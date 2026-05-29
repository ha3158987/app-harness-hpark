// AppBridge 플러그인의 웹(브라우저) 구현.
// 브라우저에서는 베이크된 네이티브 config 가 없으므로, 같은 origin 의 app-config.json 을
// 시도하고(셸이 로컬 서빙하는 경우), 실패하면 빈/디폴트 config 를 돌려준다.
import { WebPlugin } from '@capacitor/core';

export class AppBridgeWeb extends WebPlugin {
  async getConfig() {
    try {
      const res = await fetch('app-config.json', { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {
      /* 원격 origin 이라 없을 수 있음 — 무시 */
    }
    // 순수 브라우저 폴백: 모든 네이티브 기능 off
    return {
      slug: '', appName: document.title || '', appId: '',
      version: { name: '0.0.0', code: 0 },
      theme: { primary: '#1A73E8', statusBarStyle: 'dark', background: '#FFFFFF' },
      features: {},
      navigation: { allowedDomains: [], externalInBrowser: true },
    };
  }
}
