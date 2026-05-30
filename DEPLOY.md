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

## 6. 알려진 iOS 전제 (첫 실행 전 확인)
- **fastlane match** 가 인증서/프로비저닝을 관리하고 있어야 한다(최초 `fastlane match appstore` 1회).
- **associated-domains / OAuth URL scheme 엔타이틀먼트의 Xcode 연결**: generate-app 이 파일은 만들지만
  `CODE_SIGN_ENTITLEMENTS` 의 pbxproj 연결은 자동화하지 않는다(손상 위험). 최초 1회 Xcode 에서 연결하거나
  pbxproj 패치를 추가해야 딥링크/소셜 복귀가 동작한다. (현재 iOS 빌드 미검증 — 첫 CI 실행에서 확인)

---

## 7. 프로덕션 게이트 (수동)
- iOS: TestFlight 까지만 자동. 외부 배포/심사 제출은 App Store Connect 에서 직접.
- Android: `internal`/`beta` 트랙 + `draft` 까지만. production 승격은 Play Console 에서 직접.
