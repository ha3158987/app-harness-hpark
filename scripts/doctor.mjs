#!/usr/bin/env node
// doctor.mjs — 환경 + 모든 앱 config 점검(읽기 전용). 온보딩/CI 사전 점검용.
//   node scripts/doctor.mjs
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { authSetup, summarizeStoreBlockers } from './lib/auth-setup.mjs';
import { appLinkHosts, appLinkWarnings, hasExplicitAppLinks } from './lib/app-links.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IS_MAC = process.platform === 'darwin';
let warn = 0; let bad = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const w = (m) => { warn++; console.log(`  \x1b[33m⚠\x1b[0m ${m}`); };
const e = (m) => { bad++; console.log(`  \x1b[31m✖\x1b[0m ${m}`); };
const head = (m) => console.log(`\n\x1b[36m\x1b[1m▶ ${m}\x1b[0m`);

head('빌드 환경');
const jh = process.env.JAVA_HOME;
if (jh && existsSync(jh)) ok(`JAVA_HOME=${jh}`);
else w('JAVA_HOME 미설정/경로없음 — Android 빌드엔 JDK 21 필요(쉘 환경에 따라 안 보일 수 있음)');
const ah = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (ah && existsSync(ah)) ok(`ANDROID_HOME=${ah}`);
else w('ANDROID_HOME 미설정/경로없음 — Android 빌드 필요');
if (!IS_MAC) w('현재 OS 가 macOS 아님 — iOS 빌드 불가(CI macOS 또는 맥 필요)');
else ok('macOS — iOS 빌드 가능');
if (/[^\x00-\x7F]/.test(ROOT)) w(`레포 경로에 non-ASCII 포함(${ROOT}) — generate-app 이 overridePathCheck 로 우회하나 ASCII 경로 권장`);

head('앱 정의 (apps/*)');
const appsDir = join(ROOT, 'apps');
const appDirs = existsSync(appsDir)
  ? readdirSync(appsDir).filter((d) => statSync(join(appsDir, d)).isDirectory())
  : [];
const slugs = appDirs.filter((d) => existsSync(join(appsDir, d, 'app.config.json')));
if (!slugs.length) w('등록된 앱 없음 — 빈 설정 템플릿을 복사해 앱을 추가하세요');
if (appDirs.length > slugs.length) w(`설정 없는 자산 폴더 ${appDirs.length - slugs.length}개는 검사하지 않습니다`);
const seenIds = new Map();
for (const slug of slugs) {
  console.log(`\n  [${slug}]`);
  let cfg;
  try { cfg = loadConfig(ROOT, slug); }
  catch (ex) { e(`config 오류: ${ex.message}`); continue; }

  if (seenIds.has(cfg.appId)) e(`appId 중복: ${cfg.appId} (also ${seenIds.get(cfg.appId)})`);
  seenIds.set(cfg.appId, slug);
  ok(`${cfg.appName} (${cfg.appId}) v${cfg.version.name}+${cfg.version.code} → ${cfg.startUrl}`);

  const feats = Object.entries(cfg.features).filter(([, v]) => v === true || v?.enabled).map(([k]) => k);
  if (feats.length) ok(`features: ${feats.join(', ')}`);
  if (cfg.features.deepLink) {
    // 판정은 lib/app-links.mjs 가 정본 — generate-app 이 실제로 등록하는 목록과 같다.
    ok(`app links: ${appLinkHosts(cfg).join(', ') || '(없음)'}` +
      (hasExplicitAppLinks(cfg) ? '' : ' (allowedDomains 전체 — appLinkDomains 미지정)'));
    appLinkWarnings(cfg).forEach((m) => w(m));
  }
  if (cfg.auth.providers.length) {
    ok(`auth: ${cfg.auth.providers.join(', ')}`);
    // 인증 규칙은 lib/auth-setup.mjs 가 정본이다 — doctor 는 다시 구현하지 않는다.
    // platform 을 넘기지 않는다: doctor 는 플랫폼 중립이라 가장 엄격한 판정을 본다
    // (iOS 전용 apple clientId 예외를 적용하지 않는다 → Android 릴리즈와 같은 결과).
    const auth = authSetup(cfg);
    auth.warnings.forEach((m) => w(m));
    // storeBlockers 는 항목별로 찍지 않는다 — 앱당 최대 8건이라 진짜 문제를 묻어버린다.
    // doctor 는 빌드 게이트가 아니므로 요약 한 줄로 알려만 주고, 종료코드도 올리지 않는다.
    // 항목 전체는 `node scripts/generate-app.mjs --slug <slug> --release` 가 찍는다.
    const summary = summarizeStoreBlockers(auth.storeBlockers);
    if (summary) w(summary);
  }
  if (cfg.iap.products.length) {
    ok(`iap: ${cfg.iap.products.length}개 상품`);
    if (!cfg.iap.verifyEndpoint) e('iap.verifyEndpoint 없음 — 영수증 검증 백엔드 필수');
  }
  if (cfg.monitoring.crash.provider) {
    if (cfg.monitoring.crash.dsn) ok(`monitoring: ${cfg.monitoring.crash.provider}`);
    else w(`monitoring.crash=${cfg.monitoring.crash.provider} 인데 dsn 비어있음 — 런타임 비활성`);
  }
  const assets = ['icon', 'splash'].filter((k) => !existsSync(join(cfg._appDir, cfg.assets[k])));
  if (assets.length) w(`에셋 없음: ${assets.join(', ')} — 디버그 빌드는 가능, 스토어 제출엔 필요`);
}

console.log(`\n\x1b[1m결과: ${slugs.length} 앱, 경고 ${warn}, 오류 ${bad}\x1b[0m`);
process.exit(bad ? 1 : 0);
