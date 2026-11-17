const test = require('node:test');
const assert = require('node:assert');
const SRS = require('../js/srs.js');
const Stats = require('../js/stats.js');
const StoreLib = require('../js/store.js');

const NOW = new Date(2026, 10, 7, 15, 0).getTime();
const DAY = SRS.DAY;

test('SM-2: 새 카드를 "보통"으로 맞히면 1일 → 3일 → 약 8일', () => {
  let c = SRS.newCard({ id: 'a' }, NOW);
  c = SRS.review(c, 'good', NOW);
  assert.strictEqual(c.interval, 1);
  assert.strictEqual(c.reps, 1);
  c = SRS.review(c, 'good', NOW + DAY);
  assert.strictEqual(c.interval, 3);
  c = SRS.review(c, 'good', NOW + 4 * DAY);
  assert.ok(c.interval >= 7 && c.interval <= 8);
});

test('SM-2: "다시"는 반복을 초기화하고 오늘 다시 보이게 한다', () => {
  let c = SRS.newCard({}, NOW);
  c = SRS.review(c, 'good', NOW);
  c = SRS.review(c, 'good', NOW);
  c = SRS.review(c, 'again', NOW);
  assert.strictEqual(c.reps, 0);
  assert.strictEqual(c.interval, 0);
  assert.strictEqual(c.lapses, 1);
  assert.ok(SRS.isDue(c, NOW));
  assert.ok(c.ease < 2.5);
});

test('SM-2: ease는 1.3 아래로 내려가지 않는다', () => {
  let c = SRS.newCard({}, NOW);
  for (let i = 0; i < 20; i++) c = SRS.review(c, 'again', NOW);
  assert.strictEqual(c.ease, 1.3);
});

test('SM-2: "쉬움"은 "보통"보다 간격이 길다', () => {
  let c = SRS.newCard({}, NOW);
  c = SRS.review(c, 'good', NOW);
  c = SRS.review(c, 'good', NOW);
  const good = SRS.review(c, 'good', NOW);
  const easy = SRS.review(c, 'easy', NOW);
  const hard = SRS.review(c, 'hard', NOW);
  assert.ok(easy.interval > good.interval);
  assert.ok(hard.interval < good.interval);
});

test('SM-2: due는 자정 기준 interval일 뒤', () => {
  const c = SRS.review(SRS.newCard({}, NOW), 'good', NOW);
  assert.strictEqual(c.due, SRS.startOfDay(NOW) + DAY);
  assert.ok(!SRS.isDue(c, NOW));
  assert.ok(SRS.isDue(c, SRS.startOfDay(NOW) + DAY));
});

test('통계: 최근 7일 합계와 오늘 공부 시간', () => {
  const sessions = [
    { minutes: 25, endedAt: NOW },
    { minutes: 25, endedAt: NOW - 1000 },
    { minutes: 50, endedAt: NOW - 2 * DAY },
    { minutes: 99, endedAt: NOW - 10 * DAY },
  ];
  const days = Stats.lastNDays(sessions, NOW, 7);
  assert.strictEqual(days.length, 7);
  assert.strictEqual(days[6].label, '오늘');
  assert.strictEqual(days[6].minutes, 50);
  assert.strictEqual(days[4].minutes, 50);
  assert.strictEqual(days.reduce((a, d) => a + d.minutes, 0), 100);
  assert.strictEqual(Stats.minutesOn(sessions, NOW), 50);
});

test('통계: 연속 학습일', () => {
  const k = (n) => Stats.dayKey(NOW - n * DAY);
  assert.strictEqual(Stats.streak([k(0), k(1), k(2), k(4)], NOW), 3);
  // 오늘 아직 안 했어도 어제까지 이어졌으면 유지
  assert.strictEqual(Stats.streak([k(1), k(2)], NOW), 2);
  assert.strictEqual(Stats.streak([k(2)], NOW), 0);
  assert.strictEqual(Stats.streak([], NOW), 0);
});

test('통계: 시간 표시 형식', () => {
  assert.strictEqual(Stats.formatMinutes(45), '45분');
  assert.strictEqual(Stats.formatMinutes(60), '1시간');
  assert.strictEqual(Stats.formatMinutes(135), '2시간 15분');
});

function memoryStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => (m[k] = String(v)) };
}

test('저장소: 저장 후 다시 불러오면 유지된다', () => {
  const storage = memoryStorage();
  const s1 = StoreLib.createStore(storage);
  s1.update((st) => st.tasks.push({ id: 't1', title: '수학 문제집 3단원' }));
  const s2 = StoreLib.createStore(storage);
  assert.strictEqual(s2.get().tasks[0].title, '수학 문제집 3단원');
});

test('저장소: 내보내기/가져오기 왕복, 잘못된 파일 거부', () => {
  const a = StoreLib.createStore(memoryStorage());
  a.update((st) => st.cards.push({ id: 'c1', front: 'apple', back: '사과' }));
  const b = StoreLib.createStore(memoryStorage());
  b.importJSON(a.exportJSON());
  assert.strictEqual(b.get().cards[0].back, '사과');
  assert.throws(() => b.importJSON('{"hello":1}'));
  assert.throws(() => b.importJSON('not json'));
  assert.strictEqual(b.get().cards.length, 1);
});

test('저장소: 깨진 데이터는 기본값으로 복구', () => {
  const storage = memoryStorage();
  storage.setItem(StoreLib.KEY, '{broken');
  const s = StoreLib.createStore(storage);
  assert.strictEqual(s.get().subjects.length, 3);
  assert.strictEqual(s.get().settings.focusMin, 25);
});

test('저장소: 이름을 바꾸기 전(studymate.v1) 데이터를 자동으로 불러온다', () => {
  const storage = memoryStorage();
  storage.setItem('studymate.v1', JSON.stringify({ tasks: [{ id: 'old', title: '예전 할 일' }] }));
  const s = StoreLib.createStore(storage);
  assert.strictEqual(s.get().tasks[0].title, '예전 할 일');
  s.update(() => {});
  assert.ok(storage.getItem(StoreLib.KEY), '새 이름으로 저장');
});

test('저장소: 되돌리기는 시험 범위만 되돌리고, 그사이 쌓인 공부 기록·카드·할 일은 그대로 둔다', () => {
  const s = StoreLib.createStore(memoryStorage());
  s.update((st) => { st.topics.push({ id: 'a', title: '1단원', done: false }); });
  s.update((st) => { st.topics[0].done = true; }, { undoable: true });
  // 체크한 뒤 타이머 기록, 카드, 할 일이 생김 (되돌리기 대상 아님)
  s.update((st) => { st.sessions.push({ id: 's1', minutes: 25, endedAt: NOW }); st.cards.push({ id: 'c1' }); st.tasks.push({ id: 't1' }); st.settings.focusMin = 50; });
  assert.ok(s.canUndo());
  assert.strictEqual(s.undo(), true);
  assert.strictEqual(s.get().topics[0].done, false, '범위 체크는 되돌아감');
  assert.strictEqual(s.get().sessions.length, 1, '공부 기록은 남음');
  assert.strictEqual(s.get().cards.length, 1);
  assert.strictEqual(s.get().tasks.length, 1);
  assert.strictEqual(s.get().settings.focusMin, 50);
  assert.strictEqual(s.undo(), false, '더 되돌릴 것 없음');
});

test('저장소: 다른 탭에서 저장한 기록을 받아 온다 (보드 위치는 이 탭 것, 되돌리기는 비움)', () => {
  const s = StoreLib.createStore(memoryStorage());
  s.update((st) => { st.boardView.e1 = { x: 1, y: 2, z: 1 }; st.topics.push({ id: 'a', done: false }); });
  s.update((st) => { st.topics[0].done = true; }, { undoable: true });
  const seen = [];
  s.subscribe((st, info) => seen.push(info && info.external));
  const other = StoreLib.defaults();
  other.tasks.push({ id: 'from-other-tab' });
  other.boardView = { e1: { x: 9, y: 9, z: 2 } };
  assert.strictEqual(s.adopt(JSON.stringify(other)), true);
  assert.strictEqual(s.get().tasks[0].id, 'from-other-tab');
  assert.deepStrictEqual(s.get().boardView.e1, { x: 1, y: 2, z: 1 });
  assert.strictEqual(s.canUndo(), false);
  assert.deepStrictEqual(seen, [true]);
  assert.strictEqual(s.adopt('{broken'), false);
  assert.strictEqual(s.adopt(null), false);
});

test('저장소: 스터디갬빗 시절(studygambit.v1) 데이터도 불러온다', () => {
  const storage = memoryStorage();
  storage.setItem('studygambit.v1', JSON.stringify({ exams: [{ id: 'e', name: '기말' }], tasks: [] }));
  assert.strictEqual(StoreLib.createStore(storage).get().exams[0].name, '기말');
});

test('최근 몇 달 공부 시간 합계와 공부한 날 수', () => {
  const now = new Date(2026, 10, 20, 12).getTime(); // 2026-11-20
  const at = (m, d) => new Date(2026, m, d, 10).getTime();
  const sessions = [
    { minutes: 30, endedAt: at(10, 1) }, { minutes: 45, endedAt: at(10, 1) }, { minutes: 60, endedAt: at(10, 15) },
    { minutes: 100, endedAt: at(9, 31) }, { minutes: 20, endedAt: at(7, 5) },
  ];
  const m = Stats.lastNMonths(sessions, now, 6);
  assert.strictEqual(m.length, 6);
  assert.deepStrictEqual(m[5], { key: '2026-11', label: '11월', year: 2026, month: 11, minutes: 135, days: 2 });
  assert.strictEqual(m[4].minutes, 100);
  assert.strictEqual(m[3].minutes, 0);
  assert.strictEqual(m[2].minutes, 20);
  // 1월에서 거꾸로 가면 작년으로 넘어간다
  const jan = Stats.lastNMonths([], new Date(2027, 0, 3).getTime(), 3);
  assert.deepStrictEqual(jan.map((x) => x.key), ['2026-11', '2026-12', '2027-01']);
});

test('월 목표 진행률과 하루 필요량', () => {
  const now = new Date(2026, 10, 11, 12).getTime(); // 11월 11일 (30일 중), 남은 날 20일
  assert.strictEqual(Stats.monthGoal(0, 100, now), null);
  const g = Stats.monthGoal(60 * 60, 15 * 60, now); // 목표 60시간, 15시간 함
  assert.strictEqual(g.pct, 25);
  assert.strictEqual(g.remaining, 45 * 60);
  assert.strictEqual(g.daysLeft, 20);
  assert.strictEqual(g.perDay, 135);
  assert.strictEqual(g.onTrack, false); // 11/30 지점이면 22시간은 했어야 함
  const done = Stats.monthGoal(600, 700, now);
  assert.strictEqual(done.done, true);
  assert.strictEqual(done.pct, 100);
});

test('월 목표 하루 페이스: 오늘 몫과 남은 양', () => {
  const now = new Date(2026, 10, 11, 12).getTime(); // 11월 11일, 남은 20일(오늘 포함), 30일짜리 달
  const g = Stats.monthGoal(60 * 60, 15 * 60 + 40, now, 40); // 어제까지 15시간, 오늘 40분
  assert.strictEqual(g.basePerDay, 120); // 60시간 ÷ 30일
  assert.strictEqual(g.todayQuota, 135); // (60-15)시간 ÷ 20일
  assert.strictEqual(g.todayLeft, 95);
});

test('월 목표: 달마다 다른 날 수(28·29·30·31일)를 반영', () => {
  const base = (y, m) => Stats.monthGoal(31 * 60, 0, new Date(y, m, 1, 9).getTime(), 0).basePerDay;
  assert.strictEqual(base(2026, 0), 60);   // 1월 31일
  assert.strictEqual(base(2026, 1), 67);   // 2월 28일 → 1860/28 = 66.4 → 67
  assert.strictEqual(base(2028, 1), 65);   // 윤년 2월 29일 → 64.1 → 65
  assert.strictEqual(base(2026, 10), 62);  // 11월 30일
  assert.strictEqual(Stats.monthGoal(600, 0, new Date(2026, 1, 28, 9).getTime(), 0).daysLeft, 1); // 2월 마지막 날
  assert.strictEqual(Stats.monthGoal(600, 0, new Date(2026, 0, 28, 9).getTime(), 0).daysLeft, 4); // 1월 28일 → 31일까지
});

test('공부 달력: 날마다 공부 시간과 진하기, 1일 앞 빈칸, 달마다 다른 날 수', () => {
  const at = (y, m, d, h) => new Date(y, m, d, h || 12).getTime();
  const sessions = [
    { minutes: 30, endedAt: at(2026, 10, 1) },
    { minutes: 45, endedAt: at(2026, 10, 1, 20) },
    { minutes: 130, endedAt: at(2026, 10, 7) },
    { minutes: 250, endedAt: at(2026, 10, 30) },
    { minutes: 40, endedAt: at(2026, 9, 31) }, // 10월
  ];
  const cal = Stats.monthCalendar(sessions, 2026, 10);
  assert.strictEqual(cal.month, 11);
  assert.strictEqual(cal.days.length, 30);
  assert.strictEqual(cal.lead, 0); // 2026-11-01은 일요일
  assert.deepStrictEqual([cal.days[0].minutes, cal.days[0].level], [75, 2]);
  assert.strictEqual(cal.days[6].level, 3);
  assert.strictEqual(cal.days[29].level, 4);
  assert.strictEqual(cal.days[1].level, 0);
  assert.deepStrictEqual([cal.total, cal.studied, cal.best], [455, 3, 250]);
  assert.strictEqual(Stats.monthCalendar([], 2026, 1).days.length, 28);
  assert.strictEqual(Stats.monthCalendar([], 2028, 1).days.length, 29);
  assert.strictEqual(Stats.monthCalendar([{ minutes: 20, endedAt: at(2026, 9, 31) }], 2026, 9).days[30].level, 1);
});

test('하루 시간표: 시간대별 조각, 자정 넘긴 기록, 직접 기록은 따로', () => {
  const at = (d, h, mi) => new Date(2026, 10, d, h, mi || 0).getTime();
  const sessions = [
    { minutes: 25, endedAt: at(9, 9, 28), subjectId: 'kor' }, // 9:03~9:28
    { minutes: 50, endedAt: at(9, 11, 20), subjectId: 'math' }, // 10:30~11:20
    { minutes: 40, endedAt: at(10, 0, 20), subjectId: 'eng' }, // 23:40~다음날 0:20
    { minutes: 90, endedAt: at(9, 12), subjectId: 'math', manual: true },
    { minutes: 30, endedAt: at(8, 15), subjectId: 'kor' }, // 다른 날
  ];
  const tl = Stats.dayTimeline(sessions, '2026-11-09');
  assert.deepStrictEqual(tl.hours.map((h) => h.hour), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  assert.deepStrictEqual(tl.hours[0].segs, [{ from: 3, to: 28, subjectId: 'kor' }]);
  assert.deepStrictEqual(tl.hours[1].segs, [{ from: 30, to: 60, subjectId: 'math' }]);
  assert.deepStrictEqual(tl.hours[2].segs, [{ from: 0, to: 20, subjectId: 'math' }]);
  assert.deepStrictEqual(tl.hours[3].segs, []);
  assert.deepStrictEqual(tl.hours[14].segs, [{ from: 40, to: 60, subjectId: 'eng' }]);
  assert.strictEqual(tl.timed, 25 + 50 + 20);
  assert.strictEqual(tl.untimed, 90);
  assert.strictEqual(tl.start, at(9, 9, 3));
  assert.strictEqual(tl.end, at(10, 0, 0));
  const next = Stats.dayTimeline(sessions, '2026-11-10');
  assert.deepStrictEqual(next.hours, [{ hour: 0, segs: [{ from: 0, to: 20, subjectId: 'eng' }] }]);
  const none = Stats.dayTimeline(sessions.slice(3, 4), '2026-11-09');
  assert.deepStrictEqual([none.hours.length, none.timed, none.untimed, none.start], [0, 0, 90, null]);
});

test('조사: 받침에 맞게 고른다 (을/를, 이/가, 과/와, 으로/로)', () => {
  assert.strictEqual(Stats.josa('국어', '을/를'), '를');
  assert.strictEqual(Stats.josa('수학', '을/를'), '을');
  assert.strictEqual(Stats.josa('한국사', '과/와'), '와');
  assert.strictEqual(Stats.josa('문법', '과/와'), '과');
  assert.strictEqual(Stats.josa('영어', '이/가'), '가');
  // (으)로: 받침이 없거나 ㄹ 받침이면 '로'
  assert.strictEqual(Stats.josa('국어', '으로/로'), '로');
  assert.strictEqual(Stats.josa('수학', '으로/로'), '으로');
  assert.strictEqual(Stats.josa('미술', '으로/로'), '로');
  // 숫자·영어·따옴표로 끝나도
  assert.strictEqual(Stats.josa('기출 2', '을/를'), '를');
  assert.strictEqual(Stats.josa('기출 3', '을/를'), '을');
  assert.strictEqual(Stats.josa('수학 1', '으로/로'), '로');
  assert.strictEqual(Stats.josa('Day 10', '을/를'), '을');
  assert.strictEqual(Stats.josa('‘국어’', '을/를'), '를');
  assert.strictEqual(Stats.josa('Reading', '을/를'), '을');
  assert.strictEqual(Stats.josa('Grammar', '을/를'), '를');
});

test('기록 정리: 체크는 풀렸는데 진행률이 100%로 남은 범위 항목은 0%로 바로잡는다', () => {
  const out = StoreLib.normalize({ tasks: [], topics: [
    { id: 'a', done: false, pct: 100 }, { id: 'b', done: true, pct: 100 }, { id: 'c', done: false, pct: 40 }, { id: 'd', done: true }, { id: 'e', done: false },
  ] });
  assert.deepStrictEqual(out.topics.map((t) => t.pct), [0, 100, 40, undefined, undefined]);
  assert.deepStrictEqual(out.topics.map((t) => t.done), [false, true, false, true, false]);
});

/* ---------- 끝낸 할 일·범위의 소요 시간을 공부 기록으로 (v3.5.1) ---------- */
const ScopeLib = require('../js/scope.js');
const creditState = () => ({
  subjects: [{ id: 'm', name: '수학', color: '#000' }],
  tasks: [
    { id: 't1', title: '문제집 3쪽', subjectId: 'm', estimateMin: 40, done: false },
    { id: 't2', title: '단어', subjectId: null, estimateMin: null, done: false },
    { id: 't3', title: '수학 · 1단원', subjectId: 'm', estimateMin: 30, done: false, topicId: 'a1' }, // 범위에서 보낸 할 일
  ],
  topics: [
    { id: 'c', examId: 'e', parentId: null, kind: 'topic', title: '수학', order: 0 },
    { id: 'a', examId: 'e', parentId: 'c', kind: 'topic', title: '1단원', order: 0 },
    { id: 'a1', examId: 'e', parentId: 'a', kind: 'topic', title: '개념', est: 30, order: 0 },
    { id: 'a2', examId: 'e', parentId: 'a', kind: 'topic', title: '문제', est: 50, order: 1 },
    { id: 'b', examId: 'e', parentId: 'c', kind: 'topic', title: '2단원', order: 1 }, // 소요시간 없음
    { id: 'n', examId: 'e', parentId: null, kind: 'note', title: '메모', done: true },
  ],
  sessions: [],
});
let cid = 0;
const nextId = () => 'id' + ++cid;

test('끝낸 할 일: 예상 시간을 시각 없는 공부 기록으로 넣고, 두 번 넣지 않는다', () => {
  const st = creditState();
  const t = st.tasks[0];
  t.done = true;
  const s = Stats.creditTask(st, t, NOW, 'x1');
  assert.deepStrictEqual(s, { id: 'x1', kind: 'done', manual: true, doneOf: 'task:t1', subjectId: 'm', minutes: 40, endedAt: NOW, label: '문제집 3쪽', taskId: 't1' });
  assert.strictEqual(Stats.minutesOn(st.sessions, NOW), 40);
  assert.strictEqual(Stats.sessionSpan(s), null); // 타임테이블에는 '시각 없음'
  assert.strictEqual(Stats.dayTimeline(st.sessions, Stats.dayKey(NOW)).untimed, 40);
  assert.strictEqual(Stats.creditTask(st, t, NOW, 'x2'), null);
  assert.strictEqual(st.sessions.length, 1);
  // 예상 시간이 없거나 아직 안 끝낸 할 일은 넣지 않는다
  st.tasks[1].done = true;
  assert.strictEqual(Stats.creditTask(st, st.tasks[1], NOW, 'x3'), null);
  assert.strictEqual(Stats.creditTask(st, Object.assign({}, t, { id: 'z', done: false }), NOW, 'x4'), null);
});

test('끝낸 할 일: 스톱워치로 이미 잰 할 일은 예상 시간을 또 넣지 않는다', () => {
  const st = creditState();
  st.sessions.push({ id: 'sw-1', subjectId: 'm', minutes: 25, endedAt: NOW - 3600000, kind: 'stopwatch', label: '문제집 3쪽', taskId: 't1' });
  st.tasks[0].done = true;
  assert.strictEqual(Stats.taskCreditMinutes(st, st.tasks[0]), 0);
  assert.strictEqual(Stats.creditTask(st, st.tasks[0], NOW, 'x'), null);
  assert.strictEqual(Stats.minutesOn(st.sessions, NOW), 25);
});

test('끝냄 취소: 오늘 넣은 기록만 빼고, 지난날 넣은 기록은 남긴다', () => {
  const st = creditState();
  st.tasks[0].done = true;
  Stats.creditTask(st, st.tasks[0], NOW, 'x1');
  assert.strictEqual(Stats.uncreditDone(st, 'task:t1', NOW + 60000), 40);
  assert.strictEqual(st.sessions.length, 0);
  Stats.creditTask(st, st.tasks[0], NOW - DAY, 'x2'); // 어제 끝냄
  assert.strictEqual(Stats.uncreditDone(st, 'task:t1', NOW), 0);
  assert.strictEqual(st.sessions.length, 1);
  // 어제 넣은 기록이 있으니 오늘 다시 끝내도 또 넣지 않는다
  assert.strictEqual(Stats.creditTask(st, st.tasks[0], NOW, 'x3'), null);
});

test('끝낸 할 일: 한 번에 하루(24시간)까지만 넣는다', () => {
  const st = creditState();
  Object.assign(st.tasks[0], { done: true, estimateMin: 5000 });
  assert.strictEqual(Stats.creditTask(st, st.tasks[0], NOW, 'x').minutes, 24 * 60);
});

test('범위 체크: 새로 끝낸 잎 항목의 소요시간을 넣고, 체크를 풀면 오늘 넣은 것을 뺀다', () => {
  const st = creditState();
  let before = Stats.doneTopicIds(st);
  ScopeLib.setDone(st.topics, 'a2', true, NOW);
  let got = Stats.syncTopicCredits(st, before, NOW, nextId);
  assert.strictEqual(got.added, 50);
  assert.deepStrictEqual(st.sessions.map((s) => [s.doneOf, s.label, s.subjectId, s.topicId, s.kind, s.manual]), [['topic:a2', '수학 · 문제', 'm', 'a2', 'done', true]]);
  // 상위 항목(과목)을 체크하면 아래 잎마다. 이미 넣은 a2, 소요시간이 없는 2단원은 빼고 a1(30분)만
  before = Stats.doneTopicIds(st);
  ScopeLib.setDone(st.topics, 'c', true, NOW);
  got = Stats.syncTopicCredits(st, before, NOW, nextId);
  assert.strictEqual(got.added, 30);
  assert.strictEqual(got.ids.length, 1);
  assert.strictEqual(Stats.minutesOn(st.sessions, NOW), 80);
  // 체크를 모두 풀면 오늘 넣은 80분을 뺀다
  before = Stats.doneTopicIds(st);
  ScopeLib.setDone(st.topics, 'c', false, NOW);
  got = Stats.syncTopicCredits(st, before, NOW + 1000, nextId);
  assert.deepStrictEqual([got.added, got.removed], [0, 80]);
  assert.strictEqual(st.sessions.length, 0);
});

test('범위 체크: 지운 항목의 기록은 남기고, 범위에서 보낸 할 일과 범위는 한 번만 넣는다', () => {
  const st = creditState();
  // 범위에서 보낸 할 일(t3, a1과 한 몸)을 먼저 끝내면
  st.tasks[2].done = true;
  assert.strictEqual(Stats.creditTask(st, st.tasks[2], NOW, 't3rec').topicId, 'a1');
  let before = Stats.doneTopicIds(st);
  ScopeLib.setDone(st.topics, 'a1', true, NOW);
  assert.strictEqual(Stats.syncTopicCredits(st, before, NOW, nextId).added, 0); // 범위에서 또 체크해도 안 넣음
  // 반대로 범위를 먼저 끝냈으면 할 일 쪽에서 안 넣음
  const st2 = creditState();
  before = Stats.doneTopicIds(st2);
  ScopeLib.setDone(st2.topics, 'a1', true, NOW);
  assert.strictEqual(Stats.syncTopicCredits(st2, before, NOW, nextId).added, 30);
  st2.tasks[2].done = true;
  assert.strictEqual(Stats.creditTask(st2, st2.tasks[2], NOW, 'q'), null);
  // 끝낸 항목을 지워도 공부한 기록은 그대로
  before = Stats.doneTopicIds(st2);
  st2.topics = ScopeLib.removeSubtree(st2.topics, 'a1');
  assert.strictEqual(Stats.syncTopicCredits(st2, before, NOW, nextId).removed, 0);
  assert.strictEqual(Stats.minutesOn(st2.sessions, NOW), 30);
  // 범위를 타이머로 잰 적이 있으면 넣지 않는다 (집중 타이머 기록은 topicId를 남긴다)
  const st3 = creditState();
  st3.sessions.push({ id: 'f', subjectId: 'm', minutes: 25, endedAt: NOW - 60000, label: '수학 · 문제', topicId: 'a2' });
  before = Stats.doneTopicIds(st3);
  ScopeLib.setDone(st3.topics, 'a2', true, NOW);
  assert.strictEqual(Stats.syncTopicCredits(st3, before, NOW, nextId).added, 0);
});
