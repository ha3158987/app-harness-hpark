# POPTALE-MIGRATION — Poptale Flutter → Capacitor 하네스 이전

> 이 문서는 **인계 문서**다. 신규 앱(프로토타입) 출시를 맡은 담당자가 가장 먼저 읽는다.
> Poptale Flutter 앱(`aipia-team/poptale-app`)을 하네스 기반 Capacitor 앱으로 옮길 때
> *무엇이 호환되어야 하고, 누가 무엇을 책임지는지*가 이 문서에 모여 있다.
>
> 📌 **선행 필독**: [`AIPIA-CONVENTIONS.md`](AIPIA-CONVENTIONS.md) — 번들ID/도메인/소셜/SDK 등 *전사 표준*.
> 이 문서는 AIPIA-CONVENTIONS 위에 *Poptale 특이값* 만 다룬다.

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
| **콘솔(사람)** | App Store Connect / Play Console — 같은 번들 ID 업데이트 시 IAP 상품 / 개인정보 라벨 / 스토어 정책. Kakao/Naver Developer Console 에 *Capacitor 빌드 키 해시 추가 등록*. |
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
| **4** | **Kakao/Naver 키 해시** | Capacitor 빌드의 *서명 키 해시*가 Kakao/Naver Developer Console 에 등록되어 있어야 로그인 동작. | 프로토타입 출시 시 키 해시 발급 → Poptale 용 Kakao/Naver 앱에 **추가 등록**(기존 Flutter 해시는 유지). |
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
| W2 | `gradlew assembleDebug` 첫 빌드, 실기기 확인 | **Kakao Capacitor 플러그인** (`template/plugins/kakao/SPEC.md`) |
| W3 | 4종 소셜 로그인 결선 | **Naver Capacitor 플러그인** (`template/plugins/naver/SPEC.md`) |
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
| **P0** | Kakao Capacitor 플러그인 | `template/plugins/kakao/` | Flutter `kakao_flutter_sdk_user` 동작 매칭 |
| **P0** | Naver Capacitor 플러그인 | `template/plugins/naver/` | Flutter `flutter_naver_login` 동작 매칭 |
| **P0** | IAP Google 토큰 압축 옵션 | `template/bridge/dist/index.js` `purchase()` | Poptale 0.28.21+102 |
| **P0** | Adbrix provider | `template/plugins/adbrix/`, `MARKETING.md §4` 절차 | Poptale 1.1.13+181 (DFINERY) |
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
| 4 | Kakao/Naver Developer 앱 — Poptale 기존 앱에 키 해시 추가 vs 신규 앱 분리 | 검토 후 즉시 등록 |
| 5 | 백엔드 IAP `verifyEndpoint` 듀얼 호환 작업 일정 | Poptale Phase C 진입 가능 시점 |

---

## 8. 어디서 무엇을 찾는가

| 필요한 것 | 위치 |
|---|---|
| 하네스 사용법 마스터 | [`GUIDE.md`](GUIDE.md) |
| 새 서비스 추가 흐름 | [`ONBOARDING.md`](ONBOARDING.md) |
| 웹 통합 API | [`INTEGRATION.md`](INTEGRATION.md) + `template/integration/harness-adapter.js` |
| 인증/SSO/회원탈퇴/게스트 | [`AUTH.md`](AUTH.md) |
| 인앱결제 정책·구현 | [`IAP.md`](IAP.md) |
| 마케팅 SDK (Adbrix·Amplitude·AppsFlyer) | [`MARKETING.md`](MARKETING.md) |
| 빌드/CI/시크릿 | [`DEPLOY.md`](DEPLOY.md) |
| Poptale 레퍼런스 config | [`apps/poptale/app.config.json`](apps/poptale/app.config.json), [`apps/poptale-dev/app.config.json`](apps/poptale-dev/app.config.json) |
| AppChannel shim 사용 | `template/integration/harness-adapter.js` 의 `installAppChannelShim()` |
| 네이티브 플러그인 작업 사양 | `template/plugins/{kakao,naver,adbrix,whatap}/SPEC.md` |
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

**Last Updated**: 2026-06-01
