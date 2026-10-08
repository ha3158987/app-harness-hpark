---
doc: 25
title: AUTH DELEGATION — 외부 인증서버 위탁 (기본 인증 규약)
category: 기능연동
audience: 개발자
status: active
updated: 2026-10-08
---

# AUTH DELEGATION — 외부 인증서버 위탁 (기본 인증 규약)

**하네스로 만드는 모든 앱의 기본 인증 방식이다.** 서비스가 이미 운영 중인 외부 인증서버에
인증을 위탁하고, 하네스는 자격증명을 **운반만** 한다.

첫 적용은 **팝챗(characterchat) + poptale-auth** 이고, 이후 앱(팝테일 글로벌)은 **config 만 바꿔 같은 경로**를 따른다.

> ✅ **2026-09-03 확정 · 2026-09-11 문서 반영 — 팝챗 앱은 브로커(§3 A′)다.** 앱이 공급자와 직접 OAuth 를
> 돌지 않고(길 B 미사용), 서비스 BE 의 `start` 를 인앱 브라우저로 열어 인증서버가 커스텀 스킴으로 돌려준
> `code` 를 앱 WebView 가 상환한다. 하네스 배선은 `auth.oauthReturnScheme: true` 하나(#34). 신규 앱의
> 기본도 이 형태다. 길 B 는 poptale(국내)·aipia 가 쓴다. §3·§4·§7 은 두 형태를 나눠 적었다.
>
> ✅ **2026-10-07 — 팝테일 V2(`poptale-v2-dev`)도 A′ 브로커다.** 게이트웨이는 poptale-backend(`client=poptale`),
> 앱 복귀는 `com.aipia.poptale.v2.dev://oauth/callback`. 팝챗과 다른 점은 브릿지 엔드포인트가 BE 가 아니라
> **V2 웹의 같은 오리진 BFF** 라는 것 하나다 — §3 "팝테일 V2" 절.

> **IdP 를 자체 구축하는 경로(Keycloak)는 레거시다.** 신규 앱은 쓰지 않는다 — [`10-AUTH.md`](10-AUTH.md).
> 우리가 IdP 를 지으려던 이유는 "IdP 가 없어서" 였는데, 이제 운영 중인 것이 있으므로 지을 이유가 없다.
>
> ✅ **코드 반영은 PR #25 로 끝났다.** `aipiaPreset` 이 소셜 provider 마다 `auth.oauth.<provider>.clientId`
> 자리를 만들어 내보내므로 `new-app` 으로 만든 앱은 clientId 를 넣을 자리가 있다. 자체 IdP 모드
> 제거도 같은 PR 에 담겼다 — 아래 §8 이 그 결과다.

> [`10-AUTH.md`](10-AUTH.md) 의 IdP 설정·Keycloak 체크리스트 절과 레퍼런스 백엔드 `backend/auth-reference` 는
> **2026-09-11 에 삭제했다**(제거된 경로의 문서·코드를 레포에 남기지 않는다). 그 문서의 *공급자별 토큰 교환표*는
> 길 B 앱(poptale)에만 해당한다.
>
> 설계 원본(도식·시퀀스·상태·와이어프레임 포함):
>
> | 문서 | URL |
> |---|---|
> | 하네스 인증 운반 규약 (앱 측) | https://claude.ai/code/artifact/cb140bf5-43a0-4d30-bcf1-0abccc170da6 |
> | 레포별 인증 구현 명세 (작업 목록·도식) | https://claude.ai/code/artifact/e3cf02ac-7a22-47be-9900-37c701cbda0c |
> | 팝챗 가입·로그인 설계 (웹·BE 측) | https://claude.ai/code/artifact/39a8075f-1b1b-4dae-8ced-56ed26af6b49 |

---

## 1. 원칙 두 줄

1. **OS 권한이 필요한 것만 하네스가 갖는다.** 나머지는 웹과 서비스 BE.
2. **하네스는 운반만 하고 해석하지 않는다.** 코드·토큰·플래그를 그대로 실어 나르고 의미 판단은
   웹과 BE 가 한다.

두 번째가 이 문서의 전부다. 서비스 고유 개념이 브릿지에 들어가는 순간 **그 하네스는 그 서비스
전용이 되어 다음 앱이 물려받지 못한다.**

---

## 2. 주체가 넷이다 — 기존 3분할이 성립하지 않는다

```
앱 하네스   OS 권한 (시스템 브라우저 · 딥링크 · Keychain · 생체)
웹          화면 · 문구 · 플로우 · 온보딩
서비스 BE   게이트웨이 · 사용자 DB · 세션쿠키 · 정책 판정
인증서버    공급자 토큰 교환 · 신원 정본 · 토큰 발급    ← 새로 생긴 주체
```

**직접 모드에서 서비스 BE 가 하던 "공급자와 client secret 으로 토큰 교환"이 인증서버로 이동했다.**
그래서 서비스 BE 는 가벼워지고(공급자 N곳 → 인증서버 1곳), 대신 **단일 장애점이 생겼는데 그
운영 통제권은 우리에게 없다.**

**하네스가 할 일은 줄지 않았다.**

---

## 3. 앱이 인증서버에 닿는 경로

| 경로 | 흐름 | 하네스 배선 |
|---|---|---|
| **A · 웹 리다이렉트** | 브라우저 → 서비스 BE `start` → 인증서버 authorize → 공급자 → `returnUrl?code=` → 웹이 상환 | 없음(브라우저 전용) |
| **A′ · 브로커 (앱)** | 앱이 서비스 BE 의 `start?platform=app` 을 **인앱 브라우저**로 열기 → 인증서버 → 공급자 → 인증서버가 `<appId>://oauth/callback?code=` 로 redirect → **앱 WebView 가 `code` 를 서비스 BE 에 상환** | `auth.oauthReturnScheme: true`. `login()` **미사용** |
| **B · 앱 직접 OAuth** | 앱 → **공급자와 직접** OAuth(PKCE) → 딥링크 복귀 → 자격증명을 서비스 BE(`sessionEndpoint`)로 | `login()` · `auth.providers` · `auth.oauth.<p>.clientId` |
| **C · 네이티브 SDK** | 앱 → 공급자 네이티브 SDK → 토큰을 서비스 BE 로 | iOS Apple 만 구현 |

### 어느 앱이 어느 길인가

| 앱 | 경로 | 게이트웨이(인증서버를 부르는 서비스 BE) · `client` | 앱 복귀 주소 | 이유 |
|---|---|---|---|---|
| **팝챗(characterchat·-dev)** | **A′ 브로커** | character-chatbot-api · `popchat` | `com.aipia.characterchat.dev://oauth/callback`(dev) | 앱이 공급자 clientId 를 들면 인증서버 것과 갈릴 때 **같은 사람이 웹·앱 두 계정이 된다** — 코드상 양쪽 다 정상으로 보여 끝까지 안 드러나는 사고다. 2026-09-03 확정. 인증서버가 `returnUrl` 에 커스텀 스킴을 받아 준다(auth 팀 확정) |
| **팝테일 글로벌(poptale-global, 신규)** | **A′ 브로커** | 팝챗 BE 계약 그대로(호스트만 다름) · 미정 | `com.aipia.poptale.global://oauth/callback` | 위와 같음 |
| **팝테일 V2(poptale-v2-dev)** | **A′ 브로커** | **poptale-backend · `poptale`** | **`com.aipia.poptale.v2.dev://oauth/callback`** | 2026-10-07 계약(바다 승인) — 팝챗과 같은 구조. BE 가 유일한 게이트웨이이고 인증서버 토큰은 BE 금고에만 둔다. 레거시 Flutter 앱은 레거시 경로 유지 |
| poptale · poptale-dev · aipia | **B** | 자체 BE | `<appId>://oauth/<p>` | 자체 BE 가 공급자 자격증명을 받는 기존 구조. 변경 없음 |

**신규 앱의 기본은 A′ 다.** 길 B 는 표준 OAuth 라 인증서버에 독립적이지만, 위 계정 분열 위험을 앱 쪽
clientId 관리로 떠안는다. A′ 는 그 위험이 구조적으로 없고, 앱은 복귀 스킴 하나만 등록한다.

### A′ 의 규약 — 앱 · 웹 · 인증서버가 맞춰야 할 것

- **복귀 스킴은 `<appId>://oauth/callback`** — host 는 `oauth` 로 고정한다. 웹이 라우팅 딥링크(https)와
  OAuth 복귀를 **이 host 로 가른다.** 인증서버 `returnUrl` 화이트리스트에 dev(`<appId>.dev://…`)·prod 각각
  등록한다(사람 작업 — `new-app` 스킬이 안내한다).
- **config**: `auth.providers: []` + `auth.oauthReturnScheme: true`. `sessionEndpoint`·`oauth`·`guestEndpoint` 는
  **넣지 않는다**(상환은 웹이 한다). `signupEndpoint`·`logoutEndpoint`·`deleteEndpoint`·`deviceEndpoint`·
  `deviceUnregisterEndpoint` 는 그대로 쓴다 — §7 샘플.
- **인앱 브라우저(②)로 연다**(아래). 상환은 **앱 WebView 가 직접** 한다 — 브라우저에서 상환하면 세션 쿠키가
  브라우저에 구워지고 앱은 로그아웃으로 남는다.
- **하네스는 브로커 로그인 헬퍼를 제공하지 않는다**(결정 2026-09-11). 복귀 대기·취소 판정·상환·결과 판정은
  BE 계약과 얽혀 §1 원칙상 웹 소유다. **참조 구현은 팝챗 웹** `character-chatbot-web/src/lib/harness/adapter.ts`
  의 `awaitOAuthReturn` · `brokeredSignIn` · `isOAuthCallbackUrl` · `redeemOrphanOAuthReturn` · `signInOutcome`
  (+ 같은 폴더 `*.test.ts`)이다. 새 앱은 이 파일을 복사해 BE 경로만 맞춘다 — [`06-INTEGRATION.md`](06-INTEGRATION.md) §3 골격.
- **브릿지 최소 버전은 §6 호환 매트릭스** — 인앱 브라우저·취소 판정은 `1.5.0-beta.2`, `rememberLastLogin` 브로커
  허용은 `1.5.0-beta.4`. 웹은 메서드 존재 여부로 폴백한다(참조 구현이 그렇게 되어 있다).

### 팝테일 V2 — 팝챗과 같은 구조, 엔드포인트만 V2 웹의 같은 오리진 BFF (2026-10-07)

| 항목 | 팝챗 | 팝테일 V2 (`apps/poptale-v2-dev`) |
|---|---|---|
| 웹 | character-chatbot-web (`chat.dev.poptale.ai`) | poptale-web-v2 — Cloud Run `poptale-dev-web` (`https://poptale-dev-web-188609021980.asia-northeast3.run.app`) |
| 게이트웨이 · `client` | character-chatbot-api · `popchat` | poptale-backend · `poptale` (BE 자체 세션은 그대로, 인증서버 토큰은 BE 금고에만) |
| SNS 시작(앱) | BE `start?platform=app` 를 인앱 브라우저로 | BE `GET /api/v2/oauth2/authorization/{p}?redirect=com.aipia.poptale.v2.dev://oauth/callback` 를 인앱 브라우저로 — 웹 플래그 `NEXT_PUBLIC_AUTH_IDP=on` 일 때만. off 면 지금의 `/auth/app-start` 경유(레거시 uuid) 그대로 |
| 상환 | 앱 WebView → BE `POST /auth/social/redeem` | 앱 WebView → V2 BFF(`/api/auth/social/redeem`) → BE `POST /api/v2/user/login/social {userSocialRequestDto:{code}}` |
| 브릿지 엔드포인트 | BE 호스트(`api.chat.dev.poptale.ai`) — 쿠키 Domain `.dev.poptale.ai` 라 같은 사이트 | **V2 웹 같은 오리진** `/api/app/logout` · `/api/app/withdraw` · `/api/app/device` · `/api/app/device/unregister` |
| 세션 쿠키 | BE `cc_session` | V2 BFF `pt_session`(httpOnly, V2 호스트) — BE 는 Bearer 전용이라 BFF 가 바꿔 부른다 |
| `signupEndpoint` | `/auth/signup`(`completeSignup`) | **없음** — V2 는 `completeSignup` 을 안 쓴다(가입은 BFF `/api/auth/signup`). 스토어 게이트는 `deleteEndpoint` 만 본다 |

- 브릿지는 `fetch(endpoint, { credentials:'include' })` 로 부른다 — V2 BFF 는 **Origin 같은 출처 검사**로 CSRF 를 막는다
  (브릿지는 `x-poptale-bff` 헤더를 못 붙인다). 바디는 브릿지 dist 가 보내는 모양 그대로다(`deleteAccount` = `{ deviceId }`,
  기기 등록·해제 = `{ pushToken, deviceId, platform }`, 로그아웃 = 바디 없음).
- 탈퇴는 팝챗과 같은 2단계 — 웹이 `POST /api/app/withdraw/reasons` 로 사유를 먼저 저장하고 `AppBridge.deleteAccount()` 가
  `/api/app/withdraw` 를 부른다. 공용 계정이라 **팝챗 로그인도 함께 끊긴다**(auth 043 D4 — 탈퇴 화면에서 안내).
- 사람 작업: 인증서버 `auth_clients.poptale.allowed_redirect_uris` 와 poptale-backend 복귀 허용 목록에
  `com.aipia.poptale.v2.dev://oauth/callback`(정확 일치) 등록. 남은 외부 작업 전체는 [`21-POPTALE-MIGRATION.md`](21-POPTALE-MIGRATION.md) §10.
- ⚠️ `--local` 로 만든 앱은 엔드포인트가 **배포 호스트를 그대로** 가리킨다 — 로컬 웹의 세션 쿠키가 실리지 않아 브릿지의
  로그아웃·탈퇴·기기 등록 호출은 실패한다(웹 자신의 BFF 로그아웃은 된다). 로컬에서 이 셋까지 보려면 엔드포인트를 로컬
  주소로 바꿔 생성한다(커밋하지 않는다).

### 길 B 가 남아 있는 이유

`login()` 이 만드는 `{ ok, authorizationCode, codeVerifier, redirectUri, state }` 는 표준 OAuth 라 인증서버
규약에 의존하지 않는다 — poptale 처럼 **자체 BE 가 공급자 자격증명을 직접 받는 서비스**에는 이 길이 맞다.
브릿지의 `login()` 반환 필드는 제거·개명하지 않는다(설치본이 쓴다).

### 브라우저는 세 종류다 — ②를 쓴다 (실기기 확인)

앱에서 OAuth 를 어디서 돌리느냐가 **인증서버의 성공/실패를 가른다.**

| | 무엇 | 공급자 정책 | 탭 |
|---|---|---|---|
| ① 앱 화면 (WKWebView) | 앱이 웹을 직접 그리는 것 | 🚫 차단 (`disallowed_useragent`) | — |
| ② **인앱 브라우저** (SFSafariViewController / Chrome Custom Tabs) | 앱 위에 덮이는 일회용 창 | ✅ 허용 | **없다** |
| ③ 공용 브라우저 앱 | 사파리/크롬 본체. 앱이 전환된다 | ✅ 허용 | **남는다** |

**①을 피한다는 이유로 ③을 고르면 안 된다.** ③은 로그인하다 만 공급자 화면이 탭으로
살아남는다. 그런데 인증서버는 `/authorize` 마다 바인딩 쿠키를 덮어쓰므로(poptale-auth
`OAuthWebController` 주석: "오래된 탭은 콜백에서 거부된다") 그 옛 탭에서 뒤늦게 완주하면
**`로그인 요청을 확인할 수 없습니다`** 로 끊긴다. **앱을 재시동하면 진행 중이던 흐름이
닫히지 않고 방치돼 정확히 그 조건이 만들어진다** — 실기기에서 "브라우저 탭을 전부 닫으면
재현 안 됨" 으로 확인했다(2026-09-08).

②는 일회용 창이라 돌아갈 옛 페이지가 없어 이 사고가 **구조적으로** 불가능하다. 쿠키는
공용 브라우저와 공유하므로 공급자 자동 로그인도 유지된다.

> ⚠️ **②로 바꿀 때 취소 판정을 같이 옮겨야 한다.** ②는 앱 위에 덮이는 창이라 앱이
> 백그라운드로 가지 않는다 = `onPause`/`onResume` 이 뜨지 않는다. ③ 시절의 "나갔다
> 돌아왔으면 취소" 판정을 그대로 두면 사용자가 창을 닫아도 신호가 없어 **타임아웃까지
> 스피너가 돈다.** 브릿지의 `onBrowserClosed()` 가 그 신호다.
>
> ⚠️ 브릿지의 **네이티브 OAuth 경로(`_oauth2`, 길 B)는 아직 ③이다.** 같은 노출이 있지만
> 운영 앱(poptale) 로그인이 걸려 있어 실기기 확인 전에는 바꾸지 않는다. A′ 는 웹 참조 구현이 ②를 쓴다.

### C 는 iOS Apple 만 — 그리고 길 B 앱에서만

Apple 네이티브 로그인은 길 B 앱에서 `providers` 에 `apple` 이 있을 때 쓰이고(`applesignin` 엔타이틀먼트
자동 주입) iOS 심사 4.8 상 사실상 의무다. **A′ 브로커 앱은 애플도 웹 경로로 처리하므로 엔타이틀먼트를
선언하지 않는다**(`usesNativeApple` 이 복귀 스킴 판정과 분리돼 있다 — #34). 카카오·네이버 네이티브 SDK 는
**만들지 않는다**(사양서도 2026-09-11 삭제) — "카카오톡 앱으로 점프"는 불가하고 브라우저 로그인만 된다.
UX 기대치를 여기 맞춘다. 다시 필요해지면 그 시점 코드 기준으로 새로 사양을 쓴다.

---

## 4. 웹과의 계약 — 앱 형태마다 다르다

### A′ 브로커 앱 (팝챗 · 팝테일 글로벌) — 팝챗 웹이 실제로 쓰는 표면

```js
AppBridge.onDeepLink(fn)                          // 복귀 `<appId>://oauth/callback?code=|error=` 수신. 라우팅 딥링크와 host('oauth') 로 구분
AppBridge.openExternal(startUrl)                  // ② 인앱 브라우저. { system:true } 는 ③ — onBrowserClosed 가 없는 옛 브릿지 폴백에만
AppBridge.closeInAppBrowser()                     // 복귀·실패·취소 뒤 창 닫기 (1.5.0-beta.2+)
AppBridge.onBrowserClosed(fn)                     // 취소 판정의 유일한 근거 (1.5.0-beta.2+). 없으면 onPause×onResume 폴백
AppBridge.rememberLastLogin(p) / getLastLogin()   // 기록·조회. beta.4+ 는 브로커 앱도 통과 — beta.3 이하는 setPref('last_login_provider', p) 로 직접
AppBridge.completeSignup(body, { reload:false })  // 가입 확정 — 화면 전환은 웹이 한다
AppBridge.logout({ reload:false })                // 기기 토큰 해제 → 시큐어 토큰 삭제 → logoutEndpoint. 웹은 자기 BE 로그아웃도 따로 부른다(설정 유무를 모르므로 — 멱등)
AppBridge.deleteAccount({ reload:false })         // 기기 토큰 해제 → deleteEndpoint({ deviceId }). body 를 못 실으므로 부가 데이터(탈퇴 사유 등)는 웹이 **앞서** 별도 요청
```

**`login()` 은 호출하지 않는다** — 브로커 앱 config 에 `providers` 가 없어 `provider-not-enabled` 를 돌려준다.
상환(`POST /auth/social/redeem`)·이메일 로그인·결과 판정은 전부 웹이 한다. 아래 "pass-through" 절은
**이 형태에 해당하지 않는다**(`completeSignup` 의 예약 이름 `ok`·`backend` 두 개만 본다).

### B 네이티브 OAuth 앱 (poptale · aipia)

```js
AppBridge.login(provider)             // → { ok, reason?, ...BE 응답 — 단 예약 이름은 브릿지가 이긴다 }
AppBridge.completeSignup(body)        // body 를 해석 없이 signupEndpoint 로 POST
AppBridge.rememberLastLogin(provider) // 기록. login() 성공 시 자동 — 그 밖은 웹이 직접
AppBridge.getLastLogin()              // → { provider } | null
AppBridge.logout() / deleteAccount()
```

⚠️ **`getLastLogin()` 의 짝을 빼먹지 마라.** A′ 브로커 앱은 `login()` 을 지나지 않으므로
**자동 기록이 일어나지 않는다.** 이메일도 같다 —
`login('email')` 은 기록 전에 `email-handled-by-web` 으로 빠진다. 웹이
`rememberLastLogin()` 을 부르지 않으면 `getLastLogin()` 이 영원히 `null` 이고,
**오류 없이 "마지막 로그인" 배지만 안 뜬다.** 브라우저에서는 웹이 자체 localStorage 로
처리해 되는 것처럼 보여 **앱에서만 안 되는 버그**로 나타난다(팝챗 실측).

> ⚠️ **`1.5.0-beta.3` 이하의 `rememberLastLogin()` 은 브로커 앱에서 항상 `provider-not-enabled` 다** —
> 게이트가 `auth.providers` 만 봤다. 그래서 팝챗 웹은 같은 키 `last_login_provider` 에 `setPref` 로 직접 쓴다.
> `beta.4` 부터는 `providers` 가 비어 있고 `oauthReturnScheme` 이 true 면 하네스가 아는 10종(`AuthProvider`)을
> 그대로 받는다(그 밖은 `unknown-provider`). 웹은 메서드 결과가 `provider-not-enabled` 면 `setPref` 로 폴백해도 된다.

**보장해야 할 것**

| 계약 | 어기면 |
|---|---|
| 브라우저에서는 `reason:'web-should-redirect'` — 아무것도 하지 않는다 | 웹 개발이 앱 빌드에 묶인다 |
| **미지 필드 pass-through** — BE 응답에서 아는 필드만 골라내지 않고 통째로 올린다 | 가입 토큰이 웹까지 못 와서 완주 불가 |
| 브릿지 소스에 **서비스 고유 이름이 등장하지 않는다** | 하네스가 그 서비스 전용이 된다 |
| 인증 UI 를 그리지 않는다 | 문구 수정 하나에 스토어 재심사 |


### pass-through 는 "전부"가 아니다 — 예약 이름이 있다 (실측)

`_finishLogin` 이 `{ ...data, ...credential, session, user, isNew, needsProfile, backend }` 순서로
합치기 때문에(`template/bridge/dist/index.js:1476-1483`) **`...data` 를 먼저 펼치고 뒤에서
덮어쓴다.** 그래서 다음 이름들은 BE 가 보내도 웹에 그 값으로 도착하지 않는다.

| 티어 | 이름 | 조건 |
|---|---|---|
| 항상 대체됨 | `session` · `backend` | 무조건. `session` 은 HTTP 상태(`res.ok`)일 뿐이다 |
| 자격증명이 이김 | `ok` · `provider` · `authorizationCode` | 양쪽 경로 |
| 자격증명이 이김 | `codeVerifier` · `redirectUri` · `state` | **OAuth 경로에서만** |
| 자격증명이 이김 | `native` · `idToken` | **iOS Apple 네이티브에서만** |
| 이름은 남고 boolean 강제 | `isNew` · `needsProfile` | `!!` 강제. `needsConsent:true` 도 `needsProfile` 을 true 로 만든다 |
| 예약 아님 | `user` | BE 값이 truthy 면 BE 가 이김, falsy 면 자격증명 값 |
| 예약 아님 | `token` · `reason` · `error` · `complete` · `needsConsent` · `signupRequired` | 그대로 통과 |

> ⚠️ **가장 위험한 것은 `idToken` 이다.** BE 가 자기 `idToken` 을 내려주면 **Android 와
> iOS 의 비-Apple 로그인에서는 웹까지 도달하는데, iOS Apple 로그인에서만 Apple 의
> `identityToken` 으로 조용히 대체된다.** 같은 타입, 같은 모양의 JWT, 다른 발급자다 —
> **한 공급자 × 한 플랫폼 조합에서만 깨지므로 테스트를 거의 다 통과한다.** BE 는 이 이름을
> 쓰지 마라.

**`reason` 은 이제 BE 와 공유하는 이름이다.** 브릿지가 쓴 `reason` 은 항상 `ok===false` 또는
`session===false` 와 함께 온다. 따라서 **`ok`·`session` 이 모두 true 인데 `reason` 이 있으면 BE 값**이다.
**역은 성립하지 않는다** — HTTP 4xx/5xx 면 `...data` 가 그대로 펼쳐지므로 `session===false` 에
BE 의 `reason` 이 실릴 수도 있다.

**바디 수준 BE 거절을 알리는 top-level 필드가 없다.** HTTP 200 + `{ok:false, error:'…'}` 는
웹에 `{ok:true, session:true, error:'…'}` 로 도착한다(`ok` 는 자격증명 쪽이 이기고 `session` 은
`res.ok`). 웹은 **`backend.ok` 를 읽어야 한다.** `result.ok` 는 "자격증명 회수 성공" 이지
BE 판정이 아니다.

### pass-through 의 트레이드오프 — 미결

**BE 응답을 통째로 올리면, 나중에 `refreshToken` 같은 민감 필드가 응답에 추가됐을 때 그것도
자동으로 WebView 까지 전달된다.** 웹 레이어에 XSS 나 제3자 스크립트가 있으면 추출될 수 있다.

| 안 | 내용 | 대가 |
|---|---|---|
| A · 금지 패턴 | 이름 패턴(`*token` · `*secret` 등)만 거르고 나머지는 통과 | 해석 없이 사고를 막지만 패턴이 완전하지 않다 |
| B · allow-list | 허용 필드만 전달 | 안전하지만 **하네스가 서비스별 스키마를 알아야 해서 §1 의 원칙이 깨진다** |
| C · 현행 | 통째로 전달 | 민감 필드가 실제로 추가되면 그대로 노출 |

**서비스 BE 의 응답 필드가 확정되기 전이라 지금 고르지 않는다.** §9 의 계약이 나온 뒤 실제
필드를 보고 결정한다.

그때까지의 실질적 완화책은 **BE 가 세션 토큰을 응답 바디에 넣지 않는 것**(쿠키로만 내리는 것)이다.
그러면 이 문제가 애초에 생기지 않는다 — **계약 협의에서 이 점을 먼저 확인한다.**

---

## 5. 하네스에 넣으면 안 되는 것

- **본인인증**(PortOne 등) — 한국 전용. 글로벌 앱엔 없다
- **약관 항목·문구·순서** — 지역 법규 종속
- **가입 토큰의 의미와 수명** — 불투명 문자열로만 다룬다
- **재가입 제한 · 중복가입 판정 · CI** — 서비스 정책
- **세션 정책**(만료·동시 로그인·원격 로그아웃) — 하네스는 의도적으로 안 가진다.
  `deviceId` 라는 **연결고리만** 제공한다
- **브로커 로그인의 상환·결과 판정**(`/auth/social/redeem`, `signupRequired`/`signupToken` 해석, 취소·실패 문구) —
  BE 계약이다. 하네스는 인앱 브라우저·딥링크·닫힘 이벤트라는 **OS 수단만** 준다(결정 2026-09-11, §3 A′)

---

## 6. provider — 같은 누락이 세 곳에 흩어져 있다

하네스가 아는 것은 `email · apple · google · naver · kakao · facebook · x · threads · line · discord`
**10종**이다(`line` · `discord` 는 `H-1` 에서 추가됐다).
provider 를 추가하려면 **세 곳을 동시에** 고쳐야 한다. 하나만 고치면 다른 데서 막힌다.

| 위치 | 무엇 |
|---|---|
| `template/bridge/dist/index.js:45` | `OAUTH_PRESETS` (authorizeUrl · scopes) |
| `template/bridge/dist/index.d.ts:53` | `AuthProvider` union 타입 |
| `scripts/lib/config.mjs:94` | `KNOWN_AUTH_PROVIDERS` |

> **`.d.ts` 를 빼먹으면 웹(TypeScript)에서 `login('line')` 이 컴파일 에러**가 난다. 런타임보다 먼저 막힌다.
>
> **`config.mjs:337` 의 미지 provider 검증은 경고가 아니라 `throw`** 다. 허용목록을 넓히기 전에
> `app.config.json` 의 `providers` 에 새 값을 넣으면 **config 파싱 자체가 예외로 죽는다.**

브릿지에 **빌드 스텝이 없다.** `dist/index.js` 가 곧 편집 대상 소스이고(`src` 디렉터리 없음),
`dist/index.d.ts` 도 손으로 고친다. 변경은 `package.json` version bump + GitHub Packages publish
로만 웹에 닿는다.

### publish 규칙 — 프리릴리즈는 `--tag beta` 다 (실측 함정)

```bash
cd template/bridge
npm publish --tag beta      # 1.5.0-beta.x
npm publish                 # 안정판(1.6.0 등)만 기본 태그(latest)로
```

`npm publish` 의 기본 태그는 `latest` 다. 프리릴리즈를 그냥 올리면 **`latest` 가 안정판에서
베타로 옮겨가고, 이 스코프를 쓰는 다른 앱의 일반 설치(`npm i @aipia-team/harness-bridge`)가
베타로 끌려간다.** 레지스트리를 조회해야만 보이는 규칙이라 실수하기 쉽다 — 올리기 전에 현재
태그를 확인한다.

```bash
npm view @aipia-team/harness-bridge dist-tags
# { beta: '1.5.0-beta.1', latest: '1.4.0' }   ← latest 는 안정판에 둔다
```

**publish 는 되돌릴 수 없다**(같은 버전 재발행 불가). 올리기 전에 `npm test` 통과 +
`npm publish --dry-run` 으로 tarball 내용을 확인하고, 사람 확인을 받는다.

### 브릿지 버전 호환 매트릭스 — 웹이 무엇을 기대할 수 있나

앱 셸은 웹보다 늦게 배포된다. 웹은 아래 표를 보고 **메서드 존재 여부로 폴백**해야 한다(팝챗 참조 구현이 그렇다).

| 버전 | PR | 들어간 것 | A′ 브로커 앱에 미치는 것 |
|---|---|---|---|
| `1.4.0` (`latest`) | — | 인증 없음 | 브로커 로그인 불가 |
| `1.5.0-beta.0` | #27 | `login` · `completeSignup` · `getLastLogin` · `logout` · `deleteAccount` · `line`·`discord` | `completeSignup/logout/deleteAccount` 사용 가능. 딥링크 보류분이 **재생**돼 첫 로그인이 실패하는 결함 있음 |
| `1.5.0-beta.1` | #40 | 딥링크 보류분 1회 배달 + TTL · `onPause` · 로그아웃 정리(기기 토큰 해제·보류 딥링크 폐기) | 첫 시도 실패 교대 현상 해소. 취소 판정은 ③ + `onPause`×`onResume` |
| `1.5.0-beta.2` | #42 | `closeInAppBrowser` · `onBrowserClosed` | **인앱 브라우저(②) 가능.** 없으면 웹은 ③ 폴백 |
| `1.5.0-beta.3` | #45 | `rememberLastLogin` | 브로커 앱에서는 `provider-not-enabled` → `setPref` 우회 필요 |
| `1.5.0-beta.4` | #46 | `rememberLastLogin` 브로커 허용(`unknown-provider` 게이트) · `capabilities.auth` 가 브로커 앱도 true | 우회 제거 가능 |
| `1.5.0-beta.5` | #58 · #60 · #59 | 뷰어 `blockCapture` · `setBrightness` · `getBrightness` + `capabilities.viewer`(#58) · iOS 밝기 라이프사이클(#60 — 네이티브, JS 는 주석만) · **콜드스타트 launch URL 을 WebView 세션당 1회만** · **같은 딥링크 3초 안 재도착은 1회만**(#59) | 전체 이동·새로 고침마다 콜드스타트 OAuth 복귀 `code` 가 다시 흘러 **이미 소비된 code 를 재상환하던 것** 과, launch URL 이 두 길(`appUrlOpen` 보류분 + `getLaunchUrl`)로 와 같은 화면이 두 번 쌓이던 것이 없어진다 |
| `1.5.0-beta.6` | `feat/bridge-store-country` | beta.5 전부 + **스토어 나라** `getStoreCountry()` · `capabilities.storeCountry` — 네이티브 추가(iOS StoreKit storefront → alpha-2 · Android Play Billing `getBillingConfigAsync`, `billing:9.0.0` = cordova-plugin-purchase 13.18.0 과 같은 버전) | 인증 흐름은 그대로. 팝테일 V2 「성인 콘텐츠 보기」가 나라별 확인 방식을 고르는 근거다. **네이티브 메서드라 앱 재빌드가 필요하다** — 그 전 셸에서는 `capabilities.storeCountry === false` 이고 `getStoreCountry()` 는 `null`(던지지 않는다) |

`latest` 태그는 안정판 `1.4.0` 에 둔다(위 publish 규칙). beta.6 은 beta.5 위에 쌓였다 — beta.5 를 건너뛰고 beta.6 만 발행해도
되고, 발행 절차는 아래 beta.5 와 같다. 다른 점은 버전 문자열과 tarball 이 **10파일**이라는 것뿐이다(iOS 에
`StoreCountry.swift` 가 늘었다).

> ⚠️ **beta.5 이전에는 서로 다른 세 내용이 모두 `1.5.0-beta.4` 로 불렸다** — 레지스트리 = `7ee042b`(#46, 팝챗 웹 lockfile
> integrity 로 확정), main = 그 위에 #58·#60(미발행), 팝테일 V2 `vendor/harness-bridge` = PR #59 `5eef54d`(딥링크 가드, #60 주석
> 없음). 버전 문자열로 내용을 판단하지 말고 `dist/` 3파일 sha256 을 대조한다. beta.5 가 셋을 모두 담는다.

### `1.5.0-beta.5` 배포 — 누가 · 무엇으로 · 그다음 (#59 머지 뒤)

**누가**: `@aipia-team/harness-bridge` 패키지에 쓰기 권한이 있는 사람(GitHub Packages, aipia-team 조직). 지금까지 브릿지
버전 상향은 박현아가 했다(beta.4 = `4108dee`). **에이전트는 publish 하지 않는다** — 되돌릴 수 없으므로 사람 확인 뒤에.

**권한**: GitHub **classic PAT** — `write:packages`(+ `read:packages`), aipia-team SSO 승인. 사용자 `~/.npmrc` 에만 둔다
(레포·문서에 토큰을 쓰지 않는다):

```ini
@aipia-team:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

**명령** (`main` 에 #59 가 들어간 뒤, 레포 루트에서):

```bash
git checkout main && git pull
npm test                                             # 전부 통과
cd template/bridge
npm view @aipia-team/harness-bridge dist-tags        # latest 가 1.4.0(안정판)인지 먼저 본다
npm publish --dry-run --tag beta                     # tarball 9파일: dist 3 · android 3 · ios 1 · podspec · package.json
npm publish --tag beta                               # ⚠️ --tag beta 를 빼면 latest 가 베타로 옮겨간다
npm view @aipia-team/harness-bridge dist-tags        # { beta: '1.5.0-beta.5', latest: '1.4.0' }
```

**그다음 — 웹 두 곳을 같은 내용으로 맞춘다** (브릿지 JS 는 웹 번들에 실려 나가므로 **웹 배포만으로** 설치된 앱에 닿는다):

1. **팝챗 웹(character-chatbot-web)** — `npm i @aipia-team/harness-bridge@1.5.0-beta.5`(package.json `^1.5.0-beta.4` →
   `^1.5.0-beta.5`, lockfile 갱신) → PR → Vercel 배포. lockfile 이 beta.4 로 고정돼 있어 범위만으로는 안 올라간다.
   이걸 해야 팝챗 앱에도 콜드스타트 OAuth 복귀 재상환 방지가 들어간다.
2. **팝테일 V2(poptale-web-v2)** — 레지스트리를 쓰지 않는 사본(`vendor/harness-bridge`, `file:` 의존성)이다.
   `npm pack @aipia-team/harness-bridge@1.5.0-beta.5`(또는 하네스 태그 커밋의 `template/bridge`)에서 `dist/` 3파일을 그대로
   덮고, `vendor/harness-bridge/package.json` version 과 `README.md` 의 출처 커밋을 고친다. 확인 = 3파일 sha256 이 하네스
   커밋의 `template/bridge/dist/*` 와 같을 것.

### 무엇이 앱 재빌드를 필요로 하는가 — 브릿지 JS 는 아니다

셸이 원격 웹을 로드하므로(`server.url = startUrl`) **브릿지 JS 는 웹 번들에 실려 나간다.**
그래서 `dist/index.js` 수정은 publish → 웹의 의존성 갱신 → **웹 배포만으로 이미 설치된 앱에
닿는다.** 반면 `app.config.json` 값은 `generate-app` 이 `app-config.json` 으로 구워
**바이너리에 들어가므로**(`Native.getConfig()` 가 번들 파일을 읽는다) 새 빌드·릴리즈가 필요하다.

| 바꾼 것 | 반영 경로 |
|---|---|
| `template/bridge/dist/*` (JS) | publish → 웹 배포 (**앱 재빌드 불필요**) |
| `template/bridge/{ios,android}/*` (네이티브) | 새 앱 빌드·릴리즈 |
| `apps/<slug>/app.config.json` | 새 앱 빌드·릴리즈 |

---

## 7. config — 두 형태

### A′ 브로커 앱 (팝챗 실값 형태 — `apps/characterchat*/app.config.json`)

```jsonc
"auth": {
  "providers": [],                 // 비운다 — 수단 목록은 웹/BE 가 갖는다
  "oauthReturnScheme": true,       // <appId>:// 복귀 스킴만 등록 (#34). providers 와 독립
  // 상환은 웹이 하므로 sessionEndpoint · oauth · guestEndpoint 는 넣지 않는다
  "signupEndpoint":           "https://<api>/auth/signup",
  "logoutEndpoint":           "https://<api>/auth/logout",
  "deleteEndpoint":           "https://<api>/auth/withdraw",       // 스토어 필수 — 브로커 앱에도 게이트가 걸린다
  "deviceEndpoint":           "https://<api>/api/push/register",
  "deviceUnregisterEndpoint": "https://<api>/api/push/unregister"
}
```

`new-app` 스킬은 `aipiaPreset({ slug, appName, authMode: 'broker' })` 로 이 모양을 만든다
(`scripts/lib/config.mjs`). 팝테일 글로벌은 팝챗 BE 계약을 그대로 쓴다(2026-09-11 확정) — 호스트만 바뀐다.
⚠️ 팝챗 prod 호스트 `api.chat.poptale.ai` 는 **미확인 추정치**로 남아 있다(§9).

**팝테일 V2(`apps/poptale-v2-dev`)** 는 같은 모양에서 엔드포인트 4개가 V2 웹의 같은 오리진 BFF 이고 `signupEndpoint` 가
없다(§3 "팝테일 V2" 절):

```jsonc
"auth": {
  "providers": [], "oauthReturnScheme": true,
  "logoutEndpoint":           "https://<V2 웹>/api/app/logout",
  "deleteEndpoint":           "https://<V2 웹>/api/app/withdraw",
  "deviceEndpoint":           "https://<V2 웹>/api/app/device",
  "deviceUnregisterEndpoint": "https://<V2 웹>/api/app/device/unregister"
}
```

### B 네이티브 OAuth 앱 (poptale · aipia)

```jsonc
"auth": {
  "providers": ["email","kakao","naver","line","google","apple","facebook","discord"],

  // 길 B — 공급자 OAuth 를 앱이 직접 돈다. secret 은 넣지 않는다(인증서버가 보유).
  "oauth": {
    "kakao":    { "clientId": "…(REST API 키)" },
    "naver":    { "clientId": "…" },
    "line":     { "clientId": "…" },
    "google":   { "clientId": "….apps.googleusercontent.com" },
    "apple":    { "clientId": "<APPLE_SERVICE_ID>" },   // 앱별 Bundle/Service ID — 복사하지 말 것
    "facebook": { "clientId": "…(앱 ID)" },
    "discord":  { "clientId": "…" }
  },

  // 자격증명을 받는 서비스 BE 엔드포인트
  "sessionEndpoint": "https://<api>/auth/social/native",
  "signupEndpoint":  "https://<api>/auth/signup",
  "logoutEndpoint":  "https://<api>/auth/logout",
  "deleteEndpoint":  "https://<api>/auth/withdraw",
  "deviceEndpoint":  "https://<api>/auth/device"

  // idp 는 넣지 않는다 — §8 참조
}
```

`features` 의 **`deepLink` · `secureStorage` 를 켜야 한다.** 딥링크가 꺼져 있으면 OAuth 복귀
자체가 안 되고, 시큐어 스토리지가 없으면 세션을 기기에 붙들 수 없다.

`biometric` 은 **선택이다** — 앱 잠금·재인증 편의 기능이지 OAuth 플로우가 의존하지 않는다.
쓰지 않는 앱은 켜지 마라(권한·심사 항목만 늘어난다).

---

## 8. `auth.idp` 를 쓰지 않는 이유 — 가장 헷갈리는 지점

**"외부 IdP 에 위탁한다"와 "하네스의 `auth.idp` 블록을 쓴다"는 다른 얘기다.**

하네스의 idp 모드는 **표준 OIDC IdP 전용**이었다 — `_oauth2` 에
`{issuer}/protocol/openid-connect/auth` 라는 **Keycloak 경로가 하드코딩**돼 있었다(#25 에서 제거).
poptale-auth 는 그 규약이 아니다(`/oauth/v1/authorize/{provider}`, `client=`, `returnUrl=`).

따라서 위탁 모드에서는 **`idp` 속성을 아예 넣지 않고 `oauth` 직접 모드를 쓴다.**

> ⚠️ **`idp` 는 이제 빈 객체까지 포함해 "있으면 빌드가 멈춘다".**
> `scripts/lib/config.mjs:296-299` 가 `'idp' in raw.auth` 로 **키의 존재만** 보고
> `err()` 를 던지므로, `idp: {}` 도 `idp: { issuer: … }` 도 똑같이 config 로딩에서 실패한다.
> **릴리즈 빌드 한정이 아니라 모든 빌드**이고, 통과시킬 플래그가 없다.
>
> 예전(#25 이전)에는 `_oauth2` 가 `idp.issuer || idp.authorizeUrl` 로 모드를 판정해서
> **빈 객체가 조용히 직접 모드로 떨어지고 빌드는 성공**했다 — 그게 위험했던 지점이다.
> 지금은 그 누수가 원천적으로 없다.
>
> 즉 `H-4` 가 "빈 객체를 명시적 invalid 로 처리"한 게 아니다. **#25 가 IdP 모드를 통째로
> 제거하면서 `auth.idp` 자체를 금지 키로 만든 것**이다 — `H-4` 는 그 일을 하지 않았다.

### 자체 IdP 모드는 제거됐다 (#25)

`idp/` 디렉터리(Keycloak docker-compose · realm)와 브릿지의 IdP 분기는 2026-05-30 커밋
`a52ba146` "중앙 IdP 모드 지원(패밀리 SSO)" 에서 한 세트로 들어왔다. realm 정의에 identity
provider 가 0개이고 `admin/admin` 하드코딩이라 **데모 수준**이었고, 가리키는 앱은 미출시
`aipia` 하나뿐이었다.

자체 IdP 를 세울 계획이 없으므로 **#25 에서 전부 제거했다** — `_oauth2` 의 IdP 분기(Keycloak
경로 하드코딩 포함), `isIdpMode()`, `DEFAULT_AUTH.idp`, `idp/` 디렉터리. `apps/aipia` 는
`oauth` 스켈레톤으로 옮겼다.

> **잔존 설정은 조용히 무시되지 않는다.** `auth.idp` 가 남아 있으면 `loadConfig` 가 빌드를
> 멈추고 이전 경로를 알려준다. 브릿지가 그냥 무시하면 로그인이 통째로 실패하기 때문이다.

[`10-AUTH.md`](10-AUTH.md) 의 Keycloak 설치 가이드와 `backend/auth-reference`(Keycloak 교환 레퍼런스)는
**2026-09-11 에 삭제했다.** 이 절이 유일한 기록이다.

### SSO 는 어떻게 되나

길 B 는 앱이 공급자와 직접 돌므로 시스템 브라우저에 **인증서버 세션이 생기지 않는다.**
따라서 **IdP 수준 SSO**(앱이 알아서 로그인 상태를 물려받는 것)는 성립하지 않는다.
**계정 공유**(두 서비스가 같은 사람으로 인식)는 된다 — BE 가 인증서버에 물어보면 같은
사용자 식별자가 나온다.

**다만 재로그인 마찰은 크지 않다.** `openExternal({ system: true })` 가 `@capacitor/app-launcher`
로 **실제 Safari·Chrome** 을 열기 때문에(브릿지 `dist/index.js:195-198`) 공급자 세션이 브라우저에
남고, 다른 패밀리 앱이 같은 공급자로 가면 로그인·동의 화면을 건너뛰고 곧장 code 를 받는다.

| | 앱 간 공유 |
|---|---|
| 공급자 세션(카카오·구글 …) | **된다** — 시스템 브라우저 쿠키 |
| 인증서버 마스터 세션 | 안 된다 — 길 B 가 authorize 를 안 거친다 |
| 앱 세션 쿠키 | 안 된다 — WebView 저장소가 앱마다 분리 |
| `getLastLogin()` / `rememberLastLogin()` | 안 된다 — 앱별 저장소 |

**실질 차이는 "입력"이 아니라 "선택"이다.** 앱 B 는 사용자가 어느 수단을 썼는지 모르므로
버튼을 다시 고르게 해야 하고, 고른 뒤는 무마찰이다. 공급자별 세션 수명·재동의 요구는 각 사
정책이므로 **실기기 검증 항목**이다.

> ❓ **길 A 로 전환하면 SSO 가 생기나 — 미확인. 회의에서 물어야 한다.**
> 근거 두 개가 엇갈리고, 로컬 코드로는 판별되지 않는다.
>
> - §8 에 적힌 인증서버 규약 `/oauth/v1/authorize/{provider}?client=&returnUrl=` 는 **브라우저용
>   authorize 로 읽힌다.** 브라우저가 이곳을 지난다면 인증서버 세션 쿠키가 생기고, 패밀리 앱 간
>   진짜 SSO 가 성립한다.
> - 반면 팝테일 웹은 `{API_DOMAIN}/api/v2/oauth2/authorization/{provider}`
>   (`poptale-frontend` `src/hooks/auth/useSnsLogin.ts:49`) 로 **BE 를 먼저 지난다.** 이 BE
>   엔드포인트가 공급자로 바로 보내는지(Spring Security OAuth2 클라이언트의 기본 동작),
>   아니면 인증서버 authorize 로 302 하는지는 팝테일 FE 코드만으로 알 수 없다.
>
> **질문: "브라우저가 인증서버 authorize 를 직접 지나는가, 그때 인증서버 세션 쿠키가 설정되는가."**
> 지난다면 SSO 는 길 A 전환으로 얻을 수 있고, 아니라면 IdP 신설이 유일한 답이다.
> 다만 **되돌릴 자산은 남아 있지 않다** — `idp/` 디렉터리와 브릿지 IdP 분기는 #25 에서 삭제됐으므로
> 그 경우엔 처음부터 다시 짜야 한다(그리고 지금 그럴 계획은 없다).
>
> **어느 쪽이든 길 B(현재 주경로)에서 IdP 수준 SSO 가 없다는 것은 확정이다.** 위 표가 그 범위다.

---

## 9. 팝챗 적용 — 작업 목록

`H-1` 을 반드시 `H-5` 보다 먼저 한다(§6 의 `throw` 때문).

| # | 상태 | 항목 |
|---|---|---|
| `H-1` | ✅ | `line` · `discord` 추가 — **프리셋 · `.d.ts` 타입 · 허용목록 세 곳 동시에** |
| `H-2` | ✅ | 미완료 신호에 서비스가 쓰는 필드명 추가(`_finishLogin`) |
| `H-3` | ✅ | 응답 pass-through — 미지 필드를 버리지 않는다 |
| `H-4` | ✅ | config 검증 강화 — 프리셋·`authorizeUrl` 둘 다 없는 provider 탐지, 스토어 요건을 릴리즈 빌드에서 `exit 1` 로 |
| `H-5` | ✅ | `apps/characterchat*/app.config.json` — `auth` 블록 신설 + features 3개 활성. **dev 슬러그 먼저** → **#34 에서 브로커 형태로 전환**(providers 비움 · oauth·sessionEndpoint 제거 · `oauthReturnScheme`) |
| `H-6` | ✅ | `broker` 모드 — **#34 `auth.oauthReturnScheme`(2026-09-04).** 팝챗이 이 모드로 확정. 복귀 방식은 커스텀 스킴 하나(인증서버가 `returnUrl` 로 받아 줌) — universal-link/web-bounce 는 필요 없어져 만들지 않았다 |
| `H-7` | ✅ | 문서 갱신 — [`10-AUTH.md`](10-AUTH.md) 에 세 경로 병렬 기술 |

### 구현이 설계와 달라진 점 — 실제로 들어간 것

- **`H-3` pass-through 는 `backend: data` 를 유지한 채** top-level 스프레드를 추가한 형태다.
  기존 소비자가 `result.backend` 를 읽고 있어 하위호환을 깼을 수 없다. 두 자리에 같은 값이 있다.
  예약 이름 때문에 "전부"가 아니라는 점은 **§4 를 반드시 함께 읽어라.**
- **`H-4` 스토어 요건 게이트는 `--release` 플래그로만 발동한다.** 플래그가 없으면 같은 항목이
  경고로만 나온다(§10).
- **`H-4` 에서 `idp: {}` 처리는 하지 않았다.** #25 가 IdP 모드를 제거하면서 `auth.idp` 키 자체를
  모든 빌드에서 금지했기 때문에 할 일이 남아 있지 않았다 — §8 참조.
- **`H-4` 가 설계에 없던 검사 두 개를 더 얻었다.** ① `--local` 과 `--release` 동시 사용 거부
  (`--local` 은 cleartext+ATS 예외라 스토어 제출 금지) ② Android 빌드의 `apple` clientId 검사
  (Android 는 `apple` 을 web OAuth 로 타므로 Services ID 가 필요하다).
- **`H-4` 의 `authorizeUrl` 부재 검사는 현재 도달 불가다.** `KNOWN_AUTH_PROVIDERS` 가 프리셋 밖
  provider 를 config 로딩 단계에서 먼저 거부하므로, 그 상태의 config 를 애초에 만들 수 없다.
  허용목록을 넓힐 때 바로 동작하는 **선제 방어**로 남겨 뒀다.
- ⚠️ **`H-1` 의 `line` · `discord` `authorizeUrl` · `scopes` 는 각 사 공개 문서 기준값이고
  auth 콘솔과 대조하지 않았다 — 미확인.** `template/bridge/dist/index.js` 에 `TODO(G0-4)` 로
  표시돼 있다. 콘솔 등록값과 다르면 런타임에 공급자가 거절한다.
- ⚠️ **`H-5` 의 `apps/characterchat*` prod API 호스트(`api.chat.poptale.ai`)와 엔드포인트 경로는
  미확인 추정치다.** 레포에 근거가 없고, 형제 앱 `poptale` 은 다른 형태
  (`dev.api.poptale.ai` → `api.poptale.ai`)를 쓴다. **사람이 확인해야 한다.**
- **`H-5` dev 슬러그의 `deviceEndpoint` 는 기존 `/api/push/register` 를 유지했다** — 계획 샘플의
  `/auth/device` 는 오기였다. §7 의 샘플은 일반형이므로 실제 앱 config 와 다르다.
- **`H-6` 브로커 전환 뒤 `characterchat` 은 clientId 게이트를 타지 않는다** — `providers` 가 비어 있어
  `authSetup` 이 clientId·Apple 4.8 을 검사하지 않고, 탈퇴 게이트만 남는다(`test/oauth-return-scheme.test.mjs`).
  종전의 "clientId 전부 null 이라 릴리즈가 막힌다" 는 길 B 시절 얘기다.

### 인증서버·BE 팀에 확인할 것 (2026-09-11 갱신)

1. ✅ 앱 경로는 **브로커로 확정**됐다(§3 A′). 대신 서비스 BE 의 `POST /auth/social/native`(앱 자격증명 중계)는
   앱이 더 이상 부르지 않는다 — 존치 여부는 BE 팀이 정한다(팝챗 웹 `be-auth-contract.md` §3 참조)
2. ~~앱 clientId 가 인증서버 것과 같은가~~ → **해당 없음.** 브로커 앱은 clientId 를 들지 않는다 — 그게 전환 이유다.
   길 B 앱(poptale)에는 여전히 유효
3. ✅ 인증서버 `returnUrl` 화이트리스트에 **커스텀 스킴**(`<appId>://oauth/callback`, dev·prod 각각)을 받아
   준다(auth 팀 확정). 새 앱마다 등록 요청이 필요하다 — `new-app` 스킬이 안내
4. 새로 추가할 provider 의 **등록된 scope 값**(길 B 앱만)
5. 상환 응답의 provider 식별자 **대소문자** — 서비스 DB 의 unique 제약과 어긋나면 계정이 갈린다
6. (길 B 앱만) **세션 응답이 §4 의 예약 이름을 쓰지 않는지** — 특히 `idToken` · `session` · `backend` ·
   `ok` · `provider` · `authorizationCode` · `codeVerifier` · `redirectUri` · `state` · `native`.
   쓰면 웹에 그 값이 도착하지 않는다(플랫폼·공급자별로 다르게 깨져서 더 찾기 어렵다).
   그리고 `isNew` · `needsProfile` 은 **문자열·숫자가 아니라 진짜 boolean** 으로 보내야 한다 —
   브릿지가 `!!` 로 강제하므로 `"false"` 는 true 가 된다

---

## 10. 스토어 요건 — 릴리즈 빌드에서는 막는다

`generate-app.mjs` 의 `authSetup()` 이 규칙을 판정하고, **경고로 낼지 중단으로 낼지는 `main()`
이 `--release` 플래그로 정한다.** 규칙은 한 곳(`storeBlockers`)에만 있고 정책만 갈린다.

| 검사 | 내용 | dev 빌드 | `--release` |
|---|---|---|---|
| Apple 4.8 | 제3자 소셜을 제공하면 `apple` 도 `providers` 에 있어야 한다 | 경고 | **`exit 1`** |
| 계정 삭제 | `providers` 가 있으면 `auth.deleteEndpoint` 필수 | 경고 | **`exit 1`** |
| clientId | 소셜 provider 마다 `auth.oauth.<p>.clientId` 필수 | 경고 | **`exit 1`** |

- **게이트는 `--release` 없이는 발동하지 않는다.** dev 빌드는 예전처럼 경고로 통과한다 —
  기존 앱들이 즉시 빨간불이 되면 안 되기 때문이다.
- `.github/workflows/release.yml` 이 **Android · iOS generate 스텝 양쪽에 `--release` 를 넘긴다.**
  이게 없으면 게이트가 CI 에서 한 번도 동작하지 않는다.
- **`--local` 과 `--release` 는 함께 쓸 수 없다** — `--local` 은 cleartext+ATS 예외를 넣는
  dev 전용 모드라 스토어 제출용 빌드가 될 수 없다. 동시 지정 시 즉시 실패한다.
- **`apple` 도 clientId 검사 대상이다** — 단 `--platform ios` 일 때만 면제된다.
  iOS 는 네이티브 Sign in with Apple 에 appId 폴백이 있지만 **Android 는 `apple` 을 web OAuth 로
  타므로 Services ID(clientId)가 없으면 런타임 `oauth-misconfigured`** 다.
- `auth.providers` 가 비어 있는 앱(웹 레이어에서만 로그인)은 계정 삭제·clientId 게이트를
  **그냥 통과한다.** 스토어 요건은 그래도 적용되므로 게이트가 완전하다고 오해하지 마라.
- `doctor.mjs` 는 여전히 **경고만** 낸다(읽기 전용 점검이므로 의도된 것이다). 막는 쪽은
  `generate-app.mjs` 다.
