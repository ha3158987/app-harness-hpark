---
doc: 26
title: DEVICE-LAB — 빌드 버전별 기기 화면 테스트(에뮬레이터·시뮬레이터·실기기 + AI 에이전트)
category: 테스트
audience: 개발자
status: active
updated: 2026-10-13
---

# DEVICE-LAB — 빌드 버전별 기기 화면 테스트

앱(하네스 셸 + 원격 웹)을 **빌드 버전별로** 지원 기기에 띄우고, **상황**(다크·언어·글꼴·네트워크·회전·폴더블·권한·
백그라운드·딥링크·푸시)을 만든 뒤, **AI 에이전트가 화면을 직접 보고 눌러** 시나리오를 판정하는 환경.
사람·에이전트·CI 가 같은 명령 하나(`node lab/lab.mjs`)를 쓴다. 에이전트 절차는 스킬 [`device-test`](../.claude/skills/device-test/SKILL.md).

**자동화 범위:** 카탈로그에 등록된 기기와 작성된 시나리오를 검증한다. 현재 스위트는 `poptale-v2-dev` 전용이며,
33개 시나리오 중 Maestro 플로우는 11개다. 다른 앱에는 별도 스위트·테스트 데이터가 필요하다.
로그인 완주·스토어 결제·FCM 실수신은 계정·상품·백엔드·서명 빌드가 준비돼야 검증할 수 있다.
아래 §12는 당시의 검증 기록이며 전체 E2E 통과를 뜻하지 않는다.

---

## 0. 한눈에 — 4층

| 층 | 무엇 | 어디서 | 잡는 것 |
|---|---|---|---|
| ① 결정적 회귀 | Maestro 플로우(`lab/suites/<스위트>/flows/*.yaml`) | 로컬 · CI(기기 매트릭스 × 상황 프리셋) | 화면이 열리나·버튼이 있나·흐름이 끊기나 — 매 빌드 같은 결과 |
| ② AI 에이전트 탐색 | Claude 가 시나리오(`scenarios.json`)를 읽고 mobile-mcp/랩 명령으로 조작·스크린샷·판정 | 로컬(이 PC·맥) · CI(선택 `ai`) | 레이아웃 깨짐·잘림·어색한 흐름·콘솔 오류 — 사람이 눈으로 보던 것 |
| ③ 실기기 | Firebase Test Lab Robo — 한국 판매 갤럭시(S25·A36·Z Flip6·Z Fold6) | 클라우드 | 실제 하드웨어 성능(중급기 끊김)·One UI·제조사 WebView·실행 크래시 |
| ④ iOS | 같은 랩 명령(simctl) + 맥의 Claude 컴퓨터 유즈 | 별도 맥 · CI(macos-26) | 노치·다이내믹 아일랜드·홈 버튼 기기·WKWebView |

```
빌드 버전(로컬 빌드 · CI 아티팩트 · 아무 APK)  ──▶  lab/.builds/<slug>/<버전+코드>/<플랫폼-변형>/
                                                         │ lab install
기기 카탈로그(lab/devices.json) ── lab up ──▶ 에뮬레이터/시뮬레이터 ◀── lab situation(상황)
                                                         │
             ┌───────────────────────────────┬───────────┴──────────────┐
        lab flow / matrix (Maestro)     에이전트(mobile-mcp · lab ui/tap/web)    lab cloud (FTL 실기기)
             └───────────────────────────────┴──────────────────────────┘
                                   lab/.runs/<런>/  results.jsonl · shots/ · report.html
```

## 1. 파일 지도

| 경로 | 내용 |
|---|---|
| `lab/lab.mjs` | CLI 진입점 — `node lab/lab.mjs help` |
| `lab/devices.json` | **기기 카탈로그 정본** — Android 9 · iOS 8, 세트 `smoke`·`kr`·`full` (근거 docs/19) |
| `lab/lib/android.mjs` · `ios.mjs` | 에뮬레이터(adb·avdmanager) · 시뮬레이터(simctl) 계층 |
| `lab/lib/situations.mjs` | 상황 → 플랫폼별 명령. 못 하는 건 `지원 안 함`(이유·대안)으로 돌려준다 |
| `lab/lib/web.mjs` | WebView 를 CDP 로 — 화면 요소·현재 URL·가로 넘침·콘솔 오류·한글 입력(디버그 빌드) |
| `lab/lib/builds.mjs` | 빌드 보관소(버전별) · 로컬 빌드 · CI 아티팩트 받기 · APK/.app 가져오기 |
| `lab/lib/runs.mjs` | 런(증거 폴더)·판정 기록·HTML 리포트 |
| `lab/lib/cloud.mjs` | Firebase Test Lab 실기기 |
| `lab/mcp/mobile-mcp.mjs` · `.mcp.json` | 에이전트용 MCP 서버(mobile-mcp 1.0.8 고정) 런처 |
| `lab/suites/poptale-v2/` | 팝테일 V2 스위트 — `suite.json`(테스트 데이터·딥링크·언어별 문구·상황 프리셋) · `scenarios.json`(33개) · `flows/`(Maestro 11개) |
| `.github/workflows/device-lab.yml` | CI — 빌드(버전별 아티팩트 90일) → 기기 매트릭스 → (선택) AI 탐색 |
| `lab/.builds/` · `lab/.runs/` | 로컬 산출물(git 제외) |

## 2. 설치

### Windows PC (Android) — 이 PC 기준 실측
1. JDK 21(`JAVA_HOME`), Node 22+(`.nvmrc`), `npm ci`(mobile-mcp 포함).
2. Android SDK `C:\dev\.android-sdk`(cmdline-tools · platform-tools · emulator). **사용자 폴더가 한글이면** 랩이 AVD·사용자 홈·Gradle 캐시를
   SDK 옆(`C:\dev\.android-avd` 등)으로 자동으로 옮긴다(에뮬레이터·Gradle 이 비 ASCII 경로를 못 읽음).
3. 가속: `emulator -accel-check` → `WHPX ... usable`(Hyper-V 켜진 PC 는 WHPX). GPU 기본은 맥 `host`·그 밖(Windows·CI) `swiftshader_indirect`(소프트웨어 렌더러, `LAB_GPU`·`--gpu` 로 바꿈). Windows `host` 는 가볍지만 스크린샷이 흰색/검정으로 깨지고, `angle_indirect` 는 에뮬레이터 37.2 가 무효값으로 보고 auto(=swiftshader)로 바꾼다(실측).
4. 시스템 이미지: `lab create <세트>` 가 없으면 받는다. 한 번에 받기: `sdkmanager --package_file=<목록>`(Git Bash 에서 `;` 인자는 cmd 가 쪼갠다).
5. Maestro 2.11.0: GitHub 릴리스 `maestro.zip`(sha256 `5384593c…283a`)을 `C:\dev\.tools\maestro` 에 풀기. 랩은 그 경로 → `MAESTRO_BIN` → PATH 순으로 찾는다.
6. 확인: `node lab/lab.mjs doctor`.

### 맥 (iOS + Android)
Xcode 26(+ iOS 18·17 시뮬레이터 런타임 — Settings › Components), CocoaPods, Node 22+, JDK 17+, Maestro(같은 zip → `~/maestro/bin` 을 PATH),
`gh`(CI 빌드 받기). 이 레포 클론 → **`bash lab/setup/mac.sh`**(점검·Maestro 해시 검증 설치·`npm ci`·doctor·스모크 시뮬레이터 생성, `--runtimes` 면 iOS 18·17 런타임까지).

### CI
`device-lab.yml` 이 러너마다 설치한다(Maestro 는 해시 검증). 추가 시크릿 없이 ①층이 돈다. ②층(AI)은 §7.

## 3. 기기 카탈로그 · 세트

정본은 `lab/devices.json`. 레이아웃을 가르는 건 기종명이 아니라 **CSS 폭(dp)·종횡비·인셋**이라 dp 폭을 함께 둔다.

Android 이미지 ABI 기본값은 `auto`다. Apple Silicon(arm64)은 `arm64-v8a`, x64 호스트는 `x86_64`를 사용한다.
기기별 `abi`를 명시하면 그 값을 우선하며, 이미지 설치가 실패하면 AVD 생성을 진행하지 않는다.

| id | 기기 | dp | 왜(요약) |
|---|---|---|---|
| `and17-pixel9` | Pixel 9 · Android 17 | 412 | 가장 새 OS |
| `and16-s25` | Galaxy S25급 · 16 | 384 | 국내 주력 플래그십 · edge-to-edge 강제 |
| `and15-a36` | Galaxy A36급 중급기 · 15 | 384 | 판매 주력(화면·OS). **성능은 실기기 ③층** |
| `and16-flip` | Z Flip급 플립 폴더블 · 16 | 360 | 접기·펼치기 |
| `and16-fold` | Z Fold급 북 폴더블 · 16 | 851 | 대화면 ↔ 커버 화면 |
| `and16-tablet` | Pixel Tablet · 16 | 1280 | 태블릿 |
| `and14-small` | 소형 360dp · 14 | 360 | 가장 좁은 주력 폭 |
| `and13-s22` | Galaxy S22급 · 13 | 360 | 알림 런타임 권한 첫 버전 |
| `and11-legacy` | 구형 저가 · 11 | 360 | 오래된 WebView 폴백 |
| `ios26-17pro` · `ios26-17promax` · `ios26-air` | iPhone 17 Pro / Pro Max / Air · iOS 26 | 402·440·420 | 다이내믹 아일랜드·Liquid Glass |
| `ios26-16e` | iPhone 16e · 26 | 390 | 노치 |
| `ios26-se3` | iPhone SE(3세대) · 26(없으면 18) | 375 | 홈 버튼·가장 작은 화면 |
| `ios18-14` · `ios17-13mini` | iPhone 14 · 18 / 13 mini · 17 | 390·375 | 구 WebKit 폴백 |
| `ios26-ipadmini` | iPad mini · 26 | 744 | 아이패드 |

세트: `smoke`(S25·A36·17 Pro·SE3) · `kr`(국내 주력 7종) · `full`(전부). 같은 기기에서 갤럭시 '디스플레이 크기'처럼 dp 를 바꾸려면 상황 `display-size 360`.

실기기(③층) 별칭: `a36`·`a16`·`s25`(KR)·`s24`·`flip6`(KR)·`fold6`(KR)·`flip4`·`pixel9` — `lab/lib/cloud.mjs`.

## 4. 빌드 버전

보관소 `lab/.builds/<slug>/<버전+코드>/<플랫폼>-<변형>/`(app.apk | App.app + meta.json: startUrl·커밋·출처).

| 출처 | 명령 | 언제 |
|---|---|---|
| 지금 코드로 빌드 | `lab build <slug> --platform android\|ios [--start-url URL]` | 개발 중. iOS 는 맥. `--start-url` 로 다른 웹 배포(PR 미리보기)를 같은 셸로 |
| CI 가 만든 버전 | `lab fetch <slug> [--run <id>]` | 태그 `<slug>-v<버전>` 마다 device-lab.yml 이 디버그 APK·시뮬레이터 .app 을 90일 보관 |
| 아무 APK | `lab import <slug> <apk>` | 릴리즈 APK·Firebase 배포본·GCS 이력 사본(`android/archive/`) |

설치: `lab install <기기> <slug> --version <2.0.0+3|코드|latest> [--fresh]`. 업그레이드 경로(시나리오 S51)는 이전 버전 `--fresh` → 새 버전(`--fresh` 없이).
디버그 빌드만 WebView 검사(CDP)가 된다 — 릴리즈 빌드는 화면·접근성으로 판정한다.
iOS 시뮬레이터 빌드는 서명이 필요 없다. Firebase 앱인데 iOS plist 시크릿이 없으면 **자리표시 plist** 를 넣는다(앱은 뜨고 FCM 토큰만 없음 — `prepareIosFirebasePlist`).

## 5. 상황

`lab situations` 로 목록, `lab situation <기기> <slug> <이름> [인자…]` 로 적용, `reset` 으로 되돌림. 스위트 프리셋(`suite.json presets`)은 이것들의 묶음이다.

| 상황 | Android | iOS 시뮬레이터 |
|---|---|---|
| `theme dark\|light` | `cmd uimode night` | `simctl ui appearance` |
| `locale ko\|en\|ja\|zh-Hant\|es-419` | 13+: 앱별 언어(`cmd locale set-app-locales`) · 12-: 시스템(root) | 시스템 언어 + 앱 재시작 |
| `font 1.3` | `font_scale`(WebView textZoom 도 커진다) | Dynamic Type 단계로 근사 |
| `display-size <dp>` | `wm density` (갤럭시 디스플레이 크기) | 지원 안 함 — 다른 기종 |
| `network off\|on\|slow` | `svc wifi/data` · 에뮬레이터 콘솔 EDGE | 지원 안 함 — 맥 Network Link Conditioner |
| `rotate portrait\|landscape` | `user_rotation` | Simulator 메뉴 단축키(AppleScript) |
| `fold open\|closed\|half` | 에뮬레이터 콘솔 `fold`/`unfold`/`posture` (폴더블 AVD) | 지원 안 함 |
| `permission grant\|revoke\|reset notifications\|camera` | `pm grant/revoke` · 플래그 초기화(프롬프트 다시) | `simctl privacy`(알림은 불가 → 재설치) |
| `background` · `foreground` · `restart` | HOME · 런처 · force-stop | 설정 앱 앞으로 · `simctl launch` |
| `process-death` | 백그라운드에서 `am kill`(OS 메모리 회수와 같은 경로) | `simctl terminate` |
| `deeplink <url\|이름> [cold]` | `am start -a VIEW -d … <pkg>` | `simctl openurl` |
| `push-tap <경로>` | FCM 알림 탭 인텐트 재현(`google.message_id` + `url`) → 브릿지 라우팅 | `simctl push`(실제 배너 → 탭) |
| `battery low\|ok` · `animations off\|on` · `clear-data` | `dumpsys battery` · 애니메이션 배율 · `pm clear` | 지원 안 함(clear-data → `--fresh` 재설치) |

`push-tap` 은 탭 이후 라우팅만 본다. 브릿지는 로그인 뒤 `registerPush()` 에서 리스너를 단다(게스트면 보류 = 정상). 알림 '표시'는 FCM 실발송 빌드로.

## 6. iOS — 별도 맥에서 Claude 컴퓨터 유즈로

맥에서도 같은 랩 명령을 쓴다. 차이는 **화면 조작**: 시뮬레이터 창을 Claude 컴퓨터 유즈가 직접 보고 누른다(또는 mobile-mcp 의 iOS 지원).

1. 설치(§2 맥) → `node lab/lab.mjs doctor` 에서 iOS 카탈로그가 ✓ 인지.
2. 빌드: `lab fetch poptale-v2-dev`(CI 가 만든 그 버전의 .app) 또는 `lab build poptale-v2-dev --platform ios`.
3. `lab run start --suite poptale-v2 --slug poptale-v2-dev --devices ios26-17pro,ios26-se3`
4. `lab up ios26-17pro`(Simulator 창이 열린다) → `lab install ios26-17pro poptale-v2-dev --fresh` → `lab launch ios26-17pro poptale-v2-dev`
5. Claude 데스크톱(맥)에서 컴퓨터 유즈 권한: **Simulator** 앱(+ 터미널은 클릭 등급이라 명령은 Bash 도구로). 그다음 아래 지시로 시작한다.

```text
.claude/skills/device-test/SKILL.md 절차로 iOS 테스트를 한다. 기기 ios26-17pro(Simulator 창), slug poptale-v2-dev,
스위트 poptale-v2. scenarios.json 의 P0 를 차례로: 상황은 lab situation 으로 만들고, 화면은 Simulator 창을 보고 눌러라.
단계마다 lab shot ios26-17pro --scenario <id> --step <이름>, 판정은 lab verdict. 끝나면 lab report · lab summary.
자격증명 입력·약관 동의·구매는 하지 말고 BLOCKED.
```

- 스크린샷은 `lab shot`(simctl — 창 크기와 무관한 원본 해상도)이 컴퓨터 유즈 화면보다 정확하다. 판정 증거는 `lab shot` 으로 남긴다.
- WKWebView 콘솔·DOM: 맥 Safari › 개발자 › 시뮬레이터 › 해당 페이지(디버그 빌드는 Capacitor 가 inspectable 로 연다).
- iOS 시뮬레이터가 못 하는 것: 네트워크 상황(맥 전체에 Network Link Conditioner), 알림 권한 재설정(재설치), 캡처 차단(OS 미지원 — no-op 정상), ATT 팝업(불안정 — 실기기).
- 맥에서 Maestro 로 iOS 회귀만 돌리려면: `lab flow ios26-17pro poptale-v2-dev`.

## 7. AI 에이전트

- **로컬**: 이 레포를 Claude Code 로 열면 `.mcp.json` 의 `mobile` MCP(mobile-mcp)가 붙는다 — `mobile_take_screenshot`·`mobile_list_elements_on_screen`·좌표 탭·스와이프·입력·버튼·URL 열기·회전·폴더블. 스킬 `device-test` 가 절차.
  WebView 안 요소가 접근성 트리에 안 보일 때는 `lab ui <기기> <slug>`(CDP 로 DOM 의 링크·버튼을 화면 좌표로 환산 — 접근성 좌표와 1px 이내 일치 실측).
- **판정 기록**: `lab verdict` → `results.jsonl` → `lab report`(HTML)·`lab summary`(마크다운).
- **CI**(`device-lab.yml` 수동 실행 `ai: true`): `anthropics/claude-code-action@v1` 이 S25급 에뮬레이터에서 P0 시나리오를 돈다. 레포 시크릿 `ANTHROPIC_API_KEY`(또는 `CLAUDE_CODE_OAUTH_TOKEN`)가 있어야 한다 — 없으면 건너뛴다. **키 등록·비용은 사람이 결정**한다(시크릿 값은 레포에 두지 않는다 — 09).

## 8. 시나리오·플로우 쓰기

- 시나리오(`scenarios.json`): `id`·`area`·`title`·`situations`·`steps`(자연어)·`expect`(판정 항목 한 줄씩)·`evidence`·`flow`(있으면 Maestro 짝)·`platforms`·`devices`(카탈로그 태그)·`priority`.
- 플로우(`flows/*.yaml`): 화면 문구는 **`${L_<키>}`** 로 쓴다 — 프리셋의 언어(`locale`)에 맞는 문구를 랩이 `suite.json labels` 에서 넘긴다(웹 메시지 팩 키를 주석에 적어 둠). 테스트 데이터는 `${CONTENT_ID}` 등, 딥링크는 `${LINK_<이름>}`.
- 공용 도우미 `_open-home.yaml`(앱 새로 띄워 홈까지)·`_dismiss-popup.yaml`(홈 이벤트 팝업 닫기) — 태그 `helper` 는 단독 실행되지 않는다. Android 전용은 태그 `android-only`.
- 스크린샷 이름 `<플로우>--<단계>` 로 찍으면 리포트에서 해당 시나리오 아래로 모인다.

## 9. CI — `device-lab.yml`

| 트리거 | 플랫폼 · 기기 | 비고 |
|---|---|---|
| 태그 `<slug>-v<버전>` | 둘 다 · smoke | 그 버전 랩 빌드 아티팩트(90일) — `lab fetch` 로 어디서든 같은 버전 |
| 수동(Actions › device-lab) | 선택 · 세트/ id · 프리셋 · start_url · ai | `full` × 여러 프리셋은 비용 주의 |
| PR(`lab/**` 등) | Android smoke | 랩 코드 회귀. 맥 러너는 안 씀 |

잡: `plan` → `build-android`(ubuntu) / `build-ios`(macos-26, 시뮬레이터 .app) → `test-android`(KVM 에뮬레이터, 기기별 병렬) / `test-ios` → (선택) `ai-explore`.
결과: 잡 요약 표 + 아티팩트 `lab-run-<기기>`(report.html·스크린샷·JUnit·Maestro 로그).
HTML 리포트는 기기·시나리오·상황별 결과를 따로 유지한다. 같은 상황의 재시도만 마지막 결과로 갱신한다.
백엔드 사전 점검 실패는 `BLOCKED`로 기록하고 종료 코드 2를 반환한다. CI 성공을 E2E 통과로 오인하지 않도록 한다.

Android CI는 사용하지 않는 사전 설치 .NET SDK(`/usr/share/dotnet`)를 **일회용 테스트 러너에서만**
정리해 디스크 공간을 확보한다(회귀·AI 탐색 모두). 로컬 파일·Android SDK는 정리 대상이 아니다.
Android API 24 이상은 설정을 낮춰도 데이터 영역을 최소 6 GiB로 늘리고, 생성 시 20% 여유 공간을 요구한다.
따라서 `dataMb`를 3 GiB로 줄이는 방법은 효과가 없다. 2026-10-13 CI에서는 시스템 이미지 설치 후
여유 공간이 6449~7241 MiB로 줄어 필요한 7373 MiB를 확보하지 못했다.
시작 프로세스가 종료되면 즉시 로그를 보고하며, CI 아티팩트에도 `emulator-*.log`를 보존한다.
Maestro 결과가 없거나 도구 오류가 있으면 통과로 세지 않는다. JUnit의 `failure`는 `FAIL`, `error`는 `BLOCKED`,
`skipped`는 `SKIP`로 기록하며 실제 실행된 플로우가 하나도 없으면 실행을 성공 처리하지 않는다.
비용(비공개 레포): Linux 2코어 $0.006/분 · macOS $0.062/분. Android 기기 1대 × 프리셋 1개 ≈ 20~30분.

## 10. 실기기 — Firebase Test Lab

```bash
node lab/lab.mjs cloud poptale-v2-dev --models a36,flip6,fold6,s25 [--version 2.0.0+3] [--timeout 300s]
```
Robo 가 앱을 자동으로 탐색하며 실행·크래시·스크린샷·영상·성능을 남긴다(결과 링크·GCS 경로 출력, 열린 런이 있으면 판정도 기록).
WebView 화면은 Robo 가 깊이 못 들어간다 — 실기기층은 "실제 갤럭시에서 뜨나·죽나·끊기나"를 보고, 흐름 판정은 ①②층이 한다.
프로젝트 기본 `poptale-nonprod`(`LAB_FTL_PROJECT`). 비용: 실기기 하루 30분 무료, 이후 $5/시간. iOS 실기기는 6종뿐이라 XCTest 가 필요해 여기서는 다루지 않는다.

## 11. 함정 — 실측(2026-10-06)

| 증상 | 원인 | 대응 |
|---|---|---|
| `sdkmanager`/`avdmanager` 가 `Package android-30 not found` | Git Bash → cmd 가 `system-images;…` 의 `;` 를 쪼갬 | 랩은 Java 메인 클래스를 직접 부른다. 수동이면 `--package_file` |
| 'Bluetooth keeps stopping' · 'System UI / Process system isn't responding' | google_apis 이미지 블루투스 에뮬레이션 · 첫 부팅 뒤 구글 서비스 과부하 | 랩 부팅 기본 처리: 블루투스 끄기·불필요 구글 앱 끄기, 그리고 `lab up` 이 **게스트 부하가 4 아래로 가라앉을 때까지 기다리며 시스템 프로세스의 ANR 대화상자만 '기다리기'로 치운다**(앱 이름의 대화상자는 결함 증거라 두고, `lab health` 로 판정). `hide_error_dialogs` 는 시스템 ANR 은 못 막고 앱 크래시만 가려서 쓰지 않는다 |
| 중급기 흉내(코어 2)에서 Maestro 드라이버가 ANR 로 죽음 | 바쁜 호스트 + 2코어 게스트 | 코어 수로 성능을 흉내 내지 않는다(실기기 ③층). `MAESTRO_DRIVER_STARTUP_TIMEOUT` 240초 |
| 플로우가 홈 탭을 못 찾음 | 홈 이벤트 팝업(모달)이 뒤 화면을 접근성 트리에서 숨김 | `_dismiss-popup` 먼저, 대기는 `${L_OK}\|${L_WEBNOVEL}` |
| 딥링크 플로우가 '제목 보임'을 통과했는데 다음 단계 실패 | 콜드 스타트 딥링크는 홈을 거쳐 이동 — 홈에도 같은 작품 카드(최근 본)가 있다 | 목적 화면에만 있는 요소(상세 = '1화 무료로 읽기 시작')를 기다린다 |
| 검색 입력칸을 placeholder 로 못 누름 | 접근성 이름은 숨김 label(`search.input.label` = 검색어) | 문구 `L_SEARCH_INPUT` |
| `obscuredControls` 에 가로 스크롤 줄 밖 탭이 '가려짐'으로 나옴 | 스크롤로 닿는 항목을 가려짐으로 셌다(10-06 '탭 불가' 오판) | 이제 `scrolledOutControls` 로 따로 센다 — 결함이 아니라 '더 있다는 표시가 있나'를 볼 대상 |
| 글꼴 상황(`font`)에서 rem 으로 거는 CSS 조건이 안 걸림 | 기기 WebView 는 글자만 키우고 rem·em·ic 길이는 그대로(ch·ex·cap·lh 만 커짐, 10-07 실측) | 웹은 ch 로 조건을 건다. Playwright 로 흉내 낼 땐 루트를 두고 본문 글자만 키운다 |
| 공유를 눌렀는데 시트가 안 뜬 듯 | 과부하로 그리기만 늦음(최상단은 이미 ChooserActivity) | `lab health` 로 최상단 화면 확인 후 판정 |
| `lab web … go /my` 가 엉뚱한 곳 | Git Bash 가 `/my` 를 `C:/Program Files/Git/my` 로 바꿈 | `export MSYS_NO_PATHCONV=1` 또는 PowerShell |
| 스크린샷이 깨진 PNG | 바이너리 출력을 문자열로 변환 | 수정됨(`run(..., {encoding:'buffer'})`) |
| 이 PC 가용 RAM 0.5GB | 다른 작업의 Node·Gradle 데몬 + 에뮬레이터 2대 | 로컬은 동시 1~2대, `gradlew --stop`, 큰 매트릭스는 CI |
| 스크린샷이 전부 흰색/검정 | Windows `-gpu host`(gfxstream)에서 화면 읽기 실패(`glReadPixels error 0x506`) | 기본 `swiftshader_indirect`(`angle_indirect` 는 37.2 에서 무효값 → auto). GPU 모드를 바꾸면 그 AVD 는 처음부터 다시 부팅한다 |
| Maestro 첫 실행 2분 | JVM + 기기 드라이버 설치 | 한 번에 여러 플로우(`lab flow` 는 폴더째) |
| Maestro 가 도는 동안 mobile-mcp·`lab ui` 의 요소 덤프 실패(`no XML content found`) | 기기당 UiAutomation 연결은 하나 — Maestro 가 쥐고 있다 | 같은 기기에서 동시에 쓰지 않는다(플로우 끝난 뒤 탐색, 또는 기기를 나눈다) |
| mobile-mcp 를 쓴 뒤 Maestro 드라이버가 'did not start up in time' | mobile-mcp 기기 서버(`com.mobilenext.mobilecli.DeviceServer`, 30분 상주)가 UiAutomation 을 쥠 | `lab flow`·`matrix` 가 시작 전에 자동으로 내린다(mobile-mcp 는 다음 호출 때 다시 띄움) |
| mobile-mcp 가 `emulator-5554` 를 못 찾음 | mobile-mcp 는 기기를 AVD 이름으로 부른다 | `lab-<기기id>`(예: `lab-and16-s25`) — `mobile_list_available_devices` 로 확인 |

## 12. 지금 상태 · 남은 것

**2026-10-13 재검증(macOS · Android 16 ARM64 에뮬레이터 · poptale-v2-dev 2.0.0+1 debug)**

- Maestro baseline 11개 전부 통과. 검색 제출 뒤 `hideKeyboard`가 Back을 보내 검색 화면을 벗어나던 테스트를 수정했다.
- 로그인은 진입 화면까지만 확인했다. 실제 인증·결제·푸시 발송 및 iOS는 이 실행의 검증 범위에 없다.
- Android 15·16 CI 결과는 PR #67의 최종 커밋 실행에서 별도로 확인한다.


**검증(이 PC, 2026-10-06, 빌드 poptale-v2-dev 2.0.0+1 debug · 새 웹 dev 배포)**

| 층 | 결과 |
|---|---|
| ① Maestro(S25급·Android 16) | 11개 중 7 통과(상세·뷰어·딥링크·하단탭·헤더탭·뒤로 체인·로그인 진입·AI툰 시연 등). 실패 4건은 전부 느린 환경의 대기 부족 → 플로우 수정. 재실행은 폴더블 동시 부팅으로 기기 서버가 죽어 BLOCKED — 단독 재실행 필요 |
| ② 에이전트 탐색(Z Flip급 360dp) | PASS: 첫 실행·넘침·언어(ja·es)·접기/펼치기. **FAIL 2 → 둘 다 수정·재검증 PASS(10-07)**: 큰 글꼴(1.3·2.0)에서 헤더 'AI툰' 탭이 탭 줄 밖으로 밀림(스와이프로만 닿고 알아채기 어려움 — 처음 '탭 불가'로 적은 건 과장) → poptale-web-v2 #12·#14 · 오프라인 실행 시 셸 대신 WebView 기본 오류 페이지 → app-harness #68. BLOCKED: 22시 dev API 종료(503) 이후 화면 |
| ③ 실기기(FTL Robo) | Galaxy A36 5G · Z Flip6(KR) 각 180초 — Passed |
| 에이전트 도구 | mobile-mcp 1.0.8: 기기 인식·화면 요소(WebView 본문 포함)·스크린샷 확인. `lab ui <기기> <slug>` DOM 좌표 = 접근성 좌표 ±1px |

**사람이 정할 것**
1. CI AI 탐색용 Anthropic 키 시크릿(§7) — 등록·비용 결정.
2. 테스트 계정 — SNS 로그인 완주·푸시 권한·업그레이드 시 로그인 유지 시나리오(S31·S48·S49·S51)는 계정 없이는 BLOCKED.
3. dev 웹 배포의 `NEXT_PUBLIC_APP_OAUTH_SCHEMES` 가 비어 있다 → 앱 안 SNS 로그인 복귀가 막힐 것(poptale-web-v2 deploy-dev.yml build-arg).
4. (해결) 큰 글꼴 — 웹이 글자에 비해 좁을 때 여백을 줄이고(ch 컨테이너 쿼리), 그래도 넘치면 흐림·현재 탭 보이기(poptale-web-v2 #12·#14).
5. (머지 완료) 오프라인 셸 — 브릿지가 네트워크 오류일 때만 셸을 띄운다(app-harness #68, 2026-10-12 머지. 적용에는 앱 재빌드 필요).
6. dev API 는 평일 08~22시만 — 밤·주말 테스트는 `--scaling=1` 로 켜야 한다(§11, suite preflight 가 알려 줌).
7. poptale-v2-dev 의 Firebase 등록(실 푸시 표시까지 보려면) · 웹 정식 주소(web.dev.poptale.ai)가 열리면 startUrl 교체.
