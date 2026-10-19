---
doc: 12
title: 푸시 알림(FCM) 셋업 가이드 — 새 앱 출시용
category: 기능연동
audience: 개발자
status: active
updated: 2026-10-16
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
- Android: 푸시 권한(POST_NOTIFICATIONS 등). `features.pushConversation` 이면 캐릭터 대화 알림 서비스까지 — §7

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

---

## 6. iOS Communication Notifications — 캐릭터를 연락처처럼 (`features.pushConversation`)

캐릭터 선톡 푸시를 "앱 알림"이 아니라 "사람이 보낸 메시지"로 보이게 한다. iOS 15+ 에서 **캐릭터 아바타가 앱 아이콘 자리에 크게** 뜨고, **요약 알림(Scheduled Summary)·Focus 를 기본으로 통과**한다.
Apple 문서: <https://developer.apple.com/documentation/usernotifications/implementing-communication-notifications>

### 플래그
```jsonc
{
  "features": { "push": true, "pushConversation": true },   // 기본 false
  "firebase": { "enabled": true, "fcm": true }               // 알림 확장(NSE)이 생겨야 동작
}
```
- `push` 가 꺼져 있으면 config 검증 에러. `firebase.fcm` 이 꺼져 있으면 NSE 가 안 생겨 경고만 남는다.
- 현재 켠 앱: `characterchat-dev` 만. 프로덕션은 실기기 확인 뒤 별도로 켠다.

### generate-app 이 하는 일 (플래그 on 앱만)
- `App.entitlements`: `com.apple.developer.usernotifications.communication = true`
- 앱 `Info.plist`: `NSUserActivityTypes = [INSendMessageIntent]` — 없으면 기부가 무시돼 일반 알림으로 뜬다(조용한 실패).
- `NotificationService.swift`: `import Intents` + 아래 커뮤니케이션 경로. 플래그 off 앱의 생성물은 종전과 바이트 단위로 같다.

### BE 가 `data` 에 보내야 할 키
| 키 | 값 | 용도 |
|---|---|---|
| `characterId` | 캐릭터 ID(문자열) | `INPersonHandle` · 발신자 식별 |
| `characterName` | 표시 이름 | 알림 제목 자리의 발신자 이름 |
| `avatarUrl` | https 이미지 URL | 앱 아이콘 자리의 아바타 |
| `conversationId` | 대화방 ID(문자열) | 같은 대화끼리 묶임(`conversationIdentifier`) |

- `apns.payload.aps.mutable-content: 1` 은 종전대로 필수(NSE 를 깨운다). 본문은 `notification.body` 가 메시지 내용이 된다.
- FCM `data` 값은 전부 문자열이어야 한다(숫자 ID 도 문자열로).

### 동작과 폴백
1. 4개 키가 **전부** 있고 비어 있지 않으면 → 아바타를 확장 임시 디렉터리로 내려받는다(**타임아웃 8초**, 실패하면 이미지 없이 진행).
2. `INPerson` → `INSendMessageIntent` → `INInteraction(direction: .incoming).donate()` → `content.updating(from: intent)` 로 알림을 바꾼다.
3. 이 경로에서는 **FCM 이미지 첨부(`fcm_options.image`)를 건너뛴다** — 아바타가 이미 보인다.
4. 키가 하나라도 없거나, iOS 15 미만이거나, `updating(from:)` 이 실패하면 → 종전 `Messaging.serviceExtension().populateNotificationContent` 경로(일반 알림 + 이미지 첨부).
5. 시간 제한(`serviceExtensionTimeWillExpire`)에 걸리면 지금까지 만든 내용으로 내보낸다(알림은 반드시 뜬다).

### 사람이 할 일 (순서)
- [ ] Apple Developer → Identifiers → 앱 App ID → **Communication Notifications** 체크 → Save
- [ ] match 프로파일 재생성: `/opt/homebrew/bin/fastlane ios regen_profile slug:<slug>` (안 하면 서명에서 깨진다 — Step 5 와 같은 실패모드)
- [ ] BE 가 위 4개 키를 `data` 에 넣어 발송

### 실기기 확인 절차
- [ ] 플래그 on 앱을 sandbox 빌드(Xcode Run / 개발 프로파일)로 실기기에 설치 → 로그인 → FCM 토큰 확보
- [ ] sandbox APNs(또는 FCM HTTP v1) 로 `mutable-content: 1` + 4개 data 키를 넣은 푸시 1건 발송
- [ ] 잠금 화면에서 **앱 아이콘 대신 캐릭터 아바타**(앱 아이콘은 우하단 작은 배지)와 캐릭터 이름 확인
- [ ] `avatarUrl` 을 빼고 1건 더 → 일반 알림(+이미지 첨부)으로 뜨는지 폴백 확인
- [ ] Focus 켠 상태에서 한 건 → 설정 > 집중 모드 > 허용된 사람에 캐릭터가 후보로 뜨는지 확인

---

## 7. Android 캐릭터 대화 알림 — MessagingStyle + 대화 섹션 (`features.pushConversation`)

iOS §6 의 Android 짝. 캐릭터 선톡을 **메신저 메시지처럼** 그린다 — 아바타·이름이 붙은 `MessagingStyle` 알림, 그리고 캐릭터가 알림 설정의 **"대화" 섹션**에 long-lived 숏컷으로 올라간다(Android 11+). 기본 구현(03 "캐릭터를 연락처처럼").

### 전제 — BE 가 **data-only 메시지**를 보낼 때만 그린다
- FCM 은 `android.notification` 이 있는 메시지(notification 메시지)를 **백그라운드에서 SDK 가 직접 그리고 앱 코드를 부르지 않는다.** 그래서 아래 서비스는 `notification` 블록이 **없는** data-only 메시지에서만 동작한다.
- notification 메시지(control 그룹)는 종전대로 SDK 가 그린다. 다만 매니페스트 meta-data 로 **같은 아이콘·같은 채널**을 쓰게 맞춰 두었다(아래).
- BE 의 Android data-only 전환은 별도 작업이다. 전환 전까지는 이 코드가 호출되지 않는다.

### 플래그
```jsonc
{ "features": { "push": true, "pushConversation": true } }   // 기본 false · 현재 characterchat-dev 만
```

### generate-app 이 하는 일 (플래그 on 앱만 — off 앱의 생성물은 main 과 바이트 단위로 같다)
| 생성물 | 내용 |
|---|---|
| `java/<appId>/CharacterMessagingService.java` | 아래 "서비스" 참조. **Java** 다 — 앱 모듈에 kotlin-android 플러그인이 없다(MainActivity 도 .java). |
| `AndroidManifest.xml` | 플러그인 서비스 `tools:node="remove"` + 우리 서비스 등록(`MESSAGING_EVENT`) + `default_notification_icon=@drawable/ic_stat_push` + `default_notification_channel_id=character_messages`. 루트에 `xmlns:tools` 가 없으면 추가한다. |
| `res/drawable/ic_stat_push.xml` | 상태바 아이콘 **자리**. 임시 단색 원(컴파일용). 이미 파일이 있으면 건드리지 않는다. |
| `res/values/harness_push.xml` | 채널 이름 문자열 "캐릭터 메시지" |
| `app/build.gradle` | `implementation "com.google.firebase:firebase-messaging:<플러그인과 같은 규칙>"` — 아래 "왜" 참조 |

### 플러그인 서비스를 상속·대체한다 — 왜
- `@capacitor/push-notifications` 는 `com.capacitorjs.plugins.pushnotifications.MessagingService` 를 `com.google.firebase.MESSAGING_EVENT` 수신자로 등록한다. FCM 은 그 액션을 받는 서비스를 **하나만** 호출한다. 우리 서비스를 그냥 추가하면 플러그인이 토큰 갱신(`onNewToken`)·포그라운드 수신 이벤트를 **잃는다.**
- 그래서 우리 서비스는 플러그인 서비스를 **상속**하고, 매니페스트 머저로 플러그인 항목을 **제거**한 뒤 우리 것만 등록한다. 대화 키가 없으면 `super.onMessageReceived` 로 넘기므로 기존 동작은 그대로다. `onNewToken` 은 오버라이드하지 않는다(상속으로 플러그인에 전달).
- 플러그인 버전이 올라가 서비스 클래스명이 바뀌면 상속도 remove 도 조용히 깨진다 → generate-app 이 `node_modules` 의 플러그인 매니페스트에서 실제 서비스명을 읽어 대조하고, 다르면 **생성 단계에서 에러**를 낸다.
- **firebase-messaging 컴파일 의존성**: 플러그인(`@capacitor/push-notifications`, `@capacitor-community/fcm`)이 firebase-messaging 을 `implementation`(비노출)으로만 들고 있어 앱 모듈이 `FirebaseMessagingService`/`RemoteMessage` 를 못 본다. 상속을 위해 **컴파일 가시성만** 추가하는 것이고, 플러그인과 같은 버전·같은 해석 규칙(`firebaseMessagingVersion ?: 25.0.1`)이라 **APK 내용은 불변**이다.

### 서비스 동작 (`onMessageReceived`)
1. `notification` 블록이 없고 `data` 에 `characterId`·`characterName`·`avatarUrl`·`conversationId`·`title`·`body`·`url` 이 **전부** 있을 때만 진행. 하나라도 없으면 아무것도 안 그리고 `super` 로 넘긴다.
2. 채널 `character_messages`("캐릭터 메시지", IMPORTANCE_HIGH) 가 없으면 만든다.
3. `avatarUrl` 을 `HttpURLConnection` 으로 받는다(연결·읽기 **타임아웃 5초**, 외부 라이브러리 없음). 실패하면 이름 첫 글자 **이니셜 아이콘**. 원형으로 잘라 `IconCompat` 로 만든다.
4. `ShortcutManagerCompat.pushDynamicShortcut` — id=`characterId`, `setPerson`, `setLongLived(true)`, 카테고리 `android.shortcut.conversation`, 인텐트=MainActivity + 아래 extras. 실패해도 알림은 뜬다(대화 섹션에만 안 올라감).
5. `NotificationCompat.MessagingStyle(me).addMessage(body, now, Person(characterName, avatar))` + `setShortcutId(characterId)` + `CATEGORY_MESSAGE` + `setSmallIcon(ic_stat_push)` + `setAutoCancel(true)`. **같은 `conversationId` 는 같은 notification id**(교체).
6. 탭 인텐트 extras = **`data` 전부 + `google.message_id`** — FCM SDK 가 notification 메시지 탭에 넣는 것과 같은 모양. 플러그인 `handleOnNewIntent` 는 `google.message_id` 가 있을 때만 extras 를 `data` 로 묶어 `pushNotificationActionPerformed` 를 쏘고, 브릿지가 종전처럼 `data.url` 로 딥링크한다. 콜드 스타트도 `BridgeActivity` 가 런치 인텐트를 같은 경로로 넘긴다.

### 채널 생성 시점 — 알아둘 것
채널은 **첫 data-only 메시지 수신 시점**에 만들어진다(서비스가 `onNewToken` 을 오버라이드하지 않으므로 그 전엔 없다). notification 메시지가 먼저 오면 `default_notification_channel_id` 가 가리키는 채널이 없어 SDK 폴백 채널로 뜬다. 웹이 `PushNotifications.createChannel({ id: 'character_messages', name: '캐릭터 메시지', importance: 4 })` 를 앱 시작 시 호출하면 해소된다(웹 레포 작업).

### 상태바 아이콘 요구사항 — 디자인 에셋 필요
- Android 알림 small icon 은 **24dp, 흰색 실루엣(알파 채널만)** 이어야 한다. 컬러 앱 아이콘을 넣으면 흰 네모로 뭉개진다. 그래서 **앱 아이콘에서 자동 생성하지 않는다.**
- 지금 들어 있는 `ic_stat_push.xml` 은 단색 원 플레이스홀더다. 디자인 에셋(벡터 24×24, `#FFFFFF`)이 오면 generate-app 의 플레이스홀더를 교체한다.

### 실기기 확인 절차 (BE 가 Android data-only 로 전환한 뒤)
- [ ] 플래그 on 앱 설치 → 로그인 → 토큰 확보
- [ ] 7개 data 키를 넣은 data-only 메시지 1건 → 아바타·캐릭터 이름이 붙은 메시지 알림, 상태바에 `ic_stat_push`
- [ ] 알림 길게 누르기 → "대화" 섹션(설정 > 알림 > 대화)에 캐릭터가 뜨는지
- [ ] 탭 → 앱이 `data.url` 로 이동(기존 notification 메시지와 동일)
- [ ] `avatarUrl` 을 깨진 URL 로 1건 → 이니셜 아이콘으로 뜨는지(5초 안에)
- [ ] `characterId` 를 빼고 1건 → 아무것도 안 뜨는지(data-only 라 플러그인도 그리지 않는다 — 의도된 동작, BE 가 키를 빼먹으면 조용히 사라지므로 BE 쪽 검증 필수)
