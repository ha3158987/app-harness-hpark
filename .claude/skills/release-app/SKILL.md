---
name: release-app
description: 모바일 앱의 새 버전을 전 채널로 릴리즈한다 — iOS TestFlight + Android(Play 내부트랙 · Firebase App Distribution · GCS 고정 링크/QR)까지 한 번에. "모바일 앱 새로운 버전 배포해줘", "앱 새 버전 배포해줘", "새 버전 릴리즈", "전체 배포", "iOS 안드로이드 같이 배포", "스토어에 새 버전 올려" 요청이면 반드시 이 스킬을 사용해라. 버전 bump → 커밋 → 트리거 → CI 감시 → 결과 보고까지 수행한다. 사내 APK 링크만 갱신하는 publish-apk 와는 다르다. 프로덕션 공개(심사 제출·정식 출시)는 하지 않는다.
---

# release-app — 새 버전을 전 채널로 릴리즈

트리거 **한 번**에 네 곳이 동시에 나간다. `.github/workflows/release.yml` 이 전부 수행한다.

| 채널 | 산출물 | 테스터가 받는 법 | 사람 개입 |
|---|---|---|---|
| **iOS TestFlight** | `.ipa` | 빌드 처리 후 TestFlight 에 노출 | 🔴 **수출 규정 준수 답변** ([07 §6](../../../docs/07-HOWTO-DEPLOY.md)) |
| **Android Play 내부트랙** | `.aab` | Play 스토어 (몇 분 뒤 업데이트) | 없음 (`release_status: 'completed'`) |
| **Android Firebase App Distribution** | `.apk` | 초대/알림 메일 → App Tester | 없음 |
| **Android GCS 고정 링크** | `.apk` | 기존 QR·URL 그대로 | 없음 |

> 🔴 **프로덕션 공개는 하지 않는다.** App Store 심사 제출, Play `production` 승격은
> 사람이 콘솔에서 한다 (STRATEGY 안전원칙). 이 스킬은 **내부 테스터까지**다.

## 0. 먼저 다른 스킬과 구분한다

| 사용자가 원하는 것 | 스킬 |
|---|---|
| 사내 테스트 APK 링크/QR **만** 갱신 (스토어 안 건드림) | `publish-apk` |
| 버전 숫자**만** 올리기 | `bump-version` |
| 이미 빌드된 산출물만 업로드 | `submit-store` |
| **새 버전을 전 채널로** (이 스킬) | `release-app` |

"안드로이드만", "APK 만", "링크만" 이면 `publish-apk` 다. 애매하면 **위 표를 보여주고 한 번 묻는다.**

## 1. 절차

### 1단계 — slug 확인
`apps/` 목록을 보고 대상을 정한다. 여러 개면 사용자에게 고르게 한다.
```bash
for f in apps/*/app.config.json; do
  python3 -c "import json;c=json.load(open('$f'));print(f\"{c['slug']:20} {c['appId']:32} v{c['version']['name']} ({c['version']['code']})\")"
done
```

### 2단계 — 무엇이 나가는지 알리고 **확인받는다**
위 채널 표를 그대로 보여주고 진행 여부를 묻는다. **확인 없이 푸시하지 마라** —
태그 푸시는 되돌리기 번거롭고, 테스터에게 메일이 나가며, 스토어에 빌드가 올라간다.

### 3단계 — 버전 올리기 (`bump-version` 스킬)
`version.code` **정수 +1 은 필수**다. Play 도 App Store 도 같은 code 재사용을 거부한다
(`Version code N has already been used.`). `version.name` 은 사용자 지정, 없으면 patch +1 제안.

### 4단계 — 커밋 & 푸시
버전 변경이 **트리거하는 커밋에 들어 있어야** CI 가 새 버전으로 빌드한다.
```bash
git add apps/<slug>/app.config.json
git commit -m "chore(<slug>): v<name> (<code>) 릴리즈"
git push origin HEAD
```

### 5단계 — 트리거 (둘 중 하나 — 태그 중복으로 갈린다)

**A. `version.name` 이 올라갔다 → 태그** (기본 경로)
```bash
git tag <slug>-v<name> && git push origin <slug>-v<name>
```
태그 푸시는 `platform=both`, `android_channel=both`, `track=internal` 로 돈다 = 네 채널 전부.

**B. `version.code` 만 올라갔다 → 수동 실행**
태그 `<slug>-v<name>` 이 이미 있어 재사용할 수 없다. 같은 결과를 내는 수동 트리거를 쓴다:
```bash
gh workflow run release.yml --ref <브랜치> \
  -f slug=<slug> -f platform=both -f android_channel=both -f track=internal
```
> `--ref` 는 **버전 bump 커밋이 있는 브랜치**여야 한다. main 에 아직 없으면 작업 브랜치를 준다.

### 6단계 — 감시
```bash
gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch <run-id> --interval 20 --exit-status
```
실패하면 `gh run view <run-id> --log-failed` 로 원인을 **그대로 보여주고** 분석한다.
`§4 자주 겪는 것` 을 먼저 대조한다.

### 7단계 — 결과 보고
채널별 성공/스킵/실패를 표로. 그리고 **사람이 할 일을 반드시 남긴다**:
- **iOS**: App Store Connect → TestFlight → 해당 빌드 → **수출 규정 준수** 질문에 답한다.
  답하기 전엔 내부 테스터에게도 안 나간다 ([docs/07-HOWTO-DEPLOY.md §6](../../../docs/07-HOWTO-DEPLOY.md))
- 정식 출시·심사 제출이 필요하면 콘솔 위치만 안내하고 **자동 실행하지 않는다**

## 2. 전제 — 앱마다 1회 (없으면 해당 채널이 조용히 빠진다)

| 채널 | 필요한 것 | 없으면 |
|---|---|---|
| TestFlight | ASC 키·match 프로파일 (조직 공유) | iOS 잡 실패 |
| Play 내부트랙 | Play 앱 레코드 + `PLAY_SERVICE_ACCOUNT_JSON` | Play 스텝 실패 |
| Firebase App Distribution | 변수 `FIREBASE_WIF_PROVIDER_<SLUG>` · `FIREBASE_WIF_SERVICE_ACCOUNT_<SLUG>`, 시크릿 `GOOGLE_SERVICES_B64_<SLUG>`, 콘솔의 테스터 그룹 | `::notice` 남기고 **스킵** |
| GCS 고정 링크 | 변수 `APK_DIST_BUCKET_<SLUG>` + 그 버킷에 SA `objectAdmin` | **스킵** |

셋업 절차: [docs/08-DEPLOY.md §10](../../../docs/08-DEPLOY.md) · [docs/09-CREDENTIALS.md](../../../docs/09-CREDENTIALS.md)

현재 셋업이 끝난 앱은 `characterchat-dev` 뿐이다. 다른 앱은 위 표를 먼저 채워야 네 채널이 다 나간다.

## 3. 부분 실행이 필요할 때

전 채널이 과할 때는 같은 워크플로를 좁혀 쓴다.
```bash
# 한 플랫폼만
-f platform=android        # 또는 ios
# 안드로이드 채널만 좁히기
-f android_channel=firebase   # 테스터에게만 (Play 안 건드림)
-f android_channel=play       # 스토어 트랙만
```

## 4. 자주 겪는 것

| 증상 | 원인 | 해결 |
|---|---|---|
| Play: `Version code N has already been used` | code 미증가 | 3단계 — `version.code` +1 |
| 태그 푸시했는데 CI 가 옛 버전을 빌드 | bump 커밋보다 태그가 앞섬 | 태그 지우고 bump 커밋 위에 다시 |
| 한쪽 잡이 `skipped` | `platform` 을 한쪽만 줌 — 실패가 아니라 "안 돌린 것" | `platform=both` 로 재실행 |
| Firebase 스텝이 `건너뜀` | 변수/`google-services.json` 미설정 | §2 표 |
| 업로드는 됐는데 테스터가 못 봄 (Play) | 테스터가 내부 트랙 옵트인 링크 미수락 / 반영 지연 | Play Console → 내부 테스트 → 테스터 탭의 옵트인 URL 로 참여 |
| 업로드는 됐는데 테스터가 못 봄 (TestFlight) | **수출 규정 준수 정보 누락** | ASC 에서 답변 — [docs/07 §6](../../../docs/07-HOWTO-DEPLOY.md) |
| iOS: 프로파일/capability 오류 | App ID capability ↔ 프로파일 불일치 | [docs/08-DEPLOY.md §6](../../../docs/08-DEPLOY.md) — 로컬에서 `fastlane ios regen_profile` 1회 |

## 5. 주의

- **웹만 바뀌었으면 릴리즈가 불필요하다.** 셸이 `startUrl` 을 원격 로드하므로 웹 배포만으로 반영된다.
  재릴리즈는 네이티브 설정·플러그인·아이콘/스플래시·권한·SDK 요구사항이 바뀐 경우다
  ([docs/08-DEPLOY.md §1](../../../docs/08-DEPLOY.md)).
- **Firebase/GCS 로 나가는 APK 는 업로드 키로 서명**된다. Play 배포본(Play 앱 서명 키)과 지문이 달라
  소셜 로그인·App Link 가 그쪽에서만 깨질 수 있다 — 두 지문을 각 콘솔에 등록해야 한다
  ([docs/08-DEPLOY.md §10](../../../docs/08-DEPLOY.md)).
- 실패한 채널이 있어도 **성공한 채널은 이미 나간 것**이다. 재실행 전에 무엇이 나갔는지 먼저 보고한다.
