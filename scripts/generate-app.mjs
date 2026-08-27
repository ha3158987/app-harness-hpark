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
import { authSetup } from './lib/auth-setup.mjs';
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
  // iOS 에서 @capacitor/push-notifications 는 APNs 토큰만 준다. FCM 백엔드용 FCM 토큰은
  // @capacitor-community/fcm 로 취득한다(Android 는 push-notifications 가 이미 FCM 토큰 반환).
  push: ['@capacitor/push-notifications', '@capacitor-community/fcm'],
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

// 레포 안에서 유지하는 로컬 Capacitor 플러그인 → template/ 하위 경로.
// 공식/커뮤니티 플러그인이 없어 우리가 직접 짠 것들만 여기 온다. npm 에 올리지 않고
// build/<slug>/package.json 에 file: 절대경로로 박는다(브릿지와 같은 방식).
const LOCAL_PLUGINS = {
  '@aipia-team/capacitor-adbrix': ['template', 'plugins', 'adbrix', 'plugin'],
};

function localPluginPath(pkg) {
  const seg = LOCAL_PLUGINS[pkg];
  return seg ? `file:${join(ROOT, ...seg)}` : null;
}

// 패키지 버전 해석: 로컬 플러그인은 file: 경로, 공식 @capacitor/* 는 코어와 같은 메이저(^8),
// 커뮤니티/벤더 SDK 는 메이저가 코어와 다르므로 'latest' 로 npm 이 호환 버전을 고르게 한다.
function versionFor(pkg) {
  return localPluginPath(pkg) || (pkg.startsWith('@capacitor/') ? '^8.0.0' : 'latest');
}

// iOS Info.plist 권한 사용 설명 문구 (기능 켜질 때만 주입). 누락 시 iOS 가 권한 요청 즉시 크래시.
const IOS_USAGE = {
  camera: { NSCameraUsageDescription: '사진 촬영을 위해 카메라 접근이 필요합니다.',
            NSPhotoLibraryUsageDescription: '사진 선택을 위해 사진 보관함 접근이 필요합니다.',
            NSPhotoLibraryAddUsageDescription: '사진 저장을 위해 사진 보관함 접근이 필요합니다.' },
  geolocation: { NSLocationWhenInUseUsageDescription: '위치 기반 기능을 위해 위치 접근이 필요합니다.' },
  biometric: { NSFaceIDUsageDescription: '본인 확인을 위해 Face ID 를 사용합니다.' },
};

// ATT 활성 여부. tracking.att.enabled 가 정본이고, 어트리뷰션 벤더만 켜둔 예전 config 는
// 하위호환으로 함께 인정한다(그 경우 문구는 usageDescription 이 없으면 주입되지 않는다).
function attEnabled(cfg) {
  return !!(cfg.tracking?.att?.enabled || cfg.marketing?.attribution?.provider);
}

// 마케팅 SDK: 자동 배선(npm 설치)되는 벤더 → 패키지. WIRED_PROVIDERS 와 일치.
const MARKETING_PLUGINS = {
  attribution: {
    appsflyer: ['appsflyer-capacitor-plugin'],
    // Adbrix 는 공식 Capacitor 플러그인이 없다(2026-08 npm/GitHub/공식문서 전수 확인).
    // 그래서 하네스가 직접 유지하는 로컬 플러그인을 쓴다 → LOCAL_PLUGINS 참조.
    adbrix: ['@aipia-team/capacitor-adbrix'],
  },
};

// 인증 플러그인 + 규칙 판정은 scripts/lib/auth-setup.mjs 가 정본이다 (doctor.mjs 도 같은 걸 쓴다).

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
        `벤더 SDK 수동 설치 + 브릿지 핸들러 연결 필요 (docs/20-REFERENCES.md).`);
    }
  }
  return { plugins, warnings };
}

// 베이크 전용 config: 런타임 config + 환경변수 시크릿(키). 네이티브 번들에만 들어가고
// (build/ 는 gitignore) www 폴백엔 키를 넣지 않는다.
function bakedConfig(cfg, rc) {
  const baked = structuredClone(rc);
  const ap = cfg.marketing?.attribution;
  if (ap?.provider === 'adbrix') {
    const appKey = envFor(cfg.slug, 'ADBRIX_APP_KEY');
    const secretKey = envFor(cfg.slug, 'ADBRIX_SECRET_KEY');
    baked.marketing.attribution.adbrix = {
      appKey: appKey || null,
      secretKey: secretKey || null,
    };
    if (!appKey || !secretKey) {
      log.warn('ADBRIX_APP_KEY / ADBRIX_SECRET_KEY 환경변수 없음 — Adbrix 는 키 없이 빌드되어 ' +
        '런타임 비활성(어트리뷰션 미수집). 키 주입 후 재실행하면 활성화된다.');
    }
  }
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
    else if (v === '--release') a.release = true; // 릴리즈 빌드 — 스토어 요건 검증을 치명적으로 승격
  }
  if (!a.slug) fail('--slug <slug> 필요');
  if (a.local && !/^https?:\/\//.test(a.local)) fail('--local 은 http(s):// 로 시작하는 전체 URL 이어야 함');
  if (a.local && a.release) fail('--local 과 --release 는 함께 쓸 수 없다 — --local 은 dev 전용(cleartext+ATS)이라 스토어 제출 금지');
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
      // statusBarStyle/navigationBarStyle: edge-to-edge 에선 시스템바가 투명이라 아이콘 색을 theme 에 맞춰야 한다.
      //   plugin enum: LIGHT=밝은배경용 '어두운' 아이콘 / DARK=어두운배경용 '밝은' 아이콘 (theme.statusBarStyle 와 직결).
      //   단, 이 설정은 "구성 변경(다크모드 토글 등) 시 재적용"용이고, 앱 최초 시작 시 적용은
      //   네이티브 브릿지(AppBridgePlugin.load)가 담당한다(플러그인이 시작 시엔 적용 안 함).
      SafeArea: {
        statusBarStyle: isDark ? 'DARK' : 'LIGHT',
        navigationBarStyle: isDark ? 'DARK' : 'LIGHT',
      },
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
  // platform 없이 호출한다 — plugins 는 provider 로만 결정되고(lib/auth-setup.mjs 의
  // AUTH_NATIVE_PLUGINS), platform 은 storeBlockers 판정에만 쓰이는데 여기선 쓰지 않는다.
  authSetup(cfg).plugins.forEach((p) => set.add(p));
  iapSetup(cfg).plugins.forEach((p) => set.add(p));
  // iOS ATT(추적동의) 플러그인. tracking.att 로 독립 제어하되, 어트리뷰션 벤더가 켜져 있으면
  // 예전 config(tracking 블록 없음)도 그대로 동작하도록 하위호환 유지.
  if (attEnabled(cfg)) set.add('capacitor-plugin-app-tracking-transparency');
  // Firebase Remote Config — 강제 업데이트 1차 소스 + 범용 원격 설정.
  // peer 로 firebase JS SDK 를 요구하지만 그건 플러그인의 웹 구현용이고, 셸은 네이티브만 쓴다.
  if (cfg.firebase?.enabled && cfg.firebase?.remoteConfig) {
    set.add('@capacitor-firebase/remote-config');
  }
  // 크래시 리포트(@sentry/capacitor)는 프레임워크 형제(@sentry/react|vue|angular)를 peer 로 요구하므로
  // 하네스가 자동설치하지 않는다 — 웹 앱이 자기 프레임워크에 맞춰 설치(docs/06-INTEGRATION.md). 브릿지는 graceful.
  return [...set];
}

// 빌드 디렉터리 package.json (없을 때만 생성). 플러그인 + 로컬 브릿지 의존성 선언.
/**
 * 기존 build 의 package.json 을 config 가 요구하는 플러그인 목록과 맞춘다.
 *
 * 왜 필요한가: 예전엔 build 가 이미 있으면 package.json 을 통째로 건너뛰었다. 그래서 config 에서
 * 기능을 새로 켜도(예: tracking.att.enabled) 그 플러그인이 영원히 설치되지 않았다.
 * 크래시가 아니라 **조용한 무동작**으로 나타나 원인을 찾기 어렵다 — 브릿지가 플러그인 import 에
 * 실패하면 'unavailable' 을 돌려주고 넘어가므로 로그에도 잘 안 남는다.
 *
 * **추가만 하고 삭제하지 않는다.** 사람이 손으로 넣은 의존성(벤더 SDK 등)을 날리지 않기 위해서다.
 * 기능을 껐을 때 남는 잉여 플러그인은 앱 용량만 늘 뿐 동작을 깨지 않는다 — capability 플래그가
 * off 라 브릿지가 호출하지 않는다.
 */
function reconcilePackageJson(buildDir, cfg, plugins) {
  const file = join(buildDir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // 손상됐으면 새로 쓰는 편이 낫다.
    log.warn('build/package.json 을 읽을 수 없어 새로 생성한다');
    scaffoldPackageJson(buildDir, cfg, plugins);
    return;
  }
  const deps = pkg.dependencies || (pkg.dependencies = {});

  // 브릿지는 절대경로 file: 라 레포를 옮기면 깨진다 — 매번 현재 경로로 맞춘다.
  const bridgePath = `file:${join(ROOT, 'template', 'bridge')}`;
  const changed = [];
  if (deps['@aipia-team/harness-bridge'] !== bridgePath) {
    deps['@aipia-team/harness-bridge'] = bridgePath;
    changed.push('@aipia-team/harness-bridge(경로 갱신)');
  }
  for (const p of plugins) {
    const local = localPluginPath(p);
    if (local) {
      // 로컬 플러그인도 절대경로 file: 이라 브릿지와 같은 이유로 매번 맞춘다.
      if (deps[p] !== local) { deps[p] = local; changed.push(`${p}(경로 갱신)`); }
    } else if (!deps[p]) {
      deps[p] = versionFor(p); changed.push(p);
    }
  }
  // 플랫폼/CLI 는 scaffold 와 동일 규칙으로 보강
  for (const [p, v] of [['@capacitor/cli', '^8.0.0'], ['@capacitor/android', '^8.0.0']]) {
    if (!deps[p]) { deps[p] = v; changed.push(p); }
  }
  if (IS_MAC && !deps['@capacitor/ios']) { deps['@capacitor/ios'] = '^8.0.0'; changed.push('@capacitor/ios'); }

  if (!changed.length) {
    log.ok(`package.json: config 와 일치 (플러그인 ${plugins.length}개)`);
    return;
  }
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  log.ok(`package.json: 누락 의존성 ${changed.length}개 추가 — ${changed.join(', ')}`);
  log.dim('  (기존 의존성은 삭제하지 않는다 — 수동 추가분 보호)');
}

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

// features.push: Android 13+ 알림 런타임 권한을 명시 선언한다.
// firebase-messaging(23.0.6+) AAR 매니페스트 머지에 암묵 의존하면 라이브러리
// 버전에 따라 조용히 빠질 수 있다 — 권한이 없으면 requestPermissions 가
// 프롬프트 없이 거부되어 "알림이 안 오는데 에러도 없는" 상태가 된다.
function patchAndroidPushPermission(buildDir) {
  const manifest = join(buildDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (!existsSync(manifest)) return;
  let xml = readFileSync(manifest, 'utf8');
  if (xml.includes('android.permission.POST_NOTIFICATIONS')) return; // idempotent
  const perm =
`    <!-- harness-push: Android 13+ 알림 권한 (generate-app 자동 주입) -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
`;
  const appTag = xml.indexOf('<application');
  if (appTag === -1) return;
  xml = xml.slice(0, appTag) + perm.trimEnd() + '\n\n    ' + xml.slice(appTag);
  writeFileSync(manifest, xml);
  log.ok('AndroidManifest: POST_NOTIFICATIONS (push)');
}

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

// ── 딥링크 도메인 증명 파일 (.well-known) ──────────────────────────────────
// Universal Link(iOS) / App Link(Android) 는 **앱 설정만으로는 동작하지 않는다.**
// 도메인이 "이 앱을 신뢰한다"고 선언하는 파일 2개를 웹이 서빙해야 한다.
// 앱 쪽(entitlements / intent-filter)은 위 patch* 가 자동으로 넣지만, 이 파일들은
// 웹 레포 소관이라 하네스가 직접 배치할 수 없다 → build/<slug>/well-known/ 에 만들어 두고
// 웹에 옮기는 방법을 안내한다. 신규 앱이 손으로 JSON 을 짜다 틀리는 것을 막는 게 목적이다.

// Apple 팀 ID 해석: config → 환경변수. 조직 공통값이라 보통 환경변수 하나로 전 앱이 해결된다.
// FASTLANE_DEV_TEAM_ID 는 이미 fastlane 이 쓰는 이름이라 그대로 재사용한다(중복 설정 방지).
function resolveAppleTeamId(cfg) {
  return cfg.ios?.teamId
    || process.env.APPLE_TEAM_ID
    || process.env.FASTLANE_DEV_TEAM_ID
    || null;
}

// AASA/assetlinks 를 서빙해야 하는 실제 호스트 목록.
// 와일드카드(*.example.com)는 파일을 서빙할 대상이 아니다 — 각 실호스트가 자기 파일을 준다.
function wellKnownHosts(cfg) {
  const hosts = (cfg.navigation.allowedDomains || []).filter((d) => !d.includes('*'));
  const startHost = new URL(cfg.startUrl).hostname;
  return [...new Set([startHost, ...hosts])];
}

// 같은 호스트를 선언한 **모든** 앱을 모은다.
// 한 도메인의 증명 파일은 그 도메인을 쓰는 앱 전부를 인가해야 한다 — dev/stage/prod 를
// 따로 쓰면 나중에 배포한 파일이 앞선 앱을 덮어 링크가 조용히 깨진다.
// (Poptale 의 AASA 도 한 파일에 prod/stage/dev 3개 appID 가 들어 있다.)
function collectAppsByHost(repoRoot) {
  const byHost = new Map(); // host → [{ appId, teamId, fps }]
  const appsDir = join(repoRoot, 'apps');
  if (!existsSync(appsDir)) return byHost;
  for (const slug of readdirSync(appsDir)) {
    let c;
    try {
      c = loadConfig(repoRoot, slug);
    } catch {
      continue; // 잘못된/미완성 config 는 조용히 건너뛴다 — 남의 앱 때문에 내 빌드가 죽지 않게
    }
    if (!c.features?.deepLink) continue;
    const entry = {
      appId: c.appId,
      teamId: resolveAppleTeamId(c),
      fps: c.android?.sha256CertFingerprints || [],
    };
    for (const host of wellKnownHosts(c)) {
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(entry);
    }
  }
  return byHost;
}

function writeWellKnown(buildDir, cfg) {
  const outDir = join(buildDir, 'well-known');
  const byHost = collectAppsByHost(ROOT);
  const myHosts = wellKnownHosts(cfg);
  const missing = new Set();
  let wrote = 0;

  for (const host of myHosts) {
    const apps = byHost.get(host) || [];
    const withTeam = apps.filter((a) => a.teamId);
    const withFps = apps.filter((a) => a.fps.length);
    const hostDir = join(outDir, host);

    // (1) apple-app-site-association — **확장자 없는 파일**. paths:["*"] = 모든 경로를 앱으로.
    if (withTeam.length) {
      const ids = [...new Set(withTeam.map((a) => `${a.teamId}.${a.appId}`))];
      const aasa = {
        applinks: {
          apps: [],
          details: ids.map((appID) => ({ appID, paths: ['*'] })),
        },
        // 앱↔웹 비밀번호 공유(iOS 자동 로그인). 있어서 손해 없고 없으면 기능이 안 붙는다.
        webcredentials: { apps: ids },
      };
      mkdirSync(hostDir, { recursive: true });
      writeFileSync(join(hostDir, 'apple-app-site-association'), JSON.stringify(aasa, null, 2) + '\n');
      log.ok(`${host}/apple-app-site-association — 앱 ${ids.length}개: ${ids.join(', ')}`);
      wrote++;
    } else {
      missing.add('Apple 팀 ID — config 의 ios.teamId 또는 환경변수 APPLE_TEAM_ID / FASTLANE_DEV_TEAM_ID');
    }

    // (2) assetlinks.json — 지문이 없으면 만들지 않는다. 틀린 지문을 배포하면 검증이 조용히
    //     실패해 링크가 브라우저로 열리는데, 파일이 없는 것보다 디버깅이 더 어렵다.
    if (withFps.length) {
      const assetlinks = withFps.map((a) => ({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: a.appId,
          sha256_cert_fingerprints: a.fps,
        },
      }));
      mkdirSync(hostDir, { recursive: true });
      writeFileSync(join(hostDir, 'assetlinks.json'), JSON.stringify(assetlinks, null, 2) + '\n');
      log.ok(`${host}/assetlinks.json — 앱 ${withFps.length}개`);
      wrote++;
      for (const a of withFps) {
        if (a.fps.length === 1) {
          log.warn(`${a.appId} 지문이 1개다 — Play 앱 서명을 쓰면 업로드 키 + Play 앱 서명 키 ` +
            '2개가 모두 필요하다. 1개만 등록하면 App Link 검증이 조용히 실패한다.');
        }
      }
    } else {
      missing.add('Android SHA-256 지문 — config 의 android.sha256CertFingerprints ' +
        '(Play Console > 앱 > 설정 > 앱 서명 에서 업로드 키·앱 서명 키 2개)');
    }
  }

  if (missing.size) {
    log.warn('딥링크 도메인 증명 파일을 일부 만들지 못했다. 없으면 링크가 앱이 아니라 ' +
      '브라우저로 열린다(에러 없이 조용히):');
    missing.forEach((m) => log.warn(`  · ${m}`));
  }

  // 웹에 옮기는 방법 안내 — 하네스는 웹 레포를 모르므로 여기서부터는 사람의 몫이다.
  if (wrote) {
    log.info('각 호스트의 웹 서비스가 아래 경로로 서빙해야 한다:');
    log.dim('  <웹루트>/.well-known/apple-app-site-association   ← 확장자 없음, Content-Type: application/json');
    log.dim('  <웹루트>/.well-known/assetlinks.json');
    log.dim(`  생성물: ${outDir}/<host>/`);
    log.dim('  ⚠️ 리다이렉트 없이 200 이어야 하고, 인증 미들웨어에서 제외해야 한다(크롤러는 비로그인).');
    log.dim('  ⚠️ 한 호스트를 여러 앱(dev/stage/prod)이 쓰면 이 파일 하나에 전부 들어 있다 — ' +
      '앱별로 따로 올리지 말 것(덮어쓰면 다른 앱 링크가 깨진다).');
  }
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
  // ATT: 추적 사용 설명 문구. 없으면 ATT 호출 시 iOS 가 크래시한다.
  // 기본 문구를 하네스가 제공하지 않는 이유 — 앱마다 실제 용도가 다른데 기본값이 그대로 출시되면
  // "표기한 목적과 실제 용도가 다른" 상태가 된다(Poptale 사례). config 로 강제한다.
  if (attEnabled(cfg)) {
    const desc = cfg.tracking?.att?.usageDescription;
    if (typeof desc === 'string' && desc.trim() !== '') {
      add.NSUserTrackingUsageDescription = desc.trim();
    } else if (cfg.tracking?.att?.enabled) {
      // loadConfig 가 이미 막지만, tracking 블록을 우회해 들어온 경우의 최종 방어선.
      fail('tracking.att.enabled=true 인데 tracking.att.usageDescription 이 비어 있음 — ' +
        'Info.plist 문구 없이 ATT 를 켜면 권한 요청 시점에 iOS 가 크래시한다.');
    } else {
      // 하위호환 경로(어트리뷰션 벤더만 켜둔 예전 config): 문구를 임의로 만들지 않고 경고만.
      log.warn('ATT 플러그인은 설치되지만 NSUserTrackingUsageDescription 이 없다 — ' +
        'tracking.att.usageDescription 을 채워라. 없으면 ATT 호출 시 크래시한다.');
    }
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

// ── iOS 원격 푸시(FCM) 네이티브 배선 ────────────────────────────────────────
// features.push + iOS 에 필요한 4가지: (1) aps-environment 엔타이틀먼트 (2) UIBackgroundModes
// remote-notification (3) GoogleService-Info.plist 번들 등록 (4) AppDelegate FirebaseApp.configure().
// ⚠️ (1) 을 넣는 순간 프로비저닝 프로파일에 Push Notifications capability 가 있어야 빌드가 통과한다
//    (associated-domains 와 동일 실패모드). App ID capability + match 프로파일 재생성 선행 필수 → docs/08-DEPLOY.md §9.
// ⚠️ (3)(4) 는 pbxproj/AppDelegate 정규식 편집 — 첫 macOS 빌드에서 검증 필요.

// (1) aps-environment. app-store/TestFlight 배포 = production APNs.
function patchIosPushEntitlement(buildDir) {
  const iosAppDir = join(buildDir, 'ios', 'App', 'App');
  if (!existsSync(iosAppDir)) return;
  const entFile = join(iosAppDir, 'App.entitlements');
  const KEY = 'aps-environment';
  const block = `\t<key>${KEY}</key>\n\t<string>production</string>\n`;
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
  log.ok('iOS App.entitlements: aps-environment = production (push)');
}

// (2) UIBackgroundModes remote-notification (백그라운드/사일런트 푸시 수신).
function patchIosPushBackgroundMode(buildDir) {
  const plistFile = join(buildDir, 'ios', 'App', 'App', 'Info.plist');
  if (!existsSync(plistFile)) return;
  let xml = readFileSync(plistFile, 'utf8');
  if (xml.includes('remote-notification')) return; // idempotent
  const block =
    '\t<key>UIBackgroundModes</key>\n' +
    '\t<array>\n' +
    '\t\t<string>remote-notification</string>\n' +
    '\t</array>';
  const close = xml.lastIndexOf('</dict>');
  if (close === -1) return;
  xml = xml.slice(0, close) + block + '\n' + xml.slice(close);
  writeFileSync(plistFile, xml);
  log.ok('iOS Info.plist: UIBackgroundModes remote-notification (push)');
}

// (3) GoogleService-Info.plist 를 App 타깃 번들 리소스로 등록(pbxproj). 실제 파일은
//     CI(release.yml) 또는 로컬 secrets 가 build/<slug>/ios/App/GoogleService-Info.plist 로 넣는다.
//     (pbxproj 참조가 sourceTree "<group>"=SOURCE_ROOT 로 잡혀 ios/App/ 기준으로 찾으므로 그 위치에 둔다.)
//     ⚠️ 이 참조를 넣으면 빌드 시 그 경로에 파일이 반드시 있어야 한다(없으면 xcodebuild 실패) → 시크릿 필수(docs/08-DEPLOY.md §9).
function patchIosGoogleServicePlistRef(buildDir) {
  const pbx = join(buildDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  if (!existsSync(pbx)) return;
  let txt = readFileSync(pbx, 'utf8');
  if (txt.includes('GoogleService-Info.plist')) return; // idempotent
  const NAME = 'GoogleService-Info.plist';
  const FILE_REF = 'FC00000000000000000A0001';  // 고정 24-hex ID (idempotent)
  const BUILD_FILE = 'FC00000000000000000B0001';
  let ok = true;
  const set = (cond) => { if (!cond) ok = false; };
  // PBXBuildFile
  set(txt.includes('/* Begin PBXBuildFile section */'));
  txt = txt.replace('/* Begin PBXBuildFile section */\n',
    `/* Begin PBXBuildFile section */\n\t\t${BUILD_FILE} /* ${NAME} in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF} /* ${NAME} */; };\n`);
  // PBXFileReference
  set(txt.includes('/* Begin PBXFileReference section */'));
  txt = txt.replace('/* Begin PBXFileReference section */\n',
    `/* Begin PBXFileReference section */\n\t\t${FILE_REF} /* ${NAME} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "${NAME}"; sourceTree = "<group>"; };\n`);
  // 첫 PBXResourcesBuildPhase 의 files 목록에 추가
  const resIdx = txt.indexOf('isa = PBXResourcesBuildPhase;');
  set(resIdx !== -1);
  if (resIdx !== -1) {
    const filesIdx = txt.indexOf('files = (', resIdx);
    set(filesIdx !== -1);
    if (filesIdx !== -1) {
      const at = filesIdx + 'files = ('.length;
      txt = txt.slice(0, at) + `\n\t\t\t\t${BUILD_FILE} /* ${NAME} in Resources */,` + txt.slice(at);
    }
  }
  if (!ok) {
    log.warn('GoogleService-Info.plist pbxproj 등록 실패(앵커 못 찾음) — Xcode 에서 수동 추가 필요.');
    return;
  }
  writeFileSync(pbx, txt);
  log.ok('iOS project.pbxproj: GoogleService-Info.plist 번들 리소스 등록');
}

// (4) AppDelegate 에 Firebase 초기화 주입 — @capacitor-community/fcm 가 FCM 토큰을 내려면 필요.
function patchIosFirebaseInit(buildDir) {
  const appDelegate = join(buildDir, 'ios', 'App', 'App', 'AppDelegate.swift');
  if (!existsSync(appDelegate)) return;
  let txt = readFileSync(appDelegate, 'utf8');
  if (txt.includes('FirebaseApp.configure()')) return; // idempotent
  if (!/^import Firebase(Core)?\b/m.test(txt)) {
    txt = txt.replace(/^(import Capacitor\s*)$/m, '$1\nimport FirebaseCore');
  }
  const m = txt.match(/(func application\([^)]*didFinishLaunchingWithOptions[^)]*\)[^{]*\{[ \t]*\n)/);
  if (!m) {
    log.warn('AppDelegate didFinishLaunching 앵커 못 찾음 — FirebaseApp.configure() 수동 추가 필요.');
    return;
  }
  txt = txt.replace(m[1], `${m[1]}        FirebaseApp.configure()\n`);
  writeFileSync(appDelegate, txt);
  log.ok('iOS AppDelegate.swift: FirebaseApp.configure() 주입');
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

// (5) iOS Notification Service Extension — 푸시 알림에 캐릭터 프로필 사진을 붙인다.
//
// 왜 확장이 필요한가: **APNs 는 페이로드로 이미지를 못 붙인다.** Android 는 FCM SDK 가
// `notification.image` 를 받아 펼친 큰 사진과 접힌 `largeIcon`(프로필 자리)에 알아서
// 쓰지만, iOS 는 `mutable-content: 1` 로 확장을 깨워 확장이 직접 내려받아 첨부하는
// 경로밖에 없다. 확장이 없으면 서버가 이미지를 보내도 앱 아이콘만 뜬다.
//
// 다운로드 코드는 직접 쓰지 않는다. FCM iOS SDK 의
// `Messaging.serviceExtension().populateNotificationContent` 가 `apns.fcm_options.image`
// 를 보고 내려받아 첨부까지 해 준다 — 서버가 그 키를 보내고 있다(BE `fcm.py`).
//
// pbxproj 는 문자열 앵커로 직접 편집한다(이 파일의 다른 patch 들과 같은 방식). 새 타깃
// 하나는 14개 섹션에 걸쳐 있어 양이 많지만, 고정 24-hex ID 를 쓰므로 재실행해도
// 같은 결과가 되고(idempotent) 의존성이 늘지 않는다. 앵커를 못 찾으면 경고만 남기고
// 아무것도 쓰지 않는다 — 반쯤 편집된 프로젝트 파일은 Xcode 가 아예 못 여는 게 최악이라
// 실패는 눈에 보이는 쪽으로 둔다.
const NSE_NAME = 'NotificationService';
// 이 블록의 고정 ID들 — `FC…0C…` 대역. 다른 patch(0A/0B 대역)와 겹치지 않는다.
const NSE_IDS = {
  group: 'FC00000000000000000C0001',
  appexRef: 'FC00000000000000000C0002',
  swiftRef: 'FC00000000000000000C0003',
  plistRef: 'FC00000000000000000C0004',
  swiftBuild: 'FC00000000000000000C0005',
  appexBuild: 'FC00000000000000000C0006',
  sources: 'FC00000000000000000C0007',
  frameworks: 'FC00000000000000000C0008',
  resources: 'FC00000000000000000C0009',
  target: 'FC00000000000000000C000A',
  cfgDebug: 'FC00000000000000000C000B',
  cfgRelease: 'FC00000000000000000C000C',
  cfgList: 'FC00000000000000000C000D',
  proxy: 'FC00000000000000000C000E',
  dependency: 'FC00000000000000000C000F',
  embed: 'FC00000000000000000C0010',
};

const NSE_SWIFT = `// 하네스 자동 생성 (scripts/generate-app.mjs) — 직접 수정하면 재생성 시 덮어씁니다.
//
// 푸시 알림에 캐릭터 프로필 사진을 붙이는 확장. APNs 는 페이로드만으로 이미지를
// 붙일 수 없어서, 서버가 \`mutable-content: 1\` 로 이 확장을 깨우고 여기서 이미지를
// 내려받아 첨부한다.
//
// 다운로드/첨부는 FCM SDK 헬퍼가 한다 — \`apns.fcm_options.image\` 를 읽는다.
// 직접 URLSession 을 굴리지 않는 이유: 캐싱·타임아웃·파일 확장자 판별을 SDK 가
// 이미 처리하고, 서버가 보내는 키와 계약이 한곳에 모인다.

import UserNotifications
import FirebaseMessaging

final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let mutable = request.content.mutableCopy() as? UNMutableNotificationContent else {
      // 복제 실패는 이론상 없지만, 그때도 알림 자체는 떠야 한다(이미지만 포기).
      contentHandler(request.content)
      return
    }
    self.bestAttempt = mutable
    Messaging.serviceExtension().populateNotificationContent(mutable, withContentHandler: contentHandler)
  }

  override func serviceExtensionTimeWillExpire() {
    // 시간이 다 되면 지금까지 만든 내용으로 낸다. 이걸 빼면 이미지 다운로드가 느릴 때
    // **알림이 아예 안 뜬다** — 사진보다 알림이 뜨는 게 중요하다.
    if let handler = contentHandler, let content = bestAttempt {
      handler(content)
    }
  }
}
`;

function nseInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>${NSE_NAME}</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>$(MARKETING_VERSION)</string>
\t<key>CFBundleVersion</key>
\t<string>$(CURRENT_PROJECT_VERSION)</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.usernotifications.service</string>
\t\t<key>NSExtensionPrincipalClass</key>
\t\t<string>$(PRODUCT_MODULE_NAME).${NSE_NAME}</string>
\t</dict>
</dict>
</plist>
`;
}

// Podfile 에 확장 타깃을 추가한다. `pod install` 은 이 뒤(cap sync)에 돌아가므로
// 그때 Pods-NotificationService.*.xcconfig 가 생기고 baseConfigurationReference 도
// CocoaPods 가 알아서 연결한다.
function patchIosPodfileNotificationExtension(buildDir) {
  const podfile = join(buildDir, 'ios', 'App', 'Podfile');
  if (!existsSync(podfile)) return true;
  let txt = readFileSync(podfile, 'utf8');
  if (txt.includes(`target '${NSE_NAME}'`)) return true; // idempotent
  // `target 'App' do` … 그 블록의 **첫** `end` 까지. 홑/쌍따옴표 둘 다 받는다.
  // 비탐욕(`*?`)이라 중첩 블록이 있으면 안쪽 end 에서 끊기는데, 그건 삽입 위치가
  // 조금 이를 뿐 유효한 Podfile 이다(타깃 블록 사이에 들어간다).
  const anchor = /\ntarget ['"]App['"] do\n[\s\S]*?\nend\n/;
  if (!anchor.test(txt)) {
    log.warn(`Podfile 의 target 'App' 블록을 못 찾음 — ${NSE_NAME} pod 수동 추가 필요.`);
    return false;
  }
  // FirebaseMessaging 만 넣는다. 확장은 앱과 별개 바이너리라 Capacitor 플러그인 전체를
  // 링크할 이유가 없고, 넣으면 확장 크기 제한(메모리 24MB)에 불리하다.
  txt = txt.replace(anchor, (m) => `${m}\ntarget '${NSE_NAME}' do\n  pod 'FirebaseMessaging'\nend\n`);
  writeFileSync(podfile, txt);
  log.ok(`iOS Podfile: target '${NSE_NAME}' (pod FirebaseMessaging) 추가`);
  return true;
}

function patchIosNotificationServiceExtension(buildDir, cfg) {
  const iosApp = join(buildDir, 'ios', 'App');
  const pbxPath = join(iosApp, 'App.xcodeproj', 'project.pbxproj');
  if (!existsSync(pbxPath)) return;
  let txt = readFileSync(pbxPath, 'utf8');
  if (txt.includes(NSE_IDS.target) || txt.includes(`${NSE_NAME}.appex`)) {
    // 이미 등록됨 — Podfile 만 확인(먼저 실패한 실행의 잔여 상태 보정).
    patchIosPodfileNotificationExtension(buildDir);
    return;
  }
  // 확장 타깃 이름이 Podfile 표기와 어긋나면 안 되므로 `target '…'`(홑따옴표) 형태를
  // 전제로 한다. Capacitor 가 생성하는 Podfile 이 그 형태다.

  // 앵커 탐색 — 하드코딩 대신 프로젝트에서 읽는다(Capacitor 템플릿이 바뀌어도 견딘다).
  const appTarget = txt.match(/([0-9A-F]{24}) \/\* App \*\/ = \{\s*\n\s*isa = PBXNativeTarget;/);
  const mainGroup = txt.match(/mainGroup = ([0-9A-F]{24});/);
  const productsGroup = txt.match(/([0-9A-F]{24}) \/\* Products \*\/ = \{/);

  // 빌드 설정은 **App 타깃의 설정 블록 안에서만** 읽는다. 파일 전체에서 첫 매칭을
  // 쓰면 다른 타깃(테스트·위젯, 그리고 이 확장 자체)의 값이 잡혀 확장 번들 id 가
  // `엉뚱한앱id.NotificationService` 가 되거나 배포 설정이 앱과 어긋난다.
  const appCfgListId = txt.match(
    new RegExp(`${appTarget?.[1] ?? '\\x00'} \\/\\* App \\*\\/ = \\{[\\s\\S]*?buildConfigurationList = ([0-9A-F]{24})`),
  )?.[1];
  let appSettingsText = '';
  if (appCfgListId) {
    const cfgListBlock = txt.match(
      new RegExp(`${appCfgListId}[^=]*= \\{\\s*\\n\\s*isa = XCConfigurationList;[\\s\\S]*?buildConfigurations = \\(([\\s\\S]*?)\\);`),
    )?.[1];
    for (const id of cfgListBlock?.match(/[0-9A-F]{24}/g) ?? []) {
      const block = txt.match(new RegExp(`${id}[^=]*= \\{\\s*\\n\\s*isa = XCBuildConfiguration;[\\s\\S]*?\\n\\t\\t\\};`));
      if (block) appSettingsText += block[0];
    }
  }
  const pick = (key) => appSettingsText.match(new RegExp(`${key} = ([^;\\n]+);`));

  const bundleId = pick('PRODUCT_BUNDLE_IDENTIFIER');
  const deployTarget = pick('IPHONEOS_DEPLOYMENT_TARGET');
  const swiftVersion = pick('SWIFT_VERSION');
  const team = pick('DEVELOPMENT_TEAM');
  // 버전은 App 타깃과 반드시 같아야 한다 — 다르면 App Store 업로드가 거부된다.
  const marketing = pick('MARKETING_VERSION');
  const projectVersion = pick('CURRENT_PROJECT_VERSION');

  const missing = [];
  if (!appSettingsText) missing.push('App 타깃 빌드 설정');
  if (!appTarget) missing.push('App 네이티브 타깃');
  if (!mainGroup) missing.push('mainGroup');
  if (!productsGroup) missing.push('Products 그룹');
  if (!bundleId) missing.push('PRODUCT_BUNDLE_IDENTIFIER');
  if (missing.length) {
    log.warn(`iOS ${NSE_NAME} 확장 등록 실패(앵커 없음: ${missing.join(', ')}) — Xcode 에서 수동 추가 필요.`);
    return;
  }

  const APP_TARGET = appTarget[1];
  const MAIN_GROUP = mainGroup[1];
  const PRODUCTS_GROUP = productsGroup[1];
  const EXT_BUNDLE_ID = `${bundleId[1].trim()}.${NSE_NAME}`;
  const DEPLOY = (deployTarget?.[1] ?? '15.0').trim();
  const SWIFT = (swiftVersion?.[1] ?? '5.0').trim();

  // Podfile 을 **먼저** 고친다. 확장 Swift 는 `import FirebaseMessaging` 을 하므로
  // pod 없이 타깃만 생기면 빌드가 깨진다 — "타깃 없음"보다 "빌드 안 되는 타깃"이
  // 나쁘다. 실패하면 pbxproj 는 손대지 않고 여기서 끝낸다.
  if (!patchIosPodfileNotificationExtension(buildDir)) {
    log.warn(`iOS ${NSE_NAME} 확장 등록을 건너뛴다 — Podfile 을 고칠 수 없어 빌드가 깨진다.`);
    return;
  }

  // 소스 파일 먼저 — pbxproj 만 고쳐 놓고 파일이 없으면 빌드가 깨진다.
  const extDir = join(iosApp, NSE_NAME);
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, `${NSE_NAME}.swift`), NSE_SWIFT);
  writeFileSync(join(extDir, 'Info.plist'), nseInfoPlist());

  const I = NSE_IDS;
  let ok = true;
  const anchor = (marker, insert) => {
    if (!txt.includes(marker)) { ok = false; return; }
    txt = txt.replace(marker, `${marker}${insert}`);
  };

  anchor('/* Begin PBXBuildFile section */\n',
    `\t\t${I.swiftBuild} /* ${NSE_NAME}.swift in Sources */ = {isa = PBXBuildFile; fileRef = ${I.swiftRef} /* ${NSE_NAME}.swift */; };\n` +
    // `CodeSignOnCopy` 를 넣는다 — 임베드된 사본을 앱의 서명 아이덴티티로 다시
    // 서명하게 한다. 없으면 배포 아카이브에서 확장 서명이 앱과 어긋나 거부될 수
    // 있다(시뮬레이터 빌드는 서명을 안 해서 이 차이가 안 드러난다).
    `\t\t${I.appexBuild} /* ${NSE_NAME}.appex in Embed App Extensions */ = {isa = PBXBuildFile; fileRef = ${I.appexRef} /* ${NSE_NAME}.appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, CodeSignOnCopy, ); }; };\n`);

  anchor('/* Begin PBXFileReference section */\n',
    `\t\t${I.appexRef} /* ${NSE_NAME}.appex */ = {isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = "${NSE_NAME}.appex"; sourceTree = BUILT_PRODUCTS_DIR; };\n` +
    `\t\t${I.swiftRef} /* ${NSE_NAME}.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "${NSE_NAME}.swift"; sourceTree = "<group>"; };\n` +
    `\t\t${I.plistRef} /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };\n`);

  anchor('/* Begin PBXGroup section */\n',
    `\t\t${I.group} /* ${NSE_NAME} */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t${I.swiftRef} /* ${NSE_NAME}.swift */,\n\t\t\t\t${I.plistRef} /* Info.plist */,\n\t\t\t);\n\t\t\tpath = ${NSE_NAME};\n\t\t\tsourceTree = "<group>";\n\t\t};\n`);

  // 확장 그룹을 프로젝트 루트 그룹에, .appex 를 Products 그룹에 넣는다.
  const addChild = (groupId, child) => {
    const re = new RegExp(`(${groupId}[^=]*= \\{\\s*\\n\\s*isa = PBXGroup;[\\s\\S]*?children = \\()`);
    const next = txt.replace(re, `$1\n\t\t\t\t${child},`);
    if (next === txt) {
      ok = false;
      log.warn(`PBXGroup ${groupId} 에 ${child} 추가 실패(패턴 불일치).`);
      return;
    }
    txt = next;
  };
  addChild(MAIN_GROUP, `${I.group} /* ${NSE_NAME} */`);
  addChild(PRODUCTS_GROUP, `${I.appexRef} /* ${NSE_NAME}.appex */`);

  anchor('/* Begin PBXFrameworksBuildPhase section */\n',
    `\t\t${I.frameworks} /* Frameworks */ = {\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`);

  anchor('/* Begin PBXResourcesBuildPhase section */\n',
    `\t\t${I.resources} /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`);

  anchor('/* Begin PBXSourcesBuildPhase section */\n',
    `\t\t${I.sources} /* Sources */ = {\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t${I.swiftBuild} /* ${NSE_NAME}.swift in Sources */,\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`);

  anchor('/* Begin PBXNativeTarget section */\n',
    `\t\t${I.target} /* ${NSE_NAME} */ = {\n\t\t\tisa = PBXNativeTarget;\n\t\t\tbuildConfigurationList = ${I.cfgList} /* Build configuration list for PBXNativeTarget "${NSE_NAME}" */;\n\t\t\tbuildPhases = (\n\t\t\t\t${I.sources} /* Sources */,\n\t\t\t\t${I.frameworks} /* Frameworks */,\n\t\t\t\t${I.resources} /* Resources */,\n\t\t\t);\n\t\t\tbuildRules = (\n\t\t\t);\n\t\t\tdependencies = (\n\t\t\t);\n\t\t\tname = ${NSE_NAME};\n\t\t\tproductName = ${NSE_NAME};\n\t\t\tproductReference = ${I.appexRef} /* ${NSE_NAME}.appex */;\n\t\t\tproductType = "com.apple.product-type.app-extension";\n\t\t};\n`);

  const extSettings = (isDebug) => [
    'CLANG_ENABLE_MODULES = YES;',
    'CODE_SIGN_STYLE = Automatic;',
    `CURRENT_PROJECT_VERSION = ${(projectVersion?.[1] ?? '1').trim()};`,
    ...(team ? [`DEVELOPMENT_TEAM = ${team[1].trim()};`] : []),
    'INFOPLIST_FILE = NotificationService/Info.plist;',
    `IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOY};`,
    'LD_RUNPATH_SEARCH_PATHS = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks";',
    `MARKETING_VERSION = ${(marketing?.[1] ?? '1.0.0').trim()};`,
    'MTL_ENABLE_DEBUG_INFO = ' + (isDebug ? 'INCLUDE_SOURCE;' : 'NO;'),
    `PRODUCT_BUNDLE_IDENTIFIER = ${EXT_BUNDLE_ID};`,
    'PRODUCT_NAME = "$(TARGET_NAME)";',
    'SKIP_INSTALL = YES;',
    `SWIFT_ACTIVE_COMPILATION_CONDITIONS = ${isDebug ? 'DEBUG' : '""'};`,
    `SWIFT_OPTIMIZATION_LEVEL = "${isDebug ? '-Onone' : '-O'}";`,
    `SWIFT_VERSION = ${SWIFT};`,
    'TARGETED_DEVICE_FAMILY = "1,2";',
  ].map((line) => `\t\t\t\t${line}`).join('\n');

  anchor('/* Begin XCBuildConfiguration section */\n',
    `\t\t${I.cfgDebug} /* Debug */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n${extSettings(true)}\n\t\t\t};\n\t\t\tname = Debug;\n\t\t};\n` +
    `\t\t${I.cfgRelease} /* Release */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n${extSettings(false)}\n\t\t\t};\n\t\t\tname = Release;\n\t\t};\n`);

  anchor('/* Begin XCConfigurationList section */\n',
    `\t\t${I.cfgList} /* Build configuration list for PBXNativeTarget "${NSE_NAME}" */ = {\n\t\t\tisa = XCConfigurationList;\n\t\t\tbuildConfigurations = (\n\t\t\t\t${I.cfgDebug} /* Debug */,\n\t\t\t\t${I.cfgRelease} /* Release */,\n\t\t\t);\n\t\t\tdefaultConfigurationIsVisible = 0;\n\t\t\tdefaultConfigurationName = Release;\n\t\t};\n`);

  // 앱이 확장을 먼저 빌드하도록 의존성 — 없으면 첫 빌드에서 .appex 가 없어 임베드가 실패한다.
  const projectId = txt.match(/([0-9A-F]{24}) \/\* Project object \*\/ = \{/);
  if (!projectId) ok = false;
  if (projectId) {
    const containerSection = '/* Begin PBXContainerItemProxy section */\n';
    const proxyBlock = `\t\t${I.proxy} /* PBXContainerItemProxy */ = {\n\t\t\tisa = PBXContainerItemProxy;\n\t\t\tcontainerPortal = ${projectId[1]} /* Project object */;\n\t\t\tproxyType = 1;\n\t\t\tremoteGlobalIDString = ${I.target};\n\t\t\tremoteInfo = ${NSE_NAME};\n\t\t};\n`;
    if (txt.includes(containerSection)) {
      txt = txt.replace(containerSection, `${containerSection}${proxyBlock}`);
    } else {
      // 이 템플릿에는 섹션이 아직 없다 — PBXFileReference 앞에 새로 만든다.
      txt = txt.replace('/* Begin PBXFileReference section */',
        `/* Begin PBXContainerItemProxy section */\n${proxyBlock}/* End PBXContainerItemProxy section */\n\n/* Begin PBXFileReference section */`);
    }
    const depSection = '/* Begin PBXTargetDependency section */\n';
    const depBlock = `\t\t${I.dependency} /* PBXTargetDependency */ = {\n\t\t\tisa = PBXTargetDependency;\n\t\t\ttarget = ${I.target} /* ${NSE_NAME} */;\n\t\t\ttargetProxy = ${I.proxy} /* PBXContainerItemProxy */;\n\t\t};\n`;
    if (txt.includes(depSection)) {
      txt = txt.replace(depSection, `${depSection}${depBlock}`);
    } else {
      txt = txt.replace('/* Begin PBXVariantGroup section */',
        `/* Begin PBXTargetDependency section */\n${depBlock}/* End PBXTargetDependency section */\n\n/* Begin PBXVariantGroup section */`);
    }
  }

  // 임베드 단계 — .appex 를 앱 번들 PlugIns/ 로 복사(dstSubfolderSpec 13).
  // 이 섹션은 Capacitor 기본 프로젝트에 **없다.** 없으면 아래에서 새로 만든다.
  const embedBlock = `\t\t${I.embed} /* Embed App Extensions */ = {\n\t\t\tisa = PBXCopyFilesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tdstPath = "";\n\t\t\tdstSubfolderSpec = 13;\n\t\t\tfiles = (\n\t\t\t\t${I.appexBuild} /* ${NSE_NAME}.appex in Embed App Extensions */,\n\t\t\t);\n\t\t\tname = "Embed App Extensions";\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};\n`;
  if (txt.includes('/* Begin PBXCopyFilesBuildPhase section */\n')) {
    txt = txt.replace('/* Begin PBXCopyFilesBuildPhase section */\n', `/* Begin PBXCopyFilesBuildPhase section */\n${embedBlock}`);
  } else {
    txt = txt.replace('/* Begin PBXFrameworksBuildPhase section */',
      `/* Begin PBXCopyFilesBuildPhase section */\n${embedBlock}/* End PBXCopyFilesBuildPhase section */\n\n/* Begin PBXFrameworksBuildPhase section */`);
  }

  // App 타깃에: 임베드 단계를 buildPhases 끝에, 의존성을 dependencies 에.
  const appTargetBlock = new RegExp(`(${APP_TARGET} \\/\\* App \\*\\/ = \\{[\\s\\S]*?productType = "com.apple.product-type.application";\\s*\\n\\s*\\};)`);
  const found = txt.match(appTargetBlock);
  if (!found) {
    ok = false;
    log.warn('App 네이티브 타깃 블록을 못 찾음 — 확장 임베드/의존성을 붙일 수 없다.');
  } else {
    let block = found[1];
    // 치환이 실제로 일어났는지 **반드시 확인한다.** 조용히 넘어가면 확장 타깃은
    // 있는데 임베드가 안 된 프로젝트가 되고, 그러면 **빌드는 성공하지만 확장이
    // 앱에 안 들어가** 알림 이미지가 안 붙는다 — 원인 찾기가 가장 어려운 실패다.
    const must = (re, repl, label) => {
      const next = block.replace(re, repl);
      if (next === block) {
        ok = false;
        log.warn(`App 타깃에 ${label} 추가 실패(패턴 불일치).`);
        return;
      }
      block = next;
    };
    // 임베드는 Pods 복사 단계 뒤(맨 끝)에 온다 — 확장이 프레임워크를 찾을 수 있어야 한다.
    must(/(buildPhases = \([\s\S]*?)(\n\t\t\t\);)/, `$1\n\t\t\t\t${I.embed} /* Embed App Extensions */,$2`, '임베드 단계');
    // `dependencies` 는 비어 있을 수도, 이미 항목이 있을 수도 있다 — 둘 다 받는다.
    // 빈 목록만 가정하면 다른 의존성이 생긴 순간 조용히 건너뛴다.
    must(/dependencies = \(/, `dependencies = (\n\t\t\t\t${I.dependency} /* PBXTargetDependency */,`, '타깃 의존성');
    txt = txt.replace(found[1], block);
  }

  // 프로젝트의 targets 목록에 확장 추가 — 빠지면 Xcode 가 타깃을 아예 안 보여준다.
  const targetsRe = /(targets = \()/;
  if (!targetsRe.test(txt)) ok = false;
  else txt = txt.replace(targetsRe, `$1\n\t\t\t\t${I.target} /* ${NSE_NAME} */,`);

  if (!ok) {
    log.warn(`iOS ${NSE_NAME} 확장 등록 실패(앵커 불일치) — project.pbxproj 를 쓰지 않았다. Xcode 에서 수동 추가 필요.`);
    return;
  }
  writeFileSync(pbxPath, txt);
  log.ok(`iOS ${NSE_NAME} 확장 등록 (알림에 캐릭터 프로필 첨부, bundleId=${EXT_BUNDLE_ID})`);
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
function patchIosPbxEntitlements(buildDir, cfg) {
  const pbx = join(buildDir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
  const ent = join(buildDir, 'ios', 'App', 'App', 'App.entitlements');
  if (!existsSync(pbx) || !existsSync(ent)) return;
  let txt = readFileSync(pbx, 'utf8');
  if (txt.includes('CODE_SIGN_ENTITLEMENTS')) return; // 이미 연결됨
  const before = txt;
  // ⚠️ **App 타깃에만** 붙인다. 예전엔 PRODUCT_BUNDLE_IDENTIFIER 를 가진 블록이 App 뿐이라
  // 전역 치환으로 충분했는데, 알림 확장이 생기면서 확장 타깃에도 앱 entitlements 가 붙었다.
  // 그러면 확장이 aps-environment / associated-domains 를 요구하는데 확장 프로파일엔 그
  // 권한이 없어 빌드가 거부된다("doesn't include the ... entitlements").
  // 확장은 자체 entitlements 가 필요 없으므로 번들 id 가 정확히 앱 id 인 블록만 고른다.
  const escaped = cfg.appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(\\n(\\s*)PRODUCT_BUNDLE_IDENTIFIER = ${escaped};)`, 'g');
  txt = txt.replace(re, '$1\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;');
  if (txt === before) return;
  writeFileSync(pbx, txt);
  const n = (txt.match(/CODE_SIGN_ENTITLEMENTS/g) || []).length;
  log.ok(`iOS project.pbxproj: CODE_SIGN_ENTITLEMENTS 연결 (App 타깃 ${n}개 설정)`);
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
  const authConf = authSetup(cfg, args.platform);
  if ((cfg.auth?.providers || []).length) log.info(`인증: ${cfg.auth.providers.join(', ')}`);
  authConf.warnings.forEach((w) => log.warn(w));
  // 스토어 요건은 릴리즈에서만 치명적이다 — dev 빌드는 경고로 통과시킨다.
  if (args.release) {
    if (authConf.storeBlockers.length) {
      authConf.storeBlockers.forEach((m) => console.error(`  ✗ ${m}`));
      console.error(`\n릴리즈 빌드 중단 — 위 ${authConf.storeBlockers.length}건을 먼저 해결하세요. ` +
        '(dev 빌드는 --release 없이 실행하면 경고로 통과합니다)');
      process.exit(1);
    }
  } else {
    authConf.storeBlockers.forEach((w) => log.warn(w));
  }
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
    // 기존 build 라도 config 가 요구하는 플러그인이 빠져 있으면 채운다.
    reconcilePackageJson(buildDir, cfg, plugins);
  }

  // 4b) 딥링크 도메인 증명 파일. config 만으로 만들 수 있어(네이티브 플랫폼 불필요)
  // 설치/sync 앞에 둔다 — 웹 담당자가 --skip-install 드라이 실행만으로 파일을 받아갈 수 있게.
  if (cfg.features.deepLink) {
    log.step('딥링크 도메인 증명 파일 (.well-known)');
    writeWellKnown(buildDir, cfg);
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
    // .well-known 파일은 위 4b) 에서 이미 생성됐다(네이티브 불필요).
  }
  // 7b-2) 푸시 배선 (features.push)
  if (cfg.features.push) {
    patchAndroidPushPermission(buildDir);
    // iOS 원격 푸시(FCM): 엔타이틀먼트 + 백그라운드 모드는 항상, plist 등록/Firebase 초기화는 firebase.fcm 일 때만.
    patchIosPushEntitlement(buildDir);
    patchIosPushBackgroundMode(buildDir);
    if (cfg.firebase?.enabled && cfg.firebase?.fcm) {
      patchIosGoogleServicePlistRef(buildDir);
      patchIosFirebaseInit(buildDir);
      // 알림에 캐릭터 프로필 사진을 붙이는 확장. FCM SDK 헬퍼를 쓰므로 firebase.fcm
      // 이 켜진 경우에만 의미가 있다(패치가 pod 'FirebaseMessaging' 을 추가한다).
      // patchNativeVersion 뒤에 와야 한다 — 확장 버전을 App 타깃에서 읽어 맞춘다.
      patchIosNotificationServiceExtension(buildDir, cfg);
    }
  }
  log.step('iOS 권한 사용 설명(Info.plist) 점검');
  patchIosUsageStrings(buildDir, cfg);
  if (args.local) patchIosLocalAts(buildDir); // 로컬 dev 평문 http 허용(ATS 예외)

  // 7c) 인증 네이티브 배선 (OAuth 복귀 URL scheme + Apple Sign In)
  if (authConf.hasOAuth || (cfg.auth?.providers || []).includes('apple')) {
    log.step('인증 네이티브 배선 (OAuth URL scheme / Apple Sign In)');
    patchAndroidAuthScheme(buildDir, cfg);
    patchIosAuthScheme(buildDir, cfg);
    patchIosAppleEntitlement(buildDir, cfg);
  }

  // 7d) iOS 엔타이틀먼트를 Xcode 프로젝트에 연결(App.entitlements 있을 때만)
  patchIosPbxEntitlements(buildDir, cfg);

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
