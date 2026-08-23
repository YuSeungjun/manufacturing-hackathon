---
title: 끼임 예방 · 위험구역 감시
emoji: ⚠️
colorFrom: gray
colorTo: red
sdk: docker
app_port: 8000
pinned: false
---

# 위험구역 감시 서비스

압연설비 CCTV 영상에서 작업자를 찾아 위험구역 잔류를 재고, 설비 상태와 결합해 끼임 위험
순간을 잘라 낸다. **판단은 하지 않는다** — 근거를 만들어 안전관리자에게 넘긴다.

## 하지 않는 것

- 얼굴 인식 · 개인 식별 (COCO `person` 클래스 하나만 본다)
- 보호구 착용 판정
- 작업자 감시 · 근태 추적

`track id` 는 한 영상 안에서만 쓰이는 익명 번호이고 분석이 끝나면 사라진다.
저장되는 캡처는 bbox 상단 28%(머리)를 가우시안 블러 처리한다. 이 선언은 `GET /health` 의
`identifiesIndividuals: false`, `faceBlur: true` 로 응답에 박혀 있다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/health` | 모델·설정·프라이버시 선언 |
| `POST` | `/analyze/video` | 영상 분석 잡 생성 → `202 {jobId}` |
| `GET` | `/analyze/jobs/{jobId}` | 진행률 / 결과 |
| `DELETE` | `/analyze/jobs/{jobId}` | 잡·캡처 삭제 |
| `GET` | `/captures/{jobId}/{captureId}` | 캡처 이미지·클립 |
| `POST` | `/analyze/frame` | 단일 프레임 즉석 점유 판정 |

동기 처리를 쓰지 않는 이유: HF Space 게이트웨이(~60초)와 업로드 시간을 한꺼번에 우회하기
위해서다. 부수효과로 진행률 바가 생긴다.

```bash
curl -X POST http://127.0.0.1:8000/analyze/video \
  -F "file=@clip.mp4" \
  -F 'body={"zones":[{"id":"Z1","name":"롤 갭 하부",
        "polygon":[[0.31,0.52],[0.68,0.50],[0.72,0.93],[0.27,0.95]],"dwellWarnSec":5}],
      "machineStates":[{"tSec":0,"state":"STOPPED"},{"tSec":12,"state":"RESTART_REQUESTED"}]}'
```

`videoUrl` 을 담은 JSON 본문이 1순위 경로다. Vercel Function 요청 본문이 4.5MB 로 막혀 있어
영상은 브라우저에서 Blob 으로 직접 올라가고 여기에는 URL 만 온다. multipart 는 curl·로컬
개발용 보조 경로다.

## 설비 상태 타임라인

`machineStates` 는 **요청 파라미터**다. 실제 현장에서는 PLC / MES / LOTO 시건 시스템이 준다.

끼임은 "사람이 들어간 사건"이 아니라 **사람이 안에 있는 채로 설비가 깨어난 사건**이다.
그래서 이 값이 없으면 CRITICAL 판정이 성립하지 않는다. 타임라인을 안 주면 `STOPPED` 로
가정해 진입·잔류 이벤트만 내고 CRITICAL 은 내지 않는다 — 안전한 기본값이다.

## 판정 규칙

| 설비 상태 ＼ 구역 | 비어있음 | 진입 | 잔류 ≥ dwellWarnSec |
|---|---|---|---|
| `LOTO` | SAFE | INFO | INFO |
| `STOPPED` | SAFE | CAUTION | WARNING |
| `RESTART_REQUESTED` | SAFE | **CRITICAL** | **CRITICAL** |
| `RUNNING` | SAFE | **CRITICAL** | **CRITICAL** |

CRITICAL 은 디바운스하지 않고 즉시 확정한다. 1초를 기다리면 이미 늦다.

## 구조

```
config.py     임계값·환경변수
schemas.py    요청/응답 계약 (좌표는 전부 0~1 정규화)
geometry.py   광선투사 point-in-polygon, 발끝 5점 점유 점수
zones.py      잔류 히스테리시스, id 스티칭, 설비 타임라인
risk.py       결합 매트릭스, 이벤트 OPEN/CONFIRM/ESCALATE/MERGE/CLOSE
detector.py   YOLO 로드·추적 래퍼
capture.py    링버퍼, JPEG/WebP 인코딩, 얼굴 블러
pipeline.py   프레임 루프 + 잡 레지스트리
server.py     라우트
```

`geometry` · `zones` · `risk` 는 순수 함수라 모델 없이 테스트한다:

```bash
.venv/bin/python -m pytest tests -q     # 레포 루트에서
```

## 로컬 실행

```bash
python3 -m venv ai/.venv
ai/.venv/bin/pip install -r ai/requirements.txt
./ai/run.sh            # 또는 레포 루트의 ./start-dev.sh
```

## 성능

Apple M 시리즈 2스레드 실측 (`ai/bench.py`):

| 모델 | 384 | 512 | 640 |
|---|---|---|---|
| yolo26n | 21.5ms | 36.0ms | 46.6ms |
| yolo11n | 21.1ms | 36.7ms | 45.4ms |

20초 영상을 6fps 로 샘플링하면 120프레임 → 640px 기준 약 5.6초. HF Space 무료 티어(2 vCPU)는
이보다 느리므로 여유를 두고 잡+폴링으로 처리한다.

`OMP_NUM_THREADS` 를 안 잡으면 2 vCPU 컨테이너에서 호스트 코어 수만큼 스레드를 띄워
오히려 2~3배 느려진다. Dockerfile 에 고정해 두었다.

## 라이선스 주의

`ultralytics` 와 `yolo26n.pt` COCO 가중치는 **AGPL-3.0** 이다.
MIT 로 배포하려면 검출기를 교체해야 한다.
