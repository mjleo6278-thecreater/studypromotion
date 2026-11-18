// 브라우저 시나리오 테스트: node tests/e2e.js  (Playwright 필요)
const { chromium } = require('playwright');
const path = require('path');
const url = process.env.APP_URL || 'file://' + path.resolve(__dirname, '../index.html');
const shotDir = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const okAsk = async () => { await page.click('#ask-ok'); };
  await page.goto(url);
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };

  // 스터디 플래너: 오늘 할 일 하나, 날짜 안 정한 할 일 하나
  await page.click('[data-view=plan]');
  const today = await page.evaluate(() => Stats.dayKey(Date.now()));
  await page.click('#pl-todo [data-pl-add]');
  await page.fill('#pl-title', '수학 문제집 3단원');
  await page.click('#pl-subj .chip:has-text("수학")');
  assert((await page.$eval('#pl-date', (i) => i.value)) === today, '오늘 칸에서 추가하면 날짜가 오늘');
  await page.selectOption('#pl-est', 'custom');
  await page.fill('#pl-est-custom', '50');
  await page.click('#pl-save');
  await page.click('#pl-todo [data-pl-add]');
  await page.fill('#pl-title', '영어 독해 지문 5개');
  await page.fill('#pl-date', '');
  await page.click('#pl-save');
  assert((await page.locator('#pl-list .pl-item').count()) === 1 && (await page.locator('#pl-undated .pl-item').count()) === 1, '할 일 2개 추가 (오늘 1, 날짜 안 정함 1)');
  const t0 = await page.evaluate(() => window.__studypromotion.store.get().tasks[0]);
  assert(t0.estimateMin === 50 && t0.due === today && t0.subjectId, '예상 시간 직접 적기 50분, 과목·날짜');

  // 홈 반영 (홈의 오늘 할 일 = 플래너의 오늘 칸)
  await page.click('[data-view=home]');
  assert((await page.textContent('#h-tasks')) === '1', '홈에 오늘 남은 할 일 1');
  assert((await page.locator('#h-tasklist .pl-item').count()) === 1, '홈 오늘 할 일 1개');
  await page.click('#h-tasklist .pl-mark');
  assert((await page.textContent('#h-tasks')) === '0' && /오늘 할 일 끝/.test(await page.textContent('#h-tasks-sub')), '완료 체크 후 0');

  // 타이머: 1분 집중 설정 후 시간 경과 시뮬레이션
  await page.click('#account-btn');
  assert(await page.isVisible('#view-account') && await page.isVisible('#acc-google'), '계정·설정 화면 (오른쪽 위 아이콘)');
  await page.fill('#set-focus', '1');
  await page.click('#settings-form button[type=submit]');
  await page.click('[data-view=timer]');
  assert((await page.textContent('#timer-time')) === '01:00', '타이머 1분 표시');
  await page.selectOption('#timer-subject', { label: '수학' });
  await page.click('#timer-start');
  await page.waitForTimeout(1300);
  const t = await page.textContent('#timer-time');
  assert(t === '00:59' || t === '00:58', '타이머 감소 ' + t);
  await page.evaluate(() => { window.__studypromotion.timer.endAt = Date.now() - 10; });
  await page.waitForTimeout(400);
  assert((await page.textContent('#timer-mode')) === '휴식', '집중 완료 후 휴식 전환');
  assert((await page.textContent('#timer-today')).includes('1회'), '오늘 집중 1회 기록');
  // 집중이 끝나면 이어서 무엇을 할지 고르는 창이 뜬다 (v2.9) → 그냥 끄기
  await page.waitForSelector('.ui-back.in .next-sheet');
  await page.click('.ui-back.in .next-sheet .ch-opt >> nth=3');
  await page.waitForTimeout(300);
  assert((await page.locator('.ui-back.in').count()) === 0 && (await page.textContent('#timer-time')) === '01:00', "집중이 끝나면 고르는 창이 뜨고, '그냥 끄기'를 누르면 닫힘");

  // 복습: 덱, 일괄 추가, 복습
  await page.click('[data-view=review]');
  await page.fill('#d-name', '영단어 Day 1');
  await page.click('#deck-form button');
  await page.fill('#c-front', 'apple'); await page.fill('#c-back', '사과');
  await page.click('#card-form button');
  await page.click('.bulk summary');
  await page.fill('#bulk-text', 'banana - 바나나\ncherry\t체리\nbad line');
  await page.click('#bulk-add');
  assert((await page.locator('#card-list .card-row').count()) === 3, '카드 3장 (잘못된 줄 무시)');
  if (shotDir) await page.screenshot({ path: shotDir + '/deck.png' });
  await page.click('#deck-study');
  await page.click('#flash');
  if (shotDir) await page.screenshot({ path: shotDir + '/study.png' });
  await page.click('[data-grade=good]');
  await page.keyboard.press(' ');
  await page.keyboard.press('1'); // 다시 → 큐 뒤로
  for (let i = 0; i < 5 && await page.isVisible('#flash'); i++) { await page.click('#flash'); await page.click('[data-grade=easy]'); }
  assert(await page.isVisible('#study-done'), '복습 완료 화면');
  await page.click('#study-finish');
  assert((await page.textContent('#deck-summary')).includes('복습할 카드 0장'), '복습 후 대기 0장');

  // 통계
  await page.click('[data-view=stats]');
  assert((await page.textContent('#week-total')).includes('1분'), '7일 합계 반영');
  assert((await page.locator('#subject-bars .sb-row').count()) === 1, '과목별 1행');
  await page.click('[data-view=home]');
  assert((await page.textContent('#h-streak')) === '1일', '연속 학습 1일');
  if (shotDir) await page.screenshot({ path: shotDir + '/home.png' });

  // 새로고침 후 유지
  await page.reload();
  assert((await page.locator('#h-tasklist .pl-item.done').count()) === 1 && (await page.textContent('#h-tasks')) === '0', '새로고침 후 데이터 유지');

  // XSS 방지
  await page.click('[data-view=plan]');
  await page.click('#pl-todo [data-pl-add]');
  await page.fill('#pl-title', '<img src=x onerror="window.__x=1">');
  await page.click('#pl-save');
  assert((await page.textContent('#pl-list')).includes('<img src=x'), '할 일 이름은 글자 그대로');
  assert(!(await page.evaluate(() => window.__x)), 'HTML 이스케이프');

  // 앱 소개
  await page.click('#about-btn');
  const about = await page.textContent('#view-about');
  assert(about.includes('남민재') && about.includes('프로모션') && about.includes('사용설명서') && about.includes('이스터에그'), '앱 소개: 제작자·이름의 뜻·사용설명서·이스터에그 자리');
  await page.click('[data-view=home]');

  // 모바일
  await page.setViewportSize({ width: 375, height: 760 });
  await page.click('[data-view=stats]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '모바일 가로 스크롤 없음');
  if (shotDir) { await page.screenshot({ path: shotDir + '/m-stats.png', fullPage: true }); await page.click('[data-view=plan]'); await page.screenshot({ path: shotDir + '/m-plan.png' }); await page.click('[data-view=timer]'); await page.screenshot({ path: shotDir + '/m-timer.png' }); }

  // 확인 창: 과목 삭제 취소 후 확인
  await page.click('[data-view=plan]');
  await page.click('#pl-subjects-fold > summary');
  assert(await page.isVisible('#subject-list'), '과목 관리를 누르면 펼쳐짐');
  await page.click('[data-del-subject]');
  assert(await page.isVisible('#ask'), '확인 창 표시');
  await page.click('#ask-cancel');
  assert((await page.locator('.subject-pill').count()) === 3, '취소하면 유지');
  await page.click('[data-del-subject]');
  await okAsk();
  assert((await page.locator('.subject-pill').count()) === 2, '확인하면 삭제');

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
