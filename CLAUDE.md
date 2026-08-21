# CLAUDE.md — Appharness 작업 지침 + 문서 색인

> 이 파일은 Claude Code 가 **매 세션 자동으로 읽는** 파일이다. 사람도 같은 색인을 본다.
> 레포의 문서 색인은 **이 파일 하나뿐이다.**

---

## 0. 작업 시작 전 — 반드시 이 순서를 따른다

**어떤 작업이든 코드를 건드리기 전에:**

1. **이 파일의 §1 라우팅 표에서 지금 작업에 해당하는 행을 찾는다.**
2. **그 행이 지정한 문서를 실제로 읽는다.** 파일명·기억·추측으로 대신하지 마라 — 문서는 `docs/` 에 번호순으로 있다.
3. **[`docs/01-AIPIA-CONVENTIONS.md`](docs/01-AIPIA-CONVENTIONS.md) 는 전사 표준 정본이다.** 번들ID·도메인·소셜·SDK·이벤트명·최소OS 는 여기를 따른다. 다른 문서와 충돌하면 **01 이 이긴다.**
4. **config 스키마는 [`docs/02-GUIDE.md`](docs/02-GUIDE.md) §6 이 정본이다.** 스키마를 추측해서 키를 만들지 마라.
5. 읽은 문서와 근거를 사용자에게 밝히고 작업한다.

**해당 문서를 읽지 않은 상태로 다음을 하지 마라:**

- 번들ID · 패키지명 · 도메인 · 이벤트명을 새로 정하는 일 → **01 을 먼저 읽어라**
- `app.config.json` 키를 추가·변경하는 일 → **02 §6 을 먼저 읽어라**
- 배포 · 서명 · 시크릿을 건드리는 일 → **07 → 08 → 09 를 먼저 읽어라**
- 푸시 · ATT · 마케팅 SDK 배선 → **12 / 14 / 13 을 먼저 읽어라**

**절대 규칙:**

- 실제 키 · 비번 · 토큰 값을 레포에 커밋하지 않는다. (`docs/09-CREDENTIALS.md`)
- 프로덕션 스토어 공개(심사 제출 · 정식 릴리즈)는 자동화하지 않는다. 사람이 콘솔에서 한다.
- 앱 작업은 해당 스킬(`new-app` · `integrate-web` · `build-android` · `build-ios` · `bump-version` · `generate-assets` · `submit-store`)을 우선 사용한다. 직접 명령을 조립하지 마라.
- 요청받은 것만 한다. 문서·기능·추상화를 임의로 늘리지 않는다.

---

## 1. 작업별 라우팅 — 무엇을 하려면 무엇을 읽는가

| 작업 | 읽을 문서(번호순) | 주의 |
|---|---|---|
| 새 앱/서비스를 하네스에 추가 | 01 → 04 → 05 → 06 | `new-app` 스킬 사용. 01 의 전사 표준을 어기지 마라 |
| 웹 레포를 하네스에 연결(브릿지) | 06 → 01 | `integrate-web` 스킬 사용 |
| Android / iOS 빌드 | 07 → 08 | `build-android` / `build-ios` 스킬 사용 |
| 스토어 업로드 · 배포 | 07 → 08 → 09 | 프로덕션 공개는 절대 자동화하지 마라 |
| 버전 올리기 | 07 | `bump-version` 스킬 사용 |
| 로그인 / SSO 작업 | 10 → 01 | 백엔드 규약은 10 이 정본 |
| 인앱결제 작업 | 11 | 디지털 재화는 스토어 IAP 강제 |
| 푸시 알림 작업 | 12 → 08 | 순서를 어기면 iOS 빌드가 깨진다 |
| 마케팅 SDK / 어트리뷰션 | 13 → 14 → 15 | 키는 config·레포에 절대 넣지 마라 |
| ATT(추적 동의) 작업 | 14 → 15 | 15 는 설계·결정 기록 |
| 강제 업데이트 작업 | 23 → 02 §6 | Firebase 콘솔 **게시(Publish)** 를 빼먹지 마라 |
| 스토어 심사 · 개인정보 양식 | 16 → 17 |  |
| config 스키마 확인 | 02 §6 | 02 §6 이 스키마 정본 |
| 기능 지원 여부 / 기기 지원 확인 | 18 · 19 | 조회용 |
| Poptale 이전 | 01 → 21 |  |
| 아이콘 · 스플래시 | — | `generate-assets` 스킬 사용 |

---

## 2. 전체 문서 23개

전부 [`docs/`](docs/) 에 있다. 번호는 01 부터 연속이며 **마지막 번호 = 전체 개수(22)**.

| # | 문서 | 카테고리 | 대상 독자 | 상태 | 최종 수정 | 내용 |
|---|---|---|---|---|---|---|
| 01 | [AIPIA-CONVENTIONS](docs/01-AIPIA-CONVENTIONS.md) | 시작 | 개발자 | active | 2026-08-19 | 전사 표준 정본 — 번들ID·도메인·SDK·이벤트명 |
| 02 | [GUIDE](docs/02-GUIDE.md) | 시작 | 전체 | active | 2026-08-20 | 하네스 동작 방식 + config 스키마 정본 |
| 03 | [STRATEGY](docs/03-STRATEGY.md) | 전략 | 전체 | active | 2026-05-30 | 왜 이 구조인가 — 결정과 이유 |
| 04 | [NEW-APP-CHECKLIST](docs/04-NEW-APP-CHECKLIST.md) | 앱추가 | 배포담당자 | active | 2026-08-20 | 사람이 직접 할 콘솔·계정 작업 전부 |
| 05 | [SETUP](docs/05-SETUP.md) | 앱추가 | 개발자 | active | 2026-05-30 | 환경·키 단계별 준비 |
| 06 | [INTEGRATION](docs/06-INTEGRATION.md) | 앱추가 | 개발자 | active | 2026-05-30 | 프론트 통합 — bridge·어댑터·API |
| 07 | [HOWTO-DEPLOY](docs/07-HOWTO-DEPLOY.md) | 빌드배포 | 배포담당자 | active | 2026-06-19 | 배포 실전 절차 (진입점) |
| 08 | [DEPLOY](docs/08-DEPLOY.md) | 빌드배포 | 배포담당자 | active | 2026-08-06 | CI/CD·시크릿·서명 상세 |
| 09 | [CREDENTIALS](docs/09-CREDENTIALS.md) | 빌드배포 | 배포담당자 | active | 2026-08-20 | 자격증명 단일 출처 |
| 10 | [AUTH](docs/10-AUTH.md) | 기능연동 | 개발자 | active | 2026-05-30 | 로그인·SSO·탈퇴·백엔드 규약 |
| 11 | [IAP](docs/11-IAP.md) | 기능연동 | 전체 | active | 2026-06-01 | 인앱결제·가격분기·백엔드 검증 |
| 12 | [PUSH-NOTIFICATIONS](docs/12-PUSH-NOTIFICATIONS.md) | 기능연동 | 개발자 | active | 2026-08-10 | FCM 셋업 — 키·확장·발송 규약 |
| 13 | [MARKETING](docs/13-MARKETING.md) | 기능연동 | 개발자 | active | 2026-06-01 | 어트리뷰션·분석·CRM SDK |
| 14 | [ATT-INTEGRATION](docs/14-ATT-INTEGRATION.md) | 기능연동 | 개발자 | active | 2026-08-20 | 추적 동의(ATT) 연동 가이드 |
| 15 | [APP-GROWTH-FEATURES](docs/15-APP-GROWTH-FEATURES.md) | 기능연동 | 개발자 | active | 2026-08-20 | 성장 기능 설계·결정 기록 |
| 16 | [COMPLIANCE](docs/16-COMPLIANCE.md) | 정책 | 기획자 | active | 2026-05-30 | 권한 고지·개인정보·성인인증 |
| 17 | [DATA-COLLECTION](docs/17-DATA-COLLECTION.md) | 정책 | 기획자 | active | 2026-05-30 | 스토어 개인정보 양식 정답지 |
| 18 | [APP-FEATURES](docs/18-APP-FEATURES.md) | 레퍼런스 | 전체 | reference | 2026-05-30 | 지원 기능 + 패키지 버전 |
| 19 | [DEVICE-SUPPORT](docs/19-DEVICE-SUPPORT.md) | 레퍼런스 | 개발자 | reference | 2026-07-24 | 기기·OS 지원 매트릭스 |
| 20 | [REFERENCES](docs/20-REFERENCES.md) | 레퍼런스 | 개발자 | reference | 2026-05-30 | 외부 1차 소스 링크 |
| 21 | [POPTALE-MIGRATION](docs/21-POPTALE-MIGRATION.md) | 마이그레이션 | 전체 | active | 2026-06-01 | Poptale Flutter → 하네스 이전 인계 |
| 22 | [NATIVE_FEATURES_PLAN](docs/22-NATIVE_FEATURES_PLAN.md) | 마이그레이션 | 개발자 | reference | 2026-08-19 | characterchat 네이티브 기능 조사 스냅샷 |
| 23 | [FORCE-UPDATE](docs/23-FORCE-UPDATE.md) | 기능연동 | 개발자 | active | 2026-08-21 | 강제 업데이트 — Remote Config 콘솔 셋업 |

**상태** — `active`: 현행 문서, 순서대로 읽는다 · `reference`: 수시 조회용, 처음부터 읽을 필요 없다

각 문서 최상단 frontmatter(`doc` `title` `category` `audience` `status` `updated`)에 같은 정보가 있다.

---

## 3. 루트에 남아 있는 문서

| 문서 | 왜 루트인가 |
|---|---|
| [README.md](README.md) | GitHub 첫 화면 — 프로젝트 소개 · 아키텍처 · 레포 레이아웃 |
| [ONBOARDING.md](ONBOARDING.md) | `ShareOnboardingGuide` 툴이 레포 루트에서 읽는다 (옮기면 깨짐) |

---

## 4. 코드와 함께 있는 문서

옮기지 않는다 — 해당 코드를 볼 때 같이 읽는다.

| 위치 | 내용 |
|---|---|
| [idp/README.md](idp/README.md) | 중앙 IdP(Keycloak) 구동 |
| [backend/auth-reference/README.md](backend/auth-reference/README.md) | 백엔드 레퍼런스 구현 (인메모리 · 학습용) |
| [secrets/README.md](secrets/README.md) | 로컬 키 파일 배치 규칙 |
| [template/plugins/README.md](template/plugins/README.md) | 네이티브 플러그인 작업 개요 |
| [template/plugins/](template/plugins/) `{kakao,naver,adbrix,whatap}/SPEC.md` | 플러그인별 작업 사양서 |
| [.claude/skills/](.claude/skills/) `*/SKILL.md` | 자동화 스킬 정의 (하네스가 경로로 로드 — 옮기지 마라) |

---

## 5. 문서 관리 규칙

1. 문서는 `docs/` 에만 둔다. 번호는 **01 부터 빈칸 없이 연속** — 마지막 번호 = 전체 개수(현재 **23**).
2. 새 문서는 해당 카테고리 블록의 **끝 번호**를 받는다. 뒤 문서를 밀지 않는다 (링크가 깨진다). 전면 재정렬은 별도 작업으로 한 번에 한다.
3. 모든 문서는 frontmatter 6개 키를 갖는다. 새 문서도 반드시 붙인다.
4. **색인은 이 파일 하나다.** 다른 문서에 문서 목록 표를 새로 만들지 않는다 — 반드시 낡는다. (README 와 `02-GUIDE §8` 에 있던 중복 색인을 이 파일로 합쳤다.)
5. 문서를 추가·삭제하면 §1 라우팅 · §2 표 · §2 개수 · §5 개수를 **같이** 갱신한다.
6. 문서 간 링크는 `docs/` 안에서는 `./NN-NAME.md`, 루트에서는 `docs/NN-NAME.md`, 하위 디렉토리에서는 `../docs/NN-NAME.md` 로 쓴다.
