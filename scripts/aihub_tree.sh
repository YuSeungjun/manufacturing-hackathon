#!/usr/bin/env bash
# 데이터셋 파일 트리와 fileSn 조회. 승인 없이도 동작한다.
#   ./scripts/aihub_tree.sh          # 71679
#   ./scripts/aihub_tree.sh 510      # 물류창고 내 작업 안전 데이터
#   ./scripts/aihub_tree.sh list     # 전체 데이터셋 목록
set -euo pipefail
: "${AIHUB_APIKEY:?AIHUB_APIKEY 환경변수를 설정해 주세요}"

if [ "${1:-71679}" = "list" ]; then
  curl -s -H "apikey:$AIHUB_APIKEY" "https://api.aihub.or.kr/info/dataset.do"
else
  curl -s -H "apikey:$AIHUB_APIKEY" "https://api.aihub.or.kr/info/${1:-71679}.do"
fi
