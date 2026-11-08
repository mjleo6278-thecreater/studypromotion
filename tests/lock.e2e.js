// 폰 잠금 모드와 월간 통계 테스트
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
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));

  // 월간 통계: 이번 달과 지난달 기록
  await page.goto(base + '#stats');
  await page.evaluate(() => {
    const n = new Date();
    const thisM = new Date(n.getFullYear(), n.getMonth(), 1, 9).getTime();
    const lastM = new Date(n.getFullYear(), n.getMonth() - 1, 10, 9).getTime();
    App.store.update((s) => { s.sessions.push({ id: 'a', minutes: 90, endedAt: thisM }, { id: 'b', minutes: 60, endedAt: lastM }); });
    App.render();
  });
  assert(await page.textContent('#month-total') === '1시간 30분', '이번 달 합계');
  assert(/지난달.*1시간 · ▲ 30분/.test(await page.textContent('#month-compare')), '지난달 비교');
  assert(await page.locator('#month-chart .wc-col').count() === 6, '6개월 막대');
  await page.click('#mg-edit'); await page.fill('#mg-input', '30'); await page.click('#mg-form button[type=submit]');
  assert(/5% 달성/.test(await page.textContent('#mg-text')) && /30시간/.test(await page.textContent('#mg-label')), '월 목표 설정과 진행률');
  await page.reload();
  assert(/5% 달성/.test(await page.textContent('#mg-text')), '월 목표 저장 유지');

  // 잠금 시작
  await page.goto(base + '#timer');
  await page.click('[data-lock="30"]');
  await page.click('#lock-start');
  await page.click('#ask-ok');
  assert(await page.isVisible('#lock-screen'), '잠금 화면 보임');
  assert(/^(29:5\d|30:00)$/.test(await page.textContent('#lock-time')), '남은 시간 30분');

  // 뒤로 가기 막힘
  await page.goBack();
  await page.waitForTimeout(300);
  assert(await page.isVisible('#lock-screen'), '뒤로 가기로 못 빠져나감');

  // 새로고침(앱 다시 열기)해도 잠금 유지
  await page.reload();
  assert(await page.isVisible('#lock-screen'), '다시 열어도 잠금 유지');

  // 다른 앱으로 나간 것처럼
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert(/나간 횟수 2번/.test(await page.textContent('#lock-leaves')), '나간 횟수 기록 (새로고침 + 다른 앱)');

  // 시간이 다 된 상태로 다시 열면 끝나고 기록됨
  await page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem('studypromotion.lock'));
    l.startAt = Date.now() - 30 * 60000; l.endAt = Date.now() - 1000;
    localStorage.setItem('studypromotion.lock', JSON.stringify(l));
  });
  await page.reload();
  assert(await page.isHidden('#lock-screen'), '시간이 끝나면 잠금 풀림');
  const s = await page.evaluate(() => App.store.get().sessions.find((x) => x.lock));
  assert(s && s.minutes === 29 && s.leaves >= 2, '잠금 공부 시간 기록 (' + (s && s.minutes) + '분)');

  // 길게 눌러 포기
  await page.click('#lock-start'); await page.click('#ask-ok');
  const q = page.locator('#lock-quit'); const box = await q.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.waitForTimeout(3200); await page.mouse.up();
  await page.click('#ask-ok');
  assert(await page.isHidden('#lock-screen'), '3초 길게 눌러 포기');

  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
