# CREDENTIALS — 배포 인증(자격증명) 관리 단일 출처

이 문서는 app-harness 가 앱을 스토어에 배포할 때 필요한 **모든 인증 요소**를 한곳에 정리한다.
목표: **어떤 앱(slug)이 추가돼도 인증을 새로 셋업하지 않고 재사용**한다.

> ⛔ 절대 원칙: 실제 키/비번/토큰 값은 **레포에 커밋하지 않는다.**
> - 로컬: `secrets/` 폴더(바이너리 키) + `fastlane/.env` (값) — 둘 다 `.gitignore` 차단
> - CI: **GitHub Secrets** (암호화 저장)
> - 이 레포에는 **빈 템플릿/설명서만** 들어간다 (`.env.example`, `secrets/README.md`, 이 문서).

---

## 1. 핵심 원리 — 시크릿은 전부 "조직 공유", 앱별 고유는 시크릿이 아님

| 구분 | 내용 | 새 앱 추가 시 |
|---|---|---|
| **조직 공유 시크릿** | ASC API 키, match repo, Play 서비스계정, 업로드 keystore, Apple 계정 | 한 번 셋업 → **재사용** |
| **앱별 고유(시크릿 아님)** | appId/bundleId, appName | `app.config.json` 에 작성 |
| **앱별 1회 수동(시크릿 아님)** | 스토어 앱 레코드, iOS 프로비저닝 | 스토어 등록 / match 자동 생성 |

➡️ **새 앱이 발급해야 할 새 시크릿 = 0개.** (업로드 keystore를 "공유 1개"로 운용하기 때문)

---

## 2. 인증 요소 전체 목록

### 🍎 iOS (조직 공유)

| 요소 | 로컬 위치 | CI GitHub Secret | 발급 방법 |
|---|---|---|---|
| Apple ID | `.env` `FASTLANE_APPLE_ID` | (CI는 API키로 대체) | 기존 Apple 계정 |
| Apple Dev Team ID | `.env` `FASTLANE_DEV_TEAM_ID` | 워크플로 내 주입 | 3W889GYPRK |
| ITC Team ID | `.env` `FASTLANE_ITC_TEAM_ID` | — | ASC에서 확인 |
| ASC API 키 (.p8) | `secrets/asc_api_key.p8` | `ASC_KEY_P8` (내용) | ASC → 사용자·액세스 → 통합 → 팀 키 (App Manager) |
| ASC Key ID | `.env` `APP_STORE_CONNECT_API_KEY_KEY_ID` | `ASC_KEY_ID` | 위와 함께 (10자리) |
| ASC Issuer ID | `.env` `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | `ASC_ISSUER_ID` | 위와 함께 (UUID) |
| match repo URL | `.env` `MATCH_GIT_URL` | `MATCH_GIT_URL` | 빈 private git repo 생성 |
| match 복호화 비번 | `.env` `MATCH_PASSWORD` | `MATCH_PASSWORD` | `fastlane match init` 시 설정 |
| match repo 접근 (CI) | (로컬은 git https 권한) | `MATCH_DEPLOY_KEY` | `ios-certificates` 저장소의 **읽기전용 deploy key**(ed25519). 저장소 귀속 — 개인 토큰 아님(퇴사 무관). `MATCH_GIT_URL`은 CI에서 SSH 형식(`git@github.com:...`) |

### 🤖 Android (조직 공유)

| 요소 | 로컬 위치 | CI GitHub Secret | 발급 방법 |
|---|---|---|---|
| Play 서비스계정 JSON | `secrets/play-service-account.json` | `PLAY_SERVICE_ACCOUNT_JSON` (내용) | GCP → 서비스계정 → JSON 키 → Play "사용자 및 권한"에 초대 |
| 업로드 keystore | `secrets/android/upload.jks` | `ANDROID_KEYSTORE_BASE64` (base64) | aipia.jks 재사용 (공유 1개) |
| keystore 비번 | `.env` `ANDROID_KEYSTORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD` | keystore.properties |
| 키 별칭 | `.env` `ANDROID_KEY_ALIAS` | `ANDROID_KEY_ALIAS` | keystore.properties |
| 키 비번 | `.env` `ANDROID_KEY_PASSWORD` | `ANDROID_KEY_PASSWORD` | keystore.properties |

### 🟦 앱별 고유 (시크릿 아님 — 발급 불필요)

| 요소 | 출처 |
|---|---|
| appId / bundleId, appName | `apps/<slug>/app.config.json` |
| iOS 프로비저닝 프로파일 | match 가 appId 기준 **자동 생성**, 공유 repo에 저장 |
| Play/ASC 앱 레코드 | 스토어에 1회 수동 등록 |

---

## 3. 로컬 ↔ CI 매핑

```
   [로컬 개발 — macOS]                          [CI — GitHub Actions]
   ───────────────────────                      ──────────────────────
   secrets/                  (.gitignore)        GitHub Secrets (암호화)
     ├ asc_api_key.p8           ─────────────▶     ASC_KEY_P8                (파일 내용)
     ├ play-service-account.json ────────────▶     PLAY_SERVICE_ACCOUNT_JSON (파일 내용)
     └ android/upload.jks       ──base64─────▶     ANDROID_KEYSTORE_BASE64   (base64 인코딩)
   fastlane/.env             (.gitignore)
     ├ APP_STORE_CONNECT_API_KEY_KEY_ID ──────▶     ASC_KEY_ID
     ├ APP_STORE_CONNECT_API_KEY_ISSUER_ID ───▶     ASC_ISSUER_ID
     ├ MATCH_GIT_URL / MATCH_PASSWORD ────────▶     MATCH_GIT_URL / MATCH_PASSWORD
     │                                              + MATCH_GIT_BASIC_AUTHORIZATION (CI 전용)
     └ ANDROID_KEYSTORE_PASSWORD / ALIAS / KEY ▶     동명 3개
            │                                              │
            └──────────────► fastlane Fastfile ◄───────────┘
                          (slug 무관 — 공유 자격증명 그대로 사용)
```

keystore → base64 인코딩(CI Secret 입력용):
```bash
base64 -i secrets/android/upload.jks | tr -d '\n'   # macOS
```

---

## 4. 새 앱 추가 — **시크릿 발급은 0, 콘솔 작업은 0이 아니다**

인증은 §2의 **조직 공유분을 그대로 재사용**한다 → **새로 발급할 시크릿 없음**
(keystore·ASC키·match·Play계정 전부 공유).

⚠️ 다만 **"콘솔 작업 0"은 아니다.** 아래는 시크릿이 아니지만 사람이 반드시 해야 한다:

```
새 앱을 배포하려면:
  1. apps/<slug>/app.config.json 작성                      (시크릿 아님)
  2. Play Console / App Store Connect 에 앱 레코드 등록      (수동)
  3. Apple 개발자 포털에 App ID 등록                         (수동)
       · 앱 본체          com.aipia.<slug>
       · 알림 확장        com.aipia.<slug>.NotificationService   ← 푸시 쓰면 필수
  4. 프로비저닝 프로파일 생성 — **순서 중요**                  (수동, 1회)
       node scripts/generate-app.mjs --slug <slug> --platform ios
       fastlane ios regen_profile slug:<slug>
  5. 빌드/배포
```

> 🔴 **3·4 를 빠뜨리면 CI 가 실패한다.** CI 의 match 는 `readonly` 라 프로파일을 **스스로 만들지 못한다**
> (예전 문서에 "match 가 자동 생성"이라 적혀 있었으나 사실이 아니다 — CI 는 가져다 쓰기만 한다).
> 특히 알림 확장은 애플 눈에 **별개의 앱**이라 App ID·프로파일이 따로 필요하고, 이 사실은
> 확장을 도입한 뒤 **첫 iOS 빌드에서야** 드러난다.
>
> 콘솔·계정 작업 전체 목록은 **[NEW-APP-CHECKLIST.md](./NEW-APP-CHECKLIST.md)** 참조.

---

## 5. 최초 1회 셋업 순서 (조직 전체에서 딱 한 번)

1. **Apple**: ASC API 팀 키 발급(App Manager) → `secrets/asc_api_key.p8`, Key ID, Issuer ID 확보
2. **iOS match**: 빈 private repo 생성 → `fastlane match init` → `fastlane match appstore` 1회
3. **Android**: GCP 서비스계정 JSON 발급 → Play "사용자 및 권한"에 초대(출시 권한) → `secrets/play-service-account.json`
4. **Android keystore**: 공유 업로드 키(aipia.jks) → `secrets/android/upload.jks`
5. 위 값들을 `fastlane/.env`(로컬) + GitHub Secrets(CI)에 입력 → §3 매핑표대로

> CI에 필요한 GitHub Secret 전체 목록·등록법은 `DEPLOY.md §4` 참조.
> 단계별 환경 셋업은 `SETUP.md` 참조.
