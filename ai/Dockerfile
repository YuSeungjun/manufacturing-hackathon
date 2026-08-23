# PPE 탐지 서비스 컨테이너 (Railway / Render / Fly 공통)
FROM python:3.13-slim

# ultralytics 가 쓰는 OpenCV 런타임 의존성
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch 는 CPU 휠로 받는다. CUDA 판을 받으면 이미지가 3GB 를 넘는다.
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision \
      --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY server.py .

# 모델을 이미지에 미리 넣어 둔다. 첫 요청 때 받으면 콜드 스타트가 수십 초로 늘어난다.
ENV PPE_MODEL_REPO=Hansung-Cho/yolov8-ppe-detection \
    PPE_MODEL_FILE=best.pt \
    HF_HOME=/app/.hf
RUN python -c "import os; from huggingface_hub import hf_hub_download; \
hf_hub_download(os.environ['PPE_MODEL_REPO'], os.environ['PPE_MODEL_FILE'])"

ENV PORT=8000
EXPOSE 8000
# 컨테이너 밖에서 접근해야 하므로 0.0.0.0 에 바인딩한다. (로컬 run.sh 는 127.0.0.1 유지)
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
