// v2.10 새 기능 확인: 공부 시작하기에서 시험 범위 항목도 고르기, 타임테이블에 공부 시간을 몇 시부터 몇 시까지 직접 추가하기
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
const SW = 'studypromotion.stopwatch';

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const near = (a, b, tol) => Math.abs(a - b) <= (tol || 0.2);
  const browser = await chromium.launch();
  const errors = [];
  // 시계를 오늘 오후 4시 20분으로 맞춘다 (흐르기는 그대로)
  async function open(extra) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, locale: 'ko-KR' }, extra || {}));
    await ctx.addInitScript(() => {
      const real = Date.now.bind(Date);
      let shift = Number(sessionStorage.getItem('__shift'));
      if (!shift) {
        const d = new Date(real());
        shift = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16, 20, 0).getTime() - real();
        sessionStorage.setItem('__shift', String(shift));
      }
      Date.now = () => real() + shift;
      try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ }
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return page;
  }
  const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const toastOf = (page) => page.textContent('#toast');
  const swState = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SW);
  const sheetTitle = (page) => page.textContent('.ui-back.in .ui-sheet-head b');
  const sheetItems = (page) => page.$$eval('.ui-back.in .ch-opts > *', (els) => els.map((e) => (e.classList.contains('ch-head') ? '#' : '') + (e.querySelector('b') || e).textContent.trim().replace(/\s+/g, ' ')));
  const sheetHints = (page) => page.$$eval('.ui-back.in .ch-opt', (els) => els.map((e) => (e.querySelector('small') || { textContent: '' }).textContent));
  const tapOpt = async (page, text) => { await page.tap(`.ui-back.in .ch-opt:has(b:text-is("${text}"))`); await page.waitForTimeout(350); };
  const rows = (page) => page.$$eval('#ttv-grid .tt-row:not(.tt-head)', (els) => els.map((r) => ({
    hour: +r.querySelector('.tt-h').textContent,
    segs: [...r.querySelectorAll('.tt-bar i')].map((i) => ({ left: parseFloat(i.style.left), width: parseFloat(i.style.width), color: i.style.background })),
  })));
  const listText = (page) => page.$$eval('#ttv-list li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const at = (page, dayShift, h, m) => page.evaluate(([n, h, m]) => { const d = new Date(Date.now()); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, h, m).getTime(); }, [dayShift, h, m]);
  const dayKeyOf = (page, t) => page.evaluate((t) => Stats.dayKey(t), t);

  /* ===== 1) 공부 시작하기: 과목을 고르면 할 일과 시험 범위가 함께 ===== */
  let page = await open();
  await page.goto(base + '#home');
  await page.waitForFunction(() => window.App && window.Stopwatch && window.Timetable);
  await page.evaluate(() => {
    const d = new Date(Date.now());
    const day = (n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    App.store.update((s) => {
      const math = s.subjects.find((x) => x.name === '수학');
      s.tasks.push({ id: 't1', title: '문제집 3단원 풀기', subjectId: math.id, due: day(1), estimateMin: 60, done: false, createdAt: 1 });
      s.tasks.push({ id: 't2', title: '삼각형 오답 정리', subjectId: math.id, due: null, estimateMin: null, done: false, createdAt: 2, topicId: 'l4' }); // 범위에서 할 일로 옮겨 둔 항목
      s.exams.push({ id: 'e1', name: '2학기 중간고사', date: day(9) }, { id: 'e0', name: '지난 쪽지시험', date: day(-3) }, { id: 'e2', name: '수행평가', date: '' });
      const T = (id, examId, parentId, title, order, extra) => s.topics.push(Object.assign({ id, examId, parentId, kind: 'topic', title, done: false, order }, extra || {}));
      T('c1', 'e1', null, '수학', 0); T('u1', 'e1', 'c1', '1단원 함수', 0);
      T('l1', 'e1', 'u1', '함수의 뜻', 0, { done: true, pct: 100 }); T('l2', 'e1', 'u1', '일차함수 그래프', 1, { est: 40, pct: 50 }); T('l3', 'e1', 'u1', '연습문제', 2, { est: 30 });
      T('n1', 'e1', 'u1', '메모: 공식 외우기', 3, { kind: 'note' });
      T('u2', 'e1', 'c1', '2단원 도형', 1); T('l4', 'e1', 'u2', '삼각형의 성질', 0); T('l5', 'e1', 'u2', '사각형의 성질', 1);
      T('c2', 'e1', null, '영어', 1); T('l6', 'e1', 'c2', '본문 1과', 0);
      T('c0', 'e0', null, '수학', 0); T('l7', 'e0', 'c0', '지난 시험 항목', 0);
      T('c3', 'e2', null, '수학', 0); T('l8', 'e2', 'c3', '탐구 보고서', 0);
    });
  });
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await tapOpt(page, '수학');
  await page.waitForSelector('.ui-back.in .start-sheet');
  assert(await sheetTitle(page) === '수학 · 무엇을 공부할까요?', '과목 다음 창 제목: ' + await sheetTitle(page));
  let items = await sheetItems(page);
  assert(items.join(' | ') === '#할 일 | 문제집 3단원 풀기 | 삼각형 오답 정리 | #범위 2학기 중간고사 D-9 | 일차함수 그래프 | 연습문제 | 사각형의 성질 | #범위 수행평가 | 탐구 보고서 | 고르지 않고 수학만 공부하기',
    '할 일과 범위를 나눠서: 끝낸 항목·메모·지난 시험·다른 과목·할 일로 옮긴 항목은 빠지고, 다가오는 시험부터: ' + items.join(' | '));
  const hints = await sheetHints(page);
  assert(hints[2] === '1단원 함수 · 50% 했음 · 남은 20분' && hints[3] === '1단원 함수 · 남은 30분' && hints[4] === '2단원 도형', '범위 항목 아래에 단원·진행·남은 시간: ' + hints.slice(2, 5).join(' / '));
  assert(/할 일이나 범위에 없는 공부라면/.test(await page.textContent('.ui-back.in .ch-note')), '안내 문구');
  // 범위 항목을 골라 시작
  await tapOpt(page, '연습문제');
  let sw = await swState(page);
  let st = await state(page);
  const math = st.subjects.find((s) => s.name === '수학');
  assert(sw.running && sw.subjectId === math.id && sw.topicId === 'l3' && sw.label === '수학 · 연습문제' && sw.taskId === null && await page.evaluate(() => App.view) === 'timer', '범위를 고르면 그 과목으로 스톱워치 시작, 범위가 함께 남음');
  assert(await page.textContent('#sw-now-name') === '수학 · 연습문제', '재는 중 표시에 과목 이름을 두 번 쓰지 않음: ' + await page.textContent('#sw-now-name'));
  await page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.startAt -= 30 * 60000; localStorage.setItem(k, JSON.stringify(s)); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, SW);
  await page.tap('#sw-main');
  await page.waitForSelector('#ask:not([hidden])');
  assert(/연습문제.*끝냈나요/.test(await page.textContent('#ask-msg')), '멈추면 그 범위를 끝냈는지 물어봄');
  assert(/수학 · 연습문제 30분 기록했어요/.test(await toastOf(page)), '기록 알림: ' + await toastOf(page));
  await page.tap('#ask-ok');
  await page.waitForTimeout(200);
  st = await state(page);
  const rec = st.sessions.find((s) => s.kind === 'stopwatch');
  assert(st.topics.find((t) => t.id === 'l3').done && rec && rec.topicId === 'l3' && rec.minutes === 30, '끝냈다고 하면 범위에서 체크, 기록에 범위가 남음');
  // 범위만 있는 과목(영어): 묶음 제목은 ‘범위’ 하나
  await page.evaluate(() => App.go('home'));
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await tapOpt(page, '영어');
  items = await sheetItems(page);
  assert(items.join(' | ') === '#범위 2학기 중간고사 D-9 | 본문 1과 | 고르지 않고 영어만 공부하기', '할 일이 없고 범위만 있으면 범위만: ' + items.join(' | '));
  await tapOpt(page, '고르지 않고 영어만 공부하기');
  sw = await swState(page);
  assert(sw.running && sw.label === null && sw.topicId === null, '맨 아래를 고르면 과목만으로 시작');
  await page.tap('#sw-main');
  await page.waitForTimeout(300);
  // 범위도 할 일도 없는 과목(국어)은 예전처럼 바로 시작
  await page.evaluate(() => App.go('home'));
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await tapOpt(page, '국어');
  sw = await swState(page);
  assert(sw.running && await page.isHidden('.ui-back.in .start-sheet'), '할 일·범위가 없으면 고르는 창 없이 바로 시작');
  await page.tap('#sw-main');
  await page.waitForTimeout(300);
  await page.context().close();

  /* ===== 2) 타임테이블: 칸을 눌러 공부 시간 추가 ===== */
  page = await open();
  await page.goto(base + '#timetable');
  await page.waitForFunction(() => window.App && window.Timetable && App.view === 'timetable');
  assert(/칸을 눌러 추가/.test(await page.textContent('#ttv-foot')), '칸을 누르면 추가할 수 있다고 알려 줌');
  // 10시 줄의 세 번째 칸(20~30분)을 누름
  let bar = await (await page.$('[data-tt-row="10"] .tt-bar')).boundingBox();
  await page.touchscreen.tap(bar.x + bar.width * 0.42, bar.y + bar.height / 2);
  await page.waitForSelector('#log-dlg:not([hidden])');
  assert(await page.isVisible('#log-clock') && await page.isHidden('#log-dur') && await page.getAttribute('[data-log-mode="time"]', 'aria-pressed') === 'true', '시각으로 적는 창이 열림');
  assert([await page.inputValue('#log-sh'), await page.inputValue('#log-sm'), await page.inputValue('#log-eh'), await page.inputValue('#log-em')].join(':') === '10:20:11:20', '누른 칸부터 한 시간으로 채워짐');
  assert(await page.textContent('#log-sum') === '10:20 ~ 11:20 · 1시간', '아래에 시각과 시간: ' + await page.textContent('#log-sum'));
  await page.fill('#log-em', '50');
  assert(await page.textContent('#log-sum') === '10:20 ~ 11:50 · 1시간 30분', '고치면 바로 다시 계산');
  await page.selectOption('#log-subject', { label: '국어' });
  await page.fill('#log-label', '독서실');
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(250);
  assert(await page.isHidden('#log-dlg') && /오늘 10:20 ~ 11:50 1시간 30분 공부를 기록했어요/.test(await toastOf(page)), '기록하면 창이 닫히고 알림: ' + await toastOf(page));
  st = await state(page);
  const kor = st.subjects.find((s) => s.name === '국어');
  let man = st.sessions.filter((s) => s.manual);
  assert(man.length === 1 && man[0].minutes === 90 && man[0].startAt === await at(page, 0, 10, 20) && man[0].endedAt === await at(page, 0, 11, 50) && man[0].subjectId === kor.id && man[0].label === '독서실', '직접 기록에 시작 시각까지 남음');
  let r = await rows(page);
  let r10 = r.find((x) => x.hour === 10), r11 = r.find((x) => x.hour === 11);
  assert(r10.segs.length === 1 && near(r10.segs[0].left, 33.33) && near(r10.segs[0].width, 66.67) && r11.segs.length === 1 && near(r11.segs[0].left, 0) && near(r11.segs[0].width, 83.33), '타임테이블 10:20~11:50 칸이 칠해짐');
  assert(/1시간 30분/.test(await page.textContent('#ttv-sum')) && /10:20 ~ 11:50/.test(await page.textContent('#ttv-sum')), '합계와 시각');
  let lt = await listText(page);
  assert(lt.length === 1 && /국어 직접 · 독서실\s?10:20 ~ 11:50 · 1시간 30분/.test(lt[0]), '이날의 기록에 시각과 함께: ' + lt.join(' / '));
  // 아직 오지 않은 시간의 칸
  bar = await (await page.$('[data-tt-row="18"] .tt-bar')).boundingBox();
  await page.touchscreen.tap(bar.x + 10, bar.y + bar.height / 2);
  await page.waitForTimeout(200);
  assert(await page.isHidden('#log-dlg') && /아직 오지 않은 시간/.test(await toastOf(page)), '지나지 않은 칸은 열지 않고 알림');

  /* ===== 3) 겹치는 시간, 잘못 적은 시각 ===== */
  await page.tap('#view-timetable [data-log-open]');
  await page.waitForSelector('#log-dlg:not([hidden])');
  assert(await page.isVisible('#log-clock') && (await page.inputValue('#log-sh')) === '' && (await page.inputValue('#log-date')) === await dayKeyOf(page, await at(page, 0, 12, 0)), '‘＋ 공부 시간 추가’: 보고 있는 날, 빈 칸으로');
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#log-dlg') && /시작 시각을 적어/.test(await toastOf(page)), '시각을 안 적으면 기록 안 함');
  await page.fill('#log-sh', '14'); await page.fill('#log-sm', '0'); await page.fill('#log-eh', '13'); await page.fill('#log-em', '0');
  assert(/늦게 적어/.test(await page.textContent('#log-sum')), '끝이 시작보다 한참 이르면 잘못 적은 것으로: ' + await page.textContent('#log-sum'));
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#log-dlg') && (await state(page)).sessions.length === 1, '기록 안 함');
  await page.fill('#log-sh', '16'); await page.fill('#log-sm', '0'); await page.fill('#log-eh', '17'); await page.fill('#log-em', '0');
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#log-dlg') && /아직 오지 않은 시각/.test(await toastOf(page)), '지금(16:20)보다 늦게 끝나면 기록 안 함');
  // 빠른 선택: 빈 칸에서 1시간 → 지금까지 1시간
  await page.fill('#log-sh', ''); await page.fill('#log-sm', ''); await page.fill('#log-eh', ''); await page.fill('#log-em', '');
  await page.tap('#log-quick [data-min="60"]');
  assert([await page.inputValue('#log-sh'), await page.inputValue('#log-sm'), await page.inputValue('#log-eh'), await page.inputValue('#log-em')].join(':') === '15:20:16:20', '빈 칸에서 ‘1시간’ → 지금까지 1시간');
  await page.fill('#log-sh', '11'); await page.fill('#log-sm', '30');
  await page.tap('#log-quick [data-min="90"]');
  assert([await page.inputValue('#log-eh'), await page.inputValue('#log-em')].join(':') === '13:00', '시작을 적었으면 시작부터 1시간 30분');
  // 11:30~13:00은 국어 10:20~11:50과 20분 겹침
  await page.tap('#log-form button[type="submit"]');
  await page.waitForSelector('#ask:not([hidden])');
  const askMsg = await page.textContent('#ask-msg');
  assert(/이미 공부 기록이 있어요/.test(askMsg) && /국어 10:20 ~ 11:50/.test(askMsg) && /겹치는 20분은 두 번 세어져요/.test(askMsg), '겹치면 어떤 기록과 몇 분 겹치는지 물어봄: ' + askMsg.replace(/\n/g, ' / '));
  assert(await page.textContent('#ask-ok') === '그래도 기록하기' && await page.textContent('#ask-cancel') === '시각 고치기', '버튼에 하는 일');
  await page.tap('#ask-cancel');
  await page.waitForTimeout(150);
  assert(await page.isVisible('#log-dlg') && (await state(page)).sessions.length === 1, '‘시각 고치기’ → 창이 그대로, 기록 안 함');
  await page.fill('#log-sh', '12'); await page.fill('#log-sm', '0');
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(200);
  assert(await page.isHidden('#ask') && await page.isHidden('#log-dlg') && (await state(page)).sessions.length === 2, '겹치지 않게 고치면 묻지 않고 기록');
  lt = await listText(page);
  assert(lt.length === 2 && /10:20 ~ 11:50/.test(lt[0]) && /과목 없음 직접\s?12:00 ~ 13:00 · 1시간/.test(lt[1]), '시간 순서로: ' + lt.join(' / '));
  // 지금 재는 스톱워치와 겹쳐도 물어봄
  await page.evaluate(() => Stopwatch.start(''));
  await page.evaluate((k) => { const s = JSON.parse(localStorage.getItem(k)); s.startAt -= 30 * 60000; localStorage.setItem(k, JSON.stringify(s)); window.dispatchEvent(new StorageEvent('storage', { key: k })); }, SW);
  await page.evaluate(() => App.go('timetable'));
  await page.tap('#view-timetable [data-log-open]');
  await page.fill('#log-sh', '15'); await page.fill('#log-sm', '40'); await page.fill('#log-eh', '16'); await page.fill('#log-em', '10');
  await page.tap('#log-form button[type="submit"]');
  await page.waitForSelector('#ask:not([hidden])');
  assert(/15:50 ~ 지금/.test(await page.textContent('#ask-msg')) && /겹치는 20분/.test(await page.textContent('#ask-msg')), '재는 중인 시간과 겹쳐도 알려 줌: ' + (await page.textContent('#ask-msg')).replace(/\n/g, ' / '));
  await page.tap('#ask-ok');
  await page.waitForTimeout(200);
  assert((await state(page)).sessions.filter((s) => s.manual).length === 3, '‘그래도 기록하기’ → 기록');
  await page.evaluate(() => Stopwatch.stop());
  await page.waitForTimeout(200);

  /* ===== 4) 지난 날, 자정을 넘긴 공부 ===== */
  await page.evaluate(() => App.go('timetable'));
  await page.tap('#ttv-prev');
  await page.tap('#view-timetable [data-log-open]');
  const yKey = await dayKeyOf(page, await at(page, -1, 12, 0)), tKey = await dayKeyOf(page, await at(page, 0, 12, 0));
  assert((await page.inputValue('#log-date')) === yKey, '어제를 보고 있으면 어제 날짜로');
  await page.fill('#log-sh', '22'); await page.fill('#log-sm', '0'); await page.fill('#log-eh', '1'); await page.fill('#log-em', '0');
  assert(/22:00 ~ 다음 날 1:00 · 3시간/.test(await page.textContent('#log-sum')) && /나눠서 기록/.test(await page.textContent('#log-sum')), '자정을 넘기면 다음 날까지로 보고 알려 줌: ' + await page.textContent('#log-sum'));
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(200);
  st = await state(page);
  const y = st.sessions.find((s) => s.manual && s.minutes === 120);
  const t = st.sessions.find((s) => s.manual && s.startAt === y.startAt + 120 * 60000);
  assert(y && t && y.startAt === await at(page, -1, 22, 0) && await dayKeyOf(page, y.endedAt) === yKey && t.minutes === 60 && t.startAt === await at(page, 0, 0, 0) && await dayKeyOf(page, t.endedAt) === tKey,
    '날짜가 바뀌는 때에 나눠서: 어제 22:00~24:00 2시간, 오늘 0:00~1:00 1시간');
  r = await rows(page);
  assert(r.find((x) => x.hour === 22).segs.length === 1 && near(r.find((x) => x.hour === 23).segs[0].width, 100) && /22:00 ~ 24:00 · 2시간/.test((await listText(page)).join(' ')), '어제 시간표의 22시·23시 줄, 목록은 24:00까지');
  await page.tap('#ttv-today');
  r = await rows(page);
  assert(r.find((x) => x.hour === 0).segs.length === 1, '오늘 0시 줄에도 칠해짐');
  // 통계의 최근 기록에도 시각이 나옴
  await page.evaluate(() => App.go('stats'));
  await page.waitForTimeout(150);
  assert((await page.$$eval('#session-list li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')))).some((x) => /독서실 .*11:50 · 1시간 30분/.test(x)), '통계 최근 기록에 시각을 적은 직접 기록은 시각까지');
  // 다른 곳에서 열면 예전처럼 ‘공부한 시간만’
  await page.tap('#view-stats [data-log-open]');
  assert(await page.isVisible('#log-dur') && await page.isHidden('#log-clock') && await page.isHidden('#log-sum') && await page.getAttribute('[data-log-mode="dur"]', 'aria-pressed') === 'true', '통계에서 열면 ‘공부한 시간만’으로');
  await page.tap('[data-log-mode="time"]');
  assert(await page.isVisible('#log-clock') && await page.isHidden('#log-dur') && /타임테이블의 그 시간에 칠해/.test(await page.textContent('#log-desc')), '위 단추로 시각으로 적기로 바꿈');
  await page.keyboard.press('Escape');
  const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(fit.sw <= fit.cw, '화면이 옆으로 밀리지 않음 (360)');
  await page.context().close();

  /* ===== 5) 하루 시작 시각이 새벽 4시면 새벽 시각은 그날의 연장 ===== */
  page = await open();
  await page.goto(base + '#home');
  await page.waitForFunction(() => window.App && window.Timetable);
  await page.evaluate(() => App.store.update((s) => { s.settings.dayStartHour = 4; }));
  await page.evaluate(() => App.go('timetable'));
  await page.tap('#ttv-prev');
  await page.tap('#view-timetable [data-log-open]');
  const y4 = await page.evaluate(() => Stats.dayKey(Date.now() - 864e5));
  assert((await page.inputValue('#log-date')) === y4, '어제 날짜');
  await page.fill('#log-sh', '23'); await page.fill('#log-sm', '0'); await page.fill('#log-eh', '2'); await page.fill('#log-em', '30');
  assert(await page.textContent('#log-sum') === '23:00 ~ 2:30 · 3시간 30분', '새벽 2:30은 같은 공부 날 (다음 날로 나누지 않음): ' + await page.textContent('#log-sum'));
  await page.tap('#log-form button[type="submit"]');
  await page.waitForTimeout(200);
  st = await state(page);
  man = st.sessions.filter((s) => s.manual);
  assert(man.length === 1 && man[0].minutes === 210 && man[0].startAt === await at(page, -1, 23, 0) && man[0].endedAt === await at(page, 0, 2, 30) && await dayKeyOf(page, man[0].endedAt) === y4, '한 번에 기록, 어제 공부로');
  r = await rows(page);
  const i23 = r.findIndex((x) => x.hour === 23), i2 = r.findIndex((x) => x.hour === 2);
  assert(r[r.length - 1].hour === 3 && i2 > i23 && r[i23].segs.length === 1 && r[i2].segs.length === 1 && near(r[i2].segs[0].width, 50), '어제 시간표(새벽 3시 줄까지)의 23시와 그 뒤 새벽 2시 줄');
  await page.context().close();

  assert(!errors.length, '콘솔 오류 없음' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
