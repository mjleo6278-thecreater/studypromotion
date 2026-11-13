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

// 타임테이블 (v2.9): 하루 전체 24줄과 지금 재는 구간
test('타임테이블: 하루 전체(full)는 0시부터 24줄, 기록이 없어도 줄은 있다', () => {
  const sessions = [{ minutes: 50, endedAt: at(9, 9, 55), subjectId: 'kor' }];
  const tl = Stats.dayTimeline(sessions, '2026-11-09', { full: true });
  assert.deepStrictEqual(tl.hours.map((h) => h.hour), Array.from({ length: 24 }, (_, i) => i));
  assert.deepStrictEqual(tl.hours[9].segs, [{ from: 5, to: 55, subjectId: 'kor' }]);
  assert.strictEqual(tl.hours.filter((h) => h.segs.length).length, 1);
  const none = Stats.dayTimeline(sessions, '2026-11-08', { full: true });
  assert.deepStrictEqual([none.hours.length, none.start, none.end, none.timed], [24, null, null, 0]);
  // full을 안 주면 예전처럼 공부한 시간대만
  assert.deepStrictEqual(Stats.dayTimeline(sessions, '2026-11-09').hours.map((h) => h.hour), [9]);
  assert.deepStrictEqual(Stats.dayTimeline(sessions, '2026-11-08').hours, []);
});

test('타임테이블: 지금 재는 구간(live)은 기록 전이어도 칠하고 live 표시가 붙는다', () => {
  const sessions = [{ minutes: 50, endedAt: at(9, 9, 55), subjectId: 'kor' }];
  const live = { from: at(9, 16, 8), to: at(9, 16, 20), subjectId: 'math' };
  const tl = Stats.dayTimeline(sessions, '2026-11-09', { full: true, live });
  assert.deepStrictEqual(tl.hours[16].segs, [{ from: 8, to: 20, subjectId: 'math', live: true }]);
  assert.deepStrictEqual(tl.hours[9].segs, [{ from: 5, to: 55, subjectId: 'kor' }]); // 기록된 조각에는 live가 없다
  assert.deepStrictEqual([tl.timed, tl.start, tl.end], [62, at(9, 9, 5), at(9, 16, 20)]);
  // full 없이도: 처음 공부한 시부터 지금 재는 시까지
  assert.deepStrictEqual(Stats.dayTimeline(sessions, '2026-11-09', { live }).hours.map((h) => h.hour), [9, 10, 11, 12, 13, 14, 15, 16]);
  // 자정을 넘겨 재는 중이면 날마다 그날 몫만
  const late = { from: at(9, 23, 50), to: at(10, 0, 10), subjectId: null };
  assert.deepStrictEqual(Stats.dayTimeline([], '2026-11-09', { full: true, live: late }).hours[23].segs, [{ from: 50, to: 60, subjectId: null, live: true }]);
  assert.deepStrictEqual(Stats.dayTimeline([], '2026-11-10', { full: true, live: late }).hours[0].segs, [{ from: 0, to: 10, subjectId: null, live: true }]);
  // 다른 날을 볼 때는 영향 없음
  assert.strictEqual(Stats.dayTimeline(sessions, '2026-11-08', { full: true, live }).timed, 0);
  assert.deepStrictEqual(Stats.dayTimeline(sessions, '2026-11-09', { live: null }), Stats.dayTimeline(sessions, '2026-11-09'));
});

test('타임테이블: 하루 시작 시각이 새벽 4시면 4시부터 다음 날 3시까지 24줄', () => withStart(4, () => {
  const sessions = [
    { minutes: 60, endedAt: at(11, 1, 0), subjectId: 'b' }, // 11일 00:00~01:00 → 10일 몫
    { minutes: 30, endedAt: at(10, 5, 0), subjectId: 'c' }, // 10일 04:30~05:00
  ];
  const tl = Stats.dayTimeline(sessions, '2026-11-10', { full: true });
  assert.deepStrictEqual(tl.hours.map((h) => h.hour), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3]);
  assert.deepStrictEqual(tl.hours[0].segs, [{ from: 30, to: 60, subjectId: 'c' }]);
  assert.deepStrictEqual(tl.hours[20].segs, [{ from: 0, to: 60, subjectId: 'b' }]);
  assert.strictEqual(tl.timed, 90);
}));

// 타임테이블에 직접 추가 (v2.10): 시각을 적은 직접 기록(manual + startAt)은 칸에 칠하고, 시간만 적은 것은 예전처럼 따로
test('기록이 차지하는 시각(sessionSpan): 타이머·스톱워치는 끝에서 거꾸로, 시각을 적은 직접 기록은 시작부터, 시간만 적은 것은 없음', () => {
  assert.deepStrictEqual(Stats.sessionSpan({ minutes: 50, endedAt: at(9, 9, 55) }), [at(9, 9, 5), at(9, 9, 55)]);
  assert.deepStrictEqual(Stats.sessionSpan({ minutes: 50, endedAt: at(9, 9, 55), kind: 'stopwatch', sec: 3000 }), [at(9, 9, 5), at(9, 9, 55)]);
  assert.deepStrictEqual(Stats.sessionSpan({ minutes: 90, startAt: at(9, 14, 0), endedAt: at(9, 15, 30), manual: true }), [at(9, 14, 0), at(9, 15, 30)]);
  // 하루 끝에 딱 맞춰 끝난 직접 기록: endedAt은 1ms 당겨 그날에 넣었지만 칸은 24시까지
  assert.deepStrictEqual(Stats.sessionSpan({ minutes: 60, startAt: at(9, 23, 0), endedAt: at(10, 0, 0) - 1, manual: true }), [at(9, 23, 0), at(10, 0, 0)]);
  assert.strictEqual(Stats.sessionSpan({ minutes: 30, endedAt: at(9, 21, 0), manual: true }), null);
  assert.strictEqual(Stats.sessionSpan({ minutes: 0, endedAt: at(9, 21, 0) }), null);
});

test('타임테이블: 시각을 적은 직접 기록은 그 시간에 칠하고, 시간만 적은 직접 기록은 untimed로', () => {
  const sessions = [
    { minutes: 90, startAt: at(9, 14, 0), endedAt: at(9, 15, 30), manual: true, subjectId: 'eng' },
    { minutes: 30, endedAt: at(9, 21, 0), manual: true, subjectId: 'kor' },
    { minutes: 60, startAt: at(9, 23, 0), endedAt: at(10, 0, 0) - 1, manual: true, subjectId: 'math' },
  ];
  const tl = Stats.dayTimeline(sessions, '2026-11-09', { full: true });
  assert.deepStrictEqual(tl.hours[14].segs, [{ from: 0, to: 60, subjectId: 'eng' }]);
  assert.deepStrictEqual(tl.hours[15].segs, [{ from: 0, to: 30, subjectId: 'eng' }]);
  assert.deepStrictEqual(tl.hours[23].segs, [{ from: 0, to: 60, subjectId: 'math' }]);
  assert.deepStrictEqual([tl.timed, tl.untimed, tl.start, tl.end], [150, 30, at(9, 14, 0), at(10, 0, 0)]);
  assert.strictEqual(Stats.dayTimeline(sessions, '2026-11-10', { full: true }).timed, 0); // 다음 날로 번지지 않음
  // 하루 공부 시간(분)은 예전처럼 endedAt의 날짜로 센다
  assert.strictEqual(Stats.minutesOn(sessions, at(9, 12, 0)), 180);
});
