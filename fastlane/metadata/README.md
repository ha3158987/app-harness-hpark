# 스토어 메타데이터 (다국어) — 구조와 활성화 방법

앱 안의 문구(앱 이름·권한 문구)는 `app.config.json` + `generate-app` 이 담당한다([docs/02-GUIDE.md §6](../../docs/02-GUIDE.md)).
**스토어 페이지의 문구**(제목·설명·스크린샷)는 그것과 별개로 스토어 콘솔이 갖는 데이터라 여기 둔다.

> ⚠️ 현재 **비활성**이다. `Fastfile` 의 Play beta lane 은 `skip_upload_metadata: true` 이고,
> App Store 메타데이터 업로드(`deliver`) lane 은 아예 없다. 이 디렉터리는 **구조와 이름만 준비**해 둔 것이다.
> 활성화는 아래 "활성화 제안"을 사람이 판단해서 적용한다. **프로덕션 공개는 자동화하지 않는다**(레포 절대 규칙).

## 레이아웃

```
fastlane/metadata/<slug>/android/<play-locale>/     # supply(Play)
fastlane/metadata/<slug>/ios/<appstore-locale>/     # deliver(App Store)
```

앱이 여러 개인 하네스라 **slug 로 한 겹 감싼다** — fastlane 기본 경로(`fastlane/metadata/android/...`)를
그대로 쓰면 앱들이 서로의 스토어 문구를 덮어쓴다.

## 로케일 코드 — 앱 안과 다르다

`scripts/lib/i18n.mjs` 가 정본이고, 이 디렉터리 이름들은 거기서 파생됐다.

| config | Play | App Store |
|---|---|---|
| `en` | `en-US` | `en-US` |
| `ko-KR` | `ko-KR` | `ko` |
| `ja-JP` | `ja-JP` | `ja` |
| `zh-Hant` | `zh-TW` | `zh-Hant` |
| `th-TH` | `th` | `th` |
| `id-ID` | `id` | `id` |
| `es-419` | `es-419` | **`es-MX`** — App Store 에는 `es-419` 가 없다 |
| `pt-BR` | `pt-BR` | `pt-BR` |

## 채워야 하는 파일

지금은 앱 이름(`title.txt` / `name.txt`)만 들어 있다 — config 에서 그대로 가져온 값이다.
나머지는 **마케팅 문구라 사람이 쓴다.** 없는 파일은 업로드에서 그냥 빠지므로, 준비 안 된 항목은
빈 파일을 만들지 말고 **파일 자체를 두지 마라**(빈 문자열이 스토어에 올라가 기존 설명을 지운다).

| Play (`android/<locale>/`) | App Store (`ios/<locale>/`) |
|---|---|
| `title.txt` (30자) ✅ 있음 | `name.txt` (30자) ✅ 있음 |
| `short_description.txt` (80자) | `subtitle.txt` (30자) |
| `full_description.txt` (4000자) | `description.txt` (4000자) |
| `changelogs/<versionCode>.txt` (500자) | `release_notes.txt` (4000자) |
| — | `keywords.txt` (100자) |

스크린샷은 언어별 이미지가 또 필요하다(`screenshots/`). 스플래시·아이콘에는 텍스트가 없어
언어별 에셋이 필요 없지만, **스토어 스크린샷은 앱 화면을 찍는 것이라 언어별로 다르다.**

## 활성화 제안 (아직 적용하지 않았다)

1. **Play** — `Fastfile` 의 `android :beta` 에서:
   ```ruby
   skip_upload_metadata: true,          # ← false 로
   metadata_path: File.join('fastlane', 'metadata', slug, 'android'),   # ← 추가 (slug 별 경로)
   ```
   `skip_upload_images` / `skip_upload_screenshots` 는 이미지가 준비되기 전까지 `true` 로 둔다.

2. **App Store** — 지금은 `upload_to_testflight`(바이너리)만 있다. 스토어 페이지 문구는
   `deliver` lane 을 따로 만들어야 한다:
   ```ruby
   lane :metadata do |options|
     slug = require_slug(options)
     upload_to_app_store(
       app_identifier: app_config(slug)['appId'],
       metadata_path: File.join('fastlane', 'metadata', slug, 'ios'),
       skip_binary_upload: true, skip_screenshots: true,
       precheck_include_in_app_purchases: false,
       submit_for_review: false, force: true,    # ← 심사 제출은 사람이 콘솔에서
     )
   end
   ```
   `submit_for_review: false` 를 반드시 유지한다 — 심사 제출/정식 릴리즈는 자동화하지 않는다.

3. 두 스토어 콘솔에서 **해당 언어를 먼저 추가**해야 업로드가 받아진다(없는 언어로 올리면 실패).
