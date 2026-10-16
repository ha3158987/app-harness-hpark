---
doc: 22
title: 네이티브 기능 조사 + 적용 플랜 (characterchat)
category: 마이그레이션
audience: 개발자
status: reference
updated: 2026-08-19
---

# 네이티브 기능 조사 + 적용 플랜 (characterchat)

> 조사 범위: `app-harness`(Capacitor 하네스) + `character-chatbot-web`(웹).
> 작성 시점 코드 기준. 코드 변경 없이 조사·계획만 수행함.
> **결론 한 줄:** 거의 모든 네이티브 기능이 **Android·iOS 양쪽 다 이미 구현돼 있고**, 대부분 "쓰느냐 안 쓰느냐"는 코드가 아니라 **`app.config.json`의 feature 플래그 + 웹에서 어댑터 호출** 두 가지로 결정된다.

---

## 0. 아키텍처 핵심 (왜 "가능/불가"가 이렇게 나오는가)

이걸 모르면 매트릭스가 안 읽힌다. 3가지 사실만 잡으면 된다.

1. **네이티브 기능은 전부 JS 브릿지 레이어에 구현돼 있다.**
   커스텀 네이티브 플러그인 `AppBridge`(Kt/Swift)는 `getConfig()` **하나만** 구현한다.
   - `template/bridge/android/.../AppBridgePlugin.kt:20` → `getConfig` 뿐
   - `template/bridge/ios/.../AppBridgePlugin.swift:19` → `getConfig` 뿐
   나머지(share/haptic/camera/push/…)는 전부 `template/bridge/dist/index.js`(1254줄)가 **공식·커뮤니티 Capacitor 플러그인을 동적 import** 해서 처리한다. → **Capacitor 플러그인이 지원하는 플랫폼 = 그 기능이 되는 플랫폼.** Capacitor 공식 플러그인은 iOS·Android 양쪽 지원이 기본이라, 플랫폼별 "불가"는 거의 없고 대부분 **OS 정책상 제약**만 있다.

2. **기능 ON/OFF는 `apps/<slug>/app.config.json`의 `features` 플래그가 결정한다.**
   `deriveCapabilities()`(`dist/index.js:16`)가 플래그 → `capabilities`로 변환하고, 브릿지 메서드는 전부 `if (!this.capabilities.X) return no-op` 로 게이트돼 있다. 플래그가 false면 코드가 있어도 동작 안 한다.
   - 현재 `apps/characterchat/app.config.json` 에서 **켜진 것: `share`, `haptics`, `darkMode` 뿐.** 나머지(push/camera/biometric/clipboard/geolocation/localNotification/secureStorage/deepLink/forceUpdate)는 전부 false.

3. **플래그를 켜면 빌드 스크립트가 해당 Capacitor 플러그인을 자동 설치한다.**
   `scripts/generate-app.mjs` 의 `FEATURE_PLUGINS`(line 44~52)가 feature→plugin 매핑. 플래그 ON → `npm install` + iOS Info.plist 권한 문구(`IOS_USAGE`, line 64) 자동 주입. **즉 새 기능 적용 = ①플래그 ON → ②`generate` 재실행 → ③웹에서 어댑터 메서드 호출.** 새 네이티브 코드는 안 짜도 된다(SDK에 이미 있는 기능 한정).

> ⚠️ 따라서 "불가능"은 두 부류뿐이다:
> (A) **OS 정책 제약** (iOS 백그라운드 실행, iOS 스크린샷 차단, iOS 클립보드 무음 읽기 등)
> (B) **SDK에 아직 메서드 자체가 없는 기능** (STT 음성입력, TTS 음성출력, 인앱리뷰, NFC 등) → 새 플러그인 추가 필요.

---

## 1. 데모 페이지 인벤토리

데모 페이지는 **하네스가 아니라 웹 레포**에 있다. (하네스 `template/src/index.html`은 오프라인 폴백 셸일 뿐, 기능 데모 아님.)

**위치:** `character-chatbot-web/src/app/harness-demo/page.tsx` (117줄, "검증용, 앱 확인 후 삭제 예정" 주석)
**호출 경로:** 모든 호출은 `src/lib/harness/adapter.ts` → `@aipia-team/harness-bridge` 의 `AppBridge` 로 들어간다.

| 데모 버튼 | 호출 메서드 | 구현 위치 | 사용 Capacitor 플러그인 |
|---|---|---|---|
| 공유 시트 | `share()` | `dist/index.js:131` | `@capacitor/share` |
| 햅틱 light/medium/heavy | `haptic()` | `dist/index.js:473` | `@capacitor/haptics` |
| 외부 열기 | `openExternal()` | `dist/index.js:148` | `@capacitor/browser` / `@capacitor/app-launcher` |
| 클립보드 복사/읽기 | `copyToClipboard()` / `readClipboard()` | `dist/index.js:489` | `@capacitor/clipboard` |
| 네트워크 | `getNetworkStatus()` | `dist/index.js:545` | `@capacitor/network` |
| 기기정보 | `getDeviceInfo()` | `dist/index.js:535` | `@capacitor/device` |
| 안전영역 | `getSafeAreaInsets()` | adapter/bridge | `@capacitor-community/safe-area` (base) |
| ATT 동의 | `requestTracking()` | `dist/index.js:782` | `capacitor-plugin-app-tracking-transparency` |
| 마케팅 init | `initMarketing()` | `dist/index.js:1133` | `appsflyer-capacitor-plugin` |
| 이벤트 전송 | `track()` | `dist/index.js:247` (SDK) | 마케팅 벤더로 분배 |

**현재 실제 기능에 이미 붙은 것 (데모 아닌 프로덕션 코드):**
- 공유 + 햅틱 → `src/components/chat/SettingsMenuButton.tsx:53,55` (채팅 설정메뉴)
- 햅틱 → `src/components/find/SwipeDeck.tsx:38` (찾기 카드 매치→대화 시작)
- 초기화 + 딥링크 라우팅 → `src/lib/harness/HarnessInit.tsx` (providers 트리 1회 마운트)

---

## 2. 플랫폼 가능/불가 매트릭스

범례: ✅가능 · ⚠️가능하나 OS 제약 · ❌현재 SDK에 없음(플러그인 추가 필요) · 🔲SDK엔 있으나 현재 플래그 OFF

| 기능 | Android | iOS | 필요 플러그인 (SDK 보유?) | 권한/설정 | 비고 |
|---|---|---|---|---|---|
| 공유 | ✅ | ✅ | `@capacitor/share` (보유) | 없음 | **현재 ON.** 양쪽 네이티브 공유 시트. |
| 햅틱/진동 | ✅ | ✅ | `@capacitor/haptics` (보유) | 없음 | **현재 ON.** iOS=Taptic, Android=Vibrator. |
| 외부 링크 | ✅ | ✅ | `@capacitor/browser` (base) | 없음 | in-app/시스템 브라우저. 항상 가능. |
| 클립보드 복사 | ✅ | ✅ | `@capacitor/clipboard` (보유) | 없음 | 🔲 플래그 OFF. 복사는 무음. |
| 클립보드 읽기 | ✅ | ⚠️ | 동일 | 없음 | iOS 14+ 는 읽을 때 **시스템 배너 노출**(프라이버시). → 가급적 "복사"만 노출 권장. |
| 카메라/갤러리 | ✅ | ✅ | `@capacitor/camera` (보유) | iOS Info.plist 3종 자동주입 / Android 런타임 권한 | 🔲 OFF. multimodal 첨부에 적합. |
| 로컬 알림 | ✅ | ✅ | `@capacitor/local-notifications` (보유) | Android 13+ `POST_NOTIFICATIONS` 런타임 권한 | 🔲 OFF. 백엔드 불필요(클라 예약). |
| 푸시 알림 | ✅ | ✅ | `@capacitor/push-notifications` (보유) | iOS APNs Capability+인증서 / Android FCM `google-services.json` | 🔲 OFF. **백엔드 필요**(토큰 등록+발송). |
| 생체인증 | ✅ | ✅ | `@aparajita/capacitor-biometric-auth` (보유) | iOS `NSFaceIDUsageDescription` 자동주입 | 🔲 OFF. 빠른 재로그인/앱 잠금. auth와 연동. |
| 시큐어 스토리지 | ✅ | ✅ | `@aparajita/capacitor-secure-storage` (보유) | 없음 | 🔲 OFF. Keystore/Keychain. 토큰 보관. |
| 위치 | ✅ | ✅ | `@capacitor/geolocation` (보유) | iOS `NSLocationWhenInUse` 자동 / Android 런타임 | 🔲 OFF. 챗봇 가치 낮음. |
| 네트워크 상태 | ✅ | ✅ | `@capacitor/network` (base) | 없음 | 항상 가능. 오프라인 배너용. |
| 기기정보 | ✅ | ✅ | `@capacitor/device` (base) | 없음 | 항상 가능. |
| 상태바 | ✅ | ✅ | `@capacitor/status-bar` (base) | 없음 | 테마 연동. |
| 스플래시 | ✅ | ✅ | `@capacitor/splash-screen` (base) | 없음 | config 제어. |
| 키보드 이벤트 | ✅ | ✅ | `@capacitor/keyboard` (base) | 없음 | `onKeyboard()`. 채팅 입력창 보정. |
| 안전영역 인셋 | ✅ | ✅ | `@capacitor-community/safe-area` (base) | 없음 | CSS 변수/`getSafeAreaInsets()`. |
| 딥링크 | ✅ | ✅ | `@capacitor/app` (base) | iOS Universal Link / Android App Link 설정 | 🔲 플래그 OFF지만 `HarnessInit`에 핸들러는 배선됨. |
| 강제 업데이트 | ✅ | ✅ | (config + version 비교) | minVersion JSON 호스팅 | 🔲 OFF. config만으로 동작. |
| Android 백버튼 | ✅ | — | `@capacitor/app` (base) | 없음 | Android 전용(iOS 무관). `onBackButton()`. |
| ATT 추적동의 | — | ✅ | `capacitor-plugin-app-tracking-transparency` | iOS `NSUserTrackingUsageDescription` | **iOS 전용.** Android는 not-applicable(no-op). |
| 화면캡쳐 차단 | ✅ | ❌ | (SDK optional, **네이티브 미구현**) | — | Android=`FLAG_SECURE` 완전차단 가능. **iOS는 스크린샷 차단 불가**(촬영 감지/앱전환시 블러만). 현재 `blockCapture?` 는 no-op. |
| 뷰어 밝기 | ✅ | ✅ | (SDK optional, **네이티브 미구현**) | — | `setBrightness?` 선언만, 구현 비어있음. |
| **음성입력(STT)** | ✅ | ✅ | `features.speechRecognition` → `@capacitor-community/speech-recognition` (브릿지 메서드 없음 — 웹이 `registerPlugin("SpeechRecognition")` 로 직접 호출) | iOS `NSSpeechRecognitionUsageDescription`+`NSMicrophoneUsageDescription`(8개 언어 자동 주입) / Android `RECORD_AUDIO`·`RecognitionService` queries 는 플러그인 매니페스트 머지 | 2026-10-16 하네스 배선 완료(characterchat ON). **셸 재빌드 후** 웹 마이크 버튼이 노출된다(구버전 앱은 `isPluginAvailable` false → 숨김). |
| **음성출력(TTS)** | ❌ | ❌ | **SDK에 없음** → `@capacitor-community/text-to-speech` 추가 필요 | 없음 | 캐릭터 음성 답변. 신규 추가 필요. |
| 인앱 리뷰요청 | ❌ | ❌ | **SDK에 없음** → `@capacitor-community/in-app-review` | 없음 | 리텐션 UX. 신규 추가 필요. |
| 백그라운드 실행 | ⚠️ | ❌ | (SDK 미노출) | — | iOS는 임의 백그라운드 실행 불가(OS 제약). 챗봇은 푸시로 대체. |
| NFC / 블루투스 / 연락처 / 캘린더 | ❌ | ❌ | SDK에 없음 | — | 챗봇 무관. 추가 불필요. |

**불가능 정리 (근거):**
- **iOS 화면캡쳐 차단** — OS가 스크린샷을 막을 API를 제공하지 않음. 감지/블러만 가능. (Android는 `FLAG_SECURE`로 가능)
- **iOS 백그라운드 임의 실행** — OS 정책. → 푸시 알림으로 우회.
- **iOS 클립보드 무음 읽기** — iOS 14+ 읽기 시 사용자에게 배너 표시. (복사는 무음 가능)
- **STT/TTS/인앱리뷰/NFC 등** — 양쪽 다 "OS 불가"가 아니라 **현재 브릿지 SDK에 메서드가 없어서** 불가. 플러그인+브릿지 메서드 추가하면 양쪽 가능.

---

## 3. 챗봇 적용처 제안

표기: 난이도(하/중/상) · 통신=웹↔앱/백엔드 통신 필요 여부

| # | 기능 | 적용 화면/플로우 | 사용자 가치 | 난이도 | 통신 |
|---|---|---|---|---|---|
| A | 햅틱 확장 | 메시지 **전송/수신 완료** 피드백, 탭 전환, 좋아요/매치 (현재는 설정메뉴·찾기카드 2곳만) | 대화의 "촉감". 챗봇 몰입감↑ | 하 | 불필요 (플래그 이미 ON) |
| B | 네트워크 오프라인 배너 | 채팅 화면에서 연결 끊김 시 "오프라인" 인디케이터 + 전송 버튼 비활성 | 메시지 유실 혼란 방지 | 하 | 불필요 |
| C | 공유 확장 | 캐릭터 프로필 공유, 대화 일부 공유(설정메뉴 공유는 이미 있음) | 바이럴/초대 | 하 | 불필요 |
| D | 클립보드 복사 | 캐릭터 메시지 **롱프레스 → 복사** (읽기는 iOS 배너 때문에 지양) | 답변 재사용 편의 | 하 | 불필요 (플래그 ON 필요) |
| E | 키보드/안전영역 보정 | 채팅 입력창이 키보드에 가리지 않게 `onKeyboard()`로 패딩 조정 | 입력 UX(특히 iOS) | 하 | 불필요 |
| F | 로컬 알림 | "캐릭터가 답장을 기다려요" N시간 후 리마인더(앱 내에서 예약) | 리텐션 | 중 | 웹↔앱 (예약 호출) |
| G | 푸시 알림 | 캐릭터 답장 도착/재참여 알림. 딥링크로 해당 채팅 열기 | **리텐션 최대**. 챗봇 핵심 | 상 | 웹+앱+**백엔드** |
| H | 카메라/갤러리 | 캐릭터에게 **이미지 첨부**(멀티모달 대화) | 대화 폭 확장 | 중 | 웹↔앱 + 업로드 |
| I | 생체인증 + 시큐어스토리지 | 앱 재실행 시 Face ID/지문 빠른 잠금해제, 토큰 Keychain 보관 | 보안+편의 | 중 | auth 연동 |
| J | 음성입력(STT) | 채팅 입력창 마이크 버튼 → 말로 입력 | 챗봇 접근성·몰입 매우↑ | 상 | **신규 플러그인** |
| K | 음성출력(TTS) | 캐릭터 메시지 음성 재생 | 캐릭터 "목소리" | 상 | **신규 플러그인** |
| L | 강제 업데이트 | 구버전 차단 게이트 | 운영 안정성 | 하 | config + JSON 호스팅 |

---

## 4. 단계별 구현 플랜 (우선순위: 가치 높고 난이도 낮은 순)

각 단계는 독립적으로 빌드·검증 가능하도록 끊었다. 통신 프로토콜은 **기존 어댑터 패턴을 그대로 따른다**(웹이 `@/lib/harness/adapter` 호출 → AppBridge → 네이티브). 새 통신 패턴을 만들지 않는다.

### Phase 1 — 플래그/코드 0~최소, 즉시 체감 (난이도 하)
**1-1. 햅틱 확장 (A)** — 통신 불필요, 플래그 이미 ON
- 웹: `src/app/chat/[sessionId]/page.tsx`(또는 메시지 전송 핸들러 컴포넌트)에서 전송 직후/응답 수신 시 `haptic("light")` 호출. 탭 레이아웃 `src/app/(tabs)/layout.tsx` 탭 전환에 `haptic("light")`.
- 하네스: 변경 없음.
- 검증: 실기기에서 메시지 보낼 때 진동. (브라우저=noop 확인)

**1-2. 네트워크 오프라인 배너 (B)** — 통신 불필요
- 웹: 채팅 화면에 `AppBridge.getNetworkStatus()` + `AppBridge.onNetworkChange()` 구독해 오프라인 배너 표시. 어댑터에 `getNetworkStatus`/`onNetworkChange` 얇은 래퍼 추가(adapter.ts).
- 하네스: 변경 없음(`network`는 base 플러그인).
- 검증: 비행기모드 토글 시 배너 on/off.

**1-3. 키보드/안전영역 보정 (E)** — 통신 불필요
- 웹: 채팅 입력 컴포넌트에서 `AppBridge.onKeyboard(({visible,height})=>…)`로 입력창 하단 패딩 조정. 어댑터에 `onKeyboard` 래퍼 추가.
- 검증: iOS·Android 실기기에서 키보드가 입력창 안 가림.

### Phase 2 — 플래그 ON + generate 재실행 필요 (난이도 하~중)
**2-1. 클립보드 복사 (D)**
- 하네스: `apps/characterchat/app.config.json` → `features.clipboard: true`. `npm run generate -- --slug characterchat` 재실행(=`@capacitor/clipboard` 자동 설치).
- 웹: 캐릭터 메시지 버블 롱프레스 메뉴 → `AppBridge.copyToClipboard(text)`. 어댑터에 `copyToClipboard` 래퍼 추가. **읽기(readClipboard)는 노출하지 않음**(iOS 배너).
- 검증: 복사 후 다른 앱에 붙여넣기.

**2-2. 강제 업데이트 (L)**
- 하네스: `features.forceUpdate: true` + config에 minVersion JSON URL. JSON 정적 호스팅.
- 웹: 별도 코드 불필요(`ready()`에서 자동 1회 실행).
- 검증: minVersion을 현재보다 높게 두고 게이트 화면 확인.

### Phase 3 — 통신 설계 필요 (난이도 중)
**3-1. 로컬 알림 (F)**
- 하네스: `features.localNotification: true` + generate. (Android 13+ `POST_NOTIFICATIONS`는 플러그인이 처리, iOS는 권한 요청)
- 웹↔앱 프로토콜(기존 어댑터 메서드 직접 사용):
  - 예약: `AppBridge.scheduleNotification({ title, body, at: Date, id, extra:{ path:"/chat/<id>" } })`
  - 탭 시 라우팅: 알림 `extra.path`를 `HarnessInit`의 딥링크/노티 핸들러에서 `router.push(path)` (기존 onDeepLink 경로 재사용).
- 웹: 어댑터에 `scheduleNotification`/`cancelNotification` 래퍼 추가. 마지막 대화 후 N시간 미접속 시 예약하는 훅.
- 검증: 예약 → 앱 백그라운드 → 알림 수신 → 탭 시 해당 채팅 열림.

**3-2. 카메라/갤러리 이미지 첨부 (H)**
- 하네스: `features.camera: true` + generate (iOS Info.plist 3종 자동주입).
- 웹: 채팅 입력창에 첨부 버튼 → `AppBridge.takePhoto({ source:"prompt", resultType:"dataUrl" })` → 기존 이미지 업로드/멀티모달 전송 플로우에 연결. 어댑터에 `takePhoto` 래퍼.
- 검증: 촬영/선택 → 채팅에 이미지 전송.

### Phase 4 — 백엔드/신규플러그인 (난이도 상, 별도 스프린트)
**4-1. 푸시 알림 (G)** — 가치 최고, 백엔드 필수
- 하네스: `features.push: true` + generate. iOS APNs Capability+인증서(`09-CREDENTIALS.md`/fastlane), Android FCM `google-services.json`. (브릿지에 `registerPush`·푸시탭→딥링크 emit은 이미 구현 — 새 네이티브 코드 불필요, 플래그+자격증명+재빌드만.)
- 통신 프로토콜:
  1. 앱 시작 시 웹이 `AppBridge.registerPush()` → `{granted, token}` 수신.
  2. 토큰을 **백엔드에 등록**. 백엔드는 **별도 레포 `character-chatbot-api`(Python/FastAPI)** — `POST /api/push/register {token, platform}` 신설. `userId`는 바디로 받지 말고 인증(`require_auth`)의 `ctx.user_id`로 강제.
  3. **유휴→재참여(선톡)** 시 백엔드가 APNs/FCM로 발송. 딥링크는 **절대 URL `characterchat://chat/<sessionId>`** 로 보낼 것(FE 파서가 `new URL()`이라 베어 경로 `/chat/<id>`는 throw). 포그라운드 메시지는 기존 SSE가 커버 → 푸시는 유휴 경로만.
  4. 수신 탭 → 기존 onDeepLink/노티 핸들러 → `router.push`.
- 웹 수정: `registerPush` 래퍼는 있으나 **시작 시 자동 호출 미배선**(`HarnessInit.tsx`에 추가) + 권한/설정 UX 신규(현재 스텁). 토큰은 브릿지가 `auth.deviceEndpoint`로 자동 등록(FE 전송 코드 불필요, app.config에 `deviceEndpoint`만 설정).
- 백엔드(`character-chatbot-api`) — **진짜 작업량, 전부 신규**: device_token 모델+alembic → `POST /api/push/register`(`app/api/sessions.py` 라우터 패턴) → APNs/FCM 발송 서비스+자격증명. **발송 훅 = `app/services/proactive/postman.py`의 `deliver_task` 커밋 직후**(스케줄러·세션 배달 공통 지점). 관찰성 `push.sent`/`push.failed`. 상세는 BE 핸드오프 스펙 참조.
- 검증: 기기 토큰 등록 → 서버에서 테스트 푸시 → 알림 탭 → 채팅 진입.

**4-2. 생체인증 + 시큐어 스토리지 (I)** — auth 연동
- 하네스: `features.biometric: true`, `features.secureStorage: true` + generate.
- 웹: 로그인 직후 `AppBridge.enableBiometricLogin(true)`, 앱 시작 시 `AppBridge.unlock()`. 토큰은 `secureSet`/`secureGet`.
- [확인필요: 현재 character-chatbot-web 인증 흐름(`src/app/auth/signin`)과 세션 토큰 저장 방식 — 브릿지 auth(login/guestLogin) 사용 여부 미확인]
- 검증: 재실행 시 Face ID/지문 잠금해제.

**4-3. 음성입력(STT) (J) / 음성출력(TTS) (K)** — 신규 플러그인

> **STT 는 2026-10-16 구현됨** — 아래 원안과 달리 **브릿지 SDK 를 거치지 않는다.** 하네스는
> `features.speechRecognition` → `FEATURE_PLUGINS` 로 플러그인을 싣고 `IOS_USAGE` 로 두 문구를 넣을 뿐이고,
> 웹(팝챗 `src/lib/voiceInput.ts`)이 `registerPlugin("SpeechRecognition")` + `Capacitor.isPluginAvailable` 로
> 직접 잡는다. 그래서 브릿지 npm 재배포 없이 **셸 재빌드만으로** 켜진다(deriveCapabilities/CAP_METHOD 미변경).
> TTS 는 아직 원안 그대로 미구현.
- 하네스: 브릿지 SDK에 메서드 신설 필요(현재 없음):
  - `dist/index.js`(소스 추정 위치)에 `startSpeechRecognition()`/`speak()` 추가 + `@capacitor-community/speech-recognition`, `@capacitor-community/text-to-speech` 를 `generate-app.mjs` FEATURE_PLUGINS에 추가 + iOS 권한 문구(`IOS_USAGE`에 STT/마이크) 추가 + `deriveCapabilities`/`CAP_METHOD` 세 곳 갱신.
  - `index.d.ts`에 타입 추가.
- 웹: 채팅 입력창 마이크 버튼 / 메시지 재생 버튼 → 어댑터 래퍼 호출.
- 검증: 실기기 음성 인식·재생.

---

## 부록: 새 기능 적용 체크리스트 (재사용)

SDK에 **이미 있는** 기능 적용 시:
1. `apps/characterchat/app.config.json` → `features.<flag>: true`
2. `npm run generate -- --slug characterchat` (플러그인 자동 설치 + iOS 권한 주입)
3. `character-chatbot-web/src/lib/harness/adapter.ts` 에 얇은 래퍼 함수 추가(없으면)
4. 해당 웹 컴포넌트에서 호출 (`isApp()` 분기는 브릿지가 폴백 처리하므로 대개 불필요)
5. `npm run build:android` / `build:ios` 후 실기기 검증

SDK에 **없는** 기능(STT/TTS 등) 추가 시 위 + 브릿지 5곳 갱신: `index.d.ts` 타입 / `dist/index.js` 메서드 / `deriveCapabilities` / `CAP_METHOD` / `generate-app.mjs` FEATURE_PLUGINS(+iOS 권한).
