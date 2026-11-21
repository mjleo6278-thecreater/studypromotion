// v4.3 채팅에 붙이는 것: 앱(js/chatattach.js)과 진짜 서버 코드(worker/src/index.js의 /group op say·thumbs·file·unsay)를 이어서,
// 친구 여럿이 사진·공부 기록 카드·단어장을 주고받는 모습을 확인한다. 준비는 tests/group-chat.e2e.js와 같다
// (앱은 github.io에서 열린 것처럼, 로그인은 가짜, 서버 주소로 가는 요청은 이 시험 안에서 서버 코드가 답한다. 바깥으로 나가는 요청은 없다).
// 나(리더)·지우는 폰 앱, 지우는 컴퓨터로도, 서연·도윤은 서버에 직접 요청한다.
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
const MIN = 60000, DAY = 86400000;
const MARK = 'SECRET-CAMERA-GPS-37.5665N-126.9780E'; // 사진에 숨겨 둔 기기·장소 정보 (보낸 사진에 남으면 안 된다)

const USERS = {
  me: { uid: 'uidMeQ7x81Lr', email: 'me.private@example.com', displayName: '비공개이름하나' },
  jiwoo: { uid: 'uidJiwooP3k2', email: 'jiwoo.private@example.com', displayName: '비공개이름둘' },
  seoyeon: { uid: 'uidSeoyeonW5', email: 'seoyeon.private@example.com', displayName: '비공개이름넷' },
  doyun: { uid: 'uidDoyunR8t6', email: 'doyun.private@example.com', displayName: '비공개이름다섯' },
};
const SECRETS = Object.values(USERS).flatMap((u) => [u.uid, u.email, u.displayName]);

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

// JPEG에 EXIF(기기 이름 칸에 MARK, 방향)를 끼워 넣는다: 폰 사진처럼
function withExif(jpg, text, orient) {
  const str = Buffer.from(text + '\0', 'latin1');
  const n = orient ? 2 : 1, strOff = 8 + 2 + 12 * n + 4;
  const tiff = Buffer.alloc(strOff);
  tiff.write('II', 0, 'latin1'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(n, 8);
  let o = 10;
  tiff.writeUInt16LE(0x010f, o); tiff.writeUInt16LE(2, o + 2); tiff.writeUInt32LE(str.length, o + 4); tiff.writeUInt32LE(strOff, o + 8); o += 12;
  if (orient) { tiff.writeUInt16LE(0x0112, o); tiff.writeUInt16LE(3, o + 2); tiff.writeUInt32LE(1, o + 4); tiff.writeUInt16LE(orient, o + 8); o += 12; }
  tiff.writeUInt32LE(0, o);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, str]);
  const seg = Buffer.alloc(4); seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), seg, body, jpg.subarray(2)]);
}
// JPEG의 가로·세로 (SOF 칸에서)
function jpegDims(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
const hasExif = (buf) => buf.includes(Buffer.from('Exif\0\0', 'latin1'));

(async () => {
  const W = await import('../worker/src/index.js');
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };

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
  const api = async (who, body) => {
    const init = { method: body ? 'POST' : 'GET', headers: { Origin: HOME, Authorization: 'Bearer ' + TOK[USERS[who].uid], 'Content-Type': 'application/json' } };
    if (body) init.body = JSON.stringify(body);
    const res = await W.handle(new Request(API + '/group', init), env, { now: Date.now(), fetch: jwks });
    const j = await res.json();
    srv.bodies.push(JSON.stringify(j));
    return j;
  };

  const browser = await chromium.launch();
  const errors = [];
  async function person(who, opts) {
    opts = opts || {};
    const tag = opts.tag || who;
    const ctx = await browser.newContext({ ...(opts.pc ? { viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }), locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', deviceScaleFactor: SHOTS ? 2 : 1, colorScheme: opts.dark ? 'dark' : 'light', acceptDownloads: true });
    await ctx.addInitScript(([tok, who]) => {
      window.__TOK = tok;
      try { localStorage.setItem('studypromotion.welcomeClosed', '1'); localStorage.setItem('fakeNext', who); } catch (e) { /* 무시 */ }
    }, [TOK, who]);
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
      if (where === '/group' && req.method() !== 'OPTIONS') srv.calls.push({ who: tag, method: req.method(), size: (init.body || '').length, body: init.body ? JSON.parse(init.body) : null });
      const res = await W.handle(new Request(req.url(), init), env, { now: Date.now(), fetch: jwks });
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      const buf = Buffer.from(await res.arrayBuffer());
      if (where === '/group') srv.bodies.push(buf.toString());
      route.fulfill({ status: res.status, headers, body: buf });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|status of (400|401|403)/.test(m.text()) && errors.push(who + ': ' + m.text()));
    const P = {
      who, ctx, page, pc: !!opts.pc,
      tap: async (sel) => { const l = typeof sel === 'string' ? page.locator(sel).first() : sel; await l.scrollIntoViewIfNeeded(); if (opts.pc) await l.click(); else await l.tap(); },
      shot: async (name) => {
        if (!SHOTS) return;
        await page.evaluate(() => { document.documentElement.classList.add('touch'); document.querySelector('#toast').classList.remove('show'); });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      },
      calls: () => srv.calls.filter((c) => c.who === tag),
      sync: async () => { await page.evaluate(() => Group.refresh()); await page.waitForTimeout(150); },
      login: async () => {
        await page.evaluate(() => { location.hash = '#account'; });
        await page.waitForSelector('#acc-google:not([disabled])');
        await page.click('#acc-google');
        await page.waitForFunction(() => window.Cloud && Cloud.user && !Cloud.syncing);
      },
      closeSheet: async () => { if (await page.$('.ui-back.in')) { await P.tap('.ui-back.in [data-ui-close]'); await page.waitForSelector('.ui-back', { state: 'detached' }); } },
    };
    return P;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitToast = (P, re) => P.page.waitForFunction((src) => { const t = document.querySelector('#toast'); return t.classList.contains('show') && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 });
  const askYes = async (P, re, no) => {
    await P.page.waitForSelector('#ask:not([hidden])');
    if (re) assert(re.test(await P.page.textContent('#ask-msg')), '확인 창: ' + re.source);
    await P.tap(no ? '#ask-cancel' : '#ask-ok');
    await P.page.waitForSelector('#ask', { state: 'hidden' });
  };
  const choices = (P) => P.page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent).join('|'));
  const pickChoice = async (P, label) => {
    await P.page.waitForSelector('.ui-back.in .ch-opt');
    await P.tap(`.ui-back.in .ch-opt:has-text("${label}")`);
    await P.page.waitForSelector('.ui-back', { state: 'detached' });
  };
  const longPress = async (P, loc) => {
    await loc.scrollIntoViewIfNeeded();
    await P.page.waitForTimeout(150); // 목록을 굴린 소식(scroll)이 지나간 뒤에 누른다 (굴리면 꾹 누르기가 풀린다)
    const b = await loc.boundingBox();
    const at = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    await loc.dispatchEvent('pointerdown', at);
    await P.page.waitForTimeout(600);
    await loc.dispatchEvent('pointerup', at);
  };
  const openChat = async (P) => {
    await P.tap('.gc-card [data-gc="open"]');
    await P.page.waitForSelector('#gc:not([hidden])');
    await P.page.waitForFunction(() => !document.querySelector('#gc-list .gc-wait'));
  };
  const toBottom = (P) => P.page.evaluate(() => { const l = document.querySelector('#gc-list'); l.scrollTop = l.scrollHeight; });
  const settled = (P) => P.page.waitForFunction(() => !document.querySelector('#gc-list .gc-msg.sending'), null, { timeout: 15000 });
  const sheetText = (P) => P.page.$eval('.ui-back.in', (b) => b.textContent.replace(/\s+/g, ' '));
  const lines = () => { const m = hub().get('m:' + gid); return m ? m.ms : []; };
  const says = (P) => P.calls().filter((c) => c.body && c.body.op === 'say');
  const opCalls = (P, op) => P.calls().filter((c) => c.body && c.body.op === op);
  // + 메뉴를 열고 고르기
  const plus = async (P, label) => {
    await P.tap('#gc-add');
    await P.page.waitForSelector('.ui-back.in .gx-menu');
    if (label) await P.tap(`.ui-back.in .gx-menu button:has-text("${label}")`);
  };
  // 브라우저에서 사진 만들기 (그림 + 글자 + 잡음) → JPEG base64
  const genJpeg = (P, w, h, noise, q) => P.page.evaluate(async ([w, h, noise, q]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#04becd'); g.addColorStop(1, '#f5e6c8');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 36; i++) { x.fillStyle = `hsl(${(i * 37) % 360} 60% 60%)`; x.beginPath(); x.arc((i * 997) % w, (i * 613) % h, (40 + ((i * 53) % 220)) * (w / 4032), 0, 7); x.fill(); }
    x.fillStyle = '#1d2433'; x.font = `bold ${Math.round(h / 7)}px sans-serif`; x.fillText('수학 22번 ✏️', w * 0.08, h * 0.56);
    x.font = `${Math.round(h / 16)}px sans-serif`; x.fillText('∫ x² dx = x³/3 + C', w * 0.08, h * 0.74);
    if (noise) {
      const d = x.getImageData(0, 0, w, h);
      for (let i = 0; i < d.data.length; i += 4) { const n = (Math.random() - 0.5) * noise; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
      x.putImageData(d, 0, 0);
    }
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q || 0.92));
    const u = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return s.length ? btoa(s) : '';
  }, [w, h, noise, q]);
  // 앨범에서 고르기 (+ → 앨범 → 파일 고르는 창)
  const pickPhoto = async (P, file) => {
    await P.tap('#gc-add');
    await P.page.waitForSelector('.ui-back.in .gx-menu');
    const [chooser] = await Promise.all([P.page.waitForEvent('filechooser'), P.tap('.ui-back.in .gx-menu [data-gx-pick="album"]')]);
    await chooser.setFiles(file);
  };

  /* ===== 1) 그룹: 나(리더)·지우는 앱, 서연·도윤은 서버에 직접 ===== */
  const me = await person('me');
  await me.page.goto(APP + '#account');
  await me.login();
  let r = await api('me', { op: 'create', name: '수능 D-100 스터디', n: '공부왕', goal: { day: 180, week: 4800 } });
  assert(r.ok, '그룹을 만듦');
  const gid = r.groups[0].id, code = r.groups[0].code;
  for (const [who, n] of [['jiwoo', '지우'], ['seoyeon', '서연'], ['doyun', '도윤']]) assert((await api(who, { op: 'join', code, n })).ok, n + ' 들어옴');
  await me.page.evaluate(() => App.go('group'));
  await me.sync();
  await me.page.waitForSelector('#gr-body .gc-card [data-gc="open"]');
  const myId = await me.page.evaluate(() => Group.state.me.id);

  // 내 공부 기록과 덱 (오늘: 수학 집중 50분 + 스톱워치 40분, 국어 직접 30분, 영어 집중 25분 / 이번 주 월요일 수학 60분, 할 일)
  const today = await me.page.evaluate(() => {
    const now = Date.now();
    App.store.update((st) => {
      const [kor, math, eng] = st.subjects;
      const at = (back, h) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back); return Math.min(now - 60000, d.getTime() + h * 3600000); };
      const add = (s, min, end, o) => st.sessions.push(Object.assign({ id: 'seed' + Math.random().toString(36).slice(2, 9), subjectId: s.id, minutes: min, endedAt: end }, o));
      add(math, 50, at(0, 0.9)); add(math, 40, at(0, 0.95), { kind: 'stopwatch' }); add(kor, 30, at(0, 0.97), { manual: true }); add(eng, 25, at(0, 0.99));
      const dow = (new Date(now).getDay() + 6) % 7; // 오늘이 월요일에서 며칠째
      if (dow > 0) add(math, 60, at(dow, 15));
      st.tasks.push({ id: 'tk1', title: '비밀 할 일 제목', due: App.todayKey(), done: true, memo: '비밀 메모' }, { id: 'tk2', title: '수학 숙제', due: App.todayKey(), done: false });
      st.settings.dailyGoalMin = 180;
      st.decks.push({ id: 'dk1', name: '스페인어 동사', createdAt: now }, { id: 'dk2', name: '빈 덱', createdAt: now });
      [['hablar', '말하다'], ['comer', '먹다'], ['vivir', '살다'], ['tener', '가지다'], ['hacer', '하다, 만들다']].forEach(([f, b], i) => st.cards.push(SRS.newCard({ id: 'cd' + i, deckId: 'dk1', front: f, back: b, createdAt: now, reps: 4, ease: 2.8, interval: 12 }, now)));
    });
    return App.todayKey();
  });

  /* ===== 2) + 메뉴 ===== */
  await openChat(me);
  assert(await me.page.$eval('#gc-add', (b) => b.getAttribute('aria-label')) === '사진·공부 기록·단어장 보내기', '입력 칸 왼쪽에 + 단추');
  await plus(me);
  assert(await me.page.$$eval('.ui-back.in .gx-menu button', (els) => els.map((e) => e.textContent.trim()).join('|')) === '앨범|사진 찍기|공부 기록|단어장', '+ 메뉴: 앨범 · 사진 찍기 · 공부 기록 · 단어장');
  assert(/긴 변 1600픽셀로 줄여 보내고, 찍은 장소 같은 정보는 지워요/.test(await sheetText(me)), '메뉴 아래 안내: 줄여 보내고 장소 정보는 지움');
  await me.shot('20-attach-menu');
  await me.closeSheet();

  /* ===== 3) 사진 보내기: 4032×3024 폰 사진(EXIF 장소 정보) → 1600×1200, EXIF 없음 ===== */
  const raw = Buffer.from(await genJpeg(me, 4032, 3024, 14), 'base64');
  const photoFile = { name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: withExif(raw, MARK) };
  assert(photoFile.buffer.length > 900 * 1024 && photoFile.buffer.includes(Buffer.from(MARK)), '시험 사진: 큰 원본에 장소 정보가 들어 있음 (' + Math.round(photoFile.buffer.length / 1024) + 'KB)');
  await pickPhoto(me, photoFile);
  await me.page.waitForSelector('.ui-back.in .gx-photo-sheet .gx-prev');
  await me.page.waitForFunction(() => { const i = document.querySelector('.ui-back.in .gx-prev'); return i && i.complete && i.naturalWidth > 0; });
  let st = await sheetText(me);
  assert(/얼굴, 이름표, 학교, 집 주소가 보이는 사진은 그룹 사람 모두에게 보여요/.test(st), '처음 보내는 사진: 개인정보 안내 한 번');
  assert(/MB|KB/.test(st) && /찍은 장소 정보는 지워요/.test(st), '보낼 크기와 장소 정보 지움 안내');
  assert(await me.page.$eval('.ui-back.in .gx-prev', (i) => i.naturalWidth) === 1600, '미리 보기는 줄인 사진');
  await me.page.fill('.ui-back.in .gx-cap-in', '  오늘 푼   수학 22번 풀이  ');
  await me.shot('21-photo-send');
  await me.tap('.ui-back.in [data-gx-send]');
  await me.page.waitForSelector('.ui-back', { state: 'detached' });
  await me.page.waitForSelector('#gc-list .gc-msg.me .gx-ph img[src^="blob:"]');
  await settled(me);
  let say = says(me).pop();
  assert(say.body.p === 'img' && say.body.t === '오늘 푼 수학 22번 풀이' && !('loc' in say.body) && !('cap' in say.body), '보낸 것: 사진 + 한 줄로 다듬은 설명 ' + JSON.stringify(Object.keys(say.body)));
  const sent = Buffer.from(say.body.img, 'base64'), sentTh = Buffer.from(say.body.th, 'base64');
  let dm = jpegDims(sent), dt = jpegDims(sentTh);
  assert(dm.w === 1600 && dm.h === 1200 && say.body.w === 1600 && say.body.h === 1200, '긴 변 1600픽셀로 줄임 ' + JSON.stringify(dm));
  assert(sent.length <= 600 * 1024, '보통 사진은 0.6MB 아래 (' + Math.round(sent.length / 1024) + 'KB)');
  assert(dt.w === 480 && dt.h === 360 && sentTh.length <= 80 * 1024, '작은 그림 480×360 (' + Math.round(sentTh.length / 1024) + 'KB)');
  assert(!sent.includes(Buffer.from(MARK)) && !hasExif(sent) && !hasExif(sentTh) && !sentTh.includes(Buffer.from(MARK)), '보낸 사진에는 기기·장소 정보(EXIF)가 없음');
  let photoLine = lines().filter((x) => x.p === 'img').pop();
  const aid1 = photoLine.a;
  assert(/^[0-9a-z]{12}$/.test(aid1) && hub().get('a:' + aid1).b === say.body.img && hub().get('a:' + aid1 + ':s') === say.body.th, '서버에 사진과 작은 그림이 따로 저장됨');
  assert(!JSON.stringify(hub().get('m:' + gid)).includes(say.body.th.slice(0, 200)), '채팅 기록에는 사진이 들어 있지 않음 (파일 번호만)');
  assert(opCalls(me, 'thumbs').length === 0, '내가 보낸 사진은 다시 받지 않음');
  const capShown = await me.page.$eval('#gc-list .gc-msg.me .gx-cap', (e) => e.lastChild.textContent);
  assert(capShown === '오늘 푼 수학 22번 풀이', '사진 아래 설명 말풍선');
  assert(await me.page.evaluate(() => localStorage.getItem('studypromotion.chatPhotoNote')) === '1', '안내는 한 번 보면 이 기기에서 다시 안 보임');

  // 두 번째 사진: 세로로 찍은 사진(EXIF 방향 6) → 세로 1200×1600, 안내 없음, 설명 없이
  const raw2 = Buffer.from(await genJpeg(me, 2000, 1500, 6), 'base64');
  await sleep(1100);
  await pickPhoto(me, { name: 'IMG_2042.jpg', mimeType: 'image/jpeg', buffer: withExif(raw2, MARK, 6) });
  await me.page.waitForSelector('.ui-back.in .gx-photo-sheet .gx-prev');
  assert(!/얼굴, 이름표/.test(await sheetText(me)), '두 번째부터는 안내 없이');
  await me.tap('.ui-back.in [data-gx-send]');
  await me.page.waitForSelector('.ui-back', { state: 'detached' });
  await settled(me);
  say = says(me).pop();
  dm = jpegDims(Buffer.from(say.body.img, 'base64'));
  assert(dm.w === 1200 && dm.h === 1600 && say.body.w === 1200 && say.body.h === 1600 && !('t' in say.body), '세로로 찍은 사진은 세로로 (폰 사진의 방향 정보를 따름) ' + JSON.stringify(dm));
  const aid2 = lines().filter((x) => x.p === 'img').pop().a;

  // 사진이 아닌 파일
  await pickPhoto(me, { name: 'note.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('이건 사진이 아니에요') });
  await waitToast(me, /이 사진은 열 수 없어요/);
  assert(!(await me.page.$('.ui-back.in')) && says(me).length === 2, '열 수 없는 파일은 보내지 않고 알려 줌');

  /* ===== 4) 지우: 작은 그림만 받고, 누르면 크게 ===== */
  const jiwoo = await person('jiwoo');
  await jiwoo.page.goto(APP + '#account');
  await jiwoo.login();
  await jiwoo.page.evaluate(() => App.go('group'));
  await jiwoo.sync();
  await jiwoo.page.waitForSelector('#gr-body .gc-card .gc-prev');
  assert(/📷 사진/.test(await jiwoo.page.textContent('.gc-card .gc-prev')), '채팅 칸 미리 보기: 📷 사진');
  await openChat(jiwoo);
  await jiwoo.page.waitForFunction(() => document.querySelectorAll('#gc-list .gx-ph img[src^="blob:"]').length === 2);
  const th = opCalls(jiwoo, 'thumbs');
  assert(th.length === 1 && th[0].body.as.sort().join() === [aid1, aid2].sort().join() && opCalls(jiwoo, 'file').length === 0, '열면 작은 그림만 한 번에 받음 (원본은 받지 않음)');
  const ph = await jiwoo.page.$eval('#gc-list .gc-msg:not(.me) .gx-ph', (b) => ({ label: b.getAttribute('aria-label'), ar: b.style.getPropertyValue('--ar').replace(/\s/g, ''), name: b.closest('.gc-msg').querySelector('.gc-who small').textContent }));
  assert(ph.label === '공부왕 님의 사진: 오늘 푼 수학 22번 풀이 · 크게 보기' && ph.ar === '1600/1200' && ph.name === '공부왕', '친구 사진: 별명과 함께, 화면 읽기 이름 ' + JSON.stringify(ph));
  await toBottom(jiwoo);
  await jiwoo.shot('22-chat-photo');
  await jiwoo.tap(jiwoo.page.locator('#gc-list .gx-ph').first());
  await jiwoo.page.waitForSelector('#gx-view:not([hidden])');
  await jiwoo.page.waitForFunction(() => { const i = document.querySelector('#gx-view-img'); return i.complete && i.naturalWidth === 1600; });
  assert(opCalls(jiwoo, 'file').length === 1 && opCalls(jiwoo, 'file')[0].body.a === aid1, '누르면 원본을 그때 받음');
  assert(await jiwoo.page.textContent('#gx-view-name') === '공부왕' && /\d+월 \d+일 오[전후] \d+:\d\d/.test(await jiwoo.page.textContent('#gx-view-time')) && await jiwoo.page.textContent('#gx-view-cap') === '오늘 푼 수학 22번 풀이', '크게 보기: 보낸 사람 · 시각 · 설명');
  await jiwoo.shot('23-viewer');
  // 두 번 누르면 확대 · 다시 두 번 누르면 되돌림
  const dbl = () => jiwoo.page.evaluate(async () => {
    const s = document.querySelector('#gx-view-stage'), r = s.getBoundingClientRect();
    const ev = (type) => s.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    ev('pointerdown'); ev('pointerup'); await new Promise((ok) => setTimeout(ok, 80)); ev('pointerdown'); ev('pointerup');
  });
  await dbl();
  assert(await jiwoo.page.$eval('#gx-view', (v) => v.classList.contains('zoomed')) && /scale\(2\.5\)/.test(await jiwoo.page.$eval('#gx-view-img', (i) => i.style.transform)), '두 번 누르면 2.5배');
  await jiwoo.page.waitForTimeout(400);
  await dbl();
  assert(!(await jiwoo.page.$eval('#gx-view', (v) => v.classList.contains('zoomed'))), '다시 두 번 누르면 되돌림');
  // 두 손가락으로 벌리기
  await jiwoo.page.evaluate(() => {
    const s = document.querySelector('#gx-view-stage'), r = s.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, id, x) => s.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', bubbles: true, clientX: x, clientY: cy }));
    ev('pointerdown', 1, cx - 40); ev('pointerdown', 2, cx + 40);
    for (let k = 1; k <= 5; k++) { ev('pointermove', 1, cx - 40 - k * 16); ev('pointermove', 2, cx + 40 + k * 16); }
    ev('pointerup', 1, cx - 120); ev('pointerup', 2, cx + 120);
  });
  const pinch = await jiwoo.page.$eval('#gx-view-img', (i) => +(/scale\(([\d.]+)\)/.exec(i.style.transform) || [0, 0])[1]);
  assert(pinch > 2.8 && pinch < 3.2, '두 손가락으로 벌리면 확대 (' + pinch + '배)');
  // 저장: 내려받기 (아이폰이 아니면)
  const [dl] = await Promise.all([jiwoo.page.waitForEvent('download'), jiwoo.tap('#gx-view-save')]);
  const saved = fs.readFileSync(await dl.path());
  assert(/^studypromotion-\d{8}-\d{4}\.jpg$/.test(dl.suggestedFilename()) && saved.equals(sent), '‘사진 저장’: 받은 원본 그대로 내려받기 ' + dl.suggestedFilename());
  await waitToast(jiwoo, /사진을 저장했어요/);
  // 휴대폰 ‘뒤로’는 크게 보기만 닫음
  await jiwoo.page.evaluate(() => history.back());
  await jiwoo.page.waitForSelector('#gx-view', { state: 'hidden' });
  assert(await jiwoo.page.isVisible('#gc'), '휴대폰 ‘뒤로’는 크게 보기만 닫고 채팅 창은 그대로');
  // 다시 열면 원본을 또 받지 않음, 아래로 끌어 닫기
  await jiwoo.tap(jiwoo.page.locator('#gc-list .gx-ph').first());
  await jiwoo.page.waitForSelector('#gx-view:not([hidden])');
  await jiwoo.page.waitForFunction(() => document.querySelector('#gx-view-img').naturalWidth === 1600);
  assert(opCalls(jiwoo, 'file').length === 1, '한 번 받은 원본은 앱이 열려 있는 동안 다시 받지 않음');
  await jiwoo.page.evaluate(() => {
    const s = document.querySelector('#gx-view-stage'), r = s.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev = (type, y) => s.dispatchEvent(new PointerEvent(type, { pointerId: 3, pointerType: 'touch', isPrimary: true, bubbles: true, clientX: cx, clientY: y }));
    ev('pointerdown', cy); for (let k = 1; k <= 8; k++) ev('pointermove', cy + k * 25); ev('pointerup', cy + 200);
  });
  await jiwoo.page.waitForSelector('#gx-view', { state: 'hidden' });
  assert(await jiwoo.page.isVisible('#gc'), '아래로 끌면 크게 보기가 닫힘');
  // 꾹 누르기 메뉴 (리더가 아닌 친구)
  await longPress(jiwoo, jiwoo.page.locator('#gc-list .gc-msg:not(.me) .gx-ph').first());
  await jiwoo.page.waitForSelector('.ui-back.in .ch-opt');
  assert(await choices(jiwoo) === '사진 저장|설명 복사|공부왕 님 메시지 가리기', '친구 사진을 꾹 누르면: 사진 저장 · 설명 복사 · 가리기 ' + await choices(jiwoo));
  await jiwoo.closeSheet();
  assert(await jiwoo.page.isHidden('#gx-view'), '꾹 누른 뒤에는 크게 보기가 열리지 않음');
  const stored = await jiwoo.page.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
  assert(!stored.includes('/9j/') && !stored.includes('blob:'), '받은 사진은 기기에 따로 저장하지 않음 (앱이 열려 있는 동안만)');

  /* ===== 5) 공부 기록 카드 ===== */
  await sleep(1100);
  await plus(me, '공부 기록');
  await me.page.waitForSelector('.ui-back.in .gx-rec-sheet .gx-rec');
  const card = () => me.page.$eval('.ui-back.in .gx-rec', (e) => ({
    title: e.querySelector('.gx-rec-h b').textContent, big: e.querySelector('.gx-rec-big').textContent, goal: (e.querySelector('.gx-rec-gt') || {}).textContent || '',
    subs: [...e.querySelectorAll('.gx-rec-sub li')].map((li) => li.querySelector('span').textContent + ' ' + li.querySelector('em').textContent), meta: [...e.querySelectorAll('.gx-rec-meta span')].map((s) => s.textContent),
  }));
  let c1 = await card();
  assert(c1.title === '오늘 공부 기록' && c1.big === '2시간 25분' && c1.goal === '하루 목표 3시간 · 81%', '오늘 카드: 총 시간과 하루 목표 % ' + JSON.stringify(c1));
  const dow = await me.page.evaluate(() => (new Date().getDay() + 6) % 7);
  assert(c1.subs.join('|') === '수학 1시간 30분|국어 30분|영어 25분' && c1.meta.join('|') === `집중 2번|할 일 1/2|${dow === 1 ? 2 : 1}일 연속`, '과목별 시간(많은 순) · 집중 횟수 · 할 일 · 연속 ' + JSON.stringify(c1));
  assert(/할 일 제목·메모·시험 범위는 보내지 않아요/.test(await sheetText(me)) && !/비밀 할 일 제목/.test(await sheetText(me)), '할 일 제목은 카드에 없음');
  await me.shot('24-record-sheet');
  await me.tap('.ui-back.in [data-gx-span="w"]');
  c1 = await card();
  assert(c1.title === '이번 주 공부 기록' && c1.big === (dow > 0 ? '3시간 25분' : '2시간 25분'), '이번 주로 바꾸면 월요일부터 오늘까지 ' + JSON.stringify(c1));
  await me.tap('.ui-back.in [data-gx-names]');
  c1 = await card();
  assert(c1.subs[0].startsWith('과목 1 ') && !c1.subs.some((s) => /수학|국어|영어/.test(s)) && await me.page.$eval('.ui-back.in [data-gx-names]', (b) => b.getAttribute('aria-checked')) === 'false', '과목 이름 빼기: ‘과목 1, 2’로');
  await me.page.fill('.ui-back.in .gx-cap-in', '내일도 화이팅 🔥');
  await me.tap('.ui-back.in [data-gx-send]');
  await me.page.waitForSelector('.ui-back', { state: 'detached' });
  await settled(me);
  say = says(me).pop();
  assert(say.body.p === 'rec' && say.body.r.sp === 'w' && say.body.t === '내일도 화이팅 🔥' && say.body.r.sb.every((s) => !('n' in s)), '보낸 것: 이번 주 숫자 + 한마디 (과목 이름 없이)');
  const recJson = JSON.stringify(lines().filter((x) => x.p === 'rec').pop());
  assert(!/비밀 할 일 제목|비밀 메모|수학 숙제|수학|국어|영어|tk1/.test(recJson), '서버에 간 공부 기록에 할 일 제목·메모·과목 이름이 없음');
  assert(await me.page.evaluate(() => localStorage.getItem('studypromotion.chatRecNames')) === '0', '과목 이름 넣기는 이 기기에서 마지막으로 고른 대로');
  // 오늘 카드 (과목 이름 넣기)
  await sleep(1100);
  await plus(me, '공부 기록');
  await me.page.waitForSelector('.ui-back.in .gx-rec-sheet .gx-rec');
  assert(await me.page.$eval('.ui-back.in [data-gx-names]', (b) => b.getAttribute('aria-checked')) === 'false' && (await card()).title === '오늘 공부 기록', '다시 열면 오늘 · 과목 이름 빼기 그대로');
  await me.tap('.ui-back.in [data-gx-names]');
  await me.tap('.ui-back.in [data-gx-send]');
  await me.page.waitForSelector('.ui-back', { state: 'detached' });
  await settled(me);
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForFunction(() => document.querySelectorAll('#gc-list .gc-msg:not(.me) .gx-rec').length === 2);
  const jr = await jiwoo.page.$$eval('#gc-list .gc-msg:not(.me) .gx-rec', (els) => els.map((e) => ({ t: e.querySelector('.gx-rec-h b').textContent, big: e.querySelector('.gx-rec-big').textContent, memo: (e.querySelector('.gx-rec-memo') || {}).textContent || '', subs: [...e.querySelectorAll('.gx-rec-sub li span')].map((s) => s.textContent).join(',') })));
  assert(jr[0].t === '이번 주 공부 기록' && jr[0].memo === '내일도 화이팅 🔥' && /^과목 1,과목 2/.test(jr[0].subs) && jr[1].t === '오늘 공부 기록' && jr[1].subs === '수학,국어,영어' && jr[1].big === '2시간 25분', '친구 화면의 공부 기록 카드 ' + JSON.stringify(jr));
  await toBottom(jiwoo);
  await jiwoo.shot('25-chat-record');
  await longPress(jiwoo, jiwoo.page.locator('#gc-list .gc-msg:not(.me) .gx-rec').first());
  assert(await choices(jiwoo) === '한마디 복사|공부왕 님 메시지 가리기', '공부 기록 카드 메뉴: 한마디 복사 · 가리기 ' + await choices(jiwoo));
  await jiwoo.closeSheet();

  /* ===== 6) 단어장 ===== */
  await sleep(1100);
  await plus(me, '단어장');
  await me.page.waitForSelector('.ui-back.in .gx-deck-sheet [data-gx-deck]');
  const dl1 = await me.page.$$eval('.ui-back.in [data-gx-deck]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim() + (e.disabled ? ' (꺼짐)' : '')));
  assert(dl1.join('|') === '스페인어 동사카드 5장|빈 덱카드가 없어요 (꺼짐)', '덱 고르기: 카드 수, 빈 덱은 못 고름 ' + dl1.join('|'));
  await me.tap('.ui-back.in [data-gx-deck="dk1"]');
  await me.page.waitForSelector('.ui-back.in .gx-deck.in-sheet');
  st = await sheetText(me);
  assert(/스페인어 동사/.test(st) && /카드 5장/.test(st) && (await me.page.$$('.ui-back.in .gx-deck.in-sheet li')).length === 3 && /외운 정도·다음 복습 날짜 같은 내 복습 기록은 보내지 않아요/.test(st), '고른 덱: 이름 · 장수 · 앞 카드 3장 · 복습 기록은 안 보냄');
  assert(await me.page.textContent('.ui-back.in [data-gx-send]') === '카드 5장 보내기', '보내기 단추에 장수');
  await me.shot('26-deck-sheet');
  await me.tap('.ui-back.in [data-gx-back]');
  await me.page.waitForSelector('.ui-back.in [data-gx-deck="dk1"]');
  await me.tap('.ui-back.in [data-gx-deck="dk1"]');
  await me.tap('.ui-back.in [data-gx-send]');
  await me.page.waitForSelector('.ui-back', { state: 'detached' });
  await settled(me);
  say = says(me).pop();
  assert(say.body.p === 'deck' && JSON.stringify(say.body.deck) === JSON.stringify({ n: '스페인어 동사', cs: [['hablar', '말하다'], ['comer', '먹다'], ['vivir', '살다'], ['tener', '가지다'], ['hacer', '하다, 만들다']] }), '보낸 것: 덱 이름과 카드 앞·뒤 글자뿐');
  const deckLine = lines().filter((x) => x.p === 'deck').pop();
  assert(deckLine.cn === 5 && deckLine.pv.length === 3 && hub().get('a:' + deckLine.a).cs.length === 5, '서버: 채팅 줄에는 앞 3장, 카드 전체는 따로');
  assert(!(await me.page.$('#gc-list .gc-msg.me .gx-deck [data-gx-act]')), '내가 보낸 단어장에는 담기 단추가 없음');
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForSelector('#gc-list .gc-msg:not(.me) .gx-deck [data-gx-act="import"]');
  assert(/단어장스페인어동사카드5장hablar말하다comer먹다vivir살다내복습에담기$/.test(await jiwoo.page.$eval('#gc-list .gc-msg:not(.me) .gx-deck', (e) => e.textContent.replace(/\s+/g, ''))), '친구 화면: 단어장 이름 · 장수 · 앞 카드 3장 · 내 복습에 담기');
  await toBottom(jiwoo);
  await jiwoo.shot('27-chat-deck');
  const deckBefore = await jiwoo.page.evaluate(() => App.store.get().cards.length);
  await jiwoo.tap('#gc-list .gc-msg:not(.me) .gx-deck [data-gx-act="import"]');
  await jiwoo.page.waitForSelector('.ui-back.in .ui-cardlink [data-cl-ok]');
  assert(/카드 5장을 추가할까요/.test(await jiwoo.page.textContent('.ui-back.in')) && await jiwoo.page.textContent('.ui-back.in [data-cl-ok]') === '카드 5장 추가' && await jiwoo.page.inputValue('.ui-back.in .cl-name-in') === '스페인어 동사', '내 복습에 담기: 링크 가져오기와 같은 확인 창 (새 덱 이름은 받은 이름)');
  assert(opCalls(jiwoo, 'file').filter((c) => c.body.a === deckLine.a).length === 1, '담기를 누를 때 카드 전체를 받음');
  await jiwoo.shot('28-deck-import');
  await jiwoo.tap('.ui-back.in [data-cl-ok]');
  await waitToast(jiwoo, /'스페인어 동사' 덱에 카드 5장을 넣었어요/);
  const got = await jiwoo.page.evaluate(() => { const s = App.store.get(), d = s.decks.find((x) => x.name === '스페인어 동사'); return { n: s.cards.length, cs: s.cards.filter((c) => c.deckId === d.id).map((c) => [c.front, c.back, c.reps, c.interval, c.from]) }; });
  assert(got.n === deckBefore + 5 && got.cs.every((c) => c[2] === 0 && c[3] === 0 && c[4] === 'chat') && got.cs[4][0] === 'hacer', '담은 카드는 새 카드로 시작 (보낸 사람의 외운 정도는 오지 않음)');
  assert(await jiwoo.page.isVisible('#gc') && await jiwoo.page.evaluate(() => App.view) === 'group', '담아도 채팅 창은 그대로');
  await jiwoo.page.waitForSelector('#gc-list .gc-msg:not(.me) .gx-deck [data-gx-act="go"]');
  assert(/담았어요 · 복습에서 보기/.test(await jiwoo.page.textContent('#gc-list .gx-deck [data-gx-act="go"]')), '담은 뒤 단추: 담았어요 · 복습에서 보기');
  await jiwoo.tap('#gc-list .gx-deck [data-gx-act="go"]');
  await jiwoo.page.waitForSelector('#gc', { state: 'hidden' });
  assert(await jiwoo.page.evaluate(() => App.view) === 'review' && /스페인어 동사/.test(await jiwoo.page.textContent('#view-review')), '‘복습에서 보기’: 채팅을 닫고 그 덱으로');
  await jiwoo.page.evaluate(() => App.go('group'));
  await openChat(jiwoo);

  /* ===== 7) 가린 사람의 사진은 받지 않음 ===== */
  await sleep(1100);
  const small = await genJpeg(me, 800, 600, 8, 0.85), smallTh = await genJpeg(me, 240, 180, 0, 0.7);
  r = await api('seoyeon', { op: 'say', g: gid, t: '나 서연인데 이것 좀 봐', c: 'sy' + Date.now().toString(36) });
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForFunction(() => /이것 좀 봐/.test(document.querySelector('#gc-list').textContent));
  await longPress(jiwoo, jiwoo.page.locator('#gc-list .gc-b', { hasText: '이것 좀 봐' }).first());
  await pickChoice(jiwoo, '서연 님 메시지 가리기');
  await sleep(1100);
  r = await api('seoyeon', { op: 'say', g: gid, p: 'img', img: small, th: smallTh, w: 800, h: 600, t: '내 사진', c: 'sy' + Date.now().toString(36) });
  assert(r.ok, '서연이 사진을 보냄');
  const aid3 = lines().filter((x) => x.p === 'img').pop().a;
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForFunction(() => /가린 사람의 메시지 2개/.test(document.querySelector('#gc-list').textContent));
  await sleep(300);
  assert(!opCalls(jiwoo, 'thumbs').some((c) => c.body.as.includes(aid3)), '가린 사람의 사진은 작은 그림도 받지 않음');
  await jiwoo.tap('#gc-menu');
  await jiwoo.page.waitForSelector('.ui-back.in .ch-opt');
  await jiwoo.tap('.ui-back.in .ch-opt:has-text("가린 사람")');
  await jiwoo.page.waitForFunction(() => { const b = document.querySelector('.ui-back.in'); return b && /가린 사람의 메시지는 이 기기에서만/.test(b.textContent); });
  await pickChoice(jiwoo, '서연');
  await jiwoo.page.waitForFunction((a) => { const i = document.querySelector(`#gc-list img[data-gx-th="${a}"]`); return i && /^blob:/.test(i.src); }, aid3);
  assert(opCalls(jiwoo, 'thumbs').some((c) => c.body.as.includes(aid3)), '다시 보이게 하면 그때 받음');

  /* ===== 8) 지우기: 서버의 사진도 지워짐 (보낸 사람 · 리더) ===== */
  // 지우가 그 사진을 크게 보는 중
  await jiwoo.tap(jiwoo.page.locator(`#gc-list .gx-ph:has(img[data-gx-th="${aid1}"])`));
  await jiwoo.page.waitForSelector('#gx-view:not([hidden])');
  await jiwoo.page.waitForFunction(() => document.querySelector('#gx-view-img').naturalWidth === 1600);
  const viewing = await jiwoo.page.$eval('#gx-view-img', (i) => i.src);
  const thumbUrl = await jiwoo.page.$eval(`#gc-list img[data-gx-th="${aid1}"]`, (i) => i.src);
  await longPress(me, me.page.locator('#gc-list .gc-msg.me .gx-ph').first());
  await me.page.waitForSelector('.ui-back.in .ch-opt');
  assert(await choices(me) === '사진 저장|설명 복사|사진 지우기', '내 사진 메뉴: 사진 저장 · 설명 복사 · 사진 지우기 ' + await choices(me));
  await pickChoice(me, '사진 지우기');
  await askYes(me, /이 사진을 지울까요\?\n모두의 화면에서 ‘지운 메시지예요’로 바뀌어요\. 서버에 있는 사진도 지워져요\./);
  await waitToast(me, /사진을 지웠어요/);
  assert(!hub().has('a:' + aid1) && !hub().has('a:' + aid1 + ':s') && !hub().get('ax').a[aid1], '지우면 서버의 사진과 작은 그림이 바로 지워짐');
  assert(!lines().some((x) => x.a === aid1) && lines().some((x) => x.x === 1 && !x.p && !x.t), '채팅 줄은 ‘지운 메시지예요’만 남음');
  await jiwoo.page.evaluate(() => GroupChat.poll());
  await jiwoo.page.waitForFunction((a) => !document.querySelector(`#gc-list [data-gx-th="${a}"]`), aid1);
  await jiwoo.page.waitForSelector('#gx-view', { state: 'hidden' });
  await waitToast(jiwoo, /지워진 사진이에요/);
  const alive = (u) => jiwoo.page.evaluate(async (u) => { try { await fetch(u); return true; } catch (e) { return false; } }, u);
  const nErr = errors.length;
  const dead = !(await alive(viewing)) && !(await alive(thumbUrl));
  await jiwoo.page.waitForTimeout(300);
  errors.splice(nErr); // 위에서 일부러 열어 본 (놓아준) 주소의 실패 줄은 뺀다
  assert(dead, '크게 보던 친구 화면도 닫히고, 받아 둔 사진과 작은 그림을 놓아줌');
  r = await api('doyun', { op: 'file', g: gid, a: aid1 });
  assert(r.error === 'gone', '지운 사진은 누구도 받을 수 없음');
  // 리더: 서연의 사진 지우기
  await me.page.evaluate(() => GroupChat.poll());
  await me.page.waitForSelector(`#gc-list [data-gx-th="${aid3}"]`);
  await longPress(me, me.page.locator(`#gc-list .gx-ph:has(img[data-gx-th="${aid3}"])`));
  assert(await choices(me) === '사진 저장|설명 복사|서연 님 메시지 가리기|사진 지우기', '리더는 친구 사진도 지울 수 있음 ' + await choices(me));
  await pickChoice(me, '사진 지우기');
  await askYes(me, /리더가 지운 메시지예요.*서버에 있는 사진도 지워져요/s);
  await waitToast(me, /사진을 지웠어요/);
  assert(!hub().has('a:' + aid3), '리더가 지워도 서버의 사진이 지워짐');

  /* ===== 9) 한도와 인터넷 끊김 ===== */
  const u = hub().get('u:' + myId);
  hub().set('u:' + myId, Object.assign({}, u, { ay: { day: new Date().toISOString().slice(0, 10), i: 20, d: 0 } }));
  await sleep(1100);
  await pickPhoto(me, { name: 'IMG_2043.jpg', mimeType: 'image/jpeg', buffer: raw2 });
  await me.page.waitForSelector('.ui-back.in .gx-photo-sheet .gx-prev');
  await me.tap('.ui-back.in [data-gx-send]');
  await waitToast(me, /사진은 하루에 20장까지 보낼 수 있어요/);
  await me.page.waitForSelector('#gc-list .gc-msg.me.failed .gx-ph');
  assert(/못 보냈어요/.test(await me.page.textContent('#gc-list .gc-msg.me.failed')), '하루 20장을 넘으면 알려 주고 ‘못 보냈어요’');
  await me.tap('#gc-list .gc-msg.me.failed .gx-ph');
  await me.page.waitForSelector('.ui-back.in .ch-opt');
  assert(await choices(me) === '다시 보내기|보내지 않기', '못 보낸 사진을 누르면: 다시 보내기 · 보내지 않기 ' + await choices(me));
  await pickChoice(me, '보내지 않기');
  await me.page.waitForFunction(() => !document.querySelector('#gc-list .gc-msg.failed'));
  hub().set('u:' + myId, Object.assign({}, hub().get('u:' + myId), { ay: { day: new Date().toISOString().slice(0, 10), i: 2, d: 1 } }));
  srv.down = true;
  await plus(me, '공부 기록');
  await me.page.waitForSelector('.ui-back.in .gx-rec-sheet .gx-rec');
  await me.tap('.ui-back.in [data-gx-send]');
  await me.page.waitForSelector('#gc-list .gc-msg.me.failed [data-gc-retry]', { timeout: 9000 });
  const nRec = lines().filter((x) => x.p === 'rec').length;
  srv.down = false;
  await me.tap('#gc-list [data-gc-retry]');
  await me.page.waitForFunction(() => !document.querySelector('#gc-list .gc-msg.failed') && !document.querySelector('#gc-list .gc-msg.sending'), null, { timeout: 9000 });
  assert(lines().filter((x) => x.p === 'rec').length === nRec + 1, '인터넷이 끊겨 못 보낸 공부 기록도 ‘다시 보내기’로 한 번만');

  /* ===== 10) 컴퓨터: 눌러서 크게 보기, 휠로 확대, Esc ===== */
  const pc = await person('jiwoo', { pc: true, tag: 'pc' });
  await pc.page.goto(APP + '#account');
  await pc.login();
  await pc.page.evaluate(() => App.go('group'));
  await pc.sync();
  await pc.page.waitForSelector('#gr-body .gc-card [data-gc="open"]');
  await openChat(pc);
  await pc.page.waitForSelector(`#gc-list img[data-gx-th="${aid2}"][src^="blob:"]`);
  await pc.page.click(`#gc-list .gx-ph:has(img[data-gx-th="${aid2}"])`);
  await pc.page.waitForSelector('#gx-view:not([hidden])');
  await pc.page.waitForFunction(() => document.querySelector('#gx-view-img').naturalWidth === 1200);
  const img = await pc.page.$eval('#gx-view-img', (i) => { const r = i.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), nh: i.naturalHeight }; });
  assert(img.w === 1280 && img.h === 860 && img.nh === 1600, '컴퓨터: 화면 가득 (사진은 비율대로 맞춤) ' + JSON.stringify(img));
  await pc.page.mouse.move(640, 430);
  await pc.page.mouse.wheel(0, -300);
  await pc.page.waitForTimeout(100);
  assert(await pc.page.$eval('#gx-view', (v) => v.classList.contains('zoomed')), '휠로 확대');
  await pc.shot('30-pc-viewer');
  await pc.page.keyboard.press('Escape');
  await pc.page.waitForSelector('#gx-view', { state: 'hidden' });
  assert(await pc.page.isVisible('#gc'), 'Esc는 크게 보기만 닫음');
  // 마우스로 공부 기록 카드를 누르면 메뉴
  await pc.page.click('#gc-list .gc-msg:not(.me) .gx-rec >> nth=0');
  await pc.page.waitForSelector('.ui-back.in .ch-opt');
  assert(/공부왕 님 메시지 가리기/.test(await choices(pc)), '컴퓨터: 카드를 누르면 메뉴');
  await pc.page.keyboard.press('Escape');
  await pc.page.waitForSelector('.ui-back', { state: 'detached' });

  /* ===== 11) 예전 앱(4.2)이 받는 글, 개인 정보 ===== */
  const old = await api('doyun', { op: 'chat', g: gid });
  const alts = old.chat.ms.filter((x) => x.p).map((x) => x.t);
  assert(alts.includes('📷 사진') && alts.some((t) => /^📊 이번 주 공부 \d+시간( \d+분)? · 내일도 화이팅 🔥$/.test(t)) && alts.includes('🗂️ 단어장 ‘스페인어 동사’ 카드 5장'), '예전 앱에는 글로 보임: ' + alts.join(' / '));
  const leak = srv.bodies.filter((b) => SECRETS.some((x) => b.includes(x)));
  assert(leak.length === 0, '서버 답 어디에도 이메일·구글 이름·계정 번호가 없음');
  const KEYS = ['s', 'v', 'at', 'f', 'n', 't', 'k', 'x', 'c', 'min', 'end', 'p', 'cap', 'a', 'w', 'h', 'r', 'dn', 'cn', 'pv'];
  const views = srv.bodies.map((b) => { try { return JSON.parse(b); } catch (e) { return null; } }).filter((j) => j && j.chat && Array.isArray(j.chat.ms));
  assert(views.length > 5 && views.every((j) => j.chat.ms.every((x) => Object.keys(x).every((k) => KEYS.includes(k)))), '채팅 줄에는 정해 둔 칸만');
  assert(srv.bodies.concat(srv.calls.map((c) => JSON.stringify(c.body))).every((b) => !b.includes('"reps"') && !b.includes('"ease"') && !b.includes('비밀 할 일') && !b.includes('비밀 메모')), '복습 기록·할 일 제목·메모는 어디에도 오가지 않음 (보내는 것과 받는 것 모두)');

  /* ===== 12) 어두운 화면 (미리 보기 그림) ===== */
  if (SHOTS) {
    const dark = await person('jiwoo', { dark: true, tag: 'dark' });
    await dark.page.goto(APP + '#account');
    await dark.login();
    await dark.page.evaluate(() => App.go('group'));
    await dark.sync();
    await openChat(dark);
    await dark.page.waitForFunction(() => [...document.querySelectorAll('#gc-list .gx-ph img')].every((i) => /^blob:/.test(i.src) || i.closest('.gone')));
    await toBottom(dark);
    await dark.shot('29-chat-dark');
    await dark.ctx.close();
  }

  assert(errors.length === 0, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  console.log('채팅 첨부 시험 통과');
})().catch((e) => { console.error(e); process.exit(1); });
