/**
 * ⚠️ 참조용 템플릿 — 실제 빌드에선 이 파일을 쓰지 않는다.
 *
 * scripts/generate-app.mjs 가 apps/<slug>/app.config.json 을 읽어
 * build/<slug>/capacitor.config.json (JSON) 을 결정론적으로 생성한다.
 * (JSON 으로 내보내는 이유: ts/js config 는 빌드 시 추가 트랜스파일이 필요해 깨지기 쉬움.)
 *
 * 이 .ts 는 "최종적으로 어떤 모양이 나오는지"를 사람이 읽기 위한 레퍼런스다.
 * {{PLACEHOLDER}} 는 app.config.json 값으로 치환된다.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: '{{appId}}',
  appName: '{{appName}}',
  webDir: 'www', // 오프라인/에러 폴백 셸. 평소엔 server.url 의 원격 웹이 로드된다.
  server: {
    url: '{{startUrl}}',          // 원격 웹 서비스를 그대로 로드
    cleartext: false,
    allowNavigation: ['{{...navigation.allowedDomains}}'], // 화이트리스트만 셸 내부 탐색
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '{{theme.background}}',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: '{{theme.statusBarStyle === "dark" ? "DARK" : "LIGHT"}}',
      backgroundColor: '{{theme.background}}',
    },
    // features.push 가 true 일 때만 포함됨
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
  ios: { contentInset: 'never' }, // edge-to-edge: 콘텐츠를 세이프에어리어 밖(노치/홈인디케이터)까지 확장
  android: { allowMixedContent: false },
};

export default config;
