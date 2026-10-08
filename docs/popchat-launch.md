# Popchat launch scene

`characterchat` and `characterchat-dev` bundle `template/launch/popchat` locally. iOS attaches a local WKWebView to the Capacitor root; Android attaches a local WebView above the Capacitor view. Neither launch view loads network resources or changes the main application's bridge/navigation delegates.

The approved scene's artwork, diagonal crops, Pretendard subsets, SVG logo, light sweep and timing share one source on both platforms. `first-frame.png` is a rendered still used while the local renderer starts. `apps/characterchat-dev/splash*.png` supplies the iOS OS launch image. Android 12+ requires its system icon splash first; the full scene follows as soon as the activity starts.

After two painted frames, motion starts at 120ms and settles after 1900ms. The native host checks that the main document has completed loading, then releases the scene after its introductory motion. While loading continues, the subtle light animation repeats. A 15-second escape reveals the app's error/retry UI. Reduced-motion mode removes the introduction. `PopchatLaunch/1` in the user agent lets the web frontend skip its older remote launch animation.

Generation updates existing native projects idempotently. `node --test test/native-launch.test.mjs` covers regeneration and offline asset placement. Changes require a new binary; publishing the remote web app alone does not update this scene.

DEV release: version 1.0.0 (20), release workflow on the feature branch, iOS TestFlight and Android Firebase App Distribution (`aipia_internal`). Production stores are not part of this release.
