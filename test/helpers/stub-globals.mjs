// 브릿지는 브라우저 전역(fetch · location)을 직접 쓴다. Node 테스트에서 그 둘을 갈아끼운다.
// 각 테스트는 반드시 restore() 를 호출해 전역을 되돌린다 — 안 그러면 테스트 간 오염된다.

/**
 * @param {object} responseBody sessionEndpoint 가 돌려줄 JSON 바디
 * @param {{ ok?: boolean }} [opts] HTTP 성공 여부 (기본 true)
 * @returns {{ reloaded: () => boolean, requests: object[], restore: () => void }}
 */
export function stubGlobals(responseBody, opts = {}) {
  const origFetch = globalThis.fetch;
  const origLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');

  let reloadCalled = false;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: opts.ok !== false,
      json: async () => responseBody,
    };
  };
  Object.defineProperty(globalThis, 'location', {
    value: { reload: () => { reloadCalled = true; } },
    configurable: true,
    writable: true,
  });

  return {
    reloaded: () => reloadCalled,
    requests,
    restore() {
      globalThis.fetch = origFetch;
      if (origLocation) Object.defineProperty(globalThis, 'location', origLocation);
      else delete globalThis.location;
    },
  };
}
