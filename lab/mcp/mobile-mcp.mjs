#!/usr/bin/env node
// mobile-mcp 런처 — Claude Code 가 .mcp.json 으로 띄운다(윈도·맥 공용, npx 래퍼 불필요).
// 하는 일: 랩과 같은 SDK·ASCII 경로 환경을 잡아 주고, 텔레메트리를 끄고, 레포에 고정한 버전을 실행한다.
//   도구: mobile_list_available_devices · mobile_take_screenshot · mobile_list_elements_on_screen ·
//         mobile_click_on_screen_at_coordinates · mobile_swipe_on_screen · mobile_type_keys · mobile_press_button ·
//         mobile_launch_app · mobile_open_url · mobile_set_orientation · mobile_fold_device …
// 기기는 lab up 으로 먼저 띄운다(이 서버는 떠 있는 에뮬레이터/시뮬레이터를 찾을 뿐 만들지 않는다).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { androidEnv, androidSdk } from '../lib/env.mjs';

const require = createRequire(import.meta.url);
let entry;
try {
  entry = join(dirname(require.resolve('@mobilenext/mobile-mcp/package.json')), 'lib', 'index.js');
} catch {
  process.stderr.write('mobile-mcp 가 없다 — 레포 루트에서 npm ci 를 먼저 실행하라\n');
  process.exit(1);
}

const env = androidEnv();
const sdk = androidSdk();
if (sdk) env.PATH = [join(sdk, 'platform-tools'), join(sdk, 'emulator'), env.PATH ?? env.Path].join(delimiter);
env.MOBILEMCP_DISABLE_TELEMETRY = '1';

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
