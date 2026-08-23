/**
 * CCTV 감지 알림음.
 *
 * 브라우저에는 "소리 권한" 프롬프트가 없다. 카메라·마이크와 달리 자동재생은 권한 API 가
 * 아니라 **그 문서에서 사용자가 조작을 했는지**(user activation)로 판단한다.
 * 그래서 로그인 버튼을 누르는 그 순간에 오디오를 한 번 열어 둔다. 로그인 후 현황판으로는
 * 클라이언트 전환이라 같은 문서가 유지되고, 그 덕에 팝업에서 소리가 바로 난다.
 *
 * 새로고침으로 현황판에 바로 들어오면 조작 기록이 없어 막힌다 — 그때는 팝업이
 * «소리 켜기» 를 띄운다. 소리는 거들 뿐이고 알림의 본체는 화면이다.
 */

const SRC = "/sounds/cctv-alert.mp3";
const MUTED_KEY = "safe-restart:alert-muted";

let element: HTMLAudioElement | null = null;

function audio() {
  if (!element) {
    element = new Audio(SRC);
    element.preload = "auto";
    element.volume = 0.6;
  }
  return element;
}

export function isAlertMuted() {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAlertMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // 저장이 막혀 있어도 이번 세션 동안은 동작한다.
  }
  listeners.forEach((notify) => notify());
}

/* 음소거 설정은 localStorage 에 있다 — React 밖의 값이라 외부 저장소로 읽는다. */
const listeners = new Set<() => void>();

export function subscribeAlertMuted(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** 서버는 이 값을 알 수 없다. 정해지기 전에는 소리를 켠 상태로 그린다. */
export function alertMutedOnServer() {
  return false;
}

/**
 * 사용자 조작 안에서 불러 오디오를 열어 둔다.
 * 소리를 내지 않으려고 음소거로 잠깐 재생했다가 되감는다.
 */
export function primeAlertSound() {
  const el = audio();
  const wasMuted = el.muted;
  el.muted = true;
  el.play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.muted = wasMuted;
    })
    .catch(() => {
      el.muted = wasMuted;
    });
}

/** 실제로 들리게 재생한다. 막히면 false 를 돌려준다. */
export async function playAlertSound(): Promise<boolean> {
  if (isAlertMuted()) return true;
  const el = audio();
  el.muted = false;
  el.currentTime = 0;
  try {
    await el.play();
    return true;
  } catch (error) {
    // AbortError 는 우리가 멈춘 것이다. 브라우저가 막은 건 NotAllowedError 뿐이다.
    return !(error instanceof DOMException && error.name === "NotAllowedError");
  }
}

export function stopAlertSound() {
  if (!element) return;
  element.pause();
  element.currentTime = 0;
}
