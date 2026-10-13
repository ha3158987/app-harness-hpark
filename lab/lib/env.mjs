// 랩 실행 환경 — SDK 경로 · ASCII 경로 우회 · 프로세스 실행 헬퍼.
//
// 왜 ASCII 경로를 따로 잡나: Windows 사용자 폴더가 한글(C:\Users\김바다)이면 에뮬레이터·Gradle 이
// 경로를 못 읽는다(2026-09-23 실측). 그래서 홈이 비 ASCII 면 AVD·사용자 홈·Gradle 캐시를
// SDK 옆(예: C:\dev\.android-avd)으로 옮긴다. 이미 환경변수가 있으면 그것을 따른다.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IS_WIN = platform() === 'win32';
export const IS_MAC = platform() === 'darwin';
export const LAB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = resolve(LAB_DIR, '..');
export const RUNS_DIR = join(LAB_DIR, '.runs');
export const BUILDS_DIR = join(LAB_DIR, '.builds');

const isAscii = (s) => /^[\x00-\x7F]*$/.test(s);

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p));
}

export function androidSdk() {
  const sdk = firstExisting([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    IS_WIN ? 'C:\\dev\\.android-sdk' : null,
    IS_WIN && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    IS_MAC ? join(homedir(), 'Library', 'Android', 'sdk') : join(homedir(), 'Android', 'Sdk'),
  ]);
  return sdk ?? null;
}

// 에뮬레이터·adb·Gradle 이 볼 환경변수. 자식 프로세스에 그대로 넘긴다.
export function androidEnv() {
  const sdk = androidSdk();
  const env = { ...process.env };
  if (!sdk) return env;
  env.ANDROID_HOME = sdk;
  env.ANDROID_SDK_ROOT = sdk;
  const base = dirname(sdk);
  if (!isAscii(homedir())) {
    env.ANDROID_AVD_HOME ??= join(base, '.android-avd');
    env.ANDROID_USER_HOME ??= join(base, '.android-user');
    env.GRADLE_USER_HOME ??= join(base, '.gradle-home');
    if (IS_WIN) {
      const tmp = join(base, '.tmp');
      mkdirSync(tmp, { recursive: true });
      env.TMP = tmp;
      env.TEMP = tmp;
    }
  }
  env.ANDROID_AVD_HOME ??= join(homedir(), '.android', 'avd');
  // Git Bash 에서 /sdcard/… 같은 인자가 C:/Program Files/Git/sdcard 로 바뀌지 않게.
  env.MSYS_NO_PATHCONV = '1';
  return env;
}

export function tool(name) {
  const sdk = androidSdk();
  if (!sdk) return null;
  const exe = IS_WIN ? '.exe' : '';
  const map = {
    adb: join(sdk, 'platform-tools', `adb${exe}`),
    emulator: join(sdk, 'emulator', `emulator${exe}`),
    aapt: firstExisting(
      ['36.0.0', '35.0.0', '34.0.0'].map((v) => join(sdk, 'build-tools', v, `aapt${exe}`)),
    ),
    cmdlineTools: join(sdk, 'cmdline-tools', 'latest'),
  };
  return map[name] ?? null;
}

// cmdline-tools 의 .bat 은 cmd 가 `system-images;android-36;…` 의 `;` 를 인자 구분자로 쪼갠다.
// 그래서 Java 메인 클래스를 직접 부른다(맥·리눅스도 같은 방식이라 분기가 없다).
export function sdkJava(kind, args, opts = {}) {
  const tools = tool('cmdlineTools');
  const cls = {
    avdmanager: ['avdmanager-classpath.jar', 'com.android.sdklib.tool.AvdManagerCli'],
    sdkmanager: ['sdkmanager-classpath.jar', 'com.android.sdklib.tool.sdkmanager.SdkManagerCli'],
  }[kind];
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', IS_WIN ? 'java.exe' : 'java') : 'java';
  return run(java, [
    `-Dcom.android.sdkmanager.toolsdir=${tools}`,
    '-classpath', join(tools, 'lib', cls[0]),
    cls[1],
    ...(kind === 'sdkmanager' ? [`--sdk_root=${androidSdk()}`] : []),
    ...args,
  ], { env: androidEnv(), ...opts });
}

// 동기 실행. 실패해도 던지지 않고 결과를 돌려준다(호출자가 판단).
export function run(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    ...opts,
  });
  const binary = opts.encoding === 'buffer';
  return {
    ok: r.status === 0,
    code: r.status,
    out: binary ? (r.stdout ?? Buffer.alloc(0)) : (r.stdout ?? '').toString(),
    err: (r.stderr ?? '').toString() + (r.error ? String(r.error) : ''),
  };
}

// Windows 의 .bat/.cmd(maestro.bat · gradlew.bat)는 cmd 를 거쳐야 한다. shell:true 로 넘기면 인자가
// 따옴표 없이 이어 붙는다(DEP0190) — 여기서 하나씩 감싸 cmd /s /c 에 통째로 준다.
export function runScript(cmd, args = [], opts = {}) {
  if (!IS_WIN || !/\.(bat|cmd)$/i.test(cmd)) return run(cmd, args, opts);
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const line = [cmd, ...args].map(q).join(' ');
  return run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
}

export function mustRun(cmd, args, opts) {
  const r = run(cmd, args, opts);
  if (!r.ok) {
    throw new Error(`${cmd} ${args.join(' ')} → exit ${r.code}\n${r.err || r.out}`.trim());
  }
  return r;
}

// 오래 사는 프로세스(에뮬레이터)를 떼어 놓고 띄운다. 로그는 파일로.
export function spawnDetached(cmd, args, { env, logFile } = {}) {
  const fd = logFile ? openSync(logFile, 'a') : 'ignore';
  const child = spawn(cmd, args, {
    env,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
