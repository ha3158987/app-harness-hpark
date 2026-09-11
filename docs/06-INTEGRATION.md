---
doc: 06
title: INTEGRATION — 프론트엔드 통합 가이드
category: 앱추가
audience: 개발자
status: active
updated: 2026-09-11
---

# INTEGRATION — 프론트엔드 통합 가이드

당신의 웹 서비스를 하네스 앱과 엮는 방법. **웹 코드를 앱에 넣는 게 아니다** — 앱은 당신의
배포된 웹을 원격 로드하고, 웹은 `@harness/bridge` 로 네이티브 기능을 호출한다.

## 0. 핵심 모델
- 앱 = `server.url` 로 **당신 웹사이트를 그대로 로드**하는 셸. 프론트 변경은 **웹만 배포하면 앱에 즉시 반영**(앱 재배포 불필요).
- 당신이 할 일은 두 가지: ① 웹에 `@harness/bridge` 추가 + 호출, ② 하네스에 `apps/<slug>/app.config.json` 등록(../ONBOARDING.md).

## 추천: 어댑터 패턴 + 자동 연동(integrate-web 스킬)
call site 를 여기저기 고치는 대신 **어댑터 한 곳**(`template/integration/harness-adapter.js` 를 웹에 복사)
에서만 앱/웹 분기를 한다. 그러면 연동이 결정론적이라 **`integrate-web` 스킬**로 자동화된다("이 웹 레포를
하네스에 연결해줘" → AI 가 어댑터 배치 + call site 분기 + app.config 등록 + diff 보고).
```js
import { initHarness, login, buy } from './harness-adapter';
await initHarness({ onDeepLink: (url) => router.push(new URL(url).pathname) });
loginBtn.onclick = () => login('google', () => startWebGoogleOAuth());  // 앱=네이티브 경로, 웹=기존
buyBtn.onclick   = () => buy('coin_100', () => myWebCheckout('coin_100'));
```
아래는 어댑터 없이 브릿지를 직접 쓰는 저수준 사용법이다.

## 1. 설치 / 부트스트랩
```bash
npm i @harness/bridge   # (모노레포면 file:/workspace 의존성)
```
```js
import { AppBridge } from '@harness/bridge';

await AppBridge.ready();              // 앱 시작 1회. config/capabilities 로딩 대기
if (AppBridge.isNative) { /* 앱 */ } else { /* 브라우저 */ }
```
- `AppBridge.isNative` : 앱이면 true. **모든 분기는 이걸로**(OS 분기 X).
- `AppBridge.capabilities` : 켜진 기능 플래그. 예 `if (AppBridge.capabilities.biometric) …`
- 브라우저에선 네이티브 메서드가 **안전한 폴백**(공유=Web Share, 결제=웹PG 등).

## 2. API 한눈에

| 영역 | 메서드 |
|---|---|
| 코어 | `ready()`, `isNative`, `platform`, `capabilities`, `config` |
| 로그인/SSO | `login(provider)`(네이티브 OAuth 앱), `logout()`, `completeSignup(profile)`, `rememberLastLogin(provider)`, `getLastLogin()`, `deleteAccount()` |
| 브로커 로그인(앱이 `login()` 을 안 쓰는 팝챗형) | `onDeepLink(fn)` + `openExternal(startUrl)` + `closeInAppBrowser()` + `onBrowserClosed(fn)`(취소) + `onPause/onResume`(옛 브릿지 폴백) — 25-AUTH-DELEGATION.md §4 |
| 인앱결제 | `getProducts()`, `purchase(id)`, `restorePurchases()` |
| 공유/링크 | `share()`, `openExternal(url,{system})` |
| 푸시/알림 | `registerPush()`, `scheduleNotification()`, `cancelNotification()` |
| 딥링크 | `onDeepLink(fn)` |
| 강제업데이트 | `checkForceUpdate()` (보통 자동) |
| 기기/네트워크/키보드 | `getDeviceInfo()`, `getNetworkStatus()`, `onNetworkChange(fn)`, `onKeyboard(fn)` |
| 저장 | `secureSet/Get/Remove`(민감), `setPref/getPref/removePref`(일반) |
| 카메라/위치/햅틱/클립보드 | `takePhoto()`, `getLocation()`, `haptic()`, `copyToClipboard()`, `readClipboard()` |
| 마케팅/분석 | `initMarketing()`, `track(event,params)`, `setUser(id,traits)`, `requestTracking()`(iOS ATT) |
| 백버튼/에러 | `onBackButton(fn)`, `reportError(e)` |

상세 타입은 `template/bridge/dist/index.d.ts`.

## 3. 자주 쓰는 패턴

### 로그인 + 신규 온보딩 (10-AUTH.md)
```js
const r = await AppBridge.login('kakao');
if (r.isNew || r.needsProfile) {
  const profile = await showOnboarding();              // 약관+추가정보(웹 UI)
  await AppBridge.completeSignup(profile);
}
```

### 브로커 로그인 — 앱이 공급자와 직접 OAuth 를 돌지 않는 앱 (25-AUTH-DELEGATION.md §3 A′)
`login()` 대신 **서비스 BE 의 start 를 인앱 브라우저로 열고, 딥링크로 돌아온 code 를 웹이 상환**한다.
하네스는 이 헬퍼를 제공하지 않는다(상환·결과 판정이 BE 계약이라 웹 소유 — 2026-09-11 결정).
**참조 구현**: 팝챗 `character-chatbot-web/src/lib/harness/adapter.ts` 의 `awaitOAuthReturn` · `brokeredSignIn` ·
`isOAuthCallbackUrl` · `redeemOrphanOAuthReturn` · `signInOutcome`(+ 같은 폴더의 `*.test.ts`). 새 앱은 이 파일을
복사해 BE 경로(`/auth/social/{p}/start`, `/auth/social/redeem`)만 맞춘다. 골격:
```js
const off = AppBridge.onDeepLink((url) => {           // 1) 열기 **전에** 리스너 등록
  const u = new URL(url);
  if (u.host !== 'oauth' || !(u.searchParams.has('code') || u.searchParams.has('error'))) return; // 라우팅 딥링크
  off(); AppBridge.closeInAppBrowser();
  redeem(u.searchParams.get('code'));                 // 2) 상환은 앱 WebView 가 — 쿠키가 여기 구워진다
});
const offClosed = AppBridge.onBrowserClosed(() => setTimeout(cancel, 2500)); // 3) 창 닫힘 = 취소(유예 2.5s)
await AppBridge.openExternal(startUrl);               // 4) 인앱 브라우저(②). {system:true} 는 쓰지 않는다
```
콜드스타트로 온 복귀(대기 중인 로그인이 없음)는 라우팅 핸들러가 상환해야 code 가 버려지지 않는다(참조 구현 `redeemOrphanOAuthReturn`).

### 인앱결제 — 웹/앱 가격 분기 (11-IAP.md)
```js
if (AppBridge.isNative) {
  await AppBridge.purchase('coin_100');                 // 스토어 IAP(앱 가격티어) → 서버지갑
} else {
  await myWebCheckout('coin_100');                      // 웹 PG(웹 가격) → 같은 서버지갑
}
```

### 딥링크 라우팅 (직접/디퍼드/푸시탭 통합)
```js
AppBridge.onDeepLink((url) => router.push(new URL(url).pathname));
```

### Android 백버튼
```js
AppBridge.onBackButton(() => { if (modalOpen) { closeModal(); return true; } return false; });
```

### 시작 시 마케팅
```js
await AppBridge.requestTracking();                      // iOS ATT (initMarketing 전)
await AppBridge.initMarketing({ onDeepLink: routeDeepLink });
AppBridge.track('screen_view', { path: location.pathname }); // 자동수집도 있음
```

## 4b. 크래시 리포트(Sentry)
`monitoring.crash.provider="sentry"` + `dsn` 을 config 에 두면 브릿지가 `initMonitoring()` 으로 자동 init 한다.
단 `@sentry/capacitor` 는 프레임워크 형제(`@sentry/react|vue|angular`)를 요구하므로 **웹 앱이 직접 설치**한다:
```bash
npm i @sentry/capacitor @sentry/react   # (당신 프레임워크에 맞게)
```
미설치면 브릿지는 조용히 no-op(에러 없음). 수동 보고는 `AppBridge.reportError(e)`.

## 4c. 웹/앱에서 다른 이벤트·콘텐츠 (+ 지갑 갱신)
가격뿐 아니라 **이벤트/배너/쿠폰/섹션도 앱/웹 다르게** 가능. 자주 바뀌므로 **백엔드 주도** 권장:
클라가 컨텍스트를 보내고 서버가 맞는 캠페인을 내려준다(→ 앱/웹 재배포 없이 이벤트 교체, 앱 전용 이벤트도).
```js
import { context, onResume, fetchWallet } from './harness-adapter';
const campaigns = await fetch('/campaigns', {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(context()),       // { isApp, platform, appVersion, slug }
}).then(r => r.json());                   // 서버가 앱/웹별 이벤트 반환

// 지갑 잔액(계정에 묶임 = 웹/앱 동일). 복귀 시 자동 갱신
onResume(async () => { walletEl.textContent = await fetchWallet(); });
```
> 클라 분기로 간단히 `if (isApp()) showAppEvent()` 도 가능하나, 운영성(무재배포 교체)은 백엔드 주도가 우월.
> 서버 렌더(SSR)면 컨텍스트 대신 UA 표식(`HarnessApp/...`)으로 분기(11-IAP.md §2).

## 4. 주의
- **앱/브라우저 둘 다 잘 돌게**: 항상 `isNative`/`capabilities` 로 분기하고 폴백 가정.
- **민감정보는 `secureSet`**(토큰/세션). `setPref` 는 비암호화.
- **OS 분기 금지**: `platform` 직접 분기보다 capability 피처 디텍션.
- 자세한 정책/백엔드 규약: `10-AUTH.md`(로그인/SSO/회원가입), `11-IAP.md`(결제), `08-DEPLOY.md`(배포).
