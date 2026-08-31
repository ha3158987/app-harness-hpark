// pbxproj.mjs — Xcode 프로젝트 파일에서 앵커를 찾는 헬퍼.
// 정규식으로 pbxproj 를 다루는 건 즐겁지 않지만, Xcode 없이(리눅스 CI 포함) 결정론적으로
// 프로젝트를 패치하려면 이 방법뿐이다. 앵커 판정이 틀리면 **빌드는 성공하는데 결과물만 다르다** —
// 그래서 이 파일의 함수들은 테스트로 고정한다(test/i18n.test.mjs).

/**
 * App(application) 타깃의 Resources 빌드 페이즈 `files = (` 바로 뒤 위치를 돌려준다.
 * 타깃이 여럿(App + 알림 확장)일 때 어느 번들에 리소스가 들어가는지를 가르는 자리라, 섹션 순서에
 * 기대지 않고 productType 으로 App 타깃을 특정한 뒤 그 buildPhases 안에서 찾는다. 못 찾으면 -1.
 */
export function appResourcesFilesAnchor(txt) {
  for (const m of txt.matchAll(/[0-9A-F]{24} \/\* [^*]*\*\/ = \{\n\t\t\tisa = PBXNativeTarget;[\s\S]*?\n\t\t\};/g)) {
    if (!/productType = "com\.apple\.product-type\.application"/.test(m[0])) continue;
    const phases = (m[0].match(/buildPhases = \(([\s\S]*?)\);/) || [, ''])[1].match(/[0-9A-F]{24}/g) || [];
    for (const id of phases) {
      const sec = new RegExp(`\\n\\t\\t${id} \\/\\* [^*]*\\*\\/ = \\{\\n\\t\\t\\tisa = PBXResourcesBuildPhase;[\\s\\S]*?files = \\(`);
      const hit = sec.exec(txt);
      if (hit) return hit.index + hit[0].length;
    }
  }
  return -1;
}

/**
 * 하네스가 넣은 InfoPlist.strings 배선을 전부 걷어낸다(재구성 전 단계).
 * 로케일 목록이 바뀌어도 결과가 항상 supported 와 일치하게 만드는 유일한 방법이다 —
 * "없으면 추가"만 하면 지운 로케일이 영원히 남고, 추가한 로케일은 반영되지 않는다.
 *
 * **하네스가 만든 항목만** 지운다: ID 가 HARNESS_ID_RE(고정 접두어)인 것들. 다른 타깃이 자기
 * InfoPlist.strings 를 갖고 있어도 건드리지 않는다.
 *
 * ⚠️ **순서가 중요하다.** 참조 줄(`… /* InfoPlist.strings *\/,`)을 먼저 지우면 VariantGroup 의
 * 여는 줄까지 같이 날아가 본문이 고아로 남아 pbxproj 가 깨진다(실제로 한 번 냈다). 블록 먼저.
 */
const HARNESS_ID = 'FC0{18}C0[0-9A-F]{2}';
export function stripLprojRefs(txt) {
  return txt
    // 1) PBXVariantGroup 블록 통째 (반드시 먼저)
    .replace(new RegExp(`^\\t+${HARNESS_ID} \\/\\* InfoPlist\\.strings \\*\\/ = \\{\\n\\t+isa = PBXVariantGroup;[\\s\\S]*?\\n\\t+\\};\\n`, 'gm'), '')
    // 2) PBXBuildFile 정의 줄
    .replace(new RegExp(`^\\t+${HARNESS_ID} \\/\\* InfoPlist\\.strings in Resources \\*\\/ = \\{isa = PBXBuildFile;[^\\n]*\\n`, 'gm'), '')
    // 3) PBXFileReference — <code>.lproj/InfoPlist.strings 를 가리키는 것만
    .replace(new RegExp(`^\\t+${HARNESS_ID} \\/\\* [^*]*\\*\\/ = \\{isa = PBXFileReference;[^\\n]*\\.lproj\\/InfoPlist\\.strings[^\\n]*\\n`, 'gm'), '')
    // 4) files 목록·group children 안의 참조 줄(끝이 쉼표인 줄만)
    .replace(new RegExp(`^\\t+${HARNESS_ID} \\/\\* InfoPlist\\.strings( in Resources)? \\*\\/,\\n`, 'gm'), '');
}

/**
 * knownRegions 를 재작성한다. 남의 항목(Base 등)은 보존한다.
 *   drop   : 걷어낼 코드(우리가 관리하는 로케일 전체)
 *   add    : 새로 넣을 코드(현재 supported)
 *   ensure : 무슨 일이 있어도 남길 코드. en 이 여기 온다 — Capacitor 템플릿의 기본값이자
 *            CFBundleDevelopmentRegion 이라, 로케일을 껐다고 같이 지우면 원본보다 나빠진다.
 */
export function rewriteKnownRegions(txt, { drop = [], add = [], ensure = [] } = {}) {
  const dropSet = new Set(drop);
  return txt.replace(/knownRegions = \(\n([\s\S]*?)\n(\t+)\);/, (m, body, ind) => {
    const kept = body.split('\n').map((l) => l.trim().replace(/^"|",$|,$|"$/g, '').trim())
      .filter((v) => v && !dropSet.has(v));
    const list = [...new Set([...kept, ...add])];
    for (const c of ensure) if (!list.includes(c)) list.unshift(c);
    return `knownRegions = (\n${list.map((c) => `${ind}\t"${c}",`).join('\n')}\n${ind});`;
  });
}
