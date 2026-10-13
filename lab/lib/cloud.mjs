// 실기기 층 — Firebase Test Lab(FTL). 에뮬레이터가 흉내 못 내는 것: 실제 갤럭시의 성능(중급기 끊김)·One UI·
// 제조사 WebView·폴더블 하드웨어. Robo(자동 탐색)로 실행·크래시·스크린샷·영상·성능을 받는다.
//   ⚠ Robo 는 WebView 화면에서 접근성 요소가 적으면 무작위 입력으로 바뀐다 — 깊은 흐름 판정은 에뮬레이터 랩이 한다.
//   비용: Blaze 요금제 실기기 하루 30분 무료, 이후 $5/시간(분 단위). 기기 1대 × 5분이 기본.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IS_WIN, runScript } from './env.mjs';

// 카탈로그와 짝을 이루는 실기기(한국 판매 모델 우선: ksx). 목록: gcloud firebase test android models list
export const MODELS = {
  a36: { model: 'a36xq', version: '36', label: 'Galaxy A36 5G (중급기)' },
  a16: { model: 'a16x', version: '35', label: 'Galaxy A16 5G (보급기)' },
  s25: { model: 'pa1qksx', version: '36', label: 'Galaxy S25 (KR)' },
  s24: { model: 'e1q', version: '34', label: 'Galaxy S24 · Android 14' },
  flip6: { model: 'b6qksx', version: '36', label: 'Galaxy Z Flip6 (KR)' },
  fold6: { model: 'q6qksx', version: '36', label: 'Galaxy Z Fold6 (KR)' },
  flip4: { model: 'b4q', version: '33', label: 'Galaxy Z Flip4 · Android 13' },
  pixel9: { model: 'tokay', version: '36', label: 'Pixel 9' },
};

function gcloud() {
  const cands = [process.env.GCLOUD_BIN, IS_WIN ? 'C:\\dev\\gcloud\\google-cloud-sdk\\bin\\gcloud.cmd' : null, 'gcloud'].filter(Boolean);
  return cands[0];
}

export function runRobo({ apk, slug, models, locale = 'ko_KR', timeout = '300s', project }) {
  const proj = project ?? process.env.LAB_FTL_PROJECT ?? 'poptale-nonprod';
  const devs = models.map((m) => {
    const d = MODELS[m] ?? (m.includes('=') ? Object.fromEntries(m.split(',').map((kv) => kv.split('='))) : null);
    if (!d) throw new Error(`모르는 실기기 별칭: ${m} (${Object.keys(MODELS).join(', ')} 또는 model=…,version=…)`);
    return ['--device', `model=${d.model},version=${d.version},locale=${locale},orientation=portrait`];
  }).flat();
  const args = ['firebase', 'test', 'android', 'run', '--type', 'robo', '--app', apk,
    ...devs, '--timeout', timeout, '--results-history-name', `lab-${slug}`,
    '--client-details', `matrixLabel=device-lab ${slug}`, '--project', proj, '--format', 'json'];
  const r = runScript(gcloud(), args);
  // gcloud 는 진행·결과 링크를 stderr 로 낸다
  const text = `${r.out}\n${r.err}`;
  const console_ = text.match(/https:\/\/console\.firebase\.google\.com\/\S+/)?.[0] ?? null;
  // 'Raw results will be stored in your GCS bucket at [https://console.developers.google.com/storage/browser/<버킷>/<경로>/]'
  const raw = text.match(/storage\/browser\/([^\]\s]+)/)?.[1] ?? text.match(/gs:\/\/([\w.:/-]+)/)?.[1] ?? null;
  const bucket = raw ? `gs://${raw.replace(/\/$/, '')}` : null;
  let outcomes = [];
  try { outcomes = JSON.parse(r.out); } catch { /* 표 형식일 때 */ }
  return { ok: r.ok, code: r.code, console: console_, bucket, outcomes, tail: text.split(/\r?\n/).filter(Boolean).slice(-12) };
}

// 실기기 결과(스크린샷·영상·logcat)를 런 폴더로 — 기기별 폴더(<모델>-<API>-<로케일>-<방향>)째로
export function download(bucket, runDir) {
  const dest = join(runDir, 'cloud');
  mkdirSync(dest, { recursive: true });
  const r = runScript(gcloud(), ['storage', 'cp', '-r', `${bucket}/*`, dest]);
  return { ok: r.ok, dest, err: r.ok ? undefined : r.err.split(/\r?\n/).slice(-3).join(' ') };
}
