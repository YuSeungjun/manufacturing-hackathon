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
from .detector import INFERENCE_LOCK, Detection, model_name, track_video
from .geometry import occupancy_score, validate_polygon
from .risk import CODE_LABEL, LEVEL_ORDER, RiskEngine
from .schemas import (
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


def temp_video_path(suffix: str = ".mp4") -> str:
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="pinch-")
    os.close(fd)
    return path
