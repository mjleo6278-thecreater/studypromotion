// v3.5.1 테스트: ① 소요 시간을 적은 할 일·범위를 끝내면 그 시간이 공부 기록에 들어가고, 풀면 빠진다
//               ② 범위 목록·보드에서 줄을 꾹 눌러 끌면 순서가 바뀐다 (위로·아래로 버튼도 그대로)
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

// 시험 하나, 과목 카드 셋(국어 항목 6개 + 하위 단계, 수학, 영어), 할 일 셋
// 오늘 날짜 'YYYY-MM-DD' (처음 기록의 할 일은 플래너의 오늘 칸에)
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function seed() {
  const topics = [
    { id: 'c1', examId: 'e1', parentId: null, kind: 'topic', title: '국어', order: 0, x: 0, y: 0, color: '#e05a4f', flags: {} },
    { id: 'c2', examId: 'e1', parentId: null, kind: 'topic', title: '수학', order: 1, x: 340, y: 0, color: '#3d96e0', flags: {} },
    { id: 'c3', examId: 'e1', parentId: null, kind: 'topic', title: '영어', order: 2, x: 680, y: 0, color: '#45a865', flags: {} },
  ];
  ['문학 1강', '문학 2강', '문법 1강', '문법 2강', '비문학 1강', '비문학 2강'].forEach((t, i) => topics.push({ id: 'k' + i, examId: 'e1', parentId: 'c1', kind: 'topic', title: t, order: i, est: 30 + i * 10, flags: {} }));
  topics.push({ id: 'k2a', examId: 'e1', parentId: 'k2', kind: 'topic', title: '음운', order: 0, est: 20, flags: {} });
  topics.push({ id: 'k2b', examId: 'e1', parentId: 'k2', kind: 'topic', title: '형태소', order: 1, flags: {} });
  ['미적분', '확률', '기하'].forEach((t, i) => topics.push({ id: 'm' + i, examId: 'e1', parentId: 'c2', kind: 'topic', title: t, order: i, est: 60, flags: {} }));
  ['단어 1', '단어 2'].forEach((t, i) => topics.push({ id: 'g' + i, examId: 'e1', parentId: 'c3', kind: 'topic', title: t, order: i, flags: {} }));
  return {
    subjects: [{ id: 's1', name: '국어', color: '#e05a4f' }, { id: 's2', name: '수학', color: '#3d96e0' }, { id: 's3', name: '영어', color: '#45a865' }],
    tasks: [
      { id: 't1', title: '수학 문제집 3쪽', subjectId: 's2', due: todayKey(), estimateMin: 45, done: false, createdAt: 1 },
      { id: 't2', title: '단어 외우기', subjectId: 's3', due: todayKey(), estimateMin: null, done: false, createdAt: 2 },
      { id: 't3', title: '국어 오답', subjectId: 's1', due: todayKey(), estimateMin: 30, done: false, createdAt: 3 },
    ],
    exams: [{ id: 'e1', name: '기말고사', date: '2026-12-20', createdAt: 1 }],
    activeExamId: 'e1',
    topics,
  };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];

  async function open(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR' }, opts || {}));
    await ctx.addInitScript((data) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('studypromotion.welcomeClosed', '1');
      localStorage.setItem('studypromotion.v1', JSON.stringify(Object.assign({ cards: [], decks: [], sessions: [], reviewLog: [], strokes: [], boardView: {}, events: [] }, data)));
    }, seed());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return { ctx, page };
  }
  const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const todayMin = (page) => page.evaluate(() => Stats.minutesOn(App.store.get().sessions, Date.now()));
  const toastOf = (page) => page.textContent('#toast');
  const order = async (page, parentId) => (await state(page)).topics.filter((t) => t.parentId === parentId).sort((a, b) => a.order - b.order).map((t) => t.title);
  const rowOf = (page, title) => page.locator(`.bitem > .brow:has(> .btitle:text-is("${title}")) .btitle`);
  const rowH = async (page, title) => (await page.locator(`.bitem > .brow:has(> .btitle:text-is("${title}"))`).boundingBox()).height;

  // 손가락: CDP 터치로 꾹 누른 채 끌기 (holdMs 동안 가만히 → steps번에 나눠 dy만큼)
  async function touchDrag(page, el, dy, holdMs, steps) {
    const cdp = await page.context().newCDPSession(page);
    const b = await el.boundingBox();
    const x = b.x + Math.min(40, b.width / 2), y = b.y + b.height / 2;
    const pt = (yy) => [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y) });
    if (holdMs) await page.waitForTimeout(holdMs);
    const n = steps || 12;
    for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y + (dy * i) / n) }); await page.waitForTimeout(16); }
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    await cdp.detach();
  }

  /* ===== ① 끝내면 공부 시간에 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#plan');
    await page.waitForSelector('#pl-list .pl-item');
    // 진행 칸: 누를 때마다 빈칸 → ○ → △ → 빈칸. want가 될 때까지 누른다
    const chk = async (id, want) => {
      for (let i = 0; i < 3; i++) {
        await page.tap(`#pl-list [data-pl-id="${id}"] .pl-mark`);
        await page.waitForTimeout(60);
        const t = (await state(page)).tasks.find((x) => x.id === id);
        const m = t.done ? 'o' : t.part ? 't' : '';
        if (m === (want === undefined ? 'o' : want)) return;
      }
      throw new Error('진행 칸이 ' + want + '이 안 됨');
    };
    assert(await todayMin(page) === 0, '처음엔 오늘 공부 0분');
    // 예상 시간 45분인 할 일을 끝내면 45분이 들어간다
    await chk('t1');
    await page.waitForTimeout(100);
    let s = await state(page);
    let rec = s.sessions.find((x) => x.doneOf === 'task:t1');
    assert(rec && rec.minutes === 45 && rec.subjectId === 's2' && rec.kind === 'done' && rec.manual === true && rec.label === '수학 문제집 3쪽', '할 일 완료 → 45분 기록(수학, 시각 없음)');
    assert(/공부 시간 \+45분/.test(await toastOf(page)), '알림에 더한 시간: ' + (await toastOf(page)));
    assert(await todayMin(page) === 45, '오늘 공부 45분');
    // 예상 시간이 없는 할 일은 그대로
    await chk('t2');
    await page.waitForTimeout(100);
    assert((await state(page)).sessions.length === 1, '예상 시간이 없는 할 일은 기록 안 함');
    // 끝낸 할 일도 그 자리에 남아 있어서 체크를 바로 풀 수 있다. 풀면 뺀다
    assert(await page.isVisible('#pl-list [data-pl-id="t1"].done'), '끝낸 할 일은 줄을 그은 채 그 자리에');
    await chk('t1', 't');
    await page.waitForTimeout(100);
    assert(!(await state(page)).sessions.some((x) => x.doneOf === 'task:t1'), '△(덜 끝냄)로 바꾸면 기록에서 뺌');
    assert(/45분을 뺐어요/.test(await toastOf(page)), '뺀 알림: ' + (await toastOf(page)));
    // 다시 끝내고 알림의 ‘시간 빼기’ → 완료는 그대로, 시간만 뺌
    await chk('t1');
    await page.waitForTimeout(100);
    assert(await todayMin(page) === 45, '다시 끝내면 다시 45분');
    await page.tap('#toast .toast-act');
    await page.waitForTimeout(100);
    s = await state(page);
    assert(s.tasks.find((t) => t.id === 't1').done && !s.sessions.length, '‘시간 빼기’: 완료는 그대로 두고 시간만 뺌');
    // 끝낸 할 일의 예상 시간을 고치면 오늘 넣은 기록도 맞춘다
    await chk('t3');
    await page.waitForTimeout(100);
    await page.tap('#pl-list [data-pl-id="t3"] .pl-title');
    await page.tap('.ui-back.in [data-pl-mi="edit"]');
    await page.selectOption('#pl-est', 'custom');
    await page.fill('#pl-est-custom', '50');
    await page.tap('#pl-save');
    await page.waitForTimeout(100);
    assert((await state(page)).sessions.find((x) => x.doneOf === 'task:t3').minutes === 50, '끝낸 할 일 예상 시간 30→50분이면 기록도 50분');

    // 스톱워치로 잰 할 일은 또 넣지 않는다
    await page.evaluate(() => App.store.update((st) => {
      st.tasks.push({ id: 't4', title: '영어 독해', subjectId: 's3', due: Stats.dayKey(Date.now()), estimateMin: 40, done: false, createdAt: 4 });
      st.sessions.push({ id: 'sw-1', subjectId: 's3', minutes: 25, sec: 1500, endedAt: Date.now() - 60000, label: '영어 독해', topicId: null, taskId: 't4', kind: 'stopwatch' });
    }));
    await page.waitForTimeout(50);
    assert(/공부 25분/.test(await page.textContent('#pl-list [data-pl-id="t4"]')), '잰 시간이 그 할 일 줄에 쌓여 보임');
    await chk('t4');
    await page.waitForTimeout(100);
    assert(!(await state(page)).sessions.some((x) => x.doneOf === 'task:t4'), '스톱워치로 잰 할 일은 예상 시간을 또 넣지 않음');
    assert(/^잘했어요! 할 일 하나 완료/.test(await toastOf(page)), '그때는 예전 알림 그대로');

    // 범위 목록: 항목 체크 → 소요시간만큼
    await page.evaluate(() => App.store.update((st) => { st.sessions = []; }));
    await page.goto(base + '#board');
    await page.waitForSelector('.list-mode .bitem');
    await page.tap('.bitem[data-id="k0"] > .brow [data-check]');
    await page.waitForTimeout(100);
    rec = (await state(page)).sessions.find((x) => x.doneOf === 'topic:k0');
    assert(rec && rec.minutes === 30 && rec.subjectId === 's1' && rec.label === '국어 · 문학 1강' && rec.topicId === 'k0', '범위 항목 체크 → 30분(국어 · 문학 1강)');
    assert(/공부 시간에 30분을 넣었어요/.test(await toastOf(page)), '범위 알림: ' + (await toastOf(page)));
    // 하위 단계가 있는 항목을 체크하면 소요시간을 적은 잎만 (음운 20분, 형태소는 시간 없음)
    await page.tap('.bitem[data-id="k2"] > .brow [data-check]');
    await page.waitForTimeout(100);
    assert(await todayMin(page) === 50, '상위 항목 체크 → 아래 잎의 소요시간(20분)만 더해 50분');
    // 체크를 풀면 뺀다
    await page.tap('.bitem[data-id="k0"] > .brow [data-check]');
    await page.waitForTimeout(100);
    assert(await todayMin(page) === 20, '체크를 풀면 30분을 뺌');
    // 되돌리기(범위 되돌리기)를 누르면 기록도 함께
    await page.tap('[data-list-act="undo"]');
    await page.waitForTimeout(100);
    assert(await todayMin(page) === 50 && (await state(page)).topics.find((t) => t.id === 'k0').done, '되돌리기로 체크가 돌아오면 30분도 다시');
    await page.tap('[data-list-act="undo"]');
    await page.waitForTimeout(100);
    assert(await todayMin(page) === 30 && !(await state(page)).topics.find((t) => t.id === 'k2a').done, '한 번 더 되돌리면 상위 항목 체크와 20분이 빠짐');
    assert(/20분을 뺐어요/.test(await toastOf(page)), '되돌리기 알림: ' + (await toastOf(page)));
    // 소요시간·진행률 창에서 100%로 → 기록, 소요시간 바꾸면 기록도
    await page.tap('.bitem[data-id="k1"] > .brow [data-time]');
    await page.tap('#time-pct-quick [data-pct="100"]');
    await page.tap('#time-form button[type="submit"]');
    await page.waitForTimeout(100);
    assert((await state(page)).sessions.find((x) => x.doneOf === 'topic:k1').minutes === 40, '진행률 100% → 40분');
    await page.tap('.bitem[data-id="k1"] > .brow [data-time]');
    await page.fill('#time-h', '1');
    await page.fill('#time-m', '5');
    await page.tap('#time-form button[type="submit"]');
    await page.waitForTimeout(100);
    assert((await state(page)).sessions.find((x) => x.doneOf === 'topic:k1').minutes === 65, '끝낸 항목의 소요시간을 1시간 5분으로 고치면 기록도 65분');
    await page.tap('.bitem[data-id="k1"] > .brow [data-time]');
    await page.tap('#time-pct-quick [data-pct="50"]');
    await page.tap('#time-form button[type="submit"]');
    await page.waitForTimeout(100);
    assert(!(await state(page)).sessions.some((x) => x.doneOf === 'topic:k1'), '진행률을 50%로 내리면 기록에서 뺌');

    // 통계 기록 목록에 ‘완료’ 표시
    await page.goto(base + '#stats');
    await page.waitForTimeout(200);
    const tags = await page.$$eval('.sl-tag', (els) => els.map((e) => e.textContent));
    assert(tags.includes('완료'), '최근 기록에 ‘완료’ 꼬리표: ' + tags.join(','));
    // 홈 ‘오늘 공부’에 들어감
    await page.goto(base + '#home');
    await page.waitForTimeout(200);
    const homeToday = await page.textContent('#view-home');
    assert(/30분/.test(homeToday), '홈 오늘 공부에 반영');
    await ctx.close();
  }

  /* ===== ② 꾹 눌러 끌어서 순서 바꾸기 (휴대폰 목록) ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#board');
    await page.waitForSelector('.list-mode .bitem');
    // 꾹 누르고 아래로 두 칸 (문학 1강 → 문법 1강 뒤)
    const h = await rowH(page, '문학 1강');
    await touchDrag(page, rowOf(page, '문학 1강'), h * 3, 550); // 문법 1강은 아래 단계 2개를 품은 세 줄짜리라 가운데를 넘도록
    assert((await order(page, 'c1')).join(',') === '문학 2강,문법 1강,문학 1강,문법 2강,비문학 1강,비문학 2강', '꾹 눌러 아래로 두 칸: ' + (await order(page, 'c1')).join(','));
    assert(!(await page.$('.drag-lift')) && !(await page.$('.bitem[style*="transform"]')), '놓으면 들린 모양·밀린 줄 원래대로');
    // 꾹 누르지 않고 바로 밀면 그냥 스크롤 (순서 그대로)
    const before = (await order(page, 'c1')).join(',');
    await touchDrag(page, rowOf(page, '문학 2강'), 120, 0);
    assert((await order(page, 'c1')).join(',') === before, '바로 밀면 스크롤일 뿐 순서는 그대로');
    // 위로 (하위 단계가 있는 항목은 아래 단계와 함께)
    await page.evaluate(() => { document.querySelector('.board-viewport').scrollTop = 0; });
    const fb = await rowOf(page, '문법 1강').boundingBox();
    const top = await rowOf(page, '문학 2강').boundingBox();
    await touchDrag(page, rowOf(page, '문법 1강'), top.y - fb.y - 4, 550);
    assert((await order(page, 'c1')).join(',') === '문법 1강,문학 2강,문학 1강,문법 2강,비문학 1강,비문학 2강', '하위 단계가 있는 항목을 맨 위로: ' + (await order(page, 'c1')).join(','));
    assert((await order(page, 'k2')).join(',') === '음운,형태소' && (await page.$$eval('.bitem[data-id="k2"] .bitem', (els) => els.length)) === 2, '아래 단계는 그대로 따라감');
    // 하위 단계 안에서도
    await touchDrag(page, rowOf(page, '형태소'), -(await rowH(page, '형태소')), 550);
    assert((await order(page, 'k2')).join(',') === '형태소,음운', '하위 단계 안에서 순서 바꾸기');
    // 다른 과목으로는 안 넘어감 (끝까지 끌어도 그 과목 맨 끝)
    await touchDrag(page, rowOf(page, '비문학 1강'), 600, 550, 20);
    const s = await state(page);
    assert(s.topics.find((t) => t.id === 'k4').parentId === 'c1' && (await order(page, 'c1')).slice(-1)[0] === '비문학 1강', '다른 과목으로 넘어가지 않고 그 과목 맨 끝으로');
    // 과목 이름 줄을 꾹 눌러 과목 순서도
    const head = page.locator('.bcard[data-id="c3"] .bcard-title');
    await head.scrollIntoViewIfNeeded();
    const c1b = await page.locator('.bcard[data-id="c1"]').boundingBox();
    const c3b = await head.boundingBox();
    await touchDrag(page, head, c1b.y - c3b.y - 10, 550, 24);
    assert((await order(page, null)).join(',') === '영어,국어,수학', '과목 이름 줄을 꾹 눌러 맨 위로: ' + (await order(page, null)).join(','));
    // 되돌리기 한 번이면 그 전 순서로
    await page.evaluate(() => { document.querySelector('.board-viewport').scrollTop = 0; });
    await page.tap('[data-list-act="undo"]');
    await page.waitForTimeout(100);
    assert((await order(page, null)).join(',') === '국어,수학,영어', '되돌리기로 과목 순서 원래대로');
    // 기존 ⋯ › 옮기기 › 위로·아래로도 그대로
    await page.tap('.bitem[data-id="m2"] > .brow [data-menu]');
    await page.tap('#pop-menu [data-act="page:move"]');
    assert(/꾹 눌러/.test(await page.textContent('#pop-menu .pm-tip')), '옮기기 메뉴에 꾹 눌러 끌기 안내');
    await page.tap('#pop-menu [data-act="up"]');
    await page.tap('#pop-menu [data-act="up"]');
    await page.waitForTimeout(100);
    assert((await order(page, 'c2')).join(',') === '기하,미적분,확률', '위로 버튼 두 번도 그대로 동작');
    await page.keyboard.press('Escape');
    // 꾹 누르기만 하고 그 자리에 놓으면 아무 일 없음 (체크·메뉴가 눌리지 않음)
    const before2 = JSON.stringify((await state(page)).topics);
    await touchDrag(page, rowOf(page, '확률'), 0, 600, 1);
    assert(JSON.stringify((await state(page)).topics) === before2 && (await page.isHidden('#pop-menu')), '그 자리에 놓으면 그대로');
    // 그냥 누르면(짧게) 예전처럼 체크·메뉴가 됨
    await page.tap('.bitem[data-id="g0"] > .brow [data-check]');
    await page.waitForTimeout(100);
    assert((await state(page)).topics.find((t) => t.id === 'g0').done, '짧게 누르면 체크는 그대로');
    await ctx.close();
  }

  /* ===== ③ 컴퓨터: 마우스로 꾹 눌러 끌기 (목록), 보드 카드 안 항목 ===== */
  {
    const { ctx, page } = await open({ viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false });
    await page.goto(base + '#board');
    await page.waitForSelector('.bitem');
    if ((await page.evaluate(() => Board.mode)) !== 'list') { await page.evaluate(() => Board.setMode('list')); await page.waitForTimeout(300); }
    await page.evaluate(() => document.querySelector('.bitem[data-id="m1"]').scrollIntoView({ block: 'center' })); // 화면 끝이면 저절로 스크롤되므로 가운데에서
    const a = await rowOf(page, '미적분').boundingBox();
    await page.mouse.move(a.x + 30, a.y + a.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    const ah = await rowH(page, '미적분');
    for (let i = 1; i <= 10; i++) { await page.mouse.move(a.x + 30, a.y + a.height / 2 + (ah * 1.3 * i) / 10); await page.waitForTimeout(16); }
    assert(await page.$('.bitem.drag-lift'), '마우스로 꾹 누르면 줄이 들림');
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert((await order(page, 'c2')).join(',') === '확률,미적분,기하', '마우스로 한 칸 아래로: ' + (await order(page, 'c2')).join(','));
    // Esc를 누르면 취소
    await page.evaluate(() => document.querySelector('.bitem[data-id="g0"]').scrollIntoView({ block: 'center' }));
    const b = await rowOf(page, '단어 1').boundingBox();
    await page.mouse.move(b.x + 30, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.move(b.x + 30, b.y + b.height * 2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert((await order(page, 'c3')).join(',') === '단어 1,단어 2' && (await page.evaluate(() => Board.mode)) === 'list', 'Esc로 끌기 취소 (목록 그대로)');

    // 보드: 카드 안 항목을 꾹 눌러 옮기기
    await page.evaluate(() => Board.setMode('board'));
    await page.waitForTimeout(500);
    const r = await rowOf(page, '단어 2').boundingBox();
    const r0 = await rowOf(page, '단어 1').boundingBox();
    const view0 = await page.evaluate(() => Board.view);
    await page.mouse.move(r.x + 20, r.y + r.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    for (let i = 1; i <= 8; i++) { await page.mouse.move(r.x + 20, r.y + r.height / 2 + ((r0.y - r.y - 4) * i) / 8); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(200);
    const view1 = await page.evaluate(() => Board.view);
    assert((await order(page, 'c3')).join(',') === '단어 2,단어 1', '보드 카드 안 항목을 꾹 눌러 위로: ' + (await order(page, 'c3')).join(','));
    assert(view0.x === view1.x && view0.y === view1.y, '그동안 보드 화면은 안 움직임');
    // 누르자마자 끌면 예전처럼 보드 화면 이동
    const q = await rowOf(page, '단어 1').boundingBox();
    await page.mouse.move(q.x + 20, q.y + q.height / 2);
    await page.mouse.down();
    await page.mouse.move(q.x + 120, q.y + q.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const view2 = await page.evaluate(() => Board.view);
    assert(view2.x !== view1.x && (await order(page, 'c3')).join(',') === '단어 2,단어 1', '바로 끌면 화면 이동 (순서 그대로)');
    await ctx.close();
  }

  /* ===== ④ 휴대폰 보드: 손가락으로 꾹 눌러 카드 안 항목 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#board');
    await page.waitForSelector('.list-mode .bitem');
    await page.evaluate(() => Board.setMode('board'));
    await page.waitForTimeout(600);
    await page.evaluate(() => { Board.zoomAt(1, 0, 0); });
    await page.waitForTimeout(100);
    const el = rowOf(page, '문학 1강'); // 화면 왼쪽 첫 카드
    const box = await el.boundingBox();
    assert(box && box.y > 80 && box.x + 40 < 390, '보드 첫 카드 항목이 화면 안에');
    await touchDrag(page, el, (await rowH(page, '문학 1강')) * 1.4, 550);
    assert((await order(page, 'c1')).slice(0, 2).join(',') === '문학 2강,문학 1강', '휴대폰 보드에서 꾹 눌러 한 칸 아래로: ' + (await order(page, 'c1')).join(','));
    assert(!(await page.$('.drag-lift')), '놓으면 원래 모양');
    // App.setTaskDone: 다른 화면(플래너 등)에서도 같은 규칙으로
    let r = await page.evaluate(() => App.setTaskDone('t1', true, { quiet: true }));
    assert(r.added === 45 && (await todayMin(page)) === 45, 'App.setTaskDone(끝냄) → 45분');
    r = await page.evaluate(() => App.setTaskDone('t1', true));
    assert(r.added === 0 && (await todayMin(page)) === 45, '이미 끝낸 할 일에 또 불러도 한 번만');
    r = await page.evaluate(() => App.setTaskDone('t1', false));
    assert(r.removed === 45 && (await todayMin(page)) === 0, 'App.setTaskDone(풀기) → 45분 뺌');
    await ctx.close();
  }

  assert(!errors.length, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
