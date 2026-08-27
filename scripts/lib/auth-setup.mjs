// auth-setup.mjs — 인증 플러그인 + 인증 규칙 판정의 **정본**.
//
// generate-app.mjs(빌드 게이트)와 doctor.mjs(헬스체크)가 **둘 다 여기를 import 한다.**
// 예전엔 doctor 가 같은 규칙을 손으로 다시 구현했고, 그래서 이미 서로 달라져 있었다
// (doctor 에는 per-provider clientId · authorizeUrl · platform 예외가 없었고,
//  generate-app 에는 sessionEndpoint 점검이 없었다). 규칙을 두 곳에 쓰지 마라 —
// 새 인증 규칙은 이 파일에만 추가하면 양쪽에 자동으로 반영된다.
//
// 규칙은 여기가 정본이고, 그걸 경고로 낼지 중단으로 낼지(정책)는 **호출자가** 정한다 —
// 같은 문제를 경고와 치명 양쪽에 중복 인코딩하지 않기 위해.
//   warnings      — dev 조언. 릴리즈에서도 경고로만 낸다.
//   storeBlockers — 스토어 요건. generate-app 은 dev 경고 / --release 중단,
//                   doctor 는 요약 한 줄로만 낸다(헬스체크는 빌드 게이트가 아니다).

// 인증: 네이티브 SDK 가 필요한 공급자만 플러그인 설치. 나머지(google/naver/kakao/facebook/x/threads)는
// 시스템 브라우저 OAuth2(PKCE)로 처리 → 추가 플러그인 불필요(@capacitor/browser 는 base).
export const AUTH_NATIVE_PLUGINS = {
  apple: ['@capacitor-community/apple-sign-in'], // iOS 네이티브 Sign in with Apple
};

// 브릿지 OAUTH_PRESETS 와 같은 집합이어야 한다 — 여기 없고 config 에 authorizeUrl 도
// 없으면 앱은 OAuth 를 시작할 URL 자체를 모른다(런타임 oauth-misconfigured).
// test/providers.test.mjs 가 브릿지 쪽과의 동기화를 지킨다.
//
// 아래 authSetup 의 authorizeUrl 분기는 **현재 도달 불가**다: scripts/lib/config.mjs 의
// KNOWN_AUTH_PROVIDERS 가 프리셋 밖 provider 를 config 로딩 단계에서 먼저 거부하므로,
// "프리셋에 없는 provider" 를 담은 config 자체를 만들 수 없다. 그래도 남겨 둔다 —
// 프리셋 밖 provider 를 허용하게 될 때(KNOWN_AUTH_PROVIDERS 확장) 바로 동작하는 선제 방어다.
// 그때 그 분기는 storeBlockers 로 나간다 — dev 는 경고, --release 는 중단. authorize URL 이
// 없는 앱은 빌드는 되지만 런타임에 로그인이 아예 시작되지 않으므로(oauth-misconfigured)
// 스토어에 내보내면 안 된다. 경고로만 두면 프리셋 없는 provider 가 릴리즈를 통과한다.
export const OAUTH_PRESET_PROVIDERS = [
  'google', 'naver', 'kakao', 'apple', 'facebook', 'x', 'threads', 'line', 'discord',
];

/**
 * 인증 플러그인 + 규칙 판정.
 * @param {object} cfg loadConfig() 결과
 * @param {'android'|'ios'|'both'|undefined} platform 생략하면 플랫폼 예외를 적용하지 않는다
 *   (= 가장 엄격). doctor 는 플랫폼이 없으므로 생략하고 부른다.
 * @returns {{ plugins: string[], warnings: string[], storeBlockers: string[], hasOAuth: boolean }}
 */
export function authSetup(cfg, platform) {
  const providers = cfg.auth?.providers || [];
  const plugins = [];
  const warnings = [];
  const storeBlockers = [];
  const social = providers.filter((p) => p !== 'email');

  for (const p of providers) {
    (AUTH_NATIVE_PLUGINS[p] || []).forEach((x) => plugins.push(x));
  }

  // Apple App Store 4.8: 제3자 소셜 로그인을 제공하면 Sign in with Apple 도 제공해야 한다(iOS).
  const hasOtherSocial = social.some((p) => p !== 'apple');
  if (hasOtherSocial && !providers.includes('apple')) {
    storeBlockers.push('소셜 로그인 제공 시 Apple 가이드라인 4.8 에 따라 "apple"(Sign in with Apple) 도 ' +
      'providers 에 추가해야 합니다 (하네스는 한 config 로 양 스토어를 낸다 — iOS 심사에서 리젝된다).');
  }

  // 회원탈퇴는 App Store · Play 양쪽 필수. providers 가 있을 때만 본다 —
  // 즉 auth.providers 없이 웹 레이어에서만 로그인하는 앱(현재 characterchat)은 이 게이트를
  // 그냥 통과한다. 스토어 요건은 그래도 적용되므로 게이트가 완전하다고 오해하지 마라.
  if (providers.length && !cfg.auth?.deleteEndpoint) {
    storeBlockers.push('auth.deleteEndpoint 누락 — 회원탈퇴는 App Store · Play 양쪽의 필수 요건입니다. ' +
      '백엔드 탈퇴 API URL 을 auth.deleteEndpoint 에 넣으세요(docs/10-AUTH.md).');
  }

  // sessionEndpoint 는 스토어 요건이 아니다 — 웹이 자격증명을 직접 백엔드로 보내도 된다.
  // 다만 없으면 브릿지가 세션쿠키 발급을 자동화하지 못하므로 dev 조언으로 남긴다.
  // (원래 doctor.mjs 가 따로 갖고 있던 점검이다 — 이관해서 양쪽이 같이 본다.)
  if (providers.length && !cfg.auth?.sessionEndpoint) {
    warnings.push('auth.sessionEndpoint 없음 — 브릿지가 백엔드 세션 발급을 자동화하지 못합니다. ' +
      '웹이 자격증명을 직접 백엔드로 보내는 구조면 무시해도 됩니다(docs/10-AUTH.md).');
  }

  // 시스템 브라우저 OAuth 공급자는 공개 clientId 가 필요하다.
  for (const p of social) {
    // iOS 네이티브 Apple 로그인은 appId 폴백이 있지만, Android 는 web OAuth 를 타므로
    // Services ID(clientId)가 없으면 런타임에 oauth-misconfigured 다.
    if (p === 'apple' && platform === 'ios') continue;
    if (!cfg.auth?.oauth?.[p]?.clientId) {
      storeBlockers.push(`auth.oauth.${p}.clientId 누락 — OAuth 가 런타임에 동작하지 않음(빌드는 됨). ` +
        '공개 clientId 를 config 에 넣거나 빌드 시 주입하세요(client secret 은 백엔드 전용).');
    }
    // 프리셋도 authorizeUrl 도 없으면 OAuth 를 시작할 URL 자체가 없다 — 로그인이 런타임에
    // 첫 화면부터 죽는다(oauth-misconfigured). clientId 누락과 같은 등급이므로 storeBlockers 다.
    // (현재 도달 불가 — 위 OAUTH_PRESET_PROVIDERS 주석 참고. 도달하게 되는 순간 릴리즈를 막는다.)
    if (!OAUTH_PRESET_PROVIDERS.includes(p) && !cfg.auth?.oauth?.[p]?.authorizeUrl) {
      storeBlockers.push(`auth.oauth.${p}.authorizeUrl 누락 — "${p}" 는 브릿지 프리셋에 없어 ` +
        'authorize URL 을 config 에서 받아야 합니다. auth.oauth.' + p + '.authorizeUrl 에 ' +
        '공급자의 authorize 엔드포인트(https://...)를 넣으세요.');
    }
  }
  return { plugins, warnings, storeBlockers, hasOAuth: social.length > 0 };
}

/**
 * storeBlockers 를 한 줄로 요약한다 — doctor 처럼 "알기만 하면 되는" 소비자용.
 * 항목을 전부 찍으면 앱당 최대 8줄이 나와 진짜 문제를 묻어버린다.
 * @param {string[]} storeBlockers
 * @returns {string|null} 요약 문장, 없으면 null
 */
export function summarizeStoreBlockers(storeBlockers) {
  if (!storeBlockers.length) return null;
  // 종류별로 묶는다. 산문을 파싱하지 않고 아는 모양만 분류한다 —
  // 새 storeBlocker 를 추가하면 여기도 한 줄 넣어라(없으면 '기타' 로 묶인다).
  const kindOf = (m) => {
    const oauth = m.match(/^auth\.oauth\.[\w-]+\.(\w+)/);
    if (oauth) return `auth.oauth.*.${oauth[1]}`;
    const key = m.match(/^(auth\.[\w.]+)/);
    if (key) return key[1];
    if (m.includes('4.8')) return 'Apple 4.8 (apple provider 누락)';
    return '기타';
  };
  const kinds = new Map();
  for (const m of storeBlockers) kinds.set(kindOf(m), (kinds.get(kindOf(m)) || 0) + 1);
  const detail = [...kinds.entries()]
    .map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
    .join(', ');
  return `스토어 요건 미충족 ${storeBlockers.length}건 — --release 빌드 실패 (${detail})`;
}
