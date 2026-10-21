import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 소스 정규식이 아니라 실제 동작을 검증한다 — 게이트를 반대로 뒤집는 변경이
// 정규식 테스트는 통과시켰다(변이 테스트 5/7 생존).
const fixtureApp = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ah-config-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'template'), join(root, 'template'), { recursive: true });
  const suffix = randomBytes(4).toString('hex');
  const slug = `config-gate-${suffix}`;
  const appDir = join(root, 'apps', slug);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'app.config.json'), JSON.stringify({
    slug,
    appName: 'Config Gate',
    appId: `com.example.configgate${suffix}`,
    startUrl: 'https://example.com',
    auth: { providers: ['google'] },
  }));
  return { root, slug };
};

const gen = ({ root, slug }, ...extra) => spawnSync(
  process.execPath,
  [join(root, 'scripts/generate-app.mjs'), '--slug', slug,
   '--platform', 'android', '--skip-install', '--skip-sync', ...extra],
  { cwd: root, encoding: 'utf8' },
);

test('--release 는 clientId 없는 앱의 릴리즈 빌드를 막는다', (t) => {
  const r = gen(fixtureApp(t), '--release');
  assert.equal(r.status, 1, `exit 1 이어야 한다 (실제 ${r.status})\n${r.stderr}`);
  assert.match(r.stderr, /clientId/, 'clientId 누락을 stderr 로 알려야 한다');
});

test('--release 없이는 같은 앱이 경고로 통과한다', (t) => {
  const r = gen(fixtureApp(t));
  assert.equal(r.status, 0, `dev 빌드는 통과해야 한다 (실제 ${r.status})\n${r.stderr}`);
});
