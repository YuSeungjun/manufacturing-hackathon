"""요청·응답 계약.

좌표는 전부 0~1 정규화다. 웹의 EvidenceView 가 이 전제로 짜여 있어서,
이미지 실제 크기를 몰라도 % 로 오버레이할 수 있다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .config import (
    CLIP_AFTER_SEC,
    CLIP_BEFORE_SEC,
    DEFAULT_DWELL_WARN_SEC,
    IMGSZ,
    MAX_DURATION_SEC,
    TARGET_FPS,
)

Point = tuple[float, float]
Level = Literal["SAFE", "INFO", "CAUTION", "WARNING", "CRITICAL"]
MachineState = Literal["STOPPED", "LOTO", "RESTART_REQUESTED", "RUNNING"]
RiskCode = Literal[
    "ZONE_INTRUSION",
    "PROLONGED_DWELL",
    "LOTO_MISSING",
    "ENTRY_WHILE_RUNNING",
    "RESTART_WITH_WORKER_INSIDE",
]


class Zone(BaseModel):
    id: str
    name: str = ""
    polygon: list[Point] = Field(min_length=3, max_length=64)
    kind: Literal["PINCH", "ROTATING", "TRAVEL", "GENERAL"] = "PINCH"
    dwellWarnSec: float = DEFAULT_DWELL_WARN_SEC


class MachineStatePoint(BaseModel):
    tSec: float
    state: MachineState
    machineId: str = "M1"
    zoneIds: list[str] = Field(default_factory=list)  # 비면 전 구역을 지배한다


class AnalyzeOptions(BaseModel):
    targetFps: float = Field(TARGET_FPS, ge=2.0, le=15.0)
    imgsz: int = Field(IMGSZ, ge=320, le=960)
    conf: float = Field(0.30, ge=0.05, le=0.9)
    minPersonHeightFrac: float = Field(0.04, ge=0.0, le=0.5)
    maxDurationSec: float = Field(MAX_DURATION_SEC, gt=0, le=300.0)
    captureMode: Literal["url", "inline", "none"] = "url"
    clipFormat: Literal["webp", "frames", "none"] = "webp"
    clipBeforeSec: float = CLIP_BEFORE_SEC
    clipAfterSec: float = CLIP_AFTER_SEC
    blurFaces: bool = True
    recordedAt: datetime | None = None


class AnalyzeVideoRequest(BaseModel):
    videoUrl: str | None = None
    zones: list[Zone] = Field(min_length=1)
    machineStates: list[MachineStatePoint] = Field(default_factory=list)
    options: AnalyzeOptions = Field(default_factory=AnalyzeOptions)


class PersonBox(BaseModel):
    trackId: int | None = None
    confidence: float
    x: float
    y: float
    w: float
    h: float
    anchorX: float
    anchorY: float
    zoneIds: list[str] = Field(default_factory=list)
    occupancy: dict[str, float] = Field(default_factory=dict)
    truncated: bool = False


class FrameSample(BaseModel):
    index: int
    tSec: float
    persons: list[PersonBox] = Field(default_factory=list)
    # ★ track id 에 의존하지 않는 인원수. CRITICAL 판정의 근거는 이것 하나다.
    zoneOccupancy: dict[str, int] = Field(default_factory=dict)
    zoneDwell: dict[str, float] = Field(default_factory=dict)
    machineState: dict[str, str] = Field(default_factory=dict)
    riskLevel: Level = "SAFE"


class Capture(BaseModel):
    captureId: str
    kind: Literal["frame", "clip"]
    mimeType: str
    url: str | None = None
    dataBase64: str | None = None
    tSec: float
    width: int
    height: int
    frameCount: int = 1


class RiskEventOut(BaseModel):
    eventId: str
    code: RiskCode
    level: Level
    zoneId: str
    zoneName: str
    trackIds: list[int] = Field(default_factory=list)
    startSec: float
    endSec: float
    peakSec: float
    dwellSec: float
    machineState: MachineState
    occupantsAtPeak: int
    reason: str
    captures: list[Capture] = Field(default_factory=list)
    startedAt: datetime | None = None


class ZoneStat(BaseModel):
    zoneId: str
    zoneName: str
    totalDwellSec: float = 0.0
    entryCount: int = 0
    uniqueTrackCount: int = 0
    occupiedRatio: float = 0.0
    eventCounts: dict[str, int] = Field(default_factory=dict)
    maxLevel: Level = "SAFE"


class TimeBucket(BaseModel):
    startSec: float
    endSec: float
    maxLevel: Level
    occupiedFrames: int
    eventCount: int


class AnalyzeResult(BaseModel):
    jobId: str
    model: str
    videoDurationSec: float
    sourceFps: float
    sampledFps: float
    frameCount: int
    processingSec: float
    frames: list[FrameSample] = Field(default_factory=list)
    events: list[RiskEventOut] = Field(default_factory=list)
    zoneStats: list[ZoneStat] = Field(default_factory=list)
    timeBuckets: list[TimeBucket] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class JobStatus(BaseModel):
    jobId: str
    status: Literal["QUEUED", "RUNNING", "DONE", "ERROR"]
    progress: float = 0.0
    processedFrames: int = 0
    totalFrames: int = 0
    etaSec: float | None = None
    result: AnalyzeResult | None = None
    error: str | None = None


class FrameCheckResult(BaseModel):
    model: str
    imageWidth: int
    imageHeight: int
    personCount: int
    occupancy: dict[str, int]
    persons: list[PersonBox]
    riskLevel: Level
