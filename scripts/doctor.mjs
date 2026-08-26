#!/usr/bin/env node
// doctor.mjs — 환경 + 모든 앱 config 점검(읽기 전용). 온보딩/CI 사전 점검용.
//   node scripts/doctor.mjs
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';

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
const slugs = existsSync(appsDir)
  ? readdirSync(appsDir).filter((d) => statSync(join(appsDir, d)).isDirectory())
  : [];
if (!slugs.length) w('등록된 앱 없음 — new-app 으로 추가');
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
  if (cfg.auth.providers.length) {
    ok(`auth: ${cfg.auth.providers.join(', ')}`);
    const social = cfg.auth.providers.filter((p) => p !== 'email' && p !== 'apple');
    if (social.length && !cfg.auth.providers.includes('apple')) w('소셜 제공 시 apple(Sign in with Apple) 권장 — iOS 4.8');
    if (!cfg.auth.sessionEndpoint) w('auth.sessionEndpoint 없음 — 백엔드 세션 발급 자동화 불가');
    if (!cfg.auth.deleteEndpoint) w('auth.deleteEndpoint 없음 — 회원탈퇴(스토어 필수) 백엔드 필요');
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
