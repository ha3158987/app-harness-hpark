import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sdkJava } from '../lab/lib/env.mjs';
import { imagePackage, hasImage, createAvd } from '../lab/lib/android.mjs';
import { record, report } from '../lab/lib/runs.mjs';
import * as Runs from '../lab/lib/runs.mjs';

function workspace(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lab-regression-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
}

function fakeSdk(t, script) {
  const dir = workspace(t);
  const sdk = join(dir, 'sdk with spaces');
  const javaHome = join(dir, 'jdk');
  mkdirSync(join(sdk, 'cmdline-tools', 'latest', 'lib'), { recursive: true });
  mkdirSync(join(javaHome, 'bin'), { recursive: true });
  const java = join(javaHome, 'bin', 'java');
  writeFileSync(java, `#!${process.execPath}\n${script}\n`);
  chmodSync(java, 0o755);
  return { dir, sdk, javaHome };
}

test('direct sdkmanager invocation receives the SDK root without splitting package arguments', { skip: process.platform === 'win32' }, (t) => {
  const { sdk, javaHome } = fakeSdk(t, 'console.log(JSON.stringify(process.argv.slice(2)))');
  setEnv(t, { ANDROID_HOME: sdk, JAVA_HOME: javaHome });
  const pkg = 'system-images;android-36;google_apis;x86_64';
  const r = sdkJava('sdkmanager', [pkg]);
  assert.equal(r.ok, true, r.err);
  const args = JSON.parse(r.out);
  assert.ok(args.includes(`--sdk_root=${sdk}`), 'sdkmanager must receive an explicit SDK root');
  assert.ok(args.includes(pkg), 'package name must stay a single argument');
  const avd = JSON.parse(sdkJava('avdmanager', ['list', 'device']).out);
  assert.ok(!avd.some((arg) => arg.startsWith('--sdk_root=')), 'avdmanager does not accept sdkmanager flags');
});

for (const [arch, abi] of [['arm64', 'arm64-v8a'], ['x64', 'x86_64']]) {
  test(`Android images follow the ${arch} host architecture`, (t) => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'arch', { value: arch, configurable: true });
    t.after(() => Object.defineProperty(process, 'arch', descriptor));
    const defaults = JSON.parse(readFileSync(new URL('../lab/devices.json', import.meta.url))).android.defaults;
    const dev = { api: '36' };
    assert.equal(imagePackage(dev, defaults), `system-images;android-36;google_apis;${abi}`);
    const sdk = workspace(t);
    setEnv(t, { ANDROID_HOME: sdk });
    const image = join(sdk, 'system-images', 'android-36', 'google_apis', abi);
    mkdirSync(image, { recursive: true });
    writeFileSync(join(image, 'system.img'), '');
    assert.equal(hasImage(dev, defaults), true, 'image detection must use the same ABI as installation');
    assert.equal(imagePackage({ ...dev, abi: 'custom' }, defaults), 'system-images;android-36;google_apis;custom');
  });
}

test('a failed image install stops before AVD creation', { skip: process.platform === 'win32' }, (t) => {
  const { dir, sdk, javaHome } = fakeSdk(t, `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.LAB_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
console.error('image download failed');
process.exit(23);`);
  const calls = join(dir, 'calls.jsonl');
  const r = spawnSync(process.execPath, ['lab/lab.mjs', 'create', 'and16-s25'], {
    cwd: join(import.meta.dirname, '..'), encoding: 'utf8',
    env: { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: javaHome, ANDROID_AVD_HOME: join(dir, 'avds'), LAB_TEST_CALLS: calls },
  });
  assert.notEqual(r.status, 0);
  const invocations = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(invocations.length, 1, 'must not call avdmanager after sdkmanager fails');
  assert.match(r.stderr, /시스템 이미지 설치 실패/);
});

test('AVD creation works on a clean host with a previously nonexistent AVD home', { skip: process.platform === 'win32' }, (t) => {
  const { dir, sdk, javaHome } = fakeSdk(t, `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const name = args[args.indexOf('-n') + 1];
// Android's path locator ignores an ANDROID_AVD_HOME directory that does not exist.
const home = existsSync(process.env.ANDROID_AVD_HOME) ? process.env.ANDROID_AVD_HOME : process.env.ANDROID_USER_HOME + '/avd';
mkdirSync(join(home, name + '.avd'), { recursive: true });
writeFileSync(join(home, name + '.ini'), '');
writeFileSync(join(home, name + '.avd', 'config.ini'), 'hw.keyboard=no\\n');`);
  const avds = join(dir, 'new avds');
  setEnv(t, { ANDROID_HOME: sdk, JAVA_HOME: javaHome, ANDROID_AVD_HOME: avds, ANDROID_USER_HOME: join(dir, 'user') });
  const defaults = JSON.parse(readFileSync(new URL('../lab/devices.json', import.meta.url))).android.defaults;
  const result = createAvd({ id: 'clean-host', api: '36', label: 'Clean host' }, defaults);
  assert.equal(result.created, true);
  assert.match(readFileSync(join(avds, 'lab-clean-host.avd', 'config.ini'), 'utf8'), /hw.keyboard=yes/);
  assert.deepEqual(createAvd({ id: 'clean-host' }, defaults), { name: 'lab-clean-host', created: false });
});

test('boot reports an emulator process that exits before Android starts', { skip: process.platform === 'win32' }, (t) => {
  const dir = workspace(t);
  const lib = join(dir, 'lab', 'lib');
  mkdirSync(lib, { recursive: true });
  for (const name of ['env.mjs', 'android.mjs']) cpSync(new URL(`../lab/lib/${name}`, import.meta.url), join(lib, name));
  const sdk = join(dir, 'sdk');
  for (const [name, body] of [['platform-tools/adb', ''], ['emulator/emulator', "console.error('emulator startup failed: fixture'); process.exit(23);"]]) {
    const file = join(sdk, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `#!${process.execPath}\n${body}\n`);
    chmodSync(file, 0o755);
  }
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
const A = await import(${JSON.stringify(pathToFileURL(join(lib, 'android.mjs')).href)});
await A.boot({ id: 'startup-failure' });`], {
    env: { ...process.env, ANDROID_HOME: sdk }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(r.error, undefined, 'a dead emulator must not consume the 15-minute boot timeout');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /emulator startup failed: fixture/);
});

test('reports retain failures in one preset when another preset passes', (t) => {
  const run = { id: 'preset-regression', dir: workspace(t) };
  record(run, { device: 'phone', scenario: 'S01', situations: 'dark', verdict: 'FAIL', note: 'dark layout broken' });
  record(run, { device: 'phone', scenario: 'S01', situations: 'english', verdict: 'PASS', note: 'English readable' });
  const html = readFileSync(report(run), 'utf8');
  assert.match(html, /FAIL 1/);
  assert.match(html, /PASS 1/);
  assert.match(html, /dark layout broken/);
  assert.match(html, /English readable/);
});

test('reports use the last attempt within the same preset', (t) => {
  const run = { id: 'retry-regression', dir: workspace(t) };
  record(run, { device: 'phone', scenario: 'S01', situations: 'dark', verdict: 'FAIL', note: 'old result' });
  record(run, { device: 'phone', scenario: 'S01', situations: 'dark', verdict: 'PASS', note: 'retry passed' });
  const html = readFileSync(report(run), 'utf8');
  assert.match(html, /FAIL 0/);
  assert.match(html, /PASS 1/);
  assert.match(html, /retry passed/);
  assert.doesNotMatch(html, /old result/);
});

test('matrix returns a nonzero exit status when preflight prevents any E2E execution', (t) => {
  const dir = workspace(t);
  const lab = join(dir, 'lab');
  mkdirSync(lab);
  for (const name of ['lab.mjs', 'devices.json', 'lib', 'suites']) {
    cpSync(new URL(`../lab/${name}`, import.meta.url), join(lab, name), { recursive: true });
  }
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
globalThis.fetch = async () => ({ ok: false, status: 503 });
process.argv = ['node', 'lab/lab.mjs', 'matrix', '--suite', 'poptale-v2', '--devices', 'and16-s25'];
await import(${JSON.stringify(pathToFileURL(join(lab, 'lab.mjs')).href)});`], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' },
  });
  assert.equal(r.status, 2, 'BLOCKED must not look like a successful CI test');
  const id = readFileSync(join(lab, '.runs', 'current'), 'utf8');
  const rows = readFileSync(join(lab, '.runs', id, 'results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.verdict === 'BLOCKED'), 'environment failures must not become app defects');
});

for (const [name, xml, commandOk, expected, ok] of [
  ['missing JUnit', '', true, [], false],
  ['empty JUnit', '<testsuite tests="0"/>', true, [], false],
  ['driver error', '<testcase name="home"><error message="driver died"/></testcase>', true, [['home', 'BLOCKED']], false],
  ['skipped test', '<testcase name="home"><skipped/></testcase>', true, [['home', 'SKIP']], false],
  ['mixed testcase forms', '<testcase name="home"/><testcase name="detail"><failure message="missing button"/></testcase>', true, [['home', 'PASS'], ['detail', 'FAIL']], false],
  ['valid pass', '<testsuite><testcase name="home" time="1"/></testsuite>', true, [['home', 'PASS']], true],
  ['CLI failure despite passing XML', '<testcase name="home"/>', false, [['home', 'PASS']], false],
]) {
  test(`Maestro results do not claim false success: ${name}`, () => {
    assert.equal(typeof Runs.maestroResults, 'function');
    const result = Runs.maestroResults(xml, commandOk);
    assert.deepEqual(result.cases.map((c) => [c.name, c.verdict]), expected);
    assert.equal(result.ok, ok);
  });
}
