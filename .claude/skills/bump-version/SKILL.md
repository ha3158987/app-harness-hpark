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
4. 변경 전/후 값을 사용자에게 보고.

## 주의
- version.code 를 절대 내리거나 중복하지 않는다.
- 여러 앱 동시 bump 요청이면 각 slug 별로 처리하고 결과를 표로 요약.
