---
doc: 12
title: 푸시 알림(FCM) 셋업 가이드 — 새 앱 출시용
category: 기능연동
audience: 개발자
status: active
updated: 2026-08-10
---

# 푸시 알림(FCM) 셋업 가이드 — 새 앱 출시용

app-harness 로 새 앱을 만들 때 **푸시 알림(원격 FCM)** 을 붙이는 전체 과정을 정리한다.
**하네스가 자동으로 해주는 것**과 **직접 세팅해야 하는 것**을 구분했다. 순서를 지키면 iOS 빌드가 안 깨진다.

> 배포/서명 런북은 [08-DEPLOY.md](./08-DEPLOY.md) §6(capability→프로파일)·§9(iOS 푸시)와 함께 본다.

---

## 0. 아키텍처 한눈에

```
[앱(웹뷰, 원격 웹 로드)]
   └ 로그인 → 브릿지 registerPush()
        iOS : @capacitor/push-notifications(APNs 등록) + @capacitor-community/fcm(FCM 토큰)
        And : @capacitor/push-notifications(registration 토큰 = FCM 토큰)
   └ 받은 FCM 토큰을 auth.deviceEndpoint(백엔드)로 등록  (기기↔계정 바인딩)

[백엔드]  FCM HTTP v1 로 발송 (해당 Firebase 프로젝트의 서비스계정)
   └ iOS: APNs → 기기 / Android: FCM → 기기
   └ 탭 시 data.url|deep_link → 브릿지가 딥링크 라우팅
```

핵심 3가지:
- **FCM 토큰은 Firebase Installations(FIS) 위에 발급**된다. FIS = "이 앱 설치 = 어느 Firebase 프로젝트" 를 정하는 신원.
- **어느 프로젝트인지는 앱에 심는 `GoogleService-Info.plist`(iOS) / `google-services.json`(Android) 이 결정**한다. → 이 파일(=CI 시크릿)이 **백엔드가 발송하는 프로젝트와 반드시 같아야** 한다.
- 브릿지 JS 는 **원격 웹 번들에서 실행**된다(앱 바이너리 아님). 브릿지 기능 변경은 **웹 재배포**로 반영, 앱 재빌드는 네이티브 변경일 때만.

---

## 1. ✅ 하네스가 자동으로 해주는 것 (건드릴 필요 없음)

`features.push: true` + `firebase.enabled/fcm: true` 이면 `generate-app` + `release.yml` + 브릿지가 아래를 자동 처리한다.

**generate-app (네이티브 배선)**
- 플러그인 설치: `@capacitor/push-notifications`, `@capacitor-community/fcm`
- iOS `App.entitlements`: `aps-environment = production` (TestFlight/App Store 용)
- iOS `Info.plist`: `UIBackgroundModes = remote-notification`
- iOS pbxproj: `GoogleService-Info.plist` 를 번들 리소스로 등록
- iOS `AppDelegate`: `FirebaseApp.configure()` 주입
- Android: 푸시 권한(POST_NOTIFICATIONS 등)

**release.yml (CI)**
- `@capacitor/assets` 로 아이콘/스플래시 생성(`apps/<slug>/icon.png` 소스)
- 시크릿 → 파일 주입: `GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG>` → iOS plist, `GOOGLE_SERVICES_B64_<SLUG>` → Android json

**브릿지 (`@aipia-team/harness-bridge`)**
- `registerPush()`:
  - iOS — Firebase 스위즐링으로 `registration` 이벤트가 안 떠서, `FCM.getToken()` 을 **지수 백오프**로 직접 취득(FIS 429 rate-limit 회피). throttle 지속 시 `deleteInstance()` 로 FID 초기화 자가복구.
  - Android — `registration` 토큰이 곧 FCM 토큰.
  - 받은 토큰을 `auth.deviceEndpoint` 로 등록.
- `pushNotificationActionPerformed` → `data.url | deep_link | deep_link_value` 를 통합 딥링크로 라우팅.

**웹 (`HarnessInit`)**
- 앱 + 로그인 상태면 **자동으로 `registerPush()` 호출**(유저당 1회). "푸시 등록" 버튼은 수동 재시도용일 뿐.

> 즉 iOS 알림 아이콘, aps-environment, Firebase 초기화, 토큰 취득/백오프, 딥링크 라우팅은 **손 안 대도 된다.**

---

## 2. 🔧 직접 세팅해야 하는 것 (순서 중요)

### Step 1 — `apps/<slug>/app.config.json` 플래그
```jsonc
{
  "features": { "push": true, "deepLink": true },   // AIPIA 프리셋은 기본 on
  "auth": { "deviceEndpoint": "https://api.<도메인>/api/push/register" },
  "navigation": { "allowedDomains": ["<웹호스트>", "*.<루트도메인>"] },
  "firebase": {
    "enabled": true,
    "project": { "dev": "<Firebase 프로젝트 ID>" },   // ⚠️ 표시용. 실제는 시크릿(plist/json)이 결정
    "fcm": true
  }
}
```

### Step 2 — Firebase 프로젝트 & 앱 등록  ⚠️ 가장 중요
1. **정본 프로젝트 하나를 확정**한다. = **백엔드가 FCM 을 발송하는 그 프로젝트.** (중복/옛 프로젝트 주의 — 여기서 틀리면 "한 플랫폼만 됨" 증상)
2. 그 프로젝트에 **iOS 앱(번들 ID)** + **Android 앱(패키지명)** 등록.
3. **`GoogleService-Info.plist`(iOS)** + **`google-services.json`(Android)** 다운로드.
4. 검증: plist 의 `GCM_SENDER_ID` == json 의 `project_number` == 백엔드 발송 프로젝트 번호. (셋이 같아야 함)

### Step 3 — APNs 인증 키 업로드 (iOS 수신 필수)
- Firebase 콘솔 → 프로젝트 설정 → **Cloud Messaging → Apple 앱 구성 → APNs 인증 키(.p8)** 업로드.
- **정본 프로젝트에** 올린다(옛 프로젝트에만 있으면 수신 안 됨). 인증 키(.p8)는 sandbox·production 공용.
- 조직 공용 키: 개발 `V9MBUA8BBJ` / 프로덕션 `T93AM54S8N` (팀 `3W889GYPRK`).

### Step 4 — Apple Developer App ID capability
- App ID 에 **Push Notifications** 체크. (deepLink 쓰면 **Associated Domains** 도)
- Save → Confirm.

### Step 5 — match 프로비저닝 프로파일 재생성  ⚠️ Step 4 하면 필수
```bash
/opt/homebrew/bin/fastlane ios regen_profile slug:<slug>
```
- capability 를 켰는데 프로파일을 재생성 안 하면 **iOS 빌드가 서명에서 깨진다**(08-DEPLOY.md §6과 동일 실패모드).
- 기본 `fastlane`(시스템 Ruby+LibreSSL)은 ASC `.p8`(EC키)에서 `invalid curve name` → **`/opt/homebrew/bin/fastlane`** 사용.

### Step 6 — GitHub Secrets 등록  ⚠️ 실제 프로젝트를 결정하는 파일
```bash
base64 -i GoogleService-Info.plist | tr -d '\n' | gh secret set GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG_대문자> -R aipia-team/app-harness
base64 -i google-services.json     | tr -d '\n' | gh secret set GOOGLE_SERVICES_B64_<SLUG_대문자>          -R aipia-team/app-harness
```
- `<SLUG_대문자>` = slug 을 대문자로, `-` → `_` (예: `characterchat-dev` → `CHARACTERCHAT_DEV`).
- **`app.config.project` 는 표시용일 뿐, 이 시크릿(plist/json)이 앱이 실제로 붙는 프로젝트를 결정**한다. config 만 바꾸고 시크릿을 안 바꾸면 조용히 깨진다 → **항상 같이 맞출 것.**

### Step 7 — 웹 레포
- 의존성 추가: `@aipia-team/harness-bridge`(최신) + `@capacitor-community/fcm`(^8).
- `HarnessInit` 에서 로그인 시 `registerPush()` 호출 배선 확인(이미 표준 배선이면 그대로).
- **웹 배포** (원격 웹 번들에 브릿지가 들어가야 앱에서 실행됨).

### Step 8 — 백엔드
- `POST {auth.deviceEndpoint}` 로 토큰 등록 받기(기기↔계정).
- **FCM HTTP v1** 로 발송 — **Step 2 정본 프로젝트의 서비스계정** 사용(`FCM_PROJECT_ID`/SA JSON 프로젝트가 그 프로젝트여야 함).

---

## 3. 빌드 · 배포 · 검증

1. `apps/<slug>/app.config.json` 의 `version.code` +1 (매 업로드마다 필수, 스토어 중복 거부 방지).
2. 배포 트리거: 태그 `<slug>-v<버전>` push, 또는 `gh workflow run release.yml --ref <branch> -f slug=<slug> -f platform=ios -f track=internal`.
3. 검증:
   - 앱 로그인 → 자동 `registerPush()` → 데모 페이지 호출 로그 or 백엔드에서 **FCM 토큰** 확인.
   - Firebase 콘솔 → 참여 → Messaging → **테스트 메시지 전송** → 그 토큰 → 앱 백그라운드 → **배너 수신** 확인.
   - 이후 백엔드 실제 발송 경로로 최종 확인.

---

## 4. ⚠️ 함정 & 트러블슈팅 (실제로 겪은 것들)

| 증상 | 원인 | 해결 |
|---|---|---|
| **한 플랫폼만 됨** (예: Android O, iOS X) | iOS/Android 가 **서로 다른(옛 중복) Firebase 프로젝트** 를 봄 | plist `GCM_SENDER_ID` == json `project_number` == 백엔드 프로젝트인지 확인. CI 시크릿을 정본 plist/json 으로 갱신 |
| `Too many server requests` (FIS 429), 며칠 지속 | `FCM.getToken` 을 촘촘히 연타 → FIS rate-limit (프로젝트/기기 stuck) | 브릿지 백오프(기본). 이미 걸렸으면 그 프로젝트에서 시간 필요 — **연타 금지** |
| iOS 토큰 안 옴(hang / `{granted:true}` 만) | Firebase 스위즐링으로 `registration` 이벤트 미발화 | 브릿지가 `FCM.getToken` 직접 취득(자동, 손 댈 것 없음) |
| iOS 빌드 서명 실패(capability 관련) | capability 켰는데 match 프로파일 구버전 | Step 4 + Step 5(regen_profile) |
| 알림에 **기본(회색) 아이콘** | iOS 알림 아이콘 = **앱 아이콘**(별도 지정 없음). 캐시 잔상 | 앱 삭제 → **기기 재부팅** → 재설치 |
| iOS 푸시 수신만 안 됨(토큰은 옴) | 정본 프로젝트에 **APNs 키 미업로드** | Step 3 |
| **Android 알림 탭해도 앱이 안 열림** (iOS 는 정상) | 백엔드 페이로드의 `android.notification.click_action`(예: Flutter 잔재 `FLUTTER_NOTIFICATION_CLICK`). FCM SDK 는 이 값이 있으면 그 액션을 받는 Activity 만 실행하고 런처 폴백을 안 한다 — Capacitor 앱엔 그 인텐트 필터가 없음 | 백엔드에서 `click_action` 제거. 탭 라우팅은 `data.url` 만으로 동작한다 |

**기억할 것**
- 실제 프로젝트를 정하는 건 **CI 시크릿(plist/json)**. `app.config.project` 는 표시용.
- iOS 알림 아이콘은 **앱 아이콘**이 전부(Android 처럼 별도 small icon 없음). Android 는 별도 알림 아이콘 설정 필요.
- `aps-environment` 는 TestFlight/App Store = `production` (하네스 자동).
- 브릿지 변경은 **웹 재배포**로 반영.

---

## 5. 새 앱 빠른 체크리스트

- [ ] `app.config.json`: `features.push`, `firebase.enabled/project/fcm`, `auth.deviceEndpoint`, `navigation.allowedDomains`
- [ ] Firebase **정본 프로젝트** 확정 (= 백엔드 발송 프로젝트) → iOS·Android 앱 등록 → plist/json 다운로드
- [ ] plist `GCM_SENDER_ID` == json `project_number` == 백엔드 프로젝트 **일치 확인**
- [ ] Firebase Cloud Messaging → **APNs .p8 업로드** (정본 프로젝트)
- [ ] Apple App ID: **Push Notifications** (+deepLink 면 Associated Domains) → **regen_profile**
- [ ] GitHub Secrets: `GOOGLE_SERVICE_INFO_PLIST_B64_<SLUG>`, `GOOGLE_SERVICES_B64_<SLUG>`
- [ ] 웹: bridge + `@capacitor-community/fcm` 의존성 + 배포
- [ ] 백엔드: `deviceEndpoint` 수신 + FCM v1 발송(정본 프로젝트 SA)
- [ ] `version.code` +1 → 빌드/배포 → 토큰 확인 → 테스트 메시지 수신 확인
