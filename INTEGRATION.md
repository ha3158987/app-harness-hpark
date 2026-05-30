# INTEGRATION — 프론트엔드 통합 가이드

당신의 웹 서비스를 하네스 앱과 엮는 방법. **웹 코드를 앱에 넣는 게 아니다** — 앱은 당신의
배포된 웹을 원격 로드하고, 웹은 `@harness/bridge` 로 네이티브 기능을 호출한다.

## 0. 핵심 모델
- 앱 = `server.url` 로 **당신 웹사이트를 그대로 로드**하는 셸. 프론트 변경은 **웹만 배포하면 앱에 즉시 반영**(앱 재배포 불필요).
- 당신이 할 일은 두 가지: ① 웹에 `@harness/bridge` 추가 + 호출, ② 하네스에 `apps/<slug>/app.config.json` 등록(ONBOARDING.md).

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
| 로그인/SSO | `login(provider)`, `logout()`, `completeSignup(profile)`, `getLastLogin()`, `deleteAccount()` |
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

### 로그인 + 신규 온보딩 (AUTH.md)
```js
const r = await AppBridge.login('kakao');
if (r.isNew || r.needsProfile) {
  const profile = await showOnboarding();              // 약관+추가정보(웹 UI)
  await AppBridge.completeSignup(profile);
}
```

### 인앱결제 — 웹/앱 가격 분기 (IAP.md)
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

## 4. 주의
- **앱/브라우저 둘 다 잘 돌게**: 항상 `isNative`/`capabilities` 로 분기하고 폴백 가정.
- **민감정보는 `secureSet`**(토큰/세션). `setPref` 는 비암호화.
- **OS 분기 금지**: `platform` 직접 분기보다 capability 피처 디텍션.
- 자세한 정책/백엔드 규약: `AUTH.md`(로그인/SSO/회원가입), `IAP.md`(결제), `DEPLOY.md`(배포).
