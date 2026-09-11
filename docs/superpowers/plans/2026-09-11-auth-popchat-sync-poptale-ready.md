# 팝챗 인증 완료 반영 + 팝테일 글로벌 재사용 준비 — 분석·계획 (검토 요청용)

> **상태: Prompt 2 구현 완료(2026-09-11) — publish 대기.** 결정: Q1 배너 · Q2 (c) 문서 참조 · Q3 승인 · Q4 팝챗 BE 계약 그대로.
> 진행 기록은 문서 끝 §8. 아래 §3~§7 은 분석 시점 그대로 두었다(무엇이 왜 바뀌었는지의 근거).
> 작성일 2026-09-11. 하네스 `feat/auth-popchat-sync-poptale-ready`(origin/main `d926530`),
> 웹 `chore/auth-harness-legacy-audit`(origin/main `c4fe231`) 기준으로 실측했다.
>
> 웹 레포 경로는 `web:` 접두, 하네스는 접두 없음. 줄 번호는 위 두 커밋 기준.

---

## 0. 한 줄 결론

**팝챗 앱은 하네스 정본 문서(25/10)가 "주경로"라고 적은 길 B(앱 직접 OAuth)를 전혀 쓰지 않는다.**
2026-09-03 에 **브로커 로그인**(앱이 서비스 BE 의 `start` 를 인앱 브라우저로 열고, 인증서버가
커스텀 스킴으로 돌려준 `code` 를 앱 WebView 가 상환)으로 확정됐고, 하네스도 #34 에서 그 모드를
지원한다(`auth.oauthReturnScheme`). 그런데 **문서 25/10/02 와 브릿지 일부 코드는 여전히 길 B
전제**로 남아 있다. 팝테일 글로벌이 이 문서를 따라가면 팝챗과 다른 인증을 만들게 된다.

코드 결함은 한 건(P0)이다 — 브릿지 `rememberLastLogin()` 이 브로커 앱에서 항상 거절돼 웹이
`setPref` 로 우회하고 있다. 나머지는 문서·스키마·프리셋 정합성이다.

---

## 1. 읽은 정본 문서와 확인한 규약

| 문서 | 이 작업에 적용한 규약 |
|---|---|
| `CLAUDE.md` | 01 이 전사 정본, 02 §6 이 config 스키마 정본, 인증 정본은 25. `docs/26` 은 삭제됨 — 재생성 금지 |
| `docs/25-AUTH-DELEGATION.md` | 하네스는 **운반만 하고 해석하지 않는다**(§1). 브릿지 소스에 서비스 고유 이름 금지(§4). 브라우저는 ②인앱을 쓴다(§3). 브릿지 JS 는 publish→웹 배포로 닿고, 네이티브·config 는 앱 재빌드(§6). 프리릴리즈는 `--tag beta`(§6) |
| `docs/10-AUTH.md` | IdP(Keycloak) 절은 배경 기록. 게스트·탈퇴·기기바인딩·딥링크 복귀 절은 유효. 로그아웃·탈퇴 시 기기 토큰 해제 순서가 계약(§3-7) |
| `docs/01-AIPIA-CONVENTIONS.md` | 번들 `com.aipia.<slug>`, 도메인 `.ai`, provider 10종 정본은 `config.mjs KNOWN_AUTH_PROVIDERS`, `auth.idp` 금지 키. **§3 기본값은 K-market 4종·이메일 미제공(Poptale 정책)** |
| `docs/02-GUIDE.md` §6 | auth 블록 허용 키: `providers · oauth · sessionEndpoint · signupEndpoint · logoutEndpoint · deleteEndpoint · guestEndpoint · deviceEndpoint · deviceUnregisterEndpoint`. **`oauthReturnScheme` 은 §6 에 없다**(코드에는 있다 — §3 C2) |
| `docs/06-INTEGRATION.md` | 어댑터 패턴 권장. API 표(§2)와 로그인 패턴(§3)은 `login()` 기준 |
| `docs/21-POPTALE-MIGRATION.md` | Poptale(국내) Flutter 이전 문맥. Kakao/Naver **네이티브 SDK** 플러그인 P0, 키 해시 콘솔 등록 — 길 C 전제. 팝테일 글로벌과 별건 |
| `docs/superpowers/plans/2026-08-26-auth-provider-expansion.md` | H-1~H-7 완료 이력. "`login()` 의 기존 반환 필드를 제거·개명하지 마라" |
| `web:CLAUDE.md` | 프론트 변경 시 `docs/frontend/01-overview.md` 갱신 트리거 |
| `web:docs/12-auth-and-access.md` | 폐기 문서(배너 있음). 현행은 `be-auth-contract.md` |
| `web:docs/be-auth-contract.md` | BE 공개 API: `GET /auth/social/{p}/start`, `POST /auth/social/redeem`, `POST /auth/signup`, `POST /auth/logout`, `POST /auth/withdraw`. `POST /auth/social/native` 는 "앱 경로 중계"로 적혀 있다(§3 W4) |
| `web:docs/frontend/03-auth-plan.md` | §7 "하네스와의 계약" 이 `AppBridge.login` 기준 — 현행 코드와 다름(§3 W2) |
| `web:docs/25-observability-analytics-app-harness.md` | 초기 브릿지 설계 스냅샷. `NEXT_PUBLIC_APP_HARNESS_ENABLED` 플래그 언급(§3 W3) |

---

## 2. 웹 인증 흐름 — 현재 진실 (팝챗 `character-chatbot-web`)

앱/웹 분기는 `web:src/lib/harness/adapter.ts` 한 곳이다. 화면은 `AppBridge` 를 직접 import 하지 않는다
(`harness-demo` 제외).

| 흐름 | 앱(네이티브 셸)에서 브릿지에 하는 것 | BE 엔드포인트 | 근거 |
|---|---|---|---|
| **소셜 로그인** | `AppBridge.onDeepLink` 로 복귀 대기 → `openExternal(startUrl)` **인앱 브라우저**(옛 브릿지면 `{system:true}` 폴백) → 복귀 URL `host==="oauth"` + `code/error` 로 판별 → `closeInAppBrowser()`. 취소는 `onBrowserClosed`(없으면 `onPause`×`onResume`). **`AppBridge.login()` 미사용.** 복귀 스킴 `<appId>://oauth/callback` | `GET /auth/social/{p}/start?platform=app` → 상환 `POST /auth/social/redeem {code}` (앱 WebView 가 직접) | `adapter.ts:201-216, 239, 263-288, 333-468` |
| 콜드스타트 복귀(고아 code) | `HarnessInit` 딥링크 핸들러가 `isOAuthCallbackUrl` 이면 라우팅 대신 `redeemOrphanOAuthReturn` | 같은 redeem | `web:src/lib/harness/HarnessInit.tsx:124-128`, `adapter.ts:290-326` |
| 마지막 로그인 수단 | 읽기 `AppBridge.getLastLogin()`. **쓰기는 `AppBridge.setPref('last_login_provider', m)` 직접** — 브릿지 `rememberLastLogin()` 을 안 쓴다(§3 B1). 값은 소셜 8종 + `'email'` | — | `adapter.ts:559-603`, `web:src/components/auth/ProviderButton.tsx:70`, `EmailSignInForm.tsx:80` |
| **회원가입**(소셜 신규 / 이메일) | `AppBridge.completeSignup(body, { reload:false })` — 웹이 `signupToken`·약관·닉네임 등을 body 로 넘기고 `ok` 만 읽는다. 화면 전환은 웹 소유 | `POST /auth/signup` (config `auth.signupEndpoint`) | `adapter.ts:519-535`, `web:src/app/signup/profile/page.tsx:23` |
| 이메일 로그인 | 브릿지 무관 — 웹 폼 → `apiFetch` | `POST /auth/login/email` | `web:src/lib/auth/authApi.ts:161-166` |
| **로그아웃** | `AppBridge.logout({ reload:false })` **+** 웹도 `POST /auth/logout` 를 한 번 더(설정 유무를 웹이 모르므로 양쪽 호출) → `location.href='/'` | `auth.logoutEndpoint` + `/auth/logout` | `adapter.ts:647-665`, `web:src/app/(tabs)/me/LogOutButton.tsx:4,18` |
| **탈퇴** | 사유를 `POST /auth/withdraw/reasons` 로 **먼저** best-effort 전송 → `AppBridge.deleteAccount({ reload:false })`. 브릿지 시그니처에 body 가 없어 2요청(§3 C4) | `auth.deleteEndpoint`(=`/auth/withdraw`) | `adapter.ts:605-645`, `web:src/app/me/withdraw/page.tsx:31,74` |
| 부트스트랩 | `AppBridge.ready()` → `onDeepLink` 1회 등록 → `initMarketing`. 푸시 등록은 로그인·ATT 뒤 | — | `adapter.ts:38-50`, `HarnessInit.tsx:102-170` |

**웹이 브릿지에서 쓰지 않는 것**: `login()` · `guestLogin()` · `rememberLastLogin()` · `enableBiometricLogin()/unlock()`(데모 화면만) · `sessionEndpoint`.

**의존 버전**: `web:package.json:25` `^1.5.0-beta.2`, 설치본 `1.5.0-beta.2`, 레지스트리 `beta: 1.5.0-beta.3 / latest: 1.4.0`(실측). beta.3 = #45 `rememberLastLogin`.

**팝챗 앱 config 실값** (`apps/characterchat{,-dev}/app.config.json`):
`auth.providers: []` · `oauthReturnScheme: true` · `signupEndpoint/logoutEndpoint/deleteEndpoint(/auth/withdraw)/deviceEndpoint(/api/push/register)/deviceUnregisterEndpoint` · **`sessionEndpoint`·`oauth` 없음** · `features.deepLink/secureStorage: true`.

---

## 3. 발견 목록

분류: **A** 레거시-삭제 · **B** 레거시-수정 · **C** 누락-추가 · **D** 팝테일 파라미터화 · **E** 유지.
영향: 문서 / config / 브릿지JS(publish) / 네이티브(재빌드) / 스크립트.

### P0 — 정본이 현행과 반대이거나, 팝테일 글로벌이 그대로 물려받으면 안 되는 것

| # | 분류 | 발견 | 하네스 근거 | 웹 근거 | 영향 |
|---|---|---|---|---|---|
| **B1** | B | **브릿지 `rememberLastLogin()` 이 브로커 앱에서 항상 `provider-not-enabled`** — 게이트가 `auth.providers.includes(p)` 인데 브로커 앱은 `providers: []` 가 정상. `.d.ts` 주석은 "앱이 자체 OAuth 를 도는 구성은 직접 불러라" 인데 그 구성이 정확히 거절 대상이다. 웹은 그래서 같은 키에 `setPref` 로 직접 쓴다 — 키 이름이 두 레포에 박혀 있고, 팝테일 글로벌은 이 우회를 복사하게 된다 | `template/bridge/dist/index.js:1033-1047`(:1039 게이트), `dist/index.d.ts:267-277`, `docs/25:124-143` | `web:src/lib/harness/adapter.ts:594-603`, `web:docs/frontend/01-overview.md:250` | 브릿지JS · 테스트 |
| **B3** | B | docs/25 §4 "웹과의 계약 — 이 다섯 개가 전부다"(`login/completeSignup/rememberLastLogin/getLastLogin/logout/deleteAccount`) — 팝챗 실계약은 `onDeepLink + openExternal + closeInAppBrowser/onBrowserClosed(+onPause/onResume 폴백) + getLastLogin(+pref) + completeSignup({reload:false}) + logout({reload:false}) + deleteAccount({reload:false})`. `login()` 은 0회 | `docs/25-AUTH-DELEGATION.md:124-133` | `adapter.ts:333-468, 519-665` | 문서 |
| **B4** | B | docs/25 §7 config 샘플이 "팝챗 기준" 이라며 `providers 8종 + oauth.clientId + sessionEndpoint` 를 보인다 — 실제 팝챗 config 는 `providers:[] + oauthReturnScheme:true`, `sessionEndpoint`·`oauth` 없음, `deviceEndpoint` 도 `/api/push/register` | `docs/25:270-300` vs `apps/characterchat/app.config.json`, `apps/characterchat-dev/app.config.json` | — | 문서 |
| **B5** | B | docs/25 §3 "주경로는 B 다" + §3 "A 를 앱에서 쓰려면 — 지금은 하지 않는다 … `broker` 모드 … 착수하지 않는다" — 브로커 모드는 #34(`da5d339`, 2026-09-04)로 구현됐고 팝챗의 **유일한** 경로다. 길 B 는 poptale(국내) 앱만 쓴다 | `docs/25:75-81, 116-120`; 구현: `scripts/lib/config.mjs:82-92`, `scripts/lib/auth-setup.mjs:63-73, 104-133`, `test/oauth-return-scheme.test.mjs` | `adapter.ts:201-208`("2026-09-03 확정") | 문서 |
| **A1** | A | docs/25 §9 `H-6 broker 모드 — 조건부. 지금 하지 않는다` 행 + "인증서버 팀에 확인할 것 1. … → H-6 착수 여부" — 완료된 일을 미착수로 표기 | `docs/25:399, 431` | 위와 같음 | 문서 |
| **C2** | C | **`auth.oauthReturnScheme` 이 02 §6 스키마 정본에 없다.** 코드(`DEFAULT_AUTH`)와 팝챗 config 는 쓰고 있다. 스키마 정본에 없으니 `new-app`/사람이 브로커 앱을 만들 근거가 없다 | `docs/02-GUIDE.md:235-244, 267-270` vs `scripts/lib/config.mjs:82-92` | `apps/characterchat/app.config.json` | 문서(스키마) |
| **C5** | C | B1 의 회귀 테스트가 없다 — `remember-last-login.test.mjs` 는 providers 가 채워진 앱만 검사 | `test/remember-last-login.test.mjs:36-90` | — | 테스트 |

### P1 — 팝테일 글로벌 착수 전에 맞춰야 하는 것

| # | 분류 | 발견 | 하네스 근거 | 웹 근거 | 영향 |
|---|---|---|---|---|---|
| **C1** | C | **브로커 로그인 헬퍼가 하네스에 없다.** 공식 어댑터 `harness-adapter.js` 는 `login()`→`AppBridge.login` 만 있다. 팝챗 웹은 인앱 브라우저 열기·복귀 판별·취소 판정·옛 브릿지 폴백·고아 code 상환·결과 판정을 ~300줄 자체 구현했다. 팝테일 글로벌은 이걸 복사해야 한다. 브릿지에는 이미 같은 일을 하는 `_awaitOAuthRedirect` 가 네이티브 경로 전용으로 있다 | `template/integration/harness-adapter.js:39-47`, `template/bridge/dist/index.js:1485-1503`, `docs/06:50, 66-72` | `adapter.ts:239-517`(`isOAuthCallbackUrl`·`redeemOrphanOAuthReturn`·`awaitOAuthReturn`·`brokeredSignIn`·`signInOutcome`), `web:src/lib/harness/{oauthReturn,signInOutcome}.test.ts` | 브릿지JS 또는 어댑터 · 문서 · **범위 결정 필요(§6 Q2)** |
| **C3/D1** | C·D | **`aipiaPreset`/`new-app` 이 네이티브 OAuth 형태만 만든다** — `providers` K-market 4종, `oauth.<p>.clientId`, `sessionEndpoint /api/v2/auth/native`, `guestEndpoint`. 브로커 형태(팝챗·팝테일 글로벌) 옵션이 없고 `new-app` SKILL 에 인증 질문이 없다. 팝테일 글로벌을 `new-app` 으로 만들면 사람이 손으로 팝챗 모양으로 고쳐야 한다 | `scripts/lib/config.mjs:529-532, 562-573, 604-636`, `.claude/skills/new-app/SKILL.md`(auth 언급 0) | `apps/characterchat/app.config.json`(목표 형태) | 스크립트 · 스킬 · **02 §6 키 추가 없음**(oauthReturnScheme 은 기존 키) |
| **D1'** | D | docs/01 §3 "K-Market 4 socials 기본 · 이메일 미제공(Poptale 정책)" — 팝테일 글로벌은 팝챗 스펙(이메일 + 소셜 8종, 브로커)을 따른다. 브로커 앱은 **provider 목록을 앱이 갖지 않는다**(웹 `GET /auth/terms` 가 정함)는 규약이 01 에 없다. 01 은 전사 정본 → 사용자 결정(§6 Q3) | `docs/01-AIPIA-CONVENTIONS.md:104-142` | `web:src/lib/auth/providers.ts:9-18`, `authApi.ts:60-62`, `useAuthBootstrap.ts:73` | 문서(정본) |
| **B6** | B | docs/10 §0 표 "B 앱 직접 OAuth — 팝챗 앱(주경로)" + "팝챗 앱은 길 B 를 쓴다" | `docs/10-AUTH.md:36-39` | `adapter.ts:201-208` | 문서 |
| **B11** | B | docs/25 §9 "인증서버 팀에 확인할 것" 2·3·6 번(앱 clientId 일치·커스텀 스킴 redirect 등록·예약 이름) — 브로커에서는 앱이 clientId 를 들지 않고, 커스텀 스킴은 인증서버 `returnUrl` 로 확정됐고(웹 주석 "auth 팀 확정"), `sessionEndpoint` pass-through 가 없다 | `docs/25:429-445` | `adapter.ts:217-222` | 문서 |
| **A2** | A | docs/25 §9 "`characterchat` 태그 릴리즈는 CI 에서 실패한다 — clientId 전부 null" — 브로커 앱은 clientId 게이트를 타지 않는다(테스트로 보장) | `docs/25:425-427` vs `test/oauth-return-scheme.test.mjs:79` | — | 문서 |
| **D2** | D | 복귀 스킴 규약 `<appId>://oauth/callback`(host `oauth`) 이 웹 상수로만 존재하고 하네스 문서에 없다. 팝테일 글로벌이 다른 host 를 쓰면 인증서버 화이트리스트·웹 판별이 갈린다 | `docs/25` 전체(언급 없음), `scripts/generate-app.mjs:1066-1110`(스킴만 등록, path 무관) | `adapter.ts:239` | 문서 |
| **B12** | B | 웹 어댑터의 "옛 브릿지 폴백"(`onBrowserClosed`·`onPause` 없으면 ③+복귀 판정, beta.1 이전 딥링크 재생 방어)이 **하네스 문서에 호환 매트릭스로 없다** — 어느 브릿지 버전부터 인앱 브라우저·1회 배달이 보장되는지 | `docs/25:82-105`(② 권장만), `template/bridge/package.json`(1.5.0-beta.3) | `adapter.ts:168-186, 341-346, 396-411` | 문서 |

### P2 — 정리·품질

| # | 분류 | 발견 | 하네스 근거 | 웹 근거 | 영향 |
|---|---|---|---|---|---|
| **B2** | B | `capabilities.auth = providers.length > 0` → 브로커 앱은 인증을 하는데 `auth:false`. 지금 소비자는 없지만(웹 `caps().auth` 미사용) 거짓 capability 다 | `template/bridge/dist/index.js:113-115, 75` | `adapter.ts:26`(caps 노출만) | 브릿지JS |
| **C4** | C | `deleteAccount()` 가 body 를 못 싣는다(`{deviceId}` 고정) → 웹이 탈퇴 사유를 별도 요청으로 먼저 보낸다(2요청, 사유 성공·탈퇴 실패 가능). `completeSignup` 처럼 `{ body }` pass-through 를 주면 1요청. `logout` 도 대칭 | `dist/index.js:1155-1164`, `dist/index.d.ts:290-293` | `adapter.ts:605-645` | 브릿지JS · d.ts |
| **A3** | A | `backend/auth-reference/` 가 **Keycloak/IdP 모드** 레퍼런스다(#25 에서 제거된 경로). 배너 없음. CLAUDE.md §4 가 "백엔드 레퍼런스 구현" 으로 안내 | `backend/auth-reference/README.md:3-5, 12-23`, `server.mjs:1-5, 20-33`, `CLAUDE.md` §4 | — | 삭제 또는 배너 — **사용자 결정(§6 Q1)** |
| **B9** | B | `auth-setup.mjs` 상단 주석의 provider 열거에 `line·discord` 누락 | `scripts/lib/auth-setup.mjs:15-16` | — | 주석 |
| **B10** | B | `template/plugins/README.md` 가 Kakao/Naver **네이티브 SDK** 플러그인을 P0 로 유지 — 25 §3 은 "길 C 는 구현 없음, UX 기대치를 여기 맞춰라". 팝챗·팝테일 글로벌은 브로커라 불필요. Poptale(국내) 이전 문맥에서만 의미 | `template/plugins/README.md:8-9`, `docs/21:104-105` vs `docs/25:110-114` | — | 문서(우선순위 주석) |
| **D3** | D | `apps/characterchat` prod API 호스트 `api.chat.poptale.ai` 는 25 §9 가 "미확인 추정치" 로 남겼고 지금도 근거가 없다(dev 호스트는 웹 문서로 확인됨) `[미확인]` | `docs/25:420-423`, `apps/characterchat/app.config.json` | `web:docs/frontend/01-overview.md:212`(dev 만) | config — 사람 확인 |

### E — 확인했고 그대로 둔다

| # | 항목 | 근거 |
|---|---|---|
| E1 | `logout()`/`deleteAccount()` 정리 순서(기기해제→토큰→BE), `reload:false`, 보류 딥링크 폐기 | `dist/index.js:1140-1176`, `test/logout-cleanup.test.mjs`; 웹이 정확히 그 옵션으로 호출 `adapter.ts:636, 656` |
| E2 | 딥링크 보류분 1회 배달 + TTL(#40) | `dist/index.js:286-320`, `test/deep-link-pending.test.mjs`; 웹은 옛 브릿지 대비 방어만 추가 `adapter.ts:341-346` |
| E3 | `closeInAppBrowser`/`onBrowserClosed`(#42) | `dist/index.js:882-907`; 웹 feature-detect `adapter.ts:168-186`. iOS `browserFinished` 발화 조건은 `[미확인 실기기]` |
| E4 | `completeSignup` pass-through·`reload` 옵션 | `dist/index.js:1576-1600`; 웹은 `ok` 만 읽음 |
| E5 | 복귀 스킴 네이티브 등록(`appId://`, path 무관) — `oauth/callback` 포함 | `scripts/generate-app.mjs:1066-1110, 2015-2021` |
| E6 | 브로커 앱 스토어 게이트(탈퇴 필수·clientId 면제·Apple 엔타이틀먼트 분리) | `scripts/lib/auth-setup.mjs:63-73, 120-133`, `test/oauth-return-scheme.test.mjs` |
| E7 | 25 §3 "브라우저 세 종류 — ②" 서술 | 웹 `a7770b1` 과 일치 |
| E8 | 네이티브 OAuth `_oauth2` 가 아직 ③(공용 브라우저) | `dist/index.js:1440-1483`; 25 §3:107 이 인지. poptale 운영 경로라 실기기 확인 전 불변. 팝테일 글로벌은 이 경로를 안 탄다 |
| E9 | 10 §3-6 게스트 · §3-7 생체 빠른 로그인 | 팝챗 미사용, poptale 기능. 유효 |
| E10 | provider 세 곳 동기화(25 §6) | 네이티브 OAuth 앱에는 여전히 유효. 브로커 앱은 무관(웹/BE 가 목록 소유) — 그 단서만 추가(B3 에 포함) |
| E11 | 브릿지 소스에 서비스 고유 이름 없음 | `grep signupToken|withdraw/reasons|cc_session template/bridge` 0건. `oauth` host 도 웹 쪽 상수 |

### 웹 레포 후속 (이번 범위 밖 — 별건 PR 로)

| # | 내용 | 근거 |
|---|---|---|
| W1 | B1 이 브릿지에 반영·publish(beta.4)되면 `rememberLastLogin` 을 `AppBridge.rememberLastLogin` 로 되돌리고(옛 브릿지 폴백 = 현행 `setPref`), `01-overview.md:250` 갱신 | `adapter.ts:594-603` |
| W2 | `docs/frontend/03-auth-plan.md` §7 "하네스와의 계약" 이 `AppBridge.login` 기준 — 현행(브로커) 으로 | `web:docs/frontend/03-auth-plan.md:167-175` |
| W3 | `.env.example` `NEXT_PUBLIC_APP_HARNESS_ENABLED` 가 `src` 어디서도 안 읽힌다(문서 25/26/27 만) | `web:.env.example:71` |
| W4 | `be-auth-contract.md` `POST /auth/social/native`(앱 경로 중계)·`be-stub route.ts:108`·`authErrors.ts native_signup_unsupported(409)` — 앱이 네이티브 경로를 안 쓰므로 BE 엔드포인트 존치 여부를 BE 팀과 확인 | `web:docs/be-auth-contract.md:66`, `web:src/app/be-stub/[...path]/route.ts:108`, `web:src/lib/auth/authErrors.ts:129-141` |
| W5 | 브릿지 의존 `^1.5.0-beta.2`(설치 beta.2) — 레지스트리 beta.3. W1 시점에 함께 올림 | `web:package.json:25` |

---

## 4. 실행 계획 (Prompt 2 — 승인 후)

원칙: 하네스만 고친다. 웹은 §3 "웹 레포 후속" 으로 넘긴다. 브릿지 JS 변경은 publish 전 사람 확인.

### Phase 1 — 문서 정합 (코드 0, publish 0) · P0/P1 문서 항목 전부

| 대상 | 변경 | 검증 |
|---|---|---|
| `docs/25-AUTH-DELEGATION.md` | §3: "주경로는 B" → **"경로는 둘 — 네이티브 OAuth(B, poptale 국내) · 브로커(팝챗·신규 앱 기본)"**. "A 를 앱에서 쓰려면 — 지금은 하지 않는다" 절 → 브로커 모드 설명(`oauthReturnScheme`, 복귀 스킴 `<appId>://oauth/callback`, 인앱 브라우저, 상환은 앱 WebView). §4: 계약을 **모드별 2표**로(B3). §7: config 샘플 2종(B4). §9: H-6 ✅ + 확인 항목 재작성(A1·A2·B11). 신설: **브릿지 버전 호환 매트릭스**(B12: beta.1 딥링크 1회 배달, beta.2 인앱 브라우저·`onBrowserClosed`·`onPause`, beta.3 `rememberLastLogin`) + D2 복귀 스킴 규약 | 읽기 검토. `docs/02 §6`·`01` 과 충돌 없음 확인 |
| `docs/10-AUTH.md` | §0 표 B 행 "팝챗 앱(주경로)" → poptale, 브로커 행 추가(팝챗). :39 문장 수정(B6) | 읽기 검토 |
| `docs/02-GUIDE.md` §6 | auth 블록에 `"oauthReturnScheme": false` + 필드 메모 1줄("브로커 앱: providers 비우고 이 키를 true — 네이티브 OAuth 없이 복귀 스킴만 등록")(C2). **새 키 아님** — `config.mjs:92` 기존 키의 문서화 | `grep oauthReturnScheme docs/02-GUIDE.md` |
| `docs/06-INTEGRATION.md` | §2 표에 브로커용 메서드 행, §3 에 "브로커 로그인" 패턴 1개(팝챗 어댑터 참조 링크) | 읽기 검토 |
| `scripts/lib/auth-setup.mjs:15-16` | 주석 provider 열거 보정(B9) | `npm test` |
| `template/plugins/README.md` | Kakao/Naver 행에 "길 C — 브로커 앱 불필요. Poptale 국내 이전 한정" 주석(B10) | — |
| `CLAUDE.md` §4 | A3 결정에 따라 `backend/auth-reference` 행 갱신 또는 삭제 | — |

### Phase 2 — 브릿지 JS (publish `1.5.0-beta.4`, `--tag beta`) · B1 · B2 · C5

| 대상 | 변경 | 검증 |
|---|---|---|
| `template/bridge/dist/index.js:1033-1047` | `rememberLastLogin` 게이트: `providers.includes(p) || auth.oauthReturnScheme === true`. 브로커 분기에서는 값 형식만 검사(`OAUTH_PRESETS` 키 ∪ `'email'`) — 웹/BE 가 목록을 소유하므로 더 좁히지 않는다(25 §1) | `test/remember-last-login.test.mjs` 에 브로커 케이스 3건 추가(허용·비문자열 거절·getLastLogin 왕복) |
| `template/bridge/dist/index.js:113-115` | `capabilities.auth = providers.length > 0 || !!auth.oauthReturnScheme`(B2) | `test/` 에 1건 |
| `template/bridge/dist/index.d.ts:267-277` | `rememberLastLogin` 주석: 브로커 앱 허용 명시. `login()` 반환 필드 불변 | `npm test` |
| `template/bridge/package.json` | `1.5.0-beta.3` → `1.5.0-beta.4` | `npm publish --dry-run` → **사람 확인** → `npm publish --tag beta`(25 §6 규칙: `latest` 는 1.4.0 유지) |
| 후속 | 웹 W1 티켓 | — |

### Phase 3 — 프리셋·new-app (C3/D1) · **Q3·Q4 답 이후**

| 대상 | 변경 | 검증 |
|---|---|---|
| `scripts/lib/config.mjs:604-636` | `aipiaPreset({ slug, appName, authMode })`. `authMode:'native'`(기본, 현행 유지) / `'broker'` → `providers:[]`, `oauthReturnScheme:true`, `sessionEndpoint`·`oauth`·`guestEndpoint` 제외, signup/logout/delete/device/deviceUnregister 만. 엔드포인트 경로는 Q4 로 정한 맵 | `test/config-validation.test.mjs` 에 broker 프리셋이 `loadConfig`·`authSetup` 통과(blockers 0) 1건 |
| `.claude/skills/new-app/SKILL.md` | "인증 모드: 네이티브 OAuth / 브로커(팝챗형)" 질문 1개 추가 → `authMode` 전달 | 스킬 드라이런(`--skip-install`) |
| `docs/01-AIPIA-CONVENTIONS.md` §3 | Q3 승인 시: "브로커 앱은 provider 목록·이메일 여부를 앱이 갖지 않는다 — 웹/BE 정본" 1절 추가. 01 은 정본이라 **승인 없이는 건드리지 않는다** | — |

### Phase 4 — 선택 (Q2 답 이후) · C1 · C4

| 안 | 내용 | 대가 |
|---|---|---|
| C1-a | 브릿지에 `awaitOAuthReturn(startUrl, { callbackHost:'oauth', timeoutMs })` 신설 — 인앱 브라우저 열기·복귀 판별·`onBrowserClosed` 취소·close·`_awaitOAuthRedirect` 와 공유. **상환·결과 판정은 웹에 남긴다**(BE 계약이라 25 §1) | publish 1회. 웹은 feature-detect 로 점진 채택. 팝테일 글로벌은 ~150줄 덜 복사 |
| C1-b | `template/integration/harness-adapter.js` 에 JS 포팅만 | publish 없음. 웹 TS 와 이중 관리 |
| C1-c | 문서로 "팝챗 `adapter.ts` 가 참조 구현" 링크만 | 0 비용. 복사 유도 |
| C4 | `deleteAccount({ body })`·`logout({ body })` 를 POST body 에 병합(`completeSignup` 과 같은 규약) | d.ts 변경. 팝챗 웹은 그대로 동작(옵션) |

---

## 5. 팝테일 글로벌 준비 체크리스트 (인증 한정)

전제(메모리): 글로벌 앱은 **팝챗과 동일 인증 스펙**. 정본은 레포 밖 아티팩트 "팝테일 글로벌 시작 가이드" — **이 문서는 그 가이드를 읽지 않고 썼다**(§6 Q6).

| 항목 | config 만으로 되나 | 지금 상태 | 비고 |
|---|---|---|---|
| 앱 정의 생성(`new-app`) | ❌ (Phase 3 전) | 프리셋이 네이티브 OAuth 형태 → 팝챗 config 를 복제해 `slug/appId/startUrl/endpoints` 치환하는 것이 현실적 | C3 |
| 복귀 스킴 | ✅ `auth.oauthReturnScheme: true` | 하네스 자동 등록 | 인증서버 `returnUrl` 화이트리스트에 `com.aipia.<slug>://oauth/callback`(dev 는 `.dev`) **사람이 등록 요청** |
| provider 목록 | ✅ 앱은 안 가짐 | 웹 `GET /auth/terms` + FE 상수 | Kakao/Naver **키 해시 등록 불필요**(앱이 공급자와 직접 안 함 — 21 §3 의 요건은 네이티브 SDK 한정) |
| Sign in with Apple | ✅ 브로커는 웹 OAuth | `usesNativeApple=false` → 엔타이틀먼트 없음 | Apple 4.8 은 웹 버튼으로 충족 |
| 가입/로그아웃/탈퇴 엔드포인트 | ✅ `signupEndpoint/logoutEndpoint/deleteEndpoint` | 팝챗 BE 와 같은 계약이면 값만 | BE 가 다르면 웹 어댑터 경로도 달라짐(Q4) |
| 기기 바인딩 | ✅ `deviceEndpoint/deviceUnregisterEndpoint` | | 푸시 쓰면 필수 |
| 스토어 게이트 | ✅ | `deleteEndpoint` 필수, clientId 면제 | `--release` 에서 자동 |
| 마지막 로그인 배지 | ⚠️ | Phase 2 전: 팝챗처럼 `setPref` 우회 필요 | B1 |
| 웹 측 브로커 로그인 | ❌ 하네스 미제공 | 팝챗 `adapter.ts` 복사 | C1 |
| 브릿지 최소 버전 | `≥1.5.0-beta.2` | 인앱 브라우저·취소 판정 | B12 매트릭스 |
| `features` | `deepLink: true`, `secureStorage: true` 필수, `biometric` 선택 | | 25 §7 |
| 남는 수동 작업 | 인증서버 client 등록·returnUrl 화이트리스트·`X-Internal-Key`(BE)·스토어 콘솔 | `docs/04` 에 브로커 앱용 행 추가 필요(현재 :228 은 "clientId" 전제) | |

---

## 6. 열린 질문 — 사용자 결정 필요

| # | 질문 | 영향 |
|---|---|---|
| **Q1** | `backend/auth-reference/`(Keycloak 레퍼런스) — **삭제**할지, 상단 배너("제거된 IdP 경로의 배경 기록")만 붙일지 | A3, CLAUDE.md §4 |
| **Q2** | C1 범위 — (a) 브릿지 API 신설 / (b) 어댑터 JS 포팅 / (c) 문서 참조만. 추천 **(a)**: 이미 `_awaitOAuthRedirect` 가 있어 중복이 줄고, 팝테일 글로벌이 검증된 로직을 물려받는다. 단 publish 1회 | Phase 4 |
| **Q3** | `docs/01` §3 (전사 정본) 에 "브로커 앱은 provider 목록을 앱이 갖지 않는다" 를 추가할지. 01 은 승인 없이 못 고친다 | Phase 3 |
| **Q4** | 팝테일 글로벌 BE 가 팝챗 BE 계약(`/auth/social/{p}/start`, `/auth/social/redeem`, `/auth/signup`, `/auth/withdraw`, `/auth/logout`)을 **그대로** 쓰는가. 아니면 `AIPIA_DEFAULTS.backendEndpoints`(`/api/v2/auth/*`) 인가 | 프리셋 broker 엔드포인트 맵 |
| **Q5** | `apps/characterchat` prod `api.chat.poptale.ai` 실제 호스트 확인 | D3 |
| **Q6** | 팝테일 글로벌 시작 가이드(아티팩트)의 **인증 항목**을 대조해야 §5 를 확정할 수 있다 — 링크 제공 또는 "인증 절 없음" 확인 요청 | §5 |

---

## 7. 검증 방법 요약

- 문서 단계: `grep -n "주경로는 B\|지금 하지 않는다\|이 다섯 개가 전부다" docs/25-AUTH-DELEGATION.md` 가 0건.
- 브릿지 단계: `npm test`(node --test) 전건 통과 + 신규 케이스 4건. `npm publish --dry-run` tarball 에 `dist/` 만.
- 프리셋 단계: `node -e "import('./scripts/lib/config.mjs').then(m=>console.log(JSON.stringify(m.aipiaPreset({slug:'poptale-global',appName:'Poptale',authMode:'broker'}).auth)))"` 가 팝챗 config 모양. `node scripts/doctor.mjs` 오류 0.
- 실기기: Phase 2 이후 팝챗 dev 앱에서 소셜 로그인 → 재진입 시 "마지막 로그인" 배지(W1 반영 후).

---

## 8. 진행 기록 (Prompt 2 · 2026-09-11)

| 항목 | 결과 | 어디 |
|---|---|---|
| **B1** `rememberLastLogin` 브로커 게이트 | ✅ `providers:[]` + `oauthReturnScheme:true` 면 10종(`OAUTH_PRESETS` ∪ `email`) 통과, 그 밖 `unknown-provider`. 네이티브 앱 게이트 불변 | `template/bridge/dist/index.js` `rememberLastLogin`, `dist/index.d.ts` 주석 |
| **B2** `capabilities.auth` | ✅ `deriveAuthCapability(auth)` → `_authCapability()` 로 분리(테스트 가능) | `dist/index.js` `ready()` |
| **C5** 회귀 테스트 | ✅ 브로커 4건 추가. 기존 5번 테스트가 `rememberLastLogin` 을 `undefined` 로 "복원"하던 잠복 버그도 수정 | `test/remember-last-login.test.mjs` |
| 브릿지 버전 | `1.5.0-beta.3` → **`1.5.0-beta.4`**. `npm publish --dry-run --tag beta` 통과(8 파일, 46.8 kB). **publish 는 사람 확인 후** | `template/bridge/package.json` |
| **C3/D1** `aipiaPreset` | ✅ `authMode: 'native'(기본·호환) | 'broker'`. broker → `providers:[]`, `oauthReturnScheme:true`, signup/logout/withdraw/push-register/push-unregister(팝챗 계약 그대로), `sessionEndpoint`·`oauth`·`guestEndpoint` 없음. 오타는 throw | `scripts/lib/config.mjs` `AIPIA_DEFAULTS.brokerEndpoints`, `aipiaPreset` |
| `new-app` 스킬 | ✅ 인증 모드 질문 + `aipiaPreset` 호출 절차 + returnUrl 화이트리스트 안내 | `.claude/skills/new-app/SKILL.md` |
| 프리셋 테스트 | ✅ 4건 — native 출력 불변 · broker 모양 · `authSetup` blockers/warnings 0 · 오타 거절 | `test/aipia-preset.test.mjs` |
| **B3·B4·B5·A1·A2·B11·D2·B12** docs/25 | ✅ §3 경로표 A′ 신설 + "어느 앱이 어느 길" + A′ 규약 · §4 두 형태 · §5 브로커 판정 금지 · §6 **버전 호환 매트릭스** · §7 두 config · §9 H-6 ✅ + 확인 항목 갱신. **C1 은 (c)** — 참조 구현(팝챗 `adapter.ts`) 링크 | `docs/25-AUTH-DELEGATION.md` |
| **B6** docs/10 | ✅ §0 표에 A′ 행, 팝챗=브로커 | `docs/10-AUTH.md` |
| **C2** docs/02 §6 | ✅ `oauthReturnScheme` 키 + 필드 메모 | `docs/02-GUIDE.md` |
| docs/06 | ✅ §2 브로커 행 · §3 브로커 로그인 패턴(골격 + 참조 구현) | `docs/06-INTEGRATION.md` |
| **D1′** docs/01 §3 (Q3 승인) | ✅ "두 형태" 표 신설, 3-2 두 경로 병기. K-market 4종은 네이티브 앱 기본으로 한정 | `docs/01-AIPIA-CONVENTIONS.md` |
| **A3** (Q1 배너 → **삭제**로 변경, 같은 날) | ✅ `backend/auth-reference/` 삭제 · docs/10 §5 IdP/Keycloak 절 삭제 · 02/25/01/README/ONBOARDING/CLAUDE.md 참조 정리 — "하네스에는 유효한 코드만" 결정 | (삭제) |
| **B9 · B10** | ✅ 주석·우선순위 주석 | `scripts/lib/auth-setup.mjs`, `template/plugins/README.md` |
| CLAUDE.md §2 | ✅ 01/02/06/10/25 최종 수정 2026-09-11 | `CLAUDE.md` |

**검증**: `npm test` 65/65 · `node scripts/doctor.mjs` 5 앱 오류 0(경고 11 — #34 기준선과 동일) · `npm run check` · `node --check` 통과 ·
`grep "주경로는 B|지금 하지 않는다|이 다섯 개가 전부다" docs/25` 0건.

**하지 않은 것 (의도)**
- **C4** `deleteAccount({ body })` — 결정 없음 → 보류. 팝챗 웹의 2요청 우회는 그대로 동작한다.
- **D3** `api.chat.poptale.ai` prod 호스트 — Q5 미답. 25 §7 에 "미확인" 유지.
- **§5 팝테일 글로벌 체크리스트 대조** — Q6(아티팩트 가이드) 미답. 체크리스트는 분석 시점 그대로.
- **웹 후속 W1~W5** — 웹 레포는 변경 0건(범위 밖). beta.4 publish 뒤 W1(`rememberLastLogin` 복귀 + 폴백)부터.
- **publish** — `npm publish --tag beta` 는 되돌릴 수 없어 사람 확인 뒤 실행(25 §6).
