# WhaTap APM Capacitor 플러그인 — 작업 사양서

> WhaTap APM/RUM (Application Performance Monitoring / Real User Monitoring) SDK.
> Poptale 웹/앱이 사용 중. 하네스 `monitoring.apm.provider: "whatap"` 슬롯의 실제 배선.

---

## 1. 목적

- 모바일 앱의 성능/이벤트 모니터링 (응답시간, 화면 전환, 네트워크, 크래시)
- 크래시 리포팅은 Firebase Crashlytics 와 분리(`monitoring.crash.provider: "crashlytics"`)
  → WhaTap 은 *APM* 으로만 사용, 크래시는 Crashlytics 가 정본

## 2. config 진입점

```jsonc
{
  "monitoring": {
    "crash": { "provider": "crashlytics" },
    "apm":   { "provider": "whatap" }
  }
}
```

## 3. 키 주입

| 환경변수 | 의미 |
|---|---|
| `WHATAP_PROJECT_ACCESS_KEY` (또는 `..._<SLUG>`) | WhaTap 프로젝트 액세스 키 |
| `WHATAP_PCODE` (또는 `..._<SLUG>`) | WhaTap PCode |

> Poptale Frontend `.env.example` 에 `NEXT_PUBLIC_WHATAP_PROJECT_ACCESS_KEY` / `NEXT_PUBLIC_WHATAP_PCODE`
> 가 있어 *웹 측* 은 이미 WhaTap Browser Agent 사용. 앱(Capacitor) 측에서도 같은 프로젝트로 보낼지,
> 별도 프로젝트로 분리할지 결정 필요.

## 4. Poptale 레퍼런스

- 웹: WhaTap Browser Agent (script tag 또는 npm 패키지)
- 앱: **Flutter 앱에는 WhaTap 모바일 APM 이 들어가 있지 않음** — 신규 검토 항목.
  → 신규 앱부터 WhaTap 모바일 APM 도입할지, 또는 Crashlytics + Firebase Analytics 만으로 충분한지 의사결정 필요.

## 5. AppBridge 표면

```ts
AppBridge.initMonitoring(): Promise<void>      // ready() 시 자동 호출
AppBridge.reportError(err, context): void      // 수동 에러 리포트
```

(WhaTap 호출은 브릿지 내부에 숨김. 앱 코드는 벤더를 모름.)

## 6. 배선 체크리스트

1. `scripts/lib/config.mjs` — `KNOWN_APM_PROVIDERS` 에 `'whatap'` 추가됨 ✅
2. `scripts/generate-app.mjs`:
   - APM 슬롯 자동배선이 현재 없음 — `MONITORING_PLUGINS.apm.whatap` 신설
   - `bakedConfig()` 에 `WHATAP_*` 환경변수 주입
3. `template/bridge/dist/index.js`:
   - `initMonitoring()` 에 `cfg.monitoring.apm.provider === 'whatap'` 분기
   - WhaTap SDK init 호출
   - `reportError()` 에서 WhaTap 으로도 전송
4. Android: WhaTap Android Agent (`com.whatap:agent-mobile-android`)
5. iOS: WhaTap iOS SDK pod

## 7. 콘솔 등록

- **WhaTap 대시보드** → 프로젝트 → APM/Mobile 앱 추가
- Project Access Key + PCode 발급
- (선택) 알림 / 슬랙 연동

## 8. TODO

- [ ] **결정 우선**: 앱 APM 으로 WhaTap 을 쓸지, 아니면 Firebase Performance Monitoring 으로 갈지
  (Flutter 앱은 후자도 명시 안 됨 — 사실상 Crashlytics 만)
- [ ] WhaTap 모바일 SDK 의 Capacitor 호환성 확인 — Android/iOS 둘 다 지원하는지
- [ ] 웹/앱이 같은 WhaTap 프로젝트로 들어갈지 분리할지 (트래픽/세션 통계 영향)
- [ ] (만약 WhaTap 모바일 SDK 가 부담스러우면) **이 플러그인은 보류**, monitoring.apm.provider 를 null
  로 두는 것도 합리적 선택
