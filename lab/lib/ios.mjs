// iOS 시뮬레이터 계층 — macOS + Xcode 전용(xcrun simctl).
// 카탈로그 기기는 시뮬레이터 이름 `lab-<id>` 로 만든다(같은 기종을 OS 별로 여러 대 둘 수 있게).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IS_MAC, run, mustRun, sleep } from './env.mjs';

export const simName = (dev) => `lab-${dev.id}`;

function simctl(args, opts) {
  if (!IS_MAC) throw new Error('iOS 시뮬레이터는 macOS 에서만 돈다(Xcode 필요).');
  return run('xcrun', ['simctl', ...args], opts);
}

function json(args) {
  const r = simctl([...args, '-j']);
  if (!r.ok) throw new Error(r.err);
  return JSON.parse(r.out);
}

export function runtimes() {
  return json(['list', 'runtimes']).runtimes.filter((r) => r.isAvailable);
}

// 'iOS 26' → 설치된 iOS 26.x 중 가장 높은 것
export function resolveRuntime(prefix) {
  const want = prefix.replace(/^iOS\s*/i, '');
  return runtimes()
    .filter((r) => r.platform === 'iOS' && (r.version === want || r.version.startsWith(`${want}.`)))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0] ?? null;
}

export function deviceTypes() {
  return json(['list', 'devicetypes']).devicetypes;
}

export function devices() {
  const all = json(['list', 'devices']).devices;
  return Object.values(all).flat();
}

export function udidOf(dev) {
  return devices().find((d) => d.name === simName(dev) && d.isAvailable)?.udid ?? null;
}

export function create(dev) {
  const existing = udidOf(dev);
  if (existing) return { udid: existing, created: false };
  const rt = resolveRuntime(dev.runtime) ?? (dev.fallbackRuntime ? resolveRuntime(dev.fallbackRuntime) : null);
  if (!rt) throw new Error(`${dev.runtime} 런타임이 없다 — Xcode › Settings › Components 에서 받거나 \`xcodebuild -downloadPlatform iOS\``);
  const type = deviceTypes().find((t) => t.name === dev.deviceType);
  if (!type) throw new Error(`기종 '${dev.deviceType}' 이 이 Xcode 에 없다 — lab doctor 로 목록 확인`);
  const r = mustRun('xcrun', ['simctl', 'create', simName(dev), type.identifier, rt.identifier]);
  return { udid: r.out.trim(), created: true, runtime: rt.version };
}

export async function boot(dev, { window = true } = {}) {
  const udid = udidOf(dev) ?? create(dev).udid;
  simctl(['boot', udid]); // 이미 켜져 있으면 실패하지만 무시한다
  mustRun('xcrun', ['simctl', 'bootstatus', udid, '-b']);
  // 컴퓨터 유즈로 볼 때는 Simulator 창이 있어야 한다.
  if (window) run('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid]);
  await sleep(1000);
  return udid;
}

export function shutdown(udid) {
  return simctl(['shutdown', udid]);
}

export function install(udid, appPath, bundleId, { fresh = false } = {}) {
  if (fresh) simctl(['uninstall', udid, bundleId]);
  return mustRun('xcrun', ['simctl', 'install', udid, appPath]);
}

export function installedVersion(udid, bundleId) {
  const r = simctl(['appinfo', udid, bundleId]);
  if (!r.ok) return null;
  const name = r.out.match(/CFBundleShortVersionString = "?([^";\n]+)/)?.[1];
  const code = r.out.match(/CFBundleVersion = "?([^";\n]+)/)?.[1];
  return name ? { name, code } : null;
}

export function launch(udid, bundleId) {
  return simctl(['launch', '--terminate-running-process', udid, bundleId]);
}

export function terminate(udid, bundleId) {
  return simctl(['terminate', udid, bundleId]);
}

export function openUrl(udid, url) {
  return simctl(['openurl', udid, url]);
}

export function screenshot(udid, file) {
  mustRun('xcrun', ['simctl', 'io', udid, 'screenshot', '--type=png', file]);
  return file;
}

export function push(udid, bundleId, payload) {
  const f = join(tmpdir(), `lab-push-${Date.now()}.apns`);
  writeFileSync(f, JSON.stringify({ 'Simulator Target Bundle': bundleId, ...payload }));
  return simctl(['push', udid, bundleId, f]);
}

// 시뮬레이터 전역 설정 — simctl 이 직접 못 하는 것은 AppleScript(Simulator 메뉴)로.
export const ui = {
  appearance: (udid, mode) => simctl(['ui', udid, 'appearance', mode]),
  contentSize: (udid, size) => simctl(['ui', udid, 'content_size', size]),
  rotate: (dir) => run('osascript', ['-e', 'tell application "Simulator" to activate',
    '-e', `tell application "System Events" to keystroke (ASCII character ${dir === 'left' ? 28 : 29}) using command down`]),
  // simctl 에는 홈 버튼이 없다 — 설정 앱을 앞으로 올려 우리 앱을 백그라운드로 보낸다.
  home: (udid) => simctl(['launch', udid, 'com.apple.Preferences']).ok,
};

export function privacy(udid, action, service, bundleId) {
  return simctl(['privacy', udid, action, service, bundleId]);
}

// 언어·지역 — 앱이 다음 실행부터 따른다(시스템 언어 = WKWebView Accept-Language).
export function setLanguage(udid, tag) {
  const lang = tag.replace('-', '_');
  simctl(['spawn', udid, 'defaults', 'write', 'Apple Global Domain', 'AppleLanguages', '-array', tag]);
  simctl(['spawn', udid, 'defaults', 'write', 'Apple Global Domain', 'AppleLocale', '-string', lang]);
}

export function logs(udid, bundleId, seconds = 120) {
  const r = simctl(['spawn', udid, 'log', 'show', '--last', `${seconds}s`, '--style', 'compact',
    '--predicate', `process == "App" OR subsystem CONTAINS "${bundleId}" OR eventMessage CONTAINS "WebKit"`]);
  return r.out.split(/\r?\n/).filter((l) => /error|fault|exception|crash|⚡️/i.test(l));
}
