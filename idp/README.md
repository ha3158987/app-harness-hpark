# 중앙 IdP (Keycloak) — 로컬 구동 + 소셜 연결 가이드

패밀리 SSO 의 "신분증 발급소". 로컬에서 한번 띄워 개념을 눈으로 확인하고, 그대로 운영
(`auth.aipia.co.kr`)으로 옮기면 된다. 하네스 연동은 `../AUTH.md` §5 참조.

---

## 1. 띄우기

```bash
docker compose -f idp/docker-compose.yml up
```
- 어드민 콘솔: <http://localhost:8080>  (admin / admin)
- 첫 기동 시 `realm-aipia.json` 자동 import → realm **aipia** + 앱 클라이언트 2개 생성됨.
- 끄기: `Ctrl-C`, 데이터까지 삭제: `docker compose -f idp/docker-compose.yml down -v`

> realm/client 설정을 바꾸면 어드민에서 하고, 영구화하려면 export 해서 `realm-aipia.json` 갱신.

---

## 2. 구조 (한눈에)

```
realm: aipia                         ← 패밀리 공용 사용자 풀(여기 한 곳에 회원이 쌓임 = SSO 핵심)
├── clients (앱마다 1개)
│   ├── aipia-novel-app   redirect: kr.co.aipia.app://oauth/*
│   └── aipia-game-app    redirect: kr.co.aipia.game://oauth/*
└── identity providers (소셜 — 여기 한 번만 등록)
    ├── google / facebook / twitter   (Keycloak 기본 제공)
    ├── kakao                          (OIDC — discovery 로 추가, 확장 불필요)
    ├── apple                          (확장 또는 iOS 네이티브로 우회)
    ├── naver                          (확장 필요 — OIDC 아님)
    └── threads                        (커스텀 OAuth2 / 확장)
```

신규 패밀리 앱 = **client 1개 추가**가 전부(소셜은 이미 realm 에 있음). 하네스 config 는
`auth.idp.clientId` 만 그 client 로 바꿔 복붙(`../AUTH.md` §5 템플릿).

---

## 3. 소셜 연결 (Identity Providers)

어드민 → realm `aipia` → **Identity providers** → Add. **각 공급자 콘솔의 redirect 에 Keycloak
브로커 콜백을 등록**해야 한다(공통):
```
https://auth.aipia.co.kr/realms/aipia/broker/<alias>/endpoint
# 로컬 테스트: http://localhost:8080/realms/aipia/broker/<alias>/endpoint
```
`<alias>` 는 하네스 config 의 `idp.hints` 값과 **반드시 일치**시킨다(예: kakao, naver, google …).

| 공급자 | Keycloak 추가 방법 | alias | 비고 |
|---|---|---|---|
| **Google** | 기본 제공("Google") | `google` | clientId/secret 입력 |
| **Facebook** | 기본 제공("Facebook") | `facebook` | clientId/secret |
| **X(Twitter)** | 기본 제공("Twitter") | `twitter` | hints 에서 x→twitter 매핑 |
| **Kakao** | "OpenID Connect v1.0" + discovery | `kakao` | discovery: `https://kauth.kakao.com/.well-known/openid-configuration` (확장 불필요) |
| **Naver** | 커뮤니티 확장(jar) 또는 커스텀 OAuth2 | `naver` | 네이버는 OIDC 아님 → 확장 권장 |
| **Apple** | 확장(예: apple-identity-provider) | `apple` | client_secret 이 ES256 JWT(만료) 라 확장 필요. **또는 iOS 는 하네스 네이티브로 우회** |
| **Threads** | 커스텀 OAuth2 / 확장 | `threads` | 신규 API |

> **확장(jar) 설치**: Keycloak 26 은 `/opt/keycloak/providers/*.jar` 에 두고 빌드. docker-compose 에
> `./providers:/opt/keycloak/providers` 볼륨을 추가하고 `command` 를 `start-dev --import-realm` 앞에
> `build` 단계가 필요할 수 있다(확장별 README 따름).

### 한국 소셜 엔드포인트 메모 (커스텀 OAuth2 입력값)
```
# Kakao (OIDC 권장)
authorize  https://kauth.kakao.com/oauth/authorize
token      https://kauth.kakao.com/oauth/token
userinfo   https://kapi.kakao.com/v2/user/me   (OIDC userinfo: https://kapi.kakao.com/v1/oidc/userinfo)

# Naver (OAuth2)
authorize  https://nid.naver.com/oauth2.0/authorize
token      https://nid.naver.com/oauth2.0/token
userinfo   https://openapi.naver.com/v1/nid/me
```

---

## 4. 흐름 확인 (로컬)

1. 어드민에서 소셜 1개라도 추가(예: Google 테스트 clientId).
2. realm `aipia` → Users 로 가입/로그인 동작 확인, 또는 account console:
   <http://localhost:8080/realms/aipia/account>
3. 앱 클라이언트 authorize URL 을 직접 때려 동작 확인:
```
http://localhost:8080/realms/aipia/protocol/openid-connect/auth
  ?client_id=aipia-novel-app&response_type=code
  &redirect_uri=http://localhost:8100/callback&scope=openid%20email%20profile
  &kc_idp_hint=google
```
→ `kc_idp_hint=google` 이면 곧장 구글로 점프(= 하네스 `login('google')` 이 하는 것).

---

## 5. 하네스 연결

`apps/<slug>/app.config.json` 의 `auth.idp` 를 이 IdP 로 향하게 한다(`../AUTH.md` §5 템플릿):
```jsonc
"idp": {
  "issuer": "http://localhost:8080/realms/aipia",   // 운영: https://auth.aipia.co.kr/realms/aipia
  "clientId": "aipia-novel-app",
  "hintParam": "kc_idp_hint",
  "hints": { "google":"google","kakao":"kakao","naver":"naver","apple":"apple",
             "facebook":"facebook","x":"twitter","threads":"threads" }
}
```
그러면 앱의 `AppBridge.login('kakao')` → IdP authorize + `kc_idp_hint=kakao` → 카카오 → IdP 세션 →
앱 복귀(code) → 백엔드가 IdP 와 교환(`../AUTH.md` §5 "백엔드 단순화").

---

## 6. 로컬 → 운영 옮길 때 체크
- `start-dev` → `start`, `KC_HOSTNAME=auth.aipia.co.kr`, HTTPS 인증서, reverse proxy(`KC_PROXY_HEADERS`).
- 어드민 비번 강하게, DB 영속/백업, realm export 버전관리.
- 소셜 clientId/secret 은 env/시크릿 매니저(레포 금지).
- redirect URIs 에 실제 앱 스킴(`kr.co.aipia.app://oauth/*`) + 각 사이트 https 콜백.
