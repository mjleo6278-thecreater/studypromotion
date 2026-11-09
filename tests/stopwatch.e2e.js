// 타이머 시간 직접 정하기, 스톱워치(열품타처럼 과목별로 공부 시간 재기) 테스트
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
const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const SW = 'studypromotion.stopwatch';

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  // 자정 근처에 테스트가 돌아도 같게: 시계를 오늘 오후 3시로 맞춰 둔다 (흐르기는 그대로, 새로고침·다른 창도 같은 시계)
  await ctx.addInitScript(() => {
    const real = Date.now.bind(Date);
    let shift = Number(localStorage.getItem('__shift'));
    if (!shift) {
      const d = new Date(real());
      shift = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 15, 0, 0).getTime() - real();
      localStorage.setItem('__shift', String(shift));
    }
    window.__shift = shift;
    Date.now = () => real() + window.__shift;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const swState = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SW);
  const toastText = () => page.textContent('#toast');
  const swSessions = async () => (await state()).sessions.filter((s) => s.kind === 'stopwatch');
  // 스톱워치를 n초 전에 시작한 것처럼
  const backdate = (sec) => page.evaluate(([k, sec]) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.startAt -= sec * 1000;
    localStorage.setItem(k, JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage', { key: k }));
  }, [SW, sec]);

  await page.goto(base + '#home');
  const subs = (await state()).subjects;
  const kor = subs.find((s) => s.name === '국어'), math = subs.find((s) => s.name === '수학'), eng = subs.find((s) => s.name === '영어');
  await page.evaluate((id) => App.store.update((s) => { s.sessions.push({ id: 'seed', subjectId: id, minutes: 50, endedAt: Date.now() - 3600e3, label: null, topicId: null }); }), kor.id);

  /* ---------- 1) 집중 타이머: 시간 직접 정하기 ---------- */
  await page.goto(base + '#timer');
  assert(await page.isVisible('#timer-pane-focus') && !(await page.isVisible('#timer-pane-sw')), '처음엔 집중 타이머 탭');
  assert(await page.isVisible('#len-chips [data-len-edit]'), '‘직접’ 칩');
  await page.tap('#len-chips [data-len-edit]');
  assert(await page.evaluate(() => document.activeElement && document.activeElement.id === 'len-input'), '누르면 분을 적는 칸에 바로 입력');
  assert((await page.inputValue('#len-input')) === '25', '지금 시간이 미리 들어 있음');
  await page.fill('#len-input', '45');
  await page.press('#len-input', 'Enter');
  assert((await state()).settings.focusMin === 45 && (await page.textContent('#timer-time')) === '45:00', '45분 직접 설정 → 45:00');
  assert((await page.getAttribute('#len-chips [data-len="45"]', 'aria-pressed')) === 'true', '45분 칩이 골라진 상태로 보임');
  await page.tap('#len-chips [data-len-edit]');
  await page.fill('#len-input', '500');
  await page.press('#len-input', 'Enter');
  assert((await state()).settings.focusMin === 180 && /180분까지/.test(await toastText()), '너무 크면 180분으로 맞추고 알려 줌');
  await page.tap('#len-chips [data-len-edit]');
  await page.fill('#len-input', '0');
  await page.press('#len-input', 'Enter');
  assert(await page.isVisible('#len-input') && /1분 이상/.test(await toastText()), '0분은 안 받고 칸이 그대로');
  await page.press('#len-input', 'Escape');
  assert(!(await page.isVisible('#len-input')) && (await state()).settings.focusMin === 180, 'Esc로 닫으면 그대로');
  // 칸 밖을 누르면 적은 값으로
  await page.tap('#len-chips [data-len-edit]');
  await page.fill('#len-input', '70');
  await page.tap('#timer-today');
  await page.waitForTimeout(350);
  assert((await state()).settings.focusMin === 70 && (await page.textContent('#timer-time')) === '70:00', '칸 밖을 누르면 적은 시간으로 (휴대폰 키보드 ‘완료’)');
  // 다른 저장이 일어나도 적던 칸이 지워지지 않음
  await page.tap('#len-chips [data-len-edit]');
  await page.fill('#len-input', '3');
  await page.evaluate(() => App.store.update((s) => { s.settings.dailyGoalMin = (s.settings.dailyGoalMin || 0) + 1; }));
  assert((await page.inputValue('#len-input')) === '3', '적는 중에 다른 기록이 바뀌어도 칸 유지');
  await page.press('#len-input', 'Escape');
  // 휴식은 60분까지
  await page.tap('.mode-switch [data-mode="break"]');
  await page.tap('#len-chips [data-len-edit]');
  assert((await page.getAttribute('#len-input', 'max')) === '60', '휴식은 60분까지');
  await page.fill('#len-input', '20');
  await page.press('#len-input', 'Enter');
  assert((await state()).settings.breakMin === 20 && (await page.textContent('#timer-time')) === '20:00', '휴식 20분 직접 설정');
  await page.tap('.mode-switch [data-mode="focus"]');
  // 설정 화면에서도 180분까지
  await page.goto(base + '#account');
  assert((await page.getAttribute('#set-focus', 'max')) === '180' && (await page.inputValue('#set-focus')) === '70', '설정 화면 집중 시간도 같은 값, 180분까지');

  /* ---------- 2) 스톱워치 ---------- */
  await page.goto(base + '#timer');
  await page.tap('[data-ttab="sw"]');
  assert(await page.isVisible('#timer-pane-sw') && !(await page.isVisible('#timer-pane-focus')), '스톱워치 탭');
  assert((await page.getAttribute('[data-ttab="sw"]', 'aria-selected')) === 'true', '탭 선택 상태를 화면 읽기 프로그램에 알림');
  assert((await page.textContent('#sw-total')) === '00:50:00', '오늘 공부한 시간 (이미 기록된 50분)');
  assert((await page.textContent(`#sw-list [data-sw-time="${kor.id}"]`)) === '00:50:00', '과목별 오늘 시간');
  assert(/국어 시작/.test(await page.textContent('#sw-main')), '큰 버튼: 첫 과목으로 시작');
  await page.reload();
  assert(await page.isVisible('#timer-pane-sw'), '다시 열어도 스톱워치 탭');

  // 수학 시작 → 30분 지난 것처럼
  await page.tap(`#sw-list [data-sw="${math.id}"]`);
  let st = await swState();
  assert(st.running && st.subjectId === math.id, '과목을 누르면 그 과목으로 시작');
  assert(await page.isVisible('#sw-now') && (await page.textContent('#sw-now-name')) === '수학', '지금 재는 과목 표시');
  assert(await page.$eval('.tab[data-view="timer"]', (el) => el.classList.contains('sw-on')), '하단 타이머 탭에 재는 중 점');
  assert(/멈추고 기록/.test(await page.textContent('#sw-main')), '큰 버튼이 멈추기로');
  await backdate(30 * 60 + 5);
  await page.waitForTimeout(400);
  assert(/^00:30:0\d$/.test(await page.textContent('#sw-now-time')), '이번에 잰 시간 ' + (await page.textContent('#sw-now-time')));
  assert(/^01:20:0\d$/.test(await page.textContent('#sw-total')), '오늘 합계에 바로 더해짐');
  assert(/^\d\d:\d\d:\d\d · 수학$/.test(await page.title()), '창 제목에 시간 · 과목');
  await page.reload();
  assert((await swState()).running && /^00:30:0\d$/.test(await page.textContent('#sw-now-time')), '앱을 닫았다 열어도 이어서 잼');

  // 재는 중에 영어를 누르면: 수학을 기록하고 영어로
  await page.tap(`#sw-list [data-sw="${eng.id}"]`);
  let rec = await swSessions();
  assert(rec.length === 1 && rec[0].subjectId === math.id && rec[0].minutes === 30 && rec[0].sec >= 1805 && rec[0].sec < 1815, '다른 과목을 누르면 지금까지를 기록 (' + JSON.stringify(rec[0]) + ')');
  st = await swState();
  assert(st.running && st.subjectId === eng.id, '바로 그 과목으로 이어서 잼');
  assert(/수학 30분 기록 · 영어 시작/.test(await toastText()), '바꿨다고 알림');
  // 1분이 안 되면 기록하지 않음
  await page.tap('#sw-main');
  assert(!(await swState()).running && (await swSessions()).length === 1 && /1분이 안 돼서/.test(await toastText()), '1분 안 되는 건 기록하지 않음');
  assert(/영어 시작/.test(await page.textContent('#sw-main')), '다음엔 마지막 과목으로 시작');
  assert(!(await page.$eval('.tab[data-view="timer"]', (el) => el.classList.contains('sw-on'))), '멈추면 점이 사라짐');

  // 스페이스 키 (PC)
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press(' ');
  assert((await swState()).running, '스페이스로 시작');
  await backdate(12 * 60);
  await page.keyboard.press(' ');
  rec = await swSessions();
  assert(!(await swState()).running && rec.length === 2 && rec[1].subjectId === eng.id && rec[1].minutes === 12, '스페이스로 멈추고 기록');

  // 너무 오래 켜져 있었으면 물어봄
  await page.tap('#sw-main');
  await backdate(6 * 3600);
  await page.tap('#sw-main');
  assert(await page.isVisible('#ask') && /켜져 있었어요/.test(await page.textContent('#ask-msg')), '5시간 넘게 켜져 있었으면 기록 전에 물어봄');
  await page.tap('#ask-cancel');
  assert(!(await swState()).running && (await swSessions()).length === 2 && /기록하지 않았어요/.test(await toastText()), '기록하지 않기를 고르면 남기지 않음');
  assert(await page.isVisible('#toast .toast-act'), '직접 기록할 수 있게 알림에 버튼');

  // 자정을 넘기면 날마다 나눠서 기록 (어제 23:30 ~ 오늘 00:40)
  const split = await page.evaluate(([k, id]) => {
    const d = new Date(Date.now());
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const real = Date.now() - window.__shift;
    window.__saved = window.__shift;
    window.__shift = midnight + 40 * 60e3 - real;
    localStorage.setItem(k, JSON.stringify({ running: true, startAt: midnight - 30 * 60e3, subjectId: id, last: id }));
    window.dispatchEvent(new StorageEvent('storage', { key: k }));
    return midnight;
  }, [SW, kor.id]);
  await page.waitForTimeout(300);
  // 국어: 이미 기록된 50분 + 자정 이후 40분 (자정 전 30분은 빼고)
  assert(/^01:30:\d\d$/.test(await page.textContent(`#sw-list [data-sw-time="${kor.id}"]`)) && /^01:10:\d\d$/.test(await page.textContent('#sw-now-time')), '오늘 몫은 자정 이후만, 이번 시간은 전부 (' + (await page.textContent(`#sw-list [data-sw-time="${kor.id}"]`)) + ')');
  await page.tap('#sw-main');
  rec = (await swSessions()).filter((s) => s.subjectId === kor.id);
  const y = rec.find((s) => dayKey(s.endedAt) === dayKey(split - 1)), t = rec.find((s) => dayKey(s.endedAt) === dayKey(split));
  assert(rec.length === 2 && y && y.minutes === 30 && t && t.minutes === 40, '자정 전 30분은 어제, 뒤 40분은 오늘로 (' + rec.map((s) => dayKey(s.endedAt) + ' ' + s.minutes).join(', ') + ')');
  // 자정 앞뒤 조각이 둘 다 1분이 안 되면(23:59:30~00:00:40) 합쳐서 끝난 날로
  await page.evaluate(([k, id, midnight]) => {
    const real = Date.now() - window.__shift;
    window.__shift = midnight + 40e3 - real;
    localStorage.setItem(k, JSON.stringify({ running: true, startAt: midnight - 30e3, subjectId: id, last: id }));
    window.dispatchEvent(new StorageEvent('storage', { key: k }));
  }, [SW, eng.id, split]);
  await page.tap('#sw-main');
  const tiny = (await swSessions()).find((s) => s.id === 'sw-' + (split - 30e3));
  assert(tiny && tiny.sec >= 70 && tiny.sec < 75 && tiny.minutes === 1 && dayKey(tiny.endedAt) === dayKey(split), '자정 앞뒤 짧은 조각은 합쳐서 오늘로 (' + JSON.stringify(tiny) + ')');
  await page.evaluate(() => { window.__shift = window.__saved; });

  /* ---------- 3) 집중 타이머와 함께 쓰기 (같은 시간을 두 번 기록하지 않게) ---------- */
  await page.tap(`#sw-list [data-sw="${kor.id}"]`);
  await backdate(10 * 60);
  await page.tap('[data-ttab="focus"]');
  await page.tap('#timer-start');
  assert(await page.isVisible('#ask') && /스톱워치/.test(await page.textContent('#ask-msg')), '스톱워치가 도는 중에 집중 타이머를 켜면 물어봄');
  await page.tap('#ask-ok');
  await page.waitForTimeout(100);
  assert(!(await swState()).running && (await page.textContent('#timer-start')) === '일시정지', '스톱워치를 멈추고 기록한 뒤 집중 타이머 시작');
  assert((await swSessions()).some((s) => s.subjectId === kor.id && s.minutes === 10), '스톱워치 10분 기록');
  // 집중 7분째에 스톱워치를 켜면: 집중 7분을 기록하고 타이머는 처음으로
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('studypromotion.timer'));
    t.endAt = Date.now() + (t.total - 7 * 60) * 1000;
    localStorage.setItem('studypromotion.timer', JSON.stringify(t));
    window.dispatchEvent(new StorageEvent('storage', { key: 'studypromotion.timer', newValue: JSON.stringify(t) }));
  });
  const before = (await state()).sessions.length;
  await page.tap('[data-ttab="sw"]');
  await page.tap(`#sw-list [data-sw="${math.id}"]`);
  assert(await page.isVisible('#ask') && /집중 타이머가 진행 중/.test(await page.textContent('#ask-msg')), '집중 타이머가 도는 중에 스톱워치를 켜면 물어봄');
  await page.tap('#ask-ok');
  const after = await state();
  const focus7 = after.sessions.slice(before).find((s) => !s.kind && s.minutes === 7);
  assert(focus7 && (await swState()).running, '집중 7분을 기록하고 스톱워치 시작');
  await page.tap('[data-ttab="focus"]');
  assert((await page.textContent('#timer-start')) === '시작' && (await page.textContent('#timer-time')) === '70:00', '집중 타이머는 처음으로');
  // 잠금 모드를 켜면 스톱워치는 멈추고 기록
  await backdate(5 * 60);
  await page.click('[data-lock="30"]');
  await page.click('#lock-start');
  assert(/스톱워치는 멈추고/.test(await page.textContent('#ask-msg')), '잠금 시작 전에 스톱워치를 멈춘다고 알림');
  await page.click('#ask-ok');
  await page.waitForTimeout(100);
  assert(!(await swState()).running && (await swSessions()).some((s) => s.subjectId === math.id && s.minutes === 5) && await page.isVisible('#lock-screen'), '스톱워치 5분 기록 후 잠금');
  // 30분이 지난 것처럼 (다른 창에서 잠금이 끝난 것과 같은 길로)
  const endLock = async () => {
    await page.evaluate(() => {
      const l = JSON.parse(localStorage.getItem('studypromotion.lock'));
      l.startAt = Date.now() - 30 * 60000; l.endAt = Date.now() - 1000;
      localStorage.setItem('studypromotion.lock', JSON.stringify(l));
      window.dispatchEvent(new StorageEvent('storage', { key: 'studypromotion.lock', newValue: JSON.stringify(l) }));
    });
    await page.waitForTimeout(100);
  };
  await endLock();
  assert(await page.isHidden('#lock-screen'), '잠금 끝');
  // 집중 타이머가 도는 중에 잠가도: 집중은 지금까지를 기록하고 멈춤 (잠금 시간과 겹쳐 두 번 쌓이지 않게)
  await page.tap('#timer-start');
  await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('studypromotion.timer'));
    t.endAt = Date.now() + (t.total - 6 * 60) * 1000;
    localStorage.setItem('studypromotion.timer', JSON.stringify(t));
    window.dispatchEvent(new StorageEvent('storage', { key: 'studypromotion.timer', newValue: JSON.stringify(t) }));
  });
  const n0 = (await state()).sessions.length;
  await page.click('#lock-start');
  assert(/집중 타이머는 멈추고/.test(await page.textContent('#ask-msg')), '잠금 시작 전에 집중 타이머를 멈춘다고 알림');
  await page.click('#ask-ok');
  await page.waitForTimeout(100);
  const s6 = (await state()).sessions.slice(n0).find((x) => !x.kind && !x.lock && x.minutes === 6);
  assert(s6 && (await page.evaluate(() => App.timerBusy())) === null && await page.isVisible('#lock-screen'), '집중 6분을 기록하고 잠금, 타이머는 처음으로');
  await endLock();
  assert(await page.isHidden('#lock-screen'), '잠금 끝 (두 번째)');

  // 범위·홈에서 ▶로 오면 집중 타이머 탭
  await page.tap('[data-ttab="sw"]');
  await page.evaluate(() => App.focusOn({ label: '1단원', topicId: null }));
  assert(await page.isVisible('#timer-pane-focus') && /1단원/.test(await page.textContent('#timer-topic-text')), '범위에서 타이머를 열면 집중 타이머 탭');

  // 두 창: 한 창에서 시작하면 다른 창도 재는 중
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push('2: ' + e.message));
  await page2.goto(base + '#timer');
  await page.tap('[data-ttab="sw"]');
  await page.tap(`#sw-list [data-sw="${eng.id}"]`);
  await page2.waitForTimeout(200);
  assert(await page2.evaluate(() => Stopwatch.running()), '다른 창도 재는 중으로 맞춤');
  await page2.evaluate(() => Stopwatch.showTab('sw'));
  assert((await page2.textContent('#sw-list .sw-row.on .sw-name')) === '영어', '다른 창에도 영어가 재는 중으로 보임');
  await backdate(3 * 60);
  await page2.tap('#sw-main');
  await page.waitForTimeout(200);
  assert(!(await page.evaluate(() => Stopwatch.running())) && (await swSessions()).filter((s) => s.subjectId === eng.id && s.minutes === 3).length === 1, '다른 창에서 멈추면 이 창도 멈추고 한 번만 기록');
  await page2.close();

  // 기록 목록에 ‘스톱워치’ 표시
  await page.goto(base + '#stats');
  assert(/스톱워치/.test(await page.textContent('#session-list')), '공부 기록에 스톱워치 표시');

  // 과목이 없으면 ‘과목 없이’와 과목 만들기 안내
  await page.evaluate(() => App.store.update((s) => { s.subjects = []; }));
  await page.goto(base + '#timer');
  await page.tap('[data-ttab="sw"]');
  assert(await page.isVisible('#sw-empty') && (await page.$$('#sw-list .sw-row')).length === 1, '과목이 없으면 ‘과목 없이’ 하나와 과목 만들기 안내');
  assert((await page.textContent('#sw-main')).trim() === '시작', '과목 없이 시작');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '가로 스크롤 없음');
  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
