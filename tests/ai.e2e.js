// AI 도우미 화면: 둥근 단추, 대화 창, 제안 미리 보기(적용·되돌리기), 공부 시간, 복습 카드 저장, 타이머 시작, 알림.
// 진짜 AI 대신 테스트가 정해 준 답을 그대로 돌려주는 가짜(window.AIMock)를 쓴다. 답을 읽고 검사하고 적용하는 길은 실제와 같다.
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
  // mock: true면 가짜 AI를 넣는다. 가짜는 window.__replies에 넣어 둔 답을 차례로 돌려준다 (글 또는 { fail: 'limit' })
  async function open(mock, extra) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, locale: 'ko-KR' }, extra || {}));
    await ctx.addInitScript((withMock) => {
      const real = Date.now.bind(Date);
      let shift = Number(sessionStorage.getItem('__shift'));
      if (!shift) {
        const d = new Date(real());
        shift = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 16, 20, 0).getTime() - real();
        sessionStorage.setItem('__shift', String(shift));
      }
      Date.now = () => real() + shift;
      try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ }
      if (!withMock) return;
      window.__replies = [];
      window.__calls = [];
      window.AIMock = {
        async ask(messages, opts) {
          window.__calls.push(messages);
          const r = window.__replies.shift();
          await new Promise((ok) => setTimeout(ok, 30));
          if (r && r.fail) throw Object.assign(new Error(r.fail), { aiCode: r.fail });
          const text = String(r == null ? '' : r);
          for (let i = 1; i <= 3; i++) {
            if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            opts.onText(text.slice(0, Math.ceil(text.length * i / 3)));
            await new Promise((ok) => setTimeout(ok, r && r.slow ? 400 : 15));
          }
          return { text, left: 40 - window.__calls.length };
        },
      };
    }, !!mock);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    await page.waitForFunction(() => window.App && window.AICore);
    return page;
  }
  const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(App.store.get())));
  const toastOf = (page) => page.textContent('#toast');
  const key = (page, n) => page.evaluate((n) => Schedule.shiftKey(App.todayKey(), n), n);
  const tag = (list) => '<actions>' + JSON.stringify(list) + '</actions>';
  // 가짜 AI의 다음 답을 정하고 말을 보낸 뒤, 답이 끝날 때까지 기다린다
  async function say(page, text, ...replies) {
    await page.evaluate((r) => { window.__replies.push(...r); }, replies);
    await page.fill('#ai-input', text);
    await page.tap('#ai-send');
    await page.waitForFunction(() => !AI.busy);
    await page.waitForTimeout(80);
  }
  const last = (page, sel) => page.locator('#ai-log .ai-msg.ai').last().locator(sel);
  // 과목 세 개(수학 I·수학 II·영어), 할 일 두 개, 공부 기록, 덱 하나
  const seed = (page) => page.evaluate(() => {
    const now = App.now(), today = App.todayKey();
    App.store.update((st) => {
      st.subjects = [{ id: 's1', name: '수학 I', color: '#3d96e0' }, { id: 's2', name: '수학 II', color: '#45a865' }, { id: 's3', name: '영어', color: '#e3ae24' }];
      st.tasks = [
        { id: 'k1', title: '영어 단어 50개', subjectId: 's3', due: Schedule.shiftKey(today, -1), done: false, createdAt: 1 },
        { id: 'k2', title: '수학 문제집 3단원', subjectId: 's1', due: today, done: false, createdAt: 2 },
      ];
      st.sessions = [
        { id: 'a1', subjectId: 's3', minutes: 50, endedAt: now - 3600000 },
        { id: 'a2', subjectId: 's1', minutes: 40, endedAt: now - 2 * 3600000 }, // 합쳐서 하루 목표(2시간)보다 적게: 목표 달성 알림이 뜨지 않게
      ];
      st.decks = [{ id: 'd1', name: '영단어', createdAt: 1 }];
      st.cards = [];
      st.events = [];
    });
  });

  /* ===== 1) 서버 주소도 가짜 AI도 없으면 앱은 예전 그대로 ===== */
  let page = await open(false);
  assert(await page.evaluate(() => !document.querySelector('#ai-fab') && !document.querySelector('#ai-panel') && !window.AI), '서버 주소가 없으면 AI 단추와 창을 만들지 않음');
  await page.context().close();

  /* ===== 2) 둥근 단추와 대화 창 ===== */
  page = await open(true);
  await seed(page);
  for (const v of ['home', 'board', 'plan', 'timer', 'review', 'stats', 'timetable']) {
    await page.evaluate((view) => App.go(view), v);
    const box = await page.locator('#ai-fab').boundingBox();
    assert(await page.isVisible('#ai-fab') && box.x + box.width <= 360 && box.y + box.height <= 780 - 50, `${v} 화면에 둥근 단추가 탭 바 위에 보임`);
  }
  await page.evaluate(() => App.go('home'));
  assert(await page.isHidden('#ai-panel'), '처음에는 대화 창이 닫혀 있음');
  await page.tap('#ai-fab');
  await page.waitForTimeout(350);
  assert(await page.isVisible('#ai-panel .ai-sheet') && (await page.textContent('#ai-title')) === '세컨드', '단추를 누르면 대화 창이 열림');
  assert((await page.locator('#ai-log .ai-eg').count()) === 5 && /수학 I 일정 넣어 줘/.test(await page.textContent('#ai-log')), '처음에는 인사와 예시 다섯 개 (내 과목 이름으로)');
  let fit = await page.evaluate(() => { const r = document.querySelector('.ai-sheet').getBoundingClientRect(); return { w: r.width, bottom: Math.round(r.bottom), sw: document.documentElement.scrollWidth }; });
  assert(fit.w === 360 && fit.bottom === 780 && fit.sw <= 360, '폰에서는 아래에서 올라오는 시트 (옆으로 밀리지 않음)');
  await page.goBack();
  await page.waitForTimeout(350);
  assert(await page.isHidden('#ai-panel') && await page.evaluate(() => App.view === 'home'), '휴대폰 뒤로 가기로 대화 창만 닫힘');
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);

  /* ===== 3) 물어보기: 글이 나오고, 표현을 복습 카드로 저장 ===== */
  await say(page, 'echar de menos가 무슨 뜻이야?',
    '**echar de menos**는 그리워하다라는 뜻이에요.\n\n- Te echo de menos. (네가 보고 싶어.)\n<cards>[{"front":"echar de menos","back":"그리워하다"},{"front":"extrañar","back":"그리워하다 (중남미)"}]</cards>');
  let calls = await page.evaluate(() => window.__calls);
  assert(calls.length === 1 && !calls[0][0].content.includes('[앱 정보]') && calls[0][calls[0].length - 1].content === 'echar de menos가 무슨 뜻이야?', '표현 질문에는 앱 정보를 붙이지 않고 보냄');
  assert((await page.textContent('#ai-log .ai-msg.me .ai-bubble')) === 'echar de menos가 무슨 뜻이야?', '내가 보낸 말이 보임');
  assert((await last(page, '.ai-text b').first().textContent()) === 'echar de menos' && (await last(page, '.ai-text li').count()) === 1 && !/cards|\[\{/.test(await last(page, '.ai-text').textContent()), '답이 굵은 글씨·목록으로 보이고 꼬리표는 안 보임');
  assert((await page.textContent('#ai-left')) === '오늘 39번 남음', '남은 횟수 표시');
  assert((await last(page, '.ai-cardlist li').count()) === 2 && /덱 고르기/.test(await last(page, '[data-deck-pick]').textContent()), '외울 표현 두 개가 저장 단추와 함께 나옴');
  await last(page, '[data-card="0"]').tap();
  await page.waitForSelector('.ui-back.in .ch-opt');
  assert((await page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent))).join('|') === "영단어|새 덱 '표현 모음' 만들기", '처음 저장할 때 덱을 고름');
  await page.tap('.ui-back.in .ch-opt:has-text("표현 모음")');
  await page.waitForTimeout(350);
  let st = await state(page);
  assert(st.decks.map((d) => d.name).join() === '영단어,표현 모음' && st.cards.length === 1 && st.cards[0].front === 'echar de menos' && st.cards[0].deckId === st.decks[1].id, "새 덱 '표현 모음'에 카드 한 장 저장");
  assert((await last(page, '.ai-saved').count()) === 1 && /표현 모음 덱에/.test(await last(page, '[data-deck-pick]').textContent()) && /1장을 '표현 모음' 덱에 저장/.test(await toastOf(page)), '저장한 카드는 ✓ 표시, 고른 덱을 기억');
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(200);
  st = await state(page);
  assert(st.cards.length === 0 && st.decks.length === 1 && (await last(page, '.ai-saved').count()) === 0, '되돌리기를 누르면 카드와 새 덱이 사라짐');
  await last(page, '[data-card="all"]').tap();
  await page.waitForTimeout(350);
  st = await state(page);
  assert(st.cards.length === 2 && (await last(page, '.ai-saved').count()) === 2 && (await last(page, '[data-card]').count()) === 0, '모두 저장: 다시 묻지 않고 같은 덱에 두 장');

  /* ===== 4) 시키기: 미리 보기 → 적용 → 되돌리기 ===== */
  const tomorrow = await key(page, 1);
  await say(page, '내일 4시에 영어 일정 넣고 밀린 할 일 내일로 미뤄 줘',
    '이렇게 할게요.' + tag([
      { type: 'add_event', subject: '영어', date: tomorrow, start: '16:00', end: '18:00' },
      { type: 'move_task', task: 't1', due: tomorrow },
      { type: 'move_task', task: 't2', due: tomorrow },
      { type: 'delete_task', task: 't1' },
    ]));
  calls = await page.evaluate(() => window.__calls);
  const sys = calls[calls.length - 1][0].content;
  assert(sys.includes('[앱 정보]') && /t1 "영어 단어 50개" \[영어\]/.test(sys) && !sys.includes('k1') && calls[calls.length - 1].length === 4, '시키는 말에는 앱 정보(할 일 번호)와 지난 대화를 붙여 보냄');
  assert((await last(page, '.ai-op').count()) === 3 && (await last(page, '.ai-card-h').textContent()) === '이렇게 3가지를 할게요', '제안 세 가지가 미리 보기로 나옴');
  assert(/앱에 없는 동작이라 뺐어요: delete_task/.test(await last(page, '.ai-rej').textContent()), '지우는 동작은 빼고 그 사실을 알림');
  st = await state(page);
  assert(st.events.length === 0 && st.tasks[0].due !== tomorrow, '적용을 누르기 전에는 기록이 그대로');
  await last(page, '[data-plan-on="2"]').tap();
  assert(await last(page, '.ai-op.off').count() === 1, '줄마다 빼 둘 수 있음');
  await last(page, '[data-plan-apply]').tap();
  await page.waitForTimeout(250);
  st = await state(page);
  assert(st.events.length === 1 && st.events[0].subjectId === 's3' && st.events[0].date === tomorrow && st.events[0].start === '16:00' && st.events[0].end === '18:00', '적용: 내일 16~18시 영어 일정이 생김');
  assert(st.tasks[0].due === tomorrow && st.tasks[1].due !== tomorrow, '적용: 고른 할 일만 내일로 (빼 둔 것은 그대로)');
  assert(/적용했어요/.test(await last(page, '.ai-done').textContent()) && await last(page, '[data-plan-undo]').isVisible() && (await last(page, '[data-ai-go]').textContent()) === '타임테이블에서 보기', "카드가 '적용했어요'로 바뀌고 되돌리기·보러 가기가 생김");
  const backups = await page.evaluate(async () => (await App.backup.list()).filter((s) => s.reason === 'ai').length);
  assert(backups === 1, '바꾸기 전 기록을 자동 백업에 남김');
  await last(page, '[data-plan-undo]').tap();
  await page.waitForTimeout(250);
  st = await state(page);
  assert(st.events.length === 0 && st.tasks[0].due !== tomorrow && /되돌렸어요/.test(await last(page, '.ai-state').textContent()), '되돌리기: 일정이 사라지고 마감일이 원래대로');

  // 취소
  await say(page, '수학 문제집 끝냈어', '완료로 표시할게요.' + tag([{ type: 'complete_task', task: 't2' }]));
  await last(page, '[data-plan-cancel]').tap();
  await page.waitForTimeout(100);
  st = await state(page);
  assert(!st.tasks[1].done && /적용하지 않았어요/.test(await last(page, '.ai-state').textContent()) && (await last(page, '[data-plan-apply]').count()) === 0, '취소하면 아무것도 바뀌지 않음');

  // 과목이 여러 개와 맞을 때
  await say(page, '모레 7시 수학 일정', '넣을게요.' + tag([{ type: 'add_event', subject: '수학', date: await key(page, 2), start: '19:00' }]));
  assert(/과목을 골라 주세요/.test(await last(page, '.ai-op-t em').textContent()) && (await last(page, '.ai-pick .chip').allTextContents()).join() === '수학 I,수학 II', "'수학'이 두 과목과 맞으면 고르게 함");
  await last(page, '.ai-pick .chip:has-text("수학 II")').tap();
  await last(page, '[data-plan-apply]').tap();
  await page.waitForTimeout(250);
  st = await state(page);
  assert(st.events.length === 1 && st.events[0].subjectId === 's2' && st.events[0].title === '' && st.events[0].end === '20:00', '고른 과목으로 일정이 들어감 (끝 시각이 없으면 1시간)');
  await last(page, '[data-ai-go]').tap();
  await page.waitForTimeout(350);
  assert(await page.isHidden('#ai-panel') && await page.evaluate(() => App.view === 'timetable') && (await page.evaluate(() => Timetable.day)) === await key(page, 2), "'타임테이블에서 보기'를 누르면 창이 닫히고 그날 타임테이블이 열림");

  /* ===== 5) 공부 시간은 앱이 계산해 보여 줌 ===== */
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);
  await say(page, '오늘 몇 시간 했어?', '오늘 공부 시간이에요. 100시간!' + tag([{ type: 'show_stats', from: await key(page, 0), to: await key(page, 0) }]));
  assert((await last(page, '.ai-total b').textContent()) === '1시간 30분' && (await last(page, '.ai-bars li').count()) === 2 && /영어/.test(await last(page, '.ai-bars li').first().textContent()), '공부 시간 카드: 기록에서 계산한 1시간 30분(AI가 말한 숫자가 아님), 과목별 막대');
  assert((await last(page, '[data-plan-apply]').count()) === 0, '보여 주기만 하는 동작은 적용 단추가 없음');

  /* ===== 6) 타이머 시작 ===== */
  await say(page, '영어 40분 집중 시작', '시작할게요.' + tag([{ type: 'start_timer', kind: 'focus', subject: '영어', minutes: 40 }]));
  assert((await last(page, '[data-plan-apply]').textContent()) === '시작하기' && await page.evaluate(() => !App.timerRunning()), "타이머는 '시작하기'를 눌러야 시작");
  await last(page, '[data-plan-apply]').tap();
  await page.waitForTimeout(400);
  const tm = await page.evaluate(() => { const t = window.__studypromotion.timer; return { run: t.running, mode: t.mode, sid: t.subjectId, total: t.total, view: App.view }; });
  assert(tm.run && tm.mode === 'focus' && tm.sid === 's3' && tm.total === 2400 && tm.view === 'timer' && await page.isHidden('#ai-panel'), '영어 40분 집중 타이머가 돌고, 타이머 화면으로 이동');
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);
  await say(page, '스톱워치 켜 줘', '켤게요.' + tag([{ type: 'start_timer', kind: 'stopwatch' }]));
  await last(page, '[data-plan-apply]').tap();
  await page.waitForTimeout(200);
  assert(/이미 시간을 재고 있어요/.test(await toastOf(page)) && await page.evaluate(() => !Stopwatch.running() && App.timerRunning()), '이미 재는 중이면 새로 시작하지 않고 알림');
  await page.evaluate(() => App.stopTimer());

  /* ===== 7) 답을 못 받았을 때 ===== */
  await say(page, '오늘 한도 넘김', { fail: 'limit' });
  assert(/오늘 쓸 수 있는 횟수를 다 썼어요/.test(await last(page, '.ai-err').textContent()) && (await last(page, '[data-retry]').count()) === 0 && await last(page, '[data-copy-q]').isVisible(), '하루 횟수를 다 쓰면 알림과 질문 복사');
  await say(page, '인터넷 끊김', { fail: 'offline' });
  assert(/인터넷에 연결되지 않아/.test(await last(page, '.ai-err').textContent()), '인터넷이 없으면 알림');
  const before = await page.locator('#ai-log .ai-msg').count();
  await page.evaluate(() => { window.__replies.push('이제 됐어요.'); });
  await last(page, '[data-retry]').tap();
  await page.waitForFunction(() => !AI.busy);
  await page.waitForTimeout(80);
  assert((await page.locator('#ai-log .ai-msg').count()) === before && (await last(page, '.ai-text').textContent()) === '이제 됐어요.' && (await page.locator('#ai-log .ai-msg.me').last().textContent()) === '인터넷 끊김', '다시 보내기: 같은 질문을 다시 보내 답을 받음');

  /* ===== 8) 앱 정보가 필요하다고 하면 붙여서 다시 보냄, 위험한 글은 글자로만 ===== */
  let n = (await page.evaluate(() => window.__calls)).length;
  await say(page, '내 거 어떻게 돼 가?', '<need_app/>', '할 일이 2개 남았어요. <img src=x onerror="window.__hacked=1"> <script>window.__hacked=1</script>');
  calls = await page.evaluate(() => window.__calls);
  assert(calls.length === n + 2 && !calls[n][0].content.includes('[앱 정보]') && calls[n + 1][0].content.includes('[앱 정보]'), 'AI가 앱 정보가 필요하다고 하면 붙여서 한 번 더 보냄');
  assert(await page.evaluate(() => !window.__hacked && !document.querySelector('#ai-log img, #ai-log script')) && /<img src=x/.test(await last(page, '.ai-text').textContent()), 'AI 답에 든 태그는 실행되지 않고 글자로만 보임');
  await say(page, '이상한 답', '바꿀게요.<actions>[{"type":"add_task","title":</actions>');
  assert(/제안을 읽지 못했어요/.test(await last(page, '.ai-rej').textContent()) && (await last(page, '.ai-plan').count()) === 0, '깨진 제안은 버리고 알림');

  /* ===== 9) 답을 멈추기 ===== */
  await page.evaluate(() => { window.__replies.push(Object.assign(new String('아주 긴 답의 앞부분입니다. 그리고 뒷부분입니다.'), { slow: true })); });
  await page.fill('#ai-input', '긴 답 줘');
  await page.tap('#ai-send');
  await page.waitForFunction(() => /앞부분/.test(document.querySelector('#ai-log .ai-msg.ai:last-child .ai-text').textContent));
  assert((await page.getAttribute('#ai-send', 'aria-label')) === '답 멈추기', '답이 오는 동안 보내기 단추가 멈추기로 바뀜');
  await page.tap('#ai-send');
  await page.waitForFunction(() => !AI.busy);
  await page.waitForTimeout(80);
  assert(/여기서 멈췄어요/.test(await last(page, '.ai-state').textContent()) && (await page.getAttribute('#ai-send', 'aria-label')) === '보내기', '멈추면 거기까지만 남고 다시 보낼 수 있음');

  /* ===== 10) 대화는 이 기기에만, 다시 열어도 남음 ===== */
  await say(page, '할 일 하나 추가', '넣을게요.' + tag([{ type: 'add_task', title: '적용 안 한 일' }]));
  const stored = await page.evaluate(() => ({ ai: JSON.parse(localStorage.getItem('studypromotion.ai')), store: localStorage.getItem('studypromotion.v1') }));
  assert(stored.ai.msgs.length >= 10 && !stored.store.includes('echar de menos가 무슨 뜻이야') && !stored.store.includes('적용 안 한 일'), '대화는 따로 저장되고 기록(계정 동기화 대상)에는 들어가지 않음');
  await page.reload();
  await page.waitForFunction(() => window.AI);
  await page.tap('#ai-fab');
  await page.waitForTimeout(300);
  assert((await page.locator('#ai-log .ai-msg').count()) === stored.ai.msgs.length && /적용하지 않은 지난 제안/.test(await last(page, '.ai-state').textContent()) && (await last(page, '[data-plan-apply]').count()) === 0, '다시 열면 대화가 남아 있고, 지난 제안은 적용할 수 없음');
  await page.tap('#ai-new');
  await page.waitForSelector('#ask:not([hidden])');
  await page.tap('#ask-ok');
  await page.waitForTimeout(150);
  assert((await page.locator('#ai-log .ai-msg').count()) === 0 && (await page.locator('#ai-log .ai-eg').count()) === 5 && (await page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.ai')).msgs.length)) === 0, '새 대화: 지난 대화를 지우고 처음 화면으로');
  await page.context().close();

  /* ===== 11) 넓은 화면: 단추 위에 뜨는 창, Enter로 보내기 ===== */
  page = await open(true, { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });
  await seed(page);
  await page.click('#ai-fab');
  await page.waitForTimeout(300);
  const box = await page.locator('.ai-sheet').boundingBox();
  assert(Math.round(box.width) === 400 && box.x + box.width <= 1280 - 20 && box.y >= 60, '넓은 화면에서는 오른쪽 아래에 뜨는 창 (위 메뉴를 가리지 않음)');
  assert(await page.evaluate(() => document.activeElement.id === 'ai-input'), '열면 바로 적을 수 있음');
  await page.evaluate(() => { window.__replies.push('네, 답이에요.'); });
  await page.keyboard.type('첫 줄');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('둘째 줄');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !AI.busy && document.querySelectorAll('#ai-log .ai-msg').length === 2);
  assert((await page.locator('#ai-log .ai-msg.me .ai-bubble').innerHTML()) === '첫 줄<br>둘째 줄' && (await page.inputValue('#ai-input')) === '', 'Enter로 보내고 Shift+Enter로 줄 바꿈');
  await page.click('.tab[data-view="plan"]');
  assert(await page.evaluate(() => App.view === 'plan') && await page.isVisible('.ai-sheet'), '창을 열어 둔 채 다른 화면을 쓸 수 있음');
  await page.keyboard.press('Escape');
  await page.click('#ai-input');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(await page.isHidden('#ai-panel'), 'Esc로 닫힘');
  await page.context().close();

  assert(!errors.length, '콘솔 오류 없음' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
