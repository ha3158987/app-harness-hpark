// app.config.json 로딩 + 검증 + 정규화.
// README.md "4. app.config.json 스키마" 가 단일 진실 공급원. 여기서 그 스키마를 강제한다.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeLocales, normalizeLocalized, IOS_USAGE_KEYS } from './i18n.mjs';

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
  // 강제 업데이트 게이트.
  //   source: 최소 버전을 어디서 읽나. 'remoteConfig'(Firebase) | 'url'(정적 JSON).
  //     기본 'url' — Firebase 를 안 쓰는 앱도 강제 업데이트를 쓸 수 있어야 한다.
  //   minVersionUrl: url 방식의 주소이자, remoteConfig 방식의 **폴백**.
  //     RC 는 캐시 지연·fetch 실패가 있고 게이트는 fail-open 이라, 폴백이 있으면 그 구멍이 좁아진다.
  forceUpdate: { enabled: false, source: 'url', minVersionUrl: null },
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
  providers: [],            // ['email','apple','google','naver','kakao','facebook','x','threads','line','discord']
  sessionEndpoint: null,    // 네이티브 자격증명을 받아 세션쿠키를 발급하는 백엔드 URL (선택)
  signupEndpoint: null,     // 신규 회원의 약관동의+추가정보를 받아 가입 확정하는 백엔드 URL (선택)
  logoutEndpoint: null,
  deleteEndpoint: null,     // 회원탈퇴/계정삭제 백엔드 URL (스토어 정책상 사실상 필수)
  guestEndpoint: null,      // 게스트(익명) 계정 생성 백엔드 URL (IAP/진행상황 보관 시)
  deviceEndpoint: null,     // 푸시토큰/기기를 계정에 등록하는 백엔드 URL (기기↔계정 바인딩)
  oauth: {},                // 직접 모드: { google: { clientId, scopes?, redirectUri?, authorizeUrl?, extraQuery? }, ... }
  // OAuth 복귀 커스텀 스킴(`<appId>://`)을 네이티브에 등록할지. **providers 와 독립이다.**
  //
  // 왜 별도 키인가: 브로커 로그인(앱이 우리 백엔드의 start 를 시스템 브라우저로 열고,
  // 커스텀 스킴 딥링크로 code 만 받아 WebView 에서 상환하는 방식)은 네이티브 OAuth 를
  // **전혀 하지 않으면서** 복귀 스킴은 반드시 필요하다. 스킴 등록을 providers 에 물려
  // 두면 스킴을 얻기 위해 providers 를 채우게 되고, 그러면 쓰지도 않는 clientId 누락이
  // storeBlockers 로 잡혀 `--release` 빌드가 막힌다(그게 정확히 팝챗에서 난 문제다).
  //
  // providers 가 비어 있지 않으면 이 값과 무관하게 스킴은 등록된다(네이티브 OAuth 가
  // 복귀 주소를 쓰므로). 즉 이 키는 "네이티브 OAuth 없이 복귀만 받는" 앱을 위한 것이다.
  oauthReturnScheme: false,
};
const KNOWN_AUTH_PROVIDERS = ['email', 'apple', 'google', 'naver', 'kakao', 'facebook', 'x', 'threads', 'line', 'discord'];

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
// 는 어느 SDK 를 활성화할지 토글. (실제 키 파일은 레포에 절대 두지 않는다 — docs/08-DEPLOY.md §4)
const DEFAULT_FIREBASE = {
  enabled: false,
  project: { dev: null, stage: null, prod: null }, // 표시용 프로젝트 ID
  fcm: false,
  // remoteConfig: 원격 설정 플러그인 설치 + 브릿지 초기화. 강제 업데이트의 1차 소스로 쓸 수 있고,
  // getRemoteConfig(key) 로 임의 값도 읽는다(강제 업데이트 전용이 아니다).
  remoteConfig: false,
  // RC 캐시 간격(초). Firebase 는 이 시간 안에는 서버를 다시 찌르지 않는다 —
  // 콘솔에서 값을 바꿔도 최대 이만큼 반영이 늦는다. 강제 업데이트는 긴급성이 있어 1시간을 기본으로
  // 둔다(Firebase 기본값 12시간은 너무 길다). debug 빌드는 generate-app 이 0 으로 덮는다.
  remoteConfigFetchIntervalSeconds: 3600,
  analytics: false,
  crashlytics: false,
};

// 추적/프라이버시. ATT(iOS 앱 추적 투명성)는 어트리뷰션 벤더와 독립 토글이다 —
// 벤더 없이도 ATT 만 켤 수 있고, 그 반대도 된다.
//   usageDescription: Info.plist NSUserTrackingUsageDescription. enabled 면 필수(기본값 없음).
//     하네스가 기본 문구를 주면 실제 용도와 다른 문구가 그대로 출시되는 사고가 난다
//     (Poptale: 광고 어트리뷰션인데 "앱 오류 분석"으로 표기 — 심사·법규 리스크).
//   prePermission: 웹이 사전 설명 화면을 직접 그리는가.
//     **기본값 false = 브릿지가 폴백 화면을 그린다.** 기본을 true(웹이 그림)로 두면 웹 작업을 안 한
//     앱은 "플러그인은 깔리고 plist 에 추적 문구도 들어갔는데 아무도 동의를 안 묻는" 상태가 된다 —
//     스토어에는 추적한다고 선언해 놓고 실제로는 묻지 않는 앞뒤 안 맞는 앱이라 심사 리스크다.
//     켜면 최소한 동작하는 쪽이 안전한 기본값이다. 웹이 자체 화면을 만들면 true 로 명시해 끈다.
//   copy: prePermission=false 일 때 폴백 게이트 문구 오버라이드. null 이면 브릿지 기본 문구.
const DEFAULT_TRACKING = {
  att: {
    enabled: false,
    usageDescription: null,
    prePermission: false,
    copy: { title: null, body: null, notice: null, continueLabel: null, laterLabel: null },
  },
};

// 플랫폼별 서명 식별자. 딥링크(Universal Link / App Link)의 도메인 소유 증명 파일
// (.well-known/apple-app-site-association, assetlinks.json)을 만들 때 필요하다.
// 둘 다 공개값이다 — 실제로 웹에서 누구나 받아볼 수 있는 파일에 그대로 들어간다.
//
//   ios.teamId: Apple Developer 팀 ID. **조직 공통값**이라 앱마다 다르지 않다.
//     비워두면 generate-app 이 환경변수(APPLE_TEAM_ID → FASTLANE_DEV_TEAM_ID)에서 찾는다.
//   android.sha256CertFingerprints: **앱마다 다르다.** Play 앱 서명을 쓰면 2개가 필요하다 —
//     업로드 키 + Play 가 관리하는 앱 서명 키. 업로드 키만 넣으면 App Link 검증이 조용히
//     실패해 링크가 브라우저로 열린다(Poptale 도 앱마다 2개씩 등록).
//     Play Console > 앱 > 설정 > 앱 서명 에서 두 지문을 복사한다.
// appStoreId = App Store 숫자 ID. 강제 업데이트 게이트의 기본 스토어 URL 조립에 쓴다.
// (예전엔 marketing.attribution.appsflyer.iosAppId 에서 읽었는데, 어트리뷰션 벤더를
//  안 쓰거나 AppsFlyer 가 아닌 앱은 URL 이 깨졌다 — 벤더 중립 자리로 옮긴다.)
// usesNonExemptEncryption: Info.plist ITSAppUsesNonExemptEncryption 값.
//   null(기본) = plist 에 안 씀 → App Store Connect 가 **빌드마다** 수출 규정 질문을 띄우고,
//                답하기 전엔 TestFlight 내부 테스터에게도 안 나간다.
//   false      = 면제 대상 암호화만 사용(HTTPS/TLS·OS 제공·표준 알고리즘) → 질문 안 뜸.
//   true       = 비면제 암호화 사용 → 별도 수출 서류가 필요하다.
// **법적 신고 내용이라 하네스가 기본값을 false 로 정하지 않는다.** 앱마다 사람이 판단해 넣는다.
const DEFAULT_IOS = { teamId: null, appStoreId: null, usesNonExemptEncryption: null };
const DEFAULT_ANDROID = { sha256CertFingerprints: [] };

// SHA-256 지문: 대문자 16진수 2자리 32쌍을 콜론으로 이은 형태 (AA:BB:...:FF)
const SHA256_FP_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
// Apple 팀 ID: 영숫자 10자리 (예: 3W889GYPRK)
const APPLE_TEAM_ID_RE = /^[0-9A-Z]{10}$/;

// 법무/정책 링크 (스토어 필수: 개인정보처리방침). 성인인증(본인확인) URL 도 여기.
const DEFAULT_LEGAL = { privacyUrl: null, termsUrl: null, ageVerifyUrl: null };
// 권한 고지 오버라이드: { camera:{required,purpose}, location:{...}, notifications:{...} }
const DEFAULT_PERMISSIONS = {};

// 현재 generate-app 이 npm 설치까지 자동 배선하는 벤더 (나머지는 슬롯만 + 수동 안내)
const WIRED_PROVIDERS = { attribution: ['appsflyer', 'adbrix'] };
const KNOWN_PROVIDERS = {
  // adbrix = DFINERY (한국 어트리뷰션, AIPIA 표준 — 01-AIPIA-CONVENTIONS §5). 자체 플러그인으로 배선됨.
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

  // 필수 필드 (appName 은 다국어를 받으므로 아래 locales 정규화에서 따로 검증한다)
  for (const f of ['slug', 'appId', 'startUrl']) {
    if (!raw[f] || typeof raw[f] !== 'string') err(slug, `"${f}" 누락 또는 문자열 아님`);
  }
  if (!raw.appName || (typeof raw.appName !== 'string' && typeof raw.appName !== 'object')) {
    err(slug, '"appName" 누락 — 문자열 또는 로케일 맵({ "en": "…" }) 이어야 함');
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

  // 다국어(로케일). 네이티브 껍데기 문자열(앱 이름·iOS 권한 문구·ATT 문구)은 웹이 로드되기 전에
  // OS 가 직접 보여주므로 웹의 i18n 이 닿지 않는다 — config 가 언어별 값을 갖는다.
  // locales 를 선언하지 않은 앱은 supported: [] → 생성기가 로케일 산출물을 아예 만들지 않는다
  // (기존 앱의 산출물이 이번 변경으로 달라지지 않는다). 상세: docs/02-GUIDE.md §6
  const locales = normalizeLocales(raw.locales, (m) => err(slug, m));
  const loc = (path, value) => normalizeLocalized(path, value, locales, (m) => err(slug, m));
  const appName = loc('appName', raw.appName);

  // theme / features 정규화 (기본값 병합)
  const theme = merge(DEFAULT_THEME, raw.theme ?? {});
  if (!['light', 'dark'].includes(theme.statusBarStyle)) {
    err(slug, `theme.statusBarStyle 은 "light" | "dark" (받음: ${theme.statusBarStyle})`);
  }
  const features = merge(DEFAULT_FEATURES, raw.features ?? {});

  if (features.deferredDeepLink.enabled && !features.deferredDeepLink.provider) {
    err(slug, `deferredDeepLink.enabled=true 인데 provider 가 없음 (branch | appsflyer ...)`);
  }
  if (features.forceUpdate.enabled) {
    const src = features.forceUpdate.source;
    if (!['url', 'remoteConfig'].includes(src)) {
      err(slug, `forceUpdate.source 는 "url" | "remoteConfig" (받음: ${src})`);
    }
    if (src === 'url' && !features.forceUpdate.minVersionUrl) {
      err(slug, 'forceUpdate.source="url" 인데 minVersionUrl 이 없음');
    }
    // remoteConfig 를 쓰려면 실제로 RC 가 켜져 있어야 한다. 안 그러면 브릿지가 값을 못 읽고
    // 조용히 폴백(또는 fail-open)으로 빠져 "게이트를 켰는데 안 뜬다"가 된다.
    if (src === 'remoteConfig' && !(raw.firebase?.enabled && raw.firebase?.remoteConfig)) {
      err(slug, 'forceUpdate.source="remoteConfig" 인데 firebase.enabled/remoteConfig 가 켜져 있지 않음 — ' +
        '둘 다 true 여야 원격 설정을 읽을 수 있다.');
    }
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
  // 자체 IdP 모드는 제거됐다. 설정이 남아 있으면 브릿지가 조용히 무시해 로그인이 통째로
  // 실패하므로, 빌드 시점에 무엇을 고쳐야 하는지 알려주고 멈춘다.
  if (raw.auth && 'idp' in raw.auth) {
    err(slug, 'auth.idp 는 더 이상 지원되지 않습니다 — 자체 IdP(Keycloak) 모드가 제거됐습니다. ' +
      '공급자별 auth.oauth.<provider>.clientId 로 옮기세요(docs/25-AUTH-DELEGATION.md).');
  }
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

  // tracking 정규화 + 검증. ATT 는 켜는 순간 Info.plist 문구가 스토어에 노출되므로
  // 문구 누락은 경고가 아니라 실패로 막는다(경고는 무시된다).
  //   ⚠️ usageDescription 이 로케일 맵일 수 있다. merge 는 null 기본값과 객체를 병합하지 못하고,
  //   무엇보다 cfg.tracking 은 runtimeConfig 로 웹에 그대로 나가므로 **문자열로 접어서** 넘긴다.
  //   언어별 원본은 cfg.localized.attUsageDescription 으로만 흐른다(네이티브 리소스 생성용).
  const rawTracking = JSON.parse(JSON.stringify(raw.tracking ?? {}));
  const attDesc = rawTracking.att?.usageDescription != null
    ? loc('tracking.att.usageDescription', rawTracking.att.usageDescription)
    : null;
  if (attDesc) rawTracking.att.usageDescription = attDesc.base;
  const tracking = merge(DEFAULT_TRACKING, rawTracking);
  if (tracking.att.enabled) {
    const desc = tracking.att.usageDescription;
    if (typeof desc !== 'string' || desc.trim() === '') {
      err(slug, 'tracking.att.enabled=true 인데 tracking.att.usageDescription 이 없음 — ' +
        'Info.plist NSUserTrackingUsageDescription 에 들어갈 문구다. ' +
        '이 앱이 추적 데이터를 실제로 쓰는 목적을 그대로 적어라(예: "관심에 더 맞는 광고를 제공하고 ' +
        '마케팅 성과를 측정하기 위해 활동 데이터를 사용합니다"). 실제 용도와 다른 문구는 심사·법규 리스크.');
    }
  }

  // ios / android — 딥링크 도메인 증명 파일 생성에 쓰는 공개 식별자.
  // 형식만 검증하고 누락은 막지 않는다. 딥링크를 안 쓰는 앱도 있고, 쓰더라도
  // 지문은 Play Console 등록 후에야 나오므로 빌드를 세우면 순서가 꼬인다.
  // 대신 generate-app 이 파일을 만들지 못했다고 크게 경고한다.
  const ios = merge(DEFAULT_IOS, raw.ios ?? {});
  // ios.usageDescriptions: 하네스 기본 권한 문구를 plist 키 단위로 덮어쓰는 선택 블록.
  // 네이티브 생성 전용이라 cfg.ios(→ runtimeConfig 로 웹 노출)에는 남기지 않는다.
  const iosUsage = {};
  if (ios.usageDescriptions != null) {
    if (typeof ios.usageDescriptions !== 'object' || Array.isArray(ios.usageDescriptions)) {
      err(slug, 'ios.usageDescriptions 는 객체여야 함 — { "NSCameraUsageDescription": "…" }');
    }
    for (const [k, v] of Object.entries(ios.usageDescriptions)) {
      if (!IOS_USAGE_KEYS.includes(k)) {
        err(slug, `ios.usageDescriptions 의 "${k}" 는 지원하지 않는 키 — 오타면 조용히 무시된다. ` +
          `가능: ${IOS_USAGE_KEYS.join(' | ')}`);
      }
      iosUsage[k] = loc(`ios.usageDescriptions.${k}`, v);
    }
    delete ios.usageDescriptions;
  }
  const android = merge(DEFAULT_ANDROID, raw.android ?? {});
  if (ios.appStoreId != null && !/^\d+$/.test(String(ios.appStoreId))) {
    err(slug, `ios.appStoreId "${ios.appStoreId}" 형식 오류 — 숫자만 (예: "6480000000")`);
  }
  // 문자열 "false" 를 넣으면 plist 에 <true/> 가 박혀 반대 신고가 된다 — 불리언만 받는다.
  if (ios.usesNonExemptEncryption != null && typeof ios.usesNonExemptEncryption !== 'boolean') {
    err(slug, `ios.usesNonExemptEncryption 는 true/false 불리언이어야 함 (받은 값: ${JSON.stringify(ios.usesNonExemptEncryption)}). ` +
      '수출 규정 신고 값이라 문자열을 허용하지 않는다 — docs/07-HOWTO-DEPLOY.md §6');
  }
  if (ios.teamId != null && !APPLE_TEAM_ID_RE.test(ios.teamId)) {
    err(slug, `ios.teamId "${ios.teamId}" 형식 오류 — 영숫자 대문자 10자리 (예: 3W889GYPRK)`);
  }
  if (!Array.isArray(android.sha256CertFingerprints)) {
    err(slug, 'android.sha256CertFingerprints 는 배열이어야 함');
  }
  for (const fp of android.sha256CertFingerprints) {
    if (typeof fp !== 'string' || !SHA256_FP_RE.test(fp)) {
      err(slug, `android.sha256CertFingerprints 항목 "${fp}" 형식 오류 — ` +
        '대문자 16진수 2자리 32쌍을 콜론으로 이은 형태 (AA:BB:…:FF). ' +
        'Play Console > 앱 > 설정 > 앱 서명 에서 복사한다.');
    }
  }

  const legal = merge(DEFAULT_LEGAL, raw.legal ?? {});
  const permissions = merge(DEFAULT_PERMISSIONS, raw.permissions ?? {});

  return {
    slug, appName: appName.base, appId: raw.appId, startUrl: raw.startUrl,
    version, theme, features, navigation, assets, marketing, auth, iap, monitoring,
    firebase, tracking, ios, android, legal, permissions,
    // 로케일 선언 + 언어별 원본. 기존 필드는 전부 문자열(기본 로케일 값)로 유지되므로
    // runtimeConfig·브릿지·capacitor.config 는 이 블록을 몰라도 그대로 동작한다.
    locales,
    localized: {
      appName: appName.map ? appName : null,
      attUsageDescription: attDesc?.map ? attDesc : null,
      iosUsage,
    },
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
    tracking: cfg.tracking,     // ATT 토글 + 사전동의 화면 담당 주체(prePermission) + 폴백 문구.
    ios: cfg.ios,               // Apple 팀 ID + App Store 숫자 ID. 둘 다 공개값이라 노출해도 된다.
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
  // Apple Developer 팀 ID — 계정이 하나라 전 앱 공통. AASA 의 appID 접두사로 쓰인다.
  // 비밀값이 아니다: 모든 앱의 공개 .well-known/apple-app-site-association 에 그대로 실린다
  // (poptale.ai 에서 확인 가능). 그래서 gitignore 되는 fastlane/.env 가 아니라 여기 둔다 —
  // 거기 두면 개발자·CI 마다 따로 설정해야 해서 "config 만 채우면 동작" 이 깨진다.
  // ⚠️ 오래된 App ID 는 App ID Prefix 가 팀 ID 와 다를 수 있다. 그 경우에만 앱 config 의
  //    ios.teamId 로 덮는다 (Certificates, Identifiers & Profiles > Identifiers 에서 확인).
  appleTeamId: '3W889GYPRK',
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
 * @param {{ slug: string, appName: string }} opts
 *
 * 인증은 항상 **외부 인증서버 위탁**이다(docs/25-AUTH-DELEGATION.md). Keycloak 등 자체 IdP 는
 * 쓰지 않기로 확정됐으므로 이 프리셋은 `auth.idp` 를 어떤 경우에도 내보내지 않는다.
 * @returns {object} app.config.json 시작 보일러플레이트
 */
export function aipiaPreset({ slug, appName, ...rest }) {
  if (!SLUG_RE.test(slug)) throw new Error(`slug "${slug}" 형식 오류`);
  // 예전 시그니처의 idp 인자를 조용히 무시하면 호출자의 의도가 사라진다 — 명시적으로 막는다.
  if ('idp' in rest) {
    throw new Error(
      'aipiaPreset 은 더 이상 idp 인자를 받지 않습니다 — 자체 IdP(Keycloak)는 사용하지 않기로 ' +
      '확정됐습니다. 인증은 외부 인증서버 위탁이며 auth.oauth 로 배선합니다. ' +
      '(docs/25-AUTH-DELEGATION.md)',
    );
  }
  const sub = (tpl) => tpl.replaceAll('{slug}', slug);
  const D = AIPIA_DEFAULTS;
  const webProd = sub(D.domainPattern.web.prod);
  const apiProd = sub(D.domainPattern.api.prod);
  // 소셜 provider 마다 clientId 자리를 만들어 둔다 — 값은 각 공급자 콘솔에서 발급받아 채운다.
  // email 은 웹이 처리하므로(브릿지는 email-handled-by-web 반환) oauth 항목이 필요 없다.
  const providers = [...D.auth.providers];
  const oauth = Object.fromEntries(
    providers.filter((p) => p !== 'email').map((p) => [p, { clientId: null }]),
  );
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
      providers,
      sessionEndpoint: `https://${apiProd}${D.backendEndpoints.authNative}`,
      signupEndpoint:  `https://${apiProd}${D.backendEndpoints.authSignup}`,
      logoutEndpoint:  `https://${apiProd}${D.backendEndpoints.authLogout}`,
      deleteEndpoint:  `https://${apiProd}${D.backendEndpoints.authDelete}`,
      guestEndpoint:   `https://${apiProd}${D.backendEndpoints.authGuest}`,
      deviceEndpoint:  `https://${apiProd}${D.backendEndpoints.authDevice}`,
      oauth,
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
    // 추적 동의(ATT). **어트리뷰션 SDK 를 붙인 뒤에 켠다** — SDK 없이 켜면 "동의는 묻는데 쓸 데가
    // 없는" 반쪽 상태라 심사 리스크. 켤 때 usageDescription 은 필수(비우면 빌드 실패)이고,
    // 실제 용도를 그대로 적어야 한다(표기와 용도가 다르면 심사·법규 리스크).
    tracking: {
      att: {
        enabled: false,
        usageDescription: '관심에 더 맞는 광고를 제공하고 마케팅 성과를 측정하기 위해 활동 데이터를 사용합니다.',
        prePermission: false,   // false = 브릿지 기본 화면. 웹이 직접 그리면 true
      },
    },
    // 딥링크 도메인 증명용 공개 식별자.
    //   ios.teamId 는 조직 공통이라 비워두고 환경변수(FASTLANE_DEV_TEAM_ID)로 해결하는 게 기본.
    //   지문은 Play Console 등록 후에야 나오므로 빈 배열로 시작 → 나오면 2개(업로드/앱서명) 채운다.
    ios: { teamId: D.appleTeamId },
    android: { sha256CertFingerprints: [] },
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
