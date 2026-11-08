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

  // 계획: 할 일 추가
  await page.click('[data-view=plan]');
  const today = await page.evaluate(() => Stats.dayKey(Date.now()));
  await page.fill('#t-title', '수학 문제집 3단원');
  await page.selectOption('#t-subject', { label: '수학' });
  await page.fill('#t-due', today);
  await page.fill('#t-est', '50');
  await page.click('#task-form button[type=submit]');
  await page.fill('#t-title', '영어 독해 지문 5개');
  await page.fill('#t-due', '');
  await page.click('#task-form button[type=submit]');
  assert((await page.locator('#tasklist .task').count()) === 2, '할 일 2개 추가');

  // 홈 반영
  await page.click('[data-view=home]');
  assert((await page.textContent('#h-tasks')) === '2', '홈에 남은 할 일 2');
  assert((await page.locator('#h-tasklist .task').count()) === 1, '홈 오늘 할 일 1개');
  await page.click('#h-tasklist .task-check');
  assert((await page.textContent('#h-tasks')) === '1', '완료 체크 후 1');

  // 타이머: 1분 집중 설정 후 시간 경과 시뮬레이션
  await page.click('[data-view=stats]');
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
  assert((await page.textContent('#h-tasks')) === '1', '새로고침 후 데이터 유지');

  // XSS 방지
  await page.click('[data-view=plan]');
  await page.fill('#t-title', '<img src=x onerror="window.__x=1">');
  await page.click('#task-form button[type=submit]');
  assert(!(await page.evaluate(() => window.__x)), 'HTML 이스케이프');

  // 모바일
  await page.setViewportSize({ width: 375, height: 760 });
  await page.click('[data-view=stats]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, '모바일 가로 스크롤 없음');
  if (shotDir) { await page.screenshot({ path: shotDir + '/m-stats.png', fullPage: true }); await page.click('[data-view=plan]'); await page.screenshot({ path: shotDir + '/m-plan.png' }); await page.click('[data-view=timer]'); await page.screenshot({ path: shotDir + '/m-timer.png' }); }

  // 확인 창: 과목 삭제 취소 후 확인
  await page.click('[data-view=plan]');
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
