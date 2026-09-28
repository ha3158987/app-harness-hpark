import Foundation
import Capacitor
import Photos
import UIKit
import WebKit

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
        CAPPluginMethod(name: "getConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveImageToGallery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "blockCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBrightness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBrightness", returnType: CAPPluginReturnPromise)
    ]

    /**
     * iOS 스와이프 뒤로가기 활성화 (왼쪽 엣지 스와이프 → WKWebView 히스토리 back).
     * iOS 는 안드로이드와 달리 하드웨어 백버튼이 없어, "DEMO" 진입 등 앱 전용 페이지에서
     * 되돌아갈 수단이 없다. Capacitor 기본값은 off 라 여기서 켠다. (Android 는 브릿지 onBackButton 이 처리)
     */
    override public func load() {
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.allowsBackForwardNavigationGestures = true
        }
        // Viewer brightness lifecycle (see setBrightness). UIScreen.brightness IS the system
        // brightness on iOS, so a viewer value must not leak outside the app: hand the system
        // value back whenever the app leaves the foreground (home, app switcher, swipe-kill, lock)
        // and re-apply the viewer value when it comes back.
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(viewerBrightnessSuspend),
                       name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(viewerBrightnessResume),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

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

    /**
     * 이 앱의 iOS 설정 페이지를 연다.
     *
     * 권한을 한 번 거부한 유저를 되돌릴 **유일한 합법 경로**다. 특히 ATT 는 상태가
     * notDetermined 일 때만 시스템 팝업이 뜨므로, 거부 후에는 앱이 다시 물을 방법이 없다.
     * iOS 는 앱 설정 페이지에 "추적 허용" 토글을 표시하므로 여기로 보내면 유저가 직접 켤 수 있다.
     *
     * ⚠️ `설정 > 개인정보 보호 > 추적` 같은 하위 화면으로 직접 가는 URL(App-Prefs:...)은
     * 비공개 API 라 심사에서 리젝된다. 공개 API 는 앱 자신의 설정 페이지까지만 허용한다.
     */
    @objc func openAppSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("설정 URL 생성 실패")
            return
        }
        DispatchQueue.main.async {
            guard UIApplication.shared.canOpenURL(url) else {
                call.reject("설정 앱을 열 수 없습니다")
                return
            }
            UIApplication.shared.open(url, options: [:]) { ok in
                call.resolve(["opened": ok])
            }
        }
    }

    /**
     * base64 이미지를 사진 앨범(갤러리)에 저장.
     * 입력: { base64: String, fileName?: String }. base64 는 data:URL prefix 가 있어도 처리.
     * Info.plist 에 NSPhotoLibraryAddUsageDescription 필요(추가 전용 권한).
     */
    @objc func saveImageToGallery(_ call: CAPPluginCall) {
        guard let raw = call.getString("base64"), !raw.isEmpty else {
            call.reject("base64 가 필요합니다")
            return
        }
        // data:URL prefix(data:image/png;base64,) 가 섞여 와도 안전하게 제거.
        let b64 = raw.contains(",") ? String(raw.split(separator: ",").last ?? "") : raw
        guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data) else {
            call.reject("이미지 디코딩 실패")
            return
        }

        let persist = {
            PHPhotoLibrary.shared().performChanges({
                PHAssetChangeRequest.creationRequestForAsset(from: image)
            }) { success, error in
                DispatchQueue.main.async {
                    if success {
                        call.resolve(["saved": true])
                    } else {
                        call.reject(error?.localizedDescription ?? "갤러리 저장 실패")
                    }
                }
            }
        }

        // 추가 전용(addOnly) 권한만 요청 — 전체 라이브러리 접근은 불필요.
        if #available(iOS 14, *) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                DispatchQueue.main.async {
                    if status == .authorized || status == .limited {
                        persist()
                    } else {
                        call.reject("사진 추가 권한이 거부되었습니다")
                    }
                }
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                DispatchQueue.main.async {
                    if status == .authorized {
                        persist()
                    } else {
                        call.reject("사진 추가 권한이 거부되었습니다")
                    }
                }
            }
        }
    }

    // ── Content protection / Viewer UX ─────────────────────────────────────
    // Brightness is real (UIScreen). Screenshot blocking is NOT available via any public iOS API
    // (unlike Android FLAG_SECURE), so blockCapture resolves as a no-op — screen-recording blur is a follow-up.
    //
    // Unlike Android's window-level screenBrightness, UIScreen.main.brightness is the device's
    // system brightness (Control Center slider moves with it, and the OS keeps it after the app
    // dies). Device check 2026-09-28 (iPhone 13 Pro, iOS 26.6): swipe-killing the app left the
    // whole phone dark, and lock/unlock had the OS restore its own value while the plugin still
    // reported the viewer value. So:
    //   - savedBrightness  = system value captured when the viewer first set a brightness
    //   - viewerBrightness = last value the viewer applied; getBrightness returns THIS, not the
    //     live UIScreen reading (auto-brightness keeps nudging the live value: 0.1 read back as
    //     0.05–0.2 on device)
    //   - willResignActive → restore savedBrightness; didBecomeActive → re-apply viewerBrightness

    private var savedBrightness: CGFloat?
    private var viewerBrightness: CGFloat?

    @objc func blockCapture(_ call: CAPPluginCall) {
        call.resolve()
    }

    /// value 0.0~1.0 applies a viewer brightness; negative (or missing) hands control back to the system.
    @objc func setBrightness(_ call: CAPPluginCall) {
        let value = call.getDouble("value") ?? -1.0
        DispatchQueue.main.async {
            if value < 0 {
                if let s = self.savedBrightness { UIScreen.main.brightness = s }
                self.savedBrightness = nil
                self.viewerBrightness = nil
            } else {
                if self.savedBrightness == nil { self.savedBrightness = UIScreen.main.brightness }
                let v = CGFloat(max(0.0, min(1.0, value)))
                self.viewerBrightness = v
                UIScreen.main.brightness = v
            }
            call.resolve()
        }
    }

    /// Last viewer brightness applied via setBrightness, or -1 (JS maps to null) when following the system.
    @objc func getBrightness(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let v = self.viewerBrightness {
                call.resolve(["value": Double(v)])
            } else {
                call.resolve(["value": -1])
            }
        }
    }

    /// App is leaving the foreground: give the system its brightness back but keep the viewer
    /// state so the value comes back on resume. Runs on the main thread (UIKit notification).
    @objc private func viewerBrightnessSuspend() {
        guard viewerBrightness != nil, let s = savedBrightness else { return }
        UIScreen.main.brightness = s
    }

    /// App is back in the foreground: the OS may have changed the system value while we were
    /// away (lock screen, Control Center), so re-capture it as the restore target, then re-apply.
    @objc private func viewerBrightnessResume() {
        guard let v = viewerBrightness else { return }
        savedBrightness = UIScreen.main.brightness
        UIScreen.main.brightness = v
    }
}
