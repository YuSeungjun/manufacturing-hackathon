#!/usr/bin/env bash
# AI 서비스와 웹을 함께 띄운다. Ctrl-C 하면 둘 다 내려간다.
set -uo pipefail
cd "$(dirname "$0")"

if [ ! -x ai/.venv/bin/uvicorn ]; then
  echo "ai/.venv 가 없습니다. 먼저 만들어 주세요:"
  echo "  python3 -m venv ai/.venv && ai/.venv/bin/pip install -r ai/requirements.txt"
  exit 1
fi

# AI 서비스용 환경변수(Roboflow 키 등). 없으면 그냥 지나간다.
if [ -f ai/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ai/.env
  set +a
fi

# ai/ 를 패키지로 import 하므로 레포 루트에서 띄운다.
# 추적기 상태와 잡 레지스트리가 프로세스 메모리에 있어 워커는 하나여야 한다.
OMP_NUM_THREADS=${OMP_NUM_THREADS:-2} \
MKL_NUM_THREADS=${MKL_NUM_THREADS:-2} \
ai/.venv/bin/uvicorn ai.server:app --host 127.0.0.1 --port "${AI_PORT:-8000}" --workers 1 &
AI_PID=$!

trap 'kill $AI_PID 2>/dev/null' EXIT INT TERM

cd web && npm run dev
