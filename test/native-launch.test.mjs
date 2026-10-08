import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchNativeLaunchMotion } from '../scripts/lib/native-launch.mjs';

test('launch generation updates existing iOS source idempotently and bundles offline assets on both platforms', () => {
  const dir = mkdtempSync(join(tmpdir(), 'launch-test-'));
  try {
    const ios = join(dir, 'ios/App/App');
    const android = join(dir, 'android/app/src/main/java/com/example');
    mkdirSync(ios, { recursive: true }); mkdirSync(android, { recursive: true });
    writeFileSync(join(ios, 'SceneDelegate.swift'), 'import UIKit\nimport Capacitor\nclass SceneDelegate {\nfunc start() {\nwindow?.makeKeyAndVisible()\n}\n}\n');
    writeFileSync(join(android, 'MainActivity.java'), 'class MainActivity extends BridgeActivity {}');
    const cfg = { slug: 'characterchat-dev', appId: 'com.example' };
    patchNativeLaunchMotion(process.cwd(), dir, cfg);
    const first = readFileSync(join(ios, 'SceneDelegate.swift'), 'utf8');
    patchNativeLaunchMotion(process.cwd(), dir, cfg);
    assert.equal(readFileSync(join(ios, 'SceneDelegate.swift'), 'utf8'), first);
    assert.equal(first.match(/PopchatLaunch.show/g).length, 1);
    for (const path of ['www', 'ios/App/App/public', 'android/app/src/main/assets/public']) {
      for (const file of ['index.html', 'scene.js', 'male.webp', 'female.webp', 'first-frame.png', 'fonts.css']) {
        assert.ok(existsSync(join(dir, path, 'popchat-launch', file)), `${path}/${file}`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
