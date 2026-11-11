// 개선안(미리 보기) 확인: 분명한 확인 창, 타이머 초기화 때 기록 묻기, 휴대폰 뒤로 가기, 하루 시작 시각
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

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
