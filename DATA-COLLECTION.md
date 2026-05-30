# DATA-COLLECTION — 하네스가 수집하는 데이터

**App Store 개인정보 라벨(App Privacy)** 과 **Google Play 데이터 안전성(Data Safety)** 양식, 그리고
**개인정보처리방침(PIPA)** 을 정확히 채우기 위한 체크리스트. 많은 앱이 "SDK가 수집하는지 몰라서"
양식을 틀리게 낸다(특히 광고 식별자) → 심사 리젝/정책 위반. 아래는 하네스가 켤 수 있는 SDK 기준.

> 실제 수집 항목은 **당신이 켠 기능 + 백엔드가 저장하는 것**에 달림. 아래에서 **켠 것만** 신고.

| 출처(기능/SDK) | 수집 데이터 | 용도 | 광고추적? |
|---|---|---|---|
| **AppBridge 코어** | deviceId(@capacitor/device), platform, 앱버전 | 앱 기능, 기기↔계정 바인딩 | X |
| **푸시**(@capacitor/push-notifications) | 푸시 토큰(기기 식별자) | 알림 발송 | X |
| **AppsFlyer**(attribution) | **광고 식별자(IDFA/GAID/IDFV)**, 기기정보, 설치/이벤트 | 설치 어트리뷰션·마케팅 | **O (ATT 대상)** |
| **IAP**(cordova-plugin-purchase) | 구매 내역(거래ID) | 결제/지갑 | X |
| **Sentry**(monitoring, 켰을 때) | 크래시 로그, 기기정보, IP(가능) | 진단/안정성 | X |
| **인증**(auth) | 계정 식별자(이메일/소셜 sub), 이름(선택) | 로그인/회원관리 | X |
| **위치**(geolocation, 사용 시) | 위치 좌표 | 위치 기반 기능 | X |
| **카메라/사진**(camera, 사용 시) | 사진/이미지 | 사용자가 첨부할 때만 | X |
| **네트워크 요청 전반** | IP 주소 | 기본 통신 | X |
| secureStorage/preferences | (기기 로컬 저장, 전송 안 함) | 세션/설정 | X |

## 신고 시 핵심 포인트
- **AppsFlyer = 광고 식별자 수집** → App Store "추적(Tracking)"에 해당 → **ATT 동의 필수**(하네스 `requestTracking()`),
  Play 데이터 안전성에 "기기/광고 ID 수집·제3자 공유" 신고. **이걸 빠뜨리는 게 가장 흔한 리젝 사유.**
- **계정/구매/위치**는 "사용자에 연결됨(linked)"으로 신고(계정에 묶이므로).
- **Sentry IP/기기정보**는 "진단(diagnostics)"으로.
- 수집 안 하는 기능(끈 것)은 신고하지 말 것(과신고도 문제).

## 개인정보처리방침(PIPA)에 반영
- 수집 항목·목적·보유기간, **제3자 제공/처리위탁**(AppsFlyer=해외 위탁, Sentry 등) 명시.
- 마케팅 수신(선택)·광고 식별자 동의 분리. 14세 미만/법정대리인(§AUTH).
- 처리방침 URL 은 config `legal.privacyUrl` 로 두고 앱/스토어에 노출.

> 양식 작성은 **스토어 콘솔**에서(코드 아님). 이 문서는 "무엇을 신고할지"의 단일 출처.
