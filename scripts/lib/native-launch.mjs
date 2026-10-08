import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';

export const hasNativeLaunch = cfg => ['characterchat', 'characterchat-dev'].includes(cfg.slug);

// Local-only presentation shared by both platforms. It does not replace the
// Capacitor WebView, its navigation delegate, authentication or plugin bridge.
export function patchNativeLaunchMotion(root, buildDir, cfg) {
  if (!hasNativeLaunch(cfg)) return;
  const templates = join(root, 'template/launch');
  const scene = join(buildDir, 'ios/App/App/SceneDelegate.swift');
  if (existsSync(scene)) {
    const ios = join(buildDir, 'ios/App/App');
    // public is already a folder resource in the generated Xcode project.
    // cap sync copies www again, so the same assets are placed in www below.
    const target = join(ios, 'public/popchat-launch');
    mkdirSync(target, { recursive: true });
    cpSync(join(templates, 'popchat'), target, { recursive: true });
    let swift = readFileSync(scene, 'utf8').split('// POPCHAT_NATIVE_LAUNCH_MOTION')[0].trimEnd();
    swift = swift.replace(/        let launch = LaunchMotionViewController\(\)[\s\S]*?        launch.start\(\)/, '');
    if (!swift.includes('import WebKit')) swift = swift.replace('import UIKit', 'import UIKit\nimport WebKit');
    if (!swift.includes('PopchatLaunch.show')) {
      swift = swift.replace('window?.makeKeyAndVisible()', 'window?.makeKeyAndVisible()\n        if let root = window?.rootViewController as? CAPBridgeViewController {\n            PopchatLaunch.show(over: root)\n        }');
    }
    swift += '\n\n// POPCHAT_NATIVE_LAUNCH_MOTION\n' + readFileSync(join(templates, 'PopchatLaunch.swift'), 'utf8');
    writeFileSync(scene, swift);
  }
  const java = join(buildDir, 'android/app/src/main/java', ...cfg.appId.split('.'), 'MainActivity.java');
  if (existsSync(java)) {
    const old = readFileSync(java, 'utf8');
    if (!old.includes('class LaunchMotionView') && !old.includes('// POPCHAT_NATIVE_LAUNCH_MOTION') &&
        !/class MainActivity extends BridgeActivity\s*\{\s*\}/.test(old)) {
      throw new Error('MainActivity has custom behavior; integrate launch hook explicitly before generating.');
    }
    writeFileSync(java, `package ${cfg.appId};\nimport com.getcapacitor.BridgeActivity;\n` + readFileSync(join(templates, 'PopchatLaunch.java'), 'utf8'));
  }
  // Copied by cap sync on both platforms; no remote URLs or extra plugin.
  const www = join(buildDir, 'www/popchat-launch');
  mkdirSync(www, { recursive: true });
  cpSync(join(templates, 'popchat'), www, { recursive: true });
  if (existsSync(join(buildDir, 'android'))) {
    const assets = join(buildDir, 'android/app/src/main/assets/public/popchat-launch');
    mkdirSync(assets, { recursive: true });
    cpSync(join(templates, 'popchat'), assets, { recursive: true });
  }
}
