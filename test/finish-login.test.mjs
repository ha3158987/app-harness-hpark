import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge } from '../template/bridge/dist/index.js';
import { stubGlobals } from './helpers/stub-globals.mjs';

let stub = null;
const ORIG_CONFIG = AppBridge.config; // 싱글턴이다 — 테스트가 바꾼 config 를 반드시 되돌린다
afterEach(() => { stub?.restore(); stub = null; AppBridge.config = ORIG_CONFIG; });

/** sessionEndpoint 를 세팅하고 _finishLogin 을 부른다. */
async function finishLoginWith(responseBody, opts, credential = { ok: true, authorizationCode: 'CODE', codeVerifier: 'VERIFIER' }) {
  stub?.restore(); // 한 테스트에서 여러 번 불릴 수 있다 — 앞 스텁을 먼저 되돌린다
  stub = stubGlobals(responseBody, opts);
  AppBridge.config = { auth: { sessionEndpoint: 'https://stub.test/auth/native' } };
  const result = await AppBridge._finishLogin(credential, {});
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

test('HTTP 실패면 새로고침하지 않는다', async () => {
  const { reloaded } = await finishLoginWith({ user: { id: 1 } }, { ok: false });
  assert.equal(reloaded, false, 'HTTP 실패인데 새로고침이 일어났다');
});

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

test('자격증명 필드는 BE 가 덮어쓰지 못한다 — 경로별 예약 이름', async () => {
  const BE = { authorizationCode: 'BE_CODE', idToken: 'BE_TOKEN', provider: 'evil' };
  for (const [label, cred, expect] of [
    ['oauth', { ok: true, provider: 'google', authorizationCode: 'CODE', codeVerifier: 'V' },
      { authorizationCode: 'CODE', provider: 'google', idToken: 'BE_TOKEN' }],
    ['apple-native', { ok: true, provider: 'apple', native: true, idToken: 'APPLE', authorizationCode: 'AC' },
      { authorizationCode: 'AC', provider: 'apple', idToken: 'APPLE' }],
  ]) {
    const { result } = await finishLoginWith(BE, {}, cred);
    for (const [k, v] of Object.entries(expect)) assert.equal(result[k], v, `${label}: ${k}`);
  }
});
