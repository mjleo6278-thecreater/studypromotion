// v4.1 그룹 채팅: 앱(js/groupchat.js)과 진짜 서버 코드(worker/src/index.js의 /group op chat·say·unsay)를 이어서, 친구 여럿이 채팅하는 모습을 확인한다.
// 앱은 실제 주소(github.io)에서 열린 것처럼, 로그인(Firebase)은 가짜로 바꾸고, 서버 주소(workers.dev)로 가는 요청은
// 이 시험 안에서 서버 코드(handle)를 직접 불러 답한다 (tests/group.e2e.js와 같은 준비). 바깥으로 나가는 요청은 없다.
// 브라우저 셋(나·지우·하준, 지우는 컴퓨터로도)과, 서버에 직접 요청하는 친구 둘(서연·도윤)이 한 그룹에서 이야기한다.
// SHOTS=폴더 를 주면 미리 보기 그림을 그 폴더에 남긴다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const G = require('../js/group.js');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const HOME = 'https://mjleo6278-thecreater.github.io';
const APP = HOME + '/studypromotion/';
const OTHER = 'https://preview.example.com'; // 다른 주소에서 연 앱 (미리 보기 등)
const API = 'https://studypromotion-ai.mj-leo6278.workers.dev';
const PROJECT = 'studypromotionbyleo';
const SHOTS = process.env.SHOTS || '';
const MIN = 60000, DAY = 86400000;

// 사람들: 이메일·구글 이름이 다른 사람에게 새지 않는지 확인하려고 일부러 눈에 띄는 값을 넣는다
const USERS = {
  me: { uid: 'uidMeQ7x81Lr', email: 'me.private@example.com', displayName: '비공개이름하나' },
  jiwoo: { uid: 'uidJiwooP3k2', email: 'jiwoo.private@example.com', displayName: '비공개이름둘' },
  hajun: { uid: 'uidHajunZ9m4', email: 'hajun.private@example.com', displayName: '비공개이름셋' },
  seoyeon: { uid: 'uidSeoyeonW5', email: 'seoyeon.private@example.com', displayName: '비공개이름넷' },
  doyun: { uid: 'uidDoyunR8t6', email: 'doyun.private@example.com', displayName: '비공개이름다섯' },
};
const SECRETS = Object.values(USERS).flatMap((u) => [u.uid, u.email, u.displayName]);

// 가짜 로그인: 구글 단추를 누르면 localStorage fakeNext 사람으로 로그인. 확인표는 window.__TOK에서
const FAKE = `
(function(){
  const USERS = ${JSON.stringify(USERS)};
  let cur = null; const subs = [];
  const wrap = (u) => u && Object.assign({ getIdToken: async () => (window.__TOK || {})[u.uid] }, u);
  const setUser = (u) => { cur = wrap(u); try { localStorage.setItem('fakeUser', JSON.stringify(u)); } catch (e) {} subs.forEach((f) => f(cur)); };
  try { cur = wrap(JSON.parse(localStorage.getItem('fakeUser'))); } catch (e) {}
  const auth = {
    onAuthStateChanged(f) { subs.push(f); setTimeout(() => f(cur), 0); },
    getRedirectResult: async () => null,
    signInWithPopup: async () => setUser(USERS[localStorage.getItem('fakeNext') || 'me']),
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

  // 로그인 확인표 (Firebase와 같은 모양, 여기서 만든 열쇠로 서명). 구글 이름(name)도 넣어 둔다
  const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async (u) => {
    const t = Math.floor(Date.now() / 1000);
    const first = b64json({ alg: 'RS256', kid: 'k1', typ: 'JWT' }) + '.' + b64json({
      iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: u.uid, iat: t - 60, exp: t + 3600, auth_time: t - 60,
      email: u.email, email_verified: true, name: u.displayName, firebase: { sign_in_provider: 'google.com' },
    });
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(first));
    return first + '.' + b64(new Uint8Array(sig));
  };
  const TOK = {};
  for (const u of Object.values(USERS)) TOK[u.uid] = await sign(u);
  const jwks = async () => new Response(JSON.stringify({ keys: [{ kty: jwk.kty, n: jwk.n, e: jwk.e, kid: 'k1', alg: 'RS256', use: 'sig' }] }), { headers: { 'cache-control': 'max-age=3600' } });

  // 서버: 진짜 서버 코드 + 기억 속 저장소
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
  const env = {
    FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: HOME, OWNER_EMAILS: 'nobody@example.com', OPEN_TO: 'all', DAILY_LIMIT: '20',
    AI: { run: async () => { throw new Error('이 시험에서는 모델을 부르지 않는다'); } },
    COUNTER: { idFromName: (n) => n, get: (id) => ({ fetch: (url, init) => new W.Counter({ storage: storage(id) }).fetch(new Request(url, init)) }) },
  };
  const srv = { down: false, calls: [], bodies: [] };
  const hub = () => stores.get('group:hub') || new Map();
  // 브라우저 없이 서버에 직접 (서연·도윤)
  const api = async (who, body) => {
    const init = { method: body ? 'POST' : 'GET', headers: { Origin: HOME, Authorization: 'Bearer ' + TOK[USERS[who].uid], 'Content-Type': 'application/json' } };
    if (body) init.body = JSON.stringify(body);
    const res = await W.handle(new Request(API + '/group', init), env, { now: Date.now(), fetch: jwks });
    const j = await res.json();
    srv.bodies.push(JSON.stringify(j));
    return j;
  };

  const browser = await chromium.launch();
  const pages = [];
  const errors = [];
  async function person(who, opts) {
    opts = opts || {};
    const tag = opts.tag || who; // 같은 사람이 다른 기기로 열 때 요청을 따로 센다
    const ctx = await browser.newContext({ ...(opts.pc ? { viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }), locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', deviceScaleFactor: SHOTS ? 2 : 1, colorScheme: opts.dark ? 'dark' : 'light' });
    await ctx.addInitScript(([tok, who]) => {
      window.__TOK = tok;
      try { localStorage.setItem('studypromotion.welcomeClosed', '1'); localStorage.setItem('fakeNext', who); } catch (e) { /* 무시 */ }
    }, [TOK, who]);
    const serve = (base) => (route) => {
      let p = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/studypromotion/, '');
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
      route.fulfill({ contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    };
    await ctx.route(HOME + '/**', serve(HOME));
    await ctx.route(OTHER + '/**', serve(OTHER));
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript', body: r.request().url().includes('app-compat') ? FAKE : '' }));
    await ctx.route(API + '/**', async (route) => {
      const req = route.request();
      if (srv.down) return route.abort('internetdisconnected');
      const init = { method: req.method(), headers: await req.allHeaders() };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) init.body = req.postData() || '';
      const where = new URL(req.url()).pathname;
      if (where === '/group' && req.method() !== 'OPTIONS') srv.calls.push({ who: tag, method: req.method(), auth: init.headers.authorization || '', body: init.body ? JSON.parse(init.body) : null });
      const res = await W.handle(new Request(req.url(), init), env, { now: Date.now(), fetch: jwks });
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      const buf = Buffer.from(await res.arrayBuffer());
      if (where === '/group') srv.bodies.push(buf.toString());
      route.fulfill({ status: res.status, headers, body: buf });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    // 일부러 낸 실패(인터넷 끊김, 서버가 거절한 요청)를 브라우저가 적는 줄은 뺀다
    page.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|status of (400|401|403)/.test(m.text()) && errors.push(who + ': ' + m.text()));
    const P = {
      who, ctx, page,
      tap: async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); if (opts.pc) await l.click(); else await l.tap(); },
      // 미리 보기 그림: 알림은 치우고(손가락 화면처럼), 긴 화면은 창을 그만큼 늘려서 아래 탭 막대가 맨 아래에 오게
      shot: async (name, full) => {
        if (!SHOTS) return;
        await page.evaluate(() => { document.documentElement.classList.add('touch'); document.querySelector('#toast').classList.remove('show'); });
        await page.waitForTimeout(250);
        if (!full) return page.screenshot({ path: path.join(SHOTS, name + '.png') });
        const vp = page.viewportSize();
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: vp.width, height: Math.min(4000, h) });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
        await page.setViewportSize(vp);
      },
      st: () => page.evaluate(() => Group.state),
      calls: () => srv.calls.filter((c) => c.who === tag),
      // 그룹 화면 다시 받기가 끝날 때까지
      sync: async () => { await page.evaluate(() => Group.refresh()); await page.waitForTimeout(150); },
      login: async () => {
        await page.evaluate(() => { location.hash = '#account'; });
        await page.waitForSelector('#acc-google:not([disabled])');
        await page.click('#acc-google');
        await page.waitForFunction(() => window.Cloud && Cloud.user && !Cloud.syncing);
      },
      // 날마다 공부한 기록 넣기: { 며칠 전: 분 }
      seed: (perDay) => page.evaluate((perDay) => {
        const now = Date.now();
        App.store.update((st) => {
          for (const [back, min] of Object.entries(perDay)) {
            const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - Number(back));
            const start = d.getTime();
            const at = Number(back) === 0 ? Math.min(now, Math.max(start + 30000, now - 120000)) : start + 15 * 3600000;
            st.sessions.push({ id: 'seed-' + back + '-' + Math.random().toString(36).slice(2, 8), subjectId: st.subjects[0].id, minutes: min, endedAt: at, manual: true });
          }
        });
      }, perDay),
      closeSheet: async () => { if (await page.$('.ui-back.in')) { await page.tap('.ui-back.in [data-ui-close]'); await page.waitForSelector('.ui-back', { state: 'detached' }); } },
    };
    pages.push(P);
    return P;
  }
  const waitToast = (P, re) => P.page.waitForFunction((src) => { const t = document.querySelector('#toast'); return t.classList.contains('show') && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 });
  const sheetText = (P) => P.page.$eval('.ui-back.in', (b) => b.textContent.replace(/\s+/g, ' '));
  const bodyText = (P) => P.page.$eval('#gr-body', (b) => b.innerText.replace(/\s+/g, ' '));
  const askYes = async (P, re, no) => {
    await P.page.waitForSelector('#ask:not([hidden])');
    if (re) assert(re.test(await P.page.textContent('#ask-msg')), '확인 창: ' + re.source);
    await P.tap(no ? '#ask-cancel' : '#ask-ok');
    await P.page.waitForSelector('#ask', { state: 'hidden' });
  };
  const pickChoice = async (P, label) => {
    await P.page.waitForSelector('.ui-back.in .ch-opt');
    await P.tap(`.ui-back.in .ch-opt:has-text("${label}")`);
    await P.page.waitForSelector('.ui-back', { state: 'detached' });
  };


  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chatCalls = (P) => P.calls().filter((c) => c.body && c.body.op === 'chat');
  const lines = () => { const m = hub().get('m:' + gid); return m ? m.ms : []; };
  const listText = (P) => P.page.$eval('#gc-list', (b) => b.textContent);
  // 말풍선의 글자 (앞의 읽어 주는 글자 '이름, 시각:'은 빼고)
  const bubbles = (P, sel) => P.page.$$eval('#gc-list ' + (sel || '.gc-msg') + ' .gc-b', (els) => els.map((e) => e.lastChild.textContent));
  // 손가락으로 꾹 누르기 (0.6초)
  const longPress = async (P, loc) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const at = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    await loc.dispatchEvent('pointerdown', at);
    await P.page.waitForTimeout(600);
    await loc.dispatchEvent('pointerup', at);
  };
  const choices = (P) => P.page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent).join('|'));
  const openChat = async (P) => {
    await P.tap('.gc-card [data-gc="open"]');
    await P.page.waitForSelector('#gc:not([hidden])');
    await P.page.waitForFunction(() => !document.querySelector('#gc-list .gc-wait'));
  };
  const closeChat = async (P) => { await P.tap('#gc-close'); await P.page.waitForSelector('#gc', { state: 'hidden' }); };
  const say = async (who, t) => { await sleep(1100); const j = await api(who, { op: 'say', g: gid, t, c: 'e2e' + Math.random().toString(36).slice(2, 8) }); assert(j.ok, who + ' 보냄: ' + t); return j; };

  /* ===== 1) 그룹: 나(리더) · 지우 · 하준은 앱, 서연 · 도윤은 서버에 직접 ===== */
  const me = await person('me');
  await me.page.goto(APP + '#account');
  await me.login();
  let r = await api('me', { op: 'create', name: '수능 D-100 스터디', n: '공부왕', goal: { day: 180, week: 4800 } });
  assert(r.ok && r.groups.length === 1, '그룹을 만듦');
  const gid = r.groups[0].id, code = r.groups[0].code;
  for (const [who, n] of [['jiwoo', '지우'], ['hajun', '하준'], ['seoyeon', '서연'], ['doyun', '도윤']]) {
    r = await api(who, { op: 'join', code, n });
    assert(r.ok, n + ' 들어옴');
  }
  await me.page.evaluate(() => App.go('group'));
  await me.sync();
  await me.page.waitForSelector('#gr-body .gc-card');
  assert(await me.page.evaluate(() => document.querySelector('#gr-body .gr-hero').nextElementSibling.classList.contains('gc-card')), '채팅 칸은 그룹 화면 맨 위 카드 바로 아래');
  assert(/채팅/.test(await me.page.textContent('.gc-card h2')) && /7일 동안 남아요/.test(await me.page.textContent('.gc-card')) && /아직 메시지가 없어요/.test(await me.page.textContent('.gc-card')), '처음: 아직 메시지가 없어요 (들어온 소식은 새 메시지로 세지 않음)');
  assert(!(await me.page.$('.gc-card .gc-new')) && !(await me.page.$eval('nav.tabs .tab[data-view="group"]', (t) => t.classList.contains('has-new'))), '자동 소식만 있으면 새 메시지 점이 없음');
  assert(chatCalls(me).length === 0, '채팅 창을 열기 전에는 채팅을 따로 묻지 않음 (그룹을 받을 때 요약만)');

  /* ===== 2) 채팅 창 열기 · 보내기 ===== */
  await openChat(me);
  assert(await me.page.textContent('#gc-title') === '수능 D-100 스터디' && /5명 · 채팅/.test(await me.page.textContent('#gc-sub')), '채팅 창 위: 그룹 이름과 인원');
  const sys = await me.page.$$eval('#gc-list .gc-sys', (els) => els.map((e) => e.textContent));
  assert(sys.length === 4 && sys[0] === '지우 님이 그룹에 들어왔어요' && sys[3] === '도윤 님이 그룹에 들어왔어요', '자동 소식: 들어온 사람 ' + sys.join(' / '));
  assert(await me.page.$$eval('#gc-quick .gc-chip', (els) => els.map((e) => e.textContent).join('|')) === '같이 공부하자 ✏️|10분 쉬고 올게 ☕|질문 있어 🙋|오늘 목표 채웠다 ♛|잘 자 🌙', '빠른 말 5개');
  assert(await me.page.isDisabled('#gc-form .gc-send'), '빈 칸이면 보내기 단추가 꺼짐');
  const box = await me.page.$eval('#gc .gc-box', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  assert(box.w === 390 && box.h === 844, '폰에서는 화면 전체 ' + JSON.stringify(box));
  await me.page.fill('#gc-text', '  오늘 저녁 8시에\n같이 하자  ');
  assert(await me.page.isEnabled('#gc-form .gc-send'), '글을 쓰면 보내기 단추가 켜짐');
  await me.tap('#gc-form .gc-send');
  await me.page.waitForSelector('#gc-list .gc-msg.me');
  await me.page.waitForFunction(() => !document.querySelector('#gc-list .gc-msg.sending'));
  let mine = await bubbles(me, '.gc-msg.me');
  assert(mine.length === 1 && mine[0] === '오늘 저녁 8시에\n같이 하자' && await me.page.inputValue('#gc-text') === '', '보낸 글은 다듬어져(앞뒤 빈칸) 바로 내 오른쪽 말풍선으로, 입력 칸은 비움');
  assert(lines().filter((x) => x.t).length === 1 && lines().find((x) => x.t).t === '오늘 저녁 8시에\n같이 하자', '서버에 한 번 들어감');
  const sayBody = me.calls().filter((c) => c.body && c.body.op === 'say').pop().body;
  assert(Object.keys(sayBody).sort().join() === 'c,g,op,since,t' && /^[0-9a-z]{6,16}$/.test(sayBody.c), '보내는 것: 그룹·글·앱 번호뿐 ' + JSON.stringify(Object.keys(sayBody)));

  /* ===== 3) 지우: 홈에서 새 메시지 → 채팅 열기 ===== */
  const jiwoo = await person('jiwoo');
  await jiwoo.page.goto(APP + '#account');
  await jiwoo.login();
  await jiwoo.page.evaluate(() => App.go('home'));
  await jiwoo.sync();
  await jiwoo.page.waitForSelector('#h-group .gc-home');
  assert(/채팅/.test(await jiwoo.page.textContent('#h-group .gc-home')) && /새 메시지 1/.test(await jiwoo.page.textContent('#h-group .gc-home')), '홈 ‘우리 그룹’ 칸에 새 메시지 1');
  assert(await jiwoo.page.$eval('nav.tabs .tab[data-view="group"]', (t) => t.classList.contains('has-new') && t.getAttribute('aria-label') === '그룹 (새 메시지)'), '그룹 탭에 새 메시지 점');
  await jiwoo.shot('10-home-new');
  await jiwoo.tap('#h-group .gc-home');
  await jiwoo.page.waitForSelector('#gc:not([hidden]) .gc-msg');
  assert(await jiwoo.page.evaluate(() => App.view) === 'group', '누르면 그룹 화면으로 가서 채팅 창이 열림');
  const seen = await jiwoo.page.$eval('#gc-list .gc-msg:not(.me)', (e) => ({ name: e.querySelector('.gc-who small').textContent, t: e.querySelector('.gc-b').lastChild.textContent, av: !!e.querySelector('.gr-av') }));
  assert(seen.name === '공부왕' && seen.t === '오늘 저녁 8시에\n같이 하자' && seen.av, '친구 메시지: 왼쪽에 얼굴·별명과 함께');
  const jsys = await jiwoo.page.$$eval('#gc-list .gc-sys', (els) => els.map((e) => e.textContent));
  assert(jsys[0] === '그룹에 들어왔어요' && jsys.length === 4, '지우는 자기가 들어온 뒤의 소식부터 ' + jsys.join(' / '));
  await closeChat(jiwoo);
  assert(!(await jiwoo.page.$eval('nav.tabs .tab[data-view="group"]', (t) => t.classList.contains('has-new'))) && !(await jiwoo.page.$('.gc-card .gc-new')), '채팅 창을 열면 새 메시지 표시가 사라짐');
  assert(/오늘 저녁 8시에 같이 하자/.test(await jiwoo.page.textContent('.gc-card .gc-prev')), '채팅 칸에 최근 메시지 미리 보기');

  /* ===== 4) 서로 주고받기: 나는 창을 열어 둔 채, 지우는 빠른 말 ===== */
  await openChat(jiwoo);
  const n0 = chatCalls(me).length;
  await jiwoo.tap('#gc-quick [data-gc-q="1"]');
  await me.page.waitForFunction(() => [...document.querySelectorAll('#gc-list .gc-msg:not(.me) .gc-b')].some((b) => b.lastChild.textContent === '10분 쉬고 올게 ☕'), null, { timeout: 9000 });
  assert(chatCalls(me).length > n0, '창을 열어 둔 쪽은 몇 초 안에 새 메시지를 받음 (빠른 말은 누르면 바로 보내짐)');
  // 이어 보낸 메시지는 이름·얼굴을 한 번만
  await jiwoo.page.fill('#gc-text', '수학 22번 질문 있어 🙋 이따 봐 줄 사람?');
  await jiwoo.tap('#gc-form .gc-send');
  await me.page.waitForFunction(() => /수학 22번 질문 있어/.test(document.querySelector('#gc-list').textContent), null, { timeout: 9000 });
  const run = await me.page.$$eval('#gc-list .gc-msg:not(.me)', (els) => els.slice(-2).map((e) => ({ cont: e.classList.contains('cont'), name: !!e.querySelector('.gc-who small'), time: !!e.querySelector('time') })));
  assert(!run[0].cont && run[0].name && run[1].cont && !run[1].name && run[1].time, '같은 사람이 이어 보내면 이름은 첫 줄에만, 시각은 마지막에 ' + JSON.stringify(run));

  /* ===== 5) 연락처 확인 · 길이 ===== */
  await me.page.fill('#gc-text', '내 번호 010-1234-5678로 연락해');
  await me.tap('#gc-form .gc-send');
  await askYes(me, /개인 연락처는 그룹 사람 모두에게 보여요/, true);
  assert(await me.page.inputValue('#gc-text') === '내 번호 010-1234-5678로 연락해' && !lines().some((x) => /010-1234/.test(x.t || '')), '연락처: 보내기 전에 묻고, ‘고치기’면 보내지 않고 글은 그대로');
  await me.page.fill('#gc-text', '가'.repeat(201));
  assert(/201\/200/.test(await me.page.textContent('#gc-count')) && await me.page.$eval('#gc-count', (e) => e.classList.contains('over')), '글자 수가 200을 넘으면 빨갛게');
  await me.tap('#gc-form .gc-send');
  assert(/200자까지/.test(await me.page.textContent('#gc-err')) && !lines().some((x) => (x.t || '').length > 200), '200자가 넘으면 보내지 않고 알려 줌');
  await me.page.fill('#gc-text', '');

  /* ===== 6) 욕설 가리기 (보는 앱에서) ===== */
  await say('seoyeon', '아 씨발 미적분 어렵다');
  await me.page.evaluate(() => GroupChat.poll());
  await me.page.waitForFunction(() => /아 ✱✱ 미적분 어렵다/.test(document.querySelector('#gc-list').textContent));
  assert(!/씨발/.test(await listText(me)) && lines().some((x) => x.t === '아 씨발 미적분 어렵다'), '심한 욕은 보는 화면에서 ✱✱ (서버에는 그대로)');
  await me.tap('#gc-menu');
  await me.page.waitForSelector('.ui-back.in .ch-opt');
  assert(/공부하는 동안 새 메시지 숨기기\|욕설 가리기\|채팅 끄기/.test(await choices(me)), '채팅 메뉴: 공부 중 숨기기 · 욕설 가리기 · (리더) 채팅 끄기 ' + await choices(me));
  await pickChoice(me, '욕설 가리기');
  await me.page.waitForFunction(() => /아 씨발 미적분/.test(document.querySelector('#gc-list').textContent));
  assert(await me.page.evaluate(() => App.store.get().settings.groupChatFilter) === false, '욕설 가리기를 끄면 그대로 보임');
  await me.tap('#gc-menu');
  await pickChoice(me, '욕설 가리기');
  await me.page.waitForFunction(() => /아 ✱✱ 미적분/.test(document.querySelector('#gc-list').textContent));

  /* ===== 7) 꾹 누르기: 가리기 · 지우기 ===== */
  const jb = me.page.locator('#gc-list .gc-msg:not(.me) .gc-b', { hasText: '10분 쉬고 올게' }).first();
  await longPress(me, jb);
  await me.page.waitForSelector('.ui-back.in .ch-opt');
  assert(await choices(me) === '복사|지우 님 메시지 가리기|메시지 지우기', '리더가 친구 메시지를 꾹 누르면: 복사 · 가리기 · 지우기 ' + await choices(me));
  await me.shot('12-menu');
  await pickChoice(me, '지우 님 메시지 가리기');
  await me.page.waitForSelector('#gc-list .gc-hid');
  assert(!/10분 쉬고 올게|수학 22번/.test(await listText(me)) && /가린 사람의 메시지 2개/.test(await listText(me)), '가리면 그 사람 메시지가 ‘가린 사람의 메시지 2개’로');
  assert(await me.page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.groupChat')).h.length) === 1 && !me.calls().some((c) => c.body && /hide/.test(JSON.stringify(c.body))), '가리기는 이 기기에만 (서버에 알리지 않음)');
  await me.tap('#gc-menu');
  await me.page.waitForSelector('.ui-back.in .ch-opt');
  await me.tap('.ui-back.in .ch-opt:has-text("가린 사람")');
  await me.page.waitForFunction(() => { const b = document.querySelector('.ui-back.in'); return b && /가린 사람의 메시지는 이 기기에서만/.test(b.textContent); });
  await pickChoice(me, '지우');
  await me.page.waitForFunction(() => /10분 쉬고 올게/.test(document.querySelector('#gc-list').textContent));
  assert(!(await me.page.$('#gc-list .gc-hid')), '채팅 메뉴의 ‘가린 사람’에서 다시 보기');
  // 지우: 내 메시지 지우기 (리더가 아니면 남의 메시지는 못 지움)
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForFunction(() => /공부왕/.test(document.querySelector('#gc-list').textContent));
  await longPress(jiwoo, jiwoo.page.locator('#gc-list .gc-msg:not(.me) .gc-b', { hasText: '오늘 저녁 8시에' }).first());
  await jiwoo.page.waitForSelector('.ui-back.in .ch-opt');
  assert(await choices(jiwoo) === '복사|공부왕 님 메시지 가리기', '리더가 아니면 남의 메시지는 복사 · 가리기만 ' + await choices(jiwoo));
  await jiwoo.closeSheet();
  await longPress(jiwoo, jiwoo.page.locator('#gc-list .gc-msg.me .gc-b', { hasText: '10분 쉬고 올게' }).first());
  await jiwoo.page.waitForSelector('.ui-back.in .ch-opt');
  assert(await choices(jiwoo) === '복사|메시지 지우기', '내 메시지: 복사 · 지우기');
  await pickChoice(jiwoo, '메시지 지우기');
  await askYes(jiwoo, /이 메시지를 지울까요/);
  await jiwoo.page.waitForSelector('#gc-list .gc-msg.me .gc-b.del');
  await me.page.evaluate(() => GroupChat.poll());
  await me.page.waitForFunction(() => [...document.querySelectorAll('#gc-list .gc-b.del')].some((b) => b.lastChild.textContent === '지운 메시지예요'));
  assert(!/10분 쉬고 올게/.test(await listText(me)) && !lines().some((x) => x.t === '10분 쉬고 올게 ☕'), '지우면 모두의 화면에서 ‘지운 메시지예요’ (서버에서도 글을 지움)');
  // 리더: 남의 메시지 지우기
  await say('doyun', '문제집 싸게 팔아요 광고');
  await me.page.evaluate(() => GroupChat.poll());
  await me.page.waitForFunction(() => /문제집 싸게/.test(document.querySelector('#gc-list').textContent));
  await longPress(me, me.page.locator('#gc-list .gc-b', { hasText: '문제집 싸게' }).first());
  await pickChoice(me, '메시지 지우기');
  await askYes(me, /리더가 지운 메시지예요/);
  await me.page.waitForFunction(() => [...document.querySelectorAll('#gc-list .gc-b.del')].some((b) => b.lastChild.textContent === '리더가 지운 메시지예요'));
  assert(!/문제집 싸게/.test(await listText(me)), '리더는 어떤 메시지든 지움 (‘리더가 지운 메시지예요’)');

  /* ===== 8) 여러 번 빨리 눌러도 (1초에 1개 한도) 차례로 다 보내짐 ===== */
  for (const i of [0, 2, 4]) await me.page.tap(`#gc-quick [data-gc-q="${i}"]`);
  assert((await me.page.$$('#gc-list .gc-msg.me.sending')).length >= 1, '누르자마자 ‘보내는 중’으로 보임');
  await me.page.waitForFunction(() => !document.querySelector('#gc-list .gc-msg.me.sending'), null, { timeout: 12000 });
  assert(!(await me.page.$('#gc-list .gc-msg.failed')) && ['같이 공부하자 ✏️', '질문 있어 🙋', '잘 자 🌙'].every((t) => lines().filter((x) => x.t === t).length === 1), '빠르게 세 번 눌러도 1초씩 띄워 모두 한 번씩 보내짐');

  /* ===== 9) 인터넷이 끊기면 ‘다시 보내기’ ===== */
  srv.down = true;
  await me.page.fill('#gc-text', '인터넷 끊겨도 다시 보내기');
  await me.tap('#gc-form .gc-send');
  await me.page.waitForSelector('#gc-list .gc-msg.failed [data-gc-retry]', { timeout: 9000 });
  assert(/못 보냈어요/.test(await me.page.textContent('#gc-list .gc-msg.failed')) && !lines().some((x) => x.t === '인터넷 끊겨도 다시 보내기'), '못 보내면 ‘못 보냈어요 · 다시 보내기’');
  srv.down = false;
  await me.tap('#gc-list [data-gc-retry]');
  await me.page.waitForFunction(() => !document.querySelector('#gc-list .gc-msg.failed') && !document.querySelector('#gc-list .gc-msg.sending'), null, { timeout: 9000 });
  assert(lines().filter((x) => x.t === '인터넷 끊겨도 다시 보내기').length === 1, '다시 보내면 한 번만 들어감');
  // 한글 마지막 글자를 조합하는 중에 보내기를 눌러도 마지막 글자까지 (입력 칸 초점은 그대로: 글자판이 닫히지 않게)
  const cdp = await me.ctx.newCDPSession(me.page);
  await me.page.focus('#gc-text');
  await me.page.keyboard.type('조합 중에 보내');
  await cdp.send('Input.imeSetComposition', { text: '기', selectionStart: 1, selectionEnd: 1 });
  await me.tap('#gc-form .gc-send');
  await me.page.waitForFunction(() => [...document.querySelectorAll('#gc-list .gc-msg.me:not(.sending) .gc-b')].some((b) => b.lastChild.textContent === '조합 중에 보내기'), null, { timeout: 9000 });
  assert(await me.page.inputValue('#gc-text') === '' && await me.page.evaluate(() => document.activeElement && document.activeElement.id) === 'gc-text' && lines().some((x) => x.t === '조합 중에 보내기'), '한글을 조합하는 중에 보내기를 눌러도 마지막 글자까지 보내고, 입력 칸에 그대로 있음');

  /* ===== 10) 함께 집중 자동 소식 → 같이 하기 ===== */
  await sleep(300);
  r = await api('doyun', { op: 'room', g: gid, min: 25 });
  assert(r.ok, '도윤이 함께 집중을 시작');
  await me.sync();
  await me.page.evaluate(() => GroupChat.poll());
  await me.page.waitForSelector('#gc-list .gc-sys.room [data-gc-room]');
  assert(/도윤 님이 함께 집중 25분을 시작했어요/.test(await me.page.textContent('#gc-list .gc-sys.room')), '자동 소식: 함께 집중 시작 + 같이 하기');
  await me.page.evaluate(() => { const l = document.querySelector('#gc-list'); l.scrollTop = l.scrollHeight; });
  await me.shot('11-chat');
  await me.tap('#gc-list [data-gc-room]');
  await me.page.waitForSelector('#gc', { state: 'hidden' });
  await waitToast(me, /함께 집중 시작/);
  assert(await me.page.evaluate(() => App.timerBusy()) === 'focus', '‘같이 하기’를 누르면 채팅 창을 닫고 같은 시각에 끝나는 집중 타이머');

  /* ===== 11) 공부하는 동안: 새 메시지 표시 숨기기, 열면 한 번 묻기 ===== */
  await say('seoyeon', '나도 들어갈게');
  await me.page.evaluate(() => App.go('group')); // 집중 타이머 화면에서 그룹 탭으로
  await me.sync();
  await me.page.evaluate(() => Group.render());
  assert(/공부 중이라 숨김/.test(await me.page.textContent('.gc-card .gc-new.quiet')) && !(await me.page.$('.gc-card .gc-prev')) && !(await me.page.$eval('nav.tabs .tab[data-view="group"]', (t) => t.classList.contains('has-new'))), '공부 중: 새 메시지 수·미리 보기·탭 점을 숨김');
  await me.shot('13-study');
  await me.tap('.gc-card [data-gc="open"]');
  await me.page.waitForSelector('#ask:not([hidden])');
  assert(await me.page.textContent('#ask-msg') === '공부 중이에요. 채팅은 끝나고 볼까요?' && await me.page.textContent('#ask-ok') === '그래도 보기' && await me.page.textContent('#ask-cancel') === '끝나고 볼게요', '공부 중에 열면 먼저 물어봄');
  await me.shot('14-study-ask');
  await me.tap('#ask-cancel');
  await me.page.waitForTimeout(200);
  assert(await me.page.isHidden('#gc'), '‘끝나고 볼게요’면 열지 않음');
  await me.page.evaluate(() => App.stopTimer());
  await me.page.waitForFunction(() => document.querySelector('nav.tabs .tab[data-view="group"]').classList.contains('has-new') && /새 메시지 1/.test((document.querySelector('.gc-card .gc-new') || {}).textContent || ''), null, { timeout: 12000 });
  assert(!(await me.page.$('.gc-card .gc-new.quiet')), '공부가 끝나면 쌓인 메시지 수가 보임 (10초 안)');

  /* ===== 12) 리더가 채팅을 끄고 켜기 ===== */
  await me.tap('[data-gr="menu"]');
  await pickChoice(me, '채팅 끄기');
  await askYes(me, /채팅을 끌까요/);
  await waitToast(me, /채팅을 껐어요/);
  await me.page.waitForSelector('.gc-card.off [data-gc="on"]');
  assert(/리더가 채팅을 꺼 두었어요/.test(await me.page.textContent('.gc-card')), '끄면 채팅 칸에 안내 (리더에게는 켜기 단추)');
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForSelector('#gc', { state: 'hidden' });
  await waitToast(jiwoo, /리더가 채팅을 꺼 두었어요/);
  await jiwoo.sync();
  assert(await jiwoo.page.$('.gc-card.off') && !(await jiwoo.page.$('.gc-card [data-gc="on"]')) && !(await jiwoo.page.$('.gc-card [data-gc="open"]')), '열어 둔 친구의 창도 닫히고, 친구에게는 켜기 단추 없음');
  await sleep(1100);
  r = await api('seoyeon', { op: 'say', g: gid, t: '들려?' });
  assert(r.error === 'chatoff', '꺼 두면 아무도 보낼 수 없음');
  await me.tap('.gc-card [data-gc="on"]');
  await waitToast(me, /채팅을 켰어요/);
  await me.page.waitForSelector('.gc-card [data-gc="open"]');
  // 메뉴의 단추 이름도 바뀐다
  await me.tap('[data-gr="menu"]');
  await me.page.waitForSelector('.ui-back.in .ch-opt');
  assert(/채팅 끄기/.test(await choices(me)), '다시 켜면 그룹 메뉴는 ‘채팅 끄기’');
  await me.closeSheet();

  /* ===== 13) 창을 닫으면 묻지 않음 · 휴대폰 뒤로 가기 ===== */
  await openChat(me);
  const before = chatCalls(me).length;
  await me.page.evaluate(() => history.back());
  await me.page.waitForSelector('#gc', { state: 'hidden' });
  assert(await me.page.evaluate(() => App.view) === 'group', '휴대폰 ‘뒤로’는 채팅 창만 닫음');
  const closedAt = chatCalls(me).length;
  await sleep(4500);
  assert(chatCalls(me).length === closedAt && closedAt >= before, '창을 닫으면 채팅을 따로 묻지 않음');

  /* ===== 14) 하준: 공부 중 표시와 채팅을 같이 (화면 그림용), 기능 끄기 ===== */
  const hajun = await person('hajun');
  await hajun.page.goto(APP + '#account');
  await hajun.login();
  await hajun.page.evaluate(() => App.go('group'));
  await hajun.sync();
  await hajun.page.waitForSelector('#gr-body .gc-card .gc-new');
  assert(/새 메시지/.test(await hajun.page.textContent('.gc-card .gc-new')) && (await hajun.page.$$('.gc-card .gc-prev li')).length === 2, '그룹 화면 채팅 칸: 새 메시지 수와 최근 두 줄');
  await hajun.page.evaluate(() => window.scrollTo(0, 0));
  await hajun.shot('09-group');
  await hajun.page.evaluate(() => Features.set('grchat', false));
  await hajun.page.waitForTimeout(300);
  assert(!(await hajun.page.$('.gc-card')) && !(await hajun.page.$eval('nav.tabs .tab[data-view="group"]', (t) => t.classList.contains('has-new'))), '그룹 채팅을 끄면 채팅 칸과 점이 사라짐');
  await hajun.page.evaluate(() => Features.set('grchat', true));
  await hajun.page.waitForTimeout(300);
  assert(await hajun.page.$('.gc-card'), '다시 켜면 채팅 칸이 돌아옴');

  /* ===== 15) 컴퓨터: 가운데 창, Enter로 보내기, 눌러서 메뉴 ===== */
  const pc = await person('jiwoo', { pc: true, tag: 'pc' });
  await pc.page.goto(APP + '#account');
  await pc.login();
  await pc.page.evaluate(() => App.go('group'));
  await pc.sync();
  await pc.page.waitForSelector('#gr-body .gc-card [data-gc="open"]');
  await openChat(pc);
  const pcBox = await pc.page.$eval('#gc .gc-box', (b) => { const r = b.getBoundingClientRect(); return { w: r.width, x: r.x }; });
  assert(pcBox.w === 560 && pcBox.x > 300, '넓은 화면에서는 가운데 창 ' + JSON.stringify(pcBox));
  assert(await pc.page.evaluate(() => document.activeElement && document.activeElement.id === 'gc-text'), '컴퓨터는 열면 바로 입력 칸에');
  await pc.page.keyboard.type('컴퓨터에서');
  await pc.page.keyboard.press('Shift+Enter');
  await pc.page.keyboard.type('Enter로 보냄');
  await pc.page.keyboard.press('Enter');
  await pc.page.waitForFunction(() => [...document.querySelectorAll('#gc-list .gc-msg.me:not(.sending) .gc-b')].some((b) => b.lastChild.textContent === '컴퓨터에서\nEnter로 보냄'), null, { timeout: 9000 });
  assert(lines().some((x) => x.t === '컴퓨터에서\nEnter로 보냄'), 'Enter로 보내고 Shift+Enter는 줄 바꿈');
  await pc.shot('15-chat-pc');
  await pc.page.click('#gc-list .gc-msg:not(.me) .gc-b[data-gc-s] >> nth=-1');
  await pc.page.waitForSelector('.ui-back.in .ch-opt');
  assert(/복사/.test(await choices(pc)), '마우스로 친구 메시지를 누르면 메뉴');
  await pc.page.keyboard.press('Escape');
  await pc.page.waitForSelector('.ui-back', { state: 'detached' });
  assert(await pc.page.isVisible('#gc'), 'Esc는 메뉴만 닫음');
  await pc.page.keyboard.press('Escape');
  await pc.page.waitForSelector('#gc', { state: 'hidden' });

  /* ===== 16) 개인 정보: 서버 답에 이메일 · 구글 이름 · 계정 번호가 없음 ===== */
  const leak = srv.bodies.filter((b) => SECRETS.some((x) => b.includes(x)));
  assert(leak.length === 0, '서버 답 어디에도 이메일·구글 이름·계정 번호가 없음');
  const others = srv.bodies.map((b) => { try { return JSON.parse(b); } catch (e) { return null; } }).filter((j) => j && j.chat && Array.isArray(j.chat.ms));
  assert(others.length > 5 && others.every((j) => j.chat.ms.every((x) => Object.keys(x).every((k) => ['s', 'v', 'at', 'f', 'n', 't', 'k', 'x', 'c', 'min', 'end'].includes(k)))), '채팅 줄에는 번호·시각·보낸 사람 번호·별명·글만');

  /* ===== 17) 어두운 화면 (미리 보기 그림) ===== */
  if (SHOTS) {
    const dark = await person('jiwoo', { dark: true, tag: 'dark' });
    await dark.page.goto(APP + '#account');
    await dark.login();
    await dark.page.evaluate(() => App.go('group'));
    await dark.sync();
    await openChat(dark);
    await dark.page.evaluate(() => { const l = document.querySelector('#gc-list'); l.scrollTop = l.scrollHeight; });
    await dark.shot('16-chat-dark');
    await dark.ctx.close();
  }

  assert(errors.length === 0, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  console.log('그룹 채팅 시험 통과');
})().catch((e) => { console.error(e); process.exit(1); });
