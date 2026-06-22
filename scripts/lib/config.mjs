// app.config.json 로딩 + 검증 + 정규화.
// README.md "4. app.config.json 스키마" 가 단일 진실 공급원. 여기서 그 스키마를 강제한다.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/; // 역도메인, 각 세그먼트는 글자로 시작
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// features 기본값 — new-app 이 명시 안 한 기능은 안전한 OFF 로.
const DEFAULT_FEATURES = {
  push: false,
  // 푸시 라우팅 정책: data.link 의 경로 화이트리스트(허용 prefix 배열). null=모든 경로 허용.
  // 예: ['/recommend', '/detail/', '/viewer', '/event'] — Poptale 1.1.9+176 정책 참조.
  pushPolicy: { allowedPaths: null },
  deepLink: false,
  deferredDeepLink: { enabled: false, provider: null },
  biometric: false,
  share: false,
  camera: false,
  forceUpdate: { enabled: false, minVersionUrl: null },
  secureStorage: false,
  localNotification: false,
  haptics: false,
  clipboard: false,
  geolocation: false,
  // OS 다크모드 자동 추종(statusBar/네비/스플래시 색상 동기). 강제 다크면 theme 에서 처리.
  darkMode: false,
  // 기존 웹에 `window.AppChannel.postMessage("scheme://...")` 패턴이 박혀 있을 때 활성.
  // 활성 시 브릿지가 폴리필을 주입해 AppBridge 로 라우팅 → 웹 코드 무수정 동작.
  appChannelCompat: false,
  // 뷰어 전용 UX (콘텐츠 보호/사용자 환경)
  viewer: {
    // 화면 캡쳐 방지: 지정 경로 prefix 에서만 동작(필요 화면만 막는다)
    captureBlock: { enabled: false, paths: [] },
    // 뷰어 밝기 슬라이더(시스템 밝기와 독립)
    brightness: { enabled: false },
  },
};

const DEFAULT_THEME = {
  primary: '#1A73E8',
  statusBarStyle: 'dark', // light | dark  (텍스트/아이콘 색상 기준)
  background: '#FFFFFF',
  // 스플래시 화면. 안드12+ 는 OS 제약상 "단색 배경 + 가운데 아이콘"만 가능(풀이미지 불가).
  splashBackground: null,  // null 이면 background 사용. 안드12+ 시스템 스플래시 배경색.
  splashDuration: 1500,    // Capacitor 스플래시 표시 시간(ms).
};

// 마케팅 SDK 슬롯. 키/시크릿은 절대 여기 넣지 않는다(환경변수로 주입).
// provider=null 이면 미사용. 카테고리별 1개 벤더만.
const DEFAULT_MARKETING = {
  attribution: { provider: null, deferredDeepLink: false }, // appsflyer | branch | adjust | airbridge
  analytics: { provider: null },                            // amplitude | ga4 | firebase | mixpanel
  crm: { provider: null },                                  // braze | onesignal | moengage
  // 공통 동선(화면전환/앱오픈/딥링크)을 브릿지가 코드 없이 자동 수집할지. 끄려면 false.
  autoCapture: true,
};
// 인증/SSO 슬롯. providers 에 켤 공급자만 나열. client secret 은 절대 여기 두지 않는다(백엔드 전용).
// clientId 는 공개값이라 oauth.<provider>.clientId 로 둘 수 있다(또는 빌드 시 환경변수 베이크).
const DEFAULT_AUTH = {
  providers: [],            // ['email','apple','google','naver','kakao','facebook','x','threads']
  sessionEndpoint: null,    // 네이티브 자격증명을 받아 세션쿠키를 발급하는 백엔드 URL (선택)
  signupEndpoint: null,     // 신규 회원의 약관동의+추가정보를 받아 가입 확정하는 백엔드 URL (선택)
  logoutEndpoint: null,
  deleteEndpoint: null,     // 회원탈퇴/계정삭제 백엔드 URL (스토어 정책상 사실상 필수)
  guestEndpoint: null,      // 게스트(익명) 계정 생성 백엔드 URL (IAP/진행상황 보관 시)
  deviceEndpoint: null,     // 푸시토큰/기기를 계정에 등록하는 백엔드 URL (기기↔계정 바인딩)
  // 중앙 IdP 모드(패밀리 SSO): 설정 시 앱은 IdP 하나만 바라본다. IdP 가 소셜을 페더레이션.
  //   { issuer | authorizeUrl, clientId, hintParam?, hints?, scopes?, redirectUri? }
  //   빈 객체({})면 미설정 = 직접 모드. (merge 가 null+객체에서 깨지므로 기본은 {})
  idp: {},
  oauth: {},                // 직접 모드: { google: { clientId, scopes?, redirectUri?, authorizeUrl?, extraQuery? }, ... }
};
const KNOWN_AUTH_PROVIDERS = ['email', 'apple', 'google', 'naver', 'kakao', 'facebook', 'x', 'threads'];

// 인앱결제 슬롯. 디지털 재화는 스토어 IAP 강제. 영수증 검증은 백엔드(verifyEndpoint).
// products: [{ id(웹SKU), storeId(스토어 상품ID), type: 'consumable' }]  — 가격은 스토어 콘솔에서.
// googleTokenCompression: Google purchase token 이 길어 페이로드 한계에 걸릴 때 gzip+base64 압축
// 으로 전송할지(Poptale 0.28.21+102 노하우). 활성 시 verifyEndpoint 백엔드도 같은 포맷을 받아야 함.
const DEFAULT_IAP = { products: [], verifyEndpoint: null, googleTokenCompression: false };

// 모니터링.
//   crash: 크래시/에러 (sentry, crashlytics 자동배선 후보)
//   apm:   APM/RUM (whatap, datadog 등) — Poptale 은 WhaTap 사용
const DEFAULT_MONITORING = {
  crash: { provider: null, dsn: null, environment: 'production' },
  apm: { provider: null },
};
const KNOWN_CRASH_PROVIDERS = [null, 'sentry', 'crashlytics'];
const KNOWN_APM_PROVIDERS = [null, 'whatap', 'datadog'];

// Firebase 멀티-flavor 설정. enabled=true 이면 generate-app 이 flavor 별 google-services / plist 를
// secrets/env 에서 받아 build/<slug>/{android/app, ios} 에 배치. fcm/analytics/crashlytics/remoteConfig
// 는 어느 SDK 를 활성화할지 토글. (실제 키 파일은 레포에 절대 두지 않는다 — DEPLOY.md §4)
const DEFAULT_FIREBASE = {
  enabled: false,
  project: { dev: null, stage: null, prod: null }, // 표시용 프로젝트 ID
  fcm: false,
  remoteConfig: false,
  analytics: false,
  crashlytics: false,
};

// 법무/정책 링크 (스토어 필수: 개인정보처리방침). 성인인증(본인확인) URL 도 여기.
const DEFAULT_LEGAL = { privacyUrl: null, termsUrl: null, ageVerifyUrl: null };
// 권한 고지 오버라이드: { camera:{required,purpose}, location:{...}, notifications:{...} }
const DEFAULT_PERMISSIONS = {};

// 현재 generate-app 이 npm 설치까지 자동 배선하는 벤더 (나머지는 슬롯만 + 수동 안내)
const WIRED_PROVIDERS = { attribution: ['appsflyer'] };
const KNOWN_PROVIDERS = {
  // adbrix = DFINERY (한국 어트리뷰션) — 슬롯만, 배선은 template/plugins/adbrix/SPEC.md 참조
  attribution: ['appsflyer', 'branch', 'adjust', 'airbridge', 'adbrix'],
  analytics: ['amplitude', 'ga4', 'firebase', 'mixpanel'],
  crm: ['braze', 'onesignal', 'moengage'],
};

function err(slug, msg) {
  throw new Error(`apps/${slug}/app.config.json: ${msg}`);
}

/** 깊은 병합 (객체만; 배열·원시값은 src 우선) */
function merge(base, src) {
  if (Array.isArray(src) || typeof src !== 'object' || src === null) return src ?? base;
  const out = { ...base };
  for (const k of Object.keys(src)) {
    out[k] = (k in base) ? merge(base[k], src[k]) : src[k];
  }
  return out;
}

/**
 * apps/<slug>/app.config.json 을 읽어 검증 후 정규화된 config 객체를 반환.
 * @param {string} repoRoot 하네스 루트 절대경로
 * @param {string} slug
 */
export function loadConfig(repoRoot, slug) {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`slug "${slug}" 형식 오류 — 영소문자/숫자/하이픈만 (예: service-a)`);
  }
  const appDir = join(repoRoot, 'apps', slug);
  const file = join(appDir, 'app.config.json');
  if (!existsSync(file)) {
    throw new Error(`${file} 없음. 먼저 new-app 스킬로 정의를 만드세요.`);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    err(slug, `JSON 파싱 실패 — ${e.message}`);
  }

  // 필수 필드
  for (const f of ['slug', 'appName', 'appId', 'startUrl']) {
    if (!raw[f] || typeof raw[f] !== 'string') err(slug, `"${f}" 누락 또는 문자열 아님`);
  }
  if (raw.slug !== slug) err(slug, `config.slug("${raw.slug}") 가 디렉터리명("${slug}") 과 불일치`);
  if (!APP_ID_RE.test(raw.appId)) {
    err(slug, `appId "${raw.appId}" 가 역도메인 형식 아님 (예: com.yourco.servicea)`);
  }
  try {
    const u = new URL(raw.startUrl);
    if (u.protocol !== 'https:') err(slug, `startUrl 은 https 여야 함 (받음: ${u.protocol})`);
  } catch {
    err(slug, `startUrl "${raw.startUrl}" 가 유효한 URL 아님`);
  }

  // version
  const version = raw.version ?? { name: '1.0.0', code: 1 };
  if (!Number.isInteger(version.code) || version.code < 1) {
    err(slug, `version.code 는 1 이상 정수여야 함 (스토어는 단조 증가 요구)`);
  }
  if (typeof version.name !== 'string') err(slug, `version.name 문자열 필요`);

  // theme / features 정규화 (기본값 병합)
  const theme = merge(DEFAULT_THEME, raw.theme ?? {});
  if (!['light', 'dark'].includes(theme.statusBarStyle)) {
    err(slug, `theme.statusBarStyle 은 "light" | "dark" (받음: ${theme.statusBarStyle})`);
  }
  const features = merge(DEFAULT_FEATURES, raw.features ?? {});

  if (features.deferredDeepLink.enabled && !features.deferredDeepLink.provider) {
    err(slug, `deferredDeepLink.enabled=true 인데 provider 가 없음 (branch | appsflyer ...)`);
  }
  if (features.forceUpdate.enabled && !features.forceUpdate.minVersionUrl) {
    err(slug, `forceUpdate.enabled=true 인데 minVersionUrl 이 없음`);
  }
  // pushPolicy.allowedPaths: null=전허용, 배열=화이트리스트(문자열 prefix)
  const allowed = features.pushPolicy?.allowedPaths;
  if (allowed !== null && allowed !== undefined) {
    if (!Array.isArray(allowed) || allowed.some(p => typeof p !== 'string')) {
      err(slug, `features.pushPolicy.allowedPaths 는 null 또는 문자열 배열이어야 함`);
    }
  }
  // viewer.captureBlock: enabled=true 면 paths 는 비어있지 않은 문자열 배열
  const cb = features.viewer?.captureBlock;
  if (cb?.enabled) {
    if (!Array.isArray(cb.paths) || cb.paths.length === 0 || cb.paths.some(p => typeof p !== 'string')) {
      err(slug, `features.viewer.captureBlock.enabled=true 인데 paths 가 비어있거나 문자열 배열이 아님`);
    }
  }

  // navigation
  const startHost = new URL(raw.startUrl).hostname;
  const navigation = {
    allowedDomains: raw.navigation?.allowedDomains ?? [startHost],
    externalInBrowser: raw.navigation?.externalInBrowser ?? true,
  };

  const assets = {
    icon: raw.assets?.icon ?? 'icon.png',
    splash: raw.assets?.splash ?? 'splash.png',
  };

  // marketing 정규화 + 하위호환(features.deferredDeepLink → marketing.attribution)
  const marketing = merge(DEFAULT_MARKETING, raw.marketing ?? {});
  if (!raw.marketing && features.deferredDeepLink.enabled) {
    marketing.attribution = {
      provider: features.deferredDeepLink.provider,
      deferredDeepLink: true,
    };
  }
  for (const cat of ['attribution', 'analytics', 'crm']) {
    const p = marketing[cat]?.provider;
    if (p && !KNOWN_PROVIDERS[cat].includes(p)) {
      err(slug, `marketing.${cat}.provider "${p}" 미지원. 가능: ${KNOWN_PROVIDERS[cat].join(' | ')}`);
    }
  }

  // auth 정규화 + 검증 (공급자명만 검증, clientId 누락은 generate-app 이 경고)
  const auth = merge(DEFAULT_AUTH, raw.auth ?? {});
  if (!Array.isArray(auth.providers)) err(slug, 'auth.providers 는 배열이어야 함');
  for (const p of auth.providers) {
    if (!KNOWN_AUTH_PROVIDERS.includes(p)) {
      err(slug, `auth.providers 의 "${p}" 미지원. 가능: ${KNOWN_AUTH_PROVIDERS.join(' | ')}`);
    }
  }

  // iap 정규화 + 검증
  const iap = merge(DEFAULT_IAP, raw.iap ?? {});
  if (!Array.isArray(iap.products)) err(slug, 'iap.products 는 배열이어야 함');
  for (const p of iap.products) {
    if (!p || typeof p.id !== 'string') err(slug, 'iap.products 각 항목에 문자열 id 필요');
  }

  // monitoring 정규화 + 검증
  const monitoring = merge(DEFAULT_MONITORING, raw.monitoring ?? {});
  if (!KNOWN_CRASH_PROVIDERS.includes(monitoring.crash.provider)) {
    err(slug, `monitoring.crash.provider 는 ${KNOWN_CRASH_PROVIDERS.filter(Boolean).join(' | ')} (또는 null)`);
  }
  if (!KNOWN_APM_PROVIDERS.includes(monitoring.apm.provider)) {
    err(slug, `monitoring.apm.provider 는 ${KNOWN_APM_PROVIDERS.filter(Boolean).join(' | ')} (또는 null)`);
  }

  // firebase 블록: enabled=false 면 통째 비활성. enabled=true 인데 fcm/analytics/crashlytics/remoteConfig
  // 가 전부 false 면 의도 불명확 → 경고는 generate-app 이.
  const firebase = merge(DEFAULT_FIREBASE, raw.firebase ?? {});

  const legal = merge(DEFAULT_LEGAL, raw.legal ?? {});
  const permissions = merge(DEFAULT_PERMISSIONS, raw.permissions ?? {});

  return {
    slug, appName: raw.appName, appId: raw.appId, startUrl: raw.startUrl,
    version, theme, features, navigation, assets, marketing, auth, iap, monitoring,
    firebase, legal, permissions,
    _appDir: appDir,
  };
}

/**
 * 웹/네이티브 런타임에 주입할 최소 config (자격증명·내부경로 제외).
 * 브릿지 SDK 가 이 객체를 읽어 AppBridge.capabilities 를 채운다.
 */
export function runtimeConfig(cfg) {
  return {
    slug: cfg.slug,
    appName: cfg.appName,
    appId: cfg.appId,
    version: cfg.version,
    theme: cfg.theme,
    features: cfg.features,
    navigation: cfg.navigation,
    marketing: cfg.marketing, // 벤더 선택만 포함. 키/시크릿은 generate-app 이 별도 주입.
    auth: cfg.auth,           // 공급자 목록 + 공개 clientId/엔드포인트. client secret 은 미포함(백엔드 전용).
    iap: cfg.iap,             // 상품 매핑 + 검증 엔드포인트. 가격/시크릿은 스토어/백엔드.
    monitoring: cfg.monitoring, // 크래시/에러 + APM 벤더 + 공개 dsn.
    firebase: cfg.firebase,     // FCM/Analytics/Crashlytics/RemoteConfig 토글 + 표시용 프로젝트 ID.
    legal: cfg.legal,           // 개인정보처리방침/약관/성인인증 URL.
    permissions: cfg.permissions, // 권한 고지 오버라이드.
  };
}

export { WIRED_PROVIDERS, KNOWN_PROVIDERS, KNOWN_AUTH_PROVIDERS, KNOWN_CRASH_PROVIDERS, KNOWN_APM_PROVIDERS };

// ─────────────────────────────────────────────────────────────────────────────
// AIPIA-CONVENTIONS (machine-readable) — 정본은 /AIPIA-CONVENTIONS.md.
// 이 상수는 *현재 자동 적용되지 않는다*. new-app 스킬이 신규 앱을 만들 때 참조하거나,
// generate-app 이 "preset: 'aipia'" 옵션을 받았을 때 머지하는 형태로 향후 사용.
//
// 출처:
//   🅰️ aipia-team/poptale-app  (Flutter 1.1.15+183)
//   🅱️ aipia-team/poptale-frontend (Next.js 15)
// ─────────────────────────────────────────────────────────────────────────────
export const AIPIA_DEFAULTS = Object.freeze({
  // 식별자 규칙
  appIdPrefix: 'com.aipia',
  appIdDevSuffix: '.dev',                                 // dev flavor 만 suffix, stage/prod 동일
  firebaseProjectPattern: {                                // {slug} 치환
    dev:   'dev-aipia-{slug}',
    stage: 'stage-aipia-{slug}',
    prod:  'aipia-{slug}',
  },

  // 도메인 패턴 ({slug} 치환). TLD = .ai 통일
  domainPattern: {
    web: { dev: 'dev.{slug}.ai',     stage: 'stg.{slug}.ai',     prod: '{slug}.ai' },
    api: { dev: 'dev.api.{slug}.ai', stage: 'stg.api.{slug}.ai', prod: 'api.{slug}.ai' },
    cdn: { dev: 'dev-images.{slug}.ai', stage: 'dev-images.{slug}.ai', prod: 'images.{slug}.ai' },
  },
  // SSO 쿠키 공유용 (서브도메인 전체)
  cookieDomainPattern: { dev: '.dev.{slug}.ai', stage: '.stg.{slug}.ai', prod: '.{slug}.ai' },

  // 최소/타겟 OS (Poptale 1.0.0+118 기준 🅰️)
  minOS: { ios: '15.0', androidSdk: 29, targetSdk: 36 },

  // 기본 테마 (검정/다크모드/Pretendard) 🅰️🅱️
  theme: { primary: '#000000', statusBarStyle: 'light', background: '#000000' },
  font: 'Pretendard',
  responsive: { mobileMaxWidth: 440 },                    // 🅱️ 모바일 first 기준

  // 기본 features (신규 앱이 보통 켜는 것들)
  features: {
    push: true,
    deepLink: true,
    share: true,
    secureStorage: true,
    localNotification: true,
    haptics: true,
    clipboard: true,
    darkMode: true,                                       // 🅰️ Poptale 1.1.0+149
    appChannelCompat: true,                               // 기존 웹 무수정 이전 위해
  },

  // K-market 4 socials (이메일/비밀번호 미제공) 🅰️
  auth: {
    providers: ['apple', 'google', 'kakao', 'naver'],
    apiBasePathSuffix: '/api/v2',                         // <api-domain>/api/v2/auth/*
  },

  // IAP — Google purchase token 압축 기본 ON (🅰️ Poptale 0.28.21+102)
  iap: { googleTokenCompression: true },

  // 마케팅 (Adbrix + Amplitude) 🅰️🅱️
  marketing: {
    attribution: { provider: 'adbrix',   deferredDeepLink: false },
    analytics:   { provider: 'amplitude' },
    crm:         { provider: null },
    autoCapture: true,
  },

  // 모니터링 (Crashlytics + WhaTap) 🅰️🅱️
  monitoring: {
    crash: { provider: 'crashlytics' },
    apm:   { provider: 'whatap' },
  },

  // Firebase 3 환경 분리 🅰️
  firebase: { enabled: true, fcm: true, remoteConfig: true, analytics: true, crashlytics: true },

  // 이벤트 명명 표준 (🅰️ Poptale 1.1.8+175)
  eventNaming: {
    convention: 'lowercase_snake_case',
    namespaces: ['app_', 'push_', 'sns_', 'iap_'],
  },

  // 백엔드 표준 엔드포인트 (서비스 백엔드가 구현해야 할 path 모음)
  backendEndpoints: {
    authNative:   '/api/v2/auth/native',
    authSignup:   '/api/v2/auth/signup',
    authGuest:    '/api/v2/auth/guest',
    authLogout:   '/api/v2/auth/logout',
    authDelete:   '/api/v2/auth/delete',
    authDevice:   '/api/v2/auth/device',
    authMe:       '/api/v2/auth/me',
    iapVerify:    '/api/v2/iap/verify',
    webhookApple: '/api/v2/webhooks/apple',
    webhookGoogle:'/api/v2/webhooks/google',
  },
});

/**
 * AIPIA 패턴으로 신규 앱 config 의 보일러플레이트를 만들어 준다.
 * new-app 스킬이 이걸 호출해서 시작 config 를 만들고, 사람은 차이가 나는 부분만 덮어쓴다.
 * 시크릿/외부 발급값은 채우지 않는다(엔드포인트 URL 같은 공개값만).
 *
 * @param {{ slug: string, appName: string, idp?: 'keycloak'|'direct' }} opts
 * @returns {object} app.config.json 시작 보일러플레이트
 */
export function aipiaPreset({ slug, appName, idp = 'direct' }) {
  if (!SLUG_RE.test(slug)) throw new Error(`slug "${slug}" 형식 오류`);
  const sub = (tpl) => tpl.replaceAll('{slug}', slug);
  const D = AIPIA_DEFAULTS;
  const webProd = sub(D.domainPattern.web.prod);
  const apiProd = sub(D.domainPattern.api.prod);
  return {
    slug,
    appName: appName || slug,
    appId: `${D.appIdPrefix}.${slug}`,
    startUrl: `https://${webProd}`,
    version: { name: '1.0.0', code: 1 },
    theme: { ...D.theme },
    assets: { icon: 'icon.png', splash: 'splash.png' },
    features: {
      ...D.features,
      pushPolicy: { allowedPaths: null },                 // 서비스 IA 에 따라 채움
      forceUpdate: { enabled: false, minVersionUrl: null },
      viewer: { captureBlock: { enabled: false, paths: [] }, brightness: { enabled: false } },
    },
    navigation: {
      allowedDomains: [webProd, `**.${slug}.ai`],
      externalInBrowser: true,
    },
    marketing: { ...D.marketing },
    auth: {
      providers: [...D.auth.providers],
      sessionEndpoint: `https://${apiProd}${D.backendEndpoints.authNative}`,
      signupEndpoint:  `https://${apiProd}${D.backendEndpoints.authSignup}`,
      logoutEndpoint:  `https://${apiProd}${D.backendEndpoints.authLogout}`,
      deleteEndpoint:  `https://${apiProd}${D.backendEndpoints.authDelete}`,
      guestEndpoint:   `https://${apiProd}${D.backendEndpoints.authGuest}`,
      deviceEndpoint:  `https://${apiProd}${D.backendEndpoints.authDevice}`,
      idp: idp === 'keycloak' ? { issuer: `https://auth.${slug}.ai/realms/${slug}`, clientId: `${slug}-app` } : {},
    },
    iap: {
      verifyEndpoint: `https://${apiProd}${D.backendEndpoints.iapVerify}`,
      googleTokenCompression: D.iap.googleTokenCompression,
      products: [],                                       // 스토어 등록 후 채움
    },
    monitoring: { ...D.monitoring, crash: { ...D.monitoring.crash, dsn: null, environment: 'production' } },
    firebase: {
      ...D.firebase,
      project: {
        dev:   sub(D.firebaseProjectPattern.dev),
        stage: sub(D.firebaseProjectPattern.stage),
        prod:  sub(D.firebaseProjectPattern.prod),
      },
    },
    legal: {
      privacyUrl: `https://${webProd}/info/privacy`,
      termsUrl:   `https://${webProd}/info/terms`,
      ageVerifyUrl: null,
    },
    permissions: {
      notifications: { required: false, purpose: '신작/이벤트/구매 알림 수신' },
      camera:        { required: false, purpose: '1:1 문의 사진 첨부' },
    },
  };
}
