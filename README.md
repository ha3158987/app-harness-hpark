# Web→Native Harness (Capacitor 기반)

여러 웹 서비스를 **하나의 얇은 네이티브 셸 + 공유 브릿지**로 감싸 iOS/Android 앱으로
반복 추출하기 위한 하네스. 모든 작업은 CLI로 정의되어 **Claude Code 스킬**이 자동으로
구동한다. (GUI 빌더 없음, 전부 오픈소스.)

---

## 📚 문서 색인

| 문서 | 내용 |
|---|---|
| **`GUIDE.md`** ⭐ | **마스터 가이드 — 여기부터.** 지원 기능·사용 흐름·필수 입력·문서 색인(Mermaid 포함) |
| **README**(이 문서) | 스택/레이아웃/`app.config.json` 스키마/기능 매핑 |
| `ONBOARDING.md` | **새 서비스 추가** 전체 흐름(회사 개발자용 시작점) |
| `INTEGRATION.md` | **프론트엔드 통합** — `@harness/bridge` 사용법 + API 레퍼런스 |
| `STRATEGY.md` | 전략/의사결정/로드맵 |
| `AUTH.md` | 로그인/SSO/회원가입/중앙 IdP(Keycloak)/백엔드 규약 |
| `IAP.md` | 인앱결제(디지털 재화)/웹앱 가격분기/백엔드 검증 |
| `COMPLIANCE.md` | 접근권한 고지/개인정보/성인인증(본인확인)/연령등급 |
| `DATA-COLLECTION.md` | 스토어 개인정보 양식·처리방침용 수집 데이터 목록 |
| `DEPLOY.md` | CI/CD 자동배포(GitHub Actions)/시크릿/서명 |
| `MARKETING.md` | 마케팅 SDK(AppsFlyer 등) |
| `DEVICE-SUPPORT.md` | 기기/OS 지원 매트릭스 |
| `REFERENCES.md` | 외부 참조 |
| `idp/README.md` | Keycloak 로컬 구동 + 소셜 연결 |
| `backend/auth-reference/` | 인증+IAP 백엔드 레퍼런스(Node) |
| 점검 | `node scripts/doctor.mjs` (환경+모든 앱 config) |

---

## 1. 스택 & 버전 (2026-05 기준)

| 영역 | 선택 | 비고 |
|---|---|---|
| 런타임 | **Capacitor 8** (`@capacitor/cli` ^8) | 최신 메이저. 전부 CLI/설정파일 기반 |
| Node | **20 LTS+** | Capacitor 7부터 Node 20 이상 요구 |
| JDK (Android) | **21** | ⚠️ Capacitor 8 Android 는 **JDK 21 필수** (17 이면 `invalid source release: 21` 로 빌드 실패). 검증됨 |
| iOS | **Xcode 26+ / iOS 26 SDK** | Capacitor 8 요구사항. 2026-04-28부터 스토어 제출 필수 SDK |
| iOS 배포 타깃 | **iOS 15** | SDK는 26이어도 배포 타깃은 낮게 유지 가능 |
| Android | Android Studio 최신 + Gradle | `targetSdk 35` (2026-08-31부터 **36** 필수), `minSdk`는 23 유지 가능 |
| 빌드 자동화 | **fastlane** | 서명·빌드·스토어 업로드 전부 CLI |
| 아이콘/스플래시 | **@capacitor/assets** | 소스 이미지 1장에서 전 사이즈 생성 |
| 디퍼드 딥링크 | Branch / AppsFlyer 등 | Firebase Dynamic Links는 2025-08-25 종료됨, 사용 금지 |

상세 링크는 `REFERENCES.md` 참조.

---

## 2. 하드 제약 (설계 전 반드시 인지)

- **iOS 빌드는 macOS + Xcode 필수.** 이 하네스는 맥에서 Claude Code를 돌리는 전제로 설계됨.
  Android는 헤드리스로 완전 자동화 가능.
- **자격증명은 코드/스킬에 넣지 않는다.** 서명 인증서, keystore, push key, 스토어 API 키는
  전부 `fastlane match`(암호화 git repo) 또는 환경변수/시크릿으로 분리. 스킬은 경로/이름만 참조.
- **되돌릴 수 없는 공개 릴리즈는 사람이 승인.** 자동화는 빌드 → TestFlight/내부 트랙 업로드까지.
  프로덕션 스토어 공개(submit for review/release)는 수동 게이트로 둔다. (`submit-store` 스킬 참조)

---

## 3. 레포 레이아웃

```
harness/
├── apps/                      # 앱(서비스)별 정의. 코드 아님, 설정/에셋만
│   └── <slug>/
│       ├── app.config.json    # 단일 진실 공급원 (아래 스키마)
│       ├── icon.png           # 1024x1024 소스 아이콘
│       └── splash.png         # 2732x2732 소스 스플래시
├── template/                  # 공유 Capacitor 셸 (한 번만 작성)
│   ├── src/                   # 셸 웹 자산 (로딩/에러/브릿지 부트스트랩)
│   ├── bridge/                # 커스텀 Capacitor 플러그인 = 공유 JS 브릿지
│   └── capacitor.config.template.ts
├── build/                     # 생성된 앱 프로젝트 (gitignore, 빌드 산출물)
├── scripts/
│   ├── generate-app.mjs       # app.config.json → build/<slug> 프로젝트 생성/패치
│   └── lib/                   # 공용 헬퍼
├── fastlane/                  # Fastfile, Appfile, Matchfile
└── .claude/skills/            # Claude Code 스킬 정의 (이 키트에 포함)
```

`template/`과 `scripts/generate-app.mjs`는 Claude Code로 직접 구현할 부분. 이 키트는 그 작업을
구동할 **스킬 정의 + 참조 정보**를 제공한다.

---

## 4. `app.config.json` 스키마

앱 1개 = 이 파일 1개. 모든 분기(기능 on/off, OS별 처리)는 여기서 결정되고 셸/브릿지가 흡수한다.

```jsonc
{
  "slug": "service-a",                 // 내부 식별자 (디렉터리명과 일치)
  "appName": "Service A",              // 표시 이름
  "appId": "com.yourco.servicea",      // 번들 ID / applicationId
  "startUrl": "https://service-a.com", // 웹 진입 URL
  "version": { "name": "1.0.0", "code": 1 },
  "theme": {
    "primary": "#1A73E8",
    "statusBarStyle": "light",         // light | dark
    "background": "#FFFFFF"
  },
  "assets": { "icon": "icon.png", "splash": "splash.png" },
  "features": {                        // 브릿지 capability 토글 (전부 자동 배선 — 켜면 동작)
    "push": true,
    "deepLink": true,                  // 유니버설/앱 링크: 네이티브 intent-filter/associated-domains 자동 주입
    "deferredDeepLink": { "enabled": true, "provider": "branch" },
    "biometric": false,                // Face ID/지문 (@aparajita/capacitor-biometric-auth)
    "share": true,
    "camera": false,                   // 촬영/사진선택 (AppBridge.takePhoto)
    "forceUpdate": { "enabled": true, "minVersionUrl": "https://service-a.com/min-version.json" },
    "secureStorage": false,            // 토큰/세션 Keychain·Keystore (AppBridge.secureSet/Get)
    "localNotification": false,        // 로컬 알림 (AppBridge.scheduleNotification)
    "haptics": false,                  // 진동 피드백 (AppBridge.haptic)
    "clipboard": false,                // 클립보드 (AppBridge.copyToClipboard)
    "geolocation": false               // 위치 (AppBridge.getLocation)
  },
  "navigation": {
    "allowedDomains": ["service-a.com", "*.service-a.com"], // 셸 내부 탐색 허용
    "externalInBrowser": true          // 그 외 링크는 시스템 브라우저로
  },
  "marketing": {                       // 마케팅 SDK 슬롯 (키는 여기 넣지 않음 — 환경변수로 주입)
    "attribution": { "provider": "appsflyer", "deferredDeepLink": true }, // appsflyer 자동 배선
    "analytics": { "provider": null }, // amplitude|ga4|firebase|mixpanel (현재 슬롯만)
    "crm": { "provider": null }        // braze|onesignal|moengage (현재 슬롯만)
  }
}
```

> **마케팅 SDK 키는 config·레포에 넣지 않는다.** AppsFlyer 의 `devKey`/iOS `appId` 는 빌드 시
> 환경변수(`APPSFLYER_DEV_KEY`, `APPSFLYER_IOS_APP_ID`, 또는 슬러그별 `..._<SLUG>`)에서 읽어
> **네이티브 번들에만 베이크**된다(웹 폴백 config 엔 키가 들어가지 않음). 자세한 건 `MARKETING.md` 참조.
> `features.deferredDeepLink` 는 하위호환으로 `marketing.attribution` 으로 자동 매핑된다.

> **인증/SSO**는 `auth` 블록으로 정의한다(email/apple/google/naver/kakao/facebook/x/threads).
> 인증은 WebView 밖(시스템 브라우저 OAuth2+PKCE, Apple은 네이티브)에서 수행하고 딥링크로 복귀하며,
> client secret 은 앱에 없고 백엔드가 교환한다. 웹은 `AppBridge.login('google')` 한 줄. 상세·백엔드 규약은 `AUTH.md`.

> 브릿지는 런타임에 `features`를 읽어 `AppBridge.capabilities`를 채우고, 웹은
> `if (AppBridge.capabilities.biometric)` 식 피처 디텍션으로 분기한다. (OS 분기 로직은 셸/브릿지에만)
> 브릿지는 `ready()` 시 켜진 capability 에 대응 메서드가 없으면 콘솔 경고로 불일치를 알린다(거짓 약속 방지).

**`forceUpdate.minVersionUrl` 이 가리키는 JSON** (강제 업데이트 게이트가 읽음). 플랫폼별 우선, 없으면 최상위 폴백:

```jsonc
{
  "ios":     { "minVersionCode": 5, "storeUrl": "https://apps.apple.com/app/idXX– ", "message": "업데이트 안내", "force": true },
  "android": { "minVersionCode": 7, "storeUrl": "https://play.google.com/store/apps/details?id=…" },
  "storeUrl": "…", "message": "…"   // 플랫폼 노드가 없을 때 쓰는 폴백
}
```

> 현재 `version.code` < `minVersionCode` 면 브릿지가 전체화면 게이트를 띄운다(`force:false` 면 "나중에"로 닫힘).
> `capabilities.forceUpdate=true` 면 `ready()` 시 자동 1회 검사된다(앱이 직접 `AppBridge.checkForceUpdate()` 호출도 가능).

---

## 5. Claude Code 자동화 흐름

스킬은 작은 결정론적 단위. Claude Code가 요청에 따라 엮어서 실행한다.

```
"service-c 새로 추가하고 안드로이드 빌드해줘"
  → new-app          (apps/service-c/app.config.json + 에셋 스캐폴딩)
  → generate-assets  (@capacitor/assets로 아이콘/스플래시 생성)
  → build-android    (generate-app → npx cap sync → gradlew bundleRelease)

"service-a 1.2.0으로 올려서 양쪽 빌드하고 베타 올려줘"
  → bump-version → build-android / build-ios → submit-store (베타 트랙까지만)
```

각 스킬의 상세는 `.claude/skills/<name>/SKILL.md` 참조.

---

## 6. 기능 → 플러그인 매핑

| 기능 | 패키지 | 메모 |
|---|---|---|
| 푸시(원격) | `@capacitor/push-notifications` | FCM/APNs |
| 로컬 알림 | `@capacitor/local-notifications` | |
| 딥링크/유니버설링크 | `@capacitor/app` (`appUrlOpen`) | iOS associated domains / Android intent filters 설정 필요 |
| 디퍼드 딥링크 | Branch / AppsFlyer SDK 플러그인 | FDL 대체 |
| 스플래시 | `@capacitor/splash-screen` | |
| 외부 링크 | `@capacitor/browser` / `@capacitor/app-launcher` | in-app vs 시스템 브라우저 |
| 공유 | `@capacitor/share` | |
| 카메라/파일 | `@capacitor/camera` | `<input type=file>` 처리 포함 |
| 위치 | `@capacitor/geolocation` | |
| 시큐어 스토리지 | 커뮤니티 플러그인 | 토큰은 `@capacitor/preferences`(비암호화) 대신 보안 저장소 |
| 생체인증 | 커뮤니티 plugin | REFERENCES 참조 |
| OTA 웹 업데이트(선택) | `@capgo/capacitor-updater` | 스토어 재배포 없이 웹 자산 갱신 |
