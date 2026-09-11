# template/plugins — 네이티브 플러그인 작업 사양서

각 폴더는 *코드 없이* `SPEC.md` 만 들어 있다. dev 가 SDK 검토 + 디바이스 테스트를
거쳐 채워야 하는 항목들이라, **잘못된 스켈레톤 코드를 떨궈두면 더 혼란스러워서** 사양만 둔다.

| 플러그인 | 카테고리 | 우선순위 | 비고 |
|---|---|---|---|
| `kakao/` | 인증 | **P0**(Poptale 국내 이전 한정) | Poptale 1.0.1+143 JWT 전체 전달 패턴. ⚠️ 길 C — **브로커 앱(팝챗·팝테일 글로벌)은 불필요**(`docs/25` §3) |
| `naver/` | 인증 | **P0**(Poptale 국내 이전 한정) | Poptale 0.28.13+93 동작 매칭. ⚠️ 같음 |
| `adbrix/` | 어트리뷰션 | **P0** | Poptale 1.1.13+181 DFINERY |
| `whatap/` | APM | **P1/보류** | 모바일 APM 도입 여부 의사결정 선행 |

## 작업 순서 (권장)

1. **Kakao → Naver** 먼저 (소셜 로그인. Poptale 의 핵심)
2. **Adbrix** (어트리뷰션. 배선 패턴이 AppsFlyer 와 거의 동일하므로 카피)
3. **WhaTap** (도입 여부부터 결정. 안 쓰면 폴더 삭제)

## 공통 규칙

- 시크릿 키는 **환경변수**(`*_KEY_<SLUG>` 우선, fallback `*_KEY`). config / 레포 금지.
- iOS pbxproj 패치가 필요한 부분(엔타이틀먼트, URL scheme, Info.plist)은 `generate-app.mjs`
  의 ios 분기에서 적용. 첫 macOS 빌드에서 손작업 발생 가능 → 그 경험을 문서화.
- 카카오/네이버는 Android 키 해시를 콘솔에 *추가 등록* 해야 함 (기존 Flutter 해시 유지).

## 참고

- 배선 절차 전반: [docs/13-MARKETING.md §4](../../docs/13-MARKETING.md)
- Poptale 호환성: [docs/21-POPTALE-MIGRATION.md §3](../../docs/21-POPTALE-MIGRATION.md)
