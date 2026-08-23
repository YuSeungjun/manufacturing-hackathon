#!/usr/bin/env bash
# AI-Hub 데이터 수집.
#
#   ./scripts/aihub_fetch.sh labels-510    # 물류창고 설비·운반 라벨 (10MB) ← 먼저 이것부터
#   ./scripts/aihub_fetch.sh video-510     # 물류창고 설비 및 장비 원천 (4GB)
#   ./scripts/aihub_fetch.sh labels-71679  # 스마트 제조 라벨 전량 (676MB, jam 클래스 포함)
#   ./scripts/aihub_fetch.sh 510 62662     # 데이터셋·fileSn 직접 지정
#
# 선행 조건: aihub.or.kr 로그인 후 해당 데이터셋의 "다운로드 신청" 승인.
#   승인은 데이터셋별이다. 승인 전에는 API 가 안내문만 돌려준다.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${AIHUB_APIKEY:?AIHUB_APIKEY 환경변수를 설정해 주세요}"

case "${1:-labels-510}" in
  labels-510)
    # VL_04 설비 및 장비(5MB) + VL_05 운반(6MB).
    # 원천 4GB 를 받기 전에 이걸로 프레임이 연속인지부터 확인한다.
    DATASET=510; FILES=62662,62663; NAME="물류창고 라벨 (설비·운반)" ;;
  video-510)
    DATASET=510; FILES=62673; NAME="물류창고 원천 · 설비 및 장비 (4GB)" ;;
  video-510-all)
    DATASET=510; FILES=62673,62674; NAME="물류창고 원천 · 설비및장비 + 운반 (8GB)" ;;
  labels-71679)
    DATASET=71679; FILES=522641,522644; NAME="스마트 제조 라벨 TL+VL (676MB)" ;;
  *)
    DATASET="$1"; FILES="${2:?fileSn 을 지정해 주세요}"; NAME="데이터셋 $1" ;;
esac

OUT="data/aihub/$DATASET"
mkdir -p "$OUT"

echo "$NAME · 데이터셋 $DATASET · fileSn $FILES"
curl -L -C - --fail-with-body \
  -H "apikey:$AIHUB_APIKEY" \
  -o "$OUT/download.tar" \
  "https://api.aihub.or.kr/down/0.6/${DATASET}.do?fileSn=${FILES}"

SIZE=$(wc -c < "$OUT/download.tar")
if [ "$SIZE" -lt 4096 ]; then
  echo
  echo "내려받기에 실패했습니다:"
  cat "$OUT/download.tar"
  echo
  echo "→ https://www.aihub.or.kr/aihubdata/data/view.do?dataSetSn=$DATASET 에서"
  echo "  'AI 데이터 다운로드' 신청이 승인되었는지 확인해 주세요."
  rm -f "$OUT/download.tar"
  exit 1
fi

tar -xf "$OUT/download.tar" -C "$OUT"
rm -f "$OUT/download.tar"
echo "완료 → $OUT"
find "$OUT" -maxdepth 4 -name '*.zip' -print
