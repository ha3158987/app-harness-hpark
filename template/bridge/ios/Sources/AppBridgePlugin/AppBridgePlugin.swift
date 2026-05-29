import Foundation
import Capacitor

/**
 * AppBridge — 커스텀 Capacitor 플러그인 (iOS).
 *
 * generate-app.mjs 가 베이크한 public/app-config.json (앱 번들 포함)을 읽어
 * 런타임 config 를 JS(SDK)에 돌려준다. server.url 원격 로드 구조라 JS fetch 로는
 * 번들 파일을 못 읽으므로 네이티브가 이 역할을 맡는다.
 */
@objc(AppBridgePlugin)
public class AppBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppBridgePlugin"
    public let jsName = "AppBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfig", returnType: CAPPluginReturnPromise)
    ]

    @objc func getConfig(_ call: CAPPluginCall) {
        guard let url = Bundle.main.url(forResource: "app-config", withExtension: "json", subdirectory: "public")
                ?? Bundle.main.url(forResource: "app-config", withExtension: "json") else {
            call.reject("app-config.json 을 번들에서 찾을 수 없습니다")
            return
        }
        do {
            let data = try Data(contentsOf: url)
            guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                call.reject("app-config.json 파싱 실패")
                return
            }
            call.resolve(obj)
        } catch {
            call.reject("app-config.json 을 읽을 수 없습니다: \(error.localizedDescription)")
        }
    }
}
