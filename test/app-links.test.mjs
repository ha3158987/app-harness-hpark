// 앱 링크(App Links · Universal Links) 호스트를 WebView 이동 허용 목록과 분리한다 — navigation.appLinkDomains.
//
// 배경: generate-app 이 navigation.allowedDomains(WebView 이동 허용 목록) **전체**를 앱 링크로 등록했다.
// 그래서 와일드카드(*.poptale.ai)·API 호스트·--local IP 까지 autoVerify intent-filter 와 associated-domains 에
// 들어갔고, 같은 기기의 팝챗·팝테일 앱이 같은 호스트를 서로 주장했다(링크가 어느 앱으로 열릴지 모른다).
// 이 파일이 지키는 것:
//   ① 명시 목록이 있으면 그것만 ② 없으면 종전 동작 그대로(하위호환) ③ --local 호스트가 명시 목록에 새지 않음
//   ④ 형식 검증(조용히 검증 실패하는 값은 로딩에서 멈춘다) ⑤ 실제 앱 config 의 호스트가 서로 겹치지 않음
//   ⑥ 실제 패치 함수가 만드는 AndroidManifest · App.entitlements
// 실제 build/<slug> 는 건드리지 않는다 — 개발자가 쓰는 빌드를 테스트가 지우면 안 된다(임시 디렉터리 고정물).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, runtimeConfig } from '../scripts/lib/config.mjs';
import {
  appLinkHosts, wellKnownHosts, appLinkWarnings, hasExplicitAppLinks,
  patchAndroidDeepLinks, patchIosDeepLinks,
} from '../scripts/lib/app-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const V2_HOST = 'poptale-dev-web-188609021980.asia-northeast3.run.app';

/** 임시 레포(apps/t/app.config.json 하나)를 만들어 loadConfig 로 읽는다 — 검증 경로를 그대로 탄다. */
function loadWith(navigation, { features = { deepLink: true } } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ah-applinks-'));
  try {
    mkdirSync(join(root, 'apps', 't'), { recursive: true });
    writeFileSync(join(root, 'apps', 't', 'app.config.json'), JSON.stringify({
      slug: 't', appName: 'T', appId: 'com.example.t', startUrl: 'https://t.example.com',
      features, navigation,
    }));
    return loadConfig(root, 't');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// cap add android 가 만드는 MainActivity 모양(필요한 부분만).
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;

/** 네이티브 프로젝트 고정물 — android 매니페스트 + ios/App/App 디렉터리(Windows 에서도 iOS 패치를 태운다). */
function fixtureBuild(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ah-applinks-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const main = join(dir, 'android', 'app', 'src', 'main');
  mkdirSync(main, { recursive: true });
  writeFileSync(join(main, 'AndroidManifest.xml'), MANIFEST);
  mkdirSync(join(dir, 'ios', 'App', 'App'), { recursive: true });
  return dir;
}

const manifestOf = (dir) => readFileSync(join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const entitlementsOf = (dir) => readFileSync(join(dir, 'ios', 'App', 'App', 'App.entitlements'), 'utf8');
const androidHosts = (xml) => [...xml.matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]);
const iosHosts = (xml) => [...xml.matchAll(/<string>applinks:([^<]+)<\/string>/g)].map((m) => m[1]);

// ── 판정 ─────────────────────────────────────────────────────────────────────

test('appLinkDomains 가 없으면 종전대로 allowedDomains 전체가 앱 링크다 (하위호환)', () => {
  const cfg = loadWith({ allowedDomains: ['t.example.com', '*.example.com', 'api.example.com'] });
  assert.equal(cfg.appLinkDomains, null);
  assert.equal(hasExplicitAppLinks(cfg), false);
  assert.deepEqual(appLinkHosts(cfg), ['t.example.com', '*.example.com', 'api.example.com']);
  // .well-known 대상도 종전 규칙 — 시작 호스트 + 와일드카드가 아닌 호스트
  assert.deepEqual(wellKnownHosts(cfg), ['t.example.com', 'api.example.com']);
  assert.equal(appLinkWarnings(cfg).length, 1, '와일드카드가 앱 링크로 나가는 하위호환 앱에는 경고를 낸다');
});

test('appLinkDomains 가 있으면 그것만 앱 링크다 — 와일드카드·API 호스트는 WebView 이동 허용에만 남는다', () => {
  const allowed = ['t.example.com', '*.example.com', 'api.example.com'];
  const cfg = loadWith({ allowedDomains: allowed, appLinkDomains: ['t.example.com'] });
  assert.equal(hasExplicitAppLinks(cfg), true);
  assert.deepEqual(appLinkHosts(cfg), ['t.example.com']);
  assert.deepEqual(wellKnownHosts(cfg), ['t.example.com']);
  assert.deepEqual(cfg.navigation.allowedDomains, allowed, 'WebView 이동 허용 목록은 그대로다');
  assert.deepEqual(appLinkWarnings(cfg), []);
});

test('명시 목록은 시작 호스트를 자동으로 더하지 않는다 — .well-known 을 올릴 곳은 앱이 정한다', () => {
  const cfg = loadWith({ appLinkDomains: ['links.example.com'] });
  assert.deepEqual(appLinkHosts(cfg), ['links.example.com']);
  assert.deepEqual(wellKnownHosts(cfg), ['links.example.com']);
});

test('빈 배열 = https 앱 링크 없음(커스텀 스킴만) — 하위호환으로 떨어지지 않는다', () => {
  const cfg = loadWith({ allowedDomains: ['t.example.com', '*.example.com'], appLinkDomains: [] });
  assert.equal(hasExplicitAppLinks(cfg), true);
  assert.deepEqual(appLinkHosts(cfg), []);
  assert.deepEqual(wellKnownHosts(cfg), []);
});

test('--local 로 넣은 로컬 호스트는 명시 목록 앱의 앱 링크에 새지 않는다', () => {
  // generate-app --local 은 로컬 호스트를 allowedDomains 에 push 한다(WebView 가 거기로 이동해야 하므로).
  const explicit = loadWith({ allowedDomains: ['t.example.com'], appLinkDomains: ['t.example.com'] });
  explicit.navigation.allowedDomains.push('10.0.2.2');
  assert.deepEqual(appLinkHosts(explicit), ['t.example.com']);
  // 하위호환 앱은 종전 동작 그대로 — 호출 시점의 allowedDomains 를 읽는다.
  const compat = loadWith({ allowedDomains: ['t.example.com'] });
  compat.navigation.allowedDomains.push('10.0.2.2');
  assert.deepEqual(appLinkHosts(compat), ['t.example.com', '10.0.2.2']);
});

test('appLinkDomains 는 웹으로 나가는 runtimeConfig 를 바꾸지 않는다', () => {
  // 네이티브 생성 전용 값이다. navigation 에 섞으면 모든 앱의 app-config.json 모양이 바뀐다.
  const rc = runtimeConfig(loadWith({ allowedDomains: ['t.example.com'], appLinkDomains: ['t.example.com'] }));
  assert.deepEqual(Object.keys(rc.navigation).sort(), ['allowedDomains', 'externalInBrowser']);
  assert.equal('appLinkDomains' in rc, false);
});

// ── 형식 검증 ─────────────────────────────────────────────────────────────────

test('틀린 값은 config 로딩에서 멈춘다 — 앱 링크는 틀려도 에러 없이 브라우저로 열리기만 한다', () => {
  const cases = [
    [['*.example.com'], /와일드카드/],
    [['**.example.com'], /와일드카드/],
    [['https://t.example.com'], /호스트 이름이 아님/],
    [['t.example.com/path'], /호스트 이름이 아님/],
    [['t.example.com:443'], /호스트 이름이 아님/],
    [['T.Example.com'], /호스트 이름이 아님/],       // Android 는 호스트를 대소문자 구분해 비교한다
    [['10.0.2.2'], /IP 는 앱 링크 대상이 아니다/],
    [['localhost'], /호스트 이름이 아님/],
    [[''], /호스트 이름이 아님/],
    [[42], /호스트 이름이 아님/],
    ['t.example.com', /배열/],
  ];
  for (const [bad, re] of cases) {
    assert.throws(() => loadWith({ appLinkDomains: bad }), re, `거부해야 한다: ${JSON.stringify(bad)}`);
  }
});

test('딥링크가 꺼진 앱에 appLinkDomains 를 두면 멈춘다 — 선언만 하고 배선되지 않는 상태', () => {
  assert.throws(
    () => loadWith({ appLinkDomains: ['t.example.com'] }, { features: { deepLink: false } }),
    /features\.deepLink/,
  );
});

// ── 실제 앱 config ────────────────────────────────────────────────────────────

test('팝챗·팝테일 V2 dev 앱은 앱 링크 호스트를 명시하고, 서로 겹치지 않는다', () => {
  // 운영 앱 characterchat 은 DEV 한정 변경이라 일부러 미지정(운영 앱 첫 빌드 때 명시 — docs/02-GUIDE.md §6).
  const want = {
    'characterchat-dev': ['chat.dev.poptale.ai'],
    'poptale-v2-dev': [V2_HOST],
  };
  const claimedBy = new Map();
  for (const [slug, hosts] of Object.entries(want)) {
    const cfg = loadConfig(ROOT, slug);
    assert.deepEqual(appLinkHosts(cfg), hosts, `${slug} 의 앱 링크 호스트`);
    assert.deepEqual(wellKnownHosts(cfg), hosts, `${slug} 의 .well-known 대상`);
    assert.deepEqual(appLinkWarnings(cfg), [], `${slug} 는 경고가 없어야 한다`);
    for (const h of hosts) {
      assert.ok(!claimedBy.has(h), `${h} 를 ${claimedBy.get(h)} 와 ${slug} 가 둘 다 주장한다`);
      claimedBy.set(h, slug);
    }
  }
});

// ── 실제 패치 함수가 만드는 생성물 ───────────────────────────────────────────

test('poptale-v2-dev: intent-filter·associated-domains 에 V2 웹 호스트만 들어간다 (--local 조건 포함)', (t) => {
  const dir = fixtureBuild(t);
  const cfg = loadConfig(ROOT, 'poptale-v2-dev');
  cfg.navigation.allowedDomains.push('10.0.2.2'); // generate-app --local http://10.0.2.2:3000 과 같은 조건
  patchAndroidDeepLinks(dir, cfg);
  patchIosDeepLinks(dir, cfg);
  const manifest = manifestOf(dir);
  assert.match(manifest, /<intent-filter android:autoVerify="true">/);
  assert.deepEqual(androidHosts(manifest), [V2_HOST]);
  assert.deepEqual(iosHosts(entitlementsOf(dir)), [V2_HOST]);
});

test('characterchat-dev: *.poptale.ai 는 더 이상 앱 링크가 아니다', (t) => {
  const dir = fixtureBuild(t);
  const cfg = loadConfig(ROOT, 'characterchat-dev');
  assert.ok(cfg.navigation.allowedDomains.includes('*.poptale.ai'), '전제: WebView 이동 허용에는 남아 있다');
  patchAndroidDeepLinks(dir, cfg);
  patchIosDeepLinks(dir, cfg);
  assert.deepEqual(androidHosts(manifestOf(dir)), ['chat.dev.poptale.ai']);
  assert.deepEqual(iosHosts(entitlementsOf(dir)), ['chat.dev.poptale.ai']);
});

test('appLinkDomains 없는 앱의 생성물은 종전과 같다 — allowedDomains 전체 (하위호환)', (t) => {
  const dir = fixtureBuild(t);
  const allowed = ['t.example.com', '*.example.com', 'api.example.com'];
  const cfg = loadWith({ allowedDomains: allowed });
  patchAndroidDeepLinks(dir, cfg);
  patchIosDeepLinks(dir, cfg);
  assert.deepEqual(androidHosts(manifestOf(dir)), allowed);
  assert.deepEqual(iosHosts(entitlementsOf(dir)), allowed);
});

test('패치는 add-once 다 — 다시 돌려도 intent-filter 가 두 번 들어가지 않는다', (t) => {
  const dir = fixtureBuild(t);
  const cfg = loadConfig(ROOT, 'poptale-v2-dev');
  patchAndroidDeepLinks(dir, cfg);
  patchAndroidDeepLinks(dir, cfg);
  assert.equal(manifestOf(dir).split('harness-deeplinks').length - 1, 1);
});

test('빈 명시 목록이면 App Links intent-filter 를 넣지 않는다', (t) => {
  const dir = fixtureBuild(t);
  patchAndroidDeepLinks(dir, loadWith({ allowedDomains: ['t.example.com'], appLinkDomains: [] }));
  assert.equal(manifestOf(dir), MANIFEST);
});
