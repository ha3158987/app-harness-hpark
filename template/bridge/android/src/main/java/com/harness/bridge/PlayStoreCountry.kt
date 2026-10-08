package com.harness.bridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.GetBillingConfigParams
import com.android.billingclient.api.PendingPurchasesParams
import java.util.concurrent.atomic.AtomicBoolean

/**
 * getStoreCountry 의 Android 구현 — 이 기기 Play 계정의 결제 나라(Play Billing getBillingConfigAsync,
 * ISO 3166-1 alpha-2, 예 KR).
 *
 * ⚠️ **Billing 타입은 이 파일에만 둔다.** Play Billing 은 브릿지에 compileOnly 라 런타임에는 IAP 플러그인
 *    (cordova-plugin-purchase)이 넣은 앱에만 있다. Capacitor 는 플러그인을 등록할 때 AppBridgePlugin 에
 *    getDeclaredMethods() 를 부르고(Plugin.initializeActivityLaunchers), ART 는 그때 선언된 메서드 전부 —
 *    Kotlin 람다 본문으로 생긴 합성 메서드까지 — 의 인자 타입을 푼다. 거기에 Billing 타입이 하나라도 있으면
 *    Billing 이 없는 앱은 **시작하자마자** NoClassDefFoundError 로 죽는다(2026-10-08 characterchat-dev
 *    에뮬레이터 실측). 그래서 AppBridgePlugin 은 클래스 이름으로 Billing 이 있는지만 보고, 있을 때만 여기를 부른다.
 *
 * ⚠️ 구매용 연결이 아니다. 구매·구매 갱신은 IAP 플러그인이 자기 연결로 한다. 이 임시 연결은 값을 받거나
 *    실패하면 바로 끊고, 구매 갱신 리스너는 아무것도 하지 않는다.
 *
 * Play Billing 은 메인 스레드 호출을 권장한다 — 연결·응답·끊기를 전부 메인 핸들러로 보낸다.
 */
internal object PlayStoreCountry {
    /** 조회 상한. Play 연결이 응답하지 않아도 웹이 매달리지 않게. */
    private const val TIMEOUT_MS = 5_000L

    /**
     * 나라를 묻는다. [done] 은 메인 스레드에서 정확히 한 번 불린다 — (alpha-2, null) 또는 (null, 이유).
     * 이유: billing-<응답코드>(연결 실패 — 3 = 결제 불가 기기) · config-<응답코드> · no-country · disconnected ·
     * timeout · billing-error / config-error(예외 — 라이브러리 버전 불일치 등).
     */
    fun query(context: Context, done: (String?, String?) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        val settled = AtomicBoolean(false)
        var client: BillingClient? = null

        // 상한·연결 실패·응답이 경합한다 — 처음 하나만 통과한다.
        fun finish(countryCode: String?, reason: String?) {
            if (!settled.compareAndSet(false, true)) return
            main.post {
                // 실패 경로에서도 끊는다 — endConnection 이 라이브러리의 브로드캐스트 수신기·실행기까지 정리한다.
                // 연결이 안 됐던 클라이언트면 라이브러리가 "exception while unbinding service! … Service not registered"
                // 경고를 logcat 에 남기는데, 라이브러리 안에서 잡는 무해한 로그다(9.0.0 에뮬레이터 실측 2026-10-08).
                try { client?.endConnection() } catch (e: Throwable) { /* 이미 끊김 */ }
                done(countryCode, reason)
            }
        }

        main.postDelayed({ finish(null, "timeout") }, TIMEOUT_MS)
        main.post {
            if (settled.get()) return@post // 상한이 먼저 끝났다 — 연결을 만들지 않는다
            try {
                val c = BillingClient.newBuilder(context.applicationContext)
                    .setListener { _, _ -> /* 구매하지 않는다 — 구매 갱신은 IAP 플러그인 몫 */ }
                    // 라이브러리 요구 사항(없으면 build() 가 던진다). 이 연결로는 구매하지 않는다.
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .build()
                client = c
                c.startConnection(object : BillingClientStateListener {
                    override fun onBillingSetupFinished(result: BillingResult) {
                        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                            finish(null, "billing-${result.responseCode}")
                            return
                        }
                        try {
                            c.getBillingConfigAsync(GetBillingConfigParams.newBuilder().build()) { r, config ->
                                if (r.responseCode != BillingClient.BillingResponseCode.OK) {
                                    finish(null, "config-${r.responseCode}")
                                } else {
                                    val code = normalizeAlpha2(config?.countryCode)
                                    finish(code, if (code == null) "no-country" else null)
                                }
                            }
                        } catch (e: Throwable) {
                            finish(null, "config-error")
                        }
                    }

                    override fun onBillingServiceDisconnected() {
                        finish(null, "disconnected")
                    }
                })
            } catch (e: Throwable) {
                // 라이브러리 버전 불일치(NoSuchMethodError 등)도 여기로 — 나라를 모르는 것으로 끝내고 앱은 그대로 둔다.
                finish(null, "billing-error")
            }
        }
    }

    /** Play 가 준 나라 코드를 alpha-2 대문자로 맞춘다. 그 밖의 값(빈 값 등)은 null. */
    private fun normalizeAlpha2(raw: String?): String? {
        val code = raw?.trim()?.uppercase() ?: return null
        return if (code.length == 2 && code.all { it in 'A'..'Z' }) code else null
    }
}
