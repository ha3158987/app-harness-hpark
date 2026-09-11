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
// 인증 capability — "이 앱이 로그인·가입·탈퇴를 하는가". 두 형태가 있다:
//   · 네이티브 OAuth 앱: auth.providers 가 채워져 있다(login() 이 공급자와 직접 돈다)
//   · 브로커 앱: providers 는 비어 있고 auth.oauthReturnScheme 만 true 다(앱은 서비스 BE 의
//     start 를 인앱 브라우저로 열고 복귀 code 를 웹이 상환한다 — completeSignup/logout/
//     deleteAccount 는 그대로 쓴다). providers 만 보면 이 앱이 auth:false 로 나와 거짓 capability 다.
function deriveAuthCapability(auth) {
  const providers = (auth && auth.providers) || [];
  return providers.length > 0 || !!(auth && auth.oauthReturnScheme === true);
}

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
    iap: false,  // config.iap.products 로 ready() 에서 채움
    att: false,  // config.tracking.att.enabled 로 ready() 에서 채움 (iOS 전용)
  };
}

// 핸들러가 없을 때 도착한 딥링크를 보류하는 시간. 콜드스타트에서 웹 번들이 뜨고
// onDeepLink 가 걸릴 때까지를 덮을 만큼만 짧게 둔다 — 길면 한참 뒤의 로그인이
// 옛 OAuth code 를 받는다(그 code 는 이미 만료·소비돼 로그인이 실패한다).
const PENDING_DEEP_LINK_TTL_MS = 30_000;

// 범용 OAuth2(시스템 브라우저) 공급자 프리셋. config.auth.oauth.<provider> 가 덮어쓴다.
// 비밀키(client secret)는 앱에 없음 — authorization code 를 백엔드가 교환(PKCE).
const OAUTH_PRESETS = {
  google:   { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', scopes: ['openid', 'email', 'profile'] },
  naver:    { authorizeUrl: 'https://nid.naver.com/oauth2.0/authorize', scopes: [] },
  // TODO(G0-4): line · discord 의 authorizeUrl · scopes 는 auth 팀이 콘솔 등록값과 대조해 확정한다.
  //   지금 값은 각 사 공개 문서 기준 — 콘솔 확인 전까지 임의 확정하지 마라.
  line:     { authorizeUrl: 'https://access.line.me/oauth2/v2.1/authorize', scopes: ['profile', 'openid'] },
  discord:  { authorizeUrl: 'https://discord.com/oauth2/authorize', scopes: ['identify', 'email'] },
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
  iap: 'purchase',
  att: 'requestTracking',
};

class AppBridgeImpl {
  constructor() {
    this.isNative = Capacitor.isNativePlatform();
    this.platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
    this.config = null;
    this.capabilities = NO_CAPS;
    this._readyPromise = null;
    // 붙은 마케팅 벤더들. track()/setUser() 가 켜진 것 전부에 분배한다.
    // { <벤더명>: { adapter: <어댑터 정의>, handle: <벤더 SDK 핸들> } }
    this._providers = {};
    this._attResolvedAt = null;  // ATT 응답이 확정된 시각(ms). 어트리뷰션 init 대기 계산용.
    this._autoCaptureStarted = false;
    this._eventQueue = [];       // 초기화 전 track() 호출 버퍼
    this._deepLinkHandlers = []; // onDeepLink 로 등록된 라우팅 콜백들
    this._pushToken = null;      // 마지막으로 등록한 푸시 토큰(로그아웃 시 해제에 쓴다)
    this._deepLinkStarted = false;
    // 핸들러가 **하나도 없을 때** 도착한 딥링크만 보류한다(콜드스타트 레이스 방지).
    // ⚠️ 배달되면 즉시 버린다 — 남겨 두면 다음 onDeepLink 등록자에게 다시 배달돼
    //    이미 소비된 OAuth code 가 재생된다(아래 onDeepLink 주석).
    this._pendingDeepLink = null;
    // ATT: 시스템 팝업은 유저당 평생 1회만 뜬다(응답 후엔 notDetermined 로 못 돌아옴).
    // 호출부가 실수로 두 곳에서 요청하면 응답 타이밍이 엉켜 잘못된 값이 어트리뷰션 SDK 로 간다
    // (Poptale 실제 사례). 그래서 API 자체를 멱등하게 만든다 — 아래 2개가 그 상태다.
    this._rcPromise = null;      // Remote Config 초기화 1회 공유(fetchAndActivate 중복 방지)
    this._attStatus = null;      // 확정된 status 캐시. 'unavailable' 은 캐시하지 않는다(재시도 가능)
    this._attPending = null;     // 진행 중인 요청의 Promise (중복 팝업 차단)
  }

  ready() {
    if (!this._readyPromise) {
      this._readyPromise = Native.getConfig()
        .then((cfg) => {
          this.config = cfg;
          this.capabilities = deriveCapabilities(cfg && cfg.features);
          this.capabilities.auth = this._authCapability(cfg && cfg.auth);
          const iapProducts = (cfg && cfg.iap && cfg.iap.products) || [];
          this.capabilities.iap = iapProducts.length > 0;
          // ATT 는 iOS 전용. Android 에서 capability 를 켜두면 웹이 헛되이 사전화면을 띄운다.
          const attOn = !!(cfg && cfg.tracking && cfg.tracking.att && cfg.tracking.att.enabled);
          this.capabilities.att = attOn && this.platform === 'ios';
          this._validateCapabilities();
          this.initMonitoring().catch(() => {}); // 크래시 리포트 가능한 한 일찍
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

  // ready() 가 쓰는 인증 capability 판정. 메서드로 두는 이유는 테스트가 Native.getConfig()
  // 를 갈아끼울 수 없어 ready() 경로를 직접 태우지 못하기 때문이다(다른 _ 메서드와 같은 규약).
  _authCapability(auth) { return deriveAuthCapability(auth); }

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
    this._ensureViewportFit();
    if (this.capabilities.deepLink) this._startDeepLinks();
    if (this.capabilities.forceUpdate) {
      // 비차단: 게이트는 자체 오버레이로 표시. 앱이 타이밍을 제어하려면 autoForceUpdate:false 후 직접 호출.
      this.checkForceUpdate().catch(() => {});
    }
    // ATT 폴백 사전화면 — prePermission:false 인 앱에서만. 웹이 화면을 그리는 앱(기본)은 no-op.
    // 여기서 requestTracking() 을 직접 부르지 않는다는 점이 중요하다: 설명 없이 시스템 팝업을
    // 띄우면 그 유저는 영영 재요청이 불가해진다(iOS 는 notDetermined 일 때만 팝업).
    if (this.capabilities.att) this._maybeShowAttGate().catch(() => {});
  }

  // edge-to-edge(iOS contentInset:never / Android edge-to-edge)에서 env(safe-area-inset-*)가
  // 동작하려면 viewport meta에 viewport-fit=cover가 있어야 한다. 원격 웹이 이를 빠뜨려도 하네스가
  // 보장해, 앱마다 개별로 챙기지 않아도 env() 가 항상 동작하게 한다.
  // (var(--safe-area-inset-*)는 @capacitor-community/safe-area 가 별도 주입 — env/var 둘 다 되게.)
  _ensureViewportFit() {
    try {
      if (typeof document === 'undefined' || !document.head) return;
      const vp = document.querySelector('meta[name="viewport"]');
      if (vp) {
        if (!/viewport-fit\s*=/i.test(vp.content)) {
          vp.setAttribute('content', vp.content.trim().replace(/,\s*$/, '') + ', viewport-fit=cover');
        }
      } else {
        const m = document.createElement('meta');
        m.name = 'viewport';
        m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
        document.head.appendChild(m);
      }
    } catch { /* noop — 뷰포트 보장 실패해도 앱 동작엔 지장 없음 */ }
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
    // 푸시 탭 → 딥링크 라우팅: data.url | data.deep_link | data.deep_link_value 를 통합 딥링크로.
    if (!this._pushRoutingSet) {
      this._pushRoutingSet = true;
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const d = (action && action.notification && action.notification.data) || {};
        const url = d.url || d.deep_link || d.deep_link_value;
        if (url) this._emitDeepLink(url, action);
      });
    }
    return new Promise((resolve) => {
      const done = (token) => { if (token) this._registerDeviceToken(token); resolve({ granted: true, token }); };

      if (this.platform === 'ios') {
        // iOS: Firebase 스위즐링이 APNs 등록 콜백을 가로채 @capacitor/push-notifications 의
        //   'registration' 이벤트가 안 뜨는 경우가 있다(실기기 확인). 그 이벤트를 기다리면 hang.
        //   → register() 로 APNs 등록만 트리거하고, FCM 토큰은 @capacitor-community/fcm 으로
        //   직접 취득한다(APNs 토큰이 Firebase Messaging 에 셋될 때까지 재시도). FCM 토큰이 BE 규약.
        PushNotifications.addListener('registrationError', () => resolve({ granted: true }));
        PushNotifications.register();
        (async () => {
          let FCM;
          try { ({ FCM } = await import('@capacitor-community/fcm')); }
          catch { return resolve({ granted: true }); } // 플러그인 미설치 → 토큰 없이 종료(hang 방지)
          // APNs 토큰이 Firebase Messaging 에 붙고 Firebase Installations 등록이 끝날 때까지 대기한다.
          //   ⚠️ 짧은 간격으로 두드리면 FIS 가 'Too many server requests'(Code=2) 로 rate-limit 걸어
          //   영영 실패한다(실기기 확인). 그래서 백오프하며, 신규 설치 직후 APNs 준비에 수 초~수십 초가
          //   걸릴 수 있으므로 총 ~40초까지 기다린다.
          //   ⚠️⚠️ 한 번 FIS rate-limit 에 걸린 FID 는 앱을 지우고 재설치해도 안 풀린다(iOS 키체인에
          //   FID 가 잔존해 같은 ID 를 재사용 → 같은 throttle). 이때는 FCM.deleteInstance()
          //   = Installations.delete() 로 키체인의 FID 를 삭제하면 새 FID 가 발급돼 throttle 과
          //   무관해진다. 초기 몇 번의 실패는 'APNs 미준비'일 수도 있으므로 충분히 기다린 뒤
          //   (연속 3회 실패 ≈ 8s+) 1회만 초기화하고, 새 FID 로 남은 시도를 이어간다.
          const delays = [1500, 2500, 4000, 6000, 8000, 8000, 8000, 8000]; // 총 ~46s
          let didReset = false, fails = 0;
          for (let i = 0; i < delays.length; i++) {
            await new Promise((r) => setTimeout(r, delays[i]));
            try {
              const { token } = await FCM.getToken();
              if (token) return done(token);
            } catch {
              // 아직 준비 전(APNs 미셋 / FIS 등록중)이거나 stuck FID(throttle). 후자는 초기화로 복구.
              fails++;
              if (!didReset && fails >= 3) {
                didReset = true;
                try { await FCM.deleteInstance(); } catch { /* delete 도 throttle 일 수 있음 — 무시 */ }
                await new Promise((r) => setTimeout(r, 2000)); // 새 FID 생성 여유
              }
            }
          }
          resolve({ granted: true });                   // 타임아웃 — 토큰 못 받아도 hang 은 방지
        })();
        return;
      }

      // Android: registration 토큰이 곧 FCM 토큰.
      PushNotifications.addListener('registration', (t) => done(t.value));
      PushNotifications.addListener('registrationError', () => resolve({ granted: true }));
      PushNotifications.register();
    });
  }

  // ── 딥링크 / 유니버설·앱 링크 ──────────────────────────────────────────
  /**
   * 딥링크 라우팅 핸들러 등록. 직접 딥링크(appUrlOpen)와 디퍼드 딥링크(AppsFlyer)가
   * 같은 콜백으로 들어온다. **핸들러가 없을 때 도착한** 콜드스타트 딥링크는 보류분으로
   * 남아 있다가 첫 등록자에게 1회 전달된다.
   *
   * ⚠️ **보류분은 1회만 배달한다.** 예전에는 마지막 딥링크를 영구 보관하며 새로 등록되는
   *    모든 핸들러에게 다시 넘겼다. 그러면 OAuth 복귀를 딥링크로 기다리는 로그인
   *    (브로커 로그인)에서 **다음 로그인 시도가 이전 시도의 `?code=` 를 즉시 받는다** —
   *    그 code 는 일회용이라 상환이 실패하고, 그동안 브라우저는 열려서 새 code 를
   *    보류분에 채운다. 그래서 "첫 시도 실패 → 두 번째 성공" 이 무한 교대로 반복된다.
   *    보류분에 수명(TTL)도 둔다 — 앱을 오래 켜 둔 뒤의 로그인이 옛 링크를 받지 않게.
   * @returns 등록 해제 함수
   */
  onDeepLink(handler) {
    if (typeof handler !== 'function') return () => {};
    this._deepLinkHandlers.push(handler);
    if (this.isNative && !this._deepLinkStarted) this._startDeepLinks();
    const pending = this._pendingDeepLink;
    if (pending) {
      this._pendingDeepLink = null; // 신선하든 아니든 여기서 소비한다(재생 금지)
      if (Date.now() - pending.at <= PENDING_DEEP_LINK_TTL_MS) {
        try { handler(pending.url, pending.raw); } catch { /* noop */ }
      }
    }
    return () => {
      const i = this._deepLinkHandlers.indexOf(handler);
      if (i >= 0) this._deepLinkHandlers.splice(i, 1);
    };
  }

  /**
   * 보류 중인 딥링크를 버린다. 로그아웃·탈퇴처럼 "이전 세션의 흔적을 남기면 안 되는"
   * 시점에 호출한다(brdige 내부에서도 logout/deleteAccount 가 호출한다).
   */
  clearPendingDeepLink() {
    this._pendingDeepLink = null;
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
  // 핸들러가 없으면 보류분으로 남긴다 — 있으면 배달로 끝이고 보관하지 않는다.
  _emitDeepLink(url, raw) {
    this.track('deep_link_open', { url });
    const handlers = this._deepLinkHandlers.slice(); // 배달 중 등록/해제에 안전하게
    if (!handlers.length) {
      this._pendingDeepLink = { url, raw, at: Date.now() };
      return;
    }
    this._pendingDeepLink = null;
    for (const h of handlers) {
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
  // ── Firebase Remote Config ────────────────────────────────────────────
  // 앱 재배포 없이 콘솔에서 값을 바꾸기 위한 것. 강제 업데이트의 1차 소스로 쓰지만
  // 전용은 아니다 — getRemoteConfig(key) 로 임의 값도 읽는다(기능 토글·A/B 등).
  //
  // ⚠️ **캐시 지연이 있다.** fetchAndActivate 는 minimumFetchInterval 안에는 서버를 다시 찌르지
  // 않는다. 콘솔에서 눌러도 최대 그만큼 늦게 반영된다 — 긴급 차단을 RC 에만 의존하면 안 된다.
  async _initRemoteConfig() {
    if (this._rcPromise) return this._rcPromise;
    const fb = this.config && this.config.firebase;
    if (!this.isNative || !fb || !fb.enabled || !fb.remoteConfig) {
      this._rcPromise = Promise.resolve(null);
      return this._rcPromise;
    }
    this._rcPromise = (async () => {
      try {
        const { FirebaseRemoteConfig } = await import('@capacitor-firebase/remote-config');
        const secs = Number(fb.remoteConfigFetchIntervalSeconds);
        await FirebaseRemoteConfig.setSettings({
          minimumFetchIntervalInSeconds: Number.isFinite(secs) && secs >= 0 ? secs : 3600,
        });
        await FirebaseRemoteConfig.fetchAndActivate();
        return FirebaseRemoteConfig;
      } catch {
        // 플러그인 미설치·Firebase 파일 누락·네트워크 실패 — 어느 쪽이든 폴백으로 넘긴다.
        return null;
      }
    })();
    return this._rcPromise;
  }

  /**
   * Remote Config 값 읽기. RC 를 못 쓰면 null.
   * @param {string} key
   * @param {'string'|'number'|'boolean'} [type]
   */
  async getRemoteConfig(key, type = 'string') {
    const rc = await this._initRemoteConfig();
    if (!rc) return null;
    try {
      if (type === 'number') return (await rc.getNumber({ key })).value;
      if (type === 'boolean') return (await rc.getBoolean({ key })).value;
      const { value } = await rc.getString({ key });
      return value === '' ? null : value;
    } catch {
      return null;
    }
  }

  // RC 에서 최소버전 정보를 읽는다. 값이 없으면(=콘솔에 키가 없거나 0) null 을 돌려 폴백으로 넘긴다.
  // 플랫폼별 키를 나눈 이유: RC 조건(condition)으로도 분기할 수 있지만, 키를 나누면 콘솔에서
  // 값이 눈에 보여 운영 실수가 줄고 브릿지 로직도 단순해진다.
  async _forceUpdateFromRemoteConfig() {
    const rc = await this._initRemoteConfig();
    if (!rc) return null;
    const suffix = this.platform === 'ios' ? 'ios' : 'android';
    const min = await this.getRemoteConfig(`min_version_code_${suffix}`, 'number');
    if (!min) return null; // 미설정(0) → RC 는 의견 없음 → 폴백
    return {
      min: Number(min) || 0,
      storeUrl: await this.getRemoteConfig(`store_url_${suffix}`),
      message: await this.getRemoteConfig('force_update_message'),
      force: (await this.getRemoteConfig('force_update_hard', 'boolean')) !== false,
      source: 'remoteConfig',
    };
  }

  // 정적 JSON 폴백. 플랫폼별 노드 우선, 없으면 최상위.
  async _forceUpdateFromUrl() {
    const url = this.config?.features?.forceUpdate?.minVersionUrl;
    if (!url) return null;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const node = (data && data[this.platform]) || data || {};
      const min = Number(node.minVersionCode ?? data.minVersionCode ?? 0) || 0;
      if (!min) return null;
      return {
        min,
        storeUrl: node.storeUrl || data.storeUrl || null,
        message: node.message || data.message || null,
        force: node.force !== false && data.force !== false,
        source: 'url',
      };
    } catch {
      return null; // 네트워크 실패로 사용자를 막지 않는다
    }
  }

  /**
   * 강제 업데이트 체크. **RC → URL → 통과** 순으로 해석한다.
   *
   * 마지막이 "통과"인 것(fail-open)은 의도된 정책이다: 값을 못 읽었다고 사용자를 막으면
   * 호스팅 장애가 곧 전체 앱 장애가 된다. 보안 패치를 강제해야 하는 상황이라면 클라이언트
   * 게이트가 아니라 **서버가 구버전 요청을 거부**하는 방식이 맞다.
   */
  async checkForceUpdate(opts = {}) {
    await this.ready();
    if (!this.isNative || !this.capabilities.forceUpdate) return { required: false };

    const src = this.config?.features?.forceUpdate?.source;
    let info = null;
    if (src === 'remoteConfig') info = await this._forceUpdateFromRemoteConfig();
    if (!info) info = await this._forceUpdateFromUrl();
    if (!info) return { required: false }; // fail-open

    const current = Number(this.config?.version?.code ?? 0) || 0;
    if (current >= info.min) return { required: false, current, min: info.min, source: info.source };

    const storeUrl = info.storeUrl || this._defaultStoreUrl();
    const message = info.message || '원활한 이용을 위해\n최신 버전으로 업데이트해 주세요.';
    if (opts.showPrompt !== false) {
      this._showUpdateGate({ message, storeUrl, dismissible: !info.force });
    }
    return { required: true, current, min: info.min, storeUrl, source: info.source };
  }

  // 플랫폼별 스토어 검색 폴백 URL(storeUrl 미지정 시).
  _defaultStoreUrl() {
    const id = this.config?.appId || '';
    if (this.platform === 'android') return `https://play.google.com/store/apps/details?id=${id}`;
    if (this.platform === 'ios') {
      // ios.appStoreId 가 정본. 구 config 호환으로 AppsFlyer 값도 본다.
      const asid = this.config?.ios?.appStoreId
        || this.config?.marketing?.attribution?.appsflyer?.iosAppId || '';
      return `https://apps.apple.com/app/id${asid}`;
    }
    return '';
  }

  // 전체화면 업데이트 오버레이(앱별 코드 없이 동작). 웹 컨텍스트의 DOM 에 주입.
  _showUpdateGate({ message, storeUrl, dismissible }) {
    if (document.getElementById('appbridge-update-gate')) return;
    const root = document.createElement('div');
    root.id = 'appbridge-update-gate';
    const bg = (this.config?.theme?.background) || '#FFFFFF';
    // ATT 폴백 게이트(_showAttGate)와 같은 대비 규칙. 여기만 #202124 로 하드코딩돼 있어서
    // theme.background 가 어두운 앱(characterchat·poptale = #000000)에서 제목이 배경에 묻혔다.
    const dark = this._isDarkHex(bg);
    const fg = dark ? '#F2F4F7' : '#202124';
    const sub = dark ? '#B4BCC6' : '#5f6368';
    // 버튼: theme.primary 가 배경과 같은 명도대면 버튼이 안 보인다(두 앱 다 primary=배경=#000000).
    // 그럴 때만 전경색으로 반전해 CTA 가 반드시 눈에 띄게 한다.
    const themePrimary = (this.config?.theme?.primary) || '#1A73E8';
    const sameTone = this._isDarkHex(themePrimary) === dark;
    const btnBg = sameTone ? fg : themePrimary;
    const btnFg = sameTone ? (dark ? '#111418' : '#FFFFFF') : '#fff';
    root.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      `background:${bg}`, 'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:20px',
      'padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom))',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif',
      'text-align:center', `color:${fg}`,
    ].join(';'));
    const safe = (s) => String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // 문구의 줄바꿈만 살린다. **전부 이스케이프한 뒤** <br> 만 되돌리므로 임의 HTML 은 들어올 수 없다.
    // 실제 개행(RC 값에서 Enter)과 직접 친 <br> / <br/> 둘 다 인정한다.
    const withBreaks = (s) => safe(s)
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
      .replace(/\r?\n/g, '<br>');
    root.innerHTML =
      `<div style="font-size:20px;font-weight:700;color:${fg}">업데이트가 필요해요</div>` +
      `<div style="font-size:15px;line-height:1.6;max-width:320px;color:${sub}">${withBreaks(message)}</div>` +
      `<button id="appbridge-update-btn" style="margin-top:8px;border:0;border-radius:12px;` +
      `background:${btnBg};color:${btnFg};font-size:16px;font-weight:600;padding:14px 28px;cursor:pointer">` +
      '업데이트 하기</button>' +
      (dismissible
        ? `<button id="appbridge-update-skip" style="border:0;background:none;color:${sub};font-size:14px;cursor:pointer">나중에</button>`
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

  // ── 갤러리 저장 ─────────────────────────────────────────────────────────
  /**
   * 이미지를 기기 갤러리(사진 앨범)에 저장.
   * @param input dataUrl("data:image/png;base64,...") 또는 base64 문자열,
   *              또는 { dataUrl?, base64?, fileName? } 객체.
   * 반환: { saved: boolean, uri?: string, reason?: string }.
   * 앱: 커스텀 네이티브 플러그인(AppBridge.saveImageToGallery). 웹: 브라우저 다운로드 폴백.
   */
  async saveImageToGallery(input) {
    const opts = typeof input === 'string' ? { dataUrl: input } : (input || {});
    let base64 = opts.base64;
    if (!base64 && opts.dataUrl) base64 = String(opts.dataUrl).replace(/^data:[^;]+;base64,/, '');
    const fileName = opts.fileName || `capture_${Date.now()}.png`;
    if (!base64) return { saved: false, reason: 'no image data' };
    if (this.isNative) {
      try {
        const res = await Native.saveImageToGallery({ base64, fileName });
        return { saved: !(res && res.saved === false), uri: res && res.uri };
      } catch (e) { return { saved: false, reason: String((e && e.message) || e) }; }
    }
    // 웹 폴백: <a download> 로 파일 저장(브라우저).
    try {
      const a = document.createElement('a');
      a.href = opts.dataUrl || `data:image/png;base64,${base64}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { saved: true };
    } catch (e) { return { saved: false, reason: String((e && e.message) || e) }; }
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

  // 앱이 포그라운드로 복귀할 때 핸들러 실행(지갑/세션 갱신용). 웹은 focus/visibility 폴백.
  onResume(handler) {
    if (typeof handler !== 'function') return () => {};
    if (this.isNative) {
      let remove = () => {};
      import('@capacitor/app').then(({ App }) => {
        App.addListener('appStateChange', ({ isActive }) => { if (isActive) handler(); })
          .then((h) => { remove = () => h.remove(); });
      }).catch(() => {});
      return () => remove();
    }
    const onVis = () => { if (document.visibilityState === 'visible') handler(); };
    window.addEventListener('focus', handler);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', handler);
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  /**
   * 앱이 백그라운드로 나갈 때 핸들러 실행. 웹은 blur/visibility 폴백.
   *
   * ⚠️ onResume 만으로는 "복귀" 를 판정할 수 없다. isActive:true 는 앱이 **한 번도
   *    나가지 않았는데도** 올 수 있고(외부 앱을 여는 순간 iOS 가 활성 상태를 흔든다),
   *    그것을 복귀로 읽으면 진행 중인 브라우저 왕복(OAuth 로그인 등)이 "사용자가
   *    닫고 돌아왔다" 로 오판돼 취소된다. onPause 로 **실제로 나갔는지**를 먼저 본다.
   */
  onPause(handler) {
    if (typeof handler !== 'function') return () => {};
    if (this.isNative) {
      let remove = () => {};
      import('@capacitor/app').then(({ App }) => {
        App.addListener('appStateChange', ({ isActive }) => { if (!isActive) handler(); })
          .then((h) => { remove = () => h.remove(); });
      }).catch(() => {});
      return () => remove();
    }
    const onVis = () => { if (document.visibilityState === 'hidden') handler(); };
    window.addEventListener('blur', handler);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', handler);
      document.removeEventListener('visibilitychange', onVis);
    };
  }

  // ── 인앱 브라우저 (SFSafariViewController / Chrome Custom Tabs) ─────────
  /**
   * 인앱 브라우저를 닫는다. 웹·미설치 환경에서는 no-op.
   * OAuth 복귀 딥링크를 받은 뒤 호출한다 — 안 닫으면 로그인이 끝났는데도 브라우저
   * 창이 앱 위에 그대로 덮여 있다.
   */
  async closeInAppBrowser() {
    if (!this.isNative) return;
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.close();
    } catch { /* 이미 닫힘·미설치 — 무해 */ }
  }

  /**
   * 인앱 브라우저가 닫힌 순간을 구독한다(사용자가 직접 닫은 경우 포함). 반환=해제 함수.
   *
   * ⚠️ **OAuth 취소 판정의 유일한 근거다.** 인앱 브라우저는 앱 위에 덮이는 창이라
   *    앱이 백그라운드로 가지 않는다 — 즉 onPause/onResume 이 뜨지 않는다. 공용
   *    브라우저(openExternal 의 system:true) 시절에 쓰던 "나갔다 돌아왔으면 취소"
   *    판정을 그대로 두면, 사용자가 창을 닫아도 아무 신호가 없어 **타임아웃까지
   *    스피너가 돈다.**
   * @returns 해제 함수
   */
  onBrowserClosed(handler) {
    if (typeof handler !== 'function' || !this.isNative) return () => {};
    let remove = () => {};
    import('@capacitor/browser').then(({ Browser }) => {
      Browser.addListener('browserFinished', () => handler())
        .then((h) => { remove = () => h.remove(); });
    }).catch(() => {});
    return () => remove();
  }

  // 안전영역 인셋(px). safe-area 플러그인이 주입한 --safe-area-inset-* (없으면 env() 폴백)을 읽는다.
  // 레이아웃을 JS 로 계산할 때 사용. CSS 만으로 되면 var(--safe-area-inset-top) 을 직접 써도 됨.
  getSafeAreaInsets() {
    try {
      const s = getComputedStyle(document.documentElement);
      const px = (name) => parseInt(s.getPropertyValue(name), 10) || 0;
      return {
        top: px('--safe-area-inset-top'),
        bottom: px('--safe-area-inset-bottom'),
        left: px('--safe-area-inset-left'),
        right: px('--safe-area-inset-right'),
      };
    } catch { return { top: 0, bottom: 0, left: 0, right: 0 }; }
  }

  // 백엔드에 보낼 실행 컨텍스트. 서버가 앱/웹·플랫폼·버전별로 이벤트/가격/콘텐츠를 분기하는 데 쓴다.
  context() {
    return {
      isApp: this.isNative,
      platform: this.platform,
      appVersion: (this.config && this.config.version && this.config.version.name) || null,
      slug: (this.config && this.config.slug) || null,
    };
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
   * @param provider 'email'|'apple'|'google'|'naver'|'kakao'|'facebook'|'x'|'threads'|'line'|'discord'
   */
  async login(provider, opts = {}) {
    await this.ready();
    const auth = (this.config && this.config.auth) || {};
    const providers = auth.providers || [];
    if (!providers.includes(provider)) return { ok: false, reason: 'provider-not-enabled' };
    if (provider === 'email') return { ok: false, reason: 'email-handled-by-web' }; // 웹이 직접 처리
    if (!this.isNative) return { ok: false, reason: 'web-should-redirect' };          // 브라우저는 일반 리다이렉트로

    // 1) 자격증명 획득.
    //    Apple/iOS 는 네이티브 Sign in with Apple 우선(미설치/실패 시 OAuth 폴백)
    let credential;
    if (provider === 'apple' && this.platform === 'ios') {
      credential = (await this._appleNative(opts)) || (await this._oauth2(provider, opts));
    } else {
      credential = await this._oauth2(provider, opts);
    }
    if (!credential || !credential.ok) return credential || { ok: false, reason: 'login-failed' };

    // 2) 백엔드 세션 발급(sessionEndpoint 설정 시) — OAuth/Apple 경로 공통
    const result = await this._finishLogin(credential, opts);

    // 3) 다음에 "마지막 로그인 수단"으로 보여줄 수 있게 기기에 기록(재가입 방지 UX).
    //    ★ 기록은 rememberLastLogin() 한 곳에서만 한다 — 여기서 setPref 를 직접 쓰면
    //      키를 아는 곳이 둘이 되고, login() 을 지나지 않는 앱은 그 키를 흉내내야 한다.
    if (result && result.ok !== false) await this.rememberLastLogin(provider);
    return result;
  }

  /**
   * 게스트(익명) 로그인. 자격증명 없이 서버 계정을 만들어 로그인 전에도 지갑/진행상황을 보관.
   * IAP 를 쓰면 사실상 필요(결제를 담을 신원). 기기 게스트 토큰을 secureStorage 에 보관.
   * 나중에 login() 으로 실계정 전환 시 백엔드가 게스트를 병합한다(아래 prevToken).
   */
  async guestLogin(opts = {}) {
    const endpoint = (this.config && this.config.auth && this.config.auth.guestEndpoint) || opts.endpoint;
    if (!endpoint) return { ok: false, reason: 'no-guest-endpoint' };
    try {
      const existing = await this.secureGet('auth_token').catch(() => null);
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: await this._deviceId(), platform: this.platform, token: existing || undefined }),
      });
      if (!res.ok) return { ok: false, reason: 'guest-endpoint-failed' };
      const data = (await res.json().catch(() => ({}))) || {};
      if (data.token) { try { await this.secureSet('auth_token', data.token); } catch { /* noop */ } }
      return { ok: true, guest: true, user: data.user };
    } catch {
      return { ok: false, reason: 'guest-endpoint-failed' };
    }
  }

  /**
   * 마지막으로 성공한 로그인 수단을 이 기기에 기록한다. `login()` 이 성공 시 내부에서
   * 부르므로 그 경로를 쓰는 앱은 직접 부를 일이 없다.
   *
   * ★ **`login()` 을 지나지 않는 경로는 반드시 직접 불러야 한다.** 실제로 두 가지가 있다:
   *   - **앱이 자체 OAuth 를 도는 경우** — 서비스의 start URL 을 시스템 브라우저로 열고
   *     딥링크로 받은 code 를 웹이 상환하는 구성. 브릿지의 `login()` 을 지나지 않는다.
   *   - **이메일 로그인** — `login('email')` 은 `email-handled-by-web` 으로 즉시 빠지므로
   *     (웹이 폼으로 처리한다) 기록 지점까지 오지 않는다.
   *
   *   이때 아무도 기록하지 않으면 `getLastLogin()` 이 **영원히 null** 이고 "마지막 로그인"
   *   배지가 렌더될 수 없다. 브라우저에서는 웹이 자체 localStorage 로 처리해 동작하는 것처럼
   *   보이므로 **앱에서만 안 되는 버그**로 나타난다(팝챗에서 실제로 그랬다).
   *
   * 기록 **시점은 호출부가 정한다.** 소셜은 공급자로 떠났다 돌아와야 결과를 알아 "누를 때"
   * 가 현실적이고(취소하면 그 수단이 남지만 다음 로그인이 덮어쓴다), 이메일은 제출 응답에서
   * 판정이 끝나므로 "성공 후" 가 맞다. 이 값은 자격증명이 아니라 표시용 힌트다.
   *
   * @param provider `auth.providers` 에 들어 있는 수단. 'email' 도 된다.
   * @returns `{ ok: true }` 또는 `{ ok: false, reason }`. **실패해도 던지지 않는다** —
   *   힌트 하나 때문에 로그인 흐름이 막히면 안 되므로 호출부는 await 하지 않아도 된다.
   */
  async rememberLastLogin(provider) {
    await this.ready();
    const auth = (this.config && this.config.auth) || {};
    const providers = auth.providers || [];
    // 두 종류의 앱이 있다 — 게이트가 다르다.
    //   · 네이티브 OAuth 앱(providers 가 채워짐): login() 과 **같은 기준**으로 막는다. 여기서
    //     통과시키면 getLastLogin() 이 이 앱이 그리지도 않는 수단을 돌려주고, 호출부는 없는
    //     버튼에 배지를 달려 한다.
    //   · 브로커 앱(providers 비어 있음 + oauthReturnScheme): 수단 목록을 **앱이 갖지 않는다**
    //     (웹/BE 가 정한다 — docs/25 §1 "운반만 하고 해석하지 않는다"). providers 로 막으면
    //     이 API 가 그 앱에서 영원히 거절돼 웹이 같은 키에 setPref 로 직접 쓰게 된다(팝챗
    //     실측) — 키 이름이 두 레포에 박히고 다음 앱이 또 흉내낸다. 그래서 브로커 앱은
    //     **모양만** 검사한다: 하네스가 아는 10종(프리셋 9종 + email) 중 하나인가.
    const brokered = providers.length === 0 && auth.oauthReturnScheme === true;
    if (brokered) {
      const known = provider === 'email' || Object.prototype.hasOwnProperty.call(OAUTH_PRESETS, provider);
      if (typeof provider !== 'string' || !known) return { ok: false, reason: 'unknown-provider' };
    } else if (!providers.includes(provider)) {
      return { ok: false, reason: 'provider-not-enabled' };
    }
    try {
      await this.setPref('last_login_provider', provider);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'pref-write-failed' };
    }
  }

  /** 이 기기에서 마지막으로 성공한 로그인 수단. 로그인 화면에 "마지막 로그인: 카카오" 배지용.
   *  ★ 기록하는 쪽은 {@link rememberLastLogin} 이다 — `login()` 을 안 쓰는 앱은 그걸 직접
   *    불러야 한다. 짝을 안 부르면 이 함수는 영원히 null 을 돌려준다. */
  async getLastLogin() {
    const provider = await this.getPref('last_login_provider');
    return provider ? { provider } : null;
  }

  // ── 기기 바인딩(실로그인 후) ───────────────────────────────────────────
  /**
   * 생체인증 빠른 재로그인 켜기/끄기. 실로그인 직후 호출하면, 다음 실행부터 소셜 라운드트립 없이
   * Face ID/지문으로 잠금 해제(세션 토큰은 이미 secureStorage 에 기기 바인딩됨).
   */
  async enableBiometricLogin(enabled = true) {
    if (enabled && this.isNative && this.capabilities.biometric) {
      const r = await this.authenticate({ reason: '생체 인증으로 빠른 로그인을 설정합니다' });
      if (!r.success) return { ok: false, reason: r.reason };
    }
    await this.setPref('biometric_login', !!enabled);
    return { ok: true, enabled: !!enabled };
  }

  async biometricLoginEnabled() { return !!(await this.getPref('biometric_login')); }

  /**
   * 앱 시작 시 잠금 해제. 생체 빠른 로그인이 켜져 있으면 생체인증을 요구한다.
   * 반환 { unlocked, reason }. (서버 세션 유효성은 별도로 /auth/me 로 확인)
   */
  async unlock() {
    if (!(await this.biometricLoginEnabled())) return { unlocked: true, reason: 'not-required' };
    const r = await this.authenticate({ reason: '잠금을 해제하려면 인증하세요' });
    return { unlocked: !!r.success, reason: r.reason };
  }

  // 푸시 토큰을 계정에 등록(기기↔계정 바인딩). auth.deviceEndpoint 설정 시.
  async _registerDeviceToken(pushToken) {
    this._pushToken = pushToken || null; // 로그아웃/탈퇴에서 해제에 쓴다
    const endpoint = this.config && this.config.auth && this.config.auth.deviceEndpoint;
    if (!endpoint) return;
    try {
      await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushToken, deviceId: await this._deviceId(), platform: this.platform }),
      });
    } catch { /* noop */ }
  }

  /**
   * 푸시 토큰을 계정에서 해제(기기↔계정 바인딩 해제). auth.deviceUnregisterEndpoint 설정 시.
   *
   * ⚠️ **세션 쿠키가 살아 있는 동안** 불러야 한다 — 서버가 "누구의 기기인가"를 쿠키로
   *    판정하므로 로그아웃 요청보다 먼저 보내지 않으면 401 로 버려진다. 그래서
   *    logout()/deleteAccount() 가 세션 종료 **앞에서** 호출한다.
   * ⚠️ 안 하면 기기 토큰이 이전 계정에 그대로 붙어 있어, **그 기기에 아무도 로그인하지
   *    않은 동안 이전 계정의 푸시가 계속 온다.** 다음 사용자가 알림 권한을 거부하면
   *    소유자 갱신(registerPush)이 일어나지 않아 남의 알림이 되기도 한다 — 허용하면
   *    서버가 토큰 소유자를 새 사용자로 갱신한다(docs/10-AUTH §3-7).
   */
  async _unregisterDeviceToken() {
    const endpoint = this.config && this.config.auth && this.config.auth.deviceUnregisterEndpoint;
    const pushToken = this._pushToken;
    if (!endpoint || !pushToken) return;
    try {
      await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushToken, deviceId: await this._deviceId(), platform: this.platform }),
      });
    } catch { /* noop — 해제 실패로 로그아웃을 막지 않는다 */ }
    this._pushToken = null;
  }

  // 기기 식별자 캐시 (백엔드 세션/기기 관리에 함께 보냄)
  async _deviceId() {
    if (this._devId !== undefined) return this._devId;
    try { const info = await this.getDeviceInfo(); this._devId = info.id || null; }
    catch { this._devId = null; }
    return this._devId;
  }

  /**
   * 로그아웃: 기기 바인딩 해제 → 시큐어 토큰 삭제 → (설정 시) 백엔드 세션 종료 → 새로고침.
   *
   * ⚠️ 순서가 계약이다. 기기 토큰 해제는 **세션이 살아 있을 때**만 서버가 받으므로
   *    로그아웃 요청보다 먼저 보낸다(_unregisterDeviceToken 주석).
   * ⚠️ 기기에 남는 로그인 흔적을 함께 지운다 — 보류 딥링크(이전 흐름의 OAuth code)와
   *    생체 빠른 로그인 플래그. 생체 플래그를 남기면 다음 사용자(계정 전환)에게
   *    이전 사용자의 잠금이 걸린다.
   *    `last_login_provider` 는 **남긴다** — 자격증명이 아니라 "어느 버튼을 눌렀더라"
   *    힌트이고, 로그인 화면의 "마지막 로그인" 배지가 그 값으로 산다.
   */
  async logout(opts = {}) {
    await this._unregisterDeviceToken();
    try { await this.secureRemove('auth_token'); } catch { /* noop */ }
    try { await this.removePref('biometric_login'); } catch { /* noop */ }
    this.clearPendingDeepLink();
    const endpoint = (this.config && this.config.auth && this.config.auth.logoutEndpoint) || opts.endpoint;
    if (endpoint) { try { await fetch(endpoint, { method: 'POST', credentials: 'include' }); } catch { /* noop */ } }
    if (opts.reload !== false && this.isNative) location.reload();
    return { ok: true };
  }

  /**
   * 회원탈퇴/계정 삭제. 스토어 정책상 계정 생성을 지원하면 앱 내 탈퇴가 필수(Apple 5.1.1(v)).
   * 백엔드(auth.deleteEndpoint)가 계정/데이터 삭제 후 세션 종료. 확인 UI 는 웹이 띄운다.
   */
  async deleteAccount(opts = {}) {
    const endpoint = (this.config && this.config.auth && this.config.auth.deleteEndpoint) || opts.endpoint;
    if (!endpoint) return { ok: false, reason: 'no-delete-endpoint' };
    // ⚠️ 기기 바인딩 해제는 탈퇴 요청 **앞**이다 — 세션이 끝난 뒤에는 서버가 받지 않는다.
    await this._unregisterDeviceToken();
    try {
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: await this._deviceId() }),
      });
      if (res.ok) {
        try { await this.secureRemove('auth_token'); } catch { /* noop */ }
        try { await this.removePref('last_login_provider'); } catch { /* noop */ }
        // 탈퇴는 흔적을 전부 지운다 — 생체 플래그를 남기면 이 기기의 다음 사용자가
        // 사라진 계정의 잠금을 물려받는다.
        try { await this.removePref('biometric_login'); } catch { /* noop */ }
        this.clearPendingDeepLink();
        if (opts.reload !== false && this.isNative) location.reload();
      }
      return { ok: res.ok };
    } catch {
      return { ok: false, reason: 'delete-endpoint-failed' };
    }
  }

  // ── iOS ATT (앱 추적 투명성) ────────────────────────────────────────────
  // 사전 설명 화면은 웹이 그린다(config.tracking.att.prePermission=true). 웹이 안 그리는 앱을 위해
  // prePermission=false 면 아래 _showAttGate() 가 브릿지 기본 화면을 띄운다.

  // 결과 객체 정규화 — 호출부가 status 문자열 비교를 안 해도 되게 authorized 를 함께 준다.
  _attResult(status) {
    return { status, authorized: status === 'authorized' };
  }

  /**
   * 현재 ATT 상태만 조회한다. **시스템 팝업을 띄우지 않는다.**
   * 사전 설명 화면이 "이미 응답한 유저"에게 다시 뜨지 않으려면 이걸로 먼저 걸러야 한다.
   * @returns {{ status:'authorized'|'denied'|'restricted'|'notDetermined'|'not-applicable'|'unavailable', authorized:boolean }}
   */
  async trackingStatus() {
    if (this.platform !== 'ios') return this._attResult('not-applicable');
    if (this._attStatus) return this._attResult(this._attStatus);
    try {
      const { AppTrackingTransparency } = await import('capacitor-plugin-app-tracking-transparency');
      const r = await AppTrackingTransparency.getStatus();
      const status = (r && r.status) || 'notDetermined';
      // notDetermined 는 아직 확정이 아니라 캐시하지 않는다(요청 후 바뀐다).
      if (status !== 'notDetermined') this._attStatus = status;
      return this._attResult(status);
    } catch {
      return this._attResult('unavailable'); // 플러그인 미설치 — 캐시 안 함
    }
  }

  /**
   * iOS ATT 동의 요청. 어트리뷰션(AppsFlyer/Adbrix 등) 정확도에 필요하며 initMarketing 전에 호출한다.
   *
   * **멱등하다.** 여러 번 불려도 시스템 팝업은 최대 1회만 뜬다:
   *   iOS 아님 → 즉시 not-applicable / 확정 상태 캐시됨 → 캐시 반환(팝업 없음)
   *   요청 진행 중 → 진행 중인 동일 Promise 반환 / notDetermined + 첫 호출 → 실제 요청
   * 호출부 두 곳에서 동시에 불러 응답이 엉키는 사고를 API 레벨에서 막는다.
   */
  async requestTracking() {
    if (this.platform !== 'ios') return this._attResult('not-applicable');
    if (this._attStatus) return this._attResult(this._attStatus);
    if (this._attPending) return this._attPending;

    this._attPending = (async () => {
      try {
        const { AppTrackingTransparency } = await import('capacitor-plugin-app-tracking-transparency');
        // 이미 응답한 유저면 requestPermission 은 팝업 없이 기존 값을 돌려주지만,
        // 상태를 먼저 확인해 두면 캐시가 채워져 다음 호출부터 플러그인 왕복이 없다.
        const cur = await AppTrackingTransparency.getStatus().catch(() => null);
        if (cur && cur.status && cur.status !== 'notDetermined') {
          this._attStatus = cur.status;
          return this._attResult(cur.status);
        }
        const r = await AppTrackingTransparency.requestPermission();
        const status = (r && r.status) || 'notDetermined';
        if (status !== 'notDetermined') {
          this._attStatus = status;
          // 어트리뷰션 SDK 는 ATT 응답 직후 곧바로 init 하면 IDFA 를 못 잡는 경우가 있어
          // 벤더가 짧은 대기를 권한다. 어댑터가 "얼마나 지났는지" 를 알 수 있게 남긴다.
          this._attResolvedAt = Date.now();
        }
        return this._attResult(status);
      } catch {
        return this._attResult('unavailable'); // 캐시 안 함 → 다음 호출에서 재시도 가능
      } finally {
        this._attPending = null;
      }
    })();

    return this._attPending;
  }

  /**
   * 이 앱의 OS 설정 페이지를 연다. 브라우저에서는 no-op.
   *
   * **권한을 한 번 거부한 유저를 되돌릴 유일한 경로다.** ATT 는 상태가 notDetermined 일 때만
   * 시스템 팝업이 뜨므로, 거부 후에는 앱이 다시 물을 수 없다 — iOS 는 앱 설정 페이지에
   * "추적 허용" 토글을 보여주므로 거기로 보낸다. Android 는 ATT 가 없지만 알림·카메라 권한을
   * 두 번 거부하면 다이얼로그가 안 뜨므로 같은 경로가 필요하다.
   *
   * ⚠️ `설정 > 개인정보 보호 > 추적` 같은 하위 화면 직행 URL(App-Prefs:...)은 비공개 API 라
   * 심사에서 리젝된다. 공개 API 로는 앱 자신의 설정 페이지까지만 갈 수 있다 — 그래서 UI 문구는
   * "설정에서 추적을 켤 수 있어요" 처럼 한 단계 더 들어가야 함을 알려주는 게 정직하다.
   */
  async openAppSettings() {
    if (!this.isNative) return { opened: false, reason: 'not-native' };
    try {
      const r = await Native.openAppSettings();
      return { opened: !!(r && r.opened) };
    } catch (e) {
      // 구 버전 셸(플러그인에 메서드 없음)에서도 호출부가 죽지 않게 한다.
      return { opened: false, reason: String((e && e.message) || e) };
    }
  }

  /**
   * 폴백 사전 설명 화면. config.tracking.att.prePermission=false 인 앱(=웹이 자체 화면을 안 만든 앱)
   * 에서만 동작한다. 웹 작업 0으로도 "설명 없이 시스템 팝업부터 띄우는" 상태를 피하게 하는 장치.
   *
   * 문구 원칙(법무 검토 반영) — 바꿀 때 반드시 지킬 것:
   *   · ATT 는 광고의 *관련성* 만 바꾼다. "광고가 줄어든다"는 사실이 아니므로 쓰지 않는다.
   *   · 거부 경로를 허용과 같은 비중으로 노출한다(한쪽만 강조 금지).
   *   · 거부해도 모든 기능을 쓸 수 있다는 고지를 본문과 같은 크기로 넣는다.
   *   · 자체 버튼에 "허용"이라는 단어를 쓰지 않는다(시스템 다이얼로그 모방 금지 — Apple HIG).
   *   · 정보통신망법 §50 마케팅 수신 동의와는 별개다. 그 표현을 연상시키지 않는다.
   */
  async _maybeShowAttGate() {
    if (!this.isNative || this.platform !== 'ios') return;
    const att = this.config && this.config.tracking && this.config.tracking.att;
    if (!att || !att.enabled) return;
    if (att.prePermission !== false) return;        // 웹이 그린다 → 브릿지는 관여하지 않는다
    const { status } = await this.trackingStatus();
    if (status !== 'notDetermined') return;         // 이미 응답한 유저에겐 띄우지 않는다
    this._showAttGate(att.copy || {});
  }

  _showAttGate(copy) {
    if (typeof document === 'undefined' || document.getElementById('appbridge-att-gate')) return;
    const t = {
      title: copy.title || '관심에 더 맞는 광고를 보시도록\n추적을 허용해 주세요',
      body: copy.body
        || '허용하시면 관심과 동떨어진 광고 대신 더 관련성 높은 광고를 보여드릴 수 있어요.\n'
         + '광고의 개수가 줄어드는 것은 아니에요.',
      notice: copy.notice
        || '허용하지 않아도 모든 기능을 무료로 그대로 이용할 수 있어요.\n'
         + '설정 › 개인정보 보호 및 보안 › 추적 에서 언제든 변경할 수 있어요.',
      continueLabel: copy.continueLabel || '계속',
      laterLabel: copy.laterLabel || '나중에',
    };
    const bg = (this.config && this.config.theme && this.config.theme.background) || '#FFFFFF';
    const primary = (this.config && this.config.theme && this.config.theme.primary) || '#1A73E8';
    // 배경이 어두우면 텍스트를 밝게 — 다크 테마 앱에서 글자가 안 보이는 사고 방지.
    const dark = this._isDarkHex(bg);
    const fg = dark ? '#F2F4F7' : '#202124';
    const sub = dark ? '#B4BCC6' : '#5f6368';
    const line = dark ? '#4A5159' : '#C6CBD1';

    const root = document.createElement('div');
    root.id = 'appbridge-att-gate';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      `background:${bg}`, 'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center', 'gap:16px',
      'padding:max(24px,env(safe-area-inset-top)) 24px max(24px,env(safe-area-inset-bottom))',
      'font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif',
      'text-align:center', `color:${fg}`,
    ].join(';'));
    const safe = (s) => String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const nl = (s) => safe(s).replace(/\n/g, '<br>');

    // 두 버튼은 같은 폭·같은 높이. 거부 경로를 텍스트 링크로 축소하지 않는다(다크패턴 회피).
    const btn = (id, label, filled) =>
      `<button id="${id}" style="width:100%;max-width:320px;border-radius:12px;font-size:16px;` +
      `font-weight:600;padding:14px 20px;cursor:pointer;` +
      (filled
        ? `border:0;background:${primary};color:#fff`
        : `border:1px solid ${line};background:transparent;color:${fg}`) +
      `">${safe(label)}</button>`;

    root.innerHTML =
      `<div style="font-size:20px;font-weight:700;line-height:1.45">${nl(t.title)}</div>` +
      `<div style="font-size:15px;line-height:1.6;max-width:340px;color:${sub}">${nl(t.body)}</div>` +
      `<div style="font-size:15px;line-height:1.6;max-width:340px;color:${sub};margin-top:4px">${nl(t.notice)}</div>` +
      `<div style="display:flex;flex-direction:column;gap:10px;width:100%;max-width:320px;margin-top:12px">` +
      btn('appbridge-att-continue', t.continueLabel, true) +
      btn('appbridge-att-later', t.laterLabel, false) +
      `</div>`;
    document.body.appendChild(root);

    const close = () => root.remove();
    document.getElementById('appbridge-att-continue').addEventListener('click', () => {
      close();
      // 결과와 무관하게 진행한다 — ATT 는 기능·보상의 조건이 될 수 없다(Apple 5.1.2(i)).
      this.requestTracking().catch(() => {});
    });
    // "나중에": requestTracking 을 호출하지 않는다 → 상태가 notDetermined 로 남아 다음 기회가 살아 있다.
    document.getElementById('appbridge-att-later').addEventListener('click', close);
  }

  // #RRGGBB / #RGB 배경이 어두운지 (상대휘도 근사). 게이트 텍스트 대비 결정용.
  _isDarkHex(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return false;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }

  // ── 권한 (just-in-time + 접근권한 안내) ────────────────────────────────
  /**
   * 이 앱이 쓰는 네이티브 권한 목록(한국 "접근권한 안내" 화면용). capabilities 에서 파생 +
   * config.permissions 로 용도/필수여부 오버라이드. 가입 시 통째로 요청하지 말고 이 목록을 "고지"만.
   * @returns [{ type, label, purpose, required }]
   */
  getPermissionNotice() {
    const caps = this.capabilities;
    const over = (this.config && this.config.permissions) || {};
    const items = [];
    const add = (type, label, purpose) => {
      const o = over[type] || {};
      items.push({ type, label, purpose: o.purpose || purpose, required: o.required === true });
    };
    if (caps.camera) add('camera', '카메라·사진', '사진 촬영 및 첨부');
    if (caps.geolocation) add('location', '위치', '위치 기반 서비스 제공');
    if (caps.push || caps.localNotification) add('notifications', '알림', '공지·소식 등 알림 수신');
    return items;
  }

  async permissionStatus(type) {
    if (!this.isNative) return 'unsupported';
    try {
      if (type === 'notifications') { const { PushNotifications } = await import('@capacitor/push-notifications'); return (await PushNotifications.checkPermissions()).receive; }
      if (type === 'location') { const { Geolocation } = await import('@capacitor/geolocation'); return (await Geolocation.checkPermissions()).location; }
      if (type === 'camera') { const { Camera } = await import('@capacitor/camera'); return (await Camera.checkPermissions()).camera; }
    } catch { /* 미설치 */ }
    return 'unknown';
  }

  /** 권한을 그 기능을 처음 쓸 때(just-in-time) 요청. 사전 설명(rationale)은 웹이 먼저 보여줄 것. */
  async requestPermission(type) {
    if (!this.isNative) return 'unsupported';
    try {
      if (type === 'notifications') { const { PushNotifications } = await import('@capacitor/push-notifications'); return (await PushNotifications.requestPermissions()).receive; }
      if (type === 'location') { const { Geolocation } = await import('@capacitor/geolocation'); return (await Geolocation.requestPermissions()).location; }
      if (type === 'camera') { const { Camera } = await import('@capacitor/camera'); return (await Camera.requestPermissions()).camera; }
    } catch { /* 미설치 */ }
    return 'unknown';
  }

  // 크래시/에러 모니터링 초기화. config.monitoring.crash 설정 시 ready() 에서 자동 1회.
  // 현재 자동 배선: Sentry(@sentry/capacitor). dsn 은 공개값이라 config 에 둬도 됨.
  async initMonitoring() {
    if (this._monitoringStarted) return;
    const m = this.config && this.config.monitoring && this.config.monitoring.crash;
    if (!m || !m.provider) return;
    this._monitoringStarted = true;
    if (m.provider === 'sentry') {
      if (!m.dsn) return;
      try {
        const Sentry = await import('@sentry/capacitor');
        Sentry.init({
          dsn: m.dsn,
          release: this.config.version && `${this.config.appId}@${this.config.version.name}`,
          environment: m.environment || 'production',
        });
        this._sentry = Sentry;
      } catch { /* 플러그인 미설치 → 무시 */ }
    }
  }

  /** 수동 에러 보고(웹에서 catch 한 에러 등) */
  reportError(err, context) {
    try { if (this._sentry) this._sentry.captureException(err, context ? { extra: context } : undefined); }
    catch { /* noop */ }
  }

  // 범용 OAuth2 Authorization Code + PKCE (시스템 브라우저 + 딥링크 복귀)
  async _oauth2(provider, opts) {
    const auth = this.config.auth || {};

    // 공급자 OAuth 엔드포인트를 앱이 직접 호출한다(길 B). 자체 IdP 모드는 제거됐다 —
    // 인증은 외부 인증서버 위탁이다(docs/25-AUTH-DELEGATION.md).
    const conf = (auth.oauth && auth.oauth[provider]) || {};
    const preset = OAUTH_PRESETS[provider] || {};
    const clientId = conf.clientId;
    const authorizeUrl = conf.authorizeUrl || preset.authorizeUrl;
    const redirectUri = conf.redirectUri || this._defaultRedirect(provider);
    const scopes = conf.scopes || preset.scopes || [];
    const extraQuery = conf.extraQuery;
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
    const url = `${authorizeUrl}?${params.toString()}${extraQuery ? '&' + extraQuery : ''}`;

    // ⚠️ **공용 브라우저는 탭이 남는다.** 로그인하다 만 공급자 화면이 살아남아, 나중에
    //    그 탭에서 뒤늦게 완주하면 인증서버가 그 흐름을 거부할 수 있다(서버가 진행 중인
    //    시도를 하나만 기억하는 설계일 때 — poptale-auth 가 그렇다). 브로커 경로는
    //    이 문제로 인앱 브라우저로 옮겼다(웹 어댑터 awaitOAuthReturn 주석).
    //    이 네이티브 OAuth 경로도 같은 노출이 있지만, 운영 중인 앱(poptale)의 로그인이
    //    걸려 있어 실기기 확인 없이 바꾸지 않는다 — 바꿀 때는 { system: true } 를 빼고
    //    onBrowserClosed 로 취소를 판정해야 한다(그냥 빼면 취소를 영영 모른다).
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
  //   백엔드 응답 플래그: { isNew, needsProfile, needsConsent, signupRequired, complete:false }
  //   중 하나면 "미완료"
  async _finishLogin(credential, opts) {
    if (!credential || !credential.ok) return credential;
    const endpoint = (this.config.auth && this.config.auth.sessionEndpoint) || opts.sessionEndpoint;
    if (!endpoint) return credential; // 웹이 직접 백엔드로 전송
    try {
      const prevToken = await this.secureGet('auth_token').catch(() => null); // 게스트 병합용
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...credential, deviceId: await this._deviceId(), platform: this.platform,
          prevToken: prevToken || undefined, // 백엔드: 게스트 계정 → 실계정 병합
        }),
      });
      const data = (await res.json().catch(() => ({}))) || {};
      // 미완료 신호는 백엔드마다 이름이 다르다 — 하나라도 서면 "가입 안 끝남"으로 본다.
      // 브릿지는 이 플래그들의 의미를 해석하지 않는다. 새로고침 여부만 가른다.
      const incomplete = data.complete === false
        || !!data.isNew || !!data.needsProfile || !!data.needsConsent || !!data.signupRequired;
      if (res.ok && data.token) { try { await this.secureSet('auth_token', data.token); } catch { /* noop */ } }
      // 가입이 끝난 기존 회원만 새로고침. 신규(온보딩 필요)면 웹이 화면을 띄우게 둔다.
      if (res.ok && !incomplete && opts.reload !== false) location.reload();
      // 미지 필드 pass-through — 브릿지는 백엔드 응답에서 아는 필드만 골라내지 않는다.
      // 서비스마다 필요한 필드가 다르고(가입 토큰 등) 브릿지는 그 의미를 몰라야 하므로,
      // 통째로 올리고 해석은 웹에 맡긴다.
      // ★ ...data 를 먼저 펼친다 — 뒤의 필드가 이겨야 백엔드가 브릿지 판정을 덮어쓰지 못한다.
      return {
        ...data,
        ...credential,
        session: res.ok,
        user: data.user || credential.user,
        isNew: !!data.isNew,
        needsProfile: !!(data.needsProfile || data.needsConsent),
        backend: data, // 하위호환 — 기존 소비자가 쓴다. 지우지 마라.
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
      const prevToken = await this.secureGet('auth_token').catch(() => null); // 게스트 병합용
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(profile || {}), deviceId: await this._deviceId(), platform: this.platform,
          prevToken: prevToken || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) || {};
      if (res.ok && data.token) { try { await this.secureSet('auth_token', data.token); } catch { /* noop */ } }
      if (res.ok && opts.reload !== false) location.reload();
      // 미지 필드 pass-through — login() 과 같은 규약이다. ...data 를 먼저 펼쳐
      // 뒤의 필드가 이겨야 백엔드가 브릿지 판정을 덮어쓰지 못한다.
      return { ...data, ok: res.ok, user: data.user, backend: data };
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

  // ── 인앱결제 (IAP) ─────────────────────────────────────────────────────
  // 디지털 재화(코인/회차)는 스토어 IAP 강제. 영수증 검증은 백엔드가(플러그인이 verifyEndpoint 로 POST).
  // 웹/앱 한 코드: 웹은 isNative=false → 기존 웹 PG, 앱은 purchase() → 스토어 IAP.
  // 플러그인: cordova-plugin-purchase(v13, window.CdvPurchase). 통합 시 플러그인 API 재확인 권장.
  async _iapInit() {
    if (this._iapReadyP) return this._iapReadyP;
    this._iapReadyP = (async () => {
      if (!this.isNative || !this.capabilities.iap) return null;
      const CdvPurchase = (typeof window !== 'undefined') && window.CdvPurchase;
      if (!CdvPurchase || !CdvPurchase.store) return null;
      const store = CdvPurchase.store;
      const iap = this.config.iap || {};
      const platform = this.platform === 'ios'
        ? CdvPurchase.Platform.APPLE_APPSTORE : CdvPurchase.Platform.GOOGLE_PLAY;
      if (iap.verifyEndpoint) store.validator = iap.verifyEndpoint; // 백엔드 영수증 검증으로 위임
      const products = (iap.products || []).map((p) => ({
        id: p.storeId || p.id,
        type: CdvPurchase.ProductType.CONSUMABLE, // 코인=소비형
        platform,
      }));
      if (products.length) store.register(products);
      await store.initialize([platform]);
      this._store = store;
      return store;
    })().catch(() => null);
    return this._iapReadyP;
  }

  // storeId 해석 + 상품 메타(가격 등) 반환. 웹은 빈 배열(웹 가격은 웹이 직접 표시).
  async getProducts() {
    const store = await this._iapInit();
    if (!store) return [];
    return (this.config.iap.products || []).map((p) => {
      const sid = p.storeId || p.id;
      const prod = store.get ? store.get(sid) : null;
      const offer = prod && prod.getOffer && prod.getOffer();
      const phase = offer && offer.pricingPhases && offer.pricingPhases[0];
      return {
        id: p.id, storeId: sid,
        title: (prod && prod.title) || null,
        price: (phase && phase.price) || null,          // 스토어 현지화 가격(앱: 120원 티어)
        priceMicros: (phase && phase.priceMicros) || null,
      };
    });
  }

  /**
   * 구매. 앱에서만 동작(웹은 reason:'web-should-use-pg' — 웹은 자체 PG 사용).
   * 흐름: order → approved → verify(백엔드) → verified → finish. 지갑 적립은 백엔드가 검증 시 수행.
   * @returns { ok, productId, transactionId } | { ok:false, reason }
   */
  async purchase(productId) {
    if (!this.isNative) return { ok: false, reason: 'web-should-use-pg' };
    const store = await this._iapInit();
    if (!store) return { ok: false, reason: 'iap-unavailable' };
    const map = (this.config.iap.products || [])
      .find((p) => p.id === productId || p.storeId === productId);
    const sid = map ? (map.storeId || map.id) : productId;
    const product = store.get(sid);
    const offer = product && product.getOffer && product.getOffer();
    if (!offer) return { ok: false, reason: 'product-not-found' };

    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      store.when()
        .approved((t) => t.verify())                       // → 플러그인이 verifyEndpoint 로 영수증 검증
        .verified((receipt) => { receipt.finish(); done({ ok: true, productId, transactionId: receipt.id }); })
        .unverified(() => done({ ok: false, reason: 'verification-failed' }));
      Promise.resolve(store.order(offer))
        .catch((e) => done({ ok: false, reason: 'order-failed', detail: String((e && e.message) || e) }));
    });
  }

  /** 구매 복원(기기 변경/재설치 시). 비소비성/구독에 의미. 소비형 코인은 보통 서버지갑이 진실. */
  async restorePurchases() {
    const store = await this._iapInit();
    if (!store) return { ok: false, reason: 'iap-unavailable' };
    try { await store.restorePurchases(); return { ok: true }; }
    catch { return { ok: false, reason: 'restore-failed' }; }
  }

  // ── 마케팅 SDK ─────────────────────────────────────────────────────────
  // 마케팅 SDK 초기화. 앱 시작 시 1회 호출. 키는 네이티브 베이크 config 에서 읽는다.
  // opts.onDeepLink(url, raw): 디퍼드/딥링크 도착 시 라우팅 콜백.
  //
  // 벤더별 코드는 여기 없다 — ATTRIBUTION_ADAPTERS(파일 하단)의 어댑터가 갖는다.
  // 벤더 교체는 config 의 provider 값만 바꾸면 되고, 웹 서비스 코드는 손대지 않는다.
  async initMarketing(opts = {}) {
    await this.ready();
    // 전달된 onDeepLink 콜백은 통합 딥링크 핸들러로 등록(직접 딥링크와 동일 경로).
    if (typeof opts.onDeepLink === 'function') this.onDeepLink(opts.onDeepLink);

    const att = this.config && this.config.marketing && this.config.marketing.attribution;

    // ⚠️ 아래 이탈 경로는 전부 _afterInit 을 거쳐야 한다. 안 그러면 _eventQueue 가 영영
    // 안 비워져서 track() 을 기다리는 호출부가 멈추고 큐가 무한히 자란다.
    // (poptale 우회 #4 와 같은 사고: logPurchase 무한 대기 → 서버 검증 미실행 → 재화 미지급.
    //  벤더를 아예 안 쓰는 앱 — provider:null — 이 정확히 이 경로로 들어온다.)
    if (!this.isNative || !att || !att.provider) {
      this._afterInit(opts);
      return { initialized: false, reason: att && att.provider ? 'not-native' : 'no-provider' };
    }

    const name = att.provider;
    const adapter = ATTRIBUTION_ADAPTERS[name];
    if (!adapter) {
      this._afterInit(opts);
      return { initialized: false, reason: `provider-not-wired:${name}` };
    }
    if (this._providers[name]) return { initialized: true, provider: name }; // 중복 init 방지

    let res;
    // 어댑터가 던져도 앱 부팅을 막지 않는다. 단 _afterInit 은 반드시 지나가야 한다 —
    // 안 그러면 _eventQueue 가 영영 안 비워져 track() 을 기다리는 호출부가 멈춘다
    // (poptale 우회 #4 와 같은 사고: logPurchase 무한 대기 → 재화 미지급).
    try { res = await adapter.init(this, att, opts); }
    catch { res = { ok: false, reason: 'init-threw' }; }

    if (!res || !res.ok) {
      this._afterInit(opts);
      return { initialized: false, provider: name, reason: (res && res.reason) || 'init-failed' };
    }
    this._providers[name] = { adapter, handle: res.handle };
    this._afterInit(opts);
    return { initialized: true, provider: name };
  }

  // 초기화 직후 공통 처리: 큐 비우기 + 자동 수집 시작.
  _afterInit(opts) {
    if (this._afterInitDone) return;
    this._afterInitDone = true;
    const q = this._eventQueue.splice(0);
    for (const [name, params] of q) this.track(name, params);
    const auto = this.config?.marketing?.autoCapture !== false;
    if (auto && (opts.autoCapture !== false)) this._startAutoCapture();
  }

  /**
   * 통합 이벤트 로깅. 켜진 모든 마케팅 벤더로 자동 분배.
   * 웹 서비스는 벤더를 몰라도 이 한 줄만 부르면 된다: AppBridge.track('purchase', { price: 9900 })
   */
  async track(event, params = {}) {
    if (!this.isNative) return; // 브라우저: no-op (원하면 여기서 dataLayer push 등 폴백 가능)
    // 초기화 전이면 큐잉. _afterInit 이 비운다(초기화 실패해도 비워진다).
    if (!this._afterInitDone) {
      // initMarketing 을 아예 호출하지 않는 앱도 있으므로 상한을 둔다(오래된 것부터 버림).
      if (this._eventQueue.length >= 200) this._eventQueue.shift();
      this._eventQueue.push([event, params]);
      return;
    }
    await this._fanout('track', event, params || {});
  }

  /** 사용자 식별 — 켜진 벤더 전체에 동일 ID 적용 (크로스 디바이스/어트리뷰션 연결) */
  async setUser(userId, traits = {}) {
    if (!this.isNative) return;
    this._userId = userId ? String(userId) : null; // 어댑터가 이벤트에 실어야 할 때 읽는다
    await this._fanout('setUser', userId, traits || {});
  }

  /** 붙은 벤더 전체에 같은 호출을 분배. 한 벤더가 실패해도 나머지는 진행한다. */
  async _fanout(method, a, b) {
    for (const name of Object.keys(this._providers)) {
      const { adapter, handle } = this._providers[name];
      const fn = adapter && adapter[method];
      if (typeof fn !== 'function') continue;
      try { await fn(handle, a, b, this); }
      catch { /* 단일 벤더 실패가 전체를 막지 않게 */ }
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

// ── 어트리뷰션 어댑터 레지스트리 ─────────────────────────────────────────
//
// 벤더 하나 = 어댑터 하나. `marketing.attribution.provider` 이름으로 골라 쓴다.
// **벤더 교체는 config 한 줄이고, 웹 서비스 코드는 절대 바뀌지 않는다.**
// (AIPIA 표준은 Adbrix, 글로벌은 다른 벤더 예정 — 그래서 교체 가능해야 한다.)
//
// 어댑터가 구현할 것:
//   init(bridge, att, opts) → { ok, handle?, reason? }   ※ throw 하지 말 것. 실패는 ok:false 로.
//   track(handle, event, params, bridge)                  ※ 선택
//   setUser(handle, userId, traits, bridge)               ※ 선택
//
// handle 은 그 벤더의 SDK 객체. 브릿지는 내용을 모른 채 되돌려주기만 한다.
const ATTRIBUTION_ADAPTERS = {
  // Adbrix(DFINERY) — AIPIA 표준 어트리뷰션(01-AIPIA-CONVENTIONS §5).
  // 공식 Capacitor 플러그인이 없어 하네스가 직접 유지한다: template/plugins/adbrix/plugin.
  //
  // **호출 순서를 지켜야 한다** (SDK 요구):
  //   1) blockDeferredDeepLink() — SDK 가 딥링크를 받고 자기가 화면을 띄우는 걸 막는다.
  //      init 뒤에 부르면 늦는다(poptale 우회 #1 이 막으려던 사고).
  //   2) attAuthorized() — ATT 결과. init 뒤에 주면 IDFA 가 어트리뷰션에 안 붙는다.
  //   3) initialize()
  adbrix: {
    async init(bridge, att, opts) {
      const k = att.adbrix || {};
      if (!k.appKey || !k.secretKey) return { ok: false, reason: 'no-keys' };
      let Adbrix;
      try { ({ Adbrix } = await import('@aipia-team/capacitor-adbrix')); }
      catch { return { ok: false, reason: 'plugin-missing' }; }

      // 1) 디퍼드 딥링크 자동 실행 차단 + 수신 배선 — init 보다 먼저.
      if (att.deferredDeepLink) {
        try {
          await Adbrix.blockDeferredDeepLink();
          await Adbrix.addListener('deferredDeepLink', (e) => {
            if (e && e.url) bridge._emitDeepLink(e.url, e);
          });
          // 리스너가 붙기 전 도착해 네이티브가 버퍼링해 둔 링크를 흘려보낸다.
          // 설치 첫 실행에서 SDK 콜백이 웹 로딩보다 빠른 경우가 실제로 있다.
          await Adbrix.flushPendingDeepLink();
        } catch { /* 차단 실패해도 초기화는 계속한다 */ }
      }

      // 2) ATT 결과 전달 — iOS 만. requestTracking() 이 이미 캐시해 둔 값을 쓴다.
      //    poptale 은 ATT 직후 3초를 대기했는데(우회 #5), 하네스는 ATT 를 온보딩 직후에
      //    받고 initMarketing 은 그보다 늦게 부르므로 이미 충분히 벌어져 있다.
      //    그래도 같은 턴에 연달아 불린 경우를 대비해 남은 시간만 채운다.
      if (bridge.platform === 'ios') {
        const settle = Number(opts.attSettleMs ?? 3000);
        const since = bridge._attResolvedAt ? Date.now() - bridge._attResolvedAt : Infinity;
        if (since < settle) await new Promise((r) => setTimeout(r, settle - since));
        try { await Adbrix.attAuthorized({ authorized: bridge._attStatus === 'authorized' }); }
        catch { /* 전달 실패가 초기화를 막지는 않는다 */ }
      }

      // 3) 초기화
      const r = await Adbrix.initialize({ appKey: k.appKey, secretKey: k.secretKey });
      if (!r || !r.initialized) return { ok: false, reason: (r && r.reason) || 'init-failed' };
      return { ok: true, handle: Adbrix };
    },

    async track(Adbrix, event, params, bridge) {
      // ⚠️ Adbrix SDK 3.0.10 에는 사용자 식별 API 가 없다. 그래서 user_id 를 이벤트
      // 프로퍼티로 실어 보낸다(poptale 우회 #3 과 같은 이유, 그쪽 SDK 제약이 아직 유효).
      // 단 `abx:` 표준 이벤트에 비표준 키를 넣으면 **수집 자체가 실패**한다(DFINERY 확인).
      const props = { ...(params || {}) };
      if (bridge._userId && !event.startsWith('abx:')) props.user_id = bridge._userId;
      await Adbrix.logEvent({ eventName: event, properties: props });
    },

    // setUser 는 구현하지 않는다 — SDK 에 해당 API 가 없다. track() 이 user_id 를 싣는다.
  },

  appsflyer: {
    async init(bridge, att, opts) {
      const af = att.appsflyer || {};
      if (!af.devKey) return { ok: false, reason: 'no-devkey' };
      let AppsFlyer;
      try { ({ AppsFlyer } = await import('appsflyer-capacitor-plugin')); }
      catch { return { ok: false, reason: 'plugin-missing' }; }
      await AppsFlyer.initSDK({
        appID: af.iosAppId || '',
        devKey: af.devKey,
        isDebug: !!opts.debug,
        waitForATTUserAuthorization: 10, // iOS ATT 동의 대기(초)
        registerOnDeepLink: true,
        registerConversionListener: true,
      });
      if (att.deferredDeepLink) {
        const route = (dl, res) => { if (dl) bridge._emitDeepLink(dl, res); };
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
      return { ok: true, handle: AppsFlyer };
    },
    async track(af, event, params) {
      await af.logEvent({ eventName: event, eventValue: params || {} });
    },
    async setUser(af, userId, traits) {
      if (userId) await af.setCustomerUserId({ cuid: String(userId) });
      if (traits && Object.keys(traits).length) await af.setAdditionalData({ additionalData: traits });
    },
  },
};

export const AppBridge = new AppBridgeImpl();
export default AppBridge;
