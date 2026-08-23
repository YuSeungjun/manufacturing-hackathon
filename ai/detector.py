"""사람 검출과 추적.

얼굴 인식도, 개인 식별도 하지 않는다. COCO person 클래스 하나만 본다.
track id 는 "프레임 안에서 같은 사람"을 잇는 임시 번호이고 영상이 끝나면 사라진다.
"""

from __future__ import annotations

import os
import threading
from typing import Iterator

import numpy as np

from . import config
from .geometry import Box, anchor_point, is_truncated

_model = None
_model_lock = threading.Lock()

# 추적기 상태는 model.predictor.trackers 에 전역으로 붙는다.
# 두 잡이 겹치면 서로의 track id 를 오염시키므로 분석은 한 번에 하나씩만 돌린다.
INFERENCE_LOCK = threading.Lock()


def get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                import torch
                from ultralytics import YOLO

                torch.set_num_threads(config.TORCH_THREADS)
                _model = YOLO(config.PERSON_MODEL)
    return _model


def warmup() -> None:
    """첫 추론은 커널 지연 초기화 때문에 3~10배 느리다. 미리 두 번 돌려 둔다."""
    model = get_model()
    dummy = np.zeros((config.IMGSZ, config.IMGSZ, 3), dtype=np.uint8)
    for _ in range(2):
        model.predict(dummy, imgsz=config.IMGSZ, classes=[0], device="cpu", verbose=False)


def model_name() -> str:
    """화면과 DB 에 남는 이름. 절대경로가 아니라 파일명만 쓴다."""
    return os.path.basename(config.PERSON_MODEL)


class Detection:
    __slots__ = ("track_id", "confidence", "box", "anchor", "truncated")

    def __init__(self, track_id: int | None, confidence: float, box: Box) -> None:
        self.track_id = track_id
        self.confidence = confidence
        self.box = box
        self.truncated = is_truncated(box)
        self.anchor = anchor_point(box, self.truncated)


def _normalize(xyxy, width: int, height: int) -> Box:
    x1, y1, x2, y2 = (float(v) for v in xyxy)
    return (x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height)


def track_video(
    video_path: str,
    stride: int,
    imgsz: int,
    conf: float,
    min_height_frac: float,
) -> Iterator[tuple[int, list[Detection], np.ndarray]]:
    """(샘플 인덱스, 검출 목록, 원본 BGR 프레임) 를 흘려보낸다.

    stream=True 로 제너레이터를 받는다. Results 를 전부 메모리에 쌓으면 긴 영상에서 터진다.
    vid_stride 는 디코딩 단계에서 프레임을 건너뛰므로 추론 비용 자체가 1/stride 로 준다.
    """
    model = get_model()
    stream = model.track(
        source=video_path,
        stream=True,
        # ★ persist=True 로 부르면 ultralytics/trackers/track.py:46 의 조기 반환 때문에
        #   추적기가 절대 초기화되지 않아 잡 사이에 track id 가 섞인다.
        persist=False,
        vid_stride=max(1, stride),
        imgsz=imgsz,
        conf=config.TRACK_CONF,
        classes=[0],
        tracker=config.TRACKER_CFG,
        device="cpu",
        verbose=False,
    )

    for index, result in enumerate(stream):
        frame = result.orig_img
        height, width = frame.shape[:2]
        detections: list[Detection] = []

        boxes = result.boxes
        if boxes is not None and len(boxes):
            # ★ 추적기가 아직 확정하지 못한 프레임에서는 id 가 통째로 None 이다.
            ids = boxes.id
            id_list = [int(v) for v in ids.tolist()] if ids is not None else [None] * len(boxes)
            for i in range(len(boxes)):
                confidence = float(boxes.conf[i])
                if confidence < conf:
                    continue
                box = _normalize(boxes.xyxy[i], width, height)
                if box[3] < min_height_frac:
                    continue  # 프레임 높이의 4% 미만은 노이즈로 본다
                detections.append(Detection(id_list[i], confidence, box))

        yield index, detections, frame
