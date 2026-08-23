#!/usr/bin/env bash
# 로컬 개발용. 레포 루트에서 부른다 — ai/ 를 패키지로 import 하기 때문이다.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ai/.venv/bin/uvicorn ai.server:app --host 127.0.0.1 --port "${PORT:-8000}" --reload
