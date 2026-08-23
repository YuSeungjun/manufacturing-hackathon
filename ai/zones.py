"""구역 점유와 잔류 시간.

여기서 하는 일은 두 가지다.
  1) 프레임마다 "이 사람이 이 구역 안인가"를 히스테리시스로 안정화한다
  2) track id 별 잔류 시간을 벽시계 초로 누적한다

잔류 누적을 프레임 수가 아니라 초로 하는 이유: targetFps 를 바꿔도 숫자가 안 흔들려야
한다. 6fps 로 재든 10fps 로 재든 "42.7초 잔류"는 같은 값이어야 한다.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field

from .config import (
    ENTER_FRAMES,
    ENTER_SCORE,
    EXIT_FRAMES,
    EXIT_SCORE,
    STITCH_MAX_DIST,
    STITCH_MAX_GAP_SEC,
    TRACK_LOST_GRACE_SEC,
)
from .geometry import Point, distance

SAFE_STATES = ("STOPPED", "LOTO")
WAKE_STATES = ("RESTART_REQUESTED", "RUNNING")


@dataclass
class DwellState:
    """한 (track, zone) 쌍의 진입/잔류 상태."""

    inside: bool = False
    hi: int = 0
    lo: int = 0
    enter_t: float = 0.0
    last_t: float = 0.0
    accum: float = 0.0
    peak_score: float = 0.0
    last_seen_t: float = 0.0
    last_anchor: Point = (0.0, 0.0)

    def step(self, score: float, t: float, dt: float, anchor: Point) -> str:
        """한 프레임 전진. ENTER | STAY | EXIT | OUT 을 돌려준다."""
        self.last_seen_t = t
        self.last_anchor = anchor
        self.peak_score = max(self.peak_score, score)

        if score >= ENTER_SCORE:
            self.hi += 1
            self.lo = 0
        elif score <= EXIT_SCORE:
            self.lo += 1
            self.hi = 0
        else:
            # 회색지대 — 관성을 유지한다. 경계에서 어른거려도 상태가 안 튄다.
            self.hi = self.lo = 0

        if not self.inside:
            if self.hi >= ENTER_FRAMES:
                self.inside = True
                # 진입 판정은 ENTER_FRAMES 만큼 늦게 내려진다. 소급 보정이 없으면
                # 잔류시간이 진입마다 체계적으로 짧아진다.
                self.enter_t = t - dt * (ENTER_FRAMES - 1)
                self.accum += t - self.enter_t
                self.last_t = t
                return "ENTER"
            return "OUT"

        self.accum += t - self.last_t
        self.last_t = t
        if self.lo >= EXIT_FRAMES:
            self.inside = False
            # 이탈도 EXIT_FRAMES 만큼 늦게 확정된다. 그만큼 되감는다.
            self.accum = max(0.0, self.accum - dt * EXIT_FRAMES)
            self.hi = self.lo = 0
            return "EXIT"
        return "STAY"


class ZoneTracker:
    """구역 하나에 대한 모든 track 의 잔류 상태를 들고 있다."""

    def __init__(self, zone_id: str) -> None:
        self.zone_id = zone_id
        self.states: dict[int, DwellState] = {}
        # 최근에 구역 안에서 사라진 track — 스티칭 후보
        self._lost: dict[int, tuple[float, Point, float]] = {}  # id -> (t, anchor, accum)

    def observe(self, track_id: int, score: float, anchor: Point, t: float, dt: float) -> str:
        state = self.states.get(track_id)
        if state is None:
            state = DwellState()
            inherited = self._stitch(anchor, t)
            if inherited is not None:
                state.accum = inherited
            self.states[track_id] = state
        verdict = state.step(score, t, dt, anchor)
        if verdict in ("ENTER", "STAY"):
            self._lost.pop(track_id, None)
        return verdict

    def _stitch(self, anchor: Point, t: float) -> float | None:
        """직전에 이 근처에서 사라진 track 의 잔류시간을 이어받는다.

        프레임 샘플링과 가림 때문에 ByteTrack 이 id 를 놓치는 일이 있다. 같은 자리에
        곧바로 새 id 가 뜨면 같은 사람으로 보는 게 잔류시간 측면에서 옳다.
        개인 식별이 아니라 "이 자리에 사람이 계속 있었다"를 잇는 것이다.
        """
        best_id: int | None = None
        best_dist = STITCH_MAX_DIST
        for old_id, (lost_t, lost_anchor, _) in self._lost.items():
            if t - lost_t > STITCH_MAX_GAP_SEC:
                continue
            d = distance(anchor, lost_anchor)
            if d < best_dist:
                best_id, best_dist = old_id, d
        if best_id is None:
            return None
        _, _, accum = self._lost.pop(best_id)
        return accum

    def expire(self, t: float) -> list[tuple[int, DwellState]]:
        """유예 시간이 지난 track 을 정리하고 종료된 것들을 돌려준다."""
        closed: list[tuple[int, DwellState]] = []
        for track_id in list(self.states):
            state = self.states[track_id]
            if t - state.last_seen_t <= TRACK_LOST_GRACE_SEC:
                continue
            if state.inside:
                state.inside = False
                self._lost[track_id] = (state.last_seen_t, state.last_anchor, state.accum)
                closed.append((track_id, state))
            del self.states[track_id]
        return closed

    def mark_lost(self, track_id: int, anchor: Point, t: float) -> None:
        state = self.states.get(track_id)
        if state is not None:
            self._lost[track_id] = (t, anchor, state.accum)

    def occupants(self) -> list[int]:
        return [tid for tid, st in self.states.items() if st.inside]

    def max_dwell(self) -> float:
        return max((st.accum for st in self.states.values() if st.inside), default=0.0)


class MachineTimeline:
    """설비 상태 계단 함수.

    실운영에서는 PLC / MES / LOTO 시건 시스템이 이걸 준다. 데모에서는 요청 JSON 으로
    주입한다. 덕분에 설비가 실제로 재가동하는 영상 없이도 재가동 순간을 재현할 수 있다.
    """

    def __init__(self, points: list[dict], zone_ids: list[str]) -> None:
        per_zone: dict[str, list[tuple[float, str]]] = {z: [] for z in zone_ids}
        for p in sorted(points, key=lambda p: float(p.get("tSec", 0.0))):
            targets = p.get("zoneIds") or zone_ids
            for z in targets:
                per_zone.setdefault(z, []).append((float(p["tSec"]), p["state"]))
        self._per_zone = per_zone
        self._keys = {z: [t for t, _ in v] for z, v in per_zone.items()}

    def at(self, zone_id: str, t: float) -> str:
        """타임라인이 없으면 STOPPED 로 본다 — 안전한 기본값.

        상태를 모르는 채로 RUNNING 을 가정하면 정상 작업마다 CRITICAL 이 뜬다.
        """
        keys = self._keys.get(zone_id)
        if not keys:
            return "STOPPED"
        i = bisect.bisect_right(keys, t) - 1
        if i < 0:
            return "STOPPED"
        return self._per_zone[zone_id][i][1]
