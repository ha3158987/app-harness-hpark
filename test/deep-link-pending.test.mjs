// 딥링크 보류분(pending)의 배달 규약. 이 규약이 깨지면 브로커 로그인이
// "첫 시도 실패 → 두 번째 성공" 을 무한 교대로 반복한다.
//
// 배경: OAuth 복귀를 딥링크로 기다리는 로그인은 시도마다 onDeepLink 를 새로 등록한다.
// 예전 브릿지는 마지막 딥링크를 영구 보관하며 새 등록자 전원에게 다시 넘겼기 때문에,
// 두 번째 로그인 시도가 **첫 번째 시도의 `?code=`** 를 즉시 받았다. 그 code 는 일회용
// 이라 상환이 실패하고(= 사용자에게는 "로그인 실패"), 그 사이 열린 브라우저가 새 code 를
// 보류분에 채워 다음 시도가 성공한다 — 그래서 실패/성공이 번갈아 반복됐다.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppBridge } from '../template/bridge/dist/index.js';

afterEach(() => {
  AppBridge.clearPendingDeepLink();
  AppBridge._deepLinkHandlers.length = 0;
});

test('핸들러가 있으면 즉시 배달하고 보류분을 남기지 않는다', () => {
  const seen = [];
  AppBridge.onDeepLink((url) => seen.push(url));
  AppBridge._emitDeepLink('app://oauth/callback?code=A', {});

  assert.deepEqual(seen, ['app://oauth/callback?code=A']);
  assert.equal(AppBridge._pendingDeepLink, null, '배달했는데 보류분이 남았다');
});

test('핸들러가 없을 때 온 딥링크는 첫 등록자에게 1회만 배달된다', () => {
  AppBridge._emitDeepLink('app://oauth/callback?code=COLD', {});
  assert.notEqual(AppBridge._pendingDeepLink, null, '콜드스타트 링크가 보류되지 않았다');

  const first = [];
  AppBridge.onDeepLink((url) => first.push(url));
  assert.deepEqual(first, ['app://oauth/callback?code=COLD'], '첫 등록자가 못 받았다');

  // ★ 이게 회귀 지점이다 — 두 번째 등록자(= 다음 로그인 시도)는 받으면 안 된다.
  const second = [];
  AppBridge.onDeepLink((url) => second.push(url));
  assert.deepEqual(second, [], '이미 소비된 딥링크가 다음 등록자에게 재생됐다');
});

test('보류분은 TTL 을 넘기면 배달하지 않는다', () => {
  AppBridge._emitDeepLink('app://oauth/callback?code=OLD', {});
  AppBridge._pendingDeepLink.at -= 60_000; // 30s TTL 을 넘긴 옛 링크

  const seen = [];
  AppBridge.onDeepLink((url) => seen.push(url));
  assert.deepEqual(seen, [], '만료된 보류 딥링크가 배달됐다');
  assert.equal(AppBridge._pendingDeepLink, null, '만료 보류분이 버려지지 않았다');
});

test('clearPendingDeepLink 는 보류분을 버린다(로그아웃 경로)', () => {
  AppBridge._emitDeepLink('app://oauth/callback?code=STALE', {});
  AppBridge.clearPendingDeepLink();

  const seen = [];
  AppBridge.onDeepLink((url) => seen.push(url));
  assert.deepEqual(seen, [], '로그아웃 뒤에도 이전 흐름의 딥링크가 배달됐다');
});

test('여러 핸들러가 걸려 있으면 전부 받는다(라우팅 + 로그인 동시 대기)', () => {
  const routing = [];
  const login = [];
  AppBridge.onDeepLink((url) => routing.push(url));
  AppBridge.onDeepLink((url) => login.push(url));
  AppBridge._emitDeepLink('https://example.test/chat/1', {});

  assert.deepEqual(routing, ['https://example.test/chat/1']);
  assert.deepEqual(login, ['https://example.test/chat/1']);
});
