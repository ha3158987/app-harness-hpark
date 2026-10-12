package com.harness.bridge

import android.net.Uri
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient
import com.getcapacitor.Logger

/**
 * 메인 화면이 **네트워크 오류**로 못 뜨면 로컬 오프라인 셸(www/index.html)을 띄운다.
 *
 * 왜 Capacitor `server.errorPath` 를 쓰지 않나(2026-10-07 결정):
 *  - Android 의 errorPath 는 onReceivedHttpError(HTTP 4xx/5xx)에서도 오류 페이지로 갈아 끼운다
 *    → 웹이 직접 그린 404·점검 페이지가 오프라인 셸로 덮인다.
 *  - 실패한 주소를 오류 페이지에 넘기지 않아, 다시 시도하면 딥링크 목적지 대신 홈으로 간다.
 * 그래서 여기서는 메인 프레임 + 연결 계열 오류만 골라, 실패한 주소(from)와 시작 주소(home)를 셸에 넘긴다.
 * 셸(template/src/shell.js)이 '다시 시도'·네트워크 복귀 때 from(없으면 home)으로 돌아간다.
 *
 * 증상(수정 전, 디바이스 랩 실측): 오프라인 콜드 스타트 → WebView 기본 오류 페이지
 * '웹페이지를 사용할 수 없음 · net::ERR_INTERNET_DISCONNECTED' 에 서버 주소가 그대로 노출.
 */
class OfflineShellWebViewClient(private val bridge: Bridge) : BridgeWebViewClient(bridge) {

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        super.onReceivedError(view, request, error)
        if (!request.isForMainFrame) return
        val desc = error.description?.toString() ?: ""
        Logger.debug(TAG, "main frame error ${error.errorCode} $desc ${request.url}")
        if (!isNetworkError(error.errorCode, desc)) return
        val failed = request.url.toString()
        // 셸 자체(로컬 자산)가 실패한 경우는 다시 셸을 띄우지 않는다 — 루프 방지
        if (failed.startsWith(shellBase())) return
        view.loadUrl(
            shellBase() +
                "?from=" + Uri.encode(failed) +
                "&home=" + Uri.encode(bridge.serverUrl ?: ""),
        )
    }

    /**
     * 셸 파일은 여기서 직접 앱 자산(assets/public)으로 응답한다.
     * server.url 이 원격이면 Capacitor 로컬 서버는 https://localhost 를 errorPath 와 '정확히 같은' 주소일 때만
     * 로컬로 내주고 나머지는 네트워크로 보낸다 → 셸이 ERR_CONNECTION_REFUSED 로 안 떴다(실측).
     * errorPath 를 켜면 HTTP 4xx/5xx 갈아 끼우기가 다시 살아나므로, 셸 세 파일만 여기서 처리한다.
     */
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        val name = url.lastPathSegment
        if (url.scheme == bridge.scheme && url.host == bridge.host && url.pathSegments.size == 1 && name in SHELL_FILES) {
            return try {
                WebResourceResponse(SHELL_FILES[name], "utf-8", bridge.context.assets.open("public/$name"))
            } catch (e: Exception) {
                Logger.error(TAG, "셸 자산을 열 수 없다: $name", e)
                null
            }
        }
        return super.shouldInterceptRequest(view, request)
    }

    /** Capacitor 로컬 자산 주소(기본 https://localhost) 의 셸 페이지 */
    private fun shellBase(): String = "${bridge.scheme}://${bridge.host}/index.html"

    companion object {
        private const val TAG = "OfflineShell"

        /** 셸이 쓰는 파일(template/src) → MIME */
        private val SHELL_FILES = mapOf(
            "index.html" to "text/html",
            "styles.css" to "text/css",
            "shell.js" to "application/javascript",
        )

        /**
         * 연결 계열만 셸로 보낸다. WebView 는 Chromium 오류를 WebViewClient.ERROR_* 로 뭉뚱그리는데
         * ERR_INTERNET_DISCONNECTED 같은 핵심 오류가 ERROR_UNKNOWN(-1)으로 오기도 해서(실측),
         * 코드와 함께 Chromium 오류 이름(description)도 본다. 취소(ERR_ABORTED)·인증서·HTTP 상태는
         * 넣지 않는다 — 셸이 아니라 원래 화면(또는 웹의 오류 페이지)이 맞다.
         */
        private val NETWORK_ERROR_CODES = setOf(
            WebViewClient.ERROR_HOST_LOOKUP,
            WebViewClient.ERROR_CONNECT,
            WebViewClient.ERROR_TIMEOUT,
            WebViewClient.ERROR_IO,
        )
        private val NETWORK_NET_ERRORS = listOf(
            "ERR_INTERNET_DISCONNECTED",
            "ERR_NAME_NOT_RESOLVED",
            "ERR_NAME_RESOLUTION_FAILED",
            "ERR_ADDRESS_UNREACHABLE",
            "ERR_CONNECTION_REFUSED",
            "ERR_CONNECTION_RESET",
            "ERR_CONNECTION_CLOSED",
            "ERR_CONNECTION_FAILED",
            "ERR_CONNECTION_TIMED_OUT",
            "ERR_TIMED_OUT",
            "ERR_NETWORK_CHANGED",
            "ERR_PROXY_CONNECTION_FAILED",
        )

        fun isNetworkError(code: Int, description: String): Boolean {
            if (description.contains("ERR_ABORTED")) return false
            return code in NETWORK_ERROR_CODES || NETWORK_NET_ERRORS.any { description.contains(it) }
        }
    }
}
