// @aipia-team/capacitor-adbrix — Adbrix(DFINERY) Capacitor 플러그인 (JS 진입점)
//
// 네이티브 구현: android/src/.../AdbrixPlugin.kt, ios/Sources/AdbrixPlugin/AdbrixPlugin.swift
// 브라우저에서는 전부 no-op 이라 웹 개발 중 분기 없이 호출해도 안전하다.
import { registerPlugin } from '@capacitor/core';

const Adbrix = registerPlugin('Adbrix', {
  web: () => ({
    async blockDeferredDeepLink() { return { blocked: false }; },
    async initialize() { return { initialized: false, reason: 'not-native' }; },
    async attAuthorized() { return { applied: false, reason: 'not-native' }; },
    async logEvent() { },
    async setEnabled({ enabled }) { return { enabled }; },
    async flushPendingDeepLink() { },
    async addListener() { return { remove: async () => {} }; },
  }),
});

export { Adbrix };
export default Adbrix;
