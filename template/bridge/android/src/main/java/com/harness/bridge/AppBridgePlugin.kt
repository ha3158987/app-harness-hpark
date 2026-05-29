package com.harness.bridge

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

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
}
