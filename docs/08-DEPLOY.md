---
doc: 08
title: DEPLOY — 빌드 후 자동 배포 (CI/CD)
category: 빌드배포
audience: 배포담당자
status: active
updated: 2026-09-07
---

# DEPLOY — 빌드 후 자동 배포 (CI/CD)

`.github/workflows/release.yml` 이 앱을 빌드해 **내부 테스터까지** 자동 업로드한다
(iOS=TestFlight · Android=Firebase App Distribution + Play 내부/베타 트랙 + GCS 고정 링크).
전 채널을 한 번에 태우는 진입점은 `release-app` 스킬 — [07-HOWTO-DEPLOY.md](./07-HOWTO-DEPLOY.md).
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
| **태그 푸시** | `git tag aipia-v1.2.0 && git push origin aipia-v1.2.0` | slug=aipia, 양쪽 플랫폼, `internal` 트랙, Android 는 Firebase+Play 둘 다 |
| **수동 실행** | Actions 탭 → release → Run workflow (slug/platform/track/android_channel 선택) | 지정대로 |

태그 형식: **`<slug>-v<버전>`** (slug 는 `-v` 앞부분).

**Android 배포 채널** (`android_channel` 입력, 기본 `both`)

| 값 | 무엇이 도나 | 테스터가 받는 방법 |
|---|---|---|
| `firebase` | Firebase App Distribution (APK) | 초대 메일/링크 → **즉시 설치**. 콘솔 클릭 불필요 |
| `play` | Play 내부/베타 트랙 (AAB) | Play 스토어 — **바로 출시**(`release_status: 'completed'`), 콘솔 클릭 없음 |
| `both` | 둘 다 (Firebase 먼저) | — |

> Firebase 는 **Play 업로드보다 먼저** 돈다. Play 는 versionCode 중복·앱 레코드 미등록으로
> 곧잘 실패하는데, 그때도 내부 테스터에게는 빌드가 가야 하기 때문이다.

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
| `GOOGLE_SERVICES_B64_<SLUG>` | (FCM·App Distribution) `google-services.json` 의 base64. App Distribution 은 여기서 Firebase 앱 ID 를 읽는다 |

Firebase App Distribution 인증은 **시크릿이 아니라 변수(Variables)** 다 — 조직 정책상 서비스
계정 키를 만들 수 없어 GitHub OIDC(WIF)를 쓴다. 셋업은 §10.

| Variable | 설명 |
|---|---|
| `FIREBASE_WIF_PROVIDER_<SLUG>` | Workload Identity provider 리소스 경로. 접미사 없는 `FIREBASE_WIF_PROVIDER` 는 공통 폴백 |
| `FIREBASE_WIF_SERVICE_ACCOUNT_<SLUG>` | 가장할 서비스 계정 이메일 (`app-distribution-ci@<project>.iam.gserviceaccount.com`) |
| `APK_DIST_BUCKET_<SLUG>` | (선택) APK 를 QR 고정 링크로 뿌릴 공개 GCS 버킷명. 미설정이면 해당 스텝을 건너뛴다. 접미사 없는 `APK_DIST_BUCKET` 은 공통 폴백 |

`APK_DIST_BUCKET` 을 걸면 스토어 릴리즈가 돌 때마다 **같은 URL** 이 최신 APK 를 서빙한다:
`https://storage.googleapis.com/<버킷>/android/<slug>.apk` — 링크가 안 바뀌므로 **QR 은 한 번만 만들면 된다.**
버킷의 서비스 계정 권한은 `roles/storage.objectAdmin`(버킷 스코프)이면 충분하고, 인증은 위 WIF 를 그대로 쓴다.
로컬에서 같은 경로로 올리는 수동 경로는 `publish-apk` 스킬(`npm run publish:apk`)이다.

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

흐름(공통): `generate-app` → (아이콘 있으면)`@capacitor/assets` → 빌드 → 업로드 → 산출물 아티팩트.
업로드는 android 잡에서 `fastlane android firebase`(APK) → `fastlane android beta`(AAB) 순,
ios 잡에서 `fastlane ios beta`.
Android 서명은 generate-app 이 `app/build.gradle` 에 넣은 조건부 signingConfig 가 CI 가 쓴
`keystore.properties` 를 읽어 적용한다 — **AAB 와 APK 가 같은 업로드 키로 서명된다**.

> **플러그인 로딩 주의**: fastlane 은 플러그인을 **Bundler 의 Gemfile 을 통해서만** 자동
> 로드한다(`PluginManager#available_gems` → `Bundler::SharedHelpers.default_gemfile`).
> 이 레포는 번들러 없이 `gem install fastlane` 로 돌아 **Gemfile 이 없고**, 따라서
> `fastlane/Pluginfile` 에 적어도 로드되지 않는다 —
> `Could not find action, lane or variable 'firebase_app_distribution'` 로 죽는다.
> 그래서 **Fastfile 이 직접 `require 'fastlane/plugin/firebase_app_distribution'`** 한다.
> 플러그인을 추가하면 3곳을 같이 고쳐라: `Pluginfile` · `Fastfile` 의 require · 워크플로 `gem install`.

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

### 배포 인증서(Apple Distribution)가 만료됐을 때

인증서는 **팀 전체가 공유**하고, 프로파일은 그 인증서를 품고 있다. 따라서 인증서가 만료되면
**모든 앱의 프로파일이 한꺼번에 무효**가 되고 CI 는 이렇게 죽는다:

```
Your certificate '<ID>.cer' is not valid, please check end date and renew it if necessary
```

`regen_profile` 이 인증서 갱신까지 같이 한다(`renew_expired_certs`) — 만료된 `.cer`/`.p12` 를
match 저장소에서 지우고 새 인증서를 발급해 커밋한다. **fastlane 2.237 이상이 필요하다**
(2.236 이하엔 옵션 자체가 없다 — lane 이 시작할 때 경고로 알려준다).

```bash
brew upgrade fastlane                                  # 2.237 미만이면 먼저
/opt/homebrew/bin/fastlane ios regen_profile slug:<slug>
```

> ⚠️ **앱이 여러 개면 한 사람이 순차로** 돌린다. 인증서는 1장을 공유하므로, 두 사람이
> 동시에 돌리면 **각자 새 인증서를 만들어** 프로파일이 서로 다른 인증서로 갈라진다.
> 그러면 CI 는 한쪽 인증서만 집어 나머지 앱 서명이 깨진다.
> 첫 번째 실행이 match 저장소에 **push 된 것을 확인한 뒤** 다음 앱을 돌릴 것.
>
> 옛 인증서는 애플 포털에서 revoke 되지 않는다(만료분은 인증서 슬롯을 차지하지 않는다).
> 슬롯이 정말 모자라면 그때만 `fastlane match nuke distribution` 을 쓴다 — 전부 지우므로 최후수단.

### 서명 인증서의 출처는 match 저장소 하나뿐이다

CI 는 **빈 키체인만 만들고**, 인증서를 내려받아 설치하는 것은 match 가 한다. 워크플로가
키체인 이름·비밀번호를 `MATCH_KEYCHAIN_NAME` / `MATCH_KEYCHAIN_PASSWORD` 로 넘기므로,
match 가 개인키를 넣은 뒤 **partition list 까지 직접 설정**한다. 이게 있어야 `codesign` 이
승인 팝업 없이 서명한다.

> **인증서 p12 를 GitHub 시크릿에 따로 두지 말 것.** 2026-09-15 이전에는 `IOS_DIST_P12_BASE64`
> 시크릿에 개인키를 중복 보관했는데, 인증서를 갱신하자 시크릿이 조용히 낡아
> 프로파일(새 인증서) ↔ 키체인(옛 인증서)이 어긋났다. 결과는 `codesign` 이 뜨지도 않을
> 승인 팝업을 기다리며 **6시간 매달리다 잡 타임아웃**. 출처가 하나면 갱신이 저절로 따라온다.

---

## 7. 프로덕션 게이트 (수동)
- iOS: TestFlight 까지만 자동. 외부 배포/심사 제출은 App Store Connect 에서 직접.
  > ⚠️ 내부 테스터에게도 **수출 규정 준수 답변** 전에는 빌드가 안 나간다. 하네스는
  > `ITSAppUsesNonExemptEncryption` 을 넣지 않으므로 **매 빌드마다 콘솔에서 답해야 한다** —
  > 없애는 방법과 판단 기준은 [07-HOWTO-DEPLOY.md §6](./07-HOWTO-DEPLOY.md).
- Android: `internal`/`beta` 트랙까지만. 그 트랙 테스터에게는 바로 출시되지만(`completed`),
  **production 승격은 Play Console 에서 사람이** — Fastfile 이 track 을 internal|beta 로 제한한다.
- Android(Firebase App Distribution): **지정한 테스터 그룹까지만.** 스토어와 무관한 사내 채널이라
  공개 위험은 없지만, 그룹에 외부인을 넣으면 그게 곧 배포다 — 그룹 구성은 사람이 관리한다.

---

## 8. 자주 겪는 함정 (증상 → 원인 → 해결)

| 증상 | 원인 | 해결 |
|---|---|---|
| 수동 실행했는데 **iOS(또는 Android) 잡이 skipped** | `platform` 입력이 한쪽만(예: `android`) — **skip 은 실패가 아니라 "안 돌린 것"** | 양쪽이면 `platform=both`, iOS 만이면 `ios` 로 재실행 |
| iOS `build_app`: *"…doesn't include the Associated Domains capability"* | capability 를 엔타이틀먼트에만 추가하고 App ID/프로파일에 미반영 | §6 — 포털에서 capability 체크 + 로컬 `regen_profile` + CI 재실행 |
| 로컬 fastlane: **`invalid curve name`** | (a) 시스템 Ruby+LibreSSL 로 실행 (b) `.env` 의 ASC `.p8` 키 본문이 빈 값 | (a) `/opt/homebrew/bin/fastlane` 로 실행 (b) `secrets/asc_api_key.p8` 배치(자동 폴백) |
| iOS: *"Your certificate '<ID>.cer' is not valid…"* | 배포 인증서 만료 — 팀 공유라 **모든 앱**이 같이 막힌다 | §6 — fastlane 2.237+ 로 올리고 앱마다 `regen_profile` **순차** 실행 |
| iOS: *"Could not find option 'renew_expired_certs'"* | fastlane 2.236 이하 | `brew upgrade fastlane` |
| iOS CI 가 **서명 단계에서 멈춰 6시간 뒤 cancelled** | `codesign` 이 키체인 승인 팝업을 기다림 — 개인키의 partition list 미설정 | 서명 인증서 출처는 **match 저장소 하나뿐**이어야 한다(§6). 잡에 `timeout-minutes` 도 걸려 있다 |
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

---

## 10. Android 내부 테스터 배포 런북 (Firebase App Distribution)

**목적**: iOS 의 TestFlight 처럼 — 빌드가 올라가면 **테스터에게 바로 뜨는** 안드로이드 채널.
Play 내부 트랙도 이제 바로 출시되지만(`completed`), 테스터는 Play
스토어를 거친다. App Distribution 은 그 두 단계가 없다.

### 하네스가 자동으로 하는 것
- `assembleRelease` 로 **APK** 를 굽는다(AAB 와 동일한 업로드 키로 서명 — `buildTypes.release`)
- `google-services.json` 에서 **Firebase 앱 ID** 를 파싱한다 → `app.config.json` 에 새 키 불필요
- `fastlane android firebase` 로 업로드, 릴리즈 노트에 태그명 + 마지막 커밋 제목
- 시크릿이나 `google-services.json` 이 없으면 **조용히 건너뛴다**(비 Firebase 앱 배포를 막지 않음)

### 사람이 해야 하는 것 (조직 1회 + 앱 1회)

1. **Firebase 콘솔 → 프로젝트 → App Distribution → 시작하기**
   (해당 Android 앱이 이미 Firebase 에 등록돼 있어야 한다 = `google-services.json` 이 있으면 된 것)
2. **테스터 그룹 생성** — 탭 "테스터 및 그룹" → 그룹 추가 → 이름 **`aipia_internal`**
   (= 조직 표준 그룹. 다른 그룹으로 보내려면 워크플로 실행 시 `firebase_groups` 입력으로 지정)
   > ⚠️ CI 가 쓰는 값은 표시 이름이 아니라 **별칭(alias)** 이다. 콘솔이 이름에서 별칭을
   > 자동 생성하므로, 그룹을 만든 뒤 목록에서 별칭이 정말 `aipia_internal` 인지 확인할 것.
   > 다르면 워크플로/Fastfile 기본값을 그 별칭으로 맞춰야 한다.

   테스터를 넣는 방법 2가지 — **초대 메일을 보내는 버튼은 없다.**
   - **이메일 추가**: 그룹 → 테스터 추가. 메일은 **그 그룹에 첫 배포가 나갈 때** 자동 발송된다.
     등록만 해두고 배포가 없으면 아무 메일도 안 간다.
   - **초대 링크**("초대 링크" 탭): 링크를 공유하면 각자 셀프 등록해 그룹에 편입된다. 인원이
     늘 때 관리가 편하다.

   테스터 쪽 준비: 초대 수락 → **기기에서** 링크 열어 **App Tester** 앱 설치 → 로그인 → 설치.
   이메일은 **구글 계정**이어야 한다(로그인 필요).
   → 그룹에 테스터 이메일 추가. 테스터는 초대 메일을 수락하고 **App Tester** 앱을 설치한다.
3. **서비스 계정 + WIF 바인딩** — 🔴 **서비스 계정 키(.json)는 만들 수 없다.** aipia 조직은
   org policy `constraints/iam.disableServiceAccountKeyCreation` 으로 키 발급을 전역 차단한다
   (`FAILED_PRECONDITION: Key creation is not allowed on this service account`). 프로젝트 소유자도
   못 푼다 — 조직 정책 관리자만 가능. 그래서 **GitHub OIDC(Workload Identity Federation)** 를 쓴다.
   조직에 이미 `github-actions` 풀이 있고 다른 레포들도 이 방식이다.

   ```bash
   PROJECT=<firebase 프로젝트 id>            # 예: poptale-nonprod
   PROJNUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

   # 3-1. 업로드 전용 서비스 계정
   gcloud iam service-accounts create app-distribution-ci --project="$PROJECT" \
     --display-name="App Distribution CI"

   # 3-2. 업로드 권한 (이 역할 하나면 충분 — 최소권한)
   gcloud projects add-iam-policy-binding "$PROJECT" \
     --member="serviceAccount:app-distribution-ci@$PROJECT.iam.gserviceaccount.com" \
     --role="roles/firebaseappdistro.admin" --condition=None

   # 3-3. 이 레포의 Actions 가 그 계정을 가장할 수 있게 (키 대신 OIDC)
   gcloud iam service-accounts add-iam-policy-binding \
     "app-distribution-ci@$PROJECT.iam.gserviceaccount.com" --project="$PROJECT" \
     --role="roles/iam.workloadIdentityUser" \
     --member="principalSet://iam.googleapis.com/projects/$PROJNUM/locations/global/workloadIdentityPools/github-actions/attribute.repository/aipia-team/app-harness"
   ```
   > `github-actions` 풀이 그 프로젝트에 없으면 먼저 만들어야 한다(provider 는 issuer
   > `https://token.actions.githubusercontent.com`, 조건 `assertion.repository_owner == 'aipia-team'`).

4. **GitHub 변수 등록** — 시크릿이 아니라 **변수(Variables)** 다. 민감값이 아니고, 로그에
   마스킹되지 않아야 디버깅이 쉽다.
   ```bash
   gh variable set FIREBASE_WIF_PROVIDER_<SLUG> \
     --body "projects/$PROJNUM/locations/global/workloadIdentityPools/github-actions/providers/github"
   gh variable set FIREBASE_WIF_SERVICE_ACCOUNT_<SLUG> \
     --body "app-distribution-ci@$PROJECT.iam.gserviceaccount.com"
   ```
   > 서비스 계정과 WIF 풀은 **GCP 프로젝트 단위**다. `poptale-*`(dev-aipia-poptale)과
   > `characterchat-dev`(poptale-nonprod)처럼 Firebase 프로젝트가 다르면 3~4 를 프로젝트마다
   > 반복하고 변수도 슬러그별로 등록한다. 접미사 없는 `FIREBASE_WIF_PROVIDER` /
   > `FIREBASE_WIF_SERVICE_ACCOUNT` 는 공통 폴백.
   >
   > `characterchat-dev` 는 2026-10-01 싱가포르 `poptale-chat` 에서 서울 `poptale-nonprod` 로 옮겼다.
   > 이 프로젝트의 풀은 `github-actions` 가 아니라 **`github-pool`**, provider 는 레포 전용
   > **`github-app-harness`**(조건 `assertion.repository == 'aipia-team/app-harness'`)다. APK 고정 링크 버킷은
   > `poptale-nonprod-app-dist`(서울, allUsers 읽기, SA objectAdmin). Firebase 관리 권한(`roles/firebase.admin`)은
   > 박현아(hyuna_park@aipia.co.kr).

### 배포
```bash
# 태그 푸시 — Firebase + Play 둘 다
git tag <slug>-v<버전> && git push origin <slug>-v<버전>

# Firebase 만, 즉석으로
gh workflow run release.yml --ref <브랜치> \
  -f slug=<slug> -f platform=android -f android_channel=firebase -f firebase_groups=aipia_internal
```

### ⚠️ 주의 — 서명 키가 Play 빌드와 다르다

App Distribution APK 는 **업로드 키**로 서명된다. Play 는 여기에 **앱 서명 키**를 다시 씌운다.
지문(SHA-1/SHA-256)에 묶인 기능은 두 빌드에서 다르게 동작한다:

| 기능 | 증상 |
|---|---|
| Google 로그인 · Kakao · Naver SDK | 업로드 키 지문이 각 콘솔에 등록돼 있지 않으면 App Distribution 빌드에서만 로그인 실패 |
| App Link(딥링크) 검증 | `android.sha256CertFingerprints` 에 **업로드 키 지문도** 넣어야 앱 링크가 열린다(§ `02-GUIDE §6`) |

→ 두 지문을 모두 등록해 두면 양쪽이 같이 동작한다. `adb shell pm get-app-links <package>` 로 확인.

### 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 잡 로그에 `FIREBASE_WIF_PROVIDER* 변수 미설정 — 건너뜀` | 레포 변수 미등록 | 위 4번 |
| `403 The caller does not have permission` | SA 에 `roles/firebaseappdistro.admin` 없음 | 위 3-2 |
| 인증 스텝: `Unable to acquire impersonated credentials` / `permission iam.serviceAccounts.getAccessToken` | WIF 바인딩의 레포 경로가 다름 | 위 3-3 의 `attribute.repository/aipia-team/<레포>` 확인 |
| 인증 스텝: `Missing id-token permission` | 잡에 `permissions.id-token: write` 없음 | `release.yml` 의 android 잡 permissions 확인 |
| `gcloud iam service-accounts keys create` 가 `FAILED_PRECONDITION` | 조직이 SA 키 발급 차단 (`iam.disableServiceAccountKeyCreation`) | 정상이다. 키 대신 WIF 를 쓴다 — 위 3번 |
| `Could not find action, lane or variable 'firebase_app_distribution'` | 플러그인 gem 미설치, 또는 Pluginfile 만 믿고 require 를 빠뜨림 | §5 의 플러그인 로딩 주의 — Fastfile 의 require 와 워크플로 `gem install` 확인 |
| `google-services.json 없음 — Firebase 미등록 앱` | `GOOGLE_SERVICES_B64_<SLUG>` 미등록 | §4 표 |
| `google-services.json 에 패키지 … 항목이 없습니다` | 다른 앱의 설정 파일이 주입됨 | 시크릿 이름의 슬러그 확인 |
| 업로드는 성공인데 아무도 못 받음 | 콘솔에 없는 그룹 별칭 | 콘솔의 그룹 별칭과 `firebase_groups` 를 일치 |
| 테스터가 "앱을 설치할 수 없음" | 같은 패키지가 **다른 키로 서명**돼 이미 설치됨(Play 버전) | 기존 앱 삭제 후 설치. dev 앱은 `appId` 를 분리(`.dev`)해 공존 |
