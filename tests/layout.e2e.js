// v3.6 테스트: 기능과 탭 편집 (계정·설정 › 기능과 탭 편집, js/features.js · js/layout.js)
//  ① 들어가고 나오기, 처음 모습  ② 탭 끄기 (탭 막대·홈 카드·주소로 열기·'켜기')  ③ 탭 순서 (손잡이·꾹 누르기·화살표 키·첫 화면)
//  ④ 홈 화면 칸 (순서·숨기기·필요한 탭이 꺼지면)  ⑤ 타이머 안 기능 (집중 타이머·스톱워치·폰 잠금)
//  ⑥ 세컨드·카드 링크  ⑦ 처음 배치로, 다른 기기에서 바뀜  ⑧ 컴퓨터·가로 화면
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

const TABS = ['home', 'board', 'plan', 'timer', 'review', 'stats', 'group'];
const HOME = ['home-sum', 'home-group', 'home-tt', 'home-exams', 'home-next', 'home-tasks'];
// 홈에 보이는 칸: '우리 그룹'은 그룹에 들어 있을 때만 보인다 (이 시험에서는 그룹이 없다)
const HOME_SHOWN = HOME.filter((x) => x !== 'home-group');
const BAR = 'studypromotion.tabbar';
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 과목 둘, 할 일 하나(수학, 예상 45분), 한 달 뒤 시험과 범위 둘, 덱 하나
function seed(settings) {
  return {
    subjects: [{ id: 's1', name: '국어', color: '#e05a4f' }, { id: 's2', name: '수학', color: '#3d96e0' }],
    tasks: [{ id: 't1', title: '수학 문제집 3쪽', subjectId: 's2', due: null, estimateMin: 45, done: false, createdAt: 1 }],
    exams: [{ id: 'e1', name: '기말고사', date: dayKey(Date.now() + 30 * 86400000), createdAt: 1 }],
    activeExamId: 'e1',
    topics: [
      { id: 'c1', examId: 'e1', parentId: null, kind: 'topic', title: '국어', order: 0, x: 0, y: 0, color: '#e05a4f', flags: {} },
      { id: 'k1', examId: 'e1', parentId: 'c1', kind: 'topic', title: '문학 1강', order: 0, est: 30, flags: {} },
      { id: 'k2', examId: 'e1', parentId: 'c1', kind: 'topic', title: '문학 2강', order: 1, est: 30, flags: {} },
    ],
    decks: [{ id: 'd1', name: '영어 단어', createdAt: 1 }],
    settings: Object.assign({ dailyGoalMin: 120 }, settings || {}),
  };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];

  // o.settings: 처음 기록의 설정, o.ctx: 화면 크기 등, o.mock: 가짜 AI를 넣어 세컨드 단추가 생기게
  async function open(o) {
    o = o || {};
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ko-KR', serviceWorkers: 'block' }, o.ctx || {}));
    await ctx.addInitScript(({ data, mock }) => {
      if (mock) window.AIMock = { async ask(m, opts) { opts.onText('네'); return { text: '네', left: 19 }; } };
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.setItem('studypromotion.welcomeClosed', '1');
      localStorage.setItem('studypromotion.v1', JSON.stringify(Object.assign({ cards: [], sessions: [], reviewLog: [], strokes: [], boardView: {}, events: [] }, data)));
    }, { data: seed(o.settings), mock: !!o.mock });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return { ctx, page };
  }
  const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const layoutOf = async (page) => (await state(page)).settings.layout || null;
  const barOf = (page) => page.evaluate((k) => localStorage.getItem(k), BAR);
  const toastOf = (page) => page.textContent('#toast');
  const viewOf = (page) => page.evaluate(() => App.view);
  // 화면에 보이는 탭을 놓인 차례대로 (왼쪽부터)
  const shownTabs = (page) => page.$$eval('nav.tabs .tab', (els) => els.map((e) => ({ v: e.dataset.view, r: e.getBoundingClientRect() }))
    .filter((x) => x.r.width > 0).sort((a, b) => a.r.left - b.r.left || a.r.top - b.r.top).map((x) => x.v).join(','));
  const rows = (page, list) => page.$$eval(`#${list} > .lay-row`, (els) => els.map((e) => e.dataset.id).join(','));
  // 홈 화면에 보이는 칸을 위에서부터
  const homeOrder = (page) => page.$$eval('#view-home > [data-home]', (els) => els.map((e) => ({ v: e.dataset.home, r: e.getBoundingClientRect() }))
    .filter((x) => x.r.height > 0).sort((a, b) => a.r.top - b.r.top).map((x) => x.v).join(','));
  const swOf = (page, id) => page.locator(`#view-layout [data-sw="${id}"]`);
  async function flip(page, id) {
    const el = swOf(page, id);
    await el.scrollIntoViewIfNeeded();
    await el.tap();
    await page.waitForTimeout(150);
  }
  const rowBox = (page, list, id) => page.locator(`#${list} > .lay-row[data-id="${id}"]`).boundingBox();
  const openEditor = async (page) => { await page.evaluate(() => App.go('account')); await page.click('#lay-entry'); await page.waitForTimeout(150); };

  // 손가락: CDP 터치로 누른 채 끌기 (holdMs 동안 가만히 → steps번에 나눠 dy만큼)
  async function touchDrag(page, el, dy, holdMs, steps) {
    const cdp = await page.context().newCDPSession(page);
    const b = await el.boundingBox();
    const x = b.x + Math.min(14, b.width / 2), y = b.y + b.height / 2;
    const pt = (yy) => [{ x, y: yy, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y) });
    if (holdMs) await page.waitForTimeout(holdMs);
    const n = steps || 12;
    for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y + (dy * i) / n) }); await page.waitForTimeout(16); }
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    await cdp.detach();
  }

  /* ===== ① 들어가고 나오기, 처음 모습 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#account');
    await page.waitForSelector('#lay-entry');
    assert(/기능과 탭 편집/.test(await page.textContent('#lay-entry')), '설정 칸 맨 위에 ‘기능과 탭 편집’');
    await page.tap('#lay-entry');
    await page.waitForTimeout(150);
    assert(await viewOf(page) === 'layout' && (await page.evaluate(() => location.hash)) === '#layout', '누르면 편집 화면 (#layout)');
    assert(await page.evaluate(() => document.getElementById('account-btn').classList.contains('active')), '오른쪽 위 계정 단추가 켜진 채로 (계정·설정 안의 화면)');
    assert(await rows(page, 'lay-tabs') === TABS.join(','), '탭 목록: 지금 순서 그대로 ' + await rows(page, 'lay-tabs'));
    assert(await rows(page, 'lay-home') === HOME.join(','), '홈 화면 칸 목록: ' + await rows(page, 'lay-home'));
    assert(await page.textContent('#lay-tabs > [data-id="home"] .lay-always') === '항상 켜짐' && !(await page.$('#lay-tabs [data-sw="home"]')), '홈 탭은 끌 수 없음 (항상 켜짐)');
    assert(!(await page.$('#lay-home [data-sw="home-sum"]')), '오늘 요약 칸도 항상 켜짐');
    const subs = await page.$$eval('#lay-subs > *', (els) => els.map((e) => (e.classList.contains('lay-group') ? '#' + e.textContent : [...e.querySelectorAll('.lay-row')].map((r) => r.dataset.id).join(','))).join(' | '));
    assert(subs === '#타이머 안 | focus,stopwatch,lock | #플래너 안 | plcarry,plslot,plreview | #복습 안 | voice | #그룹 안 | grchat | #어디서나 | ai', '탭 안 기능 묶음: ' + subs);
    assert(await page.$$eval('#view-layout [data-sw]', (els) => els.every((e) => e.checked && !e.disabled)), '처음엔 모두 켜짐');
    assert(await page.isDisabled('#lay-reset'), '처음 배치면 ‘처음 배치로 되돌리기’는 누를 수 없음');
    assert(await layoutOf(page) === null && await barOf(page) === null, '바꾸기 전에는 아무것도 저장하지 않음');
    assert(await page.getAttribute('#lay-tabs > [data-id="timer"] .lay-grip', 'aria-label') === '타이머 탭 순서 바꾸기' && await page.getAttribute('#lay-tabs [data-sw="review"]', 'aria-label') === '복습 탭 켜기', '손잡이·스위치 이름');
    // 휴대폰 ‘뒤로’ → 계정·설정
    await page.evaluate(() => history.back());
    await page.waitForTimeout(300);
    assert(await viewOf(page) === 'account', '‘뒤로’를 누르면 홈이 아니라 계정·설정으로');
    await page.tap('#lay-entry');
    await page.tap('.lay-back');
    await page.waitForTimeout(100);
    assert(await viewOf(page) === 'account', '‘‹ 계정·설정’ 링크로도');
    await ctx.close();
  }

  /* ===== ② 탭 끄기 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#account');
    await page.waitForSelector('#lay-entry');
    await page.tap('#lay-entry');
    await flip(page, 'review');
    assert(await toastOf(page) === '복습 탭을 껐어요. 기록은 그대로 있어요.', '끄면 알림: ' + await toastOf(page));
    assert(await shownTabs(page) === 'home,board,plan,timer,stats,group', '탭 막대에서 복습이 빠짐: ' + await shownTabs(page));
    assert(JSON.stringify(await layoutOf(page)) === JSON.stringify({ tabs: TABS, home: HOME, off: ['review'] }), '기록(settings.layout)에 저장: ' + JSON.stringify(await layoutOf(page)));
    assert(await barOf(page) === JSON.stringify({ o: TABS, x: ['review'] }), '첫 화면용 탭 사본도');
    const cls = await page.getAttribute('#lay-tabs > [data-id="review"]', 'class');
    assert(/\boff\b/.test(cls) && /self-off/.test(cls) && !(await page.isChecked('#lay-tabs [data-sw="review"]')), '편집 화면의 복습 줄: 흐리게, ‘꺼짐’');
    assert(!(await page.isDisabled('#lay-reset')), '바꾼 뒤에는 ‘처음 배치로’를 누를 수 있음');
    // 홈: 복습 대기 카드가 빠지고 3장 (휴대폰에서는 오늘 공부가 한 줄 전체)
    await page.evaluate(() => App.go('home'));
    await page.waitForTimeout(150);
    assert(await page.getAttribute('#view-home .cards4', 'data-n') === '3' && await page.isHidden('#view-home .cards4 > [data-feature="review"]'), '홈 요약 카드 3장 (복습 대기 카드 숨김)');
    const [c1, c2, c3] = await page.$$eval('#view-home .cards4 > .stat', (els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, y: r.top })));
    assert(c1.w > c2.w * 1.8 && c2.y > c1.y && Math.abs(c2.y - c3.y) < 2, '3장이면 오늘 공부 카드가 한 줄, 나머지 둘이 아래 줄');
    // 주소로 복습을 열면 → 열지 않고 안내, ‘켜기’로 켜고 연다
    await page.evaluate(() => { location.hash = '#review'; });
    await page.waitForTimeout(250);
    assert(await viewOf(page) === 'home' && (await page.evaluate(() => location.hash)) === '#home', '꺼 둔 탭 주소로는 열리지 않고 지금 화면 그대로');
    assert(/^복습은 꺼 둔 기능이에요/.test(await toastOf(page)) && await page.textContent('#toast .toast-act') === '켜기', '안내 알림에 ‘켜기’: ' + await toastOf(page));
    await page.tap('#toast .toast-act');
    await page.waitForTimeout(200);
    assert(await viewOf(page) === 'review' && await shownTabs(page) === TABS.join(','), '‘켜기’ → 복습을 켜고 엶');
    assert(await layoutOf(page) === null && await barOf(page) === null, '다시 처음 배치가 되면 저장한 배치를 비움');
    // 이 화면(통계)의 탭을 다른 곳에서 끄면 홈으로
    await page.evaluate(() => App.go('stats'));
    await page.evaluate(() => Features.set('stats', false));
    await page.waitForTimeout(150);
    assert(await viewOf(page) === 'home' && await page.isHidden('nav.tabs .tab[data-view="stats"]'), '보고 있던 화면의 탭이 꺼지면 홈으로');
    // 새로 고쳐도 그대로
    await page.reload();
    await page.waitForTimeout(300);
    assert(await shownTabs(page) === 'home,board,plan,timer,review,group' && !(await page.$('#tabbar-pre')), '새로 고침 뒤에도 통계 꺼짐 (첫 화면용 스타일은 정리됨)');
    // 탭을 다 끄면 탭 막대를 숨긴다 (홈만)
    await page.evaluate(() => ['board', 'plan', 'timer', 'review', 'group'].forEach((id) => Features.set(id, false)));
    await page.waitForTimeout(150);
    assert(await page.isHidden('nav.tabs') && await page.evaluate(() => document.documentElement.classList.contains('one-tab')), '홈만 남으면 탭 막대 숨김');
    assert(await page.getAttribute('#view-home .cards4', 'data-n') === '2' && await page.isHidden('#h-start'), '홈 요약은 오늘 공부·연속 학습일 두 장, 공부 시작하기 단추도 숨김(타이머 꺼짐)');
    await page.evaluate(() => Features.set('plan', true));
    await page.waitForTimeout(150);
    assert(await page.isVisible('nav.tabs') && await shownTabs(page) === 'home,plan', '하나를 켜면 탭 막대가 다시: ' + await shownTabs(page));
    await ctx.close();
  }

  /* ===== ③ 탭 순서 바꾸기 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#account');
    await page.waitForSelector('#lay-entry');
    await page.tap('#lay-entry');
    await page.waitForTimeout(150);
    // 손잡이를 잡으면 바로 끌린다: 타이머를 맨 앞으로
    const t0 = await rowBox(page, 'lay-tabs', 'timer'), h0 = await rowBox(page, 'lay-tabs', 'home');
    await touchDrag(page, page.locator('#lay-tabs > [data-id="timer"] .lay-grip'), h0.y - t0.y - 6, 0);
    assert(await rows(page, 'lay-tabs') === 'timer,home,board,plan,review,stats,group', '손잡이로 타이머를 맨 앞으로: ' + await rows(page, 'lay-tabs'));
    assert(await shownTabs(page) === 'timer,home,board,plan,review,stats,group', '탭 막대도 바로 그 순서로: ' + await shownTabs(page));
    assert(JSON.stringify((await layoutOf(page)).tabs) === JSON.stringify(['timer', 'home', 'board', 'plan', 'review', 'stats', 'group']) && (await layoutOf(page)).off.length === 0, '순서 저장');
    assert(await page.textContent('#lay-live') === '타이머, 1번째로 옮겼어요', '화면 읽기 프로그램에 알림: ' + await page.textContent('#lay-live'));
    assert(!(await page.$('#view-layout .drag-lift')) && !(await page.$('#lay-tabs > .lay-row[style*="translate"]')), '놓으면 들린 모양·밀린 줄 원래대로');
    // 줄을 꾹(0.4초) 누르고 끌기: 통계를 한 칸 위로
    const s0 = await rowBox(page, 'lay-tabs', 'stats');
    await touchDrag(page, page.locator('#lay-tabs > [data-id="stats"] .lay-text'), -s0.height * 1.1, 550);
    assert(await rows(page, 'lay-tabs') === 'timer,home,board,plan,stats,review,group', '줄을 꾹 눌러 끌어도: ' + await rows(page, 'lay-tabs'));
    // 꾹 누르지 않고 바로 밀면 그냥 화면 굴리기 (순서 그대로)
    await touchDrag(page, page.locator('#lay-tabs > [data-id="board"] .lay-text'), 90, 0);
    assert(await rows(page, 'lay-tabs') === 'timer,home,board,plan,stats,review,group', '바로 밀면 순서는 그대로');
    // 꾹 눌렀다가 그 자리에 놓으면 아무 일 없음
    await touchDrag(page, page.locator('#lay-tabs > [data-id="plan"] .lay-text'), 0, 600, 1);
    assert(await rows(page, 'lay-tabs') === 'timer,home,board,plan,stats,review,group' && !(await page.$('#view-layout .drag-lift')), '그 자리에 놓으면 그대로');
    // 끄고 있는 동안에 스위치를 누른 것으로 치지 않음 (놓은 자리의 스위치)
    assert(await page.isChecked('#lay-tabs [data-sw="plan"]') && await page.isChecked('#lay-tabs [data-sw="stats"]'), '끌다 놓아도 스위치는 그대로');
    // 손잡이에서 화살표 키
    await page.focus('#lay-tabs > [data-id="board"] .lay-grip');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    assert(await rows(page, 'lay-tabs') === 'timer,home,plan,board,stats,review,group', '아래 화살표 키로 한 칸 아래: ' + await rows(page, 'lay-tabs'));
    assert(await page.evaluate(() => document.activeElement.closest('.lay-row').dataset.id) === 'board' && await page.textContent('#lay-live') === '범위, 4번째로 옮겼어요', '손잡이에 초점이 남고 알림');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    assert(await rows(page, 'lay-tabs') === 'timer,board,home,plan,stats,review,group', '위 화살표 두 번');
    // 탭 막대·첫 화면: 다음에 열 때 앱 코드가 오기 전부터 정한 순서로 그린다
    await page.evaluate(() => Features.set('review', false));
    await page.waitForTimeout(100);
    await page.route('**/js/features.js', async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.continue(); });
    await page.goto(base + '?again#home', { waitUntil: 'commit' }); // 주소 뒤(#)만 바꾸면 새로 열리지 않으므로
    await page.waitForSelector('nav.tabs .tab[data-view="stats"]', { state: 'attached' });
    const early = await page.evaluate(() => ({ pre: !!document.getElementById('tabbar-pre'), F: !!window.Features }));
    const earlyTabs = await shownTabs(page);
    assert(early.pre && !early.F && earlyTabs === 'timer,board,home,plan,stats,group', '앱 코드가 오기 전 첫 화면부터 정한 순서·꺼진 탭 숨김: ' + earlyTabs + ' ' + JSON.stringify(early));
    await page.waitForFunction(() => window.App && window.Features);
    await page.waitForTimeout(200);
    assert(!(await page.$('#tabbar-pre')) && await shownTabs(page) === 'timer,board,home,plan,stats,group', '앱이 뜨면 탭을 실제로 옮기고 임시 스타일은 지움');
    await page.unroute('**/js/features.js');
    // 다른 화면에서 탭 막대를 눌러도 정한 순서대로 (첫 탭 = 타이머)
    await page.tap('nav.tabs .tab:visible >> nth=0');
    await page.waitForTimeout(100);
    assert(await viewOf(page) === 'timer', '맨 왼쪽 탭을 누르면 타이머');
    await ctx.close();
  }

  /* ===== ④ 홈 화면 칸 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#home');
    await page.waitForSelector('#view-home .cards4');
    assert(await homeOrder(page) === HOME_SHOWN.join(','), '처음 홈 화면: ' + await homeOrder(page));
    await openEditor(page);
    // 시험 준비 칸을 맨 위로
    await page.locator('#lay-home').scrollIntoViewIfNeeded();
    const e0 = await rowBox(page, 'lay-home', 'home-exams'), top0 = await rowBox(page, 'lay-home', 'home-sum');
    await touchDrag(page, page.locator('#lay-home > [data-id="home-exams"] .lay-grip'), top0.y - e0.y - 6, 0, 16);
    assert(await rows(page, 'lay-home') === 'home-exams,home-sum,home-group,home-tt,home-next,home-tasks', '시험 준비 칸을 맨 위로: ' + await rows(page, 'lay-home'));
    // 오늘 타임테이블 칸 숨기기
    await flip(page, 'home-tt');
    assert(await toastOf(page) === '홈에서 오늘 타임테이블 칸을 숨겼어요', '숨기면 알림: ' + await toastOf(page));
    await page.evaluate(() => App.go('home'));
    await page.waitForTimeout(150);
    assert(await homeOrder(page) === 'home-exams,home-sum,home-next,home-tasks', '홈 화면이 정한 순서로, 타임테이블 칸은 숨김: ' + await homeOrder(page));
    assert(await page.isVisible('#view-home > .home-about'), '맨 아래 이야기 줄은 그대로 맨 아래');
    // 범위 탭을 끄면 시험 준비·오늘 할 범위 칸도 안 보이고, 편집 화면에서 그 까닭을 보여 준다
    await openEditor(page);
    await flip(page, 'board');
    assert(await page.isDisabled('#lay-home [data-sw="home-exams"]') && await page.isDisabled('#lay-home [data-sw="home-next"]'), '범위 탭이 꺼지면 시험 준비·오늘 할 범위 스위치는 잠김');
    assert(await page.textContent('#lay-d-home-exams') === '범위 탭이 꺼져 있어서 안 보여요' && await page.isChecked('#lay-home [data-sw="home-exams"]'), '까닭을 보여 주고, 제 스위치 값(켜짐)은 그대로');
    // 플래너 탭을 끄면 오늘 할 일 칸과 남은 할 일 카드도
    await flip(page, 'plan');
    await page.evaluate(() => App.go('home'));
    await page.waitForTimeout(150);
    assert(await homeOrder(page) === 'home-sum', '범위·플래너를 끄면 홈에는 요약만: ' + await homeOrder(page));
    assert(await page.getAttribute('#view-home .cards4', 'data-n') === '3' && await page.isHidden('#view-home .cards4 > [data-feature="plan"]'), '요약 카드 3장 (남은 할 일 카드 숨김)');
    // 범위 탭을 다시 켜면 숨기지 않은 칸은 돌아오고, 숨긴 칸은 그대로
    await page.evaluate(() => Features.set('board', true));
    await page.waitForTimeout(150);
    assert(await homeOrder(page) === 'home-exams,home-sum,home-next', '범위를 켜면 두 칸이 정한 자리로: ' + await homeOrder(page));
    // 범위 화면의 ⋯ 메뉴: 플래너가 꺼져 있으면 ‘플래너에 넣기’가 없음
    await page.evaluate(() => App.go('board'));
    await page.waitForSelector('.list-mode .bitem');
    await page.tap('.bitem[data-id="k1"] > .brow [data-menu]');
    await page.waitForTimeout(150);
    const acts = await page.$$eval('#pop-menu [data-act]', (els) => els.map((e) => e.dataset.act));
    assert(!acts.includes('to-task') && acts.includes('focus'), '플래너에 넣기는 빠지고 타이머는 그대로: ' + acts.join(','));
    await page.keyboard.press('Escape');
    await ctx.close();
  }

  /* ===== ⑤ 타이머 안 기능 ===== */
  {
    const { ctx, page } = await open();
    await page.goto(base + '#account');
    await page.waitForSelector('#lay-entry');
    await page.tap('#lay-entry');
    await flip(page, 'focus');
    assert(await toastOf(page) === '집중 타이머를 껐어요', '알림: ' + await toastOf(page));
    assert(await page.isDisabled('[data-sw="stopwatch"]') && await page.textContent('#lay-d-stopwatch') === '집중 타이머와 스톱워치 중 하나는 켜 둬야 해요', '나머지 하나(스톱워치)는 끌 수 없게 잠기고 까닭');
    assert(!(await page.isDisabled('[data-sw="focus"]')), '끈 쪽은 다시 켤 수 있음');
    await page.evaluate(() => App.go('timer'));
    await page.waitForTimeout(150);
    assert(await page.isHidden('.timer-tabs') && await page.isHidden('#timer-pane-focus') && await page.isVisible('#timer-pane-sw'), '타이머 탭에는 스톱워치만 (집중 타이머·스톱워치 고르는 칸도 숨김)');
    assert(await page.evaluate(() => document.querySelector('.lock-setup').parentElement.id) === 'timer-pane-sw' && await page.isVisible('.lock-setup'), '폰 잠금 모드 칸은 스톱워치 아래로 옮겨 그대로 보임');
    // 홈 ‘오늘 할 범위’의 ▶ (원래 집중 타이머) → 스톱워치로 그 범위를 잰다
    await page.evaluate(() => App.go('home'));
    await page.waitForSelector('#h-next .next-play');
    await page.tap('#h-next .next-item:has(.next-title:text-is("문학 1강")) .next-play');
    await page.waitForTimeout(250);
    let sw = await page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.stopwatch')));
    assert(sw.running && sw.topicId === 'k1' && sw.subjectId === 's1' && await viewOf(page) === 'timer', '범위 ▶ → 스톱워치로 그 범위를 잼 (국어)');
    // 재는 중에 스톱워치가 딸린 타이머 탭을 끄면 먼저 묻는다 → 취소하면 그대로
    await openEditor(page);
    await flip(page, 'timer');
    await page.waitForSelector('#ask:not([hidden])');
    assert(/스톱워치가 재는 중이에요/.test(await page.textContent('#ask-msg')), '재는 중이면 끄기 전에 물어봄');
    await page.tap('#ask-cancel');
    await page.waitForTimeout(150);
    assert(await page.isChecked('#lay-tabs [data-sw="timer"]') && await page.evaluate(() => Features.on('timer') && Stopwatch.running()), '취소하면 그대로 켜져 있고 계속 잼');
    // 다시 켜기: 집중 타이머 켜고 스톱워치 끄기 (재는 중이면 기록하고 끔)
    await flip(page, 'focus');
    await page.evaluate(() => { const k = 'studypromotion.stopwatch'; const s = JSON.parse(localStorage.getItem(k)); s.startAt -= 20 * 60000; localStorage.setItem(k, JSON.stringify(s)); window.dispatchEvent(new StorageEvent('storage', { key: k })); });
    await flip(page, 'stopwatch');
    await page.waitForSelector('#ask:not([hidden])');
    await page.tap('#ask-ok');
    await page.waitForTimeout(400);
    if (await page.isVisible('#ask')) await page.tap('#ask-cancel'); // 범위를 끝냈는지 묻는 창
    await page.waitForTimeout(150);
    let st = await state(page);
    assert(!(await page.evaluate(() => Stopwatch.running())) && st.sessions.some((x) => x.kind === 'stopwatch' && x.minutes === 20 && x.topicId === 'k1'), '‘기록하고 끄기’ → 20분 기록하고 멈춤');
    assert(!(await page.evaluate(() => Features.on('stopwatch'))) && await page.isDisabled('[data-sw="focus"]'), '스톱워치 꺼짐, 이번엔 집중 타이머가 잠김');
    await page.evaluate(() => App.go('timer'));
    await page.waitForTimeout(150);
    assert(await page.isVisible('#timer-pane-focus') && await page.isHidden('#timer-pane-sw') && await page.evaluate(() => document.querySelector('.lock-setup').parentElement.id) === 'timer-pane-focus', '집중 타이머만, 폰 잠금 칸은 집중 타이머 아래로 돌아옴');
    // 스톱워치를 꺼 두면 홈 ‘공부 시작하기’는 고른 공부로 집중 타이머를 켠다 (할 일을 기억해 두 번 세지 않게)
    await page.evaluate(() => App.go('home'));
    await page.tap('#h-start');
    await page.waitForSelector('.ui-back.in .start-sheet');
    await page.tap('.ui-back.in .ch-opt:has(b:text-is("수학"))');
    await page.waitForTimeout(350);
    await page.tap('.ui-back.in .ch-opt:has(b:text-is("수학 문제집 3쪽"))');
    await page.waitForTimeout(350);
    let tm = await page.evaluate(() => { const t = window.__studypromotion.timer; return { mode: t.mode, running: t.running, label: t.label, taskId: t.taskId, subjectId: t.subjectId }; });
    assert(tm.mode === 'focus' && tm.running && tm.label === '수학 문제집 3쪽' && tm.taskId === 't1' && tm.subjectId === 's2' && await viewOf(page) === 'timer', '공부 시작하기 → 집중 타이머 시작 (수학, 고른 할 일)');
    assert(!(await page.evaluate(() => Stopwatch.running())), '스톱워치는 켜지지 않음');
    // 집중 25분이 끝나면 기록에 할 일이 남고, 끝내도 예상 시간 45분을 또 넣지 않음. 끝난 뒤 고르는 창에 ‘스톱워치 켜고 계속’이 없음
    await page.evaluate(() => window.__studypromotion.finishPhase(true));
    await page.waitForSelector('.ui-back.in .next-sheet');
    const nexts = await page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent.trim()));
    assert(!nexts.some((x) => /스톱워치/.test(x)) && nexts.length === 3, '집중이 끝난 뒤 고르기에서 스톱워치 줄이 빠짐: ' + nexts.join(' / '));
    await page.tap('.ui-back.in .ch-opt:has(b:text-is("그냥 끄기"))');
    await page.waitForTimeout(300);
    st = await state(page);
    const rec = st.sessions.find((x) => x.taskId === 't1');
    assert(rec && rec.minutes === 25 && rec.label === '수학 문제집 3쪽', '집중 기록에 고른 할 일이 남음');
    const r = await page.evaluate(() => App.setTaskDone('t1', true, { quiet: true }));
    assert(r.added === 0, '그 할 일을 끝내도 예상 시간을 또 넣지 않음');
    await ctx.close();
  }

  /* ===== ⑥ 세컨드 · 카드 링크 ===== */
  {
    const { ctx, page } = await open({ mock: true });
    await page.goto(base + '#home');
    await page.waitForSelector('#ai-fab');
    assert(await page.isVisible('#ai-fab'), '세컨드 둥근 단추가 보임');
    await page.tap('#ai-fab');
    await page.waitForTimeout(300);
    assert(await page.isVisible('#ai-panel'), '세컨드 창 열림');
    await page.evaluate(() => Features.set('ai', false)); // 다른 기기에서 끈 경우처럼
    await page.waitForTimeout(400);
    assert(await page.isHidden('#ai-panel') && await page.isHidden('#ai-fab'), '세컨드를 끄면 열린 창이 닫히고 단추도 숨김');
    await page.evaluate(() => Features.set('ai', true));
    await page.waitForTimeout(100);
    assert(await page.isVisible('#ai-fab'), '켜면 다시 보임');
    // 세컨드가 꺼진 기능을 쓰려 하면 빼고 까닭을 말함
    const res = await page.evaluate(() => {
      Features.set('review', false);
      const st = App.store.get(), ctx = AICore.buildContext(st, Date.now());
      return { v: AICore.validate([{ type: 'add_card', front: 'hola', back: '안녕' }, { type: 'open_view', view: 'stats' }], st, ctx, Date.now()), text: AICore.contextText(ctx) };
    });
    assert(res.v.ops.length === 1 && /복습을 꺼 두어서/.test(res.v.rejected[0]) && /꺼 둔 기능: 복습, 말로 복습\./.test(res.text), '세컨드: 꺼 둔 복습 카드는 만들지 않고, AI에게도 꺼 둔 기능을 알림');
    // 복습을 꺼 둔 채로 카드 링크를 열면 켤지 묻는다 → 안 가져오기
    await page.goto(base + '#cards&deck=링크+단어&c=uno~하나&c=dos~둘');
    await page.waitForSelector('#ask:not([hidden])');
    assert(/카드 2장이 있어요/.test(await page.textContent('#ask-msg')) && /복습이 꺼져 있는데/.test(await page.textContent('#ask-msg')), '카드 링크: 복습을 켜고 가져올지 물어봄');
    assert(!/꺼 둔 기능이에요/.test(await toastOf(page) || ''), '꺼 둔 기능 알림을 따로 띄우지 않음');
    await page.tap('#ask-cancel');
    await page.waitForTimeout(200);
    assert((await state(page)).cards.length === 0 && !(await page.evaluate(() => Features.on('review'))) && await viewOf(page) !== 'review', '가져오지 않기 → 그대로');
    // 다시 열고 ‘복습 켜고 가져오기’
    await page.goto(base + '#cards&deck=링크+단어&c=uno~하나&c=dos~둘');
    await page.waitForSelector('#ask:not([hidden])');
    await page.tap('#ask-ok');
    await page.waitForSelector('.ui-back.in');
    assert(await page.evaluate(() => Features.on('review')) && await viewOf(page) === 'review', '켜고 복습 화면으로 → 가져오기 창');
    await ctx.close();
  }

  /* ===== ⑦ 처음 배치로 · 다른 기기에서 바뀜 · 새 버전의 기능은 지우지 않음 ===== */
  {
    const newer = { tabs: ['stats', 'home', 'planner', 'board', 'plan', 'timer', 'review'], home: ['home-tasks', 'home-sum', 'home-week'], off: ['review', 'planner-goal'] };
    const { ctx, page } = await open({ settings: { layout: newer } });
    await page.goto(base + '#layout');
    await page.waitForSelector('#lay-tabs > .lay-row');
    assert(await rows(page, 'lay-tabs') === 'stats,group,home,board,plan,timer,review', '새로 고침해서 바로 편집 화면으로 열어도 그려짐 (모르는 탭은 빼고, 새 그룹 탭은 기본 순서의 바로 앞 탭 뒤에): ' + await rows(page, 'lay-tabs'));
    assert(await rows(page, 'lay-home') === 'home-tasks,home-sum,home-group,home-tt,home-exams,home-next', '홈 칸: 빠진 칸은 기본 순서의 바로 앞 칸 뒤에: ' + await rows(page, 'lay-home'));
    // 하나 바꿔도 이 버전이 모르는 탭 자리·꺼 둔 것은 남긴다 (다른 기기의 새 버전)
    await flip(page, 'review');
    let L = await layoutOf(page);
    assert(L.tabs.join(',') === 'stats,group,home,planner,board,plan,timer,review' && L.home.join(',') === 'home-tasks,home-sum,home-week,home-group,home-tt,home-exams,home-next' && JSON.stringify(L.off) === JSON.stringify(['planner-goal']), '새 버전의 기능 이름은 지우지 않고 제자리에: ' + JSON.stringify(L));
    // 다른 기기에서 배치가 바뀌면(계정 동기화) 이 화면도 바로
    await page.evaluate(() => App.store.update((st) => { st.settings.layout = { tabs: ['plan', 'home', 'board', 'timer', 'review', 'stats'], off: ['board'] }; }));
    await page.waitForTimeout(150);
    assert(await rows(page, 'lay-tabs') === 'plan,home,board,timer,review,stats,group' && !(await page.isChecked('#lay-tabs [data-sw="board"]')), '편집 화면도 새 배치로 다시 그림');
    assert(await shownTabs(page) === 'plan,home,timer,review,stats,group', '탭 막대도: ' + await shownTabs(page));
    // 처음 배치로 되돌리기 → 묻고, 모두 처음대로
    await page.locator('#lay-reset').scrollIntoViewIfNeeded();
    await page.tap('#lay-reset');
    await page.waitForSelector('#ask:not([hidden])');
    assert(/처음 배치로 돌리고/.test(await page.textContent('#ask-msg')), '되돌리기 전에 물어봄');
    await page.tap('#ask-ok');
    await page.waitForTimeout(200);
    assert(await layoutOf(page) === null && await barOf(page) === null && await shownTabs(page) === TABS.join(',') && await rows(page, 'lay-home') === HOME.join(','), '처음 배치로 (저장한 배치·사본 지움)');
    assert(await toastOf(page) === '처음 배치로 되돌렸어요' && await page.isDisabled('#lay-reset'), '알림, 되돌리기 단추는 다시 잠김');
    // 백업 파일에도 들어감
    await page.evaluate(() => Features.set('stats', false));
    const backup = await page.evaluate(() => JSON.parse(App.store.exportJSON ? App.store.exportJSON() : JSON.stringify(App.store.get())));
    assert(backup.settings && backup.settings.layout && backup.settings.layout.off.includes('stats'), '백업(내보내기)에 배치가 들어감');
    await ctx.close();
  }

  /* ===== ⑧ 컴퓨터 (마우스, 위 탭 막대) · 가로 화면 ===== */
  {
    const { ctx, page } = await open({ ctx: { viewport: { width: 1280, height: 860 }, hasTouch: false, isMobile: false }, settings: { layout: { tabs: ['timer', 'home', 'board', 'plan', 'review', 'stats'], off: ['review'] } } });
    await page.goto(base + '#home');
    await page.waitForSelector('nav.tabs .tab');
    assert(await shownTabs(page) === 'timer,home,board,plan,stats,group', '컴퓨터 탭 막대도 정한 순서: ' + await shownTabs(page));
    await openEditor(page);
    // 마우스로 줄을 꾹 눌러 끌기: 범위를 맨 아래로
    const b = await rowBox(page, 'lay-tabs', 'board'), last = await rowBox(page, 'lay-tabs', 'group');
    await page.mouse.move(b.x + 120, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    for (let i = 1; i <= 12; i++) { await page.mouse.move(b.x + 120, b.y + b.height / 2 + ((last.y - b.y + 6) * i) / 12); await page.waitForTimeout(16); }
    assert(await page.$('#lay-tabs > .lay-row.drag-lift'), '마우스로 꾹 누르면 줄이 들림');
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert(await rows(page, 'lay-tabs') === 'timer,home,plan,review,stats,group,board', '마우스로 맨 아래로: ' + await rows(page, 'lay-tabs'));
    // 그냥 누르면(짧게 클릭) 아무 일 없음, 스위치 클릭은 그대로
    await page.click('#lay-tabs > [data-id="plan"] .lay-text');
    await page.click('#lay-tabs [data-sw="plan"]');
    await page.waitForTimeout(150);
    assert(await rows(page, 'lay-tabs') === 'timer,home,plan,review,stats,group,board' && !(await page.evaluate(() => Features.on('plan'))), '짧게 클릭은 순서 그대로, 스위치는 바로 끔');
    await ctx.close();
  }
  {
    // 가로로 눕힌 휴대폰: 편집 화면이 옆으로 넘치지 않음
    const { ctx, page } = await open({ ctx: { viewport: { width: 800, height: 380 } } });
    await page.goto(base + '#layout');
    await page.waitForSelector('#lay-tabs > .lay-row');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert(over <= 0, '가로 화면에서 옆으로 넘치지 않음: ' + over);
    const sw = await page.locator('#lay-tabs [data-sw="stats"]').boundingBox();
    assert(sw.x + sw.width <= 800 && sw.width >= 40, '스위치가 화면 안에');
    await ctx.close();
  }

  assert(!errors.length, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
