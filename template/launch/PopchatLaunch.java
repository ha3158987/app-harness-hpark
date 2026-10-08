// POPCHAT_NATIVE_LAUNCH_MOTION
public class MainActivity extends BridgeActivity {
    private android.webkit.WebView launch;
    private android.widget.FrameLayout launchContainer;
    private final android.os.Handler launchHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean launchClosing;
    private boolean appReady;

    @Override public void onCreate(android.os.Bundle state) {
        super.onCreate(state);
        launchContainer = new android.widget.FrameLayout(this);
        launchContainer.setBackgroundColor(android.graphics.Color.rgb(8,17,30));
        android.widget.ImageView still = new android.widget.ImageView(this);
        try (java.io.InputStream image = getAssets().open("public/popchat-launch/first-frame.png")) {
            still.setImageDrawable(android.graphics.drawable.Drawable.createFromStream(image, null));
        } catch (java.io.IOException ignored) { still.setImageResource(R.drawable.splash); }
        still.setScaleType(android.widget.ImageView.ScaleType.CENTER_CROP);
        launchContainer.addView(still, new android.widget.FrameLayout.LayoutParams(-1,-1));
        launch = new android.webkit.WebView(this);
        launch.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        launch.setAlpha(0f);
        launch.getSettings().setJavaScriptEnabled(true);
        launch.getSettings().setBlockNetworkLoads(true);
        launch.getSettings().setAllowContentAccess(false);
        launch.getSettings().setAllowFileAccess(true);
        launch.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface public void event(String value) {
                runOnUiThread(() -> {
                    if (launchClosing) return;
                    if ("painted".equals(value)) launch.setAlpha(1f);
                    if ("finished".equals(value)) dismissLaunch();
                });
            }
        }, "PopchatLaunch");
        launch.setWebViewClient(new android.webkit.WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(android.webkit.WebView view, android.webkit.WebResourceRequest request) { return true; }
            @Override public void onReceivedError(android.webkit.WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) dismissLaunch();
            }
        });
        launchContainer.addView(launch, new android.widget.FrameLayout.LayoutParams(-1,-1));
        addContentView(launchContainer, new android.view.ViewGroup.LayoutParams(-1,-1));
        launch.loadUrl("file:///android_asset/public/popchat-launch/index.html");
        launchHandler.postDelayed(this::checkLaunchReady, 200);
        launchHandler.postDelayed(this::dismissLaunch, 15000);
    }

    private void checkLaunchReady() {
        if (launchClosing) return;
        android.webkit.WebView app = getBridge().getWebView();
        if (app.getProgress() == 100 && app.getUrl() != null) {
            app.evaluateJavascript("document.readyState === 'complete' && !!document.body && document.body.children.length > 0", result -> {
                if (launchClosing) return;
                appReady = "true".equals(result);
                if (appReady) launch.evaluateJavascript("window.finishLaunch && window.finishLaunch()", null);
                // Retry until the local scene has received readiness, even if it loads later.
                launchHandler.postDelayed(this::checkLaunchReady, 200);
            });
        } else launchHandler.postDelayed(this::checkLaunchReady, 200);
    }

    private void dismissLaunch() {
        if (launchClosing) return;
        launchClosing = true;
        launchHandler.removeCallbacksAndMessages(null);
        launchContainer.animate().alpha(0f).setDuration(700).withEndAction(() -> {
            ((android.view.ViewGroup)launchContainer.getParent()).removeView(launchContainer);
            launch.removeJavascriptInterface("PopchatLaunch");
            launch.stopLoading();
            launch.destroy();
        }).start();
    }

    @Override public void onDestroy() {
        launchHandler.removeCallbacksAndMessages(null);
        if (!launchClosing && launch != null) {
            launchClosing = true;
            launch.removeJavascriptInterface("PopchatLaunch");
            launch.destroy();
        }
        super.onDestroy();
    }
}
