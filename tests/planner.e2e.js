// v3.7 테스트: 스터디 플래너 (계획 탭 자리, js/plan.js · js/planner.js)
//  ① 하루 보기: 주간 띠·날짜 넘기기·D-day  ② 할 일 추가(반복)·고치기·지우기  ③ 미루기·옮기기(달력 창)
//  ④ 지난 날 못 한 일 가져오기  ⑤ 목표·돌아보기·홈의 오늘 할 일  ⑥ 주간 보기
//  ⑦ 범위에서 고르기, 범위와 할 일 두 방향 체크(공부 시간 한 번만)  ⑧ 범위 탭 '플래너에 넣기' → 아무 날
//  ⑨ ▶ 공부 시작 → '하는 중', 잰 시간이 줄에  ⑩ 날짜 안 정한 할 일  ⑪ 과목 만들기 링크  ⑫ 화면 크기
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

// 오늘 = 2026-11-17(화) 16:20, 한국 시각. 시험은 11/30(월)
const NOW = new Date('2026-11-17T16:20:00+09:00').getTime();
function seed() {
  return {
    subjects: [{ id: 's1', name: '국어', color: '#e05a4f' }, { id: 's2', name: '수학', color: '#3d96e0' }, { id: 's3', name: '영어', color: '#45a865' }],
    tasks: [
      { id: 'o1', title: '영어 단어 50개', subjectId: 's3', due: '2026-11-16', estimateMin: 20, done: false, createdAt: 1 },
      { id: 't1', title: '수학 문제집 3쪽', subjectId: 's2', due: '2026-11-17', estimateMin: 45, done: false, createdAt: 2 },
      { id: 'f1', title: '국어 프린트', subjectId: 's1', due: '2026-11-19', estimateMin: null, done: false, createdAt: 3 },
    ],
    exams: [{ id: 'e1', name: '기말고사', date: '2026-11-30', createdAt: 1 }],
    activeExamId: 'e1',
    topics: [
      { id: 'c1', examId: 'e1', parentId: null, kind: 'topic', title: '국어', order: 0, x: 0, y: 0, color: '#e05a4f', flags: {} },
      { id: 'k1', examId: 'e1', parentId: 'c1', kind: 'topic', title: '문학 1강', order: 0, est: 30, flags: {} },
      { id: 'k2', examId: 'e1', parentId: 'c1', kind: 'topic', title: '문학 2강', order: 1, est: 40, flags: {} },
      { id: 'c2', examId: 'e1', parentId: null, kind: 'topic', title: '수학', order: 1, x: 320, y: 0, color: '#3d96e0', flags: {} },
      { id: 'u1', examId: 'e1', parentId: 'c2', kind: 'topic', title: '2단원', order: 0, flags: {} },
      { id: 'm1', examId: 'e1', parentId: 'u1', kind: 'topic', title: '복소수', order: 0, est: 50, flags: {} },
      { id: 'm2', examId: 'e1', parentId: 'u1', kind: 'topic', title: '이차방정식', order: 1, est: 60, flags: {} },
    ],
    settings: { dailyGoalMin: 120 },
  };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];

  async function open(o) {
    o = o || {};
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' }, o.ctx || {}));
    await ctx.addInitScript((data) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('studypromotion.welcomeClosed', '1');
      localStorage.setItem('studypromotion.v1', JSON.stringify(Object.assign({ cards: [], sessions: [], reviewLog: [], strokes: [], boardView: {}, events: [], decks: [] }, data)));
    }, seed());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.clock.install({ time: NOW });
    await page.goto(base + (o.hash || '#plan'));
    await page.waitForFunction(() => window.App && window.Planner);
    await page.waitForTimeout(200);
    return { ctx, page };
  }
  const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const task = async (page, id) => (await state(page)).tasks.find((t) => t.id === id);
  const toastOf = (page) => page.textContent('#toast');
  const sheetIn = (page) => page.waitForSelector('.ui-back.in .ui-sheet');
  const tapIn = async (page, sel) => { await page.waitForSelector('.ui-back.in ' + sel); await page.tap('.ui-back.in ' + sel); await page.waitForTimeout(250); };
  const choose = (page, label) => tapIn(page, `.ch-opt:has(b:text-is("${label}"))`);
  const menu = async (page, rowSel, item) => { await page.tap(rowSel + ' .pl-more'); await tapIn(page, `[data-pl-mi="${item}"]`); };
  const sumTitle = (page) => page.textContent('#pl-sum h2');
  const listIds = (page, sel) => page.$$eval((sel || '#pl-list') + ' > .pl-item', (els) => els.map((e) => e.dataset.plId));

  /* ===== ① 하루 보기 ===== */
  let { ctx, page } = await open();
  assert(/11월 17일 \(화\)/.test(await sumTitle(page)) && /오늘/.test(await sumTitle(page)), '처음엔 오늘: ' + await sumTitle(page));
  const days = await page.$$eval('#pl-strip .pl-day', (els) => els.map((e) => ({ k: e.dataset.plDay, on: e.classList.contains('on'), today: e.classList.contains('today'), label: e.querySelector('span').textContent })));
  assert(days.length === 7 && days[0].k === '2026-11-16' && days[6].k === '2026-11-22' && days[1].on && days[1].today && days[1].label === '오늘', '주간 띠: 월~일 7칸, 오늘이 골라져 있음');
  assert(/기말고사 D-13/.test(await page.textContent('#pl-sum .pl-dday')), '그날 기준 시험 D-day');
  assert((await listIds(page)).join() === 't1', '오늘 할 일만 목록에');
  assert(/어제 못 한 할 일 1개/.test(await page.textContent('#pl-todo .pl-carry')), '어제 못 한 할 일 띠');
  assert(await page.isVisible('#pl-list [data-pl-id="t1"] .pl-play'), '오늘 할 일에는 ▶ 공부 시작 버튼');
  assert(await page.locator('#pl-strip [data-pl-day="2026-11-19"] .pl-dots i').count() === 1, '띠의 날짜 아래 할 일 점');
  await page.tap('#pl-strip [data-pl-day="2026-11-19"]');
  assert(/11월 19일 \(목\)/.test(await sumTitle(page)) && /모레/.test(await sumTitle(page)), '날짜를 누르면 그날: ' + await sumTitle(page));
  assert((await listIds(page)).join() === 'f1' && !(await page.$('#pl-list .pl-play')) && !(await page.$('#pl-todo .pl-carry')), '앞날에는 그날 할 일만, ▶·못 한 일 띠 없음');
  assert(/이날의 목표/.test(await page.textContent('#pl-sum .pl-goal')) && /메모/.test(await page.textContent('#pl-memo h2')), '앞날은 ‘이날의 목표’, ‘메모’');
  await page.tap('#pl-strip [data-pl-nav="7"]');
  assert(/11월 23일 ~ 29일/.test(await page.textContent('#pl-strip .pl-week-top b')) && /11월 26일/.test(await sumTitle(page)), '다음 주로 (같은 요일)');
  await page.tap('#pl-strip [data-pl-today]');
  assert(/11월 17일/.test(await sumTitle(page)) && !(await page.$('#pl-strip [data-pl-today]')), "'오늘'을 누르면 돌아오고 그 단추는 사라짐");
  // 달력 창: 한 번 누르면 아래에 그날 요약, 단추나 한 번 더 누르면 연다
  await page.tap('#pl-strip [data-pl-cal]');
  await sheetIn(page);
  assert(/2026년 11월/.test(await page.textContent('.ui-back.in .ui-cal-head')) && await page.isVisible('.ui-back.in .pl-md.exam[data-pl-md="2026-11-30"] em'), '달력 창: 이번 달, 시험 날 표시');
  await page.tap('.ui-back.in [data-pl-md="2026-11-19"]');
  assert(/11월 19일 \(목\)/.test(await page.textContent('.ui-back.in .pl-mfoot')) && /할 일 1개/.test(await page.textContent('.ui-back.in .pl-mfoot')), '한 번 누르면 그날 할 일 수');
  await page.tap('.ui-back.in [data-pl-md="2026-11-19"]');
  await page.waitForTimeout(250);
  assert(/11월 19일/.test(await sumTitle(page)), '한 번 더 누르면 그날을 연다');
  await page.tap('#pl-strip [data-pl-today]');

  /* ===== ② 할 일 추가(반복)·고치기·지우기 ===== */
  await page.tap('#pl-todo [data-pl-add]');
  assert(await page.isVisible('#pl-dlg') && (await page.$eval('#pl-date', (i) => i.value)) === '2026-11-17' && /11월 17일/.test(await page.textContent('[data-for="pl-date"]')), '할 일 추가 창: 날짜는 보고 있는 날');
  await page.fill('#pl-title', '수학 오답 정리');
  await page.tap('#pl-subj [data-pl-subj="s2"]');
  assert(await page.getAttribute('#pl-subj [data-pl-subj="s2"]', 'aria-checked') === 'true', '과목 칩 고르기');
  await page.selectOption('#pl-est', '30');
  await page.tap('[data-pl-rep="weekly"]');
  assert(await page.isVisible('#pl-days') && await page.getAttribute('#pl-days [data-pl-wd="2"]', 'aria-pressed') === 'true', '요일마다: 그날 요일(화)이 먼저 골라짐');
  await page.tap('#pl-days [data-pl-wd="4"]');
  assert((await page.$eval('#pl-until', (i) => i.value)) === '2026-11-29', '언제까지 처음 값: 시험 전날');
  assert(/화·목마다 · 4개 \(11\/26 \(목\)까지\)/.test(await page.textContent('#pl-rep-sum')), '반복 요약: ' + await page.textContent('#pl-rep-sum'));
  await page.tap('#pl-save');
  await page.waitForTimeout(200);
  let st = await state(page);
  let rep = st.tasks.filter((t) => t.title === '수학 오답 정리');
  assert(rep.length === 4 && rep.map((t) => t.due).join() === '2026-11-17,2026-11-19,2026-11-24,2026-11-26' && rep.every((t) => t.rep && t.rep.id === rep[0].rep.id && t.estimateMin === 30 && t.subjectId === 's2'), '화·목 반복 할 일 4개 (같은 묶음)');
  assert(/화·목마다 할 일 4개를 넣었어요/.test(await toastOf(page)), '반복 알림: ' + await toastOf(page));
  assert(await page.isHidden('#pl-dlg') && /화·목마다/.test(await page.textContent('#pl-list')), '창이 닫히고 줄에 반복 표시');
  // 11/19 것을 고치기 → '이 날부터 앞으로 모두'
  await page.tap('#pl-strip [data-pl-day="2026-11-19"]');
  const r19 = rep.find((t) => t.due === '2026-11-19').id;
  await page.tap(`#pl-list [data-pl-id="${r19}"] .pl-title`);
  await tapIn(page, '[data-pl-mi="edit"]');
  assert(/반복 할 일 · 화·목마다 · 이 날부터 3개/.test(await page.textContent('#pl-rep-info')) && await page.isHidden('#pl-rep-f'), '반복 할 일을 고칠 때는 반복 안내만');
  await page.fill('#pl-title', '수학 오답 정리 (2회독)');
  await page.tap('#pl-save');
  await choose(page, '이 날부터 앞으로 모두');
  rep = (await state(page)).tasks.filter((t) => t.rep && t.rep.id === rep[0].rep.id);
  assert(rep.map((t) => t.title).join('|') === '수학 오답 정리|수학 오답 정리 (2회독)|수학 오답 정리 (2회독)|수학 오답 정리 (2회독)', '이 날부터 앞으로 모두 바뀌고 지난 것은 그대로');
  // 11/24 것을 지우기 → '이 날부터 앞으로 모두 지우기' → 되돌리기
  await page.tap('#pl-strip [data-pl-nav="7"]');
  await page.tap('#pl-strip [data-pl-day="2026-11-24"]');
  const r24 = rep.find((t) => t.due === '2026-11-24').id;
  await menu(page, `#pl-list [data-pl-id="${r24}"]`, 'del');
  await choose(page, '이 날부터 앞으로 모두 지우기');
  assert((await state(page)).tasks.filter((t) => t.rep).length === 2 && /할 일 2개를 지웠어요/.test(await toastOf(page)), '이 날부터 2개 지움');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(100);
  assert((await state(page)).tasks.filter((t) => t.rep).length === 4, '되돌리기로 다시 4개');
  await page.tap('#pl-strip [data-pl-today]');

  /* ===== ③ 미루기·옮기기 ===== */
  await menu(page, '#pl-list [data-pl-id="t1"]', 'next');
  assert((await task(page, 't1')).due === '2026-11-18' && /11월 18일 \(수\)로 옮겼어요/.test(await toastOf(page)), '내일로 미루기: ' + await toastOf(page));
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(100);
  assert((await task(page, 't1')).due === '2026-11-17', '되돌리기로 다시 오늘');
  await menu(page, '#pl-list [data-pl-id="t1"]', 'pick');
  await sheetIn(page);
  assert(/어느 날로 옮길까요/.test(await page.textContent('.ui-back.in .ui-sheet-head')), '다른 날로 옮기기: 달력 창');
  await page.tap('.ui-back.in [data-pl-md="2026-11-20"]');
  await page.tap('.ui-back.in [data-pl-mok]');
  await page.waitForTimeout(200);
  assert((await task(page, 't1')).due === '2026-11-20' && !(await listIds(page)).includes('t1'), '고른 날(11/20)로 옮겨져 오늘 목록에서 빠짐');
  await page.evaluate(() => App.store.update((s) => { s.tasks.find((t) => t.id === 't1').due = '2026-11-17'; }));

  /* ===== ④ 지난 날 못 한 일 ===== */
  await page.tap('#pl-todo [data-pl-carry-open]');
  assert(/11\/16 \(월\)/.test(await page.textContent('#pl-todo .pl-carry-list [data-pl-id="o1"]')), '펼치면 못 한 일과 그 날짜');
  await page.tap('#pl-todo [data-pl-carry]');
  await page.waitForTimeout(100);
  assert((await task(page, 'o1')).due === '2026-11-17' && !(await page.$('#pl-todo .pl-carry')) && (await listIds(page))[0] === 'o1', '오늘로 가져오기: 오늘 목록 맨 위로, 띠는 사라짐');
  assert(/할 일 1개를 오늘로 가져왔어요/.test(await toastOf(page)), '가져온 알림');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(100);
  assert((await task(page, 'o1')).due === '2026-11-16' && await page.isVisible('#pl-todo .pl-carry'), '되돌리기로 원래 날짜');

  /* ===== ⑤ 목표·돌아보기·홈 ===== */
  await page.tap('#pl-sum [data-pl-goal]');
  assert(await page.evaluate(() => document.activeElement && document.activeElement.id === 'pl-goal-in'), '목표를 누르면 바로 적는 칸');
  await page.fill('#pl-goal-in', '수학 2단원 끝내기');
  await page.press('#pl-goal-in', 'Enter');
  await page.waitForTimeout(100);
  assert((await state(page)).planner['2026-11-17'].goal === '수학 2단원 끝내기' && /수학 2단원 끝내기/.test(await page.textContent('#pl-sum .pl-goal')), '오늘의 목표 저장');
  await page.fill('#pl-memo-in', '오늘은 집중이 잘 됐다');
  await page.waitForTimeout(900);
  assert((await state(page)).planner['2026-11-17'].memo === '오늘은 집중이 잘 됐다' && /저장했어요/.test(await page.textContent('#pl-memo-st')), '돌아보기는 적는 대로 저장');
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(150);
  assert(/수학 2단원 끝내기/.test(await page.textContent('#h-pl-top .pl-home-goal')), '홈에도 오늘의 목표');
  assert((await listIds(page, '#h-tasklist')).sort().join() === ['t1', rep[0].id].sort().join() && await page.textContent('#h-tasks') === '2', '홈의 오늘 할 일 = 플래너 오늘 칸 (남은 2)');
  assert(/지난 날 못 한 일 1개/.test(await page.textContent('#h-tasks-sub')), '요약 카드에 못 한 일 수');
  await page.tap('#h-tasks-panel [data-pl-add]');
  await page.fill('#pl-title', '홈에서 넣은 할 일');
  await page.tap('#pl-save');
  await page.waitForTimeout(150);
  assert((await state(page)).tasks.find((t) => t.title === '홈에서 넣은 할 일').due === '2026-11-17' && (await listIds(page, '#h-tasklist')).length === 3, '홈에서 추가하면 오늘 할 일로');
  await page.tap('#h-tasklist [data-pl-id="t1"] .pl-check');
  await page.waitForTimeout(150);
  assert((await task(page, 't1')).done && (await state(page)).sessions.some((s) => s.doneOf === 'task:t1' && s.minutes === 45), '홈에서 체크해도 끝남 (예상 45분 기록)');
  await page.tap('#h-tasklist [data-pl-id="t1"] .pl-check');
  await page.waitForTimeout(150);
  assert(!(await task(page, 't1')).done && !(await state(page)).sessions.length, '체크를 풀면 기록도 뺌');
  await page.evaluate(() => App.go('plan'));

  /* ===== ⑥ 주간 보기 ===== */
  await page.tap('[data-pl-mode="week"]');
  assert(await page.isVisible('#pl-week') && await page.isHidden('#pl-day'), '주간 보기로 바뀜');
  const wd = await page.$$eval('#pl-week .pl-wd', (els) => els.map((e) => ({ k: e.dataset.plWd, today: e.classList.contains('today'), n: e.querySelectorAll('.pl-wi').length })));
  assert(wd.length === 7 && wd[1].today && wd[0].n === 1 && wd[1].n === 3 && wd[3].n === 2, '월~일, 날마다 할 일: ' + wd.map((x) => x.n).join(','));
  assert(/할 일 0 \/ 6/.test(await page.textContent('#pl-week .pl-wk-sum')) && /기말고사/.test(await page.textContent('#pl-week .pl-wk-exam')), '이 주 합계와 다가오는 시험');
  await page.tap('#pl-week [data-pl-wd="2026-11-21"] [data-pl-add]');
  assert((await page.$eval('#pl-date', (i) => i.value)) === '2026-11-21', '그 날의 ＋ 추가 → 그 날짜로');
  await page.tap('#pl-cancel');
  await page.tap('#pl-week [data-pl-open="2026-11-19"]');
  assert(await page.isVisible('#pl-day') && /11월 19일/.test(await sumTitle(page)), '날짜를 누르면 그날 하루 보기');
  await page.tap('#pl-strip [data-pl-today]');

  /* ===== ⑦ 범위에서 고르기, 두 방향 체크 ===== */
  await page.tap('#pl-todo [data-pl-scope]');
  await sheetIn(page);
  const items = await page.$$eval('.ui-back.in .pl-sc-item', (els) => els.map((e) => e.dataset.plSc));
  assert(items.join() === 'k1,k2,m1,m2', '시험의 남은 범위 항목: ' + items.join());
  assert(await page.isDisabled('.ui-back.in [data-pl-sc-ok]'), '고르기 전에는 넣기 단추가 꺼짐');
  await page.tap('.ui-back.in [data-pl-sc="k1"]');
  await page.tap('.ui-back.in [data-pl-sc="m1"]');
  assert(/2개를 11월 17일 \(화\)에 넣기/.test(await page.textContent('.ui-back.in [data-pl-sc-ok]')), '고른 수와 날짜');
  await page.tap('.ui-back.in [data-pl-sc-ok]');
  await page.waitForTimeout(250);
  st = await state(page);
  const tk1 = st.tasks.find((t) => t.topicId === 'k1'), tm1 = st.tasks.find((t) => t.topicId === 'm1');
  assert(tk1 && tk1.title === '문학 1강' && tk1.subjectId === 's1' && tk1.estimateMin === 30 && tk1.due === '2026-11-17', '범위 → 할 일 (과목·남은 시간·날짜): ' + JSON.stringify(tk1));
  assert(tm1 && tm1.title === '2단원 · 복소수' && tm1.subjectId === 's2' && tm1.estimateMin === 50, '단원 이름도 앞에: ' + tm1.title);
  assert(/범위 2개를 11월 17일 \(화\)에 넣었어요/.test(await toastOf(page)) && /범위/.test(await page.textContent(`#pl-list [data-pl-id="${tk1.id}"] .pl-meta`)), '알림과 줄의 범위 표시');
  // 플래너에서 체크 → 범위도 체크, 공부 시간은 한 번만
  await page.tap(`#pl-list [data-pl-id="${tk1.id}"] .pl-check`);
  await page.waitForTimeout(150);
  st = await state(page);
  assert(st.topics.find((n) => n.id === 'k1').done && st.sessions.filter((s) => s.kind === 'done').length === 1 && st.sessions[0].minutes === 30, '플래너에서 끝내면 범위도 체크, 공부 시간 30분은 한 번만');
  assert(/범위도 체크 ♟/.test(await toastOf(page)) && /\+30분/.test(await toastOf(page)), '알림: ' + await toastOf(page));
  await page.tap(`#pl-list [data-pl-id="${tk1.id}"] .pl-check`);
  await page.waitForTimeout(150);
  st = await state(page);
  assert(!st.topics.find((n) => n.id === 'k1').done && !st.sessions.length, '체크를 풀면 범위 체크와 시간도 풀림');
  // 범위에서 체크 → 할 일도 끝남
  await page.evaluate(() => App.go('board'));
  await page.waitForSelector('.list-mode .bitem[data-id="m1"]');
  await page.tap('.bitem[data-id="m1"] > .brow [data-check]');
  await page.waitForTimeout(150);
  st = await state(page);
  assert(st.tasks.find((t) => t.id === tm1.id).done && st.sessions.filter((s) => s.kind === 'done').length === 1 && st.sessions[0].doneOf === 'topic:m1', '범위에서 체크하면 이은 할 일도 끝남 (시간은 범위 쪽 한 번만)');
  await page.tap('.bitem[data-id="m1"] > .brow [data-check]');
  await page.waitForTimeout(150);
  st = await state(page);
  assert(!st.tasks.find((t) => t.id === tm1.id).done && !st.sessions.length, '범위 체크를 풀면 할 일도 다시 안 끝남');

  /* ===== ⑧ 범위 탭 ⋯ › 플래너에 넣기 → 날짜 고르기 ===== */
  await page.tap('.bitem[data-id="m2"] > .brow [data-menu]');
  await page.tap('#pop-menu [data-act="to-task"]');
  await sheetIn(page);
  assert(/이차방정식/.test(await page.textContent('.ui-back.in .ui-sheet-head')), '언제 할지 묻는 창');
  await choose(page, '날짜 고르기…');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-md="2026-11-21"]');
  await page.tap('.ui-back.in [data-pl-mok]');
  await page.waitForTimeout(200);
  const tm2 = (await state(page)).tasks.find((t) => t.topicId === 'm2');
  assert(tm2 && tm2.due === '2026-11-21' && /11월 21일 \(토\)에 넣었어요/.test(await toastOf(page)), '고른 날(11/21)에 넣음');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => App.view) === 'plan' && /11월 21일/.test(await sumTitle(page)) && (await listIds(page)).includes(tm2.id), "알림의 '보기' → 그날 플래너");
  await page.tap('#pl-strip [data-pl-today]');

  /* ===== ⑨ ▶ 공부 시작 → 하는 중 ===== */
  await page.tap('#pl-list [data-pl-id="t1"] .pl-play');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => App.view) === 'timer' && await page.evaluate(() => Stopwatch.running() && Stopwatch.live().taskId === 't1'), '▶ → 스톱워치가 이 할 일로 켜짐');
  await page.clock.fastForward('25:00');
  await page.evaluate(() => App.go('plan'));
  await page.waitForTimeout(150);
  assert(/하는 중 25분/.test(await page.textContent('#pl-list [data-pl-id="t1"] .pl-live')) && !(await page.$('#pl-list [data-pl-id="t1"] .pl-play')), "재는 중인 할 일에는 '하는 중 25분'");
  await page.evaluate(() => Stopwatch.stop());
  await page.waitForTimeout(200);
  assert(/공부 25분/.test(await page.textContent('#pl-list [data-pl-id="t1"] .pl-got')) && (await state(page)).sessions.some((s) => s.taskId === 't1' && s.minutes === 25), '멈추면 잰 시간이 그 줄에');
  await page.tap(`#pl-list [data-pl-id="t1"] .pl-check`);
  await page.waitForTimeout(150);
  assert(!(await state(page)).sessions.some((s) => s.doneOf === 'task:t1'), '잰 할 일을 끝내도 예상 시간을 또 넣지 않음');

  /* ===== ⑩ 날짜 안 정한 할 일 ===== */
  await page.tap('#pl-undated-fold > summary');
  await page.tap('#pl-undated-fold [data-pl-add]');
  assert((await page.$eval('#pl-date', (i) => i.value)) === '' && /날짜 안 정함/.test(await page.textContent('[data-for="pl-date"]')), '날짜 없이 적기: 날짜 칸이 비어 있음');
  await page.fill('#pl-title', '한국사 연표 만들기');
  await page.tap('#pl-save');
  await page.waitForTimeout(150);
  assert(/날짜 안 정한 할 일에 넣었어요/.test(await toastOf(page)) && (await page.textContent('#pl-undated-n')) === '1개', '날짜 안 정한 할 일로');
  const u = (await state(page)).tasks.find((t) => t.title === '한국사 연표 만들기');
  await page.tap(`#pl-undated [data-pl-id="${u.id}"] .pl-place`);
  await page.waitForTimeout(150);
  assert((await task(page, u.id)).due === '2026-11-17' && (await listIds(page)).includes(u.id), "'오늘로' → 오늘 할 일로");

  /* ===== ⑪ 스톱워치의 '과목 만들기' ===== */
  await page.evaluate(() => App.store.update((s) => { s.subjects = []; }));
  await page.evaluate(() => { App.go('timer'); Stopwatch.showTab('sw'); });
  await page.waitForTimeout(150);
  await page.tap('#sw-empty [data-pl-subjects]');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => App.view) === 'plan' && await page.evaluate(() => document.querySelector('#pl-subjects-fold').open && document.activeElement.id === 's-name'), "‘과목 만들기’ → 플래너의 과목 관리가 펼쳐지고 이름 칸에");
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), '폰 화면에서 가로로 넘치지 않음 (하루)');
  await page.tap('[data-pl-mode="week"]');
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), '폰 화면에서 가로로 넘치지 않음 (주간)');
  await ctx.close();

  /* ===== ⑫ 가로 화면: 추가 창이 화면 안에서 스크롤 ===== */
  ({ ctx, page } = await open({ ctx: { viewport: { width: 844, height: 390 } } }));
  await page.evaluate(() => Planner.setMode('day'));
  await page.tap('#pl-todo [data-pl-add]');
  await page.tap('[data-pl-rep="weekly"]');
  const box = await page.$eval('#pl-dlg .ask-box', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, sh: e.scrollHeight, ch: e.clientHeight }; });
  assert(box.top >= 0 && box.bottom <= 390 && box.sh > box.ch, '높이가 낮으면 창 안에서 스크롤 (' + Math.round(box.bottom) + 'px)');
  await page.locator('#pl-save').scrollIntoViewIfNeeded();
  assert(await page.isVisible('#pl-save'), '저장 단추까지 내려갈 수 있음');
  await page.tap('#pl-cancel');
  await page.tap('#pl-strip [data-pl-cal]');
  await sheetIn(page);
  await page.locator('.ui-back.in [data-pl-mok]').scrollIntoViewIfNeeded();
  assert(await page.isVisible('.ui-back.in [data-pl-mok]'), '달력 창도 가로에서 끝까지 보임');
  await ctx.close();

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
