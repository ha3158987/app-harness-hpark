# Appharness — AIPIA Web→Native Harness (Capacitor)

> ⚠️ **범용 하네스가 아니라 AIPIA 전사 앱 하네스.** 식별자/도메인/스택/SDK 선택은
> [`docs/01-AIPIA-CONVENTIONS.md`](docs/01-AIPIA-CONVENTIONS.md) 의 전사 표준을 따른다.

AIPIA 의 여러 웹 서비스(Poptale, AIPIA, ...)를 **하나의 얇은 네이티브 셸 + 공유 브릿지**로 감싸
iOS/Android 앱으로 *반복 추출* 하는 하네스. 앱은 `server.url` 로 **배포된 웹을 원격 로드**하고,
웹은 `@harness/bridge` 로 네이티브 기능을 호출한다. 모든 작업은 **Claude Code 스킬**로 자동화.

```mermaid
flowchart LR
  W["AIPIA 웹 서비스<br/>(Poptale, AIPIA, ...)"]
  CFG["apps/&lt;slug&gt;/app.config.json<br/>(앱 1개의 모든 것)"]
  GEN["generate-app.mjs"]
  APP["Capacitor 셸<br/>(APK / IPA)"]
  STORE["App Store / Play"]

  CFG --> GEN --> APP
  W -- "원격 로드" --> APP
  APP -- "fastlane (CI)" --> STORE
```

---

## 시작 동선 (3가지 입장)

| 당신이 누구냐 | 어디부터 | 결과물 |
|---|---|---|
| **새 앱을 하네스에 추가하는 개발자** | [`docs/01-AIPIA-CONVENTIONS.md`](docs/01-AIPIA-CONVENTIONS.md) → [`ONBOARDING.md`](ONBOARDING.md) | `apps/<slug>/app.config.json` + 디버그 APK |
| **Poptale 이전을 맡은 담당자** | [`docs/21-POPTALE-MIGRATION.md`](docs/21-POPTALE-MIGRATION.md) ⭐ | 10주 일정 + 호환성 매트릭스 + 플러그인 SPEC |
| **하네스 자체를 손보는 사람** | [`docs/02-GUIDE.md`](docs/02-GUIDE.md) → [`docs/03-STRATEGY.md`](docs/03-STRATEGY.md) | 스키마/스킬/CI 변경 |

---

## 새 앱 1줄 부트스트랩

```js
import { aipiaPreset } from './scripts/lib/config.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

// 슬러그 하나만 정하면 90% 완성된 config 생성
const cfg = aipiaPreset({ slug: 'newservice', appName: 'New Service' });
mkdirSync('apps/newservice', { recursive: true });
writeFileSync('apps/newservice/app.config.json', JSON.stringify(cfg, null, 2));
```

자동 도출되는 값: 번들 ID(`com.aipia.newservice`), Firebase 프로젝트 3개
(`dev-aipia-newservice` / `stage-aipia-newservice` / `aipia-newservice`), 도메인
(`https://newservice.ai`), K-market 4 socials, Adbrix+Amplitude, Crashlytics+WhaTap,
다크모드, AppChannel 호환 등 — 전부 [`docs/01-AIPIA-CONVENTIONS.md`](docs/01-AIPIA-CONVENTIONS.md) 표준.

남은 작업: 서비스별 IAP 상품 등록, 푸시 화이트리스트, 아이콘/스플래시.

---

## 지원 기능 (요약)

- **앱 기능**: 푸시 · 딥링크 · 강제업데이트 · 카메라 · 생체인증 · 시큐어스토리지 · 로컬알림 · 햅틱 · 클립보드 · 위치 · 공유 · 안전영역 · 다크모드 · **화면캡쳐 방지**(경로별) · **뷰어 밝기**
- **인증**: 소셜(apple/google/kakao/naver/facebook/x/threads/**line**/**discord**) + 이메일 — 총 10종 · 회원가입 온보딩 · 게스트→실계정 병합 · 회원탈퇴 · 생체 빠른 로그인
  · **기본은 외부 인증서버 위탁**([25-AUTH-DELEGATION.md](docs/25-AUTH-DELEGATION.md)) — 앱은 공급자와 직접 OAuth 를 돌고 자격증명을 서비스 BE 로 넘긴다
  · 중앙 IdP 자체 구축(Keycloak)은 **코드에서 제거됐다**(#25) — `auth.idp` 가 남아 있으면 빌드가 멈춘다([10-AUTH.md](docs/10-AUTH.md) 는 배경 기록)
- **결제**: 인앱결제(디지털 재화) · 웹앱 가격 분기 · **Google purchase token 압축**(Poptale 노하우) · 서버 지갑
- **마케팅/분석**: Adbrix(어트리뷰션) · Amplitude(분석) — AIPIA 표준. (AppsFlyer 슬롯 유지)
- **모니터링**: Firebase Crashlytics(크래시) · WhaTap(APM) — AIPIA 표준
- **호환성**: 기존 웹의 `window.AppChannel.postMessage("<scheme>://...")` 패턴 **무수정** 동작 — `installAppChannelShim()`
- **운영**: 권한 고지 · 개인정보/성인인증 · CI 자동배포 · 푸시 경로 화이트리스트(보안)

원칙: **하네스=네이티브 배관, 웹=`if(isNative) AppBridge.xxx()` 연결, 백엔드=검증/게이팅, 콘솔=신고.**

---

## 빠른 시작 (수동 흐름)

```bash
node scripts/doctor.mjs                                   # 환경 + 모든 앱 config 점검
node scripts/generate-app.mjs --slug <slug> --platform android
cd build/<slug>/android && ./gradlew assembleDebug        # 서명 없는 디버그 APK
```

- 새 서비스 추가 흐름 → [`ONBOARDING.md`](ONBOARDING.md)
- 웹에 기능 연결 → [`docs/06-INTEGRATION.md`](docs/06-INTEGRATION.md)
- config 스키마(정본) → [`docs/02-GUIDE.md`](docs/02-GUIDE.md) §6
- 인계 문서(Poptale) → [`docs/21-POPTALE-MIGRATION.md`](docs/21-POPTALE-MIGRATION.md)

---

## 레포 레이아웃

```
Appharness/
├── docs/01-AIPIA-CONVENTIONS.md         ⭐ 전사 컨벤션 정본 (번들ID·도메인·SDK·이벤트명)
├── docs/21-POPTALE-MIGRATION.md         ⭐ Poptale Flutter → 하네스 이전 인계 문서
├── docs/02-GUIDE.md / ONBOARDING.md / docs/06-INTEGRATION.md / docs/10-AUTH.md / docs/11-IAP.md / ...
├── apps/<slug>/app.config.json  # 앱 정의(단일 진실 공급원) + icon.png/splash.png
│   ├── aipia/                   #   AIPIA 본 앱 레퍼런스
│   ├── characterchat/           #   팝챗 prod (com.aipia.characterchat)
│   ├── characterchat-dev/       #   팝챗 dev  (com.aipia.characterchat.dev)
│   ├── poptale/                 #   Poptale prod (com.aipia.poptale)
│   ├── poptale-dev/             #   Poptale dev  (com.aipia.poptale.dev)
│   └── poptale-global/          #   Poptale 글로벌 (com.aipia.poptale.global)
├── template/
│   ├── src/                     # 오프라인/에러 폴백 셸
│   ├── bridge/                  # 공유 브릿지 (Capacitor 플러그인 + JS SDK + 타입)
│   ├── integration/             #   harness-adapter.js (AppChannel shim 포함)
│   └── plugins/                 # 네이티브 플러그인 작업 사양서 (코드 아님)
│       ├── adbrix/SPEC.md       #   P0
│       └── whatap/SPEC.md       #   P1/보류
├── build/<slug>/                # 생성된 Capacitor 프로젝트 (gitignore)
├── scripts/                     # generate-app.mjs, doctor.mjs
│   └── lib/config.mjs           #   스키마 + AIPIA_DEFAULTS + aipiaPreset()
├── fastlane/                    # 빌드/업로드 lane
├── .github/workflows/release.yml # CI 자동배포
└── .claude/skills/              # 자동화 스킬(new-app, integrate-web, build-*, ...)
```

---

## 📚 문서

문서 **22개**는 전부 [`docs/`](docs/) 에 번호순으로 있다.
**색인은 [`CLAUDE.md`](CLAUDE.md) 하나뿐이다** — 목적별 라우팅 · 카테고리 · 대상 독자 · 상태를 한 표에서 본다.
(Claude Code 가 매 세션 자동으로 읽는 파일이라 사람과 AI 가 같은 색인을 본다.)

| 급하면 이것부터 | |
|---|---|
| 새 앱을 추가한다 | [`01-AIPIA-CONVENTIONS`](docs/01-AIPIA-CONVENTIONS.md) → [`04-NEW-APP-CHECKLIST`](docs/04-NEW-APP-CHECKLIST.md) |
| 테스터에게 배포한다 | [`07-HOWTO-DEPLOY`](docs/07-HOWTO-DEPLOY.md) |
| 하네스 동작을 알고 싶다 | [`02-GUIDE`](docs/02-GUIDE.md) |
| 플러그인 사양 | [`template/plugins/`](template/plugins/) |

---

## 환경 / 요구사항

| 항목 | 값 |
|---|---|
| Capacitor | 8 |
| Node | **24** (`.nvmrc` — 웹 레포와 같은 버전). 최소 22 — Capacitor CLI 8 이 20 을 거부한다 — `nvm use` |
| pnpm (웹 측) | 10.5.2 (AIPIA 웹 표준) |
| JDK (Android) | **21 필수** |
| Android SDK | platform 35, build-tools 35 (target 36 — AIPIA 표준 🅰️) |
| Android 최소 OS | **API 29 (Android 10)** 🅰️ |
| iOS 최소 | **15.0** 🅰️ |
| iOS 빌드 | macOS + Xcode 26 (또는 CI macOS 러너) |

점검 명령: `node scripts/doctor.mjs`

---

## 현재 상태 (정직)

### 검증됨 ✅
- Android `assembleDebug` 빌드 (전 기능 + 8 소셜 + IAP + 안전영역)
- **iOS — `.ipa` 생성과 TestFlight 업로드만 검증** — fastlane `ios build`(.ipa, match) / `ios beta` 동작. 앱 내부 기능은 아래 참고
- 백엔드 레퍼런스 스모크(게스트/기기/지갑)
- `aipiaPreset()` 자동 생성 → loadConfig 검증 통과
- 6개 앱 config (`aipia`, `characterchat`, `characterchat-dev`, `poptale`, `poptale-dev`, `poptale-global`) doctor 오류 0

### 구현됨, 실기기 검증 전 🔧
- **iOS 실기기 기능** — APNs 수신 · NSE 실행 · 유니버설 링크(AASA) 연결. **빌드/업로드 성공이 기능 동작을 보장하지 않는다**
- **Adbrix 네이티브 플러그인** (어트리뷰션 · 디퍼드 딥링크 버퍼링) — 코드는 있으나 cold/warm start · 앱 종료 후 복구 · 중복 이벤트 · 버퍼 소비 시점이 미검증. **cold install → 광고 링크 클릭 → 최초 실행 수신**을 실기기로 확인할 것

### 미검증 ⚠️
- WhaTap 네이티브 플러그인 — `template/plugins/whatap/SPEC.md` 작업 사양만 있음, 실제 SDK 통합은 dev 가 채워야 함 (Kakao/Naver 네이티브 SDK 사양은 2026-09-11 삭제 — 소셜 로그인은 브라우저 OAuth/브로커, `docs/25` §3)
- Poptale 마이그 호환성 매트릭스(`docs/21-POPTALE-MIGRATION.md §3`) — 10개 항목 PASS/FAIL 검증 미실행

### 외부 의존(사람 몫) 🙋
- Apple Developer Program / Google Play Console 계정 · 멤버십
- Apple/Google/Kakao/Naver Developer Console 의 앱 등록 + 키 해시
- 스토어 IAP 상품 · 가격 티어 · 개인정보 라벨
- Firebase 프로젝트 3개(`{env}-aipia-<slug>`) 생성 + google-services 파일
- Adbrix/Amplitude/WhaTap 대시보드 앱 등록
- ~~IdP 배포(Keycloak)~~ — **제거됐다**(#25). 인증은 외부 인증서버 위탁이 기본이다

자세히: [`docs/01-AIPIA-CONVENTIONS.md §14·§15`](docs/01-AIPIA-CONVENTIONS.md), [`docs/02-GUIDE.md §5`](docs/02-GUIDE.md).

---

## 안전 원칙 (변하지 않는 것들)

- **시크릿/키 절대 config·레포 금지** — GitHub Secrets / fastlane match / 환경변수만
- **프로덕션 스토어 공개는 사람이 승인** — 자동화는 베타/내부 트랙까지
- **빅뱅 금지** — 동작하는 앱(Poptale Flutter)은 패리티 검증 전까지 깨지 않는다
- **자격증명/결제정보 자동 입력 금지**
- **회원탈퇴 엔드포인트 필수** — 스토어 정책

---

## 라이센스 / 컨택

- 사내 비공개 레포(aipia-team org)
- 컨벤션/하네스 관련 문의: AIPIA 팀 내부 채널
- Poptale 이전 인계: [`docs/21-POPTALE-MIGRATION.md §2`](docs/21-POPTALE-MIGRATION.md) 책임 분담 표 참조
