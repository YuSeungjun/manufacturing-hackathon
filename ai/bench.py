"""CPU 추론 지연 실측.

계획서의 지연 표는 추정치다. imgsz / targetFps 기본값이 이 숫자에 걸려 있으므로
착수 직후 한 번 돌려서 실제 값으로 바꾼다.

    ai/.venv/bin/python ai/bench.py
"""

import statistics
import time

import numpy as np

WARMUP = 3
RUNS = 12
SIZES = (384, 512, 640)
MODELS = ("yolo26n.pt", "yolo11n.pt")


def bench(model_name: str, imgsz: int) -> tuple[float, float] | None:
    from ultralytics import YOLO

    try:
        model = YOLO(model_name)
    except Exception as exc:  # 가중치를 못 받는 환경도 있다
        print(f"  {model_name}: 로드 실패 — {exc}")
        return None

    frame = np.random.randint(0, 255, (imgsz, imgsz, 3), dtype=np.uint8)
    for _ in range(WARMUP):
        model.predict(frame, imgsz=imgsz, classes=[0], device="cpu", verbose=False)

    laps: list[float] = []
    for _ in range(RUNS):
        t0 = time.perf_counter()
        model.predict(frame, imgsz=imgsz, classes=[0], device="cpu", verbose=False)
        laps.append((time.perf_counter() - t0) * 1000)
    return statistics.median(laps), min(laps)


def main() -> None:
    import torch

    torch.set_num_threads(2)  # HF Space 무료 티어(2 vCPU)와 같은 조건으로 잰다
    print(f"torch {torch.__version__} · threads {torch.get_num_threads()}")
    print(f"{'모델':<14}{'imgsz':>7}{'중앙값(ms)':>13}{'최소(ms)':>11}{'20초@6fps':>12}")
    print("-" * 58)

    for name in MODELS:
        for imgsz in SIZES:
            got = bench(name, imgsz)
            if got is None:
                break
            median, fastest = got
            total = median * 120 / 1000  # 20초 영상을 6fps 로 샘플링하면 120 프레임
            print(f"{name:<14}{imgsz:>7}{median:>13.1f}{fastest:>11.1f}{total:>11.1f}s")


if __name__ == "__main__":
    main()
