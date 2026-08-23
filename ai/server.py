"""이송·회전설비 끼임 예방 — 위험구역 감시 서비스.

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

from . import config, harness
from .capture import STORE
from .detector import Detection, get_model, model_name, warmup
from .geometry import occupancy_score
from .pipeline import (
    active_count,
    create_job,
    drop_job,
    gc_jobs,
    get_job,
    run_frames_job,
    run_job,
    temp_video_path,
)
from .risk import LEVEL_ORDER, classify
from .schemas import (
    AnalyzeFramesRequest,
    AnalyzeVideoRequest,
    FrameCheckResult,
    HarnessCheckResult,
    HarnessPerson,
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
        # 안전대는 착용까지만 본다. judgesAttachment: false 가 그 선언이다.
        "harness": harness.describe(),
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


@app.post("/analyze/frames", status_code=202)
async def analyze_frames_endpoint(
    request: Request,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(default=None),
):
    """정지 이미지 여러 장을 한 시퀀스로 분석한다.

    영상이 아니라 CCTV 캡처가 입력인 경로다. multipart 로 `files` 여러 장과 `body`
    (AnalyzeFramesRequest JSON) 를 함께 받는다.

    영상처럼 잡+폴링으로 둔다 — 웹의 폴링 화면과 결과 저장 코드를 그대로 재사용하려면
    응답 계약이 같아야 한다. 이미지 열 장이면 몇 초에 끝나지만 계약을 갈라 두면
    화면이 두 벌이 된다.

    시각은 body 의 frameTimes 를 쓴다. 파일에 박힌 타임스탬프를 OCR 하지 않는다 —
    번인 문자열은 카메라마다 위치와 서체가 다르고, 한 글자 잘못 읽으면 잔류시간이
    조용히 거짓이 된다. 사람이 첫 시각과 간격을 넣는 편이 훨씬 정확하다.
    """
    require_token(authorization)
    gc_jobs()

    content_type = (request.headers.get("content-type") or "").lower()
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(400, "이미지 시퀀스는 multipart/form-data 로 보내 주세요.")

    form = await request.form()
    raw = form.get("body")
    if raw is None:
        raise HTTPException(400, "body 필드(JSON 문자열)가 필요합니다.")
    try:
        payload = AnalyzeFramesRequest.model_validate(json.loads(str(raw)))
    except Exception as exc:
        raise HTTPException(400, f"요청 형식이 올바르지 않습니다: {exc}") from exc

    uploads = [f for f in form.getlist("files") if isinstance(f, StarletteUploadFile)]
    count = len(payload.frameUrls) or len(uploads)
    if count == 0:
        raise HTTPException(400, "분석할 이미지를 한 장 이상 올려 주세요.")
    if count > config.MAX_FRAMES:
        raise HTTPException(
            413, f"이미지는 한 번에 {config.MAX_FRAMES}장까지 분석합니다. 나눠서 올려 주세요."
        )

    if active_count() >= config.MAX_QUEUE:
        raise HTTPException(429, "분석 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요.")

    # 시각이 안 왔으면 균일 간격으로 채운다. 개수가 안 맞으면 조용히 자르지 않고 거절한다 —
    # 잘라내면 어느 이미지가 몇 시인지 어긋난 채로 통계가 나온다.
    times = list(payload.frameTimes)
    if not times:
        times = [i * payload.intervalSec for i in range(count)]
    elif len(times) != count:
        raise HTTPException(
            400, f"frameTimes 가 {len(times)}개인데 이미지는 {count}장입니다. 개수가 같아야 합니다."
        )

    limit = config.MAX_IMAGE_MB * 1024 * 1024
    images: list[tuple[float, np.ndarray]] = []

    if payload.frameUrls:
        blobs = [await _fetch_image(url, limit) for url in payload.frameUrls]
        sources = list(zip(times, payload.frameUrls, blobs))
    else:
        blobs = []
        for upload in uploads:
            data = await upload.read()
            if len(data) > limit:
                raise HTTPException(
                    413, f"{upload.filename} 이(가) {config.MAX_IMAGE_MB:.0f}MB 한도를 넘습니다."
                )
            blobs.append(data)
        sources = list(zip(times, [u.filename or "frame" for u in uploads], blobs))

    for at, label, data in sources:
        decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if decoded is None:
            raise HTTPException(400, f"{label} 을(를) 이미지로 읽지 못했습니다.")
        images.append((float(at), decoded))

    job_id = create_job()
    background.add_task(run_frames_job, job_id, payload, images)
    return {"jobId": job_id, "statusUrl": f"/analyze/jobs/{job_id}", "frameCount": len(images)}


async def _fetch_image(url: str, limit: int) -> bytes:
    """이미지 한 장을 메모리로 받는다. 영상과 달리 디스크를 거치지 않는다."""
    import httpx

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.content
    except Exception as exc:
        raise HTTPException(400, f"이미지를 내려받지 못했습니다: {exc}") from exc
    if len(data) > limit:
        raise HTTPException(413, f"이미지가 {config.MAX_IMAGE_MB:.0f}MB 한도를 넘습니다.")
    return data


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


@app.post("/analyze/harness", response_model=HarnessCheckResult)
async def analyze_harness(
    file: UploadFile = File(...),
    conf: float = Form(0.30),
    authorization: Optional[str] = Header(default=None),
):
    """이미지 한 장의 안전대 착용 판정.

    **위험구역 분석과 일부러 갈라 둔 엔드포인트다.** 진입·잔류는 우리 로직이고 사람
    탐지 하나만 쓰지만, 안전대 착용은 남의 학습 결과(Roboflow 호스팅 추론)에 의존한다.
    한 버튼에 묶으면 남의 서비스가 죽는 날 우리 판정까지 같이 못 믿게 된다.

    2단계로 본다 — 사람을 먼저 찾고(우리 모델, conf 0.9), 그 상체 crop 만 분류기에 넘긴다.
    전체 프레임에서 7px 폭 웨빙을 찾는 것보다 훨씬 쉬운 문제가 된다.

    착용과 체결을 **따로** 낸다. 체결은 착용이 확인된 사람에게만 묻는다 — 하네스가 없으면
    훅도 없다. 그리고 근거의 강도가 다르다: 착용은 통제된 A/B 쌍으로 확인했고, 체결은
    미체결 1장만 있다. 애매하면 UNKNOWN 을 내고 사람이 확정한다.
    """
    require_token(authorization)
    raw = await file.read()
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(400, "이미지를 읽을 수 없습니다.")

    which = harness.provider()
    if which == "none":
        return HarnessCheckResult(
            provider="none",
            model="",
            personCount=0,
            error="안전대 판정 공급자가 설정되지 않았습니다. ROBOFLOW_HARNESS_MODEL 또는 로컬 가중치가 필요합니다.",
        )

    model = get_model()
    result = model.predict(
        image, imgsz=config.IMGSZ, classes=[0], conf=conf, device="cpu", verbose=False
    )[0]
    height, width = image.shape[:2]

    persons: list[HarnessPerson] = []
    for box in result.boxes:
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
        det = Detection(None, float(box.conf), (x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height))
        guess = harness.guess(image, det.box)
        if guess is None:
            continue
        persons.append(
            HarnessPerson(
                confidence=round(det.confidence, 4),
                x=round(det.box[0], 5), y=round(det.box[1], 5),
                w=round(det.box[2], 5), h=round(det.box[3], 5),
                harness=guess,
            )
        )

    # 프레임 결론은 보수적으로 낸다.
    #
    # ① 미착용이 하나라도 있으면 그게 결론이다 — 세 명 중 한 명이 안 입었으면
    #    "한 명이 안 입었다" 가 관리자가 알아야 하는 사실이다.
    # ② **한 명이라도 판정 못 했으면 "착용" 이라고 말하지 않는다.** 전원을 확인하지 못한
    #    채로 착용이라고 하면 안전 도구가 틀린 방향으로 낙관하는 것이다.
    missing = [p for p in persons if p.harness.status == "NOT_WORN"]
    unknown = [p for p in persons if p.harness.status == "UNKNOWN"]
    worn = [p for p in persons if p.harness.status == "WORN"]

    if missing:
        verdict, confidence = "NOT_WORN", max(p.harness.confidence for p in missing)
    elif unknown or not worn:
        verdict = "UNKNOWN"
        confidence = max((p.harness.confidence for p in unknown), default=0.0)
    else:
        verdict, confidence = "WORN", min(p.harness.confidence for p in worn)

    # 훅 체결도 같은 규칙이다 — 미체결이 하나라도 있으면 그게 결론이고,
    # 한 명이라도 판정 못 했으면 "체결됐다" 고 말하지 않는다.
    loose = [p for p in worn if p.harness.hookStatus == "NOT_ATTACHED"]
    hooked = [p for p in worn if p.harness.hookStatus == "ATTACHED"]
    hook_unknown = [p for p in worn if p.harness.hookStatus == "UNKNOWN"]
    if loose:
        hook_verdict = "NOT_ATTACHED"
        hook_confidence = max(p.harness.hookConfidence for p in loose)
    elif hook_unknown or not hooked:
        hook_verdict = "UNKNOWN"
        hook_confidence = max((p.harness.hookConfidence for p in hook_unknown), default=0.0)
    else:
        hook_verdict = "ATTACHED"
        hook_confidence = min(p.harness.hookConfidence for p in hooked)

    # 어느 모델이 판정했는지 응답에 남긴다. 공급자마다 이름이 다른 자리에 있다.
    model_name_used = str(harness.describe().get("model") or "")
    if not model_name_used and config.HARNESS_MODEL:
        model_name_used = os.path.basename(config.HARNESS_MODEL)
    return HarnessCheckResult(
        provider=which,
        model=model_name_used,
        personCount=len(persons),
        persons=persons,
        verdict=verdict,
        confidence=round(confidence, 4),
        hookVerdict=hook_verdict,
        hookConfidence=round(hook_confidence, 4),
        error=harness.last_error(),
    )


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
                harness=harness.guess(image, det.box),
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
