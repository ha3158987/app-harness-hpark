// Maestro Android inputText does not support Unicode. Loopback-only adapter to the
// existing debug-WebView CDP input; never accepts arbitrary commands/evaluation.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import * as W from './web.mjs';

export async function startMaestroWeb({ insert, snapshot, searchResult }) {
  const token = randomUUID();
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== token) { res.writeHead(403).end(); return; }
    try {
      if (req.method === 'POST' && req.url === '/type') {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16_384) throw new Error('input too long');
          chunks.push(chunk);
        }
        const { text } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (typeof text !== 'string') throw new Error('text must be a string');
        await insert(text);
        res.end('{}');
      } else if (['GET', 'POST'].includes(req.method) && req.url === '/search-result') {
        res.end(JSON.stringify(await searchResult(req.method === 'POST')));
      } else if (req.method === 'GET' && req.url === '/snapshot') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(await snapshot()));
      } else res.writeHead(404).end();
    } catch (e) { res.writeHead(500).end(JSON.stringify({ error: e.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, token,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

// Separate process: the CLI runs Maestro synchronously, so its own event loop
// cannot serve requests while Maestro is executing a flow.
export async function maestroWebWorker(serial, pkg, expected = {}) {
  const worker = fork(fileURLToPath(import.meta.url), [serial, pkg, JSON.stringify(expected)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const info = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { worker.kill(); reject(new Error('WebView helper startup timed out')); }, 10_000);
    worker.once('error', (e) => { clearTimeout(timeout); reject(e); });
    worker.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`WebView helper exited (${code})`)); });
    worker.once('message', (message) => { clearTimeout(timeout); resolve(message); });
  });
  return { ...info, close: () => worker.kill() };
}

if (process.send) {
  const [serial, pkg, expectedJson] = process.argv.slice(2);
  const expected = JSON.parse(expectedJson);
  const helper = await startMaestroWeb({
    insert: (text) => W.insertText(serial, pkg, text),
    searchResult: async (click) => {
      const deadline = Date.now() + 20_000;
      do {
        const dom = await W.domElements(serial, pkg);
        const hit = dom.items.find(e => e.href && e.text.includes(expected.title)
          && new URL(e.href, 'https://local.invalid').pathname === `/detail/${expected.id}`);
        if (hit) {
          if (click) {
            const s = await W.session(serial, pkg);
            try {
              for (const type of ['mousePressed', 'mouseReleased']) {
                await s.send('Input.dispatchMouseEvent', { type, x: hit.cx, y: hit.cy, button: 'left', clickCount: 1 });
              }
            } finally { s.close(); }
          }
          return { visible: true, title: expected.title, path: `/detail/${expected.id}` };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      throw new Error('expected search result title and detail link are not visible');
    },
    // No tokens, query values, storage contents, user data or arbitrary DOM.
    snapshot: () => W.evaluate(serial, pkg, `({
      path: location.pathname,
      history: window.navigation?.entries().map(e => new URL(e.url).pathname),
      bridgeLaunchHandled: !!sessionStorage.getItem('__appbridge_launch_url'),
      webLaunchHandled: !!sessionStorage.getItem('pt_harness_launch_link'),
      launchShape: (() => { const raw = sessionStorage.getItem('pt_harness_launch_link'); if (!raw) return null; const u = new URL(raw); return {host:u.host,path:u.pathname,queryKeys:[...u.searchParams.keys()]}; })(),
      navigationTrail: (() => { try { return JSON.parse(sessionStorage.getItem('pt_nav_trail') || '[]').map(e => ({path: e.p.split('?')[0], document: e.d, entry: e.n})); } catch { return []; } })()
    })`),
  });
  process.on('disconnect', () => { helper.close().finally(() => process.exit()); });
  process.send({ url: helper.url, token: helper.token });
}
