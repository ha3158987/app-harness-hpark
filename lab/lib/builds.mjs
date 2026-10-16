// 빌드 보관소 — "어느 버전을 테스트하나"를 한 곳에서. lab/.builds/<slug>/<이름+코드>/<플랫폼>-<변형>/
//   app.apk | App.app  +  meta.json { slug, version, code, platform, variant, startUrl, gitSha, source, at }
// 출처 3가지: 로컬 빌드(lab build) · CI 아티팩트(lab fetch, device-lab.yml) · 아무 APK(lab import).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { BUILDS_DIR, REPO_DIR, IS_WIN, IS_MAC, androidEnv, tool, run, runScript, mustRun, readJson } from './env.mjs';

export function appConfig(slug) {
  const p = join(REPO_DIR, 'apps', slug, 'app.config.json');
  if (!existsSync(p)) throw new Error(`apps/${slug}/app.config.json 이 없다`);
  return readJson(p);
}

function dirFor(slug, version, code, platform, variant) {
  return join(BUILDS_DIR, slug, `${version}+${code}`, `${platform}-${variant}`);
}

function save(meta, files) {
  const d = dirFor(meta.slug, meta.version, meta.code, meta.platform, meta.variant);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  for (const [src, name] of files) cpSync(src, join(d, name), { recursive: true });
  writeFileSync(join(d, 'meta.json'), JSON.stringify(meta, null, 2));
  return { dir: d, ...meta };
}

const gitSha = () => run('git', ['-C', REPO_DIR, 'rev-parse', '--short', 'HEAD']).out.trim() || null;

export function list(slug) {
  const out = [];
  if (!existsSync(BUILDS_DIR)) return out;
  for (const s of readdirSync(BUILDS_DIR)) {
    if (slug && s !== slug) continue;
    for (const v of readdirSync(join(BUILDS_DIR, s))) {
      for (const pv of readdirSync(join(BUILDS_DIR, s, v))) {
        const m = join(BUILDS_DIR, s, v, pv, 'meta.json');
        if (existsSync(m)) out.push({ dir: join(BUILDS_DIR, s, v, pv), ...readJson(m) });
      }
    }
  }
  return out.sort((a, b) => (b.code - a.code) || String(b.at).localeCompare(String(a.at)));
}

// version: '2.0.0+3' | '3'(코드) | 'latest' | undefined(=latest)
export function resolve(slug, platform, version) {
  const all = list(slug).filter((b) => b.platform === platform);
  if (!all.length) throw new Error(`${slug} ${platform} 빌드가 보관소에 없다 — lab build / lab fetch / lab import`);
  if (!version || version === 'latest') {
    return all.sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  }
  const hit = all.find((b) => `${b.version}+${b.code}` === version || String(b.code) === String(version) || b.version === version);
  if (!hit) throw new Error(`${slug} ${platform} ${version} 없음. 있는 것: ${all.map((b) => `${b.version}+${b.code}`).join(', ')}`);
  return hit;
}

export function artifactPath(b) {
  return join(b.dir, b.platform === 'ios' ? 'App.app' : 'app.apk');
}

// ── 로컬 빌드 ─────────────────────────────────────────────────────────────
export function buildLocal(slug, platform, { startUrl } = {}) {
  const cfg = appConfig(slug);
  const gen = ['scripts/generate-app.mjs', '--slug', slug, '--platform', platform];
  // --local 은 dev 전용 플래그(cleartext 허용)지만 https 주소에도 쓸 수 있다 — 다른 웹 배포(PR 미리보기 등)를 같은 셸로 볼 때.
  if (startUrl) gen.push('--local', startUrl);
  const env = androidEnv();
  mustRun(process.execPath, gen, { cwd: REPO_DIR, env, stdio: 'inherit' });
  const buildDir = join(REPO_DIR, 'build', slug);
  const meta = {
    slug, version: cfg.version.name, code: cfg.version.code, platform, variant: 'debug',
    startUrl: startUrl ?? cfg.startUrl, appId: cfg.appId, gitSha: gitSha(), at: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID ?? null,
    source: process.env.GITHUB_RUN_ID ? `ci:${process.env.GITHUB_RUN_ID}` : 'local',
  };
  if (platform === 'android') {
    const gw = join(buildDir, 'android', IS_WIN ? 'gradlew.bat' : 'gradlew');
    const g = runScript(gw, ['assembleDebug', '--console=plain'], { cwd: join(buildDir, 'android'), env, stdio: 'inherit' });
    if (!g.ok) throw new Error(`gradle assembleDebug 실패(exit ${g.code})`);
    const apk = join(buildDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    return save(meta, [[apk, 'app.apk']]);
  }
  if (platform === 'ios') {
    if (!IS_MAC) throw new Error('iOS 빌드는 macOS 에서만 — 맥에서 lab build 하거나 lab fetch 로 CI 산출물을 받는다');
    meta.firebasePlist = prepareIosFirebasePlist(slug);
    const appDir = join(buildDir, 'ios', 'App');
    const dd = join(tmpdir(), `lab-dd-${slug}`);
    // 서명 없이 시뮬레이터용 .app — 인증서·프로비저닝이 필요 없다.
    mustRun('xcodebuild', [
      '-workspace', 'App.xcworkspace', '-scheme', 'App', '-configuration', 'Debug',
      '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
      '-derivedDataPath', dd, 'CODE_SIGNING_ALLOWED=NO', 'build',
    ], { cwd: appDir, stdio: 'inherit' });
    const app = join(dd, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
    return save(meta, [[app, 'App.app']]);
  }
  throw new Error('platform 은 android | ios');
}

// iOS 는 generate-app 이 AppDelegate 에 FirebaseApp.configure() 를 무조건 넣는다(firebase.enabled 앱) →
// GoogleService-Info.plist 가 없으면 실행 즉시 죽는다. 랩 빌드는 실키(GOOGLE_SERVICE_INFO_PLIST_B64)가 있으면
// 그것을, 없으면 형식만 맞춘 자리표시를 둔다(API_KEY 도 Firebase 형식 'A'+38자 — 형식이 틀리면
// +[FIRInstallations validateAPIKey:] NSException 으로 실행 즉시 죽는다) — 앱은 뜨고, FCM 토큰만 안 나온다(시뮬레이터 simctl push 는 APNs
// 페이로드를 직접 넣으므로 탭 라우팅 확인에는 지장 없다). 스토어 빌드(release.yml)는 이 경로를 쓰지 않는다.
const PLACEHOLDER_MARK = '디바이스 랩 자리표시';
export function prepareIosFirebasePlist(slug) {
  const cfg = appConfig(slug);
  if (!cfg.firebase?.enabled) return 'firebase 미사용';
  const dest = join(REPO_DIR, 'build', slug, 'ios', 'App', 'GoogleService-Info.plist');
  if (process.env.GOOGLE_SERVICE_INFO_PLIST_B64) {
    writeFileSync(dest, Buffer.from(process.env.GOOGLE_SERVICE_INFO_PLIST_B64, 'base64'));
    return '실키';
  }
  // 예전 랩이 둔 자리표시(형식 틀린 키)는 덮어쓴다 — 그 외 기존 파일(손으로 넣은 실키)은 그대로 쓴다.
  if (existsSync(dest) && !readFileSync(dest, 'utf8').includes(PLACEHOLDER_MARK)) return '기존 파일';
  writeFileSync(dest, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${PLACEHOLDER_MARK}(lab/lib/builds.mjs) — 실 Firebase 프로젝트가 아니다. 시뮬레이터 실행용. -->
<plist version="1.0"><dict>
  <key>API_KEY</key><string>REDACTED_GOOGLE_API_KEY</string>
  <key>GCM_SENDER_ID</key><string>000000000000</string>
  <key>PLIST_VERSION</key><string>1</string>
  <key>BUNDLE_ID</key><string>${cfg.appId}</string>
  <key>PROJECT_ID</key><string>lab-placeholder</string>
  <key>STORAGE_BUCKET</key><string>lab-placeholder.appspot.com</string>
  <key>IS_GCM_ENABLED</key><true/>
  <key>IS_ANALYTICS_ENABLED</key><false/>
  <key>GOOGLE_APP_ID</key><string>1:000000000000:ios:0000000000000000000000</string>
</dict></plist>
`);
  return '자리표시';
}

// ── 아무 APK 가져오기(릴리즈 APK·Firebase 배포본·GCS 이력 사본) ────────────────
// 옆에 meta.json(CI lab 빌드가 함께 올린 것)이 있으면 그 정보(startUrl·gitSha·source)를 그대로 쓴다.
function sideMeta(p) {
  const m = join(dirname(p), 'meta.json');
  return existsSync(m) ? readJson(m) : null;
}

export function importApp(slug, appPath) {
  if (!IS_MAC) throw new Error('.app 가져오기는 macOS 에서만(시뮬레이터 설치는 맥에서 한다)');
  const info = join(appPath, 'Info.plist');
  const read = (k) => run('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, info]).out.trim();
  const side = sideMeta(appPath);
  return save({
    slug, version: read('CFBundleShortVersionString'), code: Number(read('CFBundleVersion')), appId: read('CFBundleIdentifier'),
    platform: 'ios', variant: 'debug', at: new Date().toISOString(), ...(side ?? {}),
    source: side ? `ci:${side.runId ?? '?'}` : `import:${basename(appPath)}`,
  }, [[appPath, 'App.app']]);
}

export function importApk(slug, apkPath, { variant } = {}) {
  if (apkPath.replace(/[\\/]$/, '').endsWith('.app')) return importApp(slug, apkPath.replace(/[\\/]$/, ''));
  const side = sideMeta(apkPath);
  const aapt = tool('aapt');
  const badging = aapt ? run(aapt, ['dump', 'badging', apkPath]).out : '';
  const version = badging.match(/versionName='([^']+)'/)?.[1];
  const code = Number(badging.match(/versionCode='(\d+)'/)?.[1]);
  const appId = badging.match(/package: name='([^']+)'/)?.[1];
  if (!version) throw new Error('APK 버전을 못 읽었다(aapt 필요 — build-tools 설치)');
  const debuggable = /application-debuggable/.test(badging);
  return save({
    slug, version, code, appId, platform: 'android', variant: variant ?? (debuggable ? 'debug' : 'release'),
    at: new Date().toISOString(), ...(side ?? {}),
    source: side ? `ci:${side.runId ?? '?'}` : `import:${basename(apkPath)}`,
  }, [[apkPath, 'app.apk']]);
}

// ── CI 아티팩트(device-lab.yml) ────────────────────────────────────────────
// 아티팩트 이름: lab-<slug>-<platform> (안에 meta.json + app.apk | App.app.zip)
export function fetchRun(slug, runId) {
  const tmp = join(tmpdir(), `lab-fetch-${runId}`);
  rmSync(tmp, { recursive: true, force: true });
  const got = [];
  for (const platform of ['android', 'ios']) {
    const name = `lab-${slug}-${platform}`;
    const r = run('gh', ['run', 'download', String(runId), '-n', name, '-D', join(tmp, platform)]);
    if (!r.ok) continue;
    const d = join(tmp, platform);
    const meta = readJson(join(d, 'meta.json'));
    if (platform === 'ios') {
      mustRun(IS_MAC ? 'ditto' : 'unzip', IS_MAC ? ['-x', '-k', join(d, 'App.app.zip'), d] : ['-q', join(d, 'App.app.zip'), '-d', d]);
      got.push(save({ ...meta, source: `ci:${runId}` }, [[join(d, 'App.app'), 'App.app']]));
    } else {
      got.push(save({ ...meta, source: `ci:${runId}` }, [[join(d, 'app.apk'), 'app.apk']]));
    }
  }
  if (!got.length) throw new Error(`런 ${runId} 에 lab-${slug}-* 아티팩트가 없다(만료 90일 또는 다른 slug)`);
  return got;
}

export function latestRunId(slug) {
  const r = mustRun('gh', ['run', 'list', '--workflow', 'device-lab.yml', '--status', 'success', '--limit', '20',
    '--json', 'databaseId,displayTitle,headBranch']);
  const runs = JSON.parse(r.out);
  const hit = runs.find((x) => x.displayTitle.includes(slug)) ?? runs[0];
  if (!hit) throw new Error('성공한 device-lab 런이 없다');
  return hit.databaseId;
}

export function sizeMb(p) {
  try { return (statSync(p).size / 1048576).toFixed(1); } catch { return '?'; }
}
