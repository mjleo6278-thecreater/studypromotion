// AI 도우미가 진짜 서버를 부르는 길: 먼저 써 보기(서버가 열어 준 사람에게만 단추), 로그인 확인표 보내기, 조금씩 오는 답 읽기.
// 앱은 실제 주소(github.io)에서 열린 것처럼, 로그인(Firebase)과 AI 서버(workers.dev)는 모두 가짜로 바꿔 끼운다. 바깥으로 나가는 요청은 없다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const HOME = 'https://mjleo6278-thecreater.github.io';
const APP = HOME + '/studypromotion/';
const API = 'https://studypromotion-ai.mj-leo6278.workers.dev';

// 가짜 로그인: 구글 단추를 누르면 g1 계정, 확인표는 'tok-g1'. 계정 기록은 올리지도 받지도 않는다
const FAKE = `
(function(){
  let cur = null; const subs = [];
  const wrap = (u) => u && Object.assign({ getIdToken: async () => 'tok-' + u.uid }, u);
  const setUser = (u) => { cur = wrap(u); try { localStorage.setItem('fakeUser', JSON.stringify(u)); } catch (e) {} subs.forEach((f) => f(cur)); };
  try { cur = wrap(JSON.parse(localStorage.getItem('fakeUser'))); } catch (e) {}
  const auth = {
    onAuthStateChanged(f) { subs.push(f); setTimeout(() => f(cur), 0); },
    getRedirectResult: async () => null,
    signInWithPopup: async () => setUser({ uid: 'g1', email: 'student@gmail.com' }),
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

(async () => {
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];
  // 가짜 서버의 상태: 테스트가 바꿔 가며 쓴다
  const srv = { openTo: 'owner', owners: ['tok-g1'], used: 0, limit: 20, calls: [], meDelay: 0, down: false, answer: '**echar de menos**는 그리워하다라는 뜻이에요.' };
  const cors = { 'Access-Control-Allow-Origin': HOME, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const json = (route, body, status) => route.fulfill({ status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: JSON.stringify(body) });

  async function open(extra) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, locale: 'ko-KR', serviceWorkers: 'block' }, extra || {}));
    await ctx.addInitScript(() => { try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ } });
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
      const where = new URL(req.url()).pathname;
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (srv.down) return route.abort('internetdisconnected');
      const token = ((await req.headerValue('authorization')) || '').replace(/^Bearer\s+/, '');
      const owner = srv.owners.includes(token);
      const everyone = srv.openTo === 'all';
      srv.calls.push({ where, token, body: req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null });
      if (where === '/me') {
        if (srv.meDelay) await new Promise((ok) => setTimeout(ok, srv.meDelay));
        if (!token) return json(route, { open: everyone, signedIn: false });
        if (owner) return json(route, { open: true, signedIn: true, unlimited: true });
        if (!everyone) return json(route, { open: false, signedIn: true });
        return json(route, { open: true, signedIn: true, unlimited: false, left: srv.limit - srv.used, limit: srv.limit });
      }
      if (where !== '/chat') return json(route, { error: 'not_found' }, 404);
      if (!token) return json(route, { error: 'login' }, 401);
      if (!owner && !everyone) return json(route, { error: 'closed' }, 403);
      if (!owner && srv.used >= srv.limit) return json(route, { error: 'limit' }, 429);
      if (!owner) srv.used++;
      const half = Math.ceil(srv.answer.length / 2);
      const lines = [{ t: srv.answer.slice(0, half) }, { t: srv.answer.slice(half) }, owner ? { unlimited: true } : { left: srv.limit - srv.used }];
      route.fulfill({ headers: Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8' }, cors), body: lines.map((l) => 'data: ' + JSON.stringify(l) + '\n\n').join('') + 'data: [DONE]\n\n' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    // 일부러 낸 실패(인터넷 끊김, 횟수 다 씀, 아직 안 열림)를 브라우저가 적는 줄은 뺀다
    page.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|status of (429|403)/.test(m.text()) && errors.push(m.text()));
    await page.goto(APP);
    await page.waitForFunction(() => window.App && window.AICore && window.Cloud);
    return page;
  }
  const me = () => srv.calls.filter((c) => c.where === '/me');
  const chat = () => srv.calls.filter((c) => c.where === '/chat');
  const login = async (page) => {
    await page.evaluate(() => { location.hash = '#account'; });
    await page.waitForSelector('#acc-google:not([disabled])');
    await page.click('#acc-google');
    await page.waitForFunction(() => Cloud.user);
  };
  // 기억해 둔 서버 답을 오래된 것으로 만든다 (10분이 지난 것처럼)
  const stale = (page) => page.evaluate(() => { const g = JSON.parse(localStorage.getItem('studypromotion.ai.gate')); g.at = 0; localStorage.setItem('studypromotion.ai.gate', JSON.stringify(g)); });
  const ask = async (page, text) => {
    const n = await page.locator('#ai-log .ai-msg').count();
    await page.evaluate((t) => AI.send(t), text);
    await page.waitForFunction((k) => !AI.busy && document.querySelectorAll('#ai-log .ai-msg').length === k + 2, n);
    await page.waitForTimeout(60);
  };

  /* ===== 1) 먼저 써 보기: 로그인 안 한 사람에게는 단추가 없다 ===== */
  let page = await open();
  await page.waitForFunction(() => document.querySelector('#ai-fab'));
  await page.waitForTimeout(300);
  assert(me().length === 1 && me()[0].token === '', '열면 서버에 한 번 묻는다 (로그인 전이라 확인표 없이)');
  assert(await page.isHidden('#ai-fab'), '주인만 쓰는 동안 로그인 안 한 사람에게는 단추가 안 보임');

  /* ===== 2) 주인 계정으로 로그인하면 단추가 생기고 횟수 제한이 없다 ===== */
  await login(page);
  await page.waitForSelector('#ai-fab:not([hidden])');
  assert(me().length === 2 && me()[1].token === 'tok-g1', '로그인하면 확인표와 함께 다시 묻는다');
  await page.evaluate(() => { location.hash = '#today'; });
  await page.tap('#ai-fab');
  await page.waitForSelector('#ai-panel .ai-sheet');
  await page.waitForTimeout(300);
  assert((await page.textContent('#ai-left')) === '횟수 제한 없음', "주인 계정은 묻기 전부터 '횟수 제한 없음'");
  await ask(page, 'echar de menos가 무슨 뜻이야?');
  const sent = chat()[0];
  assert(sent.token === 'tok-g1' && sent.body.messages[0].role === 'system' && sent.body.messages[sent.body.messages.length - 1].content === 'echar de menos가 무슨 뜻이야?', '질문을 로그인 확인표와 함께 서버로 보냄');
  assert((await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-text b').textContent()) === 'echar de menos' && /그리워하다/.test(await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-text').textContent()), '조금씩 온 답을 이어 붙여 보여 줌');
  assert((await page.textContent('#ai-left')) === '횟수 제한 없음' && srv.used === 0, '주인 계정은 횟수를 쓰지 않음');

  /* ===== 3) 다시 열면 기억해 둔 답으로 단추가 바로 보인다 ===== */
  let before = me().length;
  await page.reload();
  await page.waitForFunction(() => window.Cloud && Cloud.user);
  await page.waitForTimeout(300);
  assert(await page.isVisible('#ai-fab') && me().length === before, '방금 물었으면 다시 묻지 않고 단추가 바로 보임');
  srv.meDelay = 1500;
  await stale(page);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#ai-fab'));
  assert(await page.isVisible('#ai-fab'), '오래됐어도 서버 답을 기다리지 않고 단추가 바로 보임');
  await page.waitForFunction(() => window.Cloud && Cloud.user);
  await page.waitForTimeout(1900);
  assert(me().length === before + 1 && me()[before].token === 'tok-g1' && await page.isVisible('#ai-fab'), '로그인이 이어진 뒤에 한 번만 다시 묻는다 (로그인 전에는 묻지 않음)');
  srv.meDelay = 0;

  /* ===== 4) 인터넷이 없으면 기억해 둔 대로, 물으면 알림 ===== */
  srv.down = true;
  await stale(page);
  await page.reload();
  await page.waitForFunction(() => window.Cloud && Cloud.user);
  await page.waitForTimeout(300);
  assert(await page.isVisible('#ai-fab'), '서버에 못 닿아도 단추는 그대로');
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);
  await ask(page, '지금 돼?');
  assert(/인터넷에 연결되지 않아/.test(await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-err').textContent()), '인터넷이 없으면 알림');
  srv.down = false;

  /* ===== 5) 로그아웃하면 단추가 사라진다 ===== */
  await page.evaluate(() => { AI.close(); location.hash = '#account'; });
  await page.click('#acc-logout'); await page.click('#ask-ok');
  await page.waitForFunction(() => !Cloud.user);
  await page.waitForSelector('#ai-fab', { state: 'hidden' });
  assert(me()[me().length - 1].token === '' && await page.isHidden('#ai-panel'), '로그아웃하면 다시 묻고 단추와 창이 사라짐');

  /* ===== 6) 주인이 아닌 계정: 닫혀 있으면 안 보이고, 모두에게 열면 하루 횟수와 함께 보인다 ===== */
  srv.owners = [];
  await login(page);
  await page.waitForTimeout(300);
  assert(me()[me().length - 1].token === 'tok-g1' && await page.isHidden('#ai-fab'), '주인이 아니면 로그인해도 단추가 안 보임');
  srv.openTo = 'all';
  srv.used = 18;
  await stale(page);
  await page.reload();
  await page.waitForSelector('#ai-fab:not([hidden])');
  await page.evaluate(() => { location.hash = '#today'; });
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);
  assert((await page.textContent('#ai-left')) === '오늘 2번 남음', '모두에게 열면 단추가 보이고 남은 횟수를 알려 줌');
  await ask(page, '하나');
  assert((await page.textContent('#ai-left')) === '오늘 1번 남음', '물을 때마다 남은 횟수가 줄어듦');
  await ask(page, '둘');
  await ask(page, '셋');
  assert(/오늘 쓸 수 있는 횟수를 다 썼어요/.test(await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-err').textContent()), '하루 횟수를 다 쓰면 알림');
  srv.openTo = 'owner';
  await ask(page, '넷');
  assert(/먼저 써 보는 중/.test(await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-err').textContent()), '서버가 다시 닫히면 알림');
  srv.openTo = 'all';

  /* ===== 7) 모두에게 열려 있으면 로그인 전에도 단추가 보이고, 물으면 로그인하라고 알려 준다 ===== */
  await page.evaluate(() => { AI.close(); location.hash = '#account'; });
  await page.click('#acc-logout'); await page.click('#ask-ok');
  await page.waitForFunction(() => !Cloud.user);
  await page.waitForTimeout(300);
  assert(await page.isVisible('#ai-fab'), '모두에게 열려 있으면 로그인 전에도 단추가 보임');
  await page.evaluate(() => { location.hash = '#today'; });
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);
  const chats = chat().length;
  await ask(page, '로그인 안 했는데?');
  assert(chat().length === chats && await page.locator('#ai-log .ai-msg.ai').last().locator('[data-ai-go="account"]').isVisible(), '로그인 전에는 서버로 보내지 않고 로그인하러 가기를 보여 줌');
  await page.context().close();

  /* ===== 8) 다른 주소(개발용)에서는 AI 도우미를 켜지 않는다 ===== */
  const http = require('http');
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, r));
  const calls = srv.calls.length;
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const out = [];
  await ctx.route(API + '/**', (route) => { out.push(route.request().url()); route.abort(); });
  const local = await ctx.newPage();
  local.on('pageerror', (e) => errors.push(e.message));
  local.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await local.goto(`http://localhost:${server.address().port}/`);
  await local.waitForFunction(() => window.App && window.AICore);
  await local.waitForTimeout(400);
  assert((await local.locator('#ai-fab').count()) === 0 && !out.length && srv.calls.length === calls && await local.evaluate(() => !window.AI), '실제 앱 주소가 아니면 단추도 없고 서버도 부르지 않음');
  await ctx.close();
  server.close();

  assert(!errors.length, '콘솔 오류 없음' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
