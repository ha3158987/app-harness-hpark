---
name: submit-store
description: 빌드된 앱을 내부 테스터/스토어에 업로드한다. iOS는 TestFlight, Android는 Firebase App Distribution(테스터 즉시 배포) 및 Play 내부/베타 트랙까지 fastlane으로 자동 업로드한다. "테스트플라이트 올려", "베타 배포", "내부테스트 업로드", "테스터한테 배포", "스토어 업로드" 요청이면 이 스킬을 사용해라. 단, 프로덕션 공개(심사 제출/정식 릴리즈)는 자동으로 하지 않는다.
---

# submit-store

## 안전 원칙 (반드시 준수)
- **자동화 범위 = 내부 테스터까지.** TestFlight, Firebase App Distribution(지정 그룹),
  Play `internal`/`beta` 트랙까지만.
- **프로덕션 공개는 절대 자동 실행하지 않는다.** App Store "심사 제출"이나 Play `production` 승격은
  사람이 직접 누르도록 안내만 한다. 되돌릴 수 없는 공개 행위이기 때문.
- 스토어 API 키/App Store Connect 키/서비스 계정 JSON 은 **fastlane 시크릿/환경변수**로만 접근.
  스킬·레포에 평문으로 두지 않는다. 누락 시 사람에게 요청.

## 절차
1. 대상 산출물 확인 (build-ios → .ipa, build-android → .aab/.apk).
2. 업로드:
   ```bash
   # iOS → TestFlight
   bundle exec fastlane ios beta slug:<slug>      # pilot 사용
   # Android → Firebase App Distribution (테스터에게 즉시. APK 를 직접 굽는다)
   bundle exec fastlane android firebase slug:<slug> groups:aipia_internal
   # Android → Play 내부/베타 트랙
   bundle exec fastlane android beta slug:<slug>  # supply, track: internal|beta
   ```
   **채널 선택 기준** — "테스터에게 빨리 주고 싶다"면 `firebase`(콘솔 클릭 불필요),
   "스토어 경로 그대로 검증"이면 `beta`(Play 내부트랙에 바로 출시). 애매하면 둘 다.
   CI 로 돌릴 땐 `gh workflow run release.yml -f android_channel=firebase|play|both`.
3. 업로드 결과(빌드 번호, 채널/트랙, 테스터 그룹, 처리 상태)를 사용자에게 보고.
4. 프로덕션으로 올리고 싶어 하면: **"여기서부터는 콘솔에서 직접 승인/제출하세요"** 라고 안내하고
   해당 콘솔 위치만 알려준다. 자동 제출하지 않는다.

## 주의
- 업로드 실패(인증/메타데이터/스크린샷 누락) 로그를 그대로 보여주고 원인 분석.
- Firebase App Distribution APK 는 **업로드 키**로 서명된다(Play 배포본은 Play 앱 서명 키).
  지문에 묶인 기능(Google/Kakao/Naver 로그인, App Link)이 Firebase 빌드에서만 깨질 수 있다 —
  두 지문을 모두 각 콘솔에 등록해야 한다. 상세: `docs/08-DEPLOY.md §10`.
