// 공식 카드 (v4.6): 만들어 둔 공식 덱 받기 → 한눈에 보기 → 그림 카드 복습 → 채점까지 폰 화면에서 눌러 본다
// SHOTS=폴더 를 주면 화면 사진을 남긴다
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
const SHOTS = process.env.SHOTS;

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: true, isMobile: (o.w || 390) < 700, colorScheme: o.dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => { try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ } });
    await page.goto(base + '#review');
    await page.waitForFunction(() => window.App && window.Formulas);
    await page.evaluate(() => document.fonts.ready);
    return page;
  }
  const shot = async (page, name, full) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); } };
  const tap = async (page, sel) => { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await el.tap(); await page.waitForTimeout(300); };
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const state = (page) => page.evaluate(() => { const st = App.store.get(); const d = st.decks.find((x) => x.pack === 'area'); return { deck: d || null, cards: d ? st.cards.filter((c) => c.deckId === d.id) : [], logs: st.reviewLog.length }; });

  console.log('1) 복습 탭: 만들어 둔 공식 덱');
  let page = await open();
  assert(await page.isVisible('#pack-panel') && /함수 넓이 공식/.test(await page.textContent('#pack-list')), '덱 목록 아래에 ‘만들어 둔 공식 덱’ · 함수 넓이 공식');
  assert(await page.isVisible('#pack-list [data-pack-add]') && await page.isVisible('#pack-list [data-pack-poster]') && !(await page.$('#pack-list [data-pack-open]')), '받기 전: 한눈에 보기 · 받기');
  assert(await page.$eval('#pack-list .mf-thumb', (s) => s.getBoundingClientRect().width > 40), '작은 그래프 그림');
  assert(await noSideScroll(page), '옆으로 밀리지 않음 (390px)');
  await shot(page, 'f1-decks');

  console.log('2) 한눈에 보기 (받기 전)');
  await tap(page, '#pack-list [data-pack-poster]');
  await page.waitForSelector('.mf-poster-sheet .mf-poster');
  const pv = await page.evaluate(() => {
    const sh = document.querySelector('.mf-poster-sheet'), body = sh.querySelector('.ui-sheet-body');
    return { figs: sh.querySelectorAll('.mf-p-tile svg').length, secs: [...sh.querySelectorAll('.mf-p-sec h3 > span')].map((e) => e.textContent).join(','), side: body.scrollWidth <= body.clientWidth + 1, foot: !!sh.querySelector('.mf-p-foot [data-pack-add]'), fr: sh.querySelectorAll('.mf-frac').length, tall: body.scrollHeight > body.clientHeight };
  });
  assert(pv.figs === 9 && pv.secs === '이차함수,삼차함수,사차함수,원리', '그래프 9개 · 이차·삼차·사차·원리 묶음 (' + pv.secs + ')');
  assert(pv.fr >= 11 && pv.side && pv.tall, '공식은 분수로 쌓아 보이고, 시트 안에서 위아래로만 넘김');
  assert(pv.foot, '아래에 ‘카드 10장 덱으로 받기’ 단추');
  await shot(page, 'f2-poster');
  // 원리 칸까지 넘겨 봄
  await page.evaluate(() => { const b = document.querySelector('.mf-poster-sheet .ui-sheet-body'); b.scrollTop = b.scrollHeight; });
  await page.waitForTimeout(200);
  assert(await page.isVisible('.mf-p-root .mf-p-tbl') && await page.isVisible('.mf-p-foot [data-pack-add]'), '맨 아래 원리 표까지 보이고 받기 단추는 붙어 있음');
  await shot(page, 'f2b-poster-end');

  console.log('3) 받기 → 덱 화면');
  await tap(page, '.mf-p-foot [data-pack-add]');
  await page.waitForSelector('#deck-detail:not([hidden])');
  let st = await state(page);
  assert(st.deck && st.deck.name === '함수 넓이 공식' && st.cards.length === 10 && st.cards.every((c) => /^area\//.test(c.fig) && c.front && c.back && c.due != null), '덱(pack: area)과 그림 카드 10장 (카드에는 글자와 그림 이름만)');
  assert(/‘함수 넓이 공식’ 카드 10장을 받았어요/.test(await page.textContent('#toast')), '받았다는 알림');
  assert(await page.isVisible('#deck-poster') && !(await page.isVisible('#deck-voice')), '덱 화면: 한눈에 보기 단추 있음, 말로 복습 단추는 숨김(그림 카드만 있는 덱)');
  assert(await page.$$eval('#card-list .card-row.has-fig .mf-thumb', (e) => e.length) === 9, '카드 목록에 작은 그래프 9개 (원리 카드는 그림 없음)');
  assert(await noSideScroll(page), '덱 화면 옆으로 밀리지 않음');
  await shot(page, 'f3-deck');
  await tap(page, '#deck-poster');
  assert(await page.isVisible('.mf-poster-sheet') && !(await page.$('.mf-poster-sheet .mf-p-foot')), '덱 화면의 한눈에 보기: 다 받았으면 받기 단추 없음');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  console.log('4) 그림 카드 복습');
  await page.evaluate(() => { window.__rnd = Math.random; Math.random = () => 0.999999; }); // 섞지 않음 → 덱 순서대로 (첫 장 = 이차함수와 직선)
  await tap(page, '#deck-study');
  await page.evaluate(() => { Math.random = window.__rnd; });
  const fr = await page.evaluate(() => ({ mf: document.querySelector('#flash').classList.contains('mf'), svg: !!document.querySelector('#flash-front svg.mf-fig'), q: (document.querySelector('#flash-front .mf-q') || {}).textContent, chip: (document.querySelector('#flash-front .mf-chip') || {}).textContent, back: document.querySelector('#flash-back').hidden }));
  assert(fr.mf && fr.svg && fr.q === '이차함수와 직선으로 둘러싸인 넓이' && fr.back, '앞면: 그래프 + 문제, 뒷면은 숨김 (' + fr.q + ')');
  assert(fr.chip === '함수 넓이 공식 · 이차함수', '위에 덱 · 묶음 표시 (' + fr.chip + ')');
  assert(await noSideScroll(page), '복습 화면 옆으로 밀리지 않음');
  await shot(page, 'f4-front');
  await tap(page, '#flash');
  await page.waitForTimeout(500);
  const bk = await page.evaluate(() => ({ shown: !document.querySelector('#flash-back').hidden, math: !!document.querySelector('#flash-back .mf-math'), note: (document.querySelector('#flash-back .mf-note') || {}).textContent || '', grades: (() => { const r = document.querySelector('#grades').getBoundingClientRect(); return r.top < innerHeight && r.height > 0; })() }));
  assert(bk.shown && bk.math && bk.note.length > 5, '누르면 뒷면: 공식 + 한 줄 설명');
  assert(bk.grades, '채점 단추가 화면 안으로 올라옴');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'f5-back');
  await tap(page, '[data-grade="good"]');
  st = await state(page);
  assert(st.logs === 1 && st.cards.filter((c) => c.reps > 0 || (c.due && c.due > Date.now() + 3600e3)).length === 1, '채점하면 복습 기록 1개, 그 카드는 다음 복습일로');
  assert(/남은 카드 9장/.test(await page.textContent('#study-meta')) && await page.evaluate(() => !!document.querySelector('#flash-front svg.mf-fig') || !!document.querySelector('#flash-front .mf-qmath')), '다음 그림 카드');

  console.log('5) 글자를 고친 카드 · 글자 카드와 섞인 덱');
  await tap(page, '#study-back');
  await page.evaluate(() => { const st = App.store.get(); const d = st.decks.find((x) => x.pack === 'area'); App.store.update((s) => { const c = s.cards.find((x) => x.deckId === d.id && x.fig === 'area/q-line'); c.back = '<b>내 말로</b> 1/6'; c.due = 0; }); });
  const ed = await page.evaluate(() => { const c = App.store.get().cards.find((x) => x.fig === 'area/q-line'); return Formulas.face(c, 'back'); });
  assert(/mf-math plain/.test(ed) && /&lt;b&gt;내 말로/.test(ed), '뒷면을 고친 카드는 고친 글자 그대로 (HTML로 안 읽힘)');
  await page.fill('#c-front', 'S = ?');
  await page.fill('#c-back', '넓이');
  await tap(page, '#card-form button[type=submit]');
  assert(await page.isVisible('#deck-voice'), '글자 카드를 더하면 말로 복습 단추가 다시 보임 (그림 카드는 말로 복습에서 빠짐)');

  console.log('6) 카드를 지우고 다시 받기');
  await page.evaluate(() => { App.store.update((s) => { s.cards = s.cards.filter((c) => !(c.fig === 'area/c-tan' || c.fig === 'area/f-tri')); }); });
  await tap(page, '#deck-back');
  assert(/받았어요/.test(await page.textContent('#pack-list')) && await page.isVisible('#pack-list [data-pack-open]') && /빠진 2장 받기/.test(await page.textContent('#pack-list [data-pack-add]')), '덱 목록: 덱 열기 · 빠진 2장 받기');
  await shot(page, 'f6-missing');
  await tap(page, '#pack-list [data-pack-add]');
  st = await state(page);
  assert(st.cards.filter((c) => c.fig).length === 10 && st.cards.length === 11 && (await page.evaluate(() => App.store.get().decks.filter((d) => d.pack === 'area').length)) === 1, '지운 2장만 다시 들어옴 (덱은 하나, 더한 글자 카드도 그대로)');
  await tap(page, '#deck-back');
  assert(!(await page.$('#pack-list [data-pack-add]')) && await page.isVisible('#pack-list [data-pack-open]'), '다 있으면 받기 단추 없음');
  await tap(page, '#pack-list [data-pack-open]');
  assert(await page.isVisible('#deck-detail') && /함수 넓이 공식/.test(await page.textContent('#deck-title')), '덱 열기');

  console.log('7) 다시 열어도 그대로 (저장)');
  await page.reload();
  await page.waitForFunction(() => window.App && window.Formulas);
  st = await state(page);
  assert(st.deck && st.cards.filter((c) => c.fig).length === 10, '다시 열어도 덱 · 그림 이름이 남음');

  console.log('8) 기능 끄기');
  await page.evaluate(() => App.store.update((s) => { s.settings.layout = { off: ['packs'] }; }));
  await page.evaluate(() => App.go('review'));
  await page.waitForTimeout(200);
  assert(!(await page.isVisible('#pack-panel')), '‘만들어 둔 공식 덱’을 끄면 칸이 숨음');
  await page.context().close();

  console.log('9) 다크 모드 · 다른 화면 크기');
  page = await open({ dark: true });
  await tap(page, '#pack-list [data-pack-add]');
  // 첫 장이 그림 있는 카드가 되게 섞지 않는다 (예전엔 setTimeout으로 바로 되돌려서 섞기가 그대로였고, 그림 없는 원리 카드가 먼저 나오면 실패했다)
  await page.evaluate(() => { window.__rnd = Math.random; Math.random = () => 0.999999; });
  await tap(page, '#deck-study');
  await page.evaluate(() => { Math.random = window.__rnd; });
  await tap(page, '#flash');
  const dk = await page.evaluate(() => { const p = document.querySelector('#flash-front .mf-curve'); return p ? getComputedStyle(p).stroke : ''; });
  assert(/rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)/.test(dk), '다크 모드: 그래프 선이 밝은색 (' + dk + ')');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'f7-dark');
  await page.context().close();

  for (const [w, h] of [[360, 740], [768, 1024], [800, 380]]) {
    page = await open({ w, h });
    await tap(page, '#pack-list [data-pack-add]');
    const ok1 = await noSideScroll(page);
    await tap(page, '#deck-poster');
    const sw = await page.evaluate(() => { const s = document.querySelector('.mf-poster-sheet'); const b = s.querySelector('.ui-sheet-body'); return { w: s.getBoundingClientRect().width, side: b.scrollWidth <= b.clientWidth + 1 }; });
    await shot(page, `f8-poster-${w}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await tap(page, '#deck-study');
    const ok2 = await noSideScroll(page);
    const figW = await page.$eval('#flash-front .mf-card-fig, #flash-front .mf-q', (e) => e.getBoundingClientRect().width);
    await shot(page, `f8-card-${w}`);
    assert(ok1 && ok2 && sw.side && sw.w <= 601 && figW > 100, `${w}×${h}: 옆으로 밀리지 않고, 한눈에 보기 폭 ${Math.round(sw.w)}px, 카드 그림 ${Math.round(figW)}px`);
    await page.context().close();
  }

  assert(errors.length === 0, '화면 오류 없음' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(`\n공식 카드: ${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
