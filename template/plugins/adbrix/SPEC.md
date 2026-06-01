# Adbrix (DFINERY) Capacitor 플러그인 — 작업 사양서

> 한국 어트리뷰션 SDK (DFINERY Adbrix). Poptale 1.1.13+181 에서 도입된 분석 시스템.
> 하네스 `marketing.attribution.provider: "adbrix"` 슬롯의 실제 배선을 채운다.

---

## 1. 목적

- 앱 설치 어트리뷰션 (어디서 광고 클릭하고 들어왔는지) 수집
- 이벤트 트래킹 (`AppBridge.track('event', params)` 가 자동 분배)
- 사용자 식별 (`AppBridge.setUser`)

## 2. config 진입점

```jsonc
{
  "marketing": {
    "attribution": { "provider": "adbrix", "deferredDeepLink": false }
  }
}
```

- 디퍼드 딥링크는 보통 AppsFlyer 가 잘함. Adbrix 만 쓰면 `deferredDeepLink: false`.

## 3. 키 주입 (환경변수 — 레포에 커밋 금지)

`generate-app` 실행 전:

| 환경변수 | 의미 |
|---|---|
| `ADBRIX_APP_KEY` (또는 `ADBRIX_APP_KEY_<SLUG>`) | Adbrix 앱 키 |
| `ADBRIX_SECRET_KEY` (또는 `ADBRIX_SECRET_KEY_<SLUG>`) | Adbrix 시크릿 키 |

`<SLUG>` = 슬러그 대문자 + 하이픈→언더스코어. 예: `poptale` → `ADBRIX_APP_KEY_POPTALE`.

키가 없으면 빌드는 되지만 Adbrix 는 런타임 비활성(경고). 키 넣고 재실행하면 활성.

## 4. Poptale Flutter 레퍼런스

- pubspec: `adbrix_plugin: ^1.1.2`
- 1.1.13+181 — Adbrix(DFINERY) SDK 연동 및 분석 시스템 고도화
- 1.1.15+183 — `poptale://deeplink` 앱스킴 핸들러 추가, Adbrix SDK API 수정
- 이벤트 명명 규칙 (1.1.8+175): lowercase snake_case, `app_*/push_*/sns_*/iap_*` 네임스페이스

## 5. AppBridge 표면

기존 `track`/`setUser` API 가 Adbrix 로 자동 분배. 앱 코드에서 *Adbrix 를 모르는 채* 사용:

```js
AppBridge.track('app_open');                              // Adbrix 자동 분배
AppBridge.track('iap_purchase', { price: 9900, item: 'coin_100' });
AppBridge.setUser('user_123', { plan: 'premium' });
```

## 6. 배선 체크리스트 (MARKETING.md §4 패턴)

1. `scripts/lib/config.mjs` — `KNOWN_PROVIDERS.attribution` 에 `'adbrix'` 추가됨 ✅
2. `scripts/generate-app.mjs`:
   - `MARKETING_PLUGINS.attribution.adbrix` 에 npm 패키지 추가
   - `WIRED_PROVIDERS.attribution` 에 `'adbrix'` 추가 (자동 배선 활성)
   - `bakedConfig()` 에 `ADBRIX_APP_KEY` / `ADBRIX_SECRET_KEY` 환경변수 → 네이티브 베이크
3. `template/bridge/dist/index.js`:
   - `initMarketing()` 에서 `cfg.marketing.attribution.provider === 'adbrix'` 면 Adbrix SDK init
   - `this._providers.adbrix = handle` 저장
   - `track()` 에서 핸들로 분배: `handle.event(eventName, params)`
   - `setUser()` 에서 핸들로 분배: `handle.setUserId(id)` + traits 매핑
4. `template/bridge/android/build.gradle`:
   - Adbrix Android SDK 의존성
5. iOS `HarnessBridge.podspec`:
   - Adbrix iOS SDK pod

## 7. 이벤트 명명 표준 (팀 공통)

| 영역 | 이벤트명 | 속성 예 |
|---|---|---|
| 생명주기 | `app_open`, `app_foreground`, `screen_view` | `{ path }` |
| 푸시 | `push_received`, `push_open`, `push_dismiss` | `{ campaignId, deepLink }` |
| 소셜 | `sns_login_attempt`, `sns_login_success`, `sns_login_fail` | `{ method }` ← provider 가 아니라 method |
| IAP | `iap_init`, `iap_purchase_requested`, `iap_purchase_success`, `iap_purchase_fail`, `iap_restore_requested` | `{ productId, price }` |

> Poptale 1.1.8+175 에서 확정된 네이밍. 신규 앱도 같은 표준을 따른다.

## 8. 콘솔 등록 (사람)

- **DFINERY 대시보드** 에 앱 등록 (Android/iOS 각각)
- App Key, Secret Key 발급
- 앱 → 트래킹 링크 / 캠페인 설정

## 9. TODO

- [ ] Adbrix Capacitor 플러그인 패키지 — 공식 없으면 자체 작성
- [ ] iOS ATT 권한 흐름과 통합 (`requestTracking` 이후 init)
- [ ] 디퍼드 딥링크 콜백 — 사용하면 `onDeepLink` 콜백 와이어
- [ ] Poptale 의 기존 Adbrix 대시보드를 그대로 사용할지, 신규 dashboard 분리할지 결정
