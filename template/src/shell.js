// 오프라인 폴백 셸의 동작. 원격 로드가 실패해 이 로컬 화면이 떴을 때만 실행된다.
// 네트워크가 돌아오면 원격 startUrl 로 자동 복귀하고, 수동 재시도 버튼도 제공한다.
(function () {
  'use strict';
  var titleEl = document.getElementById('title');
  var msgEl = document.getElementById('msg');
  var retryEl = document.getElementById('retry');
  var spinnerEl = document.querySelector('.shell__spinner');

  function showOffline() {
    document.title = '오프라인';
    titleEl.textContent = '인터넷에 연결할 수 없어요';
    msgEl.textContent = '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
    spinnerEl.style.display = 'none';
    retryEl.hidden = false;
  }

  function loadRemote() {
    spinnerEl.style.display = '';
    retryEl.hidden = true;
    titleEl.textContent = '연결 중…';
    msgEl.textContent = '잠시만 기다려 주세요.';
    // app-config.json 에서 startUrl 을 모르는 셸이라도, 가장 안전한 복귀는
    // 캐시 무시 새로고침. server.url 환경에선 이게 원격을 다시 시도한다.
    fetch('app-config.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function () { window.location.reload(); });
  }

  retryEl.addEventListener('click', loadRemote);
  window.addEventListener('online', loadRemote);

  if (navigator.onLine === false) {
    showOffline();
  } else {
    // 온라인인데 이 화면이 떴다면 잠깐 뒤 복귀 시도
    setTimeout(loadRemote, 1200);
  }
})();
