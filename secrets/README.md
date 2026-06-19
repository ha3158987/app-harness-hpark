# secrets/ — 로컬 개발용 자격증명 보관소

이 폴더는 **로컬에서 빌드/배포할 때 쓰는 실제 키 파일**을 두는 곳이다.

> ⛔ 이 폴더의 내용은 **`README.md` 만 빼고 전부 `.gitignore` 로 차단**된다.
> 실제 키(.p8/.jks/JSON)는 **절대 커밋되지 않으며, 커밋해서도 안 된다.**
> 전체 가이드 → 레포 루트 `CREDENTIALS.md`

## 여기에 둘 파일 (이름 고정)

```
secrets/
├─ README.md                      ← 이 파일 (git에 올라가는 유일한 것)
├─ asc_api_key.p8                 ← App Store Connect API 키 (iOS, 조직 공유)
├─ play-service-account.json      ← Play Console 서비스계정 (Android, 조직 공유)
└─ android/
   └─ upload.jks                  ← Android 업로드 keystore (공유 1개 = aipia)
```

## 받는 방법

| 파일 | 어디서 | 비고 |
|---|---|---|
| `asc_api_key.p8` | ASC → 사용자·액세스 → 통합 → 팀 키 | 발급 시 1회만 다운로드 |
| `play-service-account.json` | GCP → 서비스계정 → 키 → JSON | 재발급 가능 |
| `android/upload.jks` | 인수인계 자료(aipia.jks) | 분실 주의·백업 필수 |

값(비번·ID 등)은 파일이 아니라 `fastlane/.env` 에 넣는다 (`fastlane/.env.example` 복사).

## 빠른 시작

```bash
cp fastlane/.env.example fastlane/.env   # 값 채우기
mkdir -p secrets/android                 # 키 파일 배치
# (위 표대로 .p8 / .json / .jks 를 secrets/ 에 복사)
```

CI(GitHub Actions)는 이 폴더를 쓰지 않고 **GitHub Secrets** 를 쓴다. 매핑은 `CREDENTIALS.md §3` 참조.
