---
doc: 21
title: POPTALE-MIGRATION — Poptale Flutter → Capacitor 하네스 이전
category: 마이그레이션
audience: 전체
status: active
updated: 2026-10-07
---

# POPTALE-MIGRATION — Poptale Flutter → Capacitor 하네스 이전

> 이 문서는 **인계 문서**다. 신규 앱(프로토타입) 출시를 맡은 담당자가 가장 먼저 읽는다.
> Poptale Flutter 앱(`aipia-team/poptale-app`)을 하네스 기반 Capacitor 앱으로 옮길 때
> *무엇이 호환되어야 하고, 누가 무엇을 책임지는지*가 이 문서에 모여 있다.
>
> 📌 **선행 필독**: [`01-AIPIA-CONVENTIONS.md`](./01-AIPIA-CONVENTIONS.md) — 번들ID/도메인/소셜/SDK 등 *전사 표준*.
> 이 문서는 AIPIA-CONVENTIONS 위에 *Poptale 특이값* 만 다룬다.
>
> 🆕 **2026-10-07 — 실제로 가는 길은 §10(V2 경로)이다.** 옛 웹(`poptale-frontend`)에 shim 을 붙이는 §3~§9 대신, 새 리더 웹
> (`poptale-web-v2`)을 `apps/poptale-v2-dev` 셸에 올려 검증하고, 운영 전환 때 같은 번들(`com.aipia.poptale`)로 교체한다.
> §1~§9 는 레거시 Flutter 앱과 호환해야 할 항목 목록으로 그대로 유효하다.

---

## 0. 한 줄 요약

> **10주 후 프로토타입 신규 앱 출시 → 하네스를 다듬는다 → 그 결과물로 Poptale 을 같은 번들 ID
> (`com.aipia.poptale`)로 점진 교체.** Flutter 앱은 그동안 긴급 패치만 받으며 *동결 운영* 중.

---

## 1. 현재 운영 자산 (이전 대상)

| 항목 | 현황 | 위치 |
|---|---|---|
| **Flutter 앱** | v1.1.15+183 (2026-05-18), 적극 동결 운영 | [aipia-team/poptale-app](https://github.com/aipia-team/poptale-app) |
| **웹 프론트** | Next.js 15 + Vite, dark/light 양립 | [aipia-team/poptale-frontend](https://github.com/aipia-team/poptale-frontend) |
| **백엔드** | Spring MSA (`*.api.poptale.ai`, swagger 38082/38083/38084/38088) | (별도) |
| **Firebase 프로젝트** | `dev-aipia-poptale` / `stage-aipia-poptale` / `aipia-poptale` | Firebase Console |
| **번들 ID** | prod/stage: `com.aipia.poptale`, dev: `com.aipia.poptale.dev` | — |
| **도메인** | prod `poptale.ai`, stg `stg.poptale.ai`, dev `dev.poptale.ai` | — |

---

## 2. 책임 분담 — 누가 무엇을 한다

| 주체 | 책임 |
|---|---|
| **하네스(이 레포)** | 네이티브 셸 + `@harness/bridge` + 빌드/배포 자동화. config 1개로 환경 분기. |
| **웹(`poptale-frontend`)** | `@harness/bridge` import + `if (isNative) AppBridge.*` 분기. **앱화를 위해 거의 손대지 않는다**(AppChannel 호환 shim 덕분). |
| **백엔드** | `/auth/native`, `/auth/signup`, `/auth/guest`, `/auth/device`, `/iap/verify`, FCM 토큰 처리, Google purchase token 압축 포맷 수용. |
| **콘솔(사람)** | App Store Connect / Play Console — 같은 번들 ID 업데이트 시 IAP 상품 / 개인정보 라벨 / 스토어 정책. Kakao/Naver Developer Console 에 *커스텀 스킴 redirect(`com.aipia.poptale://oauth/<p>`) 추가 등록*(키 해시는 네이티브 SDK 전용 — 불필요). |
| **DevOps** | GitHub Secrets (서명·match·플레이 서비스계정), CI macOS 러너 비용. |

> **변경 금지**: Flutter 앱(`poptale-app`)은 긴급 패치만. 신기능 추가 금지. RemoteConfig 로 우회 가능한 건 RC 로.

---

## 3. 호환성 매트릭스 — 같은 번들 ID 업데이트의 10대 리스크

`com.aipia.poptale` 을 Flutter → Capacitor 로 *덮어쓰는* 순간 깨질 수 있는 항목들.
**프로토타입 신규 앱 출시 단계에서 미리 검증해두면 Poptale 마이그 비용 1/10**.

| # | 항목 | 위험 | 대응 |
|---|---|---|---|
| **1** | **IAP 영수증 포맷** | Flutter `in_app_purchase` 영수증 + Google purchase token 압축(0.28.21+102). Capacitor `cordova-plugin-purchase` 표준과 다름. | `verifyEndpoint` 백엔드를 **두 포맷 동시 수용**. config `iap.googleTokenCompression: true` 로 토큰 압축 활성. 6개월 후 구포맷 폐기 결정. |
| **2** | **저장소 데이터** | Flutter: `flutter_secure_storage` + `shared_preferences` + Drift SQLite. Capacitor: `@capacitor/preferences` + `@capacitor/secure-storage`. **키 이름/위치 다름**. | 자동 로그인 끊김 허용(웹 쿠키는 도메인 단위라 살아있음) + 다운로드 콘텐츠는 **재다운로드 안내 배너**. |
| **3** | **App Links / Universal Links** | 도메인 검증 파일(`apple-app-site-association`, `assetlinks.json`)은 도메인 호스팅 — 그대로 유지 OK. Capacitor `associatedDomains` 설정만 동일하게. | `apps/poptale/app.config.json` 의 `navigation.allowedDomains` 동일. iOS pbxproj `associated-domains` 엔타이틀먼트 *수동 확인* 필요(첫 macOS 빌드). |
| **4** | **Kakao/Naver 로그인 방식** | Flutter 는 네이티브 SDK(카카오톡 앱 점프). 하네스는 **브라우저 OAuth(길 B)** 만 지원 — 네이티브 SDK 플러그인은 만들지 않기로 했다(2026-09-11, 25 §3). Android 키 해시 등록은 네이티브 SDK 전용이라 **불필요**. 대신 공급자 콘솔에 커스텀 스킴 redirect(`com.aipia.poptale://oauth/<p>`)가 필요하다. | Poptale 용 Kakao/Naver 앱에 커스텀 스킴 redirect **추가 등록**(기존 Flutter 설정은 유지). 앱 점프 UX 포기는 제품에 공유. |
| **5** | **FCM 토큰** | Firebase 프로젝트 동일하면 앱 첫 실행 시 토큰 재발급 → 백엔드에 `/auth/device` 로 자동 갱신. | 동일 Firebase 프로젝트 3개(`*-aipia-poptale`) 그대로 사용. config `firebase.enabled: true` + `fcm: true`. |
| **6** | **Sign In with Apple App ID** | 같은 번들이라 그대로 동작. | 변경 없음. |
| **7** | **App Tracking Transparency (ATT)** | iOS 14.5+ 동의 흐름. Adbrix/Amplitude init 전 호출. | `AppBridge.requestTracking()` (initHarness 안에서 자동). `permissions.idfa.purpose` 명시. |
| **8** | **화면 캡쳐 방지** | Flutter `0.28.26+108` — Viewer 경로에서만. | config `features.viewer.captureBlock.paths: ["/viewer"]` + 어댑터 `autoBlockCaptureOnPaths()` 자동 토글. |
| **9** | **푸시 경로 화이트리스트** | Flutter 1.1.9+176 정책 (`/recommend`, `/detail/{id}`, `/viewer`, `/event(/*)`, `/info(/notice\|/inquiry)` 외 진입 차단). | config `features.pushPolicy.allowedPaths` 로 동일 정책 표현. native 측에서 FCM data.link 라우팅 시 prefix 매칭. |
| **10** | **AppChannel 브릿지 규약** | 웹 → 앱: `window.AppChannel.postMessage("poptale://...")`. 앱 → 웹: `CustomEvent('poptaleApp', { detail })`. | config `features.appChannelCompat: true` + 어댑터 `installAppChannelShim({ scheme: 'poptale' })` 폴리필. **기존 웹 코드 무수정 동작**. |

> ⚠️ **정본 문서**: Poptale 의 `.claude/docs/app-web-connection.md`(`poptale-app` 레포)가 AppChannel 규약의 정본. shim 의 `routes` override 를 이 문서에 정확히 맞춰야 한다.

---

## 4. 10주 역산 일정

**원칙**: 신규 프로토타입 앱은 베타까지만. Poptale 에 쓸 자산은 그 과정에 *동시* 일반화.

| 주차 | 신규 앱 트랙 | 하네스 일반화 트랙 |
|---|---|---|
| W1 | 신규 슬러그/번들ID/도메인 확정, 아이콘/스플래시 발주 | 신규 앱이 즉시 쓸 항목 식별(Kakao/Naver/Adbrix/Amplitude) |
| W2 | `gradlew assembleDebug` 첫 빌드, 실기기 확인 | ~~Kakao 네이티브 플러그인~~ → 브라우저 OAuth(길 B)로 대체, 플러그인 없음 |
| W3 | 4종 소셜 로그인 결선 | ~~Naver 네이티브 플러그인~~ → 같음. 공급자 콘솔 redirect 등록만 |
| W4 | IAP 상품 등록, 영수증 검증 결선 | IAP Google 토큰 압축 옵션 |
| W5 | FCM 푸시 + 딥링크 + 화이트리스트 | 푸시 화이트리스트 모듈(`pushPolicy.allowedPaths` 소비) |
| W6 | **iOS 첫 빌드**(macOS 러너), TestFlight | **Adbrix provider**, **Amplitude 이벤트 표준** |
| W7 | 화면캡쳐 방지·밝기·ATT·다크모드 | WebView UX 모듈 (`features.viewer.*`) |
| W8 | 베타 dogfooding, 회귀 패치 | **WhaTap APM** (`monitoring.apm.whatap`) |
| W9 | 베타 2차, Poptale 호환 매트릭스 검증 | 본 문서 §3 항목별 PASS/FAIL 표 작성 |
| W10 | **프로토타입 베타 출시**, Poptale Phase C plan 확정 | 마이그레이션 dry-run |

W6 의 iOS 첫 빌드 검증이 가장 큰 리스크 포인트. macOS 러너 비용·CI 셋업은 W1 부터 동시 진행.

---

## 5. 하네스 일반화 백로그 (우선순위)

P0 = 10주 안에 반드시. P1 = Poptale 마이그 직전. P2 = 이후.

| 우선 | 항목 | 작업 폴더 / 변경점 | 참고 |
|---|---|---|---|
| ~~P0~~ | ~~Kakao/Naver Capacitor 플러그인~~ | (삭제 2026-09-11) | 네이티브 SDK 는 만들지 않는다 — 브라우저 OAuth(길 B). "카카오톡 앱 점프" UX 는 포기(25 §3) |
| **P0** | IAP Google 토큰 압축 옵션 | `template/bridge/dist/index.js` `purchase()` | Poptale 0.28.21+102 |
| **P0** | Adbrix provider | `template/plugins/adbrix/`, `13-MARKETING.md §4` 절차 | Poptale 1.1.13+181 (DFINERY) |
| **P0** | Amplitude 이벤트 스펙 | `template/bridge/dist/index.js` `track()` | `app_*/push_*/sns_*/iap_*` lowercase snake_case (Poptale 1.1.8+175) |
| **P0** | WhaTap APM provider | `template/plugins/whatap/` | — |
| **P0** | 푸시 경로 화이트리스트 | bridge native side (Android FCM service / iOS notification handler) | config `features.pushPolicy.allowedPaths` |
| **P0** | WebView UX 모듈 | bridge native + adapter `autoBlockCaptureOnPaths()` | `features.viewer.{captureBlock,brightness}` |
| **P1** | Firebase Remote Config 통합 | bridge `getRemoteConfig(key)` | Poptale 1.1.0+154 |
| **P1** | AppChannel 호환 어댑터 | adapter `installAppChannelShim()` ✅ | 이미 구현됨 — Poptale 규약 정본에 맞춰 routes 보강 |
| **P1** | 다중 Firebase flavor 자동 배치 | `scripts/generate-app.mjs` | google-services.json / GoogleService-Info.plist |
| **P1** | 오프라인 뷰어 | bridge + assets | Poptale 의 로컬 HTML+자료 다운로드 |
| **P2** | 다중 기기 관리 UI | — | 현재 백엔드 책임 |

---

## 6. 마이그레이션 경로 — 같은 번들 vs 신규 번들

**결정: 같은 번들 ID(`com.aipia.poptale`) 업데이트.** 단, 다음 두 가지 보호 장치 필수:

1. **신규 번들로 베타 먼저 (1~2개월)**: `com.aipia.poptale.next` 같은 임시 번들로 신규 빌드를
   내부 트랙에 올려 *6개월간 dogfooding*. 패리티가 확정되면 같은 번들 ID 로 정식 교체.
2. **사용자 안내 배너 + 백엔드 듀얼 호환**: 다운로드 콘텐츠 재다운로드 안내, 자동 로그인 끊김 안내,
   IAP 영수증 포맷 백엔드 듀얼 수용.

→ "어느 날 사용자가 업데이트 받으니 앱이 다르더라"가 일어나면 안 됨.

---

## 7. 즉시 결정 필요 항목 (출시 전)

| # | 결정 | 답에 따른 분기 |
|---|---|---|
| 1 | 신규 프로토타입의 **slug / appName / 번들 ID / 도메인** | `apps/<slug>/app.config.json` 작성 |
| 2 | **macOS CI 러너 vs 사내 맥** | iOS 빌드 리드타임·비용 |
| 3 | App Store / Play Console 계정 소유 — `aipia-team` org 또는 별도 법인? | 스토어 업로드 권한 |
| 4 | Kakao/Naver Developer 앱 — Poptale 기존 앱에 커스텀 스킴 redirect 추가 vs 신규 앱 분리 (키 해시는 네이티브 SDK 전용이라 불필요) | 검토 후 즉시 등록 |
| 5 | 백엔드 IAP `verifyEndpoint` 듀얼 호환 작업 일정 | Poptale Phase C 진입 가능 시점 |

---

## 8. 어디서 무엇을 찾는가

| 필요한 것 | 위치 |
|---|---|
| 하네스 사용법 마스터 | [`02-GUIDE.md`](./02-GUIDE.md) |
| 새 서비스 추가 흐름 | [`../ONBOARDING.md`](../ONBOARDING.md) |
| 웹 통합 API | [`06-INTEGRATION.md`](./06-INTEGRATION.md) + `template/integration/harness-adapter.js` |
| 인증/SSO/회원탈퇴/게스트 | [`10-AUTH.md`](./10-AUTH.md) |
| 인앱결제 정책·구현 | [`11-IAP.md`](./11-IAP.md) |
| 마케팅 SDK (Adbrix·Amplitude·AppsFlyer) | [`13-MARKETING.md`](./13-MARKETING.md) |
| 빌드/CI/시크릿 | [`08-DEPLOY.md`](./08-DEPLOY.md) |
| Poptale 레퍼런스 config | [`apps/poptale/app.config.json`](../apps/poptale/app.config.json), [`apps/poptale-dev/app.config.json`](../apps/poptale-dev/app.config.json) |
| **V2 앱 config (새 리더 웹)** | [`apps/poptale-v2-dev/app.config.json`](../apps/poptale-v2-dev/app.config.json) — §10 |
| V2 인증 연동(인계 총괄) | poptale-web-v2 `docs/AUTH-IDP-HANDOFF.md` · FE `docs/AUTH-IDP-FE.md` · poptale-backend `docs/auth-idp/README.md` |
| AppChannel shim 사용 | `template/integration/harness-adapter.js` 의 `installAppChannelShim()` |
| 네이티브 플러그인 작업 사양 | `template/plugins/{adbrix,whatap}/SPEC.md` (Kakao/Naver 는 2026-09-11 삭제) |
| Poptale Flutter 동작 정본 | [`aipia-team/poptale-app`](https://github.com/aipia-team/poptale-app) 의 `.claude/docs/app-web-connection.md` |

---

## 9. 사용 예시 — Poptale 웹 코드에 한 줄 추가

기존 `poptale-frontend` 의 `src/stores/app/client.ts` 에서 한 곳만 고치면 끝:

```js
import { initHarness, installAppChannelShim, autoBlockCaptureOnPaths } from '@harness/integration/harness-adapter';

await initHarness({ onDeepLink: (url) => router.push(new URL(url).pathname) });
installAppChannelShim({ scheme: 'poptale' });   // 기존 window.AppChannel 호출 그대로 동작
autoBlockCaptureOnPaths();                       // /viewer 진입 시 자동 캡쳐 차단
```

→ 웹의 `window.AppChannel.postMessage("poptale://login/google")` 는 *그대로* 동작하고,
   하네스가 내부적으로 `AppBridge.login('google')` 로 라우팅한다.

---

## 10. V2 경로 — 새 리더 웹(poptale-web-v2) + `apps/poptale-v2-dev` (2026-10-07)

### 무엇이 됐나

| 항목 | 값 |
|---|---|
| 앱 | `apps/poptale-v2-dev` · `com.aipia.poptale.v2.dev` · v2.0.0(1) — 레거시 dev 앱(`com.aipia.poptale.dev`)과 나란히 설치된다 |
| 웹(startUrl) | poptale-web-v2 → Cloud Run `poptale-dev-web`(서울) `https://poptale-dev-web-188609021980.asia-northeast3.run.app` |
| 인증 | **A′ 브로커**(`providers: []` + `oauthReturnScheme: true`) — 게이트웨이 poptale-backend(`client=poptale`). 앱 복귀 `com.aipia.poptale.v2.dev://oauth/callback`. 정본 [`25-AUTH-DELEGATION.md`](./25-AUTH-DELEGATION.md) §3 "팝테일 V2" |
| 브릿지 엔드포인트 | V2 웹 같은 오리진 BFF `/api/app/logout` · `/api/app/withdraw` · `/api/app/device` · `/api/app/device/unregister`(쿠키 `pt_session`). `signupEndpoint` 없음 |
| WebView 이동 허용 | V2 호스트 하나. API 는 fetch 라 무관, 브로커 로그인은 인앱 브라우저라 auth·공급자 도메인 불필요 |
| 앱 링크 | `navigation.appLinkDomains` = V2 호스트 하나 — 팝챗(`chat.dev.poptale.ai`)과 겹치지 않는다([`02-GUIDE.md`](./02-GUIDE.md) §6) |
| 켠 기능 | push · deepLink · share · haptics · viewer(캡처 차단 `/viewer` · 밝기) · darkMode. **끈 것**: camera · secureStorage · localNotification · clipboard(V2 가 그 브릿지 API 를 안 쓰고 플러그인 JS 도 번들하지 않는다) |
| iOS 문구 | camera 를 꺼도 1:1 문의 `<input type=file accept=image/*>` 가 iOS 에서 카메라·사진을 연다 → `ios.usageDescriptions` 로 카메라·사진 보관함 문구만 둔다(없으면 "사진 찍기"에서 앱이 죽는다) |
| Firebase | `poptale-nonprod`(서울 — 팝챗 dev 와 같은 프로젝트). 레거시 `*-aipia-poptale` 아님 |
| 브릿지 | `1.5.0-beta.5`(하네스 커밋). V2 웹은 레지스트리가 아니라 `vendor/harness-bridge` 사본 — publish 뒤 교체 절차는 25 §6 |

레거시 Flutter 앱(`com.aipia.poptale`)과 레거시 경로(`user/login/app/{p}`, uuid 웹 OAuth)는 **손대지 않는다**(계약 결정 3).
운영 전환 때 같은 번들로 교체한다 — 그때 §3 호환성 매트릭스를 다시 본다.

### 정식 도메인으로 옮길 때 — 교체 지점

V2 dev 웹의 정식 도메인(`web.dev.poptale.ai`)은 AWS→GCP 이전 뒤에 붙는다. 그때 `apps/poptale-v2-dev/app.config.json` 에서
**같은 호스트 문자열 하나**를 아래 9곳에서 일괄 치환한다:

- `startUrl` · `navigation.allowedDomains` · `navigation.appLinkDomains`
- `auth.logoutEndpoint` · `auth.deleteEndpoint` · `auth.deviceEndpoint` · `auth.deviceUnregisterEndpoint`
- `legal.privacyUrl` · `legal.termsUrl`

함께 할 것: 새 호스트에 AASA·assetlinks 배포(아래 4) → 인증서버·BE 의 **웹** 복귀 주소(`<새 오리진>/auth/callback`) 갱신
(앱 스킴 복귀는 그대로) → 앱 재빌드(config 는 바이너리에 구워진다 — 25 §6). 앱 링크는 add-once 라 로컬 `build/` 는 지우고 만든다.

### 남은 외부 작업 (PR #59)

| # | 작업 | 누가 · 어디서 | 이름 · 값 |
|---|---|---|---|
| 1 | Firebase 앱 등록 — Android `com.aipia.poptale.v2.dev` · iOS 같은 번들 | Firebase 관리 권한자(`poptale-nonprod`, 박현아) | `google-services.json` · `GoogleService-Info.plist` 받기. iOS 푸시는 APNs 인증 키 업로드 |
| 2 | GitHub 시크릿·변수 | 레포 관리자 | 시크릿 `GOOGLE_SERVICES_B64_POPTALE_V2_DEV` · `GOOGLE_SERVICE_INFO_PLIST_B64_POPTALE_V2_DEV`(base64). App Distribution·APK 링크를 쓸 때 변수 `FIREBASE_WIF_PROVIDER_POPTALE_V2_DEV` · `FIREBASE_WIF_SERVICE_ACCOUNT_POPTALE_V2_DEV`(같은 프로젝트라 `CHARACTERCHAT_DEV` 값과 같다) · `APK_DIST_BUCKET_POPTALE_V2_DEV`. Adbrix 를 켤 때 `ADBRIX_APP_KEY_POPTALE_V2_DEV` · `ADBRIX_SECRET_KEY_POPTALE_V2_DEV` — [`08-DEPLOY.md`](./08-DEPLOY.md) §4·§10 |
| 3 | Apple App ID · 프로파일 | Apple Developer | `com.aipia.poptale.v2.dev` + `com.aipia.poptale.v2.dev.NotificationService`, Associated Domains · Push capability → match 프로파일 재생성([`04-NEW-APP-CHECKLIST.md`](./04-NEW-APP-CHECKLIST.md) §C) |
| 4 | 서명 지문 · `.well-known` | 서명 키 결정 → V2 웹 레포 | SHA-256 2개(업로드 키 + Play 앱 서명 키)를 `android.sha256CertFingerprints` 에 → `node scripts/generate-app.mjs --slug poptale-v2-dev --skip-install` 로 생성한 `build/poptale-v2-dev/well-known/<V2 호스트>/` 의 AASA(`3W889GYPRK.com.aipia.poptale.v2.dev`)·assetlinks 를 V2 웹 `public/.well-known/` 에 **합쳐서** 배포(레거시 Flutter 앱 항목을 지우지 않는다). 지문 전에는 AASA 만 나온다 |
| 5 | 복귀 주소 등록 | auth 운영자(SQL) · poptale-backend env | `com.aipia.poptale.v2.dev://oauth/callback` 을 `auth_clients.poptale.allowed_redirect_uris` 와 BE 복귀 허용 목록에(정확 일치) |
| 6 | 아이콘 · 스플래시 | 디자인 → `generate-assets` 스킬 | `apps/poptale-v2-dev/icon.png`(1024²) · `splash.png`(2732²) — 지금 없음(디버그 빌드는 됨) |
| 7 | iOS 수출 규정 신고값 | 사람 판단 | `ios.usesNonExemptEncryption` 미정 — 정하기 전엔 TestFlight 빌드마다 질문이 뜬다([`07-HOWTO-DEPLOY.md`](./07-HOWTO-DEPLOY.md) §6) |
| 8 | 브릿지 beta.5 발행 · 웹 반영 | 패키지 쓰기 권한자 | 25 §6 "1.5.0-beta.5 배포" — 팝챗 웹 의존성 갱신 + V2 vendor 사본 교체 |

### 확인 필요 — 실기기에서 본다

- **PortOne/PASS 본인인증**: V2 는 모바일에서 **전체 리다이렉트**(WebView 가 PortOne·통신사 페이지로 이동했다가 V2 로 돌아옴)다.
  `allowedDomains` 밖 이동은 외부 브라우저로 나가므로, 본인인증이 앱 밖에서 끝나 결과가 앱에 안 돌아올 수 있다.
  **추측으로 도메인을 넣지 않았다** — 실기기에서 실제로 거치는 호스트를 관찰한 뒤 ① 그 호스트를 `allowedDomains` 에 넣거나
  ② 본인인증을 인앱 브라우저 + 앱 스킴 복귀로 바꾼다(팝챗은 본인인증을 안 써서 검증된 적 없는 경로다).
- 브로커 SNS 왕복(인앱 브라우저 → `com.aipia.poptale.v2.dev://oauth/callback` → WebView 상환) · 취소(창 닫기).
- 브릿지 호출에 `pt_session` 이 실리는지 — 푸시 등록(`/api/app/device`) · 로그아웃 · 탈퇴(2단계).
- App Links 검증 — `adb shell pm get-app-links com.aipia.poptale.v2.dev` 가 `verified`.

### 손대지 않은 것 (범위 밖)

- **결제(IAP)**: `iap` 블록 그대로. `iap.verifyEndpoint`(`/api/v2/iap/verify`)는 **poptale-backend 에 없다** — 브릿지 `purchase()` 의
  영수증 검증(`cordova-plugin-purchase` validator)은 지금 실패한다. 하네스 IAP 를 쓰려면 BE 검증 엔드포인트 계약부터 정한다.
- **ATT**: `tracking` 블록 없음(= `capabilities.att` false → V2 의 사전 안내·`requestTracking` 이 뜨지 않음). 켜려면 함께:
  ① V2 웹 dependencies 에 `capacitor-plugin-app-tracking-transparency`(지금 번들 제외) ② `tracking.att.enabled` +
  `usageDescription`(실제 용도 문구, 법무 확인) + `prePermission: true`(V2 가 사전 안내를 직접 그린다) ③ 앱 재빌드.
- **Adbrix**: config 는 `adbrix` 지만 `@aipia-team/capacitor-adbrix` JS 가 공개 레지스트리에 없어 V2 웹이 번들하지 못한다 →
  `initMarketing` 은 plugin-missing 으로 끝난다.

---

**Last Updated**: 2026-10-07
