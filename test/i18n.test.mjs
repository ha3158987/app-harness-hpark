import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALES, normalizeLocales, normalizeLocalized, resolveLocalized, baseLocaleOf } from '../scripts/lib/i18n.mjs';
import { loadConfig } from '../scripts/lib/config.mjs';
import { appResourcesFilesAnchor, stripLprojRefs, rewriteKnownRegions } from '../scripts/lib/pbxproj.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const boom = (m) => { throw new Error(m); };
const L8 = { default: 'en', supported: Object.keys(LOCALES) };

test('플랫폼 코드 표기 — 그대로 쓰면 조용히 무시되는 것들', () => {
  // 이 4개가 이 테이블의 존재 이유다. 바뀌면 리소스가 로드되지 않는다.
  assert.equal(LOCALES['id-ID'].androidRes, 'values-in');       // values-id 는 무시됨(자바 구 ISO)
  assert.equal(LOCALES['zh-Hant'].androidRes, 'values-zh-rTW');
  assert.equal(LOCALES['es-419'].androidRes, 'values-b+es+419');
  assert.equal(LOCALES['es-419'].appStore, 'es-MX');            // App Store 는 es-419 를 모른다
  // en 도 자기 디렉터리를 갖는다 — res/values/ 는 '영어'가 아니라 locales.default 자리다.
  assert.equal(LOCALES.en.androidRes, 'values-en');
});

test('문자열 값은 그대로 통과한다 (하위 호환)', () => {
  const v = normalizeLocalized('appName', '캐릭터챗', { default: 'en', supported: [] }, boom);
  assert.deepEqual(v, { base: '캐릭터챗', map: null });
  assert.equal(resolveLocalized(v, 'th-TH'), '캐릭터챗');
});

test('로케일 맵은 기본 로케일 값을 base 로, 나머지는 폴백한다', () => {
  const v = normalizeLocalized('appName', { en: 'Popchat', 'ko-KR': '캐릭터챗' }, L8, boom);
  assert.equal(v.base, 'Popchat');
  assert.equal(resolveLocalized(v, 'ko-KR'), '캐릭터챗');
  assert.equal(resolveLocalized(v, 'th-TH'), 'Popchat'); // 번역 없는 언어 → 영어 폴백
});

test('기본 로케일 값이 없으면 실패한다 (폴백이 사라지므로)', () => {
  assert.throws(() => normalizeLocalized('appName', { 'ko-KR': '캐릭터챗' }, L8, boom), /기본 로케일/);
});

test('locales 선언 없이 로케일 맵을 쓰면 실패한다 (조용히 무시되는 것 방지)', () => {
  assert.throws(
    () => normalizeLocalized('appName', { en: 'x' }, { default: 'en', supported: [] }, boom),
    /locales.supported/);
});

test('미지원/미선언 로케일 코드는 실패한다', () => {
  assert.throws(() => normalizeLocales({ default: 'en', supported: ['jp'] }, boom), /미지원/);
  assert.throws(() => normalizeLocales({ default: 'ko-KR', supported: ['en'] }, boom), /supported 에 없음/);
  assert.throws(
    () => normalizeLocalized('appName', { en: 'x', 'ja-JP': 'y' }, { default: 'en', supported: ['en'] }, boom),
    /locales.supported 에 없음/);
});

test('locales 미선언 앱의 기본 문구 언어는 한국어로 유지된다 (기존 동작 보존)', () => {
  assert.equal(baseLocaleOf({ locales: { default: 'en', supported: [] } }), 'ko-KR');
  assert.equal(baseLocaleOf({ locales: L8 }), 'en');
});

function assertLocalizedConfig(cfg, slug) {
  assert.equal(typeof cfg.appName, 'string', `${slug}: appName 이 문자열이어야 한다(웹/네이티브가 그대로 읽음)`);
  const desc = cfg.tracking.att.usageDescription;
  assert.ok(desc === null || typeof desc === 'string', `${slug}: att.usageDescription 이 문자열/null 이어야 한다`);
  for (const l of cfg.locales.supported) assert.ok(LOCALES[l], `${slug}: 알 수 없는 로케일 ${l}`);
}

test('로케일 맵이 있는 앱 설정을 읽으면 런타임 문자열로 정규화된다', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ah-i18n-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const slug = 'sample';
  const appDir = join(root, 'apps', slug);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'app.config.json'), JSON.stringify({
    slug,
    appName: { en: 'Sample', 'ko-KR': '샘플' },
    appId: 'com.example.sample',
    startUrl: 'https://example.com',
    locales: { default: 'en', supported: ['en', 'ko-KR'] },
    tracking: { att: { usageDescription: { en: 'Analytics', 'ko-KR': '분석' } } },
  }));
  const cfg = loadConfig(root, slug);
  assertLocalizedConfig(cfg, slug);
  assert.equal(cfg.appName, 'Sample');
  assert.equal(cfg.tracking.att.usageDescription, 'Analytics');
});

test('실제 앱 설정 파일이 있는 디렉터리만 로딩한다', () => {
  for (const entry of readdirSync(join(ROOT, 'apps'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const file = join(ROOT, 'apps', slug, 'app.config.json');
    if (!existsSync(file)) continue;
    const cfg = loadConfig(ROOT, slug);
    assertLocalizedConfig(cfg, slug);
  }
});

// ── pbxproj 앵커 ────────────────────────────────────────────────────────────
// 실기기 회귀: .lproj 를 "파일에서 첫 PBXResourcesBuildPhase" 에 넣었더니 알림 확장(.appex)에
// 붙어 App.app 에는 번역이 없었다. 빌드는 성공해서 xcodebuild 로 번들을 열기 전엔 안 보였다.
const PBX_FIXTURE = [
  '/* Begin PBXResourcesBuildPhase section */',
  // 확장 타깃의 Resources 페이즈가 파일에서 **먼저** 나온다 (실제 생성 결과와 같은 순서)
  '\t\tFC00000000000000000C0009 /* Resources */ = {',
  '\t\t\tisa = PBXResourcesBuildPhase;',
  '\t\t\tfiles = (',
  '\t\t\t);',
  '\t\t};',
  '\t\t504EC3021FED79650016851F /* Resources */ = {',
  '\t\t\tisa = PBXResourcesBuildPhase;',
  '\t\t\tfiles = (',
  '\t\t\t\t504EC3121FED79650016851F /* LaunchScreen.storyboard in Resources */,',
  '\t\t\t);',
  '\t\t};',
  '/* End PBXResourcesBuildPhase section */',
  '/* Begin PBXNativeTarget section */',
  '\t\tFC00000000000000000C0010 /* NotificationService */ = {',
  '\t\t\tisa = PBXNativeTarget;',
  '\t\t\tbuildPhases = (',
  '\t\t\t\tFC00000000000000000C0009 /* Resources */,',
  '\t\t\t);',
  '\t\t\tproductType = "com.apple.product-type.app-extension";',
  '\t\t};',
  '\t\t504EC2FB1FED79650016851F /* App */ = {',
  '\t\t\tisa = PBXNativeTarget;',
  '\t\t\tbuildPhases = (',
  '\t\t\t\t504EC3021FED79650016851F /* Resources */,',
  '\t\t\t);',
  '\t\t\tproductType = "com.apple.product-type.application";',
  '\t\t};',
  '/* End PBXNativeTarget section */',
].join('\n');

test('리소스는 확장이 아니라 App 타깃 빌드 페이즈에 등록된다', () => {
  const at = appResourcesFilesAnchor(PBX_FIXTURE);
  assert.notEqual(at, -1, 'App 타깃의 Resources 페이즈를 찾아야 한다');
  const patched = PBX_FIXTURE.slice(0, at) + '\n\t\t\t\tXX /* InfoPlist.strings in Resources */,' + PBX_FIXTURE.slice(at);
  const appPhase = patched.slice(patched.indexOf('504EC3021FED79650016851F /* Resources */ = {'));
  const extPhase = patched.slice(patched.indexOf('FC00000000000000000C0009 /* Resources */ = {'),
    patched.indexOf('504EC3021FED79650016851F /* Resources */ = {'));
  assert.match(appPhase, /InfoPlist.strings in Resources/, 'App 타깃에 들어가야 한다');
  assert.doesNotMatch(extPhase, /InfoPlist.strings in Resources/, '알림 확장(.appex)에 들어가면 안 된다');
});

test('App 타깃이 없으면 -1 (앵커 못 찾음 → 생성기가 경고하고 멈춘다)', () => {
  assert.equal(appResourcesFilesAnchor('/* 빈 프로젝트 */'), -1);
});

// 회귀: 참조 줄을 VariantGroup 블록보다 먼저 지우면 그룹의 여는 줄만 날아가고 본문이 고아로
// 남아 pbxproj 가 깨진다(실제로 냈던 버그). strip 은 항상 "블록 먼저".
const PBX_WIRED = [
  '/* Begin PBXBuildFile section */',
  '\t\tFC000000000000000000C0FE /* InfoPlist.strings in Resources */ = {isa = PBXBuildFile; fileRef = FC000000000000000000C0FF /* InfoPlist.strings */; };',
  '\t\tAA000000000000000000AA01 /* Assets.xcassets in Resources */ = {isa = PBXBuildFile; fileRef = AA000000000000000000AA02 /* Assets.xcassets */; };',
  '/* End PBXBuildFile section */',
  '/* Begin PBXFileReference section */',
  '\t\tFC000000000000000000C001 /* en */ = {isa = PBXFileReference; lastKnownFileType = text.plist.strings; name = "en"; path = "en.lproj/InfoPlist.strings"; sourceTree = "<group>"; };',
  '\t\tAA000000000000000000AA02 /* Assets.xcassets */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; };',
  '/* End PBXFileReference section */',
  '\t\t504EC3061FED79650016851F /* App */ = {',
  '\t\t\tisa = PBXGroup;',
  '\t\t\tchildren = (',
  '\t\t\t\tFC000000000000000000C0FF /* InfoPlist.strings */,',
  '\t\t\t\tAA000000000000000000AA02 /* Assets.xcassets */,',
  '\t\t\t);',
  '\t\t};',
  '/* Begin PBXVariantGroup section */',
  '\t\tFC000000000000000000C0FF /* InfoPlist.strings */ = {',
  '\t\t\tisa = PBXVariantGroup;',
  '\t\t\tchildren = (',
  '\t\t\t\tFC000000000000000000C001 /* en */,',
  '\t\t\t);',
  '\t\t\tname = InfoPlist.strings;',
  '\t\t\tsourceTree = "<group>";',
  '\t\t};',
  '\t\t504EC30B1FED79650016851F /* Main.storyboard */ = {',
  '\t\t\tisa = PBXVariantGroup;',
  '\t\t\tchildren = (',
  '\t\t\t\t504EC30C1FED79650016851F /* Base */,',
  '\t\t\t);',
  '\t\t\tname = Main.storyboard;',
  '\t\t\tsourceTree = "<group>";',
  '\t\t};',
  '/* End PBXVariantGroup section */',
].join('\n');

test('stripLprojRefs 는 우리 배선만 걷어내고 고아 블록을 남기지 않는다', () => {
  const out = stripLprojRefs(PBX_WIRED);
  assert.doesNotMatch(out, /InfoPlist\.strings/, '우리 배선은 흔적 없이 사라져야 한다');
  // 고아 검출: VariantGroup 선언은 반드시 "<ID> /* 이름 */ = {" 바로 다음 줄이어야 한다
  for (const line of out.split('\n').entries()) {
    const [i, l] = line;
    if (l.includes('isa = PBXVariantGroup;')) {
      assert.match(out.split('\n')[i - 1], /\/\* [^*]+\*\/ = \{$/, `고아 블록 발견 (line ${i})`);
    }
  }
  // 남의 것은 그대로
  assert.match(out, /Main\.storyboard/);
  assert.match(out, /Assets\.xcassets in Resources/);
  assert.equal((out.match(/isa = PBXVariantGroup/g) || []).length, 1);
});

test('stripLprojRefs 는 멱등이다 (배선이 없어도 안전)', () => {
  const once = stripLprojRefs(PBX_WIRED);
  assert.equal(stripLprojRefs(once), once);
});

test('knownRegions 재작성 — 남의 항목 보존, 우리 코드 교체, en 은 항상 유지', () => {
  const src = '\t\t\tknownRegions = (\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t\t"ja",\n\t\t\t\t"th",\n\t\t\t);';
  const drop = Object.values(LOCALES).map((v) => v.ios);
  // 로케일 축소(ko 만)
  const shrunk = rewriteKnownRegions(src, { drop, add: ['ko'], ensure: ['en'] });
  assert.match(shrunk, /"ko"/);
  assert.match(shrunk, /"Base"/, 'Base 는 우리 것이 아니라 남겨야 한다');
  assert.match(shrunk, /"en"/, 'en 은 템플릿 기본값이라 항상 남는다');
  assert.doesNotMatch(shrunk, /"ja"|"th"/, '지운 로케일은 남으면 안 된다');
  // 로케일 비활성(전부 제거)
  const off = rewriteKnownRegions(src, { drop, ensure: ['en'] });
  assert.doesNotMatch(off, /"ja"|"th"|"ko"/);
  assert.match(off, /"en"/);
  assert.match(off, /"Base"/);
});
