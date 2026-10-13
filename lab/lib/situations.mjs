// 상황(situation) — 시나리오의 전제 조건을 기기 상태로 만든다. 같은 이름이 두 플랫폼에서 같은 뜻이다.
// 플랫폼이 못 하는 상황은 { unsupported: '이유와 대안' } 을 돌려준다 — 조용히 넘기지 않는다
// (에이전트가 '확인함'으로 잘못 보고하지 않게).
import * as A from './android.mjs';
import * as I from './ios.mjs';

// 앱 언어 태그 → 플랫폼 로케일. 웹(next-intl)은 WebView 의 Accept-Language 로 시스템 언어를 받는다.
const LOCALES = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', 'zh-Hant': 'zh-TW', 'es-419': 'es-419' };

// 글꼴 배율 → iOS Dynamic Type 단계(가장 가까운 것)
const IOS_SIZES = [
  [0.85, 'small'], [1.0, 'large'], [1.15, 'extra-large'], [1.3, 'extra-extra-large'],
  [1.5, 'extra-extra-extra-large'], [2.0, 'accessibility-extra-large'],
];

export const SITUATIONS = {
  theme: { args: 'dark|light', desc: '시스템 다크/라이트 모드' },
  locale: { args: 'ko|en|ja|zh-Hant|es-419', desc: '앱(안드 13+)·시스템 언어 — 웹은 Accept-Language 로 받는다' },
  font: { args: '1.0|1.3|2.0 …', desc: '시스템 글꼴 배율(iOS 는 Dynamic Type 단계로 근사)' },
  'display-size': { args: '<dp폭>|reset', desc: '안드 화면 크기 설정(=갤럭시 디스플레이 크기). 같은 기기에서 dp 폭을 바꾼다' },
  network: { args: 'off|on|slow', desc: '네트워크 끊김/복구/저속(EDGE)' },
  rotate: { args: 'portrait|landscape', desc: '화면 회전' },
  fold: { args: 'open|closed|half', desc: '폴더블 펼침/접힘/반접힘(폴더블 AVD 만)' },
  permission: { args: '<grant|revoke|reset> <notifications|camera>', desc: '권한 부여·회수·다시 묻기' },
  background: { args: '', desc: '홈으로 나가 앱을 백그라운드로' },
  foreground: { args: '', desc: '앱을 다시 앞으로(재시작 아님)' },
  'process-death': { args: '', desc: '백그라운드 중 OS 가 프로세스를 죽인 상황 → 복귀 시 상태 복원 확인' },
  restart: { args: '', desc: '강제 종료 후 콜드 스타트' },
  deeplink: { args: '<url> [cold]', desc: '커스텀 스킴/https 딥링크(cold = 앱 종료 상태에서)' },
  'push-tap': { args: '<경로 또는 url>', desc: '푸시 알림 탭 → 라우팅(안드=FCM 탭 인텐트 재현, iOS=simctl push 실알림)' },
  battery: { args: 'low|ok', desc: '배터리 부족·절전(안드)' },
  animations: { args: 'off|on', desc: '시스템 애니메이션(off 면 스크린샷이 안정적, 끊김 확인엔 on)' },
  'clear-data': { args: '', desc: '앱 데이터 삭제(설치는 유지) — 첫 실행 상태' },
  reset: { args: '', desc: '위 상황을 기본값으로 되돌림' },
};

export async function apply(ctx, name, args = []) {
  const fn = (ctx.platform === 'ios' ? IOS : ANDROID)[name];
  if (!fn) throw new Error(`모르는 상황: ${name} (lab situations 로 목록 확인)`);
  return (await fn(ctx, ...args)) ?? { ok: true };
}

const unsupported = (why) => ({ unsupported: why });

const ANDROID = {
  theme: ({ serial }, mode) => A.sh(serial, `cmd uimode night ${mode === 'dark' ? 'yes' : 'no'}`),
  locale: ({ serial, pkg }, lang) => {
    const tag = LOCALES[lang] ?? lang;
    if (A.apiLevel(serial) >= 33) {
      A.sh(serial, `cmd locale set-app-locales ${pkg} --locales ${tag}`);
      return { ok: true, note: `앱별 언어 ${tag}(앱 재시작 없이 반영 — 웹은 새로 고침 뒤)` };
    }
    // 12 이하: 앱별 언어가 없다 → 시스템 언어(루트 필요, google_apis 이미지는 가능)
    A.adb(serial, ['root']);
    A.sh(serial, `setprop persist.sys.locale ${tag}; setprop ctl.restart zygote`);
    return { ok: true, note: `시스템 언어 ${tag} — 시스템 UI 재시작(수십 초)` };
  },
  font: ({ serial }, scale) => A.sh(serial, `settings put system font_scale ${Number(scale)}`),
  'display-size': ({ serial }, dp) => {
    if (dp === 'reset') return A.sh(serial, 'wm density reset');
    const w = Number(A.sh(serial, 'wm size').out.match(/(\d+)x\d+/)?.[1]);
    return A.sh(serial, `wm density ${Math.round((w * 160) / Number(dp))}`);
  },
  network: ({ serial }, mode) => {
    if (mode === 'off') return A.sh(serial, 'svc wifi disable; svc data disable');
    if (mode === 'on') {
      A.adb(serial, ['emu', 'network', 'speed', 'full']);
      A.adb(serial, ['emu', 'network', 'delay', 'none']);
      return A.sh(serial, 'svc wifi enable; svc data enable');
    }
    if (mode === 'slow') {
      A.adb(serial, ['emu', 'network', 'speed', 'edge']);
      return A.adb(serial, ['emu', 'network', 'delay', 'edge']);
    }
    throw new Error('network off|on|slow');
  },
  rotate: ({ serial }, dir) => A.sh(serial,
    `settings put system accelerometer_rotation 0; settings put system user_rotation ${dir === 'landscape' ? 1 : 0}`),
  fold: ({ serial, dev }, state) => {
    if (!/fold/i.test(dev.profile ?? '')) return unsupported('폴더블 AVD 가 아니다(and16-flip · and16-fold 사용)');
    if (state === 'closed') return A.adb(serial, ['emu', 'fold']);
    if (state === 'open') return A.adb(serial, ['emu', 'unfold']);
    if (state === 'half') return A.adb(serial, ['emu', 'posture', '2']);
    throw new Error('fold open|closed|half');
  },
  permission: ({ serial, pkg }, action, what) => {
    const perm = { notifications: 'android.permission.POST_NOTIFICATIONS', camera: 'android.permission.CAMERA' }[what];
    if (!perm) throw new Error('permission <grant|revoke|reset> <notifications|camera>');
    if (what === 'notifications' && A.apiLevel(serial) < 33) return unsupported('Android 12 이하는 알림 런타임 권한이 없다(항상 허용)');
    if (action === 'reset') return A.sh(serial, `pm revoke ${pkg} ${perm}; pm clear-permission-flags ${pkg} ${perm} user-set user-fixed`);
    return A.sh(serial, `pm ${action} ${pkg} ${perm}`);
  },
  background: ({ serial }) => A.input.key(serial, 'KEYCODE_HOME'),
  foreground: ({ serial, pkg }) => A.launch(serial, pkg),
  'process-death': ({ serial, pkg }) => {
    A.input.key(serial, 'KEYCODE_HOME');
    // am kill 은 백그라운드 프로세스만 죽인다 = OS 의 메모리 회수와 같은 경로(태스크·저장 상태는 남는다)
    return A.sh(serial, `sleep 1; am kill ${pkg}`);
  },
  restart: ({ serial, pkg }) => {
    A.sh(serial, `am force-stop ${pkg}`);
    return A.launch(serial, pkg);
  },
  deeplink: ({ serial, pkg }, url, cold) => {
    if (cold === 'cold') A.sh(serial, `am force-stop ${pkg}`);
    return A.openUrl(serial, url, pkg);
  },
  'push-tap': ({ serial, pkg }, link) => {
    // FCM 알림을 탭했을 때 OS 가 보내는 인텐트(엑스트라에 google.message_id + data)를 그대로 만든다.
    // → @capacitor/push-notifications 가 pushNotificationActionPerformed 를 쏘고 브릿지가 data.url 로 라우팅.
    // 알림 '표시'(채널·배너)는 실발송으로만 확인된다 — 여기서는 탭 이후 라우팅만 본다.
    // 브릿지는 registerPush()(로그인 뒤 권한 허용) 에서 리스너를 단다 — 그 전이면 이벤트가 보류된다.
    const act = A.launcherActivity(serial, pkg);
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    return A.sh(serial, `am start -n ${act} -f 0x20000000 --es google.message_id lab-${Date.now()} --es url ${q(link)}`);
  },
  battery: ({ serial }, level) => level === 'low'
    ? A.sh(serial, 'dumpsys battery unplug; dumpsys battery set level 5; settings put global low_power 1')
    : A.sh(serial, 'dumpsys battery reset; settings put global low_power 0'),
  animations: ({ serial }, mode) => {
    const v = mode === 'off' ? 0 : 1;
    return A.sh(serial, ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']
      .map((k) => `settings put global ${k} ${v}`).join('; '));
  },
  'clear-data': ({ serial, pkg }) => A.sh(serial, `pm clear ${pkg}`),
  reset: async (ctx) => {
    const { serial, dev } = ctx;
    A.sh(serial, 'cmd uimode night no; settings put system font_scale 1.0; wm density reset; '
      + 'settings put system accelerometer_rotation 1; settings put system user_rotation 0; '
      + 'dumpsys battery reset; settings put global low_power 0');
    await ANDROID.network(ctx, 'on');
    await ANDROID.animations(ctx, 'on');
    if (/fold/i.test(dev.profile ?? '')) A.adb(serial, ['emu', 'unfold']);
    return { ok: true };
  },
};

const IOS = {
  theme: ({ udid }, mode) => I.ui.appearance(udid, mode),
  locale: ({ udid, pkg }, lang) => {
    I.setLanguage(udid, LOCALES[lang] ?? lang);
    I.launch(udid, pkg);
    return { ok: true, note: '시스템 언어 변경 + 앱 재시작' };
  },
  font: ({ udid }, scale) => {
    const s = Number(scale);
    const size = IOS_SIZES.reduce((best, cur) => (Math.abs(cur[0] - s) < Math.abs(best[0] - s) ? cur : best))[1];
    return I.ui.contentSize(udid, size);
  },
  'display-size': () => unsupported('iOS 는 기종별 폭이 고정 — 다른 기종(카탈로그)을 고른다. 확대(Display Zoom)는 설정 앱에서 사람이'),
  network: () => unsupported('시뮬레이터는 맥의 네트워크를 그대로 쓴다 — 맥의 Network Link Conditioner(호스트 전체)로 만들거나 Wi-Fi 를 끈다'),
  rotate: (_, dir) => I.ui.rotate(dir === 'landscape' ? 'left' : 'right'),
  fold: () => unsupported('iOS 에 폴더블 없음'),
  permission: ({ udid, pkg }, action, what) => {
    if (what === 'notifications') {
      return unsupported('simctl 은 알림 권한을 못 바꾼다 — reset 은 앱 삭제 후 재설치(lab install --fresh)로, 허용/거부는 프롬프트에서 직접');
    }
    return I.privacy(udid, action, what, pkg);
  },
  background: ({ udid }) => I.ui.home(udid),
  foreground: ({ udid, pkg }) => I.launch(udid, pkg),
  'process-death': ({ udid, pkg }) => {
    I.ui.home(udid);
    return I.terminate(udid, pkg);
  },
  restart: ({ udid, pkg }) => I.launch(udid, pkg),
  deeplink: ({ udid, pkg }, url, cold) => {
    if (cold === 'cold') I.terminate(udid, pkg);
    return I.openUrl(udid, url);
  },
  'push-tap': ({ udid, pkg }, link) => I.push(udid, pkg, {
    aps: { alert: { title: '랩 푸시', body: link }, sound: 'default' },
    url: link,
  }),
  battery: () => unsupported('시뮬레이터에 배터리 상태 없음'),
  animations: () => unsupported('시뮬레이터 전역 애니메이션 스위치 없음(Simulator › Debug › Slow Animations 는 반대 방향)'),
  'clear-data': () => unsupported('iOS 는 앱 데이터만 지우는 명령이 없다 — lab install --fresh'),
  reset: ({ udid }) => {
    I.ui.appearance(udid, 'light');
    I.ui.contentSize(udid, 'large');
    return { ok: true };
  },
};
