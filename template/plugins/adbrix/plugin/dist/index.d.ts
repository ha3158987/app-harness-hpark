import type { PluginListenerHandle } from '@capacitor/core';

/** 디퍼드 딥링크 수신 이벤트. `url` 만 보면 되고 `result` 는 SDK 원본 코드다. */
export interface DeferredDeepLinkEvent {
  url: string;
  result?: string | number;
}

export interface AdbrixPlugin {
  /**
   * 디퍼드 딥링크 자동 실행 차단 + 수신 등록. **initialize() 보다 먼저** 호출할 것.
   * 안 부르면 Android SDK 가 링크를 받는 즉시 자기가 Activity 를 띄워 앱 라우팅과 충돌한다.
   */
  blockDeferredDeepLink(): Promise<{ blocked: boolean; error?: string }>;

  /** SDK 초기화. 키가 비어도 reject 하지 않고 `initialized:false` 로 반환한다. */
  initialize(options: { appKey: string; secretKey: string }): Promise<{ initialized: boolean; reason?: string }>;

  /** iOS ATT 결과 전달. **initialize() 보다 먼저.** Android 는 no-op. */
  attAuthorized(options: { authorized: boolean }): Promise<{ applied: boolean; reason?: string }>;

  logEvent(options: { eventName: string; properties?: Record<string, unknown> }): Promise<void>;

  /** 수집 on/off. 사용자가 광고 개인화를 끄면 false. */
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;

  /** addListener 등록 후 호출. 리스너가 붙기 전 도착해 버퍼링된 딥링크를 흘려보낸다. */
  flushPendingDeepLink(): Promise<void>;

  addListener(
    eventName: 'deferredDeepLink',
    listener: (event: DeferredDeepLinkEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export declare const Adbrix: AdbrixPlugin;
export default Adbrix;
