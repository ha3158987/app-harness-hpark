import Foundation
import Capacitor
import WebKit

/**
 * 메인 화면이 **네트워크 오류**로 못 뜨면 로컬 오프라인 셸(public/index.html)을 띄운다 (iOS).
 *
 * Capacitor 의 WebViewDelegationHandler 를 감싸는 navigationDelegate 프록시다. 실패 콜백 두 개만
 * 가로채고(원래 핸들러에도 그대로 넘긴다) 나머지 위임 메서드는 전부 원래 핸들러로 포워딩한다.
 *
 * 왜 Capacitor `server.errorPath` 를 쓰지 않나(2026-10-07 결정):
 *  - iOS 의 errorPath 는 실패 종류를 가리지 않는다 — 탐색 도중 다른 탐색이 시작될 때의 취소(-999)에도
 *    오류 페이지를 띄워, 진행 중이던 두 번째 탐색까지 덮는다.
 *  - 실패한 주소를 넘기지 않아, 다시 시도하면 딥링크 목적지 대신 홈으로 간다.
 * 그래서 NSURLErrorDomain 의 연결 계열만 골라 실패 주소(from)·시작 주소(home)를 셸에 넘긴다.
 * (수정 전 iOS 는 오프라인이면 빈 흰 화면이었다.)
 */
final class OfflineShellNavigationProxy: NSObject, WKNavigationDelegate {
    private weak var target: WKNavigationDelegate?
    private weak var bridge: CAPBridgeProtocol?

    init(target: WKNavigationDelegate, bridge: CAPBridgeProtocol) {
        self.target = target
        self.bridge = bridge
        super.init()
    }

    // WKWebView 는 navigationDelegate 가 설정될 때 어떤 메서드에 응답하는지 확인해 둔다 —
    // 원래 핸들러가 응답하는 메서드는 모두 '응답한다'고 답하고, 호출은 원래 핸들러로 넘긴다.
    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (target?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let target = target, target.responds(to: aSelector) {
            return target
        }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        target?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        showShellIfNetworkError(webView, error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        target?.webView?(webView, didFail: navigation, withError: error)
        showShellIfNetworkError(webView, error)
    }

    private func showShellIfNetworkError(_ webView: WKWebView, _ error: Error) {
        let nsError = error as NSError
        guard nsError.domain == NSURLErrorDomain, Self.networkErrors.contains(nsError.code),
              let config = bridge?.config else { return }
        let local = config.localURL
        let failed = (nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        // 셸 자체(로컬 자산)가 실패한 경우는 다시 셸을 띄우지 않는다 — 루프 방지
        if let failed = failed, failed.scheme == local.scheme, failed.host == local.host { return }
        // 값은 직접 엄격하게 인코딩한다 — 딥링크(…?contentId=1&seriesId=2)의 & · = 가 셸 쿼리를 쪼개면 안 된다.
        let query = "from=\(Self.encode(failed?.absoluteString ?? ""))&home=\(Self.encode(config.serverURL.absoluteString))"
        guard let shellURL = URL(string: local.appendingPathComponent("index.html").absoluteString + "?" + query) else { return }
        webView.load(URLRequest(url: shellURL))
    }

    private static let unreserved = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func encode(_ value: String) -> String {
        return value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }

    /// 연결 계열만. 취소(-999)·인증서·WebKit 정책 오류는 넣지 않는다 — 셸이 아니라 원래 화면이 맞다.
    private static let networkErrors: Set<Int> = [
        NSURLErrorNotConnectedToInternet,
        NSURLErrorNetworkConnectionLost,
        NSURLErrorTimedOut,
        NSURLErrorCannotFindHost,
        NSURLErrorCannotConnectToHost,
        NSURLErrorDNSLookupFailed,
        NSURLErrorInternationalRoamingOff,
        NSURLErrorDataNotAllowed,
    ]
}
