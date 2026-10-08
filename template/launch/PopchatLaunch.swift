// Native host for the approved, bundled launch scene. Never loads network content.
private final class PopchatLaunch: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private weak var root: CAPBridgeViewController?
    private var scene: WKWebView!
    private var poll: Timer?
    private var timeout: DispatchWorkItem?
    private var checking = false
    private var closing = false

    static func show(over root: CAPBridgeViewController) {
        let launch = PopchatLaunch()
        launch.root = root
        root.addChild(launch)
        launch.view.frame = root.view.bounds
        launch.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        root.view.addSubview(launch.view)
        launch.didMove(toParent: root)
        launch.begin()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 8/255, green: 17/255, blue: 30/255, alpha: 1)
        let path = Bundle.main.path(forResource: "first-frame", ofType: "png", inDirectory: "public/popchat-launch")
        let still = UIImageView(image: path.flatMap { UIImage(contentsOfFile: $0) })
        still.contentMode = .scaleAspectFill
        still.clipsToBounds = true
        still.frame = view.bounds
        still.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(still)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "popchatLaunch")
        scene = WKWebView(frame: view.bounds, configuration: configuration)
        scene.navigationDelegate = self
        scene.isOpaque = false
        scene.backgroundColor = .clear
        scene.alpha = 0
        scene.scrollView.isScrollEnabled = false
        scene.scrollView.contentInsetAdjustmentBehavior = .never
        scene.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(scene)
    }

    private func begin() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "public/popchat-launch") else {
            dismissScene(); return
        }
        scene.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        poll = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.checkApp() }
        // A failed connection must reveal the shell's error/retry UI, never trap users.
        let escape = DispatchWorkItem { [weak self] in self?.dismissScene() }
        timeout = escape
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: escape)
    }

    private func checkApp() {
        guard !checking, !closing, let web = root?.bridge?.webView, !web.isLoading, web.url != nil else { return }
        checking = true
        web.evaluateJavaScript("document.readyState === 'complete' && !!document.body && document.body.children.length > 0") { [weak self] result, _ in
            guard let self = self else { return }
            self.checking = false
            if result as? Bool == true {
                self.scene.evaluateJavaScript("typeof window.finishLaunch === 'function' ? (window.finishLaunch(), true) : false") { [weak self] acknowledged, _ in
                    if acknowledged as? Bool == true { self?.poll?.invalidate() }
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let event = message.body as? String else { return }
        if event == "painted" { scene.alpha = 1 }
        if event == "finished" { dismissScene() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { dismissScene() }

    private func dismissScene() {
        guard !closing else { return }
        closing = true
        poll?.invalidate()
        timeout?.cancel()
        scene.configuration.userContentController.removeScriptMessageHandler(forName: "popchatLaunch")
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.7, animations: {
            self.view.alpha = 0
        }) { _ in
            self.scene.stopLoading()
            self.willMove(toParent: nil)
            self.view.removeFromSuperview()
            self.removeFromParent()
        }
    }
}
