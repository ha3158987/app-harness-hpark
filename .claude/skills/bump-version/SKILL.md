---
name: bump-version
description: 특정 앱(slug)의 버전을 올린다. app.config.json 의 version.name(시맨틱)과 version.code(정수)를 갱신한다. "버전 올려", "1.2.0으로 bump", "빌드 넘버 올려", "버전업" 요청이면 반드시 이 스킬을 사용해라. 빌드/제출 전에 보통 먼저 실행된다.
---

# bump-version

## 절차
1. `apps/<slug>/app.config.json` 의 `version` 을 읽는다.
2. 규칙:
   - `version.name`: 사용자가 지정한 시맨틱 버전(예 1.2.0). 미지정 시 patch +1 제안.
   - `version.code`: **항상 정수 +1** (스토어는 단조 증가 요구). iOS build number / Android versionCode
     공통으로 이 값을 쓴다.
3. config 갱신 후 generate-app 단계가 네이티브 프로젝트에 반영하도록 한다
   (별도 빌드는 build-* 스킬이 수행).
4. **브랜치 이름을 버전에 맞춘다** (히스토리 추적용):
   - `version.name` 이 올라감 → `release/<slug>-v<name>` (예 `release/characterchat-dev-v1.0.1`)
   - `version.code` 만 올라감 → `chore/<slug>-version-<code>` (예 `chore/characterchat-dev-version-11`)
   릴리즈 트리거 태그가 `<slug>-v<name>` 형식이라(`release.yml` 의 `'*-v*'`) 브랜치를 같은
   형식으로 두면 브랜치 → 태그 → 스토어 빌드가 이름으로 한 줄에 꿰인다.
5. 변경 전/후 값을 사용자에게 보고.

## 주의
- version.code 를 절대 내리거나 중복하지 않는다. **두 스토어 모두 재사용을 거부한다** —
  Play 는 `Version code N has already been used.` 로 업로드 자체를 막는다(실제 발생).
- **빌드 번호가 플랫폼별로 갈리는 건 정상이다.** 같은 `version.name` 에서 스토어별 업로드
  횟수가 다르면 `code` 가 어긋난다(iOS 1.0.0(10) / Android 1.0.0(11)). 억지로 맞추려고
  한쪽을 건너뛰면 단조 증가만 깨진다. 사용자에게 "같은 버전"인지는 `version.name` 이 정한다.
- 여러 앱 동시 bump 요청이면 각 slug 별로 처리하고 결과를 표로 요약.

전체 규칙: [AIPIA-CONVENTIONS.md §16](../../../AIPIA-CONVENTIONS.md)
