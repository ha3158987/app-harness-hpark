---
name: publish-apk
description: 사내 테스트용 Android APK 를 빌드해 GCS 공개 버킷의 고정 경로에 올리고, 항상 같은 QR/링크로 받게 한다. "안드로이드 새 버전 배포해줘", "APK 배포", "테스트 빌드 뿌려줘", "설치 링크 줘", "QR 새로 갱신해줘" 요청이면 이 스킬을 사용해라. ⚠️ 스토어(플레이스토어 내부테스트·TestFlight) 배포는 이게 아니다 — 그건 docs/07-HOWTO-DEPLOY.md 의 태그 푸시 흐름이다.
---

# publish-apk — 사내 테스트 APK 배포 (사이드로드 링크/QR)

스토어를 거치지 않고 **URL 하나로 받아 설치**하는 경로. 링크가 고정이라 **QR 은 한 번 만들면 영구 재사용**한다.

- 버킷: `gs://chat-dev-poptale-dist` (project `poptale-chat`, allUsers 읽기)
- 고정 링크: `https://storage.googleapis.com/chat-dev-poptale-dist/android/<slug>.apk`
- QR: `build/<slug>-apk-qr.png` / `.svg` (링크가 안 바뀌므로 **재생성 불필요** — 이미 배포한 QR 그대로 유효)

## 절차

1. **스토어 배포와 구분한다.** 사용자가 "플레이스토어 / 내부테스트 트랙 / TestFlight / 심사" 를 말하면
   이 스킬이 아니다 → `docs/07-HOWTO-DEPLOY.md` (태그 푸시). 애매하면 한 번 묻는다.
2. **slug 확인** — 기본 `characterchat-dev`. 여러 앱이면 `apps/` 목록을 보여주고 고르게 한다.
3. **버전** — "버전 올려서" 라는 말이 있으면 `bump-version` 스킬을 **먼저** 실행한다.
   말이 없으면 `apps/<slug>/app.config.json` 의 `version.code` 를 그대로 쓴다.
   (사이드로드는 versionCode 가 같아도 재설치된다 — 디버그 서명이 동일하므로. 스토어와 달리 bump 는 선택.)
4. **한 줄 실행:**
   ```bash
   npm run publish:apk -- --slug <slug> --build --qr
   ```
   - `--build` = generate-app → `cap sync android` → `gradlew assembleDebug` 까지 새로 빌드
   - 이미 빌드된 산출물만 올릴 땐 `--build` 를 뺀다
   - 릴리즈 서명 빌드는 `--variant release` (서명 설정이 있어야 함 → `build-android` 참조)
   - `--qr` 는 링크가 그대로라 사실 없어도 되지만, 파일이 없으면 만들어 둔다
5. **결과 보고** — 스크립트가 업로드 후 실제로 `curl` 로 200·크기 일치까지 검증한다.
   출력의 설치 링크·버전·크기를 사용자에게 그대로 전한다.

## 스크립트가 자동으로 하는 것 (`scripts/publish-apk.mjs`)

gcloud 인증 확인 → (선택)빌드 → APK 탐색 + aapt2 로 버전 추출 → **버킷 없으면 생성 + 공개 권한 부여** →
고정 경로 업로드 + `android/archive/<slug>-<버전>-<타임스탬프>.apk` 이력 사본 동시 저장 →
HTTP 200 / content-type / 크기 검증 → 링크 출력 → (`--qr`) PNG+SVG 생성.

`--bucket` `--project` `--name` 으로 다른 앱·버킷에도 그대로 쓸 수 있다.

## 환경은 스크립트가 알아서 맞춘다 (실측으로 막혔던 3가지)

수동으로 `gradlew` 를 조립하지 마라 — 비대화형 셸에서 아래가 전부 걸린다:

| 증상 | 원인 | 스크립트의 처리 |
|---|---|---|
| `npx cap sync` 가 메시지 없이 실패 | nvm 기본이 Node 20 (하네스는 22+) | nvm 의 22+ 로 자기 자신을 재실행 |
| CocoaPods 에러로 APK 빌드까지 죽음 | `generate-app` 기본 `--platform both` → iOS pod install | `--platform android` 고정 |
| `Unable to locate a Java Runtime` | JAVA_HOME 미설정 | `java_home -v 21` → Android Studio 번들 JBR 21 자동 탐지 |

## 주의

- **`cache-control: no-cache` 를 빼지 마라.** 고정 경로에 덮어쓰는 구조라, 캐시가 걸리면
  QR 을 찍은 사람이 옛 빌드를 받는다. 스크립트가 이미 넣고 있으니 수동 `gcloud storage cp` 를 조립하지 마라.
- **공개 링크다.** URL 을 아는 사람은 누구나 받는다. 사내 테스트용으로만 쓴다.
- **웹만 바뀌었으면 새 APK 가 필요 없다.** 셸이 `startUrl`(원격) 을 띄우는 구조라,
  웹 배포만으로 반영된다. APK 재배포는 **네이티브 설정·플러그인·아이콘/스플래시·권한이 바뀐 경우**다.
- QR 을 새로 만들어야 하는 유일한 경우는 **버킷/객체 경로를 바꿀 때**다. 버전업으로는 안 바뀐다.
