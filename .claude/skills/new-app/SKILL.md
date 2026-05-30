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

## 절차
1. `GUIDE.md` §6 의 `app.config.json` 스키마(정본)를 기준으로 삼는다.
2. `apps/<slug>/` 생성, `app.config.json` 작성. 기능은 사용자가 명시 안 한 건 안전한 기본값
   (`push:false`, `deepLink:false` 등)으로 두고, 어떤 값으로 채웠는지 사용자에게 요약 보고.
3. `apps/<slug>/icon.png`, `splash.png` 자리 안내. 없으면 사용자에게 1024² 아이콘 /
   2732² 스플래시 소스를 요청 (placeholder를 만들지 말 것 — 사용자 제공 전까지 비워둔다).
4. `appId` 중복 여부를 `apps/*/app.config.json` 전체에서 확인.

## 출력
- `apps/<slug>/app.config.json`
- 채운 값 + 누락된 에셋 목록을 사용자에게 요약

## 하지 말 것
- Capacitor 프로젝트를 여기서 생성하지 않는다 (그건 build-* 스킬의 generate-app 단계).
- 서명/스토어 자격증명을 config에 넣지 않는다.
