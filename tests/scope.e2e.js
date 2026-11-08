// 쉬운 범위 만들기 (휴대폰 목록 보기) 테스트: 과목 고르기 → 과목마다 공부할 내용을 하나씩
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const topic = async (title) => (await state()).topics.find((t) => t.title === title);
  const card = (title) => page.locator('.bcard', { has: page.locator(`.bcard-title:text-is("${title}")`) });
  const active = () => page.evaluate(() => (document.activeElement && document.activeElement.dataset.keep) || '');

  await page.goto(base + '#board');
  assert(await page.isVisible('#exam-form'), '시험 만들기 화면');
  await page.fill('#ex-name', '2학기 기말고사');
  await page.fill('#ex-date', '2026-12-10');
  await page.tap('#ex-subjects [data-pick="국어"]');
  await page.tap('#ex-subjects [data-pick="수학"]');
  await page.tap('#ex-subjects [data-pick="수학"]'); // 다시 누르면 빠짐
  await page.tap('#ex-subjects [data-pick="수학"]');
  await page.fill('#ex-subject-custom', '물리학');
  await page.press('#ex-subject-custom', 'Enter'); // Enter는 과목 추가 (시험이 바로 만들어지지 않음)
  assert((await state()).exams.length === 0, '직접 입력 Enter는 시험을 만들지 않음');
  assert(await page.locator('#ex-subjects [aria-pressed="true"]').count() === 3, '과목 3개 고름');
  await page.tap('#exam-form button[type=submit]');
  await page.waitForTimeout(150);
  assert((await page.evaluate(() => Board.mode)) === 'list', '휴대폰은 목록 보기');
  const cards = (await state()).topics.filter((t) => !t.parentId).map((t) => t.title);
  assert(cards.join(',') === '국어,수학,물리학', '고른 과목이 과목 카드로: ' + cards.join(','));
  assert((await state()).subjects.some((s) => s.name === '물리학'), '새 과목은 과목 목록(타이머·통계)에도 추가');
  assert((await active()).startsWith('add:'), '첫 과목의 입력칸에 커서');

  // 공부할 내용 하나씩 (Enter)
  await page.keyboard.type('문학: 현대시');
  await page.keyboard.press('Enter');
  await page.keyboard.type('문법: 음운의 변동');
  await page.keyboard.press('Enter');
  const kor = await topic('국어');
  assert((await topic('문학: 현대시')).parentId === kor.id && (await topic('문법: 음운의 변동')).parentId === kor.id, 'Enter로 국어에 연속 추가');
  assert((await active()) === 'add:' + kor.id, '추가한 뒤에도 같은 입력칸에 커서');
  // 추가 버튼
  await card('수학').locator('.sadd-input').fill('1단원 다항식');
  await card('수학').locator('.sadd button').tap();
  await card('수학').locator('.sadd-input').fill('2단원 방정식');
  await card('수학').locator('.sadd-input').press('Enter');
  assert((await topic('2단원 방정식')).parentId === (await topic('수학')).id, '추가 버튼·Enter로 수학에 추가');
  // 아직 비어 있는 과목(물리학)은 과목 자체가 할 일 하나로 센다
  assert((await page.textContent('.sl-head')).includes('0/5'), '목록 위 진행률 0/5');
  assert((await card('물리학').locator('.bcard-prog').textContent()).includes('아직 공부할 내용이 없어요'), '빈 과목 안내');

  // 체크
  await page.locator('.bitem', { hasText: '1단원 다항식' }).locator('[data-check]').tap();
  assert((await topic('1단원 다항식')).done, '체크');
  assert((await page.textContent('.sl-head')).includes('1/5 · 20%'), '진행률 1/5');

  // 과목 추가 칩
  await page.locator('#subj-picker [data-subject-add="영어"]').tap();
  assert(!!(await topic('영어')), '과목 칩으로 영어 추가');
  assert(!(await page.isVisible('#subj-picker [data-subject-add="영어"]')), '추가한 과목은 칩에서 빠짐');
  await page.fill('#subj-picker .sas-input', '한국사');
  await page.press('#subj-picker .sas-input', 'Enter');
  assert(!!(await topic('한국사')), '과목 직접 입력');
  await page.fill('#subj-picker .sas-input', '한국사');
  await page.press('#subj-picker .sas-input', 'Enter');
  assert((await state()).topics.filter((t) => t.title === '한국사').length === 1, '같은 과목은 두 번 안 생김');

  // 하위 항목 (단원 → 세부)
  await page.locator('.bitem', { hasText: '2단원 방정식' }).locator('[data-menu]').first().tap();
  await page.tap('#pop-menu [data-act="add"]');
  await page.keyboard.type('복소수');
  await page.keyboard.press('Enter');
  await page.keyboard.type('이차방정식');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert((await topic('이차방정식')).parentId === (await topic('2단원 방정식')).id, '하위 항목 추가');

  // 과목 접기·펼치기
  await card('국어').locator('.bcard-head [data-collapse]').tap();
  assert(!(await page.isVisible('.btitle:text-is("문학: 현대시")')), '과목 접기');
  await card('국어').locator('.bcard-head [data-collapse]').tap();
  assert(await page.isVisible('.btitle:text-is("문학: 현대시")'), '과목 펼치기');

  // 과목 순서 바꾸기
  await card('물리학').locator('.bcard-head [data-menu]').tap();
  await page.tap('#pop-menu [data-act="up"]');
  const order = await page.$$eval('.list-mode .bcard:not(.note) .bcard-title', (els) => els.map((e) => e.textContent));
  assert(order.indexOf('물리학') < order.indexOf('수학'), '과목 위로 옮기기: ' + order.join(','));

  // 삭제 → 되돌리기
  await card('영어').locator('.bcard-head [data-menu]').tap();
  await page.tap('#pop-menu [data-act="delete"]');
  assert(!(await topic('영어')), '빈 과목 삭제');
  await page.tap('.sl-head [data-list-act="undo"]');
  assert(!!(await topic('영어')), '되돌리기');

  // 소요시간을 적은 뒤 항목을 지워도 '오늘 한 양'으로 잡히지 않음
  await page.locator('.bitem', { hasText: '문법: 음운의 변동' }).locator('[data-time]').tap();
  await page.tap('#time-quick [data-min="60"]');
  await page.tap('#time-form button[type=submit]');
  await page.locator('.bitem', { hasText: '문학: 현대시' }).locator('[data-time]').tap();
  await page.tap('#time-quick [data-min="30"]');
  await page.tap('#time-form button[type=submit]');
  await page.locator('.bitem', { hasText: '문학: 현대시' }).locator('[data-menu]').first().tap();
  await page.tap('#pop-menu [data-act="delete"]');
  const plan = await page.evaluate(() => { const s = App.store.get(); const ex = s.exams[0]; return Scope.timePlan(Scope.examProgress(s.topics, ex.id), ex, Date.now()); });
  assert(plan && plan.todayDone === 0, '지운 항목은 오늘 한 양이 아님 (todayDone ' + (plan && plan.todayDone) + ')');

  // 보드로 바꿔도 카드가 겹치지 않음
  await page.tap('[data-scope-mode=board]');
  await page.waitForTimeout(200);
  const overlaps = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('#board-cards .bcard:not(.note)')].map((e) => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top), h: e.offsetHeight }));
    let bad = 0;
    for (let i = 0; i < rs.length; i++) for (let j = 0; j < i; j++) { const a = rs[i], b = rs[j]; if (a.x < b.x + 300 && b.x < a.x + 300 && a.y < b.y + b.h && b.y < a.y + a.h) bad++; }
    return bad;
  });
  assert(overlaps === 0, '보드: 카드 겹침 없음');
  const firstVisible = await page.evaluate(() => {
    const r = document.querySelector('#board-viewport').getBoundingClientRect();
    return [...document.querySelectorAll('#board-cards .bcard')].some((c) => { const b = c.getBoundingClientRect(); return b.left >= r.left - 1 && b.top >= r.top - 1 && b.left < r.right && b.top < r.bottom; });
  });
  assert(firstVisible, '보드로 바꾸면 카드가 화면에 보임');
  // 보드에서 과목 추가 (창)
  await page.tap('[data-scope-mode=list]');
  await page.tap('[data-scope-mode=board]');
  await page.evaluate(() => document.querySelector('#bb-add-card').click());
  assert(await page.isVisible('#subj-dlg'), '보드: 과목 추가 창');
  await page.tap('#subj-chips [data-subject-add="통합과학"]');
  assert(!!(await topic('통합과학')) && !(await page.isVisible('#subj-dlg')), '보드: 칩으로 과목 추가');
  await page.keyboard.type('물질의 규칙성');
  await page.keyboard.press('Enter');
  assert((await topic('물질의 규칙성')).parentId === (await topic('통합과학')).id, '보드: 새 과목에 바로 항목 입력');
  await page.keyboard.press('Escape');

  // 선택한 보기 방식 기억
  await page.reload();
  await page.waitForTimeout(150);
  assert((await page.evaluate(() => Board.mode)) === 'board', '보기 방식 기억');
  await page.tap('[data-scope-mode=list]');

  // 로그인 버튼이 타이머 모드를 바꾸던 문제
  await page.goto(base + '#timer');
  const before = await page.evaluate(() => window.__studypromotion.timer.mode);
  // (폼 제출 없이 클릭 처리기만 부르도록 일반 이벤트로)
  await page.evaluate(() => document.querySelector('#acc-form [data-mode="login"]').dispatchEvent(new Event('click', { bubbles: true })));
  const after = await page.evaluate(() => window.__studypromotion.timer.mode);
  assert(before === 'focus' && after === 'focus', '로그인 버튼을 눌러도 타이머는 집중 모드 (' + after + ')');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '가로 스크롤 없음');
  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
