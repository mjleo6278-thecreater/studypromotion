const test = require('node:test');
const assert = require('node:assert');
const Scope = require('../js/scope.js');

let n = 0;
const uid = () => 'id' + n++;

test('범위: 들여쓰기·글머리·제목을 트리로 읽는다', () => {
  const tree = Scope.parseOutline('# 수학\n- 1단원\n  - 다항식\n  * 인수분해\n- 2단원\n# 영어\n1. 본문\n2) 어휘\n\n');
  assert.strictEqual(tree.length, 2);
  assert.strictEqual(tree[0].title, '수학');
  assert.deepStrictEqual(tree[0].children.map((c) => c.title), ['1단원', '2단원']);
  assert.deepStrictEqual(tree[0].children[0].children.map((c) => c.title), ['다항식', '인수분해']);
  assert.deepStrictEqual(tree[1].children.map((c) => c.title), ['본문', '어휘']);
});

test('범위: 제목 없이 들여쓰기만, 탭 들여쓰기', () => {
  const tree = Scope.parseOutline('국어\n\t문학\n\t\t현대시\n\t문법\n수학');
  assert.strictEqual(tree.length, 2);
  assert.strictEqual(tree[0].children[0].children[0].title, '현대시');
  assert.strictEqual(tree[1].children.length, 0);
});

test('범위: 체크박스 표기 [ ] 와 번호를 제목에서 뺀다', () => {
  const tree = Scope.parseOutline('- [ ] 복소수\n- [x] 이차방정식\n- 1. 집합');
  assert.deepStrictEqual(tree.map((t) => t.title), ['복소수', '이차방정식', '집합']);
  assert.deepStrictEqual(tree.map((t) => t.done), [false, true, false]);
});

test('범위: 예시 범위는 카드 5개', () => {
  const tree = Scope.parseOutline(Scope.SAMPLE);
  assert.strictEqual(tree.length, 5);
  assert.ok(Scope.countOutline(tree) > 25);
});

function sampleNodes() {
  const nodes = [];
  Scope.addOutline(nodes, 'e1', Scope.parseOutline('# 수학\n- 1단원\n  - 다항식\n  - 인수분해\n- 2단원\n# 영어'), uid);
  return nodes;
}

test('진행률: 잎 항목 기준으로 계산하고, 상위 체크는 하위 전체를 바꾼다', () => {
  const nodes = sampleNodes();
  const math = nodes.find((x) => x.title === '수학');
  const u1 = nodes.find((x) => x.title === '1단원');
  const eng = nodes.find((x) => x.title === '영어');
  { const p0 = Scope.progress(nodes, math.id); assert.deepStrictEqual({ done: p0.done, total: p0.total, pct: p0.pct, state: p0.state }, { done: 0, total: 3, pct: 0, state: 'none' }); }
  // 하위가 없는 카드는 카드 자체가 잎
  assert.strictEqual(Scope.progress(nodes, eng.id).total, 1);

  Scope.toggle(nodes, nodes.find((x) => x.title === '다항식').id);
  assert.strictEqual(Scope.progress(nodes, u1.id).state, 'some');
  assert.strictEqual(Scope.progress(nodes, math.id).pct, 33);

  Scope.toggle(nodes, u1.id); // 일부 → 전체 체크
  assert.strictEqual(Scope.progress(nodes, u1.id).state, 'all');
  Scope.toggle(nodes, u1.id); // 전체 → 해제
  assert.strictEqual(Scope.progress(nodes, u1.id).state, 'none');

  Scope.setDone(nodes, math.id, true);
  { const ep = Scope.examProgress(nodes, 'e1'); assert.deepStrictEqual({ done: ep.done, total: ep.total, pct: ep.pct }, { done: 3, total: 4, pct: 75 }); }
});

test('삭제: 하위 항목까지 함께 지운다', () => {
  const nodes = sampleNodes();
  const math = nodes.find((x) => x.title === '수학');
  const left = Scope.removeSubtree(nodes, math.id);
  assert.deepStrictEqual(left.map((x) => x.title), ['영어']);
});

test('배치: 카드끼리 겹치지 않는다', () => {
  const nodes = [];
  Scope.addOutline(nodes, 'e1', Scope.parseOutline(Scope.SAMPLE), uid);
  Scope.autoLayout(nodes, 'e1');
  const cards = Scope.childrenOf(nodes, null, 'e1');
  for (const a of cards) for (const b of cards) {
    if (a === b) continue;
    const ha = Scope.estimateHeight(nodes, a.id), hb = Scope.estimateHeight(nodes, b.id);
    const overlap = a.x < b.x + Scope.CARD_W && b.x < a.x + Scope.CARD_W && a.y < b.y + hb && b.y < a.y + ha;
    assert.ok(!overlap, a.title + ' / ' + b.title);
  }
  const bb = Scope.bounds(nodes, 'e1');
  assert.ok(bb.w > Scope.CARD_W && bb.h > 0);
});

test('추가: 나중에 붙인 범위는 기존 카드 오른쪽에 놓인다', () => {
  const nodes = sampleNodes();
  const before = Math.max(...Scope.childrenOf(nodes, null, 'e1').map((c) => c.x));
  const added = Scope.addOutline(nodes, 'e1', Scope.parseOutline('사회'), uid);
  assert.ok(added[0].x > before);
});

test('D-day 표시', () => {
  const now = new Date(2026, 10, 7, 23, 0).getTime();
  assert.strictEqual(Scope.ddayLabel('2026-11-07', now), 'D-DAY');
  assert.strictEqual(Scope.ddayLabel('2026-11-20', now), 'D-13');
  assert.strictEqual(Scope.ddayLabel('2026-11-01', now), 'D+6');
  assert.strictEqual(Scope.ddayLabel('', now), '');
});

test('텍스트 내보내기에 체크 상태가 남는다', () => {
  const nodes = sampleNodes();
  Scope.toggle(nodes, nodes.find((x) => x.title === '2단원').id);
  const out = Scope.toOutline(nodes, 'e1');
  assert.ok(out.includes('  - [x] 2단원'));
  assert.ok(out.includes('    - [ ] 다항식'));
  // 다시 읽어도 같은 구조
  const again = [];
  Scope.addOutline(again, 'e2', Scope.parseOutline(out), uid);
  assert.strictEqual(again.length, 6);
  assert.deepStrictEqual(Scope.examProgress(again, 'e2'), Scope.examProgress(nodes, 'e1'));
});

test('체스 진행: 폰은 0~6칸, 100%면 퀸으로 승급', () => {
  assert.deepStrictEqual(Scope.pawnRank(0), { square: 0, promoted: false });
  assert.deepStrictEqual(Scope.pawnRank(50), { square: 3, promoted: false });
  assert.deepStrictEqual(Scope.pawnRank(99), { square: 6, promoted: false });
  assert.deepStrictEqual(Scope.pawnRank(100), { square: 7, promoted: true });
});

test('부분 진행률과 소요시간: 시간 비율로 진행률 계산', () => {
  const nodes = [
    { id: 'c', examId: 'e', parentId: null, kind: 'topic', title: '수학' },
    { id: 'a', examId: 'e', parentId: 'c', kind: 'topic', title: '다항식', est: 120, pct: 50 },
    { id: 'b', examId: 'e', parentId: 'c', kind: 'topic', title: '방정식', est: 60, done: true },
  ];
  const p = Scope.progress(nodes, 'c');
  assert.strictEqual(p.timeTotal, 180);
  assert.strictEqual(p.timeDone, 120); // 60 + 60
  assert.strictEqual(p.timeLeft, 60);
  assert.strictEqual(p.pct, 67);
  assert.strictEqual(p.state, 'some');
  Scope.setLeafProgress(nodes[1], 100);
  assert.strictEqual(nodes[1].done, true);
  assert.strictEqual(Scope.progress(nodes, 'c').state, 'all');
  Scope.setDone(nodes, 'c', false);
  assert.strictEqual(Scope.progress(nodes, 'c').timeDone, 0);
});

test('시간이 안 적힌 항목이 있으면 개수 평균으로 진행률', () => {
  const nodes = [
    { id: 'c', examId: 'e', parentId: null, kind: 'topic', title: 'x' },
    { id: 'a', examId: 'e', parentId: 'c', kind: 'topic', title: 'a', est: 60, pct: 50 },
    { id: 'b', examId: 'e', parentId: 'c', kind: 'topic', title: 'b' },
  ];
  const p = Scope.progress(nodes, 'c');
  assert.strictEqual(p.pct, 25);
  assert.strictEqual(p.noEst, 1);
});

test('시험 시간 페이스: 하루 할 양, 밀린 양, 오늘 남은 양', () => {
  const now = new Date(2026, 10, 11, 15).getTime(); // 11/11, 시험 11/21 → 10일
  const exam = { date: '2026-11-21', planStart: '2026-11-01', paceSnap: { day: '2026-11-11', left: 1200 } };
  // 총 1500분, 계획 20일 → 기본 하루 75분. 오늘 아침 남은 1200 (300 함). 지금 남은 1150 (오늘 50 함)
  const plan = Scope.timePlan({ timeTotal: 1500, timeDone: 350, timeLeft: 1150, pct: 23, noEst: 0 }, exam, now);
  assert.strictEqual(plan.days, 10);
  assert.strictEqual(plan.basePerDay, 75);
  assert.strictEqual(plan.todayQuota, 120); // 1200 / 10
  assert.strictEqual(plan.todayDone, 50);
  assert.strictEqual(plan.todayLeft, 70);
  assert.strictEqual(plan.behind, 450); // 10일 지났으니 750 했어야 하는데 300
  assert.strictEqual(plan.extraPerDay, 45);
  assert.strictEqual(plan.perDay, 115);
  // 시험 당일
  const dday = Scope.timePlan({ timeTotal: 100, timeDone: 40, timeLeft: 60, pct: 40, noEst: 0 }, { date: '2026-11-11' }, now);
  assert.strictEqual(dday.days, 0);
  assert.strictEqual(dday.perDay, 60);
});

test('계획 시작일과 아침 스냅샷 기록', () => {
  const exam = { date: '2026-11-21' };
  const now = new Date(2026, 10, 11, 9).getTime();
  assert.strictEqual(Scope.touchPlan(exam, { timeTotal: 100, timeLeft: 80 }, now), true);
  assert.deepStrictEqual(exam, { date: '2026-11-21', planStart: '2026-11-11', paceSnap: { day: '2026-11-11', left: 80 } });
  assert.strictEqual(Scope.touchPlan(exam, { timeTotal: 100, timeLeft: 70 }, now), false);
  assert.strictEqual(Scope.touchPlan({ date: 'x' }, { timeTotal: 0 }, now), false);
});
