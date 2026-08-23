#!/usr/bin/env bash
# AI 탐지 서비스와 웹 서버를 함께 띄운다.
set -e
cd "$(dirname "$0")"

./ai/run.sh &
AI_PID=$!
trap 'kill $AI_PID 2>/dev/null || true' EXIT

cd web
npm run dev
