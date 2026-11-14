/* AI 도우미 서버(worker/src/index.js) 테스트
 * 진짜 구글 열쇠·진짜 모델 대신, 여기서 만든 열쇠로 서명한 가짜 로그인 확인표와 가짜 모델을 쓴다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, verifyToken, isOwner, cleanMessages, pieceOf, Counter, forgetKeys } from '../worker/src/index.js';

const PROJECT = 'demo-project';
const ORIGIN = 'https://app.example';
const NOW = Date.UTC(2026, 10, 14, 3, 0, 0);
const DAY = 86400000;
const OWNER = 'owner@example.com';

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const b64json = (o) => b64(Buffer.from(JSON.stringify(o)));
const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, priv: pair.privateKey, pub: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' } };
}
const K1 = await makeKey('k1');
const K2 = await makeKey('k2');
const FAKE = await makeKey('k1'); // 번호(kid)는 같지만 다른 열쇠

async function token(over, key, head) {
  key = key || K1;
  const t = Math.floor(NOW / 1000);
  const body = Object.assign({
    iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: 'user-1', iat: t - 60, exp: t + 3000, auth_time: t - 600,
    email: 'someone@example.com', email_verified: true, firebase: { sign_in_provider: 'google.com' },
  }, over);
  const first = b64json(Object.assign({ alg: 'RS256', kid: key.kid, typ: 'JWT' }, head)) + '.' + b64json(body);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, new TextEncoder().encode(first));
  return first + '.' + b64(new Uint8Array(sig));
}

// 가짜 세상: 구글 열쇠 주소, 사람별 횟수 저장소, 모델
function world(opts) {
  opts = opts || {};
  const w = { keys: opts.keys || [K1.pub], keyCalls: 0, keysDown: false, runs: [], stores: new Map(), now: NOW };
  w.fetch = async () => {
    w.keyCalls++;
    if (w.keysDown) return new Response('no', { status: 500 });
    return new Response(JSON.stringify({ keys: w.keys }), { headers: { 'cache-control': 'public, max-age=3600, must-revalidate' } });
  };
  const storage = (id) => {
    if (!w.stores.has(id)) w.stores.set(id, new Map());
    const m = w.stores.get(id);
    return {
      get: async (k) => m.get(k),
      put: async (k, v) => { m.set(k, v); },
      list: async (o) => new Map([...m].filter(([k]) => k.startsWith((o && o.prefix) || ''))),
      delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); },
    };
  };
  w.answer = opts.answer || (() => sse(['안녕', '하세요']));
  w.env = Object.assign({
    FIREBASE_PROJECT_ID: PROJECT, DAILY_LIMIT: '20', MODEL: 'test-model', MAX_TOKENS: '1200', ALLOWED_ORIGINS: ORIGIN + ', https://second.example',
    OWNER_EMAILS: 'Owner@Example.com', OPEN_TO: 'all',
    AI: { run: async (model, input) => { w.runs.push({ model, input }); return w.answer(); } },
    COUNTER: {
      idFromName: (name) => name,
      get: (id) => ({ fetch: (url, init) => new Counter({ storage: storage(id) }).fetch(new Request(url, init)) }),
    },
  }, opts.env);
  w.ask = async (tok, o) => {
    o = o || {};
    const headers = { 'Content-Type': 'application/json' };
    if (o.origin !== null) headers.Origin = o.origin || ORIGIN;
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const req = new Request('https://ai.example' + (o.path || '/chat'), {
      method: o.method || 'POST', headers,
      body: (o.method || 'POST') === 'POST' ? (o.raw != null ? o.raw : JSON.stringify({ messages: o.messages || [{ role: 'user', content: '안녕' }] })) : undefined,
    });
    const res = await handle(req, w.env, { now: w.now, fetch: w.fetch });
    const text = await res.text();
    const type = res.headers.get('content-type') || '';
    const out = { status: res.status, headers: res.headers, raw: text };
    if (type.includes('event-stream')) {
      out.events = text.split('\n\n').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^data:\s*/, ''));
      out.done = out.events[out.events.length - 1] === '[DONE]';
      const objs = out.events.filter((s) => s !== '[DONE]').map((s) => JSON.parse(s));
      out.text = objs.map((j) => j.t || '').join('');
      out.left = (objs.find((j) => typeof j.left === 'number') || {}).left;
      out.unlimited = objs.some((j) => j.unlimited === true);
      out.error = (objs.find((j) => j.error) || {}).error;
    } else if (type.includes('json')) out.json = JSON.parse(text);
    return out;
  };
  return w;
}
// Workers AI가 답을 보내는 모양: data: {"response":"조각"} 줄들
function sse(pieces, cut) {
  const enc = new TextEncoder();
  const all = enc.encode(pieces.map((p) => 'data: ' + JSON.stringify(typeof p === 'string' ? { response: p } : p) + '\n\n').join('') + 'data: [DONE]\n\n');
  const size = cut || all.length;
  return new ReadableStream({
    start(c) { for (let i = 0; i < all.length; i += size) c.enqueue(all.slice(i, i + size)); c.close(); },
  });
}

test.beforeEach(() => forgetKeys());

test('주소: 미리 묻기(OPTIONS), 살아 있는지 보기(GET /), 없는 주소', async () => {
  const w = world();
  const pre = await w.ask(null, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
  const second = await w.ask(null, { method: 'OPTIONS', origin: 'https://second.example' });
  assert.equal(second.headers.get('access-control-allow-origin'), 'https://second.example');
  const other = await w.ask(null, { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(other.headers.get('access-control-allow-origin'), ORIGIN); // 모르는 곳에는 그 주소를 허락하지 않는다
  const home = await w.ask(null, { method: 'GET', path: '/' });
  assert.deepEqual(home.json, { ok: true, name: 'studypromotion-ai' });
  assert.equal((await w.ask(null, { method: 'GET', path: '/chat' })).status, 404);
  assert.equal((await w.ask(await token(), { path: '/other' })).status, 404);
  assert.equal(w.runs.length, 0);
});

test('다른 사이트에서 온 요청은 거절한다', async () => {
  const w = world();
  const r = await w.ask(await token(), { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'origin');
  assert.equal(w.runs.length, 0);
});

test('로그인 확인표가 없거나 가짜면 401', async () => {
  const w = world();
  const t = Math.floor(NOW / 1000);
  const bad = [
    null,
    'abc',
    'a.b.c',
    await token({ exp: t - 1 }),                                   // 기한이 지남
    await token({ iat: t + 600 }),                                 // 앞날에 만든 표
    await token({ aud: 'other-project' }),                         // 다른 앱의 표
    await token({ iss: 'https://securetoken.google.com/other' }),
    await token({ sub: '' }),
    await token({}, FAKE),                                         // 다른 열쇠로 서명
    await token({}, K1, { alg: 'none' }),
    await token({}, K2),                                           // 구글이 모르는 열쇠 번호
  ];
  for (const tok of bad) {
    const r = await w.ask(tok);
    assert.equal(r.status, 401, String(tok).slice(0, 20));
    assert.equal(r.json.error, 'login');
  }
  // 내용만 바꿔치기한 표
  const good = (await token()).split('.');
  const forged = [good[0], b64json({ iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: 'user-9', iat: t - 60, exp: t + 3000 }), good[2]].join('.');
  assert.equal((await w.ask(forged)).status, 401);
  assert.equal(w.runs.length, 0);
  assert.equal(w.stores.size, 0); // 횟수도 쓰지 않았다
});

test('로그인한 사람: 답이 조금씩 오고 남은 횟수가 온다', async () => {
  const w = world();
  const messages = [{ role: 'system', content: '지시문' }, { role: 'user', content: 'ojalá가 뭐야?' }];
  const r = await w.ask(await token(), { messages });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(r.text, '안녕하세요');
  assert.equal(r.left, 19);
  assert.equal(r.unlimited, false);
  assert.equal(r.done, true);
  assert.equal(w.runs.length, 1);
  assert.equal(w.runs[0].model, 'test-model');
  assert.deepEqual(w.runs[0].input, { messages, stream: true, max_tokens: 1200 });
  assert.equal(w.keyCalls, 1);
  await w.ask(await token());
  assert.equal(w.keyCalls, 1); // 구글 열쇠는 기억해 둔다
});

test('하루 20번을 다 쓰면 429, 다른 사람과 다음 날은 다시 된다', async () => {
  const w = world();
  const me = await token();
  for (let i = 0; i < 20; i++) {
    const r = await w.ask(me);
    assert.equal(r.left, 19 - i);
  }
  const over = await w.ask(me);
  assert.equal(over.status, 429);
  assert.deepEqual(over.json, { error: 'limit' });
  assert.equal(w.runs.length, 20); // 21번째는 모델을 부르지 않았다
  const friend = await w.ask(await token({ sub: 'user-2' }));
  assert.equal(friend.left, 19);
  w.now = NOW + DAY; // 0시 UTC(한국 오전 9시)가 지남
  const next = await w.ask(await token({ iat: Math.floor(w.now / 1000) - 60, exp: Math.floor(w.now / 1000) + 3000 }));
  assert.equal(next.left, 19);
  assert.deepEqual([...w.stores.get('user-1').keys()], ['n:2026-11-15']); // 지난날 기록은 지웠다
});

test('주인 계정(구글 로그인 + OWNER_EMAILS)은 횟수 제한이 없다', async () => {
  const w = world();
  const owner = await token({ sub: 'owner-1', email: OWNER });
  for (let i = 0; i < 25; i++) {
    const r = await w.ask(owner);
    assert.equal(r.status, 200);
    assert.equal(r.unlimited, true);
    assert.equal(r.left, undefined);
    assert.equal(r.done, true);
  }
  assert.equal(w.stores.size, 0); // 세지도 않는다
});

test('이메일만 같다고 주인이 되지는 않는다', async () => {
  const w = world();
  // 같은 이메일을 이메일·비밀번호 가입에 적은 사람, 확인 안 된 이메일
  const byPassword = await w.ask(await token({ sub: 'p-1', email: OWNER, firebase: { sign_in_provider: 'password' } }));
  assert.equal(byPassword.unlimited, false);
  assert.equal(byPassword.left, 19);
  const unverified = await w.ask(await token({ sub: 'p-2', email: OWNER, email_verified: false }));
  assert.equal(unverified.left, 19);
  const env = { OWNER_EMAILS: 'a@x.com, Owner@Example.com' };
  const g = { firebase: { sign_in_provider: 'google.com' }, email_verified: true };
  assert.equal(isOwner(Object.assign({ email: 'OWNER@example.com' }, g), env), true);
  assert.equal(isOwner(Object.assign({ email: 'a@x.com' }, g), env), true);
  assert.equal(isOwner(Object.assign({ email: 'b@x.com' }, g), env), false);
  assert.equal(isOwner(Object.assign({ email: '' }, g), env), false);
  assert.equal(isOwner(Object.assign({ email: OWNER }, g), {}), false); // 설정이 비어 있으면 주인이 없다
  assert.equal(isOwner(Object.assign({ email: OWNER }, g), { OWNER_EMAILS: '' }), false);
  assert.equal(isOwner(null, env), false);
});

test('앱 전체의 하루 무료 양을 다 쓰면 limit(all), 횟수는 돌려준다', async () => {
  const w = world();
  const me = await token();
  assert.equal((await w.ask(me)).left, 19);
  w.answer = () => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); };
  const r = await w.ask(me);
  assert.equal(r.status, 429);
  assert.deepEqual(r.json, { error: 'limit', scope: 'all' });
  w.answer = () => { throw new Error('boom'); };
  const s = await w.ask(me);
  assert.equal(s.status, 503);
  assert.deepEqual(s.json, { error: 'server' });
  w.answer = () => sse(['다시']);
  assert.equal((await w.ask(me)).left, 18); // 실패한 두 번은 세지 않았다
});

test('모델이 아무 말도 안 하면 오류로 알리고 횟수를 돌려준다', async () => {
  const w = world({ answer: () => sse([]) });
  const me = await token();
  const r = await w.ask(me);
  assert.equal(r.status, 200);
  assert.equal(r.error, 'server');
  assert.equal(r.done, false);
  w.answer = () => sse(['응']);
  assert.equal((await w.ask(me)).left, 19);
});

test('답이 잘게 쪼개져 와도(한글 중간에서도) 그대로 이어 붙인다', async () => {
  const pieces = ['스페인어로 ', '¡ojalá! ', '는 "~하면 좋겠다"', '라는 뜻이에요.\n', '둘째 줄'];
  for (const cut of [1, 2, 3, 7, 50]) {
    forgetKeys();
    const w = world({ answer: () => sse(pieces, cut) });
    const r = await w.ask(await token());
    assert.equal(r.text, pieces.join(''), 'cut ' + cut);
    assert.equal(r.done, true);
  }
});

test('모델마다 다른 답 모양을 읽는다', async () => {
  assert.equal(pieceOf('data: {"response":"가"}'), '가');
  assert.equal(pieceOf('data: {"choices":[{"delta":{"content":"나"}}]}'), '나');
  assert.equal(pieceOf('data: {"choices":[{"text":"다"}]}'), '다');
  assert.equal(pieceOf('data: {"choices":[{"delta":{}}]}'), '');
  assert.equal(pieceOf('data: {"response":""}'), '');
  assert.equal(pieceOf('data: {"response":null,"usage":{"total_tokens":3}}'), '');
  assert.equal(pieceOf('data: [DONE]'), '');
  assert.equal(pieceOf('data: {깨진'), '');
  assert.equal(pieceOf(': ping'), '');
  assert.equal(pieceOf(''), '');
  const open = world({ answer: () => sse([{ choices: [{ delta: { content: '오픈' } }] }, { choices: [{ delta: { content: ' 모양' } }] }]) });
  assert.equal((await open.ask(await token())).text, '오픈 모양');
  forgetKeys();
  const whole = world({ answer: () => ({ response: '한꺼번에' }) }); // 조금씩 보내지 않는 모델
  const r = await whole.ask(await token());
  assert.equal(r.text, '한꺼번에');
  assert.equal(r.left, 19);
});

test('받은 말 검사: 모양이 틀리면 400이고 횟수를 쓰지 않는다', async () => {
  const u = (content) => ({ role: 'user', content });
  const a = (content) => ({ role: 'assistant', content });
  const s = (content) => ({ role: 'system', content });
  assert.deepEqual(cleanMessages([s('지시'), u('가'), a('나'), u('다')]), [s('지시'), u('가'), a('나'), u('다')]);
  assert.deepEqual(cleanMessages([Object.assign(u('가'), { extra: 1 })]), [u('가')]); // 모르는 값은 버린다
  const bad = [
    undefined, null, 'x', {}, [],
    [u('')], [u('   ')], [u(3)], [null],
    [{ role: 'tool', content: 'x' }],
    [u('가'), s('지시')],                       // 지시문은 맨 앞에만
    [u('가'), a('나')],                         // 마지막은 사용자의 말
    [s('지시')],
    Array.from({ length: 17 }, () => u('가')),  // 너무 많음
    [u('가'.repeat(24001))],                    // 너무 김
  ];
  for (const b of bad) assert.equal(cleanMessages(b), null, String(JSON.stringify(b)).slice(0, 40));
  assert.notEqual(cleanMessages(Array.from({ length: 16 }, () => u('가'))), null);
  assert.notEqual(cleanMessages([u('가'.repeat(24000))]), null);

  const w = world();
  const me = await token();
  for (const raw of ['', '{', '[]', '{"messages":[]}', '{"messages":[{"role":"user","content":""}]}']) {
    const r = await w.ask(me, { raw });
    assert.equal(r.status, 400, raw);
    assert.equal(r.json.error, 'bad');
  }
  assert.equal(w.runs.length, 0);
  assert.equal((await w.ask(me)).left, 19);
});

test('구글이 열쇠를 바꾸면 다시 받아 온다', async () => {
  const w = world();
  assert.equal((await w.ask(await token())).status, 200);
  assert.equal(w.keyCalls, 1);
  w.keys = [K1.pub, K2.pub];
  const r = await w.ask(await token({ sub: 'user-3' }, K2));
  assert.equal(r.status, 200);
  assert.equal(w.keyCalls, 2);
  await w.ask(await token({ sub: 'user-3' }, K2));
  assert.equal(w.keyCalls, 2);
  w.now = NOW + 3601 * 1000; // 기억해 둔 시간이 지나면 다시 받는다
  const t = Math.floor(w.now / 1000);
  assert.equal((await w.ask(await token({ iat: t - 60, exp: t + 3000 }))).status, 200);
  assert.equal(w.keyCalls, 3);
});

test('구글 열쇠를 못 받아 오면 503 (로그인 탓으로 돌리지 않는다)', async () => {
  const w = world();
  w.keysDown = true;
  const r = await w.ask(await token());
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'server');
  w.keysDown = false;
  assert.equal((await w.ask(await token())).status, 200);
});

test('설정이 이상해도 버틴다: 하루 횟수 기본값, 프로젝트가 없으면 아무도 못 들어온다', async () => {
  const w = world({ env: { DAILY_LIMIT: 'abc', MAX_TOKENS: '', MODEL: '' } });
  const r = await w.ask(await token());
  assert.equal(r.left, 19);
  assert.equal(w.runs[0].model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(w.runs[0].input.max_tokens, 1200);
  forgetKeys();
  const zero = world({ env: { DAILY_LIMIT: '0' } });
  assert.equal((await zero.ask(await token())).status, 429); // 0이면 주인만 쓴다
  assert.equal((await zero.ask(await token({ sub: 'owner-1', email: OWNER }))).unlimited, true);
  assert.equal(await verifyToken(await token(), '', { now: NOW, fetch: w.fetch }), null);
  const user = await verifyToken(await token(), PROJECT, { now: NOW, fetch: w.fetch });
  assert.equal(user.sub, 'user-1');
});

test('먼저 써 보기: OPEN_TO가 all이 아니면 주인 계정만 쓸 수 있다', async () => {
  for (const value of ['owner', '', undefined, 'ALL ']) {
    forgetKeys();
    const w = world({ env: { OPEN_TO: value } });
    const open = value === 'ALL ';
    const friend = await w.ask(await token());
    assert.equal(friend.status, open ? 200 : 403, String(value));
    if (!open) {
      assert.deepEqual(friend.json, { error: 'closed' });
      assert.equal(w.runs.length, 0);
      assert.equal(w.stores.size, 0);
    }
    const owner = await w.ask(await token({ sub: 'owner-1', email: OWNER }));
    assert.equal(owner.status, 200);
    assert.equal(owner.unlimited, true);
  }
});

test('GET /me: AI 버튼을 보여 줄지, 남은 횟수가 몇 번인지 알려 준다', async () => {
  const me = (w, tok) => w.ask(tok, { method: 'GET', path: '/me' });
  const closed = world({ env: { OPEN_TO: 'owner' } });
  assert.deepEqual((await me(closed, null)).json, { open: false, signedIn: false });
  assert.deepEqual((await me(closed, await token())).json, { open: false, signedIn: true });
  assert.deepEqual((await me(closed, await token({ sub: 'owner-1', email: OWNER }))).json, { open: true, signedIn: true, unlimited: true });
  assert.equal((await me(closed, 'abc')).status, 401); // 가짜 확인표
  assert.equal((await closed.ask(null, { method: 'GET', path: '/me', origin: 'https://evil.example' })).status, 403);

  forgetKeys();
  const open = world();
  assert.deepEqual((await me(open, null)).json, { open: true, signedIn: false });
  assert.deepEqual((await me(open, await token())).json, { open: true, signedIn: true, unlimited: false, left: 20, limit: 20 });
  await open.ask(await token());
  await open.ask(await token());
  assert.deepEqual((await me(open, await token())).json, { open: true, signedIn: true, unlimited: false, left: 18, limit: 20 });
  assert.equal((await open.ask(await token())).left, 17); // 물어보는 것은 횟수를 쓰지 않는다
  assert.deepEqual((await me(open, await token({ sub: 'owner-1', email: OWNER }))).json, { open: true, signedIn: true, unlimited: true });
  assert.equal(open.runs.length, 3);
});
