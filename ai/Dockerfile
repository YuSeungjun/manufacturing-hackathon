FROM python:3.13-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# torch 는 CPU 휠로 따로 받는다. 기본 인덱스는 CUDA 런타임까지 끌고 와 이미지가 3GB 를 넘는다.
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# 서비스 코드는 패키지로 넣는다 (모듈 간 상대 import 를 쓴다)
COPY *.py /app/ai/
COPY trackers/ /app/ai/trackers/

# ★ 2 vCPU 환경에서 스레드 과할당을 막는다.
#   호스트 코어 수대로 8~16 스레드를 띄우면 오히려 2~3배 느려진다.
ENV OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 TORCH_THREADS=2

# ★ HF Space 의 HOME 은 쓰기 가능하다고 믿을 수 없다. 경로를 고정하고
#   기동할 때마다 나가는 버전 체크 왕복을 끈다.
ENV YOLO_CONFIG_DIR=/app/.ultralytics MPLCONFIGDIR=/app/.mpl YOLO_OFFLINE=1
RUN mkdir -p /app/.ultralytics /app/.mpl /app/ai/models /tmp/captures

# 콜드 스타트에 가중치를 받으면 첫 요청이 30초 넘게 걸린다. 빌드 때 미리 받아 둔다.
ENV PERSON_MODEL=/app/ai/models/yolo26n.pt
RUN python -c "from ultralytics import YOLO; YOLO('yolo26n.pt')" \
 && mv yolo26n.pt /app/ai/models/yolo26n.pt

# CLIP(ViT-B/32) 가중치도 미리 받는다. 첫 안전대 판정에서 받으면 수십 초가 더 붙는다.
ENV CLIP_CACHE=/app/.clip
RUN mkdir -p /app/.clip \
 && python -c "import clip; clip.load('ViT-B/32', device='cpu', download_root='/app/.clip')" || true

ENV IMGSZ=640 TARGET_FPS=6 MAX_VIDEO_MB=80 MAX_DURATION_SEC=60 \
    CAPTURE_DIR=/tmp/captures PORT=8000
EXPOSE 8000

# ★ --workers 1 필수: 추적기 상태와 잡 레지스트리가 프로세스 메모리에 있다.
#   워커가 둘이면 서로의 track id 를 오염시키고 폴링이 엉뚱한 워커에 닿는다.
CMD ["sh", "-c", "uvicorn ai.server:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --timeout-keep-alive 75"]
