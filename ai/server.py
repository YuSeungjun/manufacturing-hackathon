"""제철소 TBM 안전 이행 AI 탐지 서비스.

YOLOv8 PPE 모델로 안전모/마스크/안전조끼 착용 여부를 탐지한다.
판단은 하지 않는다. 의심 근거만 만들어서 안전관리자에게 넘긴다.
"""

import io
import os
from typing import List, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel
from ultralytics import YOLO

# 배포하면 공개 주소가 된다. 토큰이 설정된 환경에서만 검사하고,
# 로컬(토큰 없음)에서는 지금까지처럼 아무 설정 없이 돌아간다.
SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "")


def require_token(authorization: Optional[str]) -> None:
    if not SERVICE_TOKEN:
        return
    if authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="인증되지 않은 요청입니다.")


MODEL_REPO = os.getenv("PPE_MODEL_REPO", "Hansung-Cho/yolov8-ppe-detection")
MODEL_FILE = os.getenv("PPE_MODEL_FILE", "best.pt")

# 모델 클래스 -> 서비스 내부 위반 코드
VIOLATION_CLASSES = {
    "NO-Hardhat": "NO_HARDHAT",
    "NO-Mask": "NO_MASK",
    "NO-Safety Vest": "NO_SAFETY_VEST",
}
COMPLIANCE_CLASSES = {
    "Hardhat": "HARDHAT",
    "Mask": "MASK",
    "Safety Vest": "SAFETY_VEST",
}

app = FastAPI(title="TBM Safety Detection Service")
_model: Optional[YOLO] = None


def get_model() -> YOLO:
    global _model
    if _model is None:
        from huggingface_hub import hf_hub_download

        weights = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE)
        _model = YOLO(weights)
    return _model


class Box(BaseModel):
    label: str
    code: str
    kind: str  # violation | compliance | context
    confidence: float
    # 0~1 정규화 좌표. 프론트에서 이미지 크기와 무관하게 오버레이한다.
    x: float
    y: float
    w: float
    h: float


class DetectResponse(BaseModel):
    modelRepo: str
    imageWidth: int
    imageHeight: int
    personCount: int
    boxes: List[Box]
    violationCodes: List[str]


@app.get("/health")
def health():
    model = get_model()
    return {"status": "ok", "modelRepo": MODEL_REPO, "classes": list(model.names.values())}


@app.post("/detect", response_model=DetectResponse)
async def detect(
    file: UploadFile = File(...),
    conf: float = Form(0.35),
    authorization: Optional[str] = Header(default=None),
):
    require_token(authorization)
    raw = await file.read()
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    width, height = image.size

    model = get_model()
    result = model.predict(source=image, conf=conf, verbose=False)[0]

    boxes: List[Box] = []
    person_count = 0
    violation_codes: set[str] = set()

    for det in result.boxes:
        label = model.names[int(det.cls)]
        confidence = float(det.conf)
        x1, y1, x2, y2 = (float(v) for v in det.xyxy[0])

        if label in VIOLATION_CLASSES:
            kind, code = "violation", VIOLATION_CLASSES[label]
            violation_codes.add(code)
        elif label in COMPLIANCE_CLASSES:
            kind, code = "compliance", COMPLIANCE_CLASSES[label]
        else:
            kind, code = "context", label.upper().replace(" ", "_")
            if label == "Person":
                person_count += 1

        boxes.append(
            Box(
                label=label,
                code=code,
                kind=kind,
                confidence=round(confidence, 4),
                x=round(x1 / width, 5),
                y=round(y1 / height, 5),
                w=round((x2 - x1) / width, 5),
                h=round((y2 - y1) / height, 5),
            )
        )

    boxes.sort(key=lambda b: b.confidence, reverse=True)
    return DetectResponse(
        modelRepo=MODEL_REPO,
        imageWidth=width,
        imageHeight=height,
        personCount=person_count,
        boxes=boxes,
        violationCodes=sorted(violation_codes),
    )
