// 기능 켜기·끄기와 탭·홈 화면 순서 (v3.6): 설정 읽기·바꾸기 (js/features.js의 순수 함수)
const test = require('node:test');
const assert = require('node:assert');
const F = require('../js/features.js');

const TABS = ['home', 'board', 'plan', 'timer', 'review', 'stats'];
const HOME = ['home-sum', 'home-tt', 'home-exams', 'home-next', 'home-tasks'];
const S = (layout) => ({ dailyGoalMin: 120, layout });

test('설정이 없으면 지금 모습 그대로 (탭 6개, 모두 켜짐)', () => {
  for (const s of [null, {}, S(undefined), S('x'), S([1, 2]), S({ tabs: 'no', off: 3 })]) {
    const L = F.read(s);
    assert.deepStrictEqual(L.tabs, TABS);
    assert.deepStrictEqual(L.home, HOME);
    assert.deepStrictEqual(L.off, []);
    assert.ok(F.isDefault(L));
    for (const f of F.LIST) assert.ok(F.isOn(L, f.id), f.id + ' 켜짐');
  }
});

test('저장된 순서를 따르고, 빠진 탭은 기본 순서에서 바로 앞 탭 뒤에 끼운다', () => {
  assert.deepStrictEqual(F.read(S({ tabs: ['timer', 'home', 'board', 'plan', 'review', 'stats'] })).tabs, ['timer', 'home', 'board', 'plan', 'review', 'stats']);
  // plan이 빠짐 → board 뒤로
  assert.deepStrictEqual(F.read(S({ tabs: ['stats', 'board', 'home', 'timer', 'review'] })).tabs, ['stats', 'board', 'plan', 'home', 'timer', 'review']);
  // 맨 앞(home)이 빠짐 → 맨 앞으로
  assert.deepStrictEqual(F.read(S({ tabs: ['stats', 'board'] })).tabs, ['home', 'stats', 'board', 'plan', 'timer', 'review']);
  // 겹치거나 모르는 이름은 빼고 읽는다
  assert.deepStrictEqual(F.read(S({ tabs: ['review', 'review', 'planner', 7, 'home'] })).tabs, ['review', 'stats', 'home', 'board', 'plan', 'timer']);
});

test('mergeOrder: 새 기능은 기본 순서의 자리에 들어간다', () => {
  assert.deepStrictEqual(F.mergeOrder(['c', 'a'], ['a', 'b', 'c', 'd']), ['c', 'd', 'a', 'b'], 'd는 기본 순서에서 바로 앞인 c 뒤로');
  // 새 탭(예: 계획 다음에 생긴 탭)은 사용자가 옮겨 둔 계획 바로 뒤에 나타난다
  assert.deepStrictEqual(F.mergeOrder(['timer', 'home', 'board', 'plan', 'review', 'stats'], ['home', 'board', 'plan', 'new', 'timer', 'review', 'stats']), ['timer', 'home', 'board', 'plan', 'new', 'review', 'stats']);
  assert.deepStrictEqual(F.mergeOrder([], ['a', 'b']), ['a', 'b']);
  assert.deepStrictEqual(F.mergeOrder(['b'], ['a', 'b', 'c']), ['a', 'b', 'c']);
});

test('끈 기능: 딸린 기능도 꺼지고, 홈 칸은 필요한 탭이 꺼지면 숨는다', () => {
  let L = F.read(S({ off: ['timer'] }));
  assert.ok(!F.isOn(L, 'timer') && !F.isOn(L, 'focus') && !F.isOn(L, 'stopwatch') && !F.isOn(L, 'lock'));
  assert.ok(F.isOn(L, 'ai'), '세컨드는 타이머와 상관없음');
  assert.match(F.lockReason(L, 'focus'), /타이머 탭이 꺼져/);
  L = F.read(S({ off: ['board', 'plan'] }));
  assert.ok(!F.isOn(L, 'home-exams') && !F.isOn(L, 'home-next') && !F.isOn(L, 'home-tasks'));
  assert.ok(F.isOn(L, 'home-tt') && F.isOn(L, 'home-sum'));
  assert.match(F.lockReason(L, 'home-exams'), /범위 탭이 꺼져/);
  assert.match(F.lockReason(L, 'home-tasks'), /계획 탭이 꺼져/);
});

test('홈과 오늘 요약은 끌 수 없다', () => {
  const L = F.read(S({ off: ['home', 'home-sum', 'review'] }));
  assert.deepStrictEqual(L.off, ['review']);
  assert.ok(F.isOn(L, 'home') && F.isOn(L, 'home-sum'));
  assert.strictEqual(F.toggle(L, 'home', false), L);
  assert.match(F.lockReason(L, 'home'), /항상/);
});

test('집중 타이머와 스톱워치는 함께 끌 수 없다', () => {
  let L = F.toggle(F.read(null), 'focus', false);
  assert.deepStrictEqual(L.off, ['focus']);
  assert.strictEqual(F.toggle(L, 'stopwatch', false), L, '마지막 하나는 끄지 않음');
  assert.match(F.lockReason(L, 'stopwatch'), /하나는 켜 둬야/);
  assert.strictEqual(F.lockReason(L, 'focus'), '', '꺼 둔 쪽은 다시 켤 수 있음');
  L = F.toggle(L, 'focus', true);
  assert.deepStrictEqual(L.off, []);
  // 다른 기기·옛 기록에서 둘 다 꺼져 오면 둘 다 켠다
  assert.deepStrictEqual(F.read(S({ off: ['focus', 'stopwatch', 'lock'] })).off, ['lock']);
});

test('순서 바꾸기: moveTo', () => {
  const L = F.read(null);
  assert.deepStrictEqual(F.moveTo(L, 'tabs', 'timer', 0).tabs, ['timer', 'home', 'board', 'plan', 'review', 'stats']);
  assert.deepStrictEqual(F.moveTo(L, 'tabs', 'home', 2).tabs, ['board', 'plan', 'home', 'timer', 'review', 'stats']);
  assert.deepStrictEqual(F.moveTo(L, 'tabs', 'stats', 99).tabs, TABS);
  assert.deepStrictEqual(F.moveTo(L, 'home', 'home-exams', 0).home, ['home-exams', 'home-sum', 'home-tt', 'home-next', 'home-tasks']);
  assert.strictEqual(F.moveTo(L, 'tabs', 'nope', 0), L);
  assert.ok(!F.isDefault(F.moveTo(L, 'tabs', 'timer', 0)));
});

test('저장할 때 이 버전이 모르는 기능(새 버전의 탭·꺼 둔 것)은 지우지 않는다', () => {
  const prev = { tabs: ['home', 'planner', 'board', 'plan', 'timer', 'review', 'stats'], home: ['home-sum', 'home-week'], off: ['planner', 'review'] };
  const L = F.read(S(prev));
  assert.deepStrictEqual(L.off, ['planner', 'review'], '모르는 이름도 off에 남음');
  assert.ok(F.isOn(L, 'board') && !F.isOn(L, 'review'));
  assert.ok(!F.isOn(L, 'planner') && F.isOn(L, 'something-new'), '모르는 이름은 off에 없으면 켜진 것으로');
  const next = F.pack(F.toggle(F.moveTo(L, 'tabs', 'stats', 0), 'review', true), prev);
  assert.deepStrictEqual(next.tabs, ['stats', 'home', 'planner', 'board', 'plan', 'timer', 'review'], '모르는 탭은 전에 있던 자리(홈 바로 뒤)에');
  assert.deepStrictEqual(next.home, ['home-sum', 'home-week', 'home-tt', 'home-exams', 'home-next', 'home-tasks']);
  // 맨 앞에 있던 모르는 이름은 맨 앞에
  assert.deepStrictEqual(F.pack(F.read(null), { tabs: ['planner', 'home'] }).tabs, ['planner'].concat(TABS));
  assert.deepStrictEqual(next.off, ['planner']);
  assert.ok(F.isDefault(F.read(S({ off: ['planner'] }))), '모르는 것만 꺼져 있으면 처음 배치로 본다');
});

test('기능 목록: 이름이 겹치지 않고, 탭마다 이름·아이콘이 있다', () => {
  const ids = F.LIST.map((f) => f.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  for (const f of F.LIST) {
    assert.match(f.id, /^[a-z0-9][a-z0-9-]*$/);
    assert.ok(f.name && f.desc, f.id + ' 이름·설명');
    if (f.kind === 'tab') assert.ok(f.icon, f.id + ' 아이콘');
    if (f.parent) assert.strictEqual(F.item(f.parent).kind, 'tab');
    if (f.needs) assert.ok(F.item(f.needs));
  }
  F.ONE_OF.forEach((g) => g.forEach((id) => assert.ok(F.item(id))));
});
