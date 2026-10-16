// Android 에뮬레이터 계층 — AVD 생성·부팅·설치·입력·화면·상황.
// adb 는 serial(emulator-5554)로, 카탈로그 기기는 AVD 이름 `lab-<id>` 로 잇는다.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  androidEnv, androidSdk, tool, sdkJava, run, mustRun, spawnDetached, sleep, RUNS_DIR, IS_MAC,
} from './env.mjs';

export const avdName = (dev) => `lab-${dev.id}`;

const env = () => androidEnv();
const adbBin = () => tool('adb');

export function adb(serial, args, opts = {}) {
  const pre = serial ? ['-s', serial] : [];
  return run(adbBin(), [...pre, ...args], { env: env(), ...opts });
}

// `adb shell` 에 문자열 하나로 넘긴다 — 원격 sh 가 해석하므로 따옴표는 호출자가 책임진다.
export function sh(serial, cmd, opts) {
  return adb(serial, ['shell', cmd], opts);
}

function imageAbi(dev, defaults) {
  const abi = dev.abi ?? defaults.abi;
  return !abi || abi === 'auto' ? (process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64') : abi;
}

export function imagePackage(dev, defaults) {
  return `system-images;android-${dev.api};${dev.tag ?? defaults.tag};${imageAbi(dev, defaults)}`;
}

function imageDir(dev, defaults) {
  return join(androidSdk(), 'system-images', `android-${dev.api}`, dev.tag ?? defaults.tag, imageAbi(dev, defaults));
}

export function hasImage(dev, defaults) {
  return existsSync(join(imageDir(dev, defaults), 'system.img'));
}

export function installImage(dev, defaults) {
  const pkg = imagePackage(dev, defaults);
  // 라이선스는 SDK 첫 설치 때 이미 동의돼 있어야 한다(사람 몫). 여기서는 'y' 를 넣지 않는다.
  const r = sdkJava('sdkmanager', [pkg], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (!r.ok) throw new Error(`시스템 이미지 설치 실패(${pkg}, exit ${r.code}): ${r.err || r.out}`);
  return r;
}

export function listAvds() {
  const home = env().ANDROID_AVD_HOME;
  if (!existsSync(home)) return [];
  return readdirSync(home).filter((f) => f.endsWith('.ini')).map((f) => f.slice(0, -4));
}

function avdConfigPath(name) {
  return join(env().ANDROID_AVD_HOME, `${name}.avd`, 'config.ini');
}

function patchIni(file, kv) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const map = new Map(lines.map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1)];
  }));
  for (const [k, v] of Object.entries(kv)) map.set(k, String(v));
  writeFileSync(file, [...map].map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

export function createAvd(dev, defaults, { force = false } = {}) {
  const name = avdName(dev);
  if (listAvds().includes(name) && !force) return { name, created: false };
  // Android 경로 탐색기는 존재하지 않는 ANDROID_AVD_HOME 을 무시하고 기본 경로를 쓴다.
  // 깨끗한 CI 호스트에서도 생성·검색·에뮬레이터가 같은 경로를 보도록 먼저 만든다.
  mkdirSync(env().ANDROID_AVD_HOME, { recursive: true });
  // 프로필이 없는 기기(갤럭시급 등)는 medium_phone 으로 만든 뒤 해상도·밀도를 덮어쓴다.
  const profile = dev.profile ?? 'medium_phone';
  const r = sdkJava('avdmanager', [
    'create', 'avd', '-n', name, '-k', imagePackage(dev, defaults), '-d', profile, '-f',
  ], { input: 'no\n' });
  if (!r.ok) throw new Error(`AVD 생성 실패(${name}): ${r.err || r.out}`);
  const kv = {
    'hw.ramSize': `${dev.ramMb ?? defaults.ramMb}M`,
    'hw.cpu.ncore': dev.cores ?? defaults.cores,
    'vm.heapSize': `${dev.heapMb ?? defaults.heapMb}M`,
    'disk.dataPartition.size': `${dev.dataMb ?? defaults.dataMb}M`,
    'hw.keyboard': 'yes', // 호스트 키보드 입력(사람이 창으로 볼 때)
    'showDeviceFrame': 'no',
    'avd.ini.displayname': dev.label,
  };
  if (dev.hw) {
    Object.assign(kv, {
      'hw.lcd.width': dev.hw.width,
      'hw.lcd.height': dev.hw.height,
      'hw.lcd.density': dev.hw.density,
    });
  }
  patchIni(avdConfigPath(name), kv);
  return { name, created: true };
}

export function deleteAvd(dev) {
  return sdkJava('avdmanager', ['delete', 'avd', '-n', avdName(dev)]);
}

// 떠 있는 에뮬레이터: serial → AVD 이름
export function running() {
  const r = adb(null, ['devices']);
  const serials = r.out.split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter(([s, st]) => s?.startsWith('emulator-') && st === 'device')
    .map(([s]) => s);
  const out = {};
  for (const s of serials) {
    const n = adb(s, ['emu', 'avd', 'name']).out.split(/\r?\n/)[0]?.trim();
    if (n) out[n] = s;
  }
  return out;
}

export function serialOf(dev) {
  return running()[avdName(dev)] ?? null;
}

const DEFAULT_GPU = IS_MAC ? 'host' : 'swiftshader_indirect';

const DIET = [
  'com.google.android.googlequicksearchbox', // Google 앱(검색·어시스턴트)
  'com.google.android.apps.messaging',
  'com.google.android.as', // Android System Intelligence
  'com.google.android.apps.photos',
  'com.google.android.apps.maps',
  'com.google.android.youtube',
  'com.google.android.apps.youtube.music',
  'com.google.android.apps.wellbeing',
];

function freePort() {
  const used = new Set(Object.values(running()).map((s) => Number(s.split('-')[1])));
  // adb 기본 탐지 범위(5554~5584, 짝수)
  for (let p = 5554; p <= 5584; p += 2) if (!used.has(p)) return p;
  throw new Error('빈 에뮬레이터 포트가 없다(5554~5584). lab down 으로 몇 대 끄자.');
}

// gpu: 기본은 LAB_GPU 환경변수 → 없으면 맥=host · 그 밖(Windows·CI)=swiftshader_indirect(소프트웨어 렌더러).
//   Windows 에서 host(Intel Arc + gfxstream)는 가볍지만 화면 읽기(glReadPixels)가 실패해 스크린샷이 흰색/검정으로
//   나온다(2026-10-06 폴더블 실측) — 에이전트는 스크린샷이 생명이라 소프트웨어 렌더러를 기본으로 한다.
//   ⚠ angle_indirect 는 에뮬레이터 37.2 가 '유효하지 않은 값'으로 보고 auto(=swiftshader)로 바꾼다(로그 확인, 10-07).
// audio: 기본은 -no-audio(가볍고, 여러 대 동시 실행 시 맥 오디오를 안 잡는다). 음성 입력(STT) 테스트만
//   --audio 로 띄우고 lab situation <기기> <slug> host-mic on 으로 맥 마이크를 연결한다.
//   이미 떠 있는 기기는 플래그가 안 바뀐다(스냅샷 재사용) — lab down 후 다시 up.
export async function boot(dev, { window = false, cold = false, wipe = false, gpu, audio = false } = {}) {
  let serial = serialOf(dev);
  let pid;
  const logFile = join(RUNS_DIR, `emulator-${dev.id}.log`);
  if (!serial) {
    const port = freePort();
    serial = `emulator-${port}`;
    const args = ['-avd', avdName(dev), '-port', String(port), '-no-boot-anim',
      ...(audio ? [] : ['-no-audio']),
      '-gpu', gpu ?? process.env.LAB_GPU ?? DEFAULT_GPU];
    if (!window) args.push('-no-window');
    if (cold) args.push('-no-snapshot-load');
    if (wipe) args.push('-wipe-data');
    mkdirSync(RUNS_DIR, { recursive: true });
    pid = spawnDetached(tool('emulator'), args, { env: env(), logFile });
  }
  // 이미 떠 있던 기기도 부팅 완료를 확인하고 기본 처리를 다시 한다(앞선 lab up 이 시간 초과로 끊겼을 수 있다).
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60_000) { // 첫 콜드 부팅 + 다른 기기 동시 실행이면 8분을 넘긴다(실측)
    if (pid) {
      let alive = true;
      try { process.kill(pid, 0); } catch (error) {
        if (error.code === 'ESRCH') alive = false;
        else throw error;
      }
      if (!alive) {
        const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-8000) : '(시작 로그 없음)';
        throw new Error(`${dev.id} 에뮬레이터가 부팅 전에 종료됐다 — ${logFile}\n${tail}`);
      }
    }
    // API 레벨까지 읽혀야 완료로 본다 — 같은 포트의 이전 에뮬레이터가 꺼지는 도중 '1' 을 돌려줘
    // 죽은 기기를 부팅 완료로 오인한 적이 있다(2026-10-07, API 0).
    if (sh(serial, 'getprop sys.boot_completed').out.trim() === '1' && apiLevel(serial) > 0) {
      prep(serial);
      return serial;
    }
    await sleep(3000);
  }
  throw new Error(`${dev.id} 부팅 시간 초과(15분) — 계속 부팅 중일 수 있다. 잠시 뒤 lab up 을 다시 하거나 ${join(RUNS_DIR, `emulator-${dev.id}.log`)} 확인`);
}

// 부팅 뒤 기본 처리 — 여러 번 해도 같다.
export function prep(serial) {
  // 잠금화면 해제·화면 켜짐 유지(충전 중 켜짐).
  // 블루투스 끄기: google_apis 이미지의 블루투스 에뮬레이션이 'Bluetooth keeps stopping' 대화상자로 앱을 가린다.
  sh(serial, 'input keyevent 82; svc power stayon true; settings put system screen_off_timeout 1800000; cmd bluetooth_manager disable');

  // 테스트와 무관한데 부팅 뒤 수십 분 CPU 를 먹는 구글 앱을 끈다(사용자 0 비활성 — 이미지·AVD 는 그대로).
  // Chrome(인앱 브라우저 = SNS 로그인), Gboard(입력), Play 서비스(푸시)는 남긴다.
  sh(serial, DIET.map((p) => `pm disable-user --user 0 ${p} >/dev/null 2>&1`).join('; '));
}

// 시스템(우리 앱이 아닌) 'isn't responding' 대화상자 — 첫 부팅 뒤 과부하로 System UI·system 프로세스가 수시로 띄운다.
// '기다리기'를 눌러 치운다. 우리 앱의 대화상자는 건드리지 않는다(그건 결함 증거다).
export function dismissSystemAnr(serial) {
  sh(serial, 'uiautomator dump /sdcard/lab-anr.xml >/dev/null 2>&1');
  const xml = sh(serial, 'cat /sdcard/lab-anr.xml').out;
  const title = xml.match(/text="([^"]*)" resource-id="android:id\/alertTitle"/)?.[1]
    ?? xml.match(/resource-id="android:id\/alertTitle"[^>]*text="([^"]*)"/)?.[1] ?? '';
  // 시스템 프로세스만(앱 이름이 들어간 ANR·크래시는 결함 증거라 두고 판정한다)
  if (!/^(System UI|Process system|Bluetooth|Android System|Google|Phone|Pixel Launcher|Settings)\b/i.test(title)) return null;
  const m = xml.match(/resource-id="android:id\/aerr_wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!m) return null;
  input.tap(serial, Math.round((+m[1] + +m[3]) / 2), Math.round((+m[2] + +m[4]) / 2));
  return title;
}

// 부팅 직후 게스트 부하(1분 평균)가 가라앉을 때까지 — 그 사이 시스템 ANR 대화상자는 치운다.
// 과부하 상태에서 테스트하면 느린 반응을 결함으로 오판하고 Maestro 드라이버가 죽는다(2026-10-06 실측).
export async function settle(serial, { maxMs = 10 * 60_000, below = 4 } = {}) {
  const t0 = Date.now();
  let load = 99;
  while (Date.now() - t0 < maxMs) {
    dismissSystemAnr(serial);
    load = Number(sh(serial, 'cat /proc/loadavg').out.split(' ')[0]);
    if (load < below) return { settled: true, load, ms: Date.now() - t0 };
    await sleep(15_000);
  }
  return { settled: false, load, ms: Date.now() - t0 };
}

// 이 에뮬레이터가 오디오 장치를 갖고 떴는가(-no-audio 가 아닌가). 에뮬레이터 프로세스 인자로 판정한다.
export function audioEnabled(serial) {
  const port = serial.replace(/^emulator-/, '');
  try {
    const ps = execFileSync('ps', ['-axo', 'args'], { encoding: 'utf8' });
    const line = ps.split(/\r?\n/).find((l) => /emulator|qemu/.test(l) && l.includes(`-port ${port}`));
    return !!line && !line.includes('-no-audio');
  } catch {
    return true; // 판정 불가(Windows 등) — 막지 않는다. 무음이면 결과로 드러난다.
  }
}

export function shutdown(serial) {
  return adb(serial, ['emu', 'kill']);
}

export function apiLevel(serial) {
  return Number(sh(serial, 'getprop ro.build.version.sdk').out.trim());
}

export function installApk(serial, apk, pkg, { fresh = false } = {}) {
  if (fresh) adb(serial, ['uninstall', pkg]);
  // -r 교체(업그레이드 경로 유지), -g 는 쓰지 않는다 — 권한 프롬프트도 테스트 대상이다.
  return mustRun(adbBin(), ['-s', serial, 'install', '-r', apk], { env: env() });
}

export function installedVersion(serial, pkg) {
  const out = sh(serial, `dumpsys package ${pkg}`).out;
  const name = out.match(/versionName=(\S+)/)?.[1];
  const code = out.match(/versionCode=(\d+)/)?.[1];
  return name ? { name, code: Number(code) } : null;
}

export function launcherActivity(serial, pkg) {
  const out = sh(serial, `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`).out;
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes('/')).pop() ?? `${pkg}/.MainActivity`;
}

export function launch(serial, pkg) {
  return sh(serial, `am start -W -n ${launcherActivity(serial, pkg)}`);
}

export function openUrl(serial, url, pkg) {
  // 원격 sh 에서 & 가 백그라운드로 해석되지 않게 작은따옴표로 감싼다.
  const q = `'${url.replace(/'/g, `'\\''`)}'`;
  return sh(serial, `am start -W -a android.intent.action.VIEW -d ${q}${pkg ? ` ${pkg}` : ''}`);
}

export function screenshot(serial, file) {
  const r = run(adbBin(), ['-s', serial, 'exec-out', 'screencap', '-p'], {
    env: env(), encoding: 'buffer', maxBuffer: 128 * 1024 * 1024,
  });
  const buf = Buffer.isBuffer(r.out) ? r.out : Buffer.from(r.out);
  if (!r.ok || buf.length < 100) throw new Error(`screencap 실패: ${r.err}`);
  writeFileSync(file, buf);
  return file;
}

// uiautomator 덤프 → 에이전트가 읽기 쉬운 요소 목록(문자열·설명·id·중심 좌표).
// WebView 안 DOM 도 접근성 노드로 나온다(텍스트·aria-label). 정밀한 DOM 은 web.mjs(CDP).
export function uiElements(serial) {
  sh(serial, 'uiautomator dump /sdcard/lab-ui.xml');
  const xml = sh(serial, 'cat /sdcard/lab-ui.xml').out;
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const b = a.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    const label = a.text || a['content-desc'] || '';
    const clickable = a.clickable === 'true';
    if (!label && !clickable) continue;
    if (x2 - x1 <= 0 || y2 - y1 <= 0) continue;
    nodes.push({
      text: decode(label),
      id: a['resource-id'] || undefined,
      cls: a.class?.split('.').pop(),
      clickable,
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      bounds: [x1, y1, x2, y2],
    });
  }
  return nodes;
}

const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export const input = {
  tap: (serial, x, y) => sh(serial, `input tap ${x} ${y}`),
  swipe: (serial, x1, y1, x2, y2, ms = 300) => sh(serial, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`),
  key: (serial, key) => sh(serial, `input keyevent ${key}`),
  // adb input text 는 ASCII 만 된다. 한글 등은 web.mjs 의 CDP insertText 를 쓴다.
  text: (serial, text) => sh(serial, `input text '${text.replace(/ /g, '%s').replace(/'/g, `'\\''`)}'`),
};

export function logcat(serial, { since = '2m', grep } = {}) {
  // chromium = WebView 콘솔, Capacitor = 브릿지, AndroidRuntime = 크래시
  const r = adb(serial, ['logcat', '-d', '-v', 'time', '-T', since.endsWith('m')
    ? new Date(Date.now() - Number(since.slice(0, -1)) * 60_000).toISOString().slice(5, 19).replace('T', ' ') + '.000'
    : since]);
  const lines = r.out.split(/\r?\n/).filter((l) => /chromium|Capacitor|AndroidRuntime|FATAL|ANR/.test(l));
  return grep ? lines.filter((l) => l.includes(grep)) : lines;
}

export function secureFlag(serial) {
  // 캡처 차단(FLAG_SECURE) 이 걸린 창이 있으면 1 이상
  const out = sh(serial, 'dumpsys window windows').out;
  return (out.match(/fl=[^\n]*SECURE/g) ?? []).length;
}

export function topActivity(serial) {
  const out = sh(serial, 'dumpsys activity activities').out;
  return out.match(/topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/)?.[1]
    ?? out.match(/ResumedActivity: ActivityRecord\{\S+ \S+ (\S+)/)?.[1] ?? null;
}

// 지금 앱이 살아 있나·무엇이 맨 위인가·캡처 차단·최근 크래시/ANR — 에이전트가 '앱 결함 vs 환경'을 가를 때 먼저 본다.
export function health(serial, pkg) {
  const pid = sh(serial, `pidof ${pkg}`).out.trim() || null;
  const log = adb(serial, ['logcat', '-d', '-v', 'time', '-t', '3000']).out.split(/\r?\n/);
  const crashes = [];
  for (let i = 0; i < log.length; i++) {
    const l = log[i];
    if (/FATAL EXCEPTION/.test(l) && (log[i + 1] ?? '').includes(pkg)) crashes.push(`${l.trim()} ${log[i + 1].trim()}`);
    if (/ANR in /.test(l)) crashes.push(l.trim());
  }
  const load = sh(serial, 'cat /proc/loadavg').out.trim().split(' ').slice(0, 3).join(' ');
  return {
    appRunning: !!pid,
    pid,
    top: topActivity(serial),
    secureWindows: secureFlag(serial),
    recentCrashOrAnr: crashes.slice(-5),
    guestLoad: load,
    hint: Number(load.split(' ')[0]) > 8 ? '게스트 부하가 높다 — 느린 반응은 환경 탓일 수 있다(판정 전 잠시 기다려 재확인)' : undefined,
  };
}

export function webviewPid(serial, pkg) {
  return sh(serial, `pidof ${pkg}`).out.trim().split(/\s+/)[0] || null;
}
