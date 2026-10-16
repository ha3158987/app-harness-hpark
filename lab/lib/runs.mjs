// 테스트 런 — 한 번의 테스트 세션(빌드 1개 × 기기 여러 대 × 시나리오 여러 개)의 증거를 한 폴더에 모은다.
//   lab/.runs/<runId>/run.json · results.jsonl · shots/<기기>/<시나리오>/<NN-단계>.png · report.html
// 에이전트는 lab run start 로 런을 열고, 조작하며 lab shot / lab verdict 로 남기고, lab report 로 닫는다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RUNS_DIR, stamp, readJson } from './env.mjs';

const CURRENT = join(RUNS_DIR, 'current');

export function start(info) {
  const id = `${stamp()}-${info.suite ?? 'adhoc'}`;
  const dir = join(RUNS_DIR, id);
  mkdirSync(join(dir, 'shots'), { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ id, startedAt: new Date().toISOString(), ...info }, null, 2));
  writeFileSync(CURRENT, id);
  return { id, dir };
}

export function current(id) {
  const rid = id ?? (existsSync(CURRENT) ? readFileSync(CURRENT, 'utf8').trim() : null);
  if (!rid) return null;
  const dir = join(RUNS_DIR, rid);
  return existsSync(dir) ? { id: rid, dir, ...readJson(join(dir, 'run.json')) } : null;
}

export function shotPath(run, device, scenario, step) {
  const d = join(run.dir, 'shots', device, scenario ?? '_');
  mkdirSync(d, { recursive: true });
  const n = readdirSync(d).filter((f) => f.endsWith('.png')).length + 1;
  const safe = String(step ?? 'shot').replace(/[^\w가-힣.-]+/g, '-').slice(0, 60);
  return join(d, `${String(n).padStart(2, '0')}-${safe}.png`);
}

// verdict: PASS | FAIL | BLOCKED(환경·데이터 탓으로 판정 불가) | SKIP(이 기기에 해당 없음)
export function record(run, entry) {
  const row = { at: new Date().toISOString(), ...entry };
  appendFileSync(join(run.dir, 'results.jsonl'), JSON.stringify(row) + '\n');
  return row;
}

export function results(run) {
  const f = join(run.dir, 'results.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Maestro JUnit: 실행 누락·도구 오류·건너뜀을 앱 테스트 통과로 세지 않는다.
// stale = { 플로우: [낡은 testData 키] }(lab preflight.data) — 그 플로우의 실패는 앱 결함이 아니라 BLOCKED 다.
export function maestroResults(junit, commandOk, stale = {}) {
  const cases = [...junit.matchAll(/<testcase\b([^>]*?)\/>|<testcase\b([^>]*?)>([\s\S]*?)<\/testcase>/g)]
    .map((m) => {
      const attrs = m[1] ?? m[2];
      const body = m[3] ?? '';
      return {
        name: attrs.match(/\bname="([^"]+)"/)?.[1],
        verdict: /<failure\b/.test(body) ? 'FAIL' : /<error\b/.test(body) ? 'BLOCKED' : /<skipped\b/.test(body) ? 'SKIP' : 'PASS',
        msg: body.match(/<(?:failure|error)\b[^>]*message="([^"]*)"/)?.[1] ?? body.match(/<(?:failure|error)\b[^>]*>([^<]*)/)?.[1]?.trim(),
      };
    }).filter((c) => c.name);
  for (const c of cases) {
    if (stale[c.name] && c.verdict !== 'PASS') Object.assign(c, { verdict: 'BLOCKED', stale: true, msg: `test data stale: ${stale[c.name].join(', ')} — ${c.msg ?? ''}` });
  }
  const real = cases.filter((c) => !c.stale);
  const executed = real.some((c) => c.verdict === 'PASS' || c.verdict === 'FAIL');
  // 낡은 데이터 플로우가 실패하면 Maestro 종료 코드도 실패다 — 그때는 나머지 결과로만 본다
  const toolOk = commandOk || real.length < cases.length;
  return { cases, ok: toolOk && (executed || (cases.length > 0 && !real.length)) && !real.some((c) => c.verdict === 'FAIL' || c.verdict === 'BLOCKED') };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 자기완결 HTML(이미지는 상대경로) — 폴더째 zip 하거나 CI 아티팩트로 올린다.
export function report(run, { scenarios = [], devices = [] } = {}) {
  const rows = results(run);
  // 같은 (기기, 시나리오, 상황)는 마지막 판정이 이긴다. 다른 상황의 실패를 덮지 않는다.
  const last = new Map();
  const key = (d, s, p) => JSON.stringify([d, s, p ?? '']);
  const anchor = (d, s, p) => [d, s, p ?? ''].map(encodeURIComponent).join('-');
  for (const r of rows) last.set(key(r.device, r.scenario, r.situations), r);
  const devIds = [...new Set([...devices.map((d) => d.id), ...rows.map((r) => r.device)])];
  const scIds = [...new Set([...scenarios.map((s) => s.id), ...rows.map((r) => r.scenario)])];
  const scTitle = Object.fromEntries(scenarios.map((s) => [s.id, s.title]));
  const devLabel = Object.fromEntries(devices.map((d) => [d.id, d.label]));
  const cases = scIds.flatMap((s) => {
    const presets = [...new Set(rows.filter((r) => r.scenario === s).map((r) => r.situations ?? ''))];
    return (presets.length ? presets : ['']).map((p) => ({ s, p }));
  });
  const count = (v) => [...last.values()].filter((r) => r.verdict === v).length;
  const cell = (d, s, p) => {
    const r = last.get(key(d, s, p));
    if (!r) return '<td class="none">—</td>';
    return `<td class="${r.verdict}"><a href="#${esc(anchor(d, s, p))}">${r.verdict}</a></td>`;
  };
  const shotsOf = (d, s) => {
    const dir = join(run.dir, 'shots', d, s);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => relative(run.dir, join(dir, f)).replace(/\\/g, '/'));
  };
  const details = [];
  for (const d of devIds) {
    for (const { s, p } of cases) {
      const r = last.get(key(d, s, p));
      const shots = shotsOf(d, s);
      if (!r && !shots.length) continue;
      details.push(`<section id="${esc(anchor(d, s, p))}"><h3><span class="tag ${r?.verdict ?? 'none'}">${r?.verdict ?? '기록 없음'}</span> ${esc(scTitle[s] ?? s)} · ${esc(devLabel[d] ?? d)}</h3>
${r?.note ? `<p class="note">${esc(r.note)}</p>` : ''}${r?.situations ? `<p class="meta">상황: ${esc(r.situations)}</p>` : ''}${r?.issues?.length ? `<ul class="issues">${r.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
<div class="shots">${shots.map((p) => `<figure><a href="${esc(p)}"><img loading="lazy" src="${esc(p)}"></a><figcaption>${esc(p.split('/').pop().replace(/\.png$/, ''))}</figcaption></figure>`).join('')}</div></section>`);
    }
  }
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>디바이스 랩 리포트 ${esc(run.id)}</title><style>
:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#e3e3e3;--pass:#127a3a;--fail:#c4122f;--blk:#9a6700;--skip:#777}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--mut:#aaa;--line:#333;--pass:#4cc27a;--fail:#ff6b81;--blk:#e0b04a;--skip:#999}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0 auto;max-width:1400px;padding:16px}
h1{font-size:20px}table{border-collapse:collapse;width:100%;overflow-x:auto;display:block}th,td{border:1px solid var(--line);padding:4px 8px;text-align:center;white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal}td.PASS a{color:var(--pass)}td.FAIL a{color:var(--fail);font-weight:700}td.BLOCKED a{color:var(--blk)}td.SKIP a,td.none{color:var(--skip)}
.tag{font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid currentColor}.tag.PASS{color:var(--pass)}.tag.FAIL{color:var(--fail)}.tag.BLOCKED{color:var(--blk)}.tag.SKIP,.tag.none{color:var(--skip)}
section{border-top:1px solid var(--line);margin-top:16px}.shots{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;width:180px}img{width:100%;border:1px solid var(--line);border-radius:6px}
figcaption{font-size:11px;color:var(--mut);word-break:break-all}.meta,.note{color:var(--mut)}.issues{color:var(--fail)}
</style></head><body>
<h1>디바이스 랩 리포트 — ${esc(run.suite ?? '')} ${esc(run.build ?? '')}</h1>
<p class="meta">런 ${esc(run.id)} · 시작 ${esc(run.startedAt)} · PASS ${count('PASS')} · FAIL ${count('FAIL')} · BLOCKED ${count('BLOCKED')} · SKIP ${count('SKIP')}</p>
<table><thead><tr><th>시나리오</th>${devIds.map((d) => `<th>${esc(devLabel[d] ?? d)}</th>`).join('')}</tr></thead><tbody>
${cases.map(({ s, p }) => `<tr><td>${esc(scTitle[s] ?? s)}<br><small class="meta">${esc(s)}${p ? ` · ${esc(p)}` : ''}</small></td>${devIds.map((d) => cell(d, s, p)).join('')}</tr>`).join('\n')}
</tbody></table>
${details.join('\n')}
</body></html>`;
  const out = join(run.dir, 'report.html');
  writeFileSync(out, html);
  return out;
}
