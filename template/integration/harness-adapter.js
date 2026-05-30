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

import { AppBridge } from '@harness/bridge';

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

export { AppBridge };
