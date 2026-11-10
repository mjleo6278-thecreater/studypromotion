// 디자인 부품 브라우저 테스트: 선택창 시트, 색 팔레트, 전체 핑크 비밀 테마, 시작 화면
const { chromium } = require('playwright');
const path = require('path');
const url = process.env.APP_URL || 'file://' + path.resolve(__dirname, '../index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };

  // 테스트 브라우저에서는 시작 화면을 건너뛴다
  await page.goto(url + '#board');
  assert(!(await page.$('#splash')), '자동화 브라우저에서는 시작 화면 생략');

  // 버튼·입력칸도 앱 글꼴
  const fam = await page.$eval('.top-icon', (el) => getComputedStyle(el).fontFamily);
  assert(fam.includes('Pretendard'), '버튼 글꼴도 Pretendard: ' + fam);

  // 시험 선택창 → 앱 모양 시트
  await page.getByText('예시 범위로 둘러보기').click();
  await page.waitForTimeout(300);
  const selBtn = page.locator('[data-for="bb-exam"]');
  assert(await selBtn.isVisible(), '시험 선택이 앱 모양 버튼으로');
  assert((await selBtn.textContent()).includes('예시'), '버튼에 지금 고른 시험 이름');
  await selBtn.click();
  assert(await page.isVisible('.ui-sheet .ui-opt.on'), '누르면 선택 시트');
  assert((await page.locator('.ui-sheet .ui-opt').count()) >= 2, '시험 목록 + 새 시험');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  assert(!(await page.$('.ui-back')), 'Esc로 닫힘');

  // 과목 색: ⋯ 메뉴 → 팔레트
  await page.locator('.bcard-head .bmenu').first().click();
  await page.click('.pm-color-item');
  assert((await page.locator('.ui-sheet .ui-sw').count()) === 50, '색 계열 10줄 × 5색 팔레트');
  const picked = '#2aa893';
  await page.click(`.ui-sw[data-color="${picked}"]`);
  await page.waitForTimeout(250);
  const card = await page.evaluate(() => { const s = window.App.store.get(); return s.topics.find((t) => !t.parentId && t.kind !== 'note').color; });
  assert(card === picked, '고른 색이 과목 카드에 반영');

  // 계획: 과목 선택창, 과목 색 버튼
  await page.goto(url + '#plan');
  assert(await page.isVisible('#subject-form .color-btn'), '과목 추가에 색 버튼 (기본 색 입력창 대신)');
  await page.click('#subject-form .color-btn');
  await page.click('.ui-sw[data-color="#e36299"]');
  await page.fill('#s-name', '미술');
  await page.click('#subject-form button[type=submit]');
  const art = await page.evaluate(() => window.App.store.get().subjects.find((s) => s.name === '미술'));
  assert(art && art.color === '#e36299', '고른 색으로 과목 추가');
  await page.click('[data-for="t-subject"]');
  await page.locator('.ui-opt', { hasText: '미술' }).click();
  assert((await page.$eval('#t-subject', (s) => s.options[s.selectedIndex].textContent)) === '미술', '시트에서 고르면 원래 select 값이 바뀜');
  assert((await page.textContent('[data-for="t-subject"]')).includes('미술'), '버튼 글자도 바뀜');
  await page.selectOption('#t-subject', { label: '과목 없음' });
  assert((await page.textContent('[data-for="t-subject"]')).includes('과목 없음'), '코드로 값을 바꿔도 버튼이 따라옴');

  // 날짜: 앱 모양 달력 시트
  assert(await page.isVisible('[data-for="t-due"]'), '마감일이 달력 버튼으로');
  await page.click('[data-for="t-due"]');
  assert(await page.isVisible('.ui-date .ui-day.today'), '달력 시트에 오늘 표시');
  await page.click('.ui-cal-nav[data-nav="1"]');
  await page.locator('.ui-date .ui-day', { hasText: /^15$/ }).click();
  const due = await page.$eval('#t-due', (i) => i.value);
  const d = new Date(); const nm = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  const want = `${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}-15`;
  assert(due === want, '다음 달 15일을 고르면 input 값이 바뀜: ' + due);
  assert((await page.textContent('[data-for="t-due"]')).includes(`${nm.getMonth() + 1}월 15일`), '버튼에 고른 날짜');
  await page.fill('#t-due', '');
  assert((await page.textContent('[data-for="t-due"]')).includes('마감일'), '값을 지우면 안내 글자');
  await page.click('[data-for="t-due"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const tmr = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  assert((await page.$eval('#t-due', (i) => i.value)) === `${tmr.getFullYear()}-${String(tmr.getMonth() + 1).padStart(2, '0')}-${String(tmr.getDate()).padStart(2, '0')}`, '키보드(→, Enter)로 내일 고르기');

  // 비밀 단어로 전체 핑크 테마 켜고 끄기
  await page.goto(url + '#about');
  await page.fill('#egg-input', '전교회장');
  await page.press('#egg-input', 'Enter');
  assert((await page.evaluate(() => document.documentElement.dataset.skin)) === 'pink', '비밀 단어로 핑크 테마 켜짐');
  await page.waitForTimeout(800);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(bg === 'rgb(255, 240, 245)', '배경까지 핑크: ' + bg);
  assert((await page.textContent('#egg-out')).includes('핑크 테마가 켜졌어요'), '켜짐 안내');
  await page.reload();
  assert((await page.evaluate(() => document.documentElement.dataset.skin)) === 'pink', '다시 열어도 유지');
  await page.fill('#egg-input', '전교 회장');
  await page.press('#egg-input', 'Enter');
  assert(!(await page.evaluate(() => document.documentElement.dataset.skin)), '한 번 더 넣으면 원래 테마');

  // 시작 화면 (?splash로 강제)
  await page.goto(url.replace(/index\.html$/, 'index.html?splash'));
  assert(await page.isVisible('#splash'), '시작 화면 표시');
  await page.waitForTimeout(2900);
  assert(!(await page.$('#splash')), '애니메이션 뒤 사라짐');

  // 시작 화면 폰 움직임: 시간을 멈춰 가며 60fps 프레임마다 위치를 잰다
  // 한 칸에 한 번의 매끄러운 이동(빨라졌다 느려지기만, 중간에 멈칫 없음) × 3칸, 한 프레임에 크게 튀지 않기
  await page.goto(url.replace(/index\.html$/, 'index.html?splash'));
  const climb = await page.evaluate(() => {
    const anims = document.getAnimations();
    anims.forEach((a) => a.pause());
    const pawn = document.querySelector('.sp-pawn');
    const ys = [];
    for (let t = 0; t <= 1400; t += 1000 / 60) {
      anims.forEach((a) => { a.currentTime = t; });
      ys.push(new DOMMatrix(getComputedStyle(pawn).transform).f);
    }
    const v = ys.slice(1).map((y, i) => ys[i] - y); // 위로 간 거리(보드 단위, 한 칸 = 40)
    const humps = [];
    let cur = null;
    v.forEach((x) => { if (x > 0.02) { (cur = cur || []).push(x); } else if (cur) { humps.push(cur); cur = null; } });
    if (cur) humps.push(cur);
    const smooth = humps.every((h) => { const p = h.indexOf(Math.max(...h)); return h.every((x, i) => i === 0 || (i <= p ? x >= h[i - 1] - 0.02 : x <= h[i - 1] + 0.02)); });
    return { total: ys[0] - ys[ys.length - 1], humps: humps.length, smooth, max: Math.max(...v) };
  });
  assert(Math.round(climb.total) === 120, '폰이 끝 칸까지 3칸 이동');
  assert(climb.humps === 3 && climb.smooth, '한 칸씩 매끄럽게 (이동 ' + climb.humps + '번, 중간 멈칫 없음 ' + climb.smooth + ')');
  assert(climb.max < 4.5, '한 프레임에 크게 튀지 않음 (최대 ' + climb.max.toFixed(2) + ' / 칸 40)');

  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' / '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
