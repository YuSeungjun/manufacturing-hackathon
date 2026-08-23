"""위험 판정 상태머신.

끼임 사고는 "사람이 들어간 사건"이 아니라 **사람이 안에 있는 채로 설비가 깨어난
사건**이다. 그래서 이 모듈의 중심은 점유 자체가 아니라 설비 상태의 전이(edge)다.

그리고 그 판정은 track id 에 의존하지 않는다. 구역 점유 인원수만 본다.
프레임 샘플링으로 id 가 끊겨도 "재가동 시점에 안에 사람이 있었다"는 흔들리지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .config import (
    COOLDOWN_SEC,
    DEFAULT_DWELL_WARN_SEC,
    MERGE_GAP_SEC,
    MIN_EVENT_SEC,
)
from .zones import SAFE_STATES, WAKE_STATES

LEVEL_ORDER = {"SAFE": 0, "INFO": 1, "CAUTION": 2, "WARNING": 3, "CRITICAL": 4}

STATE_LABEL = {
    "STOPPED": "정지",
    "LOTO": "시건 완료",
    "RESTART_REQUESTED": "재가동 요청",
    "RUNNING": "가동",
}

CODE_LABEL = {
    "ZONE_INTRUSION": "위험구역 진입",
    "PROLONGED_DWELL": "위험구역 잔류",
    "LOTO_MISSING": "시건 없이 작업",
    "ENTRY_WHILE_RUNNING": "가동 중 위험구역 진입",
    "RESTART_WITH_WORKER_INSIDE": "작업자 잔류 중 재가동",
}


@dataclass
class OpenEvent:
    code: str
    level: str
    zone_id: str
    zone_name: str
    start_sec: float
    peak_sec: float
    last_true_sec: float
    machine_state: str
    reason: str
    dwell_sec: float = 0.0
    occupants_at_peak: int = 0
    track_ids: set[int] = field(default_factory=set)
    confirmed: bool = False
    capture_secs: list[float] = field(default_factory=list)


@dataclass
class ClosedEvent:
    code: str
    level: str
    zone_id: str
    zone_name: str
    start_sec: float
    peak_sec: float
    end_sec: float
    dwell_sec: float
    machine_state: str
    occupants_at_peak: int
    track_ids: list[int]
    reason: str
    capture_secs: list[float]


def classify(
    machine_state: str,
    occupants: int,
    max_dwell: float,
    dwell_warn_sec: float,
    woke_up: bool,
) -> tuple[str, str] | None:
    """(code, level) 또는 None. 결합 매트릭스 그 자체."""
    if occupants <= 0:
        return None

    # 사람이 안에 있는데 설비가 깨어났다 — 이 시스템이 존재하는 이유
    if woke_up:
        return "RESTART_WITH_WORKER_INSIDE", "CRITICAL"
    if machine_state == "RUNNING":
        return "ENTRY_WHILE_RUNNING", "CRITICAL"
    if machine_state == "RESTART_REQUESTED":
        return "RESTART_WITH_WORKER_INSIDE", "CRITICAL"
    if machine_state == "LOTO":
        # 시건이 걸려 있으면 정상 작업이다. 기록은 남기되 경보는 아니다.
        return "ZONE_INTRUSION", "INFO"
    # STOPPED — 시건 없이 들어가 있다
    if max_dwell >= dwell_warn_sec:
        return "PROLONGED_DWELL", "WARNING"
    return "ZONE_INTRUSION", "CAUTION"


def _euro(word: str) -> str:
    """받침 유무에 따라 "으로" / "로" 를 고른다.

    현장 사람이 읽는 문장이다. "재가동 요청로" 같은 말이 화면에 뜨면
    나머지가 아무리 정확해도 신뢰를 잃는다.
    """
    if not word:
        return "로"
    last = word.strip()[-1]
    if not ("가" <= last <= "힣"):
        return "로"
    jong = (ord(last) - 0xAC00) % 28
    return "로" if jong in (0, 8) else "으로"   # 받침 없음 또는 ㄹ 받침


def build_reason(code: str, zone_name: str, occupants: int, dwell: float, state: str) -> str:
    label = STATE_LABEL.get(state, state)
    if code == "RESTART_WITH_WORKER_INSIDE":
        return f"{zone_name} 안에 작업자 {occupants}명이 있는 상태에서 설비가 {label}{_euro(label)} 전환됐습니다."
    if code == "ENTRY_WHILE_RUNNING":
        return f"설비가 가동 중인데 {zone_name}에 작업자 {occupants}명이 있습니다."
    if code == "PROLONGED_DWELL":
        return f"{zone_name}에 작업자 {occupants}명이 {dwell:.1f}초째 머물고 있습니다. 시건 기록이 없습니다."
    if code == "LOTO_MISSING":
        return f"{zone_name} 작업에 개인 시건 기록이 없습니다."
    return f"{zone_name}에 작업자 {occupants}명이 진입했습니다."


class RiskEngine:
    """구역별로 이벤트를 열고, 올리고, 병합하고, 닫는다."""

    def __init__(self, zones: list[dict], min_event_sec: float = MIN_EVENT_SEC) -> None:
        self._zone_name = {z["id"]: z.get("name") or z["id"] for z in zones}
        self._warn = {
            z["id"]: float(z.get("dwellWarnSec") or DEFAULT_DWELL_WARN_SEC) for z in zones
        }
        # 영상에서는 한두 프레임짜리 이벤트를 디바운스한다(1초). 정지 이미지 시퀀스에서는
        # 프레임 하나가 곧 의도적으로 고른 관측이라 0 을 넣어 그 한 장을 인정한다.
        self._min_event_sec = min_event_sec
        self._open: dict[str, OpenEvent] = {}
        self._prev_state: dict[str, str] = {}
        self.closed: list[ClosedEvent] = []

    def step(
        self,
        t: float,
        zone_id: str,
        machine_state: str,
        occupants: list[int],
        max_dwell: float,
    ) -> None:
        prev = self._prev_state.get(zone_id)
        woke_up = prev in SAFE_STATES and machine_state in WAKE_STATES and len(occupants) > 0
        self._prev_state[zone_id] = machine_state

        verdict = classify(
            machine_state, len(occupants), max_dwell, self._warn.get(zone_id, DEFAULT_DWELL_WARN_SEC), woke_up
        )
        current = self._open.get(zone_id)

        if verdict is None:
            if current is not None and t - current.last_true_sec >= COOLDOWN_SEC:
                self._close(zone_id, current)
            return

        code, level = verdict
        name = self._zone_name.get(zone_id, zone_id)
        reason = build_reason(code, name, len(occupants), max_dwell, machine_state)

        if current is None:
            current = OpenEvent(
                code=code, level=level, zone_id=zone_id, zone_name=name,
                start_sec=t, peak_sec=t, last_true_sec=t,
                machine_state=machine_state, reason=reason,
                dwell_sec=max_dwell, occupants_at_peak=len(occupants),
                capture_secs=[t],
            )
            current.track_ids.update(occupants)
            # CRITICAL 은 즉시 확정한다. 1초를 기다리면 이미 늦다.
            # min_event_sec 이 0 이면(정지 이미지 경로) 첫 관측만으로도 확정한다.
            current.confirmed = level == "CRITICAL" or self._min_event_sec <= 0
            self._open[zone_id] = current
            return

        current.last_true_sec = t
        current.track_ids.update(occupants)
        current.dwell_sec = max(current.dwell_sec, max_dwell)
        if not current.confirmed and (level == "CRITICAL" or t - current.start_sec >= self._min_event_sec):
            current.confirmed = True

        # 에스컬레이션 — 새 이벤트를 만들지 않는다.
        # "진입 → 잔류 → 재가동"이 이벤트 1건의 서사로 남아야 한다.
        if LEVEL_ORDER[level] > LEVEL_ORDER[current.level]:
            current.level = level
            current.code = code
            current.peak_sec = t
            current.reason = reason
            current.machine_state = machine_state
            current.occupants_at_peak = len(occupants)
            current.capture_secs.append(t)
            current.confirmed = current.confirmed or level == "CRITICAL"
        elif LEVEL_ORDER[level] == LEVEL_ORDER[current.level] and len(occupants) > current.occupants_at_peak:
            current.occupants_at_peak = len(occupants)
            current.peak_sec = t
            current.reason = reason

    def current(self, zone_id: str) -> OpenEvent | None:
        """지금 열려 있는 이벤트. 파이프라인이 캡처 시점을 잡을 때 본다."""
        return self._open.get(zone_id)

    def _close(self, zone_id: str, ev: OpenEvent) -> None:
        del self._open[zone_id]
        if not ev.confirmed:
            return
        # 방금 닫힌 같은 (구역, 코드) 가 MERGE_GAP_SEC 안에 있으면 되살려 잇는다.
        # 경계에서 어른거리는 작업자가 이벤트 12건으로 폭발하는 걸 막는다.
        for prior in reversed(self.closed):
            if prior.zone_id != zone_id or prior.code != ev.code:
                continue
            if ev.start_sec - prior.end_sec <= MERGE_GAP_SEC:
                prior.end_sec = ev.last_true_sec
                prior.dwell_sec = max(prior.dwell_sec, ev.dwell_sec)
                prior.occupants_at_peak = max(prior.occupants_at_peak, ev.occupants_at_peak)
                prior.track_ids = sorted(set(prior.track_ids) | ev.track_ids)
                if LEVEL_ORDER[ev.level] > LEVEL_ORDER[prior.level]:
                    prior.level, prior.peak_sec, prior.reason = ev.level, ev.peak_sec, ev.reason
                    prior.capture_secs.extend(ev.capture_secs)
                return
            break
        self.closed.append(
            ClosedEvent(
                code=ev.code, level=ev.level, zone_id=ev.zone_id, zone_name=ev.zone_name,
                start_sec=ev.start_sec, peak_sec=ev.peak_sec, end_sec=ev.last_true_sec,
                dwell_sec=ev.dwell_sec, machine_state=ev.machine_state,
                occupants_at_peak=ev.occupants_at_peak, track_ids=sorted(ev.track_ids),
                reason=ev.reason, capture_secs=ev.capture_secs,
            )
        )

    def finish(self) -> list[ClosedEvent]:
        """영상이 끝났다. 아직 열려 있는 이벤트를 전부 닫는다."""
        for zone_id in list(self._open):
            self._close(zone_id, self._open[zone_id])
        self.closed.sort(key=lambda e: (e.start_sec, e.zone_id))
        return self.closed
