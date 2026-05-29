---
name: generate-assets
description: @capacitor/assets 로 앱 아이콘과 스플래시 스크린을 모든 iOS/Android 사이즈로 생성한다. "아이콘 생성", "스플래시 만들어", "에셋 생성", "아이콘 적용" 요청이나, 앱 빌드 전 아이콘/스플래시가 아직 안 만들어진 상황이면 반드시 이 스킬을 사용해라.
---

# generate-assets

소스 이미지 1쌍에서 전 플랫폼 아이콘/스플래시를 생성해 생성된 Capacitor 프로젝트에 적용한다.

## 전제
- `apps/<slug>/icon.png` (1024×1024), `apps/<slug>/splash.png` (2732×2732) 존재.
  없으면 사용자에게 요청하고 중단 (placeholder 만들지 말 것).
- 대상 Capacitor 프로젝트가 `build/<slug>/` 에 이미 생성돼 있어야 함
  (없으면 generate-app 먼저).

## 절차
```bash
# build/<slug> 안에서
npx @capacitor/assets generate \
  --iconBackgroundColor "<theme.background>" \
  --iconBackgroundColorDark "<theme.background>" \
  --assetPath ../../apps/<slug>
npx cap sync
```
- `--assetPath` 는 소스(icon.png/splash.png)가 있는 디렉터리.
- 색상값은 `app.config.json` 의 `theme` 에서 읽어 채운다.
- 생성 후 `ios/`, `android/` 에 반영됐는지 확인.

## 출력
- 적용된 플랫폼/사이즈 요약. 누락 소스가 있었으면 명확히 보고.
