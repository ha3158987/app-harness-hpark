# ONBOARDING — 하네스에 새 서비스(앱) 추가하기

회사 개발자가 자기 웹 서비스를 이 하네스로 앱화하는 전체 흐름. **코드가 아니라 정의(config)**
한 개를 추가하면 앱이 찍혀 나온다.

## 0. 큰 그림
```
당신 웹(따로 배포)  ──원격로드──▶  [하네스가 만든 네이티브 셸(APK/IPA)]
                                      apps/<slug>/app.config.json 한 개로 정의
```
- 웹 통합(브릿지 호출)은 `docs/06-INTEGRATION.md`.
- 빌드/배포는 `docs/08-DEPLOY.md`. 인증/결제 정책은 `docs/10-AUTH.md` / `docs/11-IAP.md`.

## 1. 빌드 환경 (최초 1회)
| | 필요 |
|---|---|
| Android | JDK 21(`JAVA_HOME`), Android SDK(`ANDROID_HOME`, platform 35, build-tools 35) |
| iOS | macOS + Xcode 26 + CocoaPods (또는 CI macOS 러너 — 맥 없이) |
| 공통 | Node 24 (`.nvmrc` — `nvm use`). 최소 22 |
> 점검: `node scripts/doctor.mjs` (환경/모든 앱 config 검사)

## 2. 새 앱 추가 (단계)
1. **정의 만들기** — `apps/<slug>/app.config.json` 작성. 스키마는 `docs/02-GUIDE.md` §6.
   최소: `slug, appName, appId(역도메인), startUrl(https)`. 기능/인증/결제는 필요한 것만 켠다.
   (스킬: `new-app` 가 대화로 만들어 줌)
2. **아이콘/스플래시** — `apps/<slug>/icon.png`(1024²), `splash.png`(2732²) 넣기.
   (스킬: `generate-assets`. 없으면 기본 아이콘으로 빌드는 됨)
3. **프로젝트 생성/빌드(로컬 확인)**:
   ```bash
   node scripts/generate-app.mjs --slug <slug> --platform android
   cd build/<slug>/android && ./gradlew assembleDebug      # 디버그 APK
   ```
4. **웹 통합** — 웹 서비스에 `@harness/bridge` 추가하고 필요한 기능 호출(`docs/06-INTEGRATION.md`).
5. **배포** — 태그 푸시 `git tag <slug>-v1.0.0 && git push origin <slug>-v1.0.0`
   또는 Actions 수동 실행. 베타/내부 트랙까지 자동(`docs/08-DEPLOY.md`). 프로덕션은 수동.

## 3. config 에서 켤 수 있는 것 (요약)
| 블록 | 무엇 | 문서 |
|---|---|---|
| `features` | push/deepLink/biometric/camera/share/forceUpdate/secureStorage/localNotification/haptics/clipboard/geolocation | GUIDE §6 |
| `navigation` | 셸 내부탐색 허용 도메인 | GUIDE §6 |
| `marketing` | AppsFlyer(어트리뷰션) 등 | docs/13-MARKETING.md |
| `auth` | 로그인 — 브로커(팝챗형) / 네이티브 OAuth(poptale형) | docs/25-AUTH-DELEGATION.md |
| `iap` | 인앱결제(디지털 재화) | docs/11-IAP.md |
| `monitoring` | 크래시 리포트(Sentry) | — |

## 4. 비밀값은 절대 config/레포에 X
서명키·소셜 secret·스토어 키·DSN 일부 등은 **환경변수 / GitHub Secrets / fastlane match** 로만.
`app.config.json` 엔 공개값(clientId/dsn 등)만. 목록은 `docs/08-DEPLOY.md` §4.

## 5. 자주 묻는 것
- **웹만 바뀌었는데 앱 다시 내야 하나?** 아니오. 원격 로드라 웹 배포로 끝. 앱 재배포는 버전업/네이티브 기능 변경 때만.
- **iOS 맥 없이?** 가능. GitHub 호스티드 macOS 러너로 빌드(Apple Developer 멤버십+서명 필요). `docs/08-DEPLOY.md`.
- **기능 켰는데 안 돼요** — 브릿지가 `ready()` 때 capability↔메서드 불일치를 콘솔 경고. config 토글 + (필요시) 백엔드/스토어 설정 확인.
