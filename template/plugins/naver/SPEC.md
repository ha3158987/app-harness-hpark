# Naver Capacitor 플러그인 — 작업 사양서

> 한국 네이버 로그인을 Capacitor 셸에서 네이티브로 처리하기 위한 플러그인.
> Poptale Flutter 앱이 사용 중인 `flutter_naver_login` 의 동작과 동등하게 맞춘다.

---

## 1. 목적

- 사용자가 `AppBridge.login('naver')` 호출 시 네이버 네이티브 SDK 로 로그인 완료.
- 네이버앱 설치되어 있으면 앱-투-앱, 없으면 OAuth 웹뷰 폴백.
- 백엔드(`auth.sessionEndpoint`)에 **네이버 JWT 전체** 전달 → 서버 검증 → 세션 발급.

## 2. config 진입점

```jsonc
{
  "auth": {
    "providers": ["naver", ...],
    "oauth": {
      "naver": {
        "clientId": "<네이버 OAuth 클라이언트 ID — 공개값>",
        "urlScheme": "naverlogin",
        "consumerSecret": null
      }
    }
  }
}
```

- `clientId` 는 공개값이라 config OK.
- *consumerSecret* 은 백엔드 전용 — config 에 두지 않는다.
- `urlScheme` 은 iOS 콜백용 (네이버 콘솔에 등록한 값).

## 3. Poptale Flutter 레퍼런스

- pubspec: `flutter_naver_login: ^2.1.1`
- 토큰 처리: 1.0.1+143 부터 JWT 전체 전달 (카카오와 동일).
- iOS: `Info.plist` 에 `LSApplicationQueriesSchemes` 로 `naversearchapp`, `naversearchthirdlogin`.
- Android: `AndroidManifest.xml` 에 OAuthLoginActivity 등록.

## 4. AppBridge 표면

```ts
AppBridge.login('naver'): Promise<AuthResult2>
// backend 필드에 네이버 토큰 객체 전체
```

## 5. 배선 체크리스트

1. `scripts/lib/config.mjs` — `KNOWN_AUTH_PROVIDERS` 에 `naver` 이미 있음 ✅
2. `scripts/generate-app.mjs`:
   - `AUTH_PLUGINS` 에 추가 (Kakao 와 같은 패턴)
   - `bakedConfig()` 에 `auth.oauth.naver.{clientId, urlScheme}` 주입
3. `template/bridge/dist/index.js`:
   - `login('naver')` 분기 추가
4. `template/bridge/android/build.gradle`:
   - `implementation 'com.navercorp.nid:oauth-jdk8:5.x.x'`
5. iOS `HarnessBridge.podspec` + Info.plist:
   - `NaverThirdPartyLogin` 또는 Naver iOS SDK pod
   - `CFBundleURLSchemes` 에 `urlScheme`

## 6. 콘솔 등록 (사람)

- **네이버 개발자센터** (https://developers.naver.com) → 애플리케이션 → Poptale 앱:
  1. Android: 패키지명 `com.aipia.poptale` 확인 (이미 등록됨)
  2. iOS: 번들 ID 확인 + URL scheme 등록
  3. 다운로드 URL / 서비스 URL — 기존 그대로
  4. 사용 API: "네이버 아이디로 로그인" (Naver Login)

## 7. 테스트 시나리오

- [ ] 네이버앱 설치 기기에서 앱-투-앱 로그인 성공
- [ ] 미설치 기기에서 웹뷰 로그인 성공
- [ ] 취소 시 `ok: false, reason: 'user-cancel'`
- [ ] 백엔드 `/auth/native` 가 네이버 JWT 받아 세션 발급
- [ ] 신규 회원 온보딩 흐름 통과

## 8. TODO

- [ ] Capacitor Naver 플러그인 패키지 선택/작성
- [ ] iOS AppDelegate URL 핸들러
- [ ] 토큰 만료 처리 — 백엔드 세션이 진실이므로 client refresh 불필요 추정
