import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 소스 정규식이 아니라 실제 동작을 검증한다 — 게이트를 반대로 뒤집는 변경이
// 정규식 테스트는 통과시켰다(변이 테스트 5/7 생존).
const gen = (...extra) => spawnSync(
  process.execPath,
  [join(ROOT, 'scripts/generate-app.mjs'), '--slug', 'aipia',
   '--platform', 'android', '--skip-install', '--skip-sync', ...extra],
  { cwd: ROOT, encoding: 'utf8' },
);

test('--release 는 clientId 없는 앱의 릴리즈 빌드를 막는다', () => {
  const r = gen('--release');
  assert.equal(r.status, 1, `exit 1 이어야 한다 (실제 ${r.status})\n${r.stderr}`);
  assert.match(r.stderr, /clientId/, 'clientId 누락을 stderr 로 알려야 한다');
});

test('--release 없이는 같은 앱이 경고로 통과한다', (t) => {
  // dev 빌드는 build/aipia 를 만든다(gitignored) — 테스트 후 지운다.
  t.after(() => rmSync(join(ROOT, 'build/aipia'), { recursive: true, force: true }));
  const r = gen();
  assert.equal(r.status, 0, `dev 빌드는 통과해야 한다 (실제 ${r.status})\n${r.stderr}`);
});
