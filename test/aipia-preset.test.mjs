// aipiaPreset 의 인증 모드 — 브로커 앱(팝챗 · 팝테일 글로벌)을 config 만으로 만들 수 있는가.
//
// 배경: 프리셋이 네이티브 OAuth 형태(providers 4종 + oauth clientId + sessionEndpoint)만 내보내
// 팝테일 글로벌을 new-app 으로 만들면 사람이 손으로 팝챗 모양으로 고쳐야 했다. 그 손질에서
// sessionEndpoint 를 남기거나 providers 를 채우면 쓰지도 않는 clientId 누락이 릴리즈를 막는다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aipiaPreset } from '../scripts/lib/config.mjs';
import { authSetup, needsOAuthReturnScheme, usesNativeApple } from '../scripts/lib/auth-setup.mjs';

test('authMode 기본값은 native — 기존 호출자의 출력이 변하지 않는다', () => {
  const a = aipiaPreset({ slug: 'poptale', appName: 'Poptale' }).auth;
  assert.deepEqual(a.providers, ['apple', 'google', 'kakao', 'naver']);
  assert.equal(a.sessionEndpoint, 'https://api.poptale.ai/api/v2/auth/native');
  assert.ok(a.guestEndpoint);
  assert.deepEqual(Object.keys(a.oauth).sort(), ['apple', 'google', 'kakao', 'naver']);
  assert.equal('oauthReturnScheme' in a, false);
});

test('authMode broker — 팝챗 config 와 같은 모양이다', () => {
  const cfg = aipiaPreset({ slug: 'poptale-global', appName: 'Poptale', authMode: 'broker' });
  const a = cfg.auth;
  assert.deepEqual(a.providers, []);
  assert.equal(a.oauthReturnScheme, true);
  // 상환은 웹이 하므로 브릿지가 자격증명을 보낼 자리가 없어야 한다.
  assert.equal('sessionEndpoint' in a, false);
  assert.equal('oauth' in a, false);
  assert.equal('guestEndpoint' in a, false);
  // 팝챗 BE 계약 경로(2026-09-11 "그대로" 확정)
  assert.equal(a.signupEndpoint, 'https://api.poptale-global.ai/auth/signup');
  assert.equal(a.deleteEndpoint, 'https://api.poptale-global.ai/auth/withdraw');
  assert.equal(a.logoutEndpoint, 'https://api.poptale-global.ai/auth/logout');
  assert.equal(a.deviceEndpoint, 'https://api.poptale-global.ai/api/push/register');
  assert.equal(a.deviceUnregisterEndpoint, 'https://api.poptale-global.ai/api/push/unregister');
  // 복귀 스킴에 필요한 feature 가 켜져 있다(docs/25 §7).
  assert.equal(cfg.features.deepLink, true);
  assert.equal(cfg.features.secureStorage, true);
});

test('authMode broker — 스토어 게이트를 그대로 통과하고 복귀 스킴만 얻는다', () => {
  const cfg = aipiaPreset({ slug: 'poptale-global', appName: 'Poptale', authMode: 'broker' });
  const r = authSetup(cfg);
  assert.deepEqual(r.storeBlockers, [], '브로커 앱에 clientId · Apple 4.8 게이트가 걸리면 안 된다');
  assert.deepEqual(r.warnings, [], 'sessionEndpoint 경고가 나면 사람이 그걸 채우러 간다');
  assert.equal(needsOAuthReturnScheme(cfg, r), true);
  assert.equal(usesNativeApple(cfg), false, '브로커는 애플도 웹 경로 — 엔타이틀먼트 불필요');
});

test('authMode 오타는 조용히 native 로 떨어지지 않는다', () => {
  assert.throws(() => aipiaPreset({ slug: 'x', appName: 'X', authMode: 'brokered' }), /authMode/);
});
