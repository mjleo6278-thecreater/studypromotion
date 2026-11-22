/* 그룹 스터디 서버(worker/src/group.js, 입구는 worker/src/index.js의 /group) 테스트
 * 진짜 구글 열쇠 대신 여기서 만든 열쇠로 서명한 가짜 로그인 확인표를 쓰고, 저장소는 기억 속 가짜(진짜처럼 값을 복사해 둔다)를 쓴다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, Counter, forgetKeys } from '../worker/src/index.js';
import { groupOp, cleanNick, cleanGroupName, cleanCode, cleanGoal, cleanDays, cleanLive, cleanSubject, cleanMsg, liveOn, LIMITS, CHEER_GAP, GROUP_STORE, CHAT,
  ATTACH, b64Size, jpegSize, cleanCaption, cleanRecord, cleanDeck, altText } from '../worker/src/group.js';

const PROJECT = 'demo-project';
const ORIGIN = 'https://app.example';
const NOW = Date.UTC(2026, 10, 19, 3, 0, 0); // 2026-11-19 12:00 KST (목)
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const b64json = (o) => b64(Buffer.from(JSON.stringify(o)));
const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
const PUB = { kty: jwk.kty, n: jwk.n, e: jwk.e, kid: 'k1', alg: 'RS256', use: 'sig' };

async function token(sub, now) {
  const t = Math.floor((now || NOW) / 1000);
  const first = b64json({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + b64json({
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub, iat: t - 60, exp: t + 30 * 86400, auth_time: t - 600,
    email: sub + '@example.com', email_verified: true, name: 'Real ' + sub, firebase: { sign_in_provider: 'google.com' },
  });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(first));
  return first + '.' + b64(new Uint8Array(sig));
}

// 가짜 세상: 구글 열쇠 주소와 저장소. 저장소는 Durable Object처럼 값을 복사해서 넣고 꺼낸다
function world() {
  const w = { stores: new Map(), now: NOW, toks: {} };
  const fetchKeys = async () => new Response(JSON.stringify({ keys: [PUB] }), { headers: { 'cache-control': 'max-age=3600' } });
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  w.storage = (name) => {
    if (!w.stores.has(name)) w.stores.set(name, new Map());
    const m = w.stores.get(name);
    return {
      get: async (k) => clone(m.get(k)),
      put: async (k, v) => { m.set(k, clone(v)); },
      list: async (o) => new Map([...m].filter(([k]) => k.startsWith((o && o.prefix) || ''))),
      delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); },
    };
  };
  w.hub = () => w.stores.get(GROUP_STORE) || new Map();
  w.env = {
    FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN, OPEN_TO: 'all', DAILY_LIMIT: '20', OWNER_EMAILS: '',
    AI: { run: async () => { throw new Error('모델을 부르지 않는다'); } },
    COUNTER: { idFromName: (n) => n, get: (id) => ({ fetch: (url, init) => new Counter({ storage: w.storage(id) }).fetch(new Request(url, init)) }) },
  };
  // who: 사람 이름(로그인 번호), body가 없으면 GET
  w.call = async (who, body, o) => {
    o = o || {};
    const headers = { Origin: o.origin || ORIGIN };
    if (who) headers.Authorization = 'Bearer ' + (w.toks[who] || (w.toks[who] = await token(who)));
    if (body) headers['Content-Type'] = 'application/json';
    const req = new Request('https://ai.example/group', { method: body ? 'POST' : 'GET', headers, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const res = await handle(req, w.env, { now: w.now, fetch: fetchKeys });
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* 아래에서 */ }
    return { status: res.status, body: j, raw: text };
  };
  w.ok = async (who, body) => {
    const r = await w.call(who, body);
    assert.equal(r.status, 200, `${who} ${JSON.stringify(body)} → ${r.raw}`);
    assert.equal(r.body.ok, true);
    return r.body;
  };
  w.err = async (who, body, code) => {
    const r = await w.call(who, body);
    assert.equal(r.body && r.body.error, code, `${who} ${JSON.stringify(body)} → ${r.raw}`);
    assert.notEqual(r.status, 200);
    return r;
  };
  return w;
}
// 그룹을 하나 만들고 친구들을 들인다 → { g 그룹 보기(리더가 본 것), code }
async function party(w, names, goal) {
  const [lead, ...rest] = names;
  const made = await w.ok(lead, { op: 'create', name: '수학 스터디', n: lead.toUpperCase(), goal: goal || { day: 180, week: 2400 } });
  const g = made.groups.find((x) => x.id === made.made);
  for (const n of rest) await w.ok(n, { op: 'join', code: g.code, n: n.toUpperCase() });
  return { gid: g.id, code: g.code };
}
const groupOf = (state, gid) => state.groups.find((g) => g.id === gid);
const member = (g, nick) => g.ms.find((m) => m.n === nick);

test.beforeEach(() => forgetKeys());

test('받은 값 검사: 별명·그룹 이름·초대 코드·목표', () => {
  assert.equal(cleanNick('  공부  왕 '), '공부 왕');
  assert.equal(cleanNick('a'.repeat(12)), 'a'.repeat(12));
  for (const bad of ['', '   ', 'a'.repeat(13), '<b>', 'x@y', 'https://a.b', '😀', null, 3]) assert.equal(cleanNick(bad), null, String(bad));
  assert.equal(cleanGroupName(' 수능 D-100 (국어) '), '수능 D-100 (국어)');
  assert.equal(cleanGroupName('가'.repeat(20)), '가'.repeat(20));
  for (const bad of ['', '가'.repeat(21), '<script>', 'a"b', "it's", 'a/b', null]) assert.equal(cleanGroupName(bad), null, String(bad));
  assert.equal(cleanCode('k7m-2qx'), 'K7M2QX');
  assert.equal(cleanCode(' K7M 2QX '), 'K7M2QX');
  for (const bad of ['K7M2Q', 'K7M2QXX', 'K0M2QX', 'KOM2QX', 'K1M2QX', 'KIM2QX', 'KLM2QX', '', null, 123456]) assert.equal(cleanCode(bad), null, String(bad));
  assert.deepEqual(cleanGoal(null), { day: 0, week: 0 });
  assert.deepEqual(cleanGoal({ day: 180 }), { day: 180, week: 0 });
  assert.deepEqual(cleanGoal({ day: 0, week: 60000 }), { day: 0, week: 60000 });
  for (const bad of [{ day: -1 }, { day: 1441 }, { week: 60001 }, { day: 1.5 }, { day: '60' }, [], 'x']) assert.equal(cleanGoal(bad), null, JSON.stringify(bad));
});

test('받은 값 검사: 날별 공부 시간·공부 중 표시·과목 이름', () => {
  assert.deepEqual(cleanDays({ '2026-11-19': 95, '2026-11-18': 0, '2026-11-10': 30 }, NOW), { '2026-11-19': 95, '2026-11-10': 30 }, '0분인 날은 뺀다');
  assert.deepEqual(cleanDays({ '2026-10-01': 30, '2026-11-25': 30, '2026-11-20': 10 }, NOW), { '2026-11-20': 10 }, '너무 오래되었거나 먼 날은 버린다');
  for (const bad of [{ '2026-11-19': 1441 }, { '2026-11-19': -1 }, { '2026-11-19': 1.5 }, { '19-11-2026': 3 }, { x: 1 }, [], 'x']) assert.equal(cleanDays(bad, NOW), null, JSON.stringify(bad));
  assert.deepEqual(cleanDays(undefined, NOW), {});
  const many = {};
  for (let i = 0; i < 41; i++) many['2026-11-' + String(i % 28 + 1).padStart(2, '0') + (i >= 28 ? 'x' : '')] = 1;
  assert.equal(cleanDays(many, NOW), null, '날이 너무 많으면 거절');

  assert.deepEqual(cleanLive({ k: 'sw', at: NOW - 30 * MIN, s: '  수학\n' }, NOW), { k: 'sw', at: NOW - 30 * MIN, s: '수학' });
  assert.deepEqual(cleanLive({ k: 'focus', at: NOW - 10 * MIN, end: NOW + 40 * MIN }, NOW), { k: 'focus', at: NOW - 10 * MIN, end: NOW + 40 * MIN });
  assert.equal(cleanLive({ k: 'focus', at: NOW - 60 * MIN, end: NOW - MIN }, NOW), null, '끝난 타이머');
  assert.equal(cleanLive({ k: 'sw', at: NOW - 17 * HOUR }, NOW), null, '17시간 켜 둔 스톱워치는 공부 중이 아니다');
  assert.equal(cleanLive({ k: 'sw', at: NOW + 5 * MIN }, NOW), null, '앞날에 시작');
  assert.equal(cleanLive({ k: 'lock', at: NOW, end: NOW + 13 * HOUR }, NOW), null, '12시간 넘는 잠금');
  assert.equal(cleanLive({ k: 'run', at: NOW }, NOW), null);
  assert.equal(cleanLive(null, NOW), null);
  assert.equal(cleanSubject(String.fromCharCode(0x202e) + '수학' + String.fromCharCode(0x200b) + ' 문제집' + String.fromCharCode(0x2028)), '수학 문제집', '보이지 않는 글자를 뺀다');
  assert.equal(cleanSubject('가'.repeat(30)), '가'.repeat(20));
  assert.equal(liveOn({ k: 'sw', at: NOW - HOUR }, NOW), true);
  assert.equal(liveOn({ k: 'focus', at: NOW - HOUR, end: NOW }, NOW), false);
});

test('주소: 로그인해야 하고, 다른 사이트·이상한 요청은 거절', async () => {
  const w = world();
  let r = await w.call(null);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'login');
  r = await w.call('amy', null, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await w.call('amy');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.groups, []);
  assert.equal(r.body.me.n, null);
  assert.match(r.body.me.id, /^[0-9a-f]{16}$/);
  await w.err('amy', { op: 'nope' }, 'bad');
  await w.err('amy', '[1,2]', 'bad');
  await w.err('amy', '{"op":', 'bad');
  await w.err('amy', JSON.stringify({ op: 'name', n: 'x', pad: 'x'.repeat(20000) }), 'bad');
  const pre = await w.call('amy', null, { origin: ORIGIN });
  assert.equal(pre.status, 200);
});

test('그룹 만들기: 별명이 있어야 하고, 만든 사람이 리더, 초대 코드 6자', async () => {
  const w = world();
  await w.err('amy', { op: 'create', name: '수학 스터디' }, 'name');
  await w.err('amy', { op: 'create', name: '수학 스터디', n: '<b>' }, 'badname');
  await w.err('amy', { op: 'create', name: '<수학>', n: '에이미' }, 'gname');
  await w.err('amy', { op: 'create', name: '수학', n: '에이미', goal: { day: 5000 } }, 'bad');
  assert.equal(w.hub().size, 0, '거절한 요청은 아무것도 남기지 않는다');
  const s = await w.ok('amy', { op: 'create', name: '수학 스터디', n: '에이미', goal: { day: 180, week: 2400 } });
  const g = groupOf(s, s.made);
  assert.ok(g);
  assert.match(g.id, /^[0-9a-z]{10}$/);
  assert.match(g.code, /^[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(g.name, '수학 스터디');
  assert.deepEqual(g.goal, { day: 180, week: 2400 });
  assert.equal(g.lead, s.me.id);
  assert.equal(g.ms.length, 1);
  assert.equal(g.ms[0].n, '에이미');
  assert.equal(g.ban, 0, '리더에게만 내보낸 사람 수');
  assert.equal(s.me.n, '에이미');
  assert.equal(w.hub().get('n'), 1);
  // 별명은 한 번 정하면 다음 그룹에 그대로
  const s2 = await w.ok('amy', { op: 'create', name: '영어 단어' });
  assert.equal(s2.groups.length, 2);
});

test('한 사람이 들 수 있는 그룹은 5개, 한 그룹은 20명까지', async () => {
  const w = world();
  for (let i = 0; i < LIMITS.groups; i++) await w.ok('amy', { op: 'create', name: '그룹' + i, n: '에이미' });
  await w.err('amy', { op: 'create', name: '여섯째' }, 'many');
  const { code } = await party(w, ['bob']);
  await w.err('amy', { op: 'join', code }, 'many');
  for (let i = 1; i < LIMITS.members; i++) await w.ok('u' + i, { op: 'join', code, n: '친구' + i });
  const peek = await w.ok('late', { op: 'peek', code });
  assert.equal(peek.peek.full, true);
  await w.err('late', { op: 'join', code, n: '늦은이' }, 'full');
});

test('초대 코드: 미리 보기, 들어가기, 틀리면 하루 30번까지', async () => {
  const w = world();
  const { gid, code } = await party(w, ['amy']);
  const p = await w.ok('bob', { op: 'peek', code: code.toLowerCase().slice(0, 3) + '-' + code.slice(3) });
  assert.deepEqual({ name: p.peek.name, count: p.peek.count, lead: p.peek.lead, member: p.peek.member, full: p.peek.full }, { name: '수학 스터디', count: 1, lead: 'AMY', member: false, full: false });
  assert.equal(p.peek.max, LIMITS.members);
  await w.err('bob', { op: 'join', code }, 'name');
  const j = await w.ok('bob', { op: 'join', code, n: '밥' });
  assert.equal(j.joined, gid);
  assert.deepEqual(groupOf(j, gid).ms.map((m) => m.n), ['AMY', '밥']);
  const again = await w.ok('bob', { op: 'join', code });
  assert.equal(again.groups.length, 1, '두 번 들어가도 한 번');
  assert.equal((await w.ok('bob', { op: 'peek', code })).peek.member, true);
  // 틀린 코드
  await w.err('eve', { op: 'join', code: 'ZZZZZZ' === code ? 'YYYYYY' : 'ZZZZZZ' }, 'code');
  await w.err('eve', { op: 'join', code: '12' }, 'code');
  for (let i = 1; i < LIMITS.tries; i++) await w.err('eve', { op: 'peek', code: 'ZZZZZZ' === code ? 'YYYYYY' : 'ZZZZZZ' }, 'code');
  await w.err('eve', { op: 'peek', code }, 'slow');
  await w.err('eve', { op: 'join', code, n: '이브' }, 'slow');
  w.now += DAY;
  await w.ok('eve', { op: 'join', code, n: '이브' });
});

test('공부 시간 나누기: 내 날별 시간과 공부 중 표시가 그룹 사람들에게 보인다', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  await w.ok('amy', { op: 'sync', d: { '2026-11-19': 95, '2026-11-17': 200 }, lv: { k: 'sw', at: NOW - 25 * MIN, s: '수학' }, dv: 'phone1' });
  const seen = groupOf(await w.ok('bob'), gid);
  const amy = member(seen, 'AMY');
  assert.deepEqual(amy.d, { '2026-11-19': 95, '2026-11-17': 200 });
  assert.deepEqual(amy.lv, { k: 'sw', at: NOW - 25 * MIN, s: '수학' }, '어느 기기인지(dv)는 보내지 않는다');
  assert.equal(amy.up, NOW);
  assert.deepEqual(member(seen, 'BOB').d, {});
  // 다른 기기(PC)가 '공부 중 아님'을 보내도 폰이 재는 중이면 지우지 않는다
  w.now += MIN;
  await w.ok('amy', { op: 'sync', d: { '2026-11-19': 95, '2026-11-17': 200 }, lv: null, dv: 'pc1' });
  assert.ok(member(groupOf(await w.ok('bob'), gid), 'AMY').lv, '다른 기기의 공부 중 표시는 남는다');
  // 재던 기기가 멈추면 지운다
  await w.ok('amy', { op: 'sync', d: { '2026-11-19': 121, '2026-11-17': 200 }, lv: null, dv: 'phone1' });
  const after = member(groupOf(await w.ok('bob'), gid), 'AMY');
  assert.equal(after.lv, null);
  assert.equal(after.d['2026-11-19'], 121);
  // 끝나는 시각이 지난 타이머는 공부 중으로 보이지 않는다
  await w.ok('bob', { op: 'sync', d: {}, lv: { k: 'focus', at: w.now, end: w.now + 25 * MIN }, dv: 'b' });
  assert.ok(member(groupOf(await w.ok('amy'), gid), 'BOB').lv);
  w.now += 26 * MIN;
  assert.equal(member(groupOf(await w.ok('amy'), gid), 'BOB').lv, null);
  // 이상한 공부 시간은 거절 (기록은 그대로)
  await w.err('amy', { op: 'sync', d: { '2026-11-19': 2000 } }, 'bad');
  assert.equal(member(groupOf(await w.ok('bob'), gid), 'AMY').d['2026-11-19'], 121);
  // 2주가 넘은 날은 보내지 않는다
  w.now += 20 * DAY;
  assert.deepEqual(member(groupOf(await w.ok('bob'), gid), 'AMY').d, {});
});

test('그룹에 들지 않은 사람의 공부 시간은 받지 않고, 다 나가면 지운다', async () => {
  const w = world();
  await w.ok('amy', { op: 'name', n: '에이미' });
  await w.ok('amy', { op: 'sync', d: { '2026-11-19': 50 } });
  const hub = w.hub();
  const rec = [...hub].find(([k]) => k.startsWith('u:'))[1];
  assert.deepEqual(rec.d, {}, '그룹이 없으면 저장하지 않음');
  const { gid } = await party(w, ['bob', 'amy']);
  await w.ok('amy', { op: 'sync', d: { '2026-11-19': 50 }, lv: { k: 'sw', at: NOW } });
  await w.ok('amy', { op: 'leave', g: gid });
  const rec2 = [...w.hub()].find(([k, v]) => k.startsWith('u:') && v.n === 'AMY')[1];
  assert.deepEqual(rec2.d, {});
  assert.equal(rec2.lv, null);
  assert.deepEqual(rec2.gs, []);
  assert.equal(rec2.n, 'AMY', '별명은 남겨 둔다 (들어갈 때 바꾼 별명)');
});

test('응답에는 이메일·로그인 번호·실제 이름이 없다', async () => {
  const w = world();
  const { code } = await party(w, ['amy-uid-123', 'bob-uid-456']);
  const raws = [(await w.call('amy-uid-123')).raw, (await w.call('bob-uid-456', { op: 'peek', code })).raw];
  for (const raw of raws) {
    for (const secret of ['amy-uid-123', 'bob-uid-456', '@example.com', 'Real ']) assert.ok(!raw.includes(secret), secret + ' 이(가) 보이면 안 된다');
  }
  const store = JSON.stringify([...w.hub()]);
  for (const secret of ['amy-uid-123', '@example.com', 'Real ']) assert.ok(!store.includes(secret), '저장소에도 ' + secret + ' 없음');
});

test('나가기: 리더가 나가면 다음 사람이 리더, 마지막 사람이 나가면 그룹과 코드가 없어진다', async () => {
  const w = world();
  const { gid, code } = await party(w, ['amy', 'bob', 'cat']);
  const s = await w.ok('amy', { op: 'leave', g: gid });
  assert.equal(s.left, gid);
  assert.equal(s.groups.length, 0);
  const g = groupOf(await w.ok('bob'), gid);
  assert.equal(g.lead, member(g, 'BOB').id, '가장 먼저 들어온 사람이 리더');
  assert.deepEqual(g.ms.map((m) => m.n), ['BOB', 'CAT']);
  await w.err('amy', { op: 'leave', g: gid }, 'nogroup');
  await w.ok('bob', { op: 'leave', g: gid });
  await w.ok('cat', { op: 'leave', g: gid });
  assert.equal(w.hub().get('g:' + gid), undefined);
  assert.equal(w.hub().get('c:' + code), undefined);
  assert.equal(w.hub().get('n'), 0);
  await w.err('dan', { op: 'join', code, n: '단' }, 'code');
});

test('리더만: 이름·목표 바꾸기, 새 초대 코드, 내보내기·다시 받기, 리더 넘기기, 그룹 없애기', async () => {
  const w = world();
  const { gid, code } = await party(w, ['amy', 'bob', 'cat']);
  const bobId = member(groupOf(await w.ok('amy'), gid), 'BOB').id;
  await w.err('bob', { op: 'edit', g: gid, name: '내 그룹' }, 'lead');
  await w.err('bob', { op: 'code', g: gid }, 'lead');
  await w.err('bob', { op: 'kick', g: gid, m: bobId }, 'lead');
  await w.err('dan', { op: 'edit', g: gid, name: 'x' }, 'nogroup');
  // 이름·목표
  await w.err('amy', { op: 'edit', g: gid }, 'bad');
  await w.err('amy', { op: 'edit', g: gid, name: '<x>' }, 'gname');
  const e = groupOf(await w.ok('amy', { op: 'edit', g: gid, name: '수능 D-100', goal: { day: 240, week: 3000 } }), gid);
  assert.equal(e.name, '수능 D-100');
  assert.deepEqual(e.goal, { day: 240, week: 3000 });
  assert.equal(groupOf(await w.ok('cat'), gid).name, '수능 D-100', '모두에게 바로 보인다');
  // 새 초대 코드: 예전 코드로는 못 들어온다
  const nc = groupOf(await w.ok('amy', { op: 'code', g: gid }), gid).code;
  assert.notEqual(nc, code);
  await w.err('dan', { op: 'peek', code }, 'code');
  assert.equal((await w.ok('dan', { op: 'peek', code: nc })).peek.count, 3);
  // 내보내기 → 다시 못 들어옴 → 다시 받기
  await w.err('amy', { op: 'kick', g: gid, m: member(e, 'AMY').id }, 'bad');
  const k = groupOf(await w.ok('amy', { op: 'kick', g: gid, m: bobId }), gid);
  assert.deepEqual(k.ms.map((m) => m.n), ['AMY', 'CAT']);
  assert.equal(k.ban, 1);
  assert.equal((await w.ok('bob')).groups.length, 0);
  assert.equal((await w.ok('bob', { op: 'peek', code: nc })).peek.banned, true);
  await w.err('bob', { op: 'join', code: nc }, 'banned');
  assert.equal(groupOf(await w.ok('amy', { op: 'unban', g: gid }), gid).ban, 0);
  await w.ok('bob', { op: 'join', code: nc });
  // 리더 넘기기
  const catId = member(k, 'CAT').id;
  await w.err('amy', { op: 'lead', g: gid, m: 'ffffffffffffffff' }, 'bad');
  const l = groupOf(await w.ok('amy', { op: 'lead', g: gid, m: catId }), gid);
  assert.equal(l.lead, catId);
  assert.equal(l.ban, undefined, '리더가 아니면 내보낸 사람 수를 받지 않는다');
  await w.err('amy', { op: 'drop', g: gid }, 'lead');
  // 그룹 없애기
  const d = await w.ok('cat', { op: 'drop', g: gid });
  assert.equal(d.dropped, gid);
  for (const who of ['amy', 'bob', 'cat']) assert.equal((await w.ok(who)).groups.length, 0, who + '의 그룹 목록에서도 빠짐');
  assert.equal(w.hub().get('n'), 0);
});

test('응원: 그룹 사람에게만, 같은 사람에게 10분에 한 번, 일주일 지난 응원은 안 보인다', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  const g = groupOf(await w.ok('amy'), gid);
  const amyId = member(g, 'AMY').id, bobId = member(g, 'BOB').id;
  await w.err('amy', { op: 'cheer', g: gid, m: amyId, e: 0 }, 'bad');
  await w.err('amy', { op: 'cheer', g: gid, m: bobId, e: 4 }, 'bad');
  await w.err('amy', { op: 'cheer', g: gid, m: 'ffffffffffffffff', e: 0 }, 'bad');
  await w.err('cat', { op: 'cheer', g: gid, m: bobId, e: 0 }, 'nogroup');
  const s = await w.ok('amy', { op: 'cheer', g: gid, m: bobId, e: 1 });
  assert.equal(s.sent, true);
  const ch = groupOf(await w.ok('bob'), gid).ch;
  assert.deepEqual(ch, [{ f: amyId, t: bobId, e: 1, at: NOW }]);
  await w.err('amy', { op: 'cheer', g: gid, m: bobId, e: 2 }, 'wait');
  await w.ok('bob', { op: 'cheer', g: gid, m: amyId, e: 0 });
  w.now += CHEER_GAP;
  await w.ok('amy', { op: 'cheer', g: gid, m: bobId, e: 2 });
  assert.equal(groupOf(await w.ok('bob'), gid).ch.length, 3);
  w.now += 8 * DAY;
  assert.equal(groupOf(await w.ok('bob'), gid).ch.length, 0);
  // 많아도 40개까지
  for (let i = 0; i < 45; i++) { w.now += CHEER_GAP; await w.ok('amy', { op: 'cheer', g: gid, m: bobId, e: i % 4 }); }
  assert.equal(groupOf(await w.ok('bob'), gid).ch.length, LIMITS.cheers);
});

test('함께 집중: 시작하면 같은 시각에 끝나고, 같이 하기·그만하기, 끝나면 사라진다', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob', 'cat']);
  await w.err('amy', { op: 'room', g: gid, min: 5 }, 'bad');
  await w.err('amy', { op: 'room', g: gid, min: 181 }, 'bad');
  await w.err('bob', { op: 'room-join', g: gid }, 'noroom');
  const s = groupOf(await w.ok('amy', { op: 'room', g: gid, min: 50 }), gid);
  const amyId = member(s, 'AMY').id;
  assert.deepEqual(s.room, { by: amyId, at: NOW, end: NOW + 50 * MIN, ms: [amyId] });
  await w.err('bob', { op: 'room', g: gid, min: 25 }, 'room');
  w.now += 10 * MIN;
  const j = groupOf(await w.ok('bob', { op: 'room-join', g: gid }), gid);
  assert.equal(j.room.ms.length, 2);
  assert.equal(j.room.end, NOW + 50 * MIN, '끝나는 시각은 그대로');
  await w.ok('bob', { op: 'room-join', g: gid });
  assert.equal(groupOf(await w.ok('cat'), gid).room.ms.length, 2, '두 번 눌러도 한 번');
  await w.ok('amy', { op: 'room-leave', g: gid });
  assert.deepEqual(groupOf(await w.ok('cat'), gid).room.ms, [member(s, 'BOB').id]);
  await w.ok('bob', { op: 'room-leave', g: gid });
  assert.equal(groupOf(await w.ok('cat'), gid).room, null, '아무도 없으면 끝');
  await w.ok('cat', { op: 'room', g: gid, min: 25 });
  w.now += 26 * MIN;
  assert.equal(groupOf(await w.ok('amy'), gid).room, null, '시간이 지나면 끝');
  await w.ok('amy', { op: 'room', g: gid, min: 25 }); // 끝난 뒤에는 새로 시작할 수 있다
});

test('별명 바꾸기는 모든 그룹에 바로', async () => {
  const w = world();
  const a = await party(w, ['amy', 'bob']);
  const b = await w.ok('bob', { op: 'create', name: '영어', goal: null });
  await w.err('bob', { op: 'name', n: '' }, 'badname');
  const s = await w.ok('bob', { op: 'name', n: '밥 2' });
  assert.equal(s.me.n, '밥 2');
  for (const g of s.groups) assert.ok(g.ms.some((m) => m.n === '밥 2'), g.name);
  assert.ok(groupOf(await w.ok('amy'), a.gid).ms.some((m) => m.n === '밥 2'));
  assert.ok(b.made);
});

test('저장소 처리(groupOp)만 따로: 이상한 요청은 거절', async () => {
  const st = world().storage('x');
  assert.deepEqual(await groupOp(st, { op: 'group-get', id: 'not-hex', at: NOW }), { error: 'bad' });
  assert.deepEqual(await groupOp(st, { op: 'group-x', id: 'ffffffffffffffff', at: NOW }), { error: 'bad' });
  assert.deepEqual(await groupOp(st, { op: 'group-get', id: 'ffffffffffffffff', at: 'x' }), { error: 'bad' });
  const s = await groupOp(st, { op: 'group-get', id: 'ffffffffffffffff', at: NOW, b: [] });
  assert.equal(s.ok, true);
  assert.deepEqual(await groupOp(st, { op: 'group-leave', id: 'ffffffffffffffff', at: NOW, b: { g: '../../x' } }), { error: 'nogroup' });
});

/* ===================== 그룹 채팅 (v4.1) ===================== */
test('채팅 글 검사: 줄바꿈은 남기고 보이지 않는 글자는 빼고, 200자·8줄까지', () => {
  assert.equal(cleanMsg('  안녕  '), '안녕');
  assert.equal(cleanMsg('a\r\nb'), 'a\nb');
  assert.equal(cleanMsg('a\n\n\n\nb'), 'a\n\nb', '빈 줄은 하나까지');
  assert.equal(cleanMsg('a  \t b'), 'a b');
  assert.equal(cleanMsg('줄 끝 빈칸   \n  다음 줄'), '줄 끝 빈칸\n다음 줄');
  assert.equal(cleanMsg('a​b‮c⁦d﻿'), 'abcd', '보이지 않는 글자·방향 바꾸는 글자');
  assert.equal(cleanMsg('\u0007삐'), '삐');
  assert.equal(cleanMsg('👨‍👩‍👧 가족'), '👨‍👩‍👧 가족', '이모지를 잇는 글자(ZWJ)는 남김');
  assert.equal(cleanMsg('가'.repeat(CHAT.len)), '가'.repeat(CHAT.len));
  assert.equal(cleanMsg('가'.repeat(CHAT.len + 1)), null);
  assert.equal(cleanMsg('😀'.repeat(CHAT.len)), '😀'.repeat(CHAT.len), '이모지 하나는 한 글자');
  assert.equal(cleanMsg(Array(CHAT.lines).fill('줄').join('\n')).split('\n').length, CHAT.lines);
  assert.equal(cleanMsg(Array(CHAT.lines + 1).fill('줄').join('\n')), null);
  for (const v of ['', '   ', '\n\n', '​', null, undefined, 3, {}, ['a']]) assert.equal(cleanMsg(v), null, JSON.stringify(v));
});

test('채팅: 보내기·받기, since 번호 뒤 것만, 보낸 사람에게만 앱 번호, 그룹 보기에 새 메시지 번호와 미리 보기', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob', 'cat']);
  w.now += MIN;
  const a = await w.ok('amy', { op: 'say', g: gid, t: '  오늘 8시에 같이 하자  ', c: 'abc123', since: 0 });
  assert.equal(a.groups, undefined, '채팅 답은 가볍게: 그룹 보기는 없음');
  assert.equal(a.chat.on, true);
  assert.equal(a.chat.full, true);
  const mine = a.chat.ms.find((x) => x.t);
  assert.equal(mine.t, '오늘 8시에 같이 하자');
  assert.equal(mine.c, 'abc123', '보낸 사람은 앱 번호로 자기 메시지를 알아본다');
  assert.equal(mine.n, 'AMY');
  assert.deepEqual(a.chat.ms.filter((x) => x.k).map((x) => [x.k, x.n]), [['in', 'BOB'], ['in', 'CAT']], '들어온 사람은 자동 소식');
  const b0 = await w.ok('bob', { op: 'chat', g: gid, since: 0 });
  const seenByBob = b0.chat.ms.find((x) => x.t);
  assert.equal(seenByBob.c, undefined, '다른 사람에게는 앱 번호가 안 감');
  assert.equal(seenByBob.f, mine.f);
  const v1 = b0.chat.v;
  assert.deepEqual((await w.ok('bob', { op: 'chat', g: gid, since: v1 })).chat.ms, [], '새것이 없으면 빈 목록');
  w.now += 2000;
  await w.ok('cat', { op: 'say', g: gid, t: '좋아 ☕', since: 0 });
  const b1 = await w.ok('bob', { op: 'chat', g: gid, since: v1 });
  assert.equal(b1.chat.full, false);
  assert.deepEqual(b1.chat.ms.map((x) => x.t), ['좋아 ☕'], 'since 뒤에 생긴 것만');
  assert.equal((await w.ok('bob', { op: 'chat', g: gid, since: 9999 })).chat.full, true, '이상한 since면 전부');
  // 그룹 보기의 요약: 다른 사람이 보낸 메시지 번호(내 것과 자동 소식은 빼고), 마지막 두 메시지
  const g = groupOf(await w.ok('bob'), gid);
  assert.equal(g.chat.on, true);
  assert.equal(g.chat.v, b1.chat.v);
  assert.equal(g.chat.nu.length, 2);
  assert.deepEqual(g.chat.nu.map((x) => x[1]), [mine.f, groupOf(await w.ok('cat'), gid).ms.find((m) => m.n === 'CAT').id], '[번호, 보낸 사람] 짝');
  assert.deepEqual(g.chat.tail.map((x) => x.t), ['오늘 8시에 같이 하자', '좋아 ☕']);
  assert.equal(groupOf(await w.ok('amy'), gid).chat.nu.length, 1, '내가 보낸 것은 새 메시지가 아님');
  // 같은 앱 번호로 다시 보내면 (답을 못 받아 다시 보낸 경우) 한 번만 들어간다
  w.now += 2000;
  await w.ok('amy', { op: 'say', g: gid, t: '오늘 8시에 같이 하자', c: 'abc123', since: 0 });
  assert.equal((await w.ok('bob', { op: 'chat', g: gid, since: 0 })).chat.ms.filter((x) => x.t === '오늘 8시에 같이 하자').length, 1);
  // 그룹에 없는 사람, 이상한 글
  await w.err('dan', { op: 'chat', g: gid, since: 0 }, 'nogroup');
  await w.err('dan', { op: 'say', g: gid, t: '안녕' }, 'nogroup');
  w.now += 2000;
  await w.err('amy', { op: 'say', g: gid, t: '   ' }, 'bad');
  await w.err('amy', { op: 'say', g: gid, t: '가'.repeat(201) }, 'bad');
  await w.err('amy', { op: 'say', g: gid, t: { x: 1 } }, 'bad');
});

test('채팅: 새로 들어온 사람은 들어온 뒤부터, 나간·내보내진 사람은 못 봄, 나가면 자동 소식', async () => {
  const w = world();
  const { gid, code } = await party(w, ['amy', 'bob', 'cat']);
  w.now += MIN;
  await w.ok('amy', { op: 'say', g: gid, t: '비밀 계획' });
  w.now += MIN;
  await w.ok('dan', { op: 'join', code, n: 'DAN' });
  const d = await w.ok('dan', { op: 'chat', g: gid, since: 0 });
  assert.ok(!d.chat.ms.some((x) => x.t === '비밀 계획'), '들어오기 전 메시지는 안 보임');
  assert.deepEqual(d.chat.ms.map((x) => [x.k, x.n]), [['in', 'DAN']], '내가 들어온 소식부터');
  assert.equal(groupOf(await w.ok('dan'), gid).chat.nu.length, 0);
  w.now += MIN;
  await w.ok('bob', { op: 'say', g: gid, t: '어서 와' });
  assert.ok((await w.ok('dan', { op: 'chat', g: gid, since: 0 })).chat.ms.some((x) => x.t === '어서 와'));
  // 나가기: 자동 소식, 나간 사람은 못 봄, 남긴 메시지는 그때 별명으로 남는다
  w.now += MIN;
  await w.ok('bob', { op: 'leave', g: gid });
  await w.err('bob', { op: 'chat', g: gid, since: 0 }, 'nogroup');
  const after = await w.ok('amy', { op: 'chat', g: gid, since: 0 });
  assert.equal(after.chat.ms.at(-1).k, 'out');
  assert.equal(after.chat.ms.at(-1).n, 'BOB');
  assert.equal(after.chat.ms.find((x) => x.t === '어서 와').n, 'BOB');
  // 내보내기: 자동 소식은 없고, 내보내진 사람은 못 봄
  w.now += MIN;
  const before = after.chat.v;
  await w.ok('amy', { op: 'kick', g: gid, m: member(groupOf(await w.ok('amy'), gid), 'CAT').id });
  await w.err('cat', { op: 'chat', g: gid, since: 0 }, 'nogroup');
  assert.deepEqual((await w.ok('amy', { op: 'chat', g: gid, since: before })).chat.ms, [], '내보낸 일은 채팅에 알리지 않음');
});

test('채팅: 지우기는 내 메시지와 리더만, 지운 자리는 남고 since로 알려짐', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob', 'cat']);
  w.now += MIN;
  const s1 = (await w.ok('bob', { op: 'say', g: gid, t: '실수로 보냄' })).chat.ms.at(-1).s;
  w.now += 2000;
  const s2 = (await w.ok('cat', { op: 'say', g: gid, t: '이상한 말' })).chat.ms.at(-1).s;
  w.now += 2000;
  const s3 = (await w.ok('amy', { op: 'say', g: gid, t: '리더 공지' })).chat.ms.at(-1).s;
  const v0 = (await w.ok('cat', { op: 'chat', g: gid, since: 0 })).chat.v;
  await w.err('bob', { op: 'unsay', g: gid, s: s3 }, 'lead');
  await w.err('bob', { op: 'unsay', g: gid, s: 'x' }, 'bad');
  await w.err('bob', { op: 'unsay', g: gid, s: 9999 }, 'gone');
  const sys = (await w.ok('bob', { op: 'chat', g: gid, since: 0 })).chat.ms.find((x) => x.k).s;
  await w.err('amy', { op: 'unsay', g: gid, s: sys }, 'gone');
  const r = await w.ok('bob', { op: 'unsay', g: gid, s: s1, since: v0 });
  assert.deepEqual(r.chat.ms.map((x) => [x.s, x.x, x.t]), [[s1, 1, undefined]], '본인이 지움: 글은 사라짐');
  await w.ok('amy', { op: 'unsay', g: gid, s: s2 });
  const c = await w.ok('cat', { op: 'chat', g: gid, since: v0 });
  assert.deepEqual(c.chat.ms.map((x) => [x.s, x.x]), [[s1, 1], [s2, 2]], '리더가 지움은 2, 바뀐 것은 since로 다시 옴');
  assert.ok(!JSON.stringify([...w.hub()]).includes('실수로 보냄'), '저장소에서도 글이 지워짐');
  await w.ok('bob', { op: 'unsay', g: gid, s: s1 }); // 이미 지운 것은 그대로
  const g = groupOf(await w.ok('cat'), gid);
  assert.deepEqual(g.chat.tail.map((x) => x.t), ['리더 공지'], '지운 메시지는 미리 보기와 새 메시지에서 빠짐');
  assert.equal(g.chat.nu.length, 1);
});

test('채팅: 1초에 1개·1분에 20개·하루 300개까지, 다음 날 다시', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  await w.ok('amy', { op: 'say', g: gid, t: '1' });
  await w.err('amy', { op: 'say', g: gid, t: '2' }, 'fast');
  w.now += 999;
  await w.err('amy', { op: 'say', g: gid, t: '2' }, 'fast');
  w.now += 1;
  await w.ok('amy', { op: 'say', g: gid, t: '2' });
  for (let i = 3; i <= CHAT.perMin; i++) { w.now += 1000; await w.ok('amy', { op: 'say', g: gid, t: String(i) }); }
  w.now += 1000;
  await w.err('amy', { op: 'say', g: gid, t: 'x' }, 'fast');
  await w.ok('bob', { op: 'say', g: gid, t: '나는 괜찮음' });
  w.now += MIN;
  await w.ok('amy', { op: 'say', g: gid, t: '1분 지나면 다시' });
  // 하루 300개 (모든 그룹 합해서). 1분에 20개를 넘지 않게 3.5초마다
  const day0 = new Date(w.now).toISOString().slice(0, 10);
  let sent = CHAT.perMin + 1;
  while (sent < CHAT.perDay) { w.now += 3500; await w.ok('amy', { op: 'say', g: gid, t: 'm' + sent }); sent++; }
  assert.equal(new Date(w.now).toISOString().slice(0, 10), day0, '같은 날 안에 보냄');
  w.now += 3500;
  await w.err('amy', { op: 'say', g: gid, t: '301' }, 'daymax');
  const c = await w.ok('bob', { op: 'chat', g: gid, since: 0 });
  assert.ok(c.chat.ms.length <= CHAT.keep, '그룹마다 최근 150줄만');
  assert.equal(c.chat.ms.at(-1).t, 'm299');
  w.now = Date.UTC(2026, 10, 20, 0, 0, 1); // 다음 날 (UTC 0시 = 한국 오전 9시)
  await w.ok('amy', { op: 'say', g: gid, t: '새 날' });
});

test('채팅: 7일 지난 줄은 사라지고, 리더가 끄면 숨고 못 보냄, 함께 집중은 자동 소식, 그룹을 없애면 채팅도', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  await w.ok('bob', { op: 'say', g: gid, t: '옛날 메시지' });
  w.now += 7 * DAY + MIN;
  const old = await w.ok('amy', { op: 'chat', g: gid, since: 0 });
  assert.ok(!old.chat.ms.some((x) => x.t === '옛날 메시지'), '7일 지나면 안 보임');
  assert.deepEqual(groupOf(await w.ok('amy'), gid).chat.tail, []);
  await w.ok('bob', { op: 'say', g: gid, t: '새 메시지' });
  assert.ok(!JSON.stringify([...w.hub()]).includes('옛날 메시지'), '새 줄을 넣을 때 저장소에서도 지움');
  // 리더가 채팅 끄기
  await w.err('bob', { op: 'edit', g: gid, chat: false }, 'lead');
  await w.err('amy', { op: 'edit', g: gid, chat: 'off' }, 'bad');
  await w.ok('amy', { op: 'edit', g: gid, chat: false });
  w.now += 2000;
  await w.err('bob', { op: 'say', g: gid, t: '들려?' }, 'chatoff');
  const off = await w.ok('bob', { op: 'chat', g: gid, since: 0 });
  assert.deepEqual([off.chat.on, off.chat.ms], [false, []]);
  assert.deepEqual(groupOf(await w.ok('bob'), gid).chat, { on: false, v: 0, nu: [], tail: [] });
  await w.ok('amy', { op: 'edit', g: gid, chat: true });
  assert.ok((await w.ok('bob', { op: 'chat', g: gid, since: 0 })).chat.ms.some((x) => x.t === '새 메시지'), '다시 켜면 남아 있던 메시지가 보임');
  // 함께 집중 시작은 자동 소식
  await w.ok('bob', { op: 'room', g: gid, min: 50 });
  const room = (await w.ok('amy', { op: 'chat', g: gid, since: 0 })).chat.ms.at(-1);
  assert.deepEqual([room.k, room.n, room.min, room.end], ['room', 'BOB', 50, w.now + 50 * MIN]);
  // 그룹을 없애면 채팅도
  assert.ok(w.hub().has('m:' + gid));
  await w.ok('amy', { op: 'drop', g: gid });
  assert.equal(w.hub().has('m:' + gid), false);
});

test('채팅: 응답과 저장소에 이메일·로그인 번호·실제 이름이 없다', async () => {
  const w = world();
  const { gid } = await party(w, ['amy-uid-123', 'bob-uid-456']);
  w.now += MIN;
  const raws = [(await w.call('amy-uid-123', { op: 'say', g: gid, t: '안녕', c: 'zz9999' })).raw, (await w.call('bob-uid-456', { op: 'chat', g: gid, since: 0 })).raw, (await w.call('bob-uid-456')).raw];
  for (const raw of raws) for (const secret of ['amy-uid-123', 'bob-uid-456', '@example.com', 'Real ']) assert.ok(!raw.includes(secret), secret);
  const store = JSON.stringify([...w.hub()]);
  for (const secret of ['amy-uid-123', 'bob-uid-456', '@example.com', 'Real ']) assert.ok(!store.includes(secret), '저장소 ' + secret);
});

/* ===================== 채팅에 붙이는 것 (v4.3): 사진 · 공부 기록 카드 · 단어장 ===================== */
// JPEG처럼 시작하는 n바이트 (서버는 앞의 FF D8 FF와 크기만 본다)
const jpeg = (n, fill) => { const b = Buffer.alloc(n, fill || 7); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; return b.toString('base64'); };
const PHOTO = jpeg(300 * 1024), THUMB = jpeg(30 * 1024, 9);
const photo = (o) => Object.assign({ op: 'say', p: 'img', img: PHOTO, th: THUMB, w: 1600, h: 1200, since: 0 }, o);
const REC = { sp: 'd', d: '2026-11-19', m: 205, g: 180, fo: 4, td: [5, 7], sk: 12, sb: [{ n: '수학', m: 100, c: '#4F86E8' }, { n: '영어', m: 55, c: '#3fb27f' }, { m: 40, c: '#ef7d3c' }, { x: 1, m: 10, c: '' }], o: 0 };
const fileKeys = (w) => [...w.hub().keys()].filter((k) => k.startsWith('a:')).sort();

test('붙이는 것 검사: base64·JPEG, 설명 한 줄, 공부 기록 카드, 단어장', () => {
  assert.equal(b64Size('AAAA'), 3);
  assert.equal(b64Size('AAA='), 2);
  assert.equal(b64Size('AA=='), 1);
  for (const bad of ['', 'AAA', 'AA=A', 'A$AA', null, 5]) assert.equal(b64Size(bad), -1, String(bad));
  assert.equal(jpegSize(jpeg(1000), 2000), 1000);
  assert.equal(jpegSize(jpeg(3000), 2000), 0, '너무 큼');
  assert.equal(jpegSize(Buffer.from('GIF89a..').toString('base64'), 2000), 0, 'JPEG가 아님');
  assert.equal(cleanCaption('  22번\n어떻게 풀어? ', 100), '22번 어떻게 풀어?', '줄바꿈은 빈칸으로');
  assert.equal(cleanCaption('', 100), '');
  assert.equal(cleanCaption(undefined, 100), '');
  assert.equal(cleanCaption('가'.repeat(41), 40), null);
  assert.equal(cleanCaption({}, 40), null);
  // 공부 기록 카드
  const r = cleanRecord(REC);
  assert.deepEqual(r.sb, [{ n: '수학', m: 100, c: '#4f86e8' }, { n: '영어', m: 55, c: '#3fb27f' }, { m: 40, c: '#ef7d3c' }, { x: 1, m: 10, c: '' }], '이름 숨긴 과목·과목 없음');
  assert.deepEqual([r.sp, r.d, r.m, r.g, r.fo, r.td, r.sk, r.o], ['d', '2026-11-19', 205, 180, 4, [5, 7], 12, 0]);
  assert.equal(cleanRecord(Object.assign({}, REC, { sp: 'w', d: '2026-11-16', e: '2026-11-19', m: 900 })).e, '2026-11-19');
  for (const bad of [
    { sp: 'm' }, { d: '19-11-2026' }, { m: 1441 }, { m: -1 }, { g: 2000 }, { td: [8, 7] }, { td: [1] }, { sb: new Array(6).fill({ m: 1 }) },
    { sb: [{ n: '', m: 'x' }] }, { sp: 'w', d: '2026-11-10', e: '2026-11-19' }, { sp: 'w', d: '2026-11-19', e: '2026-11-18' }, { sp: 'w' },
  ]) assert.equal(cleanRecord(Object.assign({}, REC, bad)), null, JSON.stringify(bad));
  assert.equal(cleanRecord(null), null);
  assert.equal(cleanRecord(Object.assign({}, REC, { title: '할 일 제목' })).title, undefined, '모르는 칸(할 일 제목 등)은 버린다');
  // 단어장
  assert.deepEqual(cleanDeck({ n: ' 수능  영단어 ', cs: [[' abandon ', '버리다\n포기하다'], ['able', '할 수 있는']] }), { n: '수능 영단어', cs: [['abandon', '버리다 포기하다'], ['able', '할 수 있는']] });
  assert.equal(cleanDeck({ cs: [['a', 'b']] }).n, '단어장', '이름이 없으면');
  for (const bad of [{ n: 'x', cs: [] }, { n: 'x', cs: [['a', '']] }, { n: 'x', cs: [['a']] }, { n: 'x', cs: [['a'.repeat(301), 'b']] }, { n: 'x', cs: [['a', 'b'.repeat(501)]] },
    { n: '가'.repeat(41), cs: [['a', 'b']] }, { n: 'x', cs: new Array(1001).fill(['a', 'b']) }, { n: 'x', cs: 'a~b' }, null])
    assert.equal(cleanDeck(bad), null, JSON.stringify(bad).slice(0, 80));
  assert.equal(cleanDeck({ n: 'x', cs: new Array(1000).fill(['가'.repeat(100), '나'.repeat(101)]) }), null, '글자 수 합 20만 자까지');
  assert.equal(cleanDeck({ n: 'x', cs: new Array(1000).fill(['가'.repeat(100), '나'.repeat(100)]) }).cs.length, 1000);
  // 예전 앱에 보이는 글
  assert.equal(altText({ p: 'img', t: '22번' }), '📷 사진 · 22번');
  assert.equal(altText({ p: 'rec', r: { sp: 'w', m: 205 }, t: '' }), '📊 이번 주 공부 3시간 25분');
  assert.equal(altText({ p: 'deck', dn: 'Day 12', cn: 30 }), '🗂️ 단어장 ‘Day 12’ 카드 30장');
});

test('사진: 보내면 그룹 사람에게 작은 그림과 원본, 늦게 들어온 사람·그룹 밖은 못 봄, 같은 앱 번호는 한 번만', async () => {
  const w = world();
  const { gid, code } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  const a = await w.ok('amy', photo({ g: gid, t: '22번 이거\n어떻게 풀어? 🙋', c: 'ph0001' }));
  const x = a.chat.ms.find((m) => m.p === 'img');
  assert.deepEqual([x.w, x.h, x.cap, x.t, x.c], [1600, 1200, '22번 이거 어떻게 풀어? 🙋', '📷 사진 · 22번 이거 어떻게 풀어? 🙋', 'ph0001']);
  assert.match(x.a, /^[0-9a-z]{12}$/);
  assert.equal(x.img, undefined, '줄에는 사진 내용이 없다');
  assert.deepEqual(fileKeys(w), ['a:' + x.a, 'a:' + x.a + ':s']);
  // bob: 줄·작은 그림·원본
  const seen = (await w.ok('bob', { op: 'chat', g: gid, since: 0 })).chat.ms.find((m) => m.p === 'img');
  assert.deepEqual([seen.a, seen.cap, seen.c], [x.a, x.cap, undefined]);
  const th = await w.ok('bob', { op: 'thumbs', g: gid, as: [x.a, 'zzzzzzzzzzzz'] });
  assert.deepEqual(th.th, { [x.a]: THUMB, zzzzzzzzzzzz: null }, '없는 번호는 null');
  const f = await w.ok('bob', { op: 'file', g: gid, a: x.a });
  assert.deepEqual([f.img === PHOTO, f.w, f.h], [true, 1600, 1200]);
  // 그룹 요약: 새 메시지로 세고, 미리 보기는 글로
  const g = groupOf(await w.ok('bob'), gid);
  assert.equal(g.chat.nu.length, 1);
  assert.equal(g.chat.tail.at(-1).t, '📷 사진 · 22번 이거 어떻게 풀어? 🙋');
  // 다시 보내도 (답을 못 받은 경우) 한 번만
  w.now += 2000;
  await w.ok('amy', photo({ g: gid, t: '22번 이거 어떻게 풀어? 🙋', c: 'ph0001' }));
  assert.equal(fileKeys(w).length, 2);
  // 나중에 들어온 사람, 그룹 밖 사람
  await w.ok('cat', { op: 'join', code, n: 'CAT' });
  assert.deepEqual((await w.ok('cat', { op: 'thumbs', g: gid, as: [x.a] })).th, { [x.a]: null }, '들어오기 전 사진은 안 보임');
  await w.err('cat', { op: 'file', g: gid, a: x.a }, 'gone');
  await w.err('dan', { op: 'thumbs', g: gid, as: [x.a] }, 'nogroup');
  await w.err('dan', { op: 'file', g: gid, a: x.a }, 'nogroup');
  // 이상한 요청
  await w.err('bob', { op: 'thumbs', g: gid, as: [] }, 'bad');
  await w.err('bob', { op: 'thumbs', g: gid, as: new Array(13).fill(0).map((_, i) => 'a'.repeat(11) + i.toString(36)) }, 'bad');
  await w.err('bob', { op: 'thumbs', g: gid, as: ['../x'] }, 'bad');
  await w.err('bob', { op: 'file', g: gid, a: 'nope' }, 'bad');
  w.now += 2000;
  await w.err('bob', photo({ g: gid, img: Buffer.from('<svg>').toString('base64') }), 'bad');
  await w.err('bob', photo({ g: gid, th: 'not base64!' }), 'bad');
  await w.err('bob', photo({ g: gid, w: 0 }), 'bad');
  await w.err('bob', photo({ g: gid, h: 5000 }), 'bad');
  await w.err('bob', photo({ g: gid, t: '가'.repeat(101) }), 'bad');
  await w.err('bob', photo({ g: gid, p: 'gif' }), 'bad');
  await w.err('bob', photo({ g: gid, img: jpeg(ATTACH.img + 1) }), 'big');
  await w.err('bob', photo({ g: gid, th: jpeg(ATTACH.thumb + 1) }), 'big');
  assert.equal(fileKeys(w).length, 2, '거절한 사진은 남지 않는다');
});

test('사진: 본문 크기 (사진·단어장을 붙인 메시지만 1.6MB까지)', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  await w.ok('amy', photo({ g: gid, img: jpeg(ATTACH.img) })); // 원본 900KB = base64 1.2MB
  const big = JSON.stringify(photo({ g: gid, img: jpeg(1300 * 1024) }));
  assert.ok(big.length > 1600000);
  const r = await w.call('amy', big);
  assert.deepEqual([r.status, r.body.error], [413, 'big']);
  await w.err('amy', { op: 'say', g: gid, t: '안녕', pad: 'x'.repeat(20000) }, 'bad');
  await w.err('amy', { op: 'chat', g: gid, p: 'img', pad: 'x'.repeat(20000) }, 'bad');
});

test('사진: 지우면 서버에서도 바로 지우고, 리더는 남의 사진도, 그룹을 없애면 모두', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob', 'cat']);
  w.now += MIN;
  const s1 = (await w.ok('bob', photo({ g: gid, t: '내 사진' }))).chat.ms.find((m) => m.p === 'img');
  w.now += 2000;
  const s2 = (await w.ok('cat', photo({ g: gid }))).chat.ms.findLast((m) => m.p === 'img');
  assert.equal(fileKeys(w).length, 4);
  const total0 = w.hub().get('ax').t;
  assert.equal(total0, 2 * (PHOTO.length + THUMB.length));
  await w.err('cat', { op: 'unsay', g: gid, s: s1.s }, 'lead');
  const d1 = await w.ok('bob', { op: 'unsay', g: gid, s: s1.s, since: 0 });
  const gone = d1.chat.ms.find((m) => m.s === s1.s);
  assert.deepEqual(Object.keys(gone).sort(), ['at', 'f', 'n', 's', 'v', 'x'], '지운 줄에는 사진·설명이 남지 않는다');
  assert.deepEqual(fileKeys(w), ['a:' + s2.a, 'a:' + s2.a + ':s']);
  assert.equal(w.hub().get('ax').t, total0 / 2);
  await w.err('amy', { op: 'file', g: gid, a: s1.a }, 'gone');
  assert.deepEqual((await w.ok('amy', { op: 'thumbs', g: gid, as: [s1.a] })).th, { [s1.a]: null });
  // 리더(amy)는 남의 사진도
  await w.ok('amy', { op: 'unsay', g: gid, s: s2.s });
  assert.deepEqual(fileKeys(w), []);
  assert.equal(w.hub().get('ax').t, 0);
  // 그룹을 없애면 사진도
  w.now += 2000;
  await w.ok('bob', photo({ g: gid }));
  w.now += 2000;
  await w.ok('amy', { op: 'say', g: gid, p: 'deck', deck: { n: 'Day 1', cs: [['a', 'b']] } });
  assert.equal(fileKeys(w).length, 3);
  await w.ok('amy', { op: 'drop', g: gid });
  assert.deepEqual(fileKeys(w), []);
  assert.deepEqual(w.hub().get('ax').a, {});
});

test('사진: 리더가 채팅을 끄면 작은 그림·원본도 못 받음', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  const x = (await w.ok('bob', photo({ g: gid }))).chat.ms.find((m) => m.p === 'img');
  await w.ok('amy', { op: 'edit', g: gid, chat: false });
  await w.err('bob', { op: 'thumbs', g: gid, as: [x.a] }, 'chatoff');
  await w.err('amy', { op: 'file', g: gid, a: x.a }, 'chatoff');
  await w.ok('amy', { op: 'edit', g: gid, chat: true });
  assert.equal((await w.ok('amy', { op: 'file', g: gid, a: x.a })).img, PHOTO);
});

test('사진: 한 사람 하루 20장, 그룹 하나 7일 100장, 저장소 전체 600MB', async () => {
  const w = world();
  const names = ['amy', 'bob', 'cat', 'dan', 'eve', 'fay'];
  const { gid } = await party(w, names);
  w.now += MIN;
  const small = { img: jpeg(2000), th: jpeg(500) };
  for (let i = 0; i < ATTACH.photoDay; i++) { w.now += 3500; await w.ok('amy', photo(Object.assign({ g: gid }, small))); }
  w.now += 3500;
  await w.err('amy', photo(Object.assign({ g: gid }, small)), 'photoday');
  await w.ok('amy', { op: 'say', g: gid, t: '글은 보낼 수 있어' });
  // 그룹 100장: 넷이 20장씩 더 보내면 100장
  for (const n of ['bob', 'cat', 'dan', 'eve']) for (let i = 0; i < ATTACH.photoDay; i++) { w.now += 3500; await w.ok(n, photo(Object.assign({ g: gid }, small))); }
  w.now += 3500;
  await w.err('fay', photo(Object.assign({ g: gid }, small)), 'photogroup');
  // 하루가 지나면 사람 상한은 다시, 그룹 상한은 7일이 지나야
  w.now += DAY;
  await w.err('amy', photo(Object.assign({ g: gid }, small)), 'photogroup');
  w.now += 6 * DAY;
  await w.ok('amy', photo(Object.assign({ g: gid }, small)));
  // 저장소 전체 상한 (거의 찬 것처럼 꾸민다)
  const ax = w.hub().get('ax');
  w.hub().set('ax', Object.assign({}, ax, { t: ATTACH.total - 1000 }));
  w.now += 3500;
  await w.err('bob', photo(Object.assign({ g: gid }, small)), 'space');
  await w.ok('bob', { op: 'say', g: gid, p: 'rec', r: REC }, 'space');
});

test('7일이 지난 사진·단어장은 한 시간 안에 서버에서 지운다 (조용한 그룹도), 150줄을 넘겨 밀려난 사진도', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  const { gid: quiet } = await party(w, ['cat', 'dan']);
  w.now += MIN;
  await w.ok('amy', photo({ g: gid }));
  w.now += 2000;
  await w.ok('cat', photo({ g: quiet, t: '조용한 그룹의 사진' }));
  w.now += 2000;
  await w.ok('cat', { op: 'say', g: quiet, p: 'deck', deck: { n: 'Day 2', cs: [['x', 'y']] } });
  assert.equal(fileKeys(w).length, 5);
  w.now += 7 * DAY - 10 * MIN;
  await w.ok('bob');
  assert.equal(fileKeys(w).length, 5, '7일 전에는 그대로');
  w.now += 70 * MIN; // 7일 + 1시간쯤
  await w.ok('bob'); // 아무 요청이나 (조용한 그룹 사람이 아니어도)
  assert.deepEqual(fileKeys(w), []);
  assert.equal(w.hub().get('ax').t, 0);
  assert.equal(JSON.stringify(w.hub().get('m:' + quiet)).includes('조용한 그룹의 사진'), false, '그 줄도 지운다');
  // 150줄을 넘겨 밀려난 사진
  await w.ok('amy', photo({ g: gid }));
  for (let i = 0; i < CHAT.keep; i++) { w.now += 3500; await w.ok(i % 2 ? 'amy' : 'bob', { op: 'say', g: gid, t: 'm' + i }); }
  assert.deepEqual(fileKeys(w), [], '줄이 밀려나면 사진도 지운다');
});

test('공부 기록 카드: 보낸 순간의 숫자만 줄에 담기고, 한마디 40자, 이상하면 거절', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  const a = await w.ok('amy', { op: 'say', g: gid, p: 'rec', r: Object.assign({ tasks: ['영어 단어 외우기'] }, REC), t: '오늘은 수학 위주로!', c: 'rec001', since: 0 });
  const x = a.chat.ms.find((m) => m.p === 'rec');
  assert.deepEqual([x.cap, x.t, x.r.m, x.r.sb.length, x.r.tasks], ['오늘은 수학 위주로!', '📊 오늘 공부 3시간 25분 · 오늘은 수학 위주로!', 205, 4, undefined]);
  assert.deepEqual(fileKeys(w), [], '카드는 파일 없이 줄에만');
  const b = (await w.ok('bob', { op: 'chat', g: gid, since: 0 })).chat.ms.find((m) => m.p === 'rec');
  assert.deepEqual(b.r, x.r);
  w.now += 2000;
  await w.err('amy', { op: 'say', g: gid, p: 'rec', r: Object.assign({}, REC, { m: -5 }) }, 'bad');
  await w.err('amy', { op: 'say', g: gid, p: 'rec', r: REC, t: '가'.repeat(41) }, 'bad');
  await w.err('amy', { op: 'say', g: gid, p: 'rec' }, 'bad');
  // 지우기
  const d = await w.ok('amy', { op: 'unsay', g: gid, s: x.s, since: 0 });
  assert.equal(d.chat.ms.find((m) => m.s === x.s).r, undefined);
});

test('단어장: 이름과 카드 앞·뒤만, 줄에는 장수와 앞 3장, 원본은 file로, 1000장까지, 하루 10개', async () => {
  const w = world();
  const { gid } = await party(w, ['amy', 'bob']);
  w.now += MIN;
  const cs = Array.from({ length: 30 }, (_, i) => ['word' + i, '뜻 ' + i]);
  cs[0] = ['abandon', '버리다, 포기하다 — '.repeat(5) + '끝'];
  const a = await w.ok('amy', { op: 'say', g: gid, p: 'deck', deck: { n: '수능 영단어 Day 12', cs, ease: 2.5 }, c: 'deck01', since: 0 });
  const x = a.chat.ms.find((m) => m.p === 'deck');
  assert.deepEqual([x.dn, x.cn, x.pv.length, x.t], ['수능 영단어 Day 12', 30, 3, '🗂️ 단어장 ‘수능 영단어 Day 12’ 카드 30장']);
  assert.ok([...x.pv[0][1]].length <= 60, '미리 보기는 짧게');
  assert.equal(x.pv[1][0], 'word1');
  const f = await w.ok('bob', { op: 'file', g: gid, a: x.a });
  assert.deepEqual(f.deck, { n: '수능 영단어 Day 12', cs: cs.map(([q, r]) => [q, r.trim()]) }, '덱 전체 (복습 기록은 없음)');
  assert.deepEqual((await w.ok('bob', { op: 'thumbs', g: gid, as: [x.a] })).th, { [x.a]: null }, '단어장은 작은 그림이 없다');
  w.now += 2000;
  await w.err('amy', { op: 'say', g: gid, p: 'deck', deck: { n: 'x', cs: new Array(1001).fill(['a', 'b']) } }, 'big');
  await w.err('amy', { op: 'say', g: gid, p: 'deck', deck: { n: 'x', cs: [['', 'b']] } }, 'bad');
  await w.err('amy', { op: 'say', g: gid, p: 'deck' }, 'bad');
  for (let i = 1; i < ATTACH.deckDay; i++) { w.now += 3500; await w.ok('amy', { op: 'say', g: gid, p: 'deck', deck: { n: 'd' + i, cs: [['a', 'b']] } }); }
  w.now += 3500;
  await w.err('amy', { op: 'say', g: gid, p: 'deck', deck: { n: 'd11', cs: [['a', 'b']] } }, 'deckday');
  // 1000장짜리 덱 (본문은 크지만 1.6MB 안)
  w.now += 3500;
  const k = await w.ok('bob', { op: 'say', g: gid, p: 'deck', deck: { n: '큰 덱', cs: Array.from({ length: 1000 }, (_, i) => ['단어'.repeat(40) + i, '뜻'.repeat(60) + i]) } });
  assert.equal(k.chat.ms.find((m) => m.dn === '큰 덱').cn, 1000);
});

test('붙인 것: 응답과 저장소에 이메일·로그인 번호·실제 이름이 없다', async () => {
  const w = world();
  const { gid } = await party(w, ['amy-uid-123', 'bob-uid-456']);
  w.now += MIN;
  const x = (await w.ok('amy-uid-123', photo({ g: gid, t: '사진' }))).chat.ms.find((m) => m.p === 'img');
  w.now += 2000;
  await w.ok('amy-uid-123', { op: 'say', g: gid, p: 'rec', r: REC });
  w.now += 2000;
  await w.ok('amy-uid-123', { op: 'say', g: gid, p: 'deck', deck: { n: 'd', cs: [['a', 'b']] } });
  const raws = [(await w.call('bob-uid-456', { op: 'chat', g: gid, since: 0 })).raw, (await w.call('bob-uid-456', { op: 'thumbs', g: gid, as: [x.a] })).raw];
  for (const raw of raws) for (const secret of ['amy-uid-123', 'bob-uid-456', '@example.com', 'Real ']) assert.ok(!raw.includes(secret), secret);
  const store = JSON.stringify([...w.hub()]);
  for (const secret of ['amy-uid-123', 'bob-uid-456', '@example.com', 'Real ']) assert.ok(!store.includes(secret), '저장소 ' + secret);
});
