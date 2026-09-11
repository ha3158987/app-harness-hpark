# template/plugins — 네이티브 플러그인 작업 사양서

각 폴더는 *코드 없이* `SPEC.md` 만 들어 있다. dev 가 SDK 검토 + 디바이스 테스트를
거쳐 채워야 하는 항목들이라, **잘못된 스켈레톤 코드를 떨궈두면 더 혼란스러워서** 사양만 둔다.

| 플러그인 | 카테고리 | 우선순위 | 비고 |
|---|---|---|---|
| `adbrix/` | 어트리뷰션 | **P0** | Poptale 1.1.13+181 DFINERY |
| `whatap/` | APM | **P1/보류** | 모바일 APM 도입 여부 의사결정 선행 |

## 작업 순서 (권장)

1. **Adbrix** (어트리뷰션. 배선 패턴이 AppsFlyer 와 거의 동일하므로 카피)
2. **WhaTap** (도입 여부부터 결정. 안 쓰면 폴더 삭제)

> **Kakao/Naver 네이티브 SDK 플러그인 사양은 2026-09-11 에 삭제했다.** 소셜 로그인은 브라우저 OAuth(길 B) 또는
> 브로커(A′)로 돈다 — `docs/25` §3. "카카오톡 앱으로 점프" UX 가 다시 필요해지면 그 시점의 코드 기준으로 새로 쓴다.

## 공통 규칙

- 시크릿 키는 **환경변수**(`*_KEY_<SLUG>` 우선, fallback `*_KEY`). config / 레포 금지.
- iOS pbxproj 패치가 필요한 부분(엔타이틀먼트, URL scheme, Info.plist)은 `generate-app.mjs`
  의 ios 분기에서 적용. 첫 macOS 빌드에서 손작업 발생 가능 → 그 경험을 문서화.

## 참고

- 배선 절차 전반: [docs/13-MARKETING.md §4](../../docs/13-MARKETING.md)
- Poptale 호환성: [docs/21-POPTALE-MIGRATION.md §3](../../docs/21-POPTALE-MIGRATION.md)
