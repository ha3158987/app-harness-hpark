# AUTH — 인증 / SSO 가이드

이 하네스의 로그인은 **"인증은 WebView 밖에서, 복귀는 딥링크로, 토큰 교환은 백엔드에서"** 라는
네이티브 앱 표준 패턴을 따른다. 임베디드 WebView 안에서 OAuth 를 돌리면 Google 등이 차단하기
때문이다(`disallowed_useragent`). 이 문서는 config 스키마와 **백엔드가 구현해야 할 규약**을 정리한다.

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
백엔드 처리:
1. `provider` 별 토큰 엔드포인트에 `authorizationCode` + `codeVerifier` + **client secret** 으로 교환
   (Apple 은 `idToken` 검증). PKCE 이므로 `code_verifier` 를 함께 전송.
2. 공급자에서 사용자 프로필 조회 → 내부 계정 매핑(없으면 가입).
3. **`Set-Cookie` 로 `aipia.co.kr` 세션쿠키 발급** (`Domain=.aipia.co.kr; Secure; HttpOnly; SameSite=Lax`).
   → 이 쿠키가 `*.aipia.co.kr` 전체에 적용 = SSO.
4. 응답 JSON: `{ "user": {...}, "token": "(선택) 시큐어스토리지에 보관할 토큰" }`.
   - 요청은 `credentials:'include'` 로 가므로 Set-Cookie 가 WebView 쿠키스토어에 저장된다.
   - `token` 을 주면 브릿지가 `secureSet('auth_token', token)` 으로 Keychain/Keystore 에 보관.

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

## 5. 스토어 정책 (필수)

- **Apple 4.8**: 제3자 소셜 로그인을 제공하면 **Sign in with Apple 도 제공해야 한다**(iOS).
  `providers` 에 `apple` 이 없고 다른 소셜이 있으면 generate-app 이 경고 + 리젝 위험.
- 디지털 재화 결제는 별도(IAP) — 인증과 무관하지만 콘텐츠 앱이면 함께 검토.
