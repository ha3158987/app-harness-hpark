// WebView 안을 Chrome DevTools 프로토콜(CDP)로 본다 — 디버그 빌드 전용.
//
// 왜 필요한가: 이 앱들은 화면 전부가 WebView 다. 접근성 트리·스크린샷만으로는
//   ① 한글 입력(adb input text 는 ASCII 만 된다), ② 현재 경로(URL), ③ 콘솔 오류·미처리 예외,
//   ④ 요소가 정말 화면 안에 있는지(넘침) 를 확정할 수 없다. CDP 는 이것들을 직접 준다.
// 릴리즈 빌드는 WebView 디버깅이 꺼져 있어 연결되지 않는다 — 그땐 화면·접근성만으로 판정한다.
import { adb, webviewPid } from './android.mjs';

const BASE_PORT = 9300;

function portFor(serial) {
  return BASE_PORT + (Number(serial.split('-')[1]) - 5554) / 2;
}

async function targets(serial, pkg) {
  const pid = webviewPid(serial, pkg);
  if (!pid) throw new Error(`${pkg} 프로세스가 없다 — 앱을 먼저 띄워라`);
  const port = portFor(serial);
  adb(serial, ['forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`]);
  const res = await fetch(`http://127.0.0.1:${port}/json`).catch(() => null);
  if (!res?.ok) throw new Error('WebView DevTools 에 연결하지 못했다 — 디버그 빌드인지 확인(릴리즈는 불가)');
  return (await res.json()).filter((t) => t.type === 'page');
}

// 가장 최근에 보이는 페이지(앱 WebView) 하나에 붙어 명령을 보낸다.
export async function session(serial, pkg) {
  const list = await targets(serial, pkg);
  const t = list.find((x) => x.attached !== false && !/^about:blank/.test(x.url)) ?? list[0];
  if (!t) throw new Error('WebView 페이지가 없다');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, no } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? no(new Error(msg.error.message)) : ok(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) => new Promise((ok, no) => {
    pending.set(++id, { ok, no });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    url: t.url,
    send,
    events,
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate 실패');
      return r.result.value;
    },
    close() { ws.close(); },
  };
}

export async function evaluate(serial, pkg, expr) {
  const s = await session(serial, pkg);
  try { return await s.eval(expr); } finally { s.close(); }
}

// 포커스된 입력칸에 유니코드 그대로 넣는다(IME 조합 이벤트 없이 input 이벤트가 난다).
export async function insertText(serial, pkg, text) {
  const s = await session(serial, pkg);
  try { await s.send('Input.insertText', { text }); } finally { s.close(); }
}

// 지금 화면 상태 요약 — 에이전트가 '어디에 있나'를 묻는 용도.
export async function state(serial, pkg) {
  return evaluate(serial, pkg, `(() => {
    const vw = innerWidth, vh = innerHeight;
    // 가로 레일(overflow-x 스크롤·숨김 컨테이너) 안의 카드는 의도된 넘침 — 조상 중 그런 컨테이너가 있으면 뺀다
    const clipped = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
    const over = [...document.querySelectorAll('body *')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed' && !clipped(e);
    }).slice(0, 5).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').slice(0,2).join('.') : ''));
    // 잘리거나 가려진 버튼·링크 — 페이지 넘침은 0 인데 헤더가 잘라내는 경우를 잡는다.
    // 가로 스크롤 줄(overflow-x auto/scroll) 밖으로 밀려난 항목은 '스크롤로 닿음'(scrolledOut)으로 따로 센다 —
    // 결함이 아니라 '더 있다는 표시가 있나'를 사람이 볼 대상이다. (10-06 에 이걸 '가려짐 — 탭 불가'로 오판했다.)
    const hidden = [];
    const scrolledOut = [];
    for (const e of document.querySelectorAll('header a, header button, nav a, nav button, [role=tab], footer a, footer button')) {
      const r = e.getBoundingClientRect();
      const st = getComputedStyle(e);
      if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
      const label = (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 30);
      // 가장 가까운 가로 클리핑 조상
      let clip = null;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX)) { clip = p; break; }
      }
      const scrollable = clip && /(auto|scroll)/.test(getComputedStyle(clip).overflowX) && clip.scrollWidth > clip.clientWidth + 1;
      if (clip) {
        const pr = clip.getBoundingClientRect();
        const outside = r.right > pr.right + 1 || r.left < pr.left - 1;
        if (outside && scrollable) { scrolledOut.push(label + ' — 스크롤 줄 밖(' + Math.round(r.left) + '~' + Math.round(r.right) + 'px, 줄 ' + Math.round(pr.left) + '~' + Math.round(pr.right) + ')'); continue; }
        if (outside) { hidden.push(label + ' — 잘림(' + Math.round(pr.right) + 'px 에서)'); continue; }
      }
      if (r.right > vw + 1 || r.left < -1) { hidden.push(label + ' — 화면 밖(' + Math.round(r.left) + '~' + Math.round(r.right) + 'px)'); continue; }
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && top !== e && !e.contains(top) && !top.contains(e)) hidden.push(label + ' — 가려짐(' + (top.getAttribute('aria-label') || top.tagName.toLowerCase()) + ')');
    }
    return {
      url: location.href,
      title: document.title,
      obscuredControls: [...new Set(hidden)].slice(0, 8),
      scrolledOutControls: [...new Set(scrolledOut)].slice(0, 8),
      lang: document.documentElement.lang,
      scheme: document.documentElement.dataset.colorScheme ?? null,
      viewport: { w: vw, h: vh, dpr: devicePixelRatio },
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
      overflowing: over,
      native: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
      safeArea: ['top','right','bottom','left'].map(k => getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-' + k).trim() || null),
      dialogs: document.querySelectorAll('[role=dialog]').length,
    };
  })()`);
}

// 화면에 보이는 상호작용 요소(링크·버튼·입력·탭) — CSS px 기준 사각형과 문구.
// uiautomator 는 WebView 안을 거의 못 본다(크로미움이 접근성 트리를 늦게·조건부로 만든다) — 그래서 DOM 에서 직접 뽑는다.
export async function domElements(serial, pkg) {
  return evaluate(serial, pkg, `(() => {
    const sel = 'a[href],button,input,textarea,select,[role=button],[role=tab],[role=link],[role=switch],[role=checkbox],[role=menuitem],[onclick],summary,label[for]';
    const vw = innerWidth, vh = innerHeight;
    const seen = new Set();
    const out = [];
    for (const e of document.querySelectorAll(sel)) {
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
      const st = getComputedStyle(e);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
      // 실제로 맨 위에 있는 요소인지(모달 뒤 요소 제외)
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== e && !e.contains(top) && !top.contains(e)) continue;
      const text = (e.getAttribute('aria-label') || e.innerText || e.value || e.placeholder || e.title || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
      const key = text + '|' + Math.round(cx) + '|' + Math.round(cy);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text, tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || undefined,
        href: e.getAttribute('href') || undefined, cx, cy, w: r.width, h: r.height });
    }
    return { dpr: devicePixelRatio, vw, vh, items: out };
  })()`);
}

// 콘솔 오류·미처리 예외를 ms 동안 모은다(이미 지나간 것은 못 본다 → 조작 직전에 켜 둔다).
export async function collectConsole(serial, pkg, ms = 5000) {
  const s = await session(serial, pkg);
  try {
    await s.send('Runtime.enable');
    await s.send('Log.enable');
    await new Promise((r) => setTimeout(r, ms));
    return s.events
      .filter((e) => (e.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(e.params.type))
        || e.method === 'Runtime.exceptionThrown'
        || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map((e) => {
        if (e.method === 'Runtime.exceptionThrown') return { level: 'exception', text: e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text };
        if (e.method === 'Log.entryAdded') return { level: 'error', text: `${e.params.entry.text} ${e.params.entry.url ?? ''}`.trim() };
        return { level: e.params.type, text: e.params.args.map((a) => a.value ?? a.description ?? '').join(' ') };
      });
  } finally { s.close(); }
}

export function unforward(serial) {
  return adb(serial, ['forward', '--remove', `tcp:${portFor(serial)}`]);
}
