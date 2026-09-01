---
doc: 26
title: POPTALE-GLOBAL — Poptale 글로벌 앱 구현 참고
category: 앱추가
audience: 개발자
status: active
updated: 2026-09-01
---

# POPTALE-GLOBAL — Poptale 글로벌 앱 구현 참고 문서

> 이 문서는 **구현 시 참고용**이다. 계획·일정·판정은 `poptale-app/.claude/docs/global-launch-plan.md`
> (및 그 아티팩트)에 있고, 여기에는 **"어떻게 만드는가"**만 둔다.
>
> 📌 **선행 필독**: [`01-AIPIA-CONVENTIONS.md`](./01-AIPIA-CONVENTIONS.md) → [`02-GUIDE.md`](./02-GUIDE.md) → [`ONBOARDING.md`](../ONBOARDING.md)
>
> ⚠️ [`21-POPTALE-MIGRATION.md`](./21-POPTALE-MIGRATION.md)와 **다른 건**이다. 그 문서는 국내 Flutter 앱을
> 같은 번들 ID(`com.aipia.poptale`)로 교체하는 마이그레이션이고, 이 문서는 **비즈니스 정책상 분리
> 출시하는 별도 글로벌 앱**이다. 두 문서의 전제가 다르다:
>
> | | POPTALE-MIGRATION | POPTALE-GLOBAL (이 문서) |
> |---|---|---|
> | 웹 | `poptale-frontend` 그대로 사용 | **팝테일과 분리된 별도 웹** (D3 확정) — i18n 4개 언어 + 한국전용 삭제 |
> | 번들 ID | 기존과 동일 (덮어쓰기) | 신규 |
> | Kakao/Naver | 필수 | **불필요** |
> | Adbrix / WhaTap | 필수 | **불필요** (글로벌 대체 SDK) |
> | 기존 사용자 | 있음 (데이터 호환성이 최대 리스크) | 없음 (호환성 부담 없음) |


---

## 0-0. 🔴 8/20 아젠다 결정 — 이 문서의 전제

| 결정 | 결과 | 구현에 미치는 영향 |
|---|---|---|
| **1차 기능 범위** | **"다" — 전부 포함** | ⚠️ D6은 전부지만 **하네스는 일정에서 제외 · 점진 보완**으로 결정됨 → Tier 3의 1차 완성은 보장되지 않는다. 웹의 해당 UI를 숨겨야 함 |
| **fork vs 단일 코드베이스** | **팝테일과 분리 · 글로벌 원빌드** | **market 플래그 불필요** (§2-2-A 하단 가이드는 미채택). 한국 전용은 플래그가 아니라 **삭제**. T6·T7 함정 해소 |
| **서버 / DB** | **분리 / 분리** | 별도 API 도메인 · 별도 DB |
| **계정 / 재화** | **계정 통합 / 재화만 분리** | **해결됨.** 인증만 공유하는 계층 = **외부 인증서버 위탁**(팝챗과 동일 방식). Keycloak 자체 구축은 **현 요구사항에서는** 불필요 — [25-AUTH-DELEGATION.md](./25-AUTH-DELEGATION.md). ⚠️ **IdP 수준 SSO 는 성립하지 않는다**(인증서버가 internal-only). 다만 앱이 실제 Safari·Chrome 을 열므로 **공급자 세션이 공유돼 재로그인은 무마찰**이고, 남는 마찰은 "수단을 다시 고르는 것" 하나다. ⚠️ **길 A(웹 리다이렉트) 전환으로도 해결되지 않는다** — 팝테일 웹도 브로커가 BE 다. SSO 가 요구사항이 되면 **IdP 신설이 유일한 답**이므로 그때는 별도 예산·일정 결정이 필요하다 |
| **출시 언어** | **EN · KO · JP · ES 4개** | 🔴 번역·레이아웃 QA 2배. **KO가 글로벌 빌드에 포함**되므로 에디션≠언어 축 분리가 실제로 필수 |
| **스토어 배포 국가** | **동일 빌드 여러 나라 동시 배포** | 🔴 국가 분리 안 함 → **Apple 4.3(Spam) 리스크 유지.** 한국 포함 여부 확인 필요 |
| **백엔드** | **다음달 착수 + 3개월** | W5 착수 → **W18 완료. 크리티컬 패스** |
| **도메인·번들ID·슬러그·URL 스킴** | **아직 안 정해짐** | 🔴 **blocking** — `app.config.json` · Firebase · AASA 전부 대기 |
| **분석·어트리뷰션** | 팝테일과 분리 · Amplitude 또는 GA4 | 신규 프로젝트 개설 |

> ## 🚫 하네스는 일정에서 제외 (결정)
>
> **오늘 초기 작업(배선 11건)을 마치고 이후 점진적으로 보완한다.** 따라서 아래 백로그는
> **일정 트랙이 아니라 보완 순서**로 읽는다. Tier 3(G13·G14·G15)는 1차 출시에 완성돼 있다고 가정하지 않는다.
>
> **구현자가 반드시 지킬 것 2가지**
> 1. **W1에 브릿지 메서드 시그니처를 고정한다.** 이후 보완에서 시그니처를 바꾸면 글로벌 웹이 재작업한다.
>    변경이 필요하면 **기존 메서드를 유지하고 새 메서드를 추가**한다.
> 2. **미지원 기능 목록을 웹에 명시적으로 넘긴다.** 웹에는 이미 다운로드·TTS UI가 있어,
>    앱 기능이 없으면 눌러도 무동작이 된다. 웹이 해당 UI를 숨길 수 있게 **capability 목록을 런타임으로 노출**할 것
>    (`AppBridge.capabilities` 활용 — `deriveCapabilities()`가 이미 config→capability 변환을 한다).

---

## 0-A. 분석 기준 (freshness) — 반드시 확인할 것

| 저장소 | 브랜치 | 커밋 | 비고 |
|---|---|---|---|
| `poptale-app` | `origin/main` | `a3918d36` | — |
| `poptale-frontend` | **`origin/prod`** | `7abe4d74` (2026-08-14) | **기본 브랜치가 `main`이 아니다** |
| `app-harness` | `feat/att-pre-permission` | `574cc1e` (main+5) | ATT 배관 · AASA 자동생성 · `15-APP-GROWTH-FEATURES.md` |

### 0-A-1. 실측 인벤토리 — `poptale-frontend` (origin/prod)

| 지표 | 값 |
|---|---|
| ts/tsx (apiTypes 제외) | **806개** |
| 라우트 (`page.tsx`) | **58개** |
| i18n · locale · intl 파일 | **0개** |
| 한글 포함 파일 / 라인 | **537개 / 7,019줄** |
| 스택 | Next.js 15.2.8 · React 19.2.1 · TanStack Query · Tailwind 4 · ky · jose |
| 백엔드 | swagger 4종 (38082 / 38083 / 38084 / 38088) |
| 한국 전용 | PortOne(본인확인) · 이메일가입 · `findid`/`findpwd` · `youth` · 부모동의 · `marketing-agree` |

### 0-A-2. 🔴 뷰어는 이미 웹이다 — 설계 전제

- `poptale-frontend`: `src/app/viewer/page.tsx` + `src/containers/Viewer.tsx`가 **프로덕션에 존재.**
  밝기 · 북마크 · TTS 재생 컨트롤 아이콘까지 전부 있음.
- `poptale-app`: `s_viewer.dart`는 **79줄**, `vm_viewer.dart`가 webview 서비스를 사용.
  `packages/poptale_viewer`는 **`pubspec.lock`만 있는 빈 껍데기.**
- → **국내 Flutter 앱도 이미 뷰어를 WebView로 렌더 중.** 하네스 이전에 "뷰어를 웹으로 다시 만드는" 작업은 없다.

### 0-A-3. 웹이 이미 호출 중인 AppChannel 액션 20종

```
init  social-auth  user  user-token  device-info  push-permission  setting
share  tts  brightness  back-press  content/download  downloads
iap/items  iap/products/consumable  iap/products/subscription
iap/products/restore  iap/purchases/verify  amplitude/private-id  ad-attribution
```

앱/웹 판별(`src/lib/utils.ts`, `deviceUtils.ts`)과 결제 분기(`hooks/charge/useCandyPayment.ts`)도 이미 구현됨.
→ `installAppChannelShim({ scheme: 'poptale' })`의 **"기존 웹 코드 무수정 동작" 주장이 성립할 조건이 갖춰져 있다.**
단 **shim의 `routes` override가 위 20종을 전부 커버하는지 1:1 대조**가 필요하다 (§3 확인필요 참조).

---

## 0. 작업 구분 원칙 — 이 문서의 뼈대

모든 작업은 둘 중 하나다. 이 구분을 놓치면 일정 추정이 어긋난다.

| | **A. 하네스 작업** | **B. 새 앱 작업** |
|---|---|---|
| 어디서 | `app-harness` 레포 | `apps/<slug>/`, 웹 레포, 백엔드, 각종 콘솔 |
| 성격 | 한 번 하면 **모든 앱에 자동 적용** | **앱마다 반드시 반복** |
| 재사용 | 국내 마이그레이션에 그대로 재사용됨 | 재사용 불가 |
| 자동화 | — | `generate-app.mjs`가 대신 해주는 부분과 사람이 해야 하는 부분이 나뉨 |

> **글로벌 프로젝트에서 A를 처리하면 하네스가 그만큼 성숙해진다.**
> 즉 글로벌 출시가 국내 마이그레이션의 예행연습이 된다 — 이것이 이 프로젝트의 부수 이득이다.

### 0-1. "전체 배관" = 3단 (ATT 레퍼런스)

하네스에서 네이티브 기능 하나를 붙인다는 건 3단을 붙인다는 뜻이다. **ATT가 3단이 다 붙은
유일한 완성 레퍼런스**이므로, 새 기능을 배선할 때 이 패턴을 그대로 따른다.

| 단 | 하는 일 | ATT의 경우 | 위치 |
|---|---|---|---|
| **①** | 브릿지 메서드 — 플러그인 동적 import + capability 게이트 | `requestTracking()` | `template/bridge/dist/index.js:877` |
| **②** | 플러그인 자동설치 — config 조건 → npm 패키지 | attribution provider 있으면 `capacitor-plugin-app-tracking-transparency` | `scripts/generate-app.mjs:301` |
| **③** | iOS 권한 문구 주입 — 없으면 호출 즉시 크래시 | `NSUserTrackingUsageDescription` | `scripts/generate-app.mjs:431` |

추가로 필요할 수 있는 것:
- **④ config 스키마 + capability** — `scripts/lib/config.mjs`의 `features` 플래그 →
  `deriveCapabilities()`(`dist/index.js:16`)가 capability로 변환. 브릿지 메서드는
  `if (!this.capabilities.X) return no-op` 로 게이트된다. **플래그가 false면 코드가 있어도 동작하지 않는다.**
- **⑤ 네이티브 프로젝트 설정** — Xcode Capability, `UIBackgroundModes` 등. 현재 `generate-app.mjs`가
  건드리지 않는 영역. **여기까지 필요하면 난이도가 급상승한다** (§1-3 TTS 참조).

> **핵심**: 커스텀 네이티브 플러그인 `AppBridge`(Kt/Swift)는 `getConfig()` **하나만** 구현한다
> (`template/bridge/android/.../AppBridgePlugin.kt:20`, `ios/.../AppBridgePlugin.swift:19`).
> 나머지는 전부 `dist/index.js`가 Capacitor 플러그인을 동적 import 해서 처리한다.
> → **대부분의 "네이티브 기능 추가"는 Kotlin/Swift를 안 짜도 된다.**

---

## 1. A. 하네스 작업 백로그

`poptale-app`(Flutter)의 AppChannel 액션 전체와 하네스 브릿지 API 표면을 대조해 도출했다.
8/20 결정(1차 기능 "다")으로 **Tier 1 전부 + Tier 2 + Tier 3 전부**가 1차에 들어온다.

### 1-1. Tier 1 — 즉시 추가 (①단 위주, ③단 불필요)

| # | 기능 | 필요한 단 | 구현 방법 | 소요 |
|---|---|---|---|---|
| **G1** | **네이티브 로딩 커버 숨김** | ①② | `@capacitor/splash-screen`의 `hide()`를 브릿지 메서드로 노출. `autoHide: false`로 두고 웹이 준비되면 `AppBridge.hideLoading()` 호출. 어댑터에 `initHarness()` 완료 시 자동 호출 옵션 추가. **타임아웃 폴백 필수**(웹이 죽어도 커버가 영구히 남으면 안 됨) | 1일 |
| **G2** | **FCM 토픽 구독/해제** | ① | `@capacitor-community/fcm`이 이미 `FEATURE_PLUGINS.push`에 설치됨. `FCM.subscribeTo({topic})` / `unsubscribeFrom` 을 `subscribeTopic(topic)` / `unsubscribeTopic(topic)` 으로 래핑. capability는 `push` 재사용 | 0.5일 |
| **G3** | **OS 앱 설정 화면 열기** | ①② | `@capacitor/app`의 네이티브 설정 열기가 없으므로 커뮤니티 플러그인(`capacitor-native-settings` 등) 추가. `openAppSettings()` 노출. **권한 거부 후 재유도 UX의 필수 부품** — `getPermissionNotice()`와 세트로 쓰인다 | 0.5일 |
| **G4** | **스토어 열기** | ① | 신규 플러그인 불필요. `config.appId` + `platform`으로 스토어 URL 조립 후 `openExternal()` 재사용. iOS는 `itms-apps://`, Android는 `market://` 우선, 실패 시 https 폴백. `checkForceUpdate()` 내부에 이미 유사 로직이 있으면 추출해서 공용화 | 0.5일 |
| **G5** | **앱 배지 제어** | ①② | 커뮤니티 배지 플러그인 추가. `setBadge(n)` / `clearBadge()`. 푸시 수신·앱 포그라운드 복귀 시 웹이 호출. iOS는 알림 권한에 badge가 포함돼야 함 (`registerPush` 요청 시 확인) | 1일 |
| **G6** | **런타임 테마 설정** | ①④ | `@capacitor/status-bar`는 이미 base 플러그인. `setTheme('light'\|'dark'\|'system')` 으로 상태바 스타일 + 배경색을 `config.theme`에 맞춰 전환. 웹의 테마 토글과 동기화. capability는 `darkMode` | 1~2일 |
| **G7** | **화면 꺼짐 방지** | ①② | 커뮤니티 keep-awake 플러그인 추가. `keepAwake(true/false)`. 웹 표준 Screen Wake Lock API는 WebView 지원 편차가 있어 네이티브가 안전. 뷰어 진입/TTS 재생 중 사용 | 0.5일 |

**Tier 1 합계: 5~6일 (1인 기준)** — ATT 3단 배관이 하루였던 실측 속도 기준. 전부 그보다 작은 작업.

### 1-2. Tier 2 — 선언만 있고 구현이 빈 것 / 중간 난이도

| # | 기능 | 현황 | 구현 방법 | 소요 |
|---|---|---|---|---|
| **G8** | **화면 캡쳐 방지** | `blockCapture?()` 가 `dist/index.d.ts:277`에 **optional 선언만, 구현 없음(no-op)** | **Android**: `FLAG_SECURE` 토글 — AppBridge.kt에 메서드 추가(드물게 Kotlin을 짜야 하는 케이스). **iOS**: OS가 스크린샷 차단 API를 제공하지 않음 → `UIScreen.capturedDidChangeNotification`(녹화 감지) + `willResignActive` 시 블러 오버레이가 한계. **iOS는 "차단 불가"임을 제품 결정으로 확정할 것** | Android 1일 / iOS 2~3일 |
| **G9** | **뷰어 밝기** | `setBrightness?()`/`getBrightness?()` 가 `index.d.ts:281-283`에 **선언만** | 커뮤니티 brightness 플러그인 배선. 앱 종료/백그라운드 시 원복 필수(시스템 밝기를 영구 변경하면 안 됨) | 1일 |
| **G10** | **어트리뷰션 결과 웹 전달** | `initMarketing()`만 있고 앱→웹 push 채널 없음 | 앱이 획득한 어트리뷰션 페이로드를 웹으로 전달하는 규약 추가. `dispatchAppEvent()`(어댑터에 이미 존재)로 `CustomEvent` 발행 + `onAttribution(cb)` 구독 API. **설치 첫 세션에 미전달되는 이슈**가 Flutter 쪽에서 이미 발생했었음(`poptale-app` SCRUM1-697) — 같은 함정을 피하려면 **초기화 완료 전 도착한 값을 버퍼링**해야 한다 | 2~3일 |
| **G11** | **IAP 구독(subscription)** | `getProducts`/`purchase`/`restorePurchases`만 | `cordova-plugin-purchase`의 구독 상품 타입 지원 + 갱신/유예/취소 상태 노출. **서버 알림(App Store Server Notifications / Play RTDN) 수신은 백엔드 몫** — 브릿지는 클라 상태만. `11-IAP.md`도 "난도↑"로 명시 | 2~3주 |
| **G12** | **Android 인앱 업데이트** | `checkForceUpdate` = 버전 비교 + 스토어 유도만 | Play In-App Update(immediate/flexible) 플러그인 배선. Android 전용, iOS는 no-op. `forceUpdate` capability 재사용 | 3~5일 |

**Tier 2 합계: 약 3~4주. 글로벌 1차에 필요한 건 G8·G9·G10 (6~8일)**

### 1-3. Tier 3 — 점진 보완 (1차 완성 보장 안 됨)

**D6은 "전부 포함"이지만 하네스가 일정에서 제외되면서 점진 보완 대상이 됐다.** 셋 다 ⑤단(네이티브 프로젝트 설정)까지 건드려 합계 10~15주다. 출시 후 순차 투입하고, 그 전까지 **웹이 해당 UI를 숨긴다.**

#### G13. 콘텐츠 다운로드 / 오프라인 서재 — 4~6주

Flutter 구현: `poptale://content/download?url=<base64url>` → Drift SQLite 메타 + `archive` 압축해제 +
`path_provider` 파일 배치 + 다운로드 큐/진행률 + `poptale://downloads` 목록 화면.

**범용화 경계를 반드시 나눌 것:**

| 하네스로 승격 (범용) | 웹/앱이 담당 (고유) |
|---|---|
| 다운로드 큐 (동시성 제한·재시도·이어받기) | 회차/시리즈 도메인 모델 |
| 진행률 이벤트 (`onDownloadProgress`) | 다운로드 목록 UI |
| 압축 해제 + 무결성 검증 | 어떤 콘텐츠를 받을지 판단 |
| 저장 용량 조회·삭제·전체 비우기 | 만료/권리 정책 |

API 초안: `download({id, url, checksum})` · `cancelDownload(id)` · `listDownloads()` ·
`deleteDownload(id)` · `storageUsage()` · `onDownloadProgress(cb)`
기반 플러그인: `@capacitor/filesystem` + 백그라운드 다운로드 플러그인.
⚠️ **iOS 백그라운드 다운로드는 `URLSession` background configuration이 필요** — ⑤단.

#### G14. 로컬 WebView (오프라인 열람) — 3~4주

하네스는 `server.url`로 **원격 웹을 로드하는 것이 전제**다. 다운로드한 로컬 HTML을 열려면
**로컬 서빙 모드로 전환하는 구조**가 필요하다. Capacitor는 원래 로컬 번들 서빙이 기본이므로
불가능하진 않지만, 두 모드를 오가는 라우팅·쿠키·오리진 문제를 설계해야 한다.

핵심 난점:
- 원격 오리진(`https://<domain>`)과 로컬 오리진(`capacitor://localhost`)의 **쿠키/세션 분리**
- 로컬 콘텐츠에서 API를 호출할 때 CORS
- 뒤로가기 스택이 두 오리진에 걸침

→ **G13과 반드시 함께 설계할 것.** 따로 하면 두 번 짓는다.

#### G15. TTS — 3~5주

Flutter: `flutter_tts` (`poptale://tts?play=&text=&speed=`).
하네스: **SDK에 메서드 자체가 없다** (`22-NATIVE_FEATURES_PLAN.md`가 "❌ SDK에 없음"으로 명시).

- ①② 단: `@capacitor-community/text-to-speech` 추가 — **쉽다 (2~3일)**
- ⑤ 단: **백그라운드·화면 잠금 중 재생** — iOS `UIBackgroundModes: audio` Capability +
  `AVAudioSession` 카테고리 설정 필요. **`generate-app.mjs`가 pbxproj Capability를 건드리는 첫 사례**가 된다.
  Android는 포그라운드 서비스 + 미디어 세션.
- 미디어 컨트롤(잠금화면 재생/일시정지, 이어폰 버튼)까지 하려면 추가 작업.

> **범용 수요는 확인됐다** — `22-NATIVE_FEATURES_PLAN.md`가 characterchat용으로 동일한 TTS 요구를
> 적어놨다. 즉 이건 Poptale 전용 기능이 아니라 **하네스 코어에 들어갈 값어치가 있다.**

### 1-4. Tier 0 — 글로벌 이전에 하네스 자체가 끝내야 할 것

| # | 항목 | 왜 | 소요 |
|---|---|---|---|
| ~~**G0-1**~~ | ~~iOS 빌드 검증~~ | 🟢 **완료.** `README.md:166`의 "미검증 — Windows 환경에서 작성"은 **stale**이다. 2026-08-05~08-19에 iOS 원격 푸시 네이티브 배선 · `GoogleService-Info.plist` 주입 경로 정합 · associated-domains 배포 함정 재발방지 + `regen_profile` lane · NSE 서명 배선 · Apple 팀 ID 반영 완료. fastlane `ios build`(.ipa, match) / `ios beta`(TestFlight) 동작 중 | **0** (새 슬러그 첫 빌드 2~3일은 셋업에 흡수) |
| **G0-2** | **푸시 경로 화이트리스트** | `POPTALE-MIGRATION.md §5` P0 미구현. config `features.pushPolicy.allowedPaths`는 스키마에 있으나 native 측 라우팅 prefix 매칭이 없음. 푸시 네이티브 배선 자체는 이미 완료라 prefix 매칭만 추가. **보안 항목** | 3~5일 |

> ⚠️ **`README.md`의 "현재 상태(정직)" 섹션을 갱신할 것.** iOS 미검증 표기가 남아 있으면
> 다른 사람도 같은 오추정을 반복한다.

### 1-5. 하네스 작업 총량 — 참고용 (일정 트랙 아님)

**추정 근거 — 관측된 실제 속도**: 2026-08-18 하루에 `15-APP-GROWTH-FEATURES.md`(804줄) +
ATT 사전동의 배관 + bridge 1.3.0 + NSE 서명 배선이 나왔다. **ATT 3단 배관 전체가 하루**였고,
Tier 1은 전부 그보다 작은 작업이다.

```
[배선 수준 — 약 3주]
G0-2 푸시 화이트리스트  3~5일
Tier 1 (G1~G7)        5~6일
G8 캡쳐 방지           3~4일
G9 밝기                1일
G10 어트리뷰션 전달     2~3일
shim routes 대조       1~2일

[Tier 3 — D6 "다" 결정으로 1차 편입, 10~15주]
G13 다운로드 매니저     4~6주
G14 로컬 WebView       3~4주
G15 TTS                3~5주

[선택 — "다"에 포함 여부 확인]
G11 IAP 구독           2~3주
G12 인앱 업데이트       3~5일

합계 = 1인 기준 16~22주 · 2인 기준 8~11주
```

> **일정에서 제외됐으므로 위 수치는 보완 규모의 참고값이다.** 배선 3주분은 W1에 확보된 것으로 보고,
> Tier 3는 출시 후 순차 보완한다. **보완 순서는 G15(TTS) → G13+G14(오프라인) 권장** —
> TTS가 단독으로 붙일 수 있고 사용자 체감이 큰 반면, G13·G14는 함께 설계해야 해서 덩어리가 크다.
>
> G13·G14는 **함께 설계할 것** (두 오리진 쿠키·CORS). G15는 `generate-app.mjs`가
> pbxproj Capability(`UIBackgroundModes: audio`)를 건드리는 첫 사례가 된다.

### 1-6. 글로벌에 불필요한 기존 P0 (참고)

`POPTALE-MIGRATION.md §5`의 P0 6건 중 **4건이 한국 전용**이라 글로벌에서는 대기할 필요가 없다.

| 항목 | 글로벌 | 대체 |
|---|---|---|
| Kakao Capacitor 플러그인 | 불필요 | — |
| Naver Capacitor 플러그인 | 불필요 | — |
| Adbrix provider | 불필요 | AppsFlyer(이미 배선됨) 또는 Firebase |
| WhaTap APM | 불필요 | Sentry / Datadog |

---

## 2. B. 새 앱 작업 — 반드시 앱마다 해야 하는 것

`generate-app.mjs`가 대신 해주는 것과, 사람이 반드시 해야 하는 것을 먼저 나눈다.

### 2-0. 자동 vs 수동 경계

| 하네스가 자동으로 함 (config만 쓰면 됨) | 사람이 반드시 해야 함 |
|---|---|
| Capacitor 프로젝트 생성 | Firebase 프로젝트 3개 생성 (콘솔) |
| feature 플래그 → 플러그인 npm 설치 | 소셜 로그인 콘솔 앱 등록 (client ID·redirect URI) |
| iOS Info.plist 권한 문구 주입 | IAP 상품 등록·통화별 가격 티어 입력 |
| 마케팅 SDK 패키지 배선 | 아이콘/스플래시 **원본 디자인** |
| 아이콘/스플래시 전 사이즈 리사이즈 (`generate-assets`) | 서명키 생성·match 등록·GitHub Secrets 값 |
| **AASA / assetlinks.json 생성** ⭐신규 | 생성된 파일을 웹루트 `.well-known/`에 **배치·서빙** |
| fastlane lane · CI 워크플로 | **글로벌 웹 i18n + 한국 전용 제거** |
| 안전영역·다크모드·오프라인 폴백 셸 | 스토어 빌드 업로드·심사 대응 |

> **범위 밖**: 백엔드 인프라·엔드포인트(미산정) · 법인·스토어 계정·콘텐츠 권리·약관 작성(사업·법무 소관).

### 2-1. 우선순위 순 작업 목록

난이도: **하** = 정해진 절차 · **중** = 설계/판단 필요 · **상** = 불확실성 큼
유형: 🙋 사람·외부기관 · 💻 개발 · 🎨 디자인

> ### 🔴 이 §2의 범위 — 프론트(웹) + 앱만
>
> **백엔드·인프라·아키텍처는 산정하지 않았다.** 아래 목록과 일정은 웹과 앱만 계산한 값이며,
> 백엔드가 크리티컬 패스가 되면 그대로 늘어난다. 미포함 항목:
>
> | 영역 | 상태 |
> |---|---|
> | 인프라 분리 (리전·서버·DB·배포) | 미산정 (참고 추정 4~6주, 미검증) |
> | 인증·결제 엔드포인트 (`/auth/native` `/guest` `/device` `/delete` `/iap/verify`) | 미산정 (참고 추정 3~4주, 미검증) |
> | 데이터·콘텐츠 파이프라인 (글로벌 노출 필터링·다국어 메타·CDN) | 산정 안 됨 |
> | 정산·세금·지갑 | 산정 안 됨 |
> | 법인·스토어 계정·콘텐츠 권리·약관 작성 | 사업·법무 소관 — 개발 관여 사항 아님 |
>
> **총 소요를 말할 때는 반드시 백엔드 산정을 받아 합산할 것.**

#### P0 — W1. 뒤 작업 전부를 막는 것

| # | 작업 | 담당 | 소요 | 난이도 | 비고 |
|---|---|---|---|---|---|
| **N1** | **fork vs 같은 레포 + 지역 플래그** 판단 | 웹 | 3일 | 중 | **나중에 뒤집으면 i18n 작업 전체를 다시 해야 함** |
| **N2** | 기술 결정 — 출시 언어 수 / 계정 통합 여부 / 1차 기능 범위 | 기획 | 1주 | 중 | 미결 시 i18n·인증 착수 불가. 가격 *값*은 사업에서 수령 |
| **N3** | macOS 빌드 환경 / CI 러너 확보 | 앱 | 1주 | 중 | 새 슬러그 첫 iOS 빌드의 선행 조건 |

#### P1 — 초기 셋업 (W1~W3). 짧지만 뒤 작업 전부의 선행

| # | 작업 | 담당 | 소요 | 난이도 | 비고 |
|---|---|---|---|---|---|
| **N4** | 슬러그·번들ID·도메인 확정 → `apps/<slug>/app.config.json` | 앱 | 3일 | 하 | `aipiaPreset()`로 90% 자동 생성. `node scripts/doctor.mjs` 통과가 완료 기준 |
| **N5** | Firebase 프로젝트 3개 생성 + `google-services.json`/`GoogleService-Info.plist` 배치 | 앱 | 3일 | 하 | `{env}-aipia-<slug>` 컨벤션. 파일은 secrets로 |
| **N6** | 아이콘·스플래시 원본 제작 → `generate-assets` | 디자인 | 1~2주 | 하 | 리사이즈는 자동. 원본만 만들면 됨 |
| **N7** | 소셜 로그인 콘솔 등록 (Google / Apple) | 앱 | 1주 | 하 | Kakao/Naver 불필요(제품 결정). **하네스는 7종을 공통 지원**하므로 수단 추가는 config `providers` 배열만 바꾸면 된다 |
| **N8** | 서명키 생성 · fastlane match · GitHub Secrets | 앱 | 1주 | 중 | 스토어 계정 준비 시점에 착수. `08-DEPLOY.md` 절차 |

#### P2 — 본 개발 (W2~W15). 프론트만 — 백엔드 미포함

| # | 작업 | 담당 | 소요 | 난이도 | 비고 |
|---|---|---|---|---|---|
| **N9** | **글로벌 웹 — i18n 인프라 + 문자열 추출** | 웹 | **5~7주** | **상** | 🔴 **크리티컬 패스.** 537파일 · 7,019 한글라인. 양은 크지만 예측 가능 |
| **N10** | 글로벌 웹 — 한국 전용 제거 | 웹 | 3~4주 | 중 | PortOne 본인확인 · 이메일가입 · `findid`/`findpwd` · `youth` · 부모동의 |
| **N11** | 글로벌 웹 — 인증 재구성 + API 도메인 분기 | 웹 | 2주 | 중 | Kakao/Naver 제거, Google/Apple 중심. **위탁 구조를 따른다** — 팝챗 계약(`be-auth-contract.md`)이 그대로 재사용된다. **백엔드 엔드포인트 규격 확정이 선행** |
| **N12** | 번역 + 다국어 레이아웃 QA | 번역·웹 | 3~4주 | 중 | N9와 일부 병렬. 번역은 외주 가능, 레이아웃 수정은 웹 |
| **N13** | 웹 ↔ 브릿지 연동 — `initHarness()` · `installAppChannelShim({scheme})` | 웹·앱 | **3일~1주** | 하 | **웹이 이미 AppChannel 20종 호출 중 → 거의 무수정.** shim routes 1:1 대조만 필요 |
| — | 🔴 **백엔드 인프라 분리 · 엔드포인트** | 백엔드 | **미산정** | — | **이 계획에 포함되지 않음.** `25-AUTH-DELEGATION.md`(인증 위탁) · `docs/11-IAP.md` 규약을 백엔드 팀에 전달하고 산정을 받을 것. **회원탈퇴 엔드포인트는 스토어 정책상 필수** |

#### P3 — 출시 준비 (W10~W22)

| # | 작업 | 담당 | 소요 | 난이도 | 비고 |
|---|---|---|---|---|---|
| **N14** | IAP 상품 등록 + 통화별 가격 티어 입력 | 앱 | 1주 | 중 | 가격 *값*은 사업에서 수령, 등록은 개발. 가격은 config가 아니라 **스토어 콘솔** |
| **N15** | 마케팅 SDK 대시보드 앱 등록 | 앱 | 3일 | 하 | AppsFlyer 등 (Adbrix 불필요) |
| **N16** | 푸시 화이트리스트 경로 정의 + AASA 호스팅 배치 | 앱·웹 | 3일 | 하 | G0-2 선행. **AASA/assetlinks 파일 자체는 `generate-app.mjs`가 자동 생성** — 웹이 `.well-known/`에 배치·서빙 |
| **N17** | 스토어 개인정보 라벨 · 데이터 안전성 양식 작성 | 앱 | 3일 | 하 | 수집 항목 목록은 개발 산출물. `17-DATA-COLLECTION.md` 양식. **약관·처리방침 본문 작성은 법무 소관** |
| **N18** | 통합 QA + 기기 매트릭스 | QA | 4주 | 중 | `19-DEVICE-SUPPORT.md`. **백엔드 스테이징 없으면 착수 불가** |
| **N19** | 스토어 빌드 업로드 + 심사 대응 + 소프트런칭 | 앱 | 3~4주 | 중 | **Apple 4.2 리스크는 낮음** — 웹이 네이티브 기능 20종을 실제로 호출하므로 순수 래퍼 판정 근거가 약함 |

#### 인계 지점 — 여기서 막히면 상대 트랙이 멈춘다

| 인계물 | 주는 쪽 → 받는 쪽 | 데드라인 | 늦으면 |
|---|---|---|---|
| 엔드포인트 규격 | 백엔드 → 웹 | W4 | N11 인증 재구성 착수 불가 |
| 아이콘·스플래시 원본 | 디자인 → 앱 | W4 | `generate-assets` 실행 불가 → 빌드 미완 |
| 브릿지 메서드 (G1~G10) | 앱 → 웹 | W5 | 웹이 N13 브릿지 연동 못 함 |
| 🔴 **글로벌 백엔드 스테이징** | 백엔드 → 웹·QA | **W8** | **M2 결제·인증 검증과 M3 통합 QA가 통째로 밀림** |
| 추출된 문자열 키셋 | 웹 → 번역 | W10 | 번역 착수 불가 → N12 지연 |
| 번역 결과 | 번역 → 웹 | W14 | 레이아웃 QA 착수 불가 → M3 지연 |

#### 🔴 변동 시나리오 — 백엔드 합산 시 총 소요

프론트+앱만 계산하면 **19~22주(≈4.5~5개월)**. 백엔드를 합치면 다음과 같이 달라진다.

| 백엔드 상황 | 총 소요 | 왜 |
|---|---|---|
| 글로벌 스테이징이 **W8까지** 제공 | **19~22주 유지** | 웹 트랙과 완전 병렬. 프론트가 크리티컬 패스 유지 |
| 스테이징이 **W12~W14**에 제공 | **23~26주** (+4주) | M2의 결제·인증 완주 검증과 통합 QA가 통째로 밀림 |
| 인프라 분리가 **별도 프로젝트로 분리** | **산정 불가** | 리전·데이터 주권·마이그레이션이 독립 일정. 프론트 완성 후 대기 발생 |
| 백엔드 **착수 시점 미정** | **산정 불가** | 이 계획은 "프론트가 끝나는 시점"만 말할 뿐 출시일을 말하지 못함 |

> **19~22주를 "출시까지 걸리는 기간"으로 인용하지 말 것.** "프론트엔드와 앱이 준비되는 데 걸리는 기간"이다.

### 2-2-A. 🔴 두 앱 공존에서 나오는 함정 — 구현 전 반드시 읽을 것

전제: **웹은 기존 `poptale-frontend`를 확장(단일 코드베이스 + market 플래그), 앱은 글로벌 전용으로 별도 출시.**
웹 코드는 하나인데 앱은 둘이라는 구조에서 아래가 터진다.

| # | 문제 | 왜 | 대응 |
|---|---|---|---|
| ~~T1~~ | ✅ **해소** — 웹 하나가 두 브릿지를 상대 | 국내 = Flutter 네이티브 AppChannel(**동결 운영**), 글로벌 = Capacitor `installAppChannelShim()`. 웹이 규약을 바꾸면 **동결된 Flutter 앱이 못 따라와 국내가 깨진다** | **AppChannel 규약을 동결 취급.** 신규 기능은 기존 액션을 확장하지 말고 **새 액션으로만** 추가. 글로벌 전용 액션은 shim에서만 처리 |
| T2 | 완화 — URL 스킴 충돌 | 두 앱이 같은 `poptale://`를 주장하면 둘 다 설치된 기기에서 어느 앱이 열릴지 OS가 보장하지 않음(iOS 미정의, Android 선택 다이얼로그). 웹에 **48곳 하드코딩** — `src/stores/app/client.ts`에 40곳 집중 | 웹에서 스킴을 상수로 추출 → market 플래그 분기. `installAppChannelShim({ scheme })`에 넘기는 값도 같이. 글로벌은 `poptale-global://` 등 별도 스킴 |
| **T3** | **AASA / Universal Links 충돌** | `generate-app.mjs`의 `collectAppsByHost()`가 **호스트별로 앱 appID를 모아 한 파일에 넣는다.** 같은 도메인에 두 앱이 걸리면 딥링크 목적지가 불확정 | **도메인 완전 분리.** `navigation.allowedDomains`도 각각. 같은 도메인에 두 앱을 절대 걸지 말 것 |
| ~~T4~~ | ✅ **해소** — 릴리스 커플링 | 같은 웹 코드베이스 = 글로벌 hotfix가 국내 배포를 유발하거나, 국내 미완성 기능이 글로벌에 노출 | 배포 파이프라인 독립 + feature flag. 브랜치 전략을 W1에 확정 |
| **T5** | Apple 4.3 (Spam / Repackaging) | 같은 개발자 계정에서 기능이 거의 동일한 앱 2개 | **스토어 배포 국가를 겹치지 않게** — 국내 앱 KR only / 글로벌 앱 KR 제외. 심사 노트에 명시 |
| **T6** | 계정 통합이 사실은 백엔드 결정 | "계정 통합"을 택하면 백엔드 완전 분리와 **모순** — 인증·지갑이 한 곳에 있어야 함 | 계정 정책이 아니라 백엔드 아키텍처 결정으로 다루고, 백엔드 산정 요청에 포함 |

> **가장 위험한 건 T1.** T2·T3·T5는 설정으로 막히지만 T1은 규약 drift라 조용히 쌓이다가 국내 앱에서 터진다.
> 부수적으로 **Amplitude·AppsFlyer 키**와 **IAP `storeId`**도 market 분기가 필요하고
> (번들이 다르므로 storeId가 다름), 두 도메인 유사 콘텐츠는 hreflang/canonical 처리가 필요하다.

#### ~~market 플래그 분기 — 구현 형태~~ 🚫 미채택

> **D3에서 "팝테일과 분리"가 확정돼 market 플래그는 쓰지 않는다.** 아래는 단일 코드베이스안을 택했을 때의 참고 자료로만 남긴다.
> 실제로는 글로벌 웹에서 한국 전용을 **삭제**하고, 언어 전환은 i18n locale로만 처리한다.
> 단 **KO가 글로벌 빌드에 포함**되므로 "언어≠에디션" 원칙은 그대로 유효하다.

```ts
// src/config/market.ts — 단일 진실 공급원
export const MARKET = process.env.NEXT_PUBLIC_MARKET as 'kr' | 'global';
export const isKR = MARKET === 'kr';
export const isGlobal = MARKET === 'global';
```

`NEXT_PUBLIC_*`는 Next.js가 **빌드 타임에 리터럴로 치환**하므로 반대편 분기는 tree-shaking으로 제거된다.

분기는 4개 층위에서:

1. **라우트 레벨** (`src/middleware.ts`) — 한국 전용 라우트를 통째로 차단.
   `/youth` `/findid` `/findpwd` `/payment` `/payment-form` `/grade` `/contest` `/event/candy` `/info/setting/marketing-agree`
2. **설정 레벨** — 소셜 프로바이더 목록, IAP `storeId` 맵, 분석 키
3. **컴포넌트 레벨** — 라우트로 안 잘리는 것만. PortOne 본인확인(`signup.AgreeOrganism` · `signup.EmailOrganism` · `signup.ParentAgreeOrganism`)
4. **환경 레벨** — `.env.kr` / `.env.global` (API 도메인 · 쿠키 도메인 · CDN)

> ⚠️ **market(에디션)과 i18n locale(언어)은 다른 축이다.** 글로벌 빌드 하나 안에서 언어가 여럿이다.
> 둘을 묶으면 *"일본어면 PortOne 끄기"* 같은 잘못된 결합이 생긴다.
>
> 원칙 두 가지: **플래그는 `market` 하나만** (국가별 차이는 플래그가 아니라 설정 데이터로),
> **라우트·모듈 경계에서 끊고 컴포넌트 내부 `if`는 최소화**.
>
> 상시 비용: **CI에서 두 빌드를 모두 돌려야 한다.** 국내 개발자가 글로벌을 의식하지 않고 코드를 넣으면 조용히 깨진다.

### 2-2. 주의점 — 반복해서 터지는 것들

- **iOS 권한 문구 누락 = 즉시 크래시.** `generate-app.mjs`의 `IOS_USAGE`가 자동 주입하지만,
  **새로 추가한 플러그인은 매핑을 같이 넣어야 한다.** 안 넣으면 권한 요청 순간 앱이 죽는다.
- **feature 플래그가 false면 코드가 있어도 동작하지 않는다.** `deriveCapabilities()`가 게이트한다.
  "구현했는데 안 돼요"의 8할이 이것.
- **시크릿을 config·레포에 절대 넣지 않는다.** GitHub Secrets / fastlane match / 환경변수만.
- **프로덕션 스토어 공개는 사람이 승인.** 자동화는 베타/내부 트랙까지 (`README.md` 안전 원칙).
- **회원탈퇴 엔드포인트 없으면 스토어 리젝.**
- **Apple 4.2 (Minimum Functionality)** — 웹뷰 래퍼로 보이면 리젝. 푸시·IAP·공유·딥링크·
  오프라인 폴백이 실제 동작함을 심사 노트에 명시할 것.

---

## 3. 부록 — 기능 격차표 전문

`poptale-app`(Flutter) 기능 → 글로벌(웹+Capacitor) 대응.
분류: 🟢 하네스 커버 · 🔵 웹 재구현 · 🟠 네이티브 신규 · ⚪ 글로벌 제외

| 기능 | 현행 구현 | 글로벌 대응 | 분류 | 대응 항목 |
|---|---|---|---|---|
| 뷰어 (본문 렌더) | **이미 WebView** (`s_viewer.dart` 79줄) | **이미 웹에 존재** (`app/viewer/page.tsx`) | 🟢 | **작업 없음.** `poptale_viewer` 패키지는 빈 껍데기 |
| 오프라인 다운로드 | Drift + `archive` + `path_provider` | 하네스 P1 미구현 | 🟠 | G13 |
| 로컬 WebView 열람 | `webview_flutter` + 로컬 HTML | 로컬 서빙 모드 신규 | 🟠 | G14 |
| TTS | `flutter_tts` | SDK에 메서드 없음 | 🟠 | G15 |
| 화면 캡쳐 방지 | 네이티브 (Viewer 경로) | 선언만, no-op | 🟠 | G8 |
| 화면 밝기 | `screen_brightness` | 선언만, no-op | 🟠 | G9 |
| 어트리뷰션 | `adbrix_plugin` (DFINERY) | AppsFlyer / Firebase | 🟠 | G10 + N15 |
| 앱 배지 | `flutter_app_badge_control` | 없음 | 🟠 | G5 |
| 네이티브 로딩 커버 | `action/loading?value=hide` | 없음 | 🟠 | G1 |
| FCM 토픽 구독 | `notification/subscribe/{topic}` | 없음 | 🟠 | G2 |
| OS 설정 열기 | `open_settings_plus` | 없음 | 🟠 | G3 |
| 스토어 열기 | `StoreLauncher.openStore()` | 없음 | 🟠 | G4 |
| 런타임 테마 | `theme?mode=` | config 플래그만 | 🟠 | G6 |
| 화면 꺼짐 방지 | `wakelock_plus` | 없음 | 🟠 | G7 |
| Android 인앱 업데이트 | `in_app_update` | 버전 비교만 | 🟠 | G12 |
| IAP 구독 | `subscription` 액션 | 미지원 | 🟠 | G11 |
| 기기 관리 (다중 기기) | 전용 화면 + `device_info_plus` | 백엔드 + 웹 | 🔵 | **백엔드(미산정)** + 웹 · **하네스 승격 불필요** |
| 뷰어 진입/이탈 알림 | `poptale://viewer` | `autoBlockCaptureOnPaths()` | 🔵 | (**승격 불필요 — 경로 기반이 더 범용적**) |
| 소셜 로그인 (Google/Apple) | `google_sign_in`, `sign_in_with_apple` | 하네스 표준 | 🟢 | N7 + N13 · **백엔드 세션 발급은 미산정** |
| 인앱결제 기본 | `in_app_purchase` | `cordova-plugin-purchase` | 🟢 | N14 · **영수증 검증 백엔드는 미산정** |
| 푸시 (FCM) | `firebase_messaging` | `features.push` | 🟢 | N5 · N16 |
| 딥링크 | `app_links` | `features.deepLink` | 🟢 | N16 (AASA는 자동 생성) |
| 강제 업데이트 | `in_app_update` | `features.forceUpdate` | 🟢 | N4 · N5 (Remote Config 기반) |
| 공유 | `share_plus` | `features.share` | 🟢 | N13 |
| 원격 설정 | `firebase_remote_config` | `firebase.remoteConfig` | 🟢 | N5 |
| 크래시 리포팅 | `firebase_crashlytics` | `monitoring.crash` | 🟢 | N5 |
| 분석 | `amplitude_flutter` | `analytics.amplitude` | 🟢 | N13 · N15 |
| ATT (추적 동의) | `app_tracking_transparency` | `requestTracking()` | 🟢 | **3단 완비 — 배선 레퍼런스** |
| 오프라인 감지 | `connectivity_plus` | 폴백 셸 + 웹 | 🟢 | N13 |
| 로컬 알림 | `flutter_local_notifications` | `features.localNotification` | 🟢 | N4 |
| 이미지 첨부 | `image_picker` | `features.camera` | 🟢 | N4 |
| AppChannel 브릿지 | `window.AppChannel.postMessage` | `installAppChannelShim()` | 🟢 | N13 |
| 소셜 로그인 (Kakao/Naver) | `kakao_flutter_sdk_user` 외 | — | ⚪ | **하네스 P0 부담 2건 소멸** |
| APM | WhaTap | Sentry / Datadog | ⚪ | 글로벌 대체 |
| 성인인증 (PASS/NICE) | 웹 플로우 | — | ⚪ | 별도 연령 게이팅 정책 필요 |

> ⚠️ **착수 전 확인 2건**
>
> 1. **shim routes 1:1 대조** — 웹이 실제로 호출하는 액션은 §0-A-3의 **20종**이다.
>    `installAppChannelShim()`의 `routes` override가 이 20종을 전부 커버하는지 대조할 것.
>    누락되면 해당 기능이 앱에서 조용히 무동작한다.
> 2. **AppChannel 규약 정본 위치** — `poptale-app/.claude/docs/app-web-connection.md`
>    (`POPTALE-MIGRATION.md:64`가 지목)가 `origin/main` 워크트리에 존재하지 않는다.
>    정본이 어디로 갔는지 확인 후, 없다면 §0-A-3의 20종을 근거로 규약을 재작성할 것.

---

## 4. 어디서 무엇을 찾는가

| 필요한 것 | 위치 |
|---|---|
| 전사 컨벤션 (번들ID·도메인·SDK) | [`01-AIPIA-CONVENTIONS.md`](./01-AIPIA-CONVENTIONS.md) |
| 하네스 사용법 마스터 · config 스키마 정본 | [`02-GUIDE.md`](./02-GUIDE.md) §6 |
| 새 서비스 추가 전체 흐름 | [`ONBOARDING.md`](../ONBOARDING.md) |
| 웹 통합 API · 어댑터 | [`06-INTEGRATION.md`](./06-INTEGRATION.md), `template/integration/harness-adapter.js` |
| **인증 — 위탁 규약(정본)** | [`25-AUTH-DELEGATION.md`](./25-AUTH-DELEGATION.md) |
| 인증 — 게스트/탈퇴/기기세션 | [`10-AUTH.md`](./10-AUTH.md) — **Keycloak 절은 레거시** |
| 인앱결제 정책·구현 | [`11-IAP.md`](./11-IAP.md) |
| 개인정보/권한/연령등급 | [`16-COMPLIANCE.md`](./16-COMPLIANCE.md), [`17-DATA-COLLECTION.md`](./17-DATA-COLLECTION.md) |
| CI/배포/시크릿/서명 | [`08-DEPLOY.md`](./08-DEPLOY.md), [`07-HOWTO-DEPLOY.md`](./07-HOWTO-DEPLOY.md) |
| 기기/OS 지원 범위 | [`19-DEVICE-SUPPORT.md`](./19-DEVICE-SUPPORT.md) |
| 푸시 셋업 | [`12-PUSH-NOTIFICATIONS.md`](./12-PUSH-NOTIFICATIONS.md) |
| 네이티브 기능 가능/불가 매트릭스 | [`22-NATIVE_FEATURES_PLAN.md`](./22-NATIVE_FEATURES_PLAN.md) §2 |
| 국내 마이그레이션 (별건) | [`21-POPTALE-MIGRATION.md`](./21-POPTALE-MIGRATION.md) |
| 계획·일정·판정 | `poptale-app/.claude/docs/global-launch-plan.md` |

---

**Last Updated**: 2026-09-01 — 경로·링크 정리 (본문 내용 최종 갱신은 2026-08-19)
