# 안전한 재가동

> AI가 압연설비 위험구역에 남아 있는 작업자를 감지하고, 위험한 설비 재가동을 **차단**한 뒤
> 그 장면을 자동 기록하는 제철소 끼임 사고 예방 시스템.

## 왜

제철소 압연설비를 정비·청소할 때 작업자가 설비 내부에 들어간다. 이때 다른 작업자가 내부
작업자를 확인하지 못하고 설비를 재가동하면 치명적인 끼임 사고가 된다.

2024년 제조업 사고재해자의 **28.07%**, 사고사망자의 **29.41%** 가 끼임이었고, 제조업 끼임
사망사고의 약 **54%** 가 정비·청소 같은 비정형 작업 중 발생했다.
([안전보건공단 산업재해 자료](https://www.kosha.or.kr/ebook/fcatalog/access/ecatalogt.jsp?Dir=636&callmode=normal&catimage=&eclang=ko&start=52&um=s),
[끼임 사망사고 분석](https://www.kosha.or.kr/ebook/fcatalog/access/ecatalogt.jsp?Dir=493&callmode=normal&catimage=&eclang=ko&start=38&um=s))

## 무엇이 다른가

포스코를 포함해 위험구역 진입을 감지하고 알람을 보내는 AI CCTV 는 이미 현장에 있다.
"진입 감지 후 알림"만으로는 차별성이 없다.

**이 시스템은 알림에서 멈추지 않는다.**

```
작업자가 위험구역 내부에 잔류  ─┐
                              ├─→  끼임 위험  →  재가동 차단  →  관리자 현장 확인  →  해제 승인
설비 가동 또는 재가동 명령    ─┘
```

- 차단은 기계가, **해제는 사람만** 한다
- 위험 사건을 오탐으로 판정해도 인터록은 자동으로 풀리지 않는다 — 판정은 기록, 해제는 조치
- 개인 시건(LOTO)이 하나라도 남아 있으면 **안전관리자도 해제할 수 없다**
- AI 서비스가 죽어도 인터록 판정은 DB 만 보고 동작한다 (fail-safe)

기존 LOTO 와 방호장치를 대체하지 않는다. 안전절차 누락과 작업자 간 의사소통 오류를 보완하는
**AI 이중 안전장치**다.

## 흐름

| 단계 | 화면 | 하는 일 |
|---|---|---|
| 1 | `/manager/equipment/[id]/zones` | 카메라 화면 위에 위험구역 폴리곤을 그린다 |
| 2 | `/manager/analyze` | CCTV 영상 업로드 → AI 분석 → 타임라인 재생 |
| 3 | `/manager/events` | 위험 사건을 사람이 확정 / 오탐 / 보류로 판단 |
| 4 | `/manager/restarts` | 차단된 재가동 요청을 현장 확인 후 해제 승인 |
| — | `/operator` | **운전 담당자가 재가동을 요청하고, 차단당하는 자리** |
| — | `/worker` | 정비 작업자가 개인 시건을 걸고 푼다 |
| — | `/manager/metrics` | 도입 효과 6개 지표 |

## AI가 하는 일 · 하지 않는 일

**한다** — 작업자 탐지, 위치 추적, 위험구역 진입·잔류 판단, 설비 상태 결합, 위험 순간 자동
캡처, 반복 위험 시간대·구역 통계.

**하지 않는다** — 얼굴 인식, 개인 식별, 보호구 착용 판정, 작업자 감시.

COCO `person` 클래스 하나만 본다. `track id` 는 한 영상 안에서만 쓰이는 익명 번호이고 분석이
끝나면 사라진다. 저장되는 캡처는 머리 부분을 흐리게 처리한다. 이 선언은 문서가 아니라
`GET /health` 의 `identifiesIndividuals: false`, `faceBlur: true` 로 응답에 박혀 있다.

## 증명 지표

사고 건수로 효과를 주장하지 않는다. 실제로 잰 시간과 횟수로만 말한다.

| 지표 | 계산 |
|---|---|
| 위험 감지 소요시간 | 구역 진입 → AI 위험 판정 |
| 관리자 조치 소요시간 | 통보 → 인지 / 판단 / 해제 승인 |
| 위험구역 노출시간 | 구역별 · 24시간대 히트맵 |
| 차단한 위험 재가동 | 차단 요청 수, 그중 사람이 확정한 수 |
| CCTV 확인 업무시간 | 전체 영상 길이 대비 실제로 본 구간 |
| 오탐 / 미탐율 | 미판단(보류·대기)은 분모에서 제외 |

## 실행

```bash
# 1) AI 서비스
python3 -m venv ai/.venv
ai/.venv/bin/pip install -r ai/requirements.txt

# 2) 웹
cd web && npm install
cp .env.example .env          # DATABASE_URL, JWT_SECRET 채우기
npx prisma migrate deploy && npx prisma db seed
cd ..

# 3) 함께 띄우기
./start-dev.sh                # AI :8000 + 웹 :3000
```

### 데모 계정 (비밀번호 전부 `test1234`)

| 사번 | 이름 | 역할 |
|---|---|---|
| `M0001` | 김안전 | 안전관리자 |
| `O2001` | 한운전 | 설비 운전 담당자 |
| `W1001` `W1002` `W1003` | 박정비 · 이현장 · 최압연 | 정비 작업자 |

안전관리자 가입 인증번호 — 광양 `GY-SAFETY-2026`, 포항 `PH-SAFETY-2026`

### 데모 시나리오

1. `M0001` → 위험구역을 그린다 → 영상을 올린다 → 타임라인에서 잔류 구간을 확인한다
2. `O2001` → `/operator` 에서 **재가동 요청** → **차단** + 근거 캡처
3. `W1001` → `/worker` 에서 개인 시건 해제
4. `M0001` → 사건 확정 → 재가동 승인
5. `O2001` → 재요청 → **허용** → 재가동

## 데모 영상 촬영

핵심: **설비가 실제로 재가동하는 영상은 필요 없다.** 설비 상태 타임라인이 요청 파라미터라
"사람이 구역 안에 머무는 영상"만 있으면 되고, 재가동 순간은 JSON 으로 주입한다. 실운영에서는
PLC / LOTO 가 그 값을 준다 — 눈속임이 아니라 정확히 그 시스템의 실제 구조다.

삼각대 위 휴대폰(내려다보는 각도, 고정), 바닥에 마스킹테이프 사각형, 사람 2명. 각 15~25초:

| 테이크 | 내용 | 기대 결과 |
|---|---|---|
| A | 구역에 들어가 12초 작업 → 동료가 스위치 ON | WARNING → **CRITICAL** 로 에스컬레이션 |
| B | 같은 작업, 설비는 계속 정지 | WARNING 까지만. **CRITICAL 없음** |
| C | 경계를 스치며 지나감 | **아무 이벤트도 안 남** |

테이크 C 가 심사에서 가장 강하다. 대부분 "탐지됩니다"만 보여주고, "탐지 안 됩니다"를
의도적으로 보여주는 팀은 드물다.

`samples/` 에 클립을 넣고 `samples/zones/take-a.json`(예시는 `*.example.json`)에 구역·설비
타임라인·정답 구간을 적으면 채점된다:

```bash
ai/.venv/bin/python -m ai.eval.score_demo
```

## 데이터

AI-Hub [「스마트 제조 시설 안전 감시를 위한 데이터」](https://www.aihub.or.kr/aihubdata/data/view.do?dataSetSn=71679)
(끼임 CCTV 영상 2,000개 · 추출 이미지 40,000장). 원천데이터가 100GB 분할압축이라 부분
다운로드가 불가능해 **원천 영상은 쓰지 않는다.** 라벨은 로직층 평가에 쓴다.
자세한 사정과 받는 방법은 [`data/README.md`](data/README.md).

## 기술 구성

| 층 | 구성 |
|---|---|
| 웹 | Next.js 16 App Router · React 19 · Tailwind v4 · Server Actions |
| DB | Neon Postgres · Prisma 7 (driver adapter) |
| 인증 | jose HS256 JWT · httpOnly 쿠키 12시간 |
| 저장 | Vercel Blob (없으면 `public/evidence` 로컬) |
| AI | FastAPI · Ultralytics YOLO26n (COCO person) · ByteTrack · CPU |
| 배포 | Vercel (웹) · Hugging Face Docker Space (AI) |

`ai/` 의 설계 근거와 함정은 [`ai/README.md`](ai/README.md), 주제 정리는
[`docs/주제정리.md`](docs/주제정리.md).

### 알아 둘 것

- **CCTV 영상은 브라우저 → Vercel Blob 으로 직접 올라간다.** Vercel Function 요청 본문이
  4.5MB 하드 리밋이라 서버 액션으로 중계할 수 없다.
- **영상 분석은 잡+폴링이다.** HF Space 게이트웨이(~60초)와 업로드 시간을 우회하고, 덤으로
  진행률 바가 생긴다.
- **AI 캡처는 휘발성이다.** HF Space 는 재시작하면 디스크가 날아간다. 안전관리자가 위험으로
  확정한 건만 Blob 으로 옮겨 영구 보관한다 — AI 의 의심은 휘발, 사람의 판단은 영구.
- 데모는 업로드 영상 기반이다. 상용 배포에서는 RTSP 게이트웨이를 붙인다.
- `ultralytics` 와 COCO 가중치는 **AGPL-3.0**.
