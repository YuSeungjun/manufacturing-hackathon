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


class AnalyzeFramesRequest(BaseModel):
    """정지 이미지 여러 장을 한 시퀀스로 분석한다.

    영상이 아니라 CCTV 캡처 이미지가 입력인 경로다. 추적기를 쓰지 않는다 — 프레임이
    희소하면 track id 가 프레임을 건너 이어지지 않고, 이어진 척하면 잔류시간이 거짓이 된다.
    대신 각 이미지를 독립 관측으로 보고 프레임 간격만큼 잔류를 누적한다.

    그래서 잔류시간의 해상도는 프레임 간격이다. 30초 간격이면 "6.4초 잔류" 는 만들 수
    없고 "30초 이상" 까지가 정직한 한계다. 이 사실은 warnings 로 함께 내보낸다.
    """

    zones: list[Zone] = Field(min_length=1)
    machineStates: list[MachineStatePoint] = Field(default_factory=list)
    # 이미지 주소. 영상과 같은 이유로 1순위다 — Vercel Function 요청 본문이 4.5MB 로
    # 막혀 있어서 이미지 몇 장이면 서버 액션으로 중계할 수 없다.
    # 브라우저 → Blob 직업로드 후 URL 만 여기로 온다. multipart 는 로컬·curl 용 보조 경로다.
    frameUrls: list[str] = Field(default_factory=list)
    # 이미지마다의 촬영 초. frameUrls / 업로드 순서와 같은 길이여야 한다.
    frameTimes: list[float] = Field(default_factory=list)
    # frameTimes 가 비었을 때 쓰는 균일 간격(초)
    intervalSec: float = Field(30.0, gt=0, le=3600)
    options: AnalyzeOptions = Field(default_factory=AnalyzeOptions)


class HarnessGuess(BaseModel):
    """안전대 착용과 훅 체결 추정.

    두 판정을 한 객체에 담되 **별도로 낸다.** 착용은 통제된 A/B 쌍으로 확인한 부분이고,
    체결은 그 위에 얹은 것이라 근거의 강도가 다르다. 하나로 뭉치면 그 차이가 사라진다.

    체결은 착용이 확인된 사람에게만 묻는다 — 하네스가 없으면 훅도 없다.
    """

    # WORN(착용) | NOT_WORN(미착용 의심) | UNKNOWN(판정 불가 — 가림·너무 작음)
    status: Literal["WORN", "NOT_WORN", "UNKNOWN"] = "UNKNOWN"
    confidence: float = 0.0
    # ATTACHED(앵커에 체결) | NOT_ATTACHED(늘어져 있음) | UNKNOWN(안 물어봤거나 애매함)
    hookStatus: Literal["ATTACHED", "NOT_ATTACHED", "UNKNOWN"] = "UNKNOWN"
    hookConfidence: float = 0.0
    # 판정에 쓴 상체 crop 이 몇 픽셀이었나. 작으면 신뢰하지 말라는 신호다.
    cropPx: int = 0


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
    # 하네스 분류기가 없으면 None 이다. 없는 판정을 UNKNOWN 으로 채우지 않는다 —
    # "모델이 없다" 와 "모델이 못 봤다" 는 다른 사실이다.
    harness: HarnessGuess | None = None


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


class HarnessPerson(BaseModel):
    """한 사람과 그 사람의 안전대 착용 추정."""

    confidence: float
    x: float
    y: float
    w: float
    h: float
    harness: HarnessGuess


class HarnessCheckResult(BaseModel):
    """이미지 한 장의 안전대 착용·체결 판정.

    위험구역도 잔류도 보지 않는다 — 다른 질문이다. 여기서 나오는 건 "이 장면의 사람들이
    하네스를 입었나" 와 "훅을 앵커에 걸었나" 두 개다.

    사람의 확인 칸은 그대로 남는다. AI 가 판정한다는 것과 사람이 확정한다는 것은 다르다 —
    이 프로젝트의 다른 모든 판정과 같은 구조다.
    """

    # none | roboflow | local. 남의 학습 결과면 그렇다고 적는다.
    provider: str
    model: str
    personCount: int
    persons: list[HarnessPerson] = Field(default_factory=list)
    # WORN 하나라도 없고 NOT_WORN 이 있으면 NOT_WORN. 아무도 못 보면 UNKNOWN.
    verdict: Literal["WORN", "NOT_WORN", "UNKNOWN"] = "UNKNOWN"
    confidence: float = 0.0
    # 프레임 결론. 미체결이 하나라도 있으면 그게 결론이다.
    hookVerdict: Literal["ATTACHED", "NOT_ATTACHED", "UNKNOWN"] = "UNKNOWN"
    hookConfidence: float = 0.0
    # 판정하지 못한 이유. 공급자가 없거나 원격이 죽었을 때 화면까지 전달한다.
    error: str = ""


class FrameCheckResult(BaseModel):
    model: str
    imageWidth: int
    imageHeight: int
    personCount: int
    occupancy: dict[str, int]
    persons: list[PersonBox]
    riskLevel: Level
