// harness-adapter — 웹 서비스에 드롭인하는 "연결 레이어".
//
// 목적: 웹 코드 곳곳을 고치는 대신, 여기 한 곳에서만 앱/웹 분기를 한다.
//   - 앱(WebView): AppBridge 네이티브 흐름
//   - 웹(브라우저): 당신이 넘긴 webFallback(기존 웹 로직) 실행
// 웹 서비스 레포에 복사해서 쓴다. (integrate-web 스킬이 자동 배치)
//
// 사용 예:
//   import { initHarness, login, buy, share } from './harness-adapter';
//   await initHarness({ onDeepLink: (url) => router.push(new URL(url).pathname) });
//   loginBtn.onclick = () => login('google', () => startWebGoogleOAuth());
//   buyBtn.onclick   = () => buy('coin_100', () => myWebCheckout('coin_100'));

import { AppBridge } from '@ha3158987/harness-bridge';

/** 앱(네이티브 셸) 안인가? 모든 분기의 기준. */
export const isApp = () => AppBridge.isNative;

/** capability 피처 디텍션 (예: caps().biometric) */
export const caps = () => AppBridge.capabilities;

/**
 * 앱 시작 시 1회. config 로딩 대기 + (앱이면) ATT/마케팅/딥링크 배선 + 강제업데이트(자동).
 * @param {{ onDeepLink?: (url:string)=>void }} opts
 */
export async function initHarness(opts = {}) {
  await AppBridge.ready();
  if (!AppBridge.isNative) return { app: false };
  try { await AppBridge.requestTracking(); } catch { /* iOS 외 noop */ }
  try { await AppBridge.initMarketing({ onDeepLink: opts.onDeepLink }); } catch { /* noop */ }
  if (typeof opts.onDeepLink === 'function') AppBridge.onDeepLink(opts.onDeepLink);
  return { app: true, capabilities: AppBridge.capabilities };
}

/**
 * 로그인. 앱이면 AppBridge.login(소셜/IdP), 웹이면 webFallback(기존 웹 로그인).
 * 신규회원이면 onNewUser 콜백(또는 needsProfile 반환) → 웹 온보딩 후 completeSignup.
 */
export async function login(provider, webFallback, opts = {}) {
  if (!AppBridge.isNative) return webFallback ? webFallback() : { ok: false, reason: 'web-fallback-missing' };
  const r = await AppBridge.login(provider, opts);
  if ((r.isNew || r.needsProfile) && typeof opts.onNewUser === 'function') {
    const profile = await opts.onNewUser(r);
    if (profile) return AppBridge.completeSignup(profile);
  }
  return r;
}

/** 게스트(익명) 로그인 — 로그인 전 지갑/진행상황 보관(IAP 면 필요). 앱 전용(웹은 자체 처리). */
export async function guestLogin() {
  if (!AppBridge.isNative) return { ok: false, reason: 'web' };
  return AppBridge.guestLogin();
}

/**
 * 세션 보장: /auth/me 가 비로그인이면 게스트 로그인으로 신원 확보(IAP/지갑 동작용).
 * 앱 시작 시 initHarness 직후 호출하면 "비로그인이라도 구매/적립 가능" 상태가 된다.
 */
export async function ensureSession(meUrl = '/auth/me') {
  try {
    const r = await fetch(meUrl, { credentials: 'include' });
    if (r.ok) return { ok: true, guest: false };
  } catch { /* 무시 */ }
  if (AppBridge.isNative) return AppBridge.guestLogin();
  return { ok: false, reason: 'web-anonymous' };
}

export async function logout(webFallback) {
  if (!AppBridge.isNative) return webFallback ? webFallback() : { ok: true };
  return AppBridge.logout();
}

export async function deleteAccount(webFallback) {
  if (!AppBridge.isNative) return webFallback ? webFallback() : { ok: false };
  return AppBridge.deleteAccount();
}

/** 마지막 로그인 수단(앱). "카카오로 계속하기" 배지용. 웹은 null. */
export async function lastLogin() {
  if (!AppBridge.isNative) return null;
  return AppBridge.getLastLogin();
}

/** 생체 빠른 재로그인 켜기/끄기(실로그인 직후 권유). 웹은 noop. */
export async function enableBiometricLogin(enabled = true) {
  if (!AppBridge.isNative) return { ok: false, reason: 'web' };
  return AppBridge.enableBiometricLogin(enabled);
}

/** 앱 시작 시 잠금 해제(생체 빠른 로그인 켜져 있으면 생체 요구). 웹은 항상 unlocked. */
export async function unlock() {
  if (!AppBridge.isNative) return { unlocked: true, reason: 'web' };
  return AppBridge.unlock();
}

/**
 * 결제. 앱이면 스토어 IAP(디지털 재화 필수), 웹이면 webFallback(웹 PG).
 * 둘 다 같은 서버 지갑에 적립되도록 백엔드를 맞춘다.
 */
export async function buy(productId, webFallback) {
  if (!AppBridge.isNative) return webFallback ? webFallback() : { ok: false, reason: 'web-fallback-missing' };
  return AppBridge.purchase(productId);
}

/** 앱 가격(스토어 현지화) 목록. 웹은 빈 배열(웹 가격은 웹이 표시). */
export async function products() {
  if (!AppBridge.isNative) return [];
  return AppBridge.getProducts();
}

/** 공유 — 브릿지가 이미 앱/웹 폴백 처리(네이티브 시트 ↔ Web Share/클립보드). */
export const share = (opts) => AppBridge.share(opts);

/** 외부 링크 — 앱이면 in-app/시스템 브라우저, 웹이면 새 탭. */
export const openExternal = (url, opts) => AppBridge.openExternal(url, opts);

/** Android 백버튼. handler 가 true 면 기본 동작 억제. 웹은 noop. */
export const onBackButton = (handler) => AppBridge.onBackButton(handler);

/** 푸시 등록(앱). 웹은 granted:false. */
export const registerPush = () => AppBridge.registerPush();

/** 이벤트 로깅(앱: 마케팅 SDK, 웹: 필요시 자체 처리). */
export const track = (event, params) => AppBridge.track(event, params);

/** 앱 포그라운드 복귀(웹은 focus/visibility) → 지갑/세션 갱신용. 반환=해제 함수. */
export const onResume = (handler) => AppBridge.onResume(handler);

/** 백엔드에 보낼 컨텍스트(앱/웹·플랫폼·버전) — 서버가 이벤트/가격 분기에 사용. */
export const context = () => AppBridge.context();

/** 안전영역 인셋(px). CSS 만으로 되면 var(--safe-area-inset-*) 직접 사용 권장. */
export const safeAreaInsets = () => AppBridge.getSafeAreaInsets();

/** 접근권한 안내 목록(한국 필수 화면용): [{type,label,purpose,required}] */
export const permissionNotice = () => AppBridge.getPermissionNotice();
/** 권한 just-in-time 요청(기능 처음 쓸 때). 웹은 unsupported. */
export const requestPermission = (type) => AppBridge.requestPermission(type);
export const permissionStatus = (type) => AppBridge.permissionStatus(type);

/**
 * 성인인증(본인확인) 시작. config.legal.ageVerifyUrl(또는 url)을 시스템 브라우저로 연다.
 * 본인확인기관이 서버로 콜백 → 복귀 후 onResume 에서 서버 상태(예: /me)로 성인여부 재확인.
 * (PASS 앱-투-앱은 딥링크로 복귀 — onDeepLink 도 함께 동작)
 */
export async function startAgeVerification(url) {
  const target = url || (AppBridge.config && AppBridge.config.legal && AppBridge.config.legal.ageVerifyUrl);
  if (!target) return { ok: false, reason: 'no-age-verify-url' };
  if (AppBridge.isNative) await AppBridge.openExternal(target, { system: true });
  else window.location.href = target;
  return { ok: true, opened: true }; // 결과는 서버 재확인(onResume)으로
}

/**
 * 서버 권위 지갑 잔액 조회 헬퍼. 구매/로그인 직후 + onResume 에서 호출.
 * 잔액은 계정(SSO)에 묶여 웹/앱이 같은 값. 클라는 진실을 들지 않고 항상 서버에서 읽는다.
 */
export async function fetchWallet(url = '/wallet') {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) return null;
  const data = await r.json();
  return data.balance;
}

// ─────────────────────────────────────────────────────────────────────────────
// AppChannel 호환 shim — 기존 웹에 `window.AppChannel.postMessage("scheme://...")`
// 패턴이 박혀 있을 때 사용. 웹 코드 한 줄도 안 고치고 하네스로 옮기기 위함.
//
// 동작:
//   1) `installAppChannelShim({ scheme: 'poptale' })` 호출 시 window.AppChannel 폴리필.
//   2) 웹이 `postMessage("poptale://login/google")` 부르면 shim 이 파싱해서
//      `AppBridge.login('google')` 같은 표준 API 로 라우팅.
//   3) 앱→웹 방향은 `dispatchAppEvent(detail, 'poptaleApp')` 로 CustomEvent 발사.
//
// 기본 라우트는 Poptale 의 누적 규약 추정값(login/logout/purchase/share/external/haptic/track/brightness).
// 정확한 규약은 각 서비스의 docs/app-web-connection.md 정본을 따라 routes 로 override.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_APP_CHANNEL_SCHEME = 'poptale';

/**
 * @param {object} opts
 * @param {string} [opts.scheme='poptale']           URL 스킴 (poptale://...)
 * @param {string} [opts.channelName='AppChannel']   window 에 노출할 채널 이름
 * @param {Record<string, (path:string[], query:Record<string,string>, parsed:object)=>any>} [opts.routes]
 *   override/추가 라우트. 키는 URL 의 host(첫 토큰). 기본 라우트와 머지된다.
 * @param {(message:string, parsed?:object)=>any} [opts.onUnknown]
 *   라우트 미매칭 시 폴백. 없으면 silently 무시(+debug log).
 * @param {(msg:string)=>void} [opts.logger]
 * @returns {()=>void} uninstall
 */
export function installAppChannelShim(opts = {}) {
  if (typeof window === 'undefined') return () => {};
  const {
    scheme = DEFAULT_APP_CHANNEL_SCHEME,
    channelName = 'AppChannel',
    routes = {},
    onUnknown = null,
    logger = () => {},
  } = opts;

  // 진짜 네이티브 AppChannel 이 이미 주입되어 있으면(예: 기존 Flutter 셸) shim 은 양보.
  if (window[channelName] && typeof window[channelName].postMessage === 'function') {
    logger(`existing window.${channelName} detected — shim skipped`);
    return () => {};
  }

  const builtinRoutes = {
    'login': (path, query) => {
      const provider = path[0] || query.provider;
      if (!provider) throw new Error('app-channel login: provider required');
      return AppBridge.login(provider);
    },
    'logout': () => AppBridge.logout(),
    'delete-account': () => AppBridge.deleteAccount(),
    'purchase': (path, query) => {
      const id = path[0] || query.id || query.productId;
      if (!id) throw new Error('app-channel purchase: productId required');
      return AppBridge.purchase(id);
    },
    'restore-purchases': () => AppBridge.restorePurchases(),
    'share': (_path, query) => AppBridge.share({ title: query.title, text: query.text, url: query.url }),
    'external': (_path, query) => {
      if (!query.url) throw new Error('app-channel external: url required');
      return AppBridge.openExternal(query.url, { system: query.system === '1' || query.system === 'true' });
    },
    'haptic': (path, query) => AppBridge.haptic(path[0] || query.style || 'light'),
    'register-push': () => AppBridge.registerPush(),
    'track': (_path, query) => {
      const { event, ...params } = query;
      if (!event) throw new Error('app-channel track: event required');
      return AppBridge.track(event, params);
    },
    'set-user': (path, query) => {
      const userId = path[0] || query.userId;
      if (!userId) throw new Error('app-channel set-user: userId required');
      const { userId: _u, ...traits } = query;
      return AppBridge.setUser(userId, traits);
    },
    // 뷰어 밝기 — 팝테일 웹 `sendBrightnessValue` 가 보내는 `poptale://brightness?value=0.0~1.0`.
    // 값이 없거나 숫자가 아니면 시스템 밝기로 복귀(-1).
    'brightness': (path, query) => {
      const v = Number(path[0] ?? query.value);
      return AppBridge.setBrightness(Number.isFinite(v) ? v : -1);
    },
    // 'navigate' 는 라우터 책임 — 기본은 no-op. 웹이 routes 로 override 한다.
    'navigate': () => undefined,
  };
  const allRoutes = { ...builtinRoutes, ...routes };

  function parseMessage(message) {
    if (typeof message !== 'string') return null;
    try {
      const url = new URL(message);
      if (url.protocol !== `${scheme}:`) return null;
      const host = (url.hostname || url.host || '').toLowerCase();
      const path = url.pathname.split('/').filter(Boolean);
      const query = Object.fromEntries(url.searchParams);
      return { host, path, query, raw: message };
    } catch {
      return null;
    }
  }

  const channel = {
    postMessage: async (message) => {
      const parsed = parseMessage(message);
      if (!parsed) {
        if (typeof onUnknown === 'function') return onUnknown(message);
        logger(`unparseable: ${message}`);
        return;
      }
      const handler = allRoutes[parsed.host];
      if (!handler) {
        if (typeof onUnknown === 'function') return onUnknown(message, parsed);
        logger(`no route for "${parsed.host}" (msg=${message})`);
        return;
      }
      try {
        return await handler(parsed.path, parsed.query, parsed);
      } catch (e) {
        if (typeof AppBridge.reportError === 'function') {
          AppBridge.reportError(e, { source: 'app-channel-shim', message });
        }
        logger(`handler error: ${e?.message}`);
      }
    },
  };

  window[channelName] = channel;
  logger(`installed window.${channelName} (scheme=${scheme}://)`);
  return () => {
    if (window[channelName] === channel) delete window[channelName];
  };
}

/**
 * 앱→웹 방향 이벤트 디스패치. 기존 Poptale 규약: `CustomEvent('poptaleApp', { detail })`.
 * 네이티브 셸이 evaluateJavascript 로 호출하거나, 웹 테스트에서 직접 호출.
 */
export function dispatchAppEvent(detail, eventName = 'poptaleApp') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 화면 캡쳐 방지 / 밝기 — config.features.viewer 기반 자동 토글 헬퍼.
// (실제 native 구현이 있어야 동작. AppBridge.blockCapture / setBrightness 는 dev 가 구현.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * config.features.viewer.captureBlock.paths 에 매칭되는 경로에서만 화면캡쳐 차단.
 * SPA 라우팅(pushState/popstate)을 감지해 자동 on/off. 반환=해제 함수.
 */
export function autoBlockCaptureOnPaths() {
  if (typeof window === 'undefined' || !AppBridge.isNative) return () => {};
  const paths = AppBridge.config?.features?.viewer?.captureBlock?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return () => {};
  const matches = (loc) => paths.some(p => loc.startsWith(p));
  const apply = (loc) => {
    if (typeof AppBridge.blockCapture === 'function') AppBridge.blockCapture(matches(loc));
  };
  apply(window.location.pathname);
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) {
    const r = origPush.apply(this, args);
    apply(window.location.pathname);
    return r;
  };
  history.replaceState = function (...args) {
    const r = origReplace.apply(this, args);
    apply(window.location.pathname);
    return r;
  };
  const onPop = () => apply(window.location.pathname);
  window.addEventListener('popstate', onPop);
  return () => {
    history.pushState = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', onPop);
    if (typeof AppBridge.blockCapture === 'function') AppBridge.blockCapture(false);
  };
}

export { AppBridge };
