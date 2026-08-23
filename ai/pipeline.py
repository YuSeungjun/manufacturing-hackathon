"""영상 한 편을 분석해 AnalyzeResult 를 만든다.

프레임 루프 하나에서 검출 → 점유 → 잔류 → 위험 판정 → 캡처까지 흘린다.
두 번째 디코딩 패스가 없어야 CPU 예산 안에 들어온다.
"""

from __future__ import annotations

import math
import os
import tempfile
import threading
import time
from datetime import timedelta
from uuid import uuid4

import cv2

from . import config
from .capture import STORE, RingBuffer, blur_heads, downscale, encode_jpeg, encode_webp_clip
from .detector import INFERENCE_LOCK, Detection, detect_image, model_name, track_video
from .geometry import occupancy_score, validate_polygon
from .risk import CODE_LABEL, LEVEL_ORDER, RiskEngine
from .schemas import (
    AnalyzeFramesRequest,
    AnalyzeResult,
    AnalyzeVideoRequest,
    Capture,
    FrameSample,
    JobStatus,
    PersonBox,
    RiskEventOut,
    TimeBucket,
    ZoneStat,
)
from .zones import MachineTimeline, ZoneTracker

BUCKET_SEC = 10.0


def probe(path: str) -> tuple[float, float, int]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError("영상을 열 수 없습니다. 지원되는 형식인지 확인해 주세요.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    if fps <= 0:
        fps = 30.0
    duration = total / fps if total else 0.0
    return fps, duration, total


def analyze(
    job_id: str,
    video_path: str,
    req: AnalyzeVideoRequest,
    on_progress=None,
) -> AnalyzeResult:
    started = time.perf_counter()
    opts = req.options
    warnings: list[str] = []

    zone_ids = [z.id for z in req.zones]
    for zone in req.zones:
        for warning in validate_polygon([tuple(p) for p in zone.polygon]):
            warnings.append(f"[{zone.name or zone.id}] {warning}")

    source_fps, duration, total_frames = probe(video_path)
    stride = max(1, round(source_fps / opts.targetFps))
    sampled_fps = source_fps / stride
    dt = 1.0 / sampled_fps

    limit_sec = min(duration, opts.maxDurationSec) if duration else opts.maxDurationSec
    if duration and duration > opts.maxDurationSec:
        warnings.append(
            f"영상이 {duration:.0f}초로 한도({opts.maxDurationSec:.0f}초)를 넘어 앞부분만 분석했습니다."
        )
    expected = max(1, int(limit_sec * sampled_fps)) if limit_sec else 1

    timeline = MachineTimeline([p.model_dump() for p in req.machineStates], zone_ids)
    trackers = {z.id: ZoneTracker(z.id) for z in req.zones}
    engine = RiskEngine([z.model_dump() for z in req.zones])
    polygons = {z.id: [tuple(p) for p in z.polygon] for z in req.zones}
    zone_names = {z.id: (z.name or z.id) for z in req.zones}

    ring = RingBuffer(opts.clipBeforeSec, sampled_fps)
    frames_out: list[FrameSample] = []
    # 캡처 대기열: 위험 순간 이후 프레임을 몇 장 더 모아야 클립이 완성된다
    pending: list[dict] = []
    finished_clips: dict[float, list] = {}
    peak_jpegs: dict[float, tuple[bytes, int, int]] = {}
    occupied_frames = {z.id: 0 for z in req.zones}
    entry_counts = {z.id: 0 for z in req.zones}
    seen_tracks: dict[str, set[int]] = {z.id: set() for z in req.zones}
    processed = 0

    for index, detections, frame in track_video(
        video_path, stride, opts.imgsz, opts.conf, opts.minPersonHeightFrac
    ):
        t = index * stride / source_fps
        if limit_sec and t > limit_sec:
            break

        persons: list[PersonBox] = []
        per_zone_occupants: dict[str, list[int]] = {z: [] for z in zone_ids}
        anon_id = -1  # 추적기가 id 를 못 준 검출도 인원수에는 세야 한다

        for det in detections:
            occupancy: dict[str, float] = {}
            inside: list[str] = []
            track_id = det.track_id
            if track_id is None:
                track_id = anon_id
                anon_id -= 1

            for zone_id, poly in polygons.items():
                score = occupancy_score(det.box, poly, det.truncated)
                occupancy[zone_id] = round(score, 3)
                verdict = trackers[zone_id].observe(track_id, score, det.anchor, t, dt)
                if verdict == "ENTER":
                    entry_counts[zone_id] += 1
                if trackers[zone_id].states[track_id].inside:
                    inside.append(zone_id)
                    per_zone_occupants[zone_id].append(track_id)
                    if det.track_id is not None:
                        seen_tracks[zone_id].add(det.track_id)

            persons.append(
                PersonBox(
                    trackId=det.track_id,
                    confidence=round(det.confidence, 4),
                    x=round(det.box[0], 5), y=round(det.box[1], 5),
                    w=round(det.box[2], 5), h=round(det.box[3], 5),
                    anchorX=round(det.anchor[0], 5), anchorY=round(det.anchor[1], 5),
                    zoneIds=inside, occupancy=occupancy, truncated=det.truncated,
                )
            )

        # 놓친 track 정리 — 유예 시간이 지나면 잔류를 끝낸다
        for zone_id in zone_ids:
            trackers[zone_id].expire(t)

        frame_level = "SAFE"
        machine_at = {}
        zone_dwell = {}
        for zone_id in zone_ids:
            state = timeline.at(zone_id, t)
            machine_at[zone_id] = state
            occupants = per_zone_occupants[zone_id]
            max_dwell = trackers[zone_id].max_dwell()
            zone_dwell[zone_id] = round(max_dwell, 2)
            if occupants:
                occupied_frames[zone_id] += 1
            open_before = engine.current(zone_id)
            before_level = open_before.level if open_before else None
            engine.step(t, zone_id, state, occupants, max_dwell)
            current = engine.current(zone_id)
            if current is not None and LEVEL_ORDER[current.level] > LEVEL_ORDER[frame_level]:
                frame_level = current.level
            # 새로 열렸거나 레벨이 오른 순간을 캡처 시점으로 잡는다
            escalated = current is not None and current.level != before_level
            if escalated and opts.captureMode != "none" and current.level != "INFO":
                boxes = [(p.x, p.y, p.w, p.h) for p in persons]
                shot = frame.copy()
                if opts.blurFaces:
                    blur_heads(shot, boxes)
                peak_jpegs[round(t, 3)] = encode_jpeg(shot)
                if opts.clipFormat != "none":
                    pending.append(
                        {
                            "t": round(t, 3),
                            "frames": ring.since(t - opts.clipBeforeSec),
                            "remaining": max(1, math.ceil(opts.clipAfterSec * sampled_fps)),
                        }
                    )

        frames_out.append(
            FrameSample(
                index=index, tSec=round(t, 3), persons=persons,
                zoneOccupancy={z: len(v) for z, v in per_zone_occupants.items()},
                zoneDwell=zone_dwell, machineState=machine_at, riskLevel=frame_level,
            )
        )

        # 클립 뒷부분 채우기
        if pending:
            shrunk = downscale(frame)
            if opts.blurFaces:
                blur_heads(shrunk, [(p.x, p.y, p.w, p.h) for p in persons])
            for item in list(pending):
                item["frames"].append(shrunk)
                item["remaining"] -= 1
                if item["remaining"] <= 0:
                    finished_clips[item["t"]] = item["frames"]
                    pending.remove(item)

        ring.push(t, frame)
        processed += 1
        if on_progress and processed % 5 == 0:
            on_progress(processed, expected)

    for item in pending:  # 영상이 끝나서 뒷부분을 다 못 채운 클립
        finished_clips[item["t"]] = item["frames"]

    closed = engine.finish()

    # ── 캡처를 이벤트에 붙인다 ──────────────────────────
    events: list[RiskEventOut] = []
    for ev in closed:
        captures: list[Capture] = []
        if opts.captureMode != "none":
            moments = sorted({round(s, 3) for s in ev.capture_secs})
            # 정지 이미지는 서사를 위해 여러 장 남기되, 앞뒤를 자르고 최근 것부터 고른다
            for at in moments[-config.MAX_FRAME_CAPTURES :]:
                jpeg = peak_jpegs.get(at)
                if jpeg is not None:
                    data, width, height = jpeg
                    captures.append(_emit(job_id, "frame", "image/jpeg", "jpg", data, at, width, height, 1, opts))
            # 클립은 피크 순간 하나만. 인코딩이 이벤트당 몇 초씩 붙는다.
            if opts.clipFormat == "webp":
                peak_at = min(moments, key=lambda m: abs(m - ev.peak_sec), default=None)
                clip_frames = finished_clips.get(peak_at) if peak_at is not None else None
                if clip_frames:
                    blob, width, height, count = encode_webp_clip(clip_frames, sampled_fps)
                    captures.append(
                        _emit(job_id, "clip", "image/webp", "webp", blob, peak_at, width, height, count, opts)
                    )
        started_at = None
        if opts.recordedAt is not None:
            started_at = opts.recordedAt + timedelta(seconds=ev.start_sec)
        events.append(
            RiskEventOut(
                eventId=uuid4().hex[:12], code=ev.code, level=ev.level,
                zoneId=ev.zone_id, zoneName=ev.zone_name,
                trackIds=[t for t in ev.track_ids if t >= 0],
                startSec=round(ev.start_sec, 2), endSec=round(ev.end_sec, 2),
                peakSec=round(ev.peak_sec, 2), dwellSec=round(ev.dwell_sec, 2),
                machineState=ev.machine_state, occupantsAtPeak=ev.occupants_at_peak,
                reason=ev.reason, captures=captures, startedAt=started_at,
            )
        )

    total_samples = max(1, len(frames_out))
    stats: list[ZoneStat] = []
    for zone_id in zone_ids:
        zone_events = [e for e in events if e.zoneId == zone_id]
        counts: dict[str, int] = {}
        for e in zone_events:
            counts[CODE_LABEL.get(e.code, e.code)] = counts.get(CODE_LABEL.get(e.code, e.code), 0) + 1
        stats.append(
            ZoneStat(
                zoneId=zone_id, zoneName=zone_names[zone_id],
                totalDwellSec=round(sum(e.dwellSec for e in zone_events), 2),
                entryCount=entry_counts[zone_id],
                uniqueTrackCount=len(seen_tracks[zone_id]),
                occupiedRatio=round(occupied_frames[zone_id] / total_samples, 3),
                eventCounts=counts,
                maxLevel=max((e.level for e in zone_events), key=lambda l: LEVEL_ORDER[l], default="SAFE"),
            )
        )

    return AnalyzeResult(
        jobId=job_id, model=model_name(),
        videoDurationSec=round(duration or (len(frames_out) * dt), 2),
        sourceFps=round(source_fps, 2), sampledFps=round(sampled_fps, 2),
        frameCount=len(frames_out),
        processingSec=round(time.perf_counter() - started, 2),
        frames=frames_out, events=events, zoneStats=stats,
        timeBuckets=_buckets(frames_out, events), warnings=warnings,
    )


def link_limit_for(typical_gap: float) -> float:
    """연속 잔류로 이어 붙일 수 있는 최대 프레임 간격.

    전형 간격의 배수와 절대 상한 중 작은 값. 30초 간격이면 90초까지 이어 붙이고,
    10분 간격이면 절대 상한(180초)에 걸려 아예 이어 붙이지 않는다 — 그 정도로 드문
    관측으로 "계속 있었다" 를 주장할 수는 없다.
    """
    return min(config.MAX_LINK_GAP_SEC, max(0.0, typical_gap) * config.MAX_LINK_GAP_FACTOR)


def analyze_frames(
    job_id: str,
    images: list[tuple[float, "np.ndarray"]],
    req: AnalyzeFramesRequest,
    on_progress=None,
) -> AnalyzeResult:
    """정지 이미지 여러 장을 한 시퀀스로 분석한다.

    영상 경로와 같은 AnalyzeResult 를 만들어야 한다 — 웹은 이 결과 하나만 알고,
    위험 사건과 정지 에피소드가 그 위에 그대로 얹힌다.

    영상 경로와 세 가지가 다르다.

    ① **추적하지 않는다.** 프레임이 초 단위로 떨어져 있으면 ByteTrack 의 모션 예측이
       성립하지 않는다. track id 를 주지 않고 각 장을 독립 관측으로 본다. CRITICAL 판정이
       원래부터 id 가 아니라 구역 인원수만 보게 짜여 있어서 이래도 판정이 흔들리지 않는다.

    ② **히스테리시스를 쓰지 않는다.** 진입 2프레임(0.33초) / 이탈 4프레임(0.67초) 은
       6fps 기준이다. 30초 간격 이미지에 그대로 걸면 "진입 확정까지 60초" 가 된다.
       여기서는 한 장이 곧 의도적으로 고른 관측이므로 그 장의 점유를 그대로 인정한다.

    ③ **안전대는 여기서 판정하지 않는다.** 위험구역 진입·잔류와 안전대 착용은 다른
       질문이고 공급자도 다르다(안전대는 Roboflow 호스팅 추론). 한 버튼에 묶으면
       한쪽이 실패할 때 다른 쪽 결과까지 못 믿게 된다. `/analyze/harness` 가 그 몫이다.

    ④ **잔류시간의 해상도가 프레임 간격이다.** 30초 간격이면 "6.4초 잔류" 를 만들 수
       없다. 연속으로 점유된 첫 프레임과 지금 프레임의 시간 차가 우리가 말할 수 있는
       전부이고, 그 사이에 나갔다 들어왔을 가능성은 배제하지 못한다. 이 한계를
       warnings 로 함께 내보낸다 — 화면에서 지워지면 안 되는 문장이다.
    """
    started = time.perf_counter()
    opts = req.options
    warnings: list[str] = []

    zone_ids = [z.id for z in req.zones]
    for zone in req.zones:
        for warning in validate_polygon([tuple(p) for p in zone.polygon]):
            warnings.append(f"[{zone.name or zone.id}] {warning}")

    ordered = sorted(images, key=lambda item: item[0])
    if not ordered:
        raise ValueError("분석할 이미지가 없습니다.")

    times = [t for t, _ in ordered]
    gaps = [b - a for a, b in zip(times, times[1:]) if b > a]
    # 마지막 프레임이 대표하는 관측 폭. 간격이 하나도 없으면(1장) 요청값을 쓴다.
    typical = sorted(gaps)[len(gaps) // 2] if gaps else req.intervalSec
    spans = gaps + [typical]

    warnings.append(
        f"정지 이미지 {len(ordered)}장을 시퀀스로 분석했습니다. "
        f"프레임 간격이 평균 {typical:.0f}초라 잔류시간은 {typical:.0f}초 단위까지만 말할 수 있습니다."
    )
    warnings.append("이미지 시퀀스에서는 작업자 추적을 하지 않습니다. 인원수와 구역 점유만 봅니다.")

    # 관측되지 않은 공백은 존재의 증거가 아니다. 이 한도를 넘는 간격에서는 잔류를 끊는다.
    link_limit = link_limit_for(typical)
    broken_links = 0

    timeline = MachineTimeline([p.model_dump() for p in req.machineStates], zone_ids)
    # 프레임 하나가 곧 관측이다. 디바운스를 끄지 않으면 이미지 한 장짜리 위험이 사라진다.
    engine = RiskEngine([z.model_dump() for z in req.zones], min_event_sec=0.0)
    polygons = {z.id: [tuple(p) for p in z.polygon] for z in req.zones}
    zone_names = {z.id: (z.name or z.id) for z in req.zones}

    frames_out: list[FrameSample] = []
    peak_jpegs: dict[float, tuple[bytes, int, int]] = {}
    occupied_frames = {z: 0 for z in zone_ids}
    entry_counts = {z: 0 for z in zone_ids}
    # 연속 점유가 시작된 시각. 비면 지금 비어 있다는 뜻이다.
    since: dict[str, float | None] = {z: None for z in zone_ids}

    previous_t: float | None = None

    for index, ((t, frame), span) in enumerate(zip(ordered, spans)):
        # 앞 장과 너무 벌어졌으면 그 사이를 "빈 관측" 으로 흘려 열린 사건을 닫는다.
        # 이어 붙이면 "6.7시간 잔류" 같은 문장이 나오고, 그건 우리가 본 것이 아니다.
        if previous_t is not None and t - previous_t > link_limit:
            broken_links += 1
            for zone_id in zone_ids:
                since[zone_id] = None
                engine.step(previous_t + config.COOLDOWN_SEC, zone_id, timeline.at(zone_id, previous_t), [], 0.0)
        previous_t = t

        detections = detect_image(frame, opts.imgsz, opts.conf, opts.minPersonHeightFrac)

        persons: list[PersonBox] = []
        per_zone_occupants: dict[str, list[int]] = {z: [] for z in zone_ids}

        for order, det in enumerate(detections):
            occupancy: dict[str, float] = {}
            inside: list[str] = []
            for zone_id, poly in polygons.items():
                score = occupancy_score(det.box, poly, det.truncated)
                occupancy[zone_id] = round(score, 3)
                if score >= config.ENTER_SCORE:
                    inside.append(zone_id)
                    # 익명 번호. 한 프레임 안에서만 쓰이고 다음 장으로 넘어가지 않는다.
                    per_zone_occupants[zone_id].append(order)

            persons.append(
                PersonBox(
                    trackId=None,
                    confidence=round(det.confidence, 4),
                    x=round(det.box[0], 5), y=round(det.box[1], 5),
                    w=round(det.box[2], 5), h=round(det.box[3], 5),
                    anchorX=round(det.anchor[0], 5), anchorY=round(det.anchor[1], 5),
                    zoneIds=inside, occupancy=occupancy, truncated=det.truncated,
                )
            )

        frame_level = "SAFE"
        machine_at: dict[str, str] = {}
        zone_dwell: dict[str, float] = {}

        for zone_id in zone_ids:
            state = timeline.at(zone_id, t)
            machine_at[zone_id] = state
            occupants = per_zone_occupants[zone_id]

            if occupants:
                occupied_frames[zone_id] += 1
                if since[zone_id] is None:
                    since[zone_id] = t
                    entry_counts[zone_id] += 1
            else:
                since[zone_id] = None

            # 첫 관측에서는 0 이다. "머문 시간"이 아니라 "머문 것이 확인된 시간"이라
            # 한 장만으로는 0 초가 맞다 — 여기서 span 을 더하면 없는 관측을 만든다.
            start = since[zone_id]
            dwell = 0.0 if start is None else max(0.0, t - start)
            zone_dwell[zone_id] = round(dwell, 2)

            open_before = engine.current(zone_id)
            before_level = open_before.level if open_before else None
            engine.step(t, zone_id, state, occupants, dwell)
            current = engine.current(zone_id)
            if current is not None and LEVEL_ORDER[current.level] > LEVEL_ORDER[frame_level]:
                frame_level = current.level

            escalated = current is not None and current.level != before_level
            if escalated and opts.captureMode != "none" and current.level != "INFO":
                shot = frame.copy()
                if opts.blurFaces:
                    blur_heads(shot, [(p.x, p.y, p.w, p.h) for p in persons])
                peak_jpegs[round(t, 3)] = encode_jpeg(shot)

        frames_out.append(
            FrameSample(
                index=index, tSec=round(t, 3), persons=persons,
                zoneOccupancy={z: len(v) for z, v in per_zone_occupants.items()},
                zoneDwell=zone_dwell, machineState=machine_at, riskLevel=frame_level,
            )
        )

        if on_progress:
            on_progress(index + 1, len(ordered))

    if broken_links > 0:
        warnings.append(
            f"프레임 간격이 {link_limit:.0f}초를 넘는 구간이 {broken_links}곳 있어 그 앞뒤를 "
            "이어 붙이지 않았습니다. 보지 않은 사이에 나갔다 돌아왔을 수 있어 연속 잔류로 "
            "셀 근거가 없습니다."
        )

    closed = engine.finish()

    events: list[RiskEventOut] = []
    for ev in closed:
        captures: list[Capture] = []
        if opts.captureMode != "none":
            moments = sorted({round(sec, 3) for sec in ev.capture_secs})
            for at in moments[-config.MAX_FRAME_CAPTURES :]:
                jpeg = peak_jpegs.get(at)
                if jpeg is not None:
                    data, width, height = jpeg
                    captures.append(
                        _emit(job_id, "frame", "image/jpeg", "jpg", data, at, width, height, 1, opts)
                    )
        started_at = None
        if opts.recordedAt is not None:
            started_at = opts.recordedAt + timedelta(seconds=ev.start_sec)
        events.append(
            RiskEventOut(
                eventId=uuid4().hex[:12], code=ev.code, level=ev.level,
                zoneId=ev.zone_id, zoneName=ev.zone_name,
                trackIds=[],  # 추적하지 않으므로 남길 id 가 없다
                startSec=round(ev.start_sec, 2), endSec=round(ev.end_sec, 2),
                peakSec=round(ev.peak_sec, 2), dwellSec=round(ev.dwell_sec, 2),
                machineState=ev.machine_state, occupantsAtPeak=ev.occupants_at_peak,
                reason=ev.reason, captures=captures, startedAt=started_at,
            )
        )

    total_samples = max(1, len(frames_out))
    stats: list[ZoneStat] = []
    for zone_id in zone_ids:
        zone_events = [e for e in events if e.zoneId == zone_id]
        counts: dict[str, int] = {}
        for e in zone_events:
            label = CODE_LABEL.get(e.code, e.code)
            counts[label] = counts.get(label, 0) + 1
        stats.append(
            ZoneStat(
                zoneId=zone_id, zoneName=zone_names[zone_id],
                totalDwellSec=round(sum(e.dwellSec for e in zone_events), 2),
                entryCount=entry_counts[zone_id],
                uniqueTrackCount=0,
                occupiedRatio=round(occupied_frames[zone_id] / total_samples, 3),
                eventCounts=counts,
                maxLevel=max((e.level for e in zone_events), key=lambda l: LEVEL_ORDER[l], default="SAFE"),
            )
        )

    duration = (times[-1] - times[0]) + spans[-1]
    sampled = 1.0 / typical if typical > 0 else 0.0
    return AnalyzeResult(
        jobId=job_id, model=model_name(),
        videoDurationSec=round(duration, 2),
        sourceFps=round(sampled, 4), sampledFps=round(sampled, 4),
        frameCount=len(frames_out),
        processingSec=round(time.perf_counter() - started, 2),
        frames=frames_out, events=events, zoneStats=stats,
        timeBuckets=_buckets(frames_out, events), warnings=warnings,
    )


def _emit(job_id, kind, mime, ext, data, t, width, height, count, opts) -> Capture:
    if opts.captureMode == "inline":
        import base64

        return Capture(
            captureId=f"inline-{uuid4().hex[:8]}", kind=kind, mimeType=mime,
            dataBase64=base64.b64encode(data).decode(), tSec=t,
            width=width, height=height, frameCount=count,
        )
    capture_id = STORE.put(job_id, data, ext)
    return Capture(
        captureId=capture_id, kind=kind, mimeType=mime,
        url=f"/captures/{job_id}/{capture_id}", tSec=t,
        width=width, height=height, frameCount=count,
    )


def _buckets(frames: list[FrameSample], events: list[RiskEventOut]) -> list[TimeBucket]:
    """10초 단위 위험도 히스토그램. 긴 영상에서 어디를 봐야 하는지 한눈에 준다."""
    if not frames:
        return []
    span = frames[-1].tSec
    out: list[TimeBucket] = []
    start = 0.0
    while start <= span:
        end = start + BUCKET_SEC
        window = [f for f in frames if start <= f.tSec < end]
        if window:
            out.append(
                TimeBucket(
                    startSec=start, endSec=end,
                    maxLevel=max((f.riskLevel for f in window), key=lambda l: LEVEL_ORDER[l]),
                    occupiedFrames=sum(1 for f in window if any(v > 0 for v in f.zoneOccupancy.values())),
                    eventCount=sum(1 for e in events if start <= e.peakSec < end),
                )
            )
        start = end
    return out


# ── 잡 레지스트리 ────────────────────────────────────────

JOBS: dict[str, JobStatus] = {}
_JOB_FINISHED_AT: dict[str, float] = {}
_JOBS_LOCK = threading.Lock()


def active_count() -> int:
    with _JOBS_LOCK:
        return sum(1 for j in JOBS.values() if j.status in ("QUEUED", "RUNNING"))


def create_job() -> str:
    job_id = uuid4().hex[:12]
    with _JOBS_LOCK:
        JOBS[job_id] = JobStatus(jobId=job_id, status="QUEUED")
    return job_id


def get_job(job_id: str) -> JobStatus | None:
    with _JOBS_LOCK:
        return JOBS.get(job_id)


def drop_job(job_id: str) -> bool:
    with _JOBS_LOCK:
        existed = JOBS.pop(job_id, None) is not None
        _JOB_FINISHED_AT.pop(job_id, None)
    STORE.drop(job_id)
    return existed


def gc_jobs() -> None:
    cutoff = time.time() - config.JOB_TTL_SEC
    with _JOBS_LOCK:
        stale = [
            k for k, v in JOBS.items()
            if v.status in ("DONE", "ERROR") and _JOB_FINISHED_AT.get(k, 0.0) < cutoff
        ]
        for k in stale:
            JOBS.pop(k, None)
            _JOB_FINISHED_AT.pop(k, None)
            STORE.drop(k)
    STORE.gc()


def run_job(job_id: str, req: AnalyzeVideoRequest, video_path: str, cleanup: bool) -> None:
    """동기 함수로 둔다 — Starlette 이 스레드풀로 보내므로 이벤트 루프를 막지 않는다.

    그래야 처리 중에도 /health 와 폴링이 계속 응답한다.
    """
    status = get_job(job_id)
    if status is None:
        return

    def progress(done: int, total: int) -> None:
        status.processedFrames = done
        status.totalFrames = total
        status.progress = min(0.99, done / max(total, 1))

    try:
        # 추적기 상태가 전역이라 분석은 한 번에 하나씩만 돌린다
        with INFERENCE_LOCK:
            status.status = "RUNNING"
            result = analyze(job_id, video_path, req, progress)
        status.result = result
        status.processedFrames = result.frameCount
        status.totalFrames = result.frameCount
        status.progress = 1.0
        status.status = "DONE"
    except Exception as exc:  # 데모 중 500 대신 사람이 읽을 메시지를 남긴다
        status.status = "ERROR"
        status.error = f"{type(exc).__name__}: {exc}"
    finally:
        with _JOBS_LOCK:
            _JOB_FINISHED_AT[job_id] = time.time()
        if cleanup:
            try:
                os.unlink(video_path)
            except OSError:
                pass


def run_frames_job(job_id: str, req: AnalyzeFramesRequest, images: list) -> None:
    """정지 이미지 시퀀스 잡. run_job 과 같은 잡 레지스트리를 쓴다.

    웹의 폴링 화면과 결과 저장 경로를 영상과 공유해야 해서 동기 함수로 둔다 —
    Starlette 이 스레드풀로 보내므로 처리 중에도 /health 와 폴링이 응답한다.
    """
    status = get_job(job_id)
    if status is None:
        return

    def progress(done: int, total: int) -> None:
        status.processedFrames = done
        status.totalFrames = total
        status.progress = min(0.99, done / max(total, 1))

    try:
        with INFERENCE_LOCK:
            status.status = "RUNNING"
            result = analyze_frames(job_id, images, req, progress)
        status.result = result
        status.processedFrames = result.frameCount
        status.totalFrames = result.frameCount
        status.progress = 1.0
        status.status = "DONE"
    except Exception as exc:
        status.status = "ERROR"
        status.error = f"{type(exc).__name__}: {exc}"
    finally:
        with _JOBS_LOCK:
            _JOB_FINISHED_AT[job_id] = time.time()


def temp_video_path(suffix: str = ".mp4") -> str:
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="pinch-")
    os.close(fd)
    return path
