"""데모 클립 채점.

배포되는 파이프라인 전체(검출 → 추적 → 기하 → 상태머신)를 end-to-end 로 재는 유일한 숫자다.
회귀 테스트로도 쓴다 — 임계값을 만지면 여기 숫자가 먼저 움직인다.

    ai/.venv/bin/python -m ai.eval.score_demo            # samples/zones/ground_truth.yaml
    ai/.venv/bin/python -m ai.eval.score_demo take-a
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

from ..pipeline import analyze
from ..schemas import AnalyzeVideoRequest

ROOT = Path(__file__).resolve().parents[2]
SPEC_DIR = ROOT / "samples" / "zones"
IOU_MATCH = 0.3


@dataclass
class Span:
    start: float
    end: float

    def iou(self, other: "Span") -> float:
        lo = max(self.start, other.start)
        hi = min(self.end, other.end)
        inter = max(0.0, hi - lo)
        union = (self.end - self.start) + (other.end - other.start) - inter
        return inter / union if union > 0 else 0.0


def load_spec(name: str) -> dict:
    path = SPEC_DIR / f"{name}.json"
    if not path.exists():
        raise SystemExit(
            f"{path} 가 없습니다.\n"
            "촬영한 클립마다 구역·설비 타임라인·정답 구간을 적어 두세요. "
            "형식은 samples/zones/take-a.example.json 참고."
        )
    return json.loads(path.read_text())


def score(name: str) -> dict:
    spec = load_spec(name)
    video = ROOT / spec["video"]
    if not video.exists():
        raise SystemExit(f"{video} 가 없습니다.")

    request = AnalyzeVideoRequest(
        zones=spec["zones"],
        machineStates=spec.get("machineStates", []),
        options={"captureMode": "none", "clipFormat": "none", **spec.get("options", {})},
    )
    result = analyze(f"eval-{name}", str(video), request)

    expected = [
        {"code": e["code"], "span": Span(e["at"][0], e["at"][1])} for e in spec.get("expect", [])
    ]
    got = [{"code": e.code, "span": Span(e.startSec, e.endSec), "level": e.level} for e in result.events]

    matched: set[int] = set()
    hits = 0
    leads: list[float] = []
    for want in expected:
        for i, have in enumerate(got):
            if i in matched or have["code"] != want["code"]:
                continue
            if want["span"].iou(have["span"]) >= IOU_MATCH:
                matched.add(i)
                hits += 1
                # 선행 시간 — 정답 구간이 시작되기 얼마나 전에 경고가 떴는가.
                # 예방 시스템의 진짜 KPI 다.
                leads.append(want["span"].start - have["span"].start)
                break

    false_positives = len(got) - len(matched)
    misses = len(expected) - hits
    precision = hits / len(got) if got else (1.0 if not expected else 0.0)
    recall = hits / len(expected) if expected else (1.0 if not got else 0.0)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall > 0 else 0.0
    minutes = max(result.videoDurationSec, 1e-6) / 60

    return {
        "name": name,
        "events": len(got),
        "expected": len(expected),
        "hits": hits,
        "fp": false_positives,
        "miss": misses,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "lead": sum(leads) / len(leads) if leads else None,
        # 시간당 오경보 — 라벨이 없어도 잴 수 있고, 운영자가 실제로 신경 쓰는 값이다
        "far_per_hour": false_positives / minutes * 60,
        "detail": got,
    }


def main() -> None:
    names = sys.argv[1:] or sorted(p.stem for p in SPEC_DIR.glob("*.json") if ".example" not in p.name)
    if not names:
        raise SystemExit(f"{SPEC_DIR} 에 채점할 클립 정의가 없습니다.")

    rows = [score(name) for name in names]
    print(f"\n{'클립':<12}{'정답':>5}{'검출':>5}{'적중':>5}{'오탐':>5}{'미탐':>5}{'F1':>7}{'선행(s)':>9}{'FAR/h':>8}")
    print("-" * 68)
    for r in rows:
        lead = f"{r['lead']:+.1f}" if r["lead"] is not None else "—"
        print(
            f"{r['name']:<12}{r['expected']:>5}{r['events']:>5}{r['hits']:>5}"
            f"{r['fp']:>5}{r['miss']:>5}{r['f1']:>7.2f}{lead:>9}{r['far_per_hour']:>8.1f}"
        )

    print()
    for r in rows:
        for event in r["detail"]:
            print(
                f"  {r['name']}  [{event['level']}] {event['code']} "
                f"{event['span'].start:.1f}~{event['span'].end:.1f}s"
            )

    total_expected = sum(r["expected"] for r in rows)
    total_hits = sum(r["hits"] for r in rows)
    total_fp = sum(r["fp"] for r in rows)
    print(f"\n합계  적중 {total_hits}/{total_expected} · 오탐 {total_fp}")
    if total_fp > 0:
        print("  오탐이 있습니다. ENTER_SCORE / ENTER_FRAMES / dwellWarnSec 를 살펴보세요.")


if __name__ == "__main__":
    main()
