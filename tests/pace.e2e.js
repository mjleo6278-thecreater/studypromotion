// 시험 시간 페이스 테스트: 소요시간·진행률 입력과 하루 페이스
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(body);
});


(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '#home');
  await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 10);
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    App.store.update((s) => {
      s.exams.push({ id: 'e1', name: '기말', date });
      s.activeExamId = 'e1';
      s.topics.push(
        { id: 'c1', examId: 'e1', parentId: null, kind: 'topic', title: '수학', order: 0, x: 80, y: 80, color: '#4a7fd4' },
        { id: 'a', examId: 'e1', parentId: 'c1', kind: 'topic', title: '다항식', order: 0 },
        { id: 'b', examId: 'e1', parentId: 'c1', kind: 'topic', title: '방정식', order: 1 });
    });
  });
  await page.goto(base + '#board');
  assert(/걸리는 시간을 적으면/.test(await page.textContent('#board-pace')), '시간 입력 안내');

  // 다항식: 2시간, 방정식: 1시간 30분
  await page.click('[data-time="a"]');
  await page.click('#time-quick [data-min="120"]');
  await page.click('#time-form button[type=submit]');
  await page.click('[data-time="b"]');
  await page.fill('#time-h', '1'); await page.fill('#time-m', '30');
  await page.click('#time-form button[type=submit]');
  const strip = await page.textContent('#board-pace');
  assert(/오늘 할 양 21분 남음/.test(strip), '오늘 할 양 = 210분 ÷ 10일 → 21분 (' + strip.trim().replace(/\s+/g, ' ') + ')');
  assert(/하루 21분씩/.test(await page.textContent('#bb-pace')), '상단 하루 페이스');

  // 다항식 50% 진행 → 1시간 함
  await page.click('[data-time="a"]');
  await page.click('#time-pct-quick [data-pct="50"]');
  assert(/1시간 한 셈이에요 · 남은 1시간/.test(await page.textContent('#time-preview')), '입력 창 미리보기');
  await page.click('#time-form button[type=submit]');
  assert(/50% · 남은 1시간/.test(await page.textContent('[data-time="a"]')), '항목 칩에 남은 시간');
  assert(/29% · 남은 2시간 30분/.test(await page.textContent('#board-cards .bcard-prog')), '카드 진행률은 시간 비율 (60/210)');
  // 범위만 체크하고 공부 기록이 없으면 오늘 몫 완료가 아님 (홈 '오늘 공부' 0분인데 완료로 뜨던 오류)
  assert(/오늘 할 양 21분 남음/.test(await page.textContent('#board-pace')), '공부 기록 0분이면 오늘 몫 그대로 (' + (await page.textContent('#board-pace')).trim().replace(/\s+/g, ' ') + ')');
  await page.goto(base + '#home');
  assert(/오늘 21분 더/.test(await page.textContent('#h-exams')) && !/몫 완료/.test(await page.textContent('#h-exams')), '홈 시험 준비도 오늘 몫 남음');
  assert(/오늘 21분 더/.test(await page.textContent('#h-next-sub')), '홈 오늘 할 범위도 오늘 몫 남음');
  assert(/공부 기록이 없어서/.test(await page.textContent('#h-next-foot')), '체크만 한 범위는 기록이 없어서 안 셌다고 알려 줌');
  // 10분 공부 → 10분만 셈
  await page.evaluate(() => App.store.update((s) => s.sessions.push({ id: 'p1', subjectId: null, minutes: 10, endedAt: Date.now() })));
  assert(/오늘 11분 더/.test(await page.textContent('#h-exams')), '공부한 10분만큼만 오늘 한 양 (' + (await page.textContent('#h-exams')).trim().replace(/\s+/g, ' ') + ')');
  // 30분 공부 → 오늘 몫 채움
  await page.evaluate(() => App.store.update((s) => s.sessions.push({ id: 'p2', subjectId: null, minutes: 20, endedAt: Date.now() })));
  assert(/몫 완료/.test(await page.textContent('#h-exams')) && /오늘 몫 완료/.test(await page.textContent('#h-next-sub')), '홈: 공부 30분 + 범위 체크 → 오늘 몫 완료');
  await page.goto(base + '#board');
  assert(/오늘 할 양 완료/.test(await page.textContent('#board-pace')), '오늘 몫 채움');
  await page.click('#bp-toggle');
  const grid = await page.textContent('.bp-grid');
  assert(/전체소요시간3시간30분/.test(grid.replace(/\s+/g, '')) && /한만큼29%/.test(grid.replace(/\s+/g, '')), '자세히 보기');

  // 체크하면 100%
  await page.click('[data-check="b"]');
  assert(/71%/.test(await page.textContent('#bb-pct')), '체크하면 그 항목 시간 전부 완료 (150/210)');

  // 홈
  await page.goto(base + '#home');
  assert(/71% · 남은 1시간/.test(await page.textContent('#h-exams')), '홈 시험 준비에 시간 페이스');

  // 밀린 경우: 계획 시작을 5일 전으로
  await page.evaluate(() => App.store.update((s) => {
    const e = s.exams[0]; const d = new Date(); d.setDate(d.getDate() - 5);
    e.planStart = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    s.topics.forEach((t) => { t.done = false; t.pct = 0; }); e.paceSnap = null;
  }));
  await page.goto(base + '#board');
  assert(/밀린 양 1시간 10분/.test(await page.textContent('#board-pace')), '밀린 양 표시 (15일 중 5일 지남 → 70분)');
  assert(errors.length === 0, '페이지 오류 없음 ' + errors.join(' | '));
  await browser.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
