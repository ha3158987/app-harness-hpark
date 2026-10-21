---
name: new-app
description: 하네스에 새 웹 서비스를 앱으로 추가한다. apps/<slug>/app.config.json 과 에셋 자리를 스캐폴딩한다. 사용자가 "새 앱/서비스 추가", "OO 앱 만들어줘", "OO를 앱으로", "새 서비스 등록" 같은 요청을 하면 반드시 이 스킬을 사용해라. 빌드 요청이 함께 와도 먼저 이 스킬로 정의부터 만든다.
---

# new-app

새 서비스 1개를 하네스 `apps/` 에 등록한다. 이 단계는 **앱 정의(config) 생성**이며 네이티브 프로젝트 생성은 빌드 스킬이 맡는다.

## 입력으로 확보할 것

기존 웹 프로젝트나 사용자의 요청에서 먼저 확인하고, 필수 값이 없으면 묻는다.

- `slug` (영소문자·숫자·하이픈, 디렉터리명)
- `appName`, 역도메인 형식의 `appId`, 배포된 웹의 HTTPS `startUrl`
- 사용할 기능과 해당 서비스의 호스트·엔드포인트
- 로그인이 필요하다면 웹 백엔드가 OAuth 복귀를 처리하는지, 앱이 공급자 OAuth를 직접 처리하는지

## 절차

1. `docs/02-GUIDE.md` §6에서 설정 스키마를 읽는다. 인증을 연결한다면 `docs/25-AUTH-DELEGATION.md` §3도 읽는다. 문서의 서비스별 식별자·도메인·엔드포인트 예시는 새 앱 값으로 사용하지 않는다.
2. `apps/app.config.template.json`을 `apps/<slug>/app.config.json`으로 복사한다. `slug`, `appName`, `appId`, `startUrl`을 해당 프로젝트의 실제 값으로 채운다. 조직 전용 프리셋이나 기존 앱 설정에서 값을 가져오지 않는다.
3. 요청된 기능만 켠다. 기능을 켤 때 필요한 설정·웹 백엔드 계약을 함께 확인한다. 로그인 방식은 서비스에 맞춰 설정한다.
   - 웹 백엔드가 OAuth를 처리하고 앱은 복귀 URL만 받는다면 `auth.providers: []`, `auth.oauthReturnScheme: true`로 둔다. 공급자용 `auth.oauth`·`sessionEndpoint`·`guestEndpoint`를 임의로 추가하지 않는다. 복귀 스킴을 쓰므로 `features.deepLink: true`로 설정하고 인증서버의 `<appId>://oauth/callback` 허용 여부를 확인한다.
   - 앱이 공급자 OAuth를 직접 처리한다면 실제 사용하는 공급자만 `auth.providers`에 넣고, 필요한 공개 `auth.oauth.<provider>.clientId`를 확인해 채운다. 비밀 키는 넣지 않는다. 이 방식에서는 `features.deepLink: true`와 `features.secureStorage: true`를 설정한다.
   - 로그인을 쓰지 않으면 템플릿의 빈 `auth.providers`를 유지한다.
4. `features.deepLink`를 켠 경우 `navigation.appLinkDomains`를 명시한다. HTTPS 앱 링크를 운영한다면 `.well-known` 파일을 실제로 서빙할 호스트만 와일드카드 없이 넣는다. 커스텀 스킴만 쓴다면 빈 배열 `[]`로 둔다. `navigation.allowedDomains`는 WebView 이동 허용 호스트로 별도 설정한다.
5. 원본 이미지는 `apps/<slug>/icon.png`(1024×1024)와 `apps/<slug>/splash.png`(2732×2732)에 둔다. 에셋 생성 도구가 이 고정 경로를 읽으므로, `assets.icon`·`assets.splash`도 각각 `icon.png`·`splash.png`로 맞춘다. 이미지가 아직 없으면 임의로 만들지 말고 누락을 보고한다.
6. `apps/*/app.config.json`에서 `appId` 중복을 확인하고, 완성된 설정을 `loadConfig`로 검증한다. 필수 값이나 이미지가 누락되어 빌드할 수 없다면 무엇이 필요한지 보고한다.

## 출력

- `apps/<slug>/app.config.json`
- 채운 값, 켠 기능, 누락된 입력·에셋의 요약

## 하지 말 것

- 여기서 Capacitor 프로젝트를 생성하지 않는다. 빌드 스킬의 `generate-app` 단계에서 생성한다.
- 서명·스토어 자격증명이나 실제 키·비밀번호·토큰을 config 또는 Git에 넣지 않는다.
