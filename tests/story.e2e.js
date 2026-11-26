// 업데이트 이야기(컷씬)를 앱에 넣은 것 (js/story.js + cutscene/?embed): 배포본(dist/web)을 띄워 끝까지 눌러 본다
//  - 업데이트한 사람: 처음 열 때 한 번 저절로 → 닫기 → 다시 열어도 안 뜸
//  - 새로 설치한 사람: 저절로 안 뜸, 업데이트 소식 4.5 칸의 단추로 봄
//  - 끝 화면 '말로 복습 해 보기' → 덱 열고 말로 복습 시작 창 / 말로 복습을 끈 사람은 단추 없음
//  - 뒤로 가기·Esc로 닫힘, 오프라인에서도 열림, 한 파일 버전에서는 단추가 숨음
// 실행: node tests/story.e2e.js   (SHOTS=폴더 를 주면 폰 화면을 찍어 둔다)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const repo = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(repo, 'tools/build.js')], { stdio: 'ignore' });
const root = path.join(repo, 'dist/web');
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

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: SHOTS ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript((prev) => {
      try {
        localStorage.setItem('studypromotion.welcomeClosed', '1');
        // 업데이트한 사람 흉내: 지난번에 연 버전이 남아 있다 (처음 한 번만 넣는다)
        if (prev && !sessionStorage.getItem('t.seeded')) { localStorage.setItem('studypromotion.appVersion', prev); sessionStorage.setItem('t.seeded', '1'); }
      } catch (e) { /* 무시 */ }
    }, o.prev || null);
    await page.goto(base + (o.hash || '#home'));
    await page.waitForFunction(() => window.App && window.Story);
    return { ctx, page };
  }
  const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name) }); } };
  const frameOf = async (page) => {
    const el = await page.waitForSelector('.story.in iframe');
    const f = await el.contentFrame();
    await f.waitForFunction(() => window.Cutscene && document.fonts.status === 'loaded');
    return f;
  };
  const hit = (f, id) => f.click(`.hit[data-id="${id}"]`);

  // 1) 새로 설치한 사람: 저절로 안 뜸
  {
    const { ctx, page } = await open();
    await page.waitForTimeout(2500);
    assert(!(await page.$('.story')), '새로 설치: 이야기가 저절로 뜨지 않음');
    assert((await page.evaluate(() => Story.seen())).includes('shower-1'), '새로 설치: 본 것으로 적어 둠 (다음에 열어도 안 뜸)');
    await page.reload();
    await page.waitForTimeout(2000);
    assert(!(await page.$('.story')), '새로 설치 뒤 다시 열어도 안 뜸');
    // 업데이트 소식 4.5 칸의 단추로는 볼 수 있다
    await page.evaluate(() => { App.go('about'); const t = document.querySelector('#ver-tabs [data-ver-tab="4.5"]'); if (t) t.click(); }); // 이야기 단추는 4.5 칸에 (4.5.1부터는 눌러서 연다)
    await page.waitForSelector('[data-ver="4.5"] .ver-story:not([hidden]) [data-story="shower-1"]');
    assert(true, '업데이트 소식 4.5 칸에 업데이트 이야기 보기 단추');
    await page.evaluate(() => document.querySelector('#news-panel').scrollIntoView({ block: 'start' }));
    await shot(page, 'app-news-button.png');
    await ctx.close();
  }

  // 2) 업데이트한 사람(4.4.1 → 4.5): 처음 열 때 한 번
  {
    const { ctx, page } = await open({ prev: '4.4.1' });
    const f = await frameOf(page);
    assert(/[?&]embed\b/.test(f.url()) && !/try=0/.test(f.url()), '업데이트하고 처음 열면 이야기가 화면 전체로 뜸 (' + f.url().replace(base, '') + ')');
    const st = await f.evaluate(() => window.Cutscene.state());
    assert(st.buttons.includes('close') && st.buttons.includes('sound') && !st.buttons.includes('skip') && !st.playing, '시작 전: 소리 · 닫기 단추, 재생은 누를 때까지 기다림');
    assert(await page.evaluate(() => document.querySelector('meta[name=theme-color]').content) === '#16181d', '폰 상단 바도 무대 색');
    assert(await page.evaluate(() => [...document.body.children].filter((e) => !e.classList.contains('story') && e.id !== 'toast').every((e) => e.inert)), '뒤의 앱은 눌리지 않음 (inert)');
    await shot(page, 'app-story-auto.png');
    // 누르면 재생 → 건너뛰기 → 끝 화면
    await f.click('#start');
    await f.waitForFunction(() => window.Cutscene.state().playing);
    assert((await f.evaluate(() => window.Cutscene.state().buttons)).includes('skip'), '재생 중에는 건너뛰기');
    await hit(f, 'skip');
    await f.waitForFunction(() => { const b = window.Cutscene.state().buttons; return b.includes('try') && b.includes('replay') && b.includes('close'); }, null, { timeout: 5000 });
    assert(true, '끝 화면: 말로 복습 해 보기 · 다시 보기 · 닫기');
    await page.waitForTimeout(600);
    await shot(page, 'app-story-end.png');
    // 단추가 손가락 크기(44px 이상)이고 서로 겹치지 않음
    const boxes = await f.$$eval('.hit', (l) => l.map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height }; }));
    assert(boxes.every((b) => b.w >= 44 && b.h >= 44), '단추 크기 44px 이상 ' + JSON.stringify(boxes.map((b) => [b.id, Math.round(b.w), Math.round(b.h)])));
    const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert(boxes.every((a, i) => boxes.every((b, j) => i === j || !over(a, b))), '단추끼리 겹치지 않음');
    await hit(f, 'close');
    await page.waitForFunction(() => !document.querySelector('.story'));
    assert(await page.evaluate(() => [...document.body.children].every((e) => !e.inert)), '닫으면 앱이 다시 눌림');
    assert(await page.evaluate(() => document.querySelector('meta[name=theme-color]').content) !== '#16181d', '상단 바 색도 돌아옴');
    await page.reload();
    await page.waitForTimeout(2500);
    assert(!(await page.$('.story')), '한 번 본 뒤에는 다시 열어도 안 뜸');
    await ctx.close();
  }

  // 3) 끝 화면 '말로 복습 해 보기' → 오늘 복습할 카드가 가장 많은 덱의 말로 복습 시작 창
  {
    const { ctx, page } = await open({ hash: '#about' });
    await page.evaluate(() => {
      const tab = document.querySelector('#ver-tabs [data-ver-tab="4.5"]'); if (tab) tab.click(); // 이야기 단추는 4.5 칸에
      const t = Date.now();
      App.store.update((st) => {
        st.decks = [{ id: 'few', name: '스페인어 3과', createdAt: t }, { id: 'many', name: '영어 시험 단어', createdAt: t }];
        st.cards = [['comer', '먹다']].map(([f, b], i) => SRS.newCard({ id: 's' + i, deckId: 'few', front: f, back: b, createdAt: t }, t))
          .concat([['distress', '고통'], ['secure', '확보하다'], ['referent', '지시 대상']].map(([f, b], i) => SRS.newCard({ id: 'e' + i, deckId: 'many', front: f, back: b, createdAt: t }, t)));
      });
    });
    await page.click('[data-story="shower-1"]');
    let f = await frameOf(page);
    await f.evaluate(() => window.Cutscene.renderAt(31));
    await hit(f, 'try');
    await page.waitForFunction(() => !document.querySelector('.story'));
    await page.waitForSelector('[data-vs-start]', { state: 'visible', timeout: 5000 });
    assert(await page.evaluate(() => App.view === 'review' && App.review.deckId() === 'many'), '말로 복습 해 보기 → 카드가 많은 덱을 열고 말로 복습 시작 창');
    await shot(page, 'app-story-try.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // 뒤로 가기로 닫힘 (앱은 그대로)
    await page.evaluate(() => { App.go('about'); const t = document.querySelector('#ver-tabs [data-ver-tab="4.5"]'); if (t) t.click(); }); // 이야기 단추는 4.5 칸에 (4.5.1부터는 눌러서 연다)
    await page.click('[data-story="shower-1"]');
    await frameOf(page);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.story'), null, { timeout: 3000 });
    assert(await page.evaluate(() => App.view === 'about'), '폰의 뒤로 가기: 이야기만 닫히고 앱은 그 화면 그대로');
    // Esc로 닫힘 (iframe 안에 초점이 있어도)
    await page.click('[data-story="shower-1"]');
    f = await frameOf(page);
    await f.focus('#start');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.story'), null, { timeout: 3000 });
    assert(true, 'Esc로 닫힘');
    // 말로 복습을 끈 사람: 끝 화면에 '말로 복습 해 보기' 없음
    await page.evaluate(() => Features.set('voice', false));
    await page.evaluate(() => { App.go('about'); const t = document.querySelector('#ver-tabs [data-ver-tab="4.5"]'); if (t) t.click(); }); // 이야기 단추는 4.5 칸에 (4.5.1부터는 눌러서 연다)
    await page.click('[data-story="shower-1"]');
    f = await frameOf(page);
    assert(/try=0/.test(f.url()), '말로 복습을 끄면 try=0');
    const b = (await f.evaluate(() => window.Cutscene.renderAt(31))).buttons;
    assert(b.includes('replay') && !b.includes('try'), '말로 복습을 끄면 끝 화면에 다시 보기만 ' + JSON.stringify(b));
    await hit(f, 'close');
    await page.waitForFunction(() => !document.querySelector('.story'));
    // 오프라인에서도 (서비스 워커가 컷씬 파일도 저장해 둠)
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find((k) => /^studypromotion-v/.test(k))); return (await c.keys()).map((r) => new URL(r.url).pathname).filter((p) => p.includes('/cutscene/')); });
    assert(cached.length === 9, '서비스 워커가 컷씬 파일 9개를 저장 ' + JSON.stringify(cached));
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.App && window.Story);
    await page.evaluate(() => { App.go('about'); const t = document.querySelector('#ver-tabs [data-ver-tab="4.5"]'); if (t) t.click(); }); // 이야기 단추는 4.5 칸에 (4.5.1부터는 눌러서 연다)
    await page.click('[data-story="shower-1"]');
    f = await frameOf(page);
    const stats = await f.evaluate(() => window.Cutscene.renderAt(10).stats);
    assert(stats && stats.calls > 20 && stats.tris > 1000, '오프라인에서도 이야기가 그려짐 (그리기 ' + JSON.stringify(stats) + ')');
    await ctx.setOffline(false);
    await ctx.close();
  }

  // 4) 타이머가 도는 중에는 저절로 띄우지 않음
  {
    const { ctx, page } = await open({ prev: '4.4.1', hash: '#timer' });
    // 첫 시도(0.9초 뒤) 전에 타이머 시작
    await page.click('#timer-start');
    await page.waitForTimeout(2500);
    const shown = !!(await page.$('.story'));
    assert(!shown, '타이머 도는 중에는 업데이트 이야기를 띄우지 않음');
    assert(!(await page.evaluate(() => Story.seen())).includes('shower-1'), '못 보여 준 것은 본 것으로 치지 않음');
    await ctx.close();
  }

  // 5) 한 파일 버전(dist/studypromotion.html): 컷씬 파일이 없으니 단추도 숨고 저절로도 안 뜸
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('한 파일: ' + e.message));
    await page.addInitScript(() => { try { localStorage.setItem('studypromotion.appVersion', '4.4.1'); localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ } });
    await page.goto('file://' + path.join(repo, 'dist/studypromotion.html') + '#about');
    await page.waitForFunction(() => window.App && window.Story);
    await page.waitForTimeout(2000);
    assert(!(await page.$('.story')) && await page.$eval('[data-ver="4.5"] .ver-story', (p) => p.hidden), '한 파일 버전: 단추 숨김 · 저절로 안 뜸');
    await ctx.close();
  }

  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
