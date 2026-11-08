// 구글 연동 테스트: 구글 로그인·드라이브를 가짜로 바꿔서 두 기기 사이 동기화를 확인한다
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (p === '/js/gsync.js') body = body.toString().replace("const CLIENT_ID = '';", "const CLIENT_ID = 'test-client';");
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});

// 가짜 구글 드라이브 (두 기기가 공유)
const drive = { file: null, n: 0 };
async function fakeGoogle(ctx) {
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: `
    window.google = { accounts: { oauth2: {
      initTokenClient: (o) => ({ callback: o.callback, requestAccessToken() { setTimeout(() => this.callback({ access_token: 'tok', expires_in: 3600 }), 10); } }),
      revoke: () => {} } } };` }));
  await ctx.route('https://openidconnect.googleapis.com/**', (r) => r.fulfill({ json: { email: 'student@gmail.com' } }));
  await ctx.route('https://www.googleapis.com/**', async (r) => {
    const u = new URL(r.request().url()); const m = r.request().method();
    const stamp = () => 't' + (++drive.n);
    if (u.pathname === '/drive/v3/files' && m === 'GET') return r.fulfill({ json: { files: drive.file ? [{ id: 'f1', modifiedTime: drive.file.modifiedTime }] : [] } });
    if (u.pathname === '/drive/v3/files/f1' && m === 'GET') return r.fulfill({ contentType: 'application/json', body: drive.file.body });
    if (u.pathname === '/upload/drive/v3/files' && m === 'POST') {
      const raw = r.request().postData(); const parts = raw.split(/\r\n--sp\w+/);
      const body = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n');
      drive.file = { body, modifiedTime: stamp() };
      return r.fulfill({ json: { id: 'f1', modifiedTime: drive.file.modifiedTime } });
    }
    if (u.pathname === '/upload/drive/v3/files/f1' && m === 'PATCH') {
      drive.file = { body: r.request().postData(), modifiedTime: stamp() };
      return r.fulfill({ json: { id: 'f1', modifiedTime: drive.file.modifiedTime } });
    }
    r.fulfill({ status: 404, body: '' });
  });
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];

  // 기기 A: 할 일을 만들고 구글 연결 → 드라이브에 올라감
  const a = await browser.newContext(); await fakeGoogle(a);
  const pa = await a.newPage(); pa.on('pageerror', (e) => errors.push(e.message));
  await pa.goto(base + '#stats');
  assert(await pa.isVisible('#g-connect'), '연결 버튼 보임');
  await pa.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'x1', title: '수학 1단원', done: false })));
  await pa.click('#g-connect');
  await pa.waitForFunction(() => /student@gmail.com 연결됨/.test(document.querySelector('#g-status').textContent));
  assert(drive.file && JSON.parse(drive.file.body).tasks[0].title === '수학 1단원', '기기 A 기록이 드라이브에 저장됨');

  // 기록을 바꾸면 자동으로 올라감
  await pa.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'x2', title: '영어 단어', done: false })));
  await pa.waitForFunction(() => !GSync.meta.dirty, null, { timeout: 10000 });
  assert(JSON.parse(drive.file.body).tasks.length === 2, '바뀐 기록이 자동으로 올라감');

  // 기기 B: 빈 상태에서 연결하면 바로 내려받음
  const b = await browser.newContext(); await fakeGoogle(b);
  const pb = await b.newPage(); pb.on('pageerror', (e) => errors.push(e.message));
  await pb.goto(base + '#stats');
  await pb.click('#g-connect');
  await pb.waitForFunction(() => App.store.get().tasks.length === 2);
  assert(true, '기기 B가 드라이브 기록을 불러옴');

  // 끊기
  await pb.click('#g-disconnect'); await pb.click('#ask-ok');
  assert(await pb.isVisible('#g-connect'), '연결 끊기');
  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
