"""임계값과 환경변수를 한 곳에 모은다.

숫자가 코드 여기저기 흩어지면 튜닝할 때 무엇을 만졌는지 알 수 없게 된다.
"""

import os
from pathlib import Path

_HERE = Path(__file__).resolve().parent

# ── 모델 ────────────────────────────────────────────────
_BUNDLED = _HERE / "models" / "yolo26n.pt"
PERSON_MODEL = os.getenv("PERSON_MODEL") or (str(_BUNDLED) if _BUNDLED.exists() else "yolo26n.pt")
IMGSZ = int(os.getenv("IMGSZ", "640"))
TARGET_FPS = float(os.getenv("TARGET_FPS", "6"))
TORCH_THREADS = int(os.getenv("TORCH_THREADS", "2"))
# CWD 에 의존하면 로컬(레포 루트)과 컨테이너(/app)에서 다른 곳을 본다
TRACKER_CFG = os.getenv("TRACKER_CFG", str(_HERE / "trackers" / "pinch_bytetrack.yaml"))

# 추적기에 넘기는 conf 는 낮게 준다. ByteTrack 2단계 매칭이 저점수 박스를 쓰기 때문이다.
# 최종 필터링은 우리가 후처리에서 한다.
TRACK_CONF = 0.15

# ── 입력 제한 ───────────────────────────────────────────
MAX_VIDEO_MB = float(os.getenv("MAX_VIDEO_MB", "80"))
MAX_DURATION_SEC = float(os.getenv("MAX_DURATION_SEC", "60"))
MAX_QUEUE = int(os.getenv("MAX_QUEUE", "2"))
JOB_TTL_SEC = float(os.getenv("JOB_TTL_SEC", "1800"))

# ── 구역 판정 ───────────────────────────────────────────
# bbox 하단 변에서 뽑는 표본 위치. 좌우 20% 는 헐거운 박스 보정을 위해 버린다.
BOTTOM_SAMPLES = (0.20, 0.35, 0.50, 0.65, 0.80)

# 비대칭 2-임계. 회색지대(EXIT~ENTER)는 현재 상태를 유지한다.
ENTER_SCORE = 0.60
EXIT_SCORE = 0.25

# N-of-M 연속 프레임 투표. 진입은 빠르게, 이탈은 느리게.
# 한두 프레임 미탐으로 잔류 타이머가 리셋되면 안 된다.
ENTER_FRAMES = 2   # 6fps 기준 0.33초
EXIT_FRAMES = 4    # 6fps 기준 0.67초

# 접지점을 못 믿는 조건 — 프레임 하단에 잘렸거나 하반신이 가려졌을 때
TRUNCATE_Y = 0.98
TRUNCATE_ASPECT = 1.1
FALLBACK_ANCHOR_Y = 0.85   # 그때는 bbox 높이의 85% 지점을 접지점으로 본다

# 추적 소실 유예. track_buffer(18프레임 = 6fps 에서 3초)와 맞춘다.
TRACK_LOST_GRACE_SEC = 3.0
# id 스티칭
STITCH_MAX_GAP_SEC = 1.0
STITCH_MAX_DIST = 0.15

# ── 이벤트 수명주기 ─────────────────────────────────────
MIN_EVENT_SEC = 1.0     # CRITICAL 은 예외 — 재가동 순간의 끼임은 디바운스 대상이 아니다
COOLDOWN_SEC = 1.5
MERGE_GAP_SEC = 2.0
DEFAULT_DWELL_WARN_SEC = 5.0
# 에스컬레이션마다 캡처를 남기면 '진입 → 잔류 → 재가동' 서사가 생기지만,
# WebP 클립 인코딩이 이벤트당 몇 초씩 붙는다. 정지 이미지는 넉넉히, 클립은 피크 하나만.
MAX_FRAME_CAPTURES = 3
MAX_CLIP_CAPTURES = 1

# ── 캡처 ────────────────────────────────────────────────
CLIP_BEFORE_SEC = 3.0
CLIP_AFTER_SEC = 2.0
CLIP_MAX_WIDTH = 480
CLIP_QUALITY = 60
CAPTURE_DIR = os.getenv("CAPTURE_DIR", "/tmp/captures")
HEAD_FRACTION = 0.28    # bbox 상단 28% 를 머리로 보고 블러한다

SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "")
