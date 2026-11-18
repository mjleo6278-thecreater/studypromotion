/* 그룹 스터디 서버 (v3.11): 친구끼리 그룹을 만들어 공부 시간을 나눠 보고, 목표를 같이 정하고, 함께 집중한다.
 * 앱 쪽은 js/group.js. 입구는 worker/src/index.js의 /group (로그인 확인 → 사람 번호를 만들어 → 이 파일의 groupOp)
 *
 * 저장: 모든 그룹을 작은 저장소(Durable Object) 하나에 둔다. AI 하루 횟수·벽 튕기기 순위와 같은 Counter 종류이고 이름만 'group:hub'
 *   (Firebase 사용자 번호에는 ':'가 없어 사람별 저장소와 이름이 겹치지 않는다). 한 저장소라 요청이 한 줄로 처리되어 서로 엉키지 않는다.
 *   'u:<사람>'  { n 별명, gs [그룹 번호], d { 'YYYY-MM-DD': 분 } 최근 약 2주, lv 공부 중 | null, up 마지막으로 받은 시각, tr { day, n } 틀린 초대 코드 횟수 }
 *   'g:<그룹>'  { id, name, code 초대 코드, lead 리더, at 만든 시각, goal { day 1인당 하루 목표(분), week 다 같이 한 주 목표(분) },
 *                ms [{ id, at 들어온 시각 }] 들어온 차례, ban [내보낸 사람], ch [{ f 보낸 사람, t 받은 사람, e 응원 종류, at }],
 *                room 함께 집중 { by 시작한 사람, at, end 끝나는 시각, ms [같이 하는 사람] } | null }
 *   'c:<초대 코드>'  그룹 번호
 *   'n'  지금 있는 그룹 수 (무료 저장 공간을 지키는 상한에 쓴다)
 *
 * 개인정보: 사람은 Firebase 사용자 번호를 SHA-256으로 바꾼 값의 앞 16자로만 가리킨다(index.js가 만든다).
 *   이메일·구글 이름은 받지도 남기지도 않는다. 다른 사람에게 보이는 것은 별명, 날마다 공부한 분, 공부 중 표시(과목 이름은 본인이 고르면)뿐이다.
 *   그룹을 모두 나가면 그 사람의 공부 시간·공부 중 표시를 지운다.
 *
 * 앱이 보내는 것 (POST /group  { op, ... },  GET /group = op 'get')
 *   get                                     내 별명과 내가 든 그룹들
 *   sync   { d, lv, dv }                    내 최근 날별 공부 시간(분)과 공부 중 표시(재는 기기 dv)
 *   name   { n }                            별명 정하기·바꾸기 (모든 그룹에 같은 별명)
 *   create { name, goal, n? }               그룹 만들기 (만든 사람이 리더)
 *   peek   { code }                         초대 코드로 그룹 이름·인원 미리 보기
 *   join   { code, n? }                     초대 코드로 들어가기
 *   leave  { g }                            나가기 (리더가 나가면 가장 먼저 들어온 사람이 이어받고, 마지막 사람이 나가면 그룹이 없어진다)
 *   cheer  { g, m, e }                      응원 보내기 (같은 사람에게는 10분에 한 번)
 *   room   { g, min }  room-join { g }  room-leave { g }   함께 집중 시작·같이 하기·그만하기
 *   리더만: edit { g, name?, goal? }  code { g } 새 초대 코드  kick { g, m } 내보내기  lead { g, m } 리더 넘기기  unban { g }  drop { g } 그룹 없애기
 * 답: { ok, me: { id, n }, groups: [그룹 보기], lim, ...(made | joined | left | dropped | sent) }  못 할 때: { error }
 */
export const GROUP_STORE = 'group:hub';
export const LIMITS = Object.freeze({ members: 20, groups: 5, all: 3000, cheers: 40, tries: 30, ban: 50 });
export const CHEER_KINDS = 4;              // 응원 종류 수 (앱의 js/group.js CHEERS와 같다)
export const CHEER_GAP = 10 * 60 * 1000;   // 같은 사람에게 다시 응원하려면 기다리는 시간
export const ROOM_MIN = Object.freeze([10, 180]); // 함께 집중 길이(분)
export const OPS = ['get', 'sync', 'name', 'create', 'peek', 'join', 'leave', 'cheer', 'room', 'room-join', 'room-leave', 'edit', 'code', 'kick', 'lead', 'unban', 'drop'];

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 헷갈리는 0·O·1·I·L은 뺀다
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/;
const ID_RE = /^[0-9a-f]{16}$/;  // 사람 번호
const GID_RE = /^[0-9a-z]{10}$/; // 그룹 번호
const NICK_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _-]+$/;
const GNAME_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _\-·.,!?&()#+~]+$/;
const LIVE_KINDS = ['sw', 'focus', 'lock']; // 스톱워치 · 집중 타이머 · 폰 잠금 모드
const KEEP_DAYS = 17;                       // 날별 공부 시간을 남기는 날 수 (이번 주와 지난주를 보려면 14일, 날짜 경계 여유)

/* ---------- 받은 값 검사 (모양이 맞으면 깨끗한 값, 아니면 null) ---------- */
const tidy = (v) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : '');
const len = (s) => [...s].length;
// 별명: 한글·영어·숫자·빈칸·_·-만 1~12자 (벽 튕기기 순위의 별명과 같은 규칙)
export function cleanNick(v) { const s = tidy(v); return s && len(s) <= 12 && NICK_RE.test(s) ? s : null; }
// 그룹 이름: 별명 글자에 · . , ! ? & ( ) # + ~ 를 더해 1~20자
export function cleanGroupName(v) { const s = tidy(v); return s && len(s) <= 20 && GNAME_RE.test(s) ? s : null; }
// 초대 코드: 대문자 6자. 소문자·빈칸·'-'은 받아 준다
export function cleanCode(v) {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? s : null;
}
// 목표: { day: 1인당 하루 0~1440분, week: 다 같이 한 주 0~60000분(1000시간) }. 0이면 목표 없음
export function cleanGoal(g) {
  if (g == null) return { day: 0, week: 0 };
  if (typeof g !== 'object' || Array.isArray(g)) return null;
  const int = (v, hi) => (v == null ? 0 : Number.isInteger(v) && v >= 0 && v <= hi ? v : -1);
  const day = int(g.day, 1440), week = int(g.week, 60000);
  return day < 0 || week < 0 ? null : { day, week };
}
// 과목 이름(공부 중 표시에 붙는다): 보이지 않는 글자·줄바꿈을 빼고 20자까지
export function cleanSubject(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, 20).join('') : null;
}
const utcKey = (t) => new Date(t).toISOString().slice(0, 10);
// 날별 공부 시간 { 'YYYY-MM-DD': 0~1440 정수 }. 모양이 틀리면 null, 너무 오래되었거나 먼 날은 버린다(기기 시계가 틀린 경우)
export function cleanDays(d, now) {
  if (d == null) return {};
  if (typeof d !== 'object' || Array.isArray(d)) return null;
  const keys = Object.keys(d);
  if (keys.length > 40) return null;
  const lo = utcKey(now - KEEP_DAYS * DAY), hi = utcKey(now + 2 * DAY);
  const out = {};
  for (const k of keys) {
    const v = d[k];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Number.isInteger(v) || v < 0 || v > 1440) return null;
    if (k >= lo && k <= hi && v > 0) out[k] = v;
  }
  return out;
}
// 공부 중 표시 { k 무엇으로 재는지, at 시작, end 끝나는 시각(타이머·잠금), s 과목 이름 }. 이상하거나 이미 끝난 것은 null (공부 중 아님)
export function cleanLive(lv, now) {
  if (!lv || typeof lv !== 'object' || Array.isArray(lv) || !LIVE_KINDS.includes(lv.k)) return null;
  if (!Number.isInteger(lv.at) || lv.at > now + MIN) return null;
  const out = { k: lv.k, at: lv.at };
  if (lv.end != null) {
    if (!Number.isInteger(lv.end) || lv.end <= lv.at || lv.end - lv.at > 12 * HOUR) return null;
    out.end = lv.end;
  }
  const s = cleanSubject(lv.s);
  if (s) out.s = s;
  return liveOn(out, now) ? out : null;
}
// 지금도 공부 중인가: 끝나는 시각이 있으면 그 전까지, 스톱워치는 시작한 지 16시간까지 (켜 둔 채 잊은 스톱워치)
export function liveOn(lv, now) {
  return !!lv && lv.at <= now + MIN && (lv.end ? lv.end > now : now - lv.at < 16 * HOUR);
}
const publicLive = (lv) => Object.assign({ k: lv.k, at: lv.at }, lv.end ? { end: lv.end } : null, lv.s ? { s: lv.s } : null);
// 남겨 둘 날만 (오래 앱을 안 연 사람의 지난 기록이 계속 오가지 않게)
function recentDays(d, now) {
  const lo = utcKey(now - KEEP_DAYS * DAY), out = {};
  for (const k in d || {}) if (k >= lo) out[k] = d[k];
  return out;
}

// 고르게 뽑은 글자 n개 (치우침이 없게 남는 값은 버린다)
function randomText(abc, n) {
  const cut = 256 - (256 % abc.length);
  let s = '';
  while (s.length < n) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    for (const v of b) if (s.length < n && v < cut) s += abc[v % abc.length];
  }
  return s;
}
const newUser = () => ({ n: null, gs: [], d: {}, lv: null, up: 0 });

/* ---------- 요청 하나 처리 ----------
 * st: 저장소(get·put·delete), msg: { op, id 사람 번호, at 지금 시각, b 앱이 보낸 본문 }
 * 저장소만 기다리고 다른 곳(인터넷)을 기다리지 않으므로, 읽고 고쳐 쓰는 동안 다른 요청이 끼어들지 않는다
 */
export async function groupOp(st, msg) {
  const op = String((msg && msg.op) || '').replace(/^group-/, '');
  const id = String((msg && msg.id) || ''), now = msg && msg.at;
  const b = msg && msg.b && typeof msg.b === 'object' && !Array.isArray(msg.b) ? msg.b : {};
  if (!ID_RE.test(id) || !Number.isFinite(now) || !OPS.includes(op)) return { error: 'bad' };
  const today = utcKey(now);

  // 이번 요청에서 읽은 사람 기록 (같은 사람을 여러 번 읽지 않고, 고친 것이 바로 보이게)
  const users = new Map();
  const getU = async (x) => { if (!users.has(x)) users.set(x, (await st.get('u:' + x)) || null); return users.get(x); };
  const putU = async (x, u) => { users.set(x, u); await st.put('u:' + x, u); };

  async function view(g) {
    const ms = [];
    for (const m of g.ms) {
      const u = await getU(m.id);
      ms.push({ id: m.id, n: (u && u.n) || '?', at: m.at, d: recentDays(u && u.d, now), lv: u && liveOn(u.lv, now) ? publicLive(u.lv) : null, up: (u && u.up) || 0 });
    }
    const room = g.room && g.room.end > now ? { by: g.room.by, at: g.room.at, end: g.room.end, ms: g.room.ms.slice() } : null;
    const out = { id: g.id, name: g.name, code: g.code, lead: g.lead, at: g.at, goal: g.goal, ms, ch: (g.ch || []).filter((c) => now - c.at < 7 * DAY), room };
    if (g.lead === id) out.ban = (g.ban || []).length; // 리더에게만: 내보낸 사람 수 (다시 받기 단추)
    return out;
  }
  // 내 별명과 그룹들. 없어진 그룹 번호가 남아 있으면 이참에 지운다
  async function state(extra) {
    const u = await getU(id);
    const groups = [], keep = [];
    for (const gid of (u && u.gs) || []) {
      const g = await st.get('g:' + gid);
      if (!g || !g.ms.some((m) => m.id === id)) continue;
      keep.push(gid);
      groups.push(await view(g));
    }
    if (u && keep.length !== u.gs.length) { u.gs = keep; await putU(id, u); }
    return Object.assign({ ok: true, me: { id, n: (u && u.n) || null }, groups, lim: { members: LIMITS.members, groups: LIMITS.groups } }, extra || null);
  }
  // 별명을 같이 보냈으면 정하고, 그래도 별명이 없으면 'name' (그룹에 들려면 별명이 있어야 한다)
  async function withNick() {
    const u = (await getU(id)) || newUser();
    if (b.n != null && b.n !== '') {
      const n = cleanNick(b.n);
      if (!n) return { error: 'badname' };
      u.n = n;
    }
    return u.n ? { u } : { error: 'name' };
  }
  async function freshCode() {
    for (let i = 0; i < 50; i++) { const c = randomText(CODE_CHARS, 6); if (!(await st.get('c:' + c))) return c; }
    throw new Error('code');
  }
  async function byCode(code) {
    const gid = await st.get('c:' + code);
    return gid ? (await st.get('g:' + gid)) || null : null;
  }
  // 틀린 초대 코드 횟수 (코드를 마구 넣어 남의 그룹을 찾지 못하게, 하루 30번)
  const tried = (u) => (u && u.tr && u.tr.day === today ? u.tr.n : 0);
  async function countTry(u) { u = u || newUser(); u.tr = { day: today, n: tried(u) + 1 }; await putU(id, u); }
  // 내가 든 그룹 (b.g)
  async function mine() {
    if (typeof b.g !== 'string' || !GID_RE.test(b.g)) return null;
    const g = await st.get('g:' + b.g);
    return g && g.ms.some((m) => m.id === id) ? g : null;
  }
  async function led() {
    const g = await mine();
    if (!g) return { error: 'nogroup' };
    return g.lead === id ? { g } : { error: 'lead' };
  }
  const isMember = (g, m) => typeof m === 'string' && g.ms.some((x) => x.id === m);
  // 그룹을 모두 나간 사람: 공부 시간·공부 중 표시를 지운다 (별명은 다음에 쓰도록 남긴다)
  const forget = (u) => { if (!u.gs.length) { u.d = {}; u.lv = null; } };
  async function dropGroup(g) {
    for (const m of g.ms) {
      const u = await getU(m.id);
      if (u) { u.gs = u.gs.filter((x) => x !== g.id); forget(u); await putU(m.id, u); }
    }
    await st.delete('g:' + g.id);
    if ((await st.get('c:' + g.code)) === g.id) await st.delete('c:' + g.code);
    await st.put('n', Math.max(0, ((await st.get('n')) || 1) - 1));
  }
  async function removeMember(g, who) {
    g.ms = g.ms.filter((m) => m.id !== who);
    const u = await getU(who);
    if (u) { u.gs = u.gs.filter((x) => x !== g.id); forget(u); await putU(who, u); }
    if (!g.ms.length) return dropGroup(g);
    if (g.lead === who) g.lead = g.ms[0].id; // 리더가 나가면 가장 먼저 들어온 사람이 이어받는다
    g.ch = (g.ch || []).filter((c) => c.f !== who && c.t !== who);
    if (g.room) { g.room.ms = g.room.ms.filter((x) => x !== who); if (!g.room.ms.length) g.room = null; }
    await st.put('g:' + g.id, g);
  }

  switch (op) {
    case 'get': return state();

    case 'sync': {
      const u = await getU(id);
      if (!u || !u.gs.length) return state(); // 그룹에 들지 않은 사람의 공부 시간은 받지 않는다
      const d = cleanDays(b.d, now);
      if (!d) return { error: 'bad' };
      const dv = typeof b.dv === 'string' && /^[0-9a-z]{1,16}$/.test(b.dv) ? b.dv : '';
      let lv = cleanLive(b.lv, now);
      if (lv && dv) lv.dv = dv;
      // 다른 기기가 재는 중인 공부 중 표시는 이 기기가 지우지 않는다 (재는 기기가 멈출 때 지운다)
      if (!lv && u.lv && liveOn(u.lv, now) && u.lv.dv && dv && u.lv.dv !== dv) lv = u.lv;
      u.d = d; u.lv = lv; u.up = now;
      await putU(id, u);
      return state();
    }

    case 'name': {
      const n = cleanNick(b.n);
      if (!n) return { error: 'badname' };
      const u = (await getU(id)) || newUser();
      u.n = n;
      await putU(id, u);
      return state();
    }

    case 'create': {
      const name = cleanGroupName(b.name);
      if (!name) return { error: 'gname' };
      const goal = cleanGoal(b.goal);
      if (!goal) return { error: 'bad' };
      const r = await withNick();
      if (r.error) return r;
      const u = r.u;
      if (u.gs.length >= LIMITS.groups) return { error: 'many' };
      const total = (await st.get('n')) || 0;
      if (total >= LIMITS.all) return { error: 'busy' };
      let gid = randomText(ID_CHARS, 10);
      while (await st.get('g:' + gid)) gid = randomText(ID_CHARS, 10);
      const code = await freshCode();
      const g = { id: gid, name, code, lead: id, at: now, goal, ms: [{ id, at: now }], ban: [], ch: [], room: null };
      u.gs.push(gid);
      await st.put('g:' + gid, g);
      await st.put('c:' + code, gid);
      await st.put('n', total + 1);
      await putU(id, u);
      return state({ made: gid });
    }

    case 'peek': {
      const code = cleanCode(b.code);
      if (!code) return { error: 'code' };
      const u = await getU(id);
      if (tried(u) >= LIMITS.tries) return { error: 'slow' };
      const g = await byCode(code);
      if (!g) { await countTry(u); return { error: 'code' }; }
      const lead = await getU(g.lead);
      return {
        ok: true, me: { id, n: (u && u.n) || null },
        peek: { id: g.id, name: g.name, count: g.ms.length, max: LIMITS.members, lead: (lead && lead.n) || null, goal: g.goal,
          member: g.ms.some((m) => m.id === id), banned: (g.ban || []).includes(id), full: g.ms.length >= LIMITS.members },
      };
    }

    case 'join': {
      const code = cleanCode(b.code);
      if (!code) return { error: 'code' };
      if (tried(await getU(id)) >= LIMITS.tries) return { error: 'slow' };
      const g = await byCode(code);
      if (!g) { await countTry(await getU(id)); return { error: 'code' }; }
      if (g.ms.some((m) => m.id === id)) return state({ joined: g.id }); // 이미 들어와 있음
      if ((g.ban || []).includes(id)) return { error: 'banned' };
      if (g.ms.length >= LIMITS.members) return { error: 'full' };
      const r = await withNick();
      if (r.error) return r;
      const u = r.u;
      if (u.gs.length >= LIMITS.groups) return { error: 'many' };
      g.ms.push({ id, at: now });
      u.gs.push(g.id);
      await st.put('g:' + g.id, g);
      await putU(id, u);
      return state({ joined: g.id });
    }

    case 'leave': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      await removeMember(g, id);
      return state({ left: g.id });
    }

    case 'cheer': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (b.m === id || !isMember(g, b.m) || !Number.isInteger(b.e) || b.e < 0 || b.e >= CHEER_KINDS) return { error: 'bad' };
      g.ch = (g.ch || []).filter((c) => now - c.at < 7 * DAY);
      if (g.ch.some((c) => c.f === id && c.t === b.m && now - c.at < CHEER_GAP)) return { error: 'wait' };
      g.ch.push({ f: id, t: b.m, e: b.e, at: now });
      g.ch = g.ch.slice(-LIMITS.cheers);
      await st.put('g:' + g.id, g);
      return state({ sent: true });
    }

    case 'room': { // 함께 집중 시작: 같은 시각에 끝나는 집중 타이머를 그룹 사람들이 같이 켠다
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (!Number.isInteger(b.min) || b.min < ROOM_MIN[0] || b.min > ROOM_MIN[1]) return { error: 'bad' };
      if (g.room && g.room.end > now) return { error: 'room' }; // 이미 하는 중: 앱은 '같이 하기'를 보여 준다
      g.room = { by: id, at: now, end: now + b.min * MIN, ms: [id] };
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'room-join': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (!g.room || g.room.end <= now) return { error: 'noroom' };
      if (!g.room.ms.includes(id)) { g.room.ms.push(id); await st.put('g:' + g.id, g); }
      return state();
    }
    case 'room-leave': {
      const g = await mine();
      if (!g) return { error: 'nogroup' };
      if (g.room && g.room.ms.includes(id)) {
        g.room.ms = g.room.ms.filter((x) => x !== id);
        if (!g.room.ms.length || g.room.end <= now) g.room = null;
        await st.put('g:' + g.id, g);
      }
      return state();
    }

    /* 리더만 */
    case 'edit': {
      const r = await led();
      if (r.error) return r;
      const g = r.g;
      if (b.name == null && b.goal == null) return { error: 'bad' };
      if (b.name != null) { const name = cleanGroupName(b.name); if (!name) return { error: 'gname' }; g.name = name; }
      if (b.goal != null) { const goal = cleanGoal(b.goal); if (!goal) return { error: 'bad' }; g.goal = goal; }
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'code': { // 새 초대 코드: 예전 코드로는 더 못 들어온다
      const r = await led();
      if (r.error) return r;
      const g = r.g, code = await freshCode();
      if ((await st.get('c:' + g.code)) === g.id) await st.delete('c:' + g.code);
      g.code = code;
      await st.put('c:' + code, g.id);
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'kick': { // 내보내기: 같은 그룹에 다시 들어오지 못한다 (리더가 '다시 받기'를 누를 때까지)
      const r = await led();
      if (r.error) return r;
      const g = r.g;
      if (b.m === id || !isMember(g, b.m)) return { error: 'bad' };
      g.ban = (g.ban || []).filter((x) => x !== b.m).concat(b.m).slice(-LIMITS.ban);
      await removeMember(g, b.m);
      return state();
    }
    case 'lead': {
      const r = await led();
      if (r.error) return r;
      const g = r.g;
      if (b.m === id || !isMember(g, b.m)) return { error: 'bad' };
      g.lead = b.m;
      await st.put('g:' + g.id, g);
      return state();
    }
    case 'unban': {
      const r = await led();
      if (r.error) return r;
      r.g.ban = [];
      await st.put('g:' + r.g.id, r.g);
      return state();
    }
    case 'drop': {
      const r = await led();
      if (r.error) return r;
      await dropGroup(r.g);
      return state({ dropped: r.g.id });
    }
  }
  return { error: 'bad' };
}
