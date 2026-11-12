// v2.9에 들어간 개선 확인: 분명한 확인 창, 타이머 초기화 때 기록 묻기, 휴대폰 뒤로 가기, 하루 시작 시각,
// 집중이 끝나면 이어서 무엇을 할지 고르기, 최근 7일을 그 전 7일과 비교
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
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' };
  async function open(opts) {
    const ctx = await browser.newContext(Object.assign({}, phone, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return page;
  }
  const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const toastOf = (page) => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });
  const askInfo = (page) => page.evaluate(() => {
    const ok = document.querySelector('#ask-ok'), alt = document.querySelector('#ask-alt');
    return {
      open: !document.querySelector('#ask').hidden, msg: document.querySelector('#ask-msg').textContent,
      ok: ok.textContent, cancel: document.querySelector('#ask-cancel').textContent, alt: alt.hidden ? null : alt.textContent,
      danger: ok.classList.contains('danger-fill'), primary: ok.classList.contains('primary'),
      bg: getComputedStyle(ok).backgroundColor, focus: document.activeElement && document.activeElement.id,
    };
  });

  /* ===== 1) 확인 창을 더 분명하게 ===== */
  let page = await open();
  await page.goto(base + '#plan');
  await page.evaluate(() => {
    localStorage.setItem('studypromotion.welcomeClosed', '1');
    App.store.update((s) => { s.subjects = [{ id: 's-kor', name: '국어', color: '#e05a4f' }, { id: 's-math', name: '수학', color: '#3d96e0' }]; });
  });
  await page.tap('#subject-list [data-del-subject]');
  let a = await askInfo(page);
  assert(a.open && a.ok === '삭제' && a.cancel === '취소', "과목 삭제 확인 창의 버튼이 '삭제'라고 적혀 있음 (전에는 '확인')");
  assert(a.danger && !a.primary && a.bg === 'rgb(200, 70, 59)', '지우는 버튼은 빨간색 (' + a.bg + ')');
  assert(a.focus === 'ask-cancel', "지우는 창은 처음 초점이 '취소'에 (Enter를 잘못 눌러도 안 지워짐)");
  await page.keyboard.press('Enter');
  assert((await stateOf(page)).subjects.length === 2 && !(await askInfo(page)).open, 'Enter를 눌러도 지워지지 않고 창만 닫힘');
  await page.tap('#subject-list [data-del-subject]');
  await page.tap('#ask-ok');
  assert((await stateOf(page)).subjects.length === 1, "'삭제'를 누르면 지워짐");
  // 위험하지 않은 확인 창은 평소 모양 그대로 (빨간색이 남지 않음)
  await page.evaluate(() => { window.__p = App.ask('그냥 물어보기'); });
  a = await askInfo(page);
  assert(a.ok === '확인' && !a.danger && a.primary && a.alt === null && a.focus === 'ask-ok', '보통 확인 창은 그대로 (빨간색·세 번째 버튼 없음)');
  await page.keyboard.press('Escape');
  assert((await page.evaluate(() => window.__p)) === false, 'Esc는 취소');
  // 꼭 골라야 하는 창은 Esc로 닫히지 않음
  await page.evaluate(() => { window.__p = App.ask('골라 주세요', { ok: '가', cancel: '나', mustChoose: true }); });
  await page.keyboard.press('Escape');
  assert((await askInfo(page)).open, '꼭 골라야 하는 창은 Esc로 닫히지 않음');
  await page.tap('#ask-cancel');
  // 전체 초기화
  await page.goto(base + '#account');
  await page.tap('#reset-btn');
  a = await askInfo(page);
  assert(a.ok === '모두 삭제' && a.danger, "전체 초기화 버튼은 빨간 '모두 삭제'");
  await page.tap('#ask-cancel');
  await page.context().close();

  /* ===== 2) 타이머 초기화: 1분 넘게 집중했으면 기록할지 묻기 ===== */
  page = await open();
  await page.goto(base + '#timer');
  await page.evaluate(() => localStorage.setItem('studypromotion.welcomeClosed', '1'));
  const ff = (min) => page.evaluate((m) => { const t = window.__studypromotion.timer; t.endAt -= m * 60 * 1000; }, min);
  const timerOf = () => page.evaluate(() => { const t = window.__studypromotion.timer; return { running: t.running, remaining: t.remaining, total: t.total, mode: t.mode }; });
  await page.tap('#timer-start');
  await page.tap('#timer-reset');
  assert(!(await askInfo(page)).open && !(await timerOf()).running, '1분이 안 됐으면 묻지 않고 바로 초기화');
  await page.tap('#timer-start');
  await ff(7);
  await page.tap('#timer-reset');
  a = await askInfo(page);
  assert(a.open && /지금까지 집중한 7분을 기록할까요/.test(a.msg), '7분 집중하다 초기화하면 기록할지 물어봄: ' + a.msg);
  assert(a.ok === '기록하고 초기화' && a.alt === '기록 없이 초기화' && a.cancel === '계속하기', '선택지 세 가지');
  const order = await page.$$eval('#ask .ask-actions .btn:not([hidden])', (els) => els.map((e) => ({ t: e.textContent, y: e.getBoundingClientRect().top, w: e.getBoundingClientRect().width })));
  assert(order.find((o) => o.t === '기록하고 초기화').y < order.find((o) => o.t === '기록 없이 초기화').y && order.find((o) => o.t === '기록 없이 초기화').y < order.find((o) => o.t === '계속하기').y && order.every((o) => o.w > 250), '세 버튼이 세로로 쌓여 글자가 잘리지 않음');
  await page.tap('#ask-cancel');
  assert((await timerOf()).running && (await stateOf(page)).sessions.length === 0, "'계속하기'를 누르면 타이머가 그대로 돎");
  await page.tap('#timer-reset');
  await page.tap('#ask-alt');
  let t = await timerOf();
  assert(!t.running && t.remaining === t.total && (await stateOf(page)).sessions.length === 0, "'기록 없이 초기화'는 기록 없이 처음으로");
  await page.tap('#timer-start');
  await ff(3);
  await page.tap('#timer-start'); // 일시정지
  await page.tap('#timer-reset');
  assert(/3분/.test((await askInfo(page)).msg), '일시정지 중에도 물어봄');
  await page.tap('#ask-ok');
  let st = await stateOf(page);
  t = await timerOf();
  assert(st.sessions.length === 1 && st.sessions[0].minutes === 3 && !t.running && t.remaining === t.total, "'기록하고 초기화'는 3분을 기록하고 처음으로");
  assert(/3분 기록했어요/.test(await toastOf(page)), '기록했다고 알려 줌');
  // 휴식 중에는 묻지 않음
  await page.tap('.mode-switch [data-mode="break"]');
  await page.tap('#timer-start');
  await ff(2);
  await page.tap('#timer-reset');
  assert(!(await askInfo(page)).open && (await stateOf(page)).sessions.length === 1, '휴식 타이머는 묻지 않고 초기화');
  await page.context().close();

  /* ===== 3) 휴대폰 뒤로 가기 버튼 ===== */
  // 설치한 앱처럼 보이게 (display-mode: standalone)
  const standalone = () => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
  };
  page = await open();
  await page.addInitScript(standalone);
  await page.goto(base + '#home');
  await page.evaluate(() => {
    localStorage.setItem('studypromotion.welcomeClosed', '1');
    App.store.update((s) => {
      s.subjects = [{ id: 's-kor', name: '국어', color: '#e05a4f' }];
      s.decks = [{ id: 'd1', name: '영단어' }];
      s.exams = [{ id: 'ex1', name: '기말고사', date: Stats.dayKey(Date.now() + 9 * 864e5), createdAt: Date.now() }];
      s.activeExamId = 'ex1';
      s.topics = [{ id: 'k', examId: 'ex1', parentId: null, kind: 'topic', title: '국어', done: false, flags: {}, order: 0, x: 80, y: 80 }, { id: 'k1', examId: 'ex1', parentId: 'k', kind: 'topic', title: '현대시', done: false, flags: {}, order: 1 }];
    });
  });
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(250); };
  const view = () => page.evaluate(() => App.view);
  const len0 = await page.evaluate(() => history.length);
  await page.tap('.tab[data-view="timer"]');
  await page.tap('.tab[data-view="stats"]');
  await page.tap('.tab[data-view="plan"]');
  assert(await page.evaluate(() => history.length) === len0, '화면을 여러 번 옮겨도 방문 기록이 쌓이지 않음');
  await back();
  assert(await view() === 'home' && await page.evaluate(() => location.hash) === '#home', '다른 화면에서 뒤로 가기 → 홈으로');
  assert(await page.evaluate(() => history.state && history.state.sp) === 'top', '다시 뒤로 갈 수 있게 준비됨');
  // 열린 창은 뒤로 가기로 닫힘
  await page.tap('.tab[data-view="stats"]');
  await page.tap('#view-stats [data-log-open]');
  assert(await page.isVisible('#log-dlg'), '직접 기록 창 열림');
  await back();
  assert(await page.isHidden('#log-dlg') && await view() === 'stats', '뒤로 가기 → 창만 닫히고 화면은 그대로');
  await page.evaluate(() => { window.__p = App.ask('뒤로 가기 확인'); });
  await back();
  assert(await page.isHidden('#ask') && (await page.evaluate(() => window.__p)) === false && await view() === 'stats', '확인 창에서 뒤로 가기 = 취소');
  await page.evaluate(() => { window.__p = App.ask('골라 주세요', { ok: '가', cancel: '나', mustChoose: true }); });
  await back();
  assert(await page.isVisible('#ask') && await view() === 'stats', '꼭 골라야 하는 창은 뒤로 가기로도 닫히지 않음 (화면도 그대로)');
  await page.tap('#ask-ok');
  // 선택 시트
  await page.tap('.tab[data-view="timer"]');
  await page.tap('#view-timer .sel-btn[data-for="timer-subject"]');
  await page.waitForSelector('.ui-back.in');
  await back();
  await page.waitForTimeout(250);
  assert(await page.locator('.ui-back').count() === 0 && await view() === 'timer', '선택 시트도 뒤로 가기로 닫힘');
  // 범위의 ⋯ 메뉴
  await page.tap('.tab[data-view="board"]');
  await page.evaluate(() => Board.setMode('list', false));
  await page.tap('#bb-more');
  assert(await page.isVisible('#pop-menu'), '⋯ 메뉴 열림');
  await back();
  assert(await page.isHidden('#pop-menu') && await view() === 'board', '⋯ 메뉴도 뒤로 가기로 닫힘');
  // 복습에서 덱을 열어 둔 상태
  await page.tap('.tab[data-view="review"]');
  await page.tap('#deck-list [data-deck]');
  assert(await page.isVisible('#deck-back'), '덱 열림');
  await back();
  assert(await page.isHidden('#deck-back') && await view() === 'review', '열어 둔 덱에서 뒤로 가기 → 덱 목록으로');
  await back();
  assert(await view() === 'home', '그다음 뒤로 가기 → 홈');
  // 홈에서: 한 번 더 누르면 닫힘
  await back();
  assert(/한 번 더 누르면 앱이 닫혀요/.test(await toastOf(page)) && await view() === 'home', '홈에서 뒤로 가기 → 한 번 더 누르면 닫힌다고 알려 줌');
  assert(await page.evaluate(() => history.state && history.state.sp) === 'base', '이때 한 번 더 누르면 앱이 닫힘 (방문 기록의 바닥)');
  await page.waitForTimeout(2200);
  assert(await page.evaluate(() => history.state && history.state.sp) === 'top', '2초가 지나면 다시 처음 상태로');
  // 새로 고침해도 칸이 늘지 않음
  const len1 = await page.evaluate(() => history.length);
  await page.reload();
  assert(await page.evaluate(() => history.length) === len1 && await page.evaluate(() => history.state.sp) === 'top', '새로 고침해도 방문 기록이 늘지 않음');
  await page.context().close();

  /* ===== 4) 하루 시작 시각 ===== */
  page = await open();
  await page.clock.install({ time: new Date('2026-11-11T01:30:00+09:00') }); // 11일(수) 새벽 1시 30분
  await page.goto(base + '#home');
  await page.evaluate(() => {
    localStorage.setItem('studypromotion.welcomeClosed', '1');
    const at = (s) => new Date(s + '+09:00').getTime();
    App.store.update((s) => {
      s.subjects = [{ id: 's-kor', name: '국어', color: '#e05a4f' }];
      s.sessions = [
        { id: 'a', subjectId: 's-kor', minutes: 50, endedAt: at('2026-11-10T23:00:00'), label: null, topicId: null },
        { id: 'b', subjectId: 's-kor', minutes: 40, endedAt: at('2026-11-11T01:00:00'), label: null, topicId: null },
        { id: 'c', subjectId: 's-kor', minutes: 30, endedAt: at('2026-11-09T22:00:00'), label: null, topicId: null },
      ];
      s.exams = [{ id: 'ex1', name: '기말고사', date: '2026-11-12', createdAt: Date.now() }];
      s.activeExamId = 'ex1';
      s.topics = [{ id: 'k', examId: 'ex1', parentId: null, kind: 'topic', title: '국어', done: false, flags: {}, order: 0, x: 80, y: 80 }, { id: 'k1', examId: 'ex1', parentId: 'k', kind: 'topic', title: '현대시', done: false, flags: {}, order: 1 }];
    });
  });
  assert((await page.textContent('#h-today')).trim() === '40분', '기본(자정): 새벽 1시 30분에는 오늘 공부가 40분');
  assert(/D-1/.test(await page.textContent('#h-exams')), '기본(자정): 내일 시험은 D-1');
  await page.goto(base + '#account');
  assert(await page.inputValue('#set-daystart') === '0', '하루 시작 시각 기본값은 자정');
  await page.selectOption('#set-daystart', '4');
  await page.tap('#settings-form button[type="submit"]');
  assert((await stateOf(page)).settings.dayStartHour === 4, '새벽 4시로 저장');
  await page.goto(base + '#home');
  assert((await page.textContent('#h-today')).trim() === '1시간 30분', '새벽 4시로 두면 어젯밤 50분 + 새벽 40분이 같은 날로 합쳐짐: ' + (await page.textContent('#h-today')).trim());
  assert((await page.textContent('#h-streak')).trim() === '2일', '연속 학습일도 이어짐 (9일·10일)');
  assert(/D-2/.test(await page.textContent('#h-exams')) && !/D-1/.test(await page.textContent('#h-exams')), '시험 D-day도 같은 기준 (아직 10일이라 D-2)');
  await page.goto(base + '#timer');
  assert(/오늘 공부 1시간 30분 · 집중 2회/.test(await page.textContent('#timer-today')), '타이머 화면의 오늘 공부도 같음');
  await page.goto(base + '#stats');
  const todayCell = await page.$eval('#cal-grid .cal-cell.today', (el) => el.getAttribute('data-cal') + ' ' + el.getAttribute('aria-label'));
  assert(/^2026-11-10 /.test(todayCell) && /1시간 30분/.test(todayCell), '공부 달력의 오늘은 10일, 1시간 30분: ' + todayCell);
  assert(/22:10 ~ 1:00/.test(await page.textContent('#cal-detail')), '그날 시간표가 새벽 1시까지 이어짐: ' + (await page.textContent('#cal-detail .tt-foot')).trim());
  const hours = await page.$$eval('#cal-tt .tt-row:not(.tt-head) .tt-h', (els) => els.map((e) => e.textContent));
  assert(hours.join(',') === '22,23,0', '시간표 줄: 22시, 23시, 0시 (' + hours.join(',') + ')');
  const week = await page.$$eval('#week-chart .wc-col', (els) => els.map((e) => e.querySelector('.wc-label').textContent + ':' + e.querySelector('.wc-val').textContent.trim()));
  assert(week[week.length - 1] === '오늘:1시간 30분' && /^월:30분$/.test(week[week.length - 2]), '최근 7일 그래프도 같은 기준 (' + week.slice(-2).join(' / ') + ')');
  // 다시 열어도 유지
  await page.reload();
  await page.goto(base + '#account');
  assert(await page.inputValue('#set-daystart') === '4', '다시 열어도 설정 유지');
  // 새벽 4시가 지나면 새 하루
  await page.clock.setFixedTime(new Date('2026-11-11T04:05:00+09:00'));
  await page.goto(base + '#home');
  await page.evaluate(() => App.render());
  assert((await page.textContent('#h-today')).trim() === '0분', '새벽 4시가 지나면 오늘 공부가 0분으로 새로 시작');
  assert(/D-1/.test(await page.textContent('#h-exams')), '새벽 4시가 지나면 D-1');
  // 스톱워치: 자정을 넘겨도 나누지 않고, 하루 시작 시각(새벽 4시)을 넘기면 나눈다
  const SW = 'studypromotion.stopwatch';
  const runFrom = async (startIso, nowIso) => {
    await page.clock.setFixedTime(new Date(nowIso + '+09:00'));
    await page.evaluate(([k, startAt]) => {
      App.store.update((st) => { st.sessions = []; });
      localStorage.setItem(k, JSON.stringify({ running: true, startAt, subjectId: 's-kor', last: 's-kor' }));
      window.dispatchEvent(new StorageEvent('storage', { key: k }));
    }, [SW, new Date(startIso + '+09:00').getTime()]);
    await page.waitForTimeout(200);
    await page.evaluate(() => Stopwatch.stop());
    await page.waitForTimeout(200);
    return (await stateOf(page)).sessions.map((x) => ({ minutes: x.minutes, day: new Date(x.endedAt - 4 * 3600e3 + 9 * 3600e3).toISOString().slice(0, 10) }));
  };
  await page.goto(base + '#timer');
  let rec = await runFrom('2026-11-10T23:40:00', '2026-11-11T00:30:00');
  assert(rec.length === 1 && rec[0].minutes === 50 && rec[0].day === '2026-11-10', '스톱워치: 자정을 넘겨도 한 기록으로, 10일 공부로 (' + JSON.stringify(rec) + ')');
  rec = await runFrom('2026-11-11T03:20:00', '2026-11-11T04:30:00');
  assert(rec.length === 2 && rec.some((x) => x.minutes === 40 && x.day === '2026-11-10') && rec.some((x) => x.minutes === 30 && x.day === '2026-11-11'), '스톱워치: 새벽 4시를 넘기면 40분은 10일, 30분은 11일로 나눔 (' + JSON.stringify(rec) + ')');
  await page.context().close();

  /* ===== 5) 집중이 끝나면 이어서 무엇을 할지 고르기 ===== */
  page = await open();
  await page.goto(base + '#timer');
  await page.evaluate(() => {
    localStorage.setItem('studypromotion.welcomeClosed', '1');
    App.store.update((s) => { s.subjects = [{ id: 's-kor', name: '국어', color: '#e05a4f' }, { id: 's-math', name: '수학', color: '#3d96e0' }]; });
  });
  const tm = () => page.evaluate(() => { const x = window.__studypromotion.timer; return { running: x.running, mode: x.mode, remaining: x.remaining, total: x.total }; });
  const sheetOpen = () => page.locator('.ui-back.in .next-sheet').count();
  const endNow = () => page.evaluate(() => { const x = window.__studypromotion.timer; x.endAt = Date.now() - 10; });
  // 집중을 시작해서 끝까지 마친 것처럼: 고르는 창이 뜰 때까지
  const finishFocus = async () => {
    await page.tap('#timer-start');
    await endNow();
    await page.waitForSelector('.ui-back.in .next-sheet');
    await page.waitForTimeout(250);
  };
  const pickNext = async (n) => { await page.tap(`.ui-back.in .next-sheet .ch-opt >> nth=${n}`); await page.waitForTimeout(350); };
  await page.selectOption('#timer-subject', 's-math');
  await finishFocus();
  let m5 = await tm();
  assert(!m5.running && !(await page.evaluate(() => Stopwatch.running())), '집중이 끝나도 고르기 전에는 아무것도 저절로 시작하지 않음');
  const opts5 = await page.$$eval('.ui-back.in .next-sheet .ch-opt b', (els) => els.map((e) => e.textContent));
  assert(opts5.join(' / ') === '스톱워치 켜고 계속 공부하기 / 휴식 타이머 시작하기 / 같은 타이머 다시 시작 / 그냥 끄기', '선택지 네 가지: ' + opts5.join(' / '));
  assert(/집중 25분 끝/.test(await page.textContent('.ui-back.in .next-sheet .ui-sheet-head b')) && /25분은 기록했어요/.test(await page.textContent('.ui-back.in .next-sheet .ch-note')), '창에 끝난 시간과 기록했다는 말이 적혀 있음');
  assert((await stateOf(page)).sessions.length === 1 && (await stateOf(page)).sessions[0].minutes === 25, '집중한 시간은 고르기 전에 이미 기록됨');
  const hints5 = await page.$$eval('.ui-back.in .next-sheet .ch-opt small', (els) => els.map((e) => e.textContent));
  assert(/수학 그대로/.test(hints5[0]) && hints5[1] === '5분' && hints5[2] === '집중 25분', '선택지 아래에 과목·시간이 적혀 있음: ' + hints5.join(' / '));
  const box5 = await page.evaluate(() => { const r = document.querySelector('.ui-back.in .next-sheet').getBoundingClientRect(); const t = document.querySelector('#toast'); return { bottom: r.bottom, vh: innerHeight, toast: t.classList.contains('show') }; });
  assert(box5.bottom <= box5.vh + 1 && !box5.toast, '창이 화면 안에 다 들어오고, 알림이 선택지를 가리지 않음');
  // 휴식 타이머 시작하기
  await pickNext(1);
  m5 = await tm();
  assert(m5.mode === 'break' && m5.running && m5.remaining > m5.total - 5 && !(await sheetOpen()), "'휴식 타이머 시작하기' → 휴식이 바로 돎");
  // 휴식이 끝나면 묻지 않고, 집중은 직접 시작
  await endNow();
  await page.waitForFunction(() => window.__studypromotion.timer.mode === 'focus');
  await page.waitForTimeout(800);
  assert(!(await tm()).running && !(await sheetOpen()), '휴식이 끝난 뒤에는 묻지 않고 집중도 저절로 시작하지 않음');
  // 같은 타이머 다시 시작
  await finishFocus();
  await pickNext(2);
  m5 = await tm();
  assert(m5.mode === 'focus' && m5.running && m5.remaining > m5.total - 5, "'같은 타이머 다시 시작' → 집중 25분이 다시 돎");
  // 그냥 끄기
  await endNow();
  await page.waitForSelector('.ui-back.in .next-sheet');
  await page.waitForTimeout(250);
  await pickNext(3);
  m5 = await tm();
  assert(m5.mode === 'focus' && !m5.running && m5.remaining === m5.total, "'그냥 끄기' → 아무것도 돌지 않고 집중 25:00으로 돌아옴");
  assert((await stateOf(page)).sessions.length === 3, '끝까지 마친 집중 세 번이 모두 기록됨');
  // 창을 그냥 닫아도(✕, 휴대폰 뒤로) 끄기와 같다
  await finishFocus();
  await page.tap('.ui-back.in .next-sheet [data-ui-close]');
  await page.waitForTimeout(350);
  m5 = await tm();
  assert(m5.mode === 'focus' && !m5.running && !(await page.evaluate(() => Stopwatch.running())), '창을 ✕로 닫으면 그냥 끄기와 같음');
  await finishFocus();
  await page.goBack();
  await page.waitForTimeout(400);
  assert(!(await sheetOpen()) && !(await tm()).running && await page.evaluate(() => App.view) === 'timer', "휴대폰 '뒤로'를 누르면 고르는 창만 닫힘");
  // 스톱워치 켜고 계속 공부하기: 같은 과목으로 스톱워치가 켜진다
  await finishFocus();
  await pickNext(0);
  const sw5 = await page.evaluate(() => ({ running: Stopwatch.running(), tab: Stopwatch.tab(), view: App.view, st: JSON.parse(localStorage.getItem('studypromotion.stopwatch')) }));
  assert(sw5.running && sw5.tab === 'sw' && sw5.view === 'timer' && sw5.st.subjectId === 's-math', "'스톱워치 켜고 계속 공부하기' → 수학 그대로 스톱워치가 켜지고 스톱워치 화면으로");
  assert(!(await tm()).running && await page.isVisible('#timer-pane-sw'), '집중 타이머는 멈춰 있음 (같은 시간이 두 번 쌓이지 않게)');
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.waitForTimeout(300);
  // 건너뛰기로 넘어간 집중은 묻지 않는다
  await page.evaluate(() => Stopwatch.showTab('focus'));
  await page.tap('#timer-start');
  await page.tap('#timer-skip');
  await page.waitForTimeout(800);
  m5 = await tm();
  assert(m5.mode === 'break' && !m5.running && !(await sheetOpen()), '건너뛰기로 넘어가면 묻지 않고 휴식은 멈춰 있음 (전과 같음)');
  // 범위에서 시작한 집중: 끝냈는지 먼저 묻고, 그다음에 고른다
  await page.evaluate(() => {
    App.store.update((s) => {
      s.exams = [{ id: 'ex5', name: '중간고사', date: null, createdAt: Date.now() }];
      s.topics = [{ id: 'tp-s', examId: 'ex5', parentId: null, kind: 'topic', title: '수학', done: false, flags: {}, order: 0 }, { id: 'tp-1', examId: 'ex5', parentId: 'tp-s', kind: 'topic', title: '인수분해', done: false, flags: {}, order: 0 }];
    });
    App.focusOn({ label: '수학 · 인수분해', topicId: 'tp-1', subjectName: '수학' });
  });
  await page.waitForTimeout(300);
  await page.tap('#timer-start');
  await endNow();
  await page.waitForSelector('#ask:not([hidden])');
  assert(/인수분해.*끝냈나요/.test(await page.textContent('#ask-msg')) && !(await sheetOpen()), '범위에서 시작한 집중은 끝냈는지 먼저 물어봄');
  await page.tap('#ask-ok');
  await page.waitForSelector('.ui-back.in .next-sheet');
  assert((await stateOf(page)).topics.find((t) => t.id === 'tp-1').done === true, '답한 뒤에 고르는 창이 뜸 (범위는 체크됨)');
  await page.waitForTimeout(250);
  await pickNext(0);
  const sw6 = await page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.stopwatch')));
  assert(sw6.running && sw6.topicId === 'tp-1' && /인수분해/.test(sw6.label || ''), '스톱워치로 이어 가면 공부하던 범위도 함께 이어짐: ' + sw6.label);
  await page.evaluate(() => { const k = 'studypromotion.stopwatch'; const x = JSON.parse(localStorage.getItem(k)); x.startAt -= 5 * 60000; localStorage.setItem(k, JSON.stringify(x)); window.dispatchEvent(new StorageEvent('storage', { key: k })); });
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.waitForTimeout(400);
  const last5 = (await stateOf(page)).sessions.slice(-1)[0];
  assert(last5.kind === 'stopwatch' && last5.minutes === 5 && last5.topicId === 'tp-1' && /인수분해/.test(last5.label || ''), '이어서 잰 5분도 그 범위의 공부로 기록됨');
  // 예전 미리 보기에 있던 '휴식 바로 시작' 설정은 없다
  await page.goto(base + '#account');
  assert((await page.locator('#set-autobreak').count()) === 0, "'집중이 끝나면 휴식 바로 시작' 설정은 넣지 않음 (고르는 창으로 대신함)");
  await page.context().close();

  /* ===== 6) 최근 7일을 그 전 7일과 비교 ===== */
  page = await open();
  await page.goto(base + '#stats');
  assert(await page.isHidden('#week-compare'), '그 전 7일 기록이 없으면 비교 줄이 안 보임');
  await page.evaluate(() => App.store.update((st) => {
    const t = Date.now();
    st.sessions = [
      { id: 'w1', subjectId: null, minutes: 120, endedAt: t - 1 * 864e5, label: null },
      { id: 'w2', subjectId: null, minutes: 60, endedAt: t - 3 * 864e5, label: null },
      { id: 'p1', subjectId: null, minutes: 100, endedAt: t - 9 * 864e5, label: null },
    ];
  }));
  assert((await page.textContent('#week-compare')).trim() === '그 전 7일보다 1시간 20분 더 했어요' && await page.isVisible('#week-compare'), '최근 7일이 그 전 7일보다 얼마나 많은지 한 줄로: ' + (await page.textContent('#week-compare')).trim());
  await page.evaluate(() => App.store.update((st) => { st.sessions.find((x) => x.id === 'p1').minutes = 400; }));
  assert((await page.textContent('#week-compare')).trim() === '그 전 7일보다 3시간 40분 덜 했어요', '적으면 덜 했다고: ' + (await page.textContent('#week-compare')).trim());
  await page.context().close();

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
