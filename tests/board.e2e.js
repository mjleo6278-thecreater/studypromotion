// 화이트보드 브라우저 시나리오 테스트: node tests/board.e2e.js [스크린샷 폴더]
const { chromium } = require('playwright');
const path = require('path');
const url = process.env.APP_URL || 'file://' + path.resolve(__dirname, '../index.html');
const shotDir = process.argv[2];
const shot = async (page, name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png') }); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.App.store.get())));
  const topic = async (title) => (await state()).topics.find((t) => t.title === title);
  const row = (title) => page.locator('.bitem', { has: page.locator(`:scope > .brow .btitle:text-is("${title}")`) }).first();

  await page.goto(url + '#board');
  assert(await page.isVisible('#board-empty'), '시험이 없으면 시작 화면');

  // 시험 만들기 → 붙여넣기 창이 열린다
  await page.fill('#ex-name', '2학기 기말고사');
  await page.fill('#ex-date', '2026-12-10');
  await page.click('#exam-form button[type=submit]');
  assert((await page.evaluate(() => Board.mode)) === 'list', '시험을 만들면 목록 보기(과목 고르기)');
  assert(await page.isVisible('#subj-picker'), '과목 고르기 칸');
  assert(await page.isVisible('.topbar'), '목록 보기에서는 위 앱 바가 보임');
  await page.click('[data-scope-mode=board]');
  assert((await page.evaluate(() => Board.mode)) === 'board', '보드 보기로 전환');
  assert((await page.evaluate(() => Board.full)) && !(await page.isVisible('.topbar')) && (await page.isVisible('#board-dock')), '보드는 전체 화면: 앱 바를 숨기고 아래 도구 띠');
  await page.waitForTimeout(50);
  assert(await page.isVisible('#toast.show') && /전체 화면/.test(await page.textContent('#toast')), '처음 한 번 돌아가는 방법 안내');
  await page.keyboard.press('Escape');
  assert((await page.evaluate(() => Board.mode)) === 'list' && (await page.isVisible('.topbar')), 'Esc로 전체 화면에서 나와 목록으로');
  await page.click('[data-scope-mode=board]');
  await page.click('#bb-paste');
  await page.keyboard.press('Escape');
  assert(!(await page.isVisible('#paste-dlg')) && (await page.evaluate(() => Board.mode)) === 'board', 'Esc로 창만 닫으면 보드는 그대로');
  await page.click('#bb-paste');
  assert(await page.isVisible('#paste-dlg'), '범위 붙여넣기 창');
  await page.fill('#paste-text', '# 수학\n- 1단원\n  - 다항식\n  - 인수분해\n- 2단원\n  - 복소수\n# 영어\n- [x] 본문 1과\n- 본문 2과\n# 국어');
  assert((await page.textContent('#paste-count')).includes('카드 3개'), '붙여넣기 미리 세기');
  await page.click('#paste-ok');
  await page.waitForTimeout(200);
  assert((await page.locator('.bcard').count()) === 3, '카드 3개 생성');
  assert((await page.textContent('#bb-pct')).trim() === '1/6 · 17%', '이미 끝낸 [x] 항목 반영: ' + (await page.textContent('#bb-pct')));
  assert((await page.textContent('#bb-dday')).startsWith('D-'), 'D-day 표시');
  assert((await page.locator('#bb-track .pt-piece').count()) === 1 && (await page.locator('#bb-track .pt-sq').count()) === 8, '체스 진행 표시: 8칸 위의 폰');
  assert((await page.title()) === '스터디 프로모션', '앱 이름');

  // 잎 항목 체크 → 상위는 일부 체크
  await row('다항식').locator(':scope > .brow [data-check]').click();
  assert((await topic('다항식')).done === true, '항목 체크');
  assert(await row('1단원').evaluate((el) => el.classList.contains('s-some')), '상위 단원은 일부 완료 표시');
  // 상위 체크 → 하위 전체
  await row('1단원').locator(':scope > .brow [data-check]').click();
  assert((await topic('인수분해')).done === true, '단원 체크 시 하위 전체 체크');
  await row('2단원').locator(':scope > .brow [data-check]').click();
  const mathCard = page.locator('.bcard', { has: page.locator('.bcard-title:text-is("수학")') });
  assert(await mathCard.evaluate((el) => el.classList.contains('complete')), '카드 전체 완료 시 완료 도장');
  await shot(page, 'b1-checked');

  // 되돌리기
  await page.click('#bb-undo');
  assert((await topic('복소수')).done === false, '되돌리기');
  await page.keyboard.press('Control+z');
  assert((await topic('인수분해')).done === false, 'Ctrl+Z 되돌리기');

  // 접기/펼치기
  await row('1단원').locator(':scope > .brow [data-collapse]').click();
  assert(!(await page.isVisible('.btitle:text-is("다항식")')), '단원 접기');
  await row('1단원').locator(':scope > .brow [data-collapse]').click();
  assert(await page.isVisible('.btitle:text-is("다항식")'), '단원 펼치기');

  // 항목 추가 (Enter 연속 입력)
  await mathCard.locator('.badd[data-add]').click();
  await page.keyboard.type('3단원 도형');
  await page.keyboard.press('Enter');
  await page.keyboard.type('4단원 함수');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert((await topic('4단원 함수')) && (await topic('3단원 도형')).parentId === (await topic('수학')).id, '카드에 항목 연속 추가');

  // 이름 바꾸기 (더블클릭)
  await page.dblclick('.btitle:text-is("3단원 도형")');
  await page.fill('.brename', '3단원 도형의 방정식');
  await page.keyboard.press('Enter');
  assert(!!(await topic('3단원 도형의 방정식')), '더블클릭으로 이름 바꾸기');

  // 메뉴: 중요 표시, 하위 항목 추가, 플래너에 넣기
  await row('복소수').locator(':scope > .brow [data-menu]').click();
  assert(!(await page.isVisible('#pop-menu [data-act="flag:star"]')), '표시는 첫 메뉴에 바로 안 나옴');
  await page.click('#pop-menu [data-act="page:flags"]');
  await page.click('#pop-menu [data-act="flag:star"]');
  assert((await topic('복소수')).flags.star === true, '중요 표시');
  assert((await page.getAttribute('#pop-menu [data-act="flag:star"]', 'aria-checked')) === 'true', '표시 메뉴가 열린 채로 ✓');
  await page.keyboard.press('Escape');
  assert((await page.textContent('#board-legend')).includes('중요 1'), '범례에 중요 개수');
  await row('복소수').locator(':scope > .brow [data-menu]').click();
  await page.click('#pop-menu [data-act="add"]');
  await page.keyboard.type('복소수의 연산');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert((await topic('복소수의 연산')).parentId === (await topic('복소수')).id, '하위 항목 추가');
  await row('복소수').locator(':scope > .brow [data-menu]').click();
  assert((await page.textContent('#pop-menu [data-act="to-task"]')).includes('플래너에 넣기'), '메뉴 이름은 플래너에 넣기');
  await page.click('#pop-menu [data-act="to-task"]');
  await page.waitForSelector('.ui-back.in .ch-opt');
  assert((await page.$$eval('.ui-back.in .ch-opt b', (els) => els.map((e) => e.textContent))).join(',') === '오늘,내일,날짜 고르기…', '언제 할지 고르기: 오늘·내일·날짜 고르기');
  await page.click('.ui-back.in .ch-opt >> nth=0');
  const tasks = (await state()).tasks;
  const todayKey = await page.evaluate(() => Stats.dayKey(Date.now()));
  assert(tasks.length === 1 && tasks[0].title === '2단원 · 복소수' && tasks[0].due === todayKey && tasks[0].topicId === (await topic('복소수')).id && !!tasks[0].subjectId, '플래너에 넣기: 오늘 할 일로 (과목 이름과 같은 카드 이름은 빼고 단원 이름을 앞에, 범위와 이어짐)');
  await page.waitForTimeout(250);

  // 카드 끌어서 옮기기
  const before = await topic('국어');
  const head = page.locator('.bcard', { has: page.locator('.bcard-title:text-is("국어")') }).locator('.bcard-head');
  const hb = await head.boundingBox();
  await page.mouse.move(hb.x + 120, hb.y + 10);
  await page.mouse.down();
  await page.mouse.move(hb.x + 220, hb.y + 90, { steps: 6 });
  await page.mouse.up();
  const after = await topic('국어');
  const z = (await page.evaluate(() => window.Board.view)).z;
  assert(Math.abs(after.x - before.x - 100 / z) <= 12 && Math.abs(after.y - before.y - 80 / z) <= 12, `카드 끌기 (${before.x},${before.y})→(${after.x},${after.y})`);

  // 빈 곳 끌어서 보드 이동
  const v0 = await page.evaluate(() => window.Board.view);
  const vpb = await page.locator('#board-viewport').boundingBox();
  await page.mouse.move(vpb.x + vpb.width - 60, vpb.y + vpb.height - 120);
  await page.mouse.down();
  await page.mouse.move(vpb.x + vpb.width - 160, vpb.y + vpb.height - 170, { steps: 5 });
  await page.mouse.up();
  const v1 = await page.evaluate(() => window.Board.view);
  assert(Math.round(v1.x - v0.x) === -100 && Math.round(v1.y - v0.y) === -50, '보드 이동');

  // 확대·축소
  await page.click('#bb-zoom-in');
  const v2 = await page.evaluate(() => window.Board.view);
  assert(Math.abs(v2.z / v1.z - 1.25) < 0.01, '확대 버튼');
  await page.mouse.move(vpb.x + 300, vpb.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  const v3 = await page.evaluate(() => window.Board.view);
  assert(v3.z < v2.z, 'Ctrl+휠 축소');
  await page.click('#bb-fit');
  await page.waitForTimeout(50);
  const allVisible = await page.evaluate(() => {
    const r = document.querySelector('#board-viewport').getBoundingClientRect();
    return [...document.querySelectorAll('.bcard')].every((c) => { const b = c.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1; });
  });
  assert(allVisible, '한눈에 보기: 모든 카드가 화면 안에');

  // 펜으로 체크 표시 그리기
  await page.click('[data-tool=pen]');
  const target = await page.locator('.btitle:text-is("본문 2과")').boundingBox();
  await page.mouse.move(target.x - 30, target.y + 6);
  await page.mouse.down();
  await page.mouse.move(target.x - 22, target.y + 14, { steps: 4 });
  await page.mouse.move(target.x - 6, target.y - 8, { steps: 6 });
  await page.mouse.up();
  assert((await state()).strokes.length === 1, '펜 자국 저장');
  assert((await page.locator('#board-ink path').count()) === 1, '펜 자국 표시');
  // 펜 모드에서는 카드가 클릭되지 않는다(그리기 우선)
  // 형광펜
  await page.click('[data-tool=marker]');
  const t2 = await page.locator('.btitle:text-is("본문 1과")').boundingBox();
  await page.mouse.move(t2.x, t2.y + t2.height / 2);
  await page.mouse.down();
  await page.mouse.move(t2.x + t2.width * 0.8, t2.y + t2.height / 2, { steps: 8 });
  await page.mouse.up();
  assert((await state()).strokes.filter((s) => s.marker).length === 1, '형광펜 자국');
  await shot(page, 'b2-ink');
  // 지우개
  await page.click('[data-tool=eraser]');
  await page.mouse.move(target.x - 40, target.y - 20);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y + 20, { steps: 10 });
  await page.mouse.up();
  assert((await state()).strokes.length === 1, '지우개로 펜 자국 하나 지움');
  await page.keyboard.press('Control+z');
  assert((await state()).strokes.length === 2, '지운 자국 되돌리기');
  await page.keyboard.press('v');

  // 메모: 붙임쪽지
  const notes = async () => (await state()).topics.filter((t) => t.kind === 'note');
  await page.click('#bb-add-note');
  await page.waitForSelector('.bnote-edit');
  assert(await page.isVisible('#note-bar'), '메모를 쓰는 동안 꾸미기 띠');
  assert((await notes()).length === 0, '새 메모는 글을 적기 전에는 저장하지 않음');
  await page.keyboard.type('수학 2단원 오답노트 다시 보기');
  await page.click('#note-bar [data-note-color="#ffd3df"]');
  await page.click('#note-bar [data-note-size]');
  assert(await page.evaluate(() => document.activeElement.matches('[data-note-edit]')), '띠를 눌러도 쓰던 칸에 커서');
  await page.mouse.click(vpb.x + 20, vpb.y + vpb.height - 100);
  let n1 = (await notes()).find((t) => t.title.includes('오답노트'));
  assert(n1 && n1.color === '#ffd3df' && n1.size === 'l' && !n1.style, '메모 붙이기 (분홍 쪽지, 큰 글자)');
  assert(!(await page.isVisible('#note-bar')), '바깥을 누르면 쓰기 끝');
  // 눌러서 고치기
  await page.click(`.bcard.note[data-id="${n1.id}"] .bnote-text`);
  await page.waitForSelector('.bnote-edit');
  await page.keyboard.press('End');
  await page.keyboard.type(' 금요일까지');
  await page.click('#note-bar [data-note-done]');
  n1 = (await notes()).find((t) => t.id === n1.id);
  assert(n1.title.endsWith('금요일까지'), '메모를 눌러 그 자리에서 고치기');
  // 끌어서 옮기기
  const nb = await page.locator(`.bcard.note[data-id="${n1.id}"]`).boundingBox();
  await page.mouse.move(nb.x + 30, nb.y + 20);
  await page.mouse.down();
  await page.mouse.move(nb.x + 130, nb.y + 70, { steps: 6 });
  await page.mouse.up();
  const n1b = (await notes()).find((t) => t.id === n1.id);
  assert(Math.abs(n1b.x - n1.x - 100 / z) <= 12 && Math.abs(n1b.y - n1.y - 50 / z) <= 12 && !(await page.isVisible('#note-bar')), '메모 끌어서 옮기기 (끌면 쓰기가 열리지 않음)');
  // 모서리로 폭 바꾸기
  const gb = await page.locator(`.bcard.note[data-id="${n1.id}"] .bnote-grip`).boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2 + 80, gb.y + gb.height / 2, { steps: 5 });
  await page.mouse.up();
  const n1c = (await notes()).find((t) => t.id === n1.id);
  assert(n1c.w > 220 && n1c.x === n1b.x, `메모 폭 넓히기 (${n1c.w})`);
  // 글 상자 (T 키)
  await page.keyboard.press('t');
  await page.waitForSelector('.bnote-edit');
  await page.keyboard.type('이번 주 목표');
  await page.click('#note-bar [data-note-color="#1c7ed6"]');
  await page.click('#note-bar [data-note-done]');
  const tb = (await notes()).find((t) => t.title === '이번 주 목표');
  assert(tb && tb.style === 'text' && tb.color === '#1c7ed6', '글 상자 (파란 글자)');
  // 비우면 지움, 빈 새 메모는 남지 않음
  await page.click(`.bcard.note[data-id="${tb.id}"] .bnote-text`);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.click('#note-bar [data-note-done]');
  assert(!(await notes()).some((t) => t.id === tb.id), '내용을 다 지우면 메모도 지움');
  await page.keyboard.press('Control+z');
  assert((await notes()).some((t) => t.id === tb.id), '지운 메모 되돌리기');
  await page.click('#bb-add-note');
  await page.waitForSelector('.bnote-edit');
  await page.keyboard.press('Escape');
  assert((await notes()).length === 2 && !(await page.locator('.bnote-edit').count()) && (await page.evaluate(() => Board.mode)) === 'board', '빈 새 메모는 Esc로 사라지고 보드는 그대로');

  // 남은 것만 보기
  await page.check('#bl-only-left');
  assert(!(await page.isVisible('.btitle:text-is("본문 1과")')), '남은 것만: 끝낸 항목 숨김');
  await page.uncheck('#bl-only-left');

  // 삭제 (확인 창) 후 되돌리기
  const korean = page.locator('.bcard', { has: page.locator('.bcard-title:text-is("수학")') });
  await korean.locator('.bcard-head [data-menu]').click();
  await page.click('#pop-menu [data-act="delete"]');
  assert(await page.isVisible('#ask'), '카드 삭제 확인 창');
  await page.click('#ask-ok');
  assert(!(await topic('수학')) && !(await topic('다항식')), '카드와 하위 항목 삭제');
  await page.click('#bb-undo');
  assert(!!(await topic('다항식')), '삭제 되돌리기');

  // 시험 하나 더 + 전환
  await page.selectOption('#bb-exam', '__new');
  await page.fill('#ee-name', '모의고사');
  await page.click('#exam-edit-form button[type=submit]');
  await page.click('#bb-paste');
  await page.click('#paste-sample');
  await page.click('#paste-ok');
  await page.waitForTimeout(150);
  assert((await page.locator('.bcard').count()) === 5, '두 번째 시험 예시 범위');
  const ids = (await state()).exams.map((e) => e.id);
  await page.selectOption('#bb-exam', ids[0]);
  assert((await page.locator('.bcard').count()) === 5, '시험 전환 (과목 3 + 메모 2)');

  // 홈 연동 (전체 화면에는 앱 바가 없으니 목록으로 나와서)
  await page.click('[data-scope-mode=list]');
  await page.click('.topbar [data-view=home]');
  assert((await page.locator('.exam-row').count()) === 2, '홈에 시험 준비 표시');
  assert((await page.textContent('#h-exams')).includes('2학기 기말고사'), '홈 시험 이름');
  await page.locator('.exam-row', { hasText: '모의고사' }).click();
  assert((await page.textContent('#bb-exam option:checked')) === '모의고사', '홈에서 시험 눌러 보드 열기');

  // 새로고침 후 유지 (보기 위치 포함) — 화면 맞춤(다음 프레임)과 저장(0.3초 뒤)이 끝난 뒤에 비교
  assert((await page.evaluate(() => Board.mode)) === 'list', '홈에서 열어도 범위는 목록부터');
  await page.click('[data-scope-mode=board]');
  await page.waitForTimeout(500);
  const vBefore = await page.evaluate(() => window.Board.view);
  await page.reload();
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => Board.mode)) === 'list', '새로고침해도 범위는 목록부터');
  await page.click('[data-scope-mode=board]');
  const vAfter = await page.evaluate(() => window.Board.view);
  assert((await page.locator('.bcard').count()) === 5 && Math.abs(vAfter.x - vBefore.x) < 2 && Math.abs(vAfter.z - vBefore.z) < 0.01, '새로고침 후 보드와 보기 위치 유지');

  // 텍스트로 내보내기 형식
  const outline = await page.evaluate(() => Scope.toOutline(App.store.get().topics, App.store.get().exams[0].id));
  assert(outline.includes('- [x] 본문 1과') && outline.includes('- [ ] 복소수의 연산'), '범위 텍스트 내보내기');

  // 시험 삭제
  await page.click('#bb-exam-edit');
  await page.click('#ee-delete');
  await page.click('#ask-ok');
  assert((await state()).exams.length === 1 && (await page.locator('.bcard').count()) === 5, '시험 삭제');

  // 하루 분량
  assert(/하루 \d+개씩/.test(await page.textContent('#bb-pace')), '하루 분량 표시: ' + (await page.textContent('#bb-pace')));

  // 검색: 접힌 곳 안의 항목도 펼쳐서 찾아 준다
  await row('1단원').locator(':scope > .brow [data-collapse]').click();
  await page.click('#bb-zoom-out'); await page.click('#bb-zoom-out'); await page.click('#bb-zoom-out');
  await page.fill('#bb-search-input', '인수');
  await page.press('#bb-search-input', 'Enter');
  await page.waitForTimeout(100);
  assert((await page.textContent('#bb-search-count')) === '1/1', '검색 결과 개수');
  const hitVisible = await page.evaluate(() => {
    const el = document.querySelector('.flash-hit');
    if (!el) return false;
    const r = document.querySelector('#board-viewport').getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return b.left > r.left && b.right < r.right && b.top > r.top && b.bottom < r.bottom;
  });
  assert(hitVisible, '검색한 항목을 펼치고 화면 가운데로');
  assert((await page.evaluate(() => window.Board.view.z)) >= 0.99, '검색 시 읽을 수 있게 확대');
  await page.fill('#bb-search-input', '없는항목');
  await page.press('#bb-search-input', 'Enter');
  assert((await page.textContent('#bb-search-count')) === '없음', '검색 결과 없음');
  await page.fill('#bb-search-input', '');

  // 항목에서 바로 타이머
  await page.evaluate(() => { const s = App.store.get(); if (!s.subjects.some((x) => x.name === '수학')) App.store.update((st) => st.subjects.push({ id: 'm', name: '수학', color: '#4a7fd4' })); });
  await row('인수분해').locator(':scope > .brow [data-menu]').click();
  await page.click('#pop-menu [data-act="focus"]');
  assert(await page.isVisible('#view-timer'), '타이머 화면으로 이동');
  assert((await page.textContent('#timer-topic-text')).includes('수학 · 인수분해'), '공부 중인 범위 표시');
  assert((await page.locator('#timer-subject option:checked').textContent()) === '수학', '과목 자동 선택');
  await page.click('#timer-start');
  await page.evaluate(() => { window.__studypromotion.timer.endAt = Date.now() - 10; });
  await page.waitForTimeout(400);
  const ses = (await state()).sessions.pop();
  assert(ses && ses.label === '수학 · 인수분해', '집중 기록에 범위 이름 저장');
  assert(!(await page.evaluate(() => Board.full)) && (await page.isVisible('.topbar')), '다른 화면으로 가면 전체 화면이 풀림');
  await page.click('.tab[data-view=board]');
  assert((await page.evaluate(() => Board.mode)) === 'list', '범위 탭으로 돌아오면 목록부터');

  // 화면 밝기 전환
  await page.click('#theme-btn');
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', '밝게');
  await page.click('#theme-btn');
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '어둡게');
  await page.click('[data-scope-mode=board]');
  await page.click('#bb-fit');
  await shot(page, 'b5-dark');
  await page.click('[data-scope-mode=list]');
  await page.click('#theme-btn');
  assert(!(await page.evaluate(() => document.documentElement.dataset.theme)), '자동');

  // 휴대폰
  await page.setViewportSize({ width: 390, height: 800 });
  await page.reload();
  await page.waitForTimeout(200);
  await page.click('[data-scope-mode=board]');
  assert(!(await page.isVisible('.tabs')) && (await page.isVisible('#board-dock')), '휴대폰: 보드는 아래 탭도 숨기고 도구 띠');
  const fullH = await page.evaluate(() => document.querySelector('#board-viewport').getBoundingClientRect().height);
  assert(fullH > 700, '휴대폰: 보드 칸이 화면을 거의 다 씀 (' + Math.round(fullH) + 'px)');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '휴대폰: 가로 스크롤 없음');
  await shot(page, 'b3-mobile');
  const mz = (await page.evaluate(() => window.Board.view)).z;
  // 터치 핀치 시뮬레이션 대신 버튼 확대
  await page.click('#bb-fit');
  await shot(page, 'b4-mobile-fit');
  assert((await page.evaluate(() => window.Board.view)).z <= mz, '휴대폰 한눈에 보기');
  // 휴대폰 뒤로 가기: 전체 화면 → 목록 (범위 화면은 그대로)
  await page.goBack();
  await page.waitForTimeout(150);
  assert((await page.evaluate(() => ({ m: Board.mode, v: App.view }))).m === 'list' && (await page.evaluate(() => App.view)) === 'board' && (await page.isVisible('.tabs')), '뒤로 가기: 보드 전체 화면에서 목록으로');
  // 3.9.1: 보드를 아주 멀리 본 뒤(확대 45% 아래) 목록으로 돌아와도 과목 제목·진행률 글씨는 목록 크기 그대로
  const headSize = () => page.evaluate(() => { const c = document.querySelector('#board-cards .bcard:not(.note)'); return { t: parseFloat(getComputedStyle(c.querySelector('.bcard-title')).fontSize), p: parseFloat(getComputedStyle(c.querySelector('.bcard-prog')).fontSize), bar: c.querySelector('.bbar').getBoundingClientRect().height }; });
  const listSize = await headSize();
  await page.click('[data-scope-mode=board]');
  await page.evaluate(() => Board.zoomAt(0.3, 195, 400));
  const farSize = await headSize();
  assert(farSize.t > listSize.t + 10, '보드를 멀리 보면 과목 제목을 크게 (' + farSize.t + 'px)');
  await page.click('[data-scope-mode=list]');
  const backSize = await headSize();
  assert(backSize.t === listSize.t && backSize.p === listSize.p && backSize.bar === listSize.bar && !(await page.evaluate(() => document.querySelector('#board-viewport').classList.contains('zoomed-out'))), '보드를 멀리 본 뒤 목록으로 와도 과목 제목·남은 시간 글씨는 그대로 (' + backSize.t + 'px, ' + backSize.p + 'px)');
  await page.click('[data-scope-mode=board]');
  assert(await page.evaluate(() => document.querySelector('#board-viewport').classList.contains('zoomed-out')) && (await headSize()).t === farSize.t, '보드로 다시 가면 멀리 보기 글씨가 돌아옴');
  await page.click('[data-scope-mode=list]');

  // 목록 ↔ 보드 전환 효과 (View Transitions): 자동 테스트는 평소 효과 없이 바로 바뀌므로, 효과를 켠 주소(?vt)로 따로 연다
  const vtCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const vtp = await vtCtx.newPage();
  vtp.on('pageerror', (e) => errors.push(e.message));
  await vtp.goto(url + '?vt#board');
  await vtp.click('#exam-sample');
  await vtp.click('[data-scope-mode=board]');
  const during = await vtp.evaluate(() => document.documentElement.className);
  await vtp.waitForFunction(() => !document.documentElement.classList.contains('vt-full'));
  assert(/vt-full/.test(during) && /vt-in/.test(during) && (await vtp.evaluate(() => Board.full)) && !(await vtp.isVisible('.tabs')), '보드로 갈 때 전환 효과 (' + during + ') 뒤 전체 화면');
  await vtp.evaluate(() => { Board.setMode('list'); Board.setMode('board'); Board.setMode('list'); }); // 효과 중에 여러 번 바꿔도 마지막 것으로
  await vtp.waitForFunction(() => !document.documentElement.classList.contains('vt-full'));
  await vtp.waitForTimeout(100);
  assert((await vtp.evaluate(() => Board.mode)) === 'list' && !(await vtp.evaluate(() => Board.full)) && (await vtp.isVisible('.tabs')), '효과 중에 다시 바꾸면 마지막으로 고른 보기로');
  await vtCtx.close();

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
})().catch(async (e) => { console.error(e.message); process.exit(1); });
