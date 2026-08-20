// @harness/bridge — 타입 정의
// 웹 서비스는 `import { AppBridge } from '@harness/bridge'` 로 사용한다.

export type StatusBarStyle = 'light' | 'dark';
export type Platform = 'ios' | 'android' | 'web';

export interface AppCapabilities {
  push: boolean;
  deepLink: boolean;
  deferredDeepLink: boolean;
  biometric: boolean;
  share: boolean;
  camera: boolean;
  forceUpdate: boolean;
  secureStorage: boolean;
  localNotification: boolean;
  haptics: boolean;
  clipboard: boolean;
  geolocation: boolean;
  auth: boolean;
  iap: boolean;
  /** iOS ATT(추적 동의) 사용. config.tracking.att.enabled 이고 플랫폼이 iOS 일 때만 true. */
  att: boolean;
}

export type TrackingStatus =
  | 'authorized' | 'denied' | 'restricted' | 'notDetermined'
  /** iOS 가 아님 (Android/web) */
  | 'not-applicable'
  /** ATT 플러그인 미설치 등으로 조회 불가 — 캐시되지 않으므로 재시도 가능 */
  | 'unavailable';

export interface TrackingResult {
  status: TrackingStatus;
  /** status === 'authorized' 의 편의 별칭. */
  authorized: boolean;
}

export interface IapProduct {
  id: string;            // 웹/내부 SKU
  storeId: string;       // 스토어 상품 ID
  title: string | null;
  price: string | null;       // 현지화 가격 문자열(앱 가격 티어)
  priceMicros: number | null;
}
export interface PurchaseResult {
  ok: boolean;
  productId?: string;
  transactionId?: string;
  reason?: string;
}

export type AuthProvider = 'email' | 'apple' | 'google' | 'naver' | 'kakao' | 'facebook' | 'x' | 'threads';

export interface AuthResult2 {
  ok: boolean;
  provider?: AuthProvider;
  /** 백엔드가 secret 으로 교환할 OAuth authorization code (PKCE) */
  authorizationCode?: string;
  codeVerifier?: string;
  redirectUri?: string;
  state?: string;
  /** Apple 네이티브 등에서 직접 받는 id token */
  idToken?: string;
  user?: { id?: string; email?: string; name?: string };
  /** sessionEndpoint 설정 시 백엔드 세션 발급 성공 여부 */
  session?: boolean;
  /** 백엔드가 신규 회원이라고 알림 → 웹은 온보딩(약관+추가정보) 화면을 띄워야 함 */
  isNew?: boolean;
  /** 추가정보/약관동의가 더 필요함 (이 경우 브릿지는 새로고침하지 않음) */
  needsProfile?: boolean;
  backend?: unknown;
  reason?: string;
}

export interface AppRuntimeConfig {
  slug: string;
  appName: string;
  appId: string;
  version: { name: string; code: number };
  theme: { primary: string; statusBarStyle: StatusBarStyle; background: string };
  features: Record<string, unknown>;
  navigation: { allowedDomains: string[]; externalInBrowser: boolean };
  marketing?: Record<string, unknown>;
}

export interface PhotoResult { dataUrl?: string; path?: string; format: string }
export interface AuthResult { success: boolean; reason?: string }
export interface NetworkStatus { connected: boolean; connectionType?: string }
export interface GeoResult { lat: number; lng: number; accuracy: number }
export interface ForceUpdateResult { required: boolean; current?: number; min?: number; storeUrl?: string }

/** 커스텀 네이티브 플러그인 인터페이스 (registerPlugin('AppBridge')) */
export interface AppBridgePlugin {
  /** 빌드시 베이크된 app-config.json 을 네이티브 번들에서 읽어 반환 */
  getConfig(): Promise<AppRuntimeConfig>;
}

/** 공유 SDK 표면 */
export interface AppBridgeSDK {
  /** 앱(네이티브 셸) 안에서 실행 중인지. 웹 브라우저면 false */
  readonly isNative: boolean;
  /** 실행 플랫폼 */
  readonly platform: Platform;
  /** 활성화된 기능 플래그. 웹은 이걸 보고 피처 디텍션 분기. */
  readonly capabilities: AppCapabilities;
  /** 런타임 config (ready 이후 채워짐) */
  readonly config: AppRuntimeConfig | null;
  /** config/capabilities 로딩 완료를 기다린다. 앱 시작 시 1회 await. */
  ready(): Promise<AppCapabilities>;

  /** 네이티브 공유 시트(없으면 navigator.share / 클립보드 폴백) */
  share(opts: { title?: string; text?: string; url?: string }): Promise<void>;
  /** 외부 링크 열기 (in-app 브라우저 또는 시스템 브라우저) */
  openExternal(url: string, opts?: { system?: boolean }): Promise<void>;
  /** 원격 푸시 권한 요청 + 토큰 등록. capabilities.push=false 면 no-op. */
  registerPush(): Promise<{ granted: boolean; token?: string }>;

  /**
   * 딥링크 라우팅 핸들러 등록. 직접 딥링크(유니버설/앱 링크)와 디퍼드 딥링크(AppsFlyer)가
   * 같은 콜백으로 들어온다. 등록 전 도착한 콜드스타트 딥링크도 즉시 전달. 반환=해제 함수.
   */
  onDeepLink(handler: (url: string, raw: unknown) => void): () => void;

  /**
   * 강제 업데이트 체크. minVersionUrl JSON 과 현재 versionCode 비교, 구버전이면
   * 전체화면 게이트 표시(showPrompt:false 로 끄고 결과만 받을 수 있음).
   * capabilities.forceUpdate=true 면 ready() 시 자동 1회 실행된다.
   */
  checkForceUpdate(opts?: { showPrompt?: boolean }): Promise<ForceUpdateResult>;

  /** 사진 촬영/선택 (네이티브 카메라, 웹은 <input type=file> 폴백) */
  takePhoto(opts?: {
    source?: 'camera' | 'photos' | 'prompt';
    resultType?: 'dataUrl' | 'uri';
    quality?: number;
    allowEditing?: boolean;
  }): Promise<PhotoResult>;

  /** 생체인증(Face ID/지문). 미지원/실패 시 success:false */
  authenticate(opts?: {
    reason?: string; title?: string; subtitle?: string;
    cancelTitle?: string; fallbackTitle?: string; allowDeviceCredential?: boolean;
  }): Promise<AuthResult>;

  /** 시큐어 스토리지(Keychain/Keystore). 토큰·세션 등 민감 데이터 전용. */
  secureSet(key: string, value: unknown): Promise<boolean>;
  secureGet(key: string): Promise<unknown>;
  secureRemove(key: string): Promise<boolean>;

  /** 일반 환경설정 저장(비암호화). 민감 데이터는 secure* 사용. */
  setPref(key: string, value: unknown): Promise<void>;
  getPref(key: string): Promise<unknown>;
  removePref(key: string): Promise<void>;

  /** 로컬 알림 예약(at 미지정 시 즉시). 반환에 알림 id 포함. */
  scheduleNotification(opts: {
    title?: string; body?: string; at?: Date; id?: number; extra?: Record<string, unknown>;
  }): Promise<{ scheduled: boolean; id?: number; reason?: string }>;
  cancelNotification(id: number): Promise<void>;

  /** 햅틱 피드백 */
  haptic(style?: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error'): Promise<void>;

  /** 클립보드 */
  copyToClipboard(text: string): Promise<boolean>;
  readClipboard(): Promise<string>;

  /** 이미지를 기기 갤러리(사진 앨범)에 저장. 앱=네이티브, 웹=다운로드 폴백 */
  saveImageToGallery(
    input: string | { dataUrl?: string; base64?: string; fileName?: string },
  ): Promise<{ saved: boolean; uri?: string; reason?: string }>;

  /** 현재 위치(권한 요청 포함). 거부/미지원 시 null */
  getLocation(opts?: { highAccuracy?: boolean }): Promise<GeoResult | null>;

  /** 기기 정보 */
  getDeviceInfo(): Promise<Record<string, unknown>>;

  /** 네트워크 상태 + 변화 구독(반환=해제 함수) */
  getNetworkStatus(): Promise<NetworkStatus>;
  onNetworkChange(handler: (status: NetworkStatus) => void): () => void;

  /** 키보드 표시/숨김 이벤트(반환=해제 함수) */
  onKeyboard(handler: (info: { visible: boolean; height: number }) => void): () => void;

  /** 앱 포그라운드 복귀 시 실행(지갑/세션 갱신용). 웹은 focus/visibility 폴백. 반환=해제 함수. */
  onResume(handler: () => void): () => void;

  /** 안전영역 인셋(px) — 노치/펀치홀/제스처바. CSS 만으로 되면 var(--safe-area-inset-*) 직접 사용 권장. */
  getSafeAreaInsets(): { top: number; bottom: number; left: number; right: number };

  /** 백엔드에 보낼 실행 컨텍스트(앱/웹·플랫폼·버전) — 서버가 이벤트/가격/콘텐츠 분기에 사용. */
  context(): { isApp: boolean; platform: Platform; appVersion: string | null; slug: string | null };

  /**
   * 소셜/이메일 로그인. 인증은 WebView 밖(시스템 브라우저 OAuth2+PKCE, Apple은 네이티브)에서
   * 수행하고 딥링크로 복귀한다. authorization code 를 반환하며(백엔드가 secret 으로 교환),
   * config.auth.sessionEndpoint 설정 시 브릿지가 자동으로 백엔드에 보내 세션쿠키를 받는다.
   * 'email' 은 웹이 직접 처리(ok:false, reason:'email-handled-by-web').
   */
  login(provider: AuthProvider, opts?: {
    sessionEndpoint?: string; timeoutMs?: number; reload?: boolean;
  }): Promise<AuthResult2>;

  /**
   * 회원가입 마무리. 신규 회원(login 이 isNew/needsProfile 반환)이 약관 동의 + 추가정보를
   * 입력한 뒤 호출. config.auth.signupEndpoint 로 전송하고 세션쿠키 발급 후 새로고침.
   * profile 예: { nickname, birth, consents: { tos, privacy, age14, marketing } }
   */
  completeSignup(profile: Record<string, unknown>, opts?: { endpoint?: string; reload?: boolean }):
    Promise<{ ok: boolean; user?: unknown; backend?: unknown; reason?: string }>;

  /**
   * 게스트(익명) 로그인. 자격증명 없이 서버 계정 생성 → 로그인 전 지갑/진행상황 보관(IAP 면 사실상 필요).
   * 이후 login()/completeSignup() 으로 실계정 전환 시 백엔드가 게스트를 병합(prevToken 자동 전송).
   */
  guestLogin(opts?: { endpoint?: string }): Promise<{ ok: boolean; guest?: boolean; user?: unknown; reason?: string }>;

  /** 이 기기에서 마지막으로 성공한 로그인 수단(재가입 방지 UX: "마지막 로그인: 카카오") */
  getLastLogin(): Promise<{ provider: AuthProvider } | null>;

  /** 생체인증 빠른 재로그인 켜기/끄기(실로그인 직후). 다음 실행부터 Face ID/지문으로 잠금 해제. */
  enableBiometricLogin(enabled?: boolean): Promise<{ ok: boolean; enabled?: boolean; reason?: string }>;
  biometricLoginEnabled(): Promise<boolean>;
  /** 앱 시작 시 잠금 해제(생체 빠른 로그인이 켜져 있으면 생체인증 요구). */
  unlock(): Promise<{ unlocked: boolean; reason?: string }>;

  /** 로그아웃: 시큐어 토큰 삭제 + (설정 시) 백엔드 세션 종료 + 새로고침 */
  logout(opts?: { endpoint?: string; reload?: boolean }): Promise<{ ok: boolean }>;

  /** 회원탈퇴/계정삭제(스토어 필수). 백엔드(auth.deleteEndpoint)가 삭제. 확인 UI 는 웹이. */
  deleteAccount(opts?: { endpoint?: string; reload?: boolean }): Promise<{ ok: boolean; reason?: string }>;

  /**
   * 이 앱의 OS 설정 페이지를 연다. 브라우저에서는 no-op(`{opened:false}`).
   *
   * **권한을 한 번 거부한 유저를 되돌릴 유일한 경로.** ATT 는 `notDetermined` 일 때만 시스템
   * 팝업이 뜨므로 거부 후에는 앱이 다시 물을 수 없다 — iOS 앱 설정 페이지의 "추적 허용" 토글로
   * 보낸다. Android 는 ATT 가 없지만 권한 2회 거부 시 같은 경로가 필요하다.
   *
   * ⚠️ 하위 화면(설정 > 개인정보 보호 > 추적) 직행은 비공개 API 라 심사 리젝 — 앱 설정
   * 페이지까지만 갈 수 있다. 문구로 "한 단계 더 들어가야 함"을 알려주는 게 정직하다.
   */
  openAppSettings(): Promise<{ opened: boolean; reason?: string }>;

  /**
   * ATT 현재 상태만 조회한다 — **시스템 팝업을 띄우지 않는다.**
   * 사전 설명 화면을 "아직 응답 안 한 유저"에게만 보여주려면 이걸로 먼저 거른다.
   */
  trackingStatus(): Promise<TrackingResult>;

  /**
   * iOS 추적 동의(ATT) 요청. initMarketing 전에 호출한다. iOS 외엔 not-applicable.
   *
   * **멱등하다** — 여러 번 불려도 시스템 팝업은 최대 1회. 진행 중 재호출은 같은 Promise 를 받는다.
   * ⚠️ 설명 없이 곧바로 부르지 말 것: iOS 는 notDetermined 일 때만 팝업을 띄우므로,
   * 맥락 없이 한 번 태운 유저에게는 다시 물을 수 없다.
   */
  requestTracking(): Promise<TrackingResult>;

  /** 이 앱이 쓰는 권한 목록(한국 "접근권한 안내" 화면용). capabilities + config.permissions 로 파생. */
  getPermissionNotice(): Array<{ type: string; label: string; purpose: string; required: boolean }>;
  /** 권한 현재 상태(granted/denied/prompt 등). */
  permissionStatus(type: 'camera' | 'location' | 'notifications'): Promise<string>;
  /** 권한 just-in-time 요청(기능 처음 쓸 때). 사전 설명은 웹이 먼저. */
  requestPermission(type: 'camera' | 'location' | 'notifications'): Promise<string>;

  /** 크래시/에러 모니터링 초기화(보통 자동). config.monitoring.crash 설정 시 ready()에서 1회. */
  initMonitoring(): Promise<void>;
  /** 수동 에러 보고 */
  reportError(err: unknown, context?: Record<string, unknown>): void;

  /**
   * 마케팅 SDK 초기화(앱 시작 시 1회). 키는 네이티브 베이크 config 에서 읽는다.
   * 현재 자동 배선: AppsFlyer(어트리뷰션+디퍼드 딥링크). 그 외 벤더는 슬롯만.
   */
  initMarketing(opts?: {
    debug?: boolean;
    /** 디퍼드/딥링크 도착 시 라우팅 콜백 (onDeepLink 와 동일 경로로 등록됨) */
    onDeepLink?: (url: string, raw: unknown) => void;
    /** 공통 동선 자동 수집 끄기 (기본: config.marketing.autoCapture 따름) */
    autoCapture?: boolean;
  }): Promise<{ initialized: boolean; provider?: string; reason?: string }>;

  /**
   * 통합 이벤트 로깅. 켜진 모든 마케팅 SDK 로 자동 분배.
   * 웹은 벤더를 몰라도 됨: AppBridge.track('purchase', { price: 9900 }).
   * 브라우저(앱 아님)에선 no-op. 초기화 전 호출은 큐잉됐다가 init 후 전송.
   */
  track(event: string, params?: Record<string, unknown>): Promise<void>;

  /** 사용자 식별 — 켜진 벤더 전체에 동일 ID/속성 적용 */
  setUser(userId: string | number, traits?: Record<string, unknown>): Promise<void>;

  /** Android 하드웨어 백버튼 핸들러 등록. handler 가 true 반환 시 기본 동작 억제. */
  onBackButton(handler: () => boolean | Promise<boolean>): () => void;

  /**
   * 인앱결제 상품 목록(스토어 현지화 가격 포함). 앱에서만 의미(웹은 빈 배열 → 웹 가격은 웹이 표시).
   * 디지털 재화는 스토어 IAP 강제. 웹/앱 분기는 isNative 로.
   */
  getProducts(): Promise<IapProduct[]>;
  /** 구매(앱 전용). 영수증은 백엔드가 검증(config.iap.verifyEndpoint)하고 서버 지갑에 적립. */
  purchase(productId: string): Promise<PurchaseResult>;
  /** 구매 복원(재설치/기기변경). 소비형 코인은 서버 지갑이 진실. */
  restorePurchases(): Promise<{ ok: boolean; reason?: string }>;

  // ─── 콘텐츠 보호 / 뷰어 UX ──────────────────────────────────────────────────
  // 네이티브 구현은 dev 가 채운다(template/plugins/viewer/SPEC.md 참조).
  // 미구현 환경에선 호출이 no-op 가 되도록 모든 메서드는 optional.
  /**
   * 화면 캡쳐/스크린샷 방지 on/off. SPA 경로에 따라 토글하려면
   * harness-adapter 의 `autoBlockCaptureOnPaths()` 헬퍼 사용.
   */
  blockCapture?(enabled: boolean): Promise<void> | void;
  /**
   * 뷰어 밝기 (시스템 밝기와 독립). 0.0~1.0, 음수=시스템값 복귀.
   */
  setBrightness?(value: number): Promise<void> | void;
  /** 현재 적용된 뷰어 밝기. setBrightness 호출 후 갱신. */
  getBrightness?(): Promise<number | null>;
}

export const AppBridge: AppBridgeSDK;
export default AppBridge;
