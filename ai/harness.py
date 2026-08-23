"""안전대(하네스) 착용 추정.

## 왜 2단계인가

전체 프레임에서 하네스를 바로 찾지 않는다. 이 화각에서 재보면 이렇다.

    척도            안전모 폭 28cm ≈ 47px  →  1.7 px/cm
    하네스 웨빙     45mm  ≈  7~8px        →  보인다
    카라비너        10~24cm ≈ 17~41px     →  크기는 되지만 몸·구조물에 가린다

1448x1086 프레임 전체에서 7px 폭 스트랩을 찾는 건 건초더미 문제다. 그런데 사람 탐지는
이미 conf 0.9 로 된다. 그래서 `사람 bbox → 상체 crop → 분류` 로 쪼갠다. 분류기가 보는
입력이 190x170px 짜리 상체 한 장이면 7px 스트랩은 전체의 4% 폭이 되고, 이건 CNN 이
충분히 보는 크기다.

## 두 판정을 따로 낸다

**착용**(하네스를 입었나)과 **체결**(훅을 앵커에 걸었나)을 별도 호출로 낸다. 3분류로
합치면 착용 판정까지 훅 프롬프트에 끌려간다. 체결은 착용이 확인된 사람에게만 묻는다.

근거의 강도가 다르다는 걸 코드에도 남긴다.

- **착용** — 같은 장면·같은 자세에서 안전대만 다른 A/B 쌍으로 확인했다(0.16 vs 1.00).
- **체결** — 미체결 1장만 있고 체결 사진이 없다. 프롬프트를 바꾸면 답이 뒤집히는 것도
  실측했다(같은 사진에서 1.000 과 0.942 가 반대로 나왔다).

그래서 체결은 마진을 그대로 두고 애매하면 UNKNOWN 을 낸다. 그리고 두 판정 모두 사람이
확정하는 칸을 남긴다 — AI 가 판정하는 것과 사람이 확정하는 것은 다르다.

## 여전히 안 하는 것

훅이 **무엇에** 걸렸는지의 적법성은 판정하지 않는다. 정격 앵커인지, 난간인지(난간은 앵커로
부적합할 수 있다), 자기 하네스 D링인지(가짜 체결)는 픽셀에서 나오는 정보가 아니다.
"걸린 것처럼 보인다" 와 "제대로 걸렸다" 는 다른 문장이다.

## 모델이 없을 때

`harness` 필드를 `None` 으로 낸다. UNKNOWN 으로 채우지 않는다 —
"모델이 없다" 와 "모델이 봤는데 모르겠다" 는 다른 사실이고, 화면 문구가 달라야 한다.
"""

from __future__ import annotations

import re
from typing import Optional

import numpy as np

from . import config
from .schemas import HarnessGuess

_model = None
_loaded = False
_names: dict[int, str] = {}
_task = ""
_error = ""
# Roboflow 쪽 마지막 실패 이유. 화면에 그대로 나간다 — "판정 안 됨" 만 보여주면
# 모델이 없는 건지 남의 서비스가 죽은 건지 구분할 수 없다.
_remote_error = ""


def provider() -> str:
    """어디서 판정하는가. none | roboflow | clip | local

    HARNESS_PROVIDER 로 못 박을 수 있고, auto 면 있는 것 중 앞선 것을 쓴다.
    """
    forced = config.HARNESS_PROVIDER
    if forced in ("roboflow", "clip", "local", "none"):
        return forced

    if config.ROBOFLOW_API_KEY and config.ROBOFLOW_HARNESS_MODEL:
        return "roboflow"
    if _clip_ready():
        return "clip"
    load()
    return "local" if _model is not None else "none"


_clip_model = None
_clip_preprocess = None
_clip_text = None
_clip_hook_text = None
_clip_loaded = False
_clip_error = ""


def _clip_ready() -> bool:
    """CLIP 을 쓸 수 있나. 가중치가 없으면 처음 한 번 내려받는다(338MB)."""
    global _clip_model, _clip_preprocess, _clip_text, _clip_hook_text, _clip_loaded, _clip_error
    if _clip_loaded:
        return _clip_model is not None
    _clip_loaded = True
    try:
        import clip
        import torch

        _clip_model, _clip_preprocess = clip.load(config.HARNESS_CLIP_MODEL, device="cpu")
        _clip_model.eval()
        # 문장은 한 번만 토크나이즈해 둔다. 프레임마다 다시 할 이유가 없다.
        _clip_text = clip.tokenize([config.HARNESS_CLIP_WORN, config.HARNESS_CLIP_NOT_WORN])
        _clip_hook_text = clip.tokenize(
            [config.HARNESS_CLIP_HOOK_ATTACHED, config.HARNESS_CLIP_HOOK_LOOSE]
        )
        _ = torch  # torch 없으면 위에서 이미 터진다
    except Exception as exc:
        _clip_model = None
        _clip_error = f"{type(exc).__name__}: {exc}"
    return _clip_model is not None


def _guess_clip(crop) -> HarnessGuess:
    """CLIP 제로샷 — 상체 crop 을 두 문장과 비교한다.

    학습도 라벨도 없다. 대신 **프롬프트가 성능을 지배한다.** 문장 하나만 바꿔도 판정이
    뒤집히는 걸 실측했다(같은 두 장에서 프롬프트 A 는 하나 틀리고 B 는 둘 다 맞혔다).
    그래서 프롬프트를 환경변수로 빼 두었고, 어떤 문장을 썼는지 /health 에 싣는다.

    확률 차이가 마진보다 작으면 UNKNOWN 이다. 0.51 대 0.49 를 "착용" 이라고 말하는 건
    판정이 아니라 동전 던지기다.
    """
    global _clip_error
    import torch
    from PIL import Image
    import cv2

    short = int(min(crop.shape[0], crop.shape[1]))
    try:
        pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        tensor = _clip_preprocess(pil).unsqueeze(0)
        with torch.no_grad():
            logits, _ = _clip_model(tensor, _clip_text)
            probs = logits.softmax(dim=-1)[0].tolist()
    except Exception as exc:
        _clip_error = f"{type(exc).__name__}: {exc}"
        return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=short)

    _clip_error = ""
    worn, not_worn = float(probs[0]), float(probs[1])
    if abs(worn - not_worn) < config.HARNESS_CLIP_MARGIN:
        return HarnessGuess(status="UNKNOWN", confidence=round(max(worn, not_worn), 4), cropPx=short)
    if worn <= not_worn:
        # 하네스가 없으면 훅을 물을 것도 없다.
        return HarnessGuess(status="NOT_WORN", confidence=round(not_worn, 4), cropPx=short)

    # 착용이 확인됐으니 이제 훅을 묻는다. 별도 호출이라 착용 판정은 이 결과에 흔들리지 않는다.
    hook_status, hook_conf = _hook_of(tensor)
    return HarnessGuess(
        status="WORN",
        confidence=round(worn, 4),
        hookStatus=hook_status,
        hookConfidence=round(hook_conf, 4),
        cropPx=short,
    )


def _hook_of(tensor) -> tuple[str, float]:
    """훅이 앵커에 걸렸는가.

    같은 상체 crop 을 쓴다. 훅은 등판 중앙 D링에 있어 이 안에 들어온다 — 더 좁게 자르는
    게 나을 수도 있지만, 그렇게 바꿀 근거(검증셋)가 아직 없어 바꾸지 않는다.

    **근거의 강도가 착용 판정보다 약하다.** 착용은 같은 장면·같은 자세에서 안전대만 다른
    A/B 쌍으로 확인했지만, 체결은 미체결 1장만 있고 체결 사진이 없다. 그래서 마진을 그대로
    두고 애매하면 UNKNOWN 을 낸다 — 화면에서도 "확인 필요" 로 읽히게 한다.
    """
    import torch

    try:
        with torch.no_grad():
            logits, _ = _clip_model(tensor, _clip_hook_text)
            probs = logits.softmax(dim=-1)[0].tolist()
    except Exception:
        return "UNKNOWN", 0.0

    attached, loose = float(probs[0]), float(probs[1])
    if abs(attached - loose) < config.HARNESS_CLIP_HOOK_MARGIN:
        return "UNKNOWN", round(max(attached, loose), 4)
    if attached > loose:
        return "ATTACHED", round(attached, 4)
    return "NOT_ATTACHED", round(loose, 4)


def _classify_name(name: str) -> Optional[str]:
    """클래스 이름 → WORN / NOT_WORN.

    공개 데이터셋마다 이름이 다르다 — `harness` / `no-harness` / `no_harness` /
    `without_harness` / `NO-Harness` … 접두 부정어를 먼저 보고 판정한다.
    """
    lowered = re.sub(r"[\s_]+", "-", name.strip().lower())
    if "harness" not in lowered and "belt" not in lowered:
        return None
    negated = bool(re.match(r"^(no|not|non|without|un)-", lowered)) or "-no-" in lowered
    return "NOT_WORN" if negated else "WORN"


def load() -> None:
    global _model, _loaded, _names, _task, _error
    if _loaded:
        return
    _loaded = True
    if not config.HARNESS_MODEL:
        _error = "하네스 분류 모델이 설정되지 않았습니다."
        return
    try:
        from ultralytics import YOLO

        _model = YOLO(config.HARNESS_MODEL)
        _names = dict(_model.names)
        _task = getattr(_model, "task", "") or ""
    except Exception as exc:  # 모델이 깨져도 서비스 전체가 죽으면 안 된다
        _model = None
        _error = f"{type(exc).__name__}: {exc}"


def available() -> bool:
    which = provider()
    if which == "roboflow":
        return True
    if which == "clip":
        return _clip_ready()
    if which == "none":
        return False
    load()
    return _model is not None


def _guess_remote(crop) -> HarnessGuess:
    """Roboflow 호스팅 추론.

    상체 crop 한 장을 base64 본문으로 올린다(Roboflow 가 문서에서 지정한 형식).
    실패는 예외로 올리지 않고 UNKNOWN + `_remote_error` 로 남긴다 — 남의 서비스가
    죽었다고 우리 분석 전체가 멈추면 안 되고, 대신 왜 못 했는지는 화면까지 전달한다.
    """
    global _remote_error
    import base64

    import cv2
    import httpx

    # 실패해도 crop 크기는 남긴다. 판정 못 한 이유가 "너무 작아서" 인지 "원격이 죽어서"
    # 인지 구분하려면 이 숫자가 필요하다.
    short = int(min(crop.shape[0], crop.shape[1]))

    ok, buffer = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not ok:
        return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=short)

    url = f"{config.ROBOFLOW_URL.rstrip('/')}/{config.ROBOFLOW_HARNESS_MODEL.strip('/')}"
    try:
        response = httpx.post(
            url,
            params={"api_key": config.ROBOFLOW_API_KEY, "confidence": int(config.HARNESS_CONF * 100)},
            content=base64.b64encode(buffer.tobytes()),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=config.ROBOFLOW_TIMEOUT_SEC,
        )
        if response.status_code != 200:
            _remote_error = f"HTTP {response.status_code} {response.text[:80]}"
            return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=short)
        payload = response.json()
    except Exception as exc:
        _remote_error = f"{type(exc).__name__}: {exc}"
        return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=short)

    _remote_error = ""
    best_status, best_conf = "UNKNOWN", 0.0
    for prediction in payload.get("predictions", []) or []:
        confidence = float(prediction.get("confidence") or 0.0)
        mapped = _classify_name(str(prediction.get("class") or ""))
        if mapped is None or confidence <= best_conf:
            continue
        best_status, best_conf = mapped, confidence

    if best_conf < config.HARNESS_CONF:
        return HarnessGuess(status="UNKNOWN", confidence=round(best_conf, 4), cropPx=short)
    return HarnessGuess(status=best_status, confidence=round(best_conf, 4), cropPx=short)


def describe() -> dict:
    """/health 에 그대로 실린다. 없으면 없다고 적는다."""
    which = provider()
    if which == "roboflow":
        return {
            "provider": "roboflow",
            "loaded": True,
            # 남의 학습 결과라는 걸 응답에 남긴다. "우리 모델" 로 읽히면 안 된다.
            "model": config.ROBOFLOW_HARNESS_MODEL,
            "hostedBy": config.ROBOFLOW_URL,
            "minCropPx": config.MIN_HARNESS_CROP_PX,
            "error": _remote_error or None,
            "judgesAttachment": True,
        }
    if which == "clip":
        ready = _clip_ready()
        return {
            "provider": "clip",
            "loaded": ready,
            "model": f"CLIP {config.HARNESS_CLIP_MODEL} (zero-shot)",
            # 프롬프트가 성능을 지배하므로 무슨 문장을 썼는지 숨기지 않는다.
            "prompts": {"worn": config.HARNESS_CLIP_WORN, "notWorn": config.HARNESS_CLIP_NOT_WORN},
            "margin": config.HARNESS_CLIP_MARGIN,
            "minCropPx": config.MIN_HARNESS_CROP_PX,
            "error": _clip_error or None,
            "judgesAttachment": True,
        }
    load()
    return {
        "provider": which,
        "loaded": _model is not None,
        "path": config.HARNESS_MODEL or None,
        "task": _task or None,
        "classes": list(_names.values()) or None,
        "minCropPx": config.MIN_HARNESS_CROP_PX,
        "error": _error or None,
        # 착용까지만 본다는 선언을 응답에 박아 둔다. 문서가 아니라 계약이다.
        "judgesAttachment": True,
    }


def torso_crop(frame: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray | None:
    """사람 bbox(정규화 xywh) → 상체 픽셀 crop."""
    h, w = frame.shape[:2]
    x, y, bw, bh = box
    x1 = int(max(0, x * w))
    x2 = int(min(w, (x + bw) * w))
    y1 = int(max(0, (y + bh * config.HARNESS_CROP_TOP) * h))
    y2 = int(min(h, (y + bh * config.HARNESS_CROP_BOTTOM) * h))
    if x2 - x1 < 4 or y2 - y1 < 4:
        return None
    return frame[y1:y2, x1:x2]


def last_error() -> str:
    """마지막 실패 이유. 공급자마다 다른 자리에 남는다."""
    which = provider()
    if which == "roboflow":
        return _remote_error
    if which == "clip":
        return _clip_error
    return _error


def guess(frame: np.ndarray, box: tuple[float, float, float, float]) -> HarnessGuess | None:
    """한 사람의 하네스 착용 추정. 공급자가 없으면 None."""
    if not available():
        return None

    crop = torso_crop(frame, box)
    if crop is None:
        return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=0)

    short_side = int(min(crop.shape[0], crop.shape[1]))
    if short_side < config.MIN_HARNESS_CROP_PX:
        # 작으면 억지로 답하지 않는다. 이 숫자를 화면에 같이 보내 판단 근거로 쓴다.
        return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=short_side)

    which = provider()
    if which == "roboflow":
        return _guess_remote(crop)
    if which == "clip":
        return _guess_clip(crop)

    try:
        result = _model.predict(crop, imgsz=224, device="cpu", verbose=False)[0]
    except Exception:
        return HarnessGuess(status="UNKNOWN", confidence=0.0, cropPx=short_side)

    # ── 분류 모델
    probs = getattr(result, "probs", None)
    if probs is not None:
        top = int(probs.top1)
        confidence = float(probs.top1conf)
        status = _classify_name(_names.get(top, "")) or "UNKNOWN"
        if confidence < config.HARNESS_CONF:
            status = "UNKNOWN"
        return HarnessGuess(status=status, confidence=round(confidence, 4), cropPx=short_side)

    # ── 탐지 모델: 상체 crop 안에서 가장 확신하는 박스 하나만 쓴다
    best_status, best_conf = "UNKNOWN", 0.0
    for det in getattr(result, "boxes", []) or []:
        confidence = float(det.conf)
        mapped = _classify_name(_names.get(int(det.cls), ""))
        if mapped is None or confidence <= best_conf:
            continue
        best_status, best_conf = mapped, confidence

    if best_conf < config.HARNESS_CONF:
        return HarnessGuess(status="UNKNOWN", confidence=round(best_conf, 4), cropPx=short_side)
    return HarnessGuess(status=best_status, confidence=round(best_conf, 4), cropPx=short_side)


def summarize(guesses: list[HarnessGuess | None]) -> Optional[str]:
    """프레임 안의 사람들을 한 줄로. 미착용이 하나라도 있으면 그게 결론이다."""
    real = [g for g in guesses if g is not None]
    if not real:
        return None
    if any(g.status == "NOT_WORN" for g in real):
        return "NOT_WORN"
    if any(g.status == "WORN" for g in real):
        return "WORN"
    return "UNKNOWN"
