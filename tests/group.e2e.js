// v3.11 그룹 스터디: 앱(js/group.js)과 진짜 서버 코드(worker/src/index.js의 /group)를 이어서, 친구 여럿이 쓰는 모습을 확인한다.
// 앱은 실제 주소(github.io)에서 열린 것처럼, 로그인(Firebase)은 가짜로 바꾸고, 서버 주소(workers.dev)로 가는 요청은
// 이 시험 안에서 서버 코드(handle)를 직접 불러 답한다. 로그인 확인표는 여기서 만든 열쇠로 서명한다. 바깥으로 나가는 요청은 없다.
// 브라우저 세 개(나·지우·하준)와, 서버에 직접 요청하는 친구 둘(서연·도윤)이 한 그룹에서 공부한다.
// SHOTS=폴더 를 주면 미리 보기 그림을 그 폴더에 남긴다 (DARK=1이면 어두운 화면도).
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
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', deviceScaleFactor: SHOTS ? 2 : 1, colorScheme: opts.dark ? 'dark' : 'light' });
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
      tap: async (sel) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.tap(); },
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
  const askYes = async (P, re) => {
    await P.page.waitForSelector('#ask:not([hidden])');
    if (re) assert(re.test(await P.page.textContent('#ask-msg')), '확인 창: ' + re.source);
    await P.page.tap('#ask-ok');
  };
  const pickChoice = async (P, label) => {
    await P.page.waitForSelector('.ui-back.in .ch-opt');
    await P.page.locator('.ui-back.in .ch-opt', { hasText: label }).first().tap();
    await P.page.waitForSelector('.ui-back', { state: 'detached' });
  };

  /* ===== 0) 오늘이 이번 주 몇째 날인지 (월요일 0) ===== */
  const kst = new Date(Date.now() + 9 * 3600000);
  const todayKey = kst.toISOString().slice(0, 10);
  const dow = (G.weekdayOf(todayKey) + 6) % 7; // 월 0 ~ 일 6

  /* ===== 1) 나: 로그인 전 → 로그인 → 그룹이 없을 때 ===== */
  const me = await person('me');
  await me.page.goto(APP + '#group');
  await me.page.waitForSelector('#gr-body .gr-empty');
  assert(await me.page.isVisible('nav.tabs .tab[data-view="group"]') && /그룹/.test(await me.page.textContent('nav.tabs .tab[data-view="group"]')), '아래 탭에 ‘그룹’이 생김');
  assert(/로그인하면 친구들과 그룹을 만들 수 있어요/.test(await bodyText(me)) && /별명만 보여요/.test(await bodyText(me)), '로그인 전: 로그인 안내와 별명만 보인다는 설명');
  assert(me.calls().length === 0, '로그인 전에는 서버에 묻지 않음');
  // 7개 탭이 좁은 폰(360px)에도 다 들어가는지
  await me.page.setViewportSize({ width: 360, height: 780 });
  const tabFit = await me.page.evaluate(() => {
    const ts = [...document.querySelectorAll('nav.tabs .tab')].filter((t) => !t.hidden);
    return { n: ts.length, inside: ts.every((t) => { const r = t.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }), noScroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert(tabFit.n === 7 && tabFit.inside && tabFit.noScroll, '360px 폰에서도 탭 7개가 화면 안에 다 들어감 ' + JSON.stringify(tabFit));
  await me.page.setViewportSize({ width: 390, height: 844 });
  await me.tap('#gr-body [data-go="account"]');
  await me.page.waitForFunction(() => location.hash === '#account');
  await me.login();
  await me.page.evaluate(() => App.go('group'));
  await me.page.waitForSelector('#gr-body .gr-perks');
  assert(/친구들과 같이 공부해요/.test(await bodyText(me)) && await me.page.isVisible('[data-gr="create"]') && await me.page.isVisible('[data-gr="join"]'), '로그인 뒤 그룹이 없으면: 소개와 만들기·초대 코드로 들어가기');
  const firstCall = me.calls()[0];
  assert(firstCall && firstCall.method === 'GET' && firstCall.auth.startsWith('Bearer '), '로그인하면 확인표와 함께 그룹을 받아 옴');
  assert(!me.calls().some((c) => c.body && c.body.op === 'sync'), '그룹에 들기 전에는 내 공부 시간을 보내지 않음');
  await me.seed({ 0: 200, 1: 240, 2: 150, 3: 185, 4: 95, 5: 60, 6: 210, 7: 180, 8: 120, 9: 90 });
  await me.page.waitForTimeout(400);
  await me.shot('01-empty');

  /* ===== 2) 그룹 만들기 → 초대 시트 ===== */
  await me.tap('[data-gr="create"]');
  await me.page.waitForSelector('#gr-dlg:not([hidden]) #gr-gname');
  assert(await me.page.isVisible('#gr-nick') && /그룹 사람들에게 보일 이름/.test(await me.page.textContent('#gr-dlg')), '처음이면 별명 칸도 같이');
  await me.page.fill('#gr-gname', '<b>');
  await me.page.tap('#gr-dlg-ok');
  assert(await me.page.isVisible('#gr-dlg-err') && /20자까지/.test(await me.page.textContent('#gr-dlg-err')), '쓸 수 없는 그룹 이름은 창에서 바로 알려 줌');
  await me.page.fill('#gr-gname', '수능 D-100 스터디');
  assert(await me.page.isHidden('#gr-dlg-err'), '고쳐 적으면 빨간 안내가 사라짐');
  await me.page.fill('#gr-nick', '공부왕');
  // 주간 목표: 다 같이 80시간
  await me.page.selectOption('#gr-goal-week', '4800');
  await me.page.waitForTimeout(100);
  assert(/참고: 1명이 하루 3시간씩/.test(await me.page.textContent('#gr-goal-hint')), '하루 목표 참고 문구');
  await me.shot('02-create');
  await me.page.tap('#gr-dlg-ok');
  await me.page.waitForSelector('.ui-back.in .gr-inv');
  let s = await me.st();
  const code = s.groups[0].code;
  assert(s.groups.length === 1 && s.me.n === '공부왕' && s.groups[0].name === '수능 D-100 스터디' && s.groups[0].goal.day === 180 && s.groups[0].goal.week === 4800, '그룹을 만들고 내가 리더 (하루 3시간 · 다 같이 80시간)');
  assert(/^[2-9A-HJKMNP-Z]{6}$/.test(code) && (await sheetText(me)).includes(code.slice(0, 3)) && /그룹을 만들었어요/.test(await sheetText(me)), '만들면 바로 초대 시트: 초대 코드 ' + code);
  await me.page.waitForTimeout(300);
  await me.shot('03-invite');
  await me.closeSheet();
  await me.page.waitForFunction(() => Group.state.groups[0].ms[0].d && Object.keys(Group.state.groups[0].ms[0].d).length > 0);
  const sync1 = me.calls().filter((c) => c.body && c.body.op === 'sync').pop();
  assert(sync1 && sync1.body.d[todayKey] === 200 && Object.keys(sync1.body).sort().join() === 'd,dv,lv,op' && sync1.body.lv === null, '그룹에 들면 날별 공부 분만 보냄 (할 일·범위·기록 내용 없음)');

  /* ===== 3) 지우: 초대 링크 → 로그인 → 들어갈지 묻는 창 ===== */
  const jiwoo = await person('jiwoo');
  await jiwoo.page.goto(APP + '#join=' + code);
  await jiwoo.page.waitForSelector('#gr-body .gr-empty');
  assert(await jiwoo.page.evaluate(() => location.hash) === '#group' && new RegExp('초대 코드 ' + code + '로 들어가려면 먼저 로그인').test(await bodyText(jiwoo)), '초대 링크를 열면 그룹 화면으로, 로그인하라고 안내 (주소는 #group으로 바뀜)');
  await jiwoo.login();
  await jiwoo.page.waitForSelector('#gr-dlg:not([hidden]) #gr-peek:not([hidden])');
  assert(await jiwoo.page.evaluate(() => App.view) === 'group', '로그인을 마치면 그룹 화면으로 돌아와 들어갈지 이어서 물어봄');
  const peekText = await jiwoo.page.textContent('#gr-peek');
  assert(/수능 D-100 스터디/.test(peekText) && /1\/20명/.test(peekText) && /리더 공부왕/.test(peekText) && /하루 3시간/.test(peekText), '들어가기 전에 그룹 이름·인원·리더·목표를 보여 줌: ' + peekText);
  assert(await jiwoo.page.textContent('#gr-dlg-ok') === '들어가기' && await jiwoo.page.inputValue('#gr-code') === code, '코드는 이미 들어 있고 단추는 ‘들어가기’');
  await jiwoo.page.fill('#gr-nick', '지우');
  await jiwoo.page.waitForTimeout(200);
  await jiwoo.shot('04-join');
  await jiwoo.page.tap('#gr-dlg-ok');
  await waitToast(jiwoo, /그룹에 들어왔어요/);
  await jiwoo.page.waitForSelector('#gr-body .gr-hero');
  assert((await jiwoo.st()).groups[0].ms.length === 2 && !(await jiwoo.page.evaluate(() => localStorage.getItem('studypromotion.groupJoin'))), '지우가 들어옴 (맡겨 둔 코드는 지움)');
  await jiwoo.seed({ 0: 130, 1: 300, 2: 210, 3: 100, 4: 240, 5: 30, 7: 200, 8: 260 });

  /* ===== 4) 하준: 코드를 직접 적어서 (소문자·빈칸·하이픈도 됨). 틀린 코드는 알려 줌 ===== */
  const hajun = await person('hajun');
  await hajun.page.goto(APP + '#group');
  await hajun.page.waitForSelector('#gr-body .gr-empty');
  await hajun.login();
  await hajun.page.evaluate(() => App.go('group'));
  await hajun.page.waitForSelector('[data-gr="join"]');
  await hajun.tap('[data-gr="join"]');
  await hajun.page.waitForSelector('#gr-dlg:not([hidden]) #gr-code');
  await hajun.page.fill('#gr-code', 'ZZZ-ZZZ');
  await hajun.page.tap('#gr-dlg-ok');
  await hajun.page.waitForFunction(() => !document.querySelector('#gr-dlg-err').hidden);
  assert(/없는 초대 코드예요/.test(await hajun.page.textContent('#gr-dlg-err')), '없는 코드는 창에서 알려 줌');
  await hajun.page.fill('#gr-code', code.slice(0, 3).toLowerCase() + ' - ' + code.slice(3).toLowerCase());
  await hajun.page.tap('#gr-dlg-ok');
  await hajun.page.waitForSelector('#gr-peek:not([hidden])');
  await hajun.page.fill('#gr-nick', '하준');
  await hajun.page.tap('#gr-dlg-ok');
  await hajun.page.waitForSelector('#gr-body .gr-hero');
  assert((await hajun.st()).groups[0].ms.length === 3, '하준도 들어옴 (소문자·빈칸·하이픈 코드)');
  await hajun.seed({ 0: 45, 1: 120, 2: 180, 3: 60, 7: 90, 9: 150 });
  // 하준은 지금 수학을 스톱워치로 재는 중
  await hajun.page.evaluate(() => { const s = App.store.get().subjects.find((x) => x.name === '수학'); Stopwatch.start(s.id); });
  await hajun.page.waitForTimeout(200);
  await hajun.sync();

  /* ===== 5) 서연·도윤: 서버에 직접 (앱과 같은 요청) ===== */
  const days = (per) => { const o = {}; for (const [back, v] of Object.entries(per)) o[G.addKey(todayKey, -Number(back))] = v; return o; };
  let r = await api('seoyeon', { op: 'join', code, n: '서연' });
  assert(r.ok && r.groups[0].ms.length === 4, '서연이 들어옴');
  await api('seoyeon', { op: 'sync', d: days({ 0: 95, 1: 260, 2: 230, 3: 280, 4: 200, 7: 300, 8: 240 }), lv: { k: 'focus', at: Date.now() - 18 * MIN, end: Date.now() + 32 * MIN, s: '영어' } });
  r = await api('doyun', { op: 'join', code, n: '도윤' });
  await api('doyun', { op: 'sync', d: days({ 0: 185, 1: 90, 2: 60, 3: 200, 5: 120, 8: 60 }), lv: null });
  assert(r.ok && r.groups[0].ms.length === 5, '도윤도 들어와 다섯 명');

  /* ===== 6) 나: 그룹 한눈에 ===== */
  await jiwoo.sync();
  await me.sync();
  await me.page.waitForFunction(() => Group.state.groups[0].ms.length === 5);
  await me.page.evaluate(() => Group.render());
  s = await me.st();
  const g0 = s.groups[0];
  const ctx = { today: todayKey, now: Date.now(), start: Date.parse(todayKey + 'T00:00:00+09:00') };
  const sm = G.summary(g0, ctx);
  const byNick = Object.fromEntries(sm.rows.map((x) => [x.m.n, x]));
  assert(byNick['공부왕'].today === 200 && byNick['지우'].today === 130 && byNick['서연'].today >= 95 + 17, '오늘 공부 시간 (서연은 지금 재는 시간도 더함)');
  let txt = await bodyText(me);
  assert(/지금 공부 중 2명/.test(txt) && /하준/.test(txt) && /수학 · /.test(txt) && /영어 · 18분째 · 32분 남음|영어 · 1[78]분째 · 3[123]분 남음/.test(txt), '지금 공부 중: 하준(스톱워치·수학), 서연(집중 타이머·영어, 남은 시간) ' + txt.slice(0, 200));
  assert(/오늘 2\s*\/\s*5명 승급/.test(txt), '하루 목표(3시간)를 채운 사람 수: 공부왕·도윤');
  const weekTotal = sm.weekTotal;
  assert(/주간 목표/.test(txt) && txt.includes(sm.weekPct + '%') && /다 같이 80시간/.test(txt), '주간 목표: 다 같이 채운 % (' + sm.weekPct + '%, ' + weekTotal + '분)');
  const rankRows = await me.page.$$eval('.gr-ranks .gr-row', (ls) => ls.map((l) => ({ n: l.querySelector('.gr-who b').textContent, r: +l.querySelector('.gr-rank').textContent, me: l.classList.contains('me') })));
  const want = G.ranked(sm.rows, 'today').map((x) => x.m.n.replace(/나$/, ''));
  assert(rankRows.map((x) => x.n.replace(/나$/, '')).join() === want.join() && rankRows.find((x) => x.me).n.startsWith('공부왕'), '오늘 순위: ' + rankRows.map((x) => x.r + x.n).join(' '));
  assert(await me.page.$$eval('.gr-ranks .gr-row .gr-av.won', (a) => a.length) === 2, '하루 목표를 채운 사람에게 왕관');
  assert(await me.page.$$eval('.gr-grid tbody tr', (t) => t.length) === 5 && await me.page.$$eval('.gr-grid tbody tr.me td.ok', (t) => t.length) >= 1, '이번 주 출석표: 다섯 줄, 하루 목표를 채운 날에 왕관');
  await me.page.waitForTimeout(400);
  await me.shot('05-dashboard', true);
  // 이번 주 · 지난주 순위
  await me.tap('[data-gr-tab="week"]');
  const weekRows = await me.page.$$eval('.gr-ranks .gr-row .gr-who b', (b) => b.map((x) => x.textContent.replace(/나$/, '')));
  assert(/다 같이 이번 주/.test(await bodyText(me)) && weekRows.join() === G.ranked(sm.rows, 'week').map((x) => x.m.n).join(), "'이번 주' 순위로 바뀜: " + weekRows.join(' '));
  await me.tap('[data-gr-tab="lastWeek"]');
  assert(/다 같이 지난주/.test(await bodyText(me)), "'지난주' 순위");
  await me.tap('[data-gr-tab="today"]');
  // 개인정보: 서버가 준 답 어디에도 계정 번호·이메일·구글 이름이 없음
  const leaked = SECRETS.filter((x) => srv.bodies.some((b) => b.includes(x)));
  const stored = JSON.stringify([...hub()]);
  assert(leaked.length === 0 && !SECRETS.some((x) => stored.includes(x)), '서버의 답과 저장소 어디에도 계정 번호·이메일·구글 이름이 없음');
  const html = await me.page.content();
  assert(!['jiwoo', 'hajun', 'seoyeon', 'doyun'].some((w) => [USERS[w].email, USERS[w].displayName, USERS[w].uid].some((x) => html.includes(x))), '화면에도 친구들의 이메일·구글 이름이 없음 (내 이메일은 계정 화면에만)');

  /* ===== 7) 응원 ===== */
  await me.page.locator('.gr-ranks .gr-row', { hasText: '지우' }).first().locator('.gr-row-btn').tap();
  await me.page.waitForSelector('.ui-back.in .gr-ms');
  assert(/지우 님/.test(await sheetText(me)) && await me.page.$$eval('.ui-back.in .gr-bc', (b) => b.length) === 7 && await me.page.isVisible('.ui-back.in .gr-goal-line'), '친구를 누르면 이번 주 날마다 막대와 하루 목표 선');
  assert(await me.page.isVisible('.ui-back.in [data-gr-act="kick"]') && await me.page.isVisible('.ui-back.in [data-gr-act="lead"]'), '리더에게는 내보내기·리더 넘기기');
  await me.page.waitForTimeout(250);
  await me.shot('06-member');
  await me.page.tap('.ui-back.in [data-gr-cheer="1"]');
  await waitToast(me, /지우 님에게 🔥 힘내요를 보냈어요/);
  assert(true, '응원을 보냄');
  await me.page.waitForTimeout(2400);
  await me.page.locator('.gr-ranks .gr-row', { hasText: '지우' }).first().locator('.gr-row-btn').tap();
  await me.page.waitForSelector('.ui-back.in .gr-cheer-btn');
  await me.page.tap('.ui-back.in [data-gr-cheer="0"]');
  await waitToast(me, /10분 뒤에 다시 응원/);
  assert(true, '같은 친구에게 10분 안에 또 보내면 기다리라고 알려 줌');
  await jiwoo.page.evaluate(() => App.go('home'));
  await jiwoo.sync();
  await waitToast(jiwoo, /공부왕 님이 응원했어요 🔥 힘내요/);
  assert(true, '지우: 받은 응원을 알림으로');
  assert(await jiwoo.page.isVisible('#h-group-panel') && /수능 D-100 스터디/.test(await jiwoo.page.textContent('#h-group-panel')), "지우의 홈에 '우리 그룹' 칸");

  /* ===== 8) 함께 집중: 내가 시작 → 지우가 같이 하기 → 하준은 스톱워치를 멈추고 같이 ===== */
  await me.page.evaluate(() => App.go('group'));
  await me.tap('[data-gr="room-start"]');
  await pickChoice(me, '25분');
  await me.page.waitForFunction(() => App.timerRunning());
  s = await me.st();
  const room = s.groups[0].room;
  let tm = await me.page.evaluate(() => { const t = window.__studypromotion.timer; return { total: t.total, endAt: t.endAt, label: t.label, mode: t.mode }; });
  assert(room && room.ms.length === 1 && Math.abs(room.end - room.at - 25 * MIN) < 1000, '함께 집중 25분이 서버에 생김');
  assert(tm.mode === 'focus' && Math.abs(tm.endAt - room.end) < 2500 && tm.total <= 1500 && tm.total > 1490 && /함께 집중 · 수능 D-100 스터디/.test(tm.label), '내 집중 타이머가 함께 집중이 끝나는 시각에 맞춰 켜짐 (' + tm.total + '초)');
  assert(await me.page.evaluate(() => App.store.get().settings.focusMin) === 25, '설정의 집중 시간은 그대로');
  await me.page.evaluate(() => App.go('group'));
  await me.sync();
  assert(/함께 집중/.test(await bodyText(me)) && /같이 하는 중/.test(await bodyText(me)), '그룹 화면에 함께 집중 칸 (같이 하는 중)');
  const sync2 = me.calls().filter((c) => c.body && c.body.op === 'sync').pop();
  assert(sync2.body.lv && sync2.body.lv.k === 'focus' && Math.abs(sync2.body.lv.end - room.end) < 2500, '공부 중 표시(집중 타이머, 끝나는 시각)를 보냄');
  // 지우: 홈 칸에서 '같이 하기'
  await jiwoo.page.evaluate(() => App.go('home'));
  await jiwoo.sync();
  await jiwoo.page.waitForSelector('#h-group-panel [data-gr-home="room-join"]');
  await jiwoo.page.waitForTimeout(2600);
  await jiwoo.shot('08-home');
  await jiwoo.tap('#h-group-panel [data-gr-home="room-join"]');
  await jiwoo.page.waitForFunction(() => App.timerRunning());
  tm = await jiwoo.page.evaluate(() => window.__studypromotion.timer.endAt);
  assert(Math.abs(tm - room.end) < 2500 && await jiwoo.page.evaluate(() => App.view) === 'timer', '지우: 홈에서 같이 하기 → 같은 시각에 끝나는 타이머 (' + Math.round((tm - room.end) / 1000) + '초 차이)');
  // 하준: 스톱워치를 재는 중 → 기록하고 바꿀지 묻는다
  await hajun.page.evaluate(() => App.go('group'));
  await hajun.sync();
  await hajun.page.waitForSelector('#gr-body [data-gr="room-join"]');
  const before = await hajun.page.evaluate(() => App.store.get().sessions.length);
  // 스톱워치를 12분 잰 것으로
  await hajun.page.evaluate(() => {
    const k = 'studypromotion.stopwatch', sw = JSON.parse(localStorage.getItem(k));
    sw.startAt -= 12 * 60000;
    localStorage.setItem(k, JSON.stringify(sw));
    window.dispatchEvent(new StorageEvent('storage', { key: k }));
  });
  await hajun.tap('#gr-body [data-gr="room-join"]');
  await askYes(hajun, /스톱워치가 재는 중이에요/);
  await hajun.page.waitForFunction(() => App.timerRunning());
  assert(!(await hajun.page.evaluate(() => Stopwatch.running())) && Math.abs((await hajun.page.evaluate(() => window.__studypromotion.timer.endAt)) - room.end) < 2500, '하준: 스톱워치를 멈추고 함께 집중으로 바꿈');
  assert((await hajun.page.evaluate(() => App.store.get().sessions.length)) === before + 1, '멈춘 스톱워치의 12분은 기록으로 남김');
  await me.sync();
  s = await me.st();
  assert(s.groups[0].room.ms.length === 3, '함께 집중: 세 명');
  await me.page.evaluate(() => App.go('group'));
  await me.page.waitForTimeout(300);
  await me.page.locator('.gr-room').first().scrollIntoViewIfNeeded();
  const liveList = await me.page.$eval('.gr-live-list', (l) => l.innerText.replace(/\s+/g, ' '));
  assert(/공부왕 ?나 함께 집중 · /.test(liveList), '함께 집중 중인 사람은 ‘함께 집중’으로 표시: ' + liveList);
  await me.shot('07-room');
  await me.page.evaluate(() => App.go('timer'));
  assert(/공부 중: 함께 집중 · 수능 D-100 스터디/.test(await me.page.textContent('#timer-topic-text')), '타이머 화면에 ‘함께 집중 · 그룹 이름’');
  await me.shot('07b-timer');
  // 그만하기
  await hajun.page.evaluate(() => App.go('group'));
  await hajun.tap('#gr-body [data-gr="room-leave"]');
  await askYes(hajun, /함께 집중을 그만할까요/);
  await hajun.page.waitForFunction(() => !App.timerRunning());
  await me.sync();
  assert((await me.st()).groups[0].room.ms.length === 2, '하준이 그만하면 두 명');

  /* ===== 9) 리더: 목표·이름 바꾸기, 내보내기와 다시 받기, 리더 넘기기 ===== */
  await me.page.evaluate(() => App.go('group'));
  await me.tap('[data-gr="menu"]');
  await pickChoice(me, '목표 바꾸기');
  await me.page.waitForSelector('#gr-dlg:not([hidden]) #gr-goal-day');
  await me.page.selectOption('#gr-goal-day', '240');
  await me.page.tap('#gr-dlg-ok');
  await waitToast(me, /목표를 바꿨어요/);
  assert((await me.st()).groups[0].goal.day === 240, '하루 목표를 4시간으로');
  await me.tap('[data-gr="menu"]');
  await pickChoice(me, '그룹 이름 바꾸기');
  await me.page.fill('#gr-gname', '수능 D-99 스터디');
  await me.page.tap('#gr-dlg-ok');
  await waitToast(me, /그룹 이름을 바꿨어요/);
  // 도윤 내보내기 → 다시 못 들어옴 → 다시 받기
  await me.page.locator('.gr-ranks .gr-row', { hasText: '도윤' }).first().locator('.gr-row-btn').tap();
  await me.page.tap('.ui-back.in [data-gr-act="kick"]');
  await askYes(me, /도윤 님을 그룹에서 내보낼까요/);
  await waitToast(me, /도윤 님을 내보냈어요/);
  r = await api('doyun', { op: 'join', code });
  assert(r.error === 'banned' && (await me.st()).groups[0].ms.length === 4, '내보낸 사람은 같은 코드로 다시 못 들어옴');
  r = await api('doyun', null);
  assert(r.ok && r.groups.length === 0, '도윤에게는 그룹이 없어짐');
  await me.tap('[data-gr="menu"]');
  await pickChoice(me, '내보낸 사람 다시 받기');
  await waitToast(me, /다시 들어올 수 있어요/);
  r = await api('doyun', { op: 'join', code });
  assert(r.ok && r.groups[0].ms.length === 5, '다시 받기를 누르면 들어올 수 있음');
  // 리더 넘기기 (지우에게) → 지우의 메뉴에 리더 일
  await me.sync();
  await me.page.locator('.gr-ranks .gr-row', { hasText: '지우' }).first().locator('.gr-row-btn').tap();
  await me.page.tap('.ui-back.in [data-gr-act="lead"]');
  await askYes(me, /지우 님에게 리더를 넘길까요/);
  await waitToast(me, /지우 님이 리더가 됐어요/);
  assert(!(await me.page.isVisible('.gr-goals [data-gr="goal"]')), '리더를 넘기면 나는 목표를 못 바꿈');
  await jiwoo.page.evaluate(() => App.go('group'));
  await jiwoo.sync();
  assert(await jiwoo.page.isVisible('.gr-goals [data-gr="goal"]'), '지우는 이제 목표를 바꿀 수 있음');

  /* ===== 10) 별명 바꾸기, 과목 이름 숨기기 ===== */
  await me.tap('[data-gr="nick"]');
  await me.page.fill('#gr-nick', '공부왕7');
  await me.page.tap('#gr-dlg-ok');
  await waitToast(me, /별명을 바꿨어요/);
  assert((await me.st()).me.n === '공부왕7', '별명을 바꾸면 모든 그룹에 같게');
  await hajun.page.evaluate(() => { const s = App.store.get().subjects.find((x) => x.name === '수학'); Stopwatch.start(s.id); });
  await hajun.page.evaluate(() => App.go('group'));
  await hajun.page.locator('#gr-sub').scrollIntoViewIfNeeded();
  await hajun.page.locator('#gr-sub').tap();
  await hajun.page.waitForTimeout(400);
  await hajun.sync();
  const lastLive = hajun.calls().filter((c) => c.body && c.body.op === 'sync').pop().body.lv;
  assert(lastLive && lastLive.k === 'sw' && lastLive.s === undefined, '과목 이름 보이기를 끄면 공부 중 표시에 과목을 안 보냄');

  /* ===== 11) 인터넷이 끊기면 마지막으로 받은 내용 ===== */
  srv.down = true;
  await me.page.evaluate(() => App.go('group'));
  await me.page.evaluate(() => Group.refresh());
  await me.page.waitForSelector('#gr-body .gr-stale');
  assert(/인터넷이 없어 .*받은 내용을 보여 줘요/.test(await bodyText(me)) && await me.page.isVisible('.gr-hero'), '인터넷이 없으면 마지막으로 받은 그룹을 보여 줌');
  srv.down = false;
  await me.sync();
  assert(!(await me.page.$('#gr-body .gr-stale')), '다시 연결되면 안내가 사라짐');

  /* ===== 12) 나가기: 마지막 사람이 나가면 그룹이 없어짐 ===== */
  await hajun.page.evaluate(() => App.go('group'));
  await hajun.tap('[data-gr="leave"]');
  await askYes(hajun, /그룹에서 나갈까요/);
  await waitToast(hajun, /그룹에서 나왔어요/);
  await hajun.page.waitForSelector('#gr-body .gr-perks');
  assert((await hajun.st()).groups.length === 0, '하준이 나가면 그룹이 없는 화면으로');
  const hu = [...hub()].find(([k, v]) => k.startsWith('u:') && v.n === '하준');
  assert(hu && Object.keys(hu[1].d).length === 0 && !hu[1].lv, '그룹을 모두 나가면 서버의 공부 시간·공부 중 표시를 지움');
  const nBefore = hajun.calls().length;
  await hajun.page.evaluate(() => { App.store.update((st) => st.sessions.push({ id: 'after', subjectId: null, minutes: 30, endedAt: Date.now(), manual: true })); });
  await hajun.page.waitForTimeout(3200);
  assert(!hajun.calls().slice(nBefore).some((c) => c.body && c.body.op === 'sync'), '그룹이 없으면 공부 시간을 보내지 않음');

  /* ===== 13) 그룹 기능을 끄면 탭이 사라지고 서버와 주고받지 않음 ===== */
  await me.page.evaluate(() => Features.set('group', false));
  await me.page.waitForTimeout(200);
  assert(await me.page.isHidden('nav.tabs .tab[data-view="group"]') && await me.page.evaluate(() => App.view) === 'home' && await me.page.isHidden('#h-group-panel'), '그룹을 끄면 탭과 홈 칸이 숨고 홈으로');
  const nOff = me.calls().length;
  await me.page.evaluate(() => { App.store.update((st) => st.sessions.push({ id: 'off', subjectId: null, minutes: 20, endedAt: Date.now(), manual: true })); });
  await me.page.waitForTimeout(3200);
  await me.page.evaluate(() => Group.refresh());
  await me.page.waitForTimeout(300);
  assert(me.calls().length === nOff, '꺼 두면 서버에 아무것도 보내지 않음');
  await me.page.evaluate(() => Features.set('group', true));
  await me.page.waitForTimeout(400);
  assert(me.calls().length > nOff, '다시 켜면 바로 맞춤');

  /* ===== 14) 다른 주소에서 연 앱: 그룹은 쓸 수 없다고 알려 줌 ===== */
  const other = await person('me', { tag: 'other' });
  await other.page.goto(OTHER + '/studypromotion/#group');
  await other.page.waitForSelector('#gr-body .gr-empty');
  assert(/앱 주소에서 쓸 수 있어요/.test(await bodyText(other)) && other.calls().length === 0, '다른 주소(미리 보기 등)에서는 안내만 하고 서버에 묻지 않음');
  await other.ctx.close();

  /* ===== 15) 어두운 화면 (미리 보기 그림) ===== */
  if (SHOTS) {
    const dark = await person('me', { dark: true, tag: 'dark' });
    await dark.page.goto(APP + '#account');
    await dark.login();
    await dark.seed({ 0: 200, 1: 240, 2: 150, 3: 185 });
    await dark.page.evaluate(() => App.go('group'));
    await dark.page.waitForSelector('#gr-body .gr-hero');
    await dark.sync();
    await dark.page.waitForTimeout(2600);
    await dark.shot('09-dashboard-dark', true);
    await dark.ctx.close();
  }

  assert(errors.length === 0, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  console.log('그룹 스터디 시험 통과');
})().catch((e) => { console.error(e); process.exit(1); });
