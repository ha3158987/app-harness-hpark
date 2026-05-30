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
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'no-session' });
  return res.json({ user: publicUser(u) });
});

// 세션쿠키 → 사용자
async function currentUser(req) {
  try {
    const raw = req.cookies?.aipia_session;
    if (!raw) return null;
    const { payload } = await jwtVerify(raw, sessionKey);
    if (!sessions.has(payload.sid)) return null;
    return users.get(payload.uid) || null;
  } catch { return null; }
}

// ── 회원탈퇴 / 계정삭제 (스토어 필수) ───────────────────────────────────────
app.post('/auth/delete', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'no-session' });
  users.delete(u.id);
  wallet.delete(u.id);
  for (const [sid, s] of sessions) if (s.userId === u.id) sessions.delete(sid);
  res.clearCookie('aipia_session', { domain: COOKIE_DOMAIN });
  return res.json({ ok: true });
});

// ── 인앱결제 검증 + 서버 지갑 ───────────────────────────────────────────────
// 서버 지갑(=진실). 앱 IAP/웹 PG 둘 다 같은 잔액에 적립. (→ 실제로는 DB + 트랜잭션)
const wallet = new Map();          // userId -> coin balance
const processedTx = new Set();      // 멱등: 처리한 거래ID
const PRODUCT_COINS = { coin_100: 100, coin_500: 550 }; // storeId/SKU -> 적립 코인 (→ 실제로는 config/DB)

function creditWallet(userId, coins, txId) {
  if (processedTx.has(txId)) return false; // 중복/리플레이 차단
  processedTx.add(txId);
  wallet.set(userId, (wallet.get(userId) || 0) + coins);
  return true;
}

// 지갑 잔액 조회
app.get('/wallet', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'no-session' });
  return res.json({ balance: wallet.get(u.id) || 0 });
});

// cordova-plugin-purchase 의 validator 가 영수증을 POST 한다.
// ⚠️ 스텁이다. 실제로는: (1) Apple App Store Server API / Google purchases.products 로 영수증 검증
//    (Google 은 acknowledge 필수, 3일 내), (2) productId→coins 적립(멱등), (3) 플러그인 validator
//    프로토콜에 맞는 응답 반환. 응답 포맷은 cordova-plugin-purchase 문서(Receipt Validator) 참고.
app.post('/iap/verify', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ ok: false, code: 6778001, message: 'no-session' });

  const body = req.body || {};
  // 플러그인이 보내는 형태는 스토어/버전에 따라 다름. 핵심 식별자만 방어적으로 추출(스텁).
  const productId = body.id || body.productId || body?.products?.[0]?.id;
  const txId = body.transactionId || body?.transaction?.id || `${productId}:${Date.now()}`;
  const platform = body.platform || body?.transaction?.type;

  // TODO(실구현): platform 별 영수증 검증
  //   - Apple: App Store Server API 로 JWS 거래 검증
  //   - Google: androidpublisher purchases.products.get + purchases.products.acknowledge
  const verified = true; // 스텁: 항상 통과(절대 운영 금지)

  if (!verified) return res.status(400).json({ ok: false, code: 6778003, message: 'invalid-receipt' });

  const coins = PRODUCT_COINS[productId] || 0;
  const credited = creditWallet(u.id, coins, txId);

  // 플러그인 validator 가 기대하는 성공 응답(요지). 정확한 스키마는 플러그인 문서 기준으로 맞출 것.
  return res.json({
    ok: true,
    data: {
      id: productId,
      latest_receipt: true,
      transaction: { id: txId, type: platform || 'test' },
      // 적립 결과를 앱이 참고하도록(선택)
      wallet: { balance: wallet.get(u.id) || 0, credited: credited ? coins : 0 },
    },
  });
});

// ── 환불/취소 웹훅 (코인 회수) — 스텁 ───────────────────────────────────────
// Apple App Store Server Notifications v2 / Google Real-time Developer Notifications(Pub/Sub).
// 실제로는 서명 검증 후 환불 거래의 사용자/코인을 찾아 차감. (consumable 도 환불 발생)
app.post('/webhooks/apple', (req, res) => { /* TODO: ASSN v2 서명검증 → 환불 시 차감 */ res.sendStatus(200); });
app.post('/webhooks/google', (req, res) => { /* TODO: RTDN Pub/Sub → 환불 시 차감 */ res.sendStatus(200); });

app.listen(Number(PORT), () => console.log(`auth-reference on :${PORT} (issuer=${IDP_ISSUER || 'unset'})`));
