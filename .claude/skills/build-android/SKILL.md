---
name: build-android
description: 특정 앱(slug)의 Android 앱을 빌드한다. app.config.json → Capacitor 프로젝트 생성/동기화 → Gradle 빌드(AAB/APK)까지. "안드로이드 빌드", "Android 빌드해줘", "aab 만들어", "플레이스토어용 빌드" 요청이면 반드시 이 스킬을 사용해라. Android는 헤드리스로 완전 자동 가능.
---

# build-android

## 환경 (빌드 머신 — 최초 1회 세팅)
- **JDK 21 필수** (Capacitor 8 Android). 17 이면 `invalid source release: 21` 로 실패. `JAVA_HOME` → JDK 21.
- **Android SDK**: `ANDROID_HOME` 설정 + platform-tools / `platforms;android-35` / `build-tools;35.0.0` + 라이선스 동의.
- **non-ASCII 경로**(예: `C:\Users\김바다`): generate-app 이 `android.overridePathCheck=true` 를 자동 주입해 우회.
  (NDK 포함 플러그인을 쓰면 우회가 안 통할 수 있으니 그땐 빌드 디렉터리를 ASCII 경로로.)

## 절차
1. **프로젝트 생성/패치** — `app.config.json` 을 읽어 `build/<slug>/` 에 Capacitor 프로젝트를
   생성하거나 갱신:
   ```bash
   node scripts/generate-app.mjs --slug <slug>   # capacitor.config + appId/appName/url/플러그인 패치
   ```
2. 아이콘/스플래시 미생성 시 → generate-assets 선행.
3. **동기화 & 빌드**:
   ```bash
   cd build/<slug>
   npx cap sync android
   cd android
   ./gradlew bundleRelease      # AAB (스토어 제출용). 테스트 설치용은 assembleRelease (APK)
   ```
4. 산출물 경로 보고: `build/<slug>/android/app/build/outputs/bundle/release/*.aab`

## 서명
- 릴리즈 서명 정보(keystore 경로/별칭/비번)는 **환경변수 또는 `~/.gradle` / fastlane 으로 주입**.
  스킬·config·레포에 평문으로 두지 않는다. (서명 자동화는 submit-store 에서 fastlane `supply`와 함께)
- 미서명 디버그 빌드로 동작 확인이 목적이면 `assembleDebug` 사용.

## 컴플라이언스
- `targetSdk` 는 35 이상 (2026-08-31부터 36 필수). `minSdk` 는 Capacitor 기본(23) 유지 가능.

## 주의
- 빌드 실패 시 출력 로그를 그대로 사용자에게 보여주고 원인 분석. 자격증명 누락이면 사람에게 요청.
