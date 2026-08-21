---
doc: 15
title: APP-GROWTH-FEATURES — ATT 동의 · 강제 업데이트 · 딥링크/디퍼드 딥링크
category: 기능연동
audience: 개발자
status: active
updated: 2026-08-20
---

# APP-GROWTH-FEATURES — ATT 동의 · 강제 업데이트 · 딥링크/디퍼드 딥링크

> aipia 앱들이 **설치 이후 성장(리텐션·어트리뷰션·운영 안정성)** 을 위해 공통으로 필요로 하는 3개 기능을
> app-harness 에 범용으로 심고, 웹(character-chatbot-web)에는 그 기능이 실제로 보이는 UI/설정을 붙이기 위한 설계 문서.
> **1차 목표** = characterchat 에 실제로 붙인다. **2차 목표** = 하네스로 찍는 모든 신규 앱이 config 값만 채우면 동작한다.
>
> 이 문서는 **설계·조사 결과**다. 2026-08-14 기준 **코드는 아직 한 줄도 안 바뀌었다.**
> **신규 앱에 ATT 를 붙이는 방법은 [14-ATT-INTEGRATION.md](./14-ATT-INTEGRATION.md) 참조**(연동 가이드).
> 웹 측 상세는 [character-chatbot-web `docs/native/growth-features-web.md`](../../character-chatbot-web/docs/native/growth-features-web.md) 참조.
>
> **2026-08-14 — DECISION 6건 모두 확정됐다.** 결정 내용과 그에 따라 늘어난 작업은 §3 참조.
> 요지: ATT 폴백 게이트 O · 사전화면은 온보딩 후 · 버전소스는 **Firebase Remote Config(+URL 폴백)** ·
> 어트리뷰션은 **AppsFlyer + Adbrix 둘 다** · fail-open 유지 · poptale 결함은 6-A/B/C 전부 실행.

기호: ✅ 완료 / 🚧 진행중 / ⬜ 미착수 / ⛔ 차단됨

---

## 0. 3분 요약 (처음 보는 사람용)

- app-harness 는 **Capacitor 기반 WebView 셸**이다. (poptale 은 Flutter — 코드를 그대로 못 옮긴다. **개념만 벤치마킹**한다.)
- 놀랍게도 **3개 기능의 네이티브 배관은 하네스에 이미 다 있다.** `template/bridge/dist/index.js` 에
  `requestTracking()` · `checkForceUpdate()` · `onDeepLink()` 가 구현되어 있고 config 토글로 켜진다.
- **진짜 빠져 있는 건 3가지다:**
  1. ATT — 시스템 팝업 앞에 붙일 **사전 설명(pre-permission) 화면**이 없다. 지금은 앱 켜자마자 설명 없이 시스템 팝업이 뜬다(동의율↓, 재요청 불가).
  2. 강제 업데이트 — 게이트 코드는 있는데 **버전 정보를 내려줄 곳이 없다.** config 도 `forceUpdate: false`.
     → 결정: **Firebase Remote Config 를 1차 소스로 신규 배선**하고, RC 를 못 쓰는 앱·상황은 `minVersionUrl` JSON 으로 폴백 (DECISION #3).
  3. 딥링크 — 앱 쪽 배선은 되어 있는데 **웹에 `apple-app-site-association` / `assetlinks.json` 파일이 없다.** → Universal Link / App Link 가 물리적으로 동작 불가.
- 그리고 characterchat 두 앱 모두 `marketing.attribution.provider: null` 이라 **ATT 플러그인 자체가 앱에 설치조차 안 된다.**
- 어트리뷰션은 **AppsFlyer + Adbrix 병행**으로 결정됐다(DECISION #4). AppsFlyer 는 이미 자동 배선돼 있고,
  **Adbrix 는 하네스 배선을 처음부터 만들어야 한다** — 이게 이번 작업에서 가장 무거운 항목이다.

---

## 1. 상태 대시보드

| # | 기능 | app-harness (앱) | character-chatbot-web (웹) | 외부 셋업 | 종합 |
|---|---|---|---|---|---|
| A | ATT 사전 동의 유도 | ✅ 네이티브 호출(`requestTracking`)<br>⬜ `trackingStatus()` 신설<br>⬜ 멱등 가드(6-B)<br>⬜ 문구 config 화 + 필수 검증(6-C)<br>⬜ 폴백 게이트(#1) | ⬜ 사전 설명 화면 UI<br>🚧 호출은 있으나 무설명 즉시 호출 → 분리 필요 | ⬜ App Store 개인정보 라벨<br>⬜ 개인정보처리방침 문구<br>⬜ 문구 법무 검토 | 🚧 |
| B | 강제 업데이트 | ✅ 게이트 로직 + 전체화면 오버레이<br>⬜ **Firebase RC 신규 배선**<br>⬜ config 켜기 | ⬜ 폴백 JSON 서빙(선택) | ⬜ Firebase 콘솔 RC 파라미터<br>⬜ 스토어 URL 확정 | 🚧 |
| C | 딥링크 / 디퍼드 딥링크 | ✅ `appUrlOpen`+`getLaunchUrl`<br>✅ AppsFlyer 디퍼드 배선<br>⬜ **Adbrix 배선 신규**(SPEC §6 6단계)<br>⬜ 우회 #1·#3 반영 | ✅ `onDeepLink`→`router.push`<br>⛔ **AASA/assetlinks 없음**<br>⬜ 설치 유도/UTM | ⬜ AppsFlyer + DFINERY **양쪽** 계약·키<br>⛔ Team ID·SHA256 확보 | ⛔ |

**한 줄 결론:** A 는 UI + 하네스 소폭 보강. B 는 **Firebase RC 배선이 새 작업**으로 추가됐다.
C 는 **AASA/assetlinks 파일과 Team ID·SHA256 지문**이 여전히 하드 블로커이고, Adbrix 병행 결정으로 앱 측 작업이 크게 늘었다.

---

## 2. 벤치마킹 소스 — 어디를 봤나

| 레포 | 성격 | 이 문서에서 참고한 부분 |
|---|---|---|
| `poptale-app` | Flutter 네이티브 앱 | ATT·Adbrix·강제업데이트·딥링크 실구현 + **우회 코드** |
| `poptale-frontend` | Next.js 웹 (WebView 안에 뜸) | 업데이트 모달, 설치 배너, UTM, `/download`, tracking 어댑터 추상화, `.well-known` |
| `app-harness` | Capacitor 셸 생성기 | 현재 브릿지 구현·config 스키마·generate-app 자동 주입 |
| `character-chatbot-web` | Next.js 웹 (적용 대상) | `src/lib/harness/*`, `docs/27-*` |

> ⚠️ poptale-app / poptale-frontend 는 **읽기 전용**으로만 접근했다. 두 레포는 이번 작업에서 수정하지 않는다.
> (두 레포의 `.claude/worktrees/` 하위에 옛 사본이 있는데, 본류 경로만 인용했다.)

---

## A. ATT(앱 추적 투명성) 사전 동의 유도

### A-1. 벤치마킹 분석 — poptale 은 이렇게 되어 있다

`poptale-app/lib/my_app.dart:54-82`

```dart
Future<void> _initAdbrixWithATT() async {
  if (Platform.isIOS) { await _requestATTAndNotifyAdbrix(); }
  await _initAdbrix();
}
// 1.5초 대기 → requestTrackingAuthorization() → Adbrix.attAuthorized() → 3초 대기 → SDK init
```

| 항목 | poptale 실제 구현 | 근거 |
|---|---|---|
| 요청 시점 | 앱 부팅 직후, **1.5초 딜레이만** 주고 시스템 팝업 | `my_app.dart:66-70` |
| 사전 설명 화면 | **없음** | 코드 전체에 ATT 관련 위젯 없음 |
| 상태 저장 | 안 함 (OS 가 보관하는 `trackingAuthorizationStatus` 만 조회) | `my_app.dart:63` |
| 재요청 | 불가 (iOS 는 `notDetermined` 일 때만 팝업 — OS 제약) | `my_app.dart:66` |
| Info.plist 문구 | `"이 앱은 앱 오류 분석을 위해 추적 권한을 요청합니다."` | `ios/Runner/Info.plist:110` |
| Android | 대응 없음 (GAID 는 별도 처리 안 함) | — |
| 웹뷰 공유 | 없음 (웹은 ATT 상태를 모른다) | — |

**🔴 poptale 에서 발견한 결함 2개 (계승 금지):**

1. **ATT 이중 요청 레이스.** `main.dart:149` 가 `Permission.appTrackingTransparency.request()`(permission_handler)를
   **await 없이** 부르고, 그 뒤 `my_app.dart:69` 가 `AppTrackingTransparency.requestTrackingAuthorization()` 을 또 부른다.
   먼저 뜬 팝업의 응답이 두 번째 호출의 `notDetermined` 판정을 흔들 수 있어, `Adbrix.attAuthorized()` 에
   **잘못된 값이 전달될 수 있다.**
2. **Info.plist 문구가 실제 용도와 다르다.** 실제 용도는 Adbrix 광고 어트리뷰션인데 문구는 "앱 오류 분석"이라고 적혀 있다.
   → Apple 심사 리스크 + 국내 개인정보보호법상 **목적 명시 위반 소지**.

첨부 스크린샷의 사전 화면(캐릭터 일러스트 + "다음으로")은 **poptale 이 아니라 zeta(타사 앱)** 사례다.
즉 우리에겐 **참고할 사내 구현이 없고, 새로 만들어야 한다.**

### A-2. 사전 법률 검토 결과 (2026-08-06 완료 — 설계 제약으로 확정)

| 구분 | 항목 | 판정 |
|---|---|---|
| ✅ 안전 | 사전 설명(pre-permission) 화면을 두는 것 자체 | Apple 도 교육용 사전 화면은 허용 |
| ✅ 안전 | "거부해도 서비스를 무료로 이용할 수 있다" 고지 | 5.1.2(i) 준수 근거 |
| ✅ 안전 | "설정에서 언제든 변경 가능" 안내 | 이용자 통제권 제공 |
| ✅ 안전 | 최종 동의는 Apple 시스템 다이얼로그에서 수령 | — |
| 🔴 위험 | **"추적 허용 → 불필요한 광고 감소"** 헤드라인 | **사실과 다름.** ATT 는 광고 *관련성* 만 바꾸고 *노출량* 은 안 줄인다 → 기만 표시 |
| 🔴 위험 | **허용만 강조하는 단일 CTA** (캐릭터가 "눌러줘!") | Apple 5.1.2(i) 리젝 + 국내 다크패턴 규제 리스크 |
| 🔴 위험 | ATT 를 **마케팅 수신 동의처럼** 보이게 하는 표현 | 정보통신망법 §50 옵트인과 **완전 별개** — 포괄동의 오인 |
| 🔴 위험 | ATT 를 기능·보상의 조건으로 사용 | 절대 금지. 거부해도 100% 동일 기능 |

> 이 검토는 일반 정보이며 법률 자문이 아니다. **실제 출시 전 법무 검토 권장.**

### A-3. 우리 설계 — 앱/웹 경계 판정

| 레이어 | 담당 | 근거 |
|---|---|---|
| iOS 시스템 ATT 팝업 호출 | **app-harness** | 네이티브 API. `AppBridge.requestTracking()` 로 이미 존재 (`dist/index.js:876-889`) |
| `NSUserTrackingUsageDescription` 주입 | **app-harness** | `generate-app.mjs:432` 에서 이미 자동 주입 |
| **사전 설명 화면 UI** | **character-chatbot-web** | 하네스는 WebView 셸이라 화면이 곧 웹이다. 서비스별 톤·일러스트·다국어가 다르므로 웹이 그리는 게 맞다 |
| 사전 화면 **노출 정책**(1회성, 타이밍) | **web** | 라우팅·온보딩 흐름을 아는 쪽이 웹 |
| 사전 화면 **폴백 게이트** | **app-harness** | ✅ DECISION #1 = **폴백 병행 확정.** 웹이 화면을 안 만든 신규 앱도 준수 화면을 얻는다 |

**호출 순서 (확정)** — DECISION #2 = **온보딩 완료 후**

```
앱 부팅 → 온보딩 완료 → [iOS + notDetermined + 미노출] 일 때만 사전 설명 화면
   → 사용자가 "계속" 탭 → AppBridge.requestTracking() → iOS 시스템 다이얼로그
   → 결과와 무관하게 다음 화면 → AppBridge.initMarketing()
```

**폴백 게이트 동작 규약 (DECISION #1 상세)**

| 조건 | 동작 |
|---|---|
| `tracking.att.prePermission: true` (기본) | 웹이 화면을 그린다. 하네스는 **아무것도 띄우지 않는다** |
| `tracking.att.prePermission: false` | 하네스가 `_showUpdateGate()` 와 같은 방식의 **기본 사전 화면 오버레이**를 띄우고, 그 화면의 "계속"에서 `requestTracking()` 호출 |
| iOS 아님 / 이미 응답함 | 양쪽 모두 아무것도 안 함 |

폴백 게이트는 `_showUpdateGate()` 를 그대로 참고해 만든다(테마색 반영, `config.theme` 사용, DOM 주입 방식).
문구는 A-2 의 법률 제약을 만족하는 **중립·사실 기반 기본값**으로 하드코딩하되, `tracking.att.copy` 로 덮어쓸 수 있게 한다.

⚠️ 현재 `character-chatbot-web/src/lib/harness/adapter.ts:25` 는 `initHarness()` 안에서
`requestTracking()` 을 **아무 설명 없이 즉시** 호출한다. 이걸 **분리**하는 게 A 작업의 핵심이다.
(iOS 는 `notDetermined` 일 때만 팝업을 띄우므로, 설명 없이 한 번 태우면 **그 유저는 영영 재요청 불가**다.)

### A-4. 범용화 설계 — 신규 앱이 채울 값

`app.config.json` 에 블록 신설 제안:

```jsonc
"tracking": {
  "att": {
    "enabled": true,
    "usageDescription": "맞춤형 콘텐츠와 광고를 제공하기 위해 활동 데이터를 사용합니다.",  // 필수 (6-C)
    "prePermission": true,         // 웹이 사전 화면을 그린다는 선언(폴백 게이트 비활성)
    "copy": {                      // prePermission:false 일 때 폴백 게이트 문구 오버라이드
      "title": "…", "body": "…", "allowLabel": "계속", "denyLabel": "나중에", "notice": "…"
    }
  }
}
```

| 키 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `tracking.att.enabled` | bool | `false` | ATT 플러그인 설치 + Info.plist 문구 주입 여부 |
| `tracking.att.usageDescription` | string | **없음 — 필수** | `enabled: true` 면 반드시 채운다. 미기입 시 `generate-app` 이 실패 (6-C) |
| `tracking.att.prePermission` | bool | `true` | `false` 면 브릿지가 기본 폴백 게이트를 띄운다 (DECISION #1) |
| `tracking.att.copy` | object | 하네스 기본 문구 | 폴백 게이트 문구. `prePermission: true` 면 무시 |

**6-C — `usageDescription` 필수화 근거:** poptale 은 실제 용도가 Adbrix 광고 어트리뷰션인데
Info.plist 문구가 `"이 앱은 앱 오류 분석을 위해 추적 권한을 요청합니다."` 로 남아 있다(`ios/Runner/Info.plist:110`).
하네스도 지금 `generate-app.mjs:432` 에 기본 문구를 하드코딩해 두었는데, 그대로 방치되면 같은 문제가 재발한다.
→ **기본값을 제공하지 않고 config 필수값으로 만든다.** 없으면 빌드를 세운다(경고가 아니라 실패 — 경고는 무시된다).

> 현재는 `marketing.attribution.provider` 가 설정돼야만 ATT 플러그인이 깔린다(`generate-app.mjs:301`).
> 이 결합을 끊어 **ATT 를 독립 토글**로 만드는 게 범용화의 핵심.

### A-5. 구현 체크리스트

**app-harness** — ✅ 2026-08-14 구현 완료 (문서 갱신 제외)
- ✅ `app.config.json` 스키마에 `tracking.att` 블록 추가 — `config.mjs` `DEFAULT_TRACKING` + 검증 + **`runtimeConfig()` 에 `tracking` 추가**
  - ⚠️ 설계 시 놓쳤던 것: `runtimeConfig()` 는 화이트리스트라 여기 안 넣으면 브릿지가 config 를 영원히 못 읽는다
- ✅ `generate-app.mjs` — ATT 플러그인 설치 조건을 `attEnabled(cfg)` 로 분리 (`tracking.att.enabled` 우선, 어트리뷰션 벤더는 하위호환)
- ✅ `generate-app.mjs` — `NSUserTrackingUsageDescription` 하드코딩 제거 → config 값 주입 + **미기입 시 실패** (6-C)
- ✅ `AppBridge.trackingStatus()` 신설 — 팝업 없이 상태만 조회
- ✅ **`requestTracking()` 멱등화 (6-B)** — 캐시 + in-flight Promise 공유. 동시 3회 호출 → 시스템 팝업 1회 검증됨
- ✅ 반환에 `authorized` 불리언 추가 (`{status}` 소비 코드 하위호환)
- ✅ **폴백 사전 게이트 (DECISION #1)** — `_maybeShowAttGate()` / `_showAttGate()`. `prePermission: false` 일 때만. 다크 배경 자동 대비 포함
- ✅ `capabilities.att` (`auth`/`iap` 선례대로 `ready()` 에서 채움) + `CAP_METHOD.att` + `index.d.ts` 타입
- ✅ **`openAppSettings()` 추가 (브릿지 1.4.0)** — 거부한 유저를 OS 설정으로 보내는 유일한 경로.
  iOS `UIApplication.openSettingsURLString` / Android `ACTION_APPLICATION_DETAILS_SETTINGS`.
  하위 화면(설정 > 개인정보 보호 > 추적) 직행은 비공개 API 라 심사 리젝 → 앱 설정 페이지까지만 간다
- ✅ **[14-ATT-INTEGRATION.md](./14-ATT-INTEGRATION.md) 신설** — 신규 앱용 연동 가이드(셋업·순서·법적 제약·함정)
- ⬜ `13-MARKETING.md` / `17-DATA-COLLECTION.md` 갱신

**검증 결과 (2026-08-14)**

| 항목 | 결과 |
|---|---|
| `tracking.att` 로드·정규화 (dev/prod 양쪽) | ✅ |
| `usageDescription` 없이 `enabled:true` → **빌드 실패** | ✅ (6-C) |
| iOS 동시 3회 `requestTracking()` → 시스템 팝업 **1회** | ✅ (6-B, poptale 레이스 차단) |
| 응답 후 재호출 → 캐시 반환, 팝업 0회 | ✅ |
| `trackingStatus()` 는 팝업을 띄우지 않음 | ✅ |
| Android → `capabilities.att=false`, `not-applicable`, 플러그인 호출 0회 | ✅ |
| `prePermission:true` → 폴백 게이트 미생성(웹 화면과 중복 없음) | ✅ |
| `prePermission:false` → 게이트 생성 + 법률 제약 8개 항목 충족 | ✅ |
| `generate-app --slug characterchat-dev` → Info.plist 에 **config 문구** 주입 | ✅ |
| 네이티브 `app-config.json` 에 `tracking` 블록 전달 | ✅ |

> ⚠️ `generate-app` 은 마지막 `npx cap sync` 에서 실패한다 — **이 머신의 Node 가 v20.18.3 인데 Capacitor CLI 가 ≥22 를 요구**하는 환경 문제로, 이번 변경과 무관하다. Info.plist·app-config.json 주입은 그 이전 단계라 정상 완료됐다.
> 테스트 스크립트는 세션 스크래치패드(`attTest/run*.mjs`)에 있다 — 브릿지 dist 를 복사해 `@capacitor/core` 와 ATT 플러그인을 목으로 갈아끼워 **실제 브릿지 코드**를 돌린 것이다.

**6-B — 멱등 가드 상세 (poptale 결함 재발 방지)**

poptale 의 결함은 "두 군데서 ATT 를 요청한다"는 호출부 실수였다. 호출부 규율로 막는 건 반복 실패하므로,
**브릿지 API 자체가 여러 번 불려도 안전하도록** 만든다.

```
requestTracking()
  ├ iOS 아님              → { status:'not-applicable' } (즉시)
  ├ 이미 응답 완료         → 캐시된 status 반환 (시스템 팝업 호출 안 함)
  ├ 요청 진행 중           → 진행 중인 동일 Promise 반환 (중복 팝업 불가)
  └ notDetermined + 첫 호출 → 실제 requestPermission() → 결과 캐시
```

이러면 웹이 실수로 `initHarness()` 와 사전 화면에서 둘 다 불러도 팝업은 한 번만 뜬다.

**character-chatbot-web** → 웹 문서 참조

### A-6. 외부 셋업 체크리스트

| 항목 | 담당 | 선행조건 | 완료 판정 |
|---|---|---|---|
| ⬜ App Store Connect 개인정보 라벨에 "추적" 선언 | 앱 배포 담당 | 어트리뷰션 벤더 확정 | 스토어 제출 시 경고 없음 |
| ⬜ Google Play 데이터 안전성 양식 갱신 | 앱 배포 담당 | 동일 | Play Console 저장 완료 |
| ⬜ 개인정보처리방침에 광고 식별자 수집·목적·제3자 제공 명시 | 법무/기획 | 벤더 확정 | 방침 URL 반영 |
| ⬜ 사전 화면 문구 법무 검토 | 법무 | 문구 초안 | 서면 확인 |

### A-7. 테스트 방법

```bash
# 1) config 켜고 앱 셸 재생성
cd ~/Documents/app-harness
node scripts/generate-app.mjs --slug characterchat-dev

# 2) Info.plist 에 문구가 실제로 들어갔는지 확인 (없으면 iOS 가 팝업을 아예 안 띄운다)
grep -A1 NSUserTrackingUsageDescription build/characterchat-dev/ios/App/App/Info.plist
```

- ⚠️ **ATT 팝업은 iOS 시뮬레이터에서 불안정하다. 반드시 실기기.** (`docs/27-*` 에도 동일 기록)
- 재테스트: 설정 > 일반 > 앱 > 삭제 후 재설치 (한 번 응답하면 `notDetermined` 로 못 돌아온다)
- 기기 전역 `설정 > 개인정보 보호 및 보안 > 추적 > 앱이 추적을 요청하도록 허용` 이 꺼져 있으면 팝업이 안 뜨고 즉시 `denied` — 오판 주의
- 검증 항목: 거부해도 전 기능 동작 / 거부 CTA 가 허용과 시각적으로 동등 / 재실행 시 사전 화면 재노출 안 됨

### A-8. 리스크 & 미해결

- 사전 화면을 **너무 이르게**(첫 진입 즉시) 띄우면 이탈, **너무 늦게** 띄우면 어트리뷰션 유실 → 노출 시점은 DECISION #2
- 하단 고지 문구가 스크린샷처럼 작으면 그 자체가 "정보 비대칭 다크패턴" 소지 → 가독 크기 확보 필요
- Android 는 ATT 개념이 없다. `not-applicable` 로 no-op — 사전 화면도 **iOS 에서만** 띄워야 한다

---

## B. 앱 강제 업데이트

### B-1. 벤치마킹 분석 — poptale 은 이렇게 되어 있다

poptale 은 **"강제" 업데이트가 사실상 없다.** 두 갈래로 나뉘어 있다.

| 갈래 | 위치 | 동작 |
|---|---|---|
| ① 설정 화면 배지 | `poptale-app/lib/presentation/view/screen/setting/s_setting.dart:101` | 설정 > 버전 항목에 "업데이트" 버튼만 노출. **차단 없음** |
| ② 웹 모달 | `poptale-frontend/src/components/molecules/common/AppUpdateModal.tsx` | **특정 빌드번호와 정확히 일치**하는 유저에게만 모달. 닫기 버튼 없음 |

버전 비교 로직 — `poptale-app/lib/common/util/check_appversion/check_appversion.dart`:
```dart
static bool isLatest(int? storeBuildNo) {
  // 스토어 버전이 null 이거나 기기 버전 파싱 실패면 "최신"으로 간주(= 업데이트 유도 안 함)
  return deviceBuildNo >= storeBuildNo;
}
```

버전 정보 소스 — `poptale-app/lib/data/usecaseimpl/app_update_usecaseimpl.dart:28-38`:
- **Android**: `in_app_update` 패키지 → Google Play 가 알려주는 `availableVersionCode`
- **iOS**: 자체 API `{apiUrl}/users/apple/app/version` (`remote_dt.dart:18-19`)
- **dev flavor**: 무조건 `현재빌드+10` 을 반환해 버튼 강제 노출 (테스트용)

**🔴 poptale-frontend 의 `AppUpdateModal` 은 임시방편이다:**
```ts
const TARGET_BUILD = Number(process.env.NEXT_PUBLIC_APP_UPDATE_TARGET_BUILD ?? 0)
setIsVisible(appBuild === TARGET_BUILD)   // "미만"이 아니라 "정확히 일치"
```
문제 빌드 하나를 찍어서 웹 배포로 밀어내는 **핫픽스 도구**이지 버전 정책이 아니다. → **계승하지 않는다.**

**Firebase Remote Config 관련:** poptale 은 RC 를 쓰지만 **버전 체크에는 안 쓴다.**
`poptale-app/lib/config/config.dart:150-175` 의 RC 키는 `baseUrl`/`baseApiUrl`/OAuth clientId/`param01~03` 뿐이다.

### B-2. 우리 설계 — 앱/웹 경계 판정

**전부 app-harness. 웹 코드는 원칙적으로 0줄.** 브릿지가 `ready()` 시 자동 실행하고 자체 오버레이를 그린다.

이미 구현된 것 (`template/bridge/dist/index.js`):

| 기능 | 위치 | 상태 |
|---|---|---|
| 자동 실행 | `:124-126` `_autoInit()` — `capabilities.forceUpdate` 면 자동 호출 | ✅ |
| 버전 비교 | `:306-336` `checkForceUpdate()` — 플랫폼별 노드 우선, 최상위 폴백 | ✅ |
| 네트워크 실패 시 | `:317-320` **통과시킨다**(사용자를 막지 않음) | ✅ 안전한 기본값 |
| 전체화면 게이트 | `:345-386` `_showUpdateGate()` — 테마색 반영, `force:false` 면 "나중에" | ✅ |
| 스토어 URL 폴백 | `:339-344` appId 로 Play/App Store URL 조립 | ✅ |

minVersion JSON 스키마 (`02-GUIDE.md:252-260`):
```jsonc
{
  "ios":     { "minVersionCode": 5, "storeUrl": "https://apps.apple.com/app/idXXXX", "message": "...", "force": true },
  "android": { "minVersionCode": 7, "storeUrl": "https://play.google.com/store/apps/details?id=..." },
  "storeUrl": "...", "message": "..."
}
```

**즉 코드는 완성돼 있고, 막힌 건 `minVersionUrl` 이 가리킬 대상이 없다는 것 하나다.**

### B-3. ✅ 버전 정보 소스 = Firebase Remote Config (DECISION #3 확정)

**결정: Firebase Remote Config 를 1차 소스로 쓴다. `minVersionUrl` JSON 은 폴백으로 남긴다.**

조사 시점의 사실: **하네스에는 Remote Config 를 읽는 코드가 전혀 없다**
(`grep -n "remoteConfig" template/bridge/dist/index.js` → 0건).
`app.config.json` 의 `firebase.remoteConfig` 플래그는 `02-GUIDE.md` 에 선언만 있고 브릿지가 소비하지 않는다.
따라서 **RC 배선은 이번 작업의 신규 개발 항목**이다.

**왜 폴백을 함께 두는가 (설계 보완)**
1. **2차 목표 보호** — RC 만 지원하면 "강제 업데이트를 쓰려면 Firebase 를 붙여야 하는" 구조가 된다.
   Firebase 를 안 쓰는 신규 앱이 강제 업데이트를 못 쓰게 되므로, URL 폴백을 남겨 하네스 범용성을 유지한다.
2. **fail-open 과의 상호작용** — DECISION #5 에서 fail-open 을 유지하기로 했다. RC fetch 실패·캐시 지연 구간이
   그대로 "게이트 없음"이 되므로, URL 폴백이 있으면 그 구멍이 좁아진다.

**해석 우선순위 (브릿지 구현 규약)**

```
checkForceUpdate()
  ├ 1순위: Firebase Remote Config 의 min_version_code (RC 사용 가능 + 값 존재)
  ├ 2순위: features.forceUpdate.minVersionUrl 의 JSON  (RC 불가/값 없음)
  └ 둘 다 실패 → { required:false }  ← fail-open (DECISION #5)
```

**⚠️ RC 채택 시 반드시 알고 있어야 할 3가지**

| # | 사항 | 대응 |
|---|---|---|
| 1 | **캐시 지연.** RC 는 `minimumFetchInterval` 동안 서버를 다시 찌르지 않는다. poptale 은 prod 12시간(`config.dart:145`). 콘솔에서 눌러도 사용자 반영이 최대 그만큼 늦는다 | 강제 업데이트는 긴급성이 있으므로 **prod 1시간 / debug 0** 을 기본값으로 두고 `firebase.remoteConfig.fetchIntervalSeconds` 로 앱별 조정 가능하게 한다 |
| 2 | **Firebase 파일 필수.** iOS `GoogleService-Info.plist`, Android `google-services.json` 이 있어야 RC 가 동작 | characterchat-dev 는 이미 `firebase.enabled: true` (FCM, 프로젝트 `poptale-chat`) — **프로젝트를 새로 만들 필요는 없다.** characterchat(prod)은 `firebase` 블록 자체가 없어 신규 설정 필요 |
| 3 | **앱 재빌드 필요.** 플러그인이 추가되므로 config 만 바꿔서는 안 되고 iOS/Android 재빌드가 있어야 한다 | 첫 배선 시 1회. 이후 값 변경은 재빌드 불필요(그게 RC 의 목적) |

**RC 파라미터 규약 (Firebase 콘솔에 만들 키)**

| 키 | 타입 | 예시 | 비고 |
|---|---|---|---|
| `min_version_code_ios` | Number | `11` | iOS 최소 허용 `version.code` |
| `min_version_code_android` | Number | `11` | Android 최소 허용 `version.code` |
| `force_update_message` | String | `원활한 이용을 위해…` | 게이트 본문 |
| `force_update_hard` | Boolean | `true` | `false` 면 "나중에"로 닫히는 소프트 권유 |
| `store_url_ios` / `store_url_android` | String | 스토어 URL | 미설정 시 `appId` 기반 폴백 사용 |

> 플랫폼별 키를 나눈 이유: RC 의 "조건(condition)" 기능으로도 플랫폼 분기가 가능하지만,
> 키를 나누면 콘솔에서 값이 눈에 보여 운영 실수가 줄고 브릿지 로직도 단순해진다.

### B-4. 범용화 설계 — 신규 앱이 채울 값

```jsonc
"features": {
  "forceUpdate": {
    "enabled": true,
    "source": "remoteConfig",                                    // "remoteConfig" | "url" (기본 "url")
    "minVersionUrl": "https://<서비스도메인>/app-version.json"    // 폴백 (source 무관하게 권장)
  }
},
"firebase": {
  "enabled": true,
  "remoteConfig": true,                    // ← 브릿지가 이 플래그를 실제로 소비하게 만든다(현재는 미소비)
  "remoteConfigFetchIntervalSeconds": 3600,
  "project": { "dev": "poptale-chat", "prod": "<prod 프로젝트>" }
}
```

| 키 | 타입 | 설명 |
|---|---|---|
| `features.forceUpdate.enabled` | bool | 게이트 활성 |
| `features.forceUpdate.source` | `"remoteConfig"` \| `"url"` | 1차 소스 선택. 기본 `"url"` (Firebase 없는 앱 기본 동작 보존) |
| `features.forceUpdate.minVersionUrl` | string(URL) | 폴백 JSON 주소. `source: "remoteConfig"` 일 때도 채워두는 걸 권장 |
| `firebase.remoteConfig` | bool | RC 플러그인 설치 + 초기화 |
| `firebase.remoteConfigFetchIntervalSeconds` | int | 기본 3600. debug 빌드는 0으로 강제 |
| `version.code` | int | RC/JSON 의 `minVersionCode` 와 비교. **단조 증가 필수** |

신규 앱이 해야 할 일:
- **Firebase 쓰는 앱** → `firebase.remoteConfig: true` + `forceUpdate.source: "remoteConfig"` + 콘솔에 키 5개
- **Firebase 안 쓰는 앱** → `forceUpdate.enabled: true` + `minVersionUrl` 하나 (기존 방식 그대로 동작)

### B-5. 구현 체크리스트

**app-harness — Firebase Remote Config 신규 배선 (이번 작업의 핵심)**
- ⬜ RC Capacitor 플러그인 선정 및 추가 (`@capacitor-firebase/remote-config` 유력 — FCM 과 같은 계열이라 버전 정합성 유리)
- ⬜ `scripts/generate-app.mjs` — `firebase.remoteConfig: true` 면 플러그인 설치 목록에 추가
- ⬜ `template/bridge/dist/index.js` — `_initRemoteConfig()` 신설: `fetchAndActivate()` + `minimumFetchInterval` 적용(debug=0)
- ⬜ `checkForceUpdate()` 를 **RC 1순위 → URL 폴백 → fail-open** 순서로 재작성 (B-3 의 우선순위 규약)
- ⬜ `AppBridge.getRemoteConfig(key)` 범용 메서드도 함께 노출 (RC 를 강제업데이트 전용으로 묶지 않는다 — 다른 앱이 A/B·기능 토글에 쓸 수 있게)
- ⬜ `app.config.json` 스키마에 `features.forceUpdate.source`, `firebase.remoteConfig*` 추가 + `scripts/lib/config.mjs` 검증
- ⬜ `source: "remoteConfig"` 인데 `firebase.remoteConfig` 가 false 면 **generate-app 이 실패** (반쪽 설정 방지)

**app-harness — config 적용**
- ⬜ `apps/characterchat-dev/app.config.json` → `features.forceUpdate: { enabled: true, source: "remoteConfig", minVersionUrl: "..." }` + `firebase.remoteConfig: true`
- ⬜ `apps/characterchat/app.config.json` → 동일. ⚠️ **prod 는 `firebase` 블록이 아예 없다** — Firebase 프로젝트 신규 설정 선행 필요
- ⬜ `_showUpdateGate()` 문구/디자인이 서비스 테마와 어울리는지 확인 (현재 하드코딩된 회색 계열 `#202124`/`#5f6368` — **다크 테마 앱(characterchat 은 배경 `#000000`)에서 대비 확인 필수**)
- ⬜ `02-GUIDE.md` §6 forceUpdate 설명 갱신 + RC 키 표 추가

**character-chatbot-web (폴백 JSON)**
- ⬜ `app/app-version.json/route.ts` 생성 (`Cache-Control: no-store`) — RC 실패 구간의 안전망
- ⬜ 값 갱신 절차 문서화 (릴리스 시 누가 언제 올리나)

### B-6. 외부 셋업 체크리스트

| 항목 | 담당 | 선행조건 | 완료 판정 |
|---|---|---|---|
| ✅ 버전 정보 소스 결정 | 기획/개발 리드 | — | **2026-08-14 Firebase RC 확정** |
| ⬜ **prod Firebase 프로젝트 확정** | 개발 | — | `apps/characterchat/app.config.json` 에 `firebase.project.prod` 기입 가능 |
| ⬜ Firebase 콘솔에 RC 파라미터 5개 생성 (dev/prod 각각) | 개발 | Firebase 프로젝트 | 콘솔에 키 존재 + 기본값 게시 |
| ⬜ `GoogleService-Info.plist` / `google-services.json` 배치 확인 | 개발 | Firebase 프로젝트 | 빌드 시 secrets 에서 주입됨 |
| ⬜ RC 값 변경 권한자 지정 (누가 콘솔에서 누르나) | 운영 | 콘솔 세팅 | 런북 반영 |
| ⬜ iOS App Store 앱 ID 확보 | 앱 배포 담당 | 앱 스토어 등록 | `apps.apple.com/app/id...` URL 확보 |
| ⬜ Play Store 패키지 URL 확인 | 앱 배포 담당 | Play Console 등록 | URL 확보 |

### B-7. 테스트 방법

**RC 경로**
1. Firebase 콘솔 > Remote Config > `min_version_code_ios` 를 현재 `version.code` 보다 크게 (characterchat-dev 는 현재 **10** → 11 이상) 후 **게시**
2. 앱 강제 종료 → 재실행 → 전체화면 게이트 확인
3. ⚠️ 즉시 안 보이면 **캐시 지연**이다. debug 빌드는 `minimumFetchInterval: 0` 이어야 즉시 반영된다 — 이걸 먼저 확인할 것
4. 값을 되돌린 뒤 재실행 → 게이트 사라짐 확인

**폴백 경로**
```bash
# RC 를 끄거나(firebase.remoteConfig:false) 네트워크에서 RC 를 막고, JSON 만으로 게이트가 뜨는지
curl -s https://chat.dev.poptale.ai/app-version.json | jq
curl -sI https://chat.dev.poptale.ai/app-version.json | grep -i cache-control   # no-store 확인
```

검증 항목:
- `version.code < minVersionCode` → 전체화면 게이트, 뒤로가기/닫기 불가 (`force: true` / `force_update_hard: true`)
- soft 모드 → "나중에" 버튼으로 닫힘
- **RC 와 JSON 둘 다 실패 → 게이트 안 뜨고 정상 진입** (fail-open. 의도된 동작 — DECISION #5)
- RC 값과 JSON 값이 다를 때 **RC 가 이긴다** (우선순위 규약 검증)
- "업데이트 하기" → 올바른 스토어 앱 페이지로 이동
- 일반 브라우저(비앱)에서는 게이트가 절대 안 뜸
- 다크 테마에서 게이트 텍스트 대비 확인

### B-8. 리스크 & 미해결

- **RC 캐시 지연이 최대 리스크.** 긴급 차단이 필요한 순간에 "콘솔에서 눌렀는데 안 걸린다"가 되기 쉽다.
  → `fetchIntervalSeconds` 기본값을 1시간으로 두고, **긴급 시엔 RC 가 아니라 서버 측 API 버전 거부**를 쓰는 게 정석임을 런북에 명시
- **fail-open 유지 (DECISION #5 확정).** RC·JSON 둘 다 실패하면 게이트를 안 띄운다(`dist/index.js:317-320` 동일 정책).
  보안 패치를 강제해야 하는 상황에는 이 정책이 약하므로, 그 경우엔 BE 가 구버전 클라이언트 요청을 거부하는 방식을 병행한다
- `version.code` 단조 증가 규율이 깨지면 게이트 오작동 → CI 검증 필요
- iOS 심사 중 버전과 배포 버전이 공존하는 기간에 `minVersionCode` 를 올리면 **심사 리뷰어가 게이트에 막혀 리젝**될 수 있다 → 스토어 승인 후 올릴 것
- RC 를 강제업데이트 전용으로 만들면 나중에 재작업이 생긴다 → `getRemoteConfig(key)` 범용 메서드를 처음부터 함께 노출

---

## C. 딥링크 + 디퍼드 딥링크

### C-1. 벤치마킹 분석 — poptale 은 이렇게 되어 있다

**(1) 네이티브 설정 (poptale-app)**

| 항목 | 위치 | 값 |
|---|---|---|
| iOS URL 스킴 | `ios/Runner/Info.plist:27-38` | `poptale://` |
| iOS Universal Links | `ios/Runner/Runner-prod.entitlements` | `applinks:poptale.ai` 외 3개 |
| Android 커스텀 스킴 | `AndroidManifest.xml:69-74` | `poptale://` |
| Android App Links | `AndroidManifest.xml:104-119` | `autoVerify="true"`, 4개 호스트 |
| Flutter 기본 딥링크 | `AndroidManifest.xml:101` | `flutter_deeplinking_enabled=false` (직접 처리) |

**(2) 웹 측 검증 파일 (poptale-frontend)** — `public/.well-known/`
- `apple-app-site-association`: Team ID `3W889GYPRK` + 3개 번들ID, `paths: ["*"]`
- `assetlinks.json`: 3개 패키지 × SHA256 지문 2개(업로드키/앱서명키)

**(3) 라우팅 흐름 (poptale-app)** — `lib/common/core/app_web_communication/app_links/app_links.dart`
```
appLinks.uriLinkStream / getInitialLink()
  → 도메인 검증(isPoptaleLink)
  → 경로 화이트리스트(FcmLinkFilter.isAllowedPath)   ← 뒤로가기=종료 방어(MKT-86)
  → UTM 정규화(_normalizeForUtm)
  → 앱 상태별 분기: splash면 버퍼 / main이면 즉시 WebView load / 그 외 main 이동 후 소비
```
콜드스타트 대응: `uriLinkStream` 은 broadcast 라 늦은 구독자가 초기 URI 를 못 받는다 →
`my_app.dart:162-171` 에서 `getInitialAppLink()` 로 **직접 회수**한다.

**(4) 앱 스킴 → 웹 URL 변환** — `aw_communication_deeplink.dart`
```
poptale://deeplink/detail/{id}                → https://poptale.ai/detail/{id}      (prod 고정)
poptale://deeplink?link=detail/{id}&env=dev   → https://dev.poptale.ai/detail/{id}   (환경 지정)
```

**(5) 웹 측 설치 유도**
- `AppInstallBanner.tsx`: 모바일 웹 상단 배너. **iOS 는 App Store 직행**(커스텀 스킴은 미설치 시 에러 다이얼로그가 떠서), **Android 는 `intent://` + `S.browser_fallback_url`** 로 앱 열기 시도 후 자동 폴백
- `/download` 페이지: UA 판별 → 스토어 리다이렉트. **Android 만** Play `&referrer=` 로 UTM 전달 (iOS 는 URL 전달 수단 없음)
- `src/lib/utm.ts` + `stores/utm`: utm_source/medium/campaign/term/content 캡처

**(6) tracking 추상화 (poptale-frontend/tracking/)** ← **이게 우리가 베껴야 할 진짜 패턴**
```
tracking/index.ts        → track() 하나로 통일. Amplitude 항상 + ADBRIX_EVENTS 에 있으면 Adbrix 도
tracking/routing.ts      → 어떤 이벤트를 어느 벤더로 보낼지 Set 으로 선언
tracking/adapters/*.ts   → 벤더별 어댑터 (adbrix.ts, amplitude.ts)
```
호출부는 벤더를 모른다. **벤더 교체 = 어댑터 1개 교체.**

### C-2. 🔴 Adbrix 우회 코드 — 정체와 계승 판정

poptale 이 Adbrix 때문에 넣은 우회는 **총 5개**다.

| # | 무엇이 문제였나 | 어떻게 우회했나 | 위치 | 지금도 유효? | 계승? |
|---|---|---|---|---|---|
| 1 | **디퍼드 딥링크 수신 시 SDK 가 제멋대로 Activity 를 띄움** → 앱 자체 라우팅과 충돌 | `Adbrix.blockDeferredDeepLinkLaunch()` 를 **`init()` 이전에** 호출해 자동 실행을 막고 콜백으로만 수신 | `my_app.dart:101` | ✅ (Adbrix 사용 시) | **Adbrix 채택 시에만** |
| 2 | 디퍼드 딥링크가 **prod 도메인 고정 path** 로만 옴 → dev/stage 빌드가 prod 로 튐 | `poptale://deeplink/detail/1` → `poptale://deeplink?link=detail/1&env=dev` 로 **재작성** | `my_app.dart:134-155` | ✅ | **개념만** — 하네스는 `allowedDomains` 로 이미 환경 분리 |
| 3 | `adbrix_plugin 1.1.2` 에 **`setUserId` API 자체가 없음** | user_id 를 이벤트 프로퍼티로 주입. 단 `abx:` 표준 이벤트엔 넣으면 **수집이 실패**해서(DFINERY 확인) 제외 | `adbrix_analytics_service.dart:120-127` | ✅ | **Adbrix 채택 시에만** |
| 4 | 키가 비어도 `init()` 을 안 부르면 **Completer 가 영원히 미완료** → `logPurchase` 무한 대기 → 서버 검증 미실행 → **캔디 미지급** | 키가 비어도 `init()` 은 무조건 호출 | `my_app.dart:90-98` | ✅ | **패턴은 계승** (하네스도 `initMarketing` 실패 시 큐가 안 막히는지 확인 필요) |
| 5 | ATT 응답 전에 SDK 가 초기화되면 어트리뷰션 유실 | ATT → `attAuthorized()` → **3초 대기** → init. + `iosTrackingTimeout: 120` | `my_app.dart:77-78`, `adbrix_analytics_service.dart:26-28` | ✅ | **개념 계승** — 하네스는 AppsFlyer `waitForATTUserAuthorization: 10` 으로 이미 동등 처리 |

**판정 요약 (DECISION #4 = AppsFlyer + Adbrix 병행 확정 반영):**

| 우회 | 계승 판정 | 이유 |
|---|---|---|
| #1 `blockDeferredDeepLinkLaunch()` | **✅ 계승 확정** | Adbrix 를 쓰기로 했으므로 필수. 이걸 빼면 Adbrix 가 자체 Activity 를 띄워 하네스의 `onDeepLink` 라우팅과 충돌한다 |
| #2 env 재작성 | **불필요** | 하네스는 `navigation.allowedDomains` 로 환경이 이미 분리돼 있다 |
| #3 `setUserId` 부재 우회 | **✅ 계승 확정** | Adbrix SDK 제약이라 우리도 같은 제약을 받는다. `abx:` 표준 이벤트에 `user_id` 를 넣으면 **수집이 실패**한다는 DFINERY 확인 사항까지 그대로 반영 |
| #4 빈 키에도 init 호출 | **✅ 패턴 계승** | 벤더 무관. 하네스 `initMarketing()` 도 실패 시 `_eventQueue` 가 영구히 안 비워지는지 점검 필요 |
| #5 ATT 응답 후 init | **개념 계승 (이미 동등)** | AppsFlyer 는 `waitForATTUserAuthorization: 10` 으로 처리됨. Adbrix 어댑터에도 동일 대기를 넣어야 한다 |

**병행 결정(#4)의 파급 — 반드시 인지할 것**

1. **Adbrix 배선은 0에서 시작한다.** `template/plugins/adbrix/SPEC.md` §6 의 6단계가 전부 미착수이고,
   §9 TODO 첫 줄이 *"Adbrix Capacitor 플러그인 — 공식 없으면 자체 작성"* 이다.
   → **2026-08-14 조사 완료. 공식 Capacitor 플러그인은 없다.** 상세는 아래 C-2-1.
2. **디퍼드 딥링크는 AppsFlyer 가 단독 담당한다.** 두 SDK 가 동시에 디퍼드 링크를 라우팅하면 같은 링크로 두 번 이동한다.
   → `marketing.attribution` 에서 **Adbrix 는 `deferredDeepLink: false`** 로 고정 (SPEC.md 도 동일 권장).
3. **이벤트 중복 집계 주의.** `AppBridge.track()` 이 두 벤더로 자동 분배되므로 매출 이벤트가 양쪽에 다 잡힌다.
   poptale-frontend `tracking/routing.ts` 처럼 **"어떤 이벤트를 어느 벤더로 보낼지" 라우팅 테이블**을 하네스에도 둘지 검토 필요.
4. **계약·키가 2배.** AppsFlyer `APPSFLYER_DEV_KEY`/`APPSFLYER_IOS_APP_ID` + Adbrix `ADBRIX_APP_KEY`/`ADBRIX_SECRET_KEY` 전부 필요.
5. **provider 스키마 확장 필요.** 현재 `marketing.attribution.provider` 는 **단일 문자열**이다.
   병행하려면 배열 또는 `providers` 블록으로 스키마를 넓혀야 한다 → 아래 C-4 참조.

### C-2-1. 🔎 Adbrix Capacitor 플러그인 조사 결과 (2026-08-14)

**결론: 공식 Capacitor / Ionic / Cordova 플러그인은 존재하지 않는다.**

| 확인 경로 | 결과 |
|---|---|
| npm 레지스트리 전수 (`adbrix`, `dfinery`, `igaworks`, `capacitor adbrix`, `cordova adbrix`) | React Native SDK(`@igaworks/adbrix-react-native-sdk`), Web SDK, Unity, Flutter 만. **Capacitor 0건** |
| IGAWorks 공식 org `github.com/igaworksdev` 레포 67개 | `adbrix-{android,ios,unity,flutter,react-native,web}-sdk` 존재. **capacitor 없음** |
| GitHub 레포 검색 `adbrix capacitor` / `dfinery capacitor` | **0건** (커뮤니티 구현도 없음) |
| 공식 문서상 지원 플랫폼 | Android · iOS · React Native · Flutter · Unity · Web |

**다만 공식 "하이브리드 앱(WebView)" 연동 경로가 있다 — 우리 아키텍처와 동일하다.**
- 문서: <https://docs.dfinery.ai/developer-guide/platform/hybridapp/web-view-interface>
- 샘플: <https://github.com/igaworksdev/adbrix-hybrid-app-sample> (2025-12-08 갱신, 유지되고 있음)
- 방식: Android `addJavascriptInterface(...)` / iOS `WKScriptMessageHandler` 로 JS↔네이티브 브릿지

**⚠️ 하이브리드 브릿지의 범위는 "이벤트 로깅뿐"이다.** 공식 샘플 `AdbrixJavascriptInterface.java` 가 노출하는 메서드 전체:

```java
@JavascriptInterface public void logEvent(String eventName, String properties)
@JavascriptInterface public void enableSDK()
@JavascriptInterface public void disableSDK()
```
(DFINERY 쪽 샘플은 `setIdentity(key, value)` 가 추가되어 있다.)

**SDK 초기화 · 디퍼드 딥링크 · ATT 결과 전달은 전부 네이티브에서만 가능하다.**

**네이티브 SDK 배포 형태 (플러그인 자작 시 난이도 판단 근거)**
- Android: Maven Central `com.igaworks.adbrix:android-sdk` (minSdk 19, compileSdk 35)
- iOS: CocoaPods (`adbrix-ios-sdk` podspec 레포)
- 디퍼드 딥링크 네이티브 API: `setDeferredDeeplinkListener` → `onReceiveDeferredDeeplink(String)`
  ⚠️ poptale 이 쓰는 `blockDeferredDeepLinkLaunch()` 는 **Flutter 플러그인 API** 로 확인됐고, 네이티브 동등 API 는 **미확인**

즉 Capacitor 플러그인 자작은 "gradle 의존성 + pod + JS 셈" 이라는 표준 작업이라 기계적으로는 평범하다.

#### 실행 경로 3안 (⏸ 사용자 내부 확인 중 — 2026-08-14)

| 안 | 내용 | 공수 | 얻는 것 / 잃는 것 |
|---|---|---|---|
| **A. 최소 플러그인 + 공식 하이브리드 브릿지** ⭐ | 네이티브 SDK 를 감싸는 **얇은 Capacitor 플러그인(init + attAuthorized 만)** 작성 + 이벤트는 공식 하이브리드 JS 브릿지 패턴 재사용 | **소~중** | 설치 어트리뷰션 ✅ · 이벤트 ✅ · ATT 연동 ✅ / **Adbrix 경유 디퍼드 딥링크 ✗** |
| B. 풀 Capacitor 플러그인 자작 | 디퍼드 딥링크 리스너까지 전부 노출 | 중~대 | Adbrix 디퍼드도 가능 / 우회 #1 상당 구현 필요 + 네이티브 동등 API 미확인 리스크 |
| C. Adbrix 보류 | AppsFlyer 단독으로 먼저 출시, Adbrix 는 국내 매체 집행 확정 시 | 없음 | 즉시 출시 가능 / poptale 과 대시보드 통일 지연 |

**A 안이 유력한 이유:** DECISION #4 에서 **디퍼드 딥링크는 AppsFlyer 단독 담당**으로 이미 정했다.
따라서 Adbrix 에 필요한 건 ① 설치 어트리뷰션(네이티브 init 1회면 SDK 가 자동 수집) ② 이벤트 로깅(공식 브릿지)
③ ATT 결과 전달(`attAuthorized`) 3개뿐이고, **디퍼드 딥링크 API 를 노출할 필요가 없다.**
→ **poptale 우회 #1(`blockDeferredDeepLinkLaunch`)이 불필요해진다.** 우회 #3(`setUserId` 부재)은 그대로 유효.

**내부 확인 항목 (사용자)**
- [ ] DFINERY 에 Capacitor 공식 지원 계획 문의 (RN·Flutter 는 있으므로 로드맵에 있을 수 있다)
- [ ] Adbrix 대시보드를 poptale 과 공유할지 / 신규 분리할지
- [ ] A 안으로 충분한지 — 마케팅이 **Adbrix 트래킹 링크로도 디퍼드 딥링크**를 요구하는지

### C-3. 우리 설계 — 앱/웹 경계 판정

| 레이어 | 담당 | 현재 상태 |
|---|---|---|
| `appUrlOpen` 수신 / 콜드스타트 `getLaunchUrl` | **app-harness** | ✅ `dist/index.js:273-295` (poptale 이 고생한 콜드스타트 문제를 이미 처리) |
| Android App Links intent-filter 주입 | **app-harness** | ✅ `generate-app.mjs` (allowedDomains 기반 자동) |
| iOS associated-domains 주입 | **app-harness** | ✅ `generate-app.mjs` — ⚠️ pbxproj 연결은 **Xcode 수동** |
| **AASA / assetlinks 파일 생성** | **app-harness** | ✅ 2026-08-18 추가 — `build/<slug>/well-known/<host>/`. 웹 서빙만 사람이 |
| 디퍼드 딥링크 수신(어트리뷰션 SDK) | **app-harness** | ✅ AppsFlyer 만 배선 (`:1242-1254`) / Adbrix 는 SPEC 만 |
| **AASA / assetlinks.json 서빙** | **character-chatbot-web** | ⛔ 아직 미배치 — 단 **파일은 하네스가 만들어 준다**(위 항목). 웹은 `.well-known/` 에 올려 200 으로 서빙만 하면 된다 |
| 딥링크 → 화면 라우팅 | **character-chatbot-web** | ✅ `HarnessInit.tsx` 에서 `router.push` |
| 설치 유도 배너 / `/download` / UTM | **character-chatbot-web** | ⬜ 없음 |
| 이벤트 벤더 추상화 | **양쪽** | 앱=`AppBridge.track()` ✅ / 웹=`src/lib/analytics/track.ts` 🚧 |

### C-4. 범용화 설계 — 신규 앱이 채울 값

**⚠️ 스키마 확장이 필요하다.** 현재 `marketing.attribution.provider` 는 단일 문자열이라 병행을 표현할 수 없다.
하위호환을 지키면서 확장하는 형태:

```jsonc
"features": { "deepLink": true },
"navigation": { "allowedDomains": ["chat.poptale.ai", "*.poptale.ai"] },
"marketing": {
  "attribution": {
    // 기존: "provider": "appsflyer"  (문자열 — 계속 지원)
    // 확장: providers 배열. 각 항목이 자기 옵션을 갖는다
    "providers": [
      { "name": "appsflyer", "deferredDeepLink": true  },   // 디퍼드 딥링크 담당 = 1개만 true
      { "name": "adbrix",    "deferredDeepLink": false }    // 반드시 false (중복 라우팅 방지)
    ]
  },
  "analytics": { "provider": "amplitude" },
  "autoCapture": true
}
```

| 규칙 | 이유 |
|---|---|
| `deferredDeepLink: true` 는 **providers 중 정확히 1개만** 허용 | 2개면 같은 링크로 두 번 이동한다. `generate-app` 이 검증해 실패시킨다 |
| 기존 `provider` 문자열도 계속 지원 | 이미 배포된 앱 config 를 깨지 않는다. 내부에서 `providers: [{name}]` 로 정규화 |
| `providers` 와 `provider` 동시 지정 시 | `providers` 가 이긴다 + 경고 |

+ 환경변수(레포 커밋 금지):
`APPSFLYER_DEV_KEY`, `APPSFLYER_IOS_APP_ID`, `ADBRIX_APP_KEY`, `ADBRIX_SECRET_KEY` (슬러그별은 `..._<SLUG>`)

웹이 서빙해야 할 값:

| 파일 | 필요한 값 | 어디서 얻나 |
|---|---|---|
| `.well-known/apple-app-site-association` | Apple Team ID + 번들 ID 전체 | Apple Developer 계정 |
| `.well-known/assetlinks.json` | 패키지명 + SHA256 인증서 지문(업로드키 **및** Play 앱서명키) | Play Console > 앱 서명 |

> ⚠️ `apple-app-site-association` 은 **확장자 없이**, `Content-Type: application/json`, 리다이렉트 없이 200 이어야 한다.

### C-5. 구현 체크리스트

**app-harness — 스키마·딥링크**
- ⬜ `marketing.attribution.providers` 배열 스키마 추가 + 하위호환 정규화 + `deferredDeepLink` 단일성 검증 (`scripts/lib/config.mjs`)
- ⬜ `initMarketing()` 을 **다중 벤더 루프**로 재작성 (현재는 `if (provider === 'appsflyer')` 단일 분기)
- ⬜ `apps/characterchat*/app.config.json` → `features.deepLink: true` (dev 는 이미 true, **prod 는 false**)
- ⬜ `initMarketing()` 실패 시 `_eventQueue` 가 영구히 안 비워지는지 점검 (poptale 우회 #4 의 하네스판)
- ⬜ iOS pbxproj 의 `CODE_SIGN_ENTITLEMENTS` 수동 연결 절차를 08-DEPLOY.md 에 명시 (현재 경고만 출력)

**app-harness — Adbrix 배선 (신규)** — ⏸ **실행 경로 A/B/C 결정 대기 (C-2-1)**
- ✅ 선행 조사 완료 (2026-08-14) — 공식 Capacitor 플러그인 없음. 공식 하이브리드 WebView 브릿지는 존재하나 **이벤트 로깅 전용**
- ⏸ 실행 경로 A(최소 플러그인+하이브리드 브릿지) / B(풀 자작) / C(보류) 중 선택 — 사용자 내부 확인 중
- ⬜ (A 안이면) 얇은 Capacitor 플러그인: Android Maven `com.igaworks.adbrix:android-sdk` + iOS CocoaPods 래핑, **init·attAuthorized 만 노출**
- ⬜ (A 안이면) 이벤트는 공식 하이브리드 브릿지 패턴(`logEvent`/`enableSDK`/`disableSDK`) 재사용
- ⬜ (A 안이면) 우회 #1 **불필요** — 디퍼드 딥링크를 Adbrix 로 받지 않으므로
- ⬜ `template/plugins/adbrix/SPEC.md` §6 의 6단계 실행 (config·generate-app·브릿지·gradle·podspec)
- ⬜ **우회 #1 반영** — `blockDeferredDeepLinkLaunch()` 상당 호출을 init **이전에** 배치. Capacitor 플러그인에 해당 API 가 없으면 네이티브에서 딥링크 자동 실행을 막는 대안 필요
- ⬜ **우회 #3 반영** — `setUserId` 부재 시 이벤트 프로퍼티로 `user_id` 주입, 단 `abx:` 접두 표준 이벤트에는 **주입 금지**
- ⬜ **우회 #5 반영** — ATT 응답 이후 init (AppsFlyer 의 `waitForATTUserAuthorization` 과 동등한 대기)
- ⬜ Adbrix 는 `deferredDeepLink: false` 고정
- ⬜ 이벤트 라우팅 테이블 도입 검토 (poptale-frontend `tracking/routing.ts` 패턴 — 벤더별 중복 집계 방지)

**character-chatbot-web** → 웹 문서 참조

### C-6. 외부 셋업 체크리스트

| 항목 | 담당 | 선행조건 | 완료 판정 |
|---|---|---|---|
| ✅ 어트리뷰션 벤더 결정 | 마케팅/개발 리드 | — | **2026-08-14 AppsFlyer + Adbrix 병행 확정** |
| ✅ Adbrix Capacitor 플러그인 존재 여부 조사 | 개발 | — | **2026-08-14 완료 — 없음. C-2-1 참조** |
| ⏸ Adbrix 실행 경로 A/B/C 결정 | 마케팅/개발 리드 | C-2-1 | 결정 기록 (**사용자 내부 확인 중**) |
| ⬜ DFINERY 에 Capacitor 공식 지원 계획 문의 | 마케팅 | DFINERY 채널 | 답변 확보 |
| ✅ Apple Team ID 확보 | — | — | **2026-08-18 확인 — `3W889GYPRK`.** `AIPIA_DEFAULTS.appleTeamId` + 두 앱 config 에 반영. 환경변수 설정 없이 AASA 생성됨 |
| ⛔ Play 앱 서명 SHA256 지문 2종 확보 | 앱 배포 담당 | **Play Console 등록** | assetlinks 생성 가능 (지금은 이것만 막고 있다) |
| ⬜ Xcode > Signing & Capabilities > Associated Domains 연결 | 앱 개발 | entitlements 생성 | 빌드 성공 + 링크 동작 |
| ⬜ **AppsFlyer** 콘솔 앱 등록 + devKey·iOS App ID 발급 | 마케팅 | 계약 | 키 확보 |
| ⬜ **DFINERY(Adbrix)** 콘솔 앱 등록 + appKey·secretKey 발급 | 마케팅 | 계약 | 키 확보 |
| ⬜ Adbrix 대시보드를 poptale 과 공유할지 / 신규 분리할지 결정 | 마케팅 | DFINERY 계약 | 결정 기록 (SPEC.md §9 TODO) |
| ⬜ 트래킹 링크 생성 규칙 정의 | 마케팅 | 콘솔 세팅 | 캠페인 링크 발급 |

### C-7. 테스트 방법

```bash
# AASA 검증 (확장자 없음, JSON content-type, 리다이렉트 없이 200)
curl -sI https://chat.poptale.ai/.well-known/apple-app-site-association
curl -s  https://chat.poptale.ai/.well-known/assetlinks.json | jq

# Android App Link 검증 상태
adb shell pm get-app-links com.aipia.characterchat

# 딥링크 직접 발사
adb shell am start -a android.intent.action.VIEW -d "https://chat.poptale.ai/chat/abc"
xcrun simctl openurl booted "https://chat.poptale.ai/chat/abc"
```

시나리오 4종:
1. **웜스타트** — 앱 실행 중 링크 탭 → 해당 화면 이동
2. **콜드스타트** — 앱 종료 상태에서 링크 탭 → 스플래시 후 해당 화면 (poptale 이 가장 고생한 케이스)
3. **디퍼드** — 앱 **미설치** 상태에서 트래킹 링크 탭 → 스토어 → 설치 → 첫 실행 시 원래 목적지 도달 (⚠️ 실기기 + 신규 설치에서만 재현. 시뮬레이터 불가)
4. **일반 브라우저** — 앱 미설치 모바일 웹에서 배너/`/download` 동작

### C-8. 리스크 & 미해결

- AASA 는 **iOS 가 캐싱**한다. 파일 수정 후 즉시 반영 안 될 수 있음 → 앱 삭제 후 재설치로 검증
- Android App Links `autoVerify` 는 도메인 검증 실패 시 조용히 "브라우저로 열기"가 됨 → `pm get-app-links` 로 반드시 확인
- 디퍼드 딥링크는 **어트리뷰션 SDK 없이는 원리적으로 불가능**하다 → AppsFlyer 가 담당(확정)
- Play 앱 서명 사용 시 **업로드키 지문만 넣으면 App Link 가 안 붙는다.** 두 지문 다 필요 (poptale 도 2개 등록)
- **Adbrix Capacitor 플러그인 부재 리스크(최대 미지수).** Flutter 용만 확인됐다. Capacitor 용이 없으면 자체 플러그인 작성이 필요해 C 의 공수가 크게 늘어난다 → **착수 전 조사 필수**
- 두 어트리뷰션 SDK 를 함께 넣으면 앱 용량·시작 시간이 늘고 SKAdNetwork 항목이 양쪽에서 요구된다 → `Info.plist` 의 `SKAdNetworkItems` 를 두 벤더 목록 합집합으로 관리해야 함 (poptale 은 DFINERY 8개만 등록: `Info.plist:114-139`)

---

## 3. DECISION — 6건 전부 확정 (2026-08-14)

| # | 안건 | **결정** | 이 결정이 만든 작업 |
|---|---|---|---|
| **1** | ATT 사전 화면을 웹만 그릴까, 하네스 폴백도 둘까 | **웹 + 하네스 폴백 병행** | 브릿지에 폴백 사전 게이트 신규 구현. `tracking.att.prePermission` / `tracking.att.copy` 스키마 추가 → A-3, A-5 |
| **2** | ATT 사전 화면 노출 시점 | **온보딩 완료 후** | 웹에 노출 게이트 훅 + 로컬 플래그. `trackingStatus()` 선행 필요 → 웹 문서 A-3 |
| **3** | 강제 업데이트 버전 정보 소스 | **Firebase Remote Config**<br>(+ `minVersionUrl` JSON 폴백) | **하네스에 RC 신규 배선** — 플러그인·`_initRemoteConfig()`·`checkForceUpdate()` 재작성·config 스키마·콘솔 키 5개 → B-3~B-7 |
| **4** | 어트리뷰션 벤더 | **AppsFlyer + Adbrix 둘 다** | `providers` 배열 스키마 + `initMarketing()` 다중 벤더화 + **Adbrix 배선 0→1** + 우회 #1·#3·#5 반영 → C-2, C-4, C-5 |
| **5** | 버전 정보 fetch 실패 시 동작 | **fail-open 유지** (통과시킴) | 브릿지 변경 없음. 대신 "긴급 차단은 BE 의 구버전 요청 거부로" 를 런북에 명시 → B-8 |
| **6** | poptale ATT 결함 대응 | **6-A + 6-B + 6-C 전부** | A-4(6-C 문구 필수화) · A-5(6-B 멱등 가드) · §3-1(6-A 이슈 등록) |

**결정 #3 에 대한 기록:** 조사 단계에서는 (a) 정적 JSON 을 추천했다(하네스 코드 0줄, 즉시 착수 가능).
검토 결과 **Firebase Remote Config 로 결정**됐고, 그에 따라 RC 배선이 신규 개발 항목으로 추가됐다.
RC 의 알려진 비용 3가지(캐시 지연 / Firebase 파일 필수 / 앱 재빌드)는 B-3 에 그대로 기재해 두었으며,
2차 목표(Firebase 없는 앱도 강제 업데이트 사용)를 지키기 위해 **URL 폴백을 병행 유지**하는 형태로 설계했다.

### 3-1. 6-A — poptale-app 이슈 등록 내용 (그대로 복사해 쓸 것)

> poptale-app 은 이번 작업에서 **읽기 전용**이다. 아래는 별도 티켓으로 넘길 내용이다.

**티켓 ①  ATT 권한 이중 요청 레이스**
- 파일: `lib/main.dart:149` / `lib/my_app.dart:61-82`
- 증상: `main.dart` 가 `Permission.appTrackingTransparency.request()` 를 **await 없이** 호출하고,
  이후 `my_app.dart:69` 가 `AppTrackingTransparency.requestTrackingAuthorization()` 을 다시 호출한다.
- 영향: 먼저 뜬 팝업의 응답 타이밍에 따라 `my_app.dart:66` 의 `notDetermined` 판정이 흔들려
  `Adbrix.attAuthorized(authorized:)` 에 **잘못된 값이 전달될 수 있다** → 어트리뷰션 데이터 정확도 저하
- 제안 수정: `main.dart:147-150` 의 `Permission.appTrackingTransparency.request()` 블록 **삭제**.
  ATT 요청 경로를 `my_app.dart` 하나로 단일화
- 우선순위: 중 (데이터 정확도. 사용자 체감 버그는 아님)

**티켓 ②  Info.plist 추적 사유 문구가 실제 용도와 불일치**
- 파일: `ios/Runner/Info.plist:109-110`
- 현재 값: `"이 앱은 앱 오류 분석을 위해 추적 권한을 요청합니다."`
- 실제 용도: Adbrix(DFINERY) 광고 어트리뷰션 (`SKAdNetworkItems` + `NSAdvertisingAttributionReportEndpoint: dfinery-skadnetwork.com` 이 같은 파일에 있음)
- 영향: Apple 심사 시 목적 불일치 지적 소지 + 국내 개인정보보호법상 **수집 목적 명시 위반 소지**
- 제안 수정: 실제 용도에 맞는 문구로 교체 (예: `"맞춤형 콘텐츠와 광고를 제공하기 위해 활동 데이터를 사용합니다."`)
- 우선순위: **높음** (법규·심사 리스크, 수정 비용은 한 줄)

---

## 4. 이 문서와 기존 문서의 관계 (중복 방지)

| 기존 문서 | 겹치는 내용 | 처리 |
|---|---|---|
| `13-MARKETING.md` | 어트리뷰션 벤더 슬롯, AppsFlyer 키 주입 절차 | **정본.** `providers` 배열 스키마(#4) 도입 시 **갱신 필요** |
| `02-GUIDE.md` §6 | `app.config.json` 스키마, forceUpdate JSON 스키마 | **정본.** `tracking.att` · `forceUpdate.source` · `firebase.remoteConfig*` 추가 시 **갱신 필요** |
| `22-NATIVE_FEATURES_PLAN.md` | 기능별 가능/불가 매트릭스, Phase 2-2 강제업데이트 | 상태만 중복. 착수 후 상태 동기화 필요 |
| `17-DATA-COLLECTION.md` / `16-COMPLIANCE.md` | 개인정보 라벨·수집 항목 | ATT + 어트리뷰션 2벤더 켤 때 **갱신 대상** |
| `template/plugins/adbrix/SPEC.md` | Adbrix 배선 6단계 | **정본.** 이 문서는 우회 코드 분석을 추가 제공. #4 확정으로 이 SPEC 이 **실행 대상**이 됐다 |
| `character-chatbot-web/docs/27-*` | ATT/Adbrix/Amplitude 체크리스트 | **선행 문서.** "왜 ATT 팝업이 안 떴나" 진단이 여기 결론과 일치 |

> 위 문서들은 아직 **수정하지 않았다.** 구현 착수 시 함께 갱신한다.

---

## 5. 착수 순서 권고

결정이 다 났으니 의존 관계 기준으로 이 순서가 낭비가 가장 적다.

| 순서 | 작업 | 왜 이 순서인가 | 선행 차단 |
|---|---|---|---|
| 1 | **6-A 이슈 2건 등록** (§3-1) | 5분. 티켓 ②는 법규 리스크라 빨리 넘길수록 좋다 | 없음 |
| 2 | ~~Adbrix Capacitor 플러그인 조사~~ | ✅ **2026-08-14 완료** — 없음. 실행 경로 A/B/C 는 사용자 내부 확인 중 (C-2-1) | — |
| 3 | **A: ATT** (`trackingStatus()` + 6-B 멱등화 + 6-C 필수화 + 폴백 게이트 → 웹 사전 화면) | 외부 셋업 의존이 가장 적다. 문구 법무 검토만 병행하면 끝 | 문구 법무 검토 |
| 4 | **B: 강제 업데이트** (RC 배선 → config → 콘솔 키) | A 와 독립. prod Firebase 프로젝트만 정해지면 진행 가능 | prod Firebase 프로젝트 확정 |
| 5 | **C: 딥링크** (AASA/assetlinks → AppsFlyer → Adbrix) | 파일 생성은 하네스가 한다(2026-08-18). iOS 는 Team ID 반영으로 풀렸고, **Android 만 Play 지문 대기** | ⛔ Play SHA256 ×2 |

> **지금 당장 사람에게 요청해야 하는 것 2개:** ① **Play 앱 서명 SHA256 지문 2종**(Play Console 등록 후)
> ② characterchat prod 의 Firebase 프로젝트.
> (~~Apple Team ID~~ 는 2026-08-18 `3W889GYPRK` 로 확정·반영 완료 — 더 이상 막지 않는다.)

---

## 6. 변경 이력

| 날짜 | 변경 | 작성 |
|---|---|---|
| 2026-08-14 | 최초 작성 — poptale-app/poptale-frontend 벤치마킹, 하네스 갭 분석, 3개 기능 설계 + DECISION 6건 제기 | Claude Code (조사 전용 턴, 코드 미변경) |
| 2026-08-14 | **A(ATT) 하네스 구현 완료** — `tracking.att` config·검증·runtimeConfig 전달, generate-app 플러그인 조건 분리 + 문구 필수화(6-C), 브릿지 `trackingStatus()`·`requestTracking()` 멱등화(6-B)·폴백 게이트(#1)·`capabilities.att`. 25개 자동 검증 통과. **웹 측(3~6단계)은 미착수** | Claude Code |
| 2026-08-14 | **Adbrix Capacitor 플러그인 조사 완료** — 공식 플러그인 없음 확정(npm·GitHub·공식문서 전수). 공식 하이브리드 WebView 브릿지 발견(이벤트 로깅 전용). 실행 경로 A/B/C 제시 → §C-2-1 신설. A 안 채택 시 우회 #1 불필요해짐 | Claude Code |
| 2026-08-14 | **DECISION 6건 전부 확정 반영** — ATT 폴백 게이트(#1)·온보딩 후 노출(#2)·Firebase RC+URL 폴백(#3)·AppsFlyer+Adbrix 병행(#4)·fail-open 유지(#5)·6-A/B/C 전부(#6). B 섹션 RC 설계로 재작성, C 섹션 다중 벤더 스키마 추가, §3-1 poptale 이슈 초안, §5 착수 순서 신설 | Claude Code (코드 미변경) |
