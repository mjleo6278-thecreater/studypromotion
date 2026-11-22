// 스터디 플래너 계산: 날짜별 할 일, 반복, 지난 일 가져오기, 범위와 잇기(끝냄 한 번만 공부 시간에)
const test = require('node:test');
const assert = require('node:assert');
const Stats = require('../js/stats.js');
const P = require('../js/plan.js');

const NOW = new Date(2026, 10, 17, 16, 20).getTime(); // 2026-11-17 (화) 16:20
const TODAY = '2026-11-17';
let n = 0;
const env = () => ({ uid: () => 'u' + (++n), now: NOW });
const uid = () => 'r' + (++n);
const task = (o) => Object.assign({ id: 't' + (++n), title: '할 일', subjectId: null, due: TODAY, estimateMin: null, done: false, createdAt: ++n }, o);
// 범위: 시험 e1 > 수학 카드 c1 > 3단원 g1 > 잎 a1(30분), a2(20분) / 카드 바로 아래 잎 b1
function scopeState() {
  return {
    subjects: [{ id: 'math', name: '수학', color: '#4a7fd4' }],
    exams: [{ id: 'e1', name: '기말', date: '2026-11-30' }],
    topics: [
      { id: 'c1', examId: 'e1', parentId: null, title: '수학', color: '#123456' },
      { id: 'g1', examId: 'e1', parentId: 'c1', title: '3단원' },
      { id: 'a1', examId: 'e1', parentId: 'g1', title: '개념', est: 30 },
      { id: 'a2', examId: 'e1', parentId: 'g1', title: '문제', est: 20, pct: 50 },
      { id: 'b1', examId: 'e1', parentId: 'c1', title: '오답', est: 0 },
    ],
    tasks: [], sessions: [], events: [], planner: {},
  };
}
const credits = (st) => st.sessions.filter((s) => s.kind === 'done').reduce((a, s) => a + s.minutes, 0);

test('플래너: 날짜 부르는 말과 D-day', () => {
  assert.strictEqual(P.relDay(TODAY, TODAY), '오늘');
  assert.strictEqual(P.relDay('2026-11-18', TODAY), '내일');
  assert.strictEqual(P.relDay('2026-11-19', TODAY), '모레');
  assert.strictEqual(P.relDay('2026-11-16', TODAY), '어제');
  assert.strictEqual(P.relDay('2026-11-27', TODAY), '10일 뒤');
  assert.strictEqual(P.relDay('2026-11-10', TODAY), '7일 전');
  assert.strictEqual(P.dayTitle(TODAY), '11월 17일 (화)');
  const ex = [{ id: 'a', name: '중간', date: '2026-11-10' }, { id: 'b', name: '기말', date: '2026-11-30' }, { id: 'c', name: '모의', date: '2026-12-03' }, { id: 'd', name: '날짜 없음' }];
  assert.strictEqual(P.nextExam(ex, TODAY).exam.name, '기말');
  assert.strictEqual(P.nextExam(ex, TODAY).days, 13);
  assert.strictEqual(P.nextExam(ex, '2026-11-30').days, 0, '시험 날 당일');
  assert.strictEqual(P.ddayText(0), 'D-day');
  assert.strictEqual(P.nextExam(ex, '2026-12-04'), null);
  assert.deepStrictEqual(P.weekKeys(TODAY), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
});

test('플래너: 그날의 할 일은 적은 차례, 끝낸 것도 그 자리에', () => {
  const a = task({ title: 'a', createdAt: 1 }), b = task({ title: 'b', createdAt: 2, done: true }), c = task({ title: 'c', createdAt: 3, estimateMin: 30 });
  const d = task({ title: '내일', due: '2026-11-18' }), e = task({ title: '날짜 없음', due: null }), f = task({ title: '어제 못 함', due: '2026-11-16', estimateMin: 20 });
  const tasks = [c, d, a, e, b, f];
  assert.deepStrictEqual(P.dayTasks(tasks, TODAY).map((t) => t.title), ['a', 'b', 'c']);
  assert.deepStrictEqual(P.undated(tasks).map((t) => t.title), ['날짜 없음']);
  assert.deepStrictEqual(P.overdue(tasks, TODAY).map((t) => t.title), ['어제 못 함']);
  const s = P.daySummary(tasks, TODAY);
  assert.deepStrictEqual([s.total, s.done, s.left, s.planMin], [3, 1, 2, 30]);
});

test('플래너: 지난 일을 오늘 맨 위로 가져오고, 다른 날로 옮기면 그날 맨 아래', () => {
  const st = { tasks: [task({ title: '오늘 1', createdAt: 100 }), task({ title: '그제', due: '2026-11-15', createdAt: 50 }), task({ title: '어제', due: '2026-11-16', createdAt: 10 }), task({ title: '끝낸 어제', due: '2026-11-16', done: true })] };
  const prev = P.carryOver(st, TODAY, NOW);
  assert.deepStrictEqual(prev.map((p) => p.due), ['2026-11-15', '2026-11-16'], '되돌리기용 옛 날짜');
  assert.deepStrictEqual(P.dayTasks(st.tasks, TODAY).map((t) => t.title), ['그제', '어제', '오늘 1']);
  assert.strictEqual(P.overdue(st.tasks, TODAY).length, 0);
  assert.strictEqual(st.tasks[3].due, '2026-11-16', '끝낸 일은 그대로');
  const id = st.tasks[1].id;
  P.moveTask(st, id, '2026-11-18', NOW);
  P.moveTask(st, st.tasks[0].id, '2026-11-18', NOW + 1);
  assert.deepStrictEqual(P.dayTasks(st.tasks, '2026-11-18').map((t) => t.title), ['그제', '오늘 1']);
  P.moveTask(st, id, null, NOW);
  assert.strictEqual(st.tasks[1].due, null, '날짜 안 정함으로');
});

test('플래너: 반복 할 일은 날마다 한 줄씩 (요일·끝나는 날·최대 개수)', () => {
  assert.deepStrictEqual(P.repeatDates(TODAY, [1, 3, 5], '2026-11-30'), ['2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27', '2026-11-30']);
  assert.strictEqual(P.repeatDates(TODAY, [0, 1, 2, 3, 4, 5, 6], '2026-11-23').length, 7);
  assert.deepStrictEqual(P.repeatDates(TODAY, [2], ''), [TODAY], '끝나는 날이 없으면 그날만');
  assert.strictEqual(P.repeatDates(TODAY, [0, 1, 2, 3, 4, 5, 6], '2027-12-31').length, P.REP_MAX);
  assert.strictEqual(P.repText({ days: [0, 1, 2, 3, 4, 5, 6] }), '매일');
  assert.strictEqual(P.repText({ days: [1, 2, 3, 4, 5] }), '평일마다');
  assert.strictEqual(P.repText({ days: [0, 6] }), '주말마다');
  assert.strictEqual(P.repText({ days: [5, 1, 3] }), '월·수·금마다');
  assert.strictEqual(P.repText({ days: [3] }), '수요일마다');
  assert.strictEqual(P.defaultUntil(TODAY, [{ date: '2026-11-30' }]), '2026-11-29', '시험 전날까지');
  assert.strictEqual(P.defaultUntil(TODAY, []), '2026-12-14', '시험이 없으면 4주');
  const list = P.makeTasks({ title: '  영어   단어 ', subjectId: 'en', due: TODAY, estimateMin: '30', rep: { days: [0, 1, 2, 3, 4, 5, 6], until: '2026-11-19' } }, env());
  assert.deepStrictEqual(list.map((t) => t.due), [TODAY, '2026-11-18', '2026-11-19']);
  assert.ok(list.every((t) => t.title === '영어 단어' && t.estimateMin === 30 && t.rep.id === list[0].rep.id && t.rep.days.length === 7));
  assert.strictEqual(new Set(list.map((t) => t.id)).size, 3);
  assert.deepStrictEqual(P.makeTasks({ title: '   ' }, env()), [], '이름이 없으면 만들지 않음');
  const one = P.makeTasks({ title: '수학', due: 'nope', estimateMin: 0, topicId: 'a1' }, env())[0];
  assert.strictEqual(one.due, null);
  assert.strictEqual(one.estimateMin, null);
  assert.strictEqual(one.topicId, 'a1');
});

test('플래너: 반복 할 일 고치기 — 이 날만 / 이 날부터 앞으로', () => {
  const st = { tasks: P.makeTasks({ title: '단어', due: '2026-11-16', rep: { days: [0, 1, 2, 3, 4, 5, 6], until: '2026-11-19' } }, env()), sessions: [] };
  const [, t2, t3] = st.tasks;
  assert.deepStrictEqual(P.seriesFrom(st.tasks, t2).map((t) => t.due), ['2026-11-17', '2026-11-18', '2026-11-19']);
  assert.strictEqual(P.editTask(st, t2.id, { title: '단어 100개', estimateMin: 40 }, NOW, true), 3);
  assert.deepStrictEqual(st.tasks.map((t) => t.title), ['단어', '단어 100개', '단어 100개', '단어 100개']);
  P.editTask(st, t3.id, { title: '쉬기', due: '2026-11-25' }, NOW, false);
  assert.strictEqual(t3.title, '쉬기');
  assert.strictEqual(t3.due, '2026-11-25');
  assert.strictEqual(st.tasks[3].title, '단어 100개');
});

test('플래너: 끝낸 할 일의 예상 시간을 고치면 오늘 넣은 공부 기록도 맞춘다', () => {
  const st = { tasks: [task({ estimateMin: 30 })], sessions: [], topics: [] };
  P.setDone(st, st.tasks[0].id, true, NOW, uid);
  assert.strictEqual(credits(st), 30);
  P.editTask(st, st.tasks[0].id, { estimateMin: 45, subjectId: 'math' }, NOW, false);
  assert.strictEqual(credits(st), 45);
  assert.strictEqual(st.sessions[0].subjectId, 'math');
  P.editTask(st, st.tasks[0].id, { estimateMin: '' }, NOW, false);
  assert.strictEqual(st.sessions.length, 0, '예상 시간을 지우면 넣은 시간도 뺌');
});

test('플래너: 끝냄 — 예상 시간이 공부 기록에, 날짜 없는 일은 끝낸 날로', () => {
  const st = { tasks: [task({ estimateMin: 40, due: null })], sessions: [], topics: [] };
  const t = st.tasks[0];
  const r = P.setDone(st, t.id, true, NOW, uid);
  assert.deepStrictEqual([r.changed, r.added, r.ids.length, r.topic], [true, 40, 1, null]);
  assert.strictEqual(t.due, TODAY);
  assert.strictEqual(P.setDone(st, t.id, true, NOW, uid).changed, false, '이미 끝냄');
  const u = P.setDone(st, t.id, false, NOW, uid);
  assert.strictEqual(u.removed, 40);
  assert.strictEqual(st.sessions.length, 0);
  assert.strictEqual(P.setDone(st, 'nope', true, NOW, uid), null);
});

test('플래너: 범위와 이은 할 일을 끝내면 범위도 체크, 공부 시간은 한 번만', () => {
  const st = scopeState();
  const t = P.topicTask(st, 'a1', TODAY, env());
  assert.strictEqual(t.title, '3단원 · 개념', '과목 이름과 같은 카드 이름은 빼고 바로 위 단계를 앞에');
  assert.strictEqual(t.subjectId, 'math');
  assert.strictEqual(t.estimateMin, 30);
  st.tasks.push(t);
  const r = P.setDone(st, t.id, true, NOW, uid);
  assert.strictEqual(r.topic, 'a1');
  assert.ok(st.topics.find((x) => x.id === 'a1').done, '범위도 체크');
  assert.strictEqual(credits(st), 30, '할 일 예상 시간 한 번만');
  // 범위 쪽 계산이 다시 돌아도 두 번 넣지 않는다
  assert.strictEqual(Stats.creditTopic(st, st.topics.find((x) => x.id === 'a1'), NOW, 'again'), null);
  // 끝냄을 풀면 범위 체크도 풀리고 넣은 시간도 빠진다
  const u = P.setDone(st, t.id, false, NOW, uid);
  assert.strictEqual(u.removed, 30);
  assert.ok(!st.topics.find((x) => x.id === 'a1').done);
  assert.strictEqual(credits(st), 0);
});

test('플래너: 예상 시간 없는 할 일이면 범위의 소요시간으로, 잰 기록이 있으면 넣지 않음', () => {
  const st = scopeState();
  const t = P.topicTask(st, 'a1', TODAY, env());
  t.estimateMin = null;
  st.tasks.push(t);
  P.setDone(st, t.id, true, NOW, uid);
  assert.strictEqual(credits(st), 30, '범위 소요시간');
  P.setDone(st, t.id, false, NOW, uid);
  assert.strictEqual(credits(st), 0);
  st.sessions.push({ id: 'sw1', kind: 'stopwatch', taskId: t.id, minutes: 25, endedAt: NOW - 60000 });
  P.setDone(st, t.id, true, NOW, uid);
  assert.strictEqual(credits(st), 0, '스톱워치로 잰 할 일은 더 넣지 않음');
  assert.strictEqual(P.taskMinutes(st.sessions, t), 25);
});

test('플래너: 단원 전체를 이은 할 일 — 하위 항목 모두 체크, 할 일 시간만 한 번', () => {
  const st = scopeState();
  const t = P.topicTask(st, 'g1', '2026-11-18', env());
  assert.strictEqual(t.title, '3단원');
  assert.strictEqual(t.estimateMin, 40, '남은 소요시간 30 + 20의 반');
  st.tasks.push(t);
  P.setDone(st, t.id, true, NOW, uid);
  assert.ok(['a1', 'a2'].every((id) => st.topics.find((x) => x.id === id).done));
  assert.strictEqual(credits(st), 40);
  assert.strictEqual(P.topicComplete(st.topics, 'g1'), true);
  assert.strictEqual(P.topicComplete(st.topics, 'nope'), null);
});

test('플래너: 범위에서 체크하면 이은 할 일도 끝냄, 풀면 다시 (같은 범위의 할 일 모두)', () => {
  const st = scopeState();
  const t1 = P.topicTask(st, 'a1', TODAY, env()), t2 = P.topicTask(st, 'a1', '2026-11-20', env()), t3 = P.topicTask(st, 'g1', '2026-11-21', env());
  st.tasks.push(t1, t2, t3);
  let before = P.linkState(st);
  require('../js/scope.js').setDone(st.topics, 'a1', true, NOW);
  let r = P.syncLinked(st, before, NOW);
  assert.deepStrictEqual(r.done.sort(), [t1.id, t2.id].sort());
  assert.ok(!t3.done, '단원 전체는 아직');
  before = P.linkState(st);
  require('../js/scope.js').setDone(st.topics, 'a2', true, NOW);
  r = P.syncLinked(st, before, NOW);
  assert.deepStrictEqual(r.done, [t3.id], '단원의 하위 항목이 모두 끝나면 단원 할 일도');
  // 플래너에서 한 할 일을 풀면 같은 범위의 다른 할 일도 풀린다
  P.setDone(st, t1.id, false, NOW, uid);
  assert.ok(!t2.done && !t3.done, '범위가 풀려서 이은 할 일도 모두 풀림');
  // 지운 범위와 이은 할 일은 건드리지 않는다
  t2.done = true;
  before = P.linkState(st);
  st.topics = st.topics.filter((x) => x.id !== 'a1');
  r = P.syncLinked(st, before, NOW);
  assert.ok(t2.done);
});

test('플래너: 범위에서 고르기 목록과 줄 색', () => {
  const st = scopeState();
  st.exams.push({ id: 'old', name: '지난 시험', date: '2026-11-01' });
  st.topics.push({ id: 'x1', examId: 'old', parentId: null, title: '국어' }, { id: 'x2', examId: 'old', parentId: 'x1', title: '문학' });
  st.tasks.push(task({ topicId: 'a2', due: '2026-11-20' }));
  const g = P.scopeChoices(st, TODAY);
  assert.strictEqual(g.length, 1, '지난 시험은 빼기');
  assert.strictEqual(g[0].days, 13);
  const items = g[0].cards[0].items;
  assert.deepStrictEqual(items.map((i) => i.n.id), ['a1', 'a2', 'b1']);
  assert.deepStrictEqual(items.map((i) => i.left), [30, 10, 0]);
  assert.deepStrictEqual(items[0].path, ['3단원']);
  assert.deepStrictEqual(items.map((i) => i.planned), [null, '2026-11-20', null]);
  assert.strictEqual(P.taskColor(st, { subjectId: 'math' }), '#4a7fd4');
  assert.strictEqual(P.taskColor(st, { subjectId: null, topicId: 'a1' }), '#123456', '과목이 없으면 범위 카드 색');
  assert.strictEqual(P.taskColor(st, { subjectId: null }), '');
});

test('플래너: 날짜별 목표·메모', () => {
  const st = {};
  P.setNote(st, TODAY, { goal: '  수학   3단원 끝내기 ' });
  assert.deepStrictEqual(P.noteOf(st, TODAY), { goal: '수학 3단원 끝내기', memo: '' });
  P.setNote(st, TODAY, { memo: '집중이 잘 됐다' });
  assert.deepStrictEqual(st.planner[TODAY], { goal: '수학 3단원 끝내기', memo: '집중이 잘 됐다' });
  P.setNote(st, TODAY, { goal: '', memo: '  ' });
  assert.ok(!(TODAY in st.planner), '둘 다 비면 그날 칸을 지움');
  P.setNote(st, 'bad', { goal: 'x' });
  assert.deepStrictEqual(st.planner, {});
});

test('플래너: 그날 공부 시간과 할 일 한 줄의 시간', () => {
  const sessions = [
    { minutes: 30, endedAt: NOW - 3600000, taskId: 'k1' },
    { minutes: 20, endedAt: NOW - 86400000 },
    { minutes: 15, endedAt: NOW, topicId: 'a1' },
    { minutes: 0, endedAt: NOW },
  ];
  assert.strictEqual(P.studyMinutes(sessions, TODAY), 45);
  assert.strictEqual(P.taskMinutes(sessions, { id: 'k1' }), 30);
  assert.strictEqual(P.taskMinutes(sessions, { id: 'k2', topicId: 'a1' }), 15, '이은 범위로 잰 기록');
});

/* ---------- v3.10: 세모(△), 장소·시간, 옮기기, 복습 줄 ---------- */
test('플래너 3.10: 진행 칸 빈칸 → ○ → △ → 빈칸, ○만 공부 시간에', () => {
  const st = scopeState();
  const t = task({ estimateMin: 30, subjectId: 'math' });
  st.tasks.push(t);
  assert.strictEqual(P.markOf(t), '');
  assert.strictEqual(P.nextMark(''), 'o');
  assert.strictEqual(P.nextMark('o'), 't');
  assert.strictEqual(P.nextMark('t'), '');
  let r = P.setMark(st, t.id, 'o', NOW, uid);
  assert.strictEqual(P.markOf(t), 'o');
  assert.strictEqual(r.added, 30);
  assert.strictEqual(credits(st), 30);
  r = P.setMark(st, t.id, 't', NOW, uid);
  assert.strictEqual(P.markOf(t), 't');
  assert.strictEqual(t.done, false);
  assert.strictEqual(r.removed, 30, '○를 풀면 넣은 시간을 뺀다');
  assert.strictEqual(credits(st), 0, '△는 공부 시간에 안 넣는다');
  assert.strictEqual(r.prev, 'o');
  r = P.setMark(st, t.id, '', NOW, uid);
  assert.strictEqual(P.markOf(t), '');
  assert.ok(!('part' in t));
  assert.strictEqual(r.changed, true);
  r = P.setMark(st, t.id, '', NOW, uid);
  assert.strictEqual(r.changed, false);
  // △에서 바로 끝내면 세모는 지운다
  P.setMark(st, t.id, 't', NOW, uid);
  P.setDone(st, t.id, true, NOW, uid);
  assert.ok(!('part' in t));
  assert.strictEqual(P.markOf(t), 'o');
  assert.strictEqual(P.setMark(st, 'nope', 'o', NOW, uid), null);
  // 요약에 세모 수
  st.tasks.push(task({ part: true }), task({ done: true }));
  const sum = P.daySummary(st.tasks, TODAY);
  assert.strictEqual(sum.part, 1);
  assert.strictEqual(sum.done, 2);
});

test('플래너 3.10: 범위와 이은 할 일을 △로 바꾸면 범위 체크도 풀린다', () => {
  const st = scopeState();
  const t = task({ topicId: 'a1' });
  st.tasks.push(t);
  P.setMark(st, t.id, 'o', NOW, uid);
  assert.ok(st.topics.find((x) => x.id === 'a1').done);
  P.setMark(st, t.id, 't', NOW, uid);
  assert.ok(!st.topics.find((x) => x.id === 'a1').done);
  assert.strictEqual(P.markOf(t), 't');
});

test('플래너 3.10: 장소·시간 목록과 고르기', () => {
  const st = scopeState();
  const t = task();
  st.tasks.push(t);
  assert.deepStrictEqual(P.slotList(st).map((x) => x.name), P.DEFAULT_SLOTS, '처음엔 기본 목록');
  assert.ok(!('slots' in st), '보기만 해서는 적지 않는다');
  assert.strictEqual(P.setSlot(st, t.id, 'slot3'), true);
  assert.strictEqual(t.slotId, 'slot3');
  assert.ok(Array.isArray(st.slots), '고르면 목록을 적어 둔다');
  assert.strictEqual(P.slotOf(st, t).name, '독서실');
  assert.strictEqual(P.setSlot(st, t.id, 'slot3'), false);
  assert.strictEqual(P.setSlot(st, t.id, 'nope'), true, '없는 장소면 비운다');
  assert.ok(!('slotId' in t));
  const a = P.addSlot(st, '  학원   끝나고 ', uid);
  assert.strictEqual(a.name, '학원 끝나고');
  assert.strictEqual(P.addSlot(st, '집', uid).id, 'slot4', '같은 이름이면 있던 것');
  assert.strictEqual(P.addSlot(st, '   ', uid), null);
  P.setSlot(st, t.id, a.id);
  assert.ok(P.moveSlot(st, a.id, 0));
  assert.strictEqual(P.slotList(st)[0].id, a.id);
  assert.ok(P.renameSlot(st, a.id, '학원 뒤'));
  assert.strictEqual(P.slotOf(st, t).name, '학원 뒤');
  assert.strictEqual(P.removeSlot(st, a.id), 1, '지우면 고른 할 일도 비운다');
  assert.ok(!('slotId' in t));
});

test('플래너 3.10: 정렬 — 기본은 과목 순, 장소를 하나라도 정하면 장소 순(안 정한 일은 맨 아래)', () => {
  const st = scopeState();
  st.subjects = [{ id: 'math', name: '수학' }, { id: 'eng', name: '영어' }, { id: 'econ', name: '경제' }];
  const a = task({ title: 'a', subjectId: 'econ', createdAt: 1 });
  const b = task({ title: 'b', subjectId: 'math', createdAt: 2 });
  const c = task({ title: 'c', subjectId: null, createdAt: 3 });
  const d = task({ title: 'd', subjectId: 'eng', createdAt: 4 });
  const e = task({ title: 'e', subjectId: 'math', createdAt: 5 });
  st.tasks.push(a, b, c, d, e);
  let r = P.dayList(st, TODAY);
  assert.strictEqual(r.by, 'subject');
  assert.deepStrictEqual(r.list.map((t) => t.title), ['b', 'e', 'd', 'a', 'c']);
  P.setSlot(st, a.id, 'slot1'); // 야자1
  P.setSlot(st, e.id, 'slot4'); // 집
  P.setSlot(st, d.id, 'slot1');
  r = P.dayList(st, TODAY);
  assert.strictEqual(r.by, 'slot');
  assert.deepStrictEqual(r.list.map((t) => t.title), ['d', 'a', 'e', 'b', 'c'], '장소 순서 → 과목 순서, 안 정한 일은 맨 아래');
  P.moveSlot(st, 'slot4', 0);
  assert.deepStrictEqual(P.dayList(st, TODAY).list.map((t) => t.title), ['e', 'd', 'a', 'b', 'c'], '목록 순서를 바꾸면 정렬도');
});

test('플래너 3.10: 어제 못 끝낸 일 고르기 — 고른 것만, 세모·장소·잰 시간 같이, 처음 날짜 남김', () => {
  const st = scopeState();
  const Y = '2026-11-16', Y2 = '2026-11-15';
  const a = task({ title: '세모', due: Y, part: true, slotId: 'slot3' });
  const b = task({ title: '빈칸', due: Y });
  const c = task({ title: '끝냄', due: Y, done: true });
  const d = task({ title: '영단어', due: Y, rep: { id: 'R', days: [0, 1, 2, 3, 4, 5, 6] } });
  const d2 = task({ title: '영단어', due: TODAY, rep: { id: 'R', days: [0, 1, 2, 3, 4, 5, 6] } });
  const f = task({ title: '빈칸', due: Y2 });
  st.tasks.push(a, b, c, d, d2, f);
  st.sessions.push({ id: 'x', minutes: 25, endedAt: NOW - 86400000, taskId: a.id });
  const ch = P.carryChoices(st, TODAY);
  assert.deepStrictEqual(ch.map((o) => [o.t.title, o.t.due, o.on]), [['세모', Y, true], ['빈칸', Y, true], ['영단어', Y, false], ['빈칸', Y2, false]],
    '최근 날부터, 오늘에 같은 반복이 있거나 더 최근 날에 같은 일이 있으면 꺼 둔다');
  const prev = P.carryOver(st, TODAY, NOW, [a.id, b.id]);
  assert.strictEqual(prev.length, 2);
  assert.strictEqual(a.due, TODAY);
  assert.strictEqual(a.part, true);
  assert.strictEqual(a.slotId, 'slot3');
  assert.strictEqual(a.from, Y);
  assert.strictEqual(P.taskMinutes(st.sessions, a), 25, '잰 시간도 그대로 할 일에');
  assert.strictEqual(d.due, Y, '고르지 않은 일은 그대로');
  assert.strictEqual(P.fromText(a, TODAY), '어제부터');
  // 4.3.1: 오늘로 옮긴 '빈칸'이 있으니 그제의 '빈칸'은 그 줄에 합쳐지고, 처음 날짜는 더 이른 그제
  const pf = P.carryOver(st, TODAY, NOW, [f.id]);
  assert.strictEqual(pf[0].merged.into, b.id);
  assert.ok(!st.tasks.some((t) => t.id === f.id), '같은 일은 한 줄만');
  assert.strictEqual(P.dayTasks(st.tasks, TODAY).filter((t) => t.title === '빈칸').length, 1);
  assert.strictEqual(P.fromText(b, TODAY), '11/15부터');
  P.restoreMoves(st, pf);
  assert.strictEqual(st.tasks.find((t) => t.id === f.id).due, Y2, '되돌리면 그제 일도 제자리');
  assert.strictEqual(b.from, Y);
  P.restoreMoves(st, prev);
  assert.strictEqual(a.due, Y);
  assert.ok(!('from' in a), '되돌리면 처음 날짜도 지운다');
  assert.strictEqual(P.fromText(a, TODAY), '');
});

test('플래너 4.3.1: 두 날에 넣은 같은 일을 옮겨도 한 줄 — 합치고, 되돌리면 그대로', () => {
  const Y = '2026-11-16', TM = '2026-11-18';
  // 사용자 사례: 범위에서 어제와 오늘에 같은 항목('14회 · 분석')을 넣고 어제 것을 오늘로
  const st = scopeState();
  const y = P.topicTask(st, 'a1', Y, { uid, now: 1 });
  const t = P.topicTask(st, 'a1', TODAY, { uid, now: 2 });
  const other = task({ title: '다른 일', due: TODAY });
  y.part = true;
  y.slotId = 'slot3';
  t.estimateMin = null;
  st.tasks.push(other, y, t);
  st.sessions.push({ id: 's1', minutes: 25, endedAt: NOW - 86400000, taskId: y.id, subjectId: 'math' });
  st.events.push({ id: 'ev1', kind: 'study', title: '', taskId: y.id, date: Y, start: '19:00', end: '20:00' });
  assert.ok(P.sameTask(y, t));
  const ch = P.carryChoices(st, TODAY);
  assert.deepStrictEqual(ch.map((o) => [o.t.id, o.on, o.merge]), [[y.id, false, true]], '오늘에도 있으니 처음엔 꺼 두고, 옮기면 합쳐진다고 알림');
  const before = JSON.stringify(st);
  const prev = P.carryOver(st, TODAY, NOW, [y.id]);
  assert.strictEqual(prev.length, 1);
  assert.strictEqual(prev[0].merged.into, t.id);
  assert.deepStrictEqual(P.dayTasks(st.tasks, TODAY).map((x) => x.id), [t.id, other.id], '오늘엔 같은 일이 한 줄만 (원래 자리)');
  assert.ok(!st.tasks.some((x) => x.id === y.id));
  assert.strictEqual(P.fromText(t, TODAY), '어제부터');
  assert.strictEqual(t.part, true, '세모도 같이');
  assert.strictEqual(t.slotId, 'slot3', '정해 둔 장소도');
  assert.strictEqual(t.estimateMin, 30, '예상 시간이 없으면 옮긴 쪽 것');
  assert.strictEqual(st.sessions[0].taskId, t.id, '어제 잰 시간도 남은 줄로');
  assert.strictEqual(st.events[0].taskId, t.id, '타임테이블 일정도');
  assert.strictEqual(P.overdue(st.tasks, TODAY).length, 0);
  P.restoreMoves(st, prev);
  assert.strictEqual(JSON.stringify(st), before, '되돌리면 두 날 모두 원래대로');

  // ⋯ '오늘로'·'내일로 미루기'(moveTask)도 같게. 장소·세모는 남는 줄에 이미 있으면 그대로
  t.slotId = 'slot1';
  const before2 = JSON.stringify(st);
  const p2 = P.moveTask(st, y.id, TODAY, NOW);
  assert.strictEqual(p2.merged.into, t.id);
  assert.strictEqual(t.slotId, 'slot1');
  assert.strictEqual(t.from, Y);
  assert.strictEqual(P.dayTasks(st.tasks, TODAY).length, 2);
  P.restoreMoves(st, [p2]);
  assert.strictEqual(JSON.stringify(st), before2);
  const tm = P.topicTask(st, 'a1', TM, { uid, now: 3 });
  st.tasks.push(tm);
  const p3 = P.moveTask(st, t.id, TM, NOW);
  assert.strictEqual(p3.merged.into, tm.id, '내일에 같은 일이 있으면 내일 줄로 합침');
  assert.strictEqual(tm.from, TODAY);
  assert.strictEqual(P.dayTasks(st.tasks, TM).length, 1);
  P.restoreMoves(st, [p3]);
  assert.strictEqual(P.dayTasks(st.tasks, TODAY).filter((x) => x.topicId === 'a1').length, 1);

  // 합치지 않는 경우: 다른 범위 항목, 끝낸 일, 고치기 창에서 날짜 바꾸기, 날짜 안 정함
  const st2 = scopeState();
  const a = P.topicTask(st2, 'a1', Y, { uid, now: 1 });
  const b = P.topicTask(st2, 'a2', TODAY, { uid, now: 2 });
  b.title = a.title;
  st2.tasks.push(a, b);
  assert.ok(!P.sameTask(a, b), '이름이 같아도 다른 범위 항목이면 다른 일');
  assert.ok(!P.moveTask(st2, a.id, TODAY, NOW).merged);
  assert.strictEqual(P.dayTasks(st2.tasks, TODAY).length, 2);
  const d1 = task({ title: '단어', due: TODAY, done: true }), d2 = task({ title: '단어', due: Y });
  const e1 = task({ title: '숙제', due: TODAY }), e2 = task({ title: '숙제', due: Y });
  const n1 = task({ title: '노트', due: null }), n2 = task({ title: '노트', due: TODAY });
  st2.tasks.push(d1, d2, e1, e2, n1, n2);
  assert.ok(!P.moveTask(st2, d2.id, TODAY, NOW).merged, '오늘 것을 이미 끝냈으면 합치지 않음');
  P.editTask(st2, e2.id, { due: TODAY }, NOW);
  assert.strictEqual(P.dayTasks(st2.tasks, TODAY).filter((x) => x.title === '숙제').length, 2, '고치기 창은 그대로');
  assert.ok(!P.moveTask(st2, n2.id, null, NOW).merged, '날짜 안 정함으로는 합치지 않음');
  // 반복 묶음은 이름을 고쳤어도 같은 일, 과목이 다르면 이름이 같아도 다른 일
  assert.ok(P.sameTask(task({ title: 'A', rep: { id: 'R' } }), task({ title: 'B', rep: { id: 'R' } })));
  assert.ok(!P.sameTask(task({ title: 'A', subjectId: 'x' }), task({ title: 'A', subjectId: 'y' })));

  // 여러 날에 같은 일이 남아 있으면 모두 골라 옮겨도 한 줄, 처음 날짜는 가장 이른 날
  const st3 = scopeState();
  const o1 = task({ title: '영단어', due: '2026-11-14' }), o2 = task({ title: '영단어', due: Y });
  st3.tasks.push(o1, o2);
  const ch3 = P.carryChoices(st3, TODAY);
  assert.deepStrictEqual(ch3.map((o) => [o.t.id, o.on, o.merge]), [[o2.id, true, false], [o1.id, false, false]]);
  const p4 = P.carryOver(st3, TODAY, NOW, [o1.id, o2.id]);
  assert.strictEqual(P.dayTasks(st3.tasks, TODAY).length, 1);
  assert.strictEqual(P.dayTasks(st3.tasks, TODAY)[0].from, '2026-11-14');
  P.restoreMoves(st3, p4);
  assert.deepStrictEqual(st3.tasks.map((x) => x.due), ['2026-11-14', Y]);
  assert.ok(st3.tasks.every((x) => !('from' in x)));
});

test('플래너 3.10: 미루기 — 오늘·지난 일을 뒤로 옮기면 처음 날짜, 앞날끼리 옮기거나 되돌리면 없음', () => {
  const st = scopeState();
  const t = task({ due: TODAY });
  st.tasks.push(t);
  P.moveTask(st, t.id, '2026-11-18', NOW);
  assert.strictEqual(t.from, TODAY);
  assert.strictEqual(P.fromText(t, TODAY), '11/17부터', '앞날 칸에서는 날짜로');
  assert.strictEqual(P.fromText(t, '2026-11-18'), '어제부터', '그날이 오늘이 되면 어제부터');
  P.moveTask(st, t.id, '2026-11-20', NOW);
  assert.strictEqual(t.from, TODAY, '처음 날짜는 그대로');
  P.moveTask(st, t.id, TODAY, NOW);
  assert.ok(!('from' in t), '처음 날로 되돌리면 지움');
  const u = task({ due: '2026-11-25' });
  st.tasks.push(u);
  P.moveTask(st, u.id, '2026-11-26', NOW);
  assert.ok(!('from' in u), '앞날끼리 옮긴 건 미룬 일이 아님');
  const v = task({ due: '2026-11-16' });
  st.tasks.push(v);
  P.moveTask(st, v.id, null, NOW);
  assert.ok(!('from' in v), '날짜 안 정함으로 보내면 없음');
});

test('플래너 3.10: 복습 줄 — 수업 요일에만, 이름 누르면 체크, 날짜별로 남음', () => {
  const st = scopeState();
  const a = P.addTeacher(st, { name: ' 수탁 ', subjectId: 'math', days: [1, 2, 4, 5] }, uid);
  const b = P.addTeacher(st, { name: '서김' }, uid);
  const c = P.addTeacher(st, { name: '역김', subjectId: 'nope', days: [2, 4] }, uid);
  assert.strictEqual(P.addTeacher(st, { name: '  ' }, uid), null);
  assert.strictEqual(a.name, '수탁');
  assert.deepStrictEqual(b.days, [1, 2, 3, 4, 5], '요일을 안 고르면 평일');
  assert.strictEqual(c.subjectId, null, '없는 과목은 비움');
  const WED = '2026-11-18', THU = '2026-11-19', SUN = '2026-11-22';
  assert.deepStrictEqual(P.teachersOn(st, WED).map((t) => t.name), ['서김']);
  assert.deepStrictEqual(P.teachersOn(st, THU).map((t) => t.name), ['수탁', '서김', '역김']);
  assert.deepStrictEqual(P.teachersOn(st, SUN), []);
  assert.strictEqual(P.toggleReview(st, THU, a.id), true);
  assert.strictEqual(P.toggleReview(st, THU, c.id), true);
  assert.deepStrictEqual(P.reviewedOn(st, THU), [a.id, c.id]);
  assert.strictEqual(P.toggleReview(st, THU, c.id), false);
  assert.deepStrictEqual(P.reviewedOn(st, THU), [a.id]);
  assert.strictEqual(P.toggleReview(st, THU, 'nope'), false);
  // 목표·메모를 지워도 복습 체크는 남는다
  P.setNote(st, THU, { goal: '목표' });
  P.setNote(st, THU, { goal: '' });
  assert.deepStrictEqual(st.planner[THU], { rv: [a.id] });
  P.toggleReview(st, THU, a.id, false);
  assert.ok(!(THU in st.planner), '다 비면 그날 칸을 지움');
  // 요일을 바꿔도 그날 체크한 선생님은 그날 줄에 남는다
  P.toggleReview(st, THU, c.id, true);
  P.editTeacher(st, c.id, { days: [1] });
  assert.ok(P.teachersOn(st, THU).some((t) => t.id === c.id));
  assert.ok(P.editTeacher(st, a.id, { name: '수학탁', subjectId: '' }));
  assert.strictEqual(P.teacherList(st)[0].name, '수학탁');
  assert.strictEqual(P.teacherList(st)[0].subjectId, null);
  assert.ok(P.moveTeacher(st, c.id, 0));
  assert.strictEqual(P.teacherList(st)[0].id, c.id);
  assert.ok(P.removeTeacher(st, c.id));
  assert.ok(!P.teachersOn(st, THU).some((t) => t.id === c.id), '지우면 안 나옴');
});
