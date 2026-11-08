// 업데이트 테스트: 새 버전을 배포하면 열려 있는 앱이 알아서 새 버전으로 바뀌는지
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
let version = 1;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (p === '/sw.js') body = body.toString().replace(/studypromotion-v\d+/, 'studypromotion-test' + version);
  if (p === '/index.html') body = body.toString().replace('<body', `<body data-ver="${version}"`);
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  res.end(body);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '#home');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert(await page.getAttribute('body', 'data-ver') === '1', '처음 버전 1');

  // 새 버전 배포 → 앱으로 돌아오면 확인 → 쓰는 중이 아니면 자동 새로고침
  version = 2;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => document.body.dataset.ver === '2', null, { timeout: 15000 });
  assert(true, '열려 있던 앱이 새 버전(2)으로 자동 적용');
  await page.waitForFunction(() => /새 버전으로 업데이트했어요/.test(document.querySelector('#toast').textContent));
  assert(true, '업데이트 안내');

  // 타이머가 도는 중이면 새로고침하지 않고 안내 띠만
  await page.goto(base + '#timer');
  await page.click('#timer-start');
  version = 3;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('#update-bar:not([hidden])', { timeout: 15000 });
  assert(await page.getAttribute('body', 'data-ver') === '2', '타이머 도는 중에는 새로고침 안 함');
  await page.click('#update-btn');
  await page.waitForFunction(() => document.body.dataset.ver === '3');
  assert(true, '"지금 적용"을 누르면 새 버전(3)');
  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
