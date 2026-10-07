// 오프라인 폴백 셸의 동작. 원격 웹이 네트워크 오류로 못 떴을 때 브릿지 플러그인이 이 화면을 띄운다
// (Android OfflineShellWebViewClient · iOS OfflineShellNavigationProxy — Capacitor errorPath 는 쓰지 않는다).
// 네이티브는 실패한 주소(from)와 시작 주소(home)를 쿼리로 넘긴다:
//   https://localhost/index.html?from=<실패 주소>&home=<server.url>   (iOS 는 capacitor://localhost/…)
// '다시 시도'·네트워크 복귀 때 from(없으면 home)으로 돌아간다 — 딥링크 목적지를 잃지 않는다.
(function () {
  'use strict';
  var titleEl = document.getElementById('title');
  var msgEl = document.getElementById('msg');
  var retryEl = document.getElementById('retry');
  var spinnerEl = document.querySelector('.shell__spinner');

  // 웹이 뜨기 전 화면이라 웹의 i18n 이 닿지 않는다 — 기기 언어로 한국어/영어만 고른다.
  var ko = /^ko\b/i.test(navigator.language || '');
  var T = ko
    ? {
        offlineTitle: '인터넷에 연결할 수 없어요',
        offlineMsg: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
        downTitle: '연결할 수 없어요',
        downMsg: '잠시 후 다시 시도해 주세요.',
        connecting: '연결 중…',
        wait: '잠시만 기다려 주세요.',
        retry: '다시 시도',
      }
    : {
        offlineTitle: 'No internet connection',
        offlineMsg: 'Check your network and try again.',
        downTitle: "Can't connect right now",
        downMsg: 'Please try again in a moment.',
        connecting: 'Connecting…',
        wait: 'Please wait a moment.',
        retry: 'Try again',
      };
  document.documentElement.lang = ko ? 'ko' : 'en';
  retryEl.textContent = T.retry;

  // http/https 만 받는다(javascript: 등은 버린다).
  function httpUrl(value) {
    if (!value) return null;
    try {
      var u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch (e) {
      return null;
    }
  }
  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
  var target = params ? (httpUrl(params.get('from')) || httpUrl(params.get('home'))) : null;

  function show(title, msg) {
    document.title = title;
    titleEl.textContent = title;
    msgEl.textContent = msg;
    spinnerEl.style.display = 'none';
    retryEl.hidden = false;
  }

  var leaving = false;
  function retry() {
    if (leaving) return;
    leaving = true;
    spinnerEl.style.display = '';
    retryEl.hidden = true;
    titleEl.textContent = T.connecting;
    msgEl.textContent = T.wait;
    // 원격으로 돌아간다. 또 실패하면 네이티브가 이 셸을 다시 띄운다.
    if (target) location.replace(target);
    else location.reload();
  }

  retryEl.addEventListener('click', retry);
  window.addEventListener('online', retry);

  if (navigator.onLine === false) {
    // 오프라인 — 네트워크가 돌아오면(online 이벤트) 자동 복귀
    show(T.offlineTitle, T.offlineMsg);
  } else {
    // 온라인인데 서버에 닿지 않았다(시간 초과·연결 거부·DNS) — 간격을 늘려 가며 자동 재시도.
    // 시도 횟수는 셸이 다시 떠도 이어지고(세션 저장소), 마지막 시도 뒤 2분이 지나면 처음 간격으로 돌아간다.
    show(T.downTitle, T.downMsg);
    if (target) {
      var KEY = 'harness-shell-attempt';
      var now = Date.now();
      var attempt = 0;
      try {
        var prev = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (prev && now - prev.t < 120000) attempt = prev.n + 1;
        sessionStorage.setItem(KEY, JSON.stringify({ n: attempt, t: now }));
      } catch (e) { /* 저장소 없음 — 매번 첫 간격 */ }
      var delay = Math.min(30000, 3000 * Math.pow(2, attempt)); // 3s → 6s → 12s → 24s → 30s…
      setTimeout(retry, delay);
    }
  }
})();
