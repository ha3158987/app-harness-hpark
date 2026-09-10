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
  Object.assign(AppBridge, { rememberLastLogin: ORIG.rememberLastLogin });
});
