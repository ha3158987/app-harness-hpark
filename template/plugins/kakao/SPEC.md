# Kakao Capacitor 플러그인 — 작업 사양서

> 한국 카카오 로그인을 Capacitor 셸에서 네이티브로 처리하기 위한 플러그인.
> Poptale Flutter 앱이 사용 중인 `kakao_flutter_sdk_user` 의 동작과 동등하게 맞춘다.

---

## 1. 목적

- 사용자가 `AppBridge.login('kakao')` 를 호출하면 카카오 네이티브 SDK 가 떠서 로그인 완료.
- 백엔드(`auth.sessionEndpoint`)에 **카카오 JWT 전체** 를 전달하여 서버가 검증 → 세션 발급.
- 카카오톡 앱이 설치되어 있으면 톡으로 인증, 없으면 카카오 계정 웹뷰로 폴백.

## 2. config 진입점

```jsonc
{
  "auth": {
    "providers": ["kakao", ...],
    "sessionEndpoint": "https://api.poptale.ai/api/v2/auth/native",
    "oauth": {
      "kakao": {
        "nativeAppKey": "<카카오 네이티브 앱 키 — 공개값>",
        "scopes": ["profile_nickname", "account_email"]
      }
    }
  }
}
```

- `nativeAppKey` 는 카카오 디벨로퍼스의 *네이티브 앱 키* (공개값이라 config OK).
- *REST API 키 / Admin 키* 는 백엔드 전용 — config 에 두지 않는다.

## 3. Poptale Flutter 레퍼런스

- pubspec: `kakao_flutter_sdk_user: ^1.10.0`, `kakao_flutter_sdk_share: ^1.10.0`
- iOS: `AppDelegate` 에 카카오 딥링크 URL 핸들러 등록 (1.1.2+162 에서 Flutter 측 처리로 이관).
- Android: `AndroidManifest.xml` 에 `kakao<NATIVE_APP_KEY>://` URL scheme.
- 동작:
  - 카카오톡 앱 있음 → `loginWithKakaoTalk()` (talk SSO)
  - 없음 → `loginWithKakaoAccount()` (account webview)
  - 둘 다 실패 → user-cancel 또는 에러
- 토큰 처리: 1.0.1+143 에서 "네이버/카카오 token 만 전달" → **JWT 전체 전달** 로 변경.
  백엔드 호환을 위해 전체 토큰 페이로드(`access_token`, `id_token`, `refresh_token`, `expires_in`)를 전송.

## 4. AppBridge 표면 (브릿지가 호출자에게 보이는 API)

```ts
AppBridge.login('kakao'): Promise<AuthResult2>
// 반환 예: { ok: true, provider: 'kakao', backend: <서버 응답>, session: true, isNew: false }
```

`AuthResult2.backend` 필드에 카카오 SDK 가 반환한 토큰 객체 전체가 들어간다(백엔드가 그대로 받음).

## 5. 배선 체크리스트 (docs/13-MARKETING.md §4 패턴)

1. `scripts/lib/config.mjs` — `KNOWN_AUTH_PROVIDERS` 에 `kakao` 가 이미 있음 ✅
2. `scripts/generate-app.mjs`:
   - `MARKETING_PLUGINS` 가 아닌 `AUTH_PLUGINS` (필요시 신설) 에 추가
   - `npm install @capacitor-community/kakao-login` (또는 자체 작성 패키지)
   - `bakedConfig()` 에 `auth.oauth.kakao.nativeAppKey` 주입
3. `template/bridge/dist/index.js`:
   - `login('kakao')` 분기에 동적 import + 호출 추가
   - 결과를 `AuthResult2` 형태로 정규화
4. `template/bridge/android/build.gradle` + Manifest patch:
   - `implementation 'com.kakao.sdk:v2-user:2.x'`
   - `<data android:scheme="kakao<NATIVE_APP_KEY>" />` activity-alias
5. `template/bridge/HarnessBridge.podspec` + Info.plist patch:
   - `KakaoOpenSDK` pod
   - `LSApplicationQueriesSchemes` 에 `kakaokompassauth`, `kakaolink`
   - `CFBundleURLSchemes` 에 `kakao<NATIVE_APP_KEY>`

## 6. 콘솔 등록 (사람)

- **카카오 디벨로퍼스** (https://developers.kakao.com) 에서:
  1. 앱 등록 (이미 Poptale 용 앱 존재 — 추가 등록만)
  2. 플랫폼 → Android → **Capacitor 빌드 키 해시 추가** (기존 Flutter 해시는 유지)
     ```bash
     keytool -list -v -keystore release.keystore -alias upload | grep SHA-256
     # 또는 base64 SHA-1
     ```
  3. 플랫폼 → iOS → 번들 ID `com.aipia.poptale` 확인 (이미 있음)
  4. 동의항목: `profile_nickname` 필수, `account_email` 선택 등 Poptale 정책과 동일

## 7. 테스트 시나리오

- [ ] 카카오톡 설치된 기기에서 talk SSO 로 로그인 성공
- [ ] 카카오톡 미설치 기기에서 웹뷰 로그인 성공
- [ ] 사용자 취소(뒤로가기) 시 `ok: false, reason: 'user-cancel'`
- [ ] 백엔드 `/auth/native` 가 카카오 JWT 페이로드를 받아 세션 쿠키 반환
- [ ] 신규 회원이면 `isNew: true` → 웹 온보딩 진입
- [ ] 회원탈퇴 후 재로그인 시 신규 회원으로 처리

## 8. TODO

- [ ] Capacitor Kakao 플러그인 패키지 선택/작성 결정
- [ ] iOS AppDelegate 의 `application(_:open:options:)` 에 카카오 핸들러 연결 (1.1.2+162 패턴)
- [ ] 토큰 갱신(refresh) 흐름 — 현재 백엔드 세션이 진실이므로 client refresh 불필요할 수 있음
- [ ] Kakao Share SDK (`kakao_flutter_sdk_share`) — 별도 플러그인으로 분리 또는 추후 보강
