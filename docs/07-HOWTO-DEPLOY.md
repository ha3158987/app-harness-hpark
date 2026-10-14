---
doc: 07
title: HOWTO-DEPLOY — 팀원용 배포 사용법
category: 빌드배포
audience: 배포담당자
status: active
updated: 2026-09-07
---

# HOWTO-DEPLOY — 팀원용 배포 사용법

app-harness 로 앱을 테스터에게 배포하는 **실전 가이드**.
(인증 요소 설명·관리는 `09-CREDENTIALS.md`, CI 시크릿 등록은 `08-DEPLOY.md` 참조)

> TL;DR: **`app.config.json` 의 versionCode 올리고 → `git tag <slug>-v<버전>` 푸시 → 끝.**
> CI가 빌드·서명·업로드까지 자동. 트리거 한 번에 **네 채널**이 나간다 —
> iOS=**TestFlight** / Android=**Firebase App Distribution**(테스터에게 즉시) + **Play 내부트랙**
> + **GCS 고정 링크**(QR 재사용). (정식 출시는 사람이 콘솔에서)
>
> 이 절차 전체(버전 bump → 커밋 → 트리거 → CI 감시 → 보고)를 대신 해주는 진입점이
> **`release-app` 스킬**이다 — "모바일 앱 새 버전 배포해줘". 스토어를 안 건드리고 사내 APK
> 링크만 갱신하려면 `publish-apk` 스킬.

---

## 0. 전제 (이미 되어 있는 것)

- 조직 공유 인증은 **GitHub Secrets 에 이미 등록**되어 있다 (Android 검증 완료).
  → 평소 배포할 땐 **키 파일을 만질 일이 없다.**
- 배포하려는 앱은 `apps/<slug>/app.config.json` 이 있고, 스토어(Play/App Store Connect)에 앱 레코드가 등록돼 있다.

처음 셋업(조직 1회) 방법은 `09-CREDENTIALS.md §5` 참조.

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

→ 태그가 올라가면 CI(`.github/workflows/release.yml`)가 **양 플랫폼(android+ios)** 을 자동 빌드·업로드한다.

### 3단계 — 결과 확인
- **Android / Firebase App Distribution**: 테스터에게 **바로** 뜬다. 초대 메일 또는 App Tester 앱에서
  새 버전 확인 → 설치. 콘솔에서 누를 것 없음. (Firebase 콘솔 → App Distribution 에서 배포 이력 확인)
- **Android / Play**: Play Console → 테스트 → 내부 테스트 → 새 릴리즈가 **바로 출시**된다(`release_status: 'completed'`).
  내부 트랙 테스터는 몇 분 뒤 Play 스토어에서 업데이트를 받는다. 콘솔에서 누를 것 없음
- **Android / GCS 고정 링크**: `APK_DIST_BUCKET_<SLUG>` 변수가 있으면 같은 URL 이 최신 APK 로 갱신된다
  (`https://storage.googleapis.com/<버킷>/android/<slug>.apk`). **뿌려둔 QR 은 그대로 유효** — 실행 요약(Job Summary)에 링크가 찍힌다
- **iOS**: App Store Connect → TestFlight → 빌드 처리 후 테스터에게 노출

> 자동화는 **테스터까지만**. 정식 스토어 공개(심사 제출/프로덕션 승격)는 **사람이 콘솔에서** (안전 원칙).

> **왜 채널이 둘인가**: Firebase 는 "지금 이 빌드를 팀이 깔아보는" 용도(TestFlight 대응), Play 내부
> 트랙은 "스토어 경로 그대로" 검증하는 용도다. Firebase 배포용 APK 는 **업로드 키**로 서명돼
> Play 배포본과 서명이 다르다 — 소셜 로그인·딥링크 지문 주의사항은 `08-DEPLOY.md §10`.

---

## 2. 특정 플랫폼만 / 수동 배포

태그는 항상 양 플랫폼이다. **한쪽만** 돌리거나 즉석 실행하려면 **수동 트리거**:

```bash
# Android 만, 내부 트랙
gh workflow run release.yml --ref <브랜치> \
  -f slug=<slug> -f platform=android -f track=internal

# 테스터에게만 급히 (Play 안 건드림)
gh workflow run release.yml --ref <브랜치> \
  -f slug=<slug> -f platform=android -f android_channel=firebase

# 진행 상황 보기
gh run watch <run-id> --exit-status
```

- `platform`: `android` | `ios` | `both`
- `track` (Android Play): `internal` | `beta`
- `android_channel`: `both`(기본) | `firebase` | `play`
- `firebase_groups`: Firebase 테스터 그룹 별칭 (기본 `aipia_internal`, 쉼표로 여러 개)
- `ios_channel`: `testflight`(기본) | `firebase` | `both`. Firebase는 Ad Hoc 프로파일에 등록된 iPhone만 설치할 수 있다.

글로벌 앱을 TestFlight와 양 플랫폼 Firebase에 함께 배포:
```bash
gh workflow run release.yml --ref <빌드-브랜치> \
  -f slug=poptale-global -f platform=both -f android_channel=firebase \
  -f ios_channel=both -f firebase_groups=aipia_internal
```
최초 iOS Firebase 배포 전에는 `fastlane ios regen_profile slug:poptale-global profile_type:adhoc`으로 앱·알림 확장 프로파일을 준비한다.
새 iPhone 테스터는 Firebase 초대를 Safari에서 열어 기기를 등록한다. 수집된 UDID를 Apple Developer에 등록한 뒤 같은 명령으로 프로파일을 갱신하고 iOS Firebase를 재배포한다. CI는 프로파일을 읽기만 하며 기기 등록은 자동으로 하지 않는다.
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
bundle exec fastlane android beta slug:<slug>       # Play 내부 트랙
bundle exec fastlane android firebase slug:<slug>   # Firebase App Distribution
bundle exec fastlane ios beta slug:<slug>           # TestFlight
```

---

## 5. 트러블슈팅 (실제 겪은 것)

| 증상 | 원인 | 해결 |
|---|---|---|
| CI 가 generate-app/cap sync 에서 깨짐 | Node 20 (Capacitor 8 은 22 필요) | 워크플로가 `.nvmrc`(=24)를 읽는다 — `node-version-file` (적용됨) |
| `validateSigningRelease FAILED — release.keystore not found` | keystore 경로를 app 모듈 기준으로 찾음 | generate-app 이 `rootProject.file()` 로 해석 (적용됨) |
| Play 가 업로드 거부 (versionCode) | versionCode 가 이전과 같거나 작음 | `app.config.json` 의 `version.code` 를 +1 |
| 업로드는 됐는데 테스터가 못 봄 (Play) | 테스터가 내부 트랙 옵트인 링크를 아직 수락 안 함 / 반영 지연(몇 분) | Play Console → 내부 테스트 → 테스터 탭의 옵트인 URL 로 참여시킨다 |
| 업로드는 됐는데 테스터가 못 봄 (TestFlight) | **수출 규정 준수 정보 누락** — 답하기 전엔 배포 안 됨 | 아래 §6 |
| 업로드는 됐는데 테스터가 못 봄 (Firebase) | 콘솔에 없는 테스터 그룹 별칭 | Firebase 콘솔의 그룹 별칭과 `firebase_groups` 일치 |
| Firebase 스텝이 `건너뜀` 으로 지나감 | 레포 변수 `FIREBASE_WIF_PROVIDER_<SLUG>` 또는 시크릿 `GOOGLE_SERVICES_B64_<SLUG>` 미등록 | `08-DEPLOY.md §10` 셋업 |
| Firebase APK 에서만 소셜 로그인 실패 | 업로드 키 지문이 각 소셜 콘솔에 미등록 (Play 배포본과 서명 키가 다름) | 업로드 키 SHA-1/256 도 등록 — `08-DEPLOY.md §10` |

---

## 6. iOS 수출 규정 준수 (TestFlight 의 숨은 게이트)

Play 쪽 "검토 후 출시" 클릭은 없앴지만(`release_status: 'completed'`), **iOS 에는 아직 하나 남아 있다.**

빌드를 올리면 App Store Connect 가 암호화 사용 여부를 묻는다. 답하기 전까지 그 빌드는
**"수출 규정 준수 정보 누락"** 상태로 테스터에게 안 나간다 — 업로드는 성공인데 아무도 못 받는다.

**없애는 법** — `app.config.json` 에 선언하면 `generate-app` 이 `Info.plist` 에 박아서 다시 묻지 않는다:

```jsonc
"ios": { "teamId": "3W889GYPRK", "usesNonExemptEncryption": false }
```

| 값 | `Info.plist` | 의미 |
|---|---|---|
| `false` | `ITSAppUsesNonExemptEncryption=false` | 면제 대상 암호화만 사용 (HTTPS/TLS, OS 제공 암호화, 표준 알고리즘) — 대부분의 앱 |
| `true` | `ITSAppUsesNonExemptEncryption=true` | 비면제 암호화 사용 → 별도 수출 서류(연간 자가분류 보고 등) 필요 |
| **미선언(기본)** | 키 없음 | **매 빌드마다** ASC → TestFlight → 해당 빌드 → 관리 에서 답해야 한다 |

> ⚠️ **이건 법적 신고 내용이다.** 자체 구현 암호화나 비표준 알고리즘을 쓴다면 `false` 가 아니다.
> 그래서 하네스는 **기본값을 정하지 않는다** — 앱마다 사람이 판단해 선언한다. 미선언이면
> `generate-app` 이 iOS 생성 때 경고를 남긴다(조용히 넘어가지 않는다).
>
> 문자열 `"false"` 를 넣으면 plist 에 `<true/>` 가 박혀 **반대로 신고**된다 — `loadConfig` 가
> 불리언이 아닌 값을 빌드 실패로 막는다.

**선언 현황**: `characterchat-dev` = `false`. 나머지 앱은 미선언이라 콘솔 답변이 필요하다.

## 요약 흐름

```
              "모바일 앱 새 버전 배포해줘"  =  release-app 스킬
                                 │
versionCode +1  →  git tag <slug>-v<버전>  →  git push origin <태그>
                                                      │
                                        CI: 빌드·서명·업로드
                                                      │
        ┌───────────────────────┬─────────────────────┼──────────────────────┐
        ▼                       ▼                     ▼                      ▼
Firebase App Distribution   GCS 고정 링크      Play 내부 트랙          TestFlight
→ 테스터에게 즉시           → 같은 QR 로 최신   → 트랙 테스터에게 즉시   → 처리 후 노출
  (Android)                   (Android)          (Android)               (iOS)
```

네 채널 모두 **사람이 누를 것 없이** 테스터까지 간다. 사람이 개입하는 지점은 두 곳뿐:
**정식 출시**(Play production 승격 / App Store 심사 제출)와, iOS 첫 빌드의 **수출 규정 준수 답변**(§6).
