// "마지막 로그인 수단" 의 기록 주체 규약.
//
// 왜 테스트로 못박는가: 이 값이 안 써지는 것은 **화면에 오류가 없다.** 배지가 그냥
// 안 뜰 뿐이라 "원래 없던 기능" 처럼 보이고, 브라우저에서는 웹이 자체 localStorage 로
// 처리해 정상 동작하므로 **앱에서만 안 되는 버그**로 나타난다. 팝챗에서 실제로 그랬다 —
// 앱이 자체 OAuth(시스템 브라우저 + 딥링크)를 돌아 login() 을 지나지 않는데, 웹은
// "브릿지가 알아서 기록한다" 고 전제해 아무도 쓰지 않았다.
//
// 그래서 두 가지를 고정한다: ① login() 성공은 반드시 기록으로 이어진다
// ② login() 을 안 쓰는 앱도 기록할 공개 경로가 있다(rememberLastLogin).

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge } from '../template/bridge/dist/index.js';

const KEY = 'last_login_provider';
const ORIG_CONFIG = AppBridge.config;
const ORIG = { setPref: AppBridge.setPref, getPref: AppBridge.getPref, ready: AppBridge.ready };

afterEach(() => {
  AppBridge.config = ORIG_CONFIG;
  Object.assign(AppBridge, ORIG);
});

/** pref 저장소를 메모리로 갈아끼운다(Capacitor Preferences 는 Node 에 없다). */
function trackPrefs() {
  const store = new Map();
  AppBridge.setPref = async (k, v) => { store.set(k, v); };
  AppBridge.getPref = async (k) => (store.has(k) ? store.get(k) : null);
  AppBridge.ready = async () => {};
  return store;
}

const AUTH = { providers: ['email', 'kakao', 'naver', 'apple', 'google'] };

test('rememberLastLogin: 기록한 수단을 getLastLogin 이 그대로 돌려준다', async () => {
  trackPrefs();
  AppBridge.config = { auth: AUTH };

  const r = await AppBridge.rememberLastLogin('kakao');

  assert.deepEqual(r, { ok: true });
  assert.deepEqual(await AppBridge.getLastLogin(), { provider: 'kakao' });
});

test('rememberLastLogin: 이메일도 기록된다 — login() 은 이 경로를 못 태운다', async () => {
  trackPrefs();
  AppBridge.config = { auth: AUTH };

  // login('email') 은 기록 전에 빠지므로(웹이 폼으로 처리) 이메일은 이 API 가 유일한 입구다.
  assert.deepEqual(await AppBridge.login('email'), { ok: false, reason: 'email-handled-by-web' });
  assert.equal(await AppBridge.getLastLogin(), null, 'login("email") 이 기록해서는 안 된다');

  await AppBridge.rememberLastLogin('email');

  assert.deepEqual(await AppBridge.getLastLogin(), { provider: 'email' });
});

test('rememberLastLogin: 열지 않은 수단은 거절한다 — login() 과 같은 기준', async () => {
  const store = trackPrefs();
  AppBridge.config = { auth: AUTH };

  // 'x' 는 이 앱 config 에 없다. 통과시키면 getLastLogin 이 그리지도 않는 버튼을 가리킨다.
  const r = await AppBridge.rememberLastLogin('x');

  assert.deepEqual(r, { ok: false, reason: 'provider-not-enabled' });
  assert.equal(store.has(KEY), false);
});

test('rememberLastLogin: pref 쓰기가 실패해도 던지지 않는다', async () => {
  trackPrefs();
  AppBridge.config = { auth: AUTH };
  AppBridge.setPref = async () => { throw new Error('storage unavailable'); };

  // 힌트 하나 때문에 로그인 흐름이 막히면 안 된다 — 호출부는 await 하지 않아도 안전해야 한다.
  const r = await AppBridge.rememberLastLogin('kakao');

  assert.deepEqual(r, { ok: false, reason: 'pref-write-failed' });
});

test('login: 성공하면 그 수단이 기록된다(기록 지점은 rememberLastLogin 하나뿐)', async () => {
  trackPrefs();
  AppBridge.config = { auth: AUTH };
  const calls = [];
  // login() 내부가 setPref 를 직접 부르지 않고 이 짝을 지나는지까지 고정한다 —
  // 기록 지점이 둘로 갈라지면 키를 아는 곳이 늘어 다음 앱이 또 흉내낸다.
  AppBridge.rememberLastLogin = async (p) => { calls.push(p); return { ok: true }; };
  AppBridge._oauth2 = async () => ({ ok: true, provider: 'naver', authorizationCode: 'CODE' });
  AppBridge._finishLogin = async (c) => ({ ...c, ok: true });
  Object.defineProperty(AppBridge, 'isNative', { value: true, configurable: true });

  await AppBridge.login('naver');

  assert.deepEqual(calls, ['naver']);
  // 인스턴스 own property 로 덧씌웠으므로 지워야 프로토타입 메서드가 돌아온다.
  // (ORIG 에 없는 키를 Object.assign 하면 undefined 가 얹혀 뒤 테스트가 전부 죽는다 — 실제로 그랬다.)
  delete AppBridge.rememberLastLogin;
  delete AppBridge._oauth2;
  delete AppBridge._finishLogin;
});

// ── 브로커 앱 (providers: [] + oauthReturnScheme) ─────────────────────────────
// 팝챗은 앱이 공급자와 직접 OAuth 를 돌지 않는다 — 수단 목록을 앱이 갖지 않는다.
// 그 앱에서 providers 로 막으면 이 API 가 영원히 거절돼 웹이 같은 키에 setPref 로
// 직접 쓰게 된다(실제로 그랬다). 키가 두 레포에 박히고 다음 앱이 또 흉내낸다.

const BROKER = { providers: [], oauthReturnScheme: true };

test('rememberLastLogin(브로커): providers 가 비어도 하네스가 아는 수단은 기록된다', async () => {
  trackPrefs();
  AppBridge.config = { auth: BROKER };

  assert.deepEqual(await AppBridge.rememberLastLogin('kakao'), { ok: true });
  assert.deepEqual(await AppBridge.getLastLogin(), { provider: 'kakao' });
  assert.deepEqual(await AppBridge.rememberLastLogin('email'), { ok: true });
  assert.deepEqual(await AppBridge.getLastLogin(), { provider: 'email' });
});

test('rememberLastLogin(브로커): 모르는 값은 거절한다 — 모양만 검사한다', async () => {
  const store = trackPrefs();
  AppBridge.config = { auth: BROKER };

  assert.deepEqual(await AppBridge.rememberLastLogin('tiktok'), { ok: false, reason: 'unknown-provider' });
  assert.deepEqual(await AppBridge.rememberLastLogin(undefined), { ok: false, reason: 'unknown-provider' });
  // OAUTH_PRESETS 의 상속 속성이 새지 않는다(hasOwnProperty 로 봐야 한다).
  assert.deepEqual(await AppBridge.rememberLastLogin('toString'), { ok: false, reason: 'unknown-provider' });
  assert.equal(store.has(KEY), false);
});

test('rememberLastLogin: providers 가 비어 있어도 브로커 플래그가 없으면 종전대로 거절한다', async () => {
  trackPrefs();
  AppBridge.config = { auth: { providers: [] } };

  assert.deepEqual(await AppBridge.rememberLastLogin('kakao'), { ok: false, reason: 'provider-not-enabled' });
});

test('capabilities.auth: 브로커 앱도 인증을 하는 앱이다', () => {
  assert.equal(AppBridge._authCapability({ providers: [], oauthReturnScheme: true }), true);
  assert.equal(AppBridge._authCapability({ providers: ['kakao'] }), true);
  assert.equal(AppBridge._authCapability({ providers: [] }), false);
  assert.equal(AppBridge._authCapability(undefined), false);
});
