---
doc: 08
title: DEPLOY — 빌드 후 자동 배포 (CI/CD)
category: 빌드배포
audience: 배포담당자
status: active
updated: 2026-08-06
---

# DEPLOY — 빌드 후 자동 배포 (CI/CD)

`.github/workflows/release.yml` 이 앱을 빌드해 **베타/내부 트랙까지** 자동 업로드한다.
**프로덕션 공개(심사 제출/정식 릴리즈)는 자동화하지 않는다** — 사람이 콘솔에서(STRATEGY 안전원칙).

---

## 1. 핵심 이해 — 앱 재배포는 "가끔"이다

앱은 `server.url` 로 웹을 **원격 로드**한다. 그래서:
- **프론트 코드가 바뀌어도 앱을 다시 배포할 필요가 없다.** 프론트 팀이 웹만 배포하면 앱에 즉시 반영.
- 앱(네이티브)을 다시 빌드/배포하는 경우는 **드물다**: 버전업 / 네이티브 기능(config) 변경 /
  아이콘·스플래시 변경 / 스토어 SDK 요구사항(예: targetSdk 36, iOS SDK).

→ 이 파이프라인은 **의도된 릴리즈 때만** 돈다. 프론트 배포와 혼동하지 말 것.

## 2. 프론트 팀의 "연동" = 단 두 가지
1. 자기 웹앱에 `@harness/bridge` 를 의존성으로 추가하고 `AppBridge.*` 호출(로그인/공유/푸시 등).
2. 이 레포에 `apps/<slug>/app.config.json` 한 개 등록(+ 아이콘/스플래시 소스).

프론트 레포와 하네스 레포는 **분리**된다. 하네스는 **네이티브 셸만** 만든다.

---

## 3. 트리거 (둘 다 지원)

| 방식 | 사용 | 결과 |
|---|---|---|
| **태그 푸시** | `git tag aipia-v1.2.0 && git push origin aipia-v1.2.0` | slug=aipia, 양쪽 플랫폼, `internal` 트랙 |
| **수동 실행** | Actions 탭 → release → Run workflow (slug/platform/track 선택) | 지정대로 |

태그 형식: **`<slug>-v<버전>`** (slug 는 `-v` 앞부분).

---

## 4. 등록해야 할 GitHub Secrets

Settings → Secrets and variables → Actions 에 추가. (값은 레포에 절대 두지 않음)

### Android (Play 내부/베타)
| Secret | 설명 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | 릴리즈 keystore 를 base64 인코딩한 값 (아래 명령) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 비번 |
| `ANDROID_KEY_ALIAS` | 키 별칭 |
| `ANDROID_KEY_PASSWORD` | 키 비번 |
| `PLAY_SERVICE_ACCOUNT_JSON` | Play Console 서비스 계정 JSON **내용 전체** |

```bash
# keystore → base64 (한 줄)
base64 -w0 release.keystore         # Linux
base64 -i release.keystore | tr -d '\n'   # macOS
```
> keystore 가 없으면: `keytool -genkeypair -v -keystore release.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000`
> Play 는 App Signing 을 쓰므로 이건 **업로드 키**. 분실 주의(백업).

### iOS (TestFlight)
| Secret | 설명 |
|---|---|
| `MATCH_GIT_URL` | 인증서 저장소(암호화) git URL |
| `MATCH_PASSWORD` | match 복호화 비번 |
| `MATCH_GIT_BASIC_AUTHORIZATION` | match repo 접근용 토큰(base64 `user:token`) |
| `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_P8` | App Store Connect API 키(2FA 회피). `ASC_KEY_P8` 는 .p8 내용 |
| `GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG>` | (푸시) iOS Firebase 설정 `GoogleService-Info.plist` 의 base64. `firebase.fcm` 앱 필수 — §9 |

### 공통(선택)
| Secret | 설명 |
|---|---|
| `APPSFLYER_DEV_KEY` / `APPSFLYER_IOS_APP_ID` | 마케팅 키(네이티브 베이크) |

---

## 5. 잡 구성
- **android** → `ubuntu-latest` (헤드리스 완전 자동). JDK21 + Android SDK + fastlane.
- **ios** → `macos-latest` (GitHub 호스티드, 분당 과금). Xcode + CocoaPods + fastlane match.

흐름(공통): `generate-app` → (아이콘 있으면)`@capacitor/assets` → 빌드 → `fastlane <plat> beta` → 산출물 업로드.
Android 서명은 generate-app 이 `app/build.gradle` 에 넣은 조건부 signingConfig 가 CI 가 쓴
`keystore.properties` 를 읽어 적용한다.

---

## 6. iOS 서명·프로비저닝 (match) — 시행착오 방지

iOS 빌드 실패의 대부분은 **코드 서명 3자 불일치**다:
**App ID capability(포털) ↔ 앱 엔타이틀먼트(`App.entitlements`) ↔ 프로비저닝 프로파일(match)**.

- **fastlane match** 가 인증서/프로비저닝을 암호화 git repo 로 관리한다(최초 1회 `fastlane match appstore`).
  CI 의 match 는 **`readonly: true`** — 기존 프로파일을 **읽기만** 한다. 새 capability 반영/프로파일 재생성은 **사람이 로컬에서 1회** 해야 한다.
- 엔타이틀먼트 파일 생성과 `CODE_SIGN_ENTITLEMENTS` pbxproj 연결은 **generate-app 이 자동**으로 한다
  (`patchIosDeepLinks` / `patchIosAppleEntitlement` / `patchIosPbxEntitlements`). 수동 Xcode 작업은 필요 없다.

### ⚠️ capability 를 켜면(딥링크/푸시/Apple 로그인) 반드시 프로파일을 재생성하라
`app.config.json` 에서 아래를 켜면 iOS 엔타이틀먼트가 새 capability 를 요구한다:

| config | 요구 iOS capability |
|---|---|
| `features.deepLink: true` (+ `navigation.allowedDomains`) | **Associated Domains** (유니버설 링크) |
| `features.push: true` | Push Notifications |
| 소셜 로그인(Apple) | Sign in with Apple |

capability 를 엔타이틀먼트에만 추가하고 **App ID + 프로파일에 반영하지 않으면** CI 의 `build_app` 이 이렇게 죽는다:

```
error: Provisioning profile "match AppStore <appId>" doesn't include the Associated Domains capability.
```

**→ 해결은 반드시 2단계 (둘 다 필요):**
1. **Apple Developer 포털**: 인증서, ID 및 프로파일 → 식별자(Identifiers) → 해당 App ID → 그 capability 체크 → Save → Confirm.
   (경고 다이얼로그 "…will invalidate existing provisioning profiles" 가 바로 2번이 필요한 이유다.)
2. **로컬에서 match 프로파일 재생성**(CI 의 readonly 를 우회):
   ```bash
   # 레포 루트에서. secrets/asc_api_key.p8(gitignore) + fastlane/.env 필요.
   /opt/homebrew/bin/fastlane ios regen_profile slug:<slug>
   ```
   그다음 **CI(release)를 iOS 로 재실행**하면 갱신된 프로파일을 받아 서명이 통과한다.

> **왜 `/opt/homebrew/bin/fastlane` 절대경로인가**: 기본 `fastlane` 은 rbenv shim → macOS 시스템 Ruby(2.6, **LibreSSL**)로 돈다. LibreSSL 은 App Store Connect `.p8`(EC/ES256 키)를 못 읽어 **`invalid curve name`** 으로 죽는다. Homebrew fastlane 은 Ruby3+/OpenSSL3 라 정상. (대안: rbenv 에 `--with-openssl-dir=$(brew --prefix openssl@3)` 로 빌드한 Ruby 를 깔고 `gem install fastlane`.)
> **로컬 `.env` 의 `APP_STORE_CONNECT_API_KEY_KEY` 는 비어 있어도 된다** — `before_all` 이 `secrets/asc_api_key.p8` 로 자동 폴백한다. (빈 키 본문을 그대로 넘기면 이것도 `invalid curve name` 원인이다.)
> match repo **push 인증(403)** 이 나면: 그 저장소에 쓰기 권한 있는 계정으로 keychain 로그인돼 있거나, `MATCH_GIT_BASIC_AUTHORIZATION`(base64 `user:token`) 을 `.env` 에 추가.

---

## 7. 프로덕션 게이트 (수동)
- iOS: TestFlight 까지만 자동. 외부 배포/심사 제출은 App Store Connect 에서 직접.
- Android: `internal`/`beta` 트랙 + `draft` 까지만. production 승격은 Play Console 에서 직접.

---

## 8. 자주 겪는 함정 (증상 → 원인 → 해결)

| 증상 | 원인 | 해결 |
|---|---|---|
| 수동 실행했는데 **iOS(또는 Android) 잡이 skipped** | `platform` 입력이 한쪽만(예: `android`) — **skip 은 실패가 아니라 "안 돌린 것"** | 양쪽이면 `platform=both`, iOS 만이면 `ios` 로 재실행 |
| iOS `build_app`: *"…doesn't include the Associated Domains capability"* | capability 를 엔타이틀먼트에만 추가하고 App ID/프로파일에 미반영 | §6 — 포털에서 capability 체크 + 로컬 `regen_profile` + CI 재실행 |
| 로컬 fastlane: **`invalid curve name`** | (a) 시스템 Ruby+LibreSSL 로 실행 (b) `.env` 의 ASC `.p8` 키 본문이 빈 값 | (a) `/opt/homebrew/bin/fastlane` 로 실행 (b) `secrets/asc_api_key.p8` 배치(자동 폴백) |
| iOS: *No profile for '<appId>' / profile not found* | match repo 에 그 app_identifier 프로파일이 아직 없음(최초 미생성) | 로컬에서 `fastlane match appstore --app_identifier <appId>` 1회 생성 |
| Android `beta`: keystore/서명 실패 | keystore 시크릿 4종 미설정 | §4 Android 시크릿(`ANDROID_KEYSTORE_*`, `ANDROID_KEY_*`) 등록 |

> **원칙**: `app.config.json` 에서 **네이티브 기능/capability 를 바꾸면** iOS 는 (포털 capability + 프로파일 재생성)이 따라와야 한다. Android 는 대부분 자동(권한은 매니페스트 자동 병합). **프론트/웹 변경만이면 앱 재배포 자체가 불필요**(§1).

---

## 9. iOS 푸시(FCM) 활성화 런북

`features.push: true` + `firebase.enabled/fcm: true` 인 앱을 **iOS 에서 실제로 푸시 수신**하려면, 하네스 자동 배선 외에 **Apple·Firebase·백엔드 선행 작업**이 필요하다. **순서 중요** — 안 지키면 iOS 빌드가 깨진다(§6 associated-domains 와 동일 실패모드).

### 하네스가 자동으로 하는 것 (generate-app / CI / 브릿지)
- App.entitlements `aps-environment=production` + Info.plist `UIBackgroundModes: remote-notification`
- `firebase.fcm` 이면 pbxproj 에 `GoogleService-Info.plist` 번들 리소스 등록 + AppDelegate `FirebaseApp.configure()`
- 브릿지가 iOS 에선 `@capacitor-community/fcm` 로 **FCM 토큰**을 받아 `auth.deviceEndpoint` 로 등록 (Android 는 push-notifications 토큰이 이미 FCM)
- CI 가 `GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG>` 시크릿을 `ios/App/GoogleService-Info.plist` 로 주입

### 사람이 해야 하는 것 (반드시 이 순서)
1. **Firebase 콘솔** — 프로젝트에 iOS 앱(번들ID = appId) 추가 → `GoogleService-Info.plist` 다운로드. 그리고 **Cloud Messaging → APNs 인증키(.p8) 업로드**(Key ID/Team ID). ← 없으면 FCM→APNs 전달 자체가 안 됨.
2. **Apple 포털** — App ID 에 **Push Notifications** capability 켜기(Save→Confirm) → **match 프로파일 재생성**:
   ```bash
   /opt/homebrew/bin/fastlane ios regen_profile slug:<slug>
   ```
   ⚠️ 이 단계 없이 빌드하면 `aps-environment` 때문에 §6 처럼 서명 실패.
3. **GitHub 시크릿** — plist 를 base64 로 등록:
   ```bash
   gh secret set GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG_대문자_언더스코어> --body "$(base64 -i GoogleService-Info.plist | tr -d '\n')"
   ```
   (로컬 빌드는 `build/<slug>/ios/App/GoogleService-Info.plist` 에 직접 배치.)
   ⚠️ `firebase.fcm` 앱은 이 시크릿이 **필수** — 없으면 pbxproj 가 참조하는 리소스 누락으로 iOS 빌드 실패.
4. **백엔드** — `deviceEndpoint(/api/push/register)` 로 등록된 `platform:'ios'` FCM 토큰에, 답변 완성 등 이벤트 시 **FCM 발송**.
5. iOS 재빌드/재배포 → 실기기에서 알림 권한 허용 → 수신 확인.

### 검증 (계층 분리 — §8 표 참고)
Android 먼저 → Firebase 콘솔 "테스트 메시지"로 앱 계층 격리 → deviceEndpoint 토큰 등록 로그 → 백엔드 발송.

> ⚠️ **미검증 포인트**(실기기 빌드로 확인 필요): `@capacitor-community/fcm` 의 Capacitor 8 호환, pbxproj `GoogleService-Info.plist` 리소스 등록, AppDelegate `FirebaseApp.configure()` 주입, FCM 토큰 취득 경로.
