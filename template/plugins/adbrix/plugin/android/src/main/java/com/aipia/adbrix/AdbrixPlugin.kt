package com.aipia.adbrix

import android.app.Application
import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.igaworks.adbrix.Adbrix
import com.igaworks.adbrix.AdbrixActivityLifecycleCallbacks
import com.igaworks.adbrix.AdbrixDeepLink
import com.igaworks.adbrix.AdbrixDeferredDeepLinkListener
import org.json.JSONObject

/**
 * Adbrix(DFINERY) Capacitor 플러그인 — Android.
 *
 * 공식 Capacitor 플러그인이 존재하지 않아(2026-08 npm/GitHub/공식문서 전수 확인) 하네스가 직접 유지한다.
 * 네이티브 SDK `com.igaworks.adbrix:android-sdk:3.0.10` 의 공개 API 만 호출한다.
 *
 * **호출 순서가 중요하다.** JS(브릿지 어댑터)가 아래 순서를 지킨다:
 *   blockDeferredDeepLink() → initialize() → (이후) logEvent()
 * block 을 init 뒤에 부르면 SDK 가 디퍼드 딥링크를 받는 즉시 **자기가 Activity 를 띄워버려**
 * 앱의 라우팅과 충돌한다(poptale 우회 #1 과 같은 사고).
 */
@CapacitorPlugin(name = "Adbrix")
class AdbrixPlugin : Plugin() {

    private var lifecycleRegistered = false
    private var initialized = false

    /** 아직 JS 리스너가 안 붙었을 때 도착한 디퍼드 딥링크. 붙는 즉시 흘려보낸다. */
    private var pendingDeferred: JSObject? = null
    private var listenerAttached = false

    override fun load() {
        super.load()
        // 세션 집계에 필요. Application 콜백이라 한 번만 등록한다.
        val app = activity?.application
        if (app != null && !lifecycleRegistered) {
            app.registerActivityLifecycleCallbacks(AdbrixActivityLifecycleCallbacks())
            lifecycleRegistered = true
        }
    }

    /**
     * 디퍼드 딥링크 자동 실행 차단 + 수신 등록. **initialize() 보다 먼저** 부를 것.
     * 받은 링크는 SDK 가 여는 대신 `deferredDeepLink` 이벤트로 JS 에 넘긴다.
     */
    @PluginMethod
    fun blockDeferredDeepLink(call: PluginCall) {
        try {
            Adbrix.getInstance().blockDeferredDeepLinkLaunch(object : AdbrixDeferredDeepLinkListener {
                override fun onDeferredDeepLinkReceived(context: Context?, deepLink: AdbrixDeepLink?) {
                    val url = deepLink?.deepLink
                    if (url.isNullOrEmpty()) return
                    val payload = JSObject().apply {
                        put("url", url)
                        put("result", deepLink.result?.toString())
                    }
                    // 리스너가 아직 안 붙었으면 버퍼링한다. 설치 첫 실행에서 SDK 콜백이
                    // 웹 로딩보다 먼저 오는 경우가 실제로 있다(팝테일 글로벌 가이드 G10 / SCRUM1-697).
                    if (listenerAttached) notifyListeners("deferredDeepLink", payload)
                    else pendingDeferred = payload
                }
            })
            call.resolve(JSObject().put("blocked", true))
        } catch (e: Throwable) {
            // 차단에 실패해도 앱은 떠야 한다. JS 가 ok=false 를 보고 판단한다.
            call.resolve(JSObject().put("blocked", false).put("error", e.message ?: "unknown"))
        }
    }

    /** SDK 초기화. 키가 비어 있어도 **반드시 resolve 한다**(poptale 우회 #4 — 무한 대기 방지). */
    @PluginMethod
    fun initialize(call: PluginCall) {
        val appKey = call.getString("appKey") ?: ""
        val secretKey = call.getString("secretKey") ?: ""
        if (appKey.isEmpty() || secretKey.isEmpty()) {
            call.resolve(JSObject().put("initialized", false).put("reason", "no-keys")); return
        }
        val app = activity?.application
        if (app == null) {
            call.resolve(JSObject().put("initialized", false).put("reason", "no-application")); return
        }
        try {
            if (!initialized) {
                // 이중 init 은 네이티브 SDK 상태를 리셋시킬 수 있어 한 번만 부른다.
                Adbrix.getInstance().init(app as Application, appKey, secretKey)
                initialized = true
            }
            call.resolve(JSObject().put("initialized", true))
        } catch (e: Throwable) {
            call.resolve(JSObject().put("initialized", false).put("reason", e.message ?: "init-failed"))
        }
    }

    /** iOS 전용 API. Android 에선 no-op 이지만 JS 가 분기 없이 부를 수 있게 받아만 준다. */
    @PluginMethod
    fun attAuthorized(call: PluginCall) {
        call.resolve(JSObject().put("applied", false).put("reason", "ios-only"))
    }

    @PluginMethod
    fun logEvent(call: PluginCall) {
        val name = call.getString("eventName")
        if (name.isNullOrEmpty()) { call.reject("eventName is required"); return }
        try {
            val props = call.getObject("properties")
            if (props != null && props.length() > 0) {
                Adbrix.getInstance().logEvent(name, JSONObject(props.toString()))
            } else {
                Adbrix.getInstance().logEvent(name)
            }
            call.resolve()
        } catch (e: Throwable) {
            call.reject(e.message ?: "logEvent failed", e as? Exception)
        }
    }

    /** 수집 on/off — 사용자가 광고 개인화를 끄면 disable 한다. */
    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        try {
            if (enabled) Adbrix.getInstance().enableSDK() else Adbrix.getInstance().disableSDK()
            call.resolve(JSObject().put("enabled", enabled))
        } catch (e: Throwable) {
            call.reject(e.message ?: "setEnabled failed", e as? Exception)
        }
    }

    /** JS 가 addListener('deferredDeepLink') 를 건 뒤 부른다. 버퍼에 있던 링크를 흘려보낸다. */
    @PluginMethod
    fun flushPendingDeepLink(call: PluginCall) {
        listenerAttached = true
        pendingDeferred?.let { notifyListeners("deferredDeepLink", it); pendingDeferred = null }
        call.resolve()
    }
}
