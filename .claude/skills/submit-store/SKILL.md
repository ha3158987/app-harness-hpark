---
name: submit-store
description: 빌드된 앱을 스토어에 업로드한다. iOS는 TestFlight, Android는 Play 내부/베타 트랙까지 fastlane으로 자동 업로드한다. "테스트플라이트 올려", "베타 배포", "내부테스트 업로드", "스토어 업로드" 요청이면 이 스킬을 사용해라. 단, 프로덕션 공개(심사 제출/정식 릴리즈)는 자동으로 하지 않는다.
---

# submit-store

## 안전 원칙 (반드시 준수)
- **자동화 범위 = 베타/내부 트랙 업로드까지.** TestFlight 업로드, Play `internal`/`beta` 트랙까지만.
- **프로덕션 공개는 절대 자동 실행하지 않는다.** App Store "심사 제출"이나 Play `production` 승격은
  사람이 직접 누르도록 안내만 한다. 되돌릴 수 없는 공개 행위이기 때문.
- 스토어 API 키/App Store Connect 키/서비스 계정 JSON 은 **fastlane 시크릿/환경변수**로만 접근.
  스킬·레포에 평문으로 두지 않는다. 누락 시 사람에게 요청.

## 절차
1. 대상 산출물 확인 (build-ios → .ipa, build-android → .aab).
2. 업로드:
   ```bash
   # iOS → TestFlight
   bundle exec fastlane ios beta slug:<slug>      # pilot 사용
   # Android → Play 내부/베타 트랙
   bundle exec fastlane android beta slug:<slug>  # supply, track: internal|beta
   ```
3. 업로드 결과(빌드 번호, 트랙, 처리 상태)를 사용자에게 보고.
4. 프로덕션으로 올리고 싶어 하면: **"여기서부터는 콘솔에서 직접 승인/제출하세요"** 라고 안내하고
   해당 콘솔 위치만 알려준다. 자동 제출하지 않는다.

## 주의
- 업로드 실패(인증/메타데이터/스크린샷 누락) 로그를 그대로 보여주고 원인 분석.
