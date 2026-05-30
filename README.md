# Appharness — Web→Native Harness (Capacitor)

여러 웹 서비스를 **하나의 얇은 네이티브 셸 + 공유 브릿지**로 감싸 iOS/Android 앱으로 반복 추출하는 하네스.
앱은 `server.url` 로 **배포된 웹을 원격 로드**하고, 웹은 `@harness/bridge` 로 네이티브 기능을 호출한다.
모든 작업은 **Claude Code 스킬**로 자동화(GUI 빌더 없음, 오픈소스).

> 📖 **처음이면 [`GUIDE.md`](GUIDE.md) 부터.** 지원 기능·사용 흐름·필수 입력·문서 색인을 한 곳에(Mermaid 포함).

---

## 지원 기능 (요약)

- **앱 기능**: 푸시 · 딥링크 · 강제업데이트 · 카메라 · 생체인증 · 시큐어스토리지 · 로컬알림 · 햅틱 · 클립보드 · 위치 · 공유 · 안전영역
- **인증/SSO**: 이메일 + 소셜 8(apple/google/naver/kakao/facebook/x/threads) · 중앙 IdP(Keycloak) · 회원가입 온보딩 · 게스트→실계정 병합 · 회원탈퇴 · 생체 빠른 로그인
- **결제**: 인앱결제(디지털 재화) · 웹앱 가격 분기 · 서버 지갑
- **운영**: 마케팅(AppsFlyer) · 크래시(Sentry) · 권한 고지 · 개인정보/성인인증 · CI 자동배포

원칙: **하네스=네이티브 배관, 웹=`if(isNative) AppBridge.xxx()` 연결, 백엔드=검증/게이팅, 콘솔=신고.**

---

## 빠른 시작

```bash
node scripts/doctor.mjs                               # 환경 + 모든 앱 config 점검
node scripts/generate-app.mjs --slug <slug> --platform android
cd build/<slug>/android && ./gradlew assembleDebug    # 서명 없는 디버그 APK
```

- 새 서비스 추가 → [`ONBOARDING.md`](ONBOARDING.md)
- 웹에 기능 연결 → [`INTEGRATION.md`](INTEGRATION.md)
- config 스키마(정본) → [`GUIDE.md`](GUIDE.md) §6

---

## 레포 레이아웃

```
Appharness/
├── apps/<slug>/app.config.json   # 앱 정의(단일 진실 공급원) + icon.png/splash.png
├── template/
│   ├── src/                      # 오프라인/에러 폴백 셸
│   ├── bridge/                   # 공유 브릿지(커스텀 Capacitor 플러그인 + JS SDK)
│   └── integration/             # 웹에 드롭인하는 harness-adapter
├── build/<slug>/                 # 생성된 Capacitor 프로젝트 (gitignore)
├── scripts/                      # generate-app.mjs, doctor.mjs, lib/
├── backend/auth-reference/       # 인증+IAP 백엔드 레퍼런스(Node)
├── idp/                          # 중앙 IdP(Keycloak) 로컬 구동 세트
├── fastlane/                     # 빌드/업로드 lane
├── .github/workflows/release.yml # CI 자동배포
└── .claude/skills/               # 자동화 스킬(new-app, integrate-web, build-* ...)
```

---

## 📚 문서 색인

| 문서 | 내용 |
|---|---|
| **[`GUIDE.md`](GUIDE.md)** ⭐ | **마스터 — 여기부터.** 지원 기능·흐름·필수 입력·스키마 정본·문서 색인 |
| [`ONBOARDING.md`](ONBOARDING.md) | 새 서비스 추가 전체 흐름 |
| [`INTEGRATION.md`](INTEGRATION.md) | 프론트 통합 — `@harness/bridge` + 어댑터 + API |
| [`SETUP.md`](SETUP.md) | 환경/키 단계별 준비 |
| [`AUTH.md`](AUTH.md) | 로그인/SSO/회원가입/게스트/탈퇴/중앙 IdP/백엔드 규약 |
| [`IAP.md`](IAP.md) | 인앱결제/웹앱 가격분기/지갑/백엔드 검증 |
| [`COMPLIANCE.md`](COMPLIANCE.md) | 접근권한/개인정보/성인인증/연령등급 |
| [`DATA-COLLECTION.md`](DATA-COLLECTION.md) | 스토어 개인정보 양식·처리방침용 수집 목록 |
| [`DEPLOY.md`](DEPLOY.md) | CI/CD 자동배포/시크릿/서명 |
| [`DEVICE-SUPPORT.md`](DEVICE-SUPPORT.md) | 기기/OS/해상도/노치/폴더블 |
| [`MARKETING.md`](MARKETING.md) | 마케팅 SDK(AppsFlyer) |
| [`STRATEGY.md`](STRATEGY.md) · [`REFERENCES.md`](REFERENCES.md) · [`APP-FEATURES.md`](APP-FEATURES.md) | 전략 · 외부참조 · 기능·플러그인 |
| [`idp/README.md`](idp/README.md) · [`backend/auth-reference/`](backend/auth-reference/) | Keycloak 구동 · 백엔드 레퍼런스 |

---

## 환경

**Capacitor 8 · Node 20+ · JDK 21**(Android 필수) · **macOS + Xcode 26**(iOS, 또는 CI macOS 러너로 맥 없이).
점검: `node scripts/doctor.mjs`

## 상태 (정직)

- ✅ **검증**: Android `assembleDebug` 빌드(전 기능+8소셜+IAP+안전영역 등), 백엔드 레퍼런스 스모크.
- ⚠️ **미검증**: iOS 빌드(첫 macOS/CI 실행에서 엔타이틀먼트 연결 확인).
- ⚠️ **레퍼런스/외부**: 백엔드(인메모리)·IdP 배포·스토어 계정/상품·소셜키·본인확인 PG 는 사람/외부 몫. 자세히는 `GUIDE.md` §5·§9.
