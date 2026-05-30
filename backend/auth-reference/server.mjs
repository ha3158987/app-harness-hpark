// 하네스 인증 백엔드 — 레퍼런스 구현 (중앙 IdP / Keycloak)
//
// 하네스 브릿지(AppBridge.login)가 보내는 자격증명을 받아:
//   1) 중앙 IdP(Keycloak) 토큰 엔드포인트에 authorization code 교환 (이 앱 클라이언트 secret 사용)
//   2) IdP 가 준 id_token(JWT) 을 IdP 공개키(JWKS)로 검증
//   3) 내부 계정 find-or-create → 신규면 온보딩 유도, 기존이면 세션쿠키 발급
//   4) 약관/추가정보 가입 확정(/auth/signup), 로그아웃(/auth/logout)
//
// ⚠️ 학습/참고용이다. 사용자/세션을 인메모리 Map 으로 둔다 → 실제로는 DB/세션스토어로 교체.
//    secret/쿠키키는 환경변수로. (AUTH.md 규약과 1:1 대응)
//
// 실행: cp .env.example .env && 값 채우기 && npm i && npm start

import express from 'express';
import cookieParser from 'cookie-parser';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

const {
  PORT = '8787',
  IDP_ISSUER,                 // 예: https://auth.aipia.co.kr/realms/aipia
  IDP_CLIENT_ID,              // 백엔드 교환용 confidential client (예: aipia-app-backend)
  IDP_CLIENT_SECRET,          // ↑ 의 secret (레포 금지)
  SESSION_SECRET = 'dev-only-change-me',
  COOKIE_DOMAIN = '.aipia.co.kr',
  COOKIE_SECURE = 'true',
} = process.env;

if (!IDP_ISSUER || !IDP_CLIENT_ID || !IDP_CLIENT_SECRET) {
  console.warn('[warn] IDP_ISSUER / IDP_CLIENT_ID / IDP_CLIENT_SECRET 미설정 — .env 를 채우세요.');
}

// IdP 공개키 셋(JWKS) — id_token 검증용. issuer 의 표준 경로.
const JWKS = IDP_ISSUER ? createRemoteJWKSet(new URL(`${IDP_ISSUER}/protocol/openid-connect/certs`)) : null;
const sessionKey = new TextEncoder().encode(SESSION_SECRET);

// ── 인메모리 저장소 (→ 실제로는 DB) ─────────────────────────────────────────
const users = new Map();      // userId -> { id, sub, email, name, nickname, birth, consents, createdAt }
const pending = new Map();     // pendingId -> { sub, email, name }  (신규 가입 대기)
const sessions = new Map();    // sessionId -> { userId, deviceId, platform, createdAt }
let seq = 1;
const findBySub = (sub) => [...users.values()].find((u) => u.sub === sub);

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

// IdP 토큰 엔드포인트에 authorization code 교환 → { id_token, access_token }
async function exchangeCode({ code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: IDP_CLIENT_ID,
    client_secret: IDP_CLIENT_SECRET,
    code_verifier: codeVerifier,
  });
  const res = await fetch(`${IDP_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// id_token 검증 → 페이로드(클레임). 위조/만료/issuer 불일치를 막는다.
async function verifyIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: IDP_ISSUER,
    audience: IDP_CLIENT_ID,
  });
  return payload; // { sub, email, name, ... }
}

// 세션쿠키 발급(여기선 서명 JWT). 운영에선 세션스토어 id 도 무방.
async function setSession(res, userId, meta = {}) {
  const sessionId = `s_${seq++}`;
  sessions.set(sessionId, { userId, ...meta, createdAt: Date.now() });
  const token = await new SignJWT({ uid: userId, sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60d')
    .sign(sessionKey);
  res.cookie('aipia_session', token, {
    domain: COOKIE_DOMAIN,            // .aipia.co.kr → *.aipia.co.kr 공유 = (서브도메인) SSO
    httpOnly: true,
    secure: COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 60 * 24 * 60 * 60 * 1000,
  });
  return token;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, nickname: u.nickname };
}

// ── 앱 ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cookieParser());

// CORS: 패밀리 웹 origin 만 허용 + 쿠키 포함
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /(^https:\/\/([a-z0-9-]+\.)*aipia\.co\.kr$)|(^http:\/\/localhost(:\d+)?$)/.test(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 1) 소셜 인증 자격증명 → 세션 (AUTH.md §3-1)
app.post('/auth/native', async (req, res) => {
  try {
    const { authorizationCode, codeVerifier, redirectUri, deviceId, platform } = req.body || {};
    if (!authorizationCode || !redirectUri) return res.status(400).json({ error: 'missing-code' });

    // IdP 와 교환 + id_token 검증 (IdP 모드: 공급자별 교환 불필요 — IdP 한 곳만)
    const tok = await exchangeCode({ code: authorizationCode, codeVerifier, redirectUri });
    const claims = await verifyIdToken(tok.id_token);
    const sub = claims.sub;
    const email = claims.email || null;
    const name = claims.name || claims.preferred_username || null;

    let user = findBySub(sub);
    if (!user) {
      // 신규 → 가입 대기 등록 후 온보딩 유도(세션쿠키는 아직 발급 안 함)
      const pendingId = `p_${seq++}`;
      pending.set(pendingId, { sub, email, name });
      res.cookie('aipia_pending', pendingId, {
        httpOnly: true, secure: COOKIE_SECURE === 'true', sameSite: 'lax', maxAge: 10 * 60 * 1000,
      });
      return res.json({ isNew: true, needsProfile: true, prefill: { email, name } });
    }

    // 기존 회원 → 세션 발급
    const token = await setSession(res, user.id, { deviceId, platform });
    return res.json({ user: publicUser(user), token });
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'auth-failed', detail: String(e.message || e) });
  }
});

// 2) 약관 동의 + 추가정보 → 가입 확정 (AUTH.md §3-4)
app.post('/auth/signup', async (req, res) => {
  try {
    const pendingId = req.cookies?.aipia_pending;
    const p = pendingId && pending.get(pendingId);
    if (!p) return res.status(400).json({ error: 'no-pending-signup' });

    const { nickname, birth, consents = {}, deviceId, platform } = req.body || {};
    // 한국 법상 필수 동의 검증
    if (!consents.tos || !consents.privacy || !consents.age14) {
      return res.status(400).json({ error: 'required-consents-missing' });
    }
    const user = {
      id: `u_${seq++}`, sub: p.sub, email: p.email, name: p.name,
      nickname: nickname || null, birth: birth || null,
      consents, createdAt: Date.now(),
    };
    users.set(user.id, user);
    pending.delete(pendingId);
    res.clearCookie('aipia_pending');

    const token = await setSession(res, user.id, { deviceId, platform });
    return res.json({ user: publicUser(user), token });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'signup-failed' });
  }
});

// 3) 로그아웃
app.post('/auth/logout', (req, res) => {
  try {
    // (선택) 세션 무효화: 쿠키의 sid 를 sessions 에서 제거하면 원격 로그아웃도 가능
    res.clearCookie('aipia_session', { domain: COOKIE_DOMAIN });
    return res.json({ ok: true });
  } catch {
    return res.json({ ok: true });
  }
});

// 현재 로그인 사용자 확인(웹이 부팅 시 호출)
app.get('/auth/me', async (req, res) => {
  try {
    const raw = req.cookies?.aipia_session;
    if (!raw) return res.status(401).json({ error: 'no-session' });
    const { payload } = await jwtVerify(raw, sessionKey);
    const user = users.get(payload.uid);
    if (!user || !sessions.has(payload.sid)) return res.status(401).json({ error: 'invalid-session' });
    return res.json({ user: publicUser(user) });
  } catch {
    return res.status(401).json({ error: 'invalid-session' });
  }
});

app.listen(Number(PORT), () => console.log(`auth-reference on :${PORT} (issuer=${IDP_ISSUER || 'unset'})`));
