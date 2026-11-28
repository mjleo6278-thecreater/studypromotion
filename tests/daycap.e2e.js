// 하루 공부 기록은 24시간까지 (v4.6.3): 직접 기록 막기(시간만·시각으로), 예전에 넘친 날 맞추기, 끝낸 할 일 넣기 (휴대폰 화면)
// SHOTS=폴더 를 주면 미리 보기 그림을 남긴다
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
const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8)}`;
const SHOTS = process.env.SHOTS || '';

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const dayTotal = async (k) => page.evaluate((key) => App.store.get().sessions.filter((s) => Stats.dayKey(s.endedAt) === key).reduce((a, s) => a + s.minutes, 0), k);
  const toastText = () => page.textContent('#toast');
  const waitToast = (re) => page.waitForFunction((src) => { const t = document.querySelector('#toast'); return t && t.classList.contains('show') && new RegExp(src).test(t.textContent); }, re.source, { timeout: 6000 });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); } };
  const today = dayKey(Date.now()), yday = dayKey(Date.now() - 864e5), d2 = dayKey(Date.now() - 2 * 864e5);

  // ---------- 1) 시간만 적는 직접 기록 ----------
  await page.goto(base + '#stats');
  const openLog = async () => { await page.tap('#view-stats [data-log-open]'); await page.waitForSelector('#log-dlg:not([hidden])'); };
  const submit = () => page.tap('#log-form button[type="submit"]');
  await openLog();
  await page.fill('#log-h', '24');
  await submit();
  await waitToast(/오늘 24시간 공부를 기록했어요/);
  assert(!(await page.isVisible('#log-dlg')) && (await dayTotal(today)) === 1440, '오늘 24시간은 기록된다');

  await openLog();
  await page.fill('#log-h', '1');
  await submit();
  await waitToast(/오늘은 이미 24시간을 기록해서 더 적을 수 없어요/);
  assert(await page.isVisible('#log-dlg'), '24시간이 찬 날에 더 적으면 창이 닫히지 않음');
  assert((await dayTotal(today)) === 1440 && (await state()).sessions.length === 1, '기록이 늘지 않음 (악용하던 것: 여러 번 넣기)');
  await shot('1-full-today.png');
  await page.tap('#log-cancel');

  // 어제: 20시간 넣고 5시간 더 → 거절하며 남은 4시간을 알려 줌 → 4시간은 됨
  await openLog();
  await page.fill('#log-date', yday);
  await page.fill('#log-h', '20');
  await submit();
  await waitToast(new RegExp(`${md(yday).replace('/', '\\/')} 20시간 공부를 기록했어요`));
  await openLog();
  await page.fill('#log-date', yday);
  await page.fill('#log-h', '5');
  await submit();
  await waitToast(new RegExp(`하루 24시간까지예요\\. ${md(yday).replace('/', '\\/')}은 4시간 남았어요`));
  assert((await dayTotal(yday)) === 1200, '넘는 기록은 들어가지 않음');
  await shot('2-room-left.png');
  await page.fill('#log-h', '4');
  await submit();
  await waitToast(/4시간 공부를 기록했어요/);
  assert((await dayTotal(yday)) === 1440, '남은 4시간은 기록된다 → 그날 24시간');

  // 한 번에 24시간 넘게 적어도 (예전에는 24시간으로 잘라 넣었다) 남은 시간을 알려 준다
  await openLog();
  await page.fill('#log-date', d2);
  await page.fill('#log-h', '24');
  await page.fill('#log-m', '30');
  await submit();
  await waitToast(/하루 24시간까지예요\. .*24시간 남았어요/);
  assert((await dayTotal(d2)) === 0, '24시간 30분은 들어가지 않음');

  // ---------- 2) 시각으로 적는 직접 기록 ----------
  await page.fill('#log-h', '23');
  await page.fill('#log-m', '');
  await submit();
  await waitToast(/23시간 공부를 기록했어요/);
  await openLog();
  await page.tap('#log-dlg [data-log-mode="time"]');
  await page.fill('#log-date', d2);
  await page.fill('#log-sh', '10'); await page.fill('#log-sm', '00');
  await page.fill('#log-eh', '12'); await page.fill('#log-em', '00');
  await submit();
  await waitToast(new RegExp(`하루 24시간까지예요\\. ${md(d2).replace('/', '\\/')}은 1시간 남았어요`));
  assert(await page.isVisible('#log-dlg') && (await dayTotal(d2)) === 1380, '시각으로 적어도 24시간이 넘으면 거절');
  await page.fill('#log-eh', '11');
  await submit();
  await waitToast(/10:00 ~ 11:00 1시간 공부를 기록했어요/);
  assert((await dayTotal(d2)) === 1440, '남은 1시간(10:00~11:00)은 기록된다');
  // 끝난 일정을 기록할 때(events.js)도 같은 검사
  const evMsg = await page.evaluate((k) => { const a = new Date(k + 'T15:00').getTime(); return App.spanFull(a, a + 3600000); }, d2);
  assert(/이미 24시간을 기록해서 더 적을 수 없어요/.test(evMsg), '일정 기록하기도 24시간이 찬 날은 막음: ' + evMsg);

  // ---------- 3) 홈 '오늘 공부'는 24시간 ----------
  await page.goto(base + '#home');
  assert((await page.textContent('#h-today')).trim() === '24시간', '홈 오늘 공부: 24시간');

  // ---------- 4) 끝낸 할 일: 남은 시간까지만 ----------
  await page.evaluate(() => App.store.update((st) => { st.sessions = st.sessions.filter((s) => Stats.dayKey(s.endedAt) !== App.todayKey()); st.sessions.push({ id: 'h23', subjectId: null, minutes: 1380, endedAt: Date.now(), label: '직접 기록', manual: true }); st.tasks.push({ id: 'tk1', title: '수학 문제집', subjectId: null, due: App.todayKey(), estimateMin: 120, done: false, createdAt: 1 }); }));
  const got = await page.evaluate(() => App.setTaskDone('tk1', true, { quiet: true }));
  assert(got.added === 60 && (await dayTotal(today)) === 1440, '예상 2시간인 할 일을 끝내도 그날 남은 1시간만 들어감');

  // ---------- 5) 예전에 넘친 날: 앱을 열면 직접 기록부터 줄여 24시간으로 ----------
  const k = dayKey(Date.now() - 3 * 864e5), t21 = new Date(k + 'T21:00').getTime(), t9 = new Date(k + 'T09:00').getTime();
  await page.evaluate(({ t21, t9 }) => {
    const raw = JSON.parse(localStorage.getItem('studypromotion.v1'));
    raw.sessions.push({ id: 'real-sw', subjectId: null, minutes: 180, sec: 10800, endedAt: t9, kind: 'stopwatch' });
    for (let i = 0; i < 13; i++) raw.sessions.push({ id: 'fake' + i, subjectId: null, minutes: 1440, endedAt: t21, label: '직접 기록', manual: true });
    localStorage.setItem('studypromotion.v1', JSON.stringify(raw)); // 312시간 (+ 스톱워치 3시간)
  }, { t21, t9 });
  await page.goto(base + '#stats');
  await page.reload();
  await waitToast(/하루 공부 기록은 24시간까지예요\. 넘은 291시간을 뺐어요/);
  assert((await dayTotal(k)) === 1440, '312시간 넣은 날이 24시간으로 맞춰짐');
  const after = await state();
  assert(after.sessions.some((s) => s.id === 'real-sw' && s.minutes === 180), '스톱워치로 잰 3시간은 그대로');
  assert(after.sessions.filter((s) => /^fake/.test(s.id)).map((s) => s.minutes).join() === '1260', '직접 기록은 처음 것 21시간만 남음');
  await page.waitForTimeout(400); // 알림이 다 나타난 뒤 그림
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem('studypromotion.v1')).sessions.filter((s) => Stats.dayKey(s.endedAt) === key).reduce((a, s) => a + s.minutes, 0), k);
  assert(saved === 1440, '맞춘 기록이 바로 저장됨 (다시 열어도 24시간)');
  await shot('3-trimmed.png');
  // 그룹에 보낼 날별 분도 24시간
  const days = await page.evaluate(() => Group.payload().d);
  assert(days[k] === 1440, '그룹에 보내는 그날 공부 시간: 24시간');

  // 계정 동기화·백업 가져오기로 넘친 기록이 들어와도
  await page.evaluate((t) => App.store.importJSON(JSON.stringify({ tasks: [], sessions: [{ id: 'c1', minutes: 1000, endedAt: t, manual: true }, { id: 'c2', minutes: 1000, endedAt: t, manual: true }] }), 'cloud'), t21);
  assert((await dayTotal(k)) === 1440, '가져온 기록도 24시간으로 맞춤');

  assert(!errors.length, '오류 없음: ' + errors.join(' | '));
  await browser.close();
  server.close();
  console.log('daycap e2e 통과');
})().catch((e) => { console.error(e); process.exit(1); });
