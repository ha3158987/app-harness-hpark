---
name: device-test
description: 빌드 버전별 앱을 에뮬레이터·시뮬레이터(지원 기기 카탈로그)에 띄우고, 상황(다크·언어·글꼴·네트워크·회전·폴더블·권한·백그라운드·딥링크·푸시)을 만들어, 에이전트가 화면을 직접 보고 눌러 시나리오를 판정·리포트한다. "기기 테스트", "에뮬레이터로 테스트", "앱 화면 테스트", "실기기처럼 눌러 봐", "이 빌드 버전 테스트", "디바이스 랩", "QA 돌려" 요청이면 이 스킬을 쓴다. iOS 는 맥에서만.
---

# device-test — 디바이스 랩으로 앱을 직접 눌러 보며 테스트

정본 문서: [`docs/26-DEVICE-LAB.md`](../../../docs/26-DEVICE-LAB.md) — 처음이면 §1~§3 을 먼저 읽는다.
모든 조작은 `node lab/lab.mjs <명령>` (이하 `lab`) 하나로 한다. 직접 adb/simctl 을 조립하지 마라 — 랩이 경로·환경(한글 홈 폴더 우회 등)을 잡아 준다.

## 0. 원칙

- **판정은 증거로.** 시나리오의 expect 한 줄마다 스크린샷(`lab shot`) 또는 상태(`lab web state`·`lab health`)로 확인하고 판정한다. 보지 않은 것을 PASS 로 적지 않는다.
- **FAIL = 앱 결함만.** 환경 탓(Chrome 첫 실행 약관, google_apis 이미지에 Play 결제 없음, 자격증명 없음, 호스트 과부하)은 `BLOCKED`, 그 기기에 해당 없음은 `SKIP`.
- FAIL 로 적기 전에 한 번 더: `lab health <기기> <slug>` — `hint`(게스트 부하 높음)가 있으면 잠시 기다려 재시도한다. 공유 시트가 늦게 뜬 것을 결함으로 오판한 적이 있다(2026-10-06, 최상단은 이미 ChooserActivity 였다).
- **하지 않는 것:** 비밀번호·카드번호 입력, 약관·권한 '동의'를 사람 대신 누르기(앱의 권한 프롬프트 허용/거부는 시나리오가 요구하면 된다), 구매 버튼, 계정 생성. 필요하면 BLOCKED 로 남기고 사람에게 요청한다.
- 로컬 PC 는 동시에 **1~2대**만 띄운다(에뮬레이터 1대 ≈ RAM 3~4GB). 큰 매트릭스는 CI(`device-lab.yml`)에 맡긴다.

## 1. 준비

```bash
node lab/lab.mjs doctor                 # SDK·가속·이미지·Maestro·AVD 점검
node lab/lab.mjs devices                # 카탈로그(기기 id·dp 폭·상태) — 세트: smoke · kr · full
node lab/lab.mjs builds <slug>          # 보관된 빌드 버전
```

빌드가 없으면 하나를 고른다:
- 지금 코드: `lab build <slug> --platform android` (iOS 는 맥에서 `--platform ios`)
- CI 가 만든 특정 버전: `lab fetch <slug> [--run <id>]` (device-lab.yml 의 `lab-<slug>-<플랫폼>` 아티팩트)
- 아무 APK(릴리즈·Firebase 배포본): `lab import <slug> <apk>`
- 다른 웹 배포(PR 미리보기 등)를 같은 셸로: `lab build <slug> --start-url <https://…>`

## 2. 런 열기 → 기기 → 설치

```bash
node lab/lab.mjs run start --suite <스위트> --slug <slug> --version <버전|latest> --devices <세트|id,…>
node lab/lab.mjs up <기기>                      # Android 헤드리스(사람이 볼 땐 --window), iOS 는 Simulator 창
node lab/lab.mjs install <기기> <slug> --fresh  # 업그레이드 경로를 볼 땐 --fresh 없이 이전 → 새 버전 순서로
node lab/lab.mjs situation <기기> <slug> reset
```

스위트 = `lab/suites/<id>/` (suite.json: 테스트 데이터·딥링크·문구·상황 프리셋, scenarios.json: 시나리오, flows/: Maestro).

## 3. 결정적 회귀 먼저(Maestro)

```bash
node lab/lab.mjs flow <기기> <slug> [--preset dark] [--flow detail]
```
플로우 결과는 런에 자동 기록된다(시나리오 id 와 연결). 실패한 플로우는 4단계에서 사람 눈으로 다시 본다.

## 4. 에이전트 탐색 — 시나리오별

`scenarios.json` 에서 대상을 고른다(`priority` P0 → P1 → P2, `platforms`·`devices` 태그가 맞는 기기만). 시나리오마다:

1. **상황 만들기**: `situations` 항목을 차례로 `lab situation <기기> <slug> <이름> [인자…]`.
   인자에 스위트 변수·딥링크 이름을 쓸 수 있다: `deeplink viewer-scheme cold`, `push-tap /detail/${CONTENT_ID}`.
   ⚠ 결과가 `지원 안 함` 이면 그 시나리오는 SKIP(이유 기록).
2. **조작**: 화면을 보고 누른다.
   - MCP 가 있으면(`.mcp.json` 의 `mobile` 서버): `mobile_take_screenshot` · `mobile_list_elements_on_screen` · `mobile_click_on_screen_at_coordinates` · `mobile_swipe_on_screen` · `mobile_press_button` · `mobile_open_url`.
   - 없거나 WebView 안 요소가 안 보이면 랩 명령(Android): `lab ui <기기> <slug>`(◆ = WebView DOM 요소, 좌표는 화면 px) → `lab tap <기기> <x> <y>` 또는 `lab tap <기기> --text "문구" --slug <slug>` · `lab type <기기> <slug> "한글"`(비 ASCII 는 CDP — 디버그 빌드) · `lab key <기기> back` · `lab swipe <기기> up`.
   - iOS(맥): Simulator 창을 컴퓨터 유즈로 보고 누르거나 mobile-mcp. 스크린샷은 `lab shot`.
3. **증거**: 단계마다 `lab shot <기기> --scenario <시나리오id> --step <이름>`.
4. **상태 확인**(Android 디버그 빌드):
   - `lab web <기기> <slug> state` — url·lang·다크 여부·뷰포트·**가로 넘침**·**`obscuredControls`(헤더·내비·탭의 버튼이 화면 밖·잘림·가려짐)**·네이티브 여부·열린 대화상자 수. 페이지 넘침이 0 이어도 헤더가 잘라내면 여기서만 잡힌다(큰 글꼴에서 'AI툰' 탭이 검색 뒤로 숨은 사례)
   - `lab web <기기> <slug> console 8000` — 조작 직전에 켜 두고 그 사이 콘솔 오류·미처리 예외 수집
   - `lab health <기기> <slug>` — 앱 생존·최상단 화면·캡처 차단 창 수·최근 크래시/ANR·게스트 부하
   - `lab logs <기기> <slug>` — WebView 콘솔·Capacitor·크래시 로그
5. **판정**: `lab verdict <기기> <시나리오id> PASS|FAIL|BLOCKED|SKIP --note "무엇을 봤나" [--issue "결함 한 줄"] [--situations "dark,font1.3"]`

캡처 차단(뷰어)은 Android 에서 **스크린샷이 검게 나오는 것이 정상**이다(PASS 증거). iOS 는 OS 가 막지 못한다(no-op, FAIL 아님).

## 5. 마무리

```bash
node lab/lab.mjs report     # lab/.runs/<런>/report.html — 기기×시나리오 표 + 스크린샷
node lab/lab.mjs summary    # 마크다운 요약(사용자 보고·PR 댓글)
node lab/lab.mjs down all   # 메모리 반납
```

사용자에게는: FAIL 목록(시나리오·기기·상황·증거 스크린샷 경로·재현 명령) → BLOCKED(사람이 풀 것) → 통과 범위 순으로 보고한다.
결함이 웹 쪽이면 `poptale-web-v2` 등 해당 레포, 셸(네이티브)이면 이 레포 이슈로 분리한다.

## 6. 함정(실측)

- Git Bash 에서 `/my` 같은 인자는 `C:/Program Files/Git/my` 로 바뀐다 → `export MSYS_NO_PATHCONV=1` 또는 PowerShell.
- 첫 콜드 부팅 뒤 10~15분은 구글 서비스가 게스트 CPU 를 먹는다. `lab up` 이 불필요 앱을 끄고 부하가 가라앉을 때까지 기다리며 시스템 ANR 대화상자('System UI isn't responding')만 치운다. 그래도 보이면 `Wait`. 앱 이름이 든 대화상자는 결함 증거다 — 치우지 말고 스크린샷.
- 홈 이벤트 팝업은 모달이라 열려 있는 동안 뒤 화면 요소가 접근성 트리에서 숨는다 — 먼저 닫는다.
- uiautomator 는 WebView 안을 늦게·가끔만 본다 → `lab ui <기기> <slug>`(DOM 기반)가 정확하다.
- 릴리즈 빌드는 WebView 디버깅이 꺼져 `lab web`·한글 `lab type` 이 안 된다 → 화면·접근성으로만 판정.
- mobile-mcp 는 기기를 AVD 이름 `lab-<기기id>` 로 부른다(`emulator-5554` 아님).
- Maestro(`lab flow`)가 도는 기기에서는 mobile-mcp·`lab ui` 요소 덤프가 실패한다(UiAutomation 은 기기당 하나) — 플로우가 끝난 뒤 탐색한다.
  반대로 mobile-mcp 를 쓴 뒤의 기기 서버는 `lab flow` 가 시작 전에 알아서 내린다.
