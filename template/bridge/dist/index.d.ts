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

  /** 현재 위치(권한 요청 포함). 거부/미지원 시 null */
  getLocation(opts?: { highAccuracy?: boolean }): Promise<GeoResult | null>;

  /** 기기 정보 */
  getDeviceInfo(): Promise<Record<string, unknown>>;

  /** 네트워크 상태 + 변화 구독(반환=해제 함수) */
  getNetworkStatus(): Promise<NetworkStatus>;
  onNetworkChange(handler: (status: NetworkStatus) => void): () => void;

  /** 키보드 표시/숨김 이벤트(반환=해제 함수) */
  onKeyboard(handler: (info: { visible: boolean; height: number }) => void): () => void;

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
}

export const AppBridge: AppBridgeSDK;
export default AppBridge;
