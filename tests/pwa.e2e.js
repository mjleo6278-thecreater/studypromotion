// 설치형 앱(PWA) 테스트: 로컬 서버에서 서비스 워커 등록 → 오프라인 새로고침
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
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert(manifest.short_name === '스터디 프로모션' && manifest.icons.length === 3, '매니페스트');
  for (const ic of manifest.icons) {
    const ok = await page.evaluate(async (src) => (await fetch(src)).ok, ic.src);
    assert(ok, '아이콘 ' + ic.src);
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), '서비스 워커가 페이지를 제어');
  await page.click('[data-view=board]');
  await page.click('#exam-sample');
  await ctx.setOffline(true);
  await page.reload();
  assert((await page.locator('.bcard').count()) === 5, '오프라인에서도 앱과 데이터가 열림');
  await ctx.setOffline(false);
  assert(errors.length === 0, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e.message); server.close(); process.exit(1); });
