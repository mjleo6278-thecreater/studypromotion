/* 스터디 프로모션 AI 도우미 서버 (Cloudflare Worker)
 *
 * 하는 일: 로그인 확인 → 하루 횟수 세기 → Workers AI 모델에 묻기 → 답을 조금씩 앱으로 보내기
 * 비밀 키가 없다. 모델은 env.AI(Workers AI 연결)로 부르고, 로그인은 구글이 공개한 열쇠로 확인한다.
 *
 * 앱과 주고받는 약속 (앱 쪽은 js/ai.js)
 *   POST /chat   Authorization: Bearer <Firebase 로그인 확인표>   { "messages": [{ role, content }] }
 *   답(조금씩):  data: {"t":"글 조각"} ... data: {"left":19} 또는 data: {"unlimited":true} ... data: [DONE]
 *   못 할 때:    { "error": "login" | "limit" | "closed" | "bad" | "server", "scope": "all" }
 *                limit + scope "all" = 앱 전체의 하루 무료 양을 다 씀. closed = 아직 이 사람에게 열지 않음
 *   GET /me      (로그인 확인표는 있어도 되고 없어도 된다) AI 버튼을 보여 줄지 앱이 묻는 곳
 *   답:          { "open": true|false, "signedIn": true|false, "unlimited": true|false, "left": 19, "limit": 20 }
 *
 * 설정 (wrangler.toml의 [vars]. OWNER_EMAILS만 Cloudflare 화면에서 비밀 값으로)
 *   FIREBASE_PROJECT_ID  로그인 확인에 쓰는 Firebase 프로젝트
 *   DAILY_LIMIT          한 사람이 하루에 쓸 수 있는 횟수. 0시 UTC(한국 오전 9시)에 다시 채운다
 *   MODEL, MAX_TOKENS    Workers AI 모델 이름, 답의 최대 길이
 *   ALLOWED_ORIGINS      앱 주소 (쉼표로 여러 개)
 *   OPEN_TO              "all"이면 로그인한 모든 사람, 그 밖의 값이면 주인 계정만 쓸 수 있다 (먼저 써 보기)
 *   OWNER_EMAILS         횟수 제한이 없는 구글 계정 이메일 (쉼표로 여러 개). 공개 저장소에 적지 않는다
 */
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const MAX_MESSAGES = 16;   // 지시문 1 + 지난 대화 + 이번 질문
const MAX_CHARS = 24000;   // 한 번에 받는 글의 길이 (지시문 포함)
const ROLES = ['system', 'user', 'assistant'];

/* ---------- 로그인 확인 (Firebase 로그인 확인표 = RS256 JWT) ---------- */
function bytes64(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const json64 = (s) => JSON.parse(new TextDecoder().decode(bytes64(s)));

// 구글이 공개한 열쇠. 구글이 알려 준 시간만큼만 기억해 둔다
let keyCache = { until: 0, keys: null };
export function forgetKeys() { keyCache = { until: 0, keys: null }; }
async function googleKeys(fetcher, now, fresh) {
  if (!fresh && keyCache.keys && now < keyCache.until) return keyCache.keys;
  const res = await fetcher(JWKS_URL);
  if (!res.ok) throw new Error('keys ' + res.status);
  const body = await res.json();
  const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  keyCache = { until: now + (age ? +age[1] : 3600) * 1000, keys: Array.isArray(body.keys) ? body.keys : [] };
  return keyCache.keys;
}

// 확인표가 진짜면 그 안의 정보(sub = 사용자 번호, email 등)를, 아니면 null을 돌려준다
export async function verifyToken(token, projectId, opts) {
  opts = opts || {};
  const now = opts.now || Date.now(), fetcher = opts.fetch || fetch;
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !projectId) return null;
  let head, body;
  try { head = json64(parts[0]); body = json64(parts[1]); } catch (e) { return null; }
  if (!head || head.alg !== 'RS256' || !head.kid || !body) return null;
  let jwk = (await googleKeys(fetcher, now, false)).find((k) => k.kid === head.kid);
  if (!jwk) jwk = (await googleKeys(fetcher, now, true)).find((k) => k.kid === head.kid); // 구글이 열쇠를 바꾼 직후
  if (!jwk) return null;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes64(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch (e) { return null; }
  if (!ok) return null;
  const t = Math.floor(now / 1000), slack = 60;
  if (!(body.exp > t) || !(body.iat <= t + slack) || (body.auth_time != null && !(body.auth_time <= t + slack))) return null;
  if (body.aud !== projectId || body.iss !== 'https://securetoken.google.com/' + projectId) return null;
  if (typeof body.sub !== 'string' || !body.sub || body.sub.length > 128) return null;
  return body;
}

// 횟수 제한이 없는 계정: 구글로 로그인했고(이메일을 구글이 확인함) 이메일이 OWNER_EMAILS에 있다
export function isOwner(user, env) {
  const list = String((env && env.OWNER_EMAILS) || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const email = String((user && user.email) || '').toLowerCase();
  const via = user && user.firebase && user.firebase.sign_in_provider;
  return !!email && user.email_verified === true && via === 'google.com' && list.includes(email);
}

/* ---------- 받은 말 검사 ---------- */
// 모양이 맞으면 깨끗한 사본을, 아니면 null
export function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || !ROLES.includes(m.role) || typeof m.content !== 'string' || !m.content.trim()) return null;
    if (m.role === 'system' && i !== 0) return null;
    total += m.content.length;
    out.push({ role: m.role, content: m.content });
  }
  if (total > MAX_CHARS || out[out.length - 1].role !== 'user') return null;
  return out;
}

/* ---------- 하루 횟수 (사람마다 하나씩 있는 작은 저장소) ---------- */
export class Counter {
  constructor(state) { this.state = state; }
  // { op: 'take' | 'refund' | 'peek', day: '2026-11-14', limit } → { ok, left }
  async fetch(request) {
    const { op, day, limit } = await request.json();
    const st = this.state.storage, key = 'n:' + day;
    const n = (await st.get(key)) || 0;
    if (op === 'peek') return Response.json({ ok: true, left: Math.max(0, limit - n) }); // 세지 않고 남은 횟수만
    if (op === 'refund') {
      if (n > 0) await st.put(key, n - 1);
      return Response.json({ ok: true, left: Math.max(0, limit - Math.max(0, n - 1)) });
    }
    if (n >= limit) return Response.json({ ok: false, left: 0 });
    await st.put(key, n + 1);
    const old = [...(await st.list({ prefix: 'n:' })).keys()].filter((k) => k !== key); // 지난날 기록은 지운다
    if (old.length) await st.delete(old);
    return Response.json({ ok: true, left: limit - n - 1 });
  }
}

/* ---------- 모델의 답 읽기 ---------- */
// 모델이 보내는 한 줄에서 글 조각만 꺼낸다 (모델에 따라 모양이 조금 다르다)
export function pieceOf(line) {
  if (!line.startsWith('data:')) return '';
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return '';
  let j;
  try { j = JSON.parse(data); } catch (e) { return ''; }
  if (typeof j.response === 'string') return j.response;
  const c = j.choices && j.choices[0];
  const t = c && ((c.delta && c.delta.content) || c.text);
  return typeof t === 'string' ? t : '';
}
// 앱 전체의 하루 무료 양을 다 썼을 때 Workers AI가 내는 오류인지
const usedUp = (e) => /4006|daily free allocation|neurons/i.test(String((e && e.message) || e));

/* ---------- 요청 처리 ---------- */
// deps: 테스트에서 시계(now)와 열쇠 받아 오기(fetch)를 바꿔 끼운다
export async function handle(request, env, deps, ctx) {
  deps = deps || {};
  const now = deps.now || Date.now();
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(/[\s,]+/).filter(Boolean);
  const cors = {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors) });
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, name: 'studypromotion-ai' }); // 주소가 살아 있는지 브라우저로 열어 볼 때
  const isMe = request.method === 'GET' && url.pathname === '/me';
  if (!isMe && (request.method !== 'POST' || url.pathname !== '/chat')) return json({ error: 'not_found' }, 404);
  if (origin && allowed.length && !allowed.includes(origin)) return json({ error: 'origin' }, 403);
  const everyone = String(env.OPEN_TO || '').trim().toLowerCase() === 'all'; // 아니면 주인 계정만
  const auth = request.headers.get('Authorization') || '';
  if (isMe && !auth) return json({ open: everyone, signedIn: false }); // 로그인 전: 버튼을 보여 줄지만 알려 준다

  // 1) 로그인 확인
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth);
  let user = null;
  try { user = bearer ? await verifyToken(bearer[1], env.FIREBASE_PROJECT_ID, { now, fetch: deps.fetch }) : null; }
  catch (e) { return json({ error: 'server' }, 503); } // 구글의 열쇠를 받아 오지 못함
  if (!user) return json({ error: 'login' }, 401);

  // 2) 쓸 수 있는 사람인지: 주인 계정은 언제나, 다른 사람은 OPEN_TO가 "all"일 때만
  const owner = isOwner(user, env);
  const parsed = parseInt(env.DAILY_LIMIT, 10);
  const limit = Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
  const day = new Date(now).toISOString().slice(0, 10);
  const counter = owner ? null : env.COUNTER.get(env.COUNTER.idFromName(user.sub));
  const count = async (op) => (await counter.fetch('https://counter/', { method: 'POST', body: JSON.stringify({ op, day, limit }) })).json();
  if (isMe) {
    if (owner) return json({ open: true, signedIn: true, unlimited: true });
    if (!everyone) return json({ open: false, signedIn: true });
    return json({ open: true, signedIn: true, unlimited: false, left: (await count('peek')).left, limit });
  }
  if (!owner && !everyone) return json({ error: 'closed' }, 403);

  // 3) 받은 말 검사
  let body = null;
  try { body = await request.json(); } catch (e) { /* 아래에서 거절 */ }
  const messages = cleanMessages(body && body.messages);
  if (!messages) return json({ error: 'bad' }, 400);

  // 4) 하루 횟수: 주인 계정은 세지 않는다
  let left = null;
  if (counter) {
    const r = await count('take');
    if (!r.ok) return json({ error: 'limit' }, 429);
    left = r.left;
  }
  const refund = async () => { if (!counter) return; try { left = (await count('refund')).left; } catch (e) { /* 못 돌려줘도 답은 보낸다 */ } };

  // 5) 모델에 묻기
  const maxTokens = parseInt(env.MAX_TOKENS, 10) || 1200;
  let answer;
  try { answer = await env.AI.run(env.MODEL || DEFAULT_MODEL, { messages, stream: true, max_tokens: maxTokens }); }
  catch (e) {
    await refund(); // 답을 못 받았으니 횟수를 돌려준다
    return usedUp(e) ? json({ error: 'limit', scope: 'all' }, 429) : json({ error: 'server' }, 503);
  }

  // 6) 답을 조금씩 앱으로
  const enc = new TextEncoder(), dec = new TextDecoder();
  const pipe = new TransformStream(), w = pipe.writable.getWriter();
  const send = (obj) => w.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n'));
  const pump = (async () => {
    let got = 0;
    try {
      if (answer && typeof answer.getReader === 'function') {
        const reader = answer.getReader();
        let buf = '';
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          buf += typeof part.value === 'string' ? part.value : dec.decode(part.value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const t = pieceOf(buf.slice(0, i).trim());
            buf = buf.slice(i + 1);
            if (t) { got += t.length; await send({ t }); }
          }
        }
        const t = pieceOf(buf.trim());
        if (t) { got += t.length; await send({ t }); }
      } else if (answer && typeof answer.response === 'string' && answer.response) { // 한꺼번에 답하는 모델
        got = answer.response.length;
        await send({ t: answer.response });
      }
      if (!got) { await refund(); await send({ error: 'server' }); }
      else {
        await send(owner ? { unlimited: true } : { left });
        await w.write(enc.encode('data: [DONE]\n\n'));
      }
    } catch (e) {
      if (!got) await refund();
      try { await send({ error: usedUp(e) ? 'limit' : 'server', scope: usedUp(e) ? 'all' : undefined }); } catch (err) { /* 앱이 이미 끊음 */ }
    } finally {
      try { await w.close(); } catch (e) { /* 이미 닫힘 */ }
    }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(pump);
  return new Response(pipe.readable, { headers: Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }, cors) });
}

export default {
  fetch(request, env, ctx) { return handle(request, env, null, ctx); },
};
