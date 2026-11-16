// 링크로 플래시카드 가져오기 (v3.5): 링크를 누르면 확인 창 → 덱 고르기 → 카드 추가, 겹친 카드 빼기, 되돌리기
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CardLink = require('../js/cardlink.js');
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
const SHOTS = process.env.SHOTS; // 미리 보기 사진을 남길 폴더 (없으면 안 찍음)

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];
  async function open(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true }, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return page;
  }
  const spanish = [['hola', '안녕'], ['adiós', '잘 가'], ['¿Qué tal?', '어떻게 지내?'], ['comer (v.)', '먹다 & 마시다 아님']];
  const link = (data) => CardLink.build(data, base);
  const sheet = (page) => page.waitForSelector('.ui-back.in .ui-cardlink');
  const sheetGone = (page) => page.waitForFunction(() => !document.querySelector('.ui-back:not(.out) .ui-cardlink'));
  const toastOf = (page) => page.$eval('#toast', (t) => t.textContent);
  const st = (page) => page.evaluate(() => App.store.get());

  /* ===== 1) 앱을 처음 여는 링크: 확인 창 → 새 덱으로 추가 ===== */
  let page = await open();
  await page.goto(link({ deck: '스페인어 3과', cards: spanish }));
  await sheet(page);
  assert(new URL(page.url()).hash === '#review', '긴 카드 주소는 #review로 바뀜: ' + page.url());
  assert(await page.evaluate(() => App.view) === 'review', '복습 화면이 열림');
  assert(/카드 4장을 추가할까요\?/.test(await page.textContent('.ui-cardlink .ui-sheet-head')), '제목: 카드 4장을 추가할까요?');
  assert(await page.$eval('.ui-back.in .cl-name-in', (i) => i.value) === '스페인어 3과', '새 덱 이름은 링크에 적힌 이름');
  assert(await page.$eval('.ui-back.in [data-cl-deck=""]', (b) => b.classList.contains('on')), '덱이 없으면 새 덱 만들기가 골라져 있음');
  const rows = await page.$$eval('.ui-back.in .cl-list li', (els) => els.map((li) => [li.querySelector('b').textContent, li.querySelector('span').textContent]));
  assert(JSON.stringify(rows) === JSON.stringify(spanish), '넣을 카드를 앞·뒤 그대로 보여 줌 (괄호·& 포함)');
  assert(await page.textContent('.ui-back.in [data-cl-ok]') === '카드 4장 추가', '단추에 하는 일: 카드 4장 추가');
  assert(/이 기기에만 저장돼요/.test(await page.textContent('.ui-back.in .cl-where')), '로그인하지 않았으면 이 기기에만 저장된다고 알려 줌');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cardlink-1-confirm.png') });
  await page.tap('.ui-back.in [data-cl-ok]');
  await sheetGone(page);
  let s = await st(page);
  assert(s.decks.length === 1 && s.decks[0].name === '스페인어 3과', '새 덱이 생김');
  assert(s.cards.length === 4 && s.cards.every((c) => c.deckId === s.decks[0].id && c.ease === 2.5 && c.reps === 0 && c.due <= Date.now()), '카드 4장이 새 카드로 들어가 오늘 바로 복습할 수 있음');
  assert(s.cards[3].front === 'comer (v.)' && s.cards[3].back === '먹다 & 마시다 아님', '괄호·& 글자가 그대로');
  assert(/'스페인어 3과' 덱에 카드 4장을 넣었어요/.test(await toastOf(page)), '알림: 덱에 카드 4장을 넣었어요');
  assert(await page.isVisible('#deck-detail') && await page.textContent('#deck-title') === '스페인어 3과' && /오늘 복습할 카드 4장/.test(await page.textContent('#deck-summary')), '넣은 덱을 바로 열어 보여 줌');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'cardlink-2-added.png') });

  // 뒤로 가기·새로 고침으로 다시 뜨지 않음
  await page.goBack().catch(() => {});
  await page.waitForTimeout(400);
  assert(!(await page.$('.ui-back:not(.out) .ui-cardlink')), '뒤로 가기를 눌러도 확인 창이 다시 뜨지 않음');
  await page.reload();
  await page.waitForFunction(() => window.App);
  await page.waitForTimeout(600);
  assert(!(await page.$('.ui-back:not(.out) .ui-cardlink')) && (await st(page)).cards.length === 4, '새로 고침해도 다시 넣지 않음');

  /* ===== 2) 같은 링크를 또 누르면: 같은 이름 덱이 골라지고, 이미 있는 카드는 뺌 ===== */
  await page.goto(base + '#home');
  await page.goto(link({ deck: '스페인어 3과', cards: spanish }));
  await sheet(page);
  const deckId = (await st(page)).decks[0].id;
  assert(await page.$eval(`.ui-back.in [data-cl-deck="${deckId}"]`, (b) => b.classList.contains('on')), '앱이 열려 있을 때 눌러도 뜨고, 같은 이름의 덱이 골라져 있음');
  assert(await page.$eval('.ui-back.in [data-cl-ok]', (b) => b.disabled && b.textContent === '모두 이미 있는 카드예요'), '모두 이미 있으면 추가 단추가 꺼짐');
  assert(await page.$$eval('.ui-back.in .cl-list li.dup', (els) => els.length) === 4, '이미 있는 카드는 흐리게 ‘이미 있음’');
  assert(await page.isHidden('.ui-back.in .cl-name'), '있는 덱을 고르면 새 덱 이름 칸은 숨김');
  await page.tap('.ui-back.in [data-cl-cancel]');
  await sheetGone(page);
  assert((await st(page)).cards.length === 4, '넣지 않기를 누르면 아무것도 안 바뀜');
  await page.reload();
  await page.waitForFunction(() => window.App);
  await page.waitForTimeout(500);
  assert(!(await page.$('.ui-back:not(.out) .ui-cardlink')), '넣지 않은 링크도 새로 고침하면 다시 안 뜸');

  /* ===== 3) 일부만 겹치면 새 카드만, 다른 덱 고르기, 새 덱 이름 바꾸기 ===== */
  await page.evaluate(() => App.store.update((x) => x.decks.push({ id: 'dk-eng', name: '영단어 Day 1', createdAt: 1 })));
  await page.goto(base + '#home');
  await page.goto(link({ deck: '스페인어 3과', cards: [['hola', '안녕'], ['gracias', '고마워']] }));
  await sheet(page);
  assert(await page.textContent('.ui-back.in [data-cl-ok]') === '카드 1장 추가' && /이미 있는 카드 1장은 빼고/.test(await page.textContent('.ui-back.in .cl-dup')), '겹친 1장은 빼고 1장만 넣는다고 알려 줌');
  await page.tap('.ui-back.in [data-cl-deck="dk-eng"]');
  assert(await page.textContent('.ui-back.in [data-cl-ok]') === '카드 2장 추가' && await page.isHidden('.ui-back.in .cl-dup'), '다른 덱을 고르면 그 덱 기준으로 다시 셈');
  await page.tap('.ui-back.in [data-cl-ok]');
  await sheetGone(page);
  s = await st(page);
  assert(s.cards.filter((c) => c.deckId === 'dk-eng').length === 2, '고른 덱(영단어 Day 1)에 들어감');
  assert(await page.textContent('#deck-title') === '영단어 Day 1', '고른 덱이 열림');

  await page.goto(base + '#home');
  await page.goto(link({ cards: [['uno', '하나'], ['dos', '둘']] }));
  await sheet(page);
  const autoName = await page.$eval('.ui-back.in .cl-name-in', (i) => i.value);
  assert(/^가져온 카드 \d+\/\d+$/.test(autoName), '덱 이름이 없는 링크는 ‘가져온 카드 날짜’: ' + autoName);
  await page.fill('.ui-back.in .cl-name-in', '숫자');
  await page.press('.ui-back.in .cl-name-in', 'Enter');
  await sheetGone(page);
  s = await st(page);
  const numDeck = s.decks.find((d) => d.name === '숫자');
  assert(numDeck && s.cards.filter((c) => c.deckId === numDeck.id).length === 2, '새 덱 이름을 바꿔 적고 Enter로 추가');

  // 되돌리기: 넣은 카드와 새로 만든 덱을 뺌
  await page.tap('#toast .toast-act');
  await page.waitForTimeout(200);
  s = await st(page);
  assert(!s.decks.some((d) => d.name === '숫자') && !s.cards.some((c) => c.front === 'uno'), '되돌리기를 누르면 카드와 새 덱이 빠짐');
  assert(await page.isVisible('#deck-home'), '덱 목록으로 돌아감');
  await page.context().close();

  /* ===== 4) 압축 링크, 잘못된 링크 ===== */
  page = await open();
  const many = Array.from({ length: 120 }, (_, i) => [`palabra ${i}`, `단어 ${i}`]);
  const zip = await CardLink.buildZip({ deck: '긴 목록', cards: many }, base);
  await page.goto(zip);
  await sheet(page);
  assert(/카드 120장을 추가할까요/.test(await page.textContent('.ui-cardlink .ui-sheet-head')), '압축 링크도 읽음 (120장)');
  await page.tap('.ui-back.in [data-cl-ok]');
  await sheetGone(page);
  assert((await st(page)).cards.length === 120, '120장이 들어감');
  await page.goto(base + '#home');
  await page.goto(base + '#cards&c=그냥글자');
  await page.waitForFunction(() => /카드를 찾지 못했어요/.test(document.querySelector('#toast').textContent));
  assert(!(await page.$('.ui-back:not(.out) .ui-cardlink')), '카드가 없는 링크는 창 없이 알림만');
  await page.goto(base + '#home');
  await page.goto(zip.slice(0, zip.indexOf('&z=') + 20));
  await page.waitForFunction(() => /잘렸거나/.test(document.querySelector('#toast').textContent));
  assert(true, '중간에 잘린 압축 링크는 다시 받아 달라고 알림');
  await page.context().close();

  /* ===== 5) 새 버전으로 새로 고침돼도 링크를 잃지 않음, 시작 화면·잠금 화면이 끝난 뒤에 뜸 ===== */
  page = await open();
  await page.goto(base + '#home');
  await page.evaluate(() => { sessionStorage.setItem('studypromotion.cardLink', '#cards&deck=맡긴+링크&c=a~b'); });
  await page.reload();
  await sheet(page);
  assert(await page.$eval('.ui-back.in .cl-name-in', (i) => i.value) === '맡긴 링크', '창을 띄우기 전에 새로 고침돼도 이어서 뜸');
  await page.tap('.ui-back.in [data-cl-cancel]');
  await sheetGone(page);
  assert(await page.evaluate(() => !sessionStorage.getItem('studypromotion.cardLink')), '다 쓴 링크는 지움');

  // 창이 떠 있는 사이 다른 링크가 오면, 앞 창을 닫은 뒤 이어서 뜸
  await page.goto(base + '#cards&deck=첫+링크&c=a~b');
  await sheet(page);
  await page.evaluate(() => { location.hash = '#cards&deck=둘째+링크&c=c~d'; });
  await page.waitForTimeout(300);
  assert(await page.$eval('.ui-back.in .cl-name-in', (i) => i.value) === '첫 링크', '창이 떠 있으면 먼저 온 링크부터');
  await page.tap('.ui-back.in [data-cl-cancel]');
  await page.waitForFunction(() => { const i = document.querySelector('.ui-back.in .cl-name-in'); return i && i.value === '둘째 링크'; });
  assert(true, '앞 창을 닫으면 나중에 온 링크 창이 이어서 뜸');
  await page.tap('.ui-back.in [data-cl-cancel]');
  await sheetGone(page);

  // 계정 기록과 맞추는 중이면 끝날 때까지 기다렸다가 뜸 (받아 온 기록이 넣은 카드를 덮지 않게)
  await page.evaluate(() => { window.__sync = true; Object.defineProperty(window.Cloud, 'syncing', { get: () => window.__sync, configurable: true }); location.hash = '#cards&c=동기화~중'; });
  await page.waitForTimeout(900);
  assert(!(await page.$('.ui-back:not(.out) .ui-cardlink')), '계정과 맞추는 중에는 기다림');
  await page.evaluate(() => { window.__sync = false; });
  await sheet(page);
  assert(true, '맞추기가 끝나면 뜸');
  await page.tap('.ui-back.in [data-cl-cancel]');
  await sheetGone(page);

  await page.goto(base + '?splash#cards&c=x~y');
  await page.waitForTimeout(800);
  assert(await page.$('#splash') && !(await page.$('.ui-back:not(.out) .ui-cardlink')), '시작 화면이 도는 동안은 기다림');
  await sheet(page);
  assert(!(await page.$('#splash')), '시작 화면이 끝나면 뜸');
  await page.tap('.ui-back.in [data-cl-cancel]');
  await sheetGone(page);

  await page.goto(base + '#home');
  await page.evaluate(() => localStorage.setItem('studypromotion.lock', JSON.stringify({ startAt: Date.now() - 60000, endAt: Date.now() + 2500, minutes: 1, subjectId: '', leaves: 0, awayMs: 0 })));
  await page.goto(base + '#cards&c=잠금~중');
  await page.reload();
  await page.waitForTimeout(800);
  assert(await page.isVisible('#lock-screen') && !(await page.$('.ui-back:not(.out) .ui-cardlink')), '잠금 화면이 떠 있으면 기다림');
  await page.waitForFunction(() => !(window.Lock && window.Lock.state), null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('ask').hidden === false || document.querySelector('.ui-back.in .ui-cardlink'), null, { timeout: 8000 });
  if (!(await page.isHidden('#ask'))) await page.tap('#ask-cancel'); // 잠금이 끝나며 묻는 창이 있으면 먼저 닫는다
  await sheet(page);
  assert(true, '잠금이 끝난 뒤에 뜸');
  await page.context().close();

  /* ===== 6) 화면 크기·어두운 화면·가로 화면 ===== */
  for (const [name, opts] of [['dark', { colorScheme: 'dark' }], ['wide', { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }], ['landscape', { viewport: { width: 740, height: 360 } }]]) {
    page = await open(opts);
    await page.goto(base + '#home');
    await page.evaluate(() => App.store.update((x) => { x.decks.push({ id: 'd1', name: '영단어 Day 1', createdAt: 1 }); }));
    await page.goto(link({ deck: '스페인어 3과', cards: spanish.concat(many.slice(0, 10)) }));
    await sheet(page);
    await page.waitForTimeout(300);
    const box = await page.$eval('.ui-back.in [data-cl-ok]', (b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, w: innerWidth, right: r.right }; });
    assert(box.bottom <= box.h && box.top >= 0 && box.right <= box.w, `${name}: 추가 단추가 화면 안에 보임`);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!over, `${name}: 가로로 넘치지 않음`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `cardlink-3-${name}.png`) });
    await page.context().close();
  }

  assert(errors.length === 0, '오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
