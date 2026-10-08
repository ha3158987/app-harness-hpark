---
name: new-app
description: 하네스에 새 웹 서비스를 앱으로 추가한다. apps/<slug>/app.config.json 과 에셋 자리를 스캐폴딩한다. 사용자가 "새 앱/서비스 추가", "OO 앱 만들어줘", "OO를 앱으로", "새 서비스 등록" 같은 요청을 하면 반드시 이 스킬을 사용해라. 빌드 요청이 함께 와도 먼저 이 스킬로 정의부터 만든다.
---

# new-app

새 서비스 1개를 하네스 `apps/` 에 등록한다. **코드 생성이 아니라 정의(config) 생성**이다.

## 입력으로 확보할 것
사용자에게 없으면 물어본다 (한 번에 하나씩):
- `slug` (영소문자/하이픈, 디렉터리명)
- `appName`, `appId` (역도메인 형식, 예 `com.yourco.servicea`)
- `startUrl`
- 켤 기능 (push / deepLink / deferredDeepLink / biometric ...)
- **인증 모드** (`docs/25-AUTH-DELEGATION.md` §3) — 둘 중 하나. 모르면 **`broker`** 를 권한다:
  - `broker` — 팝챗형. 앱은 복귀 스킴만 등록하고 공급자 OAuth 는 서비스 BE → 인증서버가 돈다.
    `auth.providers` 는 비우고 `auth.oauthReturnScheme: true`. clientId 를 앱이 들지 않는다.
  - `native` — poptale형. 앱이 공급자와 직접 OAuth. `auth.providers` + `auth.oauth.<p>.clientId`.

## 절차
1. `docs/02-GUIDE.md` §6 의 `app.config.json` 스키마(정본)를 기준으로 삼는다.
2. 시작 보일러플레이트는 `scripts/lib/config.mjs` 의 `aipiaPreset` 으로 뽑는다 — 인증 블록을 손으로
   조립하지 마라(브로커 앱에 `sessionEndpoint`·`oauth` 를 남기면 쓰지도 않는 clientId 누락이 릴리즈를 막는다):
   ```bash
   node -e "import('./scripts/lib/config.mjs').then(m => console.log(JSON.stringify(m.aipiaPreset({ slug: '<slug>', appName: '<이름>', authMode: 'broker' }), null, 2)))"
   ```
   그 출력에서 `appId`·`startUrl`·엔드포인트 호스트 등 사용자가 준 값으로 덮어쓴다.
3. `apps/<slug>/` 생성, `app.config.json` 작성. 기능은 사용자가 명시 안 한 건 안전한 기본값
   (`push:false`, `deepLink:false` 등)으로 두고, 어떤 값으로 채웠는지 사용자에게 요약 보고.
   **단 `broker` 면 `deepLink` 는 반드시 `true`** — 복귀 스킴이 딥링크다. `secureStorage` 는 브릿지가
   `login`·`guestLogin`·`completeSignup` 응답의 `token` 을 보관하는 자리라, 그 셋을 안 쓰고 세션을 httpOnly 쿠키로만
   내리는 웹(팝테일 V2)은 꺼도 된다(프리셋 기본은 `true`).
   `deepLink` 를 켜면 `navigation.appLinkDomains` 에 **앱 링크 호스트를 명시**한다 — `.well-known` 을 서빙할 웹 호스트만,
   와일드카드 없이(프리셋의 `**.<slug>.ai` 는 WebView 이동 허용용이다). 키를 빼면 `allowedDomains` 전체가 앱 링크가 되어
   다른 앱과 링크를 다툰다 — `docs/02-GUIDE.md` §6.
4. `apps/<slug>/icon.png`, `splash.png` 자리 안내. 없으면 사용자에게 1024² 아이콘 /
   2732² 스플래시 소스를 요청 (placeholder를 만들지 말 것 — 사용자 제공 전까지 비워둔다).
5. `appId` 중복 여부를 `apps/*/app.config.json` 전체에서 확인.
6. `broker` 면 사람 작업을 함께 안내한다 — 인증서버(poptale-auth) `returnUrl` 화이트리스트에
   `<appId>://oauth/callback` (dev 는 `<appId>.dev://oauth/callback`) 등록 요청. 이게 없으면 앱 로그인 복귀가 안 된다.

## 출력
- `apps/<slug>/app.config.json`
- 채운 값 + 누락된 에셋 목록을 사용자에게 요약

## 하지 말 것
- Capacitor 프로젝트를 여기서 생성하지 않는다 (그건 build-* 스킬의 generate-app 단계).
- 서명/스토어 자격증명을 config에 넣지 않는다.
