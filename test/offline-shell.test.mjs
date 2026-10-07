// 오프라인 셸 규약. 원격 웹이 네트워크 오류로 못 뜨면 브릿지 플러그인이 로컬 셸(www/index.html)을
// ?from=<실패 주소>&home=<server.url> 로 띄우고, 셸은 다시 시도·네트워크 복귀 때 from(없으면 home)으로 돌아간다.
//
// 배경(2026-10-07, 디바이스 랩 실측): 오프라인 콜드 스타트에서 셸 대신 WebView 기본 오류 페이지
// ('웹페이지를 사용할 수 없음 · net::ERR_INTERNET_DISCONNECTED' + 서버 주소)가 떴다(iOS 는 빈 흰 화면).
// Capacitor server.errorPath 로 고치지 않은 이유는 generate-app.mjs buildCapacitorConfig 주석 — 아래 가드가 지킨다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SHELL = read('template/src/shell.js');

function el(extra = {}) {
  return { textContent: '', hidden: false, style: {}, ...extra };
}

// shell.js 를 가짜 DOM 위에서 한 번 실행한다.
function runShell({ search = '', onLine = true, language = 'ko-KR', storage = {} } = {}) {
  const els = { title: el(), msg: el(), retry: el({ hidden: true }) };
  const spinner = { style: {} };
  const winListeners = {};
  const timers = [];
  const nav = [];
  els.retry.addEventListener = (type, fn) => { els.retry.onClick = fn; };
  const ctx = {
    document: { getElementById: (id) => els[id], querySelector: () => spinner, documentElement: {}, title: '' },
    navigator: { onLine, language },
    location: { search, replace: (u) => nav.push(['replace', u]), reload: () => nav.push(['reload']) },
    window: { addEventListener: (type, fn) => { winListeners[type] = fn; } },
    sessionStorage: { getItem: (k) => storage[k] ?? null, setItem: (k, v) => { storage[k] = v; } },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    URL,
    URLSearchParams,
  };
  vm.runInNewContext(SHELL, ctx);
  return { els, spinner, winListeners, timers, nav, ctx, storage };
}

const q = (from, home) => `?from=${encodeURIComponent(from)}&home=${encodeURIComponent(home)}`;
const HOME = 'https://app.example.com';
const DEEP = 'https://app.example.com/viewer?contentId=1&seriesId=2';

test('다시 시도는 실패한 주소(딥링크 목적지)로 돌아간다 — 쿼리까지 그대로', () => {
  const s = runShell({ search: q(DEEP, HOME), onLine: false });
  s.els.retry.onClick();
  assert.deepEqual(s.nav, [['replace', DEEP]]);
});

test('from 이 http(s) 가 아니면 버리고 home 으로 간다(javascript: 주입 차단)', () => {
  const s = runShell({ search: q('javascript:alert(1)', HOME), onLine: false });
  s.els.retry.onClick();
  assert.deepEqual(s.nav, [['replace', `${HOME}/`]]);
});

test('오프라인이면 오프라인 문구 + 다시 시도 버튼, 자동 재시도는 없고 online 이벤트에 복귀', () => {
  const s = runShell({ search: q(DEEP, HOME), onLine: false });
  assert.equal(s.els.title.textContent, '인터넷에 연결할 수 없어요');
  assert.equal(s.els.retry.hidden, false);
  assert.equal(s.spinner.style.display, 'none');
  assert.equal(s.timers.length, 0, '오프라인인데 타이머로 재시도한다');
  s.winListeners.online();
  assert.deepEqual(s.nav, [['replace', DEEP]]);
});

test('온라인인데 서버에 못 닿으면 간격을 늘려 가며(3·6·12·24·30초 상한) 자동 재시도 — 셸이 다시 떠도 이어진다', () => {
  const storage = {};
  const delays = [];
  for (let i = 0; i < 6; i++) {
    const s = runShell({ search: q(DEEP, HOME), onLine: true, storage });
    assert.equal(s.els.title.textContent, '연결할 수 없어요');
    delays.push(s.timers[0].ms);
  }
  assert.deepEqual(delays, [3000, 6000, 12000, 24000, 30000, 30000]);
});

test('마지막 시도 뒤 2분이 지나면 첫 간격(3초)으로 돌아간다', () => {
  const storage = { 'harness-shell-attempt': JSON.stringify({ n: 4, t: Date.now() - 121_000 }) };
  const s = runShell({ search: q(DEEP, HOME), onLine: true, storage });
  assert.equal(s.timers[0].ms, 3000);
});

test('재시도는 한 번만 떠난다(버튼 + online + 타이머가 겹쳐도 이동 1회)', () => {
  const s = runShell({ search: q(DEEP, HOME), onLine: true });
  s.els.retry.onClick();
  s.winListeners.online();
  s.timers[0].fn();
  assert.equal(s.nav.length, 1);
});

test('기기 언어가 한국어가 아니면 영어', () => {
  const s = runShell({ search: q(DEEP, HOME), onLine: false, language: 'ja-JP' });
  assert.equal(s.els.title.textContent, 'No internet connection');
  assert.equal(s.els.retry.textContent, 'Try again');
  assert.equal(s.ctx.document.documentElement.lang, 'en');
});

test('파라미터 없이 뜨면 자기 자신을 새로 고치는 루프를 돌지 않는다(예전 1.2초 반복 새로 고침)', () => {
  const s = runShell({ search: '', onLine: true });
  assert.equal(s.timers.length, 0);
  s.els.retry.onClick();
  assert.deepEqual(s.nav, [['reload']]);
});

// ── 가드: 셸을 띄우는 쪽 ──────────────────────────────────────────────────────

test('capacitor.config 에 server.errorPath 를 넣지 않는다(HTTP 4xx/5xx·탐색 취소까지 셸로 덮는다)', () => {
  const gen = read('scripts/generate-app.mjs');
  assert.doesNotMatch(gen, /errorPath\s*:/, 'generate-app 이 errorPath 를 설정한다 — 브릿지 플러그인이 셸을 띄운다');
});

test('Android: 브릿지가 load() 에서 오프라인 셸 클라이언트를 달고, HTTP 오류는 건드리지 않는다', () => {
  const plugin = read('template/bridge/android/src/main/java/com/harness/bridge/AppBridgePlugin.kt');
  const client = read('template/bridge/android/src/main/java/com/harness/bridge/OfflineShellWebViewClient.kt');
  assert.match(plugin, /setWebViewClient\(OfflineShellWebViewClient\(/);
  assert.match(client, /isForMainFrame/);
  assert.match(client, /\?from=/);
  assert.match(client, /&home=/);
  assert.doesNotMatch(client, /override fun onReceivedHttpError/, 'HTTP 4xx/5xx 는 웹의 오류 화면이 맞다');
});

test('iOS: 브릿지가 navigationDelegate 를 감싸고, 탐색 취소(-999)는 셸 대상이 아니다', () => {
  const plugin = read('template/bridge/ios/Sources/AppBridgePlugin/AppBridgePlugin.swift');
  const proxy = read('template/bridge/ios/Sources/AppBridgePlugin/OfflineShellNavigationProxy.swift');
  assert.match(plugin, /webView\.navigationDelegate = proxy/);
  assert.match(proxy, /forwardingTarget\(for/);
  assert.match(proxy, /NSURLErrorNotConnectedToInternet/);
  assert.doesNotMatch(proxy, /NSURLErrorCancelled/);
});
