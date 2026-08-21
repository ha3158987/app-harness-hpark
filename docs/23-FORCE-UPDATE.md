---
doc: 23
title: 강제 업데이트 가이드 — Firebase Remote Config 셋업
category: 기능연동
audience: 개발자
status: active
updated: 2026-08-21
---

# 강제 업데이트 가이드 — Firebase Remote Config 셋업

> **읽는 사람**: 하네스로 만든 앱에 강제 업데이트를 붙이는 사람.
> **핵심**: 코드는 이미 다 있다. **Firebase 콘솔 작업 + config 3줄**이면 끝난다.
>
> 관련: [PUSH-NOTIFICATIONS.md](./12-PUSH-NOTIFICATIONS.md)(Firebase 프로젝트·키 파일 셋업 — 여기와 공유) ·
> [GUIDE.md](./02-GUIDE.md) §6(스키마 정본) · [NEW-APP-CHECKLIST.md](./04-NEW-APP-CHECKLIST.md)

---

## 0. 어떻게 동작하나

앱이 켜질 때 브릿지가 **자동으로 1회** 최소버전을 확인하고, 현재 버전이 낮으면 전체화면 게이트를 띄운다.
웹 코드는 필요 없다.

```
앱 시작 → ready() → checkForceUpdate() 자동 실행
              ↓
      ① Remote Config    (source: 'remoteConfig' 일 때)
              ↓ 값이 없으면
      ② minVersionUrl    (정적 JSON — 폴백)
              ↓ 둘 다 실패하면
      ③ 통과             (fail-open — 막지 않는다)
```

**왜 마지막이 "통과"인가**: 값을 못 읽었다고 사용자를 막으면 **호스팅 장애가 곧 전체 앱 장애**가 된다.
보안 패치를 강제해야 하는 상황이라면 클라이언트 게이트가 아니라 **서버가 구버전 요청을 거부**하는
방식이 맞다.

**왜 RC 를 쓰면서도 URL 폴백을 두나**: RC 는 캐시 지연·fetch 실패가 있는데 게이트가 fail-open 이라,
폴백이 있으면 그 구멍이 좁아진다. Firebase 를 안 쓰는 앱은 URL 만으로도 쓸 수 있다.

---

## 1. 어느 방식을 쓸 것인가

| | Remote Config | 정적 JSON (URL) |
|---|---|---|
| 값 변경 | Firebase 콘솔에서 | 웹 재배포 |
| 반영 속도 | **최대 1시간**(캐시) | 배포 즉시 |
| 조건부 롤아웃 | ✅ 국가·%·앱버전 | ✗ |
| 필요 조건 | Firebase 프로젝트 + 키 파일 | 없음 |
| 앱 재빌드 | 첫 도입 시 1회 | 불필요 |

**Firebase 를 이미 쓰는 앱(푸시 등)이면 RC 를 권한다.** 아니면 URL 이 간단하다.

> ⚠️ **"콘솔에서 누르면 즉시"가 아니다.** 아래 §4 캐시 지연을 반드시 읽을 것.

---

## 2. Firebase 콘솔 셋업 (RC 방식)

### Step 1 — Firebase 프로젝트

푸시를 이미 쓰고 있다면 **같은 프로젝트를 그대로 쓴다.** 새로 만들지 않는다.
프로젝트 생성·iOS/Android 앱 등록·키 파일(`GoogleService-Info.plist` / `google-services.json`)은
[PUSH-NOTIFICATIONS.md](./12-PUSH-NOTIFICATIONS.md) Step 2·6 과 동일하다.

- [ ] Firebase 프로젝트가 있다
- [ ] iOS·Android 앱이 그 프로젝트에 등록돼 있다
- [ ] 키 파일 2개가 GitHub Secrets 에 base64 로 올라가 있다

> 🔴 **RC 는 키 파일이 없으면 조용히 동작하지 않는다.** 브릿지가 실패를 흡수해 폴백으로 넘기므로
> 에러도 안 난다. "게이트가 안 뜬다"의 흔한 원인이다.

### Step 2 — Remote Config 파라미터 5개 생성

Firebase 콘솔 → 좌측 **DevOps 및 사용자 참여 → Remote Config** → **구성 만들기**

> 콘솔 메뉴 분류는 종종 바뀐다. 안 보이면 좌측 맨 위 **제품 검색**에 `Remote Config` 를 치거나
> `https://console.firebase.google.com/project/<프로젝트ID>/config` 로 바로 간다.

**아래 표를 그대로 콘솔에 옮겨 적는다.** 설명(Description)까지 채우는 걸 권한다 — 콘솔 목록에
그대로 보여서, 나중에 다른 사람이 이 값을 만졌을 때 판단 근거가 된다.

| 매개변수 이름 | 데이터 유형 | 기본값 | 설명(그대로 복사) |
|---|---|---|---|
| `min_version_code_ios` | **숫자** | `11` | iOS 최소 허용 버전코드. 앱의 version.code 가 이 값보다 작으면 전체화면 업데이트 게이트가 뜬다. **스토어 승인·배포 완료 후에 올릴 것** — 먼저 올리면 심사 리뷰어가 막힌다. |
| `min_version_code_android` | **숫자** | `11` | Android 최소 허용 버전코드. iOS 와 동일 규칙. 플랫폼별로 배포 시점이 다르므로 따로 관리한다. |
| `force_update_message` | 문자열 | `원활한 이용을 위해 최신 버전으로 업데이트해 주세요.` | 업데이트 게이트에 표시할 안내 문구. 비워두면 앱 기본 문구가 쓰인다. |
| `force_update_hard` | **부울** | `true` | true = 닫을 수 없는 강제 게이트. false = "나중에"로 닫히는 소프트 권유. 신규 정책은 false 로 먼저 관찰한 뒤 true 로 올리는 것을 권장. |
| `store_url_ios` / `store_url_android` | 문자열 | (빈 값) | 업데이트 버튼이 열 스토어 주소. 비워두면 앱이 번들 ID 로 자동 조립하므로 보통 비워둔다. |

> 💡 **기본값을 현재 `version.code` 와 같게** 두고 시작하는 것을 권한다(예: 현재 11 이면 `11`).
> `11 >= 11` 이라 게이트가 뜨지 않는다 — **"장전은 됐지만 발사는 안 된"** 안전한 상태다.
> 테스트할 때만 한 단계 올렸다가 되돌린다.

- [ ] 위 파라미터를 만들었다
- [ ] **오른쪽 위 「변경사항 게시」를 눌렀다** ← 저장만 하면 앱에 안 내려간다

> 🔴 **게시(Publish)를 빼먹는 게 가장 흔한 실수다.** 콘솔에서 값을 입력해도 "게시"를 누르기 전까지는
> 초안 상태라 앱이 못 읽는다.
>
> ℹ️ 데이터 유형이 중요하다. `min_version_code_*` 를 String 으로 만들면 브릿지가 0 으로 읽어
> **RC 를 건너뛰고 폴백으로 간다**(에러 없이).
>
> ℹ️ 플랫폼별 키를 나눈 이유: RC 의 조건(condition) 기능으로도 분기할 수 있지만, 키를 나누면
> 콘솔에서 값이 그대로 눈에 보여 운영 실수가 줄어든다.

### Step 3 — (선택) 조건부 롤아웃

RC 의 진짜 장점이다. 파라미터의 **조건 추가**로 이런 게 된다.

- 특정 국가만 먼저 강제
- 사용자 10% 에게만 먼저 적용해 게이트 동작 확인
- 특정 앱 버전 이하에만 다른 메시지

지금 안 써도 되고, 나중에 콘솔에서만 추가하면 된다(앱 수정 불필요).

---

## 3. 앱 config

```jsonc
{
  "features": {
    "forceUpdate": {
      "enabled": true,
      "source": "remoteConfig",
      "minVersionUrl": "https://<서비스도메인>/app-version.json"   // 폴백 — 권장
    }
  },
  "firebase": {
    "enabled": true,
    "remoteConfig": true,
    "remoteConfigFetchIntervalSeconds": 3600,
    "project": { "dev": "<프로젝트ID>" }
  }
}
```

```bash
node scripts/generate-app.mjs --slug <slug>
```

`@capacitor-firebase/remote-config` 가 자동 설치된다. **네이티브 재빌드가 필요하다**(플러그인 추가이므로).

> `source: "remoteConfig"` 인데 `firebase.remoteConfig` 가 `false` 면 **빌드가 실패한다.**
> 안 막으면 "게이트를 켰는데 안 뜬다"가 조용히 발생하기 때문이다.

### URL 방식만 쓸 경우

```jsonc
"features": { "forceUpdate": { "enabled": true, "source": "url",
  "minVersionUrl": "https://<도메인>/app-version.json" } }
```

JSON 형식:

```jsonc
{
  "ios":     { "minVersionCode": 11, "storeUrl": "https://apps.apple.com/app/idXXXX",
               "message": "…", "force": true },
  "android": { "minVersionCode": 11, "storeUrl": "https://play.google.com/store/apps/details?id=…" },
  "storeUrl": "…", "message": "…"
}
```

`Cache-Control: no-store` 로 서빙한다. Next.js 라면 Route Handler 를 권한다.

---

## 4. ⚠️ 캐시 지연 — 반드시 알아야 한다

RC 는 `remoteConfigFetchIntervalSeconds` (기본 **3600초 = 1시간**) 안에는 서버를 다시 찌르지 않는다.

```
콘솔에서 게시  →  (최대 1시간)  →  앱이 새 값을 받음
```

Firebase 기본값은 12시간인데 강제 업데이트엔 너무 길어 하네스가 1시간으로 낮춰 뒀다. 더 줄일 수는
있지만 fetch 쿼터·배터리 비용이 늘어난다.

**긴급 차단에는 RC 를 믿지 말 것.** 정말 급하면 서버에서 구버전 클라이언트 요청을 거부하는 편이 빠르고
확실하다.

테스트할 때는 앱을 **완전 종료 후 재실행**해야 새로 fetch 한다. 백그라운드 복귀만으로는 부족하다.

---

## 5. 테스트

```bash
# ① 플러그인이 실제로 깔렸는지
ls build/<slug>/node_modules/@capacitor-firebase/remote-config

# ② 네이티브에 config 가 전달됐는지
python3 -c "import json;d=json.load(open('build/<slug>/ios/App/App/public/app-config.json'));print(d['features']['forceUpdate'], d['firebase'])"

# ③ 폴백 JSON (URL 방식이거나 폴백을 뒀다면)
curl -s https://<도메인>/app-version.json | jq
curl -sI https://<도메인>/app-version.json | grep -i cache-control   # no-store
```

**동작 확인 절차**

1. 콘솔에서 `min_version_code_ios` 를 현재 `version.code` **보다 크게** 설정 → **게시**
2. 앱 완전 종료 → 재실행
3. 전체화면 게이트 노출 확인
4. 값을 되돌리고 → 게시 → 재실행 → 게이트 사라짐

| 확인 항목 | 기대 |
|---|---|
| `version.code < min` | 전체화면 게이트, 닫기 불가 (`force_update_hard: true`) |
| `force_update_hard: false` | "나중에"로 닫힘 |
| RC 와 JSON 값이 다를 때 | **RC 가 이긴다** |
| RC·JSON 둘 다 실패 | **게이트 안 뜸**(fail-open — 의도된 동작) |
| "업데이트 하기" | 올바른 스토어 페이지로 이동 |
| 일반 브라우저 | 게이트 절대 안 뜸 |

---

## 6. 자주 막히는 곳

| 증상 | 원인 | 조치 |
|---|---|---|
| 값을 바꿨는데 반영 안 됨 | **게시(Publish) 안 함** | 콘솔 오른쪽 위 「변경사항 게시」 |
| 게시했는데도 반영 안 됨 | 캐시 지연(최대 1시간) | 앱 완전 종료 후 재실행, 그래도 안 되면 대기 |
| 게이트가 아예 안 뜸 | 키 파일 누락 → RC 초기화 실패 → 폴백도 없음 | Secrets 확인. `source` 반환값으로 어느 소스가 쓰였는지 확인 |
| RC 를 무시하고 URL 만 씀 | `min_version_code_*` 가 문자열이거나 0 | 데이터 유형을 **숫자**로 (문자열이면 앱이 0 으로 읽는다) |
| `force_update_hard` 가 안 먹음 | 부울이 아니라 문자열 `"true"` 로 만듦 | 데이터 유형을 **부울**로 |
| 빌드 실패 (`firebase.remoteConfig 가 꺼짐`) | config 반쪽 설정 | `firebase.enabled`·`remoteConfig` 둘 다 `true` |
| 심사 중 리뷰어가 게이트에 막힘 | 심사 버전보다 `minVersionCode` 를 높게 올림 | **스토어 승인 후** 올릴 것 |
| `version.code` 를 안 올려 게이트 오작동 | 릴리스마다 단조 증가 필요 | CI 에서 검증 권장 |

---

## 7. 운영 규칙 (권장)

- **릴리스할 때 RC 와 폴백 JSON 을 같이 올린다.** 값이 어긋나면 RC 실패 구간에서만 다른 판정이 나는
  재현 어려운 버그가 된다.
- `minVersionCode` 는 **스토어 승인·배포가 끝난 뒤** 올린다. 먼저 올리면 심사 리뷰어가 막힌다.
- RC 값 변경 권한자를 정해 둔다(누구나 누르면 전 사용자가 막힐 수 있다).
- `force_update_hard: false` 로 먼저 소프트 권유 → 반응 보고 `true` 로 올리는 방식이 안전하다.

---

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-20 | 최초 작성. 브릿지 RC 배선(PR #19) 기준 |
