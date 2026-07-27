#!/usr/bin/env node
// generate-app.mjs — app.config.json → build/<slug> Capacitor 8 프로젝트 생성/패치
//
// 단일 진실 공급원(apps/<slug>/app.config.json)에서 빌드 가능한 Capacitor 프로젝트를
// 결정론적으로 만든다. 재실행 안전(idempotent): 이미 있으면 갱신만 한다.
//
// 사용:
//   node scripts/generate-app.mjs --slug <slug> [--platform android|ios|both]
//                                 [--skip-install] [--skip-sync]
//
// 이 스크립트는 빌드 머신(Android: 어디서나 / iOS: macOS+Xcode)에서 build-* 스킬이 호출한다.

import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  readdirSync, copyFileSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, runtimeConfig, WIRED_PROVIDERS } from './lib/config.mjs';
import { log, fail } from './lib/log.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const IS_MAC = process.platform === 'darwin';

// ── 기능 → npm 플러그인 매핑 ────────────────────────────────────────────────
// 셸 기본기(어떤 앱이든 셸 동작에 필요): 항상 설치.
const BASE_PLUGINS = [
  '@capacitor/core',
  '@capacitor/app',          // 라이프사이클 + appUrlOpen(딥링크) + 백버튼
  '@capacitor/splash-screen',
  '@capacitor/status-bar',
  '@capacitor/keyboard',
  '@capacitor/browser',      // 외부 링크 in-app 브라우저
  '@capacitor/app-launcher', // 외부 링크 시스템 브라우저/스킴 열기
  '@capacitor/network',      // 오프라인 감지 → 에러 화면
  '@capacitor/device',
  '@capacitor/preferences',
  '@capacitor-community/safe-area', // 노치/펀치홀/제스처바 안전영역 CSS 변수 주입 + edge-to-edge
];
// 기능 토글 → 추가 플러그인 (브릿지 SDK 의 capability/메서드와 1:1)
const FEATURE_PLUGINS = {
  push: ['@capacitor/push-notifications'],
  share: ['@capacitor/share'],
  camera: ['@capacitor/camera'],
  biometric: ['@aparajita/capacitor-biometric-auth'],
  secureStorage: ['@aparajita/capacitor-secure-storage'],
  localNotification: ['@capacitor/local-notifications'],
  haptics: ['@capacitor/haptics'],
  clipboard: ['@capacitor/clipboard'],
  geolocation: ['@capacitor/geolocation'],
};
// npm 으로 자동 설치하지 않고 사람에게 안내만 하는 기능 (현재 없음 — 전부 자동 배선).
const MANUAL_FEATURES = {};

// 패키지 버전 해석: 공식 @capacitor/* 는 코어와 같은 메이저(^8), 커뮤니티/벤더 SDK 는
// 메이저가 코어와 다르므로 'latest' 로 npm 이 호환 버전을 고르게 한다.
function versionFor(pkg) {
  return pkg.startsWith('@capacitor/') ? '^8.0.0' : 'latest';
}

// iOS Info.plist 권한 사용 설명 문구 (기능 켜질 때만 주입). 누락 시 iOS 가 권한 요청 즉시 크래시.
const IOS_USAGE = {
  camera: { NSCameraUsageDescription: '사진 촬영을 위해 카메라 접근이 필요합니다.',
            NSPhotoLibraryUsageDescription: '사진 선택을 위해 사진 보관함 접근이 필요합니다.',
            NSPhotoLibraryAddUsageDescription: '사진 저장을 위해 사진 보관함 접근이 필요합니다.' },
  geolocation: { NSLocationWhenInUseUsageDescription: '위치 기반 기능을 위해 위치 접근이 필요합니다.' },
  biometric: { NSFaceIDUsageDescription: '본인 확인을 위해 Face ID 를 사용합니다.' },
};

// 마케팅 SDK: 자동 배선(npm 설치)되는 벤더 → 패키지. WIRED_PROVIDERS 와 일치.
const MARKETING_PLUGINS = {
  attribution: { appsflyer: ['appsflyer-capacitor-plugin'] },
};

// 인증: 네이티브 SDK 가 필요한 공급자만 플러그인 설치. 나머지(google/naver/kakao/facebook/x/threads)는
// 시스템 브라우저 OAuth2(PKCE)로 처리 → 추가 플러그인 불필요(@capacitor/browser 는 base).
const AUTH_NATIVE_PLUGINS = {
  apple: ['@capacitor-community/apple-sign-in'], // iOS 네이티브 Sign in with Apple
};

// 중앙 IdP 모드 여부 (auth.idp 에 issuer/authorizeUrl 있음)
function isIdpMode(cfg) {
  const i = cfg.auth?.idp;
  return !!(i && (i.issuer || i.authorizeUrl));
}

// 인증 플러그인 + 경고(Apple 4.8 / clientId 누락) 수집
function authSetup(cfg) {
  const providers = cfg.auth?.providers || [];
  const plugins = [];
  const warnings = [];
  const social = providers.filter((p) => p !== 'email');
  const idp = isIdpMode(cfg);

  // 네이티브 플러그인: IdP 모드면 Apple 도 IdP 경유 → apple-sign-in 플러그인 불필요.
  for (const p of providers) {
    if (p === 'apple' && idp) continue;
    (AUTH_NATIVE_PLUGINS[p] || []).forEach((x) => plugins.push(x));
  }

  // Apple App Store 4.8: 제3자 소셜 로그인을 제공하면 Sign in with Apple 도 제공해야 한다(iOS).
  const hasOtherSocial = social.some((p) => p !== 'apple');
  if (hasOtherSocial && !providers.includes('apple')) {
    warnings.push('소셜 로그인 제공 시 Apple 가이드라인 4.8 에 따라 "apple"(Sign in with Apple) 도 ' +
      'providers 에 추가해야 합니다 — 없으면 iOS 심사에서 리젝될 수 있음.');
  }

  if (idp) {
    // IdP 모드: clientId 는 IdP 클라이언트 하나. 공급자별 oauth.clientId 는 보지 않는다.
    if (!cfg.auth?.idp?.clientId) {
      warnings.push('auth.idp.clientId 누락 — 중앙 IdP 클라이언트 ID 가 필요합니다(런타임 misconfigured).');
    }
  } else {
    // 직접 모드: 시스템 브라우저 OAuth 공급자는 공개 clientId 필요
    for (const p of social) {
      if (p === 'apple') continue;
      if (!cfg.auth?.oauth?.[p]?.clientId) {
        warnings.push(`auth.oauth.${p}.clientId 누락 — OAuth 가 런타임에 동작하지 않음(빌드는 됨). ` +
          '공개 clientId 를 config 에 넣거나 빌드 시 주입하세요(client secret 은 백엔드 전용).');
      }
    }
  }
  // OAuth 복귀 URL scheme 은 두 모드 다 필요(IdP/공급자가 appId://oauth/... 로 복귀)
  return { plugins, warnings, hasOAuth: social.length > 0, idp };
}

// 인앱결제: 상품이 있으면 IAP 플러그인 설치. 디지털 재화 결제는 스토어 IAP 강제.
const IAP_PLUGIN = ['cordova-plugin-purchase'];
function iapSetup(cfg) {
  const products = cfg.iap?.products || [];
  const plugins = [];
  const warnings = [];
  if (products.length) {
    IAP_PLUGIN.forEach((p) => plugins.push(p));
    if (!cfg.iap?.verifyEndpoint) {
      warnings.push('iap.verifyEndpoint 누락 — 영수증 검증/지갑 적립 백엔드 URL 이 필요합니다(보안상 필수).');
    }
    for (const p of products) {
      if (!p.storeId) {
        warnings.push(`iap.products "${p.id}" 에 storeId 없음 — id 를 스토어 상품ID 로 간주합니다.`);
      }
    }
  }
  return { plugins, warnings };
}

// 베이크 전용 시크릿을 환경변수에서 읽어 주입한다. 절대 source config/레포에 두지 않는다.
// 슬러그별 우선: APPSFLYER_DEV_KEY_<SLUG대문자_하이픈→언더스코어> → 없으면 APPSFLYER_DEV_KEY
function envFor(slug, base) {
  const perSlug = `${base}_${slug.toUpperCase().replace(/-/g, '_')}`;
  return process.env[perSlug] ?? process.env[base] ?? null;
}

// 마케팅 플러그인 목록 + 미배선 벤더 경고 수집
function marketingSetup(cfg) {
  const plugins = [];
  const warnings = [];
  for (const cat of ['attribution', 'analytics', 'crm']) {
    const provider = cfg.marketing?.[cat]?.provider;
    if (!provider) continue;
    const wired = (WIRED_PROVIDERS[cat] || []).includes(provider);
    if (wired) {
      (MARKETING_PLUGINS[cat]?.[provider] || []).forEach((p) => plugins.push(p));
    } else {
      warnings.push(`marketing.${cat} = "${provider}" — 아직 자동 배선 안 됨. 슬롯만 생성됨. ` +
        `벤더 SDK 수동 설치 + 브릿지 핸들러 연결 필요 (REFERENCES.md).`);
    }
  }
  return { plugins, warnings };
}

// 베이크 전용 config: 런타임 config + 환경변수 시크릿(키). 네이티브 번들에만 들어가고
// (build/ 는 gitignore) www 폴백엔 키를 넣지 않는다.
function bakedConfig(cfg, rc) {
  const baked = structuredClone(rc);
  const ap = cfg.marketing?.attribution;
  if (ap?.provider === 'appsflyer') {
    const devKey = envFor(cfg.slug, 'APPSFLYER_DEV_KEY');
    const iosAppId = envFor(cfg.slug, 'APPSFLYER_IOS_APP_ID'); // iOS App Store 숫자 ID
    baked.marketing.attribution.appsflyer = {
      devKey: devKey || null,
      iosAppId: iosAppId || null,
    };
    if (!devKey) {
      log.warn('APPSFLYER_DEV_KEY 환경변수 없음 — AppsFlyer 는 키 없이 빌드되어 런타임 비활성. ' +
        '실제 어트리뷰션 동작하려면 키 주입 후 재실행.');
    }
  }
  return baked;
}

function parseArgs(argv) {
  const a = { platform: IS_MAC ? 'both' : 'android', skipInstall: false, skipSync: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--slug') a.slug = argv[++i];
    else if (v === '--platform') a.platform = argv[++i];
    else if (v === '--skip-install') a.skipInstall = true;
    else if (v === '--skip-sync') a.skipSync = true;
    else if (v === '--local') a.local = argv[++i]; // 로컬 dev 서버 URL(예: http://192.168.1.37:3001). cleartext+ATS 자동 허용.
  }
  if (!a.slug) fail('--slug <slug> 필요');
  if (a.local && !/^https?:\/\//.test(a.local)) fail('--local 은 http(s):// 로 시작하는 전체 URL 이어야 함');
  if (!['android', 'ios', 'both'].includes(a.platform)) fail(`--platform 은 android|ios|both`);
  return a;
}

// 재귀 디렉터리 복사. node:fs 의 cpSync 는 한글/비ASCII 경로 + Windows 확장경로(\\?\)에서
// EIO 를 내는 버그가 있어 직접 구현한다.
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

function run(cmd, args, cwd) {
  log.dim(`$ ${cmd} ${args.join(' ')}`);
  // Windows 에서 npm/npx 는 .cmd 래퍼라 shell:true 가 필요하다(.cmd 는 shell 없이 spawn 불가).
  // DEP0190 경고가 뜨지만 동작엔 문제 없다. args 는 우리가 생성하는 고정값이라 주입 위험 없음.
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

// capacitor.config.json 을 config 로부터 생성.
// 핵심 결정: server.url = startUrl (원격 웹을 그대로 로드). 오프라인/에러 셸은 webDir(www)에 둔다.
function buildCapacitorConfig(cfg, opts = {}) {
  const isDark = cfg.theme.statusBarStyle === 'dark';
  // 로컬 dev 모드: 평문 http 로컬 서버를 로드하려면 cleartext + mixedContent 허용이 필요하다.
  // 프로덕션(원격 https) 빌드는 그대로 cleartext:false 를 유지한다(dev 전용 완화).
  const local = !!opts.local;
  return {
    appId: cfg.appId,
    appName: cfg.appName,
    webDir: 'www',
    // 앱 WebView UA 에 표식 추가 → 서버가 "앱에서 온 요청"을 판별(SSR 가격/결제 분기, anti-steering).
    //   감지: User-Agent 에 "HarnessApp/<slug>" 포함. 클라이언트는 AppBridge.isNative 사용.
    appendUserAgent: `HarnessApp/${cfg.slug}/${cfg.version.name}+${cfg.version.code}`,
    // 원격 서비스를 직접 로드. allowNavigation 으로 화이트리스트 도메인만 셸 내부 탐색 허용.
    server: {
      url: cfg.startUrl,
      cleartext: local,
      allowNavigation: cfg.navigation.allowedDomains,
    },
    plugins: {
      SplashScreen: {
        launchShowDuration: cfg.theme.splashDuration ?? 1500,
        backgroundColor: cfg.theme.splashBackground || cfg.theme.background,
        showSpinner: false,
        androidScaleType: 'CENTER_CROP',
      },
      StatusBar: {
        // light 스타일 = 밝은 배경 위 어두운 텍스트. Capacitor Style: 'LIGHT'|'DARK'
        style: isDark ? 'DARK' : 'LIGHT',
        backgroundColor: cfg.theme.background,
      },
      // resize:'none' — 키보드 리사이즈는 safe-area 플러그인이 담당한다(IME 표시 시 WebView 하단을 키보드 높이만큼 패딩).
      //   Capacitor Keyboard 가 여기에 또 resize(native/body)하면 이중 축소 → 입력바가 화면 위로 튄다. onKeyboard 이벤트는 유지.
      Keyboard: { resize: 'none' },
      // 노치/펀치홀/제스처바 안전영역을 --safe-area-inset-* CSS 변수로 주입(Android env() 불안정 보완).
      SafeArea: { enabled: true },
      // Capacitor v8 내장 SystemBars 의 인셋 처리를 끈다(safe-area 플러그인 요구사항).
      //   안 끄면 Capacitor 와 safe-area 플러그인이 IME(키보드) 인셋을 이중 적용 → 키보드 열 때
      //   WebView 뷰포트가 붕괴(innerHeight 급감, visualViewport=0)해 입력창이 화면 위로 튄다(Android 실기기).
      SystemBars: { insetsHandling: 'disable' },
      ...(cfg.features.push ? { PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] } } : {}),
    },
    // iOS edge-to-edge: 'never' 로 WKWebView 콘텐츠를 세이프에어리어 밖(노치/상태바·홈인디케이터 밑)까지 확장.
    //   'always'(구값) = 콘텐츠를 세이프에어리어 안쪽으로 인셋 → 상/하단에 네이티브 배경(다크=검정)이 노출됨(검은 띠).
    //   웹은 viewport-fit=cover + env(safe-area-inset-*)/--safe-area-inset-* 로 콘텐츠 패딩을 직접 처리해야 가림이 없다.
    ios: { contentInset: 'never' },
    // adjustMarginsForEdgeToEdge:'disable' — Capacitor 의 edge-to-edge 마진 자동 보정을 끄고 safe-area 플러그인에 위임한다.
    //   (미지정 시 Capacitor 가 시스템바 마진을 추가로 넣어 safe-area 플러그인의 인셋 처리와 충돌.)
    android: { allowMixedContent: local, adjustMarginsForEdgeToEdge: 'disable' },
  };
}

function pluginsFor(cfg) {
  const set = new Set(BASE_PLUGINS);
  if (cfg.features.deepLink) set.add('@capacitor/app'); // 이미 base 에 있음, 명시
  for (const [feat, pkgs] of Object.entries(FEATURE_PLUGINS)) {
    if (cfg.features[feat]) pkgs.forEach((p) => set.add(p));
  }
  marketingSetup(cfg).plugins.forEach((p) => set.add(p));
  authSetup(cfg).plugins.forEach((p) => set.add(p));
  iapSetup(cfg).plugins.forEach((p) => set.add(p));
  // 어트리뷰션 있으면 iOS ATT(추적동의) 플러그인
  if (cfg.marketing?.attribution?.provider) set.add('capacitor-plugin-app-tracking-transparency');
  // 크래시 리포트(@sentry/capacitor)는 프레임워크 형제(@sentry/react|vue|angular)를 peer 로 요구하므로
  // 하네스가 자동설치하지 않는다 — 웹 앱이 자기 프레임워크에 맞춰 설치(INTEGRATION.md). 브릿지는 graceful.
  return [...set];
}

// 빌드 디렉터리 package.json (없을 때만 생성). 플러그인 + 로컬 브릿지 의존성 선언.
function scaffoldPackageJson(buildDir, cfg, plugins) {
  const file = join(buildDir, 'package.json');
  const deps = {};
  for (const p of plugins) deps[p] = versionFor(p);
  deps['@capacitor/cli'] = '^8.0.0';
  // 플랫폼은 cap add 시점에 결정되지만 의존성으로 미리 선언
  deps['@capacitor/android'] = '^8.0.0';
  if (IS_MAC) deps['@capacitor/ios'] = '^8.0.0';
  // 공유 브릿지 (커스텀 Capacitor 플러그인 + JS SDK) — 로컬 file: 의존성
  deps['@aipia-team/harness-bridge'] = `file:${join(ROOT, 'template', 'bridge')}`;

  const pkg = {
    name: `app-${cfg.slug}`,
    version: cfg.version.name,
    private: true,
    dependencies: deps,
  };
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  log.ok(`package.json (${plugins.length} base/feature 플러그인 + @aipia-team/harness-bridge)`);
}

// ── 네이티브 딥링크 / 권한 배선 ────────────────────────────────────────────
// allowedDomains 를 유니버설/앱 링크로 연결한다. features.deepLink 일 때만 호출.

function patchAndroidDeepLinks(buildDir, cfg) {
  const manifest = join(buildDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!existsSync(manifest)) return;
  let xml = readFileSync(manifest, 'utf8');
  const MARK = 'harness-deeplinks';
  if (xml.includes(MARK)) return; // idempotent
  const domains = cfg.navigation.allowedDomains || [];
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
  log.ok(`AndroidManifest: App Links intent-filter (${domains.length} 도메인)`);
}

function patchIosDeepLinks(buildDir, cfg) {
  const iosAppDir = join(buildDir, 'ios', 'App', 'App');
  if (!existsSync(iosAppDir)) return; // iOS 플랫폼 미추가(예: Windows) — 디렉터리를 만들지 않는다
  const entFile = join(iosAppDir, 'App.entitlements');
  const domains = cfg.navigation.allowedDomains || [];
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
    log.ok(`iOS App.entitlements: associated-domains 병합 (${domains.length} 도메인)`);
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
  log.ok(`iOS App.entitlements 생성: associated-domains (${domains.length} 도메인)`);
  log.warn('iOS 딥링크가 동작하려면 Xcode > App 타깃 > Signing & Capabilities 에서 ' +
    'App.entitlements(CODE_SIGN_ENTITLEMENTS) 연결이 필요합니다(pbxproj 자동 수정은 손상 위험으로 생략).');
}

// 기능별 iOS 권한 사용 설명 문구 주입. 누락 시 권한 요청 시점에 iOS 가 크래시한다.
function patchIosUsageStrings(buildDir, cfg) {
  const plistFile = join(buildDir, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(plistFile)) return;
  let xml = readFileSync(plistFile, 'utf8');
  const add = {};
  for (const feat of Object.keys(IOS_USAGE)) {
    if (cfg.features[feat] === true || cfg.features[feat]?.enabled) Object.assign(add, IOS_USAGE[feat]);
  }
  // 갤러리 저장(AppBridge.saveImageToGallery)은 기능 플래그와 무관하게 항상 제공되므로,
  // 추가 전용(addOnly) 사진 권한 설명을 기본 주입(camera 로 이미 채워졌으면 생략).
  if (!add.NSPhotoLibraryAddUsageDescription) {
    add.NSPhotoLibraryAddUsageDescription = '캡쳐 이미지 저장을 위해 사진 보관함 접근이 필요합니다.';
  }
  // ATT: 어트리뷰션(AppsFlyer 등) 있으면 추적 사용 설명 필수(없으면 ATT 호출 시 크래시)
  if (cfg.marketing?.attribution?.provider) {
    add.NSUserTrackingUsageDescription = '맞춤형 콘텐츠와 광고 제공을 위해 활동을 추적합니다.';
  }
  const entries = Object.entries(add).filter(([k]) => !xml.includes(`<key>${k}</key>`));
  if (!entries.length) return;
  const block = entries.map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>`).join('\n');
  const close = xml.lastIndexOf('</dict>');
  if (close === -1) return;
  xml = xml.slice(0, close) + block + '\n' + xml.slice(close);
  writeFileSync(plistFile, xml);
  log.ok(`iOS Info.plist: 권한 사용 설명 ${entries.length}개 주입`);
}

// 로컬 dev 모드(--local) 전용: 평문 http 로컬 서버 로드를 위해 ATS 예외를 주입한다.
// NSAllowsArbitraryLoads=true 는 dev 한정 완화 — 프로덕션(원격 https) 빌드엔 절대 주입하지 않는다.
function patchIosLocalAts(buildDir) {
  const plistFile = join(buildDir, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(plistFile)) return;
  let xml = readFileSync(plistFile, 'utf8');
  if (xml.includes('<key>NSAppTransportSecurity</key>')) return; // 이미 있으면 손대지 않음
  const block =
    '\t<key>NSAppTransportSecurity</key>\n' +
    '\t<dict>\n' +
    '\t\t<key>NSAllowsArbitraryLoads</key>\n' +
    '\t\t<true/>\n' +
    '\t</dict>';
  const close = xml.lastIndexOf('</dict>');
  if (close === -1) return;
  xml = xml.slice(0, close) + block + '\n' + xml.slice(close);
  writeFileSync(plistFile, xml);
  log.ok('iOS Info.plist: ATS 예외 주입(NSAllowsArbitraryLoads, dev 로컬 전용)');
}

// ── 인증 네이티브 배선 ──────────────────────────────────────────────────────
// OAuth 복귀용 커스텀 URL scheme(= appId) 등록 + Apple Sign In 엔타이틀먼트.

function patchAndroidAuthScheme(buildDir, cfg) {
  const manifest = join(buildDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!existsSync(manifest)) return;
  let xml = readFileSync(manifest, 'utf8');
  const MARK = 'harness-oauth';
  if (xml.includes(MARK)) return;
  const scheme = cfg.appId; // 예: kr.co.aipia.app://oauth/<provider>
  const filter =
`            <!-- ${MARK}: OAuth 복귀 커스텀 스킴 (generate-app 자동 주입) -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${scheme}" />
            </intent-filter>
`;
  const actClose = xml.indexOf('</activity>');
  if (actClose === -1) return;
  xml = xml.slice(0, actClose) + filter + '        ' + xml.slice(actClose);
  writeFileSync(manifest, xml);
  log.ok(`AndroidManifest: OAuth URL scheme "${scheme}://"`);
}

function patchIosAuthScheme(buildDir, cfg) {
  const plistFile = join(buildDir, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(plistFile)) return;
  let xml = readFileSync(plistFile, 'utf8');
  if (xml.includes('CFBundleURLTypes')) return; // 이미 있으면 수동 병합 필요
  const scheme = cfg.appId;
  const block =
`\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${scheme}</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;
  const close = xml.lastIndexOf('</dict>');
  if (close === -1) return;
  xml = xml.slice(0, close) + block + xml.slice(close);
  writeFileSync(plistFile, xml);
  log.ok(`iOS Info.plist: OAuth URL scheme "${scheme}://"`);
}

// Apple Sign In 엔타이틀먼트(applesignin) 추가. iOS 플랫폼 + apple 공급자일 때만.
function patchIosAppleEntitlement(buildDir, cfg) {
  const iosAppDir = join(buildDir, 'ios', 'App', 'App');
  if (!existsSync(iosAppDir)) return;
  if (!(cfg.auth?.providers || []).includes('apple')) return;
  const entFile = join(iosAppDir, 'App.entitlements');
  const KEY = 'com.apple.developer.applesignin';
  const block = `\t<key>${KEY}</key>\n\t<array>\n\t\t<string>Default</string>\n\t</array>\n`;
  if (existsSync(entFile)) {
    let xml = readFileSync(entFile, 'utf8');
    if (xml.includes(KEY)) return;
    const close = xml.lastIndexOf('</dict>');
    if (close === -1) return;
    xml = xml.slice(0, close) + block + xml.slice(close);
    writeFileSync(entFile, xml);
  } else {
    const plist =
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${block}</dict>
</plist>
`;
    writeFileSync(entFile, plist);
  }
  log.ok('iOS App.entitlements: Sign in with Apple');
}

// 릴리즈 서명 배선: keystore.properties(=build/<slug>/android/keystore.properties)가 있으면
// 릴리즈 서명을 적용하고, 없으면 건드리지 않는다(디버그 빌드/CI 외 로컬에 안전). CI 가 시크릿으로 주입.
const ANDROID_SIGNING_SNIPPET = `
// harness-signing: 릴리즈 서명 (generate-app 자동 주입). keystore.properties 있을 때만 적용.
def harnessKsFile = rootProject.file("keystore.properties")
if (harnessKsFile.exists()) {
    def harnessKs = new Properties()
    harnessKsFile.withInputStream { harnessKs.load(it) }
    android {
        signingConfigs {
            release {
                storeFile rootProject.file(harnessKs['storeFile'])
                storePassword harnessKs['storePassword']
                keyAlias harnessKs['keyAlias']
                keyPassword harnessKs['keyPassword']
            }
        }
        buildTypes {
            release {
                signingConfig signingConfigs.release
            }
        }
    }
}
`;

function patchAndroidSigning(buildDir) {
  const gradleFile = join(buildDir, 'android', 'app', 'build.gradle');
  if (!existsSync(gradleFile)) return;
  let txt = readFileSync(gradleFile, 'utf8');
  if (txt.includes('harness-signing')) return; // idempotent
  txt += `\n${ANDROID_SIGNING_SNIPPET}\n`;
  writeFileSync(gradleFile, txt);
  log.ok('android/app/build.gradle: 릴리즈 서명 설정(keystore.properties 조건부)');
}

// 네이티브 버전 주입: app.config.json 의 version 을 네이티브 프로젝트에 직접 박는다.
// CI 경로(빌드 스킬 미사용, generate-app 직접 호출)에서도 버전이 반영되도록 한다.
// (안 하면 빌드번호가 Capacitor 기본 1 고정 → 재업로드 시 스토어가 중복 거부)
function patchNativeVersion(buildDir, cfg) {
  const code = cfg.version?.code;
  const name = cfg.version?.name;
  if (!code && !name) return;

  // Android: app/build.gradle defaultConfig (versionCode 정수, versionName 문자열)
  const gradleFile = join(buildDir, 'android', 'app', 'build.gradle');
  if (existsSync(gradleFile)) {
    let txt = readFileSync(gradleFile, 'utf8');
    if (code) txt = txt.replace(/versionCode\s+\d+/, `versionCode ${code}`);
    if (name) txt = txt.replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);
    writeFileSync(gradleFile, txt);
    log.ok(`android versionCode=${code} / versionName="${name}"`);
  }

  // iOS: project.pbxproj (Debug/Release 빌드설정 모두). CURRENT_PROJECT_VERSION=빌드번호, MARKETING_VERSION=표시버전
  const pbxproj = join(buildDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  if (existsSync(pbxproj)) {
    let txt = readFileSync(pbxproj, 'utf8');
    if (code) txt = txt.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${code};`);
    if (name) txt = txt.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${name};`);
    writeFileSync(pbxproj, txt);
    log.ok(`iOS CURRENT_PROJECT_VERSION=${code} / MARKETING_VERSION=${name}`);
  }
}

// 안드로이드 12+ 스플래시 배선. 안드12+ 는 OS 가 시작화면을 "단색 배경 + 가운데 아이콘"으로 강제한다
// (풀스크린 이미지 불가 — poptale 도 동일). Capacitor 기본 styles.xml 은 windowSplashScreen* 미설정이라
// 시스템 기본(밝은) 배경이 나오는 버그가 있어, 여기서 배경색 + 전용 아이콘을 주입한다.
//   배경색  = theme.splashBackground || theme.background
//   아이콘  = apps/<slug>/splash_icon.png(투명 권장) 있으면 사용, 없으면 런처 foreground
function patchAndroidSplash(buildDir, cfg) {
  const resDir = join(buildDir, 'android', 'app', 'src', 'main', 'res');
  const stylesFile = join(resDir, 'values', 'styles.xml');
  if (!existsSync(stylesFile)) return;
  const splashBg = cfg.theme.splashBackground || cfg.theme.background;

  // 1) colors.xml 에 splashBackground 등록(없으면 생성, 있으면 갱신)
  const colorsFile = join(resDir, 'values', 'colors.xml');
  let colors = existsSync(colorsFile)
    ? readFileSync(colorsFile, 'utf8')
    : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
  if (colors.includes('name="splashBackground"')) {
    colors = colors.replace(/<color name="splashBackground">[^<]*<\/color>/,
      `<color name="splashBackground">${splashBg}</color>`);
  } else {
    colors = colors.replace('</resources>',
      `    <color name="splashBackground">${splashBg}</color>\n</resources>`);
  }
  mkdirSync(dirname(colorsFile), { recursive: true });
  writeFileSync(colorsFile, colors);

  // 2) 전용 스플래시 아이콘(투명 배경 권장) 복사. 없으면 런처 foreground 로 폴백.
  let animatedIcon = '@mipmap/ic_launcher_foreground';
  const srcIcon = join(ROOT, 'apps', cfg.slug, 'splash_icon.png');
  if (existsSync(srcIcon)) {
    const dstIcon = join(resDir, 'drawable', 'splash_icon.png');
    mkdirSync(dirname(dstIcon), { recursive: true });
    copyFileSync(srcIcon, dstIcon);
    animatedIcon = '@drawable/splash_icon';
  }

  // 3) AppTheme.NoActionBarLaunch 에 windowSplashScreen* 주입 (idempotent)
  let styles = readFileSync(stylesFile, 'utf8');
  if (styles.includes('windowSplashScreenBackground')) {
    log.ok('android 스플래시 테마: 이미 적용됨(스킵)');
    return;
  }
  styles = styles.replace(
    /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/,
    '$1\n        <item name="windowSplashScreenBackground">@color/splashBackground</item>' +
    `\n        <item name="windowSplashScreenAnimatedIcon">${animatedIcon}</item>` +
    '\n        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>',
  );
  writeFileSync(stylesFile, styles);
  log.ok(`android 스플래시 테마: 배경 ${splashBg} + ${animatedIcon} (안드12+ 시스템 스플래시)`);
}

// iOS Podfile 정적 링크. Capacitor 8 + CocoaPods 에서 동적 프레임워크(use_frameworks!)면 플러그인
// 클래스가 NSClassFromString 으로 안 잡혀 등록 실패(isPluginAvailable=false) → 네이티브 미동작.
// 정적 링크(:linkage => :static)로 앱 본체에 합쳐야 플러그인이 등록된다. (실기기 검증됨)
function patchIosPodfileStaticLinkage(buildDir) {
  const podfile = join(buildDir, 'ios', 'App', 'Podfile');
  if (!existsSync(podfile)) return;
  let txt = readFileSync(podfile, 'utf8');
  if (txt.includes(':linkage => :static')) {
    log.ok('iOS Podfile: 정적 링크 이미 적용됨');
    return;
  }
  if (!/^use_frameworks!\s*$/m.test(txt)) return; // 예상 형태 아니면 손대지 않음
  txt = txt.replace(/^use_frameworks!\s*$/m, 'use_frameworks! :linkage => :static');
  writeFileSync(podfile, txt);
  // CocoaPods 는 UTF-8 로케일을 요구(경고/실패 방지)
  if (!/UTF-8/i.test(process.env.LANG || '')) process.env.LANG = 'en_US.UTF-8';
  log.ok('iOS Podfile: use_frameworks! :linkage => :static (플러그인 등록 위해) → pod install');
  run('pod', ['install'], join(buildDir, 'ios', 'App'));
}

// iOS 엔타이틀먼트를 Xcode 프로젝트에 연결(CODE_SIGN_ENTITLEMENTS). App.entitlements 가 있을 때만.
// App 타깃 빌드설정(= PRODUCT_BUNDLE_IDENTIFIER 보유 블록)에 경로를 주입한다. (수동 Xcode 단계 제거)
// ⚠️ iOS 빌드는 현재 미검증 환경 — 첫 macOS 빌드에서 확인 권장.
function patchIosPbxEntitlements(buildDir) {
  const pbx = join(buildDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const ent = join(buildDir, 'ios', 'App', 'App', 'App.entitlements');
  if (!existsSync(pbx) || !existsSync(ent)) return;
  let txt = readFileSync(pbx, 'utf8');
  if (txt.includes('CODE_SIGN_ENTITLEMENTS')) return; // 이미 연결됨
  const before = txt;
  txt = txt.replace(
    /(\n(\s*)PRODUCT_BUNDLE_IDENTIFIER = [^\n]*;)/g,
    '$1\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;',
  );
  if (txt === before) return;
  writeFileSync(pbx, txt);
  log.ok('iOS project.pbxproj: CODE_SIGN_ENTITLEMENTS = App/App.entitlements 연결');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  log.step(`config 로딩: apps/${args.slug}/app.config.json`);
  let cfg;
  try {
    cfg = loadConfig(ROOT, args.slug);
  } catch (e) {
    fail(e.message);
  }
  log.ok(`${cfg.appName} (${cfg.appId}) v${cfg.version.name}+${cfg.version.code}`);
  // 로컬 dev 모드: startUrl 을 로컬 서버로 바꾸고, 해당 호스트를 셸 내부 탐색 화이트리스트에 추가한다.
  if (args.local) {
    cfg.startUrl = args.local;
    const host = new URL(args.local).hostname;
    if (!cfg.navigation.allowedDomains.includes(host)) cfg.navigation.allowedDomains.push(host);
    log.warn(`로컬 dev 모드: server.url=${args.local} (cleartext+ATS 허용 — dev 전용 빌드, 스토어 제출 금지)`);
  }
  log.info(`startUrl: ${cfg.startUrl}`);
  log.info(`기능: ${Object.entries(cfg.features)
    .filter(([, v]) => v === true || v?.enabled)
    .map(([k]) => k).join(', ') || '(없음 — 순수 래퍼)'}`);

  // 수동 연동 안내
  for (const [feat, note] of Object.entries(MANUAL_FEATURES)) {
    if (cfg.features[feat] === true || cfg.features[feat]?.enabled) log.warn(note);
  }
  // 마케팅 SDK 안내
  const mkt = marketingSetup(cfg);
  const activeMkt = ['attribution', 'analytics', 'crm']
    .map((c) => cfg.marketing?.[c]?.provider && `${c}:${cfg.marketing[c].provider}`)
    .filter(Boolean);
  if (activeMkt.length) log.info(`마케팅: ${activeMkt.join(', ')}`);
  mkt.warnings.forEach((w) => log.warn(w));
  // 인증/SSO 안내
  const authConf = authSetup(cfg);
  if ((cfg.auth?.providers || []).length) log.info(`인증: ${cfg.auth.providers.join(', ')}`);
  authConf.warnings.forEach((w) => log.warn(w));
  // 인앱결제 안내
  const iapConf = iapSetup(cfg);
  if ((cfg.iap?.products || []).length) log.info(`인앱결제: ${cfg.iap.products.length}개 상품(${cfg.iap.products.map((p) => p.id).join(', ')})`);
  iapConf.warnings.forEach((w) => log.warn(w));

  const buildDir = join(ROOT, 'build', cfg.slug);
  const wwwDir = join(buildDir, 'www');
  const isNew = !existsSync(buildDir);
  mkdirSync(buildDir, { recursive: true });

  // 1) 셸 웹 자산 (오프라인/에러/로딩 화면) — template/src → www
  //    cpSync 가 www 를 생성한다 (Windows 에선 미리 mkdir 한 dest 로 복사 시 EIO 가 날 수 있음).
  log.step('셸 웹 자산 복사 (template/src → www)');
  rmSync(wwwDir, { recursive: true, force: true });
  copyDir(join(ROOT, 'template', 'src'), wwwDir);
  log.ok('www 갱신');

  // 2) 런타임 config 주입 — 웹(www) + 네이티브 에셋 양쪽.
  //    브릿지 SDK 는 네이티브에선 AppBridge.getConfig(), 웹 폴백에선 이 파일을 읽는다.
  const rc = runtimeConfig(cfg);
  const rcJson = JSON.stringify(rc, null, 2);      // 시크릿 없음 → www 폴백용
  writeFileSync(join(wwwDir, 'app-config.json'), rcJson);
  log.ok('www/app-config.json (키 미포함)');
  // 네이티브 베이크용: 환경변수 시크릿(AppsFlyer devKey 등) 주입. build/ 는 gitignore.
  const bakedJson = JSON.stringify(bakedConfig(cfg, rc), null, 2);

  // 3) capacitor.config.json
  log.step('capacitor.config.json 생성');
  writeFileSync(
    join(buildDir, 'capacitor.config.json'),
    JSON.stringify(buildCapacitorConfig(cfg, { local: !!args.local }), null, 2) + '\n',
  );
  log.ok(`server.url = ${cfg.startUrl} / allowNavigation: ${cfg.navigation.allowedDomains.join(', ')}`);

  // 4) package.json + 의존성
  const plugins = pluginsFor(cfg);
  if (isNew || !existsSync(join(buildDir, 'package.json'))) {
    scaffoldPackageJson(buildDir, cfg, plugins);
  } else {
    log.info('기존 package.json 유지 (플러그인 변경 시 수동 확인 권장)');
  }

  if (args.skipInstall) {
    log.warn('--skip-install: npm install / cap add / sync 건너뜀 (드라이 생성)');
    log.step('완료 (드라이)');
    return;
  }

  // 5) 의존성 설치
  log.step('npm install');
  run('npm', ['install'], buildDir);

  // 6) 플랫폼 추가 (idempotent — 이미 있으면 cap add 가 스킵/경고)
  const wantAndroid = args.platform === 'android' || args.platform === 'both';
  const wantIos = (args.platform === 'ios' || args.platform === 'both');
  if (wantIos && !IS_MAC) {
    log.warn('iOS 는 macOS 에서만 빌드 가능 — 이 환경에선 iOS 플랫폼을 건너뜀.');
  }

  if (wantAndroid && !existsSync(join(buildDir, 'android'))) {
    log.step('cap add android');
    run('npx', ['cap', 'add', 'android'], buildDir);
  }
  if (wantIos && IS_MAC && !existsSync(join(buildDir, 'ios'))) {
    log.step('cap add ios');
    // CocoaPods 명시: 커스텀 브릿지(HarnessBridge)는 podspec 기반 → SPM 비호환. CocoaPods 로 추가.
    run('npx', ['cap', 'add', 'ios', '--packagemanager', 'CocoaPods'], buildDir);
  }
  // iOS Podfile 정적 링크 — Capacitor 플러그인 등록에 필수(동적 프레임워크면 NSClassFromString 실패로
  // isPluginAvailable=false → 네이티브 미동작). regenerate 시에도 보장하려고 ios 존재 시 항상 적용.
  if (wantIos && IS_MAC && existsSync(join(buildDir, 'ios'))) {
    patchIosPodfileStaticLinkage(buildDir);
  }

  // 7) 네이티브 에셋에 런타임 config 복사 (AppBridge.getConfig() 가 읽음)
  log.step('네이티브에 app-config.json 주입');
  if (existsSync(join(buildDir, 'android'))) {
    const dst = join(buildDir, 'android', 'app', 'src', 'main', 'assets', 'public', 'app-config.json');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, bakedJson);
    log.ok('android assets/public/app-config.json');

    // 한글 등 non-ASCII 사용자명 경로(예: C:\Users\김바다)면 AGP 가 빌드를 거부한다.
    // 순수 웹뷰 앱은 overridePathCheck 로 안전하게 우회된다(검증됨).
    if (/[^\x00-\x7F]/.test(buildDir)) {
      const gp = join(buildDir, 'android', 'gradle.properties');
      let txt = existsSync(gp) ? readFileSync(gp, 'utf8') : '';
      if (!txt.includes('android.overridePathCheck')) {
        txt += `${txt.endsWith('\n') || txt === '' ? '' : '\n'}` +
          '\n# non-ASCII 경로(한글 사용자명 등) 우회 — generate-app 자동 주입\n' +
          'android.overridePathCheck=true\n';
        writeFileSync(gp, txt);
        log.ok('gradle.properties: android.overridePathCheck=true (non-ASCII 경로 우회)');
      }
    }
    patchAndroidSigning(buildDir); // 릴리즈 서명(keystore.properties 조건부) — CI 배포용
    patchAndroidSplash(buildDir, cfg); // 안드12+ 스플래시(배경색+가운데 아이콘)
  }
  if (existsSync(join(buildDir, 'ios'))) {
    const dst = join(buildDir, 'ios', 'App', 'App', 'public', 'app-config.json');
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, bakedJson);
    log.ok('ios App/public/app-config.json');
  }

  // 7a-2) 네이티브 버전 주입 (CI 경로에서도 version.code/name 반영 — 재배포 중복거부 방지)
  patchNativeVersion(buildDir, cfg);

  // 7b) 딥링크 네이티브 배선 (features.deepLink) + iOS 권한 사용 설명
  if (cfg.features.deepLink) {
    log.step('딥링크 네이티브 배선 (App Links / Universal Links)');
    patchAndroidDeepLinks(buildDir, cfg);
    patchIosDeepLinks(buildDir, cfg);
  }
  log.step('iOS 권한 사용 설명(Info.plist) 점검');
  patchIosUsageStrings(buildDir, cfg);
  if (args.local) patchIosLocalAts(buildDir); // 로컬 dev 평문 http 허용(ATS 예외)

  // 7c) 인증 네이티브 배선 (OAuth 복귀 URL scheme + Apple Sign In)
  if (authConf.hasOAuth || (cfg.auth?.providers || []).includes('apple')) {
    log.step('인증 네이티브 배선 (OAuth URL scheme / Apple Sign In)');
    patchAndroidAuthScheme(buildDir, cfg);
    patchIosAuthScheme(buildDir, cfg);
    // IdP 모드면 Apple 도 IdP 경유 → 네이티브 Sign in with Apple 엔타이틀먼트 불필요
    if (!authConf.idp) patchIosAppleEntitlement(buildDir, cfg);
  }

  // 7d) iOS 엔타이틀먼트를 Xcode 프로젝트에 연결(App.entitlements 있을 때만)
  patchIosPbxEntitlements(buildDir);

  // 8) 동기화 — 요청한 플랫폼만 sync 한다. (android 만 빌드할 때 iOS pod install 로 깨지는 것 방지)
  if (!args.skipSync) {
    log.step('cap sync');
    const syncArgs = args.platform === 'both' ? ['cap', 'sync'] : ['cap', 'sync', args.platform];
    run('npx', syncArgs, buildDir);
  }

  log.step('완료');
  log.info(`프로젝트: build/${cfg.slug}`);
  log.info('다음: generate-assets(아이콘/스플래시) → gradlew(Android) / xcodebuild(iOS)');
  if (cfg.version.code) log.dim(`버전 v${cfg.version.name}+${cfg.version.code} — 네이티브(versionCode/CFBundleVersion)에 주입됨`);
}

main();
