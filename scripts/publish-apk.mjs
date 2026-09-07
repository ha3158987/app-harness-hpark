#!/usr/bin/env node
// publish-apk.mjs — 테스트 배포용 APK 를 GCS 공개 버킷에 올리고 고정 링크를 뽑는다.
//   node scripts/publish-apk.mjs --slug characterchat-dev            # 이미 빌드된 APK 업로드
//   node scripts/publish-apk.mjs --slug characterchat-dev --build    # 빌드부터 업로드까지
//   node scripts/publish-apk.mjs --slug characterchat-dev --variant release
// 객체 경로가 고정(android/<slug>.apk)이라 같은 QR 을 계속 재사용할 수 있다.
// 스토어 배포용이 아니다 — 사내 테스트 설치 링크 전용.
import { existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Node 22+ 확보 -------------------------------------------------------
// 하네스는 engines.node >=22 인데 nvm default 가 20 인 환경이 있다. 20 에서는
// `npx cap sync` 가 메시지도 없이 죽는다(실측). nvm 에 22+ 가 있으면 그걸로 자기 자신을 재실행한다.
if (Number(process.versions.node.split('.')[0]) < 22 && !process.env.__APK_NODE_SWITCHED) {
  const nvmDir = join(process.env.HOME, '.nvm/versions/node');
  const best = existsSync(nvmDir)
    ? readdirSync(nvmDir)
        .filter((v) => Number(v.replace(/^v/, '').split('.')[0]) >= 22)
        .sort((a, b) => Number(b.replace(/^v/, '').split('.')[0]) - Number(a.replace(/^v/, '').split('.')[0]))[0]
    : null;
  if (!best) {
    console.error(`\n\x1b[31m✖ Node ${process.versions.node} — 하네스는 22 이상이 필요하다. \`nvm install 24 && nvm use 24\` 후 다시 실행.\x1b[0m`);
    process.exit(1);
  }
  const bin = join(nvmDir, best, 'bin');
  console.log(`  \x1b[33m⚠\x1b[0m Node ${process.versions.node} → ${best} 로 전환해 재실행`);
  try {
    execFileSync(join(bin, 'node'), [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, __APK_NODE_SWITCHED: '1', PATH: `${bin}:${process.env.PATH}` },
    });
  } catch (ex) {
    process.exit(ex.status ?? 1);   // 자식이 이미 이유를 출력했다 — 래퍼 스택으로 덮지 않는다.
  }
  process.exit(0);
}
// 자식(generate-app · npx cap sync)도 같은 Node 를 쓰게 한다.
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH}`;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const w = (m) => console.log(`  \x1b[33m⚠\x1b[0m ${m}`);
const head = (m) => console.log(`\n\x1b[36m\x1b[1m▶ ${m}\x1b[0m`);
const die = (m) => { console.error(`\n\x1b[31m✖ ${m}\x1b[0m`); process.exit(1); };

// --- 인자 ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? (argv[i + 1] ?? d) : d; };
const has = (n) => argv.includes(`--${n}`);

const slug = flag('slug');
if (!slug) die('--slug 필요. 예: node scripts/publish-apk.mjs --slug characterchat-dev');
const variant = flag('variant', 'debug');
if (!['debug', 'release'].includes(variant)) die(`--variant 는 debug|release (받은 값: ${variant})`);

const PROJECT = flag('project', process.env.APK_DIST_PROJECT || 'poptale-chat');
const BUCKET = flag('bucket', process.env.APK_DIST_BUCKET || 'chat-dev-poptale-dist');
const OBJECT = flag('name', `android/${slug}.apk`);
const URL = `https://storage.googleapis.com/${BUCKET}/${OBJECT}`;

// --- JDK 21 확보 -----------------------------------------------------------
// 비대화형 셸에는 JAVA_HOME 이 없어 gradlew 가 "Unable to locate a Java Runtime" 으로 죽는다(실측).
// 순서: 기존 JAVA_HOME → java_home -v 21 → Android Studio 번들 JBR(21).
function resolveJavaHome() {
  const cur = process.env.JAVA_HOME;
  if (cur && existsSync(join(cur, 'bin/java'))) return cur;
  try {
    const found = execFileSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found && existsSync(join(found, 'bin/java'))) return found;
  } catch {}
  const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  if (existsSync(join(jbr, 'bin/java'))) return jbr;
  return null;
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// --- 0. gcloud 확인 ------------------------------------------------------
head('사전 점검');
try { sh('gcloud', ['--version']); } catch { die('gcloud 미설치 — https://cloud.google.com/sdk/docs/install'); }
let account = '';
try { account = sh('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)']).trim(); } catch {}
if (!account) die('gcloud 로그인 안 됨 — `gcloud auth login` 먼저.');
ok(`gcloud 인증: ${account}`);

// --- 1. (선택) 빌드 ------------------------------------------------------
const appDir = join(ROOT, 'build', slug);
if (has('build')) {
  head(`빌드 (${slug} / ${variant})`);
  const javaHome = resolveJavaHome();
  if (!javaHome) die('JDK 21 을 못 찾았다 — Android Studio 를 설치했거나 `brew install openjdk@21` 후 JAVA_HOME 을 잡아라.');
  process.env.JAVA_HOME = javaHome;
  ok(`JAVA_HOME=${javaHome}`);
  if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    const sdkGuess = join(process.env.HOME, 'Library/Android/sdk');
    if (existsSync(sdkGuess)) { process.env.ANDROID_HOME = sdkGuess; ok(`ANDROID_HOME=${sdkGuess}`); }
  }
  // --platform android 가 중요하다: 기본값 both 는 macOS 에서 iOS pod install 까지 돌려
  // CocoaPods 문제로 APK 빌드가 통째로 죽는다(실측). generate-app 이 android sync 까지 해준다.
  const gen = ['scripts/generate-app.mjs', '--slug', slug, '--platform', 'android'];
  if (variant === 'release') gen.push('--release');
  sh('node', gen, { cwd: ROOT, stdio: 'inherit' });
  const task = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
  sh('./gradlew', [task], { cwd: join(appDir, 'android'), stdio: 'inherit' });
  ok(`gradle ${task} 완료`);
}

// --- 2. APK 찾기 ---------------------------------------------------------
head('APK');
const outDir = join(appDir, 'android/app/build/outputs/apk', variant);
if (!existsSync(outDir)) die(`빌드 산출물 없음: ${outDir}\n  → --build 를 붙이거나 build-android 스킬로 먼저 빌드해라.`);
const apks = readdirSync(outDir).filter((f) => f.endsWith('.apk'));
if (!apks.length) die(`APK 없음: ${outDir}`);
const apk = join(outDir, apks[0]);
const bytes = Number(sh('stat', ['-f', '%z', apk]).trim());
ok(`${apk.replace(ROOT + '/', '')} (${(bytes / 1024 / 1024).toFixed(1)}MB)`);

// 버전 표기는 있으면 좋고 없어도 그만 — aapt2 가 SDK 에 있을 때만.
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.HOME, 'Library/Android/sdk');
let version = '';
try {
  const bt = readdirSync(join(sdk, 'build-tools')).sort().reverse();
  const aapt2 = bt.map((v) => join(sdk, 'build-tools', v, 'aapt2')).find(existsSync);
  if (aapt2) {
    const dump = sh(aapt2, ['dump', 'badging', apk]);
    const name = dump.match(/versionName='([^']*)'/)?.[1];
    const code = dump.match(/versionCode='([^']*)'/)?.[1];
    if (name) { version = `${name} (code ${code})`; ok(`버전 ${version}`); }
  }
} catch {}

// --- 3. 버킷 준비 (없으면 생성 + 공개 읽기) --------------------------------
head(`버킷 gs://${BUCKET}`);
let exists = true;
try { sh('gcloud', ['storage', 'buckets', 'describe', `gs://${BUCKET}`, '--format=value(name)']); }
catch { exists = false; }
if (!exists) {
  w('버킷 없음 — 생성한다 (공개 읽기 버킷)');
  sh('gcloud', ['storage', 'buckets', 'create', `gs://${BUCKET}`, `--project=${PROJECT}`,
    '--location=asia-southeast1', '--uniform-bucket-level-access', '--no-public-access-prevention'], { stdio: 'inherit' });
  sh('gcloud', ['storage', 'buckets', 'add-iam-policy-binding', `gs://${BUCKET}`,
    '--member=allUsers', '--role=roles/storage.objectViewer']);
  ok('생성 + allUsers 읽기 권한 부여');
} else ok('존재 확인');

// --- 4. 업로드 -----------------------------------------------------------
// no-cache 가 핵심: 안 주면 같은 URL 에 새 APK 를 올려도 캐시된 옛 빌드가 내려간다.
head('업로드');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const archive = `android/archive/${slug}-${version ? version.split(' ')[0] + '-' : ''}${stamp}.apk`;
for (const dest of [OBJECT, archive]) {
  sh('gcloud', ['storage', 'cp', apk, `gs://${BUCKET}/${dest}`,
    '--content-type=application/vnd.android.package-archive',
    '--cache-control=no-cache, max-age=0'], { stdio: 'inherit' });
}
ok(`고정 링크 ${OBJECT}`);
ok(`이력 사본 ${archive}`);

// --- 5. 검증 -------------------------------------------------------------
head('검증');
const headers = sh('curl', ['-sI', URL]);
const status = headers.split('\n')[0].trim();
const len = Number(headers.match(/content-length: (\d+)/i)?.[1] ?? headers.match(/x-goog-stored-content-length: (\d+)/i)?.[1] ?? 0);
if (!/ 200/.test(status)) die(`공개 URL 이 200 이 아니다: ${status}`);
ok(`${status} · content-type ${headers.match(/content-type: (.*)/i)?.[1].trim()}`);
if (len && len !== bytes) w(`크기 불일치 (로컬 ${bytes} / 원격 ${len}) — CDN 캐시 지연일 수 있다`);
else ok(`크기 일치 ${bytes} bytes`);

// --- 6. 결과 -------------------------------------------------------------
console.log(`\n\x1b[1m설치 링크\x1b[0m  ${URL}`);
if (has('qr')) {
  // 링크가 고정이라 QR 도 한 번 만들면 계속 쓴다. ecc H = 인쇄/화면 훼손에 강함.
  const png = join(ROOT, `build/${slug}-apk-qr.png`);
  const svg = png.replace(/\.png$/, '.svg');
  try {
    sh('python3', ['-c',
      `import segno,sys;q=segno.make(sys.argv[1],error='h');q.save(sys.argv[2],scale=12,border=4);q.save(sys.argv[3],scale=12,border=4)`,
      URL, png, svg]);
    ok(`QR 저장: build/${slug}-apk-qr.png (+ .svg)`);
  } catch {
    try { sh('qrencode', ['-o', png, '-s', '10', '-l', 'H', URL]); ok(`QR 저장: build/${slug}-apk-qr.png`); }
    catch { w('QR 생성기 없음 — `pip3 install segno` 또는 `brew install qrencode`'); }
  }
}
