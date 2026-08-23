"""압연설비 끼임 예방 — 위험구역 감시 서비스.

CCTV 영상에서 작업자를 찾아 위험구역 잔류를 판정하고, 설비 상태와 결합해
위험 순간을 잘라낸다. 판단은 하지 않는다 — 근거를 만들어 안전관리자에게 넘긴다.

얼굴 인식도 개인 식별도 하지 않는다. COCO person 클래스 하나만 보고,
track id 는 영상이 끝나면 사라지는 임시 번호다.
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from typing import Optional

import cv2
import numpy as np
from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
# form() 이 돌려주는 것은 starlette 쪽 UploadFile 이다. fastapi.UploadFile 은 그 자식이라
# isinstance 검사를 fastapi 쪽으로 하면 multipart 업로드를 놓친다.
from starlette.datastructures import UploadFile as StarletteUploadFile

from . import config
from .capture import STORE
from .detector import Detection, get_model, model_name, warmup
from .geometry import occupancy_score
from .pipeline import (
    active_count,
    create_job,
    drop_job,
    gc_jobs,
    get_job,
    run_job,
    temp_video_path,
)
from .risk import LEVEL_ORDER, classify
from .schemas import (
    AnalyzeVideoRequest,
    FrameCheckResult,
    JobStatus,
    PersonBox,
    Zone,
)
from .zones import MachineTimeline  # noqa: F401  (설비 타임라인 계약을 문서화한다)


def require_token(authorization: Optional[str]) -> None:
    """토큰이 설정된 환경에서만 검사한다. 로컬은 아무 설정 없이 그대로 붙는다."""
    if not config.SERVICE_TOKEN:
        return
    if authorization != f"Bearer {config.SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="인증되지 않은 요청입니다.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    warmup()
    gc_jobs()
    yield


app = FastAPI(title="Pinch Prevention Zone Watch", lifespan=lifespan)


@app.get("/health")
def health():
    model = get_model()
    return {
        "status": "ok",
        "model": model_name(),
        "classes": ["person"],
        "imgsz": config.IMGSZ,
        "targetFps": config.TARGET_FPS,
        "maxDurationSec": config.MAX_DURATION_SEC,
        "activeJobs": active_count(),
        # 프라이버시 선언을 계약에 박아 둔다. 문서가 아니라 응답으로 증명한다.
        "identifiesIndividuals": False,
        "faceRecognition": False,
        "faceBlur": True,
        "detectsClasses": ["person"],
        # 하위 호환 — 웹의 aiHealth() 가 modelRepo 를 읽는다
        "modelRepo": model_name(),
    }


@app.post("/analyze/video", status_code=202)
async def analyze_video(
    request: Request,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
):
    """영상 분석 잡을 띄우고 즉시 202 를 돌려준다.

    동기로 처리하면 HF Space 게이트웨이(~60초)와 업로드 시간에 걸린다.
    잡+폴링으로 가면 어떤 HTTP 홉도 3초를 안 넘고, 덤으로 진행률 바가 생긴다.

    JSON 본문의 videoUrl 이 1순위다. Vercel Function 요청 본문이 4.5MB 로 막혀 있어서
    영상은 브라우저 → Blob 직업로드로 올라가고 여기에는 URL 만 온다.
    multipart 는 curl·로컬 개발용 보조 경로다.

    본문을 직접 읽어 갈라 쓴다 — FastAPI 는 한 엔드포인트에 JSON Body 와 Form/File 을
    함께 선언하면 multipart 만 받게 되어 JSON 경로가 막힌다.
    """
    require_token(authorization)
    gc_jobs()

    content_type = (request.headers.get("content-type") or "").lower()
    upload: StarletteUploadFile | None = None

    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        raw = form.get("body")
        candidate = form.get("file")
        upload = candidate if isinstance(candidate, StarletteUploadFile) else None
        if raw is None:
            raise HTTPException(400, "multipart 요청에는 body 필드(JSON 문자열)가 필요합니다.")
        try:
            payload = AnalyzeVideoRequest.model_validate(json.loads(str(raw)))
        except Exception as exc:
            raise HTTPException(400, f"요청 형식이 올바르지 않습니다: {exc}") from exc
    else:
        try:
            payload = AnalyzeVideoRequest.model_validate(await request.json())
        except Exception as exc:
            raise HTTPException(400, f"요청 형식이 올바르지 않습니다: {exc}") from exc

    if active_count() >= config.MAX_QUEUE:
        raise HTTPException(429, "분석 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.")

    path = temp_video_path()
    if upload is not None:
        size = 0
        limit = config.MAX_VIDEO_MB * 1024 * 1024
        with open(path, "wb") as fh:
            while chunk := await upload.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    fh.close()
                    os.unlink(path)
                    raise HTTPException(413, f"영상이 {config.MAX_VIDEO_MB:.0f}MB 한도를 넘습니다.")
                fh.write(chunk)
    elif payload.videoUrl:
        await _download(payload.videoUrl, path)
    else:
        os.unlink(path)
        raise HTTPException(400, "videoUrl 또는 file 중 하나가 필요합니다.")

    job_id = create_job()
    background.add_task(run_job, job_id, payload, path, True)
    return {"jobId": job_id, "statusUrl": f"/analyze/jobs/{job_id}"}


async def _download(url: str, dest: str) -> None:
    import httpx

    limit = config.MAX_VIDEO_MB * 1024 * 1024
    size = 0
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=120.0) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                with open(dest, "wb") as fh:
                    async for chunk in response.aiter_bytes(1 << 20):
                        size += len(chunk)
                        if size > limit:
                            raise HTTPException(413, f"영상이 {config.MAX_VIDEO_MB:.0f}MB 한도를 넘습니다.")
                        fh.write(chunk)
    except HTTPException:
        os.unlink(dest)
        raise
    except Exception as exc:
        os.unlink(dest)
        raise HTTPException(400, f"영상을 내려받지 못했습니다: {exc}") from exc


@app.get("/analyze/jobs/{job_id}", response_model=JobStatus)
def job_status(job_id: str, authorization: Optional[str] = Header(default=None)):
    require_token(authorization)
    status = get_job(job_id)
    if status is None:
        raise HTTPException(404, "분석 작업을 찾을 수 없습니다. 만료되었을 수 있습니다.")
    return status


@app.delete("/analyze/jobs/{job_id}")
def job_delete(job_id: str, authorization: Optional[str] = Header(default=None)):
    require_token(authorization)
    if not drop_job(job_id):
        raise HTTPException(404, "분석 작업을 찾을 수 없습니다.")
    return {"ok": True}


@app.get("/captures/{job_id}/{capture_id}")
def capture(job_id: str, capture_id: str, authorization: Optional[str] = Header(default=None)):
    require_token(authorization)
    path = STORE.path(job_id, capture_id)
    if path is None:
        raise HTTPException(404, "캡처를 찾을 수 없습니다. 보관 기간이 지났을 수 있습니다.")
    mime = "image/webp" if capture_id.endswith(".webp") else "image/jpeg"
    return FileResponse(path, media_type=mime)


@app.post("/analyze/frame", response_model=FrameCheckResult)
async def analyze_frame(
    file: UploadFile = File(...),
    zones: str = Form("[]"),
    conf: float = Form(0.30),
    machineState: str = Form("STOPPED"),
    authorization: Optional[str] = Header(default=None),
):
    """단일 프레임 즉석 판정.

    재가동 요청 화면에서 "지금 구역이 비어 있나"를 확인할 때 쓴다. 추적도 잔류도 없이
    이 순간의 점유만 본다 — 그게 인터록이 알아야 하는 전부다.
    """
    require_token(authorization)
    raw = await file.read()
    buffer = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "이미지를 읽을 수 없습니다.")
    height, width = image.shape[:2]

    try:
        zone_models = [Zone.model_validate(z) for z in json.loads(zones)]
    except Exception as exc:
        raise HTTPException(400, f"위험구역 형식이 올바르지 않습니다: {exc}") from exc
    polygons = {z.id: [tuple(p) for p in z.polygon] for z in zone_models}

    model = get_model()
    result = model.predict(image, imgsz=config.IMGSZ, classes=[0], conf=conf, device="cpu", verbose=False)[0]

    persons: list[PersonBox] = []
    occupancy_count = {z.id: 0 for z in zone_models}
    for box in result.boxes:
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
        det = Detection(None, float(box.conf), ((x1 / width), (y1 / height), (x2 - x1) / width, (y2 - y1) / height))
        scores: dict[str, float] = {}
        inside: list[str] = []
        for zone_id, poly in polygons.items():
            score = occupancy_score(det.box, poly, det.truncated)
            scores[zone_id] = round(score, 3)
            if score >= config.ENTER_SCORE:
                inside.append(zone_id)
                occupancy_count[zone_id] += 1
        persons.append(
            PersonBox(
                trackId=None, confidence=round(det.confidence, 4),
                x=round(det.box[0], 5), y=round(det.box[1], 5),
                w=round(det.box[2], 5), h=round(det.box[3], 5),
                anchorX=round(det.anchor[0], 5), anchorY=round(det.anchor[1], 5),
                zoneIds=inside, occupancy=scores, truncated=det.truncated,
            )
        )

    level = "SAFE"
    for zone in zone_models:
        verdict = classify(machineState, occupancy_count[zone.id], 0.0, zone.dwellWarnSec, False)
        if verdict and LEVEL_ORDER[verdict[1]] > LEVEL_ORDER[level]:
            level = verdict[1]

    persons.sort(key=lambda p: p.confidence, reverse=True)
    return FrameCheckResult(
        model=model_name(), imageWidth=width, imageHeight=height,
        personCount=len(persons), occupancy=occupancy_count,
        persons=persons, riskLevel=level,
    )
