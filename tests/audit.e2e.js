// 전체 점검(v2.8)에서 고친 것 확인: 체크 모두 해제, 집중→휴식 전환 기록, 집중 횟수, 겹친 과목 이름, 조사, 선 아이콘, 터치 화면
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const toastText = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });

  await page.goto(base + '#home');
  await page.evaluate(() => {
    const t = Date.now();
    localStorage.setItem('studypromotion.welcomeClosed', '1');
    App.store.update((s) => {
      s.subjects = [{ id: 's-kor', name: '국어', color: '#e05a4f' }, { id: 's-math', name: '수학', color: '#3d96e0' }];
      s.exams = [{ id: 'ex1', name: '기말고사', date: Stats.dayKey(t + 20 * 864e5), createdAt: t }];
      s.activeExamId = 'ex1';
      const mk = (id, parentId, title, o) => Object.assign({ id, examId: 'ex1', parentId, kind: 'topic', title, done: false, flags: {}, order: s.topics.length, collapsed: false }, o || {});
      s.topics = [];
      s.topics.push(mk('k', null, '국어', { x: 80, y: 80, color: '#e05a4f' }));
      s.topics.push(mk('k1', 'k', '고전시가: 관동별곡', { est: 90, pct: 50 }));
      s.topics.push(mk('k2', 'k', '현대시', { est: 60, pct: 100, done: true, doneAt: t }));
      s.topics.push(mk('m', null, '수학', { x: 420, y: 80, color: '#3d96e0' }));
      s.topics.push(mk('m1', 'm', '다항식', { done: true, pct: 100, doneAt: t }));
      s.topics.push(mk('m2', 'm', '방정식', { done: true, doneAt: t })); // 진행률을 따로 적지 않고 체크만 한 항목
    });
  });

  /* 1) 이 시험 체크 모두 해제: 진행률도 0으로 (전에는 모두 99%로 남았다) */
  await page.goto(base + '#board');
  await page.evaluate(() => Board.setMode('list', false));
  await page.tap('#bb-more');
  const menuTexts = await page.$$eval('#pop-menu [data-act]', (els) => els.map((e) => e.textContent));
  assert(menuTexts.every((t) => !/[✎↶＋]/.test(t)), '시험 ⋯ 메뉴 항목에 글꼴 기호가 섞여 있지 않음');
  await page.tap('#pop-menu [data-act="uncheck-exam"]');
  await page.tap('#ask-ok');
  let st = await state();
  assert(st.topics.every((t) => !t.done && !(t.pct > 0)), '체크 모두 해제하면 진행률(%)도 0');
  assert(await page.evaluate(() => Scope.examProgress(App.store.get().topics, 'ex1').pct) === 0, '시험 진행률 0%');
  assert(!(await page.textContent('#board-cards')).includes('99%'), '99%로 남는 항목 없음');
  // 예전 버전이 남긴 기록(체크는 풀렸는데 100%)도 열 때 바로잡음
  assert(await page.evaluate(() => StoreLib.normalize({ tasks: [], topics: [{ id: 'a', done: false, pct: 100 }, { id: 'b', done: true, pct: 100 }, { id: 'c', done: false, pct: 40 }] }).topics.map((t) => t.pct).join(',')) === '0,100,40', '예전 기록의 잘못된 100%를 0으로 바로잡음');

  /* 2) 조사: 받침에 맞게 */
  const josa = await page.evaluate(() => [Stats.josa('국어', '을/를'), Stats.josa('수학', '을/를'), Stats.josa('국어', '으로/로'), Stats.josa('통합과학', '으로/로'), Stats.josa('수학 1', '으로/로'), Stats.josa('한국사', '과/와'), Stats.josa('문법', '과/와')].join(' '));
  assert(josa === '를 을 로 으로 로 와 과', '조사 고르기: ' + josa);
  await page.evaluate(() => App.store.update((s) => { s.topics.find((t) => t.id === 'k1').pct = 50; }));
  await page.locator('[data-id="k1"] .bmenu').first().tap();
  await page.tap('#pop-menu [data-act="page:move"]');
  await page.tap('#pop-menu [data-act="move-to"]');
  assert((await page.textContent('#move-sub')).includes('‘고전시가: 관동별곡’을'), '옮기기 안내 문장 조사 (을)');
  await page.tap('#move-list [data-move-to="m"]');
  assert((await toastText()).includes('‘고전시가: 관…’을 ‘수학’ 아래로') || (await toastText()).includes('관동별곡’을 ‘수학’ 아래로'), '옮긴 뒤 알림 조사: ' + await toastText());
  await page.locator('[data-id="m1"] .bmenu').first().tap();
  await page.tap('#pop-menu [data-act="page:move"]');
  await page.tap('#pop-menu [data-act="move-to"]');
  assert((await page.textContent('#move-sub')).includes('‘다항식’을'), '받침 있는 이름은 을');
  await page.tap('#move-cancel');
  await page.evaluate(() => App.store.update((s) => { s.topics.find((t) => t.id === 'm2').title = '부등식 기초'; }));
  await page.locator('[data-id="m2"] .bmenu').first().tap();
  await page.tap('#pop-menu [data-act="page:move"]');
  await page.tap('#pop-menu [data-act="move-to"]');
  assert((await page.textContent('#move-sub')).includes('‘부등식 기초’를'), '받침 없는 이름은 를');
  await page.tap('#move-cancel');

  /* 3) 보드(좁은 카드): 진행률 칩은 %만, 제목이 한두 글자씩 끊기지 않음 */
  const listChip = await page.evaluate(() => { const b = document.querySelector('[data-id="k1"] .btime'); return { text: b.textContent, w: b.getBoundingClientRect().width }; });
  assert(listChip.text.includes('남은') && listChip.w > 70, '목록 보기: ‘50% · 남은 …’ 그대로 (' + listChip.text + ')');
  await page.evaluate(() => Board.setMode('board', false));
  await page.waitForTimeout(300);
  const boardRow = await page.evaluate(() => {
    const row = document.querySelector('[data-id="k1"]');
    const z = App.store.get().boardView.ex1 ? App.store.get().boardView.ex1.z : 1;
    const left = row.querySelector('.bt-left');
    return { leftShown: left && getComputedStyle(left).display !== 'none', titleW: row.querySelector('.btitle').getBoundingClientRect().width / (z || 1) };
  });
  assert(!boardRow.leftShown && boardRow.titleW >= 72, '보드 보기: 칩은 %만 보이고 제목 폭 ' + Math.round(boardRow.titleW) + 'px');
  // 보드 도구: 색 이모지·글꼴 기호 대신 선 아이콘
  const tools = await page.$$eval('.bb-btn.tool', (els) => els.map((e) => ({ svg: !!e.querySelector('svg.ic use'), text: e.textContent.trim() })));
  assert(tools.length === 4 && tools.every((t) => t.svg && !t.text), '보드 도구 4개가 선 아이콘');
  await page.evaluate(() => Board.setMode('list', false));

  /* 4) 선 아이콘: 고치기·삭제 버튼 크기가 같고, 글꼴 기호가 남아 있지 않음 */
  await page.evaluate(() => App.store.update((s) => {
    s.tasks.push({ id: 't1', title: '수학 문제집', subjectId: 's-math', due: Stats.dayKey(Date.now()), estimateMin: 30, done: false, createdAt: Date.now() });
    s.decks.push({ id: 'd1', name: '영단어', createdAt: Date.now() });
    s.cards.push(SRS.newCard({ id: 'c1', deckId: 'd1', front: 'apple', back: '사과', createdAt: Date.now() }, Date.now()));
  }));
  await page.goto(base + '#plan');
  const taskBtns = await page.$$eval('#tasklist .task .icon-btn', (els) => els.map((e) => { const r = e.getBoundingClientRect(); const i = e.querySelector('svg.ic').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), iw: Math.round(i.width), text: e.textContent.trim() }; }));
  assert(taskBtns.length === 2 && taskBtns[0].w === taskBtns[1].w && taskBtns[0].h === taskBtns[1].h && taskBtns[0].w >= 36, '할 일 고치기·삭제 버튼 크기 같음 (' + taskBtns.map((b) => b.w + 'x' + b.h).join(', ') + ')');
  assert(taskBtns.every((b) => b.iw === 18 && !b.text), '아이콘 18px, 글꼴 기호 없음');
  await page.tap('#tasklist .task-del'); // 아이콘(svg) 위를 눌러도 삭제
  assert((await state()).tasks.length === 0, '삭제 아이콘을 눌러 할 일 삭제');
  await page.goto(base + '#review');
  await page.tap('#deck-list [data-deck="d1"]');
  const cardBtns = await page.$$eval('.card-row .icon-btn', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  assert(cardBtns.length === 2 && cardBtns[0] === cardBtns[1], '카드 고치기·삭제 버튼 크기 같음');
  const glyphs = /[✎✕▶⏱↶✋▍⌫🔒♟☰▦]/u;
  for (const v of ['home', 'board', 'plan', 'timer', 'review', 'stats', 'account']) {
    await page.goto(base + '#' + v);
    const bad = await page.evaluate((src) => {
      const re = new RegExp(src, 'u');
      return [...document.querySelectorAll('main button, main a, .board-bar button, h3')].filter((e) => e.offsetParent && re.test(e.textContent)).map((e) => e.textContent.trim().slice(0, 12));
    }, glyphs.source);
    assert(bad.length === 0, v + ' 화면 버튼에 글꼴 기호 아이콘 없음 ' + bad.join(' | '));
  }
  assert(await page.evaluate(() => [...document.querySelectorAll('svg.ic use')].every((u) => document.getElementById(u.getAttribute('href').slice(1)))), '쓰인 선 아이콘이 모두 아이콘 묶음에 있음');

  /* 5) 터치 화면: 누른 뒤 ‘마우스 올림’ 모양이 남지 않게 :hover 규칙은 마우스가 있을 때만 */
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const bare = css.split('\n').filter((l) => l.includes(':hover') && !l.includes('(hover: hover)') && !/\[disabled\]:hover|\.on:hover/.test(l));
  assert(bare.length === 0, ':hover 규칙이 모두 (hover: hover) 안에 있음 ' + bare.map((l) => l.trim().slice(0, 40)).join(' | '));
  await page.goto(base + '#timer');
  await page.evaluate(() => Stopwatch.showTab('focus'));
  const inkBg = await page.evaluate(() => getComputedStyle(document.querySelector('#timer-start')).backgroundColor);
  await page.tap('#timer-start');
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('#timer-start')).backgroundColor) === inkBg, '시작을 누른 뒤에도 버튼 색이 그대로');

  /* 6) 집중 → 휴식으로 바꾸면 그때까지 한 시간은 기록 (전에는 말없이 사라졌다) */
  const before = (await state()).sessions.length;
  await page.evaluate(() => { const t = window.__studypromotion.timer; t.endAt -= 7 * 60 * 1000; }); // 7분 지난 것으로
  await page.tap('#timer-start'); // 일시정지
  await page.tap('.mode-switch [data-mode="focus"]'); // 지금 모드를 다시 눌러도 그대로
  let tm = await page.evaluate(() => { const t = window.__studypromotion.timer; return { mode: t.mode, remaining: t.remaining, total: t.total }; });
  assert(tm.mode === 'focus' && tm.remaining < tm.total, '지금 모드를 다시 눌러도 하던 타이머가 처음으로 돌아가지 않음');
  // 일시정지 중에 설정을 저장해도 하던 타이머는 그대로
  await page.goto(base + '#account');
  await page.fill('#set-goal', '200');
  await page.evaluate(() => document.querySelector('#settings-form').requestSubmit());
  tm = await page.evaluate(() => { const t = window.__studypromotion.timer; return { remaining: t.remaining, total: t.total }; });
  assert(tm.remaining < tm.total && (await state()).settings.dailyGoalMin === 200, '설정을 저장해도 일시정지한 타이머가 지워지지 않음');
  await page.goto(base + '#timer');
  await page.tap('.mode-switch [data-mode="break"]');
  st = await state();
  assert(st.sessions.length === before + 1 && st.sessions[st.sessions.length - 1].minutes === 7, '집중 7분 하다가 휴식으로 바꾸면 7분 기록');
  assert((await page.evaluate(() => window.__studypromotion.timer.mode)) === 'break', '휴식으로 바뀜');
  await page.tap('.mode-switch [data-mode="focus"]');
  assert((await state()).sessions.length === before + 1, '휴식에서 집중으로 바꿀 때는 기록 없음');
  // 달리는 중에는 물어보고, 취소하면 그대로
  await page.tap('#timer-start');
  await page.evaluate(() => { const t = window.__studypromotion.timer; t.endAt -= 3 * 60 * 1000; });
  await page.tap('.mode-switch [data-mode="break"]');
  await page.tap('#ask-cancel');
  assert(await page.evaluate(() => window.__studypromotion.timer.running) && (await state()).sessions.length === before + 1, '취소하면 계속 돎');
  await page.tap('.mode-switch [data-mode="break"]');
  await page.tap('#ask-ok');
  st = await state();
  assert(st.sessions.length === before + 2 && st.sessions[st.sessions.length - 1].minutes === 3, '도는 중에 바꾸면 3분 기록');
  await page.tap('.mode-switch [data-mode="focus"]');

  /* 7) 집중 횟수: 스톱워치·직접 기록은 세지 않음 */
  await page.evaluate(() => App.store.update((s) => {
    const t = Date.now();
    s.sessions = [
      { id: 'a', subjectId: 's-kor', minutes: 25, endedAt: t - 1000, label: '국어 · 고전시가: 관동별곡', topicId: 'k1' },
      { id: 'b', subjectId: 's-math', minutes: 40, sec: 2400, endedAt: t - 2000, label: null, kind: 'stopwatch' },
      { id: 'c', subjectId: 's-math', minutes: 60, endedAt: t - 3000, label: '학원', manual: true },
      { id: 'd', subjectId: null, minutes: 30, endedAt: t - 4000, label: '잠금 모드 완료', lock: true },
    ];
  }));
  assert(/오늘 공부 2시간 35분 · 집중 2회/.test(await page.textContent('#timer-today')), '집중 횟수는 집중 타이머·잠금만 (' + await page.textContent('#timer-today') + ')');

  /* 8) 통계의 최근 기록: 과목 이름이 두 번 나오지 않음 */
  await page.goto(base + '#stats');
  const first = await page.textContent('#session-list li:first-child .sl-what');
  assert(first.replace(/\s+/g, ' ').trim() === '국어 · 고전시가: 관동별곡', '최근 기록에 과목 이름이 겹치지 않음: ' + first.trim());

  /* 9) 새벽 인사 */
  await page.clock.install({ time: new Date('2026-11-12T03:10:00+09:00') });
  await page.goto(base + '#home');
  assert((await page.textContent('#home-greeting')) === '늦은 시간까지 수고 많아요', '새벽 3시에는 아침 인사 대신 밤 인사');

  /* 10) 처음 쓰는 사람 화면(기록 없음): 안내 문장·안내 상자·체스판 무늬 */
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const fp = await fresh.newPage();
  fp.on('pageerror', (e) => errors.push(e.message));
  await fp.goto(base + '#stats');
  assert(await fp.$eval('#session-list li.empty', (li) => getComputedStyle(li).display) === 'block', '기록이 없을 때 안내가 한 문장으로 이어짐 (세 칸으로 갈라지지 않음)');
  await fp.goto(base + '#board');
  await fp.fill('#ex-name', '기말고사');
  await fp.tap('#exam-form button[type=submit]');
  await fp.evaluate(() => Board.setMode('board'));
  await fp.waitForSelector('.board-hint');
  const hintBox = await fp.$eval('.board-hint', (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  assert(hintBox.left >= 0 && hintBox.right <= 390, '보드 보기 안내 상자가 휴대폰 화면 안에 들어옴 (' + Math.round(hintBox.left) + '~' + Math.round(hintBox.right) + ')');
  await fresh.close();
  const wide = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const wp = await wide.newPage();
  wp.on('pageerror', (e) => errors.push(e.message));
  await wp.goto(base + '#board');
  await wp.waitForSelector('#exam-form');
  const bg = await wp.evaluate(() => { const vp = document.querySelector('#board-viewport'); return vp ? parseFloat(getComputedStyle(vp).backgroundSize) : -1; });
  assert(bg > 0 && bg <= 200, '시험이 없을 때 체스판 무늬가 큰 네 칸으로 늘어나지 않음 (' + bg + 'px)');
  await wide.close();

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
