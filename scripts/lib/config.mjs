// app.config.json 로딩 + 검증 + 정규화.
// README.md "4. app.config.json 스키마" 가 단일 진실 공급원. 여기서 그 스키마를 강제한다.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP_ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/; // 역도메인, 각 세그먼트는 글자로 시작
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// features 기본값 — new-app 이 명시 안 한 기능은 안전한 OFF 로.
const DEFAULT_FEATURES = {
  push: false,
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
};

const DEFAULT_THEME = {
  primary: '#1A73E8',
  statusBarStyle: 'dark', // light | dark  (텍스트/아이콘 색상 기준)
  background: '#FFFFFF',
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
  logoutEndpoint: null,
  oauth: {},                // { google: { clientId, scopes?, redirectUri?, authorizeUrl?, extraQuery? }, ... }
};
const KNOWN_AUTH_PROVIDERS = ['email', 'apple', 'google', 'naver', 'kakao', 'facebook', 'x', 'threads'];

// 현재 generate-app 이 npm 설치까지 자동 배선하는 벤더 (나머지는 슬롯만 + 수동 안내)
const WIRED_PROVIDERS = { attribution: ['appsflyer'] };
const KNOWN_PROVIDERS = {
  attribution: ['appsflyer', 'branch', 'adjust', 'airbridge'],
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

  return {
    slug, appName: raw.appName, appId: raw.appId, startUrl: raw.startUrl,
    version, theme, features, navigation, assets, marketing, auth,
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
  };
}

export { WIRED_PROVIDERS, KNOWN_PROVIDERS, KNOWN_AUTH_PROVIDERS };
