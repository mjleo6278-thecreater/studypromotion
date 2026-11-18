// v3.8 이스터에그 '벽 튕기기' (js/bounce.js): 사진 자르기 계산과 공 움직임
const test = require('node:test');
const assert = require('node:assert');
const B = require('../js/bounce.js');
const Egg = require('../js/egg.js');

test('비밀 단어: 이름을 여러 꼴로 적어도 게임이 열리고, 다른 단어와 겹치지 않는다', () => {
  for (const w of ['이강인', '이강인 선수', '이강인님', ' 이강인! ', 'Lee Kang-in', 'Kang-in Lee', 'leekangin', '강인이']) assert.strictEqual(Egg.gameOf(w), 'bounce', w);
  for (const w of ['이강', '강인', '치이카와', '', '손흥민']) assert.strictEqual(Egg.gameOf(w), null, w);
  assert.strictEqual(Egg.find('이강인'), null);
  assert.strictEqual(Egg.videoOf('이강인'), null);
  assert.strictEqual(Egg.skinOf('이강인'), null);
  assert.strictEqual(Egg.gameOf('치이카와'), null);
});

test('자르기 처음 자리: 정사각형 사진은 위쪽 가운데, 세로로 긴 사진은 조금 아래에 더 크게', () => {
  const sq = B.initialCrop(1000, 1000);
  assert.strictEqual(sq.cx, 500);
  assert.ok(sq.cy - sq.d / 2 >= 0 && sq.cy < 300, '위쪽 ' + JSON.stringify(sq));
  assert.ok(sq.d > 250 && sq.d < 400, '얼굴 크기쯤 ' + sq.d);
  const tall = B.initialCrop(750, 1000);
  assert.strictEqual(tall.cx, 375);
  assert.ok(tall.cy > sq.cy * 0.75 * 1.2 && tall.d > 300, '셀카는 더 크고 아래 ' + JSON.stringify(tall));
  const wide = B.initialCrop(1600, 900);
  assert.ok(wide.cy - wide.d / 2 >= 0 && wide.cx === 800, '가로 사진도 사진 안에서 시작');
});

test('자르기: 동그라미는 사진 밖으로 나가지 않고 크기도 범위 안, 크기 막대와 지름이 서로 맞는다', () => {
  const c = B.clampCrop({ cx: -50, cy: 5000, d: 1 }, 800, 600);
  assert.deepStrictEqual([c.cx, c.cy], [0, 600]);
  assert.strictEqual(c.d, B.cropLimits(800, 600).min);
  assert.strictEqual(B.clampCrop({ cx: 1, cy: 1, d: 99999 }, 800, 600).d, B.cropLimits(800, 600).max);
  for (const z of [0, 25, 50, 99.5, 100]) assert.ok(Math.abs(B.dToZoom(B.zoomToD(z, 800, 600), 800, 600) - z) < 1e-6, 'z ' + z);
  assert.ok(B.zoomToD(0, 800, 600) > B.zoomToD(100, 800, 600), '막대를 오른쪽으로 = 얼굴이 크게(자르는 동그라미가 작게)');
  const f = B.cropFromFace({ x: 400, y: 100, width: 200, height: 240 }, 1000, 1000);
  assert.ok(f.cx === 500 && f.cy > 100 && f.cy < 250 && f.d > 240, '얼굴 찾기 결과로 자리 잡기 ' + JSON.stringify(f));
});

const fresh = (W = 390, H = 700) => B.createGame(W, H);

test('공: 처음엔 막대 위에서 기다리고, 차 올리면 위로 간다', () => {
  const g = fresh();
  assert.strictEqual(g.state, 'ready');
  assert.ok(Math.abs(g.ball.x - g.px) < 1e-9 && g.ball.y + g.r <= g.py);
  B.step(g, 0.1);
  assert.strictEqual(g.ball.vy, 0, '시작 전에는 움직이지 않음');
  B.movePaddle(g, 50, 1);
  assert.ok(Math.abs(g.ball.x - g.px) < 1e-9 && Math.abs(g.px - g.pw / 2) < 1e-9, '기다리는 동안 공은 막대를 따라감, 막대는 화면 밖으로 안 나감');
  assert.ok(B.launch(g, 0.5));
  assert.ok(g.state === 'play' && g.ball.vy < 0 && Math.abs(g.ball.vx) < 1e-9);
  assert.ok(!B.launch(g, 0.5), '이미 차 올렸으면 다시 안 됨');
});

test('공: 양옆 벽과 천장에 튕긴다. 골대 안이면 3점, 밖이면 점수 없음', () => {
  const g = fresh();
  B.launch(g, 0.5);
  Object.assign(g.ball, { x: g.r + 2, y: 300, vx: -400, vy: 0 });
  let ev = B.step(g, 0.02);
  assert.ok(ev.some((e) => e.type === 'wall' && e.side === 'left') && g.ball.vx > 0 && g.ball.x >= g.r, '왼쪽 벽');
  Object.assign(g.ball, { x: g.W - g.r - 2, y: 300, vx: 400, vy: 0 });
  ev = B.step(g, 0.02);
  assert.ok(ev.some((e) => e.type === 'wall' && e.side === 'right') && g.ball.vx < 0, '오른쪽 벽');
  Object.assign(g.ball, { x: g.gx, y: g.r + 3, vx: 0, vy: -500 });
  ev = B.step(g, 0.02);
  assert.ok(ev.some((e) => e.type === 'goal') && g.score === 3 && g.goals === 1 && g.ball.vy > 0, '골 +3 ' + JSON.stringify(ev));
  Object.assign(g.ball, { x: g.r + 5, y: g.r + 3, vx: 0, vy: -500 });
  ev = B.step(g, 0.02);
  assert.ok(ev.some((e) => e.type === 'top') && !ev.some((e) => e.type === 'goal') && g.score === 3, '골대 밖 천장은 튕기기만');
});

test('막대: 받으면 1점, 가운데는 곧게 끝은 비스듬히, 조금씩 빨라진다', () => {
  const g = fresh();
  B.launch(g, 0.5);
  const sp0 = g.base;
  Object.assign(g.ball, { x: g.px, y: g.py - g.r - 5, vx: 0, vy: sp0 });
  let ev = B.step(g, 0.02);
  assert.ok(ev.some((e) => e.type === 'paddle') && g.score === 1 && g.hits === 1 && g.ball.vy < 0, '가운데로 받음');
  assert.ok(Math.abs(g.ball.vx) < 1e-6, '가운데는 곧게 위로');
  assert.ok(Math.hypot(g.ball.vx, g.ball.vy) > sp0, '빨라짐');
  Object.assign(g.ball, { x: g.px + g.pw / 2, y: g.py - g.r - 5, vx: 0, vy: sp0 });
  B.step(g, 0.02);
  assert.ok(g.ball.vx > 0 && g.ball.vy < 0 && g.score === 2, '오른쪽 끝으로 받으면 오른쪽 위로');
  // 아주 빨라도 막대를 뚫고 지나가지 않는다
  Object.assign(g.ball, { x: g.px, y: g.py - g.r - 30, vx: 0, vy: g.base * 1.9 });
  B.step(g, 0.034);
  assert.ok(g.ball.vy < 0 && g.ball.y + g.r <= g.py + 1 && g.score === 3, '빠른 공도 받음');
  // 빠르기에는 끝이 있다
  for (let i = 0; i < 80; i++) { Object.assign(g.ball, { x: g.px, y: g.py - g.r - 5, vx: 0, vy: Math.abs(g.ball.vy) }); B.step(g, 0.01); }
  assert.ok(Math.hypot(g.ball.vx, g.ball.vy) <= g.base * 1.9 + 1e-6, '최고 빠르기 ' + Math.hypot(g.ball.vx, g.ball.vy));
});

test('놓치면 끝: 막대 옆으로 떨어진 공은 아래로 나가고 판이 끝난다', () => {
  const g = fresh();
  B.launch(g, 0.5);
  B.movePaddle(g, 0, 1); // 막대를 왼쪽 끝으로
  Object.assign(g.ball, { x: g.W - g.r - 1, y: g.py - g.r - 5, vx: 0, vy: 600 });
  let ev = [];
  for (let i = 0; i < 60 && g.state === 'play'; i++) ev = ev.concat(B.step(g, 1 / 60));
  assert.strictEqual(g.state, 'over');
  assert.ok(ev.some((e) => e.type === 'miss') && !ev.some((e) => e.type === 'paddle') && g.score === 0);
  B.serve(g);
  assert.ok(g.state === 'ready' && g.score === 0 && g.hits === 0, '새 판');
});

test('골대: 몇 번 받아 넘긴 뒤에야 좌우로 움직이고, 화면 밖으로 나가지 않는다', () => {
  const g = fresh();
  B.launch(g, 0.5);
  const keepFlying = () => Object.assign(g.ball, { x: g.W / 2, y: g.H / 2, vx: 0, vy: -1 });
  for (let i = 0; i < 300; i++) { keepFlying(); B.step(g, 1 / 60); }
  assert.ok(Math.abs(g.gx - g.W / 2) < 1e-6, '처음엔 가운데 그대로');
  g.hits = 30;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 1200; i++) { keepFlying(); B.step(g, 1 / 60); min = Math.min(min, g.gx); max = Math.max(max, g.gx); }
  assert.ok(max - min > 100, '움직임 ' + Math.round(min) + '~' + Math.round(max));
  assert.ok(min - g.gw / 2 >= 0 && max + g.gw / 2 <= g.W, '골대가 화면 안');
});

test('화면 크기가 바뀌면(가로로 돌리기) 공과 막대가 비율대로 옮겨지고 화면 안에 남는다', () => {
  const g = fresh(390, 700);
  B.launch(g, 0.5);
  Object.assign(g.ball, { x: 370, y: 600 });
  B.layoutGame(g, 800, 330);
  assert.ok(g.ball.x >= g.r && g.ball.x <= 800 - g.r && g.ball.y + g.r <= g.py, '공이 화면 안 ' + JSON.stringify(g.ball));
  assert.ok(g.px >= g.pw / 2 && g.px <= 800 - g.pw / 2 && g.py < 330 && g.r >= 20);
  const r = fresh(390, 700);
  B.layoutGame(r, 800, 330);
  assert.ok(r.state === 'ready' && Math.abs(r.ball.y + r.r + 1 - r.py) < 1e-9, '기다리는 공은 막대 위에 그대로');
});
