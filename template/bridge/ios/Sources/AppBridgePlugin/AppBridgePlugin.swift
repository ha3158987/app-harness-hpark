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
        CAPPluginMethod(name: "saveImageToGallery", returnType: CAPPluginReturnPromise)
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
}
