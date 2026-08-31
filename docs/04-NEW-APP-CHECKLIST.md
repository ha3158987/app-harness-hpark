---
doc: 04
title: NEW-APP-CHECKLIST — 사람이 직접 해야 하는 일 전부
category: 앱추가
audience: 배포담당자
status: active
updated: 2026-08-20
---

# NEW-APP-CHECKLIST — 사람이 직접 해야 하는 일 전부

> **읽는 사람**: 하네스로 새 앱을 처음 만드는 사람.
> **이 문서의 범위**: 코드가 아니라 **콘솔·계정 작업**. `generate-app` 이 대신 해주지 않는 것만 모았다.
> **원칙**: 위에서부터 순서대로. 순서를 지키지 않으면 막히는 지점이 실제로 있다(§C-2, §H).
>
> 관련: [../ONBOARDING.md](../ONBOARDING.md)(코드 흐름) · [09-CREDENTIALS.md](./09-CREDENTIALS.md)(시크릿 구조) ·
> [08-DEPLOY.md](./08-DEPLOY.md)(CI) · [17-DATA-COLLECTION.md](./17-DATA-COLLECTION.md)(신고 항목 정답지) ·
> [14-ATT-INTEGRATION.md](./14-ATT-INTEGRATION.md)(ATT 상세)

---

## 0. 자동 / 수동 경계

하네스가 해주는 것과 사람이 해야 하는 것을 먼저 구분한다. 이 경계를 모르면 "왜 안 되지"에 시간을 쓴다.

| | 누가 |
|---|---|
| Capacitor 프로젝트 생성, 플러그인 설치, 네이티브 배관 | ✅ `generate-app` |
| 아이콘·스플래시 전 사이즈 생성 | ✅ `generate-assets` |
| 빌드·서명·업로드 실행 | ✅ CI (`release.yml`) |
| 인증서·keystore·ASC 키 | ✅ 조직 공유분 재사용 (새로 발급 불필요) |
| **스토어 앱 레코드 등록** | 🙋 사람 |
| **App ID 등록 (Apple)** | 🙋 사람 — 앱 + **확장마다 따로** |
| **프로비저닝 프로파일 생성** | 🙋 사람 (`regen_profile` 1회) |
| **SHA-256 지문 확보** | 🙋 사람 (Play Console) |
| **`.well-known` 파일 웹 배포** | 🙋 사람 (파일 생성은 하네스가) |
| **데이터 안전성 / 개인정보 라벨** | 🙋 사람 |
| **Firebase 프로젝트·키 파일** | 🙋 사람 |

> ⚠️ `09-CREDENTIALS.md §4` 의 "새 앱 추가 = 인증 작업 0" 은 **시크릿 발급이 0**이라는 뜻이지
> **콘솔 작업이 0**이라는 뜻이 아니다. 아래가 그 콘솔 작업이다.

---

## A. 사전 확인 (5분)

- [ ] **Apple Developer 멤버십이 유효한가** — developer.apple.com/account 상단 배너 확인.
      만료되면 **기존 프로파일까지 전부 무효**가 되어 빌드·업로드가 모두 멈춘다. 갱신은 계정 소유자만 가능.
- [ ] Play Console 접근 권한이 있는가
- [ ] 이 앱의 슬러그·번들 ID·도메인이 정해졌는가 ([01-AIPIA-CONVENTIONS.md](./01-AIPIA-CONVENTIONS.md) 규칙)

---

## B. 스토어 앱 레코드 등록

빌드를 올릴 "그릇"을 먼저 만든다. 없으면 업로드 단계에서 실패한다.

- [ ] **App Store Connect** → 앱 → **+** → 신규 앱
      - 번들 ID는 §C-1 에서 만든 App ID 를 고르는 방식이라 **C-1 을 먼저 해도 된다**
      - SKU 는 슬러그 그대로 권장
- [ ] **Play Console** → 앱 만들기 (Android 배포 시)

---

## C. Apple 서명 — 여기서 가장 많이 막힌다

### C-1. App ID 등록 — **앱과 확장을 각각**

`developer.apple.com/account` → 인증서, ID 및 프로파일 → **식별자(영문)** → **+** → App IDs → App

- [ ] 앱 본체: `com.aipia.<slug>` (Bundle ID = **Explicit**)
- [ ] **알림 확장**: `com.aipia.<slug>.NotificationService`
      → **푸시 알림을 쓰면 반드시 필요.** Capabilities 는 아무것도 체크하지 않는다.
- [ ] dev/stage flavor 를 쓴다면 그 번들 ID 도 각각 (+ 각각의 `.NotificationService`)

> 🔴 **가장 흔한 함정.** 알림 확장은 앱 안에 들어가지만 **애플 눈에는 별개의 앱**이다.
> 확장 App ID 를 안 만들면 빌드가 이렇게 실패한다:
> `Couldn't find bundle identifier '….NotificationService'`
> 그런데 이 에러는 **확장을 도입한 뒤 첫 iOS 빌드에서야** 나타난다 — 그전까지는 멀쩡하다.

### C-2. 프로비저닝 프로파일 생성 — **순서 주의**

CI 의 `match` 는 `readonly` 라 스스로 프로파일을 만들지 못한다. 로컬에서 1회 만들어 팀 저장소에 올려야 한다.

```bash
cd ~/Documents/app-harness
node scripts/generate-app.mjs --slug <slug> --platform ios   # ① 먼저 프로젝트 생성
/opt/homebrew/bin/fastlane ios regen_profile slug:<slug>     # ② 그다음 프로파일
```

- [ ] 위 순서대로 실행했다
- [ ] 출력에 **앱과 확장 두 개**의 번들 ID 가 찍혔다

> 🔴 **①을 건너뛰면 확장 프로파일이 안 만들어진다.** lane 이 "프로젝트에 확장 타깃이 있나"를 보고
> 판단하기 때문이다. 프로젝트가 없으면 확장이 없다고 보고 조용히 건너뛴다.
> 출력에 번들 ID 가 하나만 찍혔다면 ①을 안 한 것이다.

---

## D. Android 서명 지문 (딥링크 쓸 때)

- [ ] Play Console → 앱 → **테스트 및 출시 → 설정 → 앱 서명**
- [ ] **앱 서명 키 인증서**의 SHA-256 복사
- [ ] **업로드 키 인증서**의 SHA-256 복사
- [ ] `apps/<slug>/app.config.json` 에 **둘 다** 기입

```jsonc
"android": { "sha256CertFingerprints": ["<앱 서명 키>", "<업로드 키>"] }
```

> 🔴 **업로드 키만 넣으면 App Link 검증이 조용히 실패**해 링크가 브라우저로 열린다. 에러가 안 난다.
> 확인: `adb shell pm get-app-links <package>` → `verified` 여야 한다.
>
> Play 에 아직 등록 전이라면 앱 서명 키가 없다. 업로드 키만으로 시작하고, 등록 후 추가한다.

---

## E. Firebase (푸시 쓸 때)

- [ ] Firebase 콘솔에서 프로젝트 생성 (또는 기존 프로젝트 사용)
- [ ] iOS 앱 등록 → `GoogleService-Info.plist` 다운로드
- [ ] Android 앱 등록 → `google-services.json` 다운로드
- [ ] APNs 인증 키를 Firebase 에 업로드 (iOS 푸시 필수)
- [ ] 두 파일을 **GitHub Secrets 에 base64 로** 등록 (레포에 커밋 금지)
      `GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG>` / `GOOGLE_SERVICES_B64_<SLUG>`
- [ ] `app.config.json` 의 `firebase` 블록에 프로젝트 ID 기입

---

## F. 웹 배포 (딥링크 쓸 때)

`generate-app` 이 파일을 만들어 두면, **웹 레포에 옮기는 건 사람**이 한다.

```bash
node scripts/generate-app.mjs --slug <slug> --skip-install
# → build/<slug>/well-known/<host>/ 에 2개 파일 생성 (네이티브 빌드 불필요)
```

- [ ] `apple-app-site-association` → 웹의 `/.well-known/` (**확장자 없음**, `Content-Type: application/json`)
- [ ] `assetlinks.json` → 웹의 `/.well-known/`
- [ ] 두 경로가 **인증 미들웨어에서 제외**되는가 (Apple/Google 크롤러는 비로그인 접근)
- [ ] 리다이렉트 없이 **200** 으로 응답하는가

```bash
curl -sI https://<host>/.well-known/apple-app-site-association
```

> ⚠️ 한 호스트를 여러 앱(dev/stage/prod)이 쓰면 하네스가 **한 파일에 합쳐서** 생성한다.
> 앱별로 따로 올리면 나중 것이 앞선 것을 덮어 링크가 깨진다.

---

## F-2. 어트리뷰션 MMP (광고 집행할 때)

MMP 를 안 쓰면 이 절 전체를 건너뛴다. 상세 절차는 **[24-MMP-CONSOLE-SETUP.md](./24-MMP-CONSOLE-SETUP.md)**.

- [ ] `app.config.json` 의 `marketing.attribution.provider` 결정 (`adbrix` = AIPIA 표준)
- [ ] 벤더 대시보드(DFINERY 등)에 앱 등록 — **iOS / Android 각각**
- [ ] App Key / Secret Key 발급
- [ ] **GitHub Secrets 등록** — `ADBRIX_APP_KEY_<SLUG>` / `ADBRIX_SECRET_KEY_<SLUG>`
      (`<SLUG>` = 대문자 + 하이픈→언더스코어. 예: `characterchat-dev` → `CHARACTERCHAT_DEV`)
- [ ] 트래킹 링크 생성 (마케팅) + 목적지 딥링크 형식 합의
- [ ] **검증** — 베이크된 `app-config.json` 의 키가 `null` 이 아닌지 확인

> 🔴 **키가 없어도 빌드는 성공한다.** 경고만 뜨고 앱도 정상 동작하며, 어트리뷰션만 조용히 0건이 된다.
> 그래서 마지막 검증 항목이 필수다 — 방법은 [24-MMP-CONSOLE-SETUP §6](./24-MMP-CONSOLE-SETUP.md).

> 🔴 **Adbrix 를 켜면 Android 에 `AD_ID` 권한이 자동으로 붙는다.** 아래 G 의 광고 ID 신고가 필수가 된다.

---

## G. 스토어 신고 양식 — **앱마다 필수**

무엇을 신고할지는 [17-DATA-COLLECTION.md](./17-DATA-COLLECTION.md) 가 정답지다. 켠 기능만 보고 옮겨 적으면 된다.

- [ ] **App Store Connect** → 앱 개인정보(App Privacy)
- [ ] **Play Console** → 데이터 안전성
- [ ] 개인정보처리방침 URL 작성·게시 → `app.config.json` 의 `legal.privacyUrl`
- [ ] 연령 등급 설정 (Apple / GRAC)

> 🔴 **어트리뷰션 SDK(Adbrix·AppsFlyer)를 켰다면 "광고 식별자 수집·제3자 공유"를 반드시 신고**한다.
> 빠뜨리는 것이 가장 흔한 리젝 사유다. 양쪽 콘솔에 정확히 무엇을 답할지는
> [24-MMP-CONSOLE-SETUP §3·§4](./24-MMP-CONSOLE-SETUP.md) 에 항목별로 적어 뒀다.

---

## H. 첫 빌드 & 배포

### H-1. 로컬에서 프로젝트 생성

```bash
nvm use                                                     # .nvmrc = 24 (최소 22)
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8                  # CocoaPods 필수
node scripts/generate-app.mjs --slug <slug> --platform ios
```

- [ ] **Node 24 권장 / 22 이상 필수** — v20 이면 Capacitor CLI 가 거부한다
- [ ] **`LANG` 을 UTF-8 로** — 비어 있으면 CocoaPods 가
      `Unicode Normalization not appropriate for ASCII-8BIT` 로 죽는다

### H-2. CI 실행

```bash
gh workflow run release.yml -f slug=<slug> -f platform=ios -f track=internal
```

- [ ] 머지만으로는 **자동 빌드되지 않는다.** 태그 푸시(`<slug>-v*`) 또는 위 수동 실행이 필요하다

### H-3. TestFlight 배포

- [ ] App Store Connect → TestFlight → 해당 빌드 → **개인 테스터 +** 로 테스터 추가
      (테스터가 0명이면 아무도 받을 수 없다)
- [ ] 테스터가 팀에 없으면 **사용자 및 액세스**에서 먼저 초대
- [ ] 내부 테스트는 심사 없이 즉시 배포된다

---

## I. 기능별 추가 셋업

켠 기능에만 해당한다.

| 기능 | 추가로 필요한 것 |
|---|---|
| **ATT** | `tracking.att.usageDescription` 필수(없으면 빌드 실패) · 문구 법무 검토 · [14-ATT-INTEGRATION.md](./14-ATT-INTEGRATION.md) |
| **딥링크** | §D 지문 · §F `.well-known` · Xcode 에서 Associated Domains 확인 |
| **푸시** | §E Firebase · §C-1 확장 App ID · APNs 키 |
| **IAP** | 스토어 상품 등록(가격 티어) · 영수증 검증 백엔드(`iap.verifyEndpoint`) |
| **소셜 로그인** | 각 공급자 콘솔에서 앱 등록 + clientId · Apple 4.8 준수(소셜 쓰면 Apple 로그인 필수) |
| **강제 업데이트** | 버전 JSON 호스팅 또는 Firebase Remote Config |

---

## J. 자주 막히는 곳

실제로 겪은 것들이다. 증상만 보고는 원인을 찾기 어려운 것 위주로 적었다.

| 증상 | 원인 | 조치 |
|---|---|---|
| `Couldn't find bundle identifier ….NotificationService` | 확장 App ID 미등록 | §C-1 |
| `No matching provisioning profiles found` | 프로파일 미생성 | §C-2 |
| 프로파일 만들었는데 확장 것만 없음 | 프로젝트 생성 전에 `regen_profile` 실행 | §C-2 순서대로 |
| `Provisioning profile … doesn't include the aps-environment entitlements` | 확장에 앱 entitlements 가 붙음 | 하네스 버그 — 2026-08-20 수정됨. 하네스를 최신으로 |
| `The Capacitor CLI requires NodeJS >=22` | Node 20 | §H-1 |
| `Unicode Normalization … ASCII-8BIT` | `LANG` 미설정 | §H-1 |
| 딥링크가 브라우저로 열림 | `.well-known` 미배포 또는 지문 1개 | §D, §F |
| ATT 팝업이 안 뜸 | 기기 전역 추적 설정 OFF / 이미 응답함 / 로그인 전 | [14-ATT-INTEGRATION.md](./14-ATT-INTEGRATION.md) §7 |
| 기능을 켰는데 플러그인이 안 깔림 | 기존 `build/` 의 package.json 미갱신 | 2026-08-20 수정됨(자동 보강). 그전 버전은 `rm -rf build/<slug>` |
| config 문구를 바꿨는데 앱에 반영 안 됨 | plist 는 **add-once** — 기존 값은 안 고침 | `rm -rf build/<slug>` 후 재생성 |
| TestFlight 에 빌드가 안 보임 | 테스터 미추가 / 처리 중 | §H-3 |

---

## K. 검증 명령 모음

배포 전에 훑으면 대부분의 사고를 잡는다.

```bash
# 환경
node -v                                    # 22 이상
echo $LANG                                 # UTF-8

# 프로젝트
node scripts/doctor.mjs                    # 환경 + 전체 앱 config 검사

# ATT
grep -A1 NSUserTrackingUsageDescription build/<slug>/ios/App/App/Info.plist
ls build/<slug>/node_modules/capacitor-plugin-app-tracking-transparency

# 딥링크
curl -sI https://<host>/.well-known/apple-app-site-association
adb shell pm get-app-links <package>       # verified 여야 함

# 버전
grep -m1 CURRENT_PROJECT_VERSION build/<slug>/ios/App/App.xcodeproj/project.pbxproj
```

---

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-20 | 최초 작성. characterchat-dev 의 ATT 도입·첫 확장 빌드에서 실제로 막힌 지점을 근거로 정리 |
