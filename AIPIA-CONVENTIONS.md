# AIPIA-CONVENTIONS — 전사 앱 컨벤션 (정본)

> 이 하네스는 *범용 Capacitor 하네스*가 아니라 **AIPIA 전사 앱 하네스**다.
> 여러 앱(Poptale, AIPIA, ...)을 찍어내지만, 식별자/도메인/스택/SDK 선택은 **AIPIA 표준**을 따른다.
> 이 문서는 두 레퍼런스 레포에서 추출한 그 표준을 한 곳에 모은 *정본*이다.
> 새 앱을 추가할 때는 [GUIDE.md](GUIDE.md) 전에 **이 문서를 먼저** 읽는다.

**출처**:
- 🅰️ [aipia-team/poptale-app](https://github.com/aipia-team/poptale-app) — Flutter 1.1.15+183 (운영 중)
- 🅱️ [aipia-team/poptale-frontend](https://github.com/aipia-team/poptale-frontend) — Next.js 15 (운영 중)

각 항목 옆 🅰️/🅱️ 는 어느 레포에서 확인된 패턴인지의 표시.

---

## 1. 식별자 규칙

### 1-1. 번들 ID (Bundle ID / App ID)

| 환경 | 패턴 | 예시 |
|---|---|---|
| prod / stage | `com.aipia.<slug>` | `com.aipia.poptale` 🅰️ |
| dev | `com.aipia.<slug>.dev` | `com.aipia.poptale.dev` 🅰️ |

- 🅰️ Poptale 1.0.1+128 에서 stage 와 prod 패키지명 통일 (`com.aipia.poptale.stage` → `com.aipia.poptale`).
  → **stage 와 prod 는 같은 번들**, dev 만 `.dev` 서픽스.
- 새 앱 슬러그는 영소문자/숫자/하이픈만, 예: `aipia`, `poptale`, `service-a`.

### 1-2. Firebase 프로젝트 ID

| 환경 | 패턴 | 예시 |
|---|---|---|
| prod | `aipia-<slug>` | `aipia-poptale` 🅰️ |
| stage | `stage-aipia-<slug>` | `stage-aipia-poptale` 🅰️ |
| dev | `dev-aipia-<slug>` | `dev-aipia-poptale` 🅰️ |

- 🅰️ 3개 환경 별도 프로젝트, `flutterfire configure --out` 으로 flavor 별 옵션 파일 분리.
- 하네스 config: `firebase.project: { dev, stage, prod }` 에 위 값들을 *표시용*으로 둔다(실제
  `google-services.json` / `GoogleService-Info.plist` 는 secrets 에서 빌드 시 배치).

### 1-3. iOS 팀 / Android 서명

- Apple Developer Team: AIPIA 단일 (구체 ID 는 fastlane `.env`)
- Android 업로드 키: 앱별 keystore 분리 (App Signing 은 Play 가 관리)
- *match git repo*: 인증서/프로비저닝 1개 비공개 git 에 통합 관리 (앱별 폴더 분리)

---

## 2. 도메인 / URL 규칙

### 2-1. 서비스 도메인

| 용도 | 패턴 | Poptale 실값 |
|---|---|---|
| 웹 (prod) | `<service>.ai` | `poptale.ai` 🅱️ |
| 웹 (stage) | `stg.<service>.ai` | `stg.poptale.ai` 🅱️ |
| 웹 (dev) | `dev.<service>.ai` | `dev.poptale.ai` 🅱️ |
| API (prod) | `api.<service>.ai` | `api.poptale.ai` 🅱️ |
| API (stage) | `stg.api.<service>.ai` | `stg.api.poptale.ai` 🅱️ |
| API (dev) | `dev.api.<service>.ai` | `dev.api.poptale.ai` 🅱️ |
| CDN (prod) | `images.<service>.ai` | `images.poptale.ai` 🅱️ |
| CDN (dev/stage) | `dev-images.<service>.ai` | `dev-images.poptale.ai` 🅱️ |
| Editor 등 서브 | `editor.<service>.ai` | `editor.poptale.ai` 🅱️ |

→ **TLD 는 `.ai` 통일**. AIPIA 모든 서비스가 같은 TLD 아래 있음.

### 2-2. 쿠키 도메인 (SSO 공유)

| 환경 | 패턴 | 의미 |
|---|---|---|
| prod | `.<service>.ai` | 서브도메인 전체 SSO |
| stage | `.stg.<service>.ai` | stage 격리 |
| dev | `.dev.<service>.ai` | dev 격리 |

- 🅱️ `NEXT_PUBLIC_COOKIE_DOMAIN` 으로 환경 분기. 로컬은 비워둠.
- 쿠키 이름 패턴: `user_token` (prod), `user_token_dev` (dev) 🅱️ — 환경 격리.

### 2-3. AppChannel URL 스킴

- 패턴: `<slug>://` (앱별 고유) — 예: `poptale://` 🅰️
- 신규 앱은 자신의 슬러그를 스킴으로 사용. 어댑터:
  ```js
  installAppChannelShim({ scheme: '<slug>' });
  ```
- 🅰️ Poptale 1.1.15+183 에서 `poptale://deeplink/*` 핸들러 추가 (path/url 방식).

### 2-4. Universal Links / App Links

- iOS `apple-app-site-association` 호스팅: 각 환경 도메인 루트에서 서빙
- Android `assetlinks.json`: 동일
- 🅰️ Poptale 의 딥링크 테스트 URL: `https://poptale.ai/detail/<id>`, `https://dev.poptale.ai/detail/<id>` 등

---

## 3. 인증 — K-Market 4 Socials

AIPIA 모든 앱의 기본 인증 제공자 세트:

```jsonc
"auth": { "providers": ["apple", "google", "kakao", "naver"] }
```

- 🅰️ Poptale Flutter: `google_sign_in`, `kakao_flutter_sdk_user`, `flutter_naver_login`, `sign_in_with_apple`
- **이메일/비밀번호 제공 안 함** (소셜 only) — Poptale 정책.
- 🅰️ 1.0.1+143: 카카오·네이버는 **JWT 전체** 를 백엔드에 전달 (token-only → full-jwt 전환).
- 백엔드 엔드포인트는 `<api-domain>/api/v2/auth/...` 패턴 (🅰️🅱️ 확인됨).

### 3-1. AIPIA 자체 앱(이 하네스 1호)이 8 socials 인 이유

- AIPIA 앱은 `apple/google/naver/kakao/facebook/x/threads` 까지 8종 (글로벌 서비스). K-market 만이면 4종으로 충분.
- 신규 앱은 **K-market 4 종이 기본값**. 글로벌 확장 시 facebook/x/threads 추가.

### 3-2. 중앙 IdP (Keycloak) vs 직접 OAuth

- AIPIA 본 앱: Keycloak 중앙 IdP 모드 (`auth.idp.issuer` 설정)
- Poptale: 직접 OAuth + 백엔드 JWT 검증 (Spring) — `auth.idp: {}`
- → 둘 다 지원. 신규 앱은 *서비스 백엔드 정책*에 맞춰 선택.

---

## 4. 결제 (IAP)

### 4-1. 표준 정책

- 디지털 재화 = **스토어 IAP 강제** (Apple/Google), 외부 결제 anti-steering 준수
- 가격 분기: 웹 100원 / 앱 120원 (스토어 수수료 부분 상쇄) — 자세히 [IAP.md](IAP.md)
- 영수증 검증은 백엔드 (`iap.verifyEndpoint`)

### 4-2. AIPIA 기본값

```jsonc
"iap": {
  "verifyEndpoint": "https://api.<service>.ai/api/v2/iap/verify",
  "googleTokenCompression": true
}
```

- 🅰️ Poptale 0.28.21+102: Google purchase token 길이 이슈 → **gzip+base64 압축이 기본**.
- 백엔드(Spring)도 해당 포맷을 수용해야 함.
- 상품 SKU 패턴: `<bundle-id>.<sku>` 예: `com.aipia.poptale.coin100`

### 4-3. 웹 PG vs 앱 IAP

- 🅱️ 웹: PortOne (`@portone/browser-sdk`) — 카드/간편결제
- 앱: Apple IAP / Google Play Billing (네이티브)
- 같은 지갑(서버) 에 적립. 클라는 서버 잔액만 신뢰.

---

## 5. 마케팅 / 분석 (Amplitude + Adbrix)

```jsonc
"marketing": {
  "attribution": { "provider": "adbrix",   "deferredDeepLink": false },
  "analytics":   { "provider": "amplitude" },
  "crm":         { "provider": null }
}
```

- 🅰️ Adbrix (DFINERY) — 한국 어트리뷰션. Poptale 1.1.13+181 도입.
- 🅰️🅱️ Amplitude — 분석. 웹/앱 공통.
- AppsFlyer 는 **사용 안 함**. (디퍼드 딥링크가 필요해지면 그때 결정)

### 5-1. 이벤트 명명 표준 (필수)

- 형식: **lowercase snake_case**
- 네임스페이스: `app_*`, `push_*`, `sns_*`, `iap_*`
- 🅰️ Poptale 1.1.8+175 에서 확정. 신규 앱도 같은 표준.

| 영역 | 예시 |
|---|---|
| 생명주기 | `app_open`, `app_foreground`, `screen_view` |
| 푸시 | `push_received`, `push_open`, `push_dismiss` |
| 소셜 | `sns_login_attempt`, `sns_login_success`, `sns_login_fail` — 속성 `{ method }` |
| IAP | `iap_init`, `iap_purchase_requested`, `iap_purchase_success`, `iap_purchase_fail`, `iap_restore_requested` |

### 5-2. UTM / 자동 수집

- 🅰️ 1.1.5+172 — UTM 보존 + 자동 lifecycle/push/SNS/IAP/privateId sync.
- 하네스 어댑터의 `autoCapture: true` 가 기본.

---

## 6. 모니터링

```jsonc
"monitoring": {
  "crash": { "provider": "crashlytics" },
  "apm":   { "provider": "whatap" }
}
```

- 🅰️ Crashlytics: Poptale Flutter 사용 중 (Firebase Crashlytics)
- 🅱️ WhaTap: 웹은 WhaTap Browser Agent 사용 중. *앱 측 도입은 의사결정 필요*
  (Poptale Flutter 에는 WhaTap 모바일 SDK 미통합 — 신규 앱부터 검토)

### 6-1. Sentry 안 쓰는 이유

- 사내 표준이 Firebase Crashlytics (Firebase 프로젝트 이미 운영 중) + 한국형 APM(WhaTap)
- Sentry 는 슬롯만 유지 (외부 협업 시 사용 가능)

---

## 7. 푸시 / 딥링크

### 7-1. FCM 표준

- Firebase Cloud Messaging — Android/iOS 모두 FCM 토큰 사용
- 백엔드 `/auth/device` 로 토큰 등록 (계정-기기 바인딩)

### 7-2. 푸시 경로 화이트리스트 (보안)

🅰️ Poptale 1.1.9+176 에서 도입된 정책 — FCM `data.link` 의 경로 prefix 가 화이트리스트에 없으면 차단.

```jsonc
"features": {
  "pushPolicy": {
    "allowedPaths": ["/recommend", "/detail/", "/viewer", "/event", "/info/notice", "/info/inquiry"]
  }
}
```

- 외부에서 임의 경로로 진입 유도하는 공격 방지.
- 앱별로 화이트리스트가 다를 수 있음 (서비스 IA 에 따라).

### 7-3. 딥링크

- 직접 딥링크: Universal Links (iOS) + App Links (Android)
- 디퍼드 딥링크: **현재 사용 안 함** (Firebase Dynamic Links 종료, AppsFlyer 미사용)
- AppChannel 콜드스타트 URI 회수: 🅰️ 1.1.12+180

---

## 8. 디자인 / UX 표준

### 8-1. 색상 / 테마

- 기본 배경: **검정 (`#000000`)** 🅰️🅱️
- statusBar: **light** (어두운 배경 → 밝은 텍스트/아이콘)
- 다크모드: **기본 ON** (`features.darkMode: true`) 🅰️ Poptale 1.1.0+149

```jsonc
"theme": { "primary": "#000000", "statusBarStyle": "light", "background": "#000000" }
```

### 8-2. 폰트

- **Pretendard** (🅰️ Poptale Flutter 표준)
- 사용 굵기: 500, 600 (필요 시 추가)

### 8-3. 반응형

- 🅱️ 모바일 first, **max-width 440px** 기준 (Poptale Frontend 표준)
- 폴더블 / 태블릿: 안전영역 + 중앙정렬 (스플래시 등)

### 8-4. 스플래시

- 🅰️ Poptale 1.1.0+148~150: 움직이는 스플래시 + 다크모드 대응
- 새 앱도 *움직이는 스플래시* 가능 (Capacitor `splash` 플러그인 또는 자체 구현)

### 8-5. 화면 캡쳐 방지

- 뷰어/유료 콘텐츠 화면에서만 차단 (전역 X)
- 🅰️ Poptale 0.28.26+108: Viewer 페이지 한정
- config: `features.viewer.captureBlock.paths: ["/viewer"]`

---

## 9. 백엔드 (Spring MSA)

- 🅱️ Spring 기반 마이크로서비스 — Swagger 노출:
  - `https://<api-domain>/api/v2/swagger-ui/index.html`
  - `https://<api-domain>/api/v2/v3/api-docs`
- 🅱️ Poptale 의 swagger 포트: 38082, 38083, 38084, 38088 (마이크로서비스 분리)
- API base: `<api-domain>/api/v2`
- TypeScript 타입 생성: `swagger-typescript-api` 🅱️

### 9-1. 인증 백엔드 엔드포인트 (표준)

```
POST /api/v2/auth/native        # 소셜 자격증명 → 세션 + isNew 판단
POST /api/v2/auth/signup        # 약관 + 추가정보 → 가입 확정
POST /api/v2/auth/guest         # 게스트(익명) 생성
POST /api/v2/auth/logout
POST /api/v2/auth/delete        # 회원탈퇴
POST /api/v2/auth/device        # 푸시 토큰 / 기기 등록
GET  /api/v2/auth/me
POST /api/v2/iap/verify         # 영수증 검증 + 지갑 적립
POST /api/v2/webhooks/apple     # App Store Server Notifications v2
POST /api/v2/webhooks/google    # Google RTDN
```

→ 새 앱 백엔드도 이 패턴을 따름.

---

## 10. 웹 프론트 표준 (Next.js)

🅱️ AIPIA 의 웹 프론트 공통 스택:

| 항목 | 값 |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + Styled Components 6 (하이브리드) |
| State (client) | Zustand 5 |
| State (server) | TanStack Query 5 |
| Form | React Hook Form 7 + Zod |
| HTTP | ky |
| Package Manager | **pnpm 10.5.2 (고정)** |
| Node | **20.18.3 (고정)** |
| Test | Vitest + happy-dom |
| Commit | Commitizen + Husky + lint-staged |

### 10-1. 성능 / SEO 규약 🅱️

- **LCP < 2.5s** 필수
- 모든 `page.tsx` 에 `metadata` 또는 `generateMetadata` 필수
- Server Component first — `'use client'` 는 hooks/browser API 필요 시에만, 사유 주석 필수
- `pnpm type-check` 0 errors 필수

### 10-2. 환경변수 패턴

- 클라이언트 노출: `NEXT_PUBLIC_*` (Adbrix Web SECRET KEY 도 SDK 규격상 여기)
- 서버 전용: prefix 없음
- 비밀값은 *절대* `NEXT_PUBLIC_` 에 두지 않음

---

## 11. 최소 OS 지원

| 플랫폼 | 최소 | 타겟 |
|---|---|---|
| iOS | **15.0** 🅰️ | 최신 (Xcode 26 권장) |
| Android | **SDK 29 (Android 10)** 🅰️ | **SDK 36** 🅰️ |

- 🅰️ Poptale 1.0.0+118 에서 확정. 이전 OS 는 *지원 종료*.
- Capacitor 8 의 최소 요구치(Android API 23, iOS 14)보다 높음 — AIPIA 가 더 엄격.

---

## 12. 보안 / 규정

- **시크릿/키 절대 config·레포 금지** — GitHub Secrets / fastlane match / 환경변수만.
- **개인정보처리방침 / 약관 URL** 필수 (`legal.privacyUrl`, `legal.termsUrl`) — 스토어 심사용.
- **회원탈퇴(`/auth/delete`)** 필수 (스토어 정책).
- (성인 콘텐츠 시) 본인확인 PG — Poptale 은 미사용. AIPIA 본 앱은 검토.
- 🅰️ ATT (App Tracking Transparency) — iOS 14.5+ 필수. Adbrix init 전에 호출.

---

## 13. 왜 이 선택인가 (의사결정 메모)

| 선택 | 이유 |
|---|---|
| 번들 ID `com.aipia.*` | 법인 도메인 통일 — 스토어 콘솔/계정 관리 단순화 |
| Firebase 3 프로젝트 분리 | 환경 격리 (dev/stage/prod 데이터 섞임 방지) |
| 같은 stage/prod 번들 | 🅰️ 1.0.1+128 — 테스터/개발자 환경 통일 |
| K-market 4 socials | 한국 시장 핵심 (95%+ 커버). 글로벌은 옵션 |
| IAP token compression default | 🅰️ 0.28.21+102 — Google token 길이 페이로드 한계 회피 |
| Adbrix (not AppsFlyer) | 🅰️ 1.1.13+181 — 한국 어트리뷰션 시장 선호도 |
| WhaTap (not Datadog) | 🅱️ 사내 표준, 한국형 APM |
| Crashlytics (not Sentry) | Firebase 프로젝트 이미 운영 중, 추가 벤더 부담 ↓ |
| AppChannel compat default | 기존 웹앱(`poptale://`) 무수정 이전 위해 |
| Dark mode default | 🅰️ 1.1.0+149 — Poptale 정책. 새 앱도 가독성·OLED 효율 |
| Pretendard | 🅰️ 사내 표준 한글 폰트 |
| max-width 440px | 🅱️ 모바일 first — 한국 모바일 시장 우선 |
| pnpm + Node 고정 | 🅱️ 빌드 재현성 |

---

## 14. 신규 앱 추가 시 — 체크리스트

1. **슬러그 확정** — `<service>` (영소문자/숫자/하이픈)
2. **번들 ID** 자동 도출: `com.aipia.<slug>` (+ `.dev` for dev flavor)
3. **Firebase 프로젝트 3개 생성** — `{dev|stage|aipia}-<slug>` 또는 `aipia-<slug>` (prod)
4. **도메인 발급** — `<slug>.ai` + `dev.<slug>.ai` + `stg.<slug>.ai` (+ API/CDN 서브도메인)
5. **소셜 OAuth 앱 등록** — Apple, Google, Kakao, Naver (4종 기본)
6. **백엔드** — `/api/v2/auth/*` `/api/v2/iap/verify` 표준 엔드포인트 구현
7. **이 하네스에 `apps/<slug>/app.config.json` 추가** — [POPTALE-MIGRATION.md](POPTALE-MIGRATION.md) §9 의 예시 또는 [apps/poptale/](apps/poptale/) 복제
8. **(필수 외부)** Apple Dev / Play Console 권한, 스토어 IAP 상품 등록, 개인정보처리방침 URL, 연령등급
9. **(웹)** [INTEGRATION.md](INTEGRATION.md) 따라 `@harness/bridge` 통합. 기존 웹앱이면 `installAppChannelShim()` 만.

---

## 15. 외부 변수 (이 컨벤션 밖의 것)

| 항목 | 위치 |
|---|---|
| Apple Developer Program 계정 | AIPIA 법인 |
| Google Play Console 계정 | AIPIA 법인 |
| Kakao Developer Console | https://developers.kakao.com — 앱별 추가 등록 |
| Naver Developer Center | https://developers.naver.com — 앱별 추가 등록 |
| Adbrix 대시보드 | (DFINERY) 앱별 추가 |
| Amplitude 프로젝트 | 앱별 추가 |
| WhaTap 프로젝트 | 앱별 추가 |
| Firebase 콘솔 | https://console.firebase.google.com (구글 계정) |

---

**Last Updated**: 2026-06-01
**원천 레포**: `aipia-team/poptale-app` (Flutter), `aipia-team/poptale-frontend` (Next.js)
