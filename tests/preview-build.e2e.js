// 미리 보기 파일 확인: 실제 앱의 기록·계정과 따로 도는지, 달라진 점 목록과 '써 보기'가 동작하는지
//  node tests/preview-build.e2e.js [스크린샷 폴더]
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
execFileSync('node', [path.join(root, 'tools/build-preview.js')], { stdio: 'ignore' });
const dir = path.join(root, 'dist', 'preview');
const shots = process.argv[2] || '';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/standalone.html';
  const file = path.join(dir, p);
  if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];
  const requests = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', deviceScaleFactor: shots ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) requests.push(r.url()); });
  const shot = async (name) => { if (shots) { await page.waitForTimeout(350); await page.screenshot({ path: path.join(shots, name + '.png') }); } };
  const toastOf = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });

  /* 1) 실제 앱과 같은 주소에서 열어도 실제 기록을 건드리지 않는다 */
  // 같은 주소에 '실제 앱의 기록'이 있다고 치고 미리 넣어 둔다
  const REAL = JSON.stringify({ version: 2, subjects: [{ id: 'r1', name: '실제 과목', color: '#000' }], tasks: [{ id: 'rt', title: '실제 앱의 할 일', done: false }], sessions: [{ id: 'rs', minutes: 77, endedAt: 1 }], decks: [], cards: [], reviewLog: [], exams: [], topics: [], settings: { dailyGoalMin: 99 } });
  await page.addInitScript((real) => {
    if (!localStorage.getItem('__realSet')) {
      localStorage.setItem('__realSet', '1');
      localStorage.setItem('studypromotion.v1', real);
      localStorage.setItem('studypromotion.cloud', '{"uid":"real-user","remoteAt":123}');
      localStorage.setItem('studypromotion.timer', '{"mode":"focus","running":false,"remaining":1500,"total":1500}');
    }
  }, REAL);
  await page.goto(base);
  await page.waitForFunction(() => window.Preview && window.App);
  await page.waitForTimeout(400);
  let st = await page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  assert(!st.tasks.some((t) => t.id === 'rt') && !st.sessions.some((s) => s.id === 'rs'), '실제 앱의 기록을 읽어 오지 않음');
  assert(st.exams.length === 1 && /^예시/.test(st.exams[0].name) && st.sessions.length > 20 && st.topics.length > 15, '처음 열면 예시 기록이 들어 있음 (시험 1개, 공부 기록 ' + st.sessions.length + '개)');
  // 여러 가지를 해 본다: 할 일 추가, 설정 저장, 타이머, 전체 초기화, 예시 다시 넣기
  await page.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'pv1', title: '미리 보기에서 적은 일', done: false, createdAt: Date.now() })));
  await page.evaluate(() => App.go('timer'));
  await page.tap('#timer-start');
  await page.tap('#timer-start');
  await page.evaluate(() => { App.store.reset(); Preview.loadSample(); });
  await page.waitForTimeout(600);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  const real = await page.evaluate(() => ({ v1: localStorage.getItem('studypromotion.v1'), cloud: localStorage.getItem('studypromotion.cloud'), timer: localStorage.getItem('studypromotion.timer') }));
  assert(real.v1 === REAL && real.cloud === '{"uid":"real-user","remoteAt":123}' && real.timer === '{"mode":"focus","running":false,"remaining":1500,"total":1500}', '실제 앱의 저장 내용이 한 글자도 바뀌지 않음 (기록·계정 연결·타이머)');
  const mine = keys.filter((k) => k !== '__realSet' && !['studypromotion.v1', 'studypromotion.cloud', 'studypromotion.timer'].includes(k));
  assert(mine.length >= 3 && mine.every((k) => k.startsWith('studypromotion-preview.')), '미리 보기는 따로 된 이름으로만 저장: ' + mine.join(', '));
  const dbs = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []));
  assert(!dbs.includes('studypromotion-backup'), '실제 앱의 자동 백업 저장소를 만들거나 열지 않음 (' + (dbs.join(', ') || '없음') + ')');
  assert(await page.evaluate(async () => !('serviceWorker' in navigator) || (await navigator.serviceWorker.getRegistrations()).length === 0), '서비스 워커를 등록하지 않음');

  /* 2) 로그인은 막혀 있다 */
  await page.evaluate(() => App.go('account'));
  assert(await page.isDisabled('#acc-google') && await page.isDisabled('#acc-email') && /미리 보기에서는 로그인하지 않아요/.test(await page.textContent('#acc-status')), '로그인 단추가 꺼져 있고 까닭이 적혀 있음');
  assert(requests.length === 0, '바깥으로 나가는 요청 없음 ' + requests.slice(0, 3).join(' '));
  assert(await page.evaluate(() => typeof window.firebase === 'undefined'), '로그인 도구(Firebase)를 불러오지 않음');

  /* 3) 미리 보기 단추와 달라진 점 목록 */
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(300);
  const fit = await page.evaluate(() => { const b = document.querySelector('.topbar'); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, pill: document.querySelector('#pv-open').getBoundingClientRect().right, brand: document.querySelector('.brand').getBoundingClientRect().height, bar: b.getBoundingClientRect().height }; });
  assert(fit.sw <= fit.cw && fit.pill <= 390 && fit.brand < 40, "머리글에 '미리 보기' 단추가 들어가도 화면이 옆으로 밀리지 않음");
  await shot('pv-01-home');
  await page.tap('#pv-open');
  await page.waitForSelector('.ui-back.in .pv-sheet');
  const items = await page.$$eval('.pv-item h3', (els) => els.map((e) => e.textContent));
  assert(items.length === 6, '달라진 점 6가지: ' + items.map((t) => t.slice(1)).join(' / '));
  assert((await page.$$eval('.pv-diff dt', (els) => els.map((e) => e.textContent))).join(',') === Array(6).fill('지금 앱,미리 보기').join(','), "항목마다 '지금 앱'과 '미리 보기'를 나란히 적음");
  await shot('pv-02-panel');
  await page.evaluate(() => { const b = document.querySelector('.ui-sheet-body'); b.scrollTop = b.scrollHeight; });
  await shot('pv-03-panel-end');
  const tryIt = async (i) => {
    if (!(await page.locator('.ui-back.in .pv-sheet').count())) { await page.evaluate(() => Preview.open()); await page.waitForSelector('.ui-back.in .pv-sheet'); }
    await page.evaluate((n) => document.querySelector(`[data-pv-try="${n}"]`).click(), i);
    await page.waitForTimeout(900);
  };
  // ① 확인 창
  await tryIt(0);
  assert(await page.isVisible('#ask') && (await page.textContent('#ask-ok')) === '삭제' && await page.evaluate(() => document.querySelector('#ask-ok').classList.contains('danger-fill')), "① 써 보기 → 빨간 '삭제' 확인 창");
  await shot('pv-04-ask-danger');
  await page.tap('#ask-cancel');
  // ② 타이머 초기화
  await tryIt(1);
  assert(await page.evaluate(() => App.view === 'timer' && window.__studypromotion.timer.running) && /18:\d\d/.test(await page.textContent('#timer-time')), '② 써 보기 → 7분 집중한 상태 (' + (await page.textContent('#timer-time')) + ')');
  await page.tap('#timer-reset');
  assert((await page.textContent('#ask-alt')) === '기록 없이 초기화' && /7분/.test(await page.textContent('#ask-msg')), '② 초기화를 누르면 기록할지 물어봄');
  await shot('pv-05-ask-reset');
  await page.tap('#ask-alt');
  // ③ 뒤로 가기
  await tryIt(2);
  assert(await page.isVisible('#log-dlg') && await page.isVisible('#pv-back-go'), "③ 써 보기 → 창이 열리고 '뒤로' 단추가 생김");
  await shot('pv-06-back');
  await page.tap('#pv-back-go');
  await page.waitForTimeout(300);
  assert(await page.isHidden('#log-dlg') && await page.evaluate(() => App.view) === 'stats', "③ '뒤로' → 창만 닫힘");
  await page.tap('#pv-back-go');
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => App.view) === 'home', "③ '뒤로' → 홈으로");
  await page.tap('#pv-back-go');
  await page.waitForTimeout(300);
  await page.tap('#pv-back-go');
  assert(/한 번 더 누르면 실제 앱은 닫혀요/.test(await toastOf()) && await page.evaluate(() => !!window.App), "③ 홈에서 '뒤로'를 거듭 눌러도 미리 보기는 닫히지 않고 알려 줌");
  await page.tap('#pv-back-x');
  await page.waitForTimeout(2300);
  // ④ 하루 시작 시각
  await tryIt(3);
  assert(await page.evaluate(() => App.view === 'account' && document.querySelector('#set-daystart').closest('.field').classList.contains('pv-hit')), '④ 써 보기 → 설정의 하루 시작 시각 칸을 표시');
  await shot('pv-07-daystart');
  // ⑥ 주간 비교
  await tryIt(5);
  assert(await page.evaluate(() => App.view === 'stats') && /그 전 7일보다 .+ (더|덜) 했어요/.test(await page.textContent('#week-compare')), '⑥ 써 보기 → 통계의 비교 줄: ' + (await page.textContent('#week-compare')));
  await shot('pv-08-week');
  // ⑤ 휴식 바로 시작
  const before = (await page.evaluate(() => App.store.get().sessions.length));
  await tryIt(4);
  assert(await page.evaluate(() => App.store.get().settings.autoBreak === true && window.__studypromotion.timer.running && window.__studypromotion.timer.mode === 'focus'), '⑤ 써 보기 → 설정을 켜고 10초 남은 집중 시작');
  await page.waitForFunction(() => window.__studypromotion.timer.mode === 'break' && window.__studypromotion.timer.running, null, { timeout: 15000 });
  assert(await page.evaluate(() => App.store.get().sessions.length) === before + 1, '⑤ 10초 뒤 집중이 끝나고 휴식이 바로 돎');
  await shot('pv-09-autobreak');
  await page.evaluate(() => { const t = window.__studypromotion.timer; t.endAt = Date.now() - 10; });
  await page.waitForFunction(() => window.__studypromotion.timer.mode === 'focus');

  /* 4) 비우고 처음부터 / 예시 다시 넣기 */
  await page.evaluate(() => Preview.open());
  await page.waitForSelector('.ui-back.in .pv-sheet');
  await page.evaluate(() => document.querySelector('[data-pv-empty]').click());
  await page.waitForSelector('#ask:not([hidden])');
  assert((await page.textContent('#ask-ok')) === '모두 비우기', '비우기 전에 물어봄');
  await page.tap('#ask-ok');
  await page.waitForTimeout(400);
  st = await page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  assert(!st.sessions.length && !st.exams.length && !st.tasks.length && await page.isVisible('#h-welcome'), '비우면 처음 쓰는 사람의 화면');
  await page.reload();
  await page.waitForFunction(() => window.Preview && window.App);
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => App.store.get().sessions.length) === 0, '비운 뒤 다시 열어도 예시 기록을 멋대로 다시 넣지 않음');
  await page.evaluate(() => Preview.open());
  await page.waitForSelector('.ui-back.in .pv-sheet');
  await page.evaluate(() => document.querySelector('[data-pv-sample]').click());
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => App.store.get().sessions.length) > 20 && await page.isHidden('#ask'), '예시 기록 다시 넣기 (비어 있으면 묻지 않고 바로)');
  assert((await page.evaluate(() => localStorage.getItem('studypromotion.v1'))) === REAL, '끝까지 실제 앱의 기록은 그대로');

  if (shots) {
    // 어두운 화면, PC 화면
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => { App.go('home'); Preview.open(); });
    await shot('pv-10-dark-panel');
    await ctx.close();
    const wide = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const wp = await wide.newPage();
    wp.on('pageerror', (e) => errors.push(e.message));
    await wp.goto(base);
    await wp.waitForFunction(() => window.Preview && window.App);
    await wp.waitForTimeout(3200);
    await wp.screenshot({ path: path.join(shots, 'pv-11-desktop-home.png') });
    await wp.click('#pv-open');
    await wp.waitForTimeout(500);
    await wp.screenshot({ path: path.join(shots, 'pv-12-desktop-panel.png') });
    await wide.close();
  }
  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
