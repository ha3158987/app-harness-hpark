# 하네스 인증 provider 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하네스 브릿지가 팝챗의 소셜 8종 자격증명을 운반하고 미완료 가입 신호를 웹에 그대로 넘기게 한다 — 서비스 BE 없이 스텁으로 전 과정을 검증한다.

**Architecture:** 브릿지는 **운반만 하고 해석하지 않는다.** 공급자와의 OAuth 는 시스템 브라우저에서 앱이 직접 돌고(길 B), 받은 `authorizationCode` 를 `sessionEndpoint` 로 POST 한 뒤 **응답을 통째로** 웹에 올린다. `signupToken` 같은 서비스 고유 개념은 브릿지가 이름조차 몰라야 한다 — 그래야 팝테일 글로벌 앱이 같은 브릿지를 물려받는다.

**Tech Stack:** Node 20 ESM · `node --test`(내장, 새 러너 설치 없음) · Capacitor 8 · 빌드 스텝 없는 브릿지(`template/bridge/dist/index.js` 가 곧 소스)

---

## 배경 — 착수 전 반드시 읽을 것

`docs/25-AUTH-DELEGATION.md` 가 이 작업의 설계 원본이다. 읽고 시작한다.

**전제:** PR #24(문서) → #25(자체 IdP 제거)가 **2026-08-26 에 순서대로 머지됐다**(`bc7abd2` → `4f855e7`). 그 `main` 에서 분기한다.

아래 줄 번호는 전부 머지된 `main` 기준으로 실측했다 — `git log --oneline -3` 에 위 두 커밋이 보이지 않으면 멈추고 보고한다.

**`docs/10-AUTH.md` 는 상단 배너부터 읽는다.** §3 공급자별 토큰 교환표와 §5 Keycloak 설치 체크리스트는 **제거된 경로의 배경 기록**이다. 따라 하지 않는다. 게스트 로그인·회원탈퇴·기기/세션 관리 절은 지금도 유효하다.

### 이미 구현돼 있는 것 — 새로 만들지 마라

`login()` · `completeSignup()` · `getLastLogin()` · `logout()` · `deleteAccount()` · `secureSet/Get/Remove` · `enableBiometricLogin()` · `unlock()` · `onKeyboard()` · Apple 네이티브 로그인 · 커스텀 스킴 자동 등록 · `deviceId`/`platform` 자동 첨부.

### 확인된 사실 — 다시 조사하지 마라

| 사실 | 근거 |
|---|---|
| 브릿지에 빌드 스텝이 없다. `dist/index.js` 가 편집 대상 소스이고 `dist/index.d.ts` 도 손으로 고친다 | `template/bridge/package.json` 에 build 스크립트 없음 |
| auth 서버는 8종을 이미 지원한다 (`kakao`·`naver`·`google`·`apple` / `line`·`x`·`facebook`·`discord`). **팝챗은 이 8종을 전부 쓴다.** 개통 요청 불필요, 확인만 | 스펙 037 |
| `threads` 는 하네스 프리셋에만 있고 auth 가 지원하지 않는다 — `providers` 에 넣지 마라 | 위와 같음 |
| `facebook` 은 일반 공개 심사 전까지 역할자 계정만 로그인된다 | 위와 같음 |
| `poptale-frontend` 는 레거시 4종만 붙였다 — **line·discord 는 참조할 프론트 구현이 없다** | `src/hooks/auth/useSnsLogin.ts` 의 `SnsProvider` 가 4종 |
| `apps/characterchat` 에 `auth` 블록이 아예 없고 `deepLink`·`secureStorage`·`biometric` 이 전부 `false` | 아래 Task 6 에서 실측 |
| `apps/characterchat-dev` 는 `auth` 에 `deviceEndpoint` 하나뿐이고 위 세 feature 는 **이미 `true`** | 위와 같음 |

### 하지 말 것

- 브릿지 소스에 `signupToken`·`portone`·`verificationId`·`cc_session`·약관·본인인증 같은 **서비스 고유 이름**을 넣지 마라.
- 인증 UI 를 그리지 마라. 화면·문구·플로우는 전부 웹이 소유한다.
- 세션 정책(만료·동시 로그인·원격 로그아웃)을 넣지 마라.
- `login()` 의 **기존 반환 필드를 제거하거나 이름을 바꾸지 마라.** 웹 1.2.2 설치본이 이미 쓰고 있다.
- 자체 IdP 모드를 되살리지 마라(#25 에서 제거됨). 필요해 보이면 멈추고 보고한다.
- `threads` 를 허용목록에서 지우지 마라. auth 미지원이라 팝챗은 안 쓰지만 다른 앱이 쓸 수 있다.
- ★ `git add` 의 에러를 `2>/dev/null` 로 가리지 마라. 커밋 후 반드시 `git diff --name-only origin/main...HEAD` 로 의도한 파일이 다 들어갔는지 확인한다.

---

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `template/bridge/dist/index.js` | 브릿지 구현 전부. `OAUTH_PRESETS`(:40) · `_oauth2()` · `_finishLogin()` | 수정 |
| `template/bridge/dist/index.d.ts` | 웹(TypeScript)이 보는 타입 표면. `AuthProvider` union(:53) · `login()` 반환 타입 | 수정 |
| `scripts/lib/config.mjs` | config 스키마 · 검증 · `AIPIA_DEFAULTS` · `aipiaPreset()`. `KNOWN_AUTH_PROVIDERS`(:76) · provider 검증(:303) | 수정 |
| `scripts/generate-app.mjs` | 네이티브 프로젝트 생성 · `authSetup()` 경고 수집 | 수정 |
| `test/providers.test.mjs` | **신규.** provider 목록이 3곳에서 동기화됐는지 | 생성 |
| `test/finish-login.test.mjs` | **신규.** `_finishLogin` 의 미완료 판정과 pass-through | 생성 |
| `test/config-validation.test.mjs` | **신규.** config 검증 규칙 | 생성 |
| `test/helpers/stub-globals.mjs` | **신규.** `fetch`·`location` 스텁 (테스트 3개가 공유) | 생성 |
| `apps/characterchat-dev/app.config.json` | dev 슬러그 앱 정의 | 수정 |
| `apps/characterchat/app.config.json` | prod 슬러그 앱 정의 | 수정 |
| `docs/10-AUTH.md` | 세 경로 병렬 기술 | 수정 |

`test/` 를 파일 3개로 나눈 이유는 관심사가 다르기 때문이다 — provider 목록 동기화(정적), 로그인 응답 처리(동적), config 검증(순수 함수). 함께 바뀌지 않으므로 함께 두지 않는다.

---

## Task 1: 테스트 하네스 셋업

지금 이 레포에는 테스트 러너가 없다(`package.json` 스크립트가 `generate`·`check` 둘뿐). 새 러너를 설치하지 않고 **Node 20 내장 `node --test`** 를 쓴다 — 이 레포는 다른 팀이 받아 쓰는 배포 패키지라 devDependency 를 늘리지 않는 편이 낫다.

브릿지가 `@capacitor/core` 를 top-level import 하므로 그것만 devDependency 로 넣는다. 이미 `peerDependencies` 에 `^8.0.0` 으로 선언돼 있고 공개 npm 에서 받는다(현재 8.5.0).

**Files:**
- Modify: `package.json`
- Create: `test/helpers/stub-globals.mjs`
- Create: `test/providers.test.mjs`

- [ ] **Step 1: `@capacitor/core` 를 devDependency 로 설치**

```bash
cd /Users/hyuna_park/Documents/app-harness
npm i -D @capacitor/core
```

Expected: `added N packages`, `package.json` 의 `devDependencies` 에 `"@capacitor/core": "^8.5.0"` 추가

- [ ] **Step 2: 브릿지가 Node 에서 import 되는지 확인**

```bash
node --input-type=module -e "import('./template/bridge/dist/index.js').then(m => console.log('exports:', Object.keys(m).join(','), '| _finishLogin:', typeof m.AppBridge._finishLogin))"
```

Expected: `exports: AppBridge,default | _finishLogin: function`

이게 실패하면 이후 Task 3·4 의 테스트가 성립하지 않는다. 실패 시 멈추고 보고한다.

- [ ] **Step 3: `package.json` 에 test 스크립트 추가**

`scripts` 블록을 아래로 바꾼다.

```json
  "scripts": {
    "generate": "node scripts/generate-app.mjs",
    "check": "node --check scripts/generate-app.mjs",
    "test": "node --test test/"
  },
```

- [ ] **Step 4: 공유 스텁 헬퍼 작성**

`test/helpers/stub-globals.mjs` 를 만든다.

```js
// 브릿지는 브라우저 전역(fetch · location)을 직접 쓴다. Node 테스트에서 그 둘을 갈아끼운다.
// 각 테스트는 반드시 restore() 를 호출해 전역을 되돌린다 — 안 그러면 테스트 간 오염된다.

/**
 * @param {object} responseBody sessionEndpoint 가 돌려줄 JSON 바디
 * @param {{ ok?: boolean }} [opts] HTTP 성공 여부 (기본 true)
 * @returns {{ reloaded: () => boolean, requests: object[], restore: () => void }}
 */
export function stubGlobals(responseBody, opts = {}) {
  const origFetch = globalThis.fetch;
  const origLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

  let reloadCalled = false;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: opts.ok !== false,
      json: async () => responseBody,
    };
  };
  Object.defineProperty(globalThis, 'location', {
    value: { reload: () => { reloadCalled = true; } },
    configurable: true,
    writable: true,
  });

  return {
    reloaded: () => reloadCalled,
    requests,
    restore() {
      globalThis.fetch = origFetch;
      if (origLocation) Object.defineProperty(globalThis, 'location', origLocation);
      else delete globalThis.location;
    },
  };
}
```

- [ ] **Step 5: 현재 상태를 고정하는 회귀 테스트 작성**

`test/providers.test.mjs` 를 만든다. **지금은 통과해야 한다** — 이 테스트의 목적은 Task 2 에서 3곳을 동시에 고치도록 강제하는 것이다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** dist/index.js 의 OAUTH_PRESETS 에 등장하는 provider 키를 뽑는다. */
function presetProviders() {
  const src = readFileSync(join(ROOT, 'template/bridge/dist/index.js'), 'utf8');
  const block = src.match(/const OAUTH_PRESETS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'OAUTH_PRESETS 블록을 찾지 못했다');
  return [...block[1].matchAll(/^\s{2}(\w+):\s*\{/gm)].map((m) => m[1]);
}

/** dist/index.d.ts 의 AuthProvider union 멤버를 뽑는다. */
function typeProviders() {
  const src = readFileSync(join(ROOT, 'template/bridge/dist/index.d.ts'), 'utf8');
  const line = src.match(/export type AuthProvider =([^;]+);/);
  assert.ok(line, 'AuthProvider union 을 찾지 못했다');
  return [...line[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
}

/** config.mjs 의 KNOWN_AUTH_PROVIDERS 를 뽑는다. */
function knownProviders() {
  const src = readFileSync(join(ROOT, 'scripts/lib/config.mjs'), 'utf8');
  const line = src.match(/const KNOWN_AUTH_PROVIDERS = \[([^\]]+)\]/);
  assert.ok(line, 'KNOWN_AUTH_PROVIDERS 를 찾지 못했다');
  return [...line[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
}

test('허용목록과 타입 union 이 같은 집합이다', () => {
  // email 은 웹이 처리하므로 OAUTH_PRESETS 에는 없다 — 타입과 허용목록에만 있다.
  assert.deepEqual([...knownProviders()].sort(), [...typeProviders()].sort());
});

test('email 을 뺀 모든 provider 에 OAuth 프리셋이 있다', () => {
  const social = knownProviders().filter((p) => p !== 'email');
  const presets = presetProviders();
  const missing = social.filter((p) => !presets.includes(p));
  assert.deepEqual(missing, [], `프리셋 없는 provider: ${missing.join(', ')}`);
});
```

- [ ] **Step 6: 테스트 실행 — 통과해야 한다**

```bash
npm test
```

Expected: `# pass 2`, `# fail 0`

실패하면 현재 코드가 이미 어긋나 있다는 뜻이다. 어느 쪽이 어긋났는지 보고하고 멈춘다.

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json test/
git commit -m "test: node --test 하네스 셋업 + provider 3곳 동기화 회귀 테스트"
```

---

## Task 2: H-1 — `line` · `discord` 를 세 곳에 동시에 추가

같은 누락이 세 곳에 흩어져 있다. **하나만 고치면 다른 데서 막힌다.**

★ `scripts/lib/config.mjs:303` 의 미지 provider 검증은 경고가 아니라 **`throw`** 다. 허용목록을 안 넓히고 Task 6 에서 `line` 을 넣으면 config 파싱이 즉시 실패한다 — **그래서 이 Task 가 Task 6 보다 먼저다.**

★ `.d.ts` 를 빼먹으면 웹(TypeScript)에서 `login('line')` 이 컴파일 에러가 난다.

**Files:**
- Modify: `template/bridge/dist/index.js:40` (`OAUTH_PRESETS`)
- Modify: `template/bridge/dist/index.d.ts:53` (`AuthProvider`)
- Modify: `scripts/lib/config.mjs:76` (`KNOWN_AUTH_PROVIDERS`)
- Test: `test/providers.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/providers.test.mjs` 끝에 아래를 추가한다.

```js
test('팝챗이 쓰는 8종이 세 곳 전부에 있다', () => {
  // 팝챗 = auth 가 지원하는 SNS 8종 전부 + email. threads 는 auth 미지원이라 빠진다.
  const 팝챗 = ['email', 'kakao', 'naver', 'line', 'google', 'apple', 'facebook', 'x', 'discord'];
  const known = knownProviders();
  const types = typeProviders();
  const presets = presetProviders();

  for (const p of 팝챗) {
    assert.ok(known.includes(p), `KNOWN_AUTH_PROVIDERS 에 ${p} 없음`);
    assert.ok(types.includes(p), `AuthProvider union 에 ${p} 없음`);
    if (p !== 'email') assert.ok(presets.includes(p), `OAUTH_PRESETS 에 ${p} 없음`);
  }
});

test('generate-app 의 OAUTH_PRESET_PROVIDERS 가 브릿지 프리셋과 같다', () => {
  // Task 5 에서 만드는 상수다. 손으로 복제한 목록이라 drift 를 테스트로 막는다.
  const src = readFileSync(join(ROOT, 'scripts/generate-app.mjs'), 'utf8');
  const block = src.match(/const OAUTH_PRESET_PROVIDERS = \[([\s\S]*?)\]/);
  if (!block) return; // Task 5 이전에는 상수가 없다 — 그때는 건너뛴다
  const listed = [...block[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), [...presetProviders()].sort());
});

test('threads 를 지우지 않았다', () => {
  // auth 가 지원하지 않아 팝챗은 안 쓰지만, 하네스 프리셋에는 남겨 둔다(다른 앱이 쓸 수 있다).
  assert.ok(knownProviders().includes('threads'), 'threads 가 사라졌다');
});
```

- [ ] **Step 2: 실행해서 실패를 확인**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)|not ok"
```

Expected: `not ok` 가 1건 이상, `# fail 1` — 메시지는 `KNOWN_AUTH_PROVIDERS 에 line 없음`

- [ ] **Step 3: `OAUTH_PRESETS` 에 두 종 추가**

`template/bridge/dist/index.js` 의 `OAUTH_PRESETS` 블록에서 `naver` 줄 **다음에** 아래 두 줄을 넣는다.

```js
  // TODO(G0-4): authorizeUrl · scopes 는 auth 콘솔 등록값과 대조해 확정한다.
  //   아래는 각 사 공개 문서 기준값 — 콘솔 확인 전까지 임의 확정하지 마라.
  line:     { authorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize', scopes: ['profile', 'openid'] },
  discord:  { authorizeUrl: 'https://discord.com/oauth2/authorize', scopes: ['identify', 'email'] },
```

- [ ] **Step 4: `AuthProvider` union 확장**

`template/bridge/dist/index.d.ts:53` 을 아래로 바꾼다.

```ts
export type AuthProvider = 'email' | 'apple' | 'google' | 'naver' | 'kakao' | 'facebook' | 'x' | 'threads' | 'line' | 'discord';
```

- [ ] **Step 5: `KNOWN_AUTH_PROVIDERS` 확장**

`scripts/lib/config.mjs:76` 을 아래로 바꾼다.

```js
const KNOWN_AUTH_PROVIDERS = ['email', 'apple', 'google', 'naver', 'kakao', 'facebook', 'x', 'threads', 'line', 'discord'];
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 4`, `# fail 0`

- [ ] **Step 7: 기존 앱이 안 깨졌는지 확인**

```bash
node scripts/doctor.mjs 2>&1 | tail -1
```

Expected: `결과: 5 앱, 경고 8, 오류 0`

- [ ] **Step 8: 커밋**

```bash
git add template/bridge/dist/index.js template/bridge/dist/index.d.ts scripts/lib/config.mjs test/providers.test.mjs
git commit -m "feat(auth): line · discord provider 추가 (프리셋 · 타입 · 허용목록 3곳)"
```

---

## Task 3: H-2 — `signupRequired` 를 미완료 신호로 인식

`_finishLogin` 은 지금 `complete:false` · `isNew` · `needsProfile` · `needsConsent` 넷만 보고 새로고침을 멈춘다. **BE 가 쓰는 필드명은 `signupRequired` 다.** 그대로 두면 가입 미완료 사용자가 새로고침에 튕겨 나가 약관 화면을 못 본다.

기존 네 개는 **그대로 둔다** — 다른 앱이 쓰고 있을 수 있다.

**Files:**
- Modify: `template/bridge/dist/index.js` (`_finishLogin` 의 `incomplete` 판정)
- Test: `test/finish-login.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/finish-login.test.mjs` 를 만든다.

```js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge } from '../template/bridge/dist/index.js';
import { stubGlobals } from './helpers/stub-globals.mjs';

let stub = null;
afterEach(() => { stub?.restore(); stub = null; });

/** sessionEndpoint 를 세팅하고 _finishLogin 을 부른다. */
async function finishLoginWith(responseBody) {
  stub = stubGlobals(responseBody);
  AppBridge.config = { auth: { sessionEndpoint: 'https://stub.test/auth/native' } };
  const result = await AppBridge._finishLogin(
    { ok: true, authorizationCode: 'CODE', codeVerifier: 'VERIFIER' },
    {},
  );
  return { result, reloaded: stub.reloaded() };
}

test('signupRequired:true 면 새로고침하지 않는다', async () => {
  const { reloaded } = await finishLoginWith({ signupRequired: true, signupToken: 'dummy' });
  assert.equal(reloaded, false, 'signupRequired 인데 location.reload() 가 불렸다');
});

test('가입이 끝난 기존 회원은 새로고침한다', async () => {
  const { reloaded } = await finishLoginWith({ user: { id: 1 } });
  assert.equal(reloaded, true, '기존 회원인데 새로고침이 안 됐다');
});

test('기존 미완료 플래그 네 개도 그대로 동작한다', async () => {
  for (const body of [
    { complete: false },
    { isNew: true },
    { needsProfile: true },
    { needsConsent: true },
  ]) {
    const { reloaded } = await finishLoginWith(body);
    assert.equal(reloaded, false, `${JSON.stringify(body)} 에서 새로고침이 일어났다`);
  }
});
```

- [ ] **Step 2: 실행해서 실패를 확인**

```bash
npm test 2>&1 | grep -E "not ok|^# (pass|fail)"
```

Expected: `not ok 1 - signupRequired:true 면 새로고침하지 않는다`, `# fail 1`
(나머지 두 테스트는 통과한다 — 현재 동작이므로)

- [ ] **Step 3: 판정 목록에 `signupRequired` 추가**

`template/bridge/dist/index.js` 에서 아래 줄을 찾는다.

```js
      const incomplete = data.complete === false || !!data.isNew || !!data.needsProfile || !!data.needsConsent;
```

아래로 바꾼다.

```js
      // 미완료 신호는 백엔드마다 이름이 다르다 — 하나라도 서면 "가입 안 끝남"으로 본다.
      // 브릿지는 이 플래그들의 의미를 해석하지 않는다. 새로고침 여부만 가른다.
      const incomplete = data.complete === false
        || !!data.isNew || !!data.needsProfile || !!data.needsConsent || !!data.signupRequired;
```

주석 위쪽의 설명 줄도 함께 고친다. 아래 줄을 찾아서

```js
  //   백엔드 응답 플래그: { isNew, needsProfile, needsConsent, complete:false } 중 하나면 "미완료"
```

아래로 바꾼다.

```js
  //   백엔드 응답 플래그: { isNew, needsProfile, needsConsent, signupRequired, complete:false }
  //   중 하나면 "미완료"
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 7`, `# fail 0`

- [ ] **Step 5: 커밋**

```bash
git add template/bridge/dist/index.js test/finish-login.test.mjs
git commit -m "fix(auth): signupRequired 를 미완료 신호로 인식 — 가입 중 새로고침 방지"
```

---

## Task 4: H-3 — BE 응답을 통째로 웹에 올린다

지금 `_finishLogin` 은 BE 응답 전체를 `backend: data` **아래에만** 담는다. 웹과 합의한 계약은

```
login(provider) → { ok, reason?, signupRequired?, ...BE 응답 전부 }
```

즉 **top-level 스프레드**다. `signupToken` 이 top-level 에 없으면 웹이 가입을 완주할 수 없다.

★ `backend: data` 는 **지우지 않는다.** 웹 1.2.2 설치본이 쓰고 있을 수 있고, "기존 반환 필드를 제거하지 마라"가 계약이다.

★ 스프레드 순서가 중요하다. `...data` 를 먼저 펼치고 브릿지가 계산한 필드를 뒤에 둬야, BE 가 `ok` 같은 이름을 보내도 브릿지의 판정을 덮어쓰지 못한다.

**Files:**
- Modify: `template/bridge/dist/index.js` (`_finishLogin` 반환값)
- Modify: `template/bridge/dist/index.d.ts` (`login()` 반환 타입에 인덱스 시그니처)
- Test: `test/finish-login.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/finish-login.test.mjs` 끝에 추가한다.

```js
test('BE 응답의 미지 필드가 top-level 에 그대로 온다', async () => {
  const { result } = await finishLoginWith({
    signupRequired: true,
    signupToken: 'st_abc123',
    아직없는필드: 42,
  });
  assert.equal(result.signupToken, 'st_abc123', 'signupToken 이 top-level 에 없다');
  assert.equal(result.signupRequired, true, 'signupRequired 가 top-level 에 없다');
  assert.equal(result.아직없는필드, 42, '미지 필드가 버려졌다');
});

test('backend 필드는 하위호환으로 그대로 남는다', async () => {
  const { result } = await finishLoginWith({ signupToken: 'st_abc123' });
  assert.equal(result.backend.signupToken, 'st_abc123');
});

test('BE 응답이 브릿지 판정 필드를 덮어쓰지 못한다', async () => {
  // BE 가 실수로 ok:false 를 보내도 자격증명 회수 성공 사실은 유지돼야 한다.
  const { result } = await finishLoginWith({ ok: false, session: false });
  assert.equal(result.ok, true, 'BE 응답이 ok 를 덮어썼다');
  assert.equal(result.session, true, 'BE 응답이 session 을 덮어썼다');
});
```

- [ ] **Step 2: 실행해서 실패를 확인**

```bash
npm test 2>&1 | grep -E "not ok|^# (pass|fail)"
```

Expected: `not ok` 2건(`top-level`·`덮어쓰지`), `# fail 2`

- [ ] **Step 3: 반환값을 스프레드로 바꾼다**

`template/bridge/dist/index.js` 의 `_finishLogin` 에서 아래 블록을 찾는다.

```js
      return {
        ...credential,
        session: res.ok,
        user: data.user || credential.user,
        isNew: !!data.isNew,
        needsProfile: !!(data.needsProfile || data.needsConsent),
        backend: data,
      };
```

아래로 바꾼다.

```js
      // 미지 필드 pass-through — 브릿지는 백엔드 응답에서 아는 필드만 골라내지 않는다.
      // 서비스마다 필요한 필드가 다르고(가입 토큰 등) 브릿지는 그 의미를 몰라야 하므로,
      // 통째로 올리고 해석은 웹에 맡긴다.
      // ★ ...data 를 먼저 펼친다 — 뒤의 필드가 이겨야 백엔드가 브릿지 판정을 덮어쓰지 못한다.
      return {
        ...data,
        ...credential,
        session: res.ok,
        user: data.user || credential.user,
        isNew: !!data.isNew,
        needsProfile: !!(data.needsProfile || data.needsConsent),
        backend: data, // 하위호환 — 기존 소비자가 쓴다. 지우지 마라.
      };
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 10`, `# fail 0`

- [ ] **Step 5: `.d.ts` 반환 타입에 인덱스 시그니처 추가**

`login()` 은 `Promise<AuthResult2>` 를 반환한다(`index.d.ts:202`). 고칠 곳은 `AuthResult2` 인터페이스(`:55`)다. 아래 두 줄을 `reason?: string;` **다음**, 닫는 중괄호 **앞**에 넣는다.

```ts
  /** 백엔드가 돌려준 가입 미완료 신호. 브릿지는 해석하지 않고 그대로 올린다. */
  signupRequired?: boolean;
  /** 서비스 백엔드 응답의 나머지 필드 전부 — 브릿지는 의미를 모른다.
   *  ★ 위 명시 필드가 전부 이 타입에 대입 가능해야 한다(unknown 이므로 문제없다). */
  [key: string]: unknown;
```

수정 후 인터페이스는 이렇게 끝난다.

```ts
  backend?: unknown;
  reason?: string;
  /** 백엔드가 돌려준 가입 미완료 신호. 브릿지는 해석하지 않고 그대로 올린다. */
  signupRequired?: boolean;
  /** 서비스 백엔드 응답의 나머지 필드 전부 — 브릿지는 의미를 모른다. */
  [key: string]: unknown;
}
```

- [ ] **Step 6: 타입이 실제로 그렇게 읽히는지 확인**

```bash
grep -n -A 3 "signupRequired" template/bridge/dist/index.d.ts
```

Expected: `signupRequired?: boolean;` 과 `[key: string]: unknown;` 이 `AuthResult2` 안에 있다

- [ ] **Step 7: 서비스 고유 이름이 안 들어갔는지 확인**

```bash
grep -n "signupToken\|portone\|verificationId\|cc_session" template/bridge/dist/index.js template/bridge/dist/index.d.ts
```

Expected: **출력 없음(0건).** 한 건이라도 나오면 원칙 위반이니 되돌린다.

- [ ] **Step 8: 커밋**

```bash
git add template/bridge/dist/index.js template/bridge/dist/index.d.ts test/finish-login.test.mjs
git commit -m "feat(auth): sessionEndpoint 응답 미지 필드 pass-through + 반환 타입 인덱스 시그니처"
```

---

## Task 5: H-4 — config 검증 강화

두 가지를 막는다.

1. **프리셋도 `authorizeUrl` 도 없는 provider** — `providers` 에는 있는데 OAuth 를 시작할 방법이 없는 상태. 지금은 런타임에 `oauth-misconfigured` 로 조용히 실패한다.
2. **스토어 요건 누락** — Apple 4.8(소셜 제공 시 Sign in with Apple 필수)과 `deleteEndpoint`(탈퇴). 지금은 경고라 그냥 지나간다.

★ **릴리즈 빌드에서만 `exit 1`** 로 올린다. dev 빌드는 경고로 통과해야 한다 — 기존 앱 5개가 즉시 빨간불이 되면 안 된다.

> 🔴 **이 게이트는 배포 중인 앱을 깨뜨릴 수 있다 — Step 7 을 반드시 수행해라.**
>
> `apps/poptale`(v1.1.15+183, **배포 중**)은 `google`·`kakao`·`naver` 에 `clientId` 가 없다.
> `apps/aipia` 도 6종이 비어 있다. 게이트를 넣으면 그 앱들의 릴리즈 빌드가 실패한다.
>
> 팝테일 앱은 **네이티브 SDK 로그인(길 C)** 을 쓰므로 하네스 config 에 공급자 `clientId` 가
> 없는 것이 정상일 수 있다. 그렇다면 게이트가 오탐이다.
>
> **게이트를 약하게 만들지 마라.** Step 7 에서 실제로 어느 앱이 실패하는지 측정하고,
> 실패하면 멈추고 사람에게 보고해라. 판단(팝테일에 clientId 를 채울지 · 예외를 둘지 ·
> 게이트 범위를 좁힐지)은 사람이 한다.

**Files:**
- Modify: `scripts/generate-app.mjs` (`authSetup` 에 프리셋 부재 검사 추가)
- Modify: `scripts/generate-app.mjs` (릴리즈 게이트)
- Test: `test/config-validation.test.mjs`

- [ ] **Step 1: 현재 릴리즈 판정 방식 확인**

```bash
grep -n "release\|--release\|isRelease\|prod" scripts/generate-app.mjs | head -20
```

이 출력에서 **릴리즈 빌드를 가리는 기존 플래그**를 찾는다. 있으면 그것을 쓰고, 없으면 Step 3 에서 `--release` 를 새로 만든다. 어느 쪽인지 기록해 두고 진행한다.

- [ ] **Step 2: 실패하는 테스트 작성**

`test/config-validation.test.mjs` 를 만든다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const genSrc = () => readFileSync(join(ROOT, 'scripts/generate-app.mjs'), 'utf8');

test('프리셋도 authorizeUrl 도 없는 provider 를 경고한다', () => {
  // authSetup 이 OAUTH_PRESETS 를 참조해야만 이 검사가 가능하다.
  const src = genSrc();
  assert.match(
    src,
    /authorizeUrl/,
    'generate-app.mjs 가 authorizeUrl 부재를 전혀 보지 않는다',
  );
});

test('스토어 요건이 릴리즈에서만 치명적이다', () => {
  const src = genSrc();
  // 릴리즈 게이트가 존재하고, 그 안에서만 exit(1) 이 일어나야 한다.
  assert.match(src, /isRelease|--release/, '릴리즈 판정 플래그가 없다');
  assert.match(
    src,
    /isRelease[\s\S]{0,400}exit\(1\)/,
    '릴리즈 게이트 안에서 exit(1) 하는 코드가 없다',
  );
});
```

- [ ] **Step 3: 실행해서 실패를 확인**

```bash
npm test 2>&1 | grep -E "not ok|^# (pass|fail)"
```

Expected: `not ok 2 - 스토어 요건이 릴리즈에서만 치명적이다`, `# fail 1`

(첫 테스트는 이미 통과할 수 있다 — Step 1 에서 본 결과에 달렸다)

- [ ] **Step 4: `authSetup` 에 프리셋 부재 검사 추가**

`scripts/generate-app.mjs` 상단, `AUTH_NATIVE_PLUGINS` 선언 근처에 아래 상수를 추가한다.

```js
// 브릿지 OAUTH_PRESETS 와 같은 집합이어야 한다 — 여기 없고 config 에 authorizeUrl 도
// 없으면 앱은 OAuth 를 시작할 URL 자체를 모른다(런타임 oauth-misconfigured).
// test/providers.test.mjs 가 브릿지 쪽과의 동기화를 지킨다.
const OAUTH_PRESET_PROVIDERS = [
  'google', 'naver', 'kakao', 'apple', 'facebook', 'x', 'threads', 'line', 'discord',
];
```

`authSetup` 의 clientId 경고 루프를 아래로 바꾼다.

```js
  // 시스템 브라우저 OAuth 공급자는 공개 clientId 가 필요하다.
  for (const p of social) {
    if (p === 'apple') continue;
    if (!cfg.auth?.oauth?.[p]?.clientId) {
      warnings.push(`auth.oauth.${p}.clientId 누락 — OAuth 가 런타임에 동작하지 않음(빌드는 됨). ` +
        '공개 clientId 를 config 에 넣거나 빌드 시 주입하세요(client secret 은 백엔드 전용).');
    }
    // 프리셋도 authorizeUrl 도 없으면 시작할 URL 이 없다.
    if (!OAUTH_PRESET_PROVIDERS.includes(p) && !cfg.auth?.oauth?.[p]?.authorizeUrl) {
      warnings.push(`auth.oauth.${p}.authorizeUrl 누락 — "${p}" 는 브릿지 프리셋에 없어 ` +
        'authorize URL 을 config 에서 받아야 합니다.');
    }
  }
```

- [ ] **Step 5: 릴리즈 게이트 추가**

`scripts/generate-app.mjs` 에서 `authConf.warnings.forEach((w) => log.warn(w));` 줄을 찾는다(Step 1 에서 본 `:1453` 근처). 그 **바로 다음에** 아래를 넣는다.

```js
  // 스토어 요건은 릴리즈에서만 치명적이다. dev 빌드는 경고로 통과시킨다 —
  // 기존 앱이 이 변경 하나로 전부 빌드 불가가 되면 안 된다.
  const isRelease = process.argv.includes('--release');
  if (isRelease) {
    const fatal = [];
    const provs = cfg.auth?.providers || [];
    const social = provs.filter((p) => p !== 'email');
    if (social.some((p) => p !== 'apple') && !provs.includes('apple')) {
      fatal.push('Apple 가이드라인 4.8 — 소셜 로그인을 제공하면 "apple" 도 providers 에 필요합니다.');
    }
    if (provs.length && !cfg.auth?.deleteEndpoint) {
      fatal.push('auth.deleteEndpoint 누락 — 회원탈퇴는 App Store · Play 양쪽의 필수 요건입니다.');
    }
    for (const p of social) {
      if (p === 'apple') continue;
      if (!cfg.auth?.oauth?.[p]?.clientId) {
        fatal.push(`auth.oauth.${p}.clientId 누락 — 릴리즈 빌드에는 실제 clientId 가 있어야 합니다.`);
      }
    }
    if (fatal.length) {
      fatal.forEach((m) => log.err ? log.err(m) : console.error(`  ✗ ${m}`));
      console.error(`\n릴리즈 빌드 중단 — 위 ${fatal.length}건을 먼저 해결하세요. ` +
        '(dev 빌드는 --release 없이 실행하면 경고로 통과합니다)');
      process.exit(1);
    }
  }
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npm test 2>&1 | grep -E "^# (pass|fail)"
```

Expected: `# pass 12`, `# fail 0`

- [ ] **Step 7: dev 빌드가 안 깨지는지 확인**

```bash
node --check scripts/generate-app.mjs && node scripts/doctor.mjs 2>&1 | tail -1
```

Expected: `결과: 5 앱, 경고 8, 오류 0`

- [ ] **Step 7-1: ★ 전 앱에 릴리즈 게이트를 걸어 보고 실패를 측정한다**

게이트를 넣기 전에 **어느 앱이 깨지는지 먼저 안다.** 아래를 그대로 실행한다.

```bash
cd /Users/hyuna_park/Documents/app-harness
for f in apps/*/app.config.json; do
  python3 -c "
import json
d = json.load(open('$f'))
a = d.get('auth', {}); o = a.get('oauth', {}) or {}
prov = [p for p in a.get('providers', []) if p != 'email']
missing = [p for p in prov if p != 'apple' and not (o.get(p) or {}).get('clientId')]
need_apple = bool([p for p in prov if p != 'apple']) and 'apple' not in a.get('providers', [])
v = d.get('version', {})
flags = []
if missing: flags.append('clientId없음=' + ','.join(missing))
if need_apple: flags.append('apple누락(4.8)')
if prov and not a.get('deleteEndpoint'): flags.append('deleteEndpoint없음')
print('%-20s v%s+%-5s %s' % (d.get('slug'), v.get('name'), v.get('code'), ' | '.join(flags) or 'OK'))
"
done
```

Expected(2026-08-26 기준 실측값):

```
aipia                v1.0.0+1     clientId없음=google,naver,kakao,facebook,x,threads
characterchat-dev    v1.0.0+12    OK          ← Task 6 에서 auth 블록을 넣으면 바뀐다
characterchat        v1.0.0+1     OK          ← 위와 같음
poptale-dev          v1.1.15+183  clientId없음=google,kakao,naver
poptale              v1.1.15+183  clientId없음=google,kakao,naver
```

- [ ] **Step 7-2: 배포 중인 앱이 실패하면 멈추고 보고한다**

`poptale`(**배포 중** v1.1.15+183)이 위 목록에 있으면 **그대로 멈추고 사람에게 보고한다.**
보고 내용은 다음 세 가지다.

1. 어느 앱의 어느 provider 가 실패하는가
2. 그 앱이 하네스 OAuth(`_oauth2`)를 실제로 쓰는가, 아니면 네이티브 SDK 경로인가
   — `poptale-frontend` 의 `src/hooks/auth/useSnsLogin.ts` 를 보면 앱은 네이티브 SDK 를 쓴다
3. 선택지: ① 팝테일에 clientId 를 채운다 ② 앱별 예외를 둔다 ③ 게이트를 팝챗 슬러그로 좁힌다

**게이트를 조용히 약하게 만들거나, 실패하는 앱을 목록에서 빼지 마라.** 배포 중인 앱의
빌드가 깨지는 것은 사람이 알고 결정해야 하는 일이다.

- [ ] **Step 8: 커밋**

```bash
git add scripts/generate-app.mjs test/config-validation.test.mjs
git commit -m "feat(config): authorizeUrl 부재 탐지 + 스토어 요건을 릴리즈 빌드에서만 치명적으로"
```

---

## Task 6: H-5 — `characterchat` 앱 설정

★ **Task 2 완료 후에만 착수한다.** 허용목록을 안 넓히고 `line` 을 넣으면 `config.mjs:303` 이 `throw` 한다.

dev 슬러그부터 하고 검증 후 prod 슬러그로 간다.

**Files:**
- Modify: `apps/characterchat-dev/app.config.json`
- Modify: `apps/characterchat/app.config.json`

- [ ] **Step 1: 두 config 의 현재 상태를 기록**

```bash
cd /Users/hyuna_park/Documents/app-harness
python3 -c "
import json
for s in ('characterchat-dev','characterchat'):
    d = json.load(open('apps/%s/app.config.json' % s))
    f = d.get('features', {})
    print(s)
    print('  auth keys :', list(d.get('auth', {}).keys()) or '(auth 블록 없음)')
    print('  deepLink=%s secureStorage=%s biometric=%s' % (f.get('deepLink'), f.get('secureStorage'), f.get('biometric')))
    print('  startUrl  :', d.get('startUrl'))
"
```

이 출력을 기록해 둔다. 아래 Step 에서 **엔드포인트 도메인을 여기 `startUrl` 에 맞춰야** 한다.

- [ ] **Step 2: dev 슬러그에 `auth` 블록 작성**

`apps/characterchat-dev/app.config.json` 의 `auth` 블록을 아래로 **교체**한다. `deviceEndpoint` 는 기존 값을 그대로 유지하고, 도메인은 Step 1 에서 확인한 dev API 호스트로 맞춘다.

```json
  "auth": {
    "providers": ["email", "kakao", "naver", "line", "google", "apple", "facebook", "x", "discord"],
    "sessionEndpoint": "https://api.chat.dev.poptale.ai/auth/social/native",
    "signupEndpoint": "https://api.chat.dev.poptale.ai/auth/signup",
    "logoutEndpoint": "https://api.chat.dev.poptale.ai/auth/logout",
    "deleteEndpoint": "https://api.chat.dev.poptale.ai/auth/withdraw",
    "deviceEndpoint": "https://api.chat.dev.poptale.ai/auth/device",
    "oauth": {
      "kakao":    { "clientId": null },
      "naver":    { "clientId": null },
      "line":     { "clientId": null },
      "google":   { "clientId": null },
      "apple":    { "clientId": null },
      "facebook": { "clientId": null },
      "x":        { "clientId": null },
      "discord":  { "clientId": null }
    }
  },
```

★ `idp` 를 넣지 마라 — 넣으면 `loadConfig` 가 빌드를 멈춘다(그게 정상 동작이다).
★ **client secret 을 절대 넣지 마라.** auth 서버가 보유한다.
★ `threads` 를 `providers` 에 넣지 마라 — auth 가 지원하지 않는다. `x` 는 **넣는다**(auth 8종에 포함).
★ `clientId` 가 `null` 인 것은 의도적이다 — 공급자 콘솔 발급값이 나오면 채운다. Task 5 의 릴리즈 게이트가 이 상태로 스토어 빌드가 나가는 것을 막는다.

- [ ] **Step 3: dev 슬러그 features 확인**

Step 1 출력에서 `characterchat-dev` 의 세 feature 가 이미 `true` 였다면 **아무것도 하지 않는다.** 하나라도 `false` 면 `features` 블록에서 그 값을 `true` 로 바꾼다.

```json
    "deepLink": true,
    "secureStorage": true,
```

`biometric` 은 **선택이다.** 앱 잠금·재인증을 실제로 쓸 때만 켠다 — OAuth 복귀는 여기 의존하지 않는다.

- [ ] **Step 4: config 가 파싱되는지 확인**

```bash
node scripts/doctor.mjs 2>&1 | grep -A 6 "characterchat-dev"
```

Expected: `auth: email, kakao, naver, line, google, apple, facebook, x, discord` 가 표시되고 오류가 없다

- [ ] **Step 5: 전체 앱 회귀 확인**

```bash
node scripts/doctor.mjs 2>&1 | tail -1
```

Expected: `결과: 5 앱, ... 오류 0`

- [ ] **Step 6: dev 슬러그 커밋**

```bash
git add apps/characterchat-dev/app.config.json
git commit -m "feat(characterchat): dev 슬러그 auth 블록 신설 — 8수단 + oauth 자리"
```

- [ ] **Step 7: prod 슬러그에 같은 작업**

`apps/characterchat/app.config.json` 에 동일한 `auth` 블록을 추가한다. **도메인만 prod 로 바꾼다**(Step 1 에서 확인한 prod `startUrl` 기준). `features` 의 `deepLink`·`secureStorage` 는 prod 슬러그가 `false` 이므로 **반드시 `true` 로 바꾼다** — 딥링크가 꺼져 있으면 OAuth 복귀 자체가 안 된다.

- [ ] **Step 8: 확인 후 커밋**

```bash
node scripts/doctor.mjs 2>&1 | tail -1
git add apps/characterchat/app.config.json
git commit -m "feat(characterchat): prod 슬러그 auth 블록 + deepLink · secureStorage 활성"
```

Expected: `오류 0`

---

## Task 7: 스텁으로 로그인 경로 실측

BE 가 없어도 **자격증명 회수까지는 실측할 수 있고**, 세션 발급 경로는 스텁으로 닫을 수 있다.

**Files:**
- Create: `test/stub-server.mjs`

- [ ] **Step 1: 스텁 서버 작성**

`test/stub-server.mjs` 를 만든다. 의존성 없이 Node 내장 `http` 만 쓴다.

```js
// BE 없이 하네스 로그인 경로를 실측하기 위한 고정 응답 서버.
// 실행: node test/stub-server.mjs [포트]
// 기본 8787. sessionEndpoint 를 http://<맥IP>:8787/auth/social/native 로 두고 앱을 띄운다.
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || 8787);

// 시나리오를 쿼리로 고른다: ?case=signup (기본) | ?case=existing
const BODIES = {
  signup:   { signupRequired: true, signupToken: 'dummy-signup-token' },
  existing: { user: { id: 1, nickname: '테스터' }, token: 'dummy-session-token' },
};

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = BODIES[url.searchParams.get('case') || 'signup'];
    console.log(`\n← ${req.method} ${url.pathname}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        console.log('  받은 필드:', Object.keys(parsed).join(', '));
        console.log('  authorizationCode:', parsed.authorizationCode ? '있음' : '없음');
        console.log('  codeVerifier    :', parsed.codeVerifier ? '있음' : '없음');
        console.log('  deviceId        :', parsed.deviceId ? '있음' : '없음');
      } catch { console.log('  (JSON 아님)', raw.slice(0, 200)); }
    }
    console.log('→ 응답:', JSON.stringify(body));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end(JSON.stringify(body));
  });
}).listen(PORT, () => {
  console.log(`스텁 서버 http://0.0.0.0:${PORT}`);
  console.log('  기본 시나리오: signupRequired:true + signupToken');
  console.log('  기존 회원으로 보려면 sessionEndpoint 뒤에 ?case=existing 을 붙인다');
});
```

- [ ] **Step 2: 스텁이 뜨는지 확인**

```bash
node test/stub-server.mjs 8787 &
sleep 1 && curl -s -X POST localhost:8787/auth/social/native -H 'Content-Type: application/json' -d '{"authorizationCode":"C","codeVerifier":"V"}'
```

Expected: `{"signupRequired":true,"signupToken":"dummy-signup-token"}`

확인 후 서버를 끈다: `kill %1`

- [ ] **Step 3: 커밋**

```bash
git add test/stub-server.mjs
git commit -m "test: BE 없이 로그인 경로를 실측하는 고정 응답 스텁 서버"
```

- [ ] **Step 4: 실기기 검증 절차를 문서에 남긴다**

`test/stub-server.mjs` 상단 주석에 이미 실행법이 있다. 아래 절차로 실기기 확인을 한다 — **이 Step 은 실기기와 공급자 clientId 가 준비된 뒤에 수행한다.** 준비가 안 됐으면 미완료로 두고 다음 Task 로 넘어간다.

1. 맥의 LAN IP 를 확인한다: `ipconfig getifaddr en0`
2. `apps/characterchat-dev/app.config.json` 의 `sessionEndpoint` 를 `http://<그 IP>:8787/auth/social/native` 로 임시 변경
3. `node test/stub-server.mjs` 실행
4. `npm run generate -- characterchat-dev` 로 앱 생성 후 실기기 설치
5. 앱에서 각 provider 로 로그인 → **스텁 콘솔에 `authorizationCode: 있음`** 이 찍히는지 확인
6. 화면이 새로고침되지 않고 웹이 `signupToken` 을 받는지 확인
7. 확인 후 `sessionEndpoint` 를 원래 값으로 되돌린다 — **커밋하지 마라**

---

## Task 8: H-7 — 문서 갱신

**Files:**
- Modify: `docs/10-AUTH.md`
- Modify: `docs/25-AUTH-DELEGATION.md`

- [ ] **Step 1: `10-AUTH.md` 에 세 경로를 병렬로 기술**

상단 배너 **바로 다음**에 아래 절을 넣는다. 배너와 어긋나게 쓰지 않는다.

```markdown
## 0. 앱이 자격증명을 얻는 세 가지 경로

| | 경로 | 누가 쓰나 | 브라우저에 남는 세션 |
|---|---|---|---|
| **A** | 웹 리다이렉트 — 브라우저가 BE 를 거쳐 공급자로 | 웹 | 공급자 세션(+ 서비스 쿠키) |
| **B** | **앱 직접 OAuth** — 앱이 시스템 브라우저로 공급자와 직접 | **팝챗 앱(주경로)** | 공급자 세션 |
| **C** | 네이티브 SDK — 카카오톡 앱 등으로 점프 | 팝테일 앱 | 없음 |

**팝챗 앱은 길 B 를 쓴다.** `openExternal({ system: true })` 가 실제 Safari·Chrome 을 열므로
(`dist/index.js:191`) 공급자 세션이 브라우저에 남아 다른 패밀리 앱의 재로그인이 무마찰이다.
자세한 규약은 [`25-AUTH-DELEGATION.md`](25-AUTH-DELEGATION.md) 에 있다.
```

- [ ] **Step 2: `25-AUTH-DELEGATION.md` 에 구현 결과 반영**

§9 작업 목록 표에서 이 계획으로 끝난 항목에 완료 표시를 하고, **실제 구현이 설계와 달라진 점**을 적는다. 최소한 아래 두 가지는 반드시 적는다.

- `H-3` pass-through 는 `backend: data` 를 **유지한 채** top-level 스프레드를 추가한 형태다(하위호환).
- `H-4` 스토어 요건 게이트는 `--release` 플래그로만 발동한다.

- [ ] **Step 3: 배너와 모순이 없는지 확인**

```bash
grep -rn "삭제하지도 말고\|Keycloak 을 세운다\|중앙 IdP 모드를 지원" docs/ || echo "✓ 모순 0건"
```

Expected: `✓ 모순 0건`

- [ ] **Step 4: 커밋**

```bash
git add docs/10-AUTH.md docs/25-AUTH-DELEGATION.md
git commit -m "docs(auth): 세 경로 병렬 기술 + 구현 결과 반영"
```

---

## Task 9: 배포 준비 — ★ 사람 확인 후에만

`npm publish` 는 되돌리기 어렵고 다른 팀이 받아 쓴다. **아래 완료 판정을 전부 통과한 뒤 사람에게 확인을 받고** 진행한다. 확인 없이 publish 하지 마라.

- [ ] **Step 1: 완료 판정 전수 확인**

```bash
cd /Users/hyuna_park/Documents/app-harness
echo "── 1) 테스트 ──"; npm test 2>&1 | grep -E "^# (pass|fail)"
echo "── 2) 서비스 고유 이름 0건 ──"; grep -c "signupToken\|portone\|verificationId\|cc_session" template/bridge/dist/index.js
echo "── 3) doctor ──"; node scripts/doctor.mjs 2>&1 | tail -1
echo "── 4) IdP 부활 안 함 ──"; grep -rn "openid-connect\|kc_idp" template scripts apps | grep -v node_modules || echo "0건"
echo "── 5) 커밋 누락 없음 ──"; git status --short
echo "── 6) PR 에 들어갈 파일 ──"; git diff --name-only origin/main...HEAD
```

Expected:
1. `# fail 0`
2. `0`
3. `오류 0`
4. `0건`
5. 출력 없음
6. 의도한 파일만 나열 — **여기에 `template/bridge/dist/index.js` 가 반드시 있어야 한다**

- [ ] **Step 2: 사람에게 확인 요청**

위 6개 결과를 그대로 보고하고, publish 를 진행해도 되는지 묻는다. **답을 받기 전에 다음 Step 으로 가지 마라.**

- [ ] **Step 3: 확인을 받은 뒤 버전 bump 와 publish**

```bash
cd template/bridge
npm version minor
npm publish
```

Expected: `1.4.0` → `1.5.0`, GitHub Packages 에 게시됨

- [ ] **Step 4: 웹 레포에 통보**

웹 레포 `package.json` 의 `@aipia-team/harness-bridge` 가 `^1.2.2` 라 새 버전이 자동으로 오지 않는다. 웹 담당자에게 **새 버전 번호와 바뀐 계약**(`signupRequired` 인식 · 미지 필드 top-level pass-through)을 전달한다.

---

## auth 팀에 물어볼 것 — 코드 착수와 동시에 티켓을 띄운다

답이 없어도 Task 1~8 은 진행 가능하다. 멈추지 말고, 막히면 무엇 때문인지 특정해 보고한다.

| # | 질문 | 왜 필요한가 |
|---|---|---|
| G0-1 | 앱이 공급자와 직접 돈 자격증명을 받는 BE 경로가 존속하는가 | 부정이면 `broker` 모드(H-6)가 되살아나 작업량이 크게 는다 |
| G0-2 | 브라우저가 인증서버 authorize(`/oauth/v1/authorize/{provider}`)를 직접 지나는가, 그때 인증서버 세션 쿠키가 설정되는가 | 지나면 길 A 전환으로 패밀리 SSO 를 얻을 수 있고, 아니면 IdP 신설이 유일한 답이다 — 글로벌 앱 계정 통합 계획이 여기 달렸다 |
| G0-3 | 앱이 쓸 공급자 clientId 가 auth 가 쓰는 것과 **같은가** — SNS 8종 각각 | **갈리면 같은 사람이 두 계정이 된다.** 코드로는 양쪽 다 정상으로 보여 끝까지 안 드러난다 |
| G0-4 | auth 콘솔에 등록된 `line`·`discord` 의 scope 값 | Task 2 의 TODO 를 확정한다 |
| G0-5 | 각 공급자 콘솔에 우리 커스텀 스킴 redirect URI 를 등록해줄 수 있는가 | 없으면 딥링크 복귀가 안 된다 |
| G0-6 | redeem 응답의 `snsType` 대소문자 — `"kakao"` 인가 `"KAKAO"` 인가 | BE 가 `user_identities.provider` 에 그대로 저장하는데 어긋나면 같은 사람이 두 계정이 된다. 하네스 작업은 아니지만 콘솔 확인할 때 같이 물으면 왕복이 한 번 준다 |

**G0-6 과 G0-3 은 짝지어 검증한다.** 웹은 인증서버 리다이렉트 경로, 앱은 공급자 직접 경로를 타므로, 공급자 client 가 갈리면 "웹에서 가입 → 앱에서 같은 소셜로 로그인"이 다른 계정이 된다. 이 시나리오를 **명시적으로 돌려보기 전까지는 발견되지 않는다.**

---

## H-6 `broker` 모드 — 지금 하지 마라

G0-1 에 **부정 답이 올 때만** 착수한다. 그전에는 설계도 구현도 하지 않는다. 필요해지면 별도 계획을 새로 쓴다.
