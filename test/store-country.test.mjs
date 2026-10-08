// 스토어 나라(getStoreCountry) 규약.
//
// 왜 테스트로 못박는가: 웹이 이 값으로 나라별 절차를 고른다(팝테일 V2 성인 보기 — 한국=본인인증,
// 미국·일본=자기 선언). 엉뚱한 값이 흐르면 다른 나라 절차로 새고, 던지면 토글이 멈춘다. 그래서
//   ① 모르면 언제나 null(던지지 않는다)  ② alpha-2 대문자만 통과  ③ 확정값만 캐시 · 동시 호출 합치기 · 상한
//   ④ 옛 셸(네이티브 메서드 없음)은 capability false  ⑤ 네이티브 두 곳이 같은 메서드를 연다
// 를 고정한다. iOS 는 이 PC(Windows)에서 컴파일하지 못하므로 ⑤와 alpha-3 표는 소스를 직접 읽어 검사한다.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AppBridge } from '../template/bridge/dist/index.js';
import { AppBridgeWeb } from '../template/bridge/dist/web.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIG = {
  isNative: AppBridge.isNative,
  capabilities: AppBridge.capabilities,
  timeoutMs: AppBridge._storeCountryTimeoutMs,
};

afterEach(() => {
  AppBridge.isNative = ORIG.isNative;
  AppBridge.capabilities = ORIG.capabilities;
  AppBridge._storeCountryTimeoutMs = ORIG.timeoutMs;
  AppBridge._storeCountry = null;
  AppBridge._storeCountryPending = null;
  // 인스턴스 own property 로 덧씌운 것을 지워야 프로토타입 메서드가 돌아온다.
  delete AppBridge.ready;
  delete AppBridge._nativeStoreCountry;
});

/**
 * 네이티브 셸 흉내 — ready() 와 네이티브 호출을 갈아끼운다(Capacitor 네이티브는 Node 에 없다).
 * @param answer 네이티브 응답, 또는 (n번째 호출) => 응답
 * @returns {{ n: number }} 네이티브 왕복 횟수
 */
function nativeShell(answer, { supported = true } = {}) {
  const calls = { n: 0 };
  AppBridge.isNative = true;
  AppBridge.capabilities = { ...ORIG.capabilities, storeCountry: supported };
  AppBridge.ready = async () => AppBridge.capabilities;
  AppBridge._nativeStoreCountry = async () => {
    calls.n += 1;
    return typeof answer === 'function' ? answer(calls.n) : answer;
  };
  return calls;
}

function reset() {
  AppBridge._storeCountry = null;
  AppBridge._storeCountryPending = null;
}

test('웹(앱 아님)은 null — 네이티브를 부르지 않는다', async () => {
  const calls = nativeShell({ countryCode: 'KR' });
  AppBridge.isNative = false;

  assert.equal(await AppBridge.getStoreCountry(), null);
  assert.equal(calls.n, 0);
});

test('이 메서드가 없는 옛 셸(capabilities.storeCountry=false)은 null — 네이티브를 부르지 않는다', async () => {
  const calls = nativeShell({ countryCode: 'KR' }, { supported: false });

  assert.equal(await AppBridge.getStoreCountry(), null);
  assert.equal(calls.n, 0, '옛 셸에서 네이티브를 부르면 UNIMPLEMENTED 왕복만 생긴다');
});

test('네이티브가 준 alpha-2 를 돌려주고, 확정값은 캐시한다', async () => {
  const calls = nativeShell({ countryCode: 'KR' });

  assert.equal(await AppBridge.getStoreCountry(), 'KR');
  assert.equal(await AppBridge.getStoreCountry(), 'KR');
  assert.equal(calls.n, 1, '확정값이 있는데 네이티브를 다시 불렀다');
});

test('형식: alpha-2 대문자만 통과 — 소문자·공백은 고쳐 받고 그 밖은 null', async () => {
  for (const [raw, expected] of [
    ['kr', 'KR'], [' us ', 'US'], ['JP', 'JP'],
    ['KOR', null], ['', null], ['K', null], ['K1', null], ['한국', null],
    [410, null], [null, null], [undefined, null], [{ code: 'KR' }, null],
  ]) {
    reset();
    nativeShell({ countryCode: raw });
    assert.equal(await AppBridge.getStoreCountry(), expected, `countryCode=${JSON.stringify(raw)}`);
  }
  // 응답 자체가 비었거나 이유만 온 경우(Play 결제 불가 등)
  for (const res of [undefined, null, {}, { reason: 'billing-3' }, 'KR']) {
    reset();
    nativeShell(res);
    assert.equal(await AppBridge.getStoreCountry(), null, `res=${JSON.stringify(res)}`);
  }
});

test('null 은 캐시하지 않는다 — 다음 호출이 다시 묻는다', async () => {
  const calls = nativeShell((n) => (n === 1 ? { reason: 'billing-3' } : { countryCode: 'US' }));

  assert.equal(await AppBridge.getStoreCountry(), null);
  assert.equal(await AppBridge.getStoreCountry(), 'US', '처음의 null 이 굳어 버렸다');
  assert.equal(calls.n, 2);
});

test('네이티브가 거부하거나 던져도 null — 호출부로 던지지 않는다', async () => {
  // 옛 셸에서 메서드가 없으면 Capacitor 가 UNIMPLEMENTED 로 거부한다.
  nativeShell(() => {
    throw Object.assign(new Error('"AppBridge.getStoreCountry()" is not implemented on android'), { code: 'UNIMPLEMENTED' });
  });
  assert.equal(await AppBridge.getStoreCountry(), null);

  reset();
  nativeShell({ countryCode: 'KR' });
  AppBridge._nativeStoreCountry = () => { throw new Error('동기 예외'); }; // async 가 아닌 구현이 던져도
  assert.equal(await AppBridge.getStoreCountry(), null);

  reset();
  nativeShell({ countryCode: 'KR' });
  AppBridge.ready = async () => { throw new Error('ready 실패'); };
  assert.equal(await AppBridge.getStoreCountry(), null);
});

test('동시 호출은 네이티브 왕복 한 번으로 합친다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = nativeShell(async () => { await gate; return { countryCode: 'JP' }; });

  const a = AppBridge.getStoreCountry();
  const b = AppBridge.getStoreCountry();
  release();

  assert.deepEqual(await Promise.all([a, b]), ['JP', 'JP']);
  assert.equal(calls.n, 1);
});

test('네이티브가 응답하지 않으면 상한에서 null — 늦게 온 답은 다음 호출이 쓴다', async () => {
  AppBridge._storeCountryTimeoutMs = 20;
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = nativeShell(async () => { await gate; return { countryCode: 'KR' }; });

  assert.equal(await AppBridge.getStoreCountry(), null, '상한이 지났는데 계속 기다렸다');

  release();
  await new Promise((r) => setTimeout(r, 0)); // 늦은 답이 캐시에 들어갈 틈
  assert.equal(await AppBridge.getStoreCountry(), 'KR');
  assert.equal(calls.n, 1, '늦게 온 답을 버리고 다시 물었다');
});

test('capability: 네이티브 메서드 목록(PluginHeaders)에 getStoreCountry 가 있을 때만 true', () => {
  const cap = globalThis.Capacitor; // @capacitor/core 가 쓰는 그 객체(네이티브가 문서 시작 때 PluginHeaders 를 꽂는다)
  const had = Object.prototype.hasOwnProperty.call(cap, 'PluginHeaders');
  const orig = cap.PluginHeaders;
  const header = (name, methods) => ({ name, methods: methods.map((m) => ({ name: m, rtype: 'promise' })) });
  try {
    AppBridge.isNative = true;
    cap.PluginHeaders = [header('App', ['getLaunchUrl']), header('AppBridge', ['getConfig', 'getStoreCountry'])];
    assert.equal(AppBridge._storeCountryCapability(), true);

    cap.PluginHeaders = [header('AppBridge', ['getConfig', 'getBrightness'])]; // beta.5 이하로 빌드한 셸
    assert.equal(AppBridge._storeCountryCapability(), false, '옛 셸인데 true');

    cap.PluginHeaders = [header('Other', ['getStoreCountry'])];
    assert.equal(AppBridge._storeCountryCapability(), false, '다른 플러그인의 같은 이름을 봤다');

    cap.PluginHeaders = undefined;
    assert.equal(AppBridge._storeCountryCapability(), false);

    AppBridge.isNative = false;
    cap.PluginHeaders = [header('AppBridge', ['getStoreCountry'])];
    assert.equal(AppBridge._storeCountryCapability(), false, '웹에서 true');
  } finally {
    if (had) cap.PluginHeaders = orig;
    else delete cap.PluginHeaders;
  }
});

test('capability 는 기본 false 이고, 켜지면 대응 메서드가 있다(자가검증 경고 없음)', () => {
  assert.equal(ORIG.capabilities.storeCountry, false, 'ready() 전 기본값(NO_CAPS)에 storeCountry 가 없다');

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    AppBridge.capabilities = { ...ORIG.capabilities, storeCountry: true };
    AppBridge._validateCapabilities();
  } finally {
    console.warn = origWarn;
  }
  assert.deepEqual(warnings, [], 'CAP_METHOD 에 storeCountry → getStoreCountry 매핑이 없다');
});

test('web.js: 브라우저 구현은 나라 없이 돌려준다(플러그인 프록시를 직접 불러도 던지지 않는다)', async () => {
  const res = await new AppBridgeWeb().getStoreCountry();
  assert.equal(res.countryCode, undefined);
});

test('네이티브 두 곳이 같은 메서드를 연다 — iOS 등록 목록 + @objc 구현, Android @PluginMethod', () => {
  const swift = readFileSync(join(ROOT, 'template/bridge/ios/Sources/AppBridgePlugin/AppBridgePlugin.swift'), 'utf8');
  assert.match(swift, /CAPPluginMethod\(name: "getStoreCountry", returnType: CAPPluginReturnPromise\)/,
    'pluginMethods 에 없으면 JS 가 not implemented 를 받는다');
  assert.match(swift, /@objc func getStoreCountry\(_ call: CAPPluginCall\)/,
    '등록만 되고 구현이 없으면 호출 순간 크래시한다');

  const kt = readFileSync(join(ROOT, 'template/bridge/android/src/main/java/com/harness/bridge/AppBridgePlugin.kt'), 'utf8');
  assert.match(kt, /@PluginMethod\s+fun getStoreCountry\(call: PluginCall\)/);
});

test('iOS alpha-3 → alpha-2 표: 형식 · 1:1 · 실제 지역 · 주요 나라', () => {
  const src = readFileSync(join(ROOT, 'template/bridge/ios/Sources/AppBridgePlugin/StoreCountry.swift'), 'utf8');
  const body = src.match(/private static let table: \[String: String\] = \[([\s\S]*?)\n\s*\]/);
  assert.ok(body, '표를 찾지 못했다');
  const leftover = body[1].replace(/"[^"]*": "[^"]*",?/g, '').trim();
  assert.equal(leftover, '', '형식이 다른 항목이 있다');

  const pairs = [...body[1].matchAll(/"([^"]*)": "([^"]*)"/g)].map((m) => [m[1], m[2]]);
  assert.equal(pairs.length, 250, 'ISO 3166-1 249개 + XKS 여야 한다');
  const regions = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
  for (const [a3, a2] of pairs) {
    assert.match(a3, /^[A-Z]{3}$/, a3);
    assert.match(a2, /^[A-Z]{2}$/, `${a3} → ${a2}`);
    assert.ok(regions.of(a2), `${a3} → ${a2} 는 ICU 가 모르는 지역이다`);
  }
  const keys = pairs.map(([k]) => k);
  const values = pairs.map(([, v]) => v);
  assert.equal(new Set(keys).size, keys.length, 'alpha-3 중복');
  assert.equal(new Set(values).size, values.length, 'alpha-2 중복 — 두 나라가 한 코드로 읽힌다');

  const map = Object.fromEntries(pairs);
  // 성인 확인 방식이 갈리는 세 나라 + 헷갈리기 쉬운 것들
  for (const [a3, a2] of [
    ['KOR', 'KR'], ['USA', 'US'], ['JPN', 'JP'], ['PRK', 'KP'],
    ['GBR', 'GB'], ['TWN', 'TW'], ['HKG', 'HK'], ['MAC', 'MO'], ['CHN', 'CN'],
    ['DEU', 'DE'], ['ESP', 'ES'], ['MEX', 'MX'], ['XKS', 'XK'],
  ]) {
    assert.equal(map[a3], a2, a3);
  }
});
