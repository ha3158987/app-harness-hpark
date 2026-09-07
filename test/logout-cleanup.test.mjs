// 로그아웃·탈퇴가 기기에 남기는 것 / 서버에 알리는 것의 규약.
//
// 왜 테스트로 못박는가: 로그아웃 누락은 **화면에 아무 증상이 없다.** 사용자는 로그아웃
// 된 것으로 보이는데 기기 푸시 토큰은 이전 계정에 붙어 있어 그 계정의 알림이 계속 오고,
// 생체 플래그가 남아 다음 사용자가 사라진 계정의 잠금을 물려받는다. 재현 조건이 "로그아웃
// 후 방치" 나 "계정 전환 + 알림 권한 거부" 라 수동 QA 에서 거의 잡히지 않는다.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge } from '../template/bridge/dist/index.js';
import { stubGlobals } from './helpers/stub-globals.mjs';

const ORIG_CONFIG = AppBridge.config;
const ORIG = {
  secureRemove: AppBridge.secureRemove,
  removePref: AppBridge.removePref,
  _deviceId: AppBridge._deviceId,
};
let stub = null;

afterEach(() => {
  stub?.restore();
  stub = null;
  AppBridge.config = ORIG_CONFIG;
  Object.assign(AppBridge, ORIG);
  AppBridge._pushToken = null;
  AppBridge.clearPendingDeepLink();
});

/** 저장소 호출을 기록만 하도록 갈아끼운다(Capacitor 플러그인은 Node 에 없다). */
function trackStorage() {
  const removedSecure = [];
  const removedPrefs = [];
  AppBridge.secureRemove = async (k) => { removedSecure.push(k); };
  AppBridge.removePref = async (k) => { removedPrefs.push(k); };
  AppBridge._deviceId = async () => 'DEV-1';
  return { removedSecure, removedPrefs };
}

const AUTH = {
  logoutEndpoint: 'https://stub.test/auth/logout',
  deleteEndpoint: 'https://stub.test/auth/withdraw',
  deviceUnregisterEndpoint: 'https://stub.test/push/unregister',
};

test('logout: 기기 토큰 해제를 세션 종료보다 먼저 보낸다', async () => {
  stub = stubGlobals({ ok: true });
  const storage = trackStorage();
  AppBridge.config = { auth: AUTH };
  AppBridge._pushToken = 'FCM-TOKEN';

  await AppBridge.logout({ reload: false });

  const urls = stub.requests.map((r) => r.url);
  assert.deepEqual(urls, [AUTH.deviceUnregisterEndpoint, AUTH.logoutEndpoint],
    '해제가 로그아웃 뒤로 가면 세션이 이미 없어 서버가 401 로 버린다');
  assert.deepEqual(stub.requests[0].body,
    { pushToken: 'FCM-TOKEN', deviceId: 'DEV-1', platform: AppBridge.platform });
  assert.ok(storage.removedSecure.includes('auth_token'), '세션 토큰이 안 지워졌다');
  assert.ok(storage.removedPrefs.includes('biometric_login'), '생체 플래그가 남았다');
});

test('logout: 마지막 로그인 수단 힌트는 남긴다', async () => {
  stub = stubGlobals({ ok: true });
  const storage = trackStorage();
  AppBridge.config = { auth: AUTH };

  await AppBridge.logout({ reload: false });

  assert.ok(!storage.removedPrefs.includes('last_login_provider'),
    'last_login_provider 는 자격증명이 아니라 "마지막 로그인" 배지의 근거다 — 지우면 안 된다');
});

test('logout: 보류 중인 이전 흐름의 딥링크를 버린다', async () => {
  stub = stubGlobals({ ok: true });
  trackStorage();
  AppBridge.config = { auth: AUTH };
  AppBridge._emitDeepLink('app://oauth/callback?code=BEFORE_LOGOUT', {});

  await AppBridge.logout({ reload: false });

  const seen = [];
  AppBridge.onDeepLink((url) => seen.push(url));
  AppBridge._deepLinkHandlers.length = 0;
  assert.deepEqual(seen, [], '로그아웃 뒤 첫 로그인이 이전 계정의 OAuth code 를 받았다');
});

test('logout: 해제 엔드포인트가 없으면 건너뛴다(설정 없는 앱도 동작)', async () => {
  stub = stubGlobals({ ok: true });
  trackStorage();
  AppBridge.config = { auth: { logoutEndpoint: AUTH.logoutEndpoint } };
  AppBridge._pushToken = 'FCM-TOKEN';

  const r = await AppBridge.logout({ reload: false });

  assert.equal(r.ok, true);
  assert.deepEqual(stub.requests.map((x) => x.url), [AUTH.logoutEndpoint]);
});

test('logout: 해제 요청이 실패해도 로그아웃은 진행된다', async () => {
  stub = stubGlobals({ ok: true });
  trackStorage();
  const failing = globalThis.fetch;
  let first = true;
  globalThis.fetch = async (url, init) => {
    if (first) { first = false; throw new Error('network down'); }
    return failing(url, init);
  };
  AppBridge.config = { auth: AUTH };
  AppBridge._pushToken = 'FCM-TOKEN';

  const r = await AppBridge.logout({ reload: false });

  assert.equal(r.ok, true, '해제 실패로 로그아웃이 막히면 사용자가 로그인 상태에 갇힌다');
  assert.deepEqual(stub.requests.map((x) => x.url), [AUTH.logoutEndpoint]);
});

test('deleteAccount: 해제 → 탈퇴 순서 + 흔적 전부 삭제', async () => {
  stub = stubGlobals({ ok: true });
  const storage = trackStorage();
  AppBridge.config = { auth: AUTH };
  AppBridge._pushToken = 'FCM-TOKEN';

  const r = await AppBridge.deleteAccount({ reload: false });

  assert.equal(r.ok, true);
  assert.deepEqual(stub.requests.map((x) => x.url),
    [AUTH.deviceUnregisterEndpoint, AUTH.deleteEndpoint]);
  assert.ok(storage.removedSecure.includes('auth_token'));
  for (const key of ['last_login_provider', 'biometric_login']) {
    assert.ok(storage.removedPrefs.includes(key), `탈퇴인데 ${key} 가 남았다`);
  }
});
