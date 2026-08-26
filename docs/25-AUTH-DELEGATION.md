---
doc: 25
title: AUTH DELEGATION — 외부 인증서버 위탁 (기본 인증 규약)
category: 기능연동
audience: 개발자
status: active
updated: 2026-08-25
---

# AUTH DELEGATION — 외부 인증서버 위탁 (기본 인증 규약)

**하네스로 만드는 모든 앱의 기본 인증 방식이다.** 서비스가 이미 운영 중인 외부 인증서버에
인증을 위탁하고, 하네스는 자격증명을 **운반만** 한다.

첫 적용은 **팝챗(characterchat) + poptale-auth** 이고, 이후 앱은 **config 만 바꿔 같은 경로**를 따른다.
앱 코드는 표준 OAuth 라 인증서버가 무엇이든 동일하다.

> **IdP 를 자체 구축하는 경로(Keycloak)는 레거시다.** 신규 앱은 쓰지 않는다 — [`10-AUTH.md`](10-AUTH.md).
> 우리가 IdP 를 지으려던 이유는 "IdP 가 없어서" 였는데, 이제 운영 중인 것이 있으므로 지을 이유가 없다.
>
> ⚠️ **코드 반영은 별도 PR(#25)** — `aipiaPreset` 이 `oauth` 블록을 내보내지 않아 **`new-app` 으로 만든
> 앱은 clientId 를 넣을 자리가 없다.** #25 가 머지되기 전에는 `auth.oauth` 를 손으로 추가해야 한다.
> #25 는 자체 IdP 모드 제거도 함께 담는다 — 아래 §8 은 그 PR 을 전제로 쓰였다.

> [`10-AUTH.md`](10-AUTH.md) 는 **하네스가 IdP 를 직접 세우는 경우**(Keycloak)를 다룬다.
> 위탁 모드에서는 그 문서의 *공급자별 토큰 교환표*와 *Keycloak 설치 가이드*가 **해당하지 않는다.**
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

## 3. 앱이 인증서버에 닿는 세 가지 경로

| 경로 | 흐름 | 하네스 변경 |
|---|---|---|
| **A · 웹 리다이렉트** | 브라우저 → 인증서버 authorize → 공급자 → `returnUrl?code=` | 없음(웹 전용) |
| **B · 앱 직접 OAuth** | 앱 → **공급자와 직접** OAuth → 딥링크 복귀 → 자격증명을 서비스 BE 로 | **기존 `login()` 그대로** |
| **C · 네이티브 SDK** | 앱 → 공급자 네이티브 SDK → 토큰을 서비스 BE 로 | Apple 은 이미 구현됨 |

### 주경로는 B 다

`login()` 이 만드는 `{ ok, authorizationCode, codeVerifier, redirectUri, state }` 가
**길 B 가 필요로 하는 형태 그대로**다. 표준 OAuth 라 인증서버 규약에 의존하지 않으므로,
**인증서버가 바뀌어도 앱 코드가 같다** — 바뀌는 건 자격증명을 받는 BE 엔드포인트 하나뿐이다.
범용 상속 관점에서 A 보다 우월하다.

### C 는 iOS Apple 만

Apple 네이티브 로그인은 이미 구현돼 있고(`applesignin` 엔타이틀먼트 자동 주입 포함) iOS 심사
4.8 상 사실상 의무다. 카카오·네이버 네이티브 SDK 는 **레포에 사양서만 있고 구현이 없다** —
"카카오톡 앱으로 점프"는 현재 불가하고 시스템 브라우저 로그인만 된다. UX 기대치를 여기 맞춘다.

### A 를 앱에서 쓰려면 — 지금은 하지 않는다

인증서버의 `returnUrl` 은 open redirect 방지를 위한 화이트리스트 대상이라 커스텀 스킴을
받지 못할 수 있다. 그 경우 복귀 방식 세 가지(`scheme` / `universal-link` / `web-bounce`)를
config 로 고르는 `broker` 모드가 필요해진다. **길 B 가 막혔다는 확인이 오기 전에는 착수하지 않는다.**

---

## 4. 웹과의 계약 — 이 네 개가 전부다

```js
AppBridge.login(provider)      // → { ok, reason?, ...서비스 BE 응답 전부 }
AppBridge.completeSignup(body) // body 를 해석 없이 signupEndpoint 로 POST
AppBridge.getLastLogin()       // → { provider } | null
AppBridge.logout() / deleteAccount()
```

**보장해야 할 것**

| 계약 | 어기면 |
|---|---|
| 브라우저에서는 `reason:'web-should-redirect'` — 아무것도 하지 않는다 | 웹 개발이 앱 빌드에 묶인다 |
| **미지 필드 pass-through** — BE 응답에서 아는 필드만 골라내지 않고 통째로 올린다 | 가입 토큰이 웹까지 못 와서 완주 불가 |
| 브릿지 소스에 **서비스 고유 이름이 등장하지 않는다** | 하네스가 그 서비스 전용이 된다 |
| 인증 UI 를 그리지 않는다 | 문구 수정 하나에 스토어 재심사 |


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

---

## 6. provider — 같은 누락이 세 곳에 흩어져 있다

하네스가 아는 것은 `email · apple · google · naver · kakao · facebook · x · threads` 8종이다.
provider 를 추가하려면 **세 곳을 동시에** 고쳐야 한다. 하나만 고치면 다른 데서 막힌다.

| 위치 | 무엇 |
|---|---|
| `template/bridge/dist/index.js:40` | `OAUTH_PRESETS` (authorizeUrl · scopes) |
| `template/bridge/dist/index.d.ts:53` | `AuthProvider` union 타입 |
| `scripts/lib/config.mjs:80` | `KNOWN_AUTH_PROVIDERS` |

> **`.d.ts` 를 빼먹으면 웹(TypeScript)에서 `login('line')` 이 컴파일 에러**가 난다. 런타임보다 먼저 막힌다.
>
> **`config.mjs:300` 의 미지 provider 검증은 경고가 아니라 `throw`** 다. 허용목록을 넓히기 전에
> `app.config.json` 의 `providers` 에 새 값을 넣으면 **config 파싱 자체가 예외로 죽는다.**

브릿지에 **빌드 스텝이 없다.** `dist/index.js` 가 곧 편집 대상 소스이고(`src` 디렉터리 없음),
`dist/index.d.ts` 도 손으로 고친다. 변경은 `package.json` version bump + GitHub Packages publish
로만 웹에 닿는다.

---

## 7. config — 위탁 모드에서는 `oauth` 직접 모드를 쓴다

```jsonc
"auth": {
  // 아래는 팝챗 기준. line·discord 는 H-1 완료 후에만 넣을 수 있다(§6 의 throw).
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

하네스의 idp 모드는 **표준 OIDC IdP 전용**이다. `dist/index.js:1267` 에
`{issuer}/protocol/openid-connect/auth` 라는 **Keycloak 경로가 하드코딩**돼 있다.
poptale-auth 는 그 규약이 아니다(`/oauth/v1/authorize/{provider}`, `client=`, `returnUrl=`).

따라서 위탁 모드에서는 **`idp` 속성을 아예 넣지 않고 `oauth` 직접 모드를 쓴다.**
**"비운다"가 아니라 "속성을 삭제한다"** 다 — 이 구분이 실제로 사고를 만든다.

> ⚠️ **`idp: {}` 빈 객체는 "미설정" 이 아니다.** `_oauth2` 는 `idp.issuer || idp.authorizeUrl` 로 모드를 판정하므로
> 빈 객체는 조용히 직접 모드로 떨어지고, clientId 가 없으면 런타임에 실패한다 — **빌드는 성공한다.**
> `apps/poptale/app.config.json` 이 지금 그 상태다.
>
> `H-4` 에서 **빈 객체를 명시적 invalid 로 처리**해 릴리즈 빌드에서 `exit 1` 로 막는다.

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

[`10-AUTH.md`](10-AUTH.md) 의 Keycloak 설치 가이드는 **배경 기록으로만 남긴다** — 따라 하면
안 된다(상단 배너 참조).

### SSO 는 어떻게 되나

길 B 는 앱이 공급자와 직접 돌므로 시스템 브라우저에 **인증서버 세션이 생기지 않는다.**
따라서 **IdP 수준 SSO**(앱이 알아서 로그인 상태를 물려받는 것)는 성립하지 않는다.
**계정 공유**(두 서비스가 같은 사람으로 인식)는 된다 — BE 가 인증서버에 물어보면 같은
사용자 식별자가 나온다.

**다만 재로그인 마찰은 크지 않다.** `openExternal({ system: true })` 가 `@capacitor/app-launcher`
로 **실제 Safari·Chrome** 을 열기 때문에(브릿지 `dist/index.js:191`) 공급자 세션이 브라우저에
남고, 다른 패밀리 앱이 같은 공급자로 가면 로그인·동의 화면을 건너뛰고 곧장 code 를 받는다.

| | 앱 간 공유 |
|---|---|
| 공급자 세션(카카오·구글 …) | **된다** — 시스템 브라우저 쿠키 |
| 인증서버 마스터 세션 | 안 된다 — 길 B 가 authorize 를 안 거친다 |
| 앱 세션 쿠키 | 안 된다 — WebView 저장소가 앱마다 분리 |
| `getLastLogin()` | 안 된다 — 앱별 저장소 |

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
> 지난다면 SSO 는 길 A 전환으로 얻을 수 있고, 아니라면 IdP 신설이 유일한 답이며 그때가 §8 의
> `idp/` 자산이 의미를 갖는 유일한 경우다.
>
> **어느 쪽이든 길 B(현재 주경로)에서 IdP 수준 SSO 가 없다는 것은 확정이다.** 위 표가 그 범위다.

---

## 9. 팝챗 적용 — 작업 목록

`H-1` 을 반드시 `H-5` 보다 먼저 한다(§6 의 `throw` 때문).

| # | 항목 |
|---|---|
| `H-1` | `line` · `discord` 추가 — **프리셋 · `.d.ts` 타입 · 허용목록 세 곳 동시에** |
| `H-2` | 미완료 신호에 서비스가 쓰는 필드명 추가(`_finishLogin`) |
| `H-3` | 응답 pass-through — 미지 필드를 버리지 않는다 |
| `H-4` | config 검증 강화 — **`idp: {}` 를 명시적 invalid 로**(빈 객체 모드 누수 차단), 프리셋·`authorizeUrl` 둘 다 없는 provider 탐지, 스토어 요건을 릴리즈 빌드에서 `exit 1` 로 |
| `H-5` | `apps/characterchat*/app.config.json` — `auth` 블록 신설 + features 3개 활성. **dev 슬러그 먼저** |
| `H-6` | `broker` 모드 — **조건부. 지금 하지 않는다**(§3) |
| `H-7` | 문서 갱신 — [`10-AUTH.md`](10-AUTH.md) 에 세 모드 병렬 기술 |

### 인증서버 팀에 확인할 것

1. 앱이 공급자와 직접 돈 자격증명을 받는 BE 경로가 존속하는가 → `H-6` 착수 여부
2. 앱이 쓸 공급자 clientId 가 인증서버가 쓰는 것과 **같은가** — provider 각각.
   갈리면 같은 사람이 웹·앱에서 다른 계정이 된다
3. 각 공급자 콘솔에 **커스텀 스킴 redirect URI** 를 등록해줄 수 있는가
4. 새로 추가할 provider 의 **등록된 scope 값**
5. 상환 응답의 provider 식별자 **대소문자** — 서비스 DB 의 unique 제약과 어긋나면 계정이 갈린다

---

## 10. 스토어 요건 — 경고만 하고 막지 못한다

`generate-app.mjs` 와 `doctor.mjs` 가 Apple 4.8(소셜 제공 시 Sign in with Apple 의무)과
계정 삭제 경로를 검사하지만 **둘 다 경고이고 `process.exit` 가 없다.** 빌드는 그대로 진행된다.

`H-4` 에서 **릴리즈 빌드에 한해 `exit 1`** 로 승격한다. dev 빌드는 경고로 통과시키는 예외 규칙을
둔다 — 기존 앱들이 즉시 빨간불이 되면 안 된다.
