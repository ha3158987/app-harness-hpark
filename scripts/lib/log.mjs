// 가벼운 콘솔 로거. 스킬이 출력 로그를 그대로 사용자에게 보여주므로 사람이 읽기 쉽게 유지.

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m',
};

export const log = {
  step: (m) => console.log(`${c.cyan}${c.bold}▶${c.reset} ${m}`),
  info: (m) => console.log(`  ${m}`),
  ok: (m) => console.log(`  ${c.green}✓${c.reset} ${m}`),
  warn: (m) => console.log(`  ${c.yellow}⚠${c.reset} ${m}`),
  dim: (m) => console.log(`  ${c.dim}${m}${c.reset}`),
};

export function fail(message) {
  console.error(`${c.red}${c.bold}✗ ${message}${c.reset}`);
  process.exit(1);
}
