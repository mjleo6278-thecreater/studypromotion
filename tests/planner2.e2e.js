// v3.10 테스트: 플래너 2차 (종이 플래너처럼)
//  ① 진행 칸 빈칸 → ○ → △ → 빈칸 (○은 공부 시간, △는 빼기)  ② 장소·시간 칸과 정렬  ③ 추가 창 장소 칩
//  ④ 복습 줄: 선생님 넣기·요일·날짜별 체크·홈·고치기·지우기  ⑤ 어제 못 끝낸 일 옮기기 창 (하루 한 번, 골라서, 되돌리기)
//  ⑥ 장소·시간 목록: 넣기·순서(키보드)·지우기  ⑦ 주간 보기  ⑧ 기능 끄기  ⑨ 좁은 화면
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

// 오늘 = 2026-11-19(목) 07:50, 한국 시각. 어제 = 11/18(수)
const NOW = new Date('2026-11-19T07:50:00+09:00').getTime();
const TODAY = '2026-11-19', YDAY = '2026-11-18';
function seed() {
  return {
    subjects: [{ id: 's1', name: '국어', color: '#e05a4f' }, { id: 's2', name: '수학', color: '#3d96e0' }, { id: 's3', name: '영어', color: '#45a865' }],
    tasks: [
      { id: 'y1', title: 'rewind Day 1', subjectId: 's2', due: YDAY, estimateMin: 60, done: false, part: true, slotId: 'slot2', createdAt: 1 },
      { id: 'y2', title: '영동T 단어', subjectId: 's3', due: YDAY, estimateMin: 30, done: false, createdAt: 2 },
      { id: 'y3', title: '문학 정리', subjectId: 's1', due: YDAY, estimateMin: 30, done: true, doneAt: NOW - 36e6, createdAt: 3 },
      { id: 'd0', title: '영동T 단어', subjectId: 's3', due: TODAY, estimateMin: 30, done: false, createdAt: 4 },
      { id: 'd1', title: '기사문 2회독', subjectId: 's3', due: TODAY, estimateMin: 30, done: false, createdAt: 5 },
      { id: 'd2', title: '수학 익힘책', subjectId: 's2', due: TODAY, estimateMin: 40, done: false, createdAt: 6 },
      { id: 'd3', title: '비문학 3지문', subjectId: 's1', due: TODAY, estimateMin: 20, done: false, createdAt: 7 },
    ],
    sessions: [{ id: 'w1', kind: 'focus', subjectId: 's2', minutes: 35, endedAt: NOW - 39e6, taskId: 'y1', label: 'rewind Day 1' }],
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
      localStorage.setItem('studypromotion.v1', JSON.stringify(Object.assign({ cards: [], sessions: [], reviewLog: [], strokes: [], boardView: {}, events: [], decks: [], topics: [], exams: [] }, data)));
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
  const sheetGone = (page) => page.waitForFunction(() => !document.querySelector('.ui-back.in'));
  const listIds = (page, sel) => page.$$eval((sel || '#pl-list') + ' > .pl-item', (els) => els.map((e) => e.dataset.plId));
  const sortText = (page) => page.textContent('#pl-todo .pl-sort');
  const row = (id, sel) => `${sel || '#pl-list'} [data-pl-id="${id}"]`;
  const setSelect = (page, sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  const minutesToday = (page) => page.evaluate(() => Stats.minutesOn(App.store.get().sessions, Date.now()));

  const { ctx, page } = await open();
  let st;

  /* ===== ① 진행 칸 ===== */
  assert((await page.$$('#pl-list .pl-item .pl-check, #pl-list .pl-item .pl-more')).length === 0, '체크 상자·⋯ 단추 대신 진행 칸');
  assert((await page.$$('#pl-list .pl-item .pl-mark')).length === 4 && (await page.$$('#pl-list .pl-item .pl-mark.o, #pl-list .pl-item .pl-mark.t')).length === 0, '오늘 할 일 4개 모두 빈칸');
  await page.tap(row('d2') + ' .pl-mark');
  await page.waitForTimeout(150);
  st = await state(page);
  assert(st.tasks.find((t) => t.id === 'd2').done && st.sessions.some((s) => s.doneOf === 'task:d2' && s.minutes === 40) && await page.isVisible(row('d2') + '.done .pl-mark.o'), '한 번 누르면 ○: 끝냄, 예상 40분이 공부 시간에');
  assert(/\+40분/.test(await toastOf(page)) && (await minutesToday(page)) === 40, '알림과 오늘 공부 40분');
  assert(await page.$eval(row('d2') + ' .pl-mark', (b) => b.classList.contains('pop') && getComputedStyle(b.querySelector('.pl-mk')).animationName === 'pl-pop') && (await page.$$('#pl-list .pl-mark.pop')).length === 1, '방금 누른 칸만 톡 튀어나오는 움직임');
  await page.clock.runFor(1200);
  await page.evaluate(() => Planner.render());
  assert(!(await page.$('#pl-list .pl-mark.pop')), '조금 지나 다시 그리면 움직임 없이 그대로');
  await page.tap(row('d2') + ' .pl-mark');
  await page.waitForTimeout(150);
  st = await state(page);
  const d2 = st.tasks.find((t) => t.id === 'd2');
  assert(!d2.done && d2.part && !st.sessions.some((s) => s.doneOf === 'task:d2') && await page.isVisible(row('d2') + '.part .pl-mark.t'), '한 번 더 누르면 △: 안 끝난 일로, 넣은 시간은 뺌');
  assert(/세모\(덜 끝냄\)로 바꾸고 공부 시간에서 40분을 뺐어요/.test(await toastOf(page)), '△ 알림: ' + await toastOf(page));
  assert(/△ 1/.test(await page.textContent('#pl-sum')) && /덜 끝냄/.test(await page.$eval(row('d2') + ' .pl-title', (e) => getComputedStyle(e, '::after').content)), '요약에 △ 수, 줄에 덜 끝냄');
  await page.tap(row('d2') + ' .pl-mark');
  await page.waitForTimeout(150);
  assert(!(await task(page, 'd2')).part && !(await task(page, 'd2')).done && !(await page.$(row('d2') + ' .pl-mark.t')), '또 누르면 빈칸');
  await page.tap(row('d3') + ' .pl-mark');
  await page.tap(row('d3') + ' .pl-mark');
  await page.waitForTimeout(150);
  assert((await task(page, 'd3')).part && (await minutesToday(page)) === 0, '빈칸에서 두 번 → △ (공부 시간 없음)');
  await page.tap(row('d3') + ' .pl-title');
  await sheetIn(page);
  assert(await page.isVisible('.ui-back.in [data-pl-mi="edit"]'), '이름을 누르면 지금처럼 메뉴');
  await page.keyboard.press('Escape');
  await sheetGone(page);

  /* ===== ② 장소·시간 칸과 정렬 ===== */
  assert(/과목 순/.test(await sortText(page)) && (await listIds(page)).join() === 'd3,d2,d0,d1', '처음엔 과목 순 (국어 → 수학 → 영어): ' + (await listIds(page)).join());
  assert(/장소/.test(await page.textContent(row('d1') + ' .pl-slot.empty')), '왼쪽 칸은 비어 있으면 ‘장소’');
  await page.tap(row('d1') + ' .pl-slot');
  await sheetIn(page);
  assert(/언제·어디서 할까요/.test(await page.textContent('.ui-back.in .ui-sheet-head')), '장소·시간 고르는 창');
  const opts = await page.$$eval('.ui-back.in [data-pl-sp]', (els) => els.map((e) => e.textContent.trim()));
  assert(opts.join() === '야자1,야자2,독서실,집,정하지 않음', '기본 목록과 정하지 않음: ' + opts.join());
  await page.tap('.ui-back.in [data-pl-sp="slot1"]');
  await sheetGone(page);
  await page.waitForTimeout(100);
  st = await state(page);
  assert(st.tasks.find((t) => t.id === 'd1').slotId === 'slot1' && Array.isArray(st.slots) && st.slots.length === 4, '고른 장소가 할 일에, 목록도 기록에 남음');
  assert((await page.textContent(row('d1') + ' .pl-slot')).trim() === '야자1' && /장소·시간 순/.test(await sortText(page)), "왼쪽 칸에 '야자1', 머리는 '장소·시간 순'");
  assert((await listIds(page)).join() === 'd1,d3,d2,d0', '장소 정한 일이 먼저, 나머지는 과목 순: ' + (await listIds(page)).join());
  await page.tap(row('d2') + ' .pl-slot');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-sp="slot4"]');
  await sheetGone(page);
  await page.tap(row('d0') + ' .pl-slot');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-sp="slot3"]');
  await sheetGone(page);
  await page.waitForTimeout(100);
  assert((await listIds(page)).join() === 'd1,d0,d2,d3', '목록 순서대로 (야자1 → 독서실 → 집 → 안 정함): ' + (await listIds(page)).join());
  // 정하지 않음으로 다시 비우기
  await page.tap(row('d2') + ' .pl-slot');
  await sheetIn(page);
  assert(await page.isVisible('.ui-back.in [data-pl-sp="slot4"].on'), '지금 고른 것이 표시됨');
  await page.tap('.ui-back.in [data-pl-sp=""]');
  await sheetGone(page);
  await page.waitForTimeout(100);
  assert(!('slotId' in (await task(page, 'd2'))) && await page.isVisible(row('d2') + ' .pl-slot.empty'), "'정하지 않음'으로 다시 비움");
  for (const id of ['d1', 'd0']) {
    await page.tap(row(id) + ' .pl-slot');
    await sheetIn(page);
    await page.tap('.ui-back.in [data-pl-sp=""]');
    await sheetGone(page);
  }
  await page.waitForTimeout(100);
  assert(/과목 순/.test(await sortText(page)) && (await listIds(page)).join() === 'd3,d2,d0,d1', '모두 비우면 다시 과목 순');

  /* ===== ③ 할 일 추가 창의 장소 칩 ===== */
  await page.tap('#pl-todo [data-pl-add]');
  await page.waitForSelector('#pl-dlg:not([hidden])');
  const chips = await page.$$eval('#pl-slot-chips [data-pl-slotc]', (els) => els.map((e) => e.textContent.trim() + (e.classList.contains('active') ? '*' : '')));
  assert(chips.join() === '야자1,야자2,독서실,집,정하지 않음*' && await page.isVisible('#pl-slot-f'), '추가 창에 장소 칩 (처음엔 정하지 않음): ' + chips.join());
  await page.fill('#pl-title', '국제경제 교과서');
  await page.tap('#pl-subj .chip:has-text("영어")');
  await page.tap('#pl-slot-chips [data-pl-slotc="slot3"]');
  assert(await page.isVisible('#pl-slot-chips [data-pl-slotc="slot3"].active'), '칩을 누르면 골라짐');
  await page.tap('#pl-save');
  await page.waitForTimeout(150);
  const nt = (await state(page)).tasks.find((t) => t.title === '국제경제 교과서');
  assert(nt && nt.slotId === 'slot3' && nt.due === TODAY, '추가 창에서 고른 장소로 저장');
  assert((await listIds(page))[0] === nt.id && /장소·시간 순/.test(await sortText(page)), '장소 정한 새 일이 맨 위');
  await page.tap(row(nt.id) + ' .pl-title');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-mi="edit"]');
  await page.waitForSelector('#pl-dlg:not([hidden])');
  assert(await page.isVisible('#pl-slot-chips [data-pl-slotc="slot3"].active'), '고치기 창에도 그 장소가 골라져 있음');
  await page.tap('#pl-slot-chips [data-pl-slotc="slot4"]');
  await page.tap('#pl-save');
  await page.waitForTimeout(150);
  assert((await task(page, nt.id)).slotId === 'slot4', '고치기 창에서 장소 바꾸기');

  /* ===== ④ 복습 줄 ===== */
  assert(await page.isVisible('#pl-todo .pl-rv.empty [data-pl-rv-setup]'), '선생님이 없으면 넣는 길만');
  await page.tap('#pl-todo [data-pl-rv-setup]');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.querySelector('#pl-teachers-fold').open && document.activeElement && document.activeElement.id === 'pl-tch-name'), "누르면 맨 아래 '복습 선생님'이 펼쳐지고 이름 칸에 초점");
  const days = () => page.$$eval('#pl-tch-days [data-pl-twd]', (els) => els.map((e) => e.textContent.trim() + (e.classList.contains('on') ? '*' : '')).join(' '));
  assert(await days() === '월* 화* 수* 목* 금* 토 일', '수업 요일은 처음에 월~금: ' + await days());
  await page.fill('#pl-tch-name', '수탁');
  await setSelect(page, '#pl-tch-subj', 's2');
  await page.tap('#pl-tch-days [data-pl-twd="3"]'); // 수요일 빼기
  await page.tap('#pl-tch-form button[type=submit]');
  await page.waitForTimeout(150);
  st = await state(page);
  const suTak = st.teachers.find((t) => t.name === '수탁');
  assert(suTak && suTak.subjectId === 's2' && suTak.days.slice().sort().join() === '1,2,4,5', '선생님 넣기: 이름·과목·요일 (월화목금)');
  assert(/'수탁' 선생님을 넣었어요/.test(await toastOf(page)) && (await page.inputValue('#pl-tch-name')) === '', '넣은 알림, 이름 칸 비움');
  await page.fill('#pl-tch-name', '서김');
  await setSelect(page, '#pl-tch-subj', '');
  await page.tap('#pl-tch-days [data-pl-twd="3"]');
  await page.press('#pl-tch-name', 'Enter');
  await page.waitForTimeout(150);
  await page.fill('#pl-tch-name', '토요T');
  for (const d of [1, 2, 3, 4, 5, 6]) await page.tap(`#pl-tch-days [data-pl-twd="${d}"]`);
  await page.tap('#pl-tch-form button[type=submit]');
  await page.waitForTimeout(150);
  st = await state(page);
  const seoKim = st.teachers.find((t) => t.name === '서김'), sat = st.teachers.find((t) => t.name === '토요T');
  assert(st.teachers.length === 3 && seoKim && !seoKim.subjectId && seoKim.days.length === 5 && sat.days.join() === '6', '과목 없이도, 토요일만도');
  assert(/3명/.test(await page.textContent('#pl-tch-n')) && (await page.$$('#pl-tch > li')).length === 3, '선생님 목록 3명');
  const rv = () => page.$$eval('#pl-todo .pl-rv-name', (els) => els.map((e) => e.textContent.trim() + (e.classList.contains('on') ? '*' : '')).join(','));
  assert(await rv() === '수탁,서김', '목요일 복습 줄에는 수업 있는 선생님만: ' + await rv());
  assert(await page.$eval('#pl-todo .pl-rv-name[data-pl-rv="' + suTak.id + '"]', (e) => getComputedStyle(e).getPropertyValue('--c').trim()) === '#3d96e0', '과목을 고른 선생님은 그 과목 색');
  await page.tap(`#pl-todo [data-pl-rv="${suTak.id}"]`);
  await page.waitForTimeout(100);
  st = await state(page);
  assert(st.planner[TODAY].rv.join() === suTak.id && await rv() === '수탁*,서김' && /1\/2/.test(await page.textContent('#pl-todo .pl-rv-h')), '이름을 누르면 체크 (그날 기록에), 1/2');
  await page.tap(`#pl-todo [data-pl-rv="${suTak.id}"]`);
  await page.waitForTimeout(100);
  assert(!((await state(page)).planner || {})[TODAY] && await rv() === '수탁,서김', '다시 누르면 풀림 (빈 기록은 남기지 않음)');
  await page.tap(`#pl-todo [data-pl-rv="${suTak.id}"]`);
  await page.waitForTimeout(100);
  // 홈에도 같은 줄
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(150);
  const homeRv = await page.$$eval('#h-pl-top .pl-rv-name', (els) => els.map((e) => e.textContent.trim() + (e.classList.contains('on') ? '*' : '')).join(','));
  assert(homeRv === '수탁*,서김', '홈의 오늘 할 일 위에도 복습 줄: ' + homeRv);
  await page.tap(`#h-pl-top [data-pl-rv="${seoKim.id}"]`);
  await page.waitForTimeout(100);
  assert((await state(page)).planner[TODAY].rv.length === 2, '홈에서 눌러도 체크');
  await page.evaluate(() => App.go('plan'));
  await page.waitForTimeout(150);
  // 날짜마다 따로: 토요일에는 토요T만, 체크 없음
  await page.tap('#pl-strip [data-pl-day="2026-11-21"]');
  await page.waitForTimeout(150);
  assert(await rv() === '토요T', '토요일에는 토요T만 (체크는 날짜마다 따로)');
  await page.tap('#pl-strip [data-pl-today]');
  await page.waitForTimeout(150);
  assert(await rv() === '수탁*,서김*', '오늘로 돌아오면 오늘 체크 그대로');
  // 고치기: 이름·과목·요일
  await page.tap(`#pl-tch .pl-tch-name[data-pl-tch="${seoKim.id}"]`);
  await sheetIn(page);
  assert((await page.inputValue('#pl-te-name')) === '서김' && await page.isVisible('.ui-back.in [data-pl-ts=""].active'), '고치기 창: 이름과 과목 없음');
  await page.fill('#pl-te-name', '서김T');
  await page.tap('.ui-back.in [data-pl-ts="s3"]');
  await page.tap('.ui-back.in [data-pl-tewd="4"]'); // 목요일 빼기
  await page.tap('.ui-back.in [data-pl-te-ok]');
  await sheetGone(page);
  await page.waitForTimeout(100);
  st = await state(page);
  const sk = st.teachers.find((t) => t.id === seoKim.id);
  assert(sk.name === '서김T' && sk.subjectId === 's3' && !sk.days.includes(4), '이름·과목·요일 고침');
  assert(await rv() === '수탁*,서김T*', '오늘 이미 체크한 선생님은 요일을 빼도 오늘 줄에 남음');
  // 지우기 (확인)
  await page.tap(`#pl-tch .pl-tch-name[data-pl-tch="${sat.id}"]`);
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-te-del]');
  await page.waitForSelector('#ask:not([hidden])');
  assert(/'토요T' 선생님을 지울까요/.test(await page.textContent('#ask-msg')), '지우기 전에 묻기');
  await page.tap('#ask-ok');
  await page.waitForTimeout(150);
  assert((await state(page)).teachers.length === 2 && /2명/.test(await page.textContent('#pl-tch-n')), '선생님 지움');
  // 순서 바꾸기 (키보드)
  await page.focus(`#pl-tch > li[data-id="${seoKim.id}"] [data-pl-grip]`);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  assert((await state(page)).teachers.map((t) => t.name).join() === '서김T,수탁' && await rv() === '서김T*,수탁*', '손잡이 + 위 화살표로 순서, 복습 줄도 그 순서');
  assert(await page.evaluate((id) => document.activeElement && document.activeElement.closest(`li[data-id="${id}"]`) !== null, seoKim.id), '옮긴 뒤에도 손잡이에 초점');

  /* ===== ⑤ 어제 못 끝낸 일 옮기기 창 ===== */
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  assert(await page.isVisible('#pl-todo .pl-carry') && !(await page.$('.ui-back.in')), '화면 시험에서는 저절로 묻지 않음 (띠만)');
  await page.evaluate(() => { window.__plCarryTest = true; Planner.maybeAsk(); });
  await sheetIn(page);
  assert(/어제 못 끝낸 할 일 2개/.test(await page.textContent('.ui-back.in .ui-sheet-head')), '그날 처음 열면 묻는 창: 어제 못 끝낸 일 2개');
  const cy = await page.$$eval('.ui-back.in [data-pl-cy]', (els) => els.map((e) => e.dataset.plCy + (e.classList.contains('on') ? '*' : '')).join(','));
  assert(cy === 'y1*,y2', '오늘도 같은 일(영동T 단어)이 있으면 처음부터 체크를 꺼 둠: ' + cy);
  assert(/한 줄로 합쳐져요/.test(await page.textContent('.ui-back.in [data-pl-cy="y2"] .pl-cy-twin')) && !(await page.$('.ui-back.in [data-pl-cy="y1"] .pl-cy-twin')), '4.2.1: 오늘에도 있는 일엔 옮기면 한 줄로 합쳐진다고 알림');
  const y1Text = await page.textContent('.ui-back.in [data-pl-cy="y1"]');
  assert(/수학/.test(y1Text) && /야자2/.test(y1Text) && /공부 35분/.test(y1Text) && await page.isVisible('.ui-back.in [data-pl-cy="y1"] .pl-cy-mark.t'), '△ 표시·장소·잰 시간도 보여 줌: ' + y1Text);
  assert(/1개 오늘로 옮기기/.test(await page.textContent('.ui-back.in [data-pl-cy-ok]')), '단추에 옮길 수');
  await page.tap('.ui-back.in [data-pl-cy="y2"]');
  assert(/2개 오늘로 옮기기/.test(await page.textContent('.ui-back.in [data-pl-cy-ok]')), '체크를 켜면 수가 늘어남');
  await page.tap('.ui-back.in [data-pl-cy="y2"]');
  await page.tap('.ui-back.in [data-pl-cy="y1"]');
  assert(await page.isDisabled('.ui-back.in [data-pl-cy-ok]') && /골라 주세요/.test(await page.textContent('.ui-back.in [data-pl-cy-ok]')), '하나도 안 고르면 단추가 꺼짐');
  await page.tap('.ui-back.in [data-pl-cy="y1"]');
  await page.tap('.ui-back.in [data-pl-cy-ok]');
  await sheetGone(page);
  await page.waitForTimeout(150);
  const y1 = await task(page, 'y1');
  assert(y1.due === TODAY && y1.from === YDAY && y1.part && y1.slotId === 'slot2' && (await task(page, 'y2')).due === YDAY, '고른 것만 오늘로: △·장소 그대로, 처음 날짜 기억');
  assert(/할 일 1개를 오늘로 옮겼어요/.test(await toastOf(page)), '옮긴 알림');
  assert(/어제부터/.test(await page.textContent(row('y1') + ' .pl-tag.from')) && await page.isVisible(row('y1') + '.part .pl-mark.t') && /공부 35분/.test(await page.textContent(row('y1'))), "오늘 칸에 '어제부터', △, 잰 시간 그대로");
  assert(await page.evaluate(() => localStorage.getItem('studypromotion.plCarryAsk')) === TODAY, '오늘 물어본 것을 기억');
  await page.evaluate(() => Planner.maybeAsk());
  await page.waitForTimeout(500);
  assert(!(await page.$('.ui-back.in')), '하루에 한 번만 묻기');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(150);
  const y1b = await task(page, 'y1');
  assert(y1b.due === YDAY && !('from' in y1b) && y1b.part, '되돌리기로 어제 칸에 그대로');
  // 그대로 두기 → 띠에서 나중에
  await page.evaluate(() => { localStorage.removeItem('studypromotion.plCarryAsk'); Planner.maybeAsk(); });
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-cy-no]');
  await sheetGone(page);
  st = await state(page);
  assert(st.tasks.find((t) => t.id === 'y1').due === YDAY && await page.isVisible('#pl-todo .pl-carry'), "'그대로 두기': 옮기지 않고 띠는 남음");
  await page.tap('#pl-todo [data-pl-carry]');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-cy-ok]');
  await sheetGone(page);
  await page.waitForTimeout(150);
  assert((await task(page, 'y1')).due === TODAY && (await task(page, 'y2')).due === YDAY && !!(await page.$('#pl-todo .pl-carry')), "띠의 '오늘로'도 같은 고르는 창 (고르지 않은 일은 띠에 남음)");
  // 4.2.1: 어제와 오늘에 같은 일(영동T 단어)이 있을 때 어제 것을 옮기면 두 줄이 되지 않고 오늘 줄에 합쳐짐
  const wordRows = async () => (await page.$$eval('#pl-list > .pl-item .pl-title', (els) => els.map((e) => e.textContent))).filter((x) => x === '영동T 단어').length;
  assert(await wordRows() === 1, '옮기기 전 오늘 칸의 영동T 단어 1줄');
  await page.tap('#pl-todo [data-pl-carry]');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-cy="y2"]');
  await page.tap('.ui-back.in [data-pl-cy-ok]');
  await sheetGone(page);
  await page.waitForTimeout(150);
  st = await state(page);
  assert(!st.tasks.some((t) => t.id === 'y2') && st.tasks.find((t) => t.id === 'd0').from === YDAY && await wordRows() === 1, '같은 일은 한 줄로 합쳐지고 처음 날짜는 어제');
  assert(/같은 할 일이 있어서 한 줄로 합쳤어요/.test(await toastOf(page)) && /어제부터/.test(await page.textContent(row('d0') + ' .pl-tag.from')) && !(await page.$('#pl-todo .pl-carry')), "합쳤다는 알림, 남은 줄에 '어제부터', 띠도 없어짐");
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(150);
  st = await state(page);
  assert(st.tasks.find((t) => t.id === 'y2').due === YDAY && !('from' in st.tasks.find((t) => t.id === 'd0')) && await wordRows() === 1 && !!(await page.$('#pl-todo .pl-carry')), '되돌리면 어제 칸에 다시, 띠도 다시');
  await page.evaluate((k) => App.store.update((s) => { s.tasks.find((t) => t.id === 'y2').due = k; }), TODAY);
  await page.waitForTimeout(100);

  /* ===== ⑥ 장소·시간 목록 ===== */
  await page.tap(row('d3') + ' .pl-slot');
  await sheetIn(page);
  await page.tap('.ui-back.in [data-pl-sp-edit]');
  await sheetGone(page);
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.querySelector('#pl-slots-fold').open && document.activeElement.id === 'pl-slot-name'), "'목록 고치기' → 맨 아래 장소·시간 목록이 펼쳐짐");
  const slotNames = () => page.$$eval('#pl-slot-list > li b', (els) => els.map((e) => e.textContent.trim()).join(','));
  assert(await slotNames() === '야자1,야자2,독서실,집' && /할 일 1개/.test(await page.textContent('#pl-slot-list > li[data-id="slot2"]')), '목록과 고른 할 일 수');
  await page.fill('#pl-slot-name', '학원');
  await page.press('#pl-slot-name', 'Enter');
  await page.waitForTimeout(150);
  assert(await slotNames() === '야자1,야자2,독서실,집,학원' && /'학원'을 넣었어요/.test(await toastOf(page)), '장소 넣기');
  await page.fill('#pl-slot-name', '집');
  await page.press('#pl-slot-name', 'Enter');
  await page.waitForTimeout(150);
  assert((await state(page)).slots.length === 5 && /이미 있어요/.test(await toastOf(page)), '같은 이름은 또 넣지 않음');
  await page.focus('#pl-slot-list > li[data-id="slot4"] [data-pl-grip]');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  assert(await slotNames() === '야자1,집,야자2,독서실,학원', '손잡이 + 위 화살표 두 번: ' + await slotNames());
  assert((await listIds(page))[0] === nt.id && (await listIds(page))[1] === 'y1', '할 일 정렬도 새 순서 (집 → 야자2): ' + (await listIds(page)).join());
  // 이름 바꾸기
  await page.tap('#pl-slot-list [data-pl-slot-ren="slot2"]');
  await sheetIn(page);
  await page.fill('#pl-sr-name', '야자 2교시');
  await page.press('#pl-sr-name', 'Enter');
  await sheetGone(page);
  await page.waitForTimeout(100);
  assert((await page.textContent(row('y1') + ' .pl-slot')).trim() === '야자 2교시', '이름을 바꾸면 할 일 칸도 바뀜');
  // 할 일이 있는 장소 지우기 → 묻고, 할 일은 정하지 않음
  await page.tap('#pl-slot-list [data-pl-slot-del="slot2"]');
  await page.waitForSelector('#ask:not([hidden])');
  assert(/할 일 1개는 '정하지 않음'이 돼요/.test(await page.textContent('#ask-msg')), '쓰는 장소는 지우기 전에 묻기');
  await page.tap('#ask-ok');
  await page.waitForTimeout(150);
  assert(!('slotId' in (await task(page, 'y1'))) && (await state(page)).slots.length === 4, '지우면 그 장소를 고른 할 일은 정하지 않음');
  await page.tap('#pl-slot-list [data-pl-slot-del="slot1"]');
  await page.waitForTimeout(150);
  assert((await state(page)).slots.length === 3 && await page.isHidden('#ask'), '안 쓰는 장소는 바로 지움');

  /* ===== ⑦ 주간 보기 ===== */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.tap('[data-pl-mode="week"]');
  await page.waitForSelector('#pl-week .pl-wi');
  const wi = row(nt.id, '#pl-week');
  assert((await page.textContent(wi + ' .pl-wslot')).trim() === '집' && await page.isVisible(wi + ' .pl-mark.sm'), '주간 보기에도 장소와 작은 진행 칸');
  assert(await page.isVisible(row('d3', '#pl-week') + '.part .pl-mark.sm.t'), '주간 보기에도 △');
  await page.tap(wi + ' .pl-mark');
  await page.waitForTimeout(150);
  assert((await task(page, nt.id)).done && await page.isVisible(wi + '.done .pl-mark.o'), '주간 보기에서도 눌러서 ○');
  await page.tap('[data-pl-mode="day"]');
  await page.waitForTimeout(100);

  /* ===== ⑧ 기능 끄기 ===== */
  await page.evaluate(() => App.store.update((s) => { s.settings.layout = { off: ['plslot', 'plreview'] }; }));
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.documentElement.classList.contains('off-plslot') && document.documentElement.classList.contains('off-plreview')), '기능과 탭 편집에서 끌 수 있음');
  assert(!(await page.$('#pl-list .pl-slot')) && await page.isHidden('#pl-slots-fold') && await page.isHidden('#pl-teachers-fold') && !(await page.$('#pl-todo .pl-rv')), '끄면 장소 칸·복습 줄·목록 접이가 안 보임');
  assert(/과목 순/.test(await sortText(page)) && (await listIds(page))[0] !== nt.id, '장소를 끄면 정해 둔 장소가 있어도 과목 순');
  await page.tap('#pl-todo [data-pl-add]');
  await page.waitForSelector('#pl-dlg:not([hidden])');
  assert(await page.isHidden('#pl-slot-f'), '추가 창의 장소 칩도 안 보임');
  await page.tap('#pl-cancel');
  await page.evaluate(() => App.store.update((s) => { delete s.settings.layout; }));
  await page.waitForTimeout(200);
  assert(await page.isVisible('#pl-list .pl-slot') && (await state(page)).tasks.find((t) => t.id === nt.id).slotId === 'slot4', '다시 켜면 정해 둔 장소 그대로');

  /* ===== ⑨ 좁은 화면 ===== */
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(200);
  const fit = await page.evaluate(() => {
    const over = document.documentElement.scrollWidth - innerWidth;
    const rows = [...document.querySelectorAll('#pl-list > .pl-item')].map((li) => {
      const r = li.getBoundingClientRect();
      const t = li.querySelector('.pl-title').getBoundingClientRect();
      const m = li.querySelector('.pl-mark').getBoundingClientRect();
      return { inside: m.right <= r.right + 0.5 && m.left >= r.left, tw: t.width };
    });
    const rvR = document.querySelector('#pl-todo .pl-rv').getBoundingClientRect();
    return { over, rows, rvOk: rvR.right <= innerWidth };
  });
  assert(fit.over <= 0 && fit.rows.every((x) => x.inside && x.tw >= 80) && fit.rvOk, '320px 화면에서 줄이 넘치지 않고 이름 칸도 넉넉: ' + JSON.stringify(fit));
  await page.setViewportSize({ width: 390, height: 844 });

  await ctx.close();
  /* ===== 다른 날 처음 열기: 기록이 없으면 묻지 않음 ===== */
  {
    const { ctx: c2, page: p2 } = await open();
    await p2.evaluate(() => { App.store.update((s) => { s.tasks = s.tasks.filter((t) => t.due !== '2026-11-18'); }); window.__plCarryTest = true; Planner.maybeAsk(); });
    await p2.waitForTimeout(600);
    assert(!(await p2.$('.ui-back.in')) && !(await p2.evaluate(() => localStorage.getItem('studypromotion.plCarryAsk'))), '못 끝낸 일이 없으면 묻지 않음');
    await c2.close();
  }

  assert(!errors.length, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
  console.log('플래너 2차 테스트 통과');
})().catch((e) => { console.error(e); process.exit(1); });
