(() => {
  const scene = document.getElementById('phone');
  let startedAt = 0;
  let ready = false;
  let finished = false;
  let holdTimer;
  let finishTimer;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const notify = (event) => {
    window.webkit?.messageHandlers?.popchatLaunch?.postMessage(event);
    window.PopchatLaunch?.event(event);
  };
  function finishWhenReady() {
    if (!ready || !startedAt || finished || finishTimer) return;
    finishTimer = setTimeout(() => {
      finished = true;
      clearTimeout(holdTimer);
      notify('finished');
    }, Math.max(0, (reduced ? 0 : 2020) - (performance.now() - startedAt)));
  }
  window.finishLaunch = () => { ready = true; finishWhenReady(); };
  Promise.all([
    document.fonts.ready,
    ...Array.from(document.images, img => img.decode().catch(() => {})),
  ]).then(() => {
    // Two painted frames preserve the approved still image before motion starts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      startedAt = performance.now();
      notify('painted');
      setTimeout(() => {
        scene.dataset.phase = reduced ? 'hold' : 'motion';
        holdTimer = setTimeout(() => { scene.dataset.phase = 'hold'; }, 1900);
      }, 120);
      finishWhenReady();
    }));
  });
})();
