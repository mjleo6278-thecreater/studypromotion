// v2.11 일정: 일정 추가·고치기·지우기(반복 포함), 타임테이블 하루(점선)·주간 표, 계획대로 했어요, 일정으로 공부 시작, 할 일 시간 정하기
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
  const errors = [];
  // 시계를 오늘 hour시 minute분으로 맞춘다 (흐르기는 그대로)
  async function open(hour, minute, extra) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, locale: 'ko-KR' }, extra || {}));
    await ctx.addInitScript(([h, mi]) => {
      const real = Date.now.bind(Date);
      let shift = Number(sessionStorage.getItem('__shift'));
      if (!shift) {
        const d = new Date(real());
        shift = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, 0).getTime() - real();
        sessionStorage.setItem('__shift', String(shift));
      }
      Date.now = () => real() + shift;
      try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ }
    }, [hour == null ? 16 : hour, minute == null ? 20 : minute]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return page;
  }
  const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const toastOf = (page) => page.textContent('#toast');
  const sheetTitle = (page) => page.textContent('.ui-back.in .ui-sheet-head b');
  const sheetOpts = (page) => page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent));
  const choose = async (page, label) => { await page.waitForSelector('.ui-back.in .ch-opt'); await page.tap(`.ui-back.in .ch-opt:has-text("${label}")`); await page.waitForTimeout(350); };
  const key = (page, n) => page.evaluate((n) => Schedule.shiftKey(App.todayKey(), n), n);
  const wd = (page, n) => page.evaluate((n) => Schedule.weekday(Schedule.shiftKey(App.todayKey(), n)), n);
  const pickSubject = async (page, name) => { await page.selectOption('#ev-subject', { label: name }); };
  const fillTime = async (page, sh, sm, eh, em) => { await page.fill('#ev-sh', String(sh)); await page.fill('#ev-sm', String(sm)); await page.fill('#ev-eh', String(eh)); await page.fill('#ev-em', String(em)); };

  /* ===== 1) 주간 표에서 매주 반복 일정 추가 ===== */
  let page = await open();
  await page.goto(base + '#timetable');
  await page.waitForFunction(() => window.App && window.Timetable && window.Events && App.view === 'timetable');
  assert(await page.isVisible('#ttv-day') && await page.isHidden('#ttv-week'), '타임테이블은 하루 보기로 시작');
  await page.tap('[data-tt-mode="week"]');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#ttv-week') && await page.isHidden('#ttv-day') && await page.evaluate(() => localStorage.getItem('studypromotion.ttMode')) === 'week', '주간을 누르면 주간 표 (다음에 열 때도 주간)');
  assert((await page.locator('#wk-grid .wk-dh').count()) === 7 && (await page.locator('#wk-grid .wk-col').count()) === 7, '월~일 일곱 칸');
  assert(/^월/.test(await page.textContent('#wk-grid .wk-dh >> nth=0')) && /^일/.test(await page.textContent('#wk-grid .wk-dh >> nth=6')), '월요일부터 일요일까지');
  assert((await page.locator('#wk-grid .wk-dh.today').count()) === 1 && (await page.locator('#wk-grid .wk-now').count()) === 1, '오늘 칸 표시와 지금 선');
  let fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(fit.sw <= fit.cw, '휴대폰(360)에서 주간 표가 옆으로 밀리지 않음');

  await page.tap('[data-ev-open="week"]');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#ev-dlg') && (await page.textContent('#ev-title-h')) === '일정 추가' && await page.isHidden('#ev-del'), '‘＋ 일정 추가’를 누르면 일정 추가 창');
  assert(await page.inputValue('#ev-date') === await key(page, 0) && await page.inputValue('#ev-sh') === '17' && await page.inputValue('#ev-eh') === '18', '기본은 오늘, 다음 정시부터 한 시간 (17~18시)');
  // 과목도 이름도 없으면 저장하지 않음
  await page.tap('#ev-save');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#ev-dlg') && /과목을 고르거나 이름/.test(await toastOf(page)), '과목·이름이 없으면 알림');
  await pickSubject(page, '수학');
  await page.fill('#ev-name', '학원');
  await fillTime(page, 16, 0, 18, 0);
  assert(/^16:00 ~ 18:00 · 2시간$/.test(await page.textContent('#ev-sum')), '아래에 16:00 ~ 18:00 · 2시간');
  await page.tap('[data-ev-rep="weekly"]');
  const w0 = await wd(page, 0);
  assert(await page.isVisible('#ev-days') && await page.isVisible('#ev-until-f') && await page.getAttribute(`[data-ev-day="${w0}"]`, 'aria-pressed') === 'true', '매주를 누르면 요일 칸, 오늘 요일이 골라져 있음');
  // 오늘 요일 + 이틀 뒤 요일로
  const w2 = await wd(page, 2);
  await page.tap(`[data-ev-day="${w2}"]`);
  assert(/매주/.test(await page.textContent('#ev-sum')), '요약에 반복도: ' + await page.textContent('#ev-sum'));
  await page.tap('#ev-save');
  await page.waitForTimeout(200);
  let st = await state(page);
  assert(await page.isHidden('#ev-dlg') && st.events.length === 1, '일정 하나 저장');
  let ev = st.events[0];
  assert(ev.kind === 'study' && ev.title === '학원' && ev.start === '16:00' && ev.end === '18:00' && ev.date === await key(page, 0) && ev.repeat.freq === 'weekly' && ev.repeat.days.includes(w0) && ev.repeat.days.includes(w2) && ev.repeat.until === null, '저장 모양: ' + JSON.stringify(ev));
  assert(/일정을 추가했어요/.test(await toastOf(page)), '추가 알림');
  const blocks = await page.$$eval('#wk-grid .wk-ev', (els) => els.map((e) => e.dataset.evDate));
  const thisWeek = await page.evaluate(() => { const ws = Schedule.weekStart(App.todayKey()); return [0, 1, 2, 3, 4, 5, 6].map((i) => Schedule.shiftKey(ws, i)); });
  const expect = [];
  for (const k of thisWeek) if (k >= ev.date && ev.repeat.days.includes(await page.evaluate((k) => Schedule.weekday(k), k))) expect.push(k);
  assert(blocks.join(',') === expect.join(','), '이번 주 표에 반복 요일마다 칸 (오늘부터): ' + blocks.join(','));

  /* ===== 2) 반복 일정 고치기: 이 날만 / 반복 전체, 지우기와 되돌리기 ===== */
  const k2 = await key(page, 2);
  await page.tap('[data-tt-mode="day"]');
  await page.tap('#ttv-next'); await page.tap('#ttv-next');
  await page.waitForTimeout(150);
  assert(/일정 1개/.test(await page.textContent('#ttv-sum')) && /계획한 공부 2시간/.test(await page.textContent('#ttv-sum')), '앞으로의 날도 열리고 일정 합계: ' + await page.textContent('#ttv-sum'));
  assert(await page.isHidden('#ttv-log-panel'), '앞으로의 날에는 공부 기록 칸을 숨김');
  const plan16 = await page.$$eval('#ttv-grid [data-tt-row="16"] .tt-bar b.plan', (els) => els.length);
  assert(plan16 === 1, '16시 줄에 점선 일정 칸');
  assert(/16:00 ~ 18:00/.test(await page.textContent('#ttv-plans')) && /매주/.test(await page.textContent('#ttv-plans')) && /예정/.test(await page.textContent('#ttv-plans')), '이날의 일정 목록: 시각·반복·예정');
  await page.tap('#ttv-plans [data-ev-edit]');
  await page.waitForTimeout(150);
  assert((await page.textContent('#ev-title-h')) === '일정 고치기' && await page.isVisible('#ev-del') && await page.inputValue('#ev-date') === k2, '일정을 누르면 고치기 창 (그날 날짜)');
  await page.fill('#ev-eh', '19');
  await page.tap('#ev-save');
  await page.waitForSelector('.ui-back.in .ch-opt');
  assert(/반복 일정을 어떻게 바꿀까요/.test(await sheetTitle(page)) && (await sheetOpts(page)).join(',') === '이 날만,이 날부터 앞으로,반복 전체', '반복 일정이면 어디까지 바꿀지 물음');
  await choose(page, '이 날만');
  st = await state(page);
  assert(st.events.length === 2 && st.events[0].skip.includes(k2) && st.events[1].date === k2 && st.events[1].end === '19:00' && st.events[1].repeat === null, '이 날만: 반복에서 그날을 빼고 그날 일정 하나를 따로');
  assert(/16:00 ~ 19:00/.test(await page.textContent('#ttv-plans')) && !/매주/.test(await page.textContent('#ttv-plans')), '그날은 바뀐 일정만');
  await page.tap('#ttv-prev'); await page.tap('#ttv-prev');
  await page.tap('#ttv-plans [data-ev-edit]');
  await page.waitForTimeout(150);
  await page.fill('#ev-sh', '15');
  await page.tap('#ev-save');
  await choose(page, '반복 전체');
  st = await state(page);
  assert(st.events.length === 2 && st.events[0].start === '15:00' && st.events[0].date === ev.date && st.events[0].skip.includes(k2), '반복 전체: 첫날과 빼 둔 날은 그대로, 시각만 바뀜');
  await page.tap('#ttv-plans [data-ev-edit]');
  await page.waitForTimeout(150);
  await page.tap('#ev-del');
  await choose(page, '반복 전체 지우기');
  st = await state(page);
  assert(st.events.length === 1 && /지웠어요/.test(await toastOf(page)), '반복 전체 지우기');
  await page.tap('#toast button');
  await page.waitForTimeout(150);
  assert((await state(page)).events.length === 2, '되돌리기');
  await page.context().close();

  /* ===== 3) 끝난 일정: 계획대로 했어요, 공부한 만큼 ✓ ===== */
  page = await open(16, 20);
  await page.goto(base + '#timetable');
  await page.waitForFunction(() => window.App && window.Events && App.view === 'timetable');
  await page.evaluate(() => localStorage.setItem('studypromotion.ttMode', 'day'));
  st = await state(page);
  const math = st.subjects.find((s) => s.name === '수학'), eng = st.subjects.find((s) => s.name === '영어');
  const today = await key(page, 0);
  const r1 = await page.evaluate(([m, e, k]) => [
    Events.add({ kind: 'study', subjectId: m, title: '학원', date: k, start: '10:00', end: '12:00' }),
    Events.add({ kind: 'study', subjectId: e, title: '단어', date: k, start: '13:00', end: '14:00' }),
    Events.add({ kind: 'other', title: '친구 약속', date: k, start: '14:00', end: '15:00' }),
    Events.add({ kind: 'study', subjectId: m, date: k, start: '16:00', end: '17:30' }),
    Events.add({ kind: 'study', subjectId: e, date: k, start: '25:00', end: '26:00' }),
  ], [math.id, eng.id, today]);
  assert(r1.slice(0, 4).every((x) => x.id) && /시작 시각/.test(r1[4].error), 'Events.add: 맞으면 저장, 잘못이면 { error }');
  // 수학 10:05~11:50 스톱워치 (105분 ≥ 96분 → 계획대로)
  await page.evaluate((m) => { const d = new Date(Date.now()); App.store.update((s) => s.sessions.push({ id: 'sw1', subjectId: m, minutes: 105, endedAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 11, 50).getTime(), kind: 'stopwatch' })); }, math.id);
  await page.waitForTimeout(150);
  const rowsText = await page.$$eval('#ttv-plans .ev-row', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  assert(rowsText.length === 4, '오늘 일정 4개: ' + rowsText.join(' / '));
  assert(/10:00 ~ 12:00.*수학.*학원.*✓ 1시간 45분/.test(rowsText[0]), '공부한 일정은 ✓와 공부한 시간: ' + rowsText[0]);
  assert(/13:00 ~ 14:00.*영어.*계획대로 했어요/.test(rowsText[1]), '기록이 없는 끝난 일정은 ‘계획대로 했어요’: ' + rowsText[1]);
  assert(/14:00 ~ 15:00.*친구 약속.*다른 일정/.test(rowsText[2]) && !(await page.$('#ttv-plans .ev-row.other button.btn')), '다른 일정은 단추 없이');
  assert(/16:00 ~ 17:30.*수학.*시작/.test(rowsText[3]) && (await page.$('#ttv-plans .ev-row.now [data-ev-start]')), '지금 하는 일정에는 ‘시작’');
  assert(/계획한 공부 4시간 30분/.test(await page.textContent('#ttv-sum')), '합계 옆에 계획한 공부 (다른 일정 빼고)');
  await page.tap('#ttv-plans .ev-row >> nth=1 >> [data-ev-done]');
  await page.waitForTimeout(200);
  st = await state(page);
  let man = st.sessions.filter((s) => s.manual);
  assert(man.length === 1 && man[0].subjectId === eng.id && man[0].minutes === 60 && man[0].label === '단어' && new Date(man[0].startAt).getHours() === 13, '계획대로 했어요 → 13:00~14:00 영어 1시간 직접 기록');
  assert(/1시간을 기록했어요/.test(await toastOf(page)) && /✓ 1시간/.test(await page.textContent('#ttv-plans .ev-row >> nth=1')), '알림과 ✓');
  assert((await page.$$eval('#ttv-grid [data-tt-row="13"] .tt-bar i', (els) => els.length)) === 1, '시간표 13시 줄에 칠해짐');
  await page.tap('#toast button');
  await page.waitForTimeout(150);
  assert(!(await state(page)).sessions.some((s) => s.manual), '되돌리기로 기록 지움');
  // 지나간 일정 칸을 누르면 그 일정으로 채운 직접 기록 창
  await page.$eval('[data-tt-row="13"]', (el) => el.scrollIntoView({ block: 'center' }));
  let bar = await (await page.$('[data-tt-row="13"] .tt-bar')).boundingBox();
  await page.touchscreen.tap(bar.x + 5, bar.y + bar.height / 2);
  await page.waitForTimeout(150);
  assert(await page.isVisible('#log-dlg') && await page.inputValue('#log-sh') === '13' && await page.inputValue('#log-eh') === '14' && await page.inputValue('#log-subject') === eng.id && await page.inputValue('#log-label') === '단어', '지나간 일정 칸 → 그 일정으로 채운 공부 기록 창');
  await page.tap('#log-cancel');
  // 앞으로의 빈 칸을 누르면 그 시각의 일정 추가
  await page.$eval('[data-tt-row="19"]', (el) => el.scrollIntoView({ block: 'center' }));
  bar = await (await page.$('[data-tt-row="19"] .tt-bar')).boundingBox();
  await page.touchscreen.tap(bar.x + bar.width * 0.55, bar.y + bar.height / 2);
  await page.waitForTimeout(150);
  assert(await page.isVisible('#ev-dlg') && await page.inputValue('#ev-sh') === '19' && await page.inputValue('#ev-sm') === '30' && await page.inputValue('#ev-eh') === '20', '앞으로의 칸 → 그 10분 칸부터 한 시간 일정 추가 창');
  await page.tap('#ev-cancel');

  /* ===== 4) 홈: 지금 일정과 ‘시작’, 공부 시작하기의 ‘지금 일정’ ===== */
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(150);
  assert(/지금 일정/.test(await page.textContent('#h-plan')) && /수학/.test(await page.textContent('#h-plan')) && /16:00 ~ 17:30/.test(await page.textContent('#h-plan')), '홈에 지금 일정 한 줄: ' + await page.textContent('#h-plan'));
  assert((await page.locator('#h-tt .ds-bar b.plan').count()) === 4, '오늘 띠에 일정 칸 4개 (점선)');
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  const so = await sheetOpts(page);
  assert(so[0] === '수학' && (await page.textContent('.ui-back.in .ch-head >> nth=0')) === '지금 일정' && /16:00 ~ 17:30/.test(await page.textContent('.ui-back.in .ch-opt >> nth=0')), '공부 시작하기 첫 창 맨 위에 지금 일정: ' + so.join(','));
  await page.tap('.ui-back.in .ch-opt >> nth=0');
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => Stopwatch.running()) && await page.evaluate(() => App.view) === 'timer', '지금 일정을 고르면 바로 스톱워치');
  let sw = await page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.stopwatch')));
  assert(sw.subjectId === math.id, '그 일정의 과목으로');
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(150);
  assert(/하는 중/.test(await page.textContent('#h-plan')) && !(await page.$('#h-plan [data-ev-start]')), '재는 중이면 ‘하는 중’');
  await page.evaluate(() => Stopwatch.stop());
  await page.waitForTimeout(200);
  await page.context().close();

  /* ===== 5) 할 일: 시간 정하기 → 할 일과 연결된 일정, 할 일에 날짜·시각 ===== */
  page = await open(9, 0);
  await page.goto(base + '#plan');
  await page.waitForFunction(() => window.App && window.Events && App.view === 'plan');
  st = await state(page);
  const kor = st.subjects.find((s) => s.name === '국어');
  await page.evaluate((k) => App.store.update((s) => s.tasks.push({ id: 't1', title: '문학 3단원 정리', subjectId: k, due: null, estimateMin: 60, done: false, createdAt: 1 })), kor.id);
  await page.waitForTimeout(100);
  await page.tap('#tasklist .task-plan-btn');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#ev-dlg') && await page.inputValue('#ev-task') === 't1' && await page.inputValue('#ev-subject') === kor.id, '시간 정하기 → 그 할 일과 과목이 골라진 일정 창');
  const tomorrow = await key(page, 1);
  await page.evaluate((k) => { const el = document.querySelector('#ev-date'); el.value = k; el.dispatchEvent(new Event('change', { bubbles: true })); }, tomorrow);
  await fillTime(page, 20, 0, 21, 30);
  await page.tap('#ev-save');
  await page.waitForTimeout(200);
  st = await state(page);
  assert(st.events.length === 1 && st.events[0].taskId === 't1' && st.events[0].subjectId === kor.id && st.events[0].date === tomorrow, '할 일과 연결된 일정 저장');
  assert(/20:00/.test(await page.textContent('#tasklist .task-plan')), '할 일에 정한 날짜·시각: ' + await page.textContent('#tasklist .task-plan'));
  await page.tap('#tasklist .task-plan');
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => App.view) === 'timetable' && await page.evaluate(() => Timetable.day) === tomorrow && /할 일: 문학 3단원 정리/.test(await page.textContent('#ttv-plans')), '할 일의 날짜를 누르면 그날 타임테이블, 일정에 할 일 이름');
  // 과목을 지워도 일정은 이름으로 남는다
  await page.evaluate((k) => App.store.update((s) => { s.subjects = s.subjects.filter((x) => x.id !== k); }), kor.id);
  // (과목 삭제 단추를 거치지 않은 경우에도 화면이 깨지지 않아야 함)
  await page.waitForTimeout(100);
  assert(/공부|문학/.test(await page.textContent('#ttv-plans')), '과목이 없어져도 일정은 보임');

  /* ===== 6) 화면 없이 고치기 (AI 도우미용) ===== */
  const id0 = st.events[0].id;
  let up = await page.evaluate((id) => Events.update(id, { start: '21:00', end: '22:00' }), id0);
  assert(up.id === id0 && up.start === '21:00' && up.end === '22:00', 'Events.update로 시각 바꾸기');
  up = await page.evaluate((id) => Events.update(id, { end: '21:00' }), id0);
  assert(/끝 시각/.test(up.error) && (await state(page)).events[0].end === '22:00', '잘못 바꾸면 { error }, 그대로 둠');
  assert(await page.evaluate((id) => Events.remove(id), id0) === true && (await state(page)).events.length === 0, 'Events.remove');
  await page.context().close();

  /* ===== 7) 어두운 화면에서도 주간 표가 보임 ===== */
  page = await open(16, 20, { colorScheme: 'dark' });
  await page.goto(base + '#timetable');
  await page.waitForFunction(() => window.App && window.Events);
  await page.evaluate(() => Events.add({ kind: 'other', title: '운동', date: App.todayKey(), start: '18:00', end: '19:00' }));
  await page.evaluate(() => Timetable.setMode('week'));
  await page.waitForTimeout(150);
  const look = await page.$eval('#wk-grid .wk-ev', (el) => { const cs = getComputedStyle(el); return { color: cs.color, h: el.getBoundingClientRect().height }; });
  assert(look.h >= 25 && look.color !== 'rgb(0, 0, 0)', '어두운 화면: 일정 칸 높이와 글자색 ' + JSON.stringify(look));
  await page.context().close();

  assert(!errors.length, '콘솔 오류 없음' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
