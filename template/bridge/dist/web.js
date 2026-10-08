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

  // 브라우저에는 "앱 설정 페이지" 개념이 없다. SDK 가 isNative 로 먼저 걸러내지만,
  // 플러그인 프록시를 직접 쓰는 코드가 던지지 않도록 여기서도 조용히 실패시킨다.
  async openAppSettings() {
    return { opened: false, reason: 'not-native' };
  }

  // Viewer UX — the browser has no screen-capture block / device brightness control.
  // Silent no-ops so code that calls the plugin proxy directly (bypassing the isNative gate) never throws.
  async blockCapture() { return; }
  async setBrightness() { return; }
  async getBrightness() { return { value: -1 }; }

  // 브라우저에는 "앱을 받은 스토어" 가 없다 — countryCode 없이 돌려준다(SDK 는 null 로 읽는다).
  async getStoreCountry() { return { reason: 'not-native' }; }
}
