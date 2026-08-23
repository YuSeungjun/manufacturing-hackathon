"""안전대(하네스) 착용 분류기 학습.

## 왜 분류기인가 (탐지기가 아니고)

전체 프레임에서 하네스를 찾지 않는다. 사람 탐지는 이미 conf 0.9 로 되고, 하네스는
사람 안에만 있다. 그래서 `사람 bbox → 상체 crop → 착용/미착용 분류` 로 쪼갠다.

    척도            안전모 폭 28cm ≈ 47px  →  1.7 px/cm
    하네스 웨빙     45mm  ≈  7~8px

1448x1086 프레임 전체에서 7px 스트랩을 찾는 건 건초더미 문제지만, 190x170px 상체 crop
안에서는 전체 폭의 4% 다. 같은 픽셀을 보는데 문제가 훨씬 쉬워진다. 공개 데이터가
100장 단위인 상황에서 탐지기를 새로 학습하는 건 특히 무리다.

## 데이터

Roboflow Universe 의 harness / no-harness **탐지** 데이터셋을 받아 **분류** 데이터로
바꾼다. 라벨 박스를 그대로 잘라 클래스 폴더에 넣으면 된다 — 그 박스가 사실상 사람의
상체 영역이라서 추론 때 우리가 만드는 crop 과 모양이 같다.

    ai/.venv/bin/python -m ai.train_harness --download safety-harness-dataset/harness-uvoia/1
    ai/.venv/bin/python -m ai.train_harness --data data/harness/harness-uvoia

## 정직하게 기대할 것

공개 데이터는 대부분 건설현장 근접 촬영이고, 우리 화각은 내려다보는 CCTV 에 사람이
220px 이다. 그래서 공개 데이터만으로 학습한 모델의 우리 화각 정확도는 검증 정확도보다
낮다. `--eval-dir` 로 우리 화각 이미지를 따로 넣어 그 숫자를 **따로** 재고, 발표에서는
그 숫자를 쓴다. 검증 정확도를 우리 화각 성능인 것처럼 말하지 않는다.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import zipfile
from pathlib import Path

from . import config
from .harness import _classify_name

REPO = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO / "data" / "harness"
WORK_ROOT = REPO / "data" / "harness-cls"
OUT_MODEL = REPO / "ai" / "models" / "harness.pt"

SPLIT_ALIASES = {"train": "train", "valid": "val", "validation": "val", "val": "val", "test": "test"}


def download(slug: str, api_key: str) -> Path:
    """Roboflow Universe 데이터셋 하나를 받는다.

    slug 는 `workspace/project/version` 이다. Universe 페이지 주소 뒤에 붙는 그 값이다.
    """
    import httpx

    parts = slug.strip("/").split("/")
    if len(parts) != 3:
        raise SystemExit(f"--download 는 workspace/project/version 형식이어야 합니다: {slug}")
    workspace, project, version = parts

    api = f"https://api.roboflow.com/{workspace}/{project}/{version}/yolov8"
    print(f"[1/2] 내보내기 요청 — {slug}")
    with httpx.Client(timeout=180.0, follow_redirects=True) as client:
        response = client.get(api, params={"api_key": api_key})
        if response.status_code == 401:
            raise SystemExit("Roboflow API 키가 거부됐습니다. 키를 확인해 주세요.")
        response.raise_for_status()
        payload = response.json()
        link = (payload.get("export") or {}).get("link")
        if not link:
            raise SystemExit(f"내보내기 주소를 찾지 못했습니다: {payload}")

        dest = DATA_ROOT / project
        dest.mkdir(parents=True, exist_ok=True)
        archive = dest.with_suffix(".zip")
        print(f"[2/2] 내려받기 — {archive.name}")
        with client.stream("GET", link) as stream:
            stream.raise_for_status()
            with open(archive, "wb") as fh:
                for chunk in stream.iter_bytes(1 << 20):
                    fh.write(chunk)

    with zipfile.ZipFile(archive) as zf:
        zf.extractall(dest)
    archive.unlink()
    print(f"    → {dest}")
    return dest


def build_crops(sources: list[Path], work: Path) -> dict[str, dict[str, int]]:
    """탐지 라벨을 잘라 분류 데이터셋으로 바꾼다.

    YOLO 라벨은 `cls cx cy w h` (정규화) 다. 추론 때와 같은 상체 비율로 자른다 —
    학습과 추론의 crop 모양이 다르면 그 차이가 그대로 오차가 된다.
    """
    import cv2

    if work.exists():
        shutil.rmtree(work)
    counts: dict[str, dict[str, int]] = {}

    for source in sources:
        names = _class_names(source)
        if not names:
            print(f"  ! {source} 에서 data.yaml 클래스 이름을 못 읽었습니다. 건너뜁니다.")
            continue

        for split_dir in sorted(source.rglob("labels")):
            split = SPLIT_ALIASES.get(split_dir.parent.name.lower())
            if split is None:
                continue
            image_dir = split_dir.parent / "images"
            if not image_dir.is_dir():
                continue

            for label_path in sorted(split_dir.glob("*.txt")):
                image_path = _match_image(image_dir, label_path.stem)
                if image_path is None:
                    continue
                image = cv2.imread(str(image_path))
                if image is None:
                    continue
                height, width = image.shape[:2]

                for index, line in enumerate(label_path.read_text().splitlines()):
                    fields = line.split()
                    if len(fields) < 5:
                        continue
                    label = names.get(int(fields[0]), "")
                    mapped = _classify_name(label)
                    if mapped is None:
                        continue

                    cx, cy, bw, bh = (float(v) for v in fields[1:5])
                    x1 = int(max(0, (cx - bw / 2) * width))
                    x2 = int(min(width, (cx + bw / 2) * width))
                    top = (cy - bh / 2) + bh * config.HARNESS_CROP_TOP
                    bottom = (cy - bh / 2) + bh * config.HARNESS_CROP_BOTTOM
                    y1 = int(max(0, top * height))
                    y2 = int(min(height, bottom * height))
                    if x2 - x1 < 16 or y2 - y1 < 16:
                        continue

                    out_dir = work / split / mapped
                    out_dir.mkdir(parents=True, exist_ok=True)
                    stem = f"{source.name}-{label_path.stem}-{index}.jpg"
                    cv2.imwrite(str(out_dir / stem), image[y1:y2, x1:x2])
                    counts.setdefault(split, {}).setdefault(mapped, 0)
                    counts[split][mapped] += 1

    return counts


def _class_names(source: Path) -> dict[int, str]:
    for candidate in list(source.rglob("data.yaml")) + list(source.rglob("data.yml")):
        text = candidate.read_text()
        # yaml 의존성을 새로 넣지 않는다. names 줄만 필요하다.
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped.startswith("names:"):
                continue
            inline = stripped[len("names:") :].strip()
            if inline.startswith("["):
                items = [v.strip().strip("'").strip('"') for v in inline.strip("[]").split(",")]
                return {i: v for i, v in enumerate(items) if v}
        # 블록 형식 (names:\n  0: harness)
        collecting = False
        mapping: dict[int, str] = {}
        for line in text.splitlines():
            if line.strip().startswith("names:"):
                collecting = True
                continue
            if collecting:
                stripped = line.strip()
                if not stripped or not line.startswith((" ", "\t")):
                    break
                if stripped.startswith("-"):
                    mapping[len(mapping)] = stripped[1:].strip().strip("'").strip('"')
                elif ":" in stripped:
                    key, value = stripped.split(":", 1)
                    try:
                        mapping[int(key)] = value.strip().strip("'").strip('"')
                    except ValueError:
                        pass
        if mapping:
            return mapping
    return {}


def _match_image(image_dir: Path, stem: str) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):
        candidate = image_dir / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def train(work: Path, epochs: int, imgsz: int) -> Path:
    from ultralytics import YOLO

    model = YOLO("yolo11n-cls.pt")
    results = model.train(
        data=str(work),
        epochs=epochs,
        imgsz=imgsz,
        device="cpu",
        # 데이터가 백 장 단위다. 증강을 세게 걸어야 과적합을 늦출 수 있다.
        degrees=8.0,
        translate=0.12,
        scale=0.4,
        fliplr=0.5,
        erasing=0.3,
        patience=15,
        verbose=True,
    )
    best = Path(results.save_dir) / "weights" / "best.pt"
    if not best.exists():
        raise SystemExit(f"학습 결과 가중치를 찾지 못했습니다: {best}")
    OUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, OUT_MODEL)
    return OUT_MODEL


def evaluate(model_path: Path, eval_dir: Path) -> None:
    """우리 화각 이미지로 따로 잰다. 이 숫자가 발표에 쓸 숫자다."""
    from ultralytics import YOLO

    model = YOLO(str(model_path))
    total = 0
    correct = 0
    confusion: dict[tuple[str, str], int] = {}

    for truth_dir in sorted(p for p in eval_dir.iterdir() if p.is_dir()):
        truth = truth_dir.name.upper()
        for image_path in sorted(truth_dir.iterdir()):
            if image_path.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
            result = model.predict(str(image_path), imgsz=224, device="cpu", verbose=False)[0]
            predicted = _classify_name(result.names[int(result.probs.top1)]) or "UNKNOWN"
            total += 1
            correct += int(predicted == truth)
            confusion[(truth, predicted)] = confusion.get((truth, predicted), 0) + 1

    if total == 0:
        print("평가 이미지가 없습니다.")
        return
    print(f"\n우리 화각 정확도 {correct}/{total} = {correct / total:.1%}")
    for (truth, predicted), count in sorted(confusion.items()):
        mark = "✓" if truth == predicted else "✗"
        print(f"  {mark} 정답 {truth:<9} → 예측 {predicted:<9} {count}건")


def main() -> int:
    parser = argparse.ArgumentParser(description="안전대 착용 분류기 학습")
    parser.add_argument(
        "--download",
        action="append",
        default=[],
        metavar="WORKSPACE/PROJECT/VERSION",
        help="Roboflow Universe 데이터셋. 여러 번 줄 수 있다. ROBOFLOW_API_KEY 가 필요하다.",
    )
    parser.add_argument(
        "--data",
        action="append",
        default=[],
        type=Path,
        help="이미 받아 둔 YOLO 탐지 데이터셋 디렉터리. 여러 번 줄 수 있다.",
    )
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--imgsz", type=int, default=224)
    parser.add_argument(
        "--eval-dir",
        type=Path,
        help="우리 화각 평가 이미지. WORN/ NOT_WORN/ 하위 폴더로 나눠 둔다.",
    )
    parser.add_argument("--skip-train", action="store_true", help="crop 만 만들고 멈춘다")
    args = parser.parse_args()

    sources = list(args.data)
    if args.download:
        api_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
        if not api_key:
            print("ROBOFLOW_API_KEY 환경변수가 필요합니다.", file=sys.stderr)
            print("  https://app.roboflow.com/settings/api 에서 발급합니다.", file=sys.stderr)
            return 2
        for slug in args.download:
            sources.append(download(slug, api_key))

    if not sources:
        parser.error("--download 또는 --data 중 하나가 필요합니다.")

    print("\n상체 crop 생성")
    counts = build_crops(sources, WORK_ROOT)
    if not counts:
        print("하네스 클래스를 가진 라벨을 찾지 못했습니다.", file=sys.stderr)
        return 1
    for split, per_class in sorted(counts.items()):
        detail = " · ".join(f"{k} {v}장" for k, v in sorted(per_class.items()))
        print(f"  {split:<6} {detail}")

    # val 이 없으면 ultralytics 가 학습을 못 한다. 어느 쪽이 비었는지 먼저 알려 준다.
    if "train" not in counts:
        print("train 분할이 비었습니다.", file=sys.stderr)
        return 1
    if "val" not in counts:
        print("val 분할이 비었습니다. Roboflow 내보내기에 valid 가 포함됐는지 확인해 주세요.", file=sys.stderr)
        return 1

    if args.skip_train:
        print(f"\ncrop 만 만들었습니다: {WORK_ROOT}")
        return 0

    print("\n학습")
    model_path = train(WORK_ROOT, args.epochs, args.imgsz)
    print(f"\n저장 → {model_path}")
    print("AI 서비스를 다시 띄우면 /health 의 harness.loaded 가 true 로 바뀝니다.")

    if args.eval_dir:
        evaluate(model_path, args.eval_dir)
    else:
        print(
            "\n! 우리 화각 평가를 아직 안 했습니다. 공개 데이터의 검증 정확도를 현장 성능처럼\n"
            "  말하지 마세요. --eval-dir 로 CCTV 화각 이미지를 넣어 따로 재야 합니다."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
