// 하루 시작 시각(설정): 새벽 공부를 전날 공부로 세는 계산
const test = require('node:test');
const assert = require('node:assert');
const SRS = require('../js/srs.js');
const Stats = require('../js/stats.js');
const Scope = require('../js/scope.js');

const at = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime(); // 2026년 11월 d일 h시 m분
const withStart = (hour, fn) => { Stats.setDayStart(hour); try { fn(); } finally { Stats.setDayStart(0); } };

test('하루 시작 시각: 기본(자정)이면 예전과 같다', () => {
  assert.strictEqual(Stats.dayOffset(), 0);
  assert.strictEqual(Stats.dayKey(at(11, 1, 30)), '2026-11-11');
  assert.strictEqual(Stats.dateKey(at(11, 1, 30)), '2026-11-11');
});

test('하루 시작 시각: 새벽 4시로 두면 새벽 1시 30분은 전날, 4시부터는 그날', () => withStart(4, () => {
  assert.strictEqual(Stats.dayKey(at(11, 1, 30)), '2026-11-10');
  assert.strictEqual(Stats.dayKey(at(11, 3, 59)), '2026-11-10');
  assert.strictEqual(Stats.dayKey(at(11, 4, 0)), '2026-11-11');
  assert.strictEqual(Stats.dayKey(at(10, 23, 0)), '2026-11-10');
  // 달력 날짜는 그대로
  assert.strictEqual(Stats.dateKey(at(11, 1, 30)), '2026-11-11');
}));

test('하루 시작 시각: 값은 0~12시로 맞춘다', () => {
  Stats.setDayStart(99); assert.strictEqual(Stats.dayOffset(), 12 * 3600000);
  Stats.setDayStart(-3); assert.strictEqual(Stats.dayOffset(), 0);
  Stats.setDayStart('abc'); assert.strictEqual(Stats.dayOffset(), 0);
  Stats.setDayStart(undefined); assert.strictEqual(Stats.dayOffset(), 0);
});

test('하루 시작 시각: 밤 11시와 새벽 1시 공부가 같은 날로 합쳐지고, 연속 학습일이 이어진다', () => withStart(4, () => {
  const sessions = [
    { minutes: 50, endedAt: at(10, 23, 0) },
    { minutes: 40, endedAt: at(11, 1, 0) },
    { minutes: 30, endedAt: at(9, 22, 0) },
  ];
  const now = at(11, 1, 30); // 11일 새벽 1시 30분 = 아직 10일
  assert.strictEqual(Stats.minutesOn(sessions, now), 90);
  const week = Stats.lastNDays(sessions, now, 3);
  assert.deepStrictEqual(week.map((d) => d.key), ['2026-11-08', '2026-11-09', '2026-11-10']);
  assert.deepStrictEqual(week.map((d) => d.minutes), [0, 30, 90]);
  assert.strictEqual(week[2].label, '오늘');
  assert.strictEqual(week[1].label, '월'); // 2026-11-09는 월요일
  assert.strictEqual(Stats.streak(sessions.map((s) => Stats.dayKey(s.endedAt)), now), 2);
}));

test('하루 시작 시각: 달이 바뀌는 새벽도 전달로 센다', () => withStart(4, () => {
  const lastNight = new Date(2026, 11, 1, 2, 0).getTime(); // 12월 1일 새벽 2시 = 아직 11월 30일
  assert.strictEqual(Stats.monthKey(lastNight), '2026-11');
  const months = Stats.lastNMonths([{ minutes: 60, endedAt: lastNight }], lastNight, 2);
  assert.deepStrictEqual(months.map((m) => m.key), ['2026-10', '2026-11']);
  assert.strictEqual(months[1].minutes, 60);
  const g = Stats.monthGoal(3000, 60, lastNight, 60);
  assert.strictEqual(g.daysLeft, 1); // 11월의 마지막 날
}));

test('하루 시작 시각: 하루 시간표가 다음 날 새벽까지 이어진다', () => withStart(4, () => {
  const sessions = [
    { minutes: 60, endedAt: at(10, 23, 30), subjectId: 'a' }, // 22:30~23:30
    { minutes: 90, endedAt: at(11, 1, 0), subjectId: 'b' }, // 23:30~01:00
    { minutes: 30, endedAt: at(11, 5, 0), subjectId: 'c' }, // 04:30~05:00 → 11일 몫
  ];
  const tl = Stats.dayTimeline(sessions, '2026-11-10');
  assert.deepStrictEqual(tl.hours.map((h) => h.hour), [22, 23, 0]);
  assert.strictEqual(tl.timed, 150);
  assert.deepStrictEqual(tl.hours[2].segs, [{ from: 0, to: 60, subjectId: 'b' }]);
  const next = Stats.dayTimeline(sessions, '2026-11-11');
  assert.deepStrictEqual(next.hours.map((h) => h.hour), [4]);
  assert.strictEqual(next.timed, 30);
}));

test('하루 시작 시각: 기본(자정)일 때 하루 시간표는 예전과 같다', () => {
  const sessions = [{ minutes: 90, endedAt: at(11, 0, 30), subjectId: 'a' }]; // 10일 23:00 ~ 11일 00:30
  const a = Stats.dayTimeline(sessions, '2026-11-10');
  assert.deepStrictEqual(a.hours.map((h) => h.hour), [23]);
  assert.strictEqual(a.timed, 60);
  const b = Stats.dayTimeline(sessions, '2026-11-11');
  assert.deepStrictEqual(b.hours.map((h) => h.hour), [0]);
  assert.strictEqual(b.timed, 30);
});

test('하루 시작 시각: 시험 D-day와 오늘 날짜도 같은 기준', () => withStart(4, () => {
  const now = at(11, 1, 30); // 아직 10일
  assert.strictEqual(Scope.daysUntil('2026-11-12', now), 2);
  assert.strictEqual(Scope.ddayLabel('2026-11-10', now), 'D-DAY');
  assert.strictEqual(Scope.daysUntil('2026-11-12', at(11, 4, 0)), 1);
  // 페이스 계산의 '오늘'도
  const exam = { date: '2026-11-20' };
  Scope.touchPlan(exam, { timeTotal: 100, timeLeft: 100 }, now);
  assert.strictEqual(exam.planStart, '2026-11-10');
  assert.strictEqual(exam.paceSnap.day, '2026-11-10');
}));

test('하루 시작 시각: 카드 복습 날짜도 새벽에는 전날 기준', () => withStart(4, () => {
  const now = at(11, 1, 30); // 아직 10일
  assert.strictEqual(SRS.startOfDay(now), at(10, 4, 0));
  let c = SRS.newCard({ id: 'a' }, now);
  assert.ok(SRS.isDue(c, now));
  c = SRS.review(c, 'good', now); // 1일 뒤 = 11일(하루 시작 새벽 4시)
  assert.strictEqual(c.due, at(11, 4, 0));
  assert.ok(!SRS.isDue(c, at(11, 3, 0)));
  assert.ok(SRS.isDue(c, at(11, 4, 0)));
  assert.strictEqual(Stats.dateKey(c.due), '2026-11-11');
}));
