# ATT 연동 가이드 — 신규 앱이 추적 동의를 붙이는 방법

> **읽는 사람**: 하네스로 새 앱을 만드는 개발자. ATT 를 처음 다뤄도 이 문서만으로 끝나게 썼다.
> **소요**: config 3줄 + 웹 화면 1개(선택). 네이티브 코드 작성은 없다.
>
> 관련: [APP-GROWTH-FEATURES.md](./APP-GROWTH-FEATURES.md)(설계·결정 기록) · [GUIDE.md](./GUIDE.md) §6(스키마 정본)

---

## 0. ATT 가 뭔지 30초

iOS 14.5+ 에서 **다른 회사의 앱·웹사이트에 걸친 사용자 활동을 추적**하려면 유저 동의가 필요하다.
동의를 받으면 IDFA(광고 식별자)를 쓸 수 있고, 못 받으면 어트리뷰션 정확도가 떨어진다.

**딱 3개만 기억하면 된다.**

| # | 사실 | 결과 |
|---|---|---|
| 1 | 시스템 팝업은 상태가 `notDetermined` 일 때**만** 뜬다 | 맥락 없이 한 번 태우면 **그 유저에게는 영영 못 묻는다** |
| 2 | 앱이 추적 설정을 직접 켤 수 없다 | 거부 후엔 유저를 **설정으로 보내는 것**밖에 없다 |
| 3 | Android 에는 ATT 개념이 없다 | Android 에서는 아무것도 하지 않아야 한다 |

1번 때문에 **"설명 먼저, 팝업 나중"** 이 필수다. 하네스가 그 순서를 강제한다.

---

## 1. 최소 셋업 — config 3줄

`apps/<slug>/app.config.json`:

```jsonc
{
  "tracking": {
    "att": {
      "enabled": true,
      "usageDescription": "관심에 더 맞는 광고를 제공하고 마케팅 성과를 측정하기 위해 활동 데이터를 사용합니다."
    }
  }
}
```

```bash
node scripts/generate-app.mjs --slug <slug>
```

이걸로 끝이다. `generate-app` 이 자동으로:

- `capacitor-plugin-app-tracking-transparency` 설치
- `Info.plist` 에 `NSUserTrackingUsageDescription` = 위 문구 주입
- 브릿지 `capabilities.att` 를 iOS 에서만 true 로

> ⚠️ **`usageDescription` 은 필수다.** 비우면 **빌드가 실패**한다. 하네스가 기본 문구를 주지 않는 건
> 의도적이다 — Poptale 은 실제 용도가 광고 어트리뷰션인데 Info.plist 에 "앱 오류 분석"이라고 적힌 채
> 운영됐다(심사·법규 리스크). **이 앱이 추적 데이터를 실제로 쓰는 목적을 그대로 적어라.**

### 옵션

| 키 | 기본값 | 의미 |
|---|---|---|
| `tracking.att.enabled` | `false` | 플러그인 설치 + 문구 주입 |
| `tracking.att.usageDescription` | **없음(필수)** | Info.plist 문구 |
| `tracking.att.prePermission` | **`false`** | `false` = **브릿지가 기본 화면을 띄운다**(웹 작업 0). 웹이 자체 화면을 만들면 `true` 로 명시해 끈다 |
| `tracking.att.copy.*` | `null` | `prePermission: false` 일 때 폴백 화면 문구 오버라이드 |

---

## 2. 두 갈래 — 웹 화면을 만들 것인가

```
prePermission: false (기본)  →  아무것도 안 만든다. 브릿지 기본 화면이 뜬다.   ← 빠른 출발
prePermission: true          →  웹이 화면을 만든다. 브랜드 톤·다국어 자유.    ← characterchat 방식
```

> 기본값이 `false` 인 이유: `enabled: true` 만 켜고 웹을 손 안 대면, `true` 가 기본일 때는
> **플러그인은 깔리고 plist 에 추적 문구도 들어갔는데 아무도 동의를 안 묻는** 상태가 된다.
> 스토어에는 추적한다고 선언해 놓고 실제로는 묻지 않는 앱이라 심사 리스크다.
> **켜면 최소한 동작하는 쪽**을 기본으로 둔다.

### 갈래 A — 브릿지 폴백만 쓴다 (웹 코드 0줄)

```jsonc
"tracking": { "att": { "enabled": true, "usageDescription": "…", "prePermission": false } }
```

앱 시작 후 브릿지가 알아서:
1. iOS + `notDetermined` 인지 확인
2. 준수 문구로 전체화면 안내를 띄움
3. "계속" → 시스템 팝업 / "나중에" → 요청하지 않음(상태 유지 → 다음 기회 살아 있음)

문구를 바꾸려면 `tracking.att.copy` 로 덮는다:

```jsonc
"copy": {
  "title": "광고 추적을 허용해 주세요",
  "body": "관심과 동떨어진 광고 대신 더 관련성 높은 광고를 보여드릴 수 있어요.\n광고의 개수가 줄어드는 것은 아니에요.",
  "notice": "허용하지 않아도 모든 기능을 무료로 그대로 이용할 수 있어요.",
  "continueLabel": "계속",
  "laterLabel": "나중에"
}
```

### 갈래 B — 웹이 직접 그린다 (characterchat 방식)

`prePermission: true` 로 **명시**하고(기본이 false 라 꺼야 한다) 웹에서 3단계.

**① 어댑터에 얇은 래퍼** — 웹이 `AppBridge` 를 직접 부르지 않는 관례를 따른다

```ts
// src/lib/harness/adapter.ts
export const trackingStatus  = () => AppBridge.trackingStatus();
export const requestTracking = () => AppBridge.requestTracking();
export const openAppSettings = () => AppBridge.openAppSettings();
```

**② 노출 조건 — 5개를 모두 만족할 때만**

```ts
isApp()                                     // 앱 WebView 안
&& caps().att                               // iOS + tracking.att.enabled
&& (await trackingStatus()).status === 'notDetermined'   // 아직 안 물어본 유저
&& <온보딩/로그인 완료 등 서비스가 정한 시점>
&& <재노출 정책 통과>                        // 아래 5절
```

**③ "계속" 에서만 요청**

```ts
async function onContinue() {
  setOpen(false);                // 위에 시스템 팝업이 뜨므로 먼저 닫는다
  const { status } = await requestTracking();
  // 결과와 무관하게 다음 흐름으로 — ATT 는 기능·보상의 조건이 될 수 없다
}
```

---

## 3. 호출 순서 (중요)

```
앱 시작
  └ AppBridge.ready()
      └ [서비스가 정한 시점: 온보딩/로그인 완료]
          └ trackingStatus()  ← 팝업 없이 조회. 이미 답한 유저는 여기서 끝
              └ 사전 설명 화면
                  ├ "계속"   → requestTracking() → iOS 시스템 팝업 → 응답
                  └ "나중에" → 요청 안 함 (상태 notDetermined 유지)
                      └ [ATT 종료 후] 마케팅 SDK init · 푸시 권한 요청
```

**지켜야 할 두 가지**

- **ATT 를 다른 권한보다 먼저.** 알림 권한과 같은 시점에 걸면 시스템 다이얼로그가 연달아 뜬다.
  어트리뷰션 정확도는 지연에 민감하므로 ATT 가 앞이다.
- **`initMarketing()` 은 ATT 응답 뒤에.** 단, 로그인처럼 늦은 시점에 ATT 를 두면 그때까지 설치
  어트리뷰션이 안 잡힌다 — 트레이드오프를 알고 정해라(characterchat 은 시작 시 init, ATT 는 로그인 후).

---

## 4. 거부한 유저를 되돌리는 방법

**앱은 추적 설정을 직접 켤 수 없다.** 거부 후 남는 카드는 하나뿐이다.

```ts
await openAppSettings();   // 이 앱의 OS 설정 페이지를 연다
```

iOS 는 앱 설정 페이지에 **"추적 허용" 토글**을 보여주므로 유저가 직접 켤 수 있다.

> ⚠️ `설정 > 개인정보 보호 > 추적` 같은 **하위 화면 직행 URL(`App-Prefs:…`)은 비공개 API 라
> 심사에서 리젝된다.** 공개 API 로는 앱 자신의 설정 페이지까지만 갈 수 있다.
> 그래서 UI 문구는 **"설정에서 추적을 켤 수 있어요"** 처럼 한 단계 더 들어가야 함을 알려주는 게 정직하다.

권장 배치: 설정/마이 화면에 "광고 개인화" 항목을 두고 현재 상태를 보여준다.

| `trackingStatus()` | 화면 표시 | 액션 |
|---|---|---|
| `authorized` | 허용됨 | 끄려면 → `openAppSettings()` |
| `denied` | 허용 안 함 | 켜려면 → `openAppSettings()` |
| `notDetermined` | 아직 선택 안 함 | 사전 설명 화면 다시 띄우기 |
| `restricted` | 기기 정책으로 불가 | 액션 없음(회사/자녀보호 기기) |
| `not-applicable` | — | **항목 자체를 숨긴다**(Android·브라우저) |

Android 에서도 `openAppSettings()` 는 동작한다(앱 정보 화면). ATT 는 없지만 알림·카메라 권한을
두 번 거부하면 다이얼로그가 안 뜨므로 같은 경로가 필요하다.

---

## 5. 재노출 정책

"나중에" 는 `requestTracking()` 을 부르지 **않으므로** 상태가 `notDetermined` 로 남는다.
즉 다음 기회가 실제로 살아 있고, 그래서 "나중에"라는 표현이 거짓이 아니다.

다만 매번 띄우면 nagging 이다. characterchat 은 **7일 간격·총 2회** 상한을 둔다
(`useAttPrompt.ts` 의 `MAX_PROMPTS` / `RETRY_AFTER_MS`). 상태는 `localStorage` 에 둔다 —
앱 재시작에도 유지돼야 하므로 `sessionStorage` 로는 부족하다.

---

## 6. 법적 제약 — 문구를 쓸 때 반드시 지킬 것

2026-08-06 법률 검토 결과다. **위반하면 Apple 리젝 또는 국내 다크패턴 규제 리스크.**

| | 하지 말 것 | 이유 |
|---|---|---|
| ❌ | "추적을 허용하면 **광고가 줄어든다**" | **사실이 아니다.** ATT 는 광고의 *관련성*만 바꾸고 *개수*는 안 줄인다 |
| ❌ | 허용만 강조하는 단일 CTA, "눌러줘!" 류 압박 | Apple 5.1.2(i) + 다크패턴 |
| ❌ | 자체 버튼에 **"허용"** 이라는 단어 | 시스템 다이얼로그 모방 금지(Apple HIG) → "계속" 을 쓴다 |
| ❌ | "마케팅 수신 동의" 를 연상시키는 표현 | 정보통신망법 §50 옵트인과 **완전 별개** — 포괄동의 오인 |
| ❌ | ATT 를 기능·보상의 조건으로 | 거부해도 100% 동일 기능 |

| | 반드시 할 것 |
|---|---|
| ✅ | 거부 경로를 허용과 **시각적으로 동등한 비중**으로 (같은 크기·같은 폭, 텍스트 링크로 축소 금지) |
| ✅ | "거부해도 모든 기능을 무료로 이용할 수 있다" 고지를 **본문과 같은 크기로** (각주 크기 금지) |
| ✅ | 설정에서 변경 가능하다는 안내 |
| ✅ | 최종 동의는 Apple 시스템 다이얼로그에서 수령 |

> 일반 정보이며 법률 자문이 아니다. **출시 전 법무 검토 권장.**

---

## 7. 테스트

```bash
# ① Info.plist 에 문구가 실제로 들어갔는지 (없으면 iOS 가 팝업 호출 시 크래시)
grep -A1 NSUserTrackingUsageDescription build/<slug>/ios/App/App/Info.plist

# ② 네이티브에 config 가 전달됐는지
python3 -c "import json;print(json.load(open('build/<slug>/ios/App/App/public/app-config.json'))['tracking'])"
```

**⚠️ ATT 팝업은 iOS 시뮬레이터에서 불안정하다. 실기기로 확인할 것.**

| 확인 항목 | 기대 |
|---|---|
| 사전 화면 → "계속" | 시스템 팝업이 뜬다 |
| 거부 후 | 전 기능 정상 동작 |
| 앱 재실행 | 사전 화면 재노출 안 됨(정책 내) |
| Android | 사전 화면 **안 뜸** |
| 다시 테스트하려면 | **앱 삭제 후 재설치** (응답하면 `notDetermined` 로 못 돌아옴) |

**흔한 오진**: 기기 전역 `설정 > 개인정보 보호 및 보안 > 추적 > 앱이 추적을 요청하도록 허용` 이
꺼져 있으면 팝업 없이 즉시 `denied` 가 된다. "코드가 안 된다"로 착각하기 쉽다 — 먼저 이걸 확인하라.

---

## 8. 자주 밟는 함정

| 증상 | 원인 | 해결 |
|---|---|---|
| 팝업이 안 뜬다 | 이미 응답한 유저(`notDetermined` 아님) | 앱 삭제 후 재설치 |
| 팝업이 안 뜨고 즉시 거부 | 기기 전역 추적 설정 OFF | 설정에서 켜기 |
| 권한 요청 시 크래시 | `NSUserTrackingUsageDescription` 누락 | `usageDescription` 채우고 재생성 |
| 팝업이 두 번 뜬다 | — | **구조적으로 불가능**. `requestTracking()` 은 멱등이다 |
| Android 에서 사전 화면이 뜬다 | 노출 조건에서 `caps().att` 를 빼먹음 | 조건에 추가(iOS 에서만 true) |
| 동의를 받아도 어트리뷰션이 안 잡힌다 | **추적 SDK 미배선** (`marketing.attribution.provider: null`) | 어트리뷰션 벤더 배선 |

> 마지막 항목 주의 — **추적 SDK 없이 ATT 만 켜면 "동의는 묻는데 쓸 데가 없는" 반쪽 상태**가 되어
> 심사 리스크다. characterchat prod 가 `enabled: false` 인 이유가 이것이다.

---

## 9. API 요약

브릿지 **1.4.0+** 필요.

```ts
// 상태만 조회 — 팝업 없음. 사전 화면 노출 판정에 쓴다
trackingStatus(): Promise<{ status: TrackingStatus; authorized: boolean }>

// 동의 요청 — 멱등(몇 번 불려도 팝업 1회). 사전 설명 뒤에만 호출
requestTracking(): Promise<{ status: TrackingStatus; authorized: boolean }>

// OS 설정 페이지 열기 — 거부한 유저의 유일한 회복 경로
openAppSettings(): Promise<{ opened: boolean; reason?: string }>

// iOS + tracking.att.enabled 일 때만 true
capabilities.att: boolean

type TrackingStatus =
  | 'authorized' | 'denied' | 'restricted' | 'notDetermined'
  | 'not-applicable'   // iOS 아님
  | 'unavailable'      // 플러그인 미설치 등 — 캐시 안 되므로 재시도 가능
```

---

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-08-19 | 최초 작성. 브릿지 1.4.0(`openAppSettings` 추가) 기준 |
