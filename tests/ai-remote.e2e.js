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
  //  chunks: 모델이 보내는 줄을 직접 정할 때 / fail: 모델이 오류를 낼 때 서버가 보내는 답 / old: 예전 서버처럼 답하기
  const srv = { openTo: 'owner', owners: ['tok-g1'], used: 0, limit: 20, calls: [], meDelay: 0, down: false, answer: '**echar de menos**는 그리워하다라는 뜻이에요.', chunks: null, fail: null, old: false };
  const cors = { 'Access-Control-Allow-Origin': HOME, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Expose-Headers': 'X-AI-Left, X-AI-Unlimited, X-AI-Mode' };
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
      // 그룹 스터디(v3.11): 이 시험의 사람들은 그룹에 들지 않았다
      if (where === '/group') return token ? json(route, { ok: true, me: { id: '0123456789abcdef', n: null }, groups: [], lim: { members: 20, groups: 5 } }) : json(route, { error: 'login' }, 401);
      if (where !== '/chat') return json(route, { error: 'not_found' }, 404);
      if (!token) return json(route, { error: 'login' }, 401);
      if (!owner && !everyone) return json(route, { error: 'closed' }, 403);
      if (!owner && srv.used >= srv.limit) return json(route, { error: 'limit' }, 429);
      if (srv.fail) return json(route, srv.fail, 503);
      if (!owner) srv.used++;
      const half = Math.ceil(srv.answer.length / 2);
      const sse = (lines) => lines.map((l) => 'data: ' + JSON.stringify(l) + '\n\n').join('') + 'data: [DONE]\n\n';
      const type = { 'Content-Type': 'text/event-stream; charset=utf-8' };
      if (srv.old || srv.calls[srv.calls.length - 1].body.v !== 2) {
        // 예전 서버: 글 조각을 다시 적어 보내고 남은 횟수는 답의 끝에
        return route.fulfill({ headers: Object.assign({}, type, cors), body: sse([{ t: srv.answer.slice(0, half) }, { t: srv.answer.slice(half) }, owner ? { unlimited: true } : { left: srv.limit - srv.used }]) });
      }
      // 새 서버(v 2): 모델이 보내는 줄 그대로, 남은 횟수는 머리말로
      const chunks = (srv.queue && srv.queue.length ? srv.queue.shift() : null) || srv.chunks || [
        { choices: [{ index: 0, delta: { role: 'assistant', content: srv.answer.slice(0, half) } }] },
        { choices: [{ index: 0, delta: { content: srv.answer.slice(half) }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 500, completion_tokens: 40 } },
      ];
      route.fulfill({ headers: Object.assign({}, type, cors, { 'X-AI-Mode': 'full' }, owner ? { 'X-AI-Unlimited': '1' } : { 'X-AI-Left': String(srv.limit - srv.used) }), body: sse(chunks) });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    // 일부러 낸 실패(인터넷 끊김, 횟수 다 씀, 아직 안 열림)를 브라우저가 적는 줄은 뺀다
    page.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|status of (429|403|503)/.test(m.text()) && errors.push(m.text()));
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
  assert(sent.body.v === 2, '새 약속(v 2)으로 묻는다: 서버가 모델의 답을 손대지 않고 넘겨 준다');
  assert(sent.token === 'tok-g1' && sent.body.messages[0].role === 'system' && sent.body.messages[sent.body.messages.length - 1].content === 'echar de menos가 무슨 뜻이야?', '질문을 로그인 확인표와 함께 서버로 보냄');
  assert((await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-text b').textContent()) === 'echar de menos' && /그리워하다/.test(await page.locator('#ai-log .ai-msg.ai').last().locator('.ai-text').textContent()), '조금씩 온 답을 이어 붙여 보여 줌');
  assert((await page.textContent('#ai-left')) === '횟수 제한 없음' && srv.used === 0, '주인 계정은 횟수를 쓰지 않음');

  /* ===== 2-1) 반복 일정을 말로 넣는다 (2026-11-15에 실제로 실패했던 말) ===== */
  const last = () => page.locator('#ai-log .ai-msg.ai').last();
  const WEEKLY = '{"type":"add_event","kind":"other","title":"정아름 영어","start":"18:30","end":"22:00","repeat":"weekly","days":["일"]}';
  const word = (t, more) => ({ choices: [Object.assign({ index: 0, delta: { content: t } }, more || {})] });
  const think = (t) => ({ choices: [{ index: 0, delta: { content: null, reasoning_content: t } }] });
  srv.chunks = [word('매주 일요일 18시 30분부터 22시까지 '), word('넣을게요.\n<actions>[' + WEEKLY), word(']</actions>', { finish_reason: 'stop' })];
  await ask(page, '매주 일요일 18시 30분부터 22시까지 정아름 영어 일정을 추가해줘. 이건 학원 일정이야.');
  assert(/일정 추가: 정아름 영어/.test(await last().locator('.ai-plan').textContent()) && /18:30~22:00 · 매주 일 · 다른 일정/.test(await last().locator('.ai-plan').textContent()), '매주 반복 일정을 제안 한 줄로 보여 줌');
  assert((await last().locator('.ai-diag').count()) === 0, "문제가 없으면 '자세히'가 없음");
  await last().locator('[data-plan-apply]').tap();
  const added = await page.evaluate(() => App.store.get().events.filter((e) => e.title === '정아름 영어'));
  assert(added.length === 1 && added[0].kind === 'other' && added[0].start === '18:30' && added[0].end === '22:00' && added[0].repeat.freq === 'weekly' && String(added[0].repeat.days) === '0' && new Date(added[0].date + 'T12:00').getDay() === 0, '적용하면 가장 가까운 일요일부터 매주 반복하는 일정 하나가 생김');
  // 다음 질문에는 앞에서 낸 제안과 그 뒤에 어떻게 됐는지를 붙인다 ("그거 7시로 바꿔 줘"를 알아듣게, v3.3.1)
  srv.chunks = null;
  await ask(page, '고마워');
  const prev = chat()[chat().length - 1].body.messages;
  assert(prev.some((m) => m.role === 'assistant' && /넣을게요\.\n\[앱 기록: 이때 낸 제안 적용함 — 일정 추가: 정아름 영어 \(.*18:30~22:00 · 매주 일/.test(m.content)), '다음 질문에 앞에서 낸 제안과 적용했는지를 붙여 보냄');
  // AI가 앱 정보가 필요하다고 하면 앱 정보를 붙여 다시 묻고, 서버에 다시 묻는 것이라고 알린다(하루 횟수를 두 번 세지 않게)
  srv.queue = [[word('<need_app/>', { finish_reason: 'stop' })], [word('내일은 일정이 없어요.', { finish_reason: 'stop' })]];
  const sentBefore = chat().length;
  await ask(page, '내일 뭐 있어?');
  const two = chat().slice(sentBefore);
  assert(two.length === 2 && two[0].body.again === undefined && two[1].body.again === true && !/\[앱 정보\]/.test(two[0].body.messages[0].content) && /\[앱 정보\]/.test(two[1].body.messages[0].content), '앱 정보가 필요하다고 하면 붙여서 다시 묻고, 다시 묻는 것이라고 알림');
  assert(/내일은 일정이 없어요/.test(await last().textContent()) && !/need_app/.test(await last().textContent()), '다시 받은 답만 보임');
  srv.queue = null;

  /* ===== 2-2) 답이 온전히 오지 않을 때: 받은 데까지 살리고 까닭을 보여 준다 ===== */
  // 모델이 생각에 답 길이를 다 써서 동작 목록이 중간에 끊김
  srv.chunks = [think('사용자가 일정을 원한다. '), think('매주 일요일이다.'), word('넣을게요.\n<actions>[' + WEEKLY.replace('정아름 영어', '끊긴 답') + ',{"type":"add_event","title":"둘째","sta', { finish_reason: 'length' }), { choices: [], usage: { prompt_tokens: 900, completion_tokens: 2000, completion_tokens_details: { reasoning_tokens: 1800 } } }];
  await ask(page, '일정 두 개 넣어 줘');
  assert((await last().locator('.ai-plan .ai-op').count()) === 1 && /끊긴 답/.test(await last().locator('.ai-plan').textContent()) && /읽은 데까지만/.test(await last().locator('.ai-plan .ai-rej').textContent()), '끊긴 동작 목록에서 끝까지 온 것만 제안하고 그 사실을 알림');
  let diag = await last().locator('.ai-diag p').textContent();
  assert(/응답 200 full/.test(diag) && /생각 \d+자/.test(diag) && /끝 length/.test(diag) && /쓴 양 2000\(생각 1800\)/.test(diag) && /끝부분: .*"sta$/.test(diag), "'자세히'에 까닭을 찾을 숫자가 있음 (생각한 양, 끝난 까닭, 쓴 양, 답의 끝부분)");
  assert(!(await last().locator('.ai-diag').evaluate((el) => el.open)), "'자세히'는 접혀 있음");
  // 하나도 끝까지 오지 않음
  srv.chunks = [word('넣을게요.\n<actions>[{"type":"add_event","tit', { finish_reason: 'length' })];
  await ask(page, '일정 넣어 줘');
  assert(/답이 길어서 제안이 끝까지 오지 못했어요/.test(await last().locator('.ai-rej').textContent()) && (await last().locator('.ai-plan').count()) === 0 && (await last().locator('.ai-diag').count()) === 1, '제안을 하나도 못 읽으면 까닭과 함께 알림');
  // 글만 오다가 길이 제한에 걸림
  srv.chunks = [word('**뜻** 그리워하다. 구문 풀이는', { finish_reason: 'length' })];
  await ask(page, 'echar de menos 길게 풀이');
  assert(/그리워하다/.test(await last().locator('.ai-text').textContent()) && /답이 길어서 끝까지 오지 못했어요/.test(await last().locator('.ai-rej').textContent()), '글이 길이 제한에 걸려 끊기면 받은 데까지 보여 주고 알림');
  // 생각만 하다가 한 글자도 못 보냄
  srv.chunks = [think('음...'), think('아직 생각 중'), { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] }];
  await ask(page, '일정 추가가 안됐어');
  assert(/AI가 빈 답을 보냈어요/.test(await last().locator('.ai-err').textContent()) && await last().locator('[data-retry]').isVisible(), '빈 답이면 알리고 다시 보내기를 보여 줌');
  diag = await last().locator('.ai-diag p').textContent();
  assert(/글 0자/.test(diag) && /생각 \d+자/.test(diag) && /끝 length/.test(diag), "빈 답의 '자세히'에 생각만 하다 끝났다는 것이 보임");
  // 모델이 오류를 냄: 서버가 주인 계정에만 까닭을 적어 보낸다
  srv.chunks = null;
  srv.fail = { error: 'server', detail: '3040: capacity temporarily exceeded' };
  await ask(page, '지금 돼?');
  assert(/AI가 지금 답하지 못했어요/.test(await last().locator('.ai-err').textContent()) && /응답 503/.test(await last().locator('.ai-diag p').textContent()) && /3040: capacity temporarily exceeded/.test(await last().locator('.ai-diag p').textContent()), "서버 오류면 '자세히'에 서버가 알려 준 까닭이 보임");
  srv.fail = null;
  await last().locator('[data-retry]').tap();
  await page.waitForFunction(() => !AI.busy && /그리워하다/.test((document.querySelector('#ai-log .ai-msg.ai:last-child .ai-text') || {}).textContent || ''));
  assert((await page.locator('#ai-log .ai-err').count()) === 1, '다시 보내기로 답을 받으면 그 알림은 사라짐 (앞의 빈 답 알림만 남음)');
  // 예전 서버(답을 다시 적어 보내는 모양)와도 통한다
  srv.old = true;
  await ask(page, '예전 서버야?');
  assert(/그리워하다/.test(await last().locator('.ai-text').textContent()) && (await page.textContent('#ai-left')) === '횟수 제한 없음', '예전 서버의 답도 읽음');
  srv.old = false;
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('studypromotion.ai')); s.msgs = []; localStorage.setItem('studypromotion.ai', JSON.stringify(s)); });

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
