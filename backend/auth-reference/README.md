# auth-reference — 인증 백엔드 레퍼런스

하네스 브릿지(`AppBridge.login`)와 중앙 IdP(Keycloak) 사이를 잇는 **백엔드 최소 구현**.
학습/참고용(인메모리)이며, `../../AUTH.md` 규약과 1:1 대응한다. 실제 서비스는 DB/세션스토어로 교체.

## 엔드포인트
| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | `/auth/native` | 소셜 자격증명 → IdP code 교환 + id_token 검증 → 기존 회원 세션 / 신규 온보딩 유도 |
| POST | `/auth/signup` | 약관동의+추가정보 → 가입 확정 → 세션 |
| POST | `/auth/logout` | 세션 종료 |
| GET | `/auth/me` | 현재 로그인 사용자 확인(웹 부팅 시) |

## 핵심 흐름 (IdP 모드)
```
앱 login('kakao') → 브릿지가 IdP(kc_idp_hint=kakao) authorize → 카카오 → IdP 세션 → 앱 복귀(code)
   → POST /auth/native { authorizationCode, codeVerifier, redirectUri, deviceId, platform }
   → 백엔드: IdP 토큰엔드포인트 교환(client secret) → id_token 검증(JWKS)
   → sub 로 계정 조회
        ├─ 있음 → aipia_session 쿠키 발급 → { user, token }
        └─ 없음 → aipia_pending 쿠키 + { isNew:true, needsProfile:true }
   → (신규) 웹 온보딩 → completeSignup → POST /auth/signup { nickname, birth, consents }
        → 필수동의 검증(tos/privacy/age14) → 계정 생성 → aipia_session 쿠키 → { user, token }
```

## 실행
```bash
cd backend/auth-reference
cp .env.example .env       # IDP_ISSUER / IDP_CLIENT_ID / IDP_CLIENT_SECRET 채우기
npm install
npm start                  # :8787
```
> 로컬 Keycloak 으로 테스트하려면 `.env` 의 `IDP_ISSUER=http://localhost:8080/realms/aipia`,
> `COOKIE_SECURE=false`, `COOKIE_DOMAIN=localhost` 로.

## Keycloak 쪽 준비
- 앱용 **public client**(`aipia-app`, PKCE) — 하네스가 authorize 에 사용.
- 백엔드용 **confidential client**(`aipia-app-backend`, Client authentication ON) — 이 서버가 code 교환에 사용.
  (두 client 의 redirect 가 앱이 보낸 `redirectUri` 와 일치해야 함)

## 직접(비-IdP) 모드로 쓸 경우
`auth.idp` 없이 공급자별 직접 OAuth 라면, `/auth/native` 의 교환 로직을 **공급자별 토큰엔드포인트**로
바꾸면 된다(`../../AUTH.md` §3-1 의 공급자별 교환 표). 나머지(세션/온보딩)는 동일.

## 운영 전 교체 목록
- 인메모리 `users/pending/sessions` → DB + 세션스토어(Redis 등)
- 계정 **중복 방지/연결**: 같은 email 이 다른 소셜로 오면 link(`../../AUTH.md` §7)
- **기기/세션 관리**: `deviceId` 로 세션 테이블 → 동시로그인 제한/원격 로그아웃
- Apple "이메일 가리기" relay, name/email 최초 1회 저장 처리
- 회원탈퇴(계정 삭제) 엔드포인트(스토어 필수)
