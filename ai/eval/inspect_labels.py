"""AI-Hub 라벨 JSON 구조를 훑어보고 사람 bbox 분포를 낸다.

라벨 스키마를 눈으로 확인하기 전에는 파서를 못 쓴다. 그래서 먼저 구조를 찍는다.
그다음 이 스크립트가 낸 bbox 크기 분포로 **기대 recall 상한**을 근거 있게 말할 수 있다 —
"평가 못 했습니다"가 "라벨 분포에서 상한을 추정했습니다"로 바뀐다.

    ai/.venv/bin/python -m ai.eval.inspect_labels data/aihub
"""

from __future__ import annotations

import json
import sys
import zipfile
import re
from collections import Counter, defaultdict
from pathlib import Path

MAX_FILES = 400


def walk(node, path="", depth=0, out=None):
    """중첩 JSON 의 키 경로를 모은다. 깊이가 깊어 눈으로 못 따라간다."""
    out = {} if out is None else out
    if depth > 6:
        return out
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{path}.{key}" if path else key
            out.setdefault(here, type(value).__name__)
            walk(value, here, depth + 1, out)
    elif isinstance(node, list) and node:
        walk(node[0], f"{path}[]", depth + 1, out)
    return out


def iter_json(root: Path):
    """디렉터리와 zip 을 모두 훑는다. AI-Hub 는 zip 안에 zip 이 들어 있기도 하다."""
    count = 0
    for path in sorted(root.rglob("*")):
        if count >= MAX_FILES:
            return
        if path.suffix.lower() == ".json":
            try:
                yield path.name, json.loads(path.read_text(encoding="utf-8-sig"))
                count += 1
            except Exception:
                continue
        elif path.suffix.lower() == ".zip":
            try:
                with zipfile.ZipFile(path) as zf:
                    for name in zf.namelist():
                        if count >= MAX_FILES:
                            return
                        if not name.lower().endswith(".json"):
                            continue
                        try:
                            yield name, json.loads(zf.read(name).decode("utf-8-sig"))
                            count += 1
                        except Exception:
                            continue
            except zipfile.BadZipFile:
                continue


def find_numbers(node, key_hint: tuple[str, ...]):
    """키 이름에 힌트가 들어간 숫자 배열을 찾아낸다 (bbox 후보)."""
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            if any(h in key.lower() for h in key_hint) and isinstance(value, list) and value:
                if all(isinstance(v, (int, float)) for v in value):
                    found.append((key, value))
            found.extend(find_numbers(value, key_hint))
    elif isinstance(node, list):
        for item in node:
            found.extend(find_numbers(item, key_hint))
    return found


SEQ = re.compile(r"^(?P<stem>.*?)(?P<num>\d{3,})(?P<ext>\.[A-Za-z0-9]+)$")


def frame_continuity(names: list[str]) -> None:
    """파일명 끝의 일련번호를 보고 프레임이 연속인지 판정한다.

    이게 이 데이터를 쓸 수 있는지 없는지를 가른다.
      연속(1,2,3,…)  → ffmpeg 로 영상 복원 가능. 추적도 되고 평가도 된다.
      드문드문       → 추적이 성립하지 않는다. 영상 데모에 못 쓴다.
    """
    groups: dict[str, list[int]] = defaultdict(list)
    for name in names:
        match = SEQ.match(Path(name).name)
        if match:
            groups[match.group("stem")].append(int(match.group("num")))

    if not groups:
        print("\n--- 프레임 연속성 ---")
        print("  파일명에서 일련번호를 찾지 못했습니다. 위 파일명 예시를 직접 확인해 주세요.")
        return

    runs: list[int] = []
    gaps = Counter()
    for nums in groups.values():
        nums.sort()
        run = 1
        for a, b in zip(nums, nums[1:]):
            gaps[b - a] += 1
            if b - a == 1:
                run += 1
            else:
                runs.append(run)
                run = 1
        runs.append(run)

    longest = max(runs)
    consecutive = sum(gaps[1] for _ in (0,))
    total_gaps = sum(gaps.values())
    print("\n--- 프레임 연속성 ---")
    print(f"  시퀀스 그룹 {len(groups)}개 · 가장 긴 연속 구간 {longest}프레임")
    if total_gaps:
        print(f"  간격 분포 (상위 5): {gaps.most_common(5)}")
        print(f"  간격 1인 비율 {consecutive / total_gaps:.1%}")

    if longest >= 30:
        print(f"\n  ✓ 연속 프레임입니다. ffmpeg 로 영상을 복원해 데모에 쓸 수 있습니다:")
        print("      ffmpeg -framerate 15 -pattern_type glob -i '<폴더>/*.jpg' -c:v libx264 out.mp4")
    elif longest >= 5:
        print("\n  △ 짧은 연속 구간만 있습니다. 추적은 되지만 클립이 몇 초짜리라 데모가 빈약할 수 있습니다.")
    else:
        print("\n  ✗ 프레임이 드문드문합니다. 추적과 영상 복원이 성립하지 않습니다.")
        print("    다른 데이터셋을 찾거나 합성 클립으로 가야 합니다.")


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "data/aihub")
    if not root.exists():
        raise SystemExit(
            f"{root} 가 없습니다.\n"
            "aihub.or.kr 에서 샘플(경량) 데이터를 내려받아 이 경로에 풀어 두세요. "
            "자세한 안내는 data/README.md 참고."
        )

    schema: dict[str, str] = {}
    names: list[str] = []
    events = Counter()
    boxes: list[tuple[float, float]] = []
    files = 0
    sample_name = ""

    for name, doc in iter_json(root):
        files += 1
        names.append(name)
        if not sample_name:
            sample_name = name
        walk(doc, out=schema)
        # 이벤트 라벨은 문자열로 흩어져 있다. jam 계열만 세어 둔다.
        blob = json.dumps(doc, ensure_ascii=False).lower()
        for label in ("jam", "bump", "fall-down", "fall-off", "hit", "no-accident"):
            if f'"{label}"' in blob:
                events[label] += 1
        for _, nums in find_numbers(doc, ("bbox", "box", "rect", "coord")):
            if len(nums) == 4:
                w, h = abs(nums[2] - nums[0]), abs(nums[3] - nums[1])
                # [x, y, w, h] 형식일 수도 있다 — 둘 다 그럴듯하면 작은 쪽을 쓴다
                boxes.append((min(w, abs(nums[2])), min(h, abs(nums[3]))))

    if files == 0:
        raise SystemExit(f"{root} 안에서 JSON 을 찾지 못했습니다.")

    print(f"\n=== 라벨 파일 {files}개 ===")
    print("--- 파일명 예시 ---")
    for n in names[:5]:
        print(f"  {n}")
    frame_continuity(names)
    print()
    print("--- 키 경로 ---")
    for key in sorted(schema)[:80]:
        print(f"  {key}: {schema[key]}")

    if events:
        print("\n--- 이벤트 라벨이 등장한 파일 수 ---")
        for label, count in events.most_common():
            print(f"  {label:<14}{count}")

    if boxes:
        areas = sorted(w * h for w, h in boxes)
        small = sum(1 for a in areas if a < 32 * 32)
        medium = sum(1 for a in areas if 32 * 32 <= a < 96 * 96)
        large = len(areas) - small - medium
        print(f"\n--- 사람 bbox {len(areas)}개 (COCO 크기 구간) ---")
        print(f"  small  (<32²)   {small:>6}  {small / len(areas):.1%}")
        print(f"  medium (32²~96²) {medium:>5}  {medium / len(areas):.1%}")
        print(f"  large  (>96²)   {large:>6}  {large / len(areas):.1%}")
        print(f"  중앙값 면적      {areas[len(areas) // 2]:.0f}px²")
        print(
            "\n  medium 이상 비율이 높을수록 COCO 사전학습 person 의 기대 recall 이 높다.\n"
            "  이 분포가 '검출기를 파인튜닝하지 않아도 되는 이유'의 근거가 된다."
        )
    else:
        print("\n bbox 로 보이는 4-숫자 배열을 못 찾았습니다. 위 키 경로를 보고 매핑을 맞춰 주세요.")


if __name__ == "__main__":
    main()
