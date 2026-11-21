/* AI 도우미 서버(worker/src/index.js) 테스트
 * 진짜 구글 열쇠·진짜 모델 대신, 여기서 만든 열쇠로 서명한 가짜 로그인 확인표와 가짜 모델을 쓴다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, verifyToken, isOwner, cleanMessages, textOf, hasImage, pieceOf, Counter, forgetKeys, cleanName, cleanScore, maxScore, BOARD_TOP, BOARD_KEEP, BOARD_STORE } from '../worker/src/index.js';

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
    AI: { run: async (model, input) => { w.runs.push({ model, input }); return w.answer(input); } },
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
      body: (o.method || 'POST') === 'POST' ? (o.raw != null ? o.raw : JSON.stringify({ messages: o.messages || [{ role: 'user', content: '안녕' }], v: o.v, again: o.again })) : undefined,
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
  // 생각하기는 끄고(켜 두면 생각에 답 길이를 다 쓴다), 쓴 양을 마지막 줄에 붙여 달라고 한다
  assert.deepEqual(w.runs[0].input, {
    messages, stream: true, max_tokens: 1200, max_completion_tokens: 1200,
    chat_template_kwargs: { enable_thinking: false }, stream_options: { include_usage: true },
  });
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
  assert.deepEqual([...w.stores.get('user-1').keys()].filter((k) => k.startsWith('n:')), ['n:2026-11-15']); // 지난날 기록은 지웠다
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
  assert.equal(w.runs.length, 2); // 무료 양을 다 썼을 때는 다시 묻지 않는다
  w.answer = () => { throw new Error('boom'); };
  const s = await w.ask(me);
  assert.equal(s.status, 503);
  assert.deepEqual(s.json, { error: 'server' }); // 주인이 아닌 사람에게는 까닭을 적어 보내지 않는다
  assert.equal(w.runs.length, 5); // 덧붙인 설정을 하나씩 빼고 두 번 더 물었다
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
  assert.equal(r.left, 49);
  assert.equal(w.runs[0].model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(w.runs[0].input.max_tokens, 2000);
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
  assert.deepEqual((await me(closed, await token({ sub: 'owner-1', email: OWNER }))).json, { open: true, signedIn: true, unlimited: true, photo: true });
  assert.equal((await me(closed, 'abc')).status, 401); // 가짜 확인표
  assert.equal((await closed.ask(null, { method: 'GET', path: '/me', origin: 'https://evil.example' })).status, 403);

  forgetKeys();
  const open = world();
  assert.deepEqual((await me(open, null)).json, { open: true, signedIn: false });
  assert.deepEqual((await me(open, await token())).json, { open: true, signedIn: true, unlimited: false, left: 20, limit: 20, photo: false });
  await open.ask(await token());
  await open.ask(await token());
  assert.deepEqual((await me(open, await token())).json, { open: true, signedIn: true, unlimited: false, left: 18, limit: 20, photo: false });
  assert.equal((await open.ask(await token())).left, 17); // 물어보는 것은 횟수를 쓰지 않는다
  assert.deepEqual((await me(open, await token({ sub: 'owner-1', email: OWNER }))).json, { open: true, signedIn: true, unlimited: true, photo: true });
  assert.equal(open.runs.length, 3);
  forgetKeys();
  const photo = world({ env: { PHOTO_TO: 'all' } });
  assert.equal((await me(photo, await token())).json.photo, true);
});

/* ---------- 새 앱(v 2): 모델이 보내는 줄을 그대로 넘긴다 ---------- */
test('v 2: 모델의 답을 손대지 않고 넘기고, 남은 횟수는 머리말로 알린다', async () => {
  const chunks = [
    { choices: [{ delta: { reasoning_content: '생각' } }] },
    { choices: [{ delta: { content: '안녕' } }] },
    { choices: [{ delta: { content: '하세요' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 30, completion_tokens: 12 } },
  ];
  const w = world({ answer: () => sse(chunks, 7) });
  const r = await w.ask(await token(), { v: 2 });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  assert.equal(r.raw, chunks.map((c) => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n');
  assert.equal(r.headers.get('x-ai-left'), '19');
  assert.equal(r.headers.get('x-ai-unlimited'), null);
  assert.equal(r.headers.get('x-ai-mode'), 'full');
  assert.match(r.headers.get('access-control-expose-headers'), /X-AI-Left.*X-AI-Unlimited.*X-AI-Mode/);
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);

  const boss = await w.ask(await token({ sub: 'owner-1', email: OWNER }), { v: 2 });
  assert.equal(boss.headers.get('x-ai-unlimited'), '1');
  assert.equal(boss.headers.get('x-ai-left'), null);

  // 예전 앱(v 없음)에는 예전 모양으로 보낸다
  const old = await w.ask(await token());
  assert.equal(old.text, '안녕하세요');
  assert.equal(old.left, 18);
  assert.equal(old.done, true);
});

test('v 2: 한꺼번에 온 답도 같은 모양으로, 빈 답은 오류로 알리고 횟수를 돌려준다', async () => {
  const w = world({ answer: () => ({ response: '한꺼번에' }) });
  const me = await token();
  const r = await w.ask(me, { v: 2 });
  assert.equal(r.raw, 'data: {"response":"한꺼번에"}\n\ndata: [DONE]\n\n');
  assert.equal(r.headers.get('x-ai-left'), '19');
  w.answer = () => ({});
  const none = await w.ask(me, { v: 2 });
  assert.equal(none.status, 503);
  assert.deepEqual(none.json, { error: 'server' });
  w.answer = () => sse(['응']);
  assert.equal((await w.ask(me, { v: 2 })).headers.get('x-ai-left'), '18'); // 빈 답은 세지 않았다
});

test('생각하기: 기본은 끄고 THINKING이 on일 때만 켠다', async () => {
  const w = world();
  await w.ask(await token());
  assert.deepEqual(w.runs[0].input.chat_template_kwargs, { enable_thinking: false });
  forgetKeys();
  const on = world({ env: { THINKING: 'on' } });
  await on.ask(await token());
  assert.deepEqual(on.runs[0].input.chat_template_kwargs, { enable_thinking: true });
});

test('모델이 덧붙인 설정을 받지 않으면 꼭 필요한 것만으로 한 번 더 묻는다', async () => {
  const w = world();
  w.answer = (input) => { if (input.chat_template_kwargs) throw new Error('5006: unknown field chat_template_kwargs'); return sse(['됐어요']); };
  const messages = [{ role: 'user', content: '안녕' }];
  const r = await w.ask(await token(), { v: 2, messages });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-ai-mode'), 'plain');
  assert.equal(r.headers.get('x-ai-left'), '19'); // 한 번만 센다
  assert.equal(w.runs.length, 3);
  assert.deepEqual(w.runs[2].input, { messages, stream: true, max_tokens: 1200 });
});

test('생각하기 끄기는 되도록 남긴다: 다른 설정만 받지 않으면 그것만 빼고 묻는다 (v3.3.1)', async () => {
  const w = world();
  w.answer = (input) => { if (input.max_completion_tokens || input.stream_options) throw new Error('5006: unknown field stream_options'); return sse(['됐어요']); };
  const messages = [{ role: 'user', content: '안녕' }];
  const r = await w.ask(await token(), { v: 2, messages });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-ai-mode'), 'mid');
  assert.equal(w.runs.length, 2);
  assert.deepEqual(w.runs[1].input, { messages, stream: true, max_tokens: 1200, chat_template_kwargs: { enable_thinking: false } });
});

test('앱 정보를 붙여 같은 질문을 바로 다시 묻는 것은 한 번만 세지 않는다 (v3.3.1)', async () => {
  const w = world();
  const me = await token();
  const q = (content) => [{ role: 'user', content }];
  assert.equal((await w.ask(me, { v: 2, messages: q('내일 일정 알려줘') })).headers.get('x-ai-left'), '19');
  const again = await w.ask(me, { v: 2, messages: [{ role: 'system', content: '앱 정보' }, { role: 'user', content: '내일 일정 알려줘' }], again: true });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('x-ai-left'), '19'); // 세지 않았다
  // 한 번만: 또 다시 묻거나, 다른 질문으로 다시 묻는다고 하면 센다
  assert.equal((await w.ask(me, { v: 2, messages: q('내일 일정 알려줘'), again: true })).headers.get('x-ai-left'), '18');
  assert.equal((await w.ask(me, { v: 2, messages: q('다른 질문'), again: true })).headers.get('x-ai-left'), '17');
  // 시간이 많이 지나면 센다
  await w.ask(me, { v: 2, messages: q('모레 일정') });
  w.now += 3 * 60 * 1000;
  assert.equal((await w.ask(me, { v: 2, messages: q('모레 일정'), again: true })).headers.get('x-ai-left'), '15');
  // 세지 않은 질문이 실패해도 횟수를 돌려주지 않는다(센 적이 없으니까)
  await w.ask(me, { v: 2, messages: q('글피 일정') });
  w.answer = () => { throw new Error('boom'); };
  assert.equal((await w.ask(me, { v: 2, messages: q('글피 일정'), again: true })).status, 503);
  w.answer = () => sse(['응']);
  assert.equal((await w.ask(me, { v: 2, messages: q('새 질문') })).headers.get('x-ai-left'), '13');
  // 저장소에는 질문의 글이 남지 않는다
  const kept = JSON.stringify([...w.stores.values()].flatMap((m) => [...m.values()]));
  assert.doesNotMatch(kept, /일정|질문/);
});

test('모델이 오류를 내면 주인 계정에만 까닭을 적어 보낸다', async () => {
  const w = world({ answer: () => { throw new Error('3040: capacity temporarily exceeded'); } });
  const boss = await w.ask(await token({ sub: 'owner-1', email: OWNER }), { v: 2 });
  assert.equal(boss.status, 503);
  assert.deepEqual(boss.json, { error: 'server', detail: '3040: capacity temporarily exceeded' });
  const other = await w.ask(await token(), { v: 2 });
  assert.equal(other.status, 503);
  assert.deepEqual(other.json, { error: 'server' });
  w.answer = () => sse(['응']);
  assert.equal((await w.ask(await token(), { v: 2 })).headers.get('x-ai-left'), '19'); // 실패는 세지 않았다
});

/* ---------- 벽 튕기기 전체 순위 (/bounce) ---------- */
const post = (w, tok, body, o) => w.ask(tok, Object.assign({ path: '/bounce', raw: JSON.stringify(body) }, o));
const look = (w, tok, o) => w.ask(tok, Object.assign({ path: '/bounce', method: 'GET' }, o));

test('순위 별명·기록 검사', () => {
  assert.equal(cleanName('  민재  '), '민재');
  assert.equal(cleanName('Kang  in-7_K'), 'Kang in-7_K');
  assert.equal(cleanName('가나다라마바사아자차카타'), '가나다라마바사아자차카타'); // 12글자
  assert.equal(cleanName('가나다라마바사아자차카타파'), null); // 13글자
  for (const bad of ['', '   ', 'a.com', 'http://x', '<b>', '😀', 'a/b', 12, null]) assert.equal(cleanName(bad), null, String(bad));
  assert.equal(cleanName('한'), '한'); // 풀어 쓴 한글은 합친다
  assert.deepEqual(cleanScore({ s: 12, g: 3, sec: 40, extra: 1 }), { s: 12, g: 3, sec: 40 });
  assert.equal(cleanScore({ s: 0, g: 0, sec: 10 }), null);
  assert.equal(cleanScore({ s: 5, g: 4, sec: 30 }), null); // 골이 너무 많다
  assert.deepEqual(cleanScore({ s: 1, g: 1, sec: 3 }), { s: 1, g: 1, sec: 3 }); // 첫 공이 바로 골
  assert.equal(cleanScore({ s: 1.5, g: 0, sec: 10 }), null);
  assert.equal(cleanScore({ s: '9', g: 0, sec: 10 }), null);
  assert.equal(cleanScore({ s: maxScore(30) + 1, g: 0, sec: 30 }), null); // 30초에 낼 수 없는 점수
  assert.ok(cleanScore({ s: maxScore(30), g: 0, sec: 30 }));
  assert.ok(maxScore(60) > 2.4 * (60 + 0.006 * 3600) + 2); // 진짜로 낼 수 있는 가장 큰 점수보다 넉넉하다
});

test('순위: 로그인 없이 보기, 올리려면 로그인과 별명', async () => {
  const w = world({ env: { OPEN_TO: 'owner' } }); // AI 도우미를 닫아 두어도 순위는 쓴다
  const empty = await look(w, null);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { signedIn: false, ok: true, top: [], total: 0, me: null, owner: false });
  assert.equal(empty.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await post(w, null, { s: 3, g: 1, sec: 20, name: '민재' })).json.error, 'login');
  const me = await token();
  const noName = await post(w, me, { s: 3, g: 1, sec: 20 });
  assert.equal(noName.status, 400);
  assert.equal(noName.json.error, 'name');
  assert.equal((await post(w, me, { s: 3, g: 1, sec: 20, name: 'www.x.com' })).json.error, 'badname');
  assert.equal((await post(w, me, { s: 999, g: 1, sec: 20, name: '민재' })).json.error, 'bad'); // 20초에 999점은 말이 안 된다
  assert.equal((await post(w, me, { name: '민재' })).json.error, 'bad'); // 기록도 별명 바꾸기도 아님
  const first = await post(w, me, { s: 3, g: 1, sec: 20, name: '민재' });
  assert.equal(first.status, 200);
  assert.equal(first.json.better, true);
  assert.equal(first.json.total, 1);
  assert.deepEqual(first.json.me, { rank: 1, n: '민재', s: 3, g: 1, sec: 20, t: NOW, me: true });
  assert.equal(first.json.top[0].id, undefined); // 다른 사람의 번호는 주인에게만
  assert.equal((await post(w, me, { s: 3, g: 1, sec: 20 }, { origin: 'https://evil.example' })).status, 403);
  // 저장소에는 사용자 번호·이메일이 그대로 남지 않는다
  const kept = JSON.stringify([...w.stores.get(BOARD_STORE).values()]);
  assert.doesNotMatch(kept, /user-1|someone@example/);
  assert.equal(w.runs.length, 0); // 모델은 부르지 않는다
  // 로그인한 사람이 보면 내 줄이 표시된다. 틀린 확인표면 그냥 로그인 안 한 사람으로 보여 준다
  assert.equal((await look(w, me)).json.top[0].me, true);
  const bad = await look(w, me + 'x');
  assert.equal(bad.status, 200);
  assert.equal(bad.json.signedIn, false);
  assert.equal(bad.json.top[0].me, undefined);
});

test('순위: 한 사람에 한 줄, 더 높을 때만 바꾸고, 같은 점수는 먼저 낸 사람이 위', async () => {
  const w = world();
  const a = await token({ sub: 'a' }), b = await token({ sub: 'b' }), c = await token({ sub: 'c' });
  await post(w, a, { s: 10, g: 2, sec: 40, name: '가' });
  w.now += 1000;
  await post(w, b, { s: 10, g: 4, sec: 30, name: '나' });
  w.now += 1000;
  let r = await post(w, c, { s: 25, g: 5, sec: 60, name: '다' });
  assert.deepEqual(r.json.top.map((e) => [e.rank, e.n, e.s]), [[1, '다', 25], [2, '가', 10], [3, '나', 10]]);
  // 낮은 기록은 바꾸지 않는다 (별명도 그대로: 처음 올릴 때만 쓴다)
  r = await post(w, a, { s: 4, g: 0, sec: 20, name: '바뀐이름' });
  assert.equal(r.json.better, false);
  assert.deepEqual([r.json.me.rank, r.json.me.n, r.json.me.s, r.json.me.t], [2, '가', 10, NOW]);
  // 높으면 바꾸고 순서를 다시 맞춘다
  w.now += 1000;
  r = await post(w, b, { s: 30, g: 6, sec: 70 });
  assert.equal(r.json.better, true);
  assert.deepEqual(r.json.top.map((e) => e.n), ['나', '다', '가']);
  assert.equal(r.json.total, 3);
  // 별명 바꾸기
  r = await post(w, a, { name: '새 별명', rename: true });
  assert.equal(r.json.me.n, '새 별명');
  assert.equal(r.json.better, false);
  // 기록이 없는 사람이 별명만 바꾸면 아무것도 남지 않는다
  r = await post(w, await token({ sub: 'd' }), { name: '라', rename: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.me, null);
  assert.equal(r.json.total, 3);
});

test('순위: 위 20줄만 보내고 내 순위는 따로, 500명까지 남긴다', async () => {
  const w = world();
  // 저장소에 미리 많은 사람을 넣어 둔다 (요청 520번 대신)
  const many = Array.from({ length: BOARD_KEEP }, (_, i) => ({ id: 'p' + i, n: '사람' + i, s: 1000 - i, g: 0, sec: 600, t: NOW - 1000 }));
  w.stores.set(BOARD_STORE, new Map([['board', many]]));
  const me = await token({ sub: 'late' });
  let r = await post(w, me, { s: 991, g: 0, sec: 600, name: '늦게' });
  assert.equal(r.json.top.length, BOARD_TOP);
  assert.equal(r.json.total, BOARD_KEEP); // 꼴찌가 빠지고 내가 들어갔다
  assert.equal(r.json.me.rank, 11); // 991점: 1000~992점 9명과 먼저 낸 991점 1명 다음
  assert.equal(r.json.top[10].me, true);
  assert.deepEqual([r.json.top[9].s, r.json.top[9].me], [991, undefined]);
  assert.equal(r.json.top[11].s, 990);
  // 남겨 두는 끝보다 낮은 기록은 들어가지 못한다
  r = await post(w, await token({ sub: 'low' }), { s: 1, g: 0, sec: 10, name: '낮음' });
  assert.equal(r.json.me, null);
  assert.equal(r.json.total, BOARD_KEEP);
});

test('순위: 주인 계정만 줄을 지울 수 있다', async () => {
  const w = world();
  const a = await token({ sub: 'a' });
  await post(w, a, { s: 8, g: 1, sec: 30, name: '나쁜별명' });
  const boss = await token({ sub: 'owner-1', email: OWNER });
  const seen = await look(w, boss);
  assert.equal(seen.json.owner, true);
  const id = seen.json.top[0].id;
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal((await post(w, a, { remove: id })).json.error, 'owner');
  assert.equal((await post(w, await token({ sub: 'b' }), { remove: id })).status, 403);
  const gone = await post(w, boss, { remove: id });
  assert.equal(gone.status, 200);
  assert.equal(gone.json.total, 0);
  // 다시 올릴 수 있다 (처음처럼 별명이 필요)
  assert.equal((await post(w, a, { s: 3, g: 0, sec: 20 })).json.error, 'name');
});

/* ---------- 사진 보내기 (v4.4) ---------- */
const JPG = 'data:image/jpeg;base64,' + '/9j/4AAQSkZJRg'.padEnd(4000, 'A');
const withPhoto = (text, url) => [{ role: 'system', content: '지시' }, { role: 'user', content: [{ type: 'image_url', image_url: { url: url || JPG } }].concat(text == null ? [] : [{ type: 'text', text }]) }];

test('사진: 마지막 질문에만 한 장, 앞머리와 길이만 본다', () => {
  const ok = cleanMessages(withPhoto('해석해 줘'));
  assert.deepEqual(ok[1].content, [{ type: 'image_url', image_url: { url: JPG } }, { type: 'text', text: '해석해 줘' }]);
  assert.equal(hasImage(ok), true);
  assert.equal(hasImage(cleanMessages([{ role: 'user', content: '가' }])), false);
  assert.equal(textOf(ok[1].content), '해석해 줘');
  assert.equal(textOf('글'), '글');
  // 글 없이 사진만 / 글이 앞에 와도 된다 / 모르는 값은 버린다
  assert.deepEqual(cleanMessages(withPhoto(null))[1].content, [{ type: 'image_url', image_url: { url: JPG } }]);
  assert.notEqual(cleanMessages([{ role: 'user', content: [{ type: 'text', text: '가' }, { type: 'image_url', image_url: { url: JPG, detail: 'high', x: 1 } }] }]), null);
  assert.deepEqual(cleanMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: JPG, x: 1 } }] }])[0].content, [{ type: 'image_url', image_url: { url: JPG } }]);
  const img = (url) => ({ type: 'image_url', image_url: { url } });
  const bad = [
    [{ role: 'user', content: [img(JPG), img(JPG)] }],                                     // 두 장
    [{ role: 'user', content: [img(JPG)] }, { role: 'assistant', content: '나' }, { role: 'user', content: '다' }], // 지난 말의 사진
    [{ role: 'system', content: [img(JPG)] }],
    [{ role: 'user', content: [] }],
    [{ role: 'user', content: [{ type: 'text', text: '가' }] }],                             // 사진 없는 배열
    [{ role: 'user', content: [img('https://example.com/a.jpg')] }],                        // 주소로 된 사진은 받지 않는다
    [{ role: 'user', content: [img('data:image/gif;base64,R0lGOD')] }],
    [{ role: 'user', content: [img('data:text/html;base64,PGh0bWw+')] }],
    [{ role: 'user', content: [img(JPG.padEnd(1500001, 'A'))] }],                            // 너무 큼
    [{ role: 'user', content: [img(JPG), { type: 'audio', x: 1 }] }],
    [{ role: 'user', content: [img(JPG), { type: 'text', text: '가'.repeat(24001) }] }],     // 글은 그대로 센다
  ];
  for (const b of bad) assert.equal(cleanMessages(b), null, JSON.stringify(b).slice(0, 80));
  assert.notEqual(cleanMessages([{ role: 'user', content: [img(JPG.padEnd(1500000, 'A'))] }]), null);
});

test('사진: PHOTO_TO가 all이 아니면 주인 계정만 보낼 수 있고, 사진 질문도 한 번으로 센다', async () => {
  const w = world({ env: { PHOTO_TO: 'owner' } });
  const friend = await w.ask(await token(), { messages: withPhoto('해석해 줘'), v: 2 });
  assert.equal(friend.status, 403);
  assert.deepEqual(friend.json, { error: 'photo' });
  assert.equal(w.runs.length, 0);
  assert.equal(w.stores.size, 0); // 횟수를 쓰지 않는다
  const owner = await w.ask(await token({ sub: 'owner-1', email: OWNER }), { messages: withPhoto('해석해 줘'), v: 2 });
  assert.equal(owner.status, 200);
  assert.deepEqual(w.runs[0].input.messages[1].content[0], { type: 'image_url', image_url: { url: JPG } }); // 사진을 그대로 모델에 넘긴다

  forgetKeys();
  const all = world({ env: { PHOTO_TO: 'all' } });
  const r = await all.ask(await token(), { messages: withPhoto('해석해 줘'), v: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-ai-left'), '19');
  assert.equal(all.runs[0].input.messages[1].content[1].text, '해석해 줘');
  // 앱 정보를 붙여 다시 묻는 것은 한 번만 센다 (사진이 같으면 같은 질문)
  const again = await all.ask(await token(), { messages: withPhoto('해석해 줘'), v: 2, again: true });
  assert.equal(again.headers.get('x-ai-left'), '19');
  const other = await all.ask(await token(), { messages: withPhoto('해석해 줘', JPG + 'BBBB'), v: 2, again: true });
  assert.equal(other.headers.get('x-ai-left'), '18'); // 다른 사진은 새 질문
  // 서버는 사진을 어디에도 남기지 않는다 (횟수 저장소에는 횟수와 짧은 지문만)
  for (const m of all.stores.values()) for (const v of m.values()) assert.ok(!JSON.stringify(v).includes('/9j/'));
});

test('사진: 모델이 사진을 받지 못하면 횟수를 돌려주고, 주인에게만 까닭을 알려 준다', async () => {
  const w = world({ env: { PHOTO_TO: 'all' } });
  w.answer = () => { throw new Error('AiError: image could not be decoded'); };
  const r = await w.ask(await token(), { messages: withPhoto('해석해 줘'), v: 2 });
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { error: 'server' });
  assert.equal(w.runs.length, 3); // full → mid → plain
  const me = await w.ask(await token(), { method: 'GET', path: '/me' });
  assert.equal(me.json.left, 20);
  const owner = await w.ask(await token({ sub: 'owner-1', email: OWNER }), { messages: withPhoto('해석해 줘'), v: 2 });
  assert.match(owner.json.detail, /could not be decoded/);
});
