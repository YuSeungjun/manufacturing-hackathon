# 안전한 하루 — 제철소 TBM 안전이행 플랫폼

수기로 작성하고 끝나던 **작업 전 안전점검회의(TBM)** 를 기록으로 남기고,
현장 영상에서 **AI가 이행 여부를 탐지**한 뒤, **안전관리자가 최종 판단**하는 구조입니다.

> AI는 탐지를 지원하고, 권한을 가진 사람이 최종 판단한다.

## 흐름

```text
안전관리자: TBM 작성 (위험 요인 + 안전 대책, 보호구 항목은 AI 확인으로 지정)
    ↓
작업자: 오늘의 TBM 확인 → 안전수칙 확인 서명
    ↓
CCTV 캡처 이미지 업로드 → YOLOv8 PPE 모델 추론
    ↓
TBM 안전수칙과 매칭되는 위반 의심 항목만 "검토 대기" 등록
    ↓
안전관리자: 근거 이미지 + 탐지 박스 확인 → 위반 확정 / 오탐 / 판단 보류
    ↓
확정된 건만 안전이행 점수에 반영 → 작업자·작업조에 알림
```

## 구성

| 디렉터리 | 내용 |
|---|---|
| `web/` | Next.js 16 (App Router) + Prisma 7 + SQLite. 로그인·권한·TBM·검토 대시보드 |
| `ai/` | FastAPI + Ultralytics YOLOv8 PPE 탐지 서비스 (포트 8000) |
| `samples/` | 데모용 현장 이미지 |

### AI 모델

[`Hansung-Cho/yolov8-ppe-detection`](https://huggingface.co/Hansung-Cho/yolov8-ppe-detection) (MIT)
— 클래스 10개: `Hardhat`, `NO-Hardhat`, `Mask`, `NO-Mask`, `Safety Vest`, `NO-Safety Vest`,
`Person`, `Safety Cone`, `machinery`, `vehicle`.

`NO-*` 클래스만 위반 의심으로 다루고, 서비스 내부 코드(`NO_HARDHAT` 등)로 변환해
TBM 안전수칙의 `ppeCode`와 매칭합니다.

## 실행

터미널 두 개가 필요합니다.

```bash
# 1) AI 탐지 서비스 (최초 실행 시 모델을 자동 내려받습니다)
./ai/run.sh

# 2) 웹
cd web
npm run dev      # http://localhost:3000
```

처음 세팅할 때만:

```bash
# Python 환경
python3.13 -m venv ai/.venv
ai/.venv/bin/pip install -r ai/requirements.txt

# 웹 환경
cd web
npm install
npx prisma migrate dev
npx prisma db seed
```

### 데모 계정

| 역할 | 사번 | 비밀번호 |
|---|---|---|
| 안전관리자 | `M0001` | `test1234` |
| 작업자 | `W1001` ~ `W1004` | `test1234` |

안전관리자 인증번호: 광양제철소 `GY-SAFETY-2026`, 포항제철소 `PH-SAFETY-2026`

### 데모 시나리오

1. `M0001` 로그인 → **현장 영상 분석** → `samples/site-3.jpg` 업로드 (임계값 0.25)
   → 안전모·안전조끼·방진마스크 미착용 3건이 검토 대기로 등록됩니다.
2. **AI 탐지 검토** → 근거 이미지의 탐지 박스를 보고 `위반 확정` / `오탐` 선택
3. `W1001` 로그인 → 오늘의 TBM 서명, 확정된 위반 알림과 안전이행 점수 확인

## 권한 설계

가입할 때 역할을 선택하되, **안전관리자 권한은 가입만으로 주지 않습니다.**
사업장 인증번호가 맞으면 즉시 승인, 모르면 `PENDING` 상태로 두고 기존 안전관리자가 승인합니다.

| 기능 | 작업자 | 안전관리자 |
|---|:--:|:--:|
| 본인 작업조 TBM 확인 · 서명 | O | O |
| 본인 관련 안전 알림 확인 | O | O |
| TBM 생성 | X | O |
| 전체 작업구역 현황 조회 | X | O |
| AI 탐지 결과 확인 | 본인 조 결과만 | 전체 |
| 위반 확정 / 오탐 판단 | X | O |
| 안전관리자 가입 승인 | X | O |

화면에서 버튼을 숨기는 것과 별개로, 서버 액션마다 `assertManager()` 로 역할을 다시
검사합니다 (`web/src/lib/auth.ts`). 작업자가 `/manager` 로 직접 접근하면 `/forbidden` 으로
보냅니다.

## 데이터 모델

`User` · `Workplace` · `Team` · `Tbm` · `SafetyRule` · `TbmAcknowledgement` ·
`Detection` · `Review` — 자세한 정의는 `web/prisma/schema.prisma`.

핵심은 **`Detection`(AI가 만든 의심)과 `Review`(사람이 내린 판단)를 분리**한 점입니다.
안전이행 점수는 `Review.decision === "CONFIRMED"` 인 건만 감점합니다
(`web/src/lib/score.ts`).

## 개인정보

MVP는 얼굴 인식으로 개인을 특정하지 않습니다. 탐지는 **작업구역·작업조 단위**로만
연결되며, 안전모·마스크를 착용한 제철소 환경에서 개인 식별 정확도를 확보하기 어렵다는
점도 함께 고려했습니다.
