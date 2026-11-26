/* 스터디 프로모션 AI 도우미 서버 (Cloudflare Worker)
 *
 * 하는 일: 로그인 확인 → 하루 횟수 세기 → Workers AI 모델에 묻기 → 답을 조금씩 앱으로 보내기
 * 비밀 키가 없다. 모델은 env.AI(Workers AI 연결)로 부르고, 로그인은 구글이 공개한 열쇠로 확인한다.
 *
 * 앱과 주고받는 약속 (앱 쪽은 js/ai.js)
 *   POST /chat   Authorization: Bearer <Firebase 로그인 확인표>   { "messages": [{ role, content }], "v": 2 }
 *                사진(v4.4): 마지막 사용자 말의 content를 배열로 보낼 수 있다
 *                  [{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }, { "type": "text", "text": "질문" }]
 *                사진은 한 장, 앱이 줄여서 보낸다. 서버는 모델에 넘기기만 하고 어디에도 저장하지 않는다. 사진 질문도 한 번으로 센다
 *   답 (v 2):    Workers AI가 보내는 줄을 손대지 않고 그대로 넘긴다(data: {"response":"글 조각"} ... data: [DONE]).
 *                남은 횟수는 머리말로: X-AI-Left: 19 또는 X-AI-Unlimited: 1
 *                (서버가 조각마다 읽고 다시 쓰면 무료 요금제의 요청당 계산 시간 10ms를 넘겨 답이 중간에 끊길 수 있다)
 *   답 (v 없음): 예전 앱용. data: {"t":"글 조각"} ... data: {"left":19} 또는 data: {"unlimited":true} ... data: [DONE]
 *   못 할 때:    { "error": "login" | "limit" | "closed" | "photo" | "bad" | "server", "scope": "all", "detail": "주인 계정에만: 모델이 낸 오류 글" }
 *                limit + scope "all" = 앱 전체의 하루 무료 양을 다 씀. closed = 아직 이 사람에게 열지 않음. photo = 사진 보내기를 아직 이 사람에게 열지 않음
 *   GET /me      (로그인 확인표는 있어도 되고 없어도 된다) AI 버튼을 보여 줄지 앱이 묻는 곳
 *   답:          { "open": true|false, "signedIn": true|false, "unlimited": true|false, "left": 49, "limit": 50, "photo": true|false }
 *                photo = 사진 단추를 보여 줄지 (로그인한 사람에게만 알려 준다)
 *
 * 이스터에그 게임 '벽 튕기기'의 전체 순위 (앱 쪽은 js/bounce.js). AI 도우미 설정(OPEN_TO, 하루 횟수)과 상관없다
 *   GET  /bounce  (로그인 확인표는 있어도 되고 없어도 된다)
 *   POST /bounce  Authorization: Bearer <확인표>  { s 점수, g 골, sec 버틴 초, name 별명(처음 올릴 때) }
 *                 별명만 바꾸기: { name, rename: true }   주인 계정만: { remove: 줄 번호 }
 *   답:           { ok, top: [{ rank, n 별명, s, g, sec, t, me?, id?(주인에게만) }], total, me: { rank, n, s, g, sec, t } | null, owner, better? }
 *   못 할 때:     { error: "login" | "name"(처음이라 별명이 필요) | "badname" | "bad" | "owner" | "server" }
 *   한 사람에 한 줄(그 사람의 최고 기록)만 남긴다. 사람을 가리키는 번호는 Firebase 사용자 번호를 SHA-256으로 바꾼 것이고, 이메일·이름은 받지 않는다
 *
 * 그룹 스터디 (v4.0, 앱 쪽은 js/group.js, 서버 쪽 처리는 worker/src/group.js). AI 도우미 설정(OPEN_TO, 하루 횟수)과 상관없다
 *   GET  /group   Authorization: Bearer <확인표>   내 별명과 내가 든 그룹들 (그룹마다 사람들의 별명·날별 공부 시간·공부 중 표시·목표·응원)
 *   POST /group   Authorization: Bearer <확인표>   { op: 'sync' | 'name' | 'create' | 'peek' | 'join' | 'leave' | 'cheer' | 'room' | ... , ... }
 *   못 할 때:     { error: "login" | "name"(별명이 필요) | "badname" | "gname" | "code"(없는 초대 코드) | "full" | "many" | "banned" | "lead"(리더만) | "nogroup" | "wait" | "slow" | "bad" | "server" }
 *                 채팅(v4.1~): "chatoff" | "fast" | "daymax" | "gone", 붙인 것(v4.3): "big" | "photoday" | "photogroup" | "deckday" | "deckgroup" | "space"
 *   본문은 16KB까지. 사진·단어장을 붙인 say만 1.6MB까지 받는다
 *   사람은 Firebase 사용자 번호를 SHA-256으로 바꾼 값('group:' + 번호, 벽 튕기기와 다른 값)으로만 가리킨다. 이메일·이름은 받지 않는다
 *
 * 말로 복습: 같은 뜻인지 묻기 (v4.5.1, 앱 쪽은 js/voice.js). 카드 뜻과 글자가 달라 앱이 틀렸다고 볼 때만 묻는다
 *   POST /judge  Authorization: Bearer <확인표>   { q: 문제 낱말, a: 카드의 뜻, said: [음성 인식이 적은 글 1~3개] }
 *   답:          { ok: true|false, left: 299 } 또는 { ok, unlimited: true }. 세컨드 하루 횟수와 따로 센다(JUDGE_LIMIT)
 *   못 할 때:    { error: "login" | "closed" | "bad" | "limit" | "server", scope?: "all" }
 *   말한 글은 모델에 넘기기만 하고 어디에도 저장하지 않는다
 *
 * 설정 (wrangler.toml의 [vars]. OWNER_EMAILS만 Cloudflare 화면에서 비밀 값으로)
 *   FIREBASE_PROJECT_ID  로그인 확인에 쓰는 Firebase 프로젝트
 *   DAILY_LIMIT          한 사람이 하루에 쓸 수 있는 횟수. 0시 UTC(한국 오전 9시)에 다시 채운다
 *   JUDGE_LIMIT          말로 복습 '같은 뜻인지 묻기'의 한 사람 하루 횟수 (없으면 300)
 *   MODEL, MAX_TOKENS    Workers AI 모델 이름, 답의 최대 길이
 *   THINKING             "on"이면 모델이 답하기 전에 속으로 생각하게 둔다. 기본은 끔: 켜 두면 보이지 않는 생각에
 *                        답 길이(MAX_TOKENS)를 다 써서 한참 기다린 뒤 답이 잘리거나 빈 채로 온다
 *   ALLOWED_ORIGINS      앱 주소 (쉼표로 여러 개)
 *   OPEN_TO              "all"이면 로그인한 모든 사람, 그 밖의 값이면 주인 계정만 쓸 수 있다 (먼저 써 보기)
 *   PHOTO_TO             사진 보내기. "all"이면 AI를 쓸 수 있는 모든 사람, 그 밖의 값이면 주인 계정만 (먼저 써 보기)
 *   OWNER_EMAILS         횟수 제한이 없는 구글 계정 이메일 (쉼표로 여러 개). 공개 저장소에 적지 않는다
 */
import { groupOp, GROUP_STORE, OPS as GROUP_OPS } from './group.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const MAX_MESSAGES = 16;   // 지시문 1 + 지난 대화 + 이번 질문
const MAX_CHARS = 24000;   // 한 번에 받는 글의 길이 (지시문 포함, 사진은 빼고 센다)
const MAX_IMAGE = 1500000; // 사진 한 장의 길이 (base64 글자 수, 약 1.1MB). 앱은 긴 변 1280픽셀 JPEG로 줄여 보내서 보통 0.2~0.5MB
const PHOTO_EXTRA_TOKENS = 1500; // 사진 질문에 더 주는 답 길이
const IMAGE_HEAD = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]/;
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
// 사진이 붙은 말(마지막 사용자 말만): [{ type: 'image_url', image_url: { url } }, { type: 'text', text }]. 사진 한 장 + 글. 맞으면 깨끗한 사본, 아니면 null
function cleanParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 2) return null;
  let text = '', image = null;
  for (const p of parts) {
    if (!p || typeof p !== 'object') return null;
    if (p.type === 'text' && typeof p.text === 'string' && !text) text = p.text;
    else if (p.type === 'image_url' && p.image_url && typeof p.image_url.url === 'string' && !image) image = p.image_url.url;
    else return null;
  }
  // 글자 하나하나를 보지 않고 앞머리와 길이만 본다: 무료 요금제는 요청마다 계산 시간이 짧다. 틀린 사진은 모델이 거절한다
  if (!image || image.length > MAX_IMAGE || !IMAGE_HEAD.test(image.slice(0, 40))) return null;
  const out = [{ type: 'image_url', image_url: { url: image } }];
  if (text.trim()) out.push({ type: 'text', text });
  return out;
}
// 말 하나의 글 (사진이 붙은 말이면 글 부분만)
export const textOf = (content) => (typeof content === 'string' ? content : ((content || []).find((p) => p.type === 'text') || {}).text || '');
// 사진이 붙은 말이 있는지
export const hasImage = (list) => (list || []).some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
// 모양이 맞으면 깨끗한 사본을, 아니면 null
export function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_MESSAGES) return null;
  let total = 0;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m || !ROLES.includes(m.role)) return null;
    let content = m.content;
    if (Array.isArray(content)) {
      if (m.role !== 'user' || i !== list.length - 1) return null; // 사진은 이번 질문에만
      content = cleanParts(content);
      if (!content) return null;
    } else if (typeof content !== 'string' || !content.trim()) return null;
    if (m.role === 'system' && i !== 0) return null;
    total += textOf(content).length;
    out.push({ role: m.role, content });
  }
  if (total > MAX_CHARS || out[out.length - 1].role !== 'user') return null;
  return out;
}

/* ---------- 하루 횟수 (사람마다 하나씩 있는 작은 저장소) ---------- */
const AGAIN_MS = 2 * 60 * 1000; // 다시 묻기를 세지 않는 시간
// 질문의 짧은 지문: 같은 질문을 다시 묻는지만 알면 되므로 글은 남기지 않는다
export async function fingerprint(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || ''))));
  return [...d.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export class Counter {
  constructor(state) { this.state = state; }
  // { op: 'take' | 'refund' | 'peek', day: '2026-11-14', limit, q, at, again } → { ok, left, free }
  //  q: 질문의 짧은 지문(글 자체는 받지 않는다), at: 지금 시각, again: 앱이 '앱 정보를 붙여 같은 질문을 다시 묻는' 것
  async fetch(request) {
    const msg = await request.json();
    if (String(msg.op).startsWith('board')) return Response.json(await boardOp(this.state.storage, msg)); // 벽 튕기기 순위 저장소 (아래)
    if (String(msg.op).startsWith('group-')) { // 그룹 스터디 저장소 (group.js). 못 하면 400(서버 문제면 503)
      const r = await groupOp(this.state.storage, msg);
      return Response.json(r, { status: r && r.error ? (r.error === 'server' ? 503 : 400) : 200 });
    }
    const { op, day, limit, q, at, again } = msg;
    const st = this.state.storage, key = 'n:' + day;
    const n = (await st.get(key)) || 0;
    if (op === 'peek') return Response.json({ ok: true, left: Math.max(0, limit - n) }); // 세지 않고 남은 횟수만
    if (op === 'refund') {
      await st.delete('last');
      if (n > 0) await st.put(key, n - 1);
      return Response.json({ ok: true, left: Math.max(0, limit - Math.max(0, n - 1)) });
    }
    // 방금 센 질문을 앱 정보와 함께 한 번 더 묻는 것은 한 번만 세지 않는다 (AI가 '앱 정보가 필요하다'고 답했을 때)
    if (again && q) {
      const last = await st.get('last');
      if (last && last.q === q && last.day === day && at - last.at >= 0 && at - last.at < AGAIN_MS) {
        await st.delete('last');
        return Response.json({ ok: true, left: Math.max(0, limit - n), free: true });
      }
    }
    if (n >= limit) return Response.json({ ok: false, left: 0 });
    await st.put(key, n + 1);
    if (q) await st.put('last', { q, day, at });
    const old = [...(await st.list({ prefix: 'n:' })).keys()].filter((k) => k !== key); // 지난날 기록은 지운다
    if (old.length) await st.delete(old);
    return Response.json({ ok: true, left: limit - n - 1 });
  }
}

/* ---------- 벽 튕기기 전체 순위 ---------- */
// 순위는 하나뿐인 작은 저장소(사람별 횟수 저장소와 같은 종류, 이름만 다름)에 목록 하나로 둔다. Firebase 사용자 번호에는 ':'가 없어 이름이 겹치지 않는다
export const BOARD_STORE = 'bounce:board';
export const BOARD_TOP = 20;   // 앱에 보여 주는 줄 수
export const BOARD_KEEP = 500; // 남겨 두는 사람 수 (한 사람에 한 줄)
const NAME_MAX = 12;
// 별명: 빈칸은 하나로, 한글·영어·숫자·빈칸·_·-만, 1~12글자. 아니면 null (주소나 이상한 글자를 막는다)
export function cleanName(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  if (!n || n > NAME_MAX || !/^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _-]+$/.test(s)) return null;
  return s;
}
// sec초 동안 낼 수 있는 점수의 넉넉한 끝: 막대와 천장 사이를 한 번 오갈 때 많아야 2점(치기 1 + 골 1),
// 공은 아주 낮은 화면(높이 200px)에서도 처음엔 1초에 1.2번쯤밖에 못 오가고, 1초마다 처음 빠르기의 1.2%씩 빨라진다(js/bounce.js SPEED_PER_SEC).
// 그렇게 낼 수 있는 2.4 × (sec + 0.006 sec²)점보다 넉넉하게 잡는다
export const maxScore = (sec) => Math.floor(10 + 4 * sec * (1 + 0.006 * sec));
// 받은 기록이 말이 되면 { s, g, sec }, 아니면 null. 골은 많아야 (점수+1)/2 (첫 공은 치지 않고 바로 골에 들어갈 수 있다)
export function cleanScore(b) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!b || !int(b.s, 1, 1000000) || !int(b.g, 0, 1000000) || !int(b.sec, 1, 86400)) return null;
  if (2 * b.g > b.s + 1 || b.s > maxScore(b.sec)) return null;
  return { s: b.s, g: b.g, sec: b.sec };
}
// 높은 점수 먼저, 같으면 먼저 낸 사람 먼저
const byScore = (a, b) => b.s - a.s || a.t - b.t;
// 앱에 보낼 모양: 위 BOARD_TOP줄 + 내 줄. 다른 사람의 번호(id)는 주인 계정에게만 보낸다 (지우기 단추)
export function boardView(list, id, owner) {
  const i = id ? list.findIndex((e) => e.id === id) : -1;
  const row = (e, k) => Object.assign({ rank: k + 1, n: e.n, s: e.s, g: e.g, sec: e.sec, t: e.t }, e.id === id ? { me: true } : null, owner ? { id: e.id } : null);
  return { ok: true, top: list.slice(0, BOARD_TOP).map(row), total: list.length, me: i >= 0 ? row(list[i], i) : null, owner: !!owner };
}
// msg: { op: 'board-get' | 'board-put' | 'board-remove', id, owner, at, name, score, rename, target }
export async function boardOp(st, msg) {
  let list = (await st.get('board')) || [];
  const { id, owner, at } = msg;
  let changed = false, better = false;
  if (msg.op === 'board-put' && id) {
    const e = list.find((x) => x.id === id);
    if (!e && msg.score && !msg.name) return { error: 'name' }; // 처음 올리는 사람은 별명이 있어야 한다
    if (e && msg.name && msg.rename && e.n !== msg.name) { e.n = msg.name; changed = true; }
    if (msg.score) {
      if (!e) { list.push(Object.assign({ id, n: msg.name, t: at }, msg.score)); changed = better = true; }
      else if (msg.score.s > e.s) { Object.assign(e, msg.score, { t: at }); changed = better = true; }
    }
    if (changed) { list.sort(byScore); list = list.slice(0, BOARD_KEEP); }
  } else if (msg.op === 'board-remove' && owner && msg.target) {
    const n = list.length;
    list = list.filter((x) => x.id !== msg.target);
    changed = list.length !== n;
  }
  if (changed) await st.put('board', list);
  return Object.assign(boardView(list, id, owner), msg.op === 'board-put' ? { better } : null);
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

/* ---------- 벽 튕기기 순위 요청 ---------- */
async function bounce(request, env, deps, now, json) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  const post = request.method === 'POST';
  let user = null;
  if (bearer) {
    try { user = await verifyToken(bearer[1], env.FIREBASE_PROJECT_ID, { now, fetch: deps.fetch }); }
    catch (e) { if (post) return json({ error: 'server' }, 503); } // 보기만 할 때는 로그인 없이 보여 준다
  }
  if (post && !user) return json({ error: 'login' }, 401);
  const id = user ? await fingerprint('bounce:' + user.sub) : null;
  const owner = !!user && isOwner(user, env);
  const store = env.COUNTER.get(env.COUNTER.idFromName(BOARD_STORE));
  const call = async (msg) => (await store.fetch('https://board/', { method: 'POST', body: JSON.stringify(Object.assign({ id, owner, at: now }, msg)) })).json();
  if (!post) return json(Object.assign({ signedIn: !!user }, await call({ op: 'board-get' })));

  let body = null;
  try { body = await request.json(); } catch (e) { /* 아래에서 거절 */ }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad' }, 400);
  if (body.remove != null) {
    if (!owner) return json({ error: 'owner' }, 403);
    return json(Object.assign({ signedIn: true }, await call({ op: 'board-remove', target: String(body.remove).slice(0, 64) })));
  }
  const name = body.name == null || body.name === '' ? null : cleanName(body.name);
  if (body.name != null && body.name !== '' && !name) return json({ error: 'badname' }, 400);
  const score = body.s == null ? null : cleanScore(body);
  if (body.s != null && !score) return json({ error: 'bad' }, 400);
  if (!score && !(name && body.rename === true)) return json({ error: 'bad' }, 400);
  const r = await call({ op: 'board-put', name, score, rename: body.rename === true });
  if (r.error) return json(r, 400);
  return json(Object.assign({ signedIn: true }, r));
}

/* ---------- 그룹 스터디 요청 ---------- */
const GROUP_BODY_MAX = 16000;    // 앱이 보내는 본문은 많아야 1KB쯤
const GROUP_FILE_MAX = 1600000;  // 사진(원본 900KB + 작은 그림, base64)이나 단어장을 붙인 say (v4.3)
async function group(request, env, deps, now, json) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  let user = null;
  if (bearer) {
    try { user = await verifyToken(bearer[1], env.FIREBASE_PROJECT_ID, { now, fetch: deps.fetch }); }
    catch (e) { return json({ error: 'server' }, 503); } // 구글의 열쇠를 받아 오지 못함
  }
  if (!user) return json({ error: 'login' }, 401);
  let body = {}, raw = '{}';
  if (request.method === 'POST') {
    if (+(request.headers.get('Content-Length') || 0) > GROUP_FILE_MAX) return json({ error: 'big' }, 413);
    raw = '';
    try { raw = await request.text(); } catch (e) { /* 아래에서 거절 */ }
    if (!raw) return json({ error: 'bad' }, 400);
    if (raw.length > GROUP_FILE_MAX) return json({ error: 'big' }, 413);
    try { body = JSON.parse(raw); } catch (e) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad' }, 400);
    // 큰 본문은 사진·단어장을 붙인 메시지만
    if (raw.length > GROUP_BODY_MAX && !(body.op === 'say' && (body.p === 'img' || body.p === 'deck'))) return json({ error: 'bad' }, 400);
  }
  const op = request.method === 'GET' ? 'get' : String(body.op || '');
  if (!GROUP_OPS.includes(op)) return json({ error: 'bad' }, 400);
  const id = await fingerprint('group:' + user.sub); // 사람 번호: 이메일·이름 대신
  const store = env.COUNTER.get(env.COUNTER.idFromName(GROUP_STORE));
  // 받은 본문은 이미 읽어 본 JSON이라 그대로 이어 붙여 넘긴다 (사진처럼 긴 글을 다시 JSON으로 만드는 일을 줄인다)
  const msg = '{"op":' + JSON.stringify('group-' + op) + ',"id":' + JSON.stringify(id) + ',"at":' + JSON.stringify(now) + ',"b":' + raw + '}';
  let res;
  try { res = await store.fetch('https://group/', { method: 'POST', body: msg }); }
  catch (e) { console.error(JSON.stringify({ at: 'group', op, error: String((e && e.message) || e).slice(0, 200) })); return json({ error: 'server' }, 503); }
  if (res.status !== 200) { // 못 함: { error }
    let r = null;
    try { r = await res.json(); } catch (e) { /* 아래에서 */ }
    return json(r && r.error ? { error: r.error } : { error: 'server' }, r && r.error && r.error !== 'server' ? 400 : 503);
  }
  // 됨: 저장소의 답(사진이면 큰 글)을 다시 읽지 않고 그대로 보낸다
  const out = json({});
  return new Response(res.body, { status: 200, headers: out.headers });
}

/* ---------- 말로 복습: 같은 뜻인지 묻기 (/judge) ---------- */
export const JUDGE_MAX = { q: 200, a: 400, said: 120, n: 3 };
// 받은 것이 맞는 모양이면 { q, a, said: [..] }, 아니면 null
export function cleanJudge(b) {
  const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.replace(/\s+/g, ' ').trim() : null);
  if (!b || typeof b !== 'object') return null;
  const q = str(b.q, JUDGE_MAX.q), a = str(b.a, JUDGE_MAX.a);
  if (!Array.isArray(b.said) || !b.said.length || b.said.length > JUDGE_MAX.n) return null;
  const said = b.said.map((s) => str(s, JUDGE_MAX.said));
  if (!q || !a || said.some((s) => !s)) return null;
  return { q, a, said };
}
// 모델에게 줄 말. 같은 뜻(비슷한 말·풀어 말하기·끝말 다름·음성 인식의 작은 실수)은 YES, 다른 뜻·반대말·너무 넓은 말은 NO
export function judgeMessages(j) {
  const sys = 'You grade a spoken vocabulary quiz. The student saw a word and said its meaning out loud; speech recognition turned the speech into text and may have small errors. ' +
    'Decide whether what the student said means the same as the card answer. Any one of the listed meanings is enough. ' +
    'Answer YES for: a synonym, a paraphrase with the same meaning, a different ending, tense, part of speech or politeness level of the same meaning, ' +
    'or text that is clearly the right answer misheard by speech recognition. ' +
    'Answer NO for: a different meaning, the opposite meaning, a much broader or vaguer word, something only related to the meaning, or just repeating the quiz word. ' +
    'Reply with exactly one word: YES or NO.';
  const said = j.said.length > 1 ? j.said.map((s) => '"' + s + '"').join(' or ') + ' (speech recognition guesses)' : '"' + j.said[0] + '"';
  return [
    { role: 'system', content: sys },
    { role: 'user', content: 'Quiz word: ' + j.q + '\nCard answer: ' + j.a + '\nStudent said: ' + said + '\nSame meaning?' },
  ];
}
// 모델의 답에서 YES/NO만 읽는다. 못 읽으면 null
export function readVerdict(answer) {
  let t = '';
  if (answer && typeof answer.response === 'string') t = answer.response;
  else if (answer && answer.choices && answer.choices[0]) t = (answer.choices[0].message && answer.choices[0].message.content) || answer.choices[0].text || '';
  else if (typeof answer === 'string') t = answer;
  const m = /\b(yes|no)\b|(예|네|아니)/i.exec(String(t || ''));
  if (!m) return null;
  return m[1] ? m[1].toLowerCase() === 'yes' : m[2] !== '아니';
}
async function judge(request, env, deps, now, json) {
  const everyone = String(env.OPEN_TO || '').trim().toLowerCase() === 'all';
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  let user = null;
  try { user = bearer ? await verifyToken(bearer[1], env.FIREBASE_PROJECT_ID, { now, fetch: deps.fetch }) : null; }
  catch (e) { return json({ error: 'server' }, 503); }
  if (!user) return json({ error: 'login' }, 401);
  const owner = isOwner(user, env);
  if (!owner && !everyone) return json({ error: 'closed' }, 403);
  let body = null;
  try { body = await request.json(); } catch (e) { /* 아래에서 거절 */ }
  const j = cleanJudge(body);
  if (!j) return json({ error: 'bad' }, 400);
  // 하루 횟수: 세컨드와 다른 저장소('judge:' + 사용자 번호)에서 센다. 주인 계정은 세지 않는다
  const parsed = parseInt(env.JUDGE_LIMIT, 10);
  const limit = Number.isFinite(parsed) && parsed >= 0 ? parsed : 300;
  const day = new Date(now).toISOString().slice(0, 10);
  const counter = owner ? null : env.COUNTER.get(env.COUNTER.idFromName('judge:' + user.sub));
  const count = async (op) => (await counter.fetch('https://counter/', { method: 'POST', body: JSON.stringify({ op, day, limit }) })).json();
  let left = null;
  if (counter) {
    const r = await count('take');
    if (!r.ok) return json({ error: 'limit' }, 429);
    left = r.left;
  }
  const refund = async () => { if (counter) { try { left = (await count('refund')).left; } catch (e) { /* 그대로 */ } } };
  // 생각하기를 끄고 한 낱말만 받는다. 설정을 받지 않는 모델이면 덜어 내고 다시
  const model = env.MODEL || DEFAULT_MODEL;
  const base = { messages: judgeMessages(j), max_tokens: 6, temperature: 0 };
  let verdict = null, fail = null;
  for (const input of [Object.assign({}, base, { chat_template_kwargs: { enable_thinking: false } }), base]) {
    try { verdict = readVerdict(await env.AI.run(model, input)); fail = null; break; }
    catch (e) {
      fail = e;
      console.error(JSON.stringify({ at: 'judge', error: String((e && e.message) || e).slice(0, 300) })); // 말한 글은 적지 않는다
      if (usedUp(e)) break;
    }
  }
  if (fail || verdict === null) {
    await refund();
    if (fail && usedUp(fail)) return json({ error: 'limit', scope: 'all' }, 429);
    return json({ error: 'server' }, 503);
  }
  return json(owner ? { ok: verdict, unlimited: true } : { ok: verdict, left });
}

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
    'Access-Control-Expose-Headers': 'X-AI-Left, X-AI-Unlimited, X-AI-Mode',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const json = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors) });
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, name: 'studypromotion-ai' }); // 주소가 살아 있는지 브라우저로 열어 볼 때
  if (url.pathname === '/bounce' && (request.method === 'GET' || request.method === 'POST')) {
    if (origin && allowed.length && !allowed.includes(origin)) return json({ error: 'origin' }, 403);
    return bounce(request, env, deps, now, json);
  }
  if (url.pathname === '/group' && (request.method === 'GET' || request.method === 'POST')) {
    if (origin && allowed.length && !allowed.includes(origin)) return json({ error: 'origin' }, 403);
    return group(request, env, deps, now, json);
  }
  if (url.pathname === '/judge' && request.method === 'POST') {
    if (origin && allowed.length && !allowed.includes(origin)) return json({ error: 'origin' }, 403);
    return judge(request, env, deps, now, json);
  }
  const isMe = request.method === 'GET' && url.pathname === '/me';
  if (!isMe && (request.method !== 'POST' || url.pathname !== '/chat')) return json({ error: 'not_found' }, 404);
  if (origin && allowed.length && !allowed.includes(origin)) return json({ error: 'origin' }, 403);
  const everyone = String(env.OPEN_TO || '').trim().toLowerCase() === 'all'; // 아니면 주인 계정만
  const photoAll = String(env.PHOTO_TO || '').trim().toLowerCase() === 'all'; // 사진 보내기. 아니면 주인 계정만
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
  const limit = Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
  const day = new Date(now).toISOString().slice(0, 10);
  const counter = owner ? null : env.COUNTER.get(env.COUNTER.idFromName(user.sub));
  const count = async (op, more) => (await counter.fetch('https://counter/', { method: 'POST', body: JSON.stringify(Object.assign({ op, day, limit }, more)) })).json();
  if (isMe) {
    if (owner) return json({ open: true, signedIn: true, unlimited: true, photo: true });
    if (!everyone) return json({ open: false, signedIn: true });
    return json({ open: true, signedIn: true, unlimited: false, left: (await count('peek')).left, limit, photo: photoAll });
  }
  if (!owner && !everyone) return json({ error: 'closed' }, 403);

  // 3) 받은 말 검사
  let body = null;
  try { body = await request.json(); } catch (e) { /* 아래에서 거절 */ }
  const messages = cleanMessages(body && body.messages);
  if (!messages) return json({ error: 'bad' }, 400);
  const photo = hasImage(messages);
  if (photo && !owner && !photoAll) return json({ error: 'photo' }, 403);

  // 4) 하루 횟수: 주인 계정은 세지 않는다
  let left = null, free = false;
  if (counter) {
    const lastMsg = messages[messages.length - 1].content;
    const img = Array.isArray(lastMsg) ? lastMsg.find((p) => p.type === 'image_url') : null;
    const q = await fingerprint(textOf(lastMsg) + (img ? '\n[사진 ' + img.image_url.url.length + ']' : '')); // 사진은 길이만 지문에 섞는다
    const r = await count('take', { q, at: now, again: body.again === true });
    if (!r.ok) return json({ error: 'limit' }, 429);
    left = r.left;
    free = r.free === true;
  }
  const refund = async () => { if (!counter || free) return; try { left = (await count('refund')).left; } catch (e) { /* 못 돌려줘도 답은 보낸다 */ } };

  // 5) 모델에 묻기. 생각하기(reasoning)는 끈다: 이 모델은 기본으로 켜져 있고, 켜 두면 생각에 답 길이를 다 써 버린다
  // 사진 질문은 읽은 글(<read>)과 카드 후보(30장까지)를 함께 적으므로 답 길이를 넉넉히 준다 (쓴 만큼만 무료 양에서 빠진다)
  const maxTokens = (parseInt(env.MAX_TOKENS, 10) || 2000) + (photo ? PHOTO_EXTRA_TOKENS : 0);
  const model = env.MODEL || DEFAULT_MODEL;
  const plain = { messages, stream: true, max_tokens: maxTokens };
  const thinking = /^(on|1|true|yes)$/i.test(String(env.THINKING || '').trim());
  const mid = Object.assign({}, plain, { chat_template_kwargs: { enable_thinking: thinking } });
  const full = Object.assign({}, mid, {
    max_completion_tokens: maxTokens,
    stream_options: { include_usage: true }, // 마지막 줄에 쓴 양(usage)을 붙여 달라고 한다: 답이 잘렸을 때 까닭을 알 수 있다
  });
  const note = (e) => String((e && e.message) || e).slice(0, 300);
  // 모델이 덧붙인 설정을 받지 않으면 하나씩 덜어 내고 다시 묻는다. 생각하기 끄기(mid)는 되도록 남긴다: 켜지면 생각에 답 길이를 다 쓴다
  let answer, mode, fail = null;
  for (const [name, input] of [['full', full], ['mid', mid], ['plain', plain]]) {
    mode = name;
    try { answer = await env.AI.run(model, input); fail = null; break; }
    catch (e) {
      fail = e;
      console.error(JSON.stringify({ at: 'ai.run', mode, photo, error: note(e) })); // Cloudflare 화면의 기록(Logs)에서 볼 수 있다. 사용자의 말과 사진은 적지 않는다
      if (usedUp(e)) break;
    }
  }
  if (fail) {
    await refund(); // 답을 못 받았으니 횟수를 돌려준다
    if (usedUp(fail)) return json({ error: 'limit', scope: 'all' }, 429);
    return json(owner ? { error: 'server', detail: note(fail) } : { error: 'server' }, 503);
  }

  // 6) 답을 앱으로. 새 앱(v 2)에는 모델이 보내는 줄을 그대로 넘긴다: 서버가 계산할 것이 없어 길게 답해도 끊기지 않는다
  if (body.v === 2) {
    const head = Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' }, cors, { 'X-AI-Mode': mode }, owner ? { 'X-AI-Unlimited': '1' } : { 'X-AI-Left': String(left) });
    if (answer && typeof answer.getReader === 'function') return new Response(answer, { headers: head });
    if (answer && typeof answer.response === 'string' && answer.response) { // 한꺼번에 답하는 모델
      return new Response('data: ' + JSON.stringify({ response: answer.response }) + '\n\ndata: [DONE]\n\n', { headers: head });
    }
    await refund();
    console.error(JSON.stringify({ at: 'ai.run', error: 'empty answer' }));
    return json({ error: 'server' }, 503);
  }

  // 7) 예전 앱: 조각마다 읽어서 다시 적어 보낸다
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
