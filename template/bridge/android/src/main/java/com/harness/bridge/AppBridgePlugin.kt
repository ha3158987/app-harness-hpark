package com.harness.bridge

import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
import androidx.core.view.WindowCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.OutputStream

/**
 * AppBridge — 커스텀 Capacitor 플러그인 (Android).
 *
 * 빌드시 generate-app.mjs 가 베이크한 assets/public/app-config.json 을 읽어
 * 런타임 config 를 JS(SDK)에 돌려준다. server.url 로 원격 웹을 로드하는 구조라
 * JS fetch 로는 번들 파일을 못 읽기 때문에 네이티브가 이 역할을 맡는다.
 */
@CapacitorPlugin(name = "AppBridge")
class AppBridgePlugin : Plugin() {

    /**
     * 앱 시작 시 상태바/네비바 아이콘 색을 theme.statusBarStyle 에 맞춰 강제 적용한다.
     *
     * 배경: @capacitor-community/safe-area 는 config 의 statusBarStyle 을 "시작 시"엔 적용하지 않는다
     * (런타임 setSystemBarsStyle 호출/구성변경 시에만 적용). 그래서 기기가 다크모드면 시작 시 시스템 기본값
     * (밝은 배경 위 '흰 아이콘')이 되어 라이트 배경 앱에서 시간·배터리·통신 아이콘이 안 보였다.
     * 네이티브가 시작 시 1회 강제 적용해 env()/edge-to-edge·기기 다크모드와 무관하게 아이콘 대비를 보장한다.
     */
    override fun load() {
        super.load()
        val act = activity ?: return
        // theme.statusBarStyle: "light" = 밝은 배경용 '어두운 아이콘'(appearanceLight=true), "dark" = '흰 아이콘'.
        val lightBars = readStatusBarStyle() != "dark"
        // decorView.post: 다른 플러그인(safe-area 의 edge-to-edge 설정) load() 이후에 실행되도록 보장.
        act.window.decorView.post {
            val controller = WindowCompat.getInsetsController(act.window, act.window.decorView)
            controller.isAppearanceLightStatusBars = lightBars
            controller.isAppearanceLightNavigationBars = lightBars
        }
    }

    private fun readStatusBarStyle(): String {
        return try {
            val json = context.assets
                .open("public/app-config.json")
                .bufferedReader()
                .use { it.readText() }
            JSObject(json).getJSObject("theme")?.getString("statusBarStyle") ?: "light"
        } catch (e: Exception) {
            "light"
        }
    }

    @PluginMethod
    fun getConfig(call: PluginCall) {
        try {
            val json = context.assets
                .open("public/app-config.json")
                .bufferedReader()
                .use { it.readText() }
            call.resolve(JSObject(json))
        } catch (e: Exception) {
            call.reject("app-config.json 을 읽을 수 없습니다: ${e.message}", e)
        }
    }

    /**
     * 이 앱의 시스템 설정 페이지("앱 정보")를 연다.
     *
     * 권한을 한 번 거부한 유저를 되돌릴 경로다 — Android 는 두 번 거부하면 런타임 권한
     * 다이얼로그가 아예 안 뜨므로(shouldShowRequestPermissionRationale=false) 설정으로
     * 보내는 것 외에 방법이 없다. iOS 의 ATT 거부 대응과 같은 목적으로 API 를 맞춘다.
     *
     * (Android 에 ATT 개념은 없다. 여기서는 알림·카메라·위치 권한 회복용으로 쓰인다.)
     */
    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", context.packageName, null)
                // 설정 화면을 별도 태스크로 — 앱 태스크 스택에 끼면 뒤로가기 동작이 어긋난다.
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            val res = JSObject()
            res.put("opened", true)
            call.resolve(res)
        } catch (e: Exception) {
            call.reject("설정 화면을 열 수 없습니다: ${e.message}", e)
        }
    }

    /**
     * base64 이미지를 갤러리(MediaStore Pictures)에 저장.
     * 입력: { base64: String, fileName?: String }. base64 는 data:URL prefix 가 있어도 처리.
     * API 29+ 는 권한 불필요(RELATIVE_PATH), 그 이하는 WRITE_EXTERNAL_STORAGE 필요.
     */
    @PluginMethod
    fun saveImageToGallery(call: PluginCall) {
        val raw = call.getString("base64")
        if (raw.isNullOrEmpty()) {
            call.reject("base64 가 필요합니다")
            return
        }
        val fileName = call.getString("fileName") ?: "capture_${System.currentTimeMillis()}.png"
        // data:URL prefix(data:image/png;base64,) 가 섞여 와도 안전하게 제거.
        val b64 = if (raw.contains(",")) raw.substringAfterLast(",") else raw
        val bytes = try {
            Base64.decode(b64, Base64.DEFAULT)
        } catch (e: Exception) {
            call.reject("base64 디코딩 실패: ${e.message}", e)
            return
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        if (bitmap == null) {
            call.reject("이미지 디코딩 실패")
            return
        }

        try {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES)
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            if (uri == null) {
                call.reject("MediaStore 항목 생성 실패")
                return
            }
            resolver.openOutputStream(uri).use { out: OutputStream? ->
                if (out == null) {
                    call.reject("출력 스트림 열기 실패")
                    return
                }
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }
            val ret = JSObject()
            ret.put("saved", true)
            ret.put("uri", uri.toString())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("갤러리 저장 실패: ${e.message}", e)
        }
    }

    // ── Content protection / Viewer UX ─────────────────────────────────────
    // Enabled only for apps whose config has features.viewer (captureBlock/brightness).
    // The JS SDK gates on capabilities.viewer; these native methods do the actual work.

    /** Screenshot / screen-recording block via window FLAG_SECURE (also hides the recent-apps thumbnail). */
    @PluginMethod
    fun blockCapture(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        val act = activity ?: run { call.reject("no activity"); return }
        act.runOnUiThread {
            if (enabled) {
                act.window.setFlags(
                    WindowManager.LayoutParams.FLAG_SECURE,
                    WindowManager.LayoutParams.FLAG_SECURE
                )
            } else {
                act.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
            call.resolve()
        }
    }

    /** Per-window brightness (independent of the system value). value 0.0..1.0; negative restores the system value. */
    @PluginMethod
    fun setBrightness(call: PluginCall) {
        val value = call.getDouble("value") ?: -1.0
        val act = activity ?: run { call.reject("no activity"); return }
        act.runOnUiThread {
            val lp = act.window.attributes
            lp.screenBrightness =
                if (value < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                else value.coerceIn(0.0, 1.0).toFloat()
            act.window.attributes = lp
            call.resolve()
        }
    }

    /** Current window brightness override, or -1 (JS maps to null) when following the system value. */
    @PluginMethod
    fun getBrightness(call: PluginCall) {
        val act = activity ?: run { call.reject("no activity"); return }
        act.runOnUiThread {
            val b = act.window.attributes.screenBrightness
            val res = JSObject()
            res.put("value", if (b < 0f) -1.0 else b.toDouble())
            call.resolve(res)
        }
    }
}
