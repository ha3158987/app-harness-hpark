---
doc: 24
title: MMP(어트리뷰션) 콘솔 셋업 — 사람이 직접 해야 하는 일
category: 기능연동
audience: 개발자
status: active
updated: 2026-08-21
---

# MMP(어트리뷰션) 콘솔 셋업 — 사람이 직접 해야 하는 일

> **이 문서의 전제**: 코드 쪽은 끝났다. 플러그인·배선·빌드까지 검증됐다.
> 여기 남은 건 **콘솔에서 사람이 클릭해야만 되는 것**들이다.
> 하나라도 빠지면 "빌드는 되는데 데이터가 안 쌓이거나" "스토어에서 반려된다".

관련 문서: [04-NEW-APP-CHECKLIST](./04-NEW-APP-CHECKLIST.md)(신규 앱 사람 작업 전체 — 이 문서는 그중 MMP 부분) · [13-MARKETING](./13-MARKETING.md)(SDK 개요) · [14-ATT-INTEGRATION](./14-ATT-INTEGRATION.md)(추적 동의) ·
[17-DATA-COLLECTION](./17-DATA-COLLECTION.md)(스토어 개인정보 양식) · [09-CREDENTIALS](./09-CREDENTIALS.md)(키 보관)

---

## 0. 한눈에 — 안 하면 무슨 일이 나는가

| # | 할 일 | 담당 | 안 하면 |
|---|---|---|---|
| 1 | DFINERY 대시보드에 앱 등록 → App Key / Secret Key 발급 | 개발 + 마케팅 | SDK 가 런타임 비활성. **데이터 0건** |
| 2 | 키를 GitHub Secrets 에 등록 | 개발 | 위와 동일. 빌드는 멀쩡히 성공해서 **눈치채기 어렵다** |
| 3 | **Play Console 데이터 안전성 — 광고 ID 신고** | 기획/개발 | **심사 반려** |
| 4 | **App Store Connect 개인정보 라벨 — 추적 신고** | 기획/개발 | **심사 반려** |
| 5 | 트래킹 링크 / 딥링크 도메인 등록 | 마케팅 + 개발 | 캠페인 유입이 어트리뷰션에 안 붙음 |
| 6 | 동작 검증 | 개발 | 위 전부가 조용히 실패해도 모른다 |

> **가장 위험한 건 1·2번이다.** 키가 없어도 **빌드는 성공하고 앱도 정상 동작한다.**
> 어트리뷰션만 조용히 0건이 된다. 그래서 6번(검증)을 반드시 한다.

---

## 1. DFINERY(Adbrix) 대시보드 — 앱 등록 & 키 발급

### 1-1. 먼저 정해야 할 것

| 결정 | 선택지 | 참고 |
|---|---|---|
| 대시보드를 **팝테일과 공유할지 / 새로 팔지** | 공유 · 분리 | 분리하면 데이터가 섞이지 않지만 계약·관리 포인트가 늘어난다 |
| 앱 등록 단위 | **iOS / Android 각각 등록** | 한 앱으로 묶이지 않는다. 플랫폼별로 키가 다를 수 있다 |
| dev / prod 분리 | 권장: 분리 | 안 나누면 개발 중 테스트 이벤트가 실적에 섞인다 |

> ⚠️ 팝테일이 이미 DFINERY 를 쓰고 있다. **기존 계약 안에 앱을 추가하는 것인지, 신규 계약인지**를
> 마케팅/기획과 먼저 확인할 것. 계약 형태에 따라 대시보드 접근 권한부터 달라진다.

### 1-2. 받아야 하는 값 (딱 2개)

| 값 | 코드에서 쓰이는 이름 | 성격 |
|---|---|---|
| Application Key | `appKey` | 앱 식별자 |
| Secret Key | `secretKey` | **비밀값 — 절대 레포에 커밋하지 않는다** |

이 둘은 네이티브 SDK 초기화에 그대로 들어간다:

```
Android : Adbrix.getInstance().init(application, appKey, secretKey)
iOS     : Adbrix.shared().sdkInit(appkey:secretKey:)
```

> 📌 **콘솔 메뉴 경로는 여기 적지 않았다.** DFINERY 콘솔 UI 를 직접 확인하지 않은 상태에서
> 메뉴 이름을 적으면 나중에 바뀌었을 때 다음 사람이 헤맨다.
> 첫 로그인 하는 사람이 **실제 경로를 확인해 이 절에 채워 넣을 것.**
> 못 찾으면 DFINERY 기술지원에 "앱 등록 후 Application Key / Secret Key 발급 위치"를 문의한다.
> 공식 문서: <https://docs.dfinery.ai>

### 1-3. 채워 넣을 자리 (첫 등록자가 작성)

```
[ ] 콘솔 URL:
[ ] 앱 등록 메뉴 경로:
[ ] 키 확인 메뉴 경로:
[ ] 계약 형태: 팝테일 공유 / 신규
[ ] 대시보드 접근 권한 요청처:
```

---

## 2. 키를 GitHub Secrets 에 등록

### 2-1. 시크릿 이름 규칙

`generate-app` 은 **슬러그별 값을 먼저 찾고, 없으면 공통값**을 쓴다.

```
ADBRIX_APP_KEY_<SLUG>      ← 슬러그별 (우선)
ADBRIX_APP_KEY             ← 공통 (폴백)
ADBRIX_SECRET_KEY_<SLUG>
ADBRIX_SECRET_KEY
```

`<SLUG>` = 슬러그를 **대문자로, 하이픈은 언더스코어**로. 예:

| 슬러그 | 시크릿 이름 |
|---|---|
| `characterchat-dev` | `ADBRIX_APP_KEY_CHARACTERCHAT_DEV` |
| `characterchat` | `ADBRIX_APP_KEY_CHARACTERCHAT` |
| `poptale` | `ADBRIX_APP_KEY_POPTALE` |

> **앱마다 키가 다르므로 슬러그별 등록을 권장한다.** 공통값은 전 앱이 같은 키를 쓸 때만 의미가 있다.

### 2-2. 등록 위치

GitHub 레포 `aipia-team/app-harness` → **Settings → Secrets and variables → Actions → New repository secret**

### 2-3. 로컬에서 빌드할 때

```bash
export ADBRIX_APP_KEY_CHARACTERCHAT_DEV="발급받은_앱키"
export ADBRIX_SECRET_KEY_CHARACTERCHAT_DEV="발급받은_시크릿"
node scripts/generate-app.mjs --slug characterchat-dev
```

키가 없으면 이 경고가 뜬다. **경고일 뿐 빌드는 성공하므로 놓치기 쉽다:**

```
⚠ ADBRIX_APP_KEY / ADBRIX_SECRET_KEY 환경변수 없음 — Adbrix 는 키 없이 빌드되어
  런타임 비활성(어트리뷰션 미수집). 키 주입 후 재실행하면 활성화된다.
```

> ⚠️ **키는 `app.config.json` 에 절대 넣지 않는다.** 그 파일은 레포에 커밋된다.
> 키는 환경변수 → `generate-app` → 네이티브 번들(`build/`, gitignore) 경로로만 흐른다.

---

## 3. Play Console — 데이터 안전성(광고 ID) 🔴 반려 사유

Adbrix 를 켜면 앱에 **`com.google.android.gms.permission.AD_ID`** 권한이 자동으로 붙는다
(플러그인 매니페스트에 선언 → 병합). Android 13+ 는 이 권한이 있어야 광고 ID(GAID)를 읽는다.

**이 권한이 붙은 앱은 Play Console 에 광고 ID 수집을 신고해야 한다. 누락하면 반려된다.**

### 신고 내용

**Play Console → 앱 → 정책 및 프로그램 → 앱 콘텐츠 → 데이터 안전성**

| 항목 | 답 |
|---|---|
| 광고 ID를 수집하는가 | **예** |
| 데이터 유형 | 앱 활동 · 기기 또는 기타 ID → **기기 또는 기타 ID** |
| 수집 목적 | **광고 또는 마케팅**, 분석 |
| 제3자와 공유하는가 | **예** (DFINERY / IGAWorks 로 전송) |
| 전송 시 암호화 | 예 |
| 사용자가 삭제 요청 가능한가 | 앱 정책에 맞춰 응답 |

추가로 **"광고 ID" 설문**이 별도로 뜬다. 여기서도 "사용함"으로 답해야 매니페스트 권한과 일치한다.
**불일치하면 자동 검사에서 걸린다.**

### 대상 앱

`marketing.attribution.provider` 가 설정된 **모든 앱**. 내부 테스트 트랙도 포함이다 —
`characterchat-dev` 도 internal 트랙으로 Play 에 올라가므로 해당된다.

> 상세 정답지는 [17-DATA-COLLECTION](./17-DATA-COLLECTION.md) 참조.

---

## 4. App Store Connect — 개인정보 라벨(추적) 🔴 반려 사유

iOS 는 IDFA 를 쓰므로 **App Privacy 라벨에 "추적(Tracking)"을 신고**해야 한다.

**App Store Connect → 앱 → App Privacy**

| 항목 | 답 |
|---|---|
| 데이터 수집 여부 | 예 |
| 데이터 유형 | **식별자 → 기기 ID**, 사용 데이터 → 제품 상호작용 |
| 사용 목적 | **제3자 광고**, 분석, 앱 기능 |
| **"사용자 추적에 사용됨"** | **예** ← 이걸 켜야 ATT 와 일관된다 |

### 반드시 같이 확인할 것

- **ATT 권한 문구**가 앱에 들어 있어야 한다 → `tracking.att.usageDescription`
  (없으면 `generate-app` 이 빌드를 실패시킨다. [14-ATT-INTEGRATION](./14-ATT-INTEGRATION.md))
- **개인정보처리방침에 "광고 식별자 수집·제3자 제공(DFINERY)" 문구**가 있어야 한다.
  라벨만 켜고 방침에 없으면 불일치로 지적받는다.

> ⚠️ ATT 를 켜 놓고 개인정보 라벨에서 "추적 안 함"으로 신고하는 **불일치가 가장 흔한 반려 사유**다.

---

## 5. 트래킹 링크 / 딥링크 도메인

어트리뷰션은 "광고를 눌러 들어왔다"를 알아야 성립한다. 그 경로가 트래킹 링크다.

### 5-1. 마케팅이 할 일

- DFINERY 대시보드에서 **캠페인 / 트래킹 링크 생성**
- 매체(네이버·카카오·구글 등)에 그 링크로 집행

### 5-2. 개발이 할 일 — 딥링크가 앱으로 들어오게

트래킹 링크를 누르면 최종적으로 **우리 도메인의 유니버설 링크 / 앱 링크**로 떨어져야 앱이 열린다.
이건 MMP 와 별개로 이미 필요한 작업이다:

| 파일 | 어디에 | 상태 |
|---|---|---|
| `.well-known/apple-app-site-association` | 웹 서버 | `generate-app` 이 `build/<slug>/well-known/<host>/` 에 **생성해 준다.** 웹에 올리기만 하면 된다 |
| `.well-known/assetlinks.json` | 웹 서버 | 위와 동일. 단 **Play 서명 SHA256 지문 2개**가 필요하다 |

**SHA256 지문 2개를 어디서 얻나** — Play Console → 앱 → 테스트 및 출시 → **앱 서명**
- 업로드 키 인증서 SHA-256
- 앱 서명 키 인증서 SHA-256

둘 다 `app.config.json` 의 `android.sha256CertFingerprints` 배열에 넣는다. **하나만 넣으면 안 된다** —
업로드 키로 서명된 빌드와 Play 가 재서명한 빌드가 다르기 때문이다.

> ⚠️ `apple-app-site-association` 은 **확장자 없이**, `Content-Type: application/json`,
> **리다이렉트 없이 200** 이어야 한다. 셋 중 하나만 틀려도 Apple 이 조용히 무시한다.

### 5-3. 디퍼드 딥링크 (설치 후 첫 실행)

앱이 없는 사람이 링크를 누르면 → 스토어 → 설치 → 첫 실행 때 원래 링크로 이동해야 한다.
이건 **SDK 가 해 주는 것**이고 하네스 배선은 끝나 있다. 콘솔에서 할 일은
**트래킹 링크에 목적지(deep link) 값을 설정**하는 것뿐이다. 마케팅과 형식을 맞춰 둘 것.

---

## 6. 동작 검증 — 여기까지 해야 "됐다"고 말할 수 있다

키가 없어도 빌드가 성공하므로, **검증 없이는 됐는지 알 수 없다.**

### 6-1. 키가 실제로 앱에 들어갔나 (빌드 직후, 기기 없이)

```bash
# 네이티브 번들에 베이크된 config 확인 (키는 여기에만 들어간다)
python3 -c "
import json; d=json.load(open('build/<slug>/ios/App/App/public/app-config.json'))
print(json.dumps(d['marketing']['attribution'], ensure_ascii=False, indent=2))"
```

`adbrix.appKey` / `adbrix.secretKey` 가 `null` 이 아니어야 한다. `null` 이면 2번(시크릿)이 안 된 것이다.

### 6-2. SDK 가 실제로 붙었나 (기기)

기기에서 앱 실행 후 로그를 본다.

```bash
# Android
adb logcat | grep -i "abx\|adbrix"
# iOS — Xcode → Window → Devices and Simulators → Open Console, 또는
xcrun simctl spawn booted log stream --predicate 'eventMessage CONTAINS[c] "adbrix"'
```

### 6-3. 대시보드에 들어왔나

DFINERY 대시보드에서 **실시간 이벤트 / 설치 리포트**를 확인한다.
보통 몇 분~수십 분 지연이 있으니 즉시 안 보인다고 실패로 단정하지 말 것.

### 6-4. 디퍼드 딥링크

1. 앱을 **완전히 삭제**한다 (재설치 판정을 위해)
2. 트래킹 링크(목적지 지정된 것)를 누른다 → 스토어
3. 설치 후 첫 실행 → **의도한 화면으로 이동하는지** 확인

> ⚠️ 이미 설치한 적 있는 기기는 "첫 설치"로 안 잡힐 수 있다. 테스트 기기를 따로 두거나
> 광고 ID 를 초기화하고 시도한다.

---

## 7. 벤더를 바꾸게 되면 (AppsFlyer / Airbridge 등)

**코드 변경은 설정 한 줄이다.** 웹 서비스 코드는 건드리지 않는다.

```jsonc
"marketing": { "attribution": { "provider": "appsflyer", "deferredDeepLink": true } }
```

진짜 리드타임은 콘솔·계약 쪽이다:

| 항목 | 비고 |
|---|---|
| 신규 벤더 계약 | 가장 오래 걸린다 |
| 대시보드 개설 + 앱 등록 + 키 발급 | 위 1번을 새 벤더로 반복 |
| GitHub Secrets 교체 | `APPSFLYER_DEV_KEY_<SLUG>` 등 |
| 트래킹 링크 전면 재발급 | **기존 링크는 죽는다.** 집행 중 캠페인이 있으면 조율 필요 |
| 과거 데이터 | **이관되지 않는다.** 벤더가 바뀌면 히스토리가 끊긴다 |
| 스토어 신고 | 제3자 공유 대상이 바뀌므로 **개인정보 라벨·데이터 안전성·처리방침 모두 수정** |

> ⚠️ **두 MMP 를 동시에 돌리는 건 아직 지원하지 않는다.** `attribution.provider` 가 단일 값이다.
> 병행이 필요하면 스키마 확장이 선행돼야 하고, 이벤트 중복 집계와
> "디퍼드 딥링크는 한쪽만" 규칙을 함께 설계해야 한다.

---

## 8. 자주 막히는 것

| 증상 | 원인 | 조치 |
|---|---|---|
| 빌드는 되는데 대시보드에 아무것도 안 옴 | 키 미주입 | 6-1 로 확인. `null` 이면 GitHub Secrets 이름 오타(슬러그 대문자·언더스코어) 의심 |
| 로컬은 되는데 CI 빌드만 안 됨 | 시크릿 미등록 | Secrets 는 로컬 환경변수와 별개다. 둘 다 필요 |
| Play 심사 반려 — 광고 ID | 3번 누락 | 매니페스트에 `AD_ID` 가 있는데 신고를 안 한 상태 |
| App Store 반려 — 개인정보 불일치 | 4번 누락 | ATT 를 쓰면서 "추적 안 함"으로 신고한 경우 |
| 유니버설 링크가 앱을 안 엶 | AASA 서빙 문제 | 확장자·Content-Type·리다이렉트 3종 확인(5-2) |
| 설치 후 첫 실행에 딥링크가 안 먹음 | 재설치로 잡힘 / 링크에 목적지 미설정 | 6-4 |
| 이벤트는 오는데 유저가 식별 안 됨 | SDK 제약 | Adbrix SDK 에는 사용자 식별 API 가 없다. 브릿지가 `user_id` 를 **이벤트 프로퍼티로** 싣는다(`abx:` 표준 이벤트 제외) |

---

## 9. 완료 체크리스트

작업자가 그대로 복사해 쓰는 용도.

```
[ ] 1. DFINERY 계약 형태 확인 (팝테일 공유 / 신규)
[ ] 2. 대시보드에 앱 등록 — iOS
[ ] 3. 대시보드에 앱 등록 — Android
[ ] 4. App Key / Secret Key 발급받음
[ ] 5. GitHub Secrets 등록 (ADBRIX_APP_KEY_<SLUG>, ADBRIX_SECRET_KEY_<SLUG>)
[ ] 6. 이 문서 1-3 절에 콘솔 경로 채워 넣음  ← 다음 사람을 위해
[ ] 7. Play Console 데이터 안전성 — 광고 ID "예"
[ ] 8. Play Console 광고 ID 설문 — "사용함"
[ ] 9. App Store Connect 개인정보 라벨 — "추적에 사용됨" 예
[ ] 10. 개인정보처리방침에 광고 식별자·제3자 제공(DFINERY) 문구
[ ] 11. Play 앱 서명 SHA256 지문 2개 → android.sha256CertFingerprints
[ ] 12. AASA / assetlinks.json 웹 서빙 (200, 리다이렉트 없음)
[ ] 13. 트래킹 링크 생성 (마케팅)
[ ] 14. 검증 6-1 — 베이크된 키가 null 이 아님
[ ] 15. 검증 6-2 — 기기 로그에 SDK 초기화 확인
[ ] 16. 검증 6-3 — 대시보드에 설치/이벤트 도착
[ ] 17. 검증 6-4 — 디퍼드 딥링크 실기기 확인
```
