import Foundation
import Capacitor
import AdbrixSDK

/**
 * Adbrix(DFINERY) Capacitor 플러그인 — iOS.
 *
 * 공식 Capacitor 플러그인이 없어(2026-08 전수 확인) 하네스가 직접 유지한다.
 * CocoaPods `adbrix2.0` 3.2.1 의 공개 API 만 호출한다.
 *
 * **호출 순서** — JS(브릿지 어댑터)가 지킨다:
 *   blockDeferredDeepLink() → attAuthorized(:) → initialize(:)
 * ATT 결과를 init 전에 넘겨야 IDFA 가 어트리뷰션에 반영된다.
 *
 * ⚠️ iOS 의 "차단"은 SDK 호출이 아니다. 딜리게이트는 항상 붙여 두고, 받은 링크를 우리가
 * 열지 않고 JS 로만 넘기면 그게 곧 차단이다. (SDK 자체는 링크를 열지 않는다 — 여는 쪽은 래퍼다.)
 */
@objc(AdbrixPlugin)
public class AdbrixPlugin: CAPPlugin, CAPBridgedPlugin, AdbrixDeferredDeepLinkDelegate {
    public let identifier = "AdbrixPlugin"
    public let jsName = "Adbrix"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "blockDeferredDeepLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attAuthorized", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flushPendingDeepLink", returnType: CAPPluginReturnPromise)
    ]

    private var initialized = false
    private var listenerAttached = false
    /// 리스너가 붙기 전에 도착한 디퍼드 딥링크. 설치 첫 실행에서 실제로 발생한다.
    private var pendingDeferred: [String: Any]?
    /// init 전에 도착한 유니버설 링크/커스텀 스킴. SDK 는 init 후에만 받는다.
    private var pendingOpenURL: URL?

    override public func load() {
        Adbrix.shared().setDeferredDeepLinkDelegate(self)

        // Capacitor 가 AppDelegate 의 openURL / continueUserActivity 를 알림으로 재발행한다.
        // 이 경로를 잡아야 트래킹 링크 클릭이 어트리뷰션에 붙는다.
        // (AppDelegate 를 직접 고치지 않아도 되는 공식 경로다.)
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleOpenURL(_:)),
            name: Notification.Name.capacitorOpenURL, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleUniversalLink(_:)),
            name: Notification.Name.capacitorOpenUniversalLink, object: nil)
    }

    @objc private func handleOpenURL(_ note: Notification) {
        guard let object = note.object as? [String: Any],
              let url = object["url"] as? URL else { return }
        forwardDeepLink(url)
    }

    @objc private func handleUniversalLink(_ note: Notification) {
        guard let object = note.object as? [String: Any],
              let url = object["url"] as? URL else { return }
        forwardDeepLink(url)
    }

    private func forwardDeepLink(_ url: URL) {
        if initialized { Adbrix.shared().deepLinkOpen(url: url) }
        else { pendingOpenURL = url }  // init 후에 흘려보낸다
    }

    // MARK: - 플러그인 메서드

    /// iOS 는 딜리게이트를 load() 에서 이미 붙였다. 우리가 링크를 직접 열지 않는 것이 곧 차단이다.
    @objc func blockDeferredDeepLink(_ call: CAPPluginCall) {
        call.resolve(["blocked": true])
    }

    /// ATT 결과 전달. **initialize 보다 먼저** 부를 것 — 늦으면 IDFA 가 어트리뷰션에 안 붙는다.
    @objc func attAuthorized(_ call: CAPPluginCall) {
        let authorized = call.getBool("authorized") ?? false
        Adbrix.shared().attAuthorized(authorized)
        call.resolve(["applied": true])
    }

    /// SDK 초기화. 키가 비어 있어도 **반드시 resolve 한다**(호출부 무한 대기 방지).
    @objc func initialize(_ call: CAPPluginCall) {
        let appKey = call.getString("appKey") ?? ""
        let secretKey = call.getString("secretKey") ?? ""
        guard !appKey.isEmpty, !secretKey.isEmpty else {
            call.resolve(["initialized": false, "reason": "no-keys"]); return
        }
        if !initialized {
            Adbrix.shared().sdkInit(appkey: appKey, secretKey: secretKey)
            initialized = true
            if let url = pendingOpenURL {
                Adbrix.shared().deepLinkOpen(url: url)
                pendingOpenURL = nil
            }
        }
        call.resolve(["initialized": true])
    }

    @objc func logEvent(_ call: CAPPluginCall) {
        guard let name = call.getString("eventName"), !name.isEmpty else {
            call.reject("eventName is required"); return
        }
        let props = call.getObject("properties") ?? [:]
        Adbrix.shared().logEvent(name: name, properties: props)
        call.resolve()
    }

    @objc func setEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        if enabled { Adbrix.shared().enableSDK() } else { Adbrix.shared().disableSDK() }
        call.resolve(["enabled": enabled])
    }

    @objc func flushPendingDeepLink(_ call: CAPPluginCall) {
        listenerAttached = true
        if let p = pendingDeferred { notifyListeners("deferredDeepLink", data: p); pendingDeferred = nil }
        call.resolve()
    }

    // MARK: - AdbrixDeferredDeepLinkDelegate

    public func didReceive(deferredDeepLink: AdbrixDeepLink) {
        guard let url = deferredDeepLink.deepLink, !url.isEmpty else { return }
        // ⚠️ 여기서 UIApplication.open 을 부르면 안 된다. 앱 라우팅과 충돌한다(poptale 우회 #1).
        let payload: [String: Any] = ["url": url, "result": deferredDeepLink.result.rawValue]
        if listenerAttached { notifyListeners("deferredDeepLink", data: payload) }
        else { pendingDeferred = payload }
    }
}
