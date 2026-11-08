// 계정 동기화 테스트: 가짜 Firebase(로그인·Firestore)로 두 기기 사이 동기화를 확인한다
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const docs = {}; // 가짜 Firestore 저장소 (두 기기가 공유)
const users = {}; // email → { uid, pass }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/__fake/')) {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const q = JSON.parse(body || '{}');
      if (u.pathname === '/__fake/signup') { if (users[q.email]) return send(400, { code: 'auth/email-already-in-use' }); users[q.email] = { uid: 'u' + Object.keys(users).length, pass: q.pass }; return send(200, { uid: users[q.email].uid, email: q.email }); }
      if (u.pathname === '/__fake/login') { const x = users[q.email]; if (!x || x.pass !== q.pass) return send(400, { code: 'auth/invalid-credential' }); return send(200, { uid: x.uid, email: q.email }); }
      if (u.pathname === '/__fake/get') return send(200, { doc: docs[q.id] || null });
      if (u.pathname === '/__fake/set') { docs[q.id] = q.data; return send(200, {}); }
      send(404, {});
    });
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (p === '/js/cloud.js') body = body.toString();
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});

const FAKE = `
(function(){
  const post = (p, b) => fetch('/__fake/' + p, { method: 'POST', body: JSON.stringify(b) }).then(async (r) => { const j = await r.json(); if (!r.ok) { const e = new Error(j.code); e.code = j.code; throw e; } return j; });
  let cur = null; const subs = [];
  const setUser = (u) => { cur = u; try { localStorage.setItem('fakeUser', JSON.stringify(u)); } catch (e) {} subs.forEach((f) => f(u)); };
  try { cur = JSON.parse(localStorage.getItem('fakeUser')); } catch (e) {}
  const auth = {
    onAuthStateChanged(f) { subs.push(f); setTimeout(() => f(cur), 0); },
    getRedirectResult: async () => null,
    signInWithPopup: async () => setUser({ uid: 'g1', email: 'student@gmail.com' }),
    createUserWithEmailAndPassword: async (email, pass) => setUser(await post('signup', { email, pass })),
    signInWithEmailAndPassword: async (email, pass) => setUser(await post('login', { email, pass })),
    signOut: async () => setUser(null),
    sendPasswordResetEmail: async () => {},
  };
  const authFn = () => auth; authFn.GoogleAuthProvider = function () { this.setCustomParameters = () => {}; };
  const doc = (id) => ({
    get: async () => { const r = await post('get', { id }); return { exists: !!r.doc, data: () => r.doc }; },
    set: async (data) => post('set', { id, data }),
    onSnapshot(cb) { let last = null; const t = setInterval(async () => { const r = await post('get', { id }); const s = JSON.stringify(r.doc); if (r.doc && s !== last) { if (last !== null) cb({ exists: true, data: () => r.doc, metadata: { hasPendingWrites: false } }); } last = s; }, 300); return () => clearInterval(t); },
  });
  window.firebase = { apps: [], initializeApp() { this.apps.push(1); }, auth: authFn, firestore: () => ({ enablePersistence: async () => {}, collection: () => ({ doc }) }) };
})();`;

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];
  async function device() {
    const ctx = await browser.newContext();
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => r.fulfill({ contentType: 'text/javascript', body: r.request().url().includes('app-compat') ? FAKE : '' }));
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
    return p;
  }

  // 기기 A: 이메일로 가입 → 기록이 계정에 올라감
  const a = await device();
  await a.goto(base + '#stats');
  assert(await a.isVisible('#acc-google') && await a.isVisible('#acc-form'), '로그인 화면 보임');
  await a.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'x1', title: '수학 1단원', done: false })));
  await a.fill('#acc-email', 'me@test.com'); await a.fill('#acc-pass', 'secret12');
  await a.click('#acc-form [data-mode="signup"]');
  await a.waitForFunction(() => /me@test.com 로그인됨/.test(document.querySelector('#acc-status').textContent));
  await a.waitForFunction(() => Cloud.meta.remoteAt && !Cloud.meta.dirty);
  assert(JSON.parse(docs.u0.data).tasks[0].title === '수학 1단원', '가입하면 기록이 계정에 저장됨');

  // 같은 이메일로 또 가입하면 안내
  const b = await device();
  await b.goto(base + '#stats');
  await b.fill('#acc-email', 'me@test.com'); await b.fill('#acc-pass', 'secret12');
  await b.click('#acc-form [data-mode="signup"]');
  await b.waitForFunction(() => /이미 가입된/.test(document.querySelector('#toast').textContent));
  assert(true, '중복 가입 안내');
  await b.fill('#acc-pass', 'wrong999'); await b.click('#acc-form [data-mode="login"]');
  await b.waitForFunction(() => /맞지 않아요/.test(document.querySelector('#toast').textContent));
  assert(true, '틀린 비밀번호 안내');

  // 기기 B: 로그인하면 A의 기록을 받음
  await b.fill('#acc-pass', 'secret12'); await b.click('#acc-form [data-mode="login"]');
  await b.waitForFunction(() => App.store.get().tasks.some((t) => t.title === '수학 1단원'));
  assert(true, '다른 기기에서 로그인하면 기록을 받아 옴');

  // A에서 바꾸면 B에 자동으로 나타남
  await a.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'x2', title: '영어 단어', done: false })));
  await b.waitForFunction(() => App.store.get().tasks.some((t) => t.title === '영어 단어'), null, { timeout: 15000 });
  assert(true, '한 기기에서 바꾸면 다른 기기에 자동 반영');

  // B 다시 열어도 로그인 유지
  await b.reload();
  await b.waitForFunction(() => /로그인됨/.test(document.querySelector('#acc-status').textContent));
  assert(true, '다시 열어도 로그인 유지');

  // 로그아웃
  await b.click('#acc-logout'); await b.click('#ask-ok');
  await b.waitForFunction(() => !document.querySelector('#acc-out').hidden);
  assert(await b.evaluate(() => App.store.get().tasks.length) === 2, '로그아웃해도 이 기기 기록은 남음');

  // 구글 로그인 버튼
  const c = await device();
  await c.goto(base + '#stats');
  await c.click('#acc-google');
  await c.waitForFunction(() => /student@gmail.com 로그인됨/.test(document.querySelector('#acc-status').textContent));
  await c.waitForFunction(() => Cloud.meta.remoteAt);
  assert(docs.g1, '구글 로그인 후 계정에 저장');

  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
