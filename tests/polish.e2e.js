// 다듬기 테스트: 플래시카드 고치기, 타이머 시간 빠른 선택, 공부 달력, 기간별 과목 시간, 끝난 시험 정리, 하단 아이콘
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
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));

  await page.goto(base + '#home');
  // 하단 탭: 글꼴 기호 대신 같은 크기의 선 아이콘
  const icoSizes = await page.$$eval('.tab .ico svg', (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  assert(icoSizes.length === 6 && icoSizes.every((w) => w === icoSizes[0] && w >= 20), '하단 탭 아이콘 6개가 같은 크기 (' + icoSizes.join(',') + ')');

  // 1) 플래시카드 고치기
  await page.evaluate(() => {
    const t = Date.now();
    App.store.update((s) => {
      s.decks.push({ id: 'd1', name: '영단어', createdAt: t });
      s.cards.push(SRS.newCard({ id: 'c1', deckId: 'd1', front: 'aple', back: '사과', createdAt: t }, t));
      s.cards.push(SRS.newCard({ id: 'c2', deckId: 'd1', front: 'banana', back: '바나나', createdAt: t }, t));
    });
  });
  await page.goto(base + '#review');
  await page.tap('#deck-list [data-deck="d1"]');
  await page.tap('[data-card="c1"] .card-edit-btn');
  assert(await page.isVisible('[data-card="c1"] .card-edit'), '✎ 누르면 그 자리에서 고치기');
  assert(await page.evaluate(() => document.activeElement && document.activeElement.name === 'front'), '앞면 칸에 바로 커서');
  await page.fill('[data-card="c1"] [name="front"]', 'apple');
  // 고치는 중에 다른 변경으로 다시 그려져도 입력이 남음
  await page.evaluate(() => App.store.update((s) => { s.settings.dailyGoalMin = 130; }));
  assert((await page.inputValue('[data-card="c1"] [name="front"]')) === 'apple', '다시 그려져도 고치던 글자 유지');
  await page.keyboard.press('Enter');
  let st = await state();
  assert(st.cards.find((c) => c.id === 'c1').front === 'apple' && st.cards.find((c) => c.id === 'c1').back === '사과', '저장하면 카드 내용이 바뀜');
  assert(!(await page.isVisible('.card-edit')), '저장하면 고치기 칸 닫힘');
  await page.tap('[data-card="c2"] .card-edit-btn');
  await page.fill('[data-card="c2"] [name="back"]', '');
  await page.tap('[data-card="c2"] .card-edit button[type="submit"]');
  assert((await state()).cards.find((c) => c.id === 'c2').back === '바나나', '빈칸이면 저장 안 함');
  await page.tap('[data-card="c2"] [data-card-cancel]');
  assert(!(await page.isVisible('.card-edit')), '취소');

  // 카드 삭제는 알림에서 되돌리기
  await page.tap('[data-card="c2"] .card-del');
  assert(!(await state()).cards.some((c) => c.id === 'c2'), '카드 삭제');
  await page.tap('#toast .toast-act');
  const order = (await state()).cards.map((c) => c.id).join(',');
  assert(order === 'c1,c2', '되돌리기로 같은 자리에 복구 (' + order + ')');

  // 할 일 삭제도 되돌리기
  await page.evaluate(() => App.store.update((s) => s.tasks.push({ id: 'tk', title: '수학 익힘책', done: false, createdAt: Date.now() })));
  await page.goto(base + '#plan');
  await page.tap('#tasklist [data-id="tk"] .task-del');
  assert(!(await state()).tasks.some((x) => x.id === 'tk'), '할 일 삭제');
  await page.tap('#toast .toast-act');
  assert((await state()).tasks.some((x) => x.id === 'tk'), '할 일 되돌리기');
  // 할 일 고치기: 이름·과목·마감일·예상 시간
  await page.tap('#tasklist [data-id="tk"] .task-edit-btn');
  assert(await page.isVisible('#tasklist .task-edit'), '할 일 ✎ 누르면 고치기');
  await page.fill('#tasklist .task-edit [name="title"]', '수학 익힘책 40~45쪽');
  await page.selectOption('#tasklist .task-edit [name="subject"]', { label: '수학' });
  await page.fill('#tasklist .task-edit [name="due"]', '2030-01-05');
  await page.fill('#tasklist .task-edit [name="est"]', '45');
  await page.tap('#tasklist .task-edit button[type="submit"]');
  const tk = (await state()).tasks.find((x) => x.id === 'tk');
  assert(tk.title === '수학 익힘책 40~45쪽' && tk.due === '2030-01-05' && tk.estimateMin === 45 && tk.subjectId === (await state()).subjects.find((x) => x.name === '수학').id, '할 일 내용이 바뀜');
  assert(!(await page.isVisible('#tasklist .task-edit')), '저장하면 닫힘');
  // 알림이 사라진 뒤에는 그 자리를 눌러도 아무 일 없음 (보이지 않는 버튼이 막지 않게)
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('#toast')).pointerEvents === 'none'), '닫힌 알림은 터치를 막지 않음');

  // 2) 타이머: 시작 전 집중·휴식 시간 빠른 선택
  await page.goto(base + '#timer');
  assert(await page.isVisible('#len-chips [data-len="50"]'), '집중 시간 고르기 (25·50·90분)');
  await page.tap('#len-chips [data-len="50"]');
  assert((await state()).settings.focusMin === 50 && (await page.textContent('#timer-time')) === '50:00', '50분을 고르면 바로 50:00');
  await page.tap('#timer-start');
  assert(await page.evaluate(() => getComputedStyle(document.querySelector('#len-chips')).visibility === 'hidden'), '타이머가 도는 동안은 숨김 (자리는 유지)');
  await page.tap('#timer-reset');
  await page.tap('.mode-switch [data-mode="break"]');
  await page.tap('#ask-ok').catch(() => {});
  assert(await page.isVisible('#len-chips [data-len="10"]'), '휴식에서는 5·10·15분');
  await page.tap('#len-chips [data-len="10"]');
  assert((await state()).settings.breakMin === 10 && (await page.textContent('#timer-time')) === '10:00', '휴식 10분');
  await page.goto(base + '#account');
  assert((await page.inputValue('#set-focus')) === '50' && (await page.inputValue('#set-break')) === '10', '설정 화면 값과 같음');

  // 3) 공부 달력과 기간별 과목 시간
  const now = Date.now();
  await page.evaluate((n) => App.store.update((s) => {
    const [ko, ma] = s.subjects;
    s.sessions.push({ id: 'a', subjectId: ko.id, minutes: 30, endedAt: n });
    s.sessions.push({ id: 'b', subjectId: ma.id, minutes: 100, endedAt: n });
    s.sessions.push({ id: 'old', subjectId: ma.id, minutes: 300, endedAt: n - 400 * 864e5 });
  }), now);
  await page.goto(base + '#stats');
  const today = dayKey(now);
  assert(await page.isVisible(`#cal-grid [data-cal="${today}"].today.lv3`), '오늘 칸이 2시간 10분만큼 진하게 (2~4시간 단계)');
  const detail = await page.textContent('#cal-detail');
  assert(detail.includes('오늘') && detail.includes('2시간 10분') && detail.includes('수학 1시간 40분') && detail.includes('국어 30분'), '오늘 과목별 공부 시간 (' + detail + ')');
  assert(await page.isDisabled('#cal-next'), '다음 달로는 못 감');
  await page.tap('#cal-prev');
  const prevTitle = await page.textContent('#cal-title');
  const pm = new Date(new Date(now).getFullYear(), new Date(now).getMonth() - 1, 1);
  assert(prevTitle === `${pm.getFullYear()}년 ${pm.getMonth() + 1}월`, '이전 달 보기 (' + prevTitle + ')');
  assert((await page.textContent('#cal-detail')).includes('날짜를 누르면'), '다른 달은 날짜를 눌러 보기');
  await page.tap('#cal-next');
  const days = await page.$$eval('#cal-grid [data-cal]', (els) => els.length);
  assert(days === new Date(new Date(now).getFullYear(), new Date(now).getMonth() + 1, 0).getDate(), '이번 달 날 수만큼 칸');
  // 기간: 이번 달(기본) → 전체
  let bars = await page.textContent('#subject-bars');
  assert(bars.includes('1시간 40분') && !bars.includes('6시간 40분'), '과목 시간 기본은 이번 달');
  await page.tap('#subj-period [data-period="all"]');
  bars = await page.textContent('#subject-bars');
  assert(bars.includes('6시간 40분'), '전체로 바꾸면 예전 기록까지');
  await page.tap('#subj-period [data-period="week"]');
  assert((await page.textContent('#subject-bars')).includes('1시간 40분'), '최근 7일');

  // 최근 기록: 10개씩, 더 보기
  await page.evaluate((n) => App.store.update((s) => { for (let i = 0; i < 15; i++) s.sessions.push({ id: 'x' + i, subjectId: null, minutes: 10, endedAt: n - (i + 1) * 3600e3 }); }), now);
  assert((await page.$$('#session-list [data-del-session]')).length === 10, '최근 기록은 10개만');
  assert((await page.textContent('#session-list [data-more-sessions]')).includes('8개'), '나머지 개수 표시');
  await page.tap('#session-list [data-more-sessions]');
  assert((await page.$$('#session-list [data-del-session]')).length === 18 && !(await page.$('[data-more-sessions]')), '더 보기 누르면 전부');

  // 4) 홈: 다가오는 시험이 먼저, 끝난 시험은 뒤로 흐리게
  await page.evaluate((d) => App.store.update((s) => {
    s.exams.push({ id: 'p', name: '지난 중간고사', date: '2020-04-20', createdAt: 1 });
    s.exams.push({ id: 'u', name: '다가오는 기말고사', date: d, createdAt: 2 });
    Scope.addOutline(s.topics, 'p', Scope.parseOutline('# 국어\n- 1단원'), App.uid);
    Scope.addOutline(s.topics, 'u', Scope.parseOutline('# 국어\n- 2단원'), App.uid);
  }), dayKey(now + 20 * 864e5));
  await page.goto(base + '#home');
  const rows = await page.$$eval('#h-exams .exam-row', (els) => els.map((e) => ({ name: e.querySelector('.exam-name').textContent, past: e.classList.contains('past'), badge: e.querySelector('.badge').textContent })));
  assert(rows[0].name === '다가오는 기말고사' && rows[1].name === '지난 중간고사' && rows[1].past && rows[1].badge.startsWith('끝남'), '다가오는 시험 먼저, 끝난 시험은 뒤에 "끝남"');

  // 5) 범위 ⋯ 메뉴에서 시험 바꾸기 (좁은 화면에서는 ✎ 대신)
  await page.goto(base + '#board');
  await page.evaluate(() => Board.setMode('list', false));
  assert(!(await page.isVisible('#bb-exam-edit')), '좁은 화면: ✎ 숨김(시험 이름이 잘리지 않게)');
  await page.tap('#bb-more');
  await page.tap('[data-act="edit-exam"]');
  assert(await page.isVisible('#exam-dlg'), '⋯ 메뉴에서 시험 이름·날짜 바꾸기');
  await page.keyboard.press('Escape');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '가로 스크롤 없음');
  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
