// 브로커 로그인 앱의 OAuth 복귀 스킴 판정.
//
// 배경: 팝챗은 앱이 공급자와 직접 OAuth 를 돌지 않는다(clientId 를 앱이 들면 auth
// 서버 것과 갈릴 때 같은 사람이 두 계정이 된다). 앱은 우리 백엔드의 start 를 시스템
// 브라우저로 열고, auth 가 커스텀 스킴으로 redirect 해 code 만 넘겨준다.
//
// 그래서 이 앱은 **auth.providers 가 비어 있는 게 정상**인데 복귀 스킴은 반드시
// 필요하다. 예전 게이트는 그 둘을 묶어 놨고, 그 결과 스킴을 얻으려면 providers 를
// 채워야 했고 → 쓰지도 않는 clientId 누락이 storeBlockers 로 잡혀 릴리즈가 막혔다.
// 이 파일은 그 묶음이 되살아나는 것을 막는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authSetup,
  needsOAuthReturnScheme,
  usesNativeApple,
} from '../scripts/lib/auth-setup.mjs';

/** 브로커 앱(팝챗) 형태의 최소 config. */
const brokered = (over = {}) => ({
  auth: {
    providers: [],
    oauthReturnScheme: true,
    deleteEndpoint: 'https://api.example/auth/withdraw',
    ...over,
  },
});

/** 네이티브 OAuth 앱 형태. */
const native = (over = {}) => ({
  auth: {
    providers: ['kakao', 'apple'],
    deleteEndpoint: 'https://api.example/auth/withdraw',
    oauth: { kakao: { clientId: 'k' }, apple: { clientId: 'a' } },
    ...over,
  },
});

test('브로커 앱은 providers 가 비어도 복귀 스킴이 필요하다', () => {
  const cfg = brokered();
  const setup = authSetup(cfg);
  assert.equal(setup.hasOAuth, false, 'providers 가 비면 네이티브 OAuth 는 없다');
  assert.equal(
    needsOAuthReturnScheme(cfg, setup),
    true,
    'hasOAuth 가 false 여도 복귀 스킴은 등록돼야 한다 — 이게 이 파일의 존재 이유다',
  );
});

test('네이티브 OAuth 앱은 플래그 없이도 복귀 스킴이 필요하다', () => {
  const cfg = native();
  assert.equal(needsOAuthReturnScheme(cfg, authSetup(cfg)), true);
});

test('둘 다 아니면 복귀 스킴을 등록하지 않는다', () => {
  // 웹 레이어에서만 로그인하고 딥링크 복귀를 안 받는 앱 — 스킴을 넣을 이유가 없다.
  const cfg = { auth: { providers: [] } };
  assert.equal(needsOAuthReturnScheme(cfg, authSetup(cfg)), false);
  assert.equal(
    needsOAuthReturnScheme({ auth: {} }, authSetup({ auth: {} })),
    false,
    'oauthReturnScheme 기본값은 false 여야 한다',
  );
});

test('브로커 앱에는 Apple 엔타이틀먼트가 필요 없다 — 스킴과 묶이면 안 된다', () => {
  // 브로커는 애플도 웹 경로로 처리한다. 묶어 두면 쓰지 않는 권한을 선언한 채 심사에 든다.
  const cfg = brokered();
  assert.equal(needsOAuthReturnScheme(cfg, authSetup(cfg)), true);
  assert.equal(usesNativeApple(cfg), false);
});

test('네이티브 애플 앱은 엔타이틀먼트가 필요하다', () => {
  assert.equal(usesNativeApple(native()), true);
  assert.equal(usesNativeApple(native({ providers: ['kakao'] })), false);
});

test('브로커 앱은 clientId 가 없어도 스토어 요건을 막지 않는다', () => {
  // providers 가 비어 있으므로 검사할 공급자가 없다 — 릴리즈 빌드가 통과해야 한다.
  assert.deepEqual(authSetup(brokered()).storeBlockers, []);
});

test('★ 브로커 앱도 탈퇴 엔드포인트는 필수다', () => {
  // providers 만으로 판정하면 브로커 앱에서 이 게이트가 조용히 꺼진다. 앱은 분명히
  // 계정을 만드는데 탈퇴 경로가 없으면 App Store · Play 양쪽에서 리젝된다.
  const blockers = authSetup(brokered({ deleteEndpoint: null })).storeBlockers;
  assert.equal(blockers.length, 1, `탈퇴 누락을 잡아야 한다 (실제: ${blockers.length}건)`);
  assert.match(blockers[0], /deleteEndpoint/);
});

test('로그인을 안 하는 앱에는 탈퇴 게이트를 걸지 않는다', () => {
  // providers 도 없고 복귀 스킴도 안 받는 앱 — 계정을 만든다는 신호가 없다.
  assert.deepEqual(authSetup({ auth: { providers: [] } }).storeBlockers, []);
});

test('브로커 앱에 sessionEndpoint 경고를 띄우지 않는다', () => {
  // 브로커는 웹이 redeem 하므로 sessionEndpoint 가 **없는 게 정상**이다.
  // 경고로 남기면 매 빌드마다 무해한 잡음이 쌓여 진짜 경고를 묻는다.
  assert.deepEqual(authSetup(brokered()).warnings, []);
});
