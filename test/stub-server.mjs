// BE 없이 하네스 로그인 경로를 실측하기 위한 고정 응답 서버.
// 실행: node test/stub-server.mjs [포트]
// 기본 8787. sessionEndpoint 를 http://<맥IP>:8787/auth/social/native 로 두고 앱을 띄운다.
//
// ★ 이 파일은 `npm test` 에서 실행되지 않는다. package.json 의 test 스크립트가
//   `node --test test/*.test.mjs` 로 대상을 한정하기 때문이다 — `node --test test/`
//   였다면 아래 listen() 이 테스트 중에 포트를 잡아 러너가 끝나지 않는다.
import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || 8787);

// 시나리오를 쿼리로 고른다: ?case=signup (기본) | ?case=existing
const BODIES = {
  signup:   { signupRequired: true, signupToken: 'dummy-signup-token' },
  existing: { user: { id: 1, nickname: '테스터' }, token: 'dummy-session-token' },
};

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const body = BODIES[url.searchParams.get('case') || 'signup'];
    console.log(`\n← ${req.method} ${url.pathname}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        console.log('  받은 필드:', Object.keys(parsed).join(', '));
        console.log('  authorizationCode:', parsed.authorizationCode ? '있음' : '없음');
        console.log('  codeVerifier    :', parsed.codeVerifier ? '있음' : '없음');
        console.log('  deviceId        :', parsed.deviceId ? '있음' : '없음');
      } catch { console.log('  (JSON 아님)', raw.slice(0, 200)); }
    }
    console.log('→ 응답:', JSON.stringify(body));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end(JSON.stringify(body));
  });
}).listen(PORT, () => {
  console.log(`스텁 서버 http://0.0.0.0:${PORT}`);
  console.log('  기본 시나리오: signupRequired:true + signupToken');
  console.log('  기존 회원으로 보려면 sessionEndpoint 뒤에 ?case=existing 을 붙인다');
});
