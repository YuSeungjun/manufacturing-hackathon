"""순수 로직 단위 테스트. 모델도 영상도 필요 없다.

여기서 검증하는 게 프로젝트의 실제 가치다 — 검출기는 COCO 사전학습을 그대로 쓰고,
신규성은 전부 이 상태머신에 있다.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ai.config import ENTER_FRAMES, EXIT_FRAMES
from ai.geometry import occupancy_score, point_in_polygon, validate_polygon
from ai.harness import _classify_name
from ai.pipeline import link_limit_for
from ai.risk import RiskEngine, classify
from ai.zones import DwellState, MachineTimeline, ZoneTracker

SQUARE = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
DT = 1 / 6


# ── geometry ────────────────────────────────────────────

def test_point_in_polygon():
    assert point_in_polygon(0.5, 0.5, SQUARE)
    assert not point_in_polygon(0.1, 0.5, SQUARE)
    assert not point_in_polygon(0.5, 0.9, SQUARE)


def test_occupancy_uses_feet_not_centroid():
    """상체가 구역 밖으로 나가 있어도 발이 안이면 안이다.

    카메라에 가까운 키 큰 작업자에서 중심점 방식이 틀리는 바로 그 경우.
    """
    # 박스 상단은 구역 위(y=0.05)로 한참 나가 있고 발끝만 구역 안(y=0.7)
    box = (0.45, 0.05, 0.1, 0.65)
    assert occupancy_score(box, SQUARE) == 1.0
    # 반대로 발끝이 구역 아래로 빠지면 밖이다
    assert occupancy_score((0.45, 0.4, 0.1, 0.55), SQUARE) == 0.0


def test_occupancy_is_graded_on_the_boundary():
    """경계에 걸친 박스는 0/1 이 아니라 중간값을 준다 — 히스테리시스가 쓸 값."""
    box = (0.72, 0.4, 0.16, 0.3)  # 하단 변이 x=0.72~0.88, 구역 오른쪽 경계는 0.8
    score = occupancy_score(box, SQUARE)
    assert 0.0 < score < 1.0


def test_truncated_box_falls_back():
    """프레임 하단에 잘린 박스는 발끝을 못 믿으므로 85% 지점으로 판정한다.

    발이 화면 밖으로 나간 작업자를 bbox 하단으로 판정하면 실제 서 있는 곳보다
    훨씬 아래로 찍혀서 구역을 벗어난다 — 전형적인 미탐 경로다.
    """
    band = [(0.2, 0.5), (0.8, 0.5), (0.8, 0.95), (0.2, 0.95)]
    box = (0.45, 0.35, 0.1, 0.68)   # y+h = 1.03 > TRUNCATE_Y
    assert occupancy_score(box, band) == 1.0        # 0.35 + 0.85*0.68 = 0.928 → 안
    # 잘리지 않았다면 같은 하단 좌표가 구역 밖으로 판정된다
    assert occupancy_score(box, band, truncated=False) == 0.0


def test_occluded_lower_body_falls_back():
    """설비에 하반신이 가려져 박스가 납작해지면 하단은 발이 아니다."""
    from ai.geometry import is_truncated

    assert is_truncated((0.4, 0.4, 0.2, 0.2))       # h/w = 1.0 < 1.1
    assert not is_truncated((0.4, 0.3, 0.1, 0.4))   # h/w = 4.0


def test_self_intersection_is_warned_not_raised():
    bowtie = [(0.2, 0.2), (0.8, 0.8), (0.8, 0.2), (0.2, 0.8)]
    warnings = validate_polygon(bowtie)
    assert any("자기교차" in w for w in warnings)
    assert validate_polygon(SQUARE) == []


# ── 히스테리시스 ─────────────────────────────────────────

def test_enter_requires_consecutive_frames():
    st = DwellState()
    assert st.step(1.0, 0 * DT, DT, (0.5, 0.5)) == "OUT"      # 1프레임으론 부족
    assert st.step(1.0, 1 * DT, DT, (0.5, 0.5)) == "ENTER"    # ENTER_FRAMES=2
    assert st.inside


def test_enter_time_is_backdated():
    """진입 판정이 늦게 내려지는 만큼 소급 보정한다.

    이게 없으면 잔류시간이 매 진입마다 체계적으로 짧아진다.
    """
    st = DwellState()
    st.step(1.0, 0.0, DT, (0.5, 0.5))
    st.step(1.0, DT, DT, (0.5, 0.5))
    assert abs(st.enter_t - 0.0) < 1e-9
    assert abs(st.accum - DT) < 1e-9


def test_single_frame_miss_does_not_reset_dwell():
    """한 프레임 놓쳤다고 잔류 타이머가 끊기면 안 된다."""
    st = DwellState()
    for i in range(2):
        st.step(1.0, i * DT, DT, (0.5, 0.5))
    for i in range(2, 12):
        score = 0.0 if i == 6 else 1.0   # 6번 프레임만 미탐
        st.step(score, i * DT, DT, (0.5, 0.5))
    assert st.inside
    assert st.accum > 1.5


def test_exit_needs_sustained_absence():
    st = DwellState()
    for i in range(2):
        st.step(1.0, i * DT, DT, (0.5, 0.5))
    verdicts = [st.step(0.0, (2 + i) * DT, DT, (0.5, 0.5)) for i in range(EXIT_FRAMES)]
    assert verdicts[:-1] == ["STAY"] * (EXIT_FRAMES - 1)
    assert verdicts[-1] == "EXIT"


def test_grey_zone_holds_state():
    """회색지대(0.25~0.60)에서는 상태가 안 바뀐다 — 경계 어른거림 방지."""
    st = DwellState()
    for i in range(2):
        st.step(1.0, i * DT, DT, (0.5, 0.5))
    for i in range(2, 20):
        st.step(0.4, i * DT, DT, (0.5, 0.5))
    assert st.inside


def test_id_stitching_carries_dwell_over():
    zt = ZoneTracker("Z1")
    for i in range(12):
        zt.observe(1, 1.0, (0.5, 0.5), i * DT, DT)
    before = zt.states[1].accum
    assert before > 1.5
    zt.mark_lost(1, (0.5, 0.5), 11 * DT)
    del zt.states[1]
    # 같은 자리에 새 id 가 뜬다
    zt.observe(2, 1.0, (0.51, 0.5), 12 * DT, DT)
    assert zt.states[2].accum >= before


def test_stitching_ignores_distant_tracks():
    zt = ZoneTracker("Z1")
    for i in range(12):
        zt.observe(1, 1.0, (0.3, 0.3), i * DT, DT)
    zt.mark_lost(1, (0.3, 0.3), 11 * DT)
    del zt.states[1]
    zt.observe(2, 1.0, (0.9, 0.9), 12 * DT, DT)   # 멀리 떨어진 새 사람
    assert zt.states[2].accum == 0.0


# ── 설비 타임라인 ────────────────────────────────────────

def test_machine_timeline_is_a_step_function():
    tl = MachineTimeline(
        [{"tSec": 0.0, "state": "STOPPED"}, {"tSec": 12.5, "state": "RESTART_REQUESTED"},
         {"tSec": 14.0, "state": "RUNNING"}],
        ["Z1"],
    )
    assert tl.at("Z1", 5.0) == "STOPPED"
    assert tl.at("Z1", 12.5) == "RESTART_REQUESTED"
    assert tl.at("Z1", 13.9) == "RESTART_REQUESTED"
    assert tl.at("Z1", 99.0) == "RUNNING"


def test_missing_timeline_assumes_stopped():
    """상태를 모르면 정지로 본다. RUNNING 을 가정하면 정상 작업마다 CRITICAL 이 뜬다."""
    assert MachineTimeline([], ["Z1"]).at("Z1", 5.0) == "STOPPED"


# ── 결합 매트릭스 ────────────────────────────────────────

def test_empty_zone_is_never_an_event():
    for state in ("STOPPED", "LOTO", "RESTART_REQUESTED", "RUNNING"):
        assert classify(state, 0, 0.0, 5.0, False) is None


def test_loto_downgrades_to_info():
    """시건이 걸린 정상 작업은 경보가 아니라 기록이다."""
    assert classify("LOTO", 1, 30.0, 5.0, False) == ("ZONE_INTRUSION", "INFO")


def test_wake_up_with_worker_inside_is_critical():
    code, level = classify("RUNNING", 1, 0.2, 5.0, True)
    assert code == "RESTART_WITH_WORKER_INSIDE"
    assert level == "CRITICAL"


def test_dwell_escalates_caution_to_warning():
    assert classify("STOPPED", 1, 1.0, 5.0, False) == ("ZONE_INTRUSION", "CAUTION")
    assert classify("STOPPED", 1, 6.0, 5.0, False) == ("PROLONGED_DWELL", "WARNING")


# ── 이벤트 수명주기 ──────────────────────────────────────

ZONES = [{"id": "Z1", "name": "롤 갭 하부", "dwellWarnSec": 5.0}]


def _run(engine, script):
    """script: [(t, machine_state, occupants, max_dwell), ...]"""
    for t, state, occ, dwell in script:
        engine.step(t, "Z1", state, occ, dwell)
    return engine.finish()


def test_take_a_escalates_within_one_event():
    """테이크 A: 진입 → 잔류 → 재가동. 이벤트는 1건이고 최종 레벨은 CRITICAL."""
    engine = RiskEngine(ZONES)
    script = []
    t = 0.0
    while t < 12.0:                       # 정지 상태로 잔류
        script.append((t, "STOPPED", [1], max(0.0, t - 4.0)))
        t += DT
    while t < 16.0:                       # 동료가 스위치를 올린다
        script.append((t, "RUNNING", [1], t - 4.0))
        t += DT
    events = _run(engine, script)
    assert len(events) == 1
    ev = events[0]
    assert ev.level == "CRITICAL"
    assert ev.code == "RESTART_WITH_WORKER_INSIDE"
    assert ev.start_sec < 1.0 and ev.peak_sec >= 12.0


def test_take_b_stays_warning_without_restart():
    """테이크 B: 설비가 계속 정지면 CRITICAL 이 나오면 안 된다."""
    engine = RiskEngine(ZONES)
    script = [(i * DT, "STOPPED", [1], max(0.0, i * DT - 2.0)) for i in range(int(18 / DT))]
    events = _run(engine, script)
    assert len(events) == 1
    assert events[0].level == "WARNING"
    assert events[0].code == "PROLONGED_DWELL"


def test_take_c_produces_nothing():
    """테이크 C: 경계를 스치고 지나가면 이벤트가 0건이어야 한다."""
    engine = RiskEngine(ZONES)
    script = []
    for i in range(int(12 / DT)):
        t = i * DT
        occ = [1] if 4.0 <= t < 4.0 + DT * (ENTER_FRAMES - 1) else []
        script.append((t, "STOPPED", occ, 0.0))
    assert _run(engine, script) == []


def test_flicker_merges_into_one_event():
    """경계에서 들락날락해도 이벤트가 폭발하지 않는다."""
    engine = RiskEngine(ZONES)
    script = []
    for i in range(int(20 / DT)):
        t = i * DT
        # 2초 있고 1초 없고를 반복 — 공백이 MERGE_GAP_SEC 안이다
        occ = [1] if int(t) % 3 != 2 else []
        script.append((t, "STOPPED", occ, 3.0))
    events = _run(engine, script)
    assert len(events) == 1


def test_short_blip_is_not_confirmed():
    """1초 미만 CAUTION 은 잡음으로 버린다."""
    engine = RiskEngine(ZONES)
    script = [(i * DT, "STOPPED", [1], 0.1) for i in range(3)]
    script += [(3 * DT + i * DT, "STOPPED", [], 0.0) for i in range(1, 30)]
    assert _run(engine, script) == []


def test_critical_is_confirmed_immediately():
    """CRITICAL 은 MIN_EVENT_SEC 를 기다리지 않는다. 1초를 기다리면 이미 늦다."""
    engine = RiskEngine(ZONES)
    script = [(0.0, "STOPPED", [1], 0.0), (DT, "RUNNING", [1], DT)]
    script += [(DT * (2 + i), "RUNNING", [], 0.0) for i in range(30)]
    events = _run(engine, script)
    assert len(events) == 1
    assert events[0].level == "CRITICAL"


# ── 정지 이미지 시퀀스 ──────────────────────────────────
#
# 영상 경로와 규칙이 다르다. 프레임 하나가 곧 의도적으로 고른 관측이라 디바운스를 끄고,
# 잔류는 프레임 간격만큼만 누적한다. 그 두 가지가 실제로 그렇게 되는지 본다.

def test_single_still_frame_confirms_event():
    """이미지 한 장이 위험을 보여주면 그 한 장으로 사건이 된다.

    영상 경로는 1초 미만 이벤트를 디바운스한다(test_short_blip_is_not_confirmed).
    정지 이미지에 그 규칙을 그대로 걸면 한 장짜리 근거가 통째로 사라진다.
    """
    engine = RiskEngine([{"id": "z", "name": "테일 풀리", "dwellWarnSec": 45}], min_event_sec=0.0)
    engine.step(0.0, "z", "STOPPED", [1], 0.0)
    engine.step(30.0, "z", "STOPPED", [], 0.0)  # 다음 장에서 비면 닫힌다
    events = engine.finish()
    assert len(events) == 1
    assert events[0].code == "ZONE_INTRUSION"


def test_video_path_still_debounces():
    """정지 이미지용 완화가 영상 경로를 오염시키지 않는다."""
    engine = RiskEngine([{"id": "z", "name": "테일 풀리", "dwellWarnSec": 45}])
    engine.step(0.0, "z", "STOPPED", [1], 0.0)
    engine.step(2.0, "z", "STOPPED", [], 0.0)
    assert engine.finish() == []


def test_sparse_dwell_escalates_at_frame_resolution():
    """30초 간격 이미지에서 잔류 임계(45초)는 두 칸을 지나야 넘는다.

    잔류시간의 해상도가 프레임 간격이라는 뜻이 여기서 드러난다 — 45초 임계를
    30초 간격으로 재면 실제로 넘는 시점은 60초다. 그 사실을 숨기지 않는다.
    """
    engine = RiskEngine([{"id": "z", "name": "테일 풀리", "dwellWarnSec": 45}], min_event_sec=0.0)
    levels = []
    for t, dwell in [(0.0, 0.0), (30.0, 30.0), (60.0, 60.0)]:
        engine.step(t, "z", "STOPPED", [1], dwell)
        levels.append(engine.current("z").level)
    assert levels == ["CAUTION", "CAUTION", "WARNING"]


def test_sparse_restart_with_worker_inside_is_critical():
    """이미지 시퀀스에서도 '안에 있는 채로 깨어난 순간'이 CRITICAL 이다."""
    engine = RiskEngine([{"id": "z", "name": "테일 풀리", "dwellWarnSec": 45}], min_event_sec=0.0)
    engine.step(0.0, "z", "STOPPED", [1], 0.0)
    engine.step(30.0, "z", "RESTART_REQUESTED", [1], 30.0)
    current = engine.current("z")
    assert current.level == "CRITICAL"
    assert current.code == "RESTART_WITH_WORKER_INSIDE"
    # 새 사건을 만들지 않고 한 건의 서사로 남는다
    assert current.start_sec == 0.0


# ── 안전대 클래스 이름 매핑 ─────────────────────────────
#
# 공개 데이터셋마다 이름이 다르다. 부정 접두어를 놓치면 미착용을 착용으로 읽는다 —
# 안전 시스템에서 가장 나쁜 방향의 오류다.

def test_harness_class_names():
    assert _classify_name("harness") == "WORN"
    assert _classify_name("safety-harness") == "WORN"
    assert _classify_name("full_body_harness") == "WORN"
    assert _classify_name("safety_belt") == "WORN"

    assert _classify_name("no-harness") == "NOT_WORN"
    assert _classify_name("no_harness") == "NOT_WORN"
    assert _classify_name("NO-Harness") == "NOT_WORN"
    assert _classify_name("without harness") == "NOT_WORN"
    assert _classify_name("non-harness") == "NOT_WORN"

    # 하네스와 무관한 클래스는 판정에 쓰지 않는다
    assert _classify_name("person") is None
    assert _classify_name("Hardhat") is None
    assert _classify_name("") is None


def test_link_limit_refuses_to_bridge_sparse_frames():
    """관측되지 않은 공백은 존재의 증거가 아니다.

    30초 간격이면 90초까지 이어 붙인다 — 한두 장 미탐을 넘어가려면 그만큼은 필요하다.
    10분 간격이면 절대 상한에 걸려 아예 이어 붙이지 않는다. 그 정도로 드문 관측으로
    "계속 안에 있었다" 를 주장하면 잔류시간이 조용히 거짓이 된다.
    """
    assert link_limit_for(30.0) == 90.0
    assert link_limit_for(600.0) == 180.0   # 절대 상한
    assert link_limit_for(0.0) == 0.0       # 간격이 없으면 이어 붙일 것도 없다


def test_empty_observation_closes_open_event():
    """공백을 빈 관측으로 흘리면 열린 사건이 닫힌다.

    파이프라인이 큰 간격을 만났을 때 쓰는 수단이 이것이다 — 사건이 공백을 건너
    한 건으로 이어지면 "6.7시간 잔류" 같은 문장이 나온다.
    """
    engine = RiskEngine([{"id": "z", "name": "테일 풀리", "dwellWarnSec": 45}], min_event_sec=0.0)
    engine.step(0.0, "z", "STOPPED", [1], 0.0)
    engine.step(1.5, "z", "STOPPED", [], 0.0)      # 공백 — 빈 관측
    engine.step(3600.0, "z", "STOPPED", [1], 0.0)  # 한참 뒤 다시 보임
    events = engine.finish()
    assert len(events) == 2
    assert all(e.dwell_sec == 0.0 for e in events)
