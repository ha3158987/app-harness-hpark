import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMaestroWeb } from '../lab/lib/maestro-web.mjs';

test('Maestro WebView helper inserts the exact Unicode text and reports CDP failures', async (t) => {
  const seen = [];
  const helper = await startMaestroWeb({
    insert: async (text) => { if (text === '실패') throw new Error('CDP unavailable'); seen.push(text); },
    snapshot: async () => ({ path: '/search' }),
  });
  t.after(() => helper.close());
  const call = (text) => fetch(helper.url + '/type', { method: 'POST', headers: { Authorization: helper.token }, body: JSON.stringify({ text }) });
  assert.equal((await call('작전명')).status, 200);
  assert.deepEqual(seen, ['작전명']);
  assert.equal((await call('실패')).status, 500);
  assert.equal((await fetch(helper.url + '/type', { method: 'POST', body: '{}' })).status, 403);
  assert.deepEqual(seen, ['작전명'], 'unauthorized requests must not type');
});

test('Maestro diagnostic helper exposes only the supplied snapshot', async (t) => {
  const helper = await startMaestroWeb({ insert: async () => {}, snapshot: async () => ({ path: '/viewer', launchHandled: true }) });
  t.after(() => helper.close());
  const response = await fetch(helper.url + '/snapshot', { headers: { Authorization: helper.token } });
  assert.deepEqual(await response.json(), { path: '/viewer', launchHandled: true });
  assert.equal((await fetch(helper.url + '/eval', { headers: { Authorization: helper.token } })).status, 404);
});

test('Unicode survives an HTTP chunk boundary inside a UTF-8 character', async (t) => {
  const { request } = await import('node:http');
  const seen = [];
  const helper = await startMaestroWeb({ insert: async (text) => seen.push(text), snapshot: async () => ({}) });
  t.after(() => helper.close());
  const body = Buffer.from(JSON.stringify({ text: '작전명' }));
  const split = body.indexOf(Buffer.from('작')) + 1;
  await new Promise((resolve, reject) => {
    const req = request(helper.url + '/type', { method: 'POST', headers: { Authorization: helper.token } }, (res) => {
      res.resume(); res.on('end', resolve);
    });
    req.on('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => req.end(body.subarray(split)), 20);
  });
  assert.deepEqual(seen, ['작전명']);
});

test('search-result check and click both fail when the expected visible link is absent', async (t) => {
  const actions = [];
  const helper = await startMaestroWeb({ insert: async () => {}, snapshot: async () => ({}),
    searchResult: async (click) => { actions.push(click); throw new Error('expected result is not visible'); } });
  t.after(() => helper.close());
  for (const method of ['GET', 'POST']) {
    const response = await fetch(helper.url + '/search-result', { method, headers: { Authorization: helper.token } });
    assert.equal(response.status, 500);
    assert.match(await response.text(), /not visible/);
  }
  assert.deepEqual(actions, [false, true]);
});
