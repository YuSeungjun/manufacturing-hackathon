/**
 * 로컬 기준 오늘 날짜 (YYYY-MM-DD).
 *
 * toISOString() 은 UTC 라서 한국(UTC+9)에서는 자정부터 오전 9시 사이에 전날을 돌려준다.
 * 그 값을 작업일 기본값으로 쓰면 어제 날짜로 TBM 이 저장되고, 작업자 화면에서 사라진다.
 */
export function todayLocalISO() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "2026-08-23" → "8월 23일". Date 를 거치지 않아 서버·클라이언트 결과가 항상 같다. */
export function formatIsoDateKo(iso: string) {
  const [, month, day] = iso.split("-");
  if (!month || !day) return iso;
  return `${Number(month)}월 ${Number(day)}일`;
}

/** "2026-08-23" 하루치 범위(로컬 기준). */
export function dayRange(iso: string) {
  const from = new Date(`${iso}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

/** ?date= 값을 검증한다. 형식이 아니거나 없는 날짜면 오늘로 되돌린다. */
export function resolveDateParam(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return todayLocalISO();
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return todayLocalISO();
  // "2026-02-31" 처럼 존재하지 않는 날짜는 Date 가 다음 달로 넘겨 버린다.
  return parsed.getDate() === Number(raw.slice(8, 10)) ? raw : todayLocalISO();
}

/** 날짜를 days 만큼 옮긴다. 정오 기준이라 서머타임 경계에 걸리지 않는다. */
export function shiftIsoDate(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-08-23" → "8월 23일 (일)" */
export function formatIsoDateKoLong(iso: string) {
  const weekday = new Date(`${iso}T12:00:00`).toLocaleDateString("ko-KR", { weekday: "short" });
  return `${formatIsoDateKo(iso)} (${weekday})`;
}

/** Date → 로컬 기준 "YYYY-MM-DD". */
export function toLocalIsoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** iso 로 끝나는 length 일치 날짜 배열 (오래된 것부터). */
export function lastIsoDays(iso: string, length: number) {
  return Array.from({ length }, (_, i) => shiftIsoDate(iso, i - (length - 1)));
}
