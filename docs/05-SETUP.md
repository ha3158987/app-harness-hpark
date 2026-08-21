---
doc: 05
title: SETUP — 내 서비스를 하네스에 연결할 때 필요한 환경/설정
category: 앱추가
audience: 개발자
status: active
updated: 2026-05-30
---

# SETUP — 내 서비스를 하네스에 연결할 때 필요한 환경/설정

> 환경·키를 **단계별로** 정리한 문서. 전체 그림·필수 입력 체크리스트는 `02-GUIDE.md` §5,
> CI 시크릿 전체는 `08-DEPLOY.md`, 프론트 연동은 `06-INTEGRATION.md` 참조.

"무엇을, 어느 단계에서" 준비하면 되는지 단계별로 정리. **단계가 올라갈수록 추가될 뿐**,
처음 디버그 빌드만 할 거면 1단계만 있으면 된다. **키/시크릿은 전부 환경변수·파일로 주입하고
레포(app.config.json 포함)엔 넣지 않는다.**

---

## 0. 서비스 쪽 사전 준비 (웹앱에서 1회)
하네스가 아니라 당신 웹 서비스 코드에 들어가는 것:
1. 공유 브릿지 SDK 사용: `import { AppBridge } from '@harness/bridge'` 후 `await AppBridge.ready()`.
   - 공유/네트워크 등 단순 기능은 앱=네이티브, 브라우저=폴백 자동.
   - **단 로그인·결제 등은 `if (AppBridge.isNative) …` 분기 필요**(앱=네이티브 IAP/IdP, 웹=기존 PG/OAuth).
     어댑터(`template/integration/harness-adapter.js`)로 한 곳에서 분기 권장. 상세 `06-INTEGRATION.md`.
2. (선택) 마케팅 이벤트: `AppBridge.track('이벤트명', {...})` — 자세한 건 `13-MARKETING.md`.
3. 세이프에어리어/뷰포트 등 웹뷰 지뢰 회피: `19-DEVICE-SUPPORT.md` 의 "공통(웹뷰)" 체크.

> `@harness/bridge` 는 generate-app 이 `build/<slug>` 에 자동 설치한다. 당신 웹 레포에서 따로 쓰려면
> `template/bridge` 를 npm 패키지로 게시하거나 file: 의존성으로 참조.

---

## 1. 디버그 빌드 (가장 먼저, 키 거의 불필요)

| 환경변수 | 값 | 비고 |
|---|---|---|
| `JAVA_HOME` | JDK **21** 경로 | Capacitor 8 Android 필수. (이 머신엔 설정됨) |
| `ANDROID_HOME` | Android SDK 경로 | platform-tools/android-35/build-tools 35. (설정됨) |

이 단계 절차:
```powershell
# 앱 정의 (new-app 스킬) → 빌드 (build-android 스킬)
node scripts/generate-app.mjs --slug <slug>
cd build/<slug>/android; .\gradlew.bat assembleDebug
```
→ 서명 없는 `app-debug.apk` 생성. 실기기 설치해 동작 확인용.
**app.config.json 에 들어가는 것**: appName / appId / startUrl / 기능 토글 / theme. (키 아님)

---

## 2. 푸시 알림 (FCM/APNs) — 환경변수가 아니라 "파일"

| 플랫폼 | 넣을 것 | 위치 |
|---|---|---|
| Android | `google-services.json` (Firebase 콘솔) | `build/<slug>/android/app/` (gitignore 처리됨) |
| iOS | `GoogleService-Info.plist` + APNs 키(.p8) | iOS 프로젝트 / fastlane |

- app.config.json 에서 `features.push: true`.
- Android 13+ 런타임 알림 권한은 브릿지가 처리(`AppBridge.registerPush()`).

---

## 3. 마케팅 SDK 키 (AppsFlyer) — 환경변수 → 네이티브 베이크

| 환경변수 | 값 |
|---|---|
| `APPSFLYER_DEV_KEY` (또는 `APPSFLYER_DEV_KEY_<SLUG>`) | AppsFlyer Dev Key |
| `APPSFLYER_IOS_APP_ID` (또는 `..._<SLUG>`) | iOS App Store 숫자 ID (Android 불필요) |

- app.config.json: `marketing.attribution.provider: "appsflyer"`.
- 키 없이도 빌드는 되고(런타임 비활성), 키 넣고 재실행하면 활성. 상세 `13-MARKETING.md`.
- `<SLUG>` = 슬러그 대문자 + 하이픈→언더스코어. 예: `service-a` → `APPSFLYER_DEV_KEY_SERVICE_A`.

---

## 4. 릴리즈 서명 (AAB/IPA, 스토어용)

### Android (keystore)
keystore 파일은 **레포 밖**에 두고, gradle 에 주입(`build/<slug>/android/keystore.properties`
또는 `~/.gradle/gradle.properties`). `.env.example` 의 `ANDROID_KEYSTORE_*` 참고.

### iOS (fastlane match) — macOS 필요
| 환경변수 | 값 |
|---|---|
| `MATCH_GIT_URL` | 인증서 암호화 저장소(비공개 git) |
| `MATCH_PASSWORD` | match 복호화 비번 |
| `FASTLANE_APPLE_ID` / `FASTLANE_ITC_TEAM_ID` / `FASTLANE_DEV_TEAM_ID` | 애플 계정/팀 |

---

## 5. 스토어 업로드 (submit-store, 베타/내부 트랙까지)

| 플랫폼 | 환경변수/파일 |
|---|---|
| Android (Play) | `SUPPLY_JSON_KEY_FILE` = Play 서비스계정 JSON 경로(레포 밖) |
| iOS (TestFlight) | 4단계 match/Apple 키 + (권장) App Store Connect API 키 |

- 전부 `fastlane/.env` 로 (템플릿: `fastlane/.env.example` 복사). **`.env` 는 커밋 안 됨.**
- **프로덕션 공개(심사 제출/정식 릴리즈)는 자동화 안 함** — 사람이 콘솔에서. (`submit-store` 스킬)

---

## 한눈에 — 단계별 필요한 것
| 하고 싶은 것 | 추가로 필요한 것 |
|---|---|
| 디버그 APK로 동작 확인 | JAVA_HOME(21), ANDROID_HOME, app.config.json |
| 푸시 | google-services.json / APNs |
| AppsFlyer 어트리뷰션 | `APPSFLYER_DEV_KEY` (+iOS App ID) |
| 스토어용 서명 빌드 | keystore / fastlane match |
| TestFlight·Play 업로드 | Play JSON 키 / Apple·match 키 (fastlane/.env) |
