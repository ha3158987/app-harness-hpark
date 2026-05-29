# 참조 깃 / 문서 모음

Claude Code가 구현 중 참조할 1차 소스. 버전 차이가 잦으니 **항상 해당 메이저(Capacitor 8)
문서를 확인**할 것. npm 패키지는 정확한 이름/최신 버전을 npm에서 재확인 후 설치.

---

## 코어 프레임워크

- **Capacitor (런타임 본체)** — https://github.com/ionic-team/capacitor
- **Capacitor 공식 문서** — https://capacitorjs.com/docs
  - 딥링크 가이드 — https://capacitorjs.com/docs/guides/deep-links
  - v8 업그레이드/요구사항 — https://capacitorjs.com/docs/updating/8-0
- **@capacitor/cli (npm)** — https://www.npmjs.com/package/@capacitor/cli
- **공식 플러그인 모노레포** — https://github.com/ionic-team/capacitor-plugins
  - push-notifications, local-notifications, app, splash-screen, browser, share,
    camera, geolocation, preferences, app-launcher 등이 여기 들어있음

## 아이콘 / 스플래시 자동 생성

- **@capacitor/assets** — https://github.com/ionic-team/capacitor-assets
  - 소스 `icon.png`(1024²) / `splash.png`(2732²)에서 전 플랫폼 사이즈 생성. 화이트라벨링 핵심.

## 빌드 / 서명 / 스토어 업로드 자동화

- **fastlane** — https://github.com/fastlane/fastlane · 문서: https://docs.fastlane.tools
  - `match` (인증서/프로비저닝 암호화 git 관리)
  - `gym`/`build_app` (iOS 빌드), `pilot` (TestFlight), `supply` (Play 업로드)
  - Capacitor + fastlane 조합 사례는 docs.fastlane.tools 의 iOS/Android 가이드 참조

## 디퍼드 딥링크 / 어트리뷰션 (FDL 대체)

> Firebase Dynamic Links는 2025-08-25 완전 종료. 신규 사용 금지. 아래 중 택1.

- **Branch** — https://branch.io · 문서에서 Capacitor/Cordova 연동 가이드 확인
- **AppsFlyer Capacitor 플러그인** — https://github.com/AppsFlyerSDK/appsflyer-capacitor-plugin
- Adjust, Airbridge 등도 Capacitor/Cordova SDK 제공 (각 공식 문서 확인)
- 선택 기준: 여러 앱을 한 계정 아래 묶어 굴릴 수 있는지 / 무료 한도 / MAU 과금 구조

## 공유 브릿지 설계 참고 (직접 포크 금지, 설계만 참고)

- **Median JS Bridge** — https://github.com/gonativeio/median-javascript-bridge
  - "config 토글 → JS 브릿지로 네이티브 호출" 패턴의 좋은 레퍼런스 (MIT)
- ⚠️ `gonativeio/gonative-android`, `gonative-ios` 는 **아카이브됨**. 베이스로 쓰지 말 것.
  설계/네이밍 참고용으로만.

## 보안 기능 플러그인 (npm에서 최신/이름 재확인)

- 생체인증: npm "capacitor biometric" 검색 (예: `@aparajita/capacitor-biometric-auth`)
- 시큐어 스토리지: npm "capacitor secure storage" 검색 (Keychain/Keystore 기반)
- ⚠️ `@capacitor/preferences`는 **암호화 안 됨** — 토큰/세션 저장에 쓰지 말 것

## OTA 웹 업데이트 (선택)

- **@capgo/capacitor-updater** — https://www.npmjs.com/package/@capgo/capacitor-updater
  - 스토어 재배포 없이 웹 번들 갱신. 플러그인은 오픈소스(서비스는 별도/자체호스팅 가능)

## 스토어 정책 (자동화 파이프라인 컴플라이언스)

- **Google Play 타깃 API 요건** — https://developer.android.com/google/play/requirements/target-sdk
- **Apple 제출 요구사항(SDK/Xcode)** — https://developer.apple.com/news/upcoming-requirements/

## Claude Code 스킬 작성

- **Skills 문서** — https://docs.claude.com (Agent Skills / SKILL.md 포맷)
  - SKILL.md = YAML frontmatter(`name`, `description`) + 마크다운 본문
  - `description`은 트리거 핵심 — "무엇을 + 언제" 모두 포함, 약간 적극적으로 작성
  - 결정론적 반복 작업은 `scripts/`로 빼고 본문은 짧게(<500줄)
