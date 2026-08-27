---
name: build-ios
description: 특정 앱(slug)의 iOS 앱을 빌드한다. app.config.json → Capacitor 프로젝트 생성/동기화 → xcodebuild(.ipa)까지. "iOS 빌드", "아이폰 빌드해줘", "ipa 만들어", "테스트플라이트용 빌드" 요청이면 반드시 이 스킬을 사용해라. macOS + Xcode 26 환경에서만 동작한다.
---

# build-ios

> ⚠️ **macOS + Xcode 26+ 필수.** 리눅스/컨테이너에서는 동작하지 않는다. 환경이 맥이 아니면
> 즉시 중단하고 사용자에게 알린다.

## 절차
1. **프로젝트 생성/패치**:
   ```bash
   node scripts/generate-app.mjs --slug <slug> --release
   # --release 는 스토어 요건(clientId · deleteEndpoint · Apple 4.8)을 빌드 실패로 승격한다.
   # 스토어에 올리지 않는 로컬 확인이면 --release 를 빼라.
   ```
2. 아이콘/스플래시 미생성 시 → generate-assets 선행.
3. **동기화 & CocoaPods**:
   ```bash
   cd build/<slug>
   npx cap sync ios
   cd ios/App && pod install
   ```
4. **빌드** — fastlane 경유 권장(서명 일관성):
   ```bash
   bundle exec fastlane ios build slug:<slug>   # Fastfile 에 lane 정의
   ```
   fastlane 미구성 시 `xcodebuild archive` + `-exportArchive` 직접 사용.

## 서명
- 인증서/프로비저닝은 **fastlane `match`** (암호화 git repo)로 관리. 스킬에 자격증명 넣지 않는다.
- 배포 타깃 iOS 15, 빌드 SDK는 Xcode 26(iOS 26 SDK) — 2026-04-28부터 스토어 제출 요건.

## 주의
- 빌드 실패(서명/프로비저닝/팀 ID) 로그를 그대로 보여주고, 자격증명 관련이면 사람에게 처리 요청.
