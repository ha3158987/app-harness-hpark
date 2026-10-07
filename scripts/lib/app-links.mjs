// app-links.mjs — App Links(Android) · Universal Links(iOS) 호스트 판정 + 네이티브 배선의 **정본**.
//
// generate-app.mjs(배선 · .well-known 생성) · doctor.mjs(헬스체크) · 테스트가 모두 여기를 쓴다.
// 호스트를 고르는 규칙을 다른 파일에 다시 쓰지 마라 — auth-setup.mjs 와 같은 이유다(두 벌은 반드시 갈라진다).
//
// ★ 앱 링크 호스트 ≠ WebView 이동 허용 목록.
//   navigation.allowedDomains 는 "WebView 가 이 호스트로 이동해도 된다"이고, 앱 링크는 "OS 가 이 https
//   링크를 이 앱으로 연다"는 선언이다. 예전엔 앞의 목록을 그대로 뒤의 것으로 썼다. 그래서 와일드카드
//   (*.poptale.ai)·API 호스트·--local IP 까지 autoVerify intent-filter 와 associated-domains 에 들어갔고,
//   같은 기기에 팝챗·팝테일 앱이 함께 있으면 같은 호스트를 서로 주장했다 — 링크가 어느 앱으로 열릴지 모른다.
//   또 Android 11 이하는 autoVerify 호스트 중 하나라도 검증에 실패하면 전부를 미검증으로 본다 — 검증 파일을
//   서빙하지 않는 API 호스트가 섞이면 그 앱의 앱 링크가 통째로 죽는다.
//   → navigation.appLinkDomains(명시 목록)가 있으면 **그것만** 쓴다. 없으면 종전 동작(하위호환).
//
// 값의 형식 검증(호스트 이름만 · 와일드카드 금지 · deepLink 필요)은 loadConfig(config.mjs)가 한다.
// 여기 들어오는 cfg.appLinkDomains 는 null(미지정) 이거나 검증된 호스트 배열이다.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { log } from './log.mjs';

/** 명시 목록(navigation.appLinkDomains)을 쓰는 앱인가. */
export function hasExplicitAppLinks(cfg) {
  return Array.isArray(cfg.appLinkDomains);
}

/**
 * 앱 링크로 등록할 호스트 — Android intent-filter(autoVerify) · iOS associated-domains 대상.
 * 명시 목록이 있으면 그것만, 없으면 navigation.allowedDomains 전체(와일드카드·--local 호스트 포함 — 종전 동작).
 * 하위호환 경로는 allowedDomains 를 **호출 시점에** 읽는다: generate-app 의 --local 이 그 배열에 호스트를
 * 넣은 뒤에 부르므로, 종전처럼 로컬 호스트도 들어간다(명시 목록 앱에는 들어가지 않는다).
 */
export function appLinkHosts(cfg) {
  if (hasExplicitAppLinks(cfg)) return [...cfg.appLinkDomains];
  return [...(cfg.navigation?.allowedDomains || [])];
}

/**
 * 이 앱이 AASA(apple-app-site-association) · assetlinks.json 을 서빙받아야 하는 **실호스트**.
 * 명시 목록이면 그 목록 그대로다(시작 호스트를 자동으로 더하지 않는다 — 웹에 파일을 올릴 곳을 앱이 정한다).
 * 하위호환: 시작 호스트 + 와일드카드가 아닌 allowedDomains. 와일드카드(*.example.com)는 파일을 서빙할
 * 대상이 아니다 — 각 실호스트가 자기 파일을 준다.
 */
export function wellKnownHosts(cfg) {
  if (hasExplicitAppLinks(cfg)) return [...new Set(cfg.appLinkDomains)];
  const hosts = (cfg.navigation?.allowedDomains || []).filter((d) => !d.includes('*'));
  const startHost = new URL(cfg.startUrl).hostname;
  return [...new Set([startHost, ...hosts])];
}

/**
 * 앱 링크 설정 조언. generate-app 과 doctor 가 같이 낸다(경고 — 빌드를 막지 않는다).
 * 하위호환 경로에서 와일드카드가 앱 링크로 나가는 경우만 짚는다. 기존 앱의 빌드를 바꾸지 않기 위해
 * 막지는 않는다 — 고칠지는 그 앱 담당자가 정한다.
 * @returns {string[]}
 */
export function appLinkWarnings(cfg) {
  if (!cfg.features?.deepLink || hasExplicitAppLinks(cfg)) return [];
  const wild = appLinkHosts(cfg).filter((h) => h.includes('*'));
  if (!wild.length) return [];
  return [
    `앱 링크에 와일드카드 ${wild.join(', ')} — navigation.appLinkDomains 미지정이라 allowedDomains 전체가 등록된다. ` +
    '같은 기기의 다른 앱과 링크를 다툰다 — 서빙하는 호스트만 appLinkDomains 에 적어라(docs/02-GUIDE.md §6).',
  ];
}

// ── 네이티브 배선 (features.deepLink 일 때 generate-app 이 부른다) ─────────────────────────
// ⚠️ 둘 다 **add-once** 다 — 이미 들어간 블록은 고치지 않는다(02-GUIDE §6 "재생성하면 어디까지 반영되나").
//    호스트를 바꿨으면 build/<slug> 를 지우고 다시 생성해야 반영된다. CI(release.yml)는 매번 새로 만든다.

/** Android: MainActivity 에 App Links intent-filter(autoVerify) 주입. */
export function patchAndroidDeepLinks(buildDir, cfg) {
  const manifest = join(buildDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!existsSync(manifest)) return;
  let xml = readFileSync(manifest, 'utf8');
  const MARK = 'harness-deeplinks';
  if (xml.includes(MARK)) return; // idempotent
  const domains = appLinkHosts(cfg);
  if (!domains.length) return;
  const dataTags = domains
    .map((d) => `                <data android:scheme="https" android:host="${d}" />`).join('\n');
  const filter =
`            <!-- ${MARK}: App Links (generate-app 자동 주입) -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
${dataTags}
            </intent-filter>
`;
  const actClose = xml.indexOf('</activity>'); // MainActivity 의 닫는 태그
  if (actClose === -1) return;
  xml = xml.slice(0, actClose) + filter + '        ' + xml.slice(actClose);
  writeFileSync(manifest, xml);
  log.ok(`AndroidManifest: App Links intent-filter (${domains.length} 도메인: ${domains.join(', ')})`);
}

/** iOS: App.entitlements 에 associated-domains(applinks:) 주입. iOS 플랫폼이 없으면(Windows 등) 건너뛴다. */
export function patchIosDeepLinks(buildDir, cfg) {
  const iosAppDir = join(buildDir, 'ios', 'App', 'App');
  if (!existsSync(iosAppDir)) return; // iOS 플랫폼 미추가(예: Windows) — 디렉터리를 만들지 않는다
  const entFile = join(iosAppDir, 'App.entitlements');
  const domains = appLinkHosts(cfg);
  if (!domains.length) return;
  const links = domains.map((d) => `\t\t<string>applinks:${d}</string>`).join('\n');

  if (existsSync(entFile)) {
    let xml = readFileSync(entFile, 'utf8');
    if (xml.includes('associated-domains')) return; // 이미 있음
    const block = `\t<key>com.apple.developer.associated-domains</key>\n\t<array>\n${links}\n\t</array>\n`;
    const close = xml.lastIndexOf('</dict>');
    if (close === -1) return;
    xml = xml.slice(0, close) + block + xml.slice(close);
    writeFileSync(entFile, xml);
    log.ok(`iOS App.entitlements: associated-domains 병합 (${domains.length} 도메인: ${domains.join(', ')})`);
    return;
  }
  const plist =
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.associated-domains</key>
\t<array>
${links}
\t</array>
</dict>
</plist>
`;
  mkdirSync(dirname(entFile), { recursive: true });
  writeFileSync(entFile, plist);
  log.ok(`iOS App.entitlements 생성: associated-domains (${domains.length} 도메인: ${domains.join(', ')})`);
  log.warn('iOS 딥링크가 동작하려면 Xcode > App 타깃 > Signing & Capabilities 에서 ' +
    'App.entitlements(CODE_SIGN_ENTITLEMENTS) 연결이 필요합니다(pbxproj 자동 수정은 손상 위험으로 생략).');
}
