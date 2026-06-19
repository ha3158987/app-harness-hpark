# HOWTO-DEPLOY — 팀원용 배포 사용법

app-harness 로 앱을 테스터에게 배포하는 **실전 가이드**.
(인증 요소 설명·관리는 `CREDENTIALS.md`, CI 시크릿 등록은 `DEPLOY.md` 참조)

> TL;DR: **`app.config.json` 의 versionCode 올리고 → `git tag <slug>-v<버전>` 푸시 → 끝.**
> CI가 빌드·서명·업로드까지 자동. iOS=TestFlight / Android=Play 내부트랙. (정식 출시는 사람이 콘솔에서)

---

## 0. 전제 (이미 되어 있는 것)

- 조직 공유 인증은 **GitHub Secrets 에 이미 등록**되어 있다 (Android 검증 완료).
  → 평소 배포할 땐 **키 파일을 만질 일이 없다.**
- 배포하려는 앱은 `apps/<slug>/app.config.json` 이 있고, 스토어(Play/App Store Connect)에 앱 레코드가 등록돼 있다.

처음 셋업(조직 1회) 방법은 `CREDENTIALS.md §5` 참조.

---

## 1. 기존 앱을 새 버전으로 배포 (가장 흔한 경우)

### 1단계 — 버전 올리기 (필수)
`apps/<slug>/app.config.json` 의 `version` 을 올린다.

```json
"version": { "name": "1.0.1", "code": 2 }
```
- `code` (정수) 는 **이전 업로드보다 반드시 커야 한다** — 안 그러면 Play/App Store 가 거부한다.
- `name` 은 사용자에게 보이는 버전 문자열.
- `/bump-version` 스킬로도 가능.

### 2단계 — 태그 푸시 (= 배포 트리거)
```bash
git tag <slug>-v<버전> && git push origin <slug>-v<버전>
# 예)
git tag characterchat-dev-v1.0.1 && git push origin characterchat-dev-v1.0.1
```

태그 형식 = **`<slug>-v<버전>`** (반드시 `-v` 포함. 앞부분이 slug 로 파싱됨).

| 부분 | 의미 | 바꾸는 때 |
|---|---|---|
| `<slug>` | `apps/<slug>` 폴더명 (=앱) | 다른 앱 배포 시 |
| `<버전>` | 트리거 라벨 (실제 버전은 app.config.json) | 매 배포 |

→ 태그가 올라가면 CI(`.github/workflows/release.yml`)가 **양 플랫폼(android+ios)** 을 `internal` 트랙으로 자동 빌드·업로드한다.

### 3단계 — 결과 확인
- **Android**: Play Console → 테스트 → 내부 테스트 → 새 릴리즈가 **초안(draft)** 으로 올라옴 → "검토 후 출시"
- **iOS**: App Store Connect → TestFlight → 빌드 처리 후 테스터에게 노출

> 자동화는 **테스터까지만**. 정식 스토어 공개(심사 제출/프로덕션 승격)는 **사람이 콘솔에서** (안전 원칙).

---

## 2. 특정 플랫폼만 / 수동 배포

태그는 항상 양 플랫폼이다. **한쪽만** 돌리거나 즉석 실행하려면 **수동 트리거**:

```bash
# Android 만, 내부 트랙
gh workflow run release.yml --ref <브랜치> \
  -f slug=<slug> -f platform=android -f track=internal

# 진행 상황 보기
gh run watch <run-id> --exit-status
```

- `platform`: `android` | `ios` | `both`
- `track` (Android): `internal` | `beta`
- `--ref`: 앱 정의(app.config.json)가 있는 브랜치. (main 에 없으면 작업 브랜치 지정)

> Actions 탭 → release → "Run workflow" 로 클릭으로도 가능.

---

## 3. 새 앱 추가 (다른 서비스)

인증은 공유라 **새로 발급할 게 없다.** 2가지만:

1. `apps/<새slug>/app.config.json` 작성 (`/new-app` 스킬 권장) + 아이콘/스플래시 소스
2. Play Console / App Store Connect 에 앱 레코드 1회 등록 (bundleId/packageName = app.config 의 appId)

그 다음은 §1 과 동일하게 태그 푸시.

---

## 4. 로컬에서 직접 돌리기 (선택)

CI 안 쓰고 본인 맥에서 배포하려면, git 에 없는 **키 파일**을 보안 채널로 받아 `secrets/` 에 배치해야 한다 (배치 규칙: `secrets/README.md`).

```bash
cp fastlane/.env.example fastlane/.env   # 값 채우기
# secrets/ 에 .p8 / .json / .jks 배치
bundle exec fastlane android beta slug:<slug>   # 또는 ios beta
```

---

## 5. 트러블슈팅 (실제 겪은 것)

| 증상 | 원인 | 해결 |
|---|---|---|
| CI 가 generate-app/cap sync 에서 깨짐 | Node 20 (Capacitor 8 은 22 필요) | release.yml `node-version: '22'` (적용됨) |
| `validateSigningRelease FAILED — release.keystore not found` | keystore 경로를 app 모듈 기준으로 찾음 | generate-app 이 `rootProject.file()` 로 해석 (적용됨) |
| Play 가 업로드 거부 (versionCode) | versionCode 가 이전과 같거나 작음 | `app.config.json` 의 `version.code` 를 +1 |
| 업로드는 됐는데 테스터가 못 봄 | 초안(draft) 상태 | Play Console 에서 "검토 후 출시" |

---

## 요약 흐름

```
versionCode +1  →  git tag <slug>-v<버전>  →  git push origin <태그>
                                                      │
                                          CI: 빌드·서명·업로드 (internal/TestFlight)
                                                      │
                                          콘솔에서 검토 후 테스터 출시 (사람)
```
