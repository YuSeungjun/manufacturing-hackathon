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

# ── 안전대(하네스) 분류기 ────────────────────────────────
# 없어도 서비스는 돈다. 없으면 하네스 칸이 null 로 나가고 화면에서 사라진다.
_HARNESS = _HERE / "models" / "harness.pt"
HARNESS_MODEL = os.getenv("HARNESS_MODEL") or (str(_HARNESS) if _HARNESS.exists() else "")
HARNESS_CONF = float(os.getenv("HARNESS_CONF", "0.35"))

# Roboflow 호스팅 추론. 키와 모델이 둘 다 있으면 로컬 가중치보다 이쪽을 먼저 쓴다.
# 우리 모델이 아니라 남의 학습 결과를 HTTP 로 부르는 것이라, 화면과 /health 에
# 공급자를 밝힌다 — "우리가 학습했다" 로 읽히면 안 된다.
ROBOFLOW_API_KEY = os.getenv("ROBOFLOW_API_KEY", "")
ROBOFLOW_HARNESS_MODEL = os.getenv("ROBOFLOW_HARNESS_MODEL", "")
ROBOFLOW_URL = os.getenv("ROBOFLOW_URL", "https://detect.roboflow.com")
ROBOFLOW_TIMEOUT_SEC = float(os.getenv("ROBOFLOW_TIMEOUT_SEC", "20"))

# 공급자 고정. auto 면 roboflow → clip → local 순으로 있는 것을 쓴다.
HARNESS_PROVIDER = os.getenv("HARNESS_PROVIDER", "auto").strip().lower()

# CLIP 제로샷. 학습도 라벨도 없이 상체 crop 을 두 문장과 비교한다.
# 사람 위치는 우리 탐지기가 이미 잡아 주므로 남는 문제는 분류 하나뿐이고,
# 분류는 탐지보다 훨씬 쉽다 — YOLO-World 로 "safety harness" 를 물체로 찾으려 하면
# 0.02 밖에 안 나오지만(실측), 문장 두 개를 비교하는 건 된다.
HARNESS_CLIP_MODEL = os.getenv("HARNESS_CLIP_MODEL", "ViT-B/32")
# 프롬프트를 코드에 박지 않고 환경변수로 뺀다 — 이게 이 방식의 유일한 튜닝 손잡이다.
HARNESS_CLIP_WORN = os.getenv(
    "HARNESS_CLIP_WORN",
    "a worker with black safety harness straps across the back and shoulders",
)
# 부정 프롬프트는 **없음을 말하면 안 된다.** 실측에서 갈렸다 —
#   "no straps on the back"      → 미착용자를 UNKNOWN(0.46) 으로 흘림
#   "nothing attached to it"     → 미착용자를 WORN(0.79) 으로 **틀림**
#   "only a plain work jacket"   → 미착용자 0.16, 착용자 1.00 으로 갈림
# CLIP 은 부재를 못 본다. 보이는 것을 묘사해야 한다.
HARNESS_CLIP_NOT_WORN = os.getenv(
    "HARNESS_CLIP_NOT_WORN",
    "a worker wearing only a plain work jacket",
)
# 두 문장 확률 차이가 이보다 작으면 UNKNOWN 을 낸다. 애매한 걸 억지로 가르지 않는다.
HARNESS_CLIP_MARGIN = float(os.getenv("HARNESS_CLIP_MARGIN", "0.20"))

# ── 훅 체결 판정 ────────────────────────────────────────
# 착용 판정과 **별도 호출**로 둔다. 3분류로 합치면 착용 판정까지 훅 프롬프트에 끌려간다.
# 착용은 통제된 A/B 쌍(같은 장면·같은 자세, 안전대만 다름)으로 확인한 부분이라 지키고,
# 체결은 그 위에 얹는다. 착용이 확인된 사람에게만 묻는다 — 하네스가 없으면 훅도 없다.
HARNESS_CLIP_HOOK_ATTACHED = os.getenv(
    "HARNESS_CLIP_HOOK_ATTACHED",
    "a carabiner hook clipped onto a metal railing",
)
HARNESS_CLIP_HOOK_LOOSE = os.getenv(
    "HARNESS_CLIP_HOOK_LOOSE",
    "a carabiner hook hanging loose down the worker's back",
)
HARNESS_CLIP_HOOK_MARGIN = float(os.getenv("HARNESS_CLIP_HOOK_MARGIN", "0.20"))
# 상체 crop 이 이보다 작으면 판정하지 않고 UNKNOWN 을 낸다.
# 웨빙 폭 45mm 가 8px 아래로 떨어지면 스트랩과 작업복 봉제선을 가를 수 없다.
MIN_HARNESS_CROP_PX = int(os.getenv("MIN_HARNESS_CROP_PX", "48"))
# 사람 bbox 에서 잘라 쓰는 상체 비율. 하네스는 어깨~허리에 걸쳐 있다.
HARNESS_CROP_TOP = 0.0
HARNESS_CROP_BOTTOM = 0.70
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
# 정지 이미지 시퀀스 한도. 한 장당 CPU 추론이 0.3~1초라 서른 장이면 최대 30초다.
MAX_FRAMES = int(os.getenv("MAX_FRAMES", "30"))
# 연속 점유로 이어 붙일 수 있는 최대 프레임 간격.
#
# 두 장 사이가 이보다 벌어지면 "그 사이 계속 안에 있었다" 를 주장할 근거가 없다 —
# 나갔다 돌아왔을 수 있고, 우리는 그 사이를 보지 않았다. 관측되지 않은 공백은
# 존재의 증거가 아니다. 그래서 잔류를 끊고 사건도 닫는다.
#
# 전형 간격의 배수와 절대 상한 중 작은 값을 쓴다. 10분 간격 스틸로 "잔류 30분" 을
# 만들지 않기 위해서다.
MAX_LINK_GAP_SEC = float(os.getenv("MAX_LINK_GAP_SEC", "180"))
MAX_LINK_GAP_FACTOR = float(os.getenv("MAX_LINK_GAP_FACTOR", "3.0"))
MAX_IMAGE_MB = float(os.getenv("MAX_IMAGE_MB", "12"))
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
