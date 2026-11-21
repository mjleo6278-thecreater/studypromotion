// 세컨드에게 사진 보내기 (v4.4): 카메라 단추, 앨범·사진 찍기, 사진 줄이기(사진 속 정보 지우기), 빠른 질문, 사진에서 읽은 글,
// 이어 묻기(사진 대신 읽은 글), 카드 30장, 다시 보내기, 기기에 남기는 것.
// 진짜 AI 대신 테스트가 정해 준 답을 돌려주는 가짜(window.AIMock)를 쓴다. 가짜가 받은 말(사진 포함)을 그대로 살펴본다.
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
  async function open(opts) {
    opts = opts || {};
    const ctx = opts.ctx || await browser.newContext(Object.assign({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, locale: 'ko-KR' }, opts.extra || {}));
    if (!opts.ctx) {
      await ctx.addInitScript((photo) => {
        try { localStorage.setItem('studypromotion.welcomeClosed', '1'); } catch (e) { /* 무시 */ }
        window.__replies = [];
        window.__calls = [];
        window.AIMock = {
          photo,
          async ask(messages, o) {
            window.__calls.push(JSON.parse(JSON.stringify(messages)));
            const r = window.__replies.shift();
            await new Promise((ok) => setTimeout(ok, 30));
            if (r && r.fail) throw Object.assign(new Error(r.fail), { aiCode: r.fail });
            const text = String(r == null ? '' : r);
            for (let i = 1; i <= 4; i++) { o.onText(text.slice(0, Math.ceil(text.length * i / 4))); await new Promise((ok) => setTimeout(ok, 20)); }
            return { text, left: 50 - window.__calls.length };
          },
        };
      }, opts.photo !== false);
    }
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    await page.waitForFunction(() => window.App && window.AICore && window.AI);
    await page.click('#ai-fab');
    await page.waitForTimeout(350);
    return page;
  }
  // 브라우저 안에서 사진 파일을 만들어 고른 것처럼 넣는다. exif: JPEG 앞에 사진 속 정보(위치 등) 조각을 끼워 넣는다
  const pick = (page, o) => page.evaluate(async (o) => {
    const c = document.createElement('canvas');
    c.width = o.w; c.height = o.h;
    const g = c.getContext('2d');
    for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${i * 37},70%,${30 + (i % 5) * 10}%)`; g.fillRect((i * 97) % o.w, (i * 53) % o.h, o.w / 5, o.h / 7); }
    g.fillStyle = '#000'; g.font = '80px serif'; g.fillText('Ojalá que no llueva', 40, o.h / 2);
    let blob = await new Promise((ok) => c.toBlob(ok, o.type || 'image/jpeg', 0.9));
    if (o.exif) {
      const b = new Uint8Array(await blob.arrayBuffer());
      const tag = new TextEncoder().encode('Exif\0\0GPSLatitude=37.5665 SECRET-PLACE');
      const seg = new Uint8Array(4 + tag.length);
      seg.set([0xff, 0xe1, ((tag.length + 2) >> 8) & 255, (tag.length + 2) & 255]); seg.set(tag, 4);
      blob = new Blob([b.slice(0, 2), seg, b.slice(2)], { type: 'image/jpeg' });
    }
    const file = new File([blob], o.name || 'photo.jpg', { type: o.fileType || blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector(o.cam ? '#ai-cam' : '#ai-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return file.size;
  }, o);
  const waitAtt = (page) => page.waitForSelector('#ai-att:not([hidden]) .ai-att-th img');
  const done = (page) => page.waitForFunction(() => !AI.busy).then(() => page.waitForTimeout(80));
  const calls = (page) => page.evaluate(() => window.__calls);
  const reply = (page, ...r) => page.evaluate((r) => { window.__replies.push(...r); }, r);
  const lastAI = (page) => page.locator('#ai-log .ai-msg.ai').last();
  // data: 주소의 사진을 읽어 크기와 바이트 안에 든 글자를 알려 준다
  const inspect = (page, url) => page.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const bin = atob(url.split(',')[1]);
    return { w: img.naturalWidth, h: img.naturalHeight, type: url.slice(5, url.indexOf(';')), secret: bin.includes('SECRET-PLACE') || bin.includes('GPSLatitude'), chars: url.length };
  }, url);

  /* ===== 1) 카메라 단추와 앨범·사진 찍기 ===== */
  let page = await open();
  assert(await page.isVisible('#ai-photo') && await page.isHidden('#ai-pmenu'), '입력 칸 왼쪽에 카메라 단추, 처음엔 사진 줄이 닫혀 있음');
  assert((await page.getAttribute('#ai-input', 'placeholder')) === '물어보거나 시켜 보세요', '카메라 단추가 있으면 입력 칸 안내를 짧게');
  assert((await page.locator('#ai-log [data-photo-eg]').count()) === 2 && /사진으로 묻기/.test(await page.textContent('#ai-log')), "빈 화면 예시에 '사진으로 묻기'");
  await page.tap('#ai-photo');
  assert(await page.isVisible('#ai-pmenu') && await page.isVisible('[data-pick="album"]') && await page.isVisible('[data-pick="camera"]') && (await page.getAttribute('#ai-photo', 'aria-expanded')) === 'true', '누르면 앨범에서 고르기·사진 찍기');
  assert(/서버에는 남기지 않아요/.test(await page.textContent('#ai-pmenu')), '사진은 서버에 남기지 않는다는 안내');
  assert((await page.getAttribute('#ai-cam', 'capture')) === 'environment' && (await page.getAttribute('#ai-file', 'accept')) === 'image/*', '사진 찍기는 뒤 카메라, 고르기는 사진 파일만');
  await page.tap('#ai-photo');
  assert(await page.isHidden('#ai-pmenu'), '다시 누르면 닫힘');
  // 사진 예시를 누르면 질문을 적어 두고 사진 줄을 연다
  await page.tap('[data-photo-eg="카드로 만들어 줘"]');
  assert(await page.isVisible('#ai-pmenu') && (await page.inputValue('#ai-input')) === '카드로 만들어 줘', '사진 예시: 질문을 적어 두고 사진 고르기를 연다');
  await page.fill('#ai-input', '');

  /* ===== 2) 사진 고르기: 줄이고, 사진 속 정보는 지운다 ===== */
  const size = await pick(page, { w: 4000, h: 3000, exif: true });
  await waitAtt(page);
  assert(await page.isHidden('#ai-pmenu') && (await page.locator('#ai-att .chip').allTextContents()).join('|') === '해석해 줘|단어 뜻 알려 줘|카드로 만들어 줘|풀이 힌트만 줘', '고르면 사진 줄이 닫히고 입력 칸 위에 사진과 빠른 질문 네 개');
  assert((await page.getAttribute('#ai-input', 'placeholder')) === '사진에 대해 물어보세요', '사진이 붙으면 입력 칸 안내가 바뀜');
  const thumbBox = await page.locator('#ai-att .ai-att-th img').boundingBox();
  assert(thumbBox.width === 62 && thumbBox.height === 62, '보낼 사진은 작은 네모로 보임');
  await page.tap('[data-att-x]');
  assert(await page.isHidden('#ai-att') && (await page.getAttribute('#ai-input', 'placeholder')) === '물어보거나 시켜 보세요', '× 로 사진을 뺄 수 있음');
  await pick(page, { w: 4000, h: 3000, exif: true, cam: true });
  await waitAtt(page);
  assert(await page.isVisible('#ai-att'), '사진 찍기로 찍은 사진도 붙음');

  await reply(page, '<read>1. Ojalá que no llueva mañana.\n4. Aunque esté cansado, seguiré estudiando.\nel paraguas · la nube</read>\n**뜻**\n피곤하더라도 계속 공부할 거야.\n\n**구문 풀이**\n- **Aunque esté cansado**: ~하더라도');
  await page.tap('#ai-att [data-chip="해석해 줘"]');
  await page.waitForFunction(() => document.querySelector('#ai-log .ai-msg.ai .ai-state') || !AI.busy);
  await done(page);
  let c = await calls(page);
  const q = c[0][c[0].length - 1];
  assert(Array.isArray(q.content) && q.content.length === 2 && q.content[0].type === 'image_url' && q.content[1].type === 'text' && q.content[1].text === '해석해 줘', '빠른 질문을 누르면 [사진, 글]로 바로 보냄');
  assert(c[0].filter((m) => Array.isArray(m.content)).length === 1 && c[0][0].content.includes('[사진]') && c[0][0].content.includes('<read>'), '사진은 이번 질문에만, 지시문에 사진 규칙');
  assert(!c[0][0].content.includes('[앱 정보]'), '해석 질문은 앱 정보 없이 짧게');
  const sent = await inspect(page, q.content[0].image_url.url);
  assert(sent.type === 'image/jpeg' && sent.w === 1280 && sent.h === 960, `긴 변 1280픽셀 JPEG로 줄여서 보냄 (${sent.w}x${sent.h}, 원본 ${Math.round(size / 1024)}KB → ${Math.round(sent.chars * 0.75 / 1024)}KB)`);
  assert(!sent.secret, '사진 속 정보(위치 등)는 다시 그리면서 지워짐');
  assert(await page.isHidden('#ai-att') && await page.isVisible('#ai-log .ai-msg.me img.ai-shot') && /해석해 줘/.test(await page.textContent('#ai-log .ai-msg.me .ai-bubble')), '내 말에 보낸 사진과 질문이 보이고, 사진 줄은 비워짐');
  const read = lastAI(page).locator('details.ai-read');
  assert(await read.isVisible() && !(await read.evaluate((d) => d.open)) && (await read.locator('summary').textContent()) === '사진에서 읽은 글', '사진에서 읽은 글은 접혀 있음');
  await read.locator('summary').tap();
  assert(/Aunque esté cansado, seguiré estudiando/.test(await read.locator('p').textContent()), '펼치면 읽은 글이 보임');
  assert(/^뜻/.test((await lastAI(page).locator('.ai-text').textContent()).trim()) && !/<read>|Ojalá que no llueva mañana/.test(await lastAI(page).locator('.ai-text').innerHTML()), '답에는 읽은 글 꼬리표가 섞이지 않음');
  assert((await page.textContent('#ai-left')) === '오늘 49번 남음', '사진 질문도 한 번으로 셈');

  /* ===== 3) 이어 묻기: 사진은 다시 보내지 않고 읽은 글로 ===== */
  const cards = Array.from({ length: 8 }, (_, i) => ({ front: 'palabra ' + (i + 1), back: '단어 ' + (i + 1) }));
  await reply(page, '사진의 단어 8개로 카드를 만들었어요.\n<cards>' + JSON.stringify(cards) + '</cards>');
  await page.fill('#ai-input', '단어도 카드로 만들어 줘');
  await page.tap('#ai-send');
  await done(page);
  c = await calls(page);
  const second = c[1];
  assert(second.every((m) => typeof m.content === 'string'), '이어지는 질문에는 사진을 다시 보내지 않음');
  assert(second[1].content === '[사진을 붙여 보냄]\n해석해 줘' && second[2].content.startsWith('<read>1. Ojalá que no llueva mañana.') && second[2].content.includes('</read>\n**뜻**'), '앞의 사진 질문은 읽은 글(<read>)로 대신 보냄');
  assert(/지난 대화의 <read>/.test(second[0].content) && !second[0].content.includes('[앱 정보]'), "지시문에 '지난 읽은 글을 보고 답하라'를 붙이고, 카드 만들기는 앱 정보 없이");
  assert((await lastAI(page).locator('.ai-cardlist li').count()) === 8 && (await lastAI(page).locator('[data-card="all"]').textContent()) === '8장 모두 저장', '카드 후보가 다섯 장을 넘어도 모두 보임');
  await lastAI(page).locator('[data-card="all"]').tap();
  await page.waitForTimeout(250); // 덱이 없으면 묻지 않고 '표현 모음' 덱을 만든다
  assert((await page.evaluate(() => App.store.get().cards.filter((x) => /^palabra/.test(x.front)).length)) === 8, '한 번에 복습 카드 8장 저장');

  /* ===== 4) 기기에 남는 것: 작은 그림만 ===== */
  const kept = await page.evaluate(() => {
    const raw = localStorage.getItem('studypromotion.ai'), s = JSON.parse(raw);
    const me = s.msgs.find((m) => m.photo);
    return { len: raw.length, img: me && me.img ? me.img.length : 0, read: (s.msgs.find((m) => m.read) || {}).read || '' };
  });
  const thumbInfo = await inspect(page, await page.getAttribute('#ai-log .ai-msg.me img.ai-shot', 'src'));
  assert(kept.img > 0 && kept.img < 40000 && kept.len < 60000 && Math.max(thumbInfo.w, thumbInfo.h) === 240 && !thumbInfo.secret, `기기에는 작은 그림(긴 변 240픽셀, ${Math.round(kept.img / 1024)}KB)만 남기고 보낸 사진은 남기지 않음`);
  assert(/seguiré estudiando/.test(kept.read), '읽은 글은 대화와 함께 남음 (다시 열어도 이어 묻기)');

  /* ===== 5) 답을 못 받으면: 다시 보내기에 사진도 같이, 앱을 다시 열었으면 사진을 다시 고르게 ===== */
  await pick(page, { w: 900, h: 1200 });
  await waitAtt(page);
  await reply(page, { fail: 'server' });
  await page.fill('#ai-input', '3번 문제 힌트');
  await page.tap('#ai-send');
  await done(page);
  assert(await lastAI(page).locator('[data-retry]').isVisible(), '답을 못 받으면 다시 보내기');
  await reply(page, '<read>3. ¿Qué tiempo hace hoy?</read>\n날씨를 묻는 표현이에요.');
  await lastAI(page).locator('[data-retry]').tap();
  await done(page);
  c = await calls(page);
  let lastQ = c[c.length - 1][c[c.length - 1].length - 1];
  assert(Array.isArray(lastQ.content) && lastQ.content[0].type === 'image_url' && lastQ.content[1].text === '3번 문제 힌트' && (await inspect(page, lastQ.content[0].image_url.url)).h === 1200, '다시 보내기에도 같은 사진을 붙임 (1280픽셀보다 작은 사진은 크기 그대로)');
  // 사진이 붙은 채 실패 → 앱을 다시 열고 다시 보내기
  await pick(page, { w: 1000, h: 800 });
  await waitAtt(page);
  await reply(page, { fail: 'offline' });
  await page.tap('#ai-att [data-chip="단어 뜻 알려 줘"]');
  await done(page);
  await page.reload();
  await page.waitForFunction(() => window.AI);
  await page.tap('#ai-fab');
  await page.waitForTimeout(350);
  const before = (await calls(page)).length;
  await lastAI(page).locator('[data-retry]').tap();
  await page.waitForTimeout(200);
  assert((await calls(page)).length === before && await page.isVisible('#ai-pmenu') && (await page.inputValue('#ai-input')) === '단어 뜻 알려 줘' && /사진을 다시 골라 주세요/.test(await page.textContent('#toast')), '앱을 다시 열어 사진이 없으면 질문을 되돌리고 사진을 다시 고르게 함');
  assert(await page.isVisible('#ai-log .ai-msg.me img.ai-shot'), '다시 열어도 보낸 사진의 작은 그림은 보임');
  await page.tap('#ai-photo');

  /* ===== 6) 사진만 보내기, 사진이 아닌 파일, 붙여 넣기 ===== */
  await pick(page, { w: 600, h: 600, type: 'image/png', name: 'a.png' });
  await waitAtt(page);
  await reply(page, '<read>사진 속 글</read>풀이예요.');
  await page.fill('#ai-input', '');
  await page.tap('#ai-send');
  await done(page);
  c = await calls(page);
  lastQ = c[c.length - 1][c[c.length - 1].length - 1];
  assert(lastQ.content[1].text === '이 사진을 풀이해 줘' && lastQ.content[0].image_url.url.startsWith('data:image/jpeg;base64,'), '글 없이 사진만 보내면 "이 사진을 풀이해 줘" (PNG도 JPEG로 바꿔 보냄)');
  await pick(page, { w: 10, h: 10, fileType: 'application/pdf', name: 'a.pdf' });
  await page.waitForTimeout(200);
  assert(await page.isHidden('#ai-att') && /사진 파일만/.test(await page.textContent('#toast')), '사진이 아닌 파일은 받지 않음');
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    c.getContext('2d').fillRect(0, 0, 100, 100);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'paste.png', { type: 'image/png' }));
    document.querySelector('#ai-input').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await waitAtt(page);
  assert(await page.isVisible('#ai-att'), '복사한 사진을 입력 칸에 붙여 넣어도 붙음');
  await page.tap('[data-att-x]');

  /* ===== 7) 새 대화로 지우면 사진도 ===== */
  await pick(page, { w: 500, h: 500 });
  await waitAtt(page);
  await page.evaluate(() => AI.clear());
  assert(await page.isHidden('#ai-att') && (await page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.ai')).msgs.length)) === 0, '모든 대화 지우기: 붙여 둔 사진과 대화 모두 지움');
  await page.context().close();

  /* ===== 8) 가로 화면에서도 사진 줄과 입력 칸이 보인다 ===== */
  page = await open({ extra: { viewport: { width: 800, height: 380 } } });
  await page.tap('#ai-photo');
  await pick(page, { w: 1200, h: 900 });
  await waitAtt(page);
  const fits = await page.evaluate(() => ['#ai-att', '#ai-form', '#ai-send'].every((s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 0; }) && document.documentElement.scrollWidth <= innerWidth);
  assert(fits, '가로 화면(800x380)에서도 보낼 사진·빠른 질문·입력 칸이 화면 안에');
  await page.context().close();

  /* ===== 9) 넓은 화면(마우스): 찍기 없이 '사진 고르기' 하나 ===== */
  page = await open({ extra: { viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false } });
  await page.click('#ai-photo');
  assert(await page.isVisible('[data-pick="album"]') && await page.isHidden('[data-pick="camera"]') && (await page.textContent('[data-pick="album"] span')) === '사진 고르기', "넓은 화면은 '사진 고르기' 하나");
  await page.context().close();

  /* ===== 10) 사진을 열지 않은 경우: 단추도 예시도 없다 ===== */
  page = await open({ photo: false });
  assert(await page.isHidden('#ai-photo') && (await page.locator('#ai-log [data-photo-eg]').count()) === 0 && (await page.getAttribute('#ai-input', 'placeholder')) === '모르는 표현을 묻거나 할 일을 말해 보세요', '사진을 쓸 수 없으면 카메라 단추·사진 예시가 없고 예전 그대로');
  await page.context().close();

  assert(errors.length === 0, '오류 없음' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
