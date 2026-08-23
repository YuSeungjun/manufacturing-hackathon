/**
 * 날짜는 전부 현장 시간대(한국) 기준이다.
 *
 * 서버의 로컬 시간대에 기대면 안 된다 — Vercel 함수는 UTC 로 돌아서
 * 한국 시간 자정부터 오전 9시 사이에 "오늘"이 하루 어긋난다.
 * 그래서 시간대를 코드에 못 박는다. (Vercel 은 TZ 를 예약어로 막아 둔다.)
 *
 * 한국은 서머타임이 없어 UTC+09:00 고정이라 오프셋을 그대로 써도 된다.
 */

export const SITE_ZONE = "Asia/Seoul";
const SITE_OFFSET = "+09:00";

/** 현장 기준 오늘 (YYYY-MM-DD). */
export function todayLocalISO() {
  return toLocalIsoDate(new Date());
}

/** 어떤 시각이 현장 기준 며칠인지 (YYYY-MM-DD). */
export function toLocalIsoDate(date: Date) {
  // en-CA 는 YYYY-MM-DD 로 찍힌다.
  return new Intl.DateTimeFormat("en-CA", { timeZone: SITE_ZONE }).format(date);
}

/** "2026-08-23" 하루의 시작·끝 (현장 자정 기준의 실제 시각). */
export function dayRange(iso: string) {
  const from = new Date(`${iso}T00:00:00${SITE_OFFSET}`);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from, to };
}

/** 현장 자정에 해당하는 시각. 작업일을 저장할 때 쓴다. */
export function isoDateToInstant(iso: string) {
  return new Date(`${iso}T00:00:00${SITE_OFFSET}`);
}

/** ?date= 값을 검증한다. 형식이 아니거나 없는 날짜면 오늘로 되돌린다. */
export function resolveDateParam(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return todayLocalISO();
  const parsed = new Date(`${raw}T00:00:00${SITE_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) return todayLocalISO();
  // "2026-02-31" 처럼 존재하지 않는 날짜는 Date 가 다음 달로 넘겨 버린다.
  return toLocalIsoDate(parsed) === raw ? raw : todayLocalISO();
}

/** 날짜를 days 만큼 옮긴다. */
export function shiftIsoDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00${SITE_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return toLocalIsoDate(d);
}

/** iso 로 끝나는 length 일치 날짜 배열 (오래된 것부터). */
export function lastIsoDays(iso: string, length: number) {
  return Array.from({ length }, (_, i) => shiftIsoDate(iso, i - (length - 1)));
}

/** "2026-08-23" → "8월 23일". Date 를 거치지 않아 서버·클라이언트 결과가 항상 같다. */
export function formatIsoDateKo(iso: string) {
  const [, month, day] = iso.split("-");
  if (!month || !day) return iso;
  return `${Number(month)}월 ${Number(day)}일`;
}

/** "2026-08-23" → "8월 23일 (일)" */
export function formatIsoDateKoLong(iso: string) {
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    timeZone: SITE_ZONE,
    weekday: "short",
  }).format(new Date(`${iso}T00:00:00${SITE_OFFSET}`));
  return `${formatIsoDateKo(iso)} (${weekday})`;
}

/* ── 화면에 찍는 시각 — 전부 현장 시간대로 ────────────────── */

/** "23:21" */
export function formatTime(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SITE_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "2026. 8. 23." */
export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: SITE_ZONE, dateStyle: "medium" }).format(date);
}

/** 기계 층 판독용 — "2026-08-23 23:21:44" */
export function formatStamp(date: Date) {
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: SITE_ZONE }).format(date);
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: SITE_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  return `${d} ${t}`;
}
