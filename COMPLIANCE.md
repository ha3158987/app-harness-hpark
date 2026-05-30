# COMPLIANCE — 권한 고지 · 개인정보 · 성인인증 (한국 + 스토어)

가입/이용 시 법·정책상 처리해야 하는 것들. 데이터 수집 신고는 `DATA-COLLECTION.md`, 동의(약관/14세/
마케팅)는 `AUTH.md §3-4`.

## 1. 접근권한 고지 + 요청
- **가입 시 권한을 통째로 요청하지 말 것.** 기능을 처음 쓸 때 **just-in-time** + 사전 설명(rationale).
- 한국 정책: **"접근권한 안내" 화면**(앱 첫 실행/설정)에서 **필수/선택 권한 + 용도 + 철회 방법**을 고지.
- 하네스: `AppBridge.getPermissionNotice()` → `[{type,label,purpose,required}]` (capabilities + `config.permissions`
  에서 파생). 화면은 웹이 렌더. 요청은 `requestPermission(type)`, 상태는 `permissionStatus(type)`.
```js
import { permissionNotice, requestPermission } from './harness-adapter';
renderNotice(permissionNotice());                 // 첫 실행: 필수/선택 권한 + 용도 고지
photoBtn.onclick = async () => {                   // 사진 첨부 누를 때 비로소 요청
  await requestPermission('camera'); /* ... */
};
```
- **Android 13+ 알림 권한**(`POST_NOTIFICATIONS`)은 런타임 요청 필수 — 안 하면 푸시가 조용히 안 옴.
- iOS 권한 사용 설명(Info.plist)은 generate-app 이 자동 주입(camera/location/ATT 등).

## 2. 개인정보 / 스토어 정책
- **개인정보처리방침 URL 필수**(양 스토어) → config `legal.privacyUrl`, `legal.termsUrl`. 앱/스토어에 노출.
- **App Store 개인정보 라벨 / Play 데이터 안전성** 양식 → `DATA-COLLECTION.md` 대로 신고
  (특히 **AppsFlyer 광고식별자 + ATT**).
- **동의**: 약관/개인정보(필수), 마케팅(선택)은 가입 온보딩에서 수집(AUTH.md §3-4). 광고추적은 ATT(`requestTracking`).
- PIPA: 수집·이용/제3자 제공/처리위탁 고지, 14세 미만 법정대리인.

## 3. 성인인증 (19+) + 연령 등급
**두 가지를 구분**:
- **만 14세 이상 확인**(일반 가입) → 가입 동의의 `age14`(AUTH.md). 가벼움.
- **성인(19+) 본인확인**(성인 콘텐츠/일부 서비스) → 한국은 **본인확인기관(PASS/NICE/KCB, 휴대폰 본인인증)**
  플로우 필요. 무겁고 한국 특수.

### 성인인증 처리 패턴 (하네스)
본인확인은 **웹/외부 플로우**다. 하네스는 webview + 딥링크라 그대로 지원:
```js
import { startAgeVerification, onResume } from './harness-adapter';
// config.legal.ageVerifyUrl(본인확인 시작 URL)을 시스템 브라우저로 염
await startAgeVerification();
// 본인확인기관 → 당신 서버로 콜백(검증 결과 저장). 복귀 시 서버에서 성인여부 재확인:
onResume(async () => { const me = await fetch('/me',{credentials:'include'}).then(r=>r.json());
  if (me.adultVerified) unlockAdultContent(); });
// PASS 앱-투-앱 복귀는 딥링크로도 들어옴(onDeepLink)
```
- **게이팅은 서버 권위**: 성인 콘텐츠 노출/구매 가능 여부는 **백엔드가 검증 플래그로 판단**(클라 우회 방지).
- **연령 등급**: Apple 콘텐츠 등급(성인=17+/관련 설문), 한국 게임은 **GRAC** 등급. 스토어 콘솔에서 설정.
- 본인확인 PG 연동(NICE/PASS 등)은 백엔드/웹 작업 — 하네스는 시작 URL 오픈 + 복귀 재확인만.

> 원칙(반복): **클라는 흐름을 열고 컨텍스트만, 검증/게이팅은 서버.**
