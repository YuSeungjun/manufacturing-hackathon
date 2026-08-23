---
title: 안전한 하루 · PPE 탐지
emoji: 🦺
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 8000
pinned: false
---

# PPE 탐지 서비스

제철소 TBM 안전이행 플랫폼(`안전한 하루`)의 탐지 엔진입니다.
YOLOv8 PPE 모델로 안전모·마스크·안전조끼 착용 여부를 탐지합니다.
**판단은 하지 않습니다.** 의심 근거만 만들어 안전관리자에게 넘깁니다.

## 엔드포인트

| | |
|---|---|
| `GET /health` | 모델 상태와 클래스 목록 |
| `POST /detect` | `file`(이미지), `conf`(임계값) → 탐지 박스 |

## 설정

| 환경변수 | 설명 |
|---|---|
| `AI_SERVICE_TOKEN` | 설정하면 `Authorization: Bearer` 를 검사합니다. 공개 주소이므로 설정을 권합니다 |
| `PPE_MODEL_REPO` | 기본 `Hansung-Cho/yolov8-ppe-detection` |

모델: [Hansung-Cho/yolov8-ppe-detection](https://huggingface.co/Hansung-Cho/yolov8-ppe-detection) (MIT)
