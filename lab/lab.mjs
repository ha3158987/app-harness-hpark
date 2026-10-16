#!/usr/bin/env node
// 디바이스 랩 CLI — 빌드 버전별로 앱을 에뮬레이터/시뮬레이터에 띄우고, 상황을 만들고, 조작·증거·판정·리포트까지.
// 사람과 AI 에이전트가 같은 명령을 쓴다. 문서: docs/26-DEVICE-LAB.md · 에이전트 절차: .claude/skills/device-test
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  IS_WIN, IS_MAC, LAB_DIR, RUNS_DIR, androidSdk, androidEnv, tool, run, runScript, readJson,
} from './lib/env.mjs';
import * as A from './lib/android.mjs';
import * as I from './lib/ios.mjs';
import * as B from './lib/builds.mjs';
import * as R from './lib/runs.mjs';
import * as W from './lib/web.mjs';
import { maestroWebWorker } from './lib/maestro-web.mjs';
import { SITUATIONS, apply as applySituation } from './lib/situations.mjs';
import * as C from './lib/cloud.mjs';

const CATALOG = readJson(join(LAB_DIR, 'devices.json'));
const ALL = [
  ...CATALOG.android.devices.map((d) => ({ ...d, platform: 'android' })),
  ...CATALOG.ios.devices.map((d) => ({ ...d, platform: 'ios' })),
];

// ── 인자 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[k] = true;
    else { flags[k] = next; i++; }
  } else pos.push(a);
}
const json = (o) => console.log(JSON.stringify(o, null, 2));
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

// ── 기기 해석 ────────────────────────────────────────────────────────────
function devicesFor(spec, { platform } = {}) {
  let list;
  if (!spec || spec === 'full' || spec === 'all') list = ALL;
  else if (CATALOG.sets[spec]) {
    const ids = CATALOG.sets[spec];
    list = ids === '*' ? ALL : ALL.filter((d) => ids.includes(d.id));
  } else {
    const ids = spec.split(',');
    list = ALL.filter((d) => ids.includes(d.id));
    const miss = ids.filter((id) => !list.some((d) => d.id === id));
    if (miss.length) die(`카탈로그에 없는 기기: ${miss.join(', ')} (lab devices)`);
  }
  // 이 호스트가 돌릴 수 없는 플랫폼은 뺀다(윈도·리눅스 = Android 만)
  list = list.filter((d) => (d.platform === 'ios' ? IS_MAC : true));
  if (platform) list = list.filter((d) => d.platform === platform);
  return list;
}

function one(id) {
  const d = ALL.find((x) => x.id === id);
  if (!d) die(`카탈로그에 없는 기기: ${id} (lab devices)`);
  return d;
}

function handle(dev) {
  if (dev.platform === 'ios') {
    const udid = I.udidOf(dev);
    if (!udid) die(`${dev.id} 시뮬레이터가 없다 — lab create ${dev.id}`);
    return { platform: 'ios', dev, udid, id: udid };
  }
  const serial = A.serialOf(dev);
  if (!serial) die(`${dev.id} 가 꺼져 있다 — lab up ${dev.id}`);
  return { platform: 'android', dev, serial, id: serial };
}

function ctxFor(devId, slug) {
  const h = handle(one(devId));
  const pkg = slug ? B.appConfig(slug).appId : null;
  return { ...h, pkg, slug };
}

// 화면 요소 = 네이티브(uiautomator) + WebView DOM(CDP, 화면 px 로 환산). 디버그 빌드가 아니면 네이티브만.
async function screenElements(h, slug) {
  const native = A.uiElements(h.serial).map((e) => ({ ...e, src: 'native' }));
  if (!slug) return native;
  const wv = native.find((e) => e.cls === 'WebView' || e.id?.endsWith(':id/webview'));
  if (!wv) return native;
  let dom;
  try { dom = await W.domElements(h.serial, B.appConfig(slug).appId); } catch (e) {
    console.error(`(WebView 요소 생략: ${e.message})`);
    return native;
  }
  const [x1, y1] = wv.bounds;
  const web = dom.items.map((e) => ({
    text: e.text, src: 'web', tag: e.tag, href: e.href, clickable: true,
    x: Math.round(x1 + e.cx * dom.dpr), y: Math.round(y1 + e.cy * dom.dpr),
  }));
  return [...native.filter((e) => e !== wv), ...web];
}

function ensureCreated(d) {
  if (d.platform === 'ios') return I.create(d);
  if (!A.hasImage(d, CATALOG.android.defaults)) {
    console.log(`… 시스템 이미지 설치 ${A.imagePackage(d, CATALOG.android.defaults)}`);
    A.installImage(d, CATALOG.android.defaults);
  }
  return A.createAvd(d, CATALOG.android.defaults, { force: !!flags.force });
}

async function bootDevice(d) {
  if (d.platform === 'ios') return I.boot(d, { window: !flags.headless });
  if (!A.listAvds().includes(A.avdName(d))) ensureCreated(d);
  const serial = await A.boot(d, { window: !!flags.window, cold: !!flags.cold, wipe: !!flags.wipe, gpu: flags.gpu, audio: !!flags.audio });
  // 부팅 직후 과부하가 가라앉을 때까지(시스템 ANR 대화상자는 치우며) — --no-settle 로 건너뛴다
  if (!flags['no-settle']) {
    const st = await A.settle(serial);
    console.log(st.settled ? `· ${d.id} 안정화 ${Math.round(st.ms / 1000)}초(부하 ${st.load})` : `⚠ ${d.id} 부하가 아직 높다(${st.load}) — 느린 반응을 결함으로 보지 말 것`);
  }
  return serial;
}

function installBuild(ctx, slug, { version, fresh }) {
  const b = B.resolve(slug, ctx.platform, version);
  if (ctx.platform === 'ios') I.install(ctx.udid, B.artifactPath(b), ctx.pkg, { fresh });
  else A.installApk(ctx.serial, B.artifactPath(b), ctx.pkg, { fresh });
  const v = ctx.platform === 'ios' ? I.installedVersion(ctx.udid, ctx.pkg) : A.installedVersion(ctx.serial, ctx.pkg);
  return { b, v };
}

// ── 명령 ────────────────────────────────────────────────────────────────
const commands = {
  async doctor() {
    const sdk = androidSdk();
    const env = androidEnv();
    const accel = tool('emulator') && existsSync(tool('emulator')) ? run(tool('emulator'), ['-accel-check'], { env }).out.trim().split(/\r?\n/).slice(-2).join(' ') : '없음';
    const imgs = CATALOG.android.devices.map((d) => `${d.api}:${A.hasImage(d, CATALOG.android.defaults) ? '✓' : '✗'}`);
    const maestro = maestroBin();
    const out = {
      host: `${process.platform} node ${process.version}`,
      androidSdk: sdk ?? '없음 — ANDROID_HOME 설정',
      avdHome: env.ANDROID_AVD_HOME,
      accel,
      java: run('java', ['-version']).err.split(/\r?\n/)[0] || '없음(JDK 17+ 필요)',
      systemImages: [...new Set(imgs)].join(' '),
      avds: A.listAvds().filter((n) => n.startsWith('lab-')),
      running: A.running(),
      maestro: maestro ? runScript(maestro, ['--version']).out.trim().split(/\r?\n/).pop() : '없음 — docs/26 §2',
      gh: run('gh', ['--version']).out.split(/\r?\n/)[0] || '없음(lab fetch 에 필요)',
    };
    if (IS_MAC) {
      out.xcode = run('xcodebuild', ['-version']).out.split(/\r?\n/)[0] || '없음';
      try {
        out.iosRuntimes = I.runtimes().filter((r) => r.platform === 'iOS').map((r) => r.version);
        const types = new Set(I.deviceTypes().map((t) => t.name));
        out.iosCatalog = CATALOG.ios.devices.map((d) => `${d.id}:${types.has(d.deviceType) ? '✓' : '✗기종'}${I.resolveRuntime(d.runtime) || (d.fallbackRuntime && I.resolveRuntime(d.fallbackRuntime)) ? '' : '✗런타임'}`);
      } catch (e) { out.ios = String(e.message); }
    }
    json(out);
  },

  devices() {
    const list = devicesFor(flags.set ?? pos[0] ?? 'full', { platform: flags.platform });
    const avds = new Set(A.listAvds());
    const live = A.running();
    const rows = list.map((d) => {
      let state = '';
      if (d.platform === 'android') state = live[A.avdName(d)] ? `켜짐 ${live[A.avdName(d)]}` : avds.has(A.avdName(d)) ? '꺼짐' : '미생성';
      else state = I.udidOf(d) ? '생성됨' : '미생성';
      return `${d.id.padEnd(16)} ${String(d.dpWidth ?? '').padStart(4)}dp  ${state.padEnd(20)} ${d.label}  [${d.tags.join(',')}]`;
    });
    console.log(rows.join('\n'));
    console.log(`\n세트: ${Object.keys(CATALOG.sets).join(' · ')}  (예: lab up smoke)`);
  },

  create() {
    for (const d of devicesFor(pos[0])) {
      const r = ensureCreated(d);
      console.log(`${r.created ? '✓ 생성' : '· 있음'} ${r.name ?? r.udid} — ${d.label}`);
    }
  },

  async up() {
    for (const d of devicesFor(pos[0])) {
      const id = await bootDevice(d);
      console.log(`✓ ${d.id} ${id}${d.platform === 'android' ? ` (API ${A.apiLevel(id)})` : ''}`);
    }
  },

  down() {
    if (pos[0] === 'all') {
      for (const s of Object.values(A.running())) A.shutdown(s);
      if (IS_MAC) run('xcrun', ['simctl', 'shutdown', 'all']);
      return console.log('✓ 전부 끔');
    }
    for (const d of devicesFor(pos[0])) {
      if (d.platform === 'ios') { const u = I.udidOf(d); if (u) I.shutdown(u); }
      else { const s = A.serialOf(d); if (s) A.shutdown(s); }
      console.log(`✓ ${d.id} 끔`);
    }
  },

  build() {
    const [slug] = pos;
    if (!slug) die('lab build <slug> --platform android|ios [--start-url URL]');
    const b = B.buildLocal(slug, flags.platform ?? 'android', { startUrl: flags['start-url'] });
    console.log(`✓ 보관 ${b.slug} ${b.version}+${b.code} ${b.platform}-${b.variant} → ${b.dir}`);
  },

  import() {
    const [slug, apk] = pos;
    if (!slug || !apk) die('lab import <slug> <apk 경로>');
    const b = B.importApk(slug, apk, { variant: flags.variant });
    console.log(`✓ 보관 ${b.slug} ${b.version}+${b.code} ${b.platform}-${b.variant} → ${b.dir}`);
  },

  fetch() {
    const [slug] = pos;
    if (!slug) die('lab fetch <slug> [--run <id>] (생략 시 최신 성공 device-lab 런)');
    const id = flags.run ?? B.latestRunId(slug);
    for (const b of B.fetchRun(slug, id)) console.log(`✓ CI 런 ${id} → ${b.version}+${b.code} ${b.platform}-${b.variant}`);
  },

  // CI·맥: generate-app --platform ios 뒤, xcodebuild 전에 — Firebase plist(실키 또는 자리표시)
  'prepare-ios'() {
    const [slug] = pos;
    console.log(`GoogleService-Info.plist: ${B.prepareIosFirebasePlist(slug)}`);
  },

  // 런 결과 → 마크다운 표(GitHub Actions 요약·PR 댓글용)
  summary() {
    const run_ = R.current(flags.run) ?? die('런이 없다');
    const rows = R.results(run_);
    const last = new Map();
    for (const r of rows) last.set(`${r.device}|${r.scenario}|${r.situations ?? ''}`, r);
    const list = [...last.values()];
    const n = (v) => list.filter((r) => r.verdict === v).length;
    const icon = { PASS: '✅', FAIL: '❌', BLOCKED: '⛔', SKIP: '⏭️' };
    console.log(`### 디바이스 랩 — ${run_.suite ?? ''} ${run_.build ?? ''}\n`);
    console.log(`PASS ${n('PASS')} · FAIL ${n('FAIL')} · BLOCKED ${n('BLOCKED')} · SKIP ${n('SKIP')}\n`);
    console.log('| 기기 | 상황 | 시나리오 | 결과 | 메모 |\n|---|---|---|---|---|');
    for (const r of list.sort((a, b) => (a.verdict === 'FAIL' ? -1 : 0) - (b.verdict === 'FAIL' ? -1 : 0))) {
      console.log(`| ${r.device} | ${r.situations ?? ''} | ${r.scenario} | ${icon[r.verdict] ?? ''} ${r.verdict} | ${(r.note ?? '').replace(/\|/g, '\\|').slice(0, 160)} |`);
    }
  },

  builds() {
    const list = B.list(pos[0]);
    if (!list.length) return console.log('(보관된 빌드 없음 — lab build / lab fetch / lab import)');
    for (const b of list) {
      console.log(`${b.slug.padEnd(16)} ${`${b.version}+${b.code}`.padEnd(10)} ${`${b.platform}-${b.variant}`.padEnd(16)} ${b.source.padEnd(14)} ${b.at?.slice(0, 16)}  ${b.startUrl ?? ''}`);
    }
  },

  install() {
    const [devId, slug] = pos;
    if (!devId || !slug) die('lab install <기기> <slug> [--version V] [--fresh]');
    const ctx = ctxFor(devId, slug);
    const { b, v } = installBuild(ctx, slug, { version: flags.version, fresh: !!flags.fresh });
    console.log(`✓ ${devId} ← ${slug} ${b.version}+${b.code} (${b.variant}, ${b.source})${flags.fresh ? ' 새로 설치' : ''} · 설치 확인 ${JSON.stringify(v)}`);
  },

  launch() {
    const [devId, slug] = pos;
    const ctx = ctxFor(devId, slug);
    // --url <주소> 또는 --link <스위트 딥링크 이름>(lab/suites/*/suite.json deeplinks)
    const url = flags.link ? resolveVars(slug, ctx.pkg)[flags.link] ?? die(`딥링크 이름 없음: ${flags.link}`) : flags.url;
    if (url) {
      if (ctx.platform === 'ios') I.openUrl(ctx.udid, url); else A.openUrl(ctx.serial, url, ctx.pkg);
    } else if (ctx.platform === 'ios') I.launch(ctx.udid, ctx.pkg);
    else A.launch(ctx.serial, ctx.pkg);
    console.log(`✓ 실행 ${slug} @ ${devId}${url ? ` ${url}` : ''}`);
  },

  situations() {
    for (const [k, v] of Object.entries(SITUATIONS)) console.log(`${k.padEnd(14)} ${v.args.padEnd(40)} ${v.desc}`);
  },

  async situation() {
    const [devId, slug, name, ...rest] = pos;
    if (!name) die('lab situation <기기> <slug> <이름> [인자…] — 목록: lab situations');
    const ctx = ctxFor(devId, slug);
    // 인자에 스위트 변수·딥링크 이름을 쓸 수 있다: deeplink viewer-scheme cold · push-tap /detail/${CONTENT_ID}
    const vars = resolveVars(slug, ctx.pkg);
    const r = await applySituation(ctx, name, rest.map((a) => vars[a] ?? expand(a, vars)));
    if (r.unsupported) { console.log(`⚠ 지원 안 함(${ctx.platform}): ${r.unsupported}`); process.exitCode = 3; return; }
    if (r.ok === false || (r.code && r.code !== 0)) die(`${name} 실패: ${r.err || r.out}`);
    console.log(`✓ ${name} ${rest.join(' ')}${r.note ? ` — ${r.note}` : ''}`);
  },

  shot() {
    const [devId] = pos;
    const h = handle(one(devId));
    const run_ = R.current(flags.run);
    const file = flags.out ?? (run_
      ? R.shotPath(run_, devId, flags.scenario, flags.step)
      : join(RUNS_DIR, `shot-${devId}-${Date.now()}.png`));
    mkdirSync(join(file, '..'), { recursive: true });
    if (h.platform === 'ios') I.screenshot(h.udid, file); else A.screenshot(h.serial, file);
    console.log(file);
  },

  async ui() {
    const [devId, slug] = pos;
    const h = handle(one(devId));
    if (h.platform === 'ios') die('iOS 는 화면 요소 목록을 mobile-mcp(mobile_list_elements_on_screen) 또는 컴퓨터 유즈로 본다');
    const els = await screenElements(h, slug);
    if (flags.json) return json(els);
    for (const e of els) {
      console.log(`${e.src === 'web' ? '◆' : e.clickable ? '▣' : '·'} (${e.x},${e.y}) ${e.text}${e.id ? `  #${e.id.split('/').pop()}` : ''}${e.href ? `  → ${e.href}` : ''}`);
    }
    if (!slug) console.log('\n(WebView 안 요소까지 보려면: lab ui <기기> <slug> — 디버그 빌드 필요)');
  },

  async tap() {
    const [devId, x, y] = pos;
    const h = handle(one(devId));
    if (h.platform === 'ios') die('iOS 탭은 mobile-mcp 또는 컴퓨터 유즈로');
    if (flags.text) {
      // lab tap <기기> --text 문구 [--slug <slug>] — 네이티브 + WebView 요소에서 찾는다
      const els = await screenElements(h, flags.slug === true ? null : flags.slug ?? pos[1]);
      const want = String(flags.text);
      const hit = els.find((e) => e.text === want) ?? els.find((e) => e.text.includes(want));
      if (!hit) die(`'${want}' 를 화면에서 못 찾음 — lab ui ${devId} <slug>`);
      A.input.tap(h.serial, hit.x, hit.y);
      return console.log(`✓ 탭 '${hit.text}' (${hit.x},${hit.y})`);
    }
    A.input.tap(h.serial, x, y);
    console.log(`✓ 탭 (${x},${y})`);
  },

  async type() {
    const [devId, slug, text] = pos;
    const ctx = ctxFor(devId, slug);
    if (ctx.platform === 'ios') die('iOS 입력은 mobile-mcp 또는 컴퓨터 유즈로');
    // ASCII 는 실제 키 입력(adb), 그 밖(한글 등)은 CDP insertText(디버그 빌드)
    if (/^[\x20-\x7E]*$/.test(text)) A.input.text(ctx.serial, text);
    else await W.insertText(ctx.serial, ctx.pkg, text);
    console.log(`✓ 입력 "${text}"`);
  },

  key() {
    const [devId, k] = pos;
    const h = handle(one(devId));
    const map = { back: 'KEYCODE_BACK', home: 'KEYCODE_HOME', enter: 'KEYCODE_ENTER', recents: 'KEYCODE_APP_SWITCH' };
    if (h.platform === 'ios') die('iOS 키는 mobile-mcp(mobile_press_button) 또는 컴퓨터 유즈로');
    A.input.key(h.serial, map[k] ?? k);
    console.log(`✓ ${k}`);
  },

  swipe() {
    const [devId, dir = 'up'] = pos;
    const h = handle(one(devId));
    if (h.platform === 'ios') die('iOS 스와이프는 mobile-mcp 또는 컴퓨터 유즈로');
    const [w, hh] = A.sh(h.serial, 'wm size').out.match(/(\d+)x(\d+)/).slice(1).map(Number);
    const cx = Math.round(w / 2), cy = Math.round(hh / 2);
    const d = { up: [cx, hh * 0.75, cx, hh * 0.25], down: [cx, hh * 0.25, cx, hh * 0.75], left: [w * 0.85, cy, w * 0.15, cy], right: [w * 0.15, cy, w * 0.85, cy] }[dir];
    A.input.swipe(h.serial, ...d.map(Math.round));
    console.log(`✓ 스와이프 ${dir}`);
  },

  async web() {
    const [devId, slug, sub = 'state', ...rest] = pos;
    const ctx = ctxFor(devId, slug);
    if (ctx.platform === 'ios') die('iOS WebView 는 맥 Safari › 개발자 메뉴(웹 검사기)로 — docs/26 §6');
    if (sub === 'state') return json(await W.state(ctx.serial, ctx.pkg));
    if (sub === 'console') return json(await W.collectConsole(ctx.serial, ctx.pkg, Number(rest[0] ?? 5000)));
    if (sub === 'eval') return json(await W.evaluate(ctx.serial, ctx.pkg, rest.join(' ')));
    if (sub === 'go') return json(await W.evaluate(ctx.serial, ctx.pkg, `location.assign(${JSON.stringify(rest[0])}); 'ok'`));
    die('lab web <기기> <slug> state|console [ms]|eval "<js>"|go <경로>');
  },

  health() {
    const [devId, slug] = pos;
    const ctx = ctxFor(devId, slug);
    if (ctx.platform === 'ios') die('iOS 는 lab logs 와 화면으로 본다');
    json(A.health(ctx.serial, ctx.pkg));
  },

  logs() {
    const [devId, slug] = pos;
    const ctx = ctxFor(devId, slug);
    const lines = ctx.platform === 'ios' ? I.logs(ctx.udid, ctx.pkg) : A.logcat(ctx.serial, { since: flags.since ?? '2m' });
    console.log(lines.slice(-Number(flags.tail ?? 80)).join('\n') || '(해당 로그 없음)');
  },

  // ── 런 ──
  async run() {
    const sub = pos.shift();
    if (sub === 'start') {
      const suite = flags.suite ? loadSuite(flags.suite) : null;
      const slug = flags.slug ?? suite?.slugs?.[0];
      const b = slug ? (() => { try { return B.resolve(slug, flags.platform ?? (IS_MAC ? 'ios' : 'android'), flags.version); } catch { return null; } })() : null;
      const r = R.start({
        suite: flags.suite ?? null, slug, build: b ? `${b.version}+${b.code} ${b.platform}-${b.variant}` : flags.version ?? null,
        devices: flags.devices ?? null, host: process.platform, by: flags.by ?? process.env.USERNAME ?? process.env.USER,
      });
      console.log(`✓ 런 시작 ${r.id}\n  ${r.dir}\n  (이후 shot·verdict·report 는 이 런에 쌓인다)`);
      if (suite) await preflight(suite);
      return;
    }
    if (sub === 'show') return json(R.current(flags.run));
    die('lab run start --suite <suite> [--slug] [--version] [--devices] | lab run show');
  },

  verdict() {
    const [devId, scenario, verdict] = pos;
    if (!['PASS', 'FAIL', 'BLOCKED', 'SKIP'].includes(verdict)) die('lab verdict <기기> <시나리오> PASS|FAIL|BLOCKED|SKIP [--note ""] [--issue ""] [--situations ""]');
    const run_ = R.current(flags.run) ?? die('열린 런이 없다 — lab run start');
    const row = R.record(run_, {
      device: devId, scenario, verdict, note: flags.note, situations: flags.situations,
      issues: flags.issue ? [].concat(flags.issue) : undefined,
    });
    console.log(`✓ ${row.verdict} ${scenario} @ ${devId}`);
  },

  report() {
    const run_ = R.current(flags.run) ?? die('런이 없다');
    const suite = run_.suite ? loadSuite(run_.suite) : null;
    const out = R.report(run_, { scenarios: suite?.scenarios ?? [], devices: ALL });
    console.log(out);
  },

  // ── 실기기(Firebase Test Lab Robo) ──
  cloud() {
    const [slug] = pos;
    if (!slug) die(`lab cloud <slug> [--models a36,s25,flip6,fold6] [--version V] [--timeout 300s] [--locale ko_KR] — 별칭: ${Object.keys(C.MODELS).join(', ')}`);
    const b = B.resolve(slug, 'android', flags.version);
    const models = String(flags.models ?? 'a36,flip6').split(',');
    console.log(`… FTL Robo ${slug} ${b.version}+${b.code} → ${models.map((m) => C.MODELS[m]?.label ?? m).join(' · ')} (수 분)`);
    const r = C.runRobo({ apk: B.artifactPath(b), slug, models, timeout: flags.timeout, locale: flags.locale, project: flags.project });
    const run_ = R.current(flags.run);
    if (run_) {
      for (const o of (Array.isArray(r.outcomes) ? r.outcomes : [])) {
        const dev = `ftl:${o.axis_value ?? o.axisValue ?? '?'}`;
        const verdict = /pass/i.test(o.outcome) ? 'PASS' : /fail/i.test(o.outcome) ? 'FAIL' : 'BLOCKED';
        R.record(run_, { device: dev, scenario: 'cloud:robo', verdict, note: `${o.outcome} — ${o.test_details ?? o.testDetails ?? ''} ${r.console ?? ''}`.trim(), source: 'ftl' });
      }
    }
    json({ ok: r.ok, console: r.console, results: r.bucket, outcomes: r.outcomes, tail: r.ok ? undefined : r.tail });
    if (r.bucket && run_) {
      const d = C.download(r.bucket, run_.dir);
      console.log(d.ok ? `✓ 실기기 스크린샷·영상·로그 → ${d.dest}` : `⚠ 결과 받기 실패: ${d.err}`);
    } else if (r.bucket) console.log(`스크린샷·영상·로그: gcloud storage cp -r ${r.bucket}/* <폴더>`);
    if (!r.ok) process.exitCode = 1;
  },

  // ── Maestro 회귀 플로우 ──
  async flow() {
    const [devId, slug] = pos;
    const ctx = ctxFor(devId, slug);
    const suite = loadSuite(flags.suite ?? 'poptale-v2');
    const run_ = R.current(flags.run) ?? R.start({ suite: suite.id, slug, devices: devId });
    const { stale } = await preflight(suite); // 단독 실행은 백엔드가 죽어도 돌린다 — 경고를 보고 사람이 판단한다
    const r = await runMaestro(ctx, suite, run_, { flow: flags.flow, preset: flags.preset ?? 'baseline', stale });
    console.log(r.summary);
    if (!r.ok) process.exitCode = 1;
  },

  // ── 자동 매트릭스: 기기 × 상황 프리셋 × Maestro 플로우 ──
  async matrix() {
    const suite = loadSuite(flags.suite ?? 'poptale-v2');
    const slug = flags.slug ?? suite.slugs[0];
    const devs = devicesFor(flags.devices ?? 'smoke');
    const presets = (flags.presets ?? 'baseline').split(',');
    const run_ = R.start({ suite: suite.id, slug, devices: flags.devices ?? 'smoke', build: flags.version ?? 'latest', mode: 'matrix' });
    console.log(`런 ${run_.id} — 기기 ${devs.length} × 프리셋 ${presets.length}`);
    const { down, stale } = await preflight(suite);
    if (down.length) {
      for (const d of devs) {
        for (const sc of suite.scenarios.filter((x) => x.flow)) {
          R.record(run_, { device: d.id, scenario: sc.id, verdict: 'BLOCKED', note: `백엔드 사전 점검 실패: ${down.join(' · ')}` });
        }
      }
      console.log(R.report(run_, { scenarios: suite.scenarios, devices: ALL }));
      process.exitCode = 2; // 앱 결함(FAIL)과 구분하되, 테스트 미실행을 CI 성공으로 숨기지 않는다.
      return;
    }
    let failed = 0;
    for (const d of devs) {
      await bootDevice(d);
      const ctx = ctxFor(d.id, slug);
      const { b } = installBuild(ctx, slug, { version: flags.version, fresh: true });
      console.log(`· ${d.id} ← ${b.version}+${b.code}`);
      for (const p of presets) {
        await applySituation(ctx, 'reset');
        const r = await runMaestro(ctx, suite, run_, { preset: p, stale });
        if (!r.ok) failed++;
        console.log(`${r.ok ? '✓' : '✗'} ${d.id} · ${p} — ${r.summary}`);
      }
      if (flags.down) {
        if (ctx.platform === 'ios') I.shutdown(ctx.udid); else A.shutdown(ctx.serial);
      }
    }
    console.log(R.report(run_, { scenarios: suite.scenarios, devices: ALL }));
    if (failed) process.exitCode = 1;
    else if (Object.keys(stale).length) process.exitCode = 2; // 낡은 데이터로 못 본 플로우를 CI 성공으로 숨기지 않는다
  },
};

// ── 스위트·Maestro ─────────────────────────────────────────────────────────
function loadSuite(id) {
  const dir = join(LAB_DIR, 'suites', id);
  if (!existsSync(dir)) die(`스위트 없음: lab/suites/${id}`);
  const suite = readJson(join(dir, 'suite.json'));
  const scenarios = existsSync(join(dir, 'scenarios.json')) ? readJson(join(dir, 'scenarios.json')).scenarios : [];
  return { id, dir, ...suite, scenarios };
}

// 스위트 사전 점검 — 백엔드가 죽어 있으면 화면 테스트 결과가 전부 환경 탓이 된다(2026-10-06 22시 dev API 503 실측).
// preflight.data — testData 값이 dev 콘텐츠 변경으로 낡으면 플로우가 앱 결함처럼 실패한다(2026-10-15 aitoon-demo 실측).
//   [{ key, url }] = url 응답 본문에 testData[key] 가 있어야 한다. 없으면 그 키를 쓰는 플로우를 BLOCKED 로 본다.
// 반환: { down: [백엔드 실패], stale: { 플로우: [낡은 키] } }
async function preflight(suite) {
  const vars = suite.testData ?? {};
  const get = (u) => fetch(u, { signal: AbortSignal.timeout(20_000) }).catch((e) => ({ ok: false, status: e.name }));
  const down = [];
  for (const u of (suite.preflight?.urls ?? []).map((x) => expand(x, vars))) {
    const r = await get(u);
    if (!r.ok) down.push(`${u} → ${r.status}`);
  }
  if (down.length) {
    console.log(`⚠ 사전 점검 실패 — 결과는 BLOCKED(환경)로 본다:\n  ${down.join('\n  ')}${suite.preflight?.$comment ? `\n  참고: ${suite.preflight.$comment}` : ''}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::디바이스 랩 사전 점검 실패(백엔드) — ${down.join(' · ')}`);
    return { down, stale: {} }; // 백엔드가 죽었으면 데이터 점검은 의미 없다
  }
  const stale = {};
  const bad = [];
  for (const { key, url } of suite.preflight?.data ?? []) {
    const u = expand(url, vars);
    const r = await get(u);
    const body = r.ok ? await r.text().catch(() => '') : '';
    if (body.includes(String(vars[key]))) continue;
    bad.push(`${key}="${vars[key]}" ← ${u} ${r.ok ? '본문에 없음' : `→ ${r.status}`}`);
    for (const f of flowsUsing(suite, key)) (stale[f] ??= []).push(key);
  }
  if (bad.length) {
    const flows = Object.keys(stale);
    console.log(`⚠ 테스트 데이터 낡음 — 영향 플로우(${flows.join(', ') || '없음'})는 BLOCKED 로 본다. suite.json testData 를 dev 값으로 고쳐라:\n  ${bad.join('\n  ')}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::디바이스 랩 테스트 데이터 낡음 — ${bad.join(' · ')}`);
  }
  return { down, stale };
}

// testData 키를 쓰는 플로우 이름 — 직접(${KEY}) 또는 그 키로 만든 딥링크(${LINK_<이름>})
function flowsUsing(suite, key) {
  const dir = join(suite.dir, 'flows');
  if (!existsSync(dir)) return [];
  const refs = [key, ...Object.entries(suite.deeplinks ?? {})
    .filter(([k, v]) => !k.startsWith('$') && String(v).includes(`\${${key}}`))
    .map(([k]) => `LINK_${k.replace(/-/g, '_').toUpperCase()}`)];
  return readdirSync(dir).filter((f) => f.endsWith('.yaml'))
    .filter((f) => refs.some((r) => readFileSync(join(dir, f), 'utf8').includes(`\${${r}}`)))
    .map((f) => f.replace(/\.yaml$/, ''));
}

// '${WEB}/detail/${CONTENT_ID}' → 값 치환(모르는 변수는 그대로 둔다)
function expand(s, vars) {
  return String(s).replace(/\$\{(\w[\w-]*)\}/g, (m, k) => vars[k] ?? m);
}

// slug 를 다루는 스위트(suite.json slugs)의 testData + deeplinks — 없으면 APP_ID 만
function resolveVars(slug, pkg) {
  const root = join(LAB_DIR, 'suites');
  const id = existsSync(root) && readdirSync(root).find((s) => {
    const f = join(root, s, 'suite.json');
    return existsSync(f) && (readJson(f).slugs ?? []).includes(slug);
  });
  const suite = id ? loadSuite(id) : {};
  const vars = { APP_ID: pkg, ...(suite.testData ?? {}) };
  for (const [k, v] of Object.entries(suite.deeplinks ?? {})) if (!k.startsWith('$')) vars[k] = expand(v, vars);
  return vars;
}

function maestroBin() {
  const cands = [
    process.env.MAESTRO_BIN,
    IS_WIN ? 'C:\\dev\\.tools\\maestro\\bin\\maestro.bat' : null,
    join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.maestro', 'bin', IS_WIN ? 'maestro.bat' : 'maestro'),
  ].filter(Boolean);
  const hit = cands.find((p) => existsSync(p));
  if (hit) return hit;
  return run(IS_WIN ? 'where' : 'which', ['maestro']).out.split(/\r?\n/)[0]?.trim() || null;
}

async function runMaestro(ctx, suite, run_, { flow, preset = 'baseline', stale = {} }) {
  const bin = maestroBin();
  if (!bin) die('Maestro 가 없다 — docs/26 §2');
  const steps = suite.presets?.[preset];
  if (!steps) die(`프리셋 없음: ${preset} (${Object.keys(suite.presets ?? {}).join(', ')})`);
  for (const [name, ...args] of steps) {
    const r = await applySituation(ctx, name, args);
    if (r.unsupported) {
      R.record(run_, { device: ctx.dev.id, scenario: `preset:${preset}`, verdict: 'SKIP', note: `${name}: ${r.unsupported}` });
      return { ok: true, summary: `건너뜀(${name} 미지원)` };
    }
  }
  const out = join(run_.dir, 'maestro', ctx.dev.id, preset);
  mkdirSync(out, { recursive: true });
  const target = flow ? join(suite.dir, 'flows', `${flow}.yaml`) : join(suite.dir, 'flows');
  // 프리셋의 locale 상황 → 그 언어 문구(L_*)를 플로우에 넘긴다
  const lang = steps.find(([n]) => n === 'locale')?.[1] ?? suite.defaultLocale ?? 'ko';
  const labels = Object.fromEntries(Object.entries(suite.labels?.[lang] ?? {}).map(([k, v]) => [`L_${k}`, v]));
  const vars = { APP_ID: ctx.pkg, PLATFORM: ctx.platform, ...(suite.testData ?? {}), ...labels };
  for (const [k, v] of Object.entries(suite.deeplinks ?? {})) {
    if (!k.startsWith('$')) vars[`LINK_${k.replace(/-/g, '_').toUpperCase()}`] = expand(v, vars);
  }
  const webHelper = ctx.platform === 'android' ? await maestroWebWorker(ctx.serial, ctx.pkg,
    { id: vars.CONTENT_ID, title: vars.CONTENT_TITLE }) : null;
  vars.LAB_WEB_URL = webHelper?.url ?? '';
  vars.LAB_WEB_TOKEN = webHelper?.token ?? '';
  const envs = Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const args = ['--device', ctx.id, 'test', target, '--format', 'junit', '--output', join(out, 'junit.xml'),
    '--test-output-dir', out, ...envs];
  if (!flow) args.push('--exclude-tags', `helper,${ctx.platform === 'ios' ? 'android-only' : 'ios-only'}`);
  // mobile-mcp 의 기기 서버(app_process DeviceServer, 30분 상주)가 UiAutomation 을 쥐고 있으면 Maestro 드라이버가
  // 기동 중 죽는다(2026-10-06 실측). 내려 두면 mobile-mcp 는 다음 호출 때 다시 띄운다.
  if (ctx.platform === 'android') A.sh(ctx.serial, 'pkill -f com.mobilenext.mobilecli.DeviceServer; am force-stop dev.mobile.maestro');
  rmSync(join(out, 'junit.xml'), { force: true }); // 이전 실행 결과를 읽지 않게
  let r;
  try { r = runScript(bin, args, {
    // 저사양 기기(중급기 흉내 2코어)·과부하 호스트에서 드라이버 기동이 기본 제한(수십 초)을 넘는다
    env: { ...androidEnv(), MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true', MAESTRO_DRIVER_STARTUP_TIMEOUT: process.env.MAESTRO_DRIVER_STARTUP_TIMEOUT ?? '240000' },
    cwd: suite.dir,
  }); } finally { webHelper?.close(); }
  const junit = existsSync(join(out, 'junit.xml')) ? readFileSync(join(out, 'junit.xml'), 'utf8') : '';
  const { cases, ok } = R.maestroResults(junit, r.ok, stale);
  const staleN = cases.filter((c) => c.stale).length;
  if (!cases.length || (!r.ok && !staleN)) {
    R.record(run_, { device: ctx.dev.id, scenario: `preset:${preset}`, verdict: 'BLOCKED', situations: preset,
      note: `Maestro 실행 확인 실패(exit ${r.code}, 결과 ${cases.length}개): ${(r.err || r.out).slice(-1500)}`, source: 'maestro' });
  }
  // 플로우 = 시나리오 id (suite.scenarios[].flow)
  for (const c of cases) {
    const sc = suite.scenarios.find((s) => s.flow === c.name) ?? { id: `flow:${c.name}` };
    R.record(run_, {
      device: ctx.dev.id, scenario: sc.id, verdict: c.verdict, situations: preset,
      note: c.verdict === 'PASS' ? 'Maestro 통과' : `Maestro ${c.verdict}: ${c.msg ?? c.verdict}`, source: 'maestro',
    });
  }
  // Maestro 스크린샷(takeScreenshot)을 리포트 폴더 구조로 모은다
  collectMaestroShots(out, run_, ctx.dev.id, suite, preset);
  const failed = cases.filter((c) => c.verdict === 'FAIL').length;
  return { ok, summary: `플로우 ${cases.length} · 실패 ${failed} · BLOCKED ${cases.filter((c) => c.verdict === 'BLOCKED').length} · SKIP ${cases.filter((c) => c.verdict === 'SKIP').length}${!cases.length ? ` · maestro 결과 없음: ${(r.err || r.out).split(/\r?\n/).filter(Boolean).slice(-3).join(' | ')}` : ''}` };
}

function collectMaestroShots(out, run_, devId, suite, preset) {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(out).filter((p) => p.endsWith('.png'))) {
    const base = f.split(/[\\/]/).pop().replace(/\.png$/, '');
    // 파일 이름 규칙: <flow>--<단계>.png (flows 에서 takeScreenshot: ${FLOW}--단계)
    const [flowName, step] = base.includes('--') ? base.split('--') : [null, base];
    const sc = suite.scenarios.find((s) => s.flow === flowName)?.id ?? (flowName ? `flow:${flowName}` : '_maestro');
    copyFileSync(f, R.shotPath(run_, devId, sc, `${preset}-${step}`));
  }
}

// ── 실행 ────────────────────────────────────────────────────────────────
const help = `디바이스 랩 — node lab/lab.mjs <명령>   (문서 docs/26-DEVICE-LAB.md)

환경    doctor · devices [세트] · create <기기|세트> · up <기기|세트> [--window] [--cold] [--wipe] [--audio] · down <기기|세트|all>
빌드    build <slug> --platform android|ios [--start-url URL] · import <slug> <apk> · fetch <slug> [--run id] · builds [slug]
앱      install <기기> <slug> [--version V] [--fresh] · launch <기기> <slug> [--url 딥링크]
상황    situations · situation <기기> <slug> <이름> [인자…]
조작    shot <기기> [--scenario S --step 이름] · ui <기기> · tap <기기> x y | --text 문구 · type <기기> <slug> "문자"
        key <기기> back|home|enter · swipe <기기> up|down|left|right · web <기기> <slug> state|console|eval|go · logs <기기> <slug>
런      run start --suite S [--slug] [--version] [--devices] · verdict <기기> <시나리오> PASS|FAIL|BLOCKED|SKIP [--note] [--issue]
        report · flow <기기> <slug> [--flow 이름] [--preset 이름] · matrix --suite S [--devices 세트] [--presets a,b] [--down]
기기 세트: ${Object.keys(CATALOG.sets).join(' · ')}`;

if (!cmd || cmd === 'help' || flags.help) console.log(help);
else if (!commands[cmd]) die(`모르는 명령: ${cmd}\n\n${help}`);
else {
  try { await commands[cmd](); } catch (e) { die(e.message); }
}
