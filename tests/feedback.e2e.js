// 다듬기 테스트: 플래시카드 고치기, 타이머 시간 빠른 선택, 공부 달력, 기간별 과목 시간, 끝난 시험 정리, 하단 아이콘
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
const dayKey = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// 베타테스트 피드백 (v2.6): 왼쪽 위 이름 → 홈, 핑크 테마, 이스터에그, 자동 백업·기록 지키기
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
  const toastText = () => page.$eval('#toast', (t) => t.textContent);
  const accentNow = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

  // 1) 왼쪽 위 '스터디 프로모션'을 누르면 홈으로
  await page.goto(base + '#stats');
  assert(await page.$eval('#view-stats', (v) => v.classList.contains('active')), '통계 화면에서 시작');
  await page.click('.topbar .brand');
  assert(await page.$eval('#view-home', (v) => v.classList.contains('active')), '이름을 누르면 홈 화면');
  assert(new URL(page.url()).hash === '#home', '주소도 #home');
  await page.goto(base + '#about');
  await page.click('.topbar .brand');
  assert(await page.$eval('#view-home', (v) => v.classList.contains('active')), '앱 소개에서도 홈으로');

  // 2) 핑크 테마
  assert(await accentNow() === '#04becd', '기본은 청록 블루');
  await page.goto(base + '#account');
  await page.click('[data-accent-pick="pink"]');
  assert(await page.evaluate(() => document.documentElement.dataset.accent) === 'pink', '핑크를 고르면 data-accent=pink');
  assert(await accentNow() === '#ff3d8b', '포인트 색이 핑크');
  assert((await toastText()).includes('핑크'), '테마 색 알림');
  assert(await page.$eval('[data-accent-pick="pink"]', (b) => b.getAttribute('aria-checked')) === 'true', '핑크가 선택됨으로 표시');
  await page.reload();
  assert(await page.evaluate(() => document.documentElement.dataset.accent) === 'pink', '다시 열어도 핑크 유지');
  assert(await page.$eval('[data-accent-pick="pink"]', (b) => b.classList.contains('active')), '다시 열어도 핑크 버튼 선택');
  // 어두운 화면에서도 핑크
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  assert(await accentNow() === '#ff3d8b', '어두운 화면에서도 핑크');
  assert(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim()) === '#ff78ae', '어두운 화면 글자용 핑크');
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await page.click('[data-accent-pick="teal"]');
  assert(await page.evaluate(() => !document.documentElement.hasAttribute('data-accent')), '청록으로 되돌리기');
  assert(await accentNow() === '#04becd', '포인트 색이 다시 청록');

  // 3) 이스터에그 (실제 이름은 저장소에 남기지 않으려고 테스트용 단어를 잠시 넣는다)
  await page.goto(base + '#about');
  await page.evaluate(() => { const E = App.egg; E.KEYS[E.key('테스트이름')] = 'a'; E.KEYS[E.key('다른이름')] = 'b'; E.KEYS[E.key('만든이')] = 'c'; E.KEYS[E.key('아이디어님')] = 'd'; E.KEYS[E.key('게임아이디어')] = 'e'; });
  await page.fill('#egg-input', '홍길동');
  await page.click('#egg-form button');
  assert(await page.$eval('#egg-out', (o) => !o.hidden && o.classList.contains('miss')), '모르는 단어는 아무 일도 없음');
  await page.fill('#egg-input', '테스트 이름님');
  await page.press('#egg-input', 'Enter');
  let egg = await page.$eval('#egg-out', (o) => ({ hit: o.classList.contains('hit'), text: o.textContent }));
  assert(egg.hit && egg.text.includes('테스트 이름님, 고마워요') && egg.text.includes('핑크 테마'), '이름을 넣으면 반영된 피드백이 나타남');
  await page.fill('#egg-input', '다른이름');
  await page.press('#egg-input', 'Enter');
  egg = await page.$eval('#egg-out', (o) => o.textContent);
  assert(egg.includes('홈으로'), '다른 사람 이름이면 그 사람 피드백');
  await page.fill('#egg-input', '아이디어님');
  await page.press('#egg-input', 'Enter');
  egg = await page.$eval('#egg-out', (o) => ({ hit: o.classList.contains('hit'), text: o.textContent }));
  assert(egg.hit && egg.text.includes('아이디어님, 고마워요') && egg.text.includes('아이디어가 이렇게 들어갔어요') && egg.text.includes('그룹 스터디') && egg.text.includes('v4.0') && !egg.text.includes('베타테스트'), '아이디어를 준 사람 → 아이디어 몫으로 보임');
  await page.fill('#egg-input', '게임아이디어');
  await page.press('#egg-input', 'Enter');
  egg = await page.$eval('#egg-out', (o) => ({ text: o.textContent, game: o.classList.contains('egg-game') }));
  assert(egg.text.includes('벽 튕기기') && egg.text.includes('v3.8') && !egg.game && await page.evaluate(() => !document.querySelector('.bounce:not([hidden]), #bounce:not([hidden])')), '게임 아이디어를 준 사람은 게임이 열리지 않고 고마움 칸');
  await page.fill('#egg-input', '<b>만든이</b>');
  await page.press('#egg-input', 'Enter');
  assert(await page.$eval('#egg-out', (o) => o.classList.contains('miss')), '태그가 섞인 입력은 통과하지 않음');
  await page.fill('#egg-input', '만든이');
  await page.press('#egg-input', 'Enter');
  egg = await page.$eval('#egg-out', (o) => o.textContent);
  assert(egg.includes('만든 사람') && egg.includes('기록 지키기'), '만든 사람 이스터에그');
  assert(await page.$$eval('#egg-out .pt-sq', (s) => s.length) === 8, '퀸으로 승급한 체스 칸');

  // 3-1) 치이카와를 넣으면 함께 공부하는 영상 (v3.4). 유튜브는 테스트에서 실제로 부르지 않는다.
  await page.route(/youtube(-nocookie)?\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }));
  await page.fill('#egg-input', '치이카와');
  await page.press('#egg-input', 'Enter');
  let vid = await page.$eval('#egg-out', (o) => {
    const f = o.querySelector('.egg-player iframe');
    const a = o.querySelector('.egg-video-foot a');
    return { hit: o.classList.contains('hit') && o.classList.contains('egg-video'), text: o.textContent, src: f && f.src, allow: f && f.getAttribute('allow'), href: a && a.href, blank: a && a.target, h: f && f.getBoundingClientRect().height, w: f && f.getBoundingClientRect().width };
  });
  assert(vid.hit && vid.text.includes('치이카와와 함께 공부해요'), '치이카와 → 영상 칸');
  assert(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}\?/.test(vid.src) && vid.allow.includes('fullscreen'), '쿠키 없는 유튜브 퍼오기 ' + vid.src);
  assert(vid.href.startsWith('https://www.youtube.com/watch?v=') && vid.blank === '_blank', '유튜브에서 열기 링크');
  assert(Math.abs(vid.w / vid.h - 16 / 9) < 0.02 && vid.w > 250, '16:9 영상 크기 ' + vid.w + 'x' + vid.h);
  assert(await page.evaluate(() => { const o = document.querySelector('#egg-out'); return document.documentElement.scrollWidth <= innerWidth && o.getBoundingClientRect().right <= innerWidth; }), '폰 화면 밖으로 넘치지 않음');
  await page.fill('#egg-input', '');
  assert(await page.$eval('#egg-out', (o) => !o.hidden && !!o.querySelector('iframe')), '입력칸을 고쳐도 영상은 그대로');
  await page.click('[data-egg-close]');
  assert(await page.$eval('#egg-out', (o) => o.hidden && !o.querySelector('iframe') && !o.classList.contains('egg-video')), '닫기 → 영상이 사라지고 멈춤');
  await page.fill('#egg-input', 'ちいかわ');
  await page.press('#egg-input', 'Enter');
  assert(await page.$eval('#egg-out', (o) => !!o.querySelector('iframe')), '일본어로 적어도 열림');
  await page.fill('#egg-input', '만든이');
  await page.press('#egg-input', 'Enter');
  assert(await page.$eval('#egg-out', (o) => !o.querySelector('iframe') && !o.classList.contains('egg-video') && o.textContent.includes('만든 사람')), '다른 단어를 넣으면 영상 대신 그 내용');
  await ctx.setOffline(true);
  await page.fill('#egg-input', 'chiikawa');
  await page.press('#egg-input', 'Enter');
  vid = await page.$eval('#egg-out', (o) => ({ iframe: !!o.querySelector('iframe'), text: o.textContent }));
  assert(!vid.iframe && vid.text.includes('인터넷에 연결하면'), '인터넷이 없으면 안내만');
  await ctx.setOffline(false);
  await page.click('[data-egg-close]');
  await page.unroute(/youtube(-nocookie)?\.com/);

  const ver = await page.evaluate(() => App.version);
  assert(/^\d+\.\d+(\.\d+)?$/.test(ver) && await page.$eval('#app-version', (v, ver) => v.textContent.includes(ver), ver), '버전 ' + ver);

  // 4) 업데이트 때 자동 백업 → 기록이 사라져도 되돌리기
  await page.evaluate(() => {
    App.store.update((s) => {
      s.tasks.push({ id: 'keep1', title: '지키고 싶은 할 일', subjectId: null, due: null, estimateMin: null, done: false, createdAt: Date.now() });
      s.sessions.push({ id: 'ss1', subjectId: null, minutes: 42, endedAt: Date.now() });
      s.futureThing = [{ id: 'f' }];
    });
    localStorage.setItem('studypromotion.appVersion', '2.5'); // 업데이트 전 버전에서 쓰던 상태
  });
  await page.reload();
  await page.waitForFunction(() => App.backup && App.backup.list().then((l) => l.some((s) => s.reason === 'update')).catch(() => false), null, { timeout: 5000 }).catch(() => {});
  let list = await page.evaluate(() => App.backup.list().then((l) => l.map((s) => ({ reason: s.reason, note: s.note, has: s.text.includes('keep1') }))));
  const upd = list.find((s) => s.reason === 'update');
  assert(upd && upd.note === '2.5 → ' + ver && upd.has, '앱이 업데이트되면 업데이트 전 기록을 자동 백업 (' + JSON.stringify(list) + ')');
  assert(await page.evaluate(() => localStorage.getItem('studypromotion.appVersion')) === ver, '지금 버전을 기억');
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem('studypromotion.v1')).futureThing.length === 1), '모르는 항목도 그대로 저장돼 있음');
  // 기록이 사라진 상황
  await page.evaluate(() => App.store.update((s) => { s.tasks = []; s.sessions = []; }));
  await page.goto(base + '#account');
  await page.click('#autobk summary');
  await page.waitForSelector('#autobk-list [data-bk-restore]');
  const items = await page.$$eval('#autobk-list .autobk-item', (l) => l.map((x) => x.textContent));
  assert(items.some((t) => t.includes('앱 업데이트 때') && t.includes('할 일 1개')), '자동 백업 목록에 업데이트 때 사본');
  await page.click('#autobk-list [data-bk-restore]');
  await page.waitForSelector('#ask:not([hidden])');
  await page.click('#ask-ok');
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => App.store.get());
  assert(st.tasks.some((t) => t.id === 'keep1') && st.sessions.some((s) => s.id === 'ss1'), '자동 백업으로 되돌리면 기록이 돌아옴');
  assert((await toastText()).includes('되돌렸어요'), '되돌리기 알림');

  // 5) 백업 파일을 불러오기 전에도 지금 기록을 남긴다
  // (바로 앞 사본과 똑같으면 또 남기지 않으므로, 할 일을 하나 더 만든 뒤 불러온다)
  await page.evaluate(() => App.store.update((s) => { s.tasks.push({ id: 'keep2', title: '새 할 일', done: false, createdAt: Date.now() }); }));
  await page.evaluate(() => App.store.importJSON(JSON.stringify({ tasks: [], cards: [] })));
  await page.waitForTimeout(300);
  list = await page.evaluate(() => App.backup.list().then((l) => l.map((s) => ({ reason: s.reason, has: s.text.includes('keep2') }))));
  assert(list.some((s) => s.reason === 'import' && s.has), '불러오기 전 기록을 자동 백업');

  // 6) 저장된 기록이 깨져도 원본을 남기고 알린다
  await page.evaluate(() => localStorage.setItem('studypromotion.v1', '{"tasks":[{"id":"half'));
  await page.reload();
  await page.waitForTimeout(1200);
  assert((await toastText()).includes('읽지 못했어요'), '깨진 기록 알림');
  assert(await page.evaluate(() => localStorage.getItem('studypromotion.v1.broken')) === '{"tasks":[{"id":"half', '깨진 원본을 따로 보관');
  list = await page.evaluate(() => App.backup.list().then((l) => l.map((s) => s.reason)));
  assert(list.includes('broken'), '자동 백업에도 원본 보관');
  await page.click('#toast .toast-act');
  await page.waitForSelector('#autobk-list [data-bk-save]');
  assert(await page.$eval('#autobk', (d) => d.open), '알림에서 자동 백업 목록 열기');

  // 7) 저장에 실패하면 알린다
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'studypromotion.v1') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); };
    App.store.update((s) => { s.tasks.push({ id: 'x', title: 'x' }); });
  });
  await page.waitForTimeout(100);
  assert((await toastText()).includes('저장하지 못했어요'), '저장 실패 알림');

  assert(errors.length === 0, '오류 없음 ' + errors.join(' / '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
