---
doc: 18
title: APP-FEATURES — 앱에서 할 수 있는 기능 + 버전
category: 레퍼런스
audience: 전체
status: reference
updated: 2026-09-03
---

# APP-FEATURES — 앱에서 할 수 있는 기능 + 버전

하네스로 만든 앱이 제공할 수 있는 기능 전체 목록과, 각 기능을 담당하는 패키지/버전.
"웹만으로는 안 되고 앱이라서 되는" 것들이 핵심 가치다.

> 버전 표기: Capacitor 공식 플러그인은 코어와 같은 메이저(현재 **^8**)로 맞춘다.
> 커뮤니티 플러그인은 **설치 직전 npm에서 최신/호환 버전 재확인**.

---

## 기준 버전 (2026-09)

| 항목 | 버전 | 정본 |
|---|---|---|
| Capacitor | **8** (`@capacitor/core`, `@capacitor/cli` ^8) | — |
| Node | **24** (`.nvmrc`) · 최소 **22** (`package.json` engines) | `.nvmrc` |
| iOS 빌드 | **Xcode 26 / iOS 26 SDK** (2026-04-28부터 제출 필수) | — |
| iOS 배포 타깃 | **iOS 15** (SDK는 26, 타깃은 낮게) | `AIPIA_DEFAULTS.minOS.ios` |
| Android targetSdk | **36** (Google Play 제출 기준 — 신규 앱·기존 앱 업데이트 모두. 2026-08-31 기한 지남) | `AIPIA_DEFAULTS.minOS.targetSdk` |
| Android minSdk | **29** (하네스 기본값. Capacitor 8 자체 하한은 23) | `AIPIA_DEFAULTS.minOS.androidSdk` |

> 값의 정본은 `scripts/lib/config.mjs` 의 `AIPIA_DEFAULTS` 와 `.nvmrc` 다. 이 표와 어긋나면 코드가 맞다.

---

## A. 앱이라서 되는 시그니처 기능

| 기능 | 패키지 | 비고 (왜 / 주의) |
|---|---|---|
| 껍데기 다국어(8언어) | 하네스 내장 (`scripts/lib/i18n.mjs`) | 앱 이름 · iOS 권한 문구 · ATT 문구를 언어별로 네이티브 리소스에 굽는다. **웹의 i18n 이 닿지 않는 자리** — config 가 언어별 값을 갖는다. 스키마는 `docs/02-GUIDE.md` §6 |
| 원격 푸시 | `@capacitor/push-notifications` ^8 | FCM/APNs. **Android 13+는 런타임 알림 권한 필수** (DEVICE-SUPPORT 참고) |
| 로컬 푸시 | `@capacitor/local-notifications` ^8 | 스케줄/리마인드 |
| 딥링크/유니버설링크 | `@capacitor/app` ^8 (`appUrlOpen`) | 특정 화면 진입. iOS associated domains / Android intent filter 설정 필요 |
| 디퍼드 딥링크 | Branch / AppsFlyer SDK 플러그인 | 설치 후 첫 실행 라우팅. FDL 대체 |
| 강제 업데이트 게이트 | 브릿지 자체 구현 | 구버전이면 스토어 유도. 웹 래퍼에선 사실상 필수 |
| 인앱 결제(필요 시) | `@capacitor-community/in-app-purchases` 등 | 디지털 재화는 스토어 결제 강제 — 정책 확인 |

## B. 네이티브 브릿지로 웹에 열어주는 기능

| 기능 | 패키지 | 비고 |
|---|---|---|
| 스플래시 | `@capacitor/splash-screen` ^8 | 부팅 화면 |
| 상태바 제어 | `@capacitor/status-bar` ^8 | 색/스타일. edge-to-edge 대응(DEVICE-SUPPORT) |
| 키보드 | `@capacitor/keyboard` ^8 | 입력 시 레이아웃 |
| 외부 링크 | `@capacitor/browser` ^8 | in-app 브라우저(Custom Tabs/SFSafariVC) |
| 앱 런처 | `@capacitor/app-launcher` ^8 | 다른 앱/스킴 열기 |
| 공유 | `@capacitor/share` ^8 | 네이티브 공유 시트 |
| 클립보드 | `@capacitor/clipboard` ^8 | |
| 햅틱 | `@capacitor/haptics` ^8 | 진동 피드백 |
| 카메라/사진 | `@capacitor/camera` ^8 | `<input type=file>` 보완, QR 등 |
| 파일시스템 | `@capacitor/filesystem` ^8 | 다운로드/캐시 |
| 위치 | `@capacitor/geolocation` ^8 | 권한 필요 |
| 네트워크 상태 | `@capacitor/network` ^8 | 오프라인 감지 → 에러 화면 |
| 기기 정보 | `@capacitor/device` ^8 | OS/모델 분기(최소화 권장) |
| 앱 상태/라이프사이클 | `@capacitor/app` ^8 | 포그라운드/백그라운드 이벤트 |
| 환경설정 저장 | `@capacitor/preferences` ^8 | ⚠️ **비암호화** — 토큰 저장 금지 |
| 시큐어 스토리지 | 커뮤니티 (npm 확인) | 토큰/세션 = Keychain/Keystore 기반 |
| 생체인증 | 커뮤니티 (npm 확인) | Face ID/지문 |
| OTA 웹 업데이트(선택) | `@capgo/capacitor-updater` | 스토어 재배포 없이 웹 번들 갱신 |

## C. 셸 기본기 (플러그인 아닌 셸/웹 레이어 구현)

| 기능 | 구현 위치 | 비고 |
|---|---|---|
| 하드웨어 백버튼(Android) | 브릿지/셸 | 안 잡으면 앱이 그냥 종료됨 |
| pull-to-refresh | 웹 또는 셸 | |
| 화면전환 효과 | **웹 (View Transitions API)** | Safari 18+/Chrome 126+ 네이티브 지원, 미지원 시 폴백 |
| 네비게이션 도메인 화이트리스트 | 셸 | 허용 도메인 외 외부 링크는 시스템 브라우저로 |
| 세이프에어리어 | 웹 CSS `env(safe-area-inset-*)` | 노치/Dynamic Island/제스처바. **이미 여백이 있는 헤더·탭바에 인셋을 통째로 더하지 말 것** — 규칙은 [19-DEVICE-SUPPORT §4b](./19-DEVICE-SUPPORT.md#4b-디스플레이-다양성-대응-레시피-해상도종횡비컷아웃폴더블) |
| 에셋 포맷 정책 | 팀 룰 | 무거운 모션은 video/Lottie, 가벼운 건 WebP |

## D. 콘텐츠 타입별 적합도 (우리 서비스 기준)

| 콘텐츠 | 적합도 | 메모 |
|---|---|---|
| 웹소설(읽기/스크롤/폼) | ◎ | 가장 쉬운 케이스. 긴 목록 가상화만 |
| 스토리 게임(비주얼노벨) | ○ | transform/opacity 위주면 60fps OK |
| 화면전환 효과 | ○ | View Transitions API로 네이티브급 |
| animated WebP (10초·10MB·단일) | ○ | 단일 재생이면 대체로 OK. "끊김 없음" 보장하려면 video 권장 |
| 고사양 연속 애니메/게임 | △ | 이 구간만 예외적으로 네이티브 고려 |
