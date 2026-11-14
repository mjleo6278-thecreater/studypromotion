// v2.9 새 기능 확인: 타임테이블(홈의 오늘 한 줄, 날짜별 화면), 홈 ‘공부 시작하기’(과목 → 할 일 → 스톱워치), 버전별 업데이트 소식
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
  // 시계를 오늘 오후 4시 20분으로 맞춘다 (흐르기는 그대로). hour를 주면 그 시각으로
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
  const swState = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SW);
  const backdate = (page, min) => page.evaluate(([k, min]) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.startAt -= min * 60000;
    localStorage.setItem(k, JSON.stringify(s));
    window.dispatchEvent(new StorageEvent('storage', { key: k }));
  }, [SW, min]);
  const sheetTitle = (page) => page.textContent('.ui-back.in .ui-sheet-head b');
  const sheetOpts = (page) => page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent));
  const pick = async (page, n) => { await page.tap(`.ui-back.in .ch-opt >> nth=${n}`); await page.waitForTimeout(350); };
  // 오늘 h시 mi분에 끝난 기록
  const seed = (page, list) => page.evaluate((list) => {
    const d = new Date(Date.now());
    App.store.update((s) => {
      list.forEach((x, i) => {
        const endedAt = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (x.day || 0), x.h, x.m).getTime();
        s.sessions.push(Object.assign({ id: x.id || 'seed' + i + '-' + endedAt, subjectId: x.sid || null, minutes: x.min, endedAt, label: x.label || null, topicId: null }, x.manual ? { manual: true } : {}, x.sw ? { kind: 'stopwatch', sec: x.min * 60 } : {}));
      });
    });
  }, list);
  const rows = (page) => page.$$eval('#ttv-grid .tt-row:not(.tt-head)', (els) => els.map((r) => ({
    hour: +r.querySelector('.tt-h').textContent, now: r.classList.contains('now'),
    segs: [...r.querySelectorAll('.tt-bar i')].map((i) => ({ left: parseFloat(i.style.left), width: parseFloat(i.style.width), color: i.style.background, live: i.classList.contains('live') })),
  })));

  /* ===== 1) 홈: 공부 시작하기 단추와 오늘 타임테이블 (기록이 없을 때) ===== */
  let page = await open();
  await page.goto(base + '#home');
  await page.waitForFunction(() => window.App && window.Timetable && window.Stopwatch);
  let st = await state(page);
  const kor = st.subjects.find((s) => s.name === '국어'), math = st.subjects.find((s) => s.name === '수학'), eng = st.subjects.find((s) => s.name === '영어');
  assert(kor && math && eng, '기본 과목 국어·수학·영어');
  assert(await page.isVisible('#h-start') && /공부 시작하기/.test(await page.textContent('#h-start')) && await page.isHidden('#h-sw-live'), "홈 ‘오늘 공부’ 칸에 ‘공부 시작하기’ 단추");
  assert(await page.isVisible('#h-tt .day-strip') && (await page.locator('#h-tt .ds-bar i').count()) === 0 && /공부를 시작하면/.test(await page.textContent('#h-tt')), '오늘 타임테이블: 기록이 없으면 빈 띠와 안내');
  assert((await page.$$eval('#h-tt .ds-ticks span', (els) => els.map((e) => e.textContent))).join(',') === '0,6,12,18,24', '띠 아래에 0·6·12·18·24시');
  const nowLeft = await page.$eval('#h-tt .ds-now', (el) => parseFloat(el.style.left));
  assert(near(nowLeft, ((16 * 60 + 20) / 1440) * 100, 0.3), '지금 시각(16:20) 자리에 표시: ' + nowLeft.toFixed(1) + '%');
  let fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, btn: document.querySelector('#h-start').getBoundingClientRect(), card: document.querySelector('#h-start').closest('.stat').getBoundingClientRect() }));
  assert(fit.sw <= fit.cw && fit.btn.right <= fit.card.right && fit.btn.left >= fit.card.left && fit.btn.height >= 28, '휴대폰(360)에서 단추가 칸 안에 들어가고 화면이 옆으로 밀리지 않음');

  /* ===== 2) 공부 시작하기: 과목 → 할 일 → 스톱워치 ===== */
  await page.evaluate(([m, e]) => App.store.update((s) => {
    const today = App.todayKey();
    s.tasks.push({ id: 't-late', title: '오답 노트 정리', subjectId: m, due: null, estimateMin: null, done: false, createdAt: 1 });
    s.tasks.push({ id: 't-today', title: '문제집 3단원 풀기', subjectId: m, due: today, estimateMin: 60, done: false, createdAt: 2 });
    s.tasks.push({ id: 't-done', title: '끝낸 일', subjectId: m, due: today, estimateMin: null, done: true, doneAt: Date.now(), createdAt: 3 });
    s.tasks.push({ id: 't-none', title: '과목 없는 일', subjectId: null, due: null, estimateMin: 30, done: false, createdAt: 4 });
  }), [math.id, eng.id]);
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  assert((await sheetTitle(page)) === '어떤 과목을 공부할까요?' && (await sheetOpts(page)).join(',') === '국어,수학,영어,과목 없이', '첫 창: 과목 고르기 (국어·수학·영어·과목 없이)');
  assert(await page.$eval('.ui-back.in .ch-opt >> nth=1', (el) => { const d = el.querySelector('.sel-dot'); return !!d && d.style.background !== ''; }), '과목마다 과목 색 점');
  // ✕로 닫으면 아무것도 시작하지 않는다
  await page.tap('.ui-back.in [data-ui-close]');
  await page.waitForTimeout(300);
  assert(!(await page.evaluate(() => Stopwatch.running())) && await page.evaluate(() => App.view) === 'home', '과목 창을 닫으면 아무것도 시작하지 않음');
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await pick(page, 1); // 수학
  await page.waitForSelector('.ui-back.in .start-sheet');
  assert(/수학/.test(await sheetTitle(page)) && /할 일/.test(await sheetTitle(page)), '둘째 창: 수학의 할 일 고르기');
  let opts = await sheetOpts(page);
  assert(opts.join(' | ') === '문제집 3단원 풀기 | 오답 노트 정리 | 할 일 없이 수학만 공부하기', '수학의 안 끝낸 할 일만, 마감이 있는 것부터, 맨 아래는 과목만: ' + opts.join(' | '));
  assert(/오늘까지 · 1시간/.test(await page.textContent('.ui-back.in .ch-opt >> nth=0')), '할 일 아래에 마감과 예상 시간');
  // 할 일 창을 닫아도 시작하지 않는다
  await page.tap('.ui-back.in [data-ui-close]');
  await page.waitForTimeout(300);
  assert(!(await page.evaluate(() => Stopwatch.running())), '할 일 창을 닫으면 시작하지 않음');
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await pick(page, 1);
  await page.waitForSelector('.ui-back.in .start-sheet');
  await pick(page, 0); // 문제집 3단원 풀기
  let sw = await swState(page);
  assert(sw.running && sw.subjectId === math.id && sw.label === '문제집 3단원 풀기' && sw.taskId === 't-today', '할 일을 고르면 그 과목으로 스톱워치가 켜짐 (할 일 이름과 함께)');
  assert(await page.evaluate(() => App.view === 'timer' && Stopwatch.tab() === 'sw') && await page.isVisible('#timer-pane-sw'), '스톱워치 화면으로 넘어감');
  assert(/수학 · 문제집 3단원 풀기/.test(await page.textContent('#sw-now-name')), '재는 중 표시에 과목과 할 일 이름');
  await backdate(page, 12);
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(200);
  assert(await page.isHidden('#h-start') && await page.isVisible('#h-sw-live'), '재는 동안 홈에는 ‘공부 시작하기’ 대신 재는 중 표시');
  assert((await page.locator('#h-tt .ds-bar i.live').count()) === 1 && /수학/.test(await page.textContent('#h-tt .tt-legend')) && /12분/.test(await page.textContent('#h-tt .tt-legend')), '홈 타임테이블에 지금 재는 12분이 바로 칠해짐');

  /* ===== 3) 타임테이블 화면: 재는 중 구간, 멈추면 기록 ===== */
  await page.tap('#h-tt .day-strip');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => App.view) === 'timetable' && await page.isVisible('#view-timetable'), '홈의 띠를 누르면 타임테이블 화면');
  assert(/오늘/.test(await page.textContent('#ttv-title')) && !(await page.isDisabled('#ttv-next')) && await page.isHidden('#ttv-today'), '오늘을 보여 주고, 일정을 넣으려고 내일로도 넘어갈 수 있음 (v2.11)');
  let rs = await rows(page);
  assert(rs.length === 18 && rs[0].hour === 6 && rs[17].hour === 23, '공부하지 않은 새벽은 접고 6시부터 23시까지 18줄: ' + rs.map((r) => r.hour).join(','));
  const r16 = rs.find((r) => r.hour === 16);
  assert(r16.now && r16.segs.length === 1 && r16.segs[0].live && near(r16.segs[0].left, (8 / 60) * 100, 1) && near(r16.segs[0].width, 20, 1), '16시 줄에 16:08~16:20 재는 중 구간 (왼쪽 ' + r16.segs[0].left.toFixed(1) + '%, 너비 ' + r16.segs[0].width.toFixed(1) + '%)');
  assert(near(await page.$eval('#ttv-grid .tt-now', (el) => parseFloat(el.style.left)), (20 / 60) * 100, 1), '지금 시각 표시가 16:20 자리에');
  assert(/12분/.test(await page.textContent('#ttv-sum')) && /16:08 ~ 지금/.test(await page.textContent('#ttv-sum')), '합계에 재는 중인 시간이 들어감: ' + (await page.textContent('#ttv-sum')));
  assert(/재는 중/.test(await page.textContent('#ttv-list')) && /문제집 3단원 풀기/.test(await page.textContent('#ttv-list')) && (await page.locator('#ttv-list [data-tt-del]').count()) === 0, '기록 목록에 재는 중인 줄 (아직 지울 기록은 없음)');
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.waitForTimeout(400);
  st = await state(page);
  const rec = st.sessions.slice(-1)[0];
  assert(st.sessions.length === 1 && rec.kind === 'stopwatch' && rec.minutes === 12 && rec.subjectId === math.id && rec.label === '문제집 3단원 풀기', '멈추면 12분이 할 일 이름과 함께 기록됨');
  rs = await rows(page);
  assert(rs.find((r) => r.hour === 16).segs.length === 1 && !rs.find((r) => r.hour === 16).segs[0].live, '멈춘 뒤에는 기록된 칸으로 남음');
  assert(/수학 · 문제집 3단원 풀기 12분 기록했어요/.test(await toastOf(page)) && /할 일 완료/.test(await toastOf(page)), '알림에 ‘할 일 완료’ 단추');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(200);
  assert((await state(page)).tasks.find((t) => t.id === 't-today').done === true, '‘할 일 완료’를 누르면 그 할 일이 체크됨');

  /* ===== 4) 과목만 고르기, 할 일이 없는 과목, 과목 없이 ===== */
  await page.evaluate(() => App.go('home'));
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await pick(page, 1);
  await page.waitForSelector('.ui-back.in .start-sheet');
  opts = await sheetOpts(page);
  assert(opts.join(' | ') === '오답 노트 정리 | 할 일 없이 수학만 공부하기', '끝낸 할 일은 목록에서 빠짐');
  await pick(page, 1); // 과목만
  sw = await swState(page);
  assert(sw.running && sw.subjectId === math.id && sw.label === null && sw.taskId === null, '‘할 일 없이 수학만’ → 과목만으로 시작');
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => App.go('home'));
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await pick(page, 0); // 국어: 할 일 없음
  sw = await swState(page);
  assert(sw.running && sw.subjectId === kor.id && (await page.locator('.ui-back.in').count()) === 0, '할 일이 없는 과목은 할 일 창 없이 바로 시작');
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => App.go('home'));
  await page.tap('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  await pick(page, 3); // 과목 없이
  await page.waitForSelector('.ui-back.in .start-sheet');
  opts = await sheetOpts(page);
  assert(opts.join(' | ') === '과목 없는 일 | 할 일 없이 시작하기', '‘과목 없이’는 과목이 없는 할 일을 보여 줌');
  await pick(page, 0);
  sw = await swState(page);
  assert(sw.running && sw.subjectId === '' && sw.label === '과목 없는 일', '과목 없이 + 할 일로 시작');
  // 재는 중에 과목을 바꾸면 할 일 이름은 따라가지 않는다
  await page.tap(`#sw-list [data-sw="${eng.id}"]`);
  await page.waitForTimeout(300);
  sw = await swState(page);
  assert(sw.running && sw.subjectId === eng.id && sw.label === null && sw.taskId === null, '재는 중에 다른 과목으로 바꾸면 할 일 이름은 비워짐');
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.waitForTimeout(300);
  // 과목이 하나도 없으면 묻지 않고 바로 시작
  await page.evaluate(() => App.store.update((s) => { s.subjects = []; s.tasks = []; }));
  await page.evaluate(() => App.go('home'));
  await page.tap('#h-start');
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => Stopwatch.running() && App.view === 'timer') && (await page.locator('.ui-back.in').count()) === 0, '과목도 할 일도 없으면 묻지 않고 바로 스톱워치 시작');
  await page.evaluate(() => { Stopwatch.stop(); });
  await page.context().close();

  /* ===== 5) 타임테이블 화면: 칸 위치, 직접 기록, 날짜 옮기기, 기록 지우기 ===== */
  page = await open();
  await page.goto(base + '#home');
  await page.waitForFunction(() => window.App && window.Timetable);
  st = await state(page);
  const K = st.subjects.find((s) => s.name === '국어').id, M = st.subjects.find((s) => s.name === '수학').id;
  const colorOf = (id) => st.subjects.find((s) => s.id === id).color;
  await seed(page, [
    { id: 'a', h: 9, m: 55, min: 50, sid: K }, // 9:05~9:55
    { id: 'b', h: 11, m: 40, min: 85, sid: M, sw: true, label: '문제집 3단원' }, // 10:15~11:40
    { id: 'c', h: 13, m: 0, min: 30, sid: K, manual: true, label: '직접 기록' },
    { id: 'd', h: 4, m: 30, min: 20, sid: M }, // 새벽 4:10~4:30
    { id: 'y', day: -1, h: 20, m: 0, min: 60, sid: M }, // 어제 19:00~20:00
  ]);
  await page.evaluate(() => App.go('timetable'));
  await page.waitForTimeout(200);
  rs = await rows(page);
  assert(rs[0].hour === 4 && rs.length === 20, '새벽에 공부한 날은 그 시각부터 보여 줌: ' + rs[0].hour + '시부터 ' + rs.length + '줄');
  const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
  const r9 = rs.find((r) => r.hour === 9), r10 = rs.find((r) => r.hour === 10), r11 = rs.find((r) => r.hour === 11), r13 = rs.find((r) => r.hour === 13);
  assert(r9.segs.length === 1 && near(r9.segs[0].left, (5 / 60) * 100) && near(r9.segs[0].width, (50 / 60) * 100) && r9.segs[0].color === hexToRgb(colorOf(K)), '9:05~9:55 국어가 9시 줄에 국어 색으로');
  assert(near(r10.segs[0].left, 25) && near(r10.segs[0].width, 75) && near(r11.segs[0].left, 0) && near(r11.segs[0].width, (40 / 60) * 100) && r11.segs[0].color === hexToRgb(colorOf(M)), '10:15~11:40 수학이 10시·11시 두 줄에 걸쳐 칠해짐');
  assert(r13.segs.length === 0 && /직접 기록 30분은 공부한 시각이 없어/.test(await page.textContent('#ttv-foot')), '직접 기록은 칸에 칠하지 않고 아래에 알려 줌');
  assert(/3시간 5분/.test(await page.textContent('#ttv-sum')) && /4:10 ~ 11:40/.test(await page.textContent('#ttv-sum')), '합계 3시간 5분(직접 기록 포함), 4:10 ~ 11:40: ' + (await page.textContent('#ttv-sum')));
  const legend = await page.$$eval('#ttv-legend .tt-chip', (els) => els.map((e) => e.textContent.trim()));
  assert(legend.length === 2 && /수학 1시간 45분/.test(legend[0]) && /국어 1시간 20분/.test(legend[1]), '과목별 시간을 많은 순으로: ' + legend.join(' / '));
  const listText = await page.$$eval('#ttv-list li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  assert(listText.length === 4 && /수학.*4:10 ~ 4:30 · 20분/.test(listText[0]) && /국어.*9:05 ~ 9:55 · 50분/.test(listText[1]) && /스톱워치.*문제집 3단원.*10:15 ~ 11:40 · 1시간 25분/.test(listText[2]) && /직접.*시각 없음 · 30분/.test(listText[3]), '이날의 기록이 시간 순서로 (직접 기록은 맨 뒤): ' + listText.join(' / '));
  fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(fit.sw <= fit.cw, '타임테이블 화면이 옆으로 밀리지 않음 (360)');
  // 날짜 옮기기
  await page.tap('#ttv-prev');
  await page.waitForTimeout(150);
  assert(!/오늘/.test(await page.textContent('#ttv-title')) && !(await page.isDisabled('#ttv-next')) && await page.isVisible('#ttv-today'), '‹ 를 누르면 어제로, ‘오늘로’ 단추가 생김');
  rs = await rows(page);
  assert(rs.find((r) => r.hour === 19).segs.length === 1 && (await page.locator('#ttv-grid .tt-now').count()) === 0 && /1시간/.test(await page.textContent('#ttv-sum')), '어제 19시 기록이 보이고 지금 시각 표시는 없음');
  await page.tap('#ttv-prev');
  await page.waitForTimeout(150);
  assert(/공부 기록이 없는 날/.test(await page.textContent('#ttv-sum')) && /공부 기록이 없어요/.test(await page.textContent('#ttv-list')), '기록이 없는 날은 그렇게 알려 줌');
  await page.tap('#ttv-today');
  await page.waitForTimeout(150);
  assert(/오늘/.test(await page.textContent('#ttv-title')) && await page.isHidden('#ttv-today'), '‘오늘로’를 누르면 오늘로 돌아옴');
  // 기록 지우기와 되돌리기
  await page.tap('#ttv-list [data-tt-del="a"]');
  await page.waitForTimeout(200);
  rs = await rows(page);
  assert(!(await state(page)).sessions.some((s) => s.id === 'a') && rs.find((r) => r.hour === 9).segs.length === 0 && /되돌리기/.test(await toastOf(page)), '목록에서 ✕를 누르면 기록과 칸이 지워지고 되돌리기 알림');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(200);
  rs = await rows(page);
  assert((await state(page)).sessions.some((s) => s.id === 'a') && rs.find((r) => r.hour === 9).segs.length === 1, '되돌리기를 누르면 다시 살아남');
  // 인증 이미지, 직접 기록
  assert(await page.isVisible('#ttv-foot [data-tt-share]') && await page.isVisible('#view-timetable [data-log-open]'), '인증 이미지와 직접 기록 단추');
  // 휴대폰 뒤로 → 홈
  await page.goBack();
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => App.view) === 'home', "타임테이블에서 휴대폰 '뒤로'를 누르면 홈으로");
  // 홈의 띠에도 같은 기록
  assert((await page.locator('#h-tt .ds-bar i').count()) === 4 && /수학/.test(await page.textContent('#h-tt .tt-legend')), '홈 타임테이블 띠에 오늘 기록 네 조각');
  // 통계의 공부 달력에서 날짜를 골라 열기
  await page.evaluate(() => App.go('stats'));
  await page.waitForTimeout(200);
  const yKey = await page.evaluate(() => Stats.dayKey(Date.now() - 86400000));
  const sameMonth = await page.evaluate((k) => !!document.querySelector(`#cal-grid [data-cal="${k}"]`), yKey);
  if (sameMonth) {
    await page.tap(`#cal-grid [data-cal="${yKey}"]`);
    await page.waitForTimeout(200);
    await page.tap('#cal-detail [data-tt-open]');
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => App.view) === 'timetable' && await page.evaluate(() => Timetable.day) === yKey && !/오늘/.test(await page.textContent('#ttv-title')), '공부 달력에서 날짜를 누르고 ‘타임테이블’을 누르면 그날의 타임테이블');
  } else {
    await page.tap('#cal-detail [data-tt-open]');
    await page.waitForTimeout(300);
    assert(await page.evaluate(() => App.view) === 'timetable', '공부 달력의 ‘타임테이블’을 누르면 타임테이블 화면 (오늘이 1일이라 어제는 건너뜀)');
  }
  // 집중 타이머로 공부하는 동안에도 바로 칠해진다
  await page.evaluate(() => { Stopwatch.showTab('focus'); App.go('timer'); });
  await page.tap('#timer-start');
  await page.evaluate(() => { const x = window.__studypromotion.timer; x.endAt -= 10 * 60000; });
  await page.evaluate(() => Timetable.open());
  await page.waitForTimeout(300);
  rs = await rows(page);
  const liveSeg = rs.find((r) => r.hour === 16).segs.find((s) => s.live);
  assert(liveSeg && near(liveSeg.left, (10 / 60) * 100, 1.5) && near(liveSeg.width, (10 / 60) * 100, 1.5), '집중 타이머가 도는 10분도 재는 중 구간으로 칠해짐');
  await page.context().close();

  /* ===== 6) 하루 시작 시각을 새벽 4시로 둔 사람 ===== */
  page = await open(1, 30); // 새벽 1시 30분 = 아직 '어제'
  await page.goto(base + '#home');
  await page.waitForFunction(() => window.App && window.Timetable);
  await page.evaluate(() => App.store.update((s) => { s.settings.dayStartHour = 4; }));
  await seed(page, [{ id: 'n1', h: 1, m: 0, min: 60, sid: null }, { id: 'n2', day: -1, h: 22, m: 0, min: 50, sid: null }]); // 오늘 0:00~1:00, 어제 21:10~22:00
  await page.evaluate(() => App.go('timetable'));
  await page.waitForTimeout(200);
  rs = await rows(page);
  assert(rs[0].hour === 6 && rs[rs.length - 1].hour === 3 && rs.length === 22, '하루가 새벽 4시에 시작하면 6시부터 다음 날 3시까지 (비어 있는 4·5시는 접음): ' + rs[0].hour + '~' + rs[rs.length - 1].hour);
  assert(rs.find((r) => r.hour === 21).segs.length === 1 && rs.find((r) => r.hour === 0).segs.length === 1 && rs.find((r) => r.hour === 1).now, '어젯밤 21시와 오늘 새벽 0시 공부가 같은 날에, 지금(1시 30분) 표시도 같은 표에');
  assert(/1시간 50분/.test(await page.textContent('#ttv-sum')), '합계 1시간 50분: ' + (await page.textContent('#ttv-sum')));
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(200);
  assert((await page.$$eval('#h-tt .ds-ticks span', (els) => els.map((e) => e.textContent))).join(',') === '4,10,16,22,4', '홈 띠의 눈금도 4시부터');
  await page.context().close();

  /* ===== 7) 버전별 업데이트 소식 ===== */
  page = await open();
  await page.goto(base + '#about');
  await page.waitForFunction(() => window.App);
  const tabs = await page.$$eval('#ver-tabs [data-ver-tab]', (els) => els.map((e) => ({ v: e.dataset.verTab, on: e.classList.contains('active'), sel: e.getAttribute('aria-selected') })));
  assert(tabs.length >= 9 && tabs[0].v === await page.evaluate(() => App.version) && tabs[0].on && tabs[0].sel === 'true' && tabs.filter((t) => t.on).length === 1, '버전마다 탭 하나, 맨 앞이 지금 버전(' + tabs[0].v + ')이고 처음에 골라져 있음: ' + tabs.map((t) => t.v).join(' '));
  assert(/버전 2\.11/.test(await page.textContent('#app-version')) && /최신/.test(await page.textContent('#ver-tabs [data-ver-tab] >> nth=0')), '앱 소개의 버전과 같고 ‘최신’ 표시');
  const shown = () => page.$$eval('#about-news .ver', (els) => els.filter((e) => !e.hidden && e.offsetParent !== null).map((e) => ({ v: e.dataset.ver, when: e.querySelector('.ver-when').textContent, n: e.querySelectorAll('.news li').length })));
  let sh = await shown();
  assert(sh.length === 1 && sh[0].v === '2.11' && /버전 2\.11 · 2026년 11월 14일 업데이트/.test(sh[0].when) && sh[0].n >= 3, '고른 버전의 내용만 보이고, 업데이트한 날이 적혀 있음: ' + sh[0].when);
  assert(/일정 추가/.test(await page.textContent('#about-news .ver:not([hidden])')) && /주간 스케줄 표/.test(await page.textContent('#about-news .ver:not([hidden])')), '2.11 소식에 일정 추가와 주간 스케줄 표');
  await page.tap('#ver-tabs [data-ver-tab="2.10"]');
  sh = await shown();
  assert(sh.length === 1 && sh[0].v === '2.10' && /버전 2\.10 · 2026년 11월 13일 업데이트/.test(sh[0].when) && /타임테이블에 직접 추가/.test(await page.textContent('#about-news .ver:not([hidden])')), '2.10 소식(범위 고르기, 타임테이블 직접 추가)도 그대로');
  await page.tap('#ver-tabs [data-ver-tab="2.9"]');
  sh = await shown();
  assert(sh.length === 1 && sh[0].v === '2.9' && /버전 2\.9 · 2026년 11월 13일 업데이트/.test(sh[0].when) && sh[0].n >= 5 && /공부 시작하기/.test(await page.textContent('#about-news .ver:not([hidden])')), '2.9 소식(타임테이블, 공부 시작하기)도 그대로');
  await page.tap('#ver-tabs [data-ver-tab="2.7"]');
  sh = await shown();
  assert(sh.length === 1 && sh[0].v === '2.7' && /2026년 11월 10일/.test(sh[0].when) && /스톱워치/.test(await page.textContent('#about-news .ver:not([hidden])')), '2.7을 누르면 2.7 내용으로 바뀜');
  const allVers = await page.$$eval('#about-news .ver', (els) => els.map((e) => ({ v: e.dataset.ver, d: e.dataset.date, n: e.querySelectorAll('.news li').length })));
  // 버전은 점 앞뒤를 따로 비교한다 (2.10은 2.9 다음)
  const verNum = (v) => v.split('.').map(Number).reduce((a, n) => a * 1000 + n, 0);
  assert(allVers.every((x) => /^\d+\.\d+$/.test(x.v) && /^\d{4}년 \d{1,2}월 \d{1,2}일$/.test(x.d) && x.n >= 1) && allVers.map((x) => verNum(x.v)).every((v, i, a) => !i || v < a[i - 1]), '모든 버전에 날짜와 내용이 있고 최신 순');
  fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(fit.sw <= fit.cw, '버전 탭이 많아도 화면이 옆으로 밀리지 않음 (360)');
  // 업데이트한 뒤의 알림 → 달라진 점
  await page.evaluate(() => { sessionStorage.setItem('studypromotion.updated', '1'); location.hash = '#home'; });
  await page.reload();
  await page.waitForFunction(() => /새 버전으로 업데이트했어요/.test(document.querySelector('#toast').textContent));
  assert(/달라진 점/.test(await toastOf(page)), '업데이트 알림에 ‘달라진 점’ 단추');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(300);
  sh = await shown();
  assert(await page.evaluate(() => App.view) === 'about' && sh.length === 1 && sh[0].v === '2.11' && await page.evaluate(() => { const r = document.querySelector('#news-panel').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), '누르면 앱 소개의 업데이트 소식(이번 버전)으로 감');
  await page.context().close();

  /* ===== 8) PC 화면, 어두운 화면 ===== */
  page = await open(16, 20, { viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false, colorScheme: 'dark' });
  await page.goto(base + '#home');
  await page.waitForFunction(() => window.App && window.Timetable);
  await seed(page, [{ id: 'p1', h: 10, m: 0, min: 50, sid: null }]);
  fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, start: document.querySelector('#h-start').getBoundingClientRect().width, card: document.querySelector('#h-start').closest('.stat').getBoundingClientRect().width }));
  assert(fit.sw <= fit.cw && fit.start <= fit.card, 'PC 홈에서도 단추가 칸 안에');
  await page.click('#h-start');
  await page.waitForSelector('.ui-back.in .start-sheet');
  const box = await page.evaluate(() => { const r = document.querySelector('.ui-back.in .ui-sheet').getBoundingClientRect(); return { cx: (r.left + r.right) / 2, top: r.top, bottom: r.bottom, vh: innerHeight, vw: innerWidth }; });
  assert(Math.abs(box.cx - box.vw / 2) < 2 && box.top > 0 && box.bottom < box.vh, 'PC에서는 고르는 창이 화면 가운데에 뜸');
  await page.keyboard.press('ArrowDown');
  assert(await page.evaluate(() => document.activeElement.classList.contains('ch-opt') && document.activeElement.textContent.includes('수학')), '키보드 ↓로 선택지를 옮김');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(!(await page.evaluate(() => Stopwatch.running())) && (await page.locator('.ui-back.in').count()) === 0, 'Esc로 닫으면 시작하지 않음');
  await page.evaluate(() => App.go('timetable'));
  await page.waitForTimeout(200);
  const dark = await page.evaluate(() => { const bar = document.querySelector('#ttv-grid .tt-bar'); const cs = getComputedStyle(bar); const nowEl = document.querySelector('#ttv-grid .tt-now'); return { bar: cs.backgroundColor, now: getComputedStyle(nowEl).backgroundColor, panel: getComputedStyle(document.querySelector('.ttv-panel')).backgroundColor }; });
  assert(dark.bar !== dark.panel && dark.now !== dark.bar, '어두운 화면에서도 빈 칸·지금 표시가 바탕과 구분됨 (' + dark.bar + ' / ' + dark.panel + ' / ' + dark.now + ')');
  await page.context().close();

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
