import { stoppageIntervals, overlapsInterval, recordingBase, atSec } from "@/lib/episodes";

let pass = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
}

console.log("정지 구간 자르기");
check("정지로 시작해 재가동으로 끝난다",
  stoppageIntervals([{tSec:0,state:"STOPPED"},{tSec:30,state:"RUNNING"}], 40),
  [{startSec:0, restartSec:30}]);

check("재가동 요청은 아직 정지다 — 구간이 안 끊긴다",
  stoppageIntervals([{tSec:0,state:"STOPPED"},{tSec:20,state:"RESTART_REQUESTED"},{tSec:25,state:"RUNNING"}], 40),
  [{startSec:0, restartSec:25}]);

check("LOTO 도 정지다",
  stoppageIntervals([{tSec:0,state:"LOTO"},{tSec:18,state:"RUNNING"}], 30),
  [{startSec:0, restartSec:18}]);

check("영상 끝까지 안 돌면 열린 채로 남는다",
  stoppageIntervals([{tSec:5,state:"STOPPED"}], 40),
  [{startSec:5, restartSec:null}]);

check("가동으로만 이루어진 영상은 에피소드가 없다",
  stoppageIntervals([{tSec:0,state:"RUNNING"}], 40),
  []);

check("정지-재가동-정지-재가동 두 건",
  stoppageIntervals([
    {tSec:0,state:"STOPPED"},{tSec:10,state:"RUNNING"},
    {tSec:20,state:"STOPPED"},{tSec:35,state:"RUNNING"}], 40),
  [{startSec:0,restartSec:10},{startSec:20,restartSec:35}]);

check("순서가 뒤섞여 와도 정렬해서 본다",
  stoppageIntervals([{tSec:30,state:"RUNNING"},{tSec:0,state:"STOPPED"}], 40),
  [{startSec:0, restartSec:30}]);

console.log("\n사건이 이 구간 안의 일인가");
const closed = {startSec:10, restartSec:30};
check("구간 안쪽",     overlapsInterval(closed, 15, 20, 60), true);
check("구간 앞",       overlapsInterval(closed, 2, 8, 60), false);
check("구간 뒤",       overlapsInterval(closed, 35, 40, 60), false);
check("경계에 걸침",   overlapsInterval(closed, 28, 34, 60), true);
check("열린 구간은 영상 끝까지", overlapsInterval({startSec:10,restartSec:null}, 50, 58, 60), true);

console.log("\n촬영 시작 시각 되계산");
const base = recordingBase([{startedAt: "2026-08-23T14:32:07.000Z", startSec: 7}], new Date(0));
check("startedAt - startSec", base.toISOString(), "2026-08-23T14:32:00.000Z");
check("startedAt 이 없으면 fallback",
  recordingBase([{startedAt: null, startSec: 5}], new Date("2026-08-23T00:00:00.000Z")).toISOString(),
  "2026-08-23T00:00:00.000Z");
check("atSec", atSec(new Date("2026-08-23T00:00:00.000Z"), 90).toISOString(), "2026-08-23T00:01:30.000Z");

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
