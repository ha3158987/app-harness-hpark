// 디바이스 랩 설정 가드 — 기기 카탈로그·스위트(문구·변수·시나리오↔플로우)가 서로 어긋나지 않게.
// 어긋나면 CI 매트릭스가 '기기 없음'으로 통째로 빠지거나, 언어 프리셋에서 플로우가 ${L_X} 를 글자 그대로 찾다 실패한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LAB = join(import.meta.dirname, '..', 'lab');
const cat = JSON.parse(readFileSync(join(LAB, 'devices.json'), 'utf8'));
const all = [...cat.android.devices, ...cat.ios.devices];

test('기기 id 는 유일하고, 세트는 있는 기기만 가리킨다', () => {
  const ids = all.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, '중복 기기 id');
  for (const [name, set] of Object.entries(cat.sets)) {
    if (set === '*') continue;
    for (const id of set) assert.ok(ids.includes(id), `세트 ${name} 의 ${id} 가 카탈로그에 없다`);
  }
});

test('Android 기기는 api 와 (profile 또는 hw) 를, iOS 기기는 deviceType·runtime 을 갖는다', () => {
  for (const d of cat.android.devices) {
    assert.ok(d.api, `${d.id}: api`);
    assert.ok(d.profile || d.hw, `${d.id}: profile 또는 hw`);
  }
  for (const d of cat.ios.devices) assert.ok(d.deviceType && d.runtime, `${d.id}: deviceType·runtime`);
});

for (const suiteId of readdirSync(join(LAB, 'suites'))) {
  const dir = join(LAB, 'suites', suiteId);
  const suite = JSON.parse(readFileSync(join(dir, 'suite.json'), 'utf8'));
  const { scenarios } = JSON.parse(readFileSync(join(dir, 'scenarios.json'), 'utf8'));
  const locales = Object.keys(suite.labels).filter((k) => !k.startsWith('$'));
  const flows = readdirSync(join(dir, 'flows')).filter((f) => f.endsWith('.yaml'));

  test(`[${suiteId}] 모든 언어의 문구 키가 같다`, () => {
    const base = Object.keys(suite.labels[suite.defaultLocale]).sort();
    for (const l of locales) assert.deepEqual(Object.keys(suite.labels[l]).sort(), base, `${l} 문구 키`);
  });

  test(`[${suiteId}] 프리셋의 locale 은 문구가 있는 언어다`, () => {
    for (const [name, steps] of Object.entries(suite.presets)) {
      if (name.startsWith('$')) continue;
      for (const [s, arg] of steps) if (s === 'locale') assert.ok(locales.includes(arg), `${name}: ${arg}`);
    }
  });

  test(`[${suiteId}] 플로우가 쓰는 변수는 전부 정의돼 있다`, () => {
    const known = new Set([
      'APP_ID', 'PLATFORM',
      ...Object.keys(suite.testData),
      ...Object.keys(suite.labels[suite.defaultLocale]).map((k) => `L_${k}`),
      ...Object.keys(suite.deeplinks).filter((k) => !k.startsWith('$')).map((k) => `LINK_${k.replace(/-/g, '_').toUpperCase()}`),
    ]);
    for (const f of flows) {
      const text = readFileSync(join(dir, 'flows', f), 'utf8');
      for (const m of text.matchAll(/\$\{(\w+)\}/g)) assert.ok(known.has(m[1]), `${f}: \${${m[1]}} 미정의`);
      for (const m of text.matchAll(/runFlow:\s*(\S+\.yaml)/g)) assert.ok(existsSync(join(dir, 'flows', m[1])), `${f}: ${m[1]} 없음`);
    }
  });

  test(`[${suiteId}] 시나리오 id 유일 · flow 는 실제 파일 · devices 태그는 카탈로그에 있다`, () => {
    const ids = scenarios.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, '중복 시나리오 id');
    const tags = new Set(all.flatMap((d) => d.tags));
    for (const s of scenarios) {
      if (s.flow) assert.ok(flows.includes(`${s.flow}.yaml`), `${s.id}: flows/${s.flow}.yaml 없음`);
      for (const t of s.devices ?? []) assert.ok(tags.has(t), `${s.id}: 기기 태그 ${t} 를 가진 기기가 없다`);
      assert.ok(Array.isArray(s.expect) && s.expect.length, `${s.id}: expect`);
    }
  });

  test(`[${suiteId}] 실행 가능한 플로우(도우미 제외)는 name 이 파일명과 같다(리포트가 시나리오에 붙는 키)`, () => {
    for (const f of flows.filter((x) => !x.startsWith('_'))) {
      const name = readFileSync(join(dir, 'flows', f), 'utf8').match(/^name:\s*(\S+)/m)?.[1];
      assert.equal(name, f.replace(/\.yaml$/, ''), f);
    }
  });
}
