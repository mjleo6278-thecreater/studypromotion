// v3.8 이스터에그 '벽 튕기기' (js/bounce.js): 비밀 단어로 열기, 막대 끌기, 끝·다시 하기, 사진 고르기·자르기(이 기기에만 저장), 뒤로·Esc, 가로 화면
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
// 시험용 사진: 앱 아이콘 (사람 사진은 저장소에 두지 않는다)
const PHOTO = { name: 'test.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(root, 'icons/icon-512.png')) };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const game = () => page.evaluate(() => { const g = Bounce.game; return { state: g.state, score: g.score, px: g.px, W: g.W, pw: g.pw, open: Bounce.isOpen(), face: Bounce.hasFace }; });
  const cardText = () => page.$eval('#bounce-card', (c) => (c.hidden ? '' : c.textContent));

  /* 1) 비밀 단어를 넣으면 게임 창이 열린다 */
  await page.goto(base + '#about');
  await page.waitForFunction(() => window.App && window.Bounce);
  assert(!(await page.$('#bounce')), '게임 창은 처음 열 때 만든다');
  await page.fill('#egg-input', '이강인');
  await page.press('#egg-input', 'Enter');
  await page.waitForSelector('#bounce:not([hidden])');
  let g = await game();
  assert(g.open && g.state === 'ready' && !g.face, '이강인 → 게임 창 (기본 공, 시작 전)');
  assert(await page.evaluate(() => document.body.classList.contains('bounce-open') && document.activeElement !== document.querySelector('#egg-input')), '뒤 화면은 안 움직이고, 비밀 단어 칸 키보드는 닫힘');
  assert(/벽 튕기기/.test(await cardText()) && /얼굴 사진 고르기/.test(await cardText()) && /이 기기에만/.test(await cardText()), '시작 안내: 하는 법, 사진 고르기, 기기에만 저장');
  assert(await page.$eval('#egg-out', (o) => o.classList.contains('hit') && !!o.querySelector('[data-egg-game]')), '비밀 칸에는 ‘게임 열기’ 단추가 남음');
  const box = await page.$eval('#bounce-stage', (s) => { const r = s.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  assert(box.w === 390 && box.h > 600, '게임 판이 화면을 거의 채움 (' + box.w + 'x' + Math.round(box.h) + ')');
  const cover = await page.evaluate(() => { const r = document.querySelector('#bounce').getBoundingClientRect(); const f = document.querySelector('.ai-fab'); return { full: r.width === innerWidth && r.height === innerHeight, fabHidden: !f || document.elementFromPoint(f.getBoundingClientRect().left + 5, f.getBoundingClientRect().top + 5).closest('#bounce') !== null }; });
  assert(cover.full && cover.fabHidden, '세컨드 둥근 버튼 등 앱 화면을 모두 덮음');

  /* 2) 시작 → 막대 끌기 */
  await page.tap('[data-b="start"]');
  g = await game();
  assert(g.state === 'play' && await page.$eval('#bounce-card', (c) => c.hidden), '시작하기 → 공이 날아감, 안내 카드 사라짐');
  await page.evaluate(() => { const b = Bounce.game.ball; b.vx = 0; b.vy = -1; b.x = Bounce.game.W / 2; b.y = Bounce.game.H / 2; }); // 시험 동안 공을 천천히
  await page.mouse.move(box.l + 40, box.t + box.h / 2);
  await page.mouse.down();
  await page.mouse.move(box.l + 60, box.t + box.h / 2, { steps: 4 });
  await page.waitForTimeout(250);
  g = await game();
  assert(Math.abs(g.px - Math.max(g.pw / 2, 60)) < 4, '왼쪽으로 끌면 막대가 따라옴 (' + Math.round(g.px) + ')');
  await page.mouse.move(box.l + 380, box.t + 200, { steps: 6 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  g = await game();
  assert(Math.abs(g.px - (g.W - g.pw / 2)) < 4, '오른쪽 끝까지 끌어도 막대는 판 안 (' + Math.round(g.px) + ')');

  /* 3) 받아 넘기기 점수, 놓치면 끝 → 최고 기록 */
  await page.evaluate(() => { const G = Bounce.game, b = G.ball; b.x = G.px; b.y = G.py - G.r - 20; b.vx = 0; b.vy = 400; });
  await page.waitForFunction(() => Bounce.game.score === 1);
  assert(await page.textContent('#bounce-score') === '1', '받아 넘기면 1점, 위 점수판에도');
  await page.evaluate(() => { const G = Bounce.game, b = G.ball; b.x = G.W * 0.1; b.y = G.py + 5; b.vx = 0; b.vy = 900; });
  await page.waitForFunction(() => Bounce.game.state === 'over');
  await page.waitForSelector('#bounce-card:not([hidden])');
  assert(/1점/.test(await cardText()) && /새 최고 기록/.test(await cardText()) && /다시 하기/.test(await cardText()), '놓치면 끝: 점수와 새 최고 기록 ' + await cardText());
  assert(await page.evaluate(() => localStorage.getItem('studypromotion.eggBest')) === '1' && await page.textContent('#bounce-best') === '1', '최고 기록은 이 기기에 저장');
  await page.tap('[data-b="again"]');
  g = await game();
  assert(g.state === 'play' && g.score === 0 && await page.textContent('#bounce-score') === '0', '다시 하기 → 0점부터');

  /* 4) 얼굴 사진 고르기 → 동그랗게 자르기 */
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('#bounce-photo')]);
  assert((await game()).state === 'pause', '사진을 고르는 동안 게임은 멈춤');
  assert(await chooser.element().evaluate((i) => i.accept === 'image/*'), '사진만 고르게 (accept=image/*)');
  await chooser.setFiles(PHOTO);
  await page.waitForSelector('#bounce-crop:not([hidden])');
  const c0 = await page.evaluate(() => { const z = Number(document.querySelector('#crop-zoom').value); const r = document.querySelector('#crop-canvas').getBoundingClientRect(); return { z, w: r.width, h: r.height, x: r.left, y: r.top }; });
  assert(c0.w === c0.h && c0.w >= 280 && c0.z > 20 && c0.z < 80, '자르기 창: 정사각형 판, 크기 막대 가운데쯤 (' + Math.round(c0.w) + ', ' + c0.z + ')');
  const ok0 = await page.$eval('#crop-ok', (b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  assert(ok0, '‘이 얼굴로 하기’ 단추가 화면 안');
  // 끌어서 옮기기
  await page.mouse.move(c0.x + c0.w / 2, c0.y + c0.h / 2);
  await page.mouse.down();
  await page.mouse.move(c0.x + c0.w / 2 + 40, c0.y + c0.h / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.$eval('#crop-zoom', (z) => { z.value = '70'; z.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.tap('#crop-ok');
  await page.waitForFunction(() => Bounce.hasFace);
  const saved = await page.evaluate(() => localStorage.getItem('studypromotion.eggBall') || '');
  assert(saved.startsWith('data:image/jpeg') && saved.length < 80000, '잘린 얼굴은 작은 사진 한 장으로 이 기기에 저장 (' + saved.length + '자)');
  assert(await page.evaluate(() => !JSON.stringify(App.store.get()).includes('data:image')), '공부 기록(동기화·백업되는 곳)에는 사진이 들어가지 않음');
  assert(await page.$eval('#bounce-crop', (c) => c.hidden) && /사진 바꾸기/.test(await cardText()) && /기본 공으로/.test(await cardText()) && (await game()).state === 'ready', '자른 뒤 시작 안내로 돌아옴 (사진 바꾸기·기본 공으로)');

  /* 5) 새로 열어도 얼굴 공이 남아 있음 → 기본 공으로 */
  await page.reload();
  await page.waitForFunction(() => window.App && window.Bounce);
  await page.goto(base + '#about');
  await page.fill('#egg-input', 'Lee Kang-in');
  await page.click('#egg-form button[type=submit]');
  await page.waitForFunction(() => Bounce.isOpen() && Bounce.hasFace);
  assert(true, '다시 열어도 고른 얼굴 공 그대로 (영어 이름으로도 열림)');
  await page.tap('[data-b="plain"]');
  assert(!(await game()).face && await page.evaluate(() => localStorage.getItem('studypromotion.eggBall')) === null && /얼굴 사진 고르기/.test(await cardText()), '기본 공으로 → 사진을 기기에서도 지움');

  /* 6) 휴대폰 뒤로·Esc: 자르기 창 → 게임 순서로 닫힘 */
  const [ch2] = await Promise.all([page.waitForEvent('filechooser'), page.tap('[data-b="photo"]')]);
  await ch2.setFiles(PHOTO);
  await page.waitForSelector('#bounce-crop:not([hidden])');
  await page.goBack();
  await page.waitForTimeout(300);
  assert(await page.$eval('#bounce-crop', (c) => c.hidden) && (await game()).open && !(await game()).face, '뒤로 → 자르기 창만 닫힘 (사진은 안 바뀜)');
  await page.goBack();
  await page.waitForTimeout(300);
  assert(!(await game()).open && await page.evaluate(() => App.view) === 'about' && !(await page.evaluate(() => document.body.classList.contains('bounce-open'))), '한 번 더 뒤로 → 게임이 닫히고 앱 소개 그대로');
  await page.tap('[data-egg-game]');
  assert((await game()).open, '‘게임 열기’로 다시 열기');
  await page.keyboard.press('Escape');
  assert(!(await game()).open, 'Esc로 닫기');

  /* 7) 가로 화면 (높이 380) */
  await page.setViewportSize({ width: 800, height: 380 });
  await page.tap('[data-egg-game]');
  const land = await page.evaluate(() => { const s = document.querySelector('#bounce-stage').getBoundingClientRect(); const c = document.querySelector('#bounce-card').getBoundingClientRect(); const b = document.querySelector('[data-b="start"]').getBoundingClientRect(); return { sw: s.width, sh: s.height, inCard: c.top >= s.top && c.bottom <= s.bottom, btn: b.bottom <= innerHeight }; });
  assert(land.sw <= 560 && land.sh > 250 && land.inCard && land.btn, '가로 화면: 판과 안내 카드가 화면 안 (' + land.sw + 'x' + Math.round(land.sh) + ')');
  const [ch3] = await Promise.all([page.waitForEvent('filechooser'), page.tap('[data-b="photo"]')]);
  await ch3.setFiles(PHOTO);
  await page.waitForSelector('#bounce-crop:not([hidden])');
  const landCrop = await page.evaluate(() => { const ok = document.querySelector('#crop-ok').getBoundingClientRect(); const cv = document.querySelector('#crop-canvas').getBoundingClientRect(); return { ok: ok.bottom <= innerHeight && ok.top >= 0, cv: cv.width >= 200 && cv.bottom <= innerHeight }; });
  assert(landCrop.ok && landCrop.cv, '가로 화면: 자르기 판과 단추가 한 화면에');
  await page.tap('#crop-cancel');
  await page.tap('#bounce-close');
  assert(!(await game()).open, '닫기 단추');

  assert(errors.length === 0, '콘솔 오류 없음 ' + errors.join(' | '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
