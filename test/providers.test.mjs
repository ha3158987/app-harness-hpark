import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** dist/index.js 의 OAUTH_PRESETS 에서 실제 https authorizeUrl 을 가진 provider 키를 뽑는다. */
function presetProviders() {
  const src = readFileSync(join(ROOT, 'template/bridge/dist/index.js'), 'utf8');
  const block = src.match(/const OAUTH_PRESETS = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'OAUTH_PRESETS 블록을 찾지 못했다');
  return [...block[1].matchAll(/^\s{2}'?([\w-]+)'?:\s*\{[^{}]*?authorizeUrl:\s*['"`]https:\/\//gm)].map((m) => m[1]);
}

/** dist/index.d.ts 의 AuthProvider union 멤버를 뽑는다. */
function typeProviders() {
  const src = readFileSync(join(ROOT, 'template/bridge/dist/index.d.ts'), 'utf8');
  const line = src.match(/export type AuthProvider =([^;]+);/);
  assert.ok(line, 'AuthProvider union 을 찾지 못했다');
  return [...line[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
}

/** config.mjs 의 KNOWN_AUTH_PROVIDERS 를 뽑는다. */
function knownProviders() {
  const src = readFileSync(join(ROOT, 'scripts/lib/config.mjs'), 'utf8');
  const line = src.match(/const KNOWN_AUTH_PROVIDERS = \[([^\]]+)\]/);
  assert.ok(line, 'KNOWN_AUTH_PROVIDERS 를 찾지 못했다');
  return [...line[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
}

test('허용목록과 타입 union 이 같은 집합이다', () => {
  assert.deepEqual(knownProviders().sort(), typeProviders().sort());
});

test('허용목록과 OAuth 프리셋이 양방향으로 맞는다', () => {
  // email 은 웹이 처리하므로 프리셋이 없다 — 비교에서 뺀다.
  const social = knownProviders().filter((p) => p !== 'email');
  const presets = presetProviders();
  const missing = social.filter((p) => !presets.includes(p));
  assert.deepEqual(missing, [], `프리셋 없는 provider: ${missing.join(', ')}`);
  // 반대 방향도 막는다 — 프리셋만 있고 허용목록에 없으면 config 가 err() 로 죽는다.
  const orphan = presets.filter((p) => !social.includes(p));
  assert.deepEqual(orphan, [], `허용목록에 없는 프리셋: ${orphan.join(', ')}`);
});

test('팝챗이 쓰는 8종이 세 곳 전부에 있다', () => {
  // 팝챗 = auth 가 지원하는 SNS 8종 전부 + email. threads 는 auth 미지원이라 빠진다.
  const 팝챗 = ['email', 'kakao', 'naver', 'line', 'google', 'apple', 'facebook', 'x', 'discord'];
  const known = knownProviders();
  const types = typeProviders();
  const presets = presetProviders();

  for (const p of 팝챗) {
    assert.ok(known.includes(p), `KNOWN_AUTH_PROVIDERS 에 ${p} 없음`);
    assert.ok(types.includes(p), `AuthProvider union 에 ${p} 없음`);
    if (p !== 'email') assert.ok(presets.includes(p), `OAUTH_PRESETS 에 ${p} 없음`);
  }
});

test('auth-setup 의 OAUTH_PRESET_PROVIDERS 가 브릿지 프리셋과 같다', () => {
  // 손으로 복제한 목록이라 drift 를 테스트로 막는다.
  // 상수는 scripts/lib/auth-setup.mjs 에 있다(generate-app.mjs 와 doctor.mjs 가 공유).
  // ★ 예전엔 못 찾으면 t.skip() 했다 — 상수가 파일을 옮기면 가드가 조용히 사라진다.
  //   이제 못 찾으면 실패다. 상수를 또 옮기면 이 경로도 같이 고쳐라.
  const src = readFileSync(join(ROOT, 'scripts/lib/auth-setup.mjs'), 'utf8');
  const block = src.match(/OAUTH_PRESET_PROVIDERS = \[([\s\S]*?)\]/);
  assert.ok(block, 'scripts/lib/auth-setup.mjs 에서 OAUTH_PRESET_PROVIDERS 를 찾지 못했다');
  const listed = [...block[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...listed].sort(), [...presetProviders()].sort());
});

test('threads 를 지우지 않았다', () => {
  // auth 가 지원하지 않아 팝챗은 안 쓰지만, 하네스 프리셋에는 남겨 둔다(다른 앱이 쓸 수 있다).
  assert.ok(knownProviders().includes('threads'), 'threads 가 사라졌다');
});
