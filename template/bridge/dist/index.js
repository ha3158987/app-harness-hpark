// @harness/bridge — 공유 JS 브릿지 SDK
//
// 설계 원칙 (STRATEGY/README):
//  - OS/기기 분기 로직은 여기(브릿지) 한 곳에만. 웹은 AppBridge.capabilities 로 피처 디텍션만.
//  - 앱이면 네이티브 호출, 브라우저면 안전한 폴백.
//  - 공식/커뮤니티 Capacitor 플러그인은 필요 시점에 동적 import (웹 번들이 비대해지지 않게).
//  - capability 와 메서드는 1:1 로 짝을 맞춘다. ready() 후 자가검증으로 불일치를 콘솔 경고.
import { Capacitor, registerPlugin } from '@capacitor/core';

const Native = registerPlugin('AppBridge', {
  web: () => import('./web.js').then((m) => new m.AppBridgeWeb()),
});

// features → capabilities 파생. 웹은 이 플래그만 보고 분기한다.
// 새 기능을 추가하면 (1) 여기 (2) 대응 메서드 (3) CAP_METHOD 매핑 세 곳을 같이 갱신.
function deriveCapabilities(features) {
  const f = features || {};
  const flag = (v) => !!(v === true || (v && typeof v === 'object' && v.enabled));
  return {
    push: flag(f.push),
    deepLink: flag(f.deepLink),
    deferredDeepLink: flag(f.deferredDeepLink),
    biometric: flag(f.biometric),
    share: flag(f.share),
    camera: flag(f.camera),
    forceUpdate: flag(f.forceUpdate),
    secureStorage: flag(f.secureStorage),
    localNotification: flag(f.localNotification),
    haptics: flag(f.haptics),
    clipboard: flag(f.clipboard),
    geolocation: flag(f.geolocation),
    auth: false, // config.auth.providers 로 ready() 에서 채움 (features 가 아니라 별도 블록)
  };
}

// 범용 OAuth2(시스템 브라우저) 공급자 프리셋. config.auth.oauth.<provider> 가 덮어쓴다.
// 비밀키(client secret)는 앱에 없음 — authorization code 를 백엔드가 교환(PKCE).
const OAUTH_PRESETS = {
  google:   { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', scopes: ['openid', 'email', 'profile'] },
  naver:    { authorizeUrl: 'https://nid.naver.com/oauth2.0/authorize', scopes: [] },
  kakao:    { authorizeUrl: 'https://kauth.kakao.com/oauth/authorize', scopes: [] },
  facebook: { authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth', scopes: ['public_profile', 'email'] },
  x:        { authorizeUrl: 'https://twitter.com/i/oauth2/authorize', scopes: ['tweet.read', 'users.read', 'offline.access'] },
  threads:  { authorizeUrl: 'https://threads.net/oauth/authorize', scopes: ['threads_basic'] },
  apple:    { authorizeUrl: 'https://appleid.apple.com/auth/authorize', scopes: ['name', 'email'] },
};

const NO_CAPS = deriveCapabilities({});

// capability → 그 기능을 쓰는 대표 메서드명. ready() 후 존재 여부를 검증한다(거짓 capability 방지).
const CAP_METHOD = {
  push: 'registerPush',
  deepLink: 'onDeepLink',
  deferredDeepLink: 'onDeepLink',
  biometric: 'authenticate',
  share: 'share',
  camera: 'takePhoto',
  forceUpdate: 'checkForceUpdate',
  secureStorage: 'secureSet',
  localNotification: 'scheduleNotification',
  haptics: 'haptic',
  clipboard: 'copyToClipboard',
  geolocation: 'getLocation',
  auth: 'login',
};

class AppBridgeImpl {
  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    this.platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
    this.config = null;
    this.capabilities = NO_CAPS;
    this._readyPromise = null;
    // 초기화된 마케팅 SDK 핸들들. track()/setUser() 가 켜진 것 전부에 분배한다.
    this._providers = {};        // { appsflyer: <plugin>, amplitude: ..., braze: ... }
    this._autoCaptureStarted = false;
    this._eventQueue = [];       // 초기화 전 track() 호출 버퍼
    this._deepLinkHandlers = []; // onDeepLink 로 등록된 라우팅 콜백들
    this._deepLinkStarted = false;
    this._lastDeepLink = null;   // 핸들러 등록 전에 도착한 딥링크 보관(콜드스타트 레이스 방지)
  }

  ready() {
    if (!this._readyPromise) {
      this._readyPromise = Native.getConfig()
        .then((cfg) => {
          this.config = cfg;
          this.capabilities = deriveCapabilities(cfg && cfg.features);
          const authProviders = (cfg && cfg.auth && cfg.auth.providers) || [];
          this.capabilities.auth = authProviders.length > 0;
          this._validateCapabilities();
          this._autoInit();
          return this.capabilities;
        })
        .catch(() => {
          this.capabilities = NO_CAPS;
          return NO_CAPS;
        });
    }
    return this._readyPromise;
  }

  // capability 가 켜졌는데 대응 메서드가 없으면 경고(향후 기능 추가 시 거짓 약속 방지).
  _validateCapabilities() {
    for (const [cap, on] of Object.entries(this.capabilities)) {
      if (on && typeof this[CAP_METHOD[cap]] !== 'function') {
        // eslint-disable-next-line no-console
        console.warn(`[AppBridge] capability "${cap}" 가 켜졌지만 구현 메서드(${CAP_METHOD[cap]})가 없습니다.`);
      }
    }
  }

  // config 로딩 직후 자동 배선: 딥링크 수신 시작 + 강제 업데이트 게이트.
  // "config 토글만 켜면 동작한다"를 보장하는 핵심(거짓 capability 해소).
  _autoInit() {
    if (!this.isNative) return;
    if (this.capabilities.deepLink) this._startDeepLinks();
    if (this.capabilities.forceUpdate) {
      // 비차단: 게이트는 자체 오버레이로 표시. 앱이 타이밍을 제어하려면 autoForceUpdate:false 후 직접 호출.
      this.checkForceUpdate().catch(() => {});
    }
  }

  // ── 공유 ───────────────────────────────────────────────────────────────
  async share(opts) {
    if (this.isNative && this.capabilities.share) {
      const { Share } = await import('@capacitor/share');
      await Share.share(opts);
      return;
    }
    // 웹 폴백: Web Share API → 클립보드
    if (navigator.share) {
      try { await navigator.share(opts); return; } catch { /* 취소 등 */ }
    }
    const text = [opts.title, opts.text, opts.url].filter(Boolean).join('\n');
    if (navigator.clipboard && text) await navigator.clipboard.writeText(text);
  }

  // ── 외부 링크 ──────────────────────────────────────────────────────────
  async openExternal(url, opts = {}) {
    const system = opts.system === true;
    if (this.isNative && !system) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    }
    if (this.isNative && system) {
      try {
        const { AppLauncher } = await import('@capacitor/app-launcher');
        await AppLauncher.openUrl({ url });
        return;
      } catch { /* app-launcher 미설치 → window.open 폴백 */ }
    }
    window.open(url, '_blank', 'noopener');
  }

  // ── 원격 푸시 ──────────────────────────────────────────────────────────
  async registerPush() {
    if (!this.isNative || !this.capabilities.push) return { granted: false };
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return { granted: false };
    return new Promise((resolve) => {
      const done = (token) => resolve({ granted: true, token });
      PushNotifications.addListener('registration', (t) => done(t.value));
      PushNotifications.addListener('registrationError', () => resolve({ granted: true }));
      PushNotifications.register();
    });
  }

  // ── 딥링크 / 유니버설·앱 링크 ──────────────────────────────────────────
  /**
   * 딥링크 라우팅 핸들러 등록. 직접 딥링크(appUrlOpen)와 디퍼드 딥링크(AppsFlyer)가
   * 같은 콜백으로 들어온다. 등록 전에 도착한 콜드스타트 딥링크도 즉시 전달한다.
   * @returns 등록 해제 함수
   */
  onDeepLink(handler) {
    if (typeof handler !== 'function') return () => {};
    this._deepLinkHandlers.push(handler);
    if (this.isNative && !this._deepLinkStarted) this._startDeepLinks();
    if (this._lastDeepLink) {
      try { handler(this._lastDeepLink.url, this._lastDeepLink.raw); } catch { /* noop */ }
    }
    return () => {
      const i = this._deepLinkHandlers.indexOf(handler);
      if (i >= 0) this._deepLinkHandlers.splice(i, 1);
    };
  }

  // appUrlOpen(유니버설/앱 링크) 수신을 시작. 내부에서 1회만 켜진다.
  _startDeepLinks() {
    if (!this.isNative || this._deepLinkStarted) return;
    this._deepLinkStarted = true;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appUrlOpen', (event) => {
        if (event && event.url) this._emitDeepLink(event.url, event);
      });
      // 콜드스타트로 열렸을 때(launchUrl)도 라우팅
      App.getLaunchUrl().then((res) => {
        if (res && res.url) this._emitDeepLink(res.url, res);
      }).catch(() => {});
    }).catch(() => {});
  }

  // 등록된 모든 핸들러로 딥링크 분배 + 동선 자동 기록.
  _emitDeepLink(url, raw) {
    this._lastDeepLink = { url, raw };
    this.track('deep_link_open', { url });
    for (const h of this._deepLinkHandlers) {
      try { h(url, raw); } catch { /* 한 핸들러 실패가 다른 핸들러를 막지 않게 */ }
    }
  }

  // ── 강제 업데이트 게이트 ────────────────────────────────────────────────
  /**
   * minVersionUrl 의 JSON 을 읽어 현재 versionCode 와 비교. 구버전이면 스토어 유도.
   * minVersion JSON 스키마(플랫폼별 우선, 없으면 최상위 폴백):
   *   { "ios":{"minVersionCode":5,"storeUrl":"...","message":"...","force":true},
   *     "android":{...}, "storeUrl":"...", "message":"..." }
   * force:false 면 닫을 수 있는 소프트 권유. 기본은 하드 게이트.
   * @returns {{ required:boolean, current?:number, min?:number, storeUrl?:string }}
   */
  async checkForceUpdate(opts = {}) {
    await this.ready();
    if (!this.isNative || !this.capabilities.forceUpdate) return { required: false };
    const url = this.config?.features?.forceUpdate?.minVersionUrl;
    if (!url) return { required: false };

    let data;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return { required: false };
      data = await res.json();
    } catch {
      return { required: false }; // 네트워크 실패로 사용자를 막지 않는다
    }

    const node = (data && data[this.platform]) || data || {};
    const min = Number(node.minVersionCode ?? data.minVersionCode ?? 0) || 0;
    const current = Number(this.config?.version?.code ?? 0) || 0;
    const storeUrl = node.storeUrl || data.storeUrl || this._defaultStoreUrl();
    const message = node.message || data.message || '원활한 이용을 위해 최신 버전으로 업데이트해 주세요.';
    const force = node.force !== false && data.force !== false;

    if (current >= min) return { required: false, current, min };

    if (opts.showPrompt !== false) {
      this._showUpdateGate({ message, storeUrl, dismissible: !force });
    }
    return { required: true, current, min, storeUrl };
  }

  // 플랫폼별 스토어 검색 폴백 URL(storeUrl 미지정 시).
  _defaultStoreUrl() {
    const id = this.config?.appId || '';
    if (this.platform === 'android') return `https://play.google.com/store/apps/details?id=${id}`;
    if (this.platform === 'ios') return `https://apps.apple.com/app/id${this.config?.marketing?.attribution?.appsflyer?.iosAppId || ''}`;
    return '';
  }

  // 전체화면 업데이트 오버레이(앱별 코드 없이 동작). 웹 컨텍스트의 DOM 에 주입.
  _showUpdateGate({ message, storeUrl, dismissible }) {
    if (document.getElementById('appbridge-update-gate')) return;
    const root = document.createElement('div');
    root.id = 'appbridge-update-gate';
    const bg = (this.config?.theme?.background) || '#FFFFFF';
    const primary = (this.config?.theme?.primary) || '#1A73E8';
    root.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      `background:${bg}`, 'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:20px',
      'padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom))',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif',
      'text-align:center', 'color:#202124',
    ].join(';'));
    const safe = (s) => String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    root.innerHTML =
      '<div style="font-size:20px;font-weight:700">업데이트가 필요해요</div>' +
      `<div style="font-size:15px;line-height:1.6;max-width:320px;color:#5f6368">${safe(message)}</div>` +
      `<button id="appbridge-update-btn" style="margin-top:8px;border:0;border-radius:12px;` +
      `background:${primary};color:#fff;font-size:16px;font-weight:600;padding:14px 28px;cursor:pointer">` +
      '업데이트 하기</button>' +
      (dismissible
        ? '<button id="appbridge-update-skip" style="border:0;background:none;color:#5f6368;font-size:14px;cursor:pointer">나중에</button>'
        : '');
    document.body.appendChild(root);
    document.getElementById('appbridge-update-btn').addEventListener('click', () => {
      if (storeUrl) this.openExternal(storeUrl, { system: true });
    });
    if (dismissible) {
      const skip = document.getElementById('appbridge-update-skip');
      if (skip) skip.addEventListener('click', () => root.remove());
    }
  }

  // ── 카메라 / 사진 ──────────────────────────────────────────────────────
  /**
   * 사진 촬영/선택. source: 'camera' | 'photos' | 'prompt'(기본).
   * resultType: 'dataUrl'(기본) | 'uri'. 반환: { dataUrl?, path?, format }.
   * 웹 폴백: <input type=file capture> 로 파일을 읽어 dataUrl 반환.
   */
  async takePhoto(opts = {}) {
    const source = opts.source || 'prompt';
    const resultType = opts.resultType || 'dataUrl';
    if (this.isNative && this.capabilities.camera) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const srcMap = { camera: CameraSource.Camera, photos: CameraSource.Photos, prompt: CameraSource.Prompt };
      const photo = await Camera.getPhoto({
        quality: opts.quality ?? 80,
        allowEditing: !!opts.allowEditing,
        resultType: resultType === 'uri' ? CameraResultType.Uri : CameraResultType.DataUrl,
        source: srcMap[source] || CameraSource.Prompt,
      });
      return { dataUrl: photo.dataUrl, path: photo.path || photo.webPath, format: photo.format };
    }
    // 웹 폴백
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (source === 'camera') input.capture = 'environment';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return reject(new Error('취소됨'));
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result, format: file.type.split('/')[1] || 'jpeg' });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  // ── 생체인증 ───────────────────────────────────────────────────────────
  /**
   * Face ID / 지문 인증. 성공 true / 실패·미지원 false.
   * @param opts.reason 사용자에게 보여줄 사유 문구
   */
  async authenticate(opts = {}) {
    if (!this.isNative || !this.capabilities.biometric) return { success: false, reason: 'unavailable' };
    let BiometricAuth;
    try { ({ BiometricAuth } = await import('@aparajita/capacitor-biometric-auth')); }
    catch { return { success: false, reason: 'plugin-missing' }; }
    try {
      const info = await BiometricAuth.checkBiometry();
      if (!info.isAvailable) return { success: false, reason: 'not-enrolled' };
      await BiometricAuth.authenticate({
        reason: opts.reason || '본인 확인이 필요합니다',
        cancelTitle: opts.cancelTitle || '취소',
        allowDeviceCredential: opts.allowDeviceCredential ?? true,
        iosFallbackTitle: opts.fallbackTitle || '비밀번호 사용',
        androidTitle: opts.title || '생체 인증',
        androidSubtitle: opts.subtitle || '',
      });
      return { success: true };
    } catch (e) {
      return { success: false, reason: (e && e.code) || 'failed' };
    }
  }

  // ── 시큐어 스토리지 (Keychain / Keystore) ──────────────────────────────
  // 토큰·세션 등 민감 데이터 전용. preferences(비암호화)와 구분.
  async secureSet(key, value) {
    if (this.isNative && this.capabilities.secureStorage) {
      try {
        const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
        await SecureStorage.set(key, value);
        return true;
      } catch { /* 플러그인 미설치 → 폴백 */ }
    }
    try { localStorage.setItem(`__sec_${key}`, JSON.stringify(value)); return true; } catch { return false; }
  }

  async secureGet(key) {
    if (this.isNative && this.capabilities.secureStorage) {
      try {
        const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
        return await SecureStorage.get(key);
      } catch { /* 폴백 */ }
    }
    try { const v = localStorage.getItem(`__sec_${key}`); return v == null ? null : JSON.parse(v); }
    catch { return null; }
  }

  async secureRemove(key) {
    if (this.isNative && this.capabilities.secureStorage) {
      try {
        const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
        await SecureStorage.remove(key);
        return true;
      } catch { /* 폴백 */ }
    }
    try { localStorage.removeItem(`__sec_${key}`); return true; } catch { return false; }
  }

  // ── 일반 환경설정 저장 (비암호화, base 플러그인) ────────────────────────
  async setPref(key, value) {
    if (this.isNative) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value: JSON.stringify(value) });
      return;
    }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
  }

  async getPref(key) {
    if (this.isNative) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      try { return value == null ? null : JSON.parse(value); } catch { return value; }
    }
    try { const v = localStorage.getItem(key); return v == null ? null : JSON.parse(v); } catch { return null; }
  }

  async removePref(key) {
    if (this.isNative) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    }
    try { localStorage.removeItem(key); } catch { /* noop */ }
  }

  // ── 로컬 알림 ──────────────────────────────────────────────────────────
  /**
   * 로컬 알림 예약. at(Date) 미지정이면 즉시. 반환: 알림 id.
   */
  async scheduleNotification(opts = {}) {
    if (!this.isNative || !this.capabilities.localNotification) return { scheduled: false };
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return { scheduled: false, reason: 'denied' };
    const id = Number.isInteger(opts.id) ? opts.id : (this._notifId = (this._notifId || 0) + 1);
    const notification = {
      id,
      title: opts.title || '',
      body: opts.body || '',
      ...(opts.at ? { schedule: { at: opts.at } } : {}),
      ...(opts.extra ? { extra: opts.extra } : {}),
    };
    await LocalNotifications.schedule({ notifications: [notification] });
    return { scheduled: true, id };
  }

  async cancelNotification(id) {
    if (!this.isNative || !this.capabilities.localNotification) return;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id }] });
  }

  // ── 햅틱 ───────────────────────────────────────────────────────────────
  /** style: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' */
  async haptic(style = 'medium') {
    if (this.isNative && this.capabilities.haptics) {
      try {
        const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
        const impact = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
        const notif = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error };
        if (impact[style]) await Haptics.impact({ style: impact[style] });
        else if (notif[style]) await Haptics.notification({ type: notif[style] });
        else await Haptics.impact({ style: ImpactStyle.Medium });
        return;
      } catch { /* 폴백 */ }
    }
    if (navigator.vibrate) navigator.vibrate(style === 'heavy' ? 40 : style === 'light' ? 10 : 20);
  }

  // ── 클립보드 ───────────────────────────────────────────────────────────
  async copyToClipboard(text) {
    if (this.isNative && this.capabilities.clipboard) {
      try {
        const { Clipboard } = await import('@capacitor/clipboard');
        await Clipboard.write({ string: String(text) });
        return true;
      } catch { /* 폴백 */ }
    }
    try { await navigator.clipboard.writeText(String(text)); return true; } catch { return false; }
  }

  async readClipboard() {
    if (this.isNative && this.capabilities.clipboard) {
      try {
        const { Clipboard } = await import('@capacitor/clipboard');
        const { value } = await Clipboard.read();
        return value;
      } catch { /* 폴백 */ }
    }
    try { return await navigator.clipboard.readText(); } catch { return ''; }
  }

  // ── 위치 ───────────────────────────────────────────────────────────────
  async getLocation(opts = {}) {
    if (this.isNative && this.capabilities.geolocation) {
      const { Geolocation } = await import('@capacitor/geolocation');
      let perm = await Geolocation.checkPermissions();
      if (perm.location === 'prompt') perm = await Geolocation.requestPermissions();
      if (perm.location !== 'granted') return null;
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: !!opts.highAccuracy });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    }
    if (navigator.geolocation) {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
          () => resolve(null),
          { enableHighAccuracy: !!opts.highAccuracy },
        );
      });
    }
    return null;
  }

  // ── 기기 정보 (base) ───────────────────────────────────────────────────
  async getDeviceInfo() {
    if (this.isNative) {
      const { Device } = await import('@capacitor/device');
      const [info, id] = await Promise.all([Device.getInfo(), Device.getId()]);
      return { ...info, id: id.identifier };
    }
    return { platform: 'web', operatingSystem: 'unknown', model: navigator.userAgent };
  }

  // ── 네트워크 (base) ─────────────────────────────────────────────────────
  async getNetworkStatus() {
    if (this.isNative) {
      const { Network } = await import('@capacitor/network');
      return await Network.getStatus();
    }
    return { connected: navigator.onLine, connectionType: 'unknown' };
  }

  /** 네트워크 변화 구독. @returns 해제 함수 */
  onNetworkChange(handler) {
    if (typeof handler !== 'function') return () => {};
    if (this.isNative) {
      let remove = () => {};
      import('@capacitor/network').then(({ Network }) => {
        Network.addListener('networkStatusChange', handler).then((h) => { remove = () => h.remove(); });
      }).catch(() => {});
      return () => remove();
    }
    const on = () => handler({ connected: true });
    const off = () => handler({ connected: false });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }

  // ── 키보드 (base) ───────────────────────────────────────────────────────
  /** 키보드 표시/숨김 이벤트. handler({ visible, height }). @returns 해제 함수 */
  onKeyboard(handler) {
    if (typeof handler !== 'function' || !this.isNative) return () => {};
    const removers = [];
    import('@capacitor/keyboard').then(({ Keyboard }) => {
      Keyboard.addListener('keyboardWillShow', (info) => handler({ visible: true, height: info.keyboardHeight }))
        .then((h) => removers.push(() => h.remove()));
      Keyboard.addListener('keyboardWillHide', () => handler({ visible: false, height: 0 }))
        .then((h) => removers.push(() => h.remove()));
    }).catch(() => {});
    return () => removers.forEach((r) => r());
  }

  // ── 인증 / SSO ─────────────────────────────────────────────────────────
  /**
   * 소셜/이메일 로그인. 핵심 원칙: 인증은 WebView 밖에서 한다(임베디드 webview 는
   * Google 등이 차단). 시스템 브라우저로 OAuth2(PKCE) → 딥링크로 복귀 → authorization
   * code 를 백엔드가 교환(secret 은 앱에 없음). Apple(iOS)은 네이티브 SDK 우선.
   *
   * 반환(웹이 백엔드로 보내거나, sessionEndpoint 설정 시 브릿지가 자동 전송):
   *   { ok, provider, authorizationCode?, codeVerifier?, redirectUri?, idToken?, user?, session? }
   * @param provider 'email'|'apple'|'google'|'naver'|'kakao'|'facebook'|'x'|'threads'
   */
  async login(provider, opts = {}) {
    await this.ready();
    const auth = (this.config && this.config.auth) || {};
    const providers = auth.providers || [];
    if (!providers.includes(provider)) return { ok: false, reason: 'provider-not-enabled' };
    if (provider === 'email') return { ok: false, reason: 'email-handled-by-web' }; // 웹이 직접 처리
    if (!this.isNative) return { ok: false, reason: 'web-should-redirect' };          // 브라우저는 일반 리다이렉트로

    // 1) 자격증명 획득. Apple/iOS 는 네이티브 우선(미설치/실패 시 범용 OAuth 폴백)
    let credential;
    if (provider === 'apple' && this.platform === 'ios') {
      credential = await this._appleNative(opts);
      if (!credential) credential = await this._oauth2(provider, opts);
    } else {
      credential = await this._oauth2(provider, opts);
    }
    if (!credential || !credential.ok) return credential || { ok: false, reason: 'login-failed' };

    // 2) 백엔드 세션 발급(sessionEndpoint 설정 시) — OAuth/Apple 경로 공통
    const result = await this._finishLogin(credential, opts);

    // 3) 다음에 "마지막 로그인 수단"으로 보여줄 수 있게 기기에 기록(재가입 방지 UX)
    if (result && result.ok !== false) { try { await this.setPref('last_login_provider', provider); } catch { /* noop */ } }
    return result;
  }

  /** 이 기기에서 마지막으로 성공한 로그인 수단. 로그인 화면에 "마지막 로그인: 카카오" 배지용. */
  async getLastLogin() {
    const provider = await this.getPref('last_login_provider');
    return provider ? { provider } : null;
  }

  // 기기 식별자 캐시 (백엔드 세션/기기 관리에 함께 보냄)
  async _deviceId() {
    if (this._devId !== undefined) return this._devId;
    try { const info = await this.getDeviceInfo(); this._devId = info.id || null; }
    catch { this._devId = null; }
    return this._devId;
  }

  /** 로그아웃: 시큐어 토큰 삭제 + (설정 시) 백엔드 세션 종료 + 새로고침 */
  async logout(opts = {}) {
    try { await this.secureRemove('auth_token'); } catch { /* noop */ }
    const endpoint = (this.config && this.config.auth && this.config.auth.logoutEndpoint) || opts.endpoint;
    if (endpoint) { try { await fetch(endpoint, { method: 'POST', credentials: 'include' }); } catch { /* noop */ } }
    if (opts.reload !== false && this.isNative) location.reload();
    return { ok: true };
  }

  // 범용 OAuth2 Authorization Code + PKCE (시스템 브라우저 + 딥링크 복귀)
  async _oauth2(provider, opts) {
    const auth = this.config.auth || {};
    const conf = (auth.oauth && auth.oauth[provider]) || {};
    const preset = OAUTH_PRESETS[provider] || {};
    const clientId = conf.clientId;
    const authorizeUrl = conf.authorizeUrl || preset.authorizeUrl;
    const redirectUri = conf.redirectUri || this._defaultRedirect(provider);
    const scopes = conf.scopes || preset.scopes || [];
    if (!clientId || !authorizeUrl) return { ok: false, reason: 'oauth-misconfigured', provider };

    const codeVerifier = this._randomString(64);
    const codeChallenge = await this._pkceChallenge(codeVerifier);
    const state = this._randomString(24);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    const url = `${authorizeUrl}?${params.toString()}${conf.extraQuery ? '&' + conf.extraQuery : ''}`;

    const res = await this._awaitOAuthRedirect(state, opts.timeoutMs || 180000, () =>
      this.openExternal(url, { system: true }));
    if (!res.ok) return { ok: false, reason: res.reason, provider };

    return { ok: true, provider, authorizationCode: res.code, codeVerifier, redirectUri, state };
  }

  // 딥링크 복귀를 state 로 매칭해 authorization code 를 회수. 시스템 브라우저는 닫는다.
  _awaitOAuthRedirect(state, timeoutMs, trigger) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; unsub(); clearTimeout(t); resolve(v); };
      const unsub = this.onDeepLink((url) => {
        let u; try { u = new URL(url); } catch { return; }
        const code = u.searchParams.get('code');
        const st = u.searchParams.get('state');
        const err = u.searchParams.get('error');
        if (!code && !err) return;          // 우리 OAuth 복귀가 아님
        if (state && st !== state) return;  // 다른 흐름의 복귀 — 무시
        import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => {});
        finish(err ? { ok: false, reason: `oauth-error:${err}` } : { ok: true, code });
      });
      const t = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
      Promise.resolve(trigger()).catch(() => finish({ ok: false, reason: 'open-failed' }));
    });
  }

  // Apple 네이티브 Sign in with Apple (플러그인 미설치 시 null → 범용 OAuth 폴백)
  async _appleNative(opts) {
    let SignInWithApple;
    try { ({ SignInWithApple } = await import('@capacitor-community/apple-sign-in')); }
    catch { return null; }
    const conf = (this.config.auth && this.config.auth.oauth && this.config.auth.oauth.apple) || {};
    try {
      const res = await SignInWithApple.authorize({
        clientId: conf.clientId || this.config.appId,
        redirectURI: conf.redirectUri || this._defaultRedirect('apple'),
        scopes: 'name email',
        state: this._randomString(16),
      });
      const r = res.response || {};
      return {
        ok: true, provider: 'apple', native: true,
        idToken: r.identityToken, authorizationCode: r.authorizationCode,
        user: { id: r.user, email: r.email, name: r.givenName && `${r.givenName} ${r.familyName || ''}`.trim() },
      };
    } catch { return null; }
  }

  // 로그인 마무리: sessionEndpoint 가 있으면 자격증명을 백엔드로 보내 세션쿠키 발급받음.
  // 백엔드가 신규 회원이라 추가정보/약관동의가 필요하다고 알리면(아래 플래그) 새로고침하지 않고
  // 그대로 반환 → 웹이 온보딩(약관+추가정보) 화면을 띄운다.
  //   백엔드 응답 플래그: { isNew, needsProfile, needsConsent, complete:false } 중 하나면 "미완료"
  async _finishLogin(credential, opts) {
    if (!credential || !credential.ok) return credential;
    const endpoint = (this.config.auth && this.config.auth.sessionEndpoint) || opts.sessionEndpoint;
    if (!endpoint) return credential; // 웹이 직접 백엔드로 전송
    try {
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credential, deviceId: await this._deviceId(), platform: this.platform }),
      });
      const data = (await res.json().catch(() => ({}))) || {};
      const incomplete = data.complete === false || !!data.isNew || !!data.needsProfile || !!data.needsConsent;
      if (res.ok && data.token) { try { await this.secureSet('auth_token', data.token); } catch { /* noop */ } }
      // 가입이 끝난 기존 회원만 새로고침. 신규(온보딩 필요)면 웹이 화면을 띄우게 둔다.
      if (res.ok && !incomplete && opts.reload !== false) location.reload();
      return {
        ...credential,
        session: res.ok,
        user: data.user || credential.user,
        isNew: !!data.isNew,
        needsProfile: !!(data.needsProfile || data.needsConsent),
        backend: data,
      };
    } catch {
      return { ...credential, session: false, reason: 'session-endpoint-failed' };
    }
  }

  /**
   * 회원가입 마무리. login() 이 needsProfile/isNew 를 반환한 신규 회원에 대해, 웹이 약관 동의 +
   * 추가정보를 수집한 뒤 이 한 줄로 백엔드에 확정 전송한다(이후 세션쿠키 발급 → 새로고침).
   * profile 예: { nickname, birth, consents: { tos:true, privacy:true, age14:true, marketing:false } }
   */
  async completeSignup(profile, opts = {}) {
    const endpoint = (this.config && this.config.auth && this.config.auth.signupEndpoint) || opts.endpoint;
    if (!endpoint) return { ok: false, reason: 'no-signup-endpoint' };
    try {
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(profile || {}), deviceId: await this._deviceId(), platform: this.platform }),
      });
      const data = (await res.json().catch(() => ({}))) || {};
      if (res.ok && data.token) { try { await this.secureSet('auth_token', data.token); } catch { /* noop */ } }
      if (res.ok && opts.reload !== false) location.reload();
      return { ok: res.ok, user: data.user, backend: data };
    } catch {
      return { ok: false, reason: 'signup-endpoint-failed' };
    }
  }

  _defaultRedirect(provider) {
    return `${(this.config && this.config.appId) || 'app'}://oauth/${provider}`;
  }

  // PKCE / state 용 난수 (Web Crypto — https origin = secure context 에서 동작)
  _randomString(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return this._base64url(bytes).slice(0, len);
  }

  async _pkceChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return this._base64url(new Uint8Array(digest));
  }

  _base64url(bytes) {
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ── 마케팅 SDK ─────────────────────────────────────────────────────────
  // 마케팅 SDK 초기화. 앱 시작 시 1회 호출. 키는 네이티브 베이크 config 에서 읽는다.
  // opts.onDeepLink(url, raw): 디퍼드/딥링크 도착 시 라우팅 콜백.
  async initMarketing(opts = {}) {
    await this.ready();
    // 전달된 onDeepLink 콜백은 통합 딥링크 핸들러로 등록(직접 딥링크와 동일 경로).
    if (typeof opts.onDeepLink === 'function') this.onDeepLink(opts.onDeepLink);

    const att = this.config && this.config.marketing && this.config.marketing.attribution;
    if (!this.isNative || !att || !att.provider) return { initialized: false };

    if (att.provider === 'appsflyer') {
      const af = att.appsflyer || {};
      if (!af.devKey) return { initialized: false, reason: 'no-devkey' };
      let AppsFlyer;
      try { ({ AppsFlyer } = await import('appsflyer-capacitor-plugin')); }
      catch { return { initialized: false, reason: 'plugin-missing' }; }
      await AppsFlyer.initSDK({
        appID: af.iosAppId || '',
        devKey: af.devKey,
        isDebug: !!opts.debug,
        waitForATTUserAuthorization: 10, // iOS ATT 동의 대기(초)
        registerOnDeepLink: true,
        registerConversionListener: true,
      });
      this._providers.appsflyer = AppsFlyer; // track()/setUser() 가 사용
      if (att.deferredDeepLink) {
        const route = (dl, res) => { if (dl) this._emitDeepLink(dl, res); };
        AppsFlyer.addListener('onDeepLink', (res) => {
          const d = res && res.deepLink;
          route(d && (d.deep_link_value || (d.click_event && d.click_event.deep_link_value)), res);
        });
        AppsFlyer.addListener('onConversionDataSuccess', (res) => {
          const d = res && res.data;
          if (d && (d.is_first_launch === true || d.is_first_launch === 'true')) {
            route(d.deep_link_value || d.af_dp, res);
          }
        });
      }
      this._afterInit(opts);
      return { initialized: true, provider: 'appsflyer' };
    }
    // 다른 벤더(branch/adjust/airbridge)는 아직 자동 배선 안 됨.
    return { initialized: false, reason: `provider-not-wired:${att.provider}` };
  }

  // 초기화 직후 공통 처리: 큐 비우기 + 자동 수집 시작.
  _afterInit(opts) {
    const q = this._eventQueue.splice(0);
    for (const [name, params] of q) this.track(name, params);
    const auto = this.config?.marketing?.autoCapture !== false;
    if (auto && (opts.autoCapture !== false)) this._startAutoCapture();
  }

  /**
   * 통합 이벤트 로깅. 켜진 모든 마케팅 SDK(AppsFlyer/분석/CRM)로 자동 분배.
   * 웹 서비스는 벤더를 몰라도 이 한 줄만 부르면 된다: AppBridge.track('purchase', { price: 9900 })
   */
  async track(event, params = {}) {
    if (!this.isNative) return; // 브라우저: no-op (원하면 여기서 dataLayer push 등 폴백 가능)
    // 아직 초기화 안 됐으면 큐잉
    if (Object.keys(this._providers).length === 0) {
      this._eventQueue.push([event, params]);
      return;
    }
    const af = this._providers.appsflyer;
    if (af) {
      try { await af.logEvent({ eventName: event, eventValue: params || {} }); }
      catch { /* 단일 벤더 실패가 전체를 막지 않게 */ }
    }
    // analytics/crm 벤더가 배선되면 여기에 동일 패턴으로 추가 (this._providers.amplitude 등)
  }

  /** 사용자 식별 — 켜진 벤더 전체에 동일 ID 적용 (크로스 디바이스/어트리뷰션 연결) */
  async setUser(userId, traits = {}) {
    if (!this.isNative) return;
    const af = this._providers.appsflyer;
    if (af) {
      try {
        if (userId) await af.setCustomerUserId({ cuid: String(userId) });
        if (traits && Object.keys(traits).length) await af.setAdditionalData({ additionalData: traits });
      } catch { /* noop */ }
    }
  }

  // 공통 동선 자동 수집: app_open + SPA 화면전환(screen_view) + 포그라운드 복귀.
  // 앱별 코드 없이 "어떤 화면을 봤는지" 동선이 자동으로 쌓인다.
  _startAutoCapture() {
    if (this._autoCaptureStarted) return;
    this._autoCaptureStarted = true;

    const screen = (path) => this.track('screen_view', { path: path || location.pathname + location.search });
    this.track('app_open', {});
    screen();

    // SPA 라우팅 감지: history API 패치 + popstate
    const wrap = (orig) => function (...a) {
      const r = orig.apply(this, a);
      try { window.dispatchEvent(new Event('__appbridge_locationchange')); } catch {}
      return r;
    };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    let last = location.pathname + location.search;
    const onChange = () => {
      const now = location.pathname + location.search;
      if (now !== last) { last = now; screen(now); }
    };
    window.addEventListener('popstate', onChange);
    window.addEventListener('__appbridge_locationchange', onChange);

    // 포그라운드 복귀 = 재방문 동선
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) this.track('app_foreground', {});
      });
    }).catch(() => {});
  }

  // ── 하드웨어 백버튼 ────────────────────────────────────────────────────
  onBackButton(handler) {
    if (!this.isNative) return () => {};
    let remove = () => {};
    import('@capacitor/app').then(({ App }) => {
      App.addListener('backButton', async ({ canGoBack }) => {
        const handled = await handler();
        if (handled) return;            // 웹이 처리함
        if (canGoBack) window.history.back();
        else App.exitApp();             // 더 갈 곳 없으면 종료 (백버튼 미처리 시 무음 종료 방지)
      }).then((h) => { remove = () => h.remove(); });
    });
    return () => remove();
  }
}

export const AppBridge = new AppBridgeImpl();
export default AppBridge;
