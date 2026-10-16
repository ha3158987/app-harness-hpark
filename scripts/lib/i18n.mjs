// i18n.mjs — 네이티브 껍데기의 다국어 문자열. 로케일 코드 표기의 **정본**.
//
// 왜 필요한가: 앱 이름·iOS 권한 문구·ATT 문구는 웹이 로드되기 **전에** OS 가 직접 읽어 보여준다.
// 웹(next-intl)이 닿지 못하는 자리라 config 가 언어별 값을 갖고, 생성기가 네이티브 리소스로 굽는다.
//
// 코드 표기가 플랫폼마다 다르다. 여기를 거치지 않고 config 코드를 그대로 쓰면 **조용히 무시된다**
// (예: values-id 는 안드로이드가 못 알아본다 — 자바 구 ISO 코드라 values-in 이어야 한다).
// docs/02-GUIDE.md §6 "다국어 문자열" 이 문서 정본.

/**
 * config 로케일 코드(BCP-47) → 플랫폼별 표기.
 *   ios        : `<code>.lproj` 디렉터리명 + CFBundleLocalizations 항목
 *   androidRes : res 디렉터리 수식어. 폴백인 res/values/ 는 locales.default 값이 들어간다
 *   androidTag : locales_config.xml 의 android:name (BCP-47 태그)
 *   appStore   : App Store Connect 로케일 (Phase 4 — 스토어 메타데이터)
 *   play       : Google Play 로케일 (Phase 4)
 */
export const LOCALES = {
  // androidRes 는 **명시 수식어**다. 기본 폴백인 res/values/ 는 로케일이 아니라
  // locales.default 값이 들어가는 자리라, en 도 자기 디렉터리(values-en)를 따로 갖는다
  // (default 가 en 이 아닌 앱에서 영어 사용자가 기본값을 보게 되는 걸 막는다).
  'en':      { ios: 'en',      androidRes: 'values-en',       androidTag: 'en',     appStore: 'en-US',   play: 'en-US' },
  'ko-KR':   { ios: 'ko',      androidRes: 'values-ko',       androidTag: 'ko-KR',  appStore: 'ko',      play: 'ko-KR' },
  'ja-JP':   { ios: 'ja',      androidRes: 'values-ja',       androidTag: 'ja-JP',  appStore: 'ja',      play: 'ja-JP' },
  // 번체 중국어: 안드로이드는 지역 수식어가 필요하다(values-zh 는 간체로 잡힌다).
  // App Store 는 스크립트 코드(zh-Hant)를, Play 는 지역 코드(zh-TW)를 쓴다.
  'zh-Hant': { ios: 'zh-Hant', androidRes: 'values-zh-rTW',   androidTag: 'zh-TW',  appStore: 'zh-Hant', play: 'zh-TW' },
  'th-TH':   { ios: 'th',      androidRes: 'values-th',       androidTag: 'th-TH',  appStore: 'th',      play: 'th' },
  // 인도네시아어: 안드로이드 리소스 수식어만 구 ISO 코드(in). 태그는 BCP-47(id-ID) 로 쓴다.
  'id-ID':   { ios: 'id',      androidRes: 'values-in',       androidTag: 'id-ID',  appStore: 'id',      play: 'id' },
  // 중남미 스페인어: 안드로이드는 BCP-47 확장 표기(b+es+419, minSdk 21+). **App Store 는 es-419 를
  // 모른다 — es-MX 를 쓴다.** Play 는 es-419 를 그대로 받는다.
  'es-419':  { ios: 'es-419',  androidRes: 'values-b+es+419', androidTag: 'es-419', appStore: 'es-MX',   play: 'es-419' },
  'pt-BR':   { ios: 'pt-BR',   androidRes: 'values-pt-rBR',   androidTag: 'pt-BR',  appStore: 'pt-BR',   play: 'pt-BR' },
};

export const KNOWN_LOCALES = Object.keys(LOCALES);

// locales 블록이 없는 앱(기존 5개 중 다수)의 기본 문구 언어.
// 하네스가 제공하는 문구(권한 사용 설명 등)는 지금까지 한국어였다 — 로케일을 선언하지 않은 앱의
// 산출물이 이번 변경으로 영어로 바뀌면 그건 하위 호환 파괴다. 그래서 비활성 앱은 ko-KR 로 굳힌다.
export const LEGACY_LOCALE = 'ko-KR';

// supported: [] = 로케일 기능 비활성 → 생성기가 로케일 산출물을 만들지 않는다(기존과 동일 동작).
export const DEFAULT_LOCALES = { default: 'en', supported: [] };

/** 앱 오버라이드를 허용하는 iOS 권한 문구 키 (오타로 조용히 무시되는 걸 막으려 화이트리스트) */
export const IOS_USAGE_KEYS = [
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSLocationWhenInUseUsageDescription',
  'NSFaceIDUsageDescription',
  'NSUserTrackingUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription',
];

/**
 * config 의 locales 블록 정규화 + 검증.
 * @param {object} raw  raw.locales
 * @param {(msg:string)=>never} err
 */
export function normalizeLocales(raw, err) {
  if (raw == null) return { ...DEFAULT_LOCALES };
  if (typeof raw !== 'object' || Array.isArray(raw)) err('locales 는 객체여야 함');
  const def = raw.default ?? DEFAULT_LOCALES.default;
  if (!KNOWN_LOCALES.includes(def)) {
    err(`locales.default "${def}" 미지원. 가능: ${KNOWN_LOCALES.join(' | ')}`);
  }
  const sup = raw.supported ?? [];
  if (!Array.isArray(sup)) err('locales.supported 는 배열이어야 함');
  for (const l of sup) {
    if (!KNOWN_LOCALES.includes(l)) {
      err(`locales.supported 의 "${l}" 미지원 — BCP-47 코드여야 한다(나라코드 jp/cn 금지). ` +
        `가능: ${KNOWN_LOCALES.join(' | ')}`);
    }
  }
  const supported = [...new Set(sup)];
  if (supported.length && !supported.includes(def)) {
    err(`locales.default "${def}" 가 locales.supported 에 없음 — 폴백 언어는 반드시 지원 목록에 있어야 한다`);
  }
  return { default: def, supported };
}

/**
 * "문자열 또는 로케일 맵" 값을 정규화한다.
 *   "캐릭터챗"                      → { base: '캐릭터챗', map: null }        (모든 언어 공통)
 *   { en: 'Popchat', 'ko-KR': '…' } → { base: 'Popchat',  map: {...} }       (base = 기본 로케일 값)
 *
 * @param {string} path  오류 메시지에 쓸 config 경로 (예: 'appName')
 * @param {*} value      raw 값
 * @param {{default:string,supported:string[]}} locales
 * @param {(msg:string)=>never} err
 * @returns {{base:string, map:Object<string,string>|null}}
 */
export function normalizeLocalized(path, value, locales, err) {
  if (typeof value === 'string') {
    if (value.trim() === '') err(`${path} 가 빈 문자열`);
    return { base: value, map: null };
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    err(`${path} 는 문자열 또는 로케일 맵(예: { "en": "…", "ko-KR": "…" }) 이어야 함`);
  }
  const keys = Object.keys(value);
  if (!keys.length) err(`${path} 로케일 맵이 비어 있음`);
  if (!locales.supported.length) {
    err(`${path} 에 로케일 맵을 쓰려면 최상위 locales.supported 를 먼저 선언해야 한다 — ` +
      '선언하지 않으면 번역이 네이티브 리소스로 나가지 않고 조용히 무시된다.');
  }
  for (const k of keys) {
    if (!KNOWN_LOCALES.includes(k)) {
      err(`${path} 의 로케일 "${k}" 미지원. 가능: ${KNOWN_LOCALES.join(' | ')}`);
    }
    if (!locales.supported.includes(k)) {
      err(`${path} 의 로케일 "${k}" 가 locales.supported 에 없음 — 값이 어디에도 쓰이지 않는다. ` +
        'locales.supported 에 추가하거나 이 키를 지워라.');
    }
    if (typeof value[k] !== 'string' || value[k].trim() === '') {
      err(`${path}.${k} 는 비어있지 않은 문자열이어야 함`);
    }
  }
  if (!keys.includes(locales.default)) {
    err(`${path} 에 기본 로케일 "${locales.default}" 값이 없음 — 번역이 없는 언어의 폴백이 사라진다`);
  }
  return { base: value[locales.default], map: { ...value } };
}

/** 로케일 L 의 값: map[L] → base (= 기본 로케일 값 또는 단일 문자열) */
export function resolveLocalized(loc, locale) {
  if (!loc) return null;
  return (loc.map && loc.map[locale]) || loc.base;
}

/**
 * 이 앱의 "기본 문구" 언어.
 * 로케일을 선언한 앱은 locales.default, 선언하지 않은 앱은 지금까지의 동작(한국어)을 유지한다.
 */
export function baseLocaleOf(cfg) {
  return cfg.locales?.supported?.length ? cfg.locales.default : LEGACY_LOCALE;
}
