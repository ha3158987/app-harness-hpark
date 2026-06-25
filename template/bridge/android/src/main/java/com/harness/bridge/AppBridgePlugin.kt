package com.harness.bridge

import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
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
}
