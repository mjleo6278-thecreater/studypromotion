// 홈 '오늘 할 범위'·처음 안내, 타이머 이어 가기, 공부 시간 직접 기록·지우기 테스트 (휴대폰 화면)
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

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept()); // 집중 중 새로고침할 때 뜨는 '떠나기' 확인
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const topic = async (title) => (await state()).topics.find((t) => t.title === title);
  const timer = () => page.evaluate(() => { const t = window.__studypromotion.timer; return { mode: t.mode, running: t.running, remaining: t.remaining, total: t.total, label: t.label, topicId: t.topicId, subjectId: t.subjectId }; });
  const nextTitles = () => page.$$eval('#h-next .next-title', (els) => els.map((e) => e.textContent));

  // 1) 처음 쓰는 사람 안내
  await page.goto(base + '#home');
  assert(await page.isVisible('#h-welcome'), '처음 쓰는 사람에게 시작 안내');
  assert(!(await page.isVisible('#h-next-panel')), '시험이 없으면 오늘 할 범위는 숨김');
  await page.tap('#welcome-close');
  await page.reload();
  assert(!(await page.isVisible('#h-welcome')), '닫은 안내는 다시 안 보임');

  // 2) 오늘 할 범위: 가장 가까운 시험에서 과목을 번갈아 (빈 과목은 빼고)
  await page.evaluate((date) => {
    App.store.update((s) => {
      s.exams.push({ id: 'old', name: '지난 시험', date: '2020-01-01', createdAt: 1 });
      Scope.addOutline(s.topics, 'old', Scope.parseOutline('# 국어\n- 지난 범위'), App.uid);
      s.exams.push({ id: 'e1', name: '중간고사', date, createdAt: Date.now() });
      s.activeExamId = 'old';
      Scope.addOutline(s.topics, 'e1', Scope.parseOutline('# 국어\n- 현대시\n- 고전시가\n# 수학\n- 다항식\n- 방정식\n# 영어'), App.uid);
    });
  }, dayKey(Date.now() + 10 * 864e5));
  assert(await page.isVisible('#h-next-panel'), '시험이 생기면 오늘 할 범위 표시');
  assert((await page.textContent('#h-next-sub')).includes('중간고사'), '날짜 지난 시험이 아니라 다가오는 시험에서 고름');
  assert(JSON.stringify(await nextTitles()) === JSON.stringify(['현대시', '다항식']), '과목을 번갈아, 하루 몫만큼 (빈 과목 제외): ' + (await nextTitles()).join(','));
  await page.tap('#h-next [data-next-check]');
  assert((await topic('현대시')).done === true, '홈에서 바로 체크');
  assert(JSON.stringify(await nextTitles()) === JSON.stringify(['고전시가', '다항식']), '체크하면 다음 항목이 올라옴');

  // 걸리는 시간을 적으면 오늘 할 양만큼만
  await page.evaluate(() => App.store.update((s) => {
    const by = (t) => s.topics.find((n) => n.title === t);
    by('고전시가').est = 60; by('다항식').est = 30; by('방정식').est = 30;
  }));
  assert(JSON.stringify(await nextTitles()) === JSON.stringify(['고전시가']), '오늘 할 양(12분)을 채우는 만큼만 추천');
  assert((await page.textContent('#h-next .next-meta')).includes('남은 1시간'), '항목의 남은 시간 표시');

  // ▶: 그 범위로 타이머 준비
  await page.tap('#h-next [data-next-focus]');
  assert(await page.isVisible('#view-timer'), '▶ 누르면 타이머로');
  let tm = await timer();
  const korean = (await state()).subjects.find((s) => s.name === '국어');
  assert(tm.label === '국어 · 고전시가' && tm.subjectId === korean.id && tm.mode === 'focus', '공부할 범위와 과목이 타이머에 들어감');

  // 3) 타이머: 앱을 닫았다 열어도 이어 감
  await page.tap('#timer-start');
  await page.waitForTimeout(1300);
  await page.reload();
  await page.waitForTimeout(300);
  tm = await timer();
  assert(tm.running && tm.remaining < 25 * 60 && tm.remaining > 25 * 60 - 10 && tm.label === '국어 · 고전시가', '새로고침해도 타이머가 계속 돌고 범위도 유지 (' + tm.remaining + '초)');
  assert((await page.textContent('#timer-start')) === '일시정지', '버튼도 일시정지 상태');
  await page.tap('#timer-start');
  const paused = (await timer()).remaining;
  await page.reload();
  await page.waitForTimeout(300);
  tm = await timer();
  assert(!tm.running && tm.remaining === paused && (await page.textContent('#timer-start')) === '계속', '일시정지한 남은 시간도 유지');

  // 앱이 닫혀 있는 동안 끝난 집중은 다시 열 때 기록하고, 범위를 끝냈는지 물어봄
  await page.tap('#timer-start');
  await page.evaluate(() => {
    const k = 'studypromotion.timer';
    const s = JSON.parse(localStorage.getItem(k));
    s.endAt = Date.now() - 60 * 1000;
    localStorage.setItem(k, JSON.stringify(s));
    window.__studypromotion.timer.running = false; // 이 탭이 먼저 끝내지 않게
    clearInterval(window.__studypromotion.timer.tick);
  });
  const sessionsBefore = (await state()).sessions.length;
  await page.reload();
  await page.waitForTimeout(400);
  let st = await state();
  const rec = st.sessions[st.sessions.length - 1];
  assert(st.sessions.length === sessionsBefore + 1 && rec.minutes === 25 && rec.label === '국어 · 고전시가' && rec.subjectId === korean.id, '닫혀 있는 동안 끝난 집중 25분 기록');
  assert(rec.endedAt < Date.now() - 50 * 1000, '끝난 시각으로 기록');
  tm = await timer();
  assert(tm.mode === 'break' && !tm.running, '다음은 휴식');
  await page.waitForSelector('#ask:not([hidden])', { timeout: 3000 });
  assert((await page.textContent('#ask-msg')).includes('고전시가'), '범위를 끝냈는지 물어봄');
  await page.tap('#ask-ok');
  assert((await topic('고전시가')).done === true, '끝냈다고 하면 범위에서 체크');

  // 4) 공부 시간 직접 기록 (학원·독서실 등)
  await page.goto(base + '#stats');
  await page.tap('#view-stats [data-log-open]');
  assert(await page.isVisible('#log-dlg'), '통계에서 직접 기록 창 열기');
  assert((await page.inputValue('#log-date')) === dayKey(Date.now()), '날짜는 오늘로');
  await page.tap('#log-form button[type="submit"]');
  assert(await page.isVisible('#log-dlg'), '시간을 안 적으면 기록 안 함');
  await page.tap('#log-quick [data-min="90"]');
  assert((await page.inputValue('#log-h')) === '1' && (await page.inputValue('#log-m')) === '30', '빠른 선택: 1시간 30분');
  await page.fill('#log-date', dayKey(Date.now() + 864e5));
  await page.tap('#log-form button[type="submit"]');
  assert(await page.isVisible('#log-dlg'), '내일 날짜는 기록 안 함');
  const yesterday = dayKey(Date.now() - 864e5);
  await page.fill('#log-date', yesterday);
  await page.selectOption('#log-subject', { label: '수학' });
  await page.fill('#log-label', '학원 수학 수업');
  await page.tap('#log-form button[type="submit"]');
  assert(!(await page.isVisible('#log-dlg')), '기록하면 창 닫힘');
  st = await state();
  const man = st.sessions.find((s) => s.manual);
  assert(man && man.minutes === 90 && dayKey(man.endedAt) === yesterday && man.label === '학원 수학 수업' && man.subjectId === st.subjects.find((s) => s.name === '수학').id, '어제 수학 1시간 30분 직접 기록');
  assert((await page.textContent('#session-list')).includes('직접'), '기록 목록에 직접 표시');
  const week = await page.textContent('#week-total');
  assert(week.includes('1시간 55분'), '최근 7일 합계에 포함 (' + week + ')');
  // 타이머 화면에서도 열 수 있고, 메모 없이 기록하면 '직접 기록'
  await page.goto(base + '#timer');
  await page.tap('#view-timer [data-log-open]');
  await page.fill('#log-m', '20');
  await page.keyboard.press('Enter');
  st = await state();
  assert(st.sessions.filter((s) => s.manual).length === 2 && st.sessions.some((s) => s.manual && s.minutes === 20 && s.label === '직접 기록'), '타이머 화면에서 20분 직접 기록');
  const today = await page.textContent('#timer-today');
  assert(today.includes('45분') && today.includes('집중 1회'), '오늘 공부 합계에는 넣고 집중 횟수에는 안 넣음 (' + today + ')');
  // Esc로 닫기
  await page.tap('#view-timer [data-log-open]');
  await page.keyboard.press('Escape');
  assert(!(await page.isVisible('#log-dlg')), 'Esc로 닫기');

  // 5) 잘못 남긴 기록 지우기
  await page.goto(base + '#stats');
  const count = (await state()).sessions.length;
  await page.tap('#session-list [data-del-session]');
  assert(await page.isVisible('#ask'), '지우기 전에 확인');
  await page.tap('#ask-cancel');
  assert((await state()).sessions.length === count, '취소하면 그대로');
  await page.tap('#session-list [data-del-session]');
  await page.tap('#ask-ok');
  assert((await state()).sessions.length === count - 1, '확인하면 기록 삭제');

  // 6) 되돌리기는 범위만: 그사이 쌓인 공부 기록은 지우지 않음
  await page.goto(base + '#home');
  await page.tap('#h-next [data-next-check]');
  const afterCheck = (await state()).sessions.length;
  await page.evaluate(() => App.store.update((s) => s.sessions.push({ id: 'later', subjectId: null, minutes: 30, endedAt: Date.now() })));
  await page.goto(base + '#board');
  await page.tap('.sl-head [data-list-act="undo"]');
  st = await state();
  assert(st.sessions.length === afterCheck + 1 && st.sessions.some((s) => s.id === 'later'), '되돌리기를 눌러도 공부 기록은 남음');

  // 7) 화면 켜 두기 설정
  await page.goto(base + '#account');
  assert(await page.isChecked('#set-awake'), '화면 켜 두기 기본값 켜짐');
  await page.tap('#set-awake');
  await page.tap('#settings-form button[type="submit"]');
  assert((await state()).settings.keepAwake === false, '화면 켜 두기 끄기 저장');

  // 8) 탭 두 개: 한쪽에서 바꾸면 다른 쪽도 맞추고, 같은 타이머를 두 번 기록하지 않음
  const pageB = await ctx.newPage();
  pageB.on('pageerror', (e) => errors.push('B: ' + e.message));
  pageB.on('console', (m) => m.type() === 'error' && errors.push('B: ' + m.text()));
  pageB.on('dialog', (d) => d.accept());
  await page.goto(base + '#timer');
  await pageB.goto(base + '#timer');
  await page.tap('.mode-switch [data-mode="focus"]');
  await page.tap('#timer-start');
  await pageB.waitForTimeout(300);
  const ta = await page.evaluate(() => window.__studypromotion.timer.endAt);
  const tb = await pageB.evaluate(() => ({ running: window.__studypromotion.timer.running, endAt: window.__studypromotion.timer.endAt }));
  assert(tb.running && tb.endAt === ta, '다른 탭에서 시작한 타이머를 이 탭도 따라감');
  // 두 탭이 거의 동시에 같은 집중을 끝내도 기록은 하나
  const end = Date.now() - 50;
  const fin = (e) => { const t = window.__studypromotion.timer; t.endAt = e; };
  await Promise.all([page.evaluate(fin, end), pageB.evaluate(fin, end)]);
  await page.waitForTimeout(900);
  const ids = (p) => p.evaluate((e) => App.store.get().sessions.filter((x) => x.id === 'focus-' + e).length, end);
  const stored = await page.evaluate((e) => JSON.parse(localStorage.getItem('studypromotion.v1')).sessions.filter((x) => x.id === 'focus-' + e).length, end);
  assert((await ids(page)) === 1 && (await ids(pageB)) === 1 && stored === 1, '두 탭이 끝내도 공부 기록은 한 번만');
  await page.evaluate(() => { if (!document.querySelector('#ask').hidden) document.querySelector('#ask-cancel').click(); });
  await pageB.evaluate(() => { if (!document.querySelector('#ask').hidden) document.querySelector('#ask-cancel').click(); });
  // 한 탭에서 바꾼 기록이 다른 탭에도 (덮어쓰지 않음)
  await page.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'tabA', title: 'A 탭에서 만든 할 일', done: false, createdAt: Date.now() })));
  await pageB.waitForTimeout(200);
  await pageB.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'tabB', title: 'B 탭에서 만든 할 일', done: false, createdAt: Date.now() })));
  await page.waitForTimeout(200);
  const tasksA = await page.evaluate(() => App.store.get().tasks.map((t) => t.id).sort().join(','));
  assert(tasksA.includes('tabA') && tasksA.includes('tabB'), '두 탭의 변경이 서로 덮어쓰지 않음 (' + tasksA + ')');
  // 두 탭 모두 보드를 열어 둬도 저장이 끝없이 오가지 않음
  for (const p of [page, pageB]) { await p.goto(base + '#board'); await p.evaluate(() => Board.setMode('board', false)); }
  await page.waitForTimeout(1200);
  const countWrites = () => { window.__w = 0; const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'studypromotion.v1') window.__w++; return o.call(this, k, v); }; };
  await Promise.all([page.evaluate(countWrites), pageB.evaluate(countWrites)]);
  await page.waitForTimeout(2000);
  const writes = (await page.evaluate(() => window.__w)) + (await pageB.evaluate(() => window.__w));
  assert(writes <= 1, '보드를 두 탭에 열어 둬도 저장이 오가지 않음 (' + writes + '번)');
  await pageB.close();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '가로 스크롤 없음');
  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
