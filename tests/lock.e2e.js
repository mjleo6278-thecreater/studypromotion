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
  if (new Date().getDate() !== 1) assert(await page.isVisible('#mg-pace') && /분|시간/.test(await page.textContent('#mg-need')), '하루 페이스 표시');
  await page.goto(base + '#home');
  assert(/월 목표 페이스/.test(await page.textContent('#h-month-pace')), '홈에 오늘 페이스 표시');

  // 잠금 시작: 확인 창에서 과목을 고른다 (v4.5.1, 전에는 위 ‘과목’ 칸을 미리 바꿔야 했다)
  await page.goto(base + '#timer');
  const kor = await page.evaluate(() => App.store.get().subjects.find((x) => x.name === '국어').id);
  await page.click('[data-lock="30"]');
  await page.click('#lock-start');
  assert((await page.getAttribute('#ask-extra [data-lsub=""]', 'aria-checked')) === 'true' && !(await page.textContent('#lock-ask-note')).includes('스톱워치'), '확인 창에 과목 칩, 위 칸과 같은 ‘과목 없음’이 골라져 있음');
  await page.click(`#ask-extra [data-lsub="${kor}"]`);
  await page.click('#ask-ok');
  assert(await page.isVisible('#lock-screen'), '잠금 화면 보임');
  assert(/^국어 · 30분 잠금$/.test(await page.textContent('#lock-sub')) && (await page.inputValue('#timer-subject')) === kor && await page.isHidden('#lock-sw'), '고른 국어로 잠금, 위 과목 칸도 국어 (스톱워치 줄은 없음)');
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
  assert(s && s.minutes === 29 && s.leaves >= 2 && s.subjectId === kor, '잠금 공부 시간을 국어로 기록 (' + (s && s.minutes) + '분)');

  // 길게 눌러 포기
  await page.click('#lock-start'); await page.click('#ask-ok');
  const q = page.locator('#lock-quit'); const box = await q.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.waitForTimeout(3200); await page.mouse.up();
  await page.click('#ask-ok');
  assert(await page.isHidden('#lock-screen'), '3초 길게 눌러 포기');

  // 가로로 눕힌 폰(높이가 낮은 화면): 모든 칸이 화면 안에 들어오고 '포기하기' 단추가 눌려 글씨가 잘리지 않음 (v3.2.1)
  for (const [w, h] of [[800, 380], [568, 300]]) {
    const lctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
    const lp = await lctx.newPage(); lp.on('pageerror', (e) => errors.push(e.message));
    await lp.goto(base + '#timer');
    // 과목을 많이 만들고 스톱워치를 켜 둔 채 잠근다: 확인 창이 낮은 화면을 넘으면 창 안에서 스크롤되고, 잠금 화면에 스톱워치 줄이 더 생긴다
    await lp.evaluate(() => {
      App.store.update((st) => { for (let i = 1; i <= 8; i++) st.subjects.push({ id: 'x' + i, name: '과목' + i, color: '#45a865' }); });
      localStorage.setItem('studypromotion.stopwatch', JSON.stringify({ running: true, startAt: Date.now() - 65 * 60000, subjectId: 'x1', last: 'x1' }));
    });
    await lp.reload();
    await lp.tap('[data-ttab="focus"]');
    await lp.locator('[data-lock="60"]').scrollIntoViewIfNeeded();
    await lp.tap('[data-lock="60"]'); await lp.tap('#lock-start');
    const askFit = await lp.evaluate(() => { const b = document.querySelector('#ask .ask-box').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
    await lp.locator('#ask-ok').scrollIntoViewIfNeeded();
    assert(askFit && await lp.isVisible('#ask-ok'), `가로 ${w}x${h}에서 과목이 많아도 확인 창이 화면 안 (창 안에서 스크롤)`);
    await lp.tap('#ask-ok');
    await lp.evaluate(() => {
      document.querySelector('#lock-msg').textContent = '돌아왔네요. 나가 있던 시간은 공부 시간에서 빠져요.';
      document.querySelector('#lock-leaves').textContent = '화면을 끄거나 나간 횟수 1번 · 2분';
    });
    assert(/^스톱워치 1:05:\d\d · 계속 재는 중$/.test(await lp.textContent('#lock-sw')), `가로 ${w}x${h}: 잠금 화면에 스톱워치 줄`);
    const fit = await lp.evaluate(() => ['.lock-icon', '#lock-time', '#lock-sub', '#lock-sw', '#lock-msg', '#lock-leaves', '#lock-quit'].map((s) => {
      const el = document.querySelector(s); const b = el.getBoundingClientRect();
      return { s, ok: b.top >= 0 && b.bottom <= innerHeight && b.height > 0 && (s !== '#lock-quit' || el.scrollHeight <= el.clientHeight + 1) };
    }));
    const quitH = await lp.evaluate(() => document.querySelector('#lock-quit').getBoundingClientRect().height);
    assert(fit.every((x) => x.ok) && quitH >= 34, `가로 ${w}x${h}에서 잠금 화면이 모두 보임 (잘린 칸: ${fit.filter((x) => !x.ok).map((x) => x.s).join(' ') || '없음'}, 포기 단추 높이 ${Math.round(quitH)})`);
    await lctx.close();
  }

  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
