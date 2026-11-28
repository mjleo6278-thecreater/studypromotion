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
      document.querySelector('#lock-msg').textContent = '돌아왔네요. 화면을 꺼 둔 시간도 공부 시간으로 세요.';
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

  // 화면을 끈 채 공부 (4.6.1, 안준형 님 신고 '타이머로 공부해도 기록이 안 남음'):
  // 실제 폰처럼 화면이 꺼져 있는 동안은 앱이 멈춰 있다가(시계만 흐름) 켜면 다시 돈다.
  // 전에는 끈 시간이 모두 '나간 시간'으로 빠져 0분이 되고 기록이 없었으며 알림은 '0분 공부를 기록했어요'였다
  {
    const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const cp = await cctx.newPage(); cp.on('pageerror', (e) => errors.push(e.message));
    await cp.clock.install({ time: new Date('2026-11-28T19:00:00+09:00') });
    const screen = (on) => cp.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v });
      document.dispatchEvent(new Event('visibilitychange'));
    }, on);
    const offFor = async (min) => { await screen(false); await cp.clock.setSystemTime(await cp.evaluate((m) => Date.now() + m * 60000, min)); await screen(true); await cp.clock.runFor(1500); };
    const lockOf = (st) => st.sessions.filter((x) => x.lock).map((x) => x.minutes);
    await cp.goto(base + '#timer');
    await cp.waitForFunction(() => window.App && window.Lock);
    const eng = await cp.evaluate(() => App.store.get().subjects.find((x) => x.name === '영어').id);
    await cp.tap('[data-lock="30"]'); await cp.tap('#lock-start');
    assert(/화면을 꺼 둔 시간도 공부 시간으로 세요/.test(await cp.textContent('#lock-ask-note')), '확인 창에 ‘화면을 꺼 둔 시간도 공부 시간으로 세요’');
    await cp.tap(`#ask-extra [data-lsub="${eng}"]`);
    await cp.tap('#ask-ok');
    await cp.clock.runFor(2000);
    await offFor(31); // 잠그고 바로 화면을 끄고 30분 뒤에 켬
    let st = await cp.evaluate(() => App.store.get());
    assert(await cp.isHidden('#lock-screen') && lockOf(st).join() === '30' && st.sessions.find((x) => x.lock).subjectId === eng, '화면을 끈 채 30분 잠금 → 영어 30분 기록 (' + lockOf(st).join() + ')');
    assert(/잠금 완료! 30분 공부를 기록했어요/.test(await cp.textContent('#toast')), '알림: ' + await cp.textContent('#toast'));
    // 1시간 잠금: 10분은 화면을 켜 두고, 다른 앱처럼 잠깐 나갔다 오고, 45분은 끔 → 1시간 다
    await cp.tap('[data-lock="60"]'); await cp.tap('#lock-start'); await cp.tap('#ask-ok');
    await cp.clock.runFor(2000);
    await cp.clock.fastForward('10:00');
    await offFor(2);
    assert(/화면을 꺼 둔 시간도 공부 시간으로 세요/.test(await cp.textContent('#lock-msg')) && /화면을 끄거나 나간 횟수 1번 · 2분/.test(await cp.textContent('#lock-leaves')), '돌아오면 화면 끈 시간도 센다고 알려 주고, 나간 횟수·시간은 보여 줌');
    await offFor(49);
    st = await cp.evaluate(() => App.store.get());
    assert(lockOf(st).join() === '30,60' && st.sessions.find((x) => x.lock && x.minutes === 60).leaves === 2, '1시간 잠금 중 화면을 여러 번 꺼도 60분 기록 (' + lockOf(st).join() + ')');
    // 화면을 끈 채 앱이 닫혔다가 끝난 뒤 다시 열어도 다 센다
    await cp.tap('[data-lock="30"]'); await cp.tap('#lock-start'); await cp.tap('#ask-ok');
    await cp.clock.runFor(2000);
    await screen(false);
    await cp.clock.setSystemTime(await cp.evaluate(() => Date.now() + 40 * 60000));
    await cp.reload();
    await cp.clock.runFor(2000);
    st = await cp.evaluate(() => App.store.get());
    assert(await cp.isHidden('#lock-screen') && lockOf(st).join() === '30,60,30', '화면을 끈 채 닫혔다가 다시 열어도 30분 기록 (' + lockOf(st).join() + ')');
    // 1분도 안 돼서 그만두면 기록하지 않고, '0분 공부를 기록했어요'라고 하지 않는다
    await cp.tap('[data-lock="30"]'); await cp.tap('#lock-start'); await cp.tap('#ask-ok');
    await cp.clock.runFor(2000);
    await cp.evaluate(() => { const q = document.querySelector('#lock-quit'); q.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await cp.clock.runFor(3200);
    await cp.tap('#ask-ok');
    await cp.clock.runFor(500);
    st = await cp.evaluate(() => App.store.get());
    assert(lockOf(st).join() === '30,60,30' && /1분이 안 돼서 기록하지 않았어요/.test(await cp.textContent('#toast')) && !/0분/.test(await cp.textContent('#toast')), '1분 안에 그만두면 기록 없이 그렇다고 알림: ' + await cp.textContent('#toast'));
    await cctx.close();
  }

  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
