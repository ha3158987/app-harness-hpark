---
name: integrate-web
description: 기존 웹 서비스 레포를 하네스에 "연결"한다. 웹 코드에 @harness/bridge 를 붙여 앱에선 네이티브(로그인/결제/공유/딥링크/푸시), 웹에선 기존 로직으로 분기되게 만든다. "이 웹 레포를 하네스에 연결해줘", "두 레포 엮어서 앱으로", "프론트에 브릿지 붙여줘", "웹앱 연동" 요청이면 이 스킬을 사용해라. new-app(정의 생성) 과 짝이다.
---

# integrate-web

기존 웹 서비스(프론트 레포)를 하네스 앱과 엮는다. **자동 연결의 핵심**: 사람이 손으로 넣던
`if (isNative) AppBridge.xxx()` 분기를, AI 가 레포를 읽고 어댑터 패턴으로 넣어준다.

## 입력으로 확보할 것 (없으면 물어본다)
- **웹 레포 경로** (프론트 소스. 하네스와 별도 레포여도 됨)
- **slug** + 기본정보(appName/appId/startUrl) — `apps/<slug>/app.config.json` 용 (없으면 new-app 선행)
- 켤 기능: 로그인(어떤 소셜/IdP), 인앱결제(상품), 공유, 푸시, 딥링크 등

## 원칙 (반드시)
- **웹 경로를 깨지 않는다.** 기존 웹 로직은 `webFallback` 으로 보존하고 **분기만** 추가. 삭제/대체 금지.
- **어댑터 한 곳으로 모은다.** call site 를 흩뿌리지 말고 `harness-adapter` 를 통해 호출.
- **변경은 최소 + diff 보고.** 무엇을 어디에 넣었는지 사람이 리뷰하게 요약.
- 자격증명/시크릿을 웹 코드·config 에 넣지 않는다(공개 clientId/dsn 만).

## 절차
1. **정의 확인/생성** — `apps/<slug>/app.config.json` 있는지. 없으면 `new-app` 으로 만들고
   필요한 블록(auth/iap/marketing/monitoring) 채운다. (스키마: GUIDE.md §6, AUTH.md, IAP.md)
2. **의존성 추가** — 웹 레포에 `@harness/bridge` 추가.
   - 모노레포면 `file:` 경로, 아니면 배포된 패키지/깃 의존성.
3. **어댑터 배치** — `template/integration/harness-adapter.js` 를 웹 레포의 적절한 위치
   (예: `src/native/harness-adapter.js`)로 복사. (TS 레포면 타입 주석/`.ts` 로 조정)
4. **부트스트랩 연결** — 앱 엔트리(예: `main`/`App` 초기화)에서 `initHarness({ onDeepLink })` 1회 호출.
   딥링크 도착 시 라우터로 보내도록 콜백 연결.
5. **call site 연결** — 레포를 검색해 아래를 어댑터 호출로 분기(기존은 webFallback 로 보존):
   - **로그인/로그아웃/회원탈퇴**: 소셜 로그인 버튼/함수 → `login(provider, ()=>기존웹로그인, { onNewUser })`
   - **결제**: 구매/충전 버튼 → `buy(productId, ()=>기존웹결제)` (디지털 재화는 앱=IAP 필수)
   - **공유/외부링크**: `share()`, `openExternal()`
   - **푸시 동의 UI**: `registerPush()`
   - **Android 백버튼/모달**: `onBackButton()`
   찾는 단서: `oauth`, `signin`/`login`, `google`/`kakao`/`naver`, `checkout`/`payment`/`purchase`,
   `navigator.share`, `window.open`.
6. **신규회원 온보딩** — 소셜은 신원만 주므로, `login` 의 `onNewUser` 에서 웹의 약관+추가정보 화면을
   띄우고 `completeSignup(profile)` 로 확정(AUTH.md §3-4). 기존 웹 가입 폼 재사용.
7. **가격/지갑 정합** — 앱 IAP 와 웹 PG 가 **같은 서버 지갑(계정)** 에 적립되도록 백엔드 확인(IAP.md).
8. **검증** — `node scripts/doctor.mjs` (config 점검) → `node scripts/generate-app.mjs --slug <slug>`
   → 디버그 빌드(build-android)로 동작 확인.
9. **보고** — 추가/변경한 파일·call site 목록과, 사람이 직접 해야 할 일(백엔드 엔드포인트, 스토어 상품,
   소셜 키, 시크릿)을 명확히 요약.

## 출력
- 웹 레포: `@harness/bridge` 의존성 + `harness-adapter` + 부트스트랩/call site 분기(diff 요약)
- 하네스: `apps/<slug>/app.config.json`
- 사람이 할 후속(백엔드/스토어/키) 체크리스트

## 하지 말 것
- 기존 웹 결제/로그인 코드를 지우거나 한쪽만 동작하게 만들지 않는다(웹/앱 둘 다 살아야 함).
- 백엔드(영수증/토큰 검증, 세션, 지갑)나 스토어/소셜 콘솔 작업을 코드로 흉내내지 않는다 — 규약 문서를
  가리키고 사람에게 넘긴다(AUTH.md / IAP.md / DEPLOY.md).
- 웹 코드 구조가 불명확하면 추측해서 광범위 수정하지 말고, 분기 지점을 사람에게 확인.
