---
doc: 13
title: MARKETING — 마케팅 SDK 연동 가이드
category: 기능연동
audience: 개발자
status: active
updated: 2026-06-01
---

# MARKETING — 마케팅 SDK 연동 가이드

하네스에 어트리뷰션/분석/CRM SDK 를 붙이는 방법. **키/시크릿은 절대 config·레포에 넣지 않는다** —
환경변수로 주입하면 generate-app 이 **네이티브 번들에만 베이크**한다(웹 폴백엔 미포함).

`app.config.json` 의 `marketing` 블록에서 카테고리별 벤더를 1개씩 고른다:

```jsonc
"marketing": {
  "attribution": { "provider": "appsflyer", "deferredDeepLink": true },
  "analytics":   { "provider": null },   // amplitude | ga4 | firebase | mixpanel
  "crm":         { "provider": null }    // braze | onesignal | moengage
}
```

---

## 1. 현재 자동 배선 상태

| 카테고리 | 벤더 | 상태 |
|---|---|---|
| 어트리뷰션 | **AppsFlyer** | ✅ 자동 배선 (플러그인 설치 + 브릿지 초기화 + 디퍼드 딥링크 라우팅) |
| 어트리뷰션 | Branch / Adjust / Airbridge / **Adbrix(DFINERY)** | 🟡 슬롯만 — 벤더 SDK 수동 설치 + 핸들러 연결 필요 |
| 분석 | Amplitude / GA4 / Firebase / Mixpanel | 🟡 슬롯만 |
| CRM/푸시 | Braze / OneSignal / MoEngage | 🟡 슬롯만 |

> **Adbrix(DFINERY) 메모**: Poptale 에서 사용 중인 한국 어트리뷰션. config 슬롯은 추가됨
> (`marketing.attribution.provider: "adbrix"`). 실제 네이티브 배선은
> `template/plugins/adbrix/SPEC.md` 의 작업 사양을 따라 dev 가 채운다.

"슬롯만" = generate-app 이 config 검증·런타임 주입까지는 하지만 npm 설치/초기화는 아직 사람이.
벤더가 확정되면 아래 "새 벤더 배선" 절차로 자동화 대상에 추가하면 된다.

---

## 2. AppsFlyer (어트리뷰션 + 디퍼드 딥링크) — 바로 사용 가능

### (1) config
```jsonc
"marketing": { "attribution": { "provider": "appsflyer", "deferredDeepLink": true } }
```

### (2) 키 주입 (환경변수 — 레포에 커밋 금지)
generate-app 실행 전에 환경변수로 둔다. 슬러그별 우선, 없으면 공통값 사용.

| 환경변수 | 의미 |
|---|---|
| `APPSFLYER_DEV_KEY` (또는 `APPSFLYER_DEV_KEY_<SLUG>`) | AppsFlyer Dev Key (대시보드 → 앱 설정) |
| `APPSFLYER_IOS_APP_ID` (또는 `..._<SLUG>`) | iOS App Store 숫자 ID (Android 는 불필요) |

`<SLUG>` 은 슬러그를 대문자화 + 하이픈→언더스코어. 예: `service-a` → `APPSFLYER_DEV_KEY_SERVICE_A`.

PowerShell 예:
```powershell
$env:APPSFLYER_DEV_KEY = "여기에_dev_key"
$env:APPSFLYER_IOS_APP_ID = "6480000000"
node scripts/generate-app.mjs --slug service-a
```

키가 없으면 빌드는 되지만 AppsFlyer 는 런타임 비활성(경고 출력). 나중에 키 넣고 재실행하면 활성화.

### (3) 웹에서 초기화 (각 웹 서비스 코드)
```js
import { AppBridge } from '@harness/bridge';

await AppBridge.ready();
await AppBridge.initMarketing({
  onDeepLink: (url) => {
    // 디퍼드/딥링크 도착 → 해당 화면으로 라우팅
    router.navigate(url);
  },
});
```
- 브라우저(앱 아님)에선 no-op. 네이티브에서만 SDK 초기화.
- 키는 네이티브 베이크 config 에서 자동으로 읽는다(웹은 키를 몰라도 됨).

### (4) 딥링크 도메인 설정 (필수)
AppsFlyer OneLink 도메인을 iOS associated domains / Android intent filter 에 등록해야 디퍼드
딥링크가 동작한다. AppsFlyer 대시보드의 OneLink 설정 + 각 플랫폼 가이드 참조.

---

## 3. 이벤트 로깅 자동화 — "앱마다 동선이 다른데 어떻게 자동화하나"

핵심 분리: **공통 동선은 코드 0줄로 자동 수집**하고, **앱별 비즈니스 이벤트는 벤더-중립 API
한 줄(`track`)** 로 찍으면 켜진 모든 마케팅 SDK 로 브릿지가 알아서 분배한다.

### (A) 자동 수집 — 앱별 코드 불필요
`initMarketing()` 호출 시(또는 config `marketing.autoCapture: true`, 기본값) 브릿지가 다음을
자동으로 `track` 한다. 웹 서비스가 SPA 라우팅만 쓰면 추가 작업이 없다.

| 자동 이벤트 | 트리거 | 동선에서의 의미 |
|---|---|---|
| `app_open` | 앱 시작 | 진입 |
| `screen_view` `{path}` | history.pushState/replaceState/popstate | **화면 이동 = 동선의 핵심** |
| `app_foreground` | 백그라운드→포그라운드 복귀 | 재방문 |
| `deep_link_open` `{url}` | 디퍼드/딥링크 도착 | 유입 경로 |

→ "어떤 화면을 어떤 순서로 봤는지"가 앱마다 코드 없이 쌓인다. 끄려면 config `autoCapture: false`
또는 `initMarketing({ autoCapture: false })`.

### (B) 앱별 비즈니스 이벤트 — 벤더 중립 한 줄
앱 고유 동선(구매/회차열람/튜토리얼완료 등)은 그 앱이 직접 찍되, **벤더를 몰라도 된다**:
```js
AppBridge.track('chapter_open', { storyId: 'abc', chapter: 12 });
AppBridge.track('purchase', { price: 9900, currency: 'KRW', item: 'coin_100' });
AppBridge.setUser('user_123', { plan: 'premium' });   // 벤더 전체에 동일 ID
```
- 브릿지가 켜진 SDK 전부(현재 AppsFlyer `logEvent`)로 분배. 나중에 분석/CRM 벤더를 켜면
  **같은 `track` 호출이 자동으로 그쪽에도 흘러간다** — 앱 코드 수정 불필요.
- 앱 아님(브라우저)이면 no-op. 초기화 전 호출은 큐잉됐다가 init 후 전송.

### (C) 자동화 극대화 팁
1. **공통 이벤트 이름을 표준화**하라(예: `screen_view`, `content_open`, `purchase`, `sign_up`).
   앱마다 다른 이름을 쓰면 대시보드에서 비교가 안 된다. 팀 공용 상수 파일로 관리 권장.
2. **동선은 (A) 자동수집에 맡기고**, 앱별로는 "전환 지점"(결제/가입/핵심행동)만 (B)로 명시.
3. 새 벤더(분석/CRM)는 아래 4절 절차로 한 번 배선하면, 기존 앱들의 `track` 이 그대로 재사용된다.

> 한 줄 요약: **동선(화면 흐름)은 브릿지가 자동, 전환 이벤트만 앱이 `track` 한 줄.
> 벤더 추가/교체는 하네스에서 1회, 앱 코드는 그대로.**

---

## 4. 새 벤더 배선 추가 절차 (분석/CRM 확정 시)

1. `scripts/lib/config.mjs` 의 `WIRED_PROVIDERS[<카테고리>]` 에 벤더 추가.
2. `scripts/generate-app.mjs` 의 `MARKETING_PLUGINS[<카테고리>][<벤더>]` 에 npm 패키지 추가.
   필요 시 `bakedConfig()` 에 그 벤더의 키 환경변수 주입 로직 추가.
3. `template/bridge/dist/index.js`:
   - `initMarketing()` 에 벤더 분기(동적 import + init) 추가 후 `this._providers.<벤더> = <handle>` 저장.
   - `track()`/`setUser()` 에 그 핸들로 보내는 한 줄 추가(AppsFlyer 패턴 그대로).
   - → 이것만 하면 기존 앱들의 `AppBridge.track(...)` 이 새 벤더로도 자동 분배된다(앱 코드 무수정).
4. 키는 환경변수로만. `bakedConfig()` 에서 네이티브 베이크 config 에만 넣는다.

> ⚠️ Firebase Dynamic Links 는 2025-08-25 종료. 디퍼드 딥링크는 AppsFlyer/Branch 등으로.
> 분석에서 "firebase" 는 Firebase **Analytics(GA4)** 를 의미하며 FDL 과 무관.
