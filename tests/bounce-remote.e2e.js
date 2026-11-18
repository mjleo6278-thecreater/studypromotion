// v3.9 벽 튕기기 전체 순위: 앱(js/bounce.js)과 진짜 서버 코드(worker/src/index.js의 /bounce)를 이어서 확인한다.
// 앱은 실제 주소(github.io)에서 열린 것처럼, 로그인(Firebase)은 가짜로 바꾸고, 서버 주소(workers.dev)로 가는 요청은
// 이 시험 안에서 서버 코드(handle)를 직접 불러 답한다. 로그인 확인표는 여기서 만든 열쇠로 서명한다. 바깥으로 나가는 요청은 없다.
// SHOTS=폴더 를 주면 미리 보기 그림을 그 폴더에 남긴다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const HOME = 'https://mjleo6278-thecreater.github.io';
const APP = HOME + '/studypromotion/';
const API = 'https://studypromotion-ai.mj-leo6278.workers.dev';
const PROJECT = 'studypromotionbyleo';
const SHOTS = process.env.SHOTS || '';

// 가짜 로그인: 구글 단추를 누르면 localStorage fakeNext 계정(없으면 g1)으로 로그인. 확인표는 window.__TOK에서
const FAKE = `
(function(){
  const USERS = { g1: { uid: 'g1', email: 'student@gmail.com' }, boss: { uid: 'boss', email: 'owner@example.com' } };
  let cur = null; const subs = [];
  const wrap = (u) => u && Object.assign({ getIdToken: async () => (window.__TOK || {})[u.uid] }, u);
  const setUser = (u) => { cur = wrap(u); try { localStorage.setItem('fakeUser', JSON.stringify(u)); } catch (e) {} subs.forEach((f) => f(cur)); };
  try { cur = wrap(JSON.parse(localStorage.getItem('fakeUser'))); } catch (e) {}
  const auth = {
    onAuthStateChanged(f) { subs.push(f); setTimeout(() => f(cur), 0); },
    getRedirectResult: async () => null,
    signInWithPopup: async () => setUser(USERS[localStorage.getItem('fakeNext') || 'g1']),
    signOut: async () => setUser(null),
  };
  const authFn = () => auth; authFn.GoogleAuthProvider = function () { this.setCustomParameters = () => {}; };
  const docs = {};
  const doc = (id) => ({
    get: async () => ({ exists: !!docs[id], data: () => docs[id] }),
    set: async (data) => { docs[id] = data; },
    onSnapshot() { return () => {}; },
  });
  window.firebase = { apps: [], initializeApp() { this.apps.push(1); }, auth: authFn, firestore: () => ({ enablePersistence: async () => {}, collection: () => ({ doc }) }) };
})();`;

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const b64json = (o) => b64(Buffer.from(JSON.stringify(o)));

(async () => {
  const W = await import('../worker/src/index.js');
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };

  // 로그인 확인표 (Firebase와 같은 모양, 여기서 만든 열쇠로 서명)
  const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async (sub, email) => {
    const t = Math.floor(Date.now() / 1000);
    const first = b64json({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + b64json({
      iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub, iat: t - 60, exp: t + 3600, auth_time: t - 60,
      email, email_verified: true, firebase: { sign_in_provider: 'google.com' },
    });
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(first));
    return first + '.' + b64(new Uint8Array(sig));
  };
  const TOK = { g1: await sign('g1', 'student@gmail.com'), boss: await sign('boss', 'owner@example.com') };
  const jwks = async () => new Response(JSON.stringify({ keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { headers: { 'cache-control': 'max-age=3600' } });

  // 서버: 진짜 서버 코드 + 기억 속 저장소. 다른 사람 세 명이 이미 올려 두었다
  const stores = new Map();
  const storage = (id) => {
    if (!stores.has(id)) stores.set(id, new Map());
    const m = stores.get(id);
    return {
      get: async (k) => m.get(k), put: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); },
      list: async (o) => new Map([...m].filter(([k]) => k.startsWith((o && o.prefix) || ''))),
      delete: async (ks) => { for (const k of [].concat(ks)) m.delete(k); },
    };
  };
  const t0 = Date.now() - 86400000;
  const ODD = SHOTS ? '민지' : '<img src=x onerror=alert(1)>'; // 미리 보기 그림에는 보통 별명
  storage(W.BOARD_STORE).put('board', [
    { id: 'aaaaaaaaaaaaaaaa', n: '슛돌이', s: 30, g: 8, sec: 95, t: t0 },
    { id: 'bbbbbbbbbbbbbbbb', n: ODD, s: 12, g: 3, sec: 50, t: t0 + 1000 }, // 앱이 글자로만 보여 주는지 (서버는 이런 별명을 받지 않는다)
    { id: 'cccccccccccccccc', n: 'Kai', s: 3, g: 0, sec: 21, t: t0 + 2000 },
  ]);
  const env = {
    FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: HOME, OWNER_EMAILS: 'owner@example.com', OPEN_TO: 'all', DAILY_LIMIT: '20',
    AI: { run: async () => { throw new Error('이 시험에서는 모델을 부르지 않는다'); } },
    COUNTER: { idFromName: (n) => n, get: (id) => ({ fetch: (url, init) => new W.Counter({ storage: storage(id) }).fetch(new Request(url, init)) }) },
  };
  const srv = { down: false, calls: [] };
  const board = () => stores.get(W.BOARD_STORE).get('board');

  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, locale: 'ko-KR', serviceWorkers: 'block', deviceScaleFactor: SHOTS ? 2 : 1 });
  await ctx.addInitScript((tok) => { window.__TOK = tok; try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ } }, TOK);
  await ctx.route(HOME + '/**', (route) => {
    let p = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/studypromotion/, '');
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript', body: r.request().url().includes('app-compat') ? FAKE : '' }));
  await ctx.route(API + '/**', async (route) => {
    const req = route.request();
    if (srv.down) return route.abort('internetdisconnected');
    const init = { method: req.method(), headers: await req.allHeaders() };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) init.body = req.postData() || '';
    const where = new URL(req.url()).pathname;
    if (where === '/bounce' && req.method() !== 'OPTIONS') srv.calls.push({ method: req.method(), auth: init.headers.authorization || '', body: init.body ? JSON.parse(init.body) : null });
    const res = await W.handle(new Request(req.url(), init), env, { now: Date.now(), fetch: jwks });
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // 일부러 낸 실패(인터넷 끊김, 서버가 거절한 기록)를 브라우저가 적는 줄은 뺀다
  page.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|status of (400|401)/.test(m.text()) && errors.push(m.text()));
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  const cardText = () => page.$eval('#bounce-card', (c) => (c.hidden ? '' : c.textContent.replace(/\s+/g, ' ')));
  const rows = () => page.$$eval('#bounce-card .bounce-board li', (ls) => ls.map((l) => ({ t: l.textContent, me: l.classList.contains('me') })));
  const settled = () => page.waitForFunction(() => { const b = document.querySelector('#bounce-card .bounce-board'); return b && !b.classList.contains('busy'); });
  const tap = async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.tap(); };
  const posts = () => srv.calls.filter((c) => c.method === 'POST');
  const openGame = async () => {
    await page.evaluate(() => { location.hash = '#about'; });
    await page.waitForSelector('#egg-input');
    await page.fill('#egg-input', '이강인');
    await page.press('#egg-input', 'Enter');
    await page.waitForSelector('#bounce:not([hidden])');
  };
  // 한 판: 점수·골·버틴 시간을 정해 두고 공을 놓친다
  const playTo = async (s, goals, sec) => {
    await tap('#bounce-card [data-b="start"], #bounce-card [data-b="again"]');
    await page.evaluate(([s, goals, sec]) => { const G = Bounce.game, b = G.ball; G.score = s; G.goals = goals; G.t = sec; G.cue = Math.floor(sec / 15); b.x = G.W * 0.1; b.y = G.py + 5; b.vx = 0; b.vy = 900; }, [s, goals, sec]);
    await page.waitForFunction(() => Bounce.game.state === 'over');
    await page.waitForSelector('#bounce-card.over:not([hidden])');
    await settled();
  };

  /* ===== 1) 로그인 전: 전체 순위를 볼 수 있고, 올리려면 로그인 ===== */
  await page.goto(APP);
  await page.waitForFunction(() => window.App && window.Bounce && window.Cloud);
  await openGame();
  await page.waitForFunction(() => document.querySelector('#bounce-card [data-b="rank"]'));
  assert(srv.calls.length === 1 && srv.calls[0].method === 'GET' && !srv.calls[0].auth, '게임을 열면 전체 순위를 미리 받아 둔다 (로그인 전이라 확인표 없이)');
  await tap('#bounce-card [data-b="rank"]');
  await settled();
  let r = await rows();
  assert(await page.$eval('#bounce-card', (c) => c.classList.contains('rank')) && /기록 순위/.test(await cardText()), "시작 카드의 '기록 순위 보기' → 순위 카드");
  assert(await page.$eval('#bounce-card [data-b="tab-all"]', (b) => b.classList.contains('active') && b.getAttribute('aria-selected') === 'true'), "'전체' 칸이 먼저 보임");
  assert(r.length === 3 && /^1슛돌이30점골 8 · 1분 35초$/.test(r[0].t) && /^3Kai3점/.test(r[2].t), '다른 사람들의 별명·점수·골·시간 ' + JSON.stringify(r.map((x) => x.t)));
  assert(r[1].t.includes(ODD) && !(await page.$('#bounce-card .bounce-board img')), '별명은 글자로만 보여 줌 (그림·스크립트가 되지 않음)');
  assert(/로그인하면 내 기록도 전체 순위에 올라가요/.test(await cardText()) && await page.$('#bounce-card [data-b="login"]'), '로그인 안 했으면 로그인 안내와 단추');
  assert(!(await page.$('#bounce-card .bb-rm')), '주인이 아니면 지우기 단추가 없음');
  await page.evaluate(() => Bounce.back());
  assert(await page.$eval('#bounce-card', (c) => c.classList.contains('ready')), '뒤로 → 순위 카드에서 시작 카드로');

  // 로그인 안 하고 한 판: 기록은 기기에 두고, 로그인하면 올릴 수 있다고 알려 준다
  await playTo(5, 1, 40);
  assert(/로그인하면 5점 기록을 전체 순위에 올릴 수 있어요/.test(await cardText()), '로그인 전 기록: 로그인하면 올릴 수 있다고 안내');
  assert(posts().length === 0 && JSON.parse(await page.evaluate(() => localStorage.getItem('studypromotion.eggSend'))).s === 5, '로그인 전에는 보내지 않고 기기에 둠');
  await tap('#bounce-card [data-b="tab-me"]');
  r = await rows();
  assert(r.length === 1 && r[0].me && /방금/.test(r[0].t), "'이 기기' 칸: 이 기기 기록 (방금 기록 표시)");
  await tap('#bounce-card [data-b="tab-all"]');
  assert((await rows()).length === 3, "'전체' 칸으로 돌아옴");

  /* ===== 2) 로그인 → 별명 정하기 → 못 올린 기록이 올라감 ===== */
  await tap('#bounce-card [data-b="login"]');
  await page.waitForFunction(() => !Bounce.isOpen() && location.hash === '#account');
  assert(true, "'로그인하기' → 게임을 닫고 계정 화면으로");
  await page.waitForSelector('#acc-google:not([disabled])');
  await page.click('#acc-google');
  await page.waitForFunction(() => Cloud.user);
  await page.waitForTimeout(200);
  assert(posts().length === 0, '별명이 없으면 로그인해도 아직 올리지 않음');
  await openGame();
  await page.waitForFunction(() => document.querySelector('#bounce-card [data-b="rank"]'));
  await page.waitForTimeout(300);
  assert(posts().length === 1 && posts()[0].auth.startsWith('Bearer ') && posts()[0].body.s === 5 && posts()[0].body.name === undefined, '다시 열면 못 올린 기록을 확인표와 함께 보냄 (별명 없이)');
  await tap('#bounce-card [data-b="rank"]');
  await settled();
  assert(/별명을 정하면 5점 기록이 전체 순위에 올라가요/.test(await cardText()), '서버가 별명을 달라고 하면 별명 정하기 안내');
  if (SHOTS) await page.waitForTimeout(3500); // 로그인 알림이 사라진 뒤에
  await shot('3-name-ask');
  await tap('#bounce-card [data-b="name"]');
  assert(await page.isVisible('#bounce-name') && await page.evaluate(() => document.activeElement.id === 'bn-input'), '별명 창이 열리고 입력칸에 초점');
  if (SHOTS) { await page.fill('#bn-input', '공부왕'); await page.waitForTimeout(800); await shot('4-name-box'); }
  await page.fill('#bn-input', 'www.a.com');
  await page.tap('#bn-ok');
  assert(await page.isVisible('#bounce-name') && await page.$eval('#bn-hint', (h) => h.classList.contains('bad')), '쓸 수 없는 별명(주소 모양)은 막고 규칙을 빨갛게');
  await page.fill('#bn-input', '  공부왕  ');
  await page.tap('#bn-ok');
  await page.waitForFunction(() => document.querySelector('#bounce-name').hidden);
  await settled();
  r = await rows();
  assert(posts().length === 2 && posts()[1].body.name === '공부왕', '정한 별명과 함께 기록을 보냄 (앞뒤 빈칸 없앰)');
  assert(r.length === 4 && r[2].me && /공부왕나5점/.test(r[2].t), '내 줄이 3위로 들어가고 ‘나’ 표시 ' + JSON.stringify(r.map((x) => x.t)));
  assert(/새 기록을 올렸어요! 전체 4명 중 3위/.test(await cardText()) && /별명 공부왕/.test(await cardText()), '올렸다는 안내, 내 순위, 별명');
  assert(!(await page.evaluate(() => localStorage.getItem('studypromotion.eggSend'))), '올린 기록은 기기에서 지움');
  const saved = board();
  assert(saved.length === 4 && !JSON.stringify(saved).includes('g1') && !JSON.stringify(saved).includes('student@'), '서버에는 별명·점수만 (계정 번호·이메일은 남지 않음)');

  /* ===== 3) 더 낮은 판은 순위가 그대로, 더 높은 판은 올라감 ===== */
  await tap('#bounce-card [data-b="start"]');
  await page.evaluate(() => Bounce.back()); // 판 도중에 닫았다가
  await openGame();
  await playTo(2, 0, 20);
  assert(posts().length === 3 && /내 최고 5점 · 전체 4명 중 3위/.test(await cardText()), '낮은 판: 보내지만 최고 기록은 그대로');
  await playTo(15, 4, 62);
  r = await rows();
  assert(r[1].me && /공부왕나15점골 4 · 1분 2초/.test(r[1].t) && /새 기록을 올렸어요! 전체 4명 중 2위/.test(await cardText()), '높은 판: 2위로 올라감');
  await shot('1-over-all');
  await tap('#bounce-card [data-b="tab-me"]');
  await shot('2-over-device');
  await tap('#bounce-card [data-b="tab-all"]');

  /* 가로 화면 */
  await page.setViewportSize({ width: 800, height: 380 });
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => {
    const s = document.querySelector('#bounce-stage').getBoundingClientRect(), c = document.querySelector('#bounce-card').getBoundingClientRect();
    const tabs = document.querySelector('#bounce-card .seg').getBoundingClientRect();
    return c.top >= s.top - 1 && c.bottom <= s.bottom + 1 && tabs.top >= c.top && tabs.right <= c.right;
  });
  assert(fit, '가로 화면: 순위 칸과 탭이 카드 안, 카드가 판 안');
  await shot('5-landscape');
  await page.setViewportSize({ width: 390, height: 800 });


  /* ===== 4) 별명 바꾸기 ===== */
  await tap('#bounce-card .bb-nick [data-b="name"]');
  assert(await page.inputValue('#bn-input') === '공부왕', '바꾸기 → 지금 별명이 채워진 창');
  await page.evaluate(() => Bounce.back());
  assert(await page.isHidden('#bounce-name') && await page.evaluate(() => Bounce.isOpen() && Bounce.game.state === 'over'), '뒤로 → 별명 창만 닫힘');
  await tap('#bounce-card .bb-nick [data-b="name"]');
  await page.fill('#bn-input', '강인팬');
  await page.press('#bn-input', 'Enter');
  await page.waitForFunction(() => /강인팬/.test(document.querySelector('#bounce-card .bounce-board').textContent));
  await settled();
  assert(posts().pop().body.rename === true && board().find((e) => e.s === 15).n === '강인팬', '별명만 바꾸면 서버의 내 줄 별명이 바뀜');

  /* ===== 5) 인터넷이 끊기면 기기에 두었다가 다시 올리기 ===== */
  srv.down = true;
  await playTo(20, 5, 80);
  assert(/인터넷에 연결되면 20점 기록을 올릴게요/.test(await cardText()) && JSON.parse(await page.evaluate(() => localStorage.getItem('studypromotion.eggSend'))).s === 20, '끊겼을 때: 기기에 두고 안내');
  assert((await rows()).length === 4, '끊겨도 전에 받은 순위는 그대로 보임');
  srv.down = false;
  await tap('#bounce-card [data-b="retry"]');
  await settled();
  r = await rows();
  assert(r[1].me && /강인팬나20점/.test(r[1].t) && /새 기록을 올렸어요! 전체 4명 중 2위/.test(await cardText()), "'다시 올리기' → 올라감 (2위) " + JSON.stringify(r.map((x) => x.t)));

  /* ===== 6) 말이 안 되는 기록은 서버가 받지 않는다 ===== */
  await playTo(500, 0, 5);
  assert(/이번 기록은 전체 순위에 올리지 못했어요/.test(await cardText()) && board().find((e) => e.n === '강인팬').s === 20, '5초에 500점: 거절되고 순위는 그대로');
  assert(!(await page.evaluate(() => localStorage.getItem('studypromotion.eggSend'))), '거절된 기록은 다시 보내지 않음');

  /* ===== 8) 주인 계정: 알맞지 않은 줄 지우기. 다른 계정의 별명은 쓰지 않는다 ===== */
  await page.evaluate(() => Bounce.close());
  await page.evaluate(() => { localStorage.setItem('fakeNext', 'boss'); });
  await page.evaluate(() => { location.hash = '#account'; });
  await page.evaluate(() => firebase.auth().signOut());
  await page.waitForFunction(() => !Cloud.user);
  await page.waitForSelector('#acc-google:not([disabled])');
  await page.click('#acc-google');
  await page.waitForFunction(() => Cloud.user && Cloud.user.uid === 'boss');
  await openGame();
  await tap('#bounce-card [data-b="rank"]');
  await settled();
  assert(!/별명 강인팬/.test(await cardText()) && !(await page.$('#bounce-card li.me')), '다른 계정으로 로그인하면 앞 계정의 별명·줄을 내 것으로 보이지 않음');
  const rm = await page.$$eval('#bounce-card .bb-rm', (bs) => bs.map((b) => b.dataset.n));
  assert(rm.length === 4, '주인 계정은 줄마다 지우기 단추');
  await tap('#bounce-card .bb-rm[data-id="bbbbbbbbbbbbbbbb"]');
  await page.waitForSelector('#ask:not([hidden])');
  assert(/기록을 전체 순위에서 지울까요/.test(await page.textContent('#ask-msg')), '지우기 전에 확인');
  await page.tap('#ask-ok');
  await page.waitForFunction(() => document.querySelectorAll('#bounce-card .bounce-board li').length === 3);
  assert(board().length === 3 && !board().some((e) => e.id === 'bbbbbbbbbbbbbbbb'), '확인하면 서버에서 그 줄이 지워짐');

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
