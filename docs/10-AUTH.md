---
doc: 10
title: AUTH — 인증 / SSO 가이드
category: 기능연동
audience: 개발자
status: active
updated: 2026-09-11
---

# AUTH — 인증 / SSO 가이드

> 🚫 **이 문서의 IdP 관련 절은 더 이상 동작하지 않습니다 — 따라 하지 마세요.**
>
> **기본 인증 규약은 [`25-AUTH-DELEGATION.md`](25-AUTH-DELEGATION.md)(외부 인증서버 위탁)** 이고,
> 하네스로 만드는 모든 앱이 그 경로를 따릅니다.
>
> 자체 IdP(Keycloak) 모드는 **코드에서 제거됐습니다**(#25) — 브릿지의 IdP 분기 · `isIdpMode()` ·
> `DEFAULT_AUTH.idp` · `idp/` 디렉터리가 모두 사라졌고, `auth.idp` 가 남아 있는 config 는
> **빌드가 멈춥니다.** 따라서 아래 두 절은 **배경 기록**일 뿐입니다:
> - §3 의 **공급자별 토큰 교환표** — 교환은 인증서버가 한다
> - §5 의 **Keycloak 설치 체크리스트** — 세울 IdP 가 없다
>
> 반면 **게스트 로그인 · 회원탈퇴 · 기기/세션 관리 · 딥링크 복귀**를 다루는 절은 지금도 유효합니다.

이 하네스의 로그인은 **"인증은 WebView 밖에서, 복귀는 딥링크로, 토큰 교환은 백엔드에서"** 라는
네이티브 앱 표준 패턴을 따른다. 임베디드 WebView 안에서 OAuth 를 돌리면 Google 등이 차단하기
때문이다(`disallowed_useragent`). 이 문서는 config 스키마와 **백엔드가 구현해야 할 규약**을 정리한다.

---

## 0. 앱이 자격증명을 얻는 세 가지 경로

| | 경로 | 누가 쓰나 | 브라우저에 남는 세션 |
|---|---|---|---|
| **A** | 웹 리다이렉트 — 브라우저가 BE 를 거쳐 공급자로 | 웹 | 공급자 세션(+ 서비스 쿠키) |
| **A′** | **브로커** — 앱이 BE 의 `start` 를 **인앱 브라우저**로 열고, 인증서버가 `<appId>://oauth/callback?code=` 로 돌려준 code 를 **앱 WebView 가 상환** | **팝챗 앱 · 신규 앱 기본**(팝테일 글로벌) | 인앱 브라우저는 공용 브라우저와 쿠키를 공유 — 공급자 세션 유지 |
| **B** | **앱 직접 OAuth** — 앱이 시스템 브라우저로 공급자와 직접 | poptale 계열(자체 BE) | 공급자 세션 |
| **C** | 네이티브 SDK — 카카오톡 앱 등으로 점프 | (Flutter 팝테일의 현행 UX — 하네스 미구현) | 없음 |

**팝챗 앱은 A′(브로커)를 쓴다 — 앱이 공급자와 직접 OAuth 를 돌지 않는다(2026-09-03 확정).**
앱이 공급자 clientId 를 들면 인증서버 것과 갈릴 때 같은 사람이 웹·앱 두 계정이 되는데, 코드상
양쪽 다 정상으로 보여 끝까지 안 드러난다. config 는 `auth.providers: []` + `auth.oauthReturnScheme: true`
이고 브릿지 `login()` 은 호출하지 않는다. 규약·참조 구현은 [`25-AUTH-DELEGATION.md`](25-AUTH-DELEGATION.md) §3·§4.

**길 B(poptale)** 에서는 `openExternal({ system: true })` 가 `@capacitor/app-launcher` 로 실제 Safari·Chrome 을
열므로 공급자 세션이 브라우저에 남아 다른 패밀리 앱의 재로그인이 무마찰이다. 아래 §1~§3 은 이 길 B 의
규약이다 — **브로커 앱에는 `sessionEndpoint` 도 공급자별 교환표도 해당하지 않는다.**

> ⚠️ **길 C 는 이 하네스에 구현이 없다.** iOS 네이티브 Sign in with Apple 만 구현돼 있고,
> `template/plugins/kakao/` · `template/plugins/naver/` 에는 **`SPEC.md` 만 있고 코드가 없다.**
> 지금 하네스로 만든 앱에서 **"카카오톡 앱으로 점프"는 불가**하고, 카카오·네이버도 브라우저
> OAuth(길 B 또는 A′)로 돈다. 위 표의 C 행은 팝테일(Flutter)의 현행 UX 이지 하네스가 이미
> 할 수 있는 일이 아니다 — UX 기대치를 여기 맞춰라.

---

## 1. 핵심 흐름

```
[WebView: aipia.co.kr]  AppBridge.login('google')
   → 브릿지가 시스템 브라우저로 OAuth2 Authorization Code + PKCE 열기 (Apple/iOS는 네이티브)
   → 사용자가 공급자에서 인증
   → 공급자가 redirectUri( <appId>://oauth/<provider> )로 복귀  ── 딥링크 ──▶ 앱
   → 브릿지가 authorization code 회수 (state 로 매칭, 시스템 브라우저 닫음)
   → (sessionEndpoint 설정 시) 브릿지가 code 를 백엔드로 POST
   → 백엔드가 client secret 으로 토큰 교환 → 사용자 식별 → aipia.co.kr 세션쿠키 발급
   → WebView 새로고침 = 로그인 완료. 세션쿠키가 *.aipia.co.kr 전체에 적용 = SSO
```

> **secret 은 앱에 없다.** 앱은 공개 `clientId` 와 PKCE 만 사용하고, 비밀키 교환은 전적으로 백엔드 몫.

---

## 2. config 스키마 (`apps/<slug>/app.config.json`)

```jsonc
"auth": {
  "providers": ["email","apple","google","naver","kakao","facebook","x","threads"],
  "sessionEndpoint": "https://aipia.co.kr/auth/native",   // (선택) 브릿지가 자격증명을 POST
  "logoutEndpoint":  "https://aipia.co.kr/auth/logout",   // (선택)
  "oauth": {
    // 시스템 브라우저 OAuth 공급자 — 공개 clientId 필요. secret 은 넣지 않는다.
    "google":   { "clientId": "xxxx.apps.googleusercontent.com" },
    "naver":    { "clientId": "..." },
    "kakao":    { "clientId": "...(REST API 키)" },
    "facebook": { "clientId": "...(앱 ID)" },
    "x":        { "clientId": "..." },
    "threads":  { "clientId": "..." },
    "apple":    { "clientId": "kr.co.aipia.app", "redirectUri": "https://aipia.co.kr/auth/apple/callback" }
  }
}
```

- `email` 은 웹이 직접 처리(브릿지는 `reason:'email-handled-by-web'` 반환).
- `redirectUri` 기본값은 `<appId>://oauth/<provider>` (커스텀 스킴). generate-app 이 이 스킴을
  Android intent-filter / iOS `CFBundleURLTypes` 에 자동 등록한다.
- `authorizeUrl`·`scopes`·`extraQuery` 는 공급자 프리셋이 있고 필요 시 덮어쓸 수 있다(브릿지 `OAUTH_PRESETS`).
- **client secret 은 config·레포 금지.** 백엔드 환경변수로만 둔다(마케팅 키와 동일 원칙).

---

## 3. 백엔드가 구현할 것

### 3-1. `POST {sessionEndpoint}` — 네이티브 자격증명 → 세션쿠키
브릿지가 보내는 body(JSON):
```jsonc
// 시스템 브라우저 OAuth 공급자 (google/naver/kakao/facebook/x/threads)
{ "ok": true, "provider": "google", "authorizationCode": "...", "codeVerifier": "...",
  "redirectUri": "kr.co.aipia.app://oauth/google", "state": "..." }

// Apple 네이티브 (iOS)
{ "ok": true, "provider": "apple", "idToken": "...", "authorizationCode": "...",
  "user": { "id": "...", "email": "...", "name": "..." } }
```
> 브릿지는 위 자격증명에 **`deviceId`(@capacitor/device) 와 `platform`** 을 자동으로 덧붙여 보낸다 →
> 백엔드의 기기별 세션 관리/푸시토큰 매핑에 사용.

백엔드 처리:
1. `provider` 별 토큰 엔드포인트에 `authorizationCode` + `codeVerifier` + **client secret** 으로 교환
   (Apple 은 `idToken` 검증). PKCE 이므로 `code_verifier` 를 함께 전송.
2. 공급자에서 사용자 프로필 조회 → 내부 계정 매핑(없으면 신규로 표시 — §3-4).
3. **`Set-Cookie` 로 세션쿠키 발급** (`Domain=.aipia.co.kr; Secure; HttpOnly; SameSite=Lax`).
4. 응답 JSON:
```jsonc
// 기존 회원 (가입 완료)
{ "user": { "id": "u_123", "nickname": "바다" }, "token": "(선택) 시큐어스토리지 보관용" }
// 신규 회원 (온보딩 필요 — §3-4)
{ "isNew": true, "needsProfile": true, "prefill": { "email": "...", "name": "..." } }
```
- 요청은 `credentials:'include'` 라 Set-Cookie 가 WebView 쿠키스토어에 저장된다.
- `token` 을 주면 브릿지가 `secureSet('auth_token', token)` 으로 Keychain/Keystore 에 보관.
- 신규면 `isNew`/`needsProfile` 만 주고 **세션쿠키는 §3-4 가입 확정 후** 발급(미완성 세션 방지).

### 공급자별 토큰 교환 (백엔드, secret 사용)
| provider | 교환 엔드포인트 | 보내는 것 | 받는 것 |
|---|---|---|---|
| google | `oauth2.googleapis.com/token` | code, code_verifier, client_id, **client_secret**, redirect_uri | `id_token`(OIDC) → email/sub |
| kakao | `kauth.kakao.com/oauth/token` | code, client_id(REST키), **client_secret**, redirect_uri | access_token → `/v2/user/me` |
| naver | `nid.naver.com/oauth2.0/token` | code, client_id, **client_secret**, state | access_token → `/v1/nid/me` |
| facebook | `graph.facebook.com/v19.0/oauth/access_token` | code, client_id, **client_secret**, redirect_uri | access_token → `/me?fields=id,email` |
| x | `api.twitter.com/2/oauth2/token` | code, code_verifier, client_id, (PKCE) | access_token → `/2/users/me` |
| threads | `graph.threads.net/oauth/access_token` | code, client_id, **client_secret**, redirect_uri | access_token → 프로필 |
| apple | (교환 불필요) | 브릿지가 준 `idToken` 을 Apple 공개키로 **검증** | sub/email |

> redirect_uri 는 앱에서 보낸 `redirectUri`(예: `kr.co.aipia.app://oauth/google`) 와 **반드시 동일**해야
> 토큰 교환이 성공한다. 공급자 콘솔에도 이 커스텀 스킴을 등록(§3-3).

### 3-2. `POST {logoutEndpoint}` — 세션 종료
세션쿠키 무효화. 브릿지는 호출 후 시큐어 토큰을 지우고 새로고침한다.

### 3-3. 콜백 URL 등록 (공급자 콘솔)
각 공급자 개발자 콘솔에 **두 종류**의 redirect 를 등록해야 한다:
- 앱(네이티브): `kr.co.aipia.app://oauth/<provider>` (커스텀 스킴)
- 웹(브라우저 폴백/Apple): `https://aipia.co.kr/auth/<provider>/callback`

---

## 3-4. 회원가입(신규) vs 로그인(기존) — 분기

소셜 로그인은 **신원만** 준다. 약관 동의·추가정보는 공급자가 주지 않으므로 **첫 가입 시 따로 받아야**
한다. 백엔드가 신규/기존을 판단하고, 신규면 브릿지가 **자동 새로고침을 멈춰** 웹이 온보딩을 띄운다.

```
login('google') → POST {sessionEndpoint}
  ├─ 기존 회원   → 200 { user }                          → 브릿지가 새로고침 = 로그인 완료
  └─ 신규 회원   → 200 { isNew:true, needsProfile:true }  → 새로고침 안 함, 웹이 온보딩 표시
                    → 웹이 약관+추가정보 수집 → completeSignup() → POST {signupEndpoint}
                    → 200 { user, token } → 세션쿠키 발급 → 새로고침 = 가입 완료
```

`{sessionEndpoint}` 응답으로 "미완료"를 알리는 플래그(아무거나): `isNew` | `needsProfile` |
`needsConsent` | `complete:false`. 이 중 하나라도 있으면 브릿지는 새로고침하지 않는다.

`{signupEndpoint}` 가 받는 body 예:
```jsonc
{ "nickname": "바다", "birth": "1998-03-01",
  "consents": { "tos": true, "privacy": true, "age14": true, "marketing": false } }
```
> 세션쿠키는 `{signupEndpoint}` 응답에서도 `Set-Cookie` 로 내려준다(가입 직후 로그인 상태).

### 한국 법상 필수 동의 (회원가입 시)
| 항목 | 필수 |
|---|---|
| 서비스 이용약관 | 필수 |
| 개인정보 수집·이용 | 필수 |
| 만 14세 이상 확인 | 필수 (미만은 법정대리인 동의) |
| 마케팅 정보 수신 | 선택 (푸시/AppsFlyer 동의와 연결) |

### Apple 특이사항 (반드시)
- **name/email 은 최초 인증 1회만** 전달된다 → 백엔드가 첫 `sessionEndpoint` 응답에서 **즉시 저장**.
- 사용자가 **"이메일 가리기"(relay)** 를 쓰면 가짜 이메일이 옴 → 메일 발송은 Apple relay 경유.

## 3-6. 게스트(익명) 로그인 + 병합
로그인 전에도 **충전(IAP)/진행상황**을 보관하려면 신원이 필요하다 → 자격증명 없는 **게스트 계정**.
- `AppBridge.guestLogin()` → `POST {guestEndpoint}` 가 익명 계정+세션 발급, 토큰을 secureStorage 에 보관.
- 앱 시작 시 `ensureSession()`(어댑터): `/auth/me` 비로그인이면 자동 게스트 로그인.
- **병합(중요)**: 게스트가 나중에 `login()`/`completeSignup()` 으로 실계정 전환하면, 브릿지가 기존
  토큰을 `prevToken` 으로 보내고 **백엔드가 게스트의 지갑/진행상황을 실계정으로 이전 후 게스트 삭제**.
- ⚠️ **익명 상태에선 웹 게스트 ≠ 앱 게스트**(공유 신원 없음). 실계정 로그인해야 합쳐진다.
```js
// 앱 시작
await initHarness();
await ensureSession();          // 비로그인이면 게스트 신원 확보 → 구매/적립 가능
// 나중에 실계정 로그인하면 백엔드가 게스트 지갑을 병합
```

## 3-7. 기기 바인딩 (실로그인 후) + 생체 빠른 재로그인
실계정 로그인하면 세션 토큰이 **기기 보안저장소(Keychain/Keystore)에 바인딩**돼 재실행해도 로그인 유지.
그 위에 두 가지를 더 얹는다:
- **생체 빠른 재로그인**: 실로그인 직후 `enableBiometricLogin()` 권유 → 다음 실행부터 소셜 라운드트립 없이
  `unlock()`(Face ID/지문)로 즉시 진입.
- **기기 등록**: `registerPush()` 시 푸시토큰+deviceId 를 `POST {deviceEndpoint}` 로 계정에 등록 →
  그 사람 기기로 푸시 + 기기/세션 관리(§6).
- **기기 해제**: `logout()` · `deleteAccount()` 가 **세션 종료 앞에서** 같은 페이로드를
  `POST {deviceUnregisterEndpoint}` 로 보낸다. 순서가 계약이다 — 세션이 끝난 뒤에는 서버가
  "누구의 기기인가" 를 판정할 수 없어 401 로 버린다.
  ⚠️ 이 키를 안 넣으면 브릿지는 해제를 **건너뛴다.** 그러면 토큰이 이전 계정에 붙은 채 남는다.
  실제로 새는 경우는 두 가지다 — **둘 다 화면에 증상이 없어 수동 QA 로 잡히지 않는다.**

  | 경우 | 결과 |
  |---|---|
  | 로그아웃한 뒤 그 기기에 아무도 로그인하지 않음 | **무조건** 이전 계정의 푸시가 계속 온다 |
  | 다음 사용자가 알림 권한을 **거부** | 소유자 갱신이 안 일어나 그 사람 기기로 **남의 알림**이 간다 |

  ⚠️ **"계정 전환이면 항상 남의 알림" 은 아니다.** 다음 사용자가 알림을 허용하면
  `registerPush()` 가 토큰을 다시 올리고, 서버가 `token` 유니크 upsert 로 **소유자를 새
  사용자로 갱신**한다(팝챗 BE `push/tokens.py` 의 `register_token` — 기기 양도·재로그인을
  위해 의도된 동작이다). 권한을 거부하면 브릿지가 토큰을 아예 보내지 않아 그 갱신이
  일어나지 않고, 그때만 남의 알림이 된다. 해제를 넣으면 두 경우가 함께 닫힌다.
```js
// 실로그인 성공 후
await AppBridge.enableBiometricLogin();    // "다음엔 Face ID로 로그인" 권유
// 앱 시작 시
const { unlocked } = await AppBridge.unlock();  // 생체 켜져 있으면 인증 요구
```

## 3-8. 로그인 유도 UX (게스트 → 실계정 전환)
게스트는 **기기에 임시로 맡긴 신원** — Android 재설치/초기화면 날아가고 복구 불가(§3-6). 그래서 가치가
생기면 실계정으로 "옮겨 담도록" 유도한다(전환 시 게스트 지갑 자동 병합).

| 타이밍 | 권유 (예시 카피) |
|---|---|
| **충전/구매 직전** | "구매한 코인을 안전하게 보관하려면 로그인하세요" (특히 Android — 재설치 시 손실 경고) |
| **구매 직후** | "방금 받은 코인을 계정에 저장하고 다른 기기에서도 쓰세요" |
| 진행상황/찜이 쌓였을 때 | "기기를 바꿔도 이어보려면 로그인" |
| 설정 화면 상시 | "계정 연결" 항목 + (로그인 후)"생체 인증으로 빠른 로그인" 토글 |
| 강요 금지 | 둘러보기/읽기는 게스트로 계속 가능하게(마찰 최소). 가치 지점에서만 권유 |

> 원칙: **시작은 마찰 없이(게스트), 가치가 생기면 실계정 유도.** 전환 시 병합은 하네스가 처리(§3-6).

## 3-5. 회원탈퇴 / 계정 삭제 (스토어 필수)
계정 생성을 지원하면 **앱 내 회원탈퇴**가 의무다(Apple 5.1.1(v), Google 정책). 웹에 탈퇴 화면을
두고(이미 웹이면 그대로), Play Console 엔 데이터 삭제 URL 을 등록한다. 탈퇴 후 브릿지 `logout()` 호출.

## 4. 웹에서 쓰는 법

```js
import { AppBridge } from '@harness/bridge';

// sessionEndpoint 를 config 에 넣었으면 이 한 줄로 끝(기존 회원이면 자동 새로고침)
const res = await AppBridge.login('google');
if (!res.ok) { showError(res.reason); }
else if (res.isNew || res.needsProfile) {
  // 신규 회원 → 약관 동의 + 추가정보 화면(웹 UI) 표시 후 가입 확정
  const profile = await showOnboarding();  // { nickname, birth, consents:{...} }
  await AppBridge.completeSignup(profile);  // → 가입 완료 후 새로고침
}

// sessionEndpoint 없이 직접 처리하려면 반환된 code 를 웹이 백엔드로 전송
const r = await AppBridge.login('kakao');
if (r.ok) await fetch('/auth/native', { method:'POST', credentials:'include',
  headers:{'Content-Type':'application/json'}, body: JSON.stringify(r) });

await AppBridge.logout();
```

> 브라우저(앱 아님)에서는 `login()` 이 `reason:'web-should-redirect'` 를 반환한다 — 웹은 평소의
> 리다이렉트 OAuth 를 그대로 쓰면 된다(피처 디텍션: `AppBridge.isNative`).

---

## 5. SSO — 패밀리 사이트 여러 개 (중요)

**"웹 쿠키 SSO" 와 "앱 SSO" 는 다르다.** 패밀리 사이트를 여러 개 만들 거면 이 구분이 핵심이다.

### 케이스 A — 같은 도메인의 서브도메인 (a.aipia.co.kr, b.aipia.co.kr)
세션쿠키를 `Domain=.aipia.co.kr` 로 발급하면 **모든 서브도메인이 자동 공유 = SSO 됨.** ✅
(단, 한 앱의 WebView 안에서 서브도메인 간 이동일 때. `allowedDomains` 에 `*.aipia.co.kr` 포함 필요.)

### 케이스 B — 패밀리 "앱"이 여러 개 (각각 별도 앱/스토어 등록)
하네스에선 **사이트 1개 = 앱 1개**(별도 app.config.json/startUrl/번들ID). 그런데 **앱마다 WebView
쿠키 저장소가 분리**돼 있어서, **쿠키만으로는 앱 A 로그인이 앱 B 로 안 넘어간다.** ❌
→ 이건 쿠키가 아니라 **중앙 인증 서버(IdP)** 가 필요한 "진짜 SSO" 영역이다.

**해결: 중앙 OIDC IdP (`auth.aipia.co.kr`) 를 둔다.**
```
각 패밀리 앱의 login() →  authorizeUrl = https://auth.aipia.co.kr/authorize  (구글 직접이 아니라)
   → 중앙 IdP 가 구글/카카오 등으로 페더레이션 + 마스터 세션 보유
   → 앱에 code 발급 → 각 앱 백엔드가 IdP 와 교환 → 각 사이트 세션쿠키
```
- 한 번 중앙 IdP 에 로그인하면, **다른 패밀리 앱도 시스템 브라우저의 IdP 세션을 재사용**해
  로그인 화면을 건너뛴다(시스템 브라우저 쿠키 공유 — 이게 모바일 SSO 의 표준).
- **하네스 준비 완료(중앙 IdP 모드)**: config 에 `auth.idp` 를 넣으면 앱은 IdP 하나만 바라본다.
  패밀리 앱들은 `clientId` 만 바꿔 같은 패턴을 복붙.
- **IdP 자체(=`auth.aipia.co.kr`)는 당신이 자기 서버에 설치**(Keycloak 권장; 외부 SaaS 아님 — PostgreSQL
  깔듯 내 서버에 설치). 소셜 8개 페더레이션·토큰발급·세션은 IdP 가 담당.

### 중앙 IdP 모드 config (패밀리 앱 복붙 템플릿)
```jsonc
"auth": {
  "providers": ["email","apple","google","naver","kakao","facebook","x","threads"],
  "idp": {
    "issuer": "https://auth.aipia.co.kr/realms/aipia",  // OIDC issuer (Keycloak realm)
    "clientId": "aipia-novel-app",                       // 이 앱의 IdP 클라이언트 (앱마다 다르게)
    "hintParam": "kc_idp_hint",                          // Keycloak: 특정 소셜로 바로 점프
    "hints": { "google":"google","kakao":"kakao","naver":"naver","apple":"apple",
               "facebook":"facebook","x":"twitter","threads":"threads" }
  },
  "sessionEndpoint": "https://novel.aipia.co.kr/auth/native",
  "signupEndpoint":  "https://novel.aipia.co.kr/auth/signup",
  "logoutEndpoint":  "https://novel.aipia.co.kr/auth/logout"
}
```
- `idp` 가 있으면 브릿지는 `login('kakao')` 를 **IdP authorize + `kc_idp_hint=kakao`** 로 보냄 →
  사용자는 곧장 카카오로, 인증 후 IdP 가 마스터 세션 발급 → 앱은 code 만 받음. **네이티브 소셜 버튼 UX 유지.**
- `oauth` 블록(직접 모드)은 `idp` 가 있으면 무시된다. 둘 중 하나만.
- redirectUri 기본값 `<appId>://oauth/<provider>` 은 그대로(generate-app 이 스킴 등록).

### 중앙 IdP 일 때 백엔드가 단순해짐
직접 모드에선 백엔드가 공급자 8곳과 각각 토큰 교환해야 했지만, **IdP 모드에선 백엔드는 IdP 한 곳하고만**
대화한다(§3-1 의 공급자별 교환 표 불필요):
1. 앱이 준 `authorizationCode`+`codeVerifier` 를 **IdP 토큰 엔드포인트**(`{issuer}/protocol/openid-connect/token`)
   에 이 앱 클라이언트의 secret 으로 교환 → IdP 가 `id_token` 발급.
2. `id_token`(JWT) 을 IdP 공개키(JWKS)로 검증 → 사용자 식별 → 세션쿠키 발급(이하 §3 동일).

### Keycloak 설정 체크리스트 (자기 서버에 설치)
1. **배포**: `auth.aipia.co.kr` 에 Keycloak(Docker) + PostgreSQL. HTTPS 필수.
2. **Realm 생성**: 예 `aipia` (= 패밀리 전체의 사용자 풀).
3. **Identity providers(소셜 페더레이션)** 등록:
   - Google/Facebook/Apple/X(Twitter): Keycloak 기본 제공 — clientId/secret 입력.
   - **Naver/Kakao**: "OpenID Connect / OAuth2" 커스텀 IdP 로 추가(authorize/token/userinfo URL 입력).
     별칭(alias)을 위 `hints` 값과 맞춘다(`kakao`,`naver`).
4. **Clients(앱) 등록**: 패밀리 앱마다 1개(`aipia-novel-app`, `aipia-game-app` …).
   - Public client + **PKCE(S256)** 활성.
   - Valid redirect URIs: `<appId>://oauth/*` (네이티브) + `https://<each-site>/auth/*/callback` (웹).
   - 백엔드용으로 confidential client(secret) 를 따로 둘지 결정(서버 교환용).
5. **클레임 매핑**: `email`, `sub`(고유 ID) 가 id_token 에 들어가게.
6. 각 소셜 공급자 콘솔의 redirect 에 **Keycloak 의 브로커 콜백**도 등록:
   `https://auth.aipia.co.kr/realms/aipia/broker/<alias>/endpoint`.

> Logto/FusionAuth 로 바꿔도 하네스 config 는 `issuer`/`authorizeUrl`/`hintParam` 만 그 제품 값으로
> 바꾸면 된다(브릿지 코드 변경 0). Keycloak 이 아니면 `hintParam` 이 다를 수 있음(없으면 IdP 로그인
> 화면에서 사용자가 소셜 선택).

> 정리: **서브도메인 패밀리면 지금 바로 SSO 됨. 별도 앱 패밀리면 중앙 IdP 설치 + config 에 `auth.idp`
> 한 블록.** 하네스는 이미 IdP 모드를 지원한다(브릿지 `_oauth2`).

## 6. 기기 / 세션 관리 — 누가 담당하나

**전적으로 백엔드 책임.** 하네스(브릿지)는 토큰을 들고 자격증명을 보낼 뿐, 세션의 수명·중복·폐기는
서버가 정한다. 하네스가 도와주는 것 / 백엔드가 해야 하는 것:

| 항목 | 담당 | 비고 |
|---|---|---|
| `deviceId`/`platform` 전송 | 하네스 ✅ | 로그인·가입 요청에 자동 포함 |
| 기기별 세션 레코드 | 백엔드 | deviceId 로 세션 테이블 관리 |
| **동시 로그인 제한/중복 처리** | 백엔드 | "1계정 N기기" 정책, 초과 시 오래된 세션 폐기 |
| 원격 로그아웃("다른 기기에서 로그아웃") | 백엔드 | 세션 무효화 → 앱은 401 받으면 재로그인 |
| 토큰 갱신(refresh) | 백엔드 + 웹 | 만료 시 갱신 엔드포인트 |
| 세션 만료(401) 감지 | 웹/하네스 | 웹 fetch 가 401 → `AppBridge.login()` 재호출 |
| 푸시 토큰 ↔ 기기 매핑 | 백엔드 | `registerPush()` 토큰 + deviceId 저장 |

> 하네스는 의도적으로 세션 정책을 안 가진다(앱마다 다르므로). deviceId 라는 **연결고리만** 제공.

## 7. 계정 중복 방지 / 연결 (재가입 막기)

소셜 수단이 8개라 **같은 사람이 다른 수단으로 또 가입**하는 문제가 생긴다. 두 층으로 막는다:

1. **기기 힌트 (UX, 하네스 제공)**: 로그인 성공 시 수단을 기기에 저장 → 다음에 표시.
   ```js
   const last = await AppBridge.getLastLogin();   // { provider: 'kakao' } | null
   if (last) highlight(last.provider);            // "카카오로 계속하기 (마지막 로그인)"
   ```
   → 같은 기기 재방문 시 같은 수단을 유도해 중복 가입을 크게 줄인다.

   ⚠️ **읽기만 붙이면 영원히 `null` 인 앱이 있다.** 기록은 `login()` 성공 경로에서만
   자동으로 일어난다. `login()` 을 지나지 않는 경로 — **앱이 자체 OAuth 를 도는 구성**
   (서비스의 start URL 을 시스템 브라우저로 열고 딥링크 code 를 웹이 상환)과 **이메일
   로그인**(`login('email')` 은 `email-handled-by-web` 으로 즉시 빠진다) — 은 짝을 직접
   불러야 한다:

   ```js
   AppBridge.rememberLastLogin(provider);  // 소셜=누를 때 · 이메일=성공 후
   ```

   안 부르면 **오류 없이 배지만 안 뜬다.** 게다가 브라우저에서는 웹이 자체
   `localStorage` 로 처리해 정상 동작하는 경우가 많아 **"앱에서만 안 되는 버그"** 로
   나타난다(팝챗에서 실제로 그랬다). 기록 시점을 호출부가 정하는 이유: 소셜은 공급자로
   떠났다 돌아와야 결과를 알고, 이메일은 제출 응답에서 판정이 끝난다.
2. **계정 연결 (백엔드, 본질적 해결)**: 토큰 교환 후 받은 **이메일을 기준키**로, 이미 그 이메일의
   계정이 있으면 **새로 만들지 말고 소셜 연결(link)** 한다.
   - 주의: **Apple "이메일 가리기" relay** 나 이메일 미제공 공급자는 이메일이 다를 수 있음 →
     이때는 가입 후 "기존 계정과 연결하시겠어요?" 흐름을 제공.

## 8. 스토어 정책 (필수)

- **Apple 4.8**: 제3자 소셜 로그인을 제공하면 **Sign in with Apple 도 제공해야 한다**(iOS).
  `providers` 에 `apple` 이 없고 다른 소셜이 있으면 generate-app 이 경고 + 리젝 위험.
- 디지털 재화 결제는 별도(IAP) — 인증과 무관하지만 콘텐츠 앱이면 함께 검토.
