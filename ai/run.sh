#!/usr/bin/env bash
# AI 탐지 서비스 실행 (기본 포트 8000)
set -e
cd "$(dirname "$0")"
exec .venv/bin/uvicorn server:app --host 127.0.0.1 --port "${PORT:-8000}"
