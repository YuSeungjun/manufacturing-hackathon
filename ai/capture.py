"""위험 순간 캡처.

cv2.VideoWriter 를 쓰지 않는다.
  - avc1/H264: pip opencv-python 휠은 GPL 문제로 libx264 를 빼고 빌드한다. 조용히 0바이트가 나온다
  - mp4v: 쓰기는 되지만 Chrome/Safari 가 <video> 에서 재생하지 못한다 (검은 화면)
  - VP80/VP90: macOS arm64 휠에서 불안정 — 로컬과 배포가 갈리는 최악의 조합

Pillow 애니메이션 WebP 는 이미 있는 의존성이고, <img src> 하나로 재생되며,
코덱 라이선스 문제가 없다.
"""

from __future__ import annotations

import io
import math
import os
import shutil
import time
from collections import deque
from uuid import uuid4

import cv2
import numpy as np
from PIL import Image

from . import config
from .geometry import Box


def blur_heads(img: np.ndarray, boxes: list[Box]) -> None:
    """bbox 상단 28% 를 가우시안 블러. 캡처 인코딩 직전에만 부른다.

    "얼굴 인식을 하지 않는다"를 문서가 아니라 코드로 증명하는 부분이다.
    전체 프레임에 걸면 비용만 늘고 얻는 게 없다.
    """
    height, width = img.shape[:2]
    for x, y, w, h in boxes:
        x1 = max(int(x * width), 0)
        y1 = max(int(y * height), 0)
        x2 = min(int((x + w) * width), width)
        y2 = min(int((y + config.HEAD_FRACTION * h) * height), height)
        if x2 <= x1 or y2 <= y1:
            continue
        roi = img[y1:y2, x1:x2]
        if roi.size == 0:
            continue
        k = max(11, (min(roi.shape[:2]) // 3) | 1)
        img[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (k, k), 0)


def encode_jpeg(frame: np.ndarray, quality: int = 88) -> tuple[bytes, int, int]:
    """피크 프레임은 원해상도로 남긴다. 안전관리자가 확대해서 판단해야 한다."""
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("캡처 인코딩에 실패했습니다.")
    height, width = frame.shape[:2]
    return buf.tobytes(), width, height


def encode_webp_clip(frames_bgr: list[np.ndarray], fps: float) -> tuple[bytes, int, int, int]:
    if not frames_bgr:
        raise ValueError("클립으로 만들 프레임이 없습니다.")
    images: list[Image.Image] = []
    for frame in frames_bgr:
        images.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
    buf = io.BytesIO()
    images[0].save(
        buf,
        "WEBP",
        save_all=True,
        append_images=images[1:],
        duration=max(1, int(1000 / max(fps, 1e-6))),
        loop=0,
        quality=config.CLIP_QUALITY,
        method=4,
    )
    width, height = images[0].size
    return buf.getvalue(), width, height, len(images)


def downscale(frame: np.ndarray, max_width: int = config.CLIP_MAX_WIDTH) -> np.ndarray:
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame.copy()
    scale = max_width / width
    return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)


class RingBuffer:
    """위험 순간 '이전' 구간용.

    스트리밍 제너레이터라 지나간 프레임은 이미 버려졌다. 두 번째 디코딩 패스를 피하려면
    다운스케일한 프레임을 계속 담아 두는 수밖에 없다.
    18프레임 × 480×270×3 = 약 7MB — 무시할 수준이다.
    """

    def __init__(self, seconds: float, fps: float) -> None:
        self.frames: deque[tuple[float, np.ndarray]] = deque(
            maxlen=max(1, math.ceil(seconds * max(fps, 1e-6)))
        )

    def push(self, t: float, frame: np.ndarray) -> None:
        self.frames.append((t, downscale(frame)))

    def since(self, t0: float) -> list[np.ndarray]:
        return [f for t, f in self.frames if t >= t0]


class CaptureStore:
    """잡 단위 캡처 파일 저장소. TTL 이 지나면 통째로 지운다.

    HF Space 는 재시작하면 디스크가 날아간다. 그래서 여기 있는 건 전부 휘발성이고,
    안전관리자가 '위험 확정'을 누른 건만 웹이 가져가 Blob 에 영구 저장한다.
    AI 의 의심은 휘발, 사람의 판단은 영구.
    """

    def __init__(self, root: str = config.CAPTURE_DIR) -> None:
        self.root = root
        os.makedirs(root, exist_ok=True)

    def job_dir(self, job_id: str) -> str:
        path = os.path.join(self.root, job_id)
        os.makedirs(path, exist_ok=True)
        return path

    def put(self, job_id: str, data: bytes, ext: str) -> str:
        capture_id = f"{uuid4().hex[:12]}.{ext}"
        with open(os.path.join(self.job_dir(job_id), capture_id), "wb") as fh:
            fh.write(data)
        return capture_id

    def path(self, job_id: str, capture_id: str) -> str | None:
        # 경로 조작 방지 — 파일명만 받는다
        if "/" in capture_id or "\\" in capture_id or capture_id.startswith("."):
            return None
        candidate = os.path.join(self.root, job_id, capture_id)
        if not os.path.isfile(candidate):
            return None
        return candidate

    def drop(self, job_id: str) -> None:
        shutil.rmtree(os.path.join(self.root, job_id), ignore_errors=True)

    def gc(self, ttl_sec: float = config.JOB_TTL_SEC) -> None:
        now = time.time()
        if not os.path.isdir(self.root):
            return
        for name in os.listdir(self.root):
            path = os.path.join(self.root, name)
            try:
                if os.path.isdir(path) and now - os.path.getmtime(path) > ttl_sec:
                    shutil.rmtree(path, ignore_errors=True)
            except OSError:
                continue


STORE = CaptureStore()
