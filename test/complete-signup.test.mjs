import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge } from '../template/bridge/dist/index.js';
import { stubGlobals } from './helpers/stub-globals.mjs';

let stub = null;
const ORIG_CONFIG = AppBridge.config; // 싱글턴이다 — 테스트가 바꾼 config 를 반드시 되돌린다
afterEach(() => { stub?.restore(); stub = null; AppBridge.config = ORIG_CONFIG; });

/** signupEndpoint 를 세팅하고 completeSignup 을 부른다. */
async function completeSignupWith(responseBody, opts) {
  stub?.restore(); // 한 테스트에서 여러 번 불릴 수 있다 — 앞 스텁을 먼저 되돌린다
  stub = stubGlobals(responseBody, opts);
  AppBridge.config = { auth: { signupEndpoint: 'https://stub.test/auth/signup' } };
  const result = await AppBridge.completeSignup({ nickname: '테스터' }, { reload: false });
  return { result, reloaded: stub.reloaded() };
}

test('BE 응답의 미지 필드가 top-level 에 그대로 온다', async () => {
  const { result } = await completeSignupWith({
    user: { id: 7 },
    다음단계: 'phone-verify',
    아직없는필드: 42,
  });
  assert.equal(result.다음단계, 'phone-verify', '미지 필드가 top-level 에 없다');
  assert.equal(result.아직없는필드, 42, '미지 필드가 버려졌다');
  assert.deepEqual(result.user, { id: 7 }, 'user 가 사라졌다');
});

test('backend 필드는 하위호환으로 그대로 남는다', async () => {
  const body = { 다음단계: 'phone-verify', errors: { nickname: 'taken' } };
  const { result } = await completeSignupWith(body);
  assert.deepEqual(result.backend, body, 'backend 에 원본이 없다');
  // 원본은 top-level 이 무엇을 덮어썼든 backend 에 온전히 남아야 한다.
  assert.deepEqual(result.backend.errors, { nickname: 'taken' });
});

test('BE 응답이 ok 를 덮어쓰지 못한다', async () => {
  // BE 가 바디에 ok:false 를 실어도 top-level ok 는 HTTP 상태다. BE 판정은 backend.ok 로 읽는다.
  const { result } = await completeSignupWith({ ok: false, user: { id: 1 } });
  assert.equal(result.ok, true, 'BE 응답이 ok 를 덮어썼다');
  assert.equal(result.backend.ok, false, 'BE 의 ok 원본이 backend 에 없다');
});

test('HTTP 실패면 ok:false 이고 BE 의 ok:true 도 이기지 못한다', async () => {
  const { result } = await completeSignupWith({ ok: true, 다음단계: 'x' }, { ok: false });
  assert.equal(result.ok, false, 'HTTP 실패인데 ok 가 true 다');
  assert.equal(result.다음단계, 'x', '실패 응답에서도 미지 필드는 올라와야 한다');
});
