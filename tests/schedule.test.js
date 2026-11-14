// 일정: 반복, 하루 시작 시각, 검사, 실제 공부와 견주기
const test = require('node:test');
const assert = require('node:assert');
const Stats = require('../js/stats.js');
const S = require('../js/schedule.js');

const at = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime(); // 2026년 11월 d일 h시 m분
const withStart = (hour, fn) => { Stats.setDayStart(hour); try { fn(); } finally { Stats.setDayStart(0); } };
const ev = (o) => { const e = S.clean(Object.assign({ kind: 'study', subjectId: 'math', date: '2026-11-16', start: '16:00', end: '18:00' }, o), { now: () => 1 }); if (e.error) throw new Error(e.error); return e; };

test('일정: 시각 읽기와 쓰기', () => {
  assert.strictEqual(S.parseHM('7:05'), 425);
  assert.strictEqual(S.parseHM('07:05'), 425);
  assert.strictEqual(S.parseHM('24:00'), 1440);
  assert.ok(Number.isNaN(S.parseHM('24:30')));
  assert.ok(Number.isNaN(S.parseHM('12:60')));
  assert.ok(Number.isNaN(S.parseHM('abc')));
  assert.strictEqual(S.fmtHM(425), '7:05');
  assert.strictEqual(S.weekStart('2026-11-14'), '2026-11-09'); // 토 → 그 주 월
  assert.strictEqual(S.weekStart('2026-11-15'), '2026-11-09'); // 일요일은 그 주의 끝
  assert.strictEqual(S.weekStart('2026-11-16'), '2026-11-16');
  assert.ok(!S.isKey('2026-02-30'));
});

test('일정: 검사해서 저장할 모양으로 맞춘다', () => {
  const e = ev({ start: '9:00', end: '10:30', title: '  학원  ' });
  assert.strictEqual(e.start, '09:00');
  assert.strictEqual(e.end, '10:30');
  assert.strictEqual(e.title, '학원');
  assert.strictEqual(e.repeat, null);
  assert.match(S.clean({ kind: 'study', date: '2026-11-16', start: '9:00', end: '10:00' }).error, /과목/);
  assert.match(S.clean({ kind: 'other', date: '2026-11-16', start: '9:00', end: '10:00' }).error, /이름/);
  assert.match(S.clean({ kind: 'other', title: '약속', date: '2026-11-16', start: '9:00', end: '9:00' }).error, /끝 시각/);
  assert.match(S.clean({ kind: 'other', title: '약속', date: '11/16', start: '9:00', end: '10:00' }).error, /날짜/);
  assert.match(S.clean({ kind: 'other', title: '약속', date: '2026-11-16', start: '25:00', end: '10:00' }).error, /시작/);
  assert.match(S.clean({ kind: 'study', subjectId: 'm', date: '2026-11-16', start: '9:00', end: '10:00', repeat: { freq: 'weekly', days: [] } }).error, /요일/);
  // 다른 일정에는 과목·할 일을 붙이지 않는다
  const o = S.clean({ kind: 'other', title: '운동', subjectId: 'm', taskId: 't', date: '2026-11-16', start: '9:00', end: '10:00' });
  assert.strictEqual(o.subjectId, null);
  assert.strictEqual(o.taskId, null);
});

test('일정: 매주 반복, 빼는 날, 끝나는 날', () => {
  const e = ev({ repeat: { freq: 'weekly', days: [1, 3, 5], until: '2026-11-27' } }); // 월수금
  const on = (k) => S.occursOn(e, k);
  assert.ok(on('2026-11-16'));
  assert.ok(!on('2026-11-17'));
  assert.ok(on('2026-11-18'));
  assert.ok(on('2026-11-27'));
  assert.ok(!on('2026-11-30')); // 끝난 뒤
  assert.ok(!on('2026-11-13')); // 시작 전
  const sk = S.skipDay(e, '2026-11-18');
  assert.ok(!S.occursOn(sk, '2026-11-18'));
  assert.ok(S.occursOn(sk, '2026-11-20'));
  const cut = S.endBefore(e, '2026-11-20');
  assert.strictEqual(cut.repeat.until, '2026-11-19');
  assert.ok(!S.occursOn(cut, '2026-11-20'));
  assert.strictEqual(S.endBefore(e, '2026-11-16'), null);
  // 첫날이 반복 요일이 아니면 다음 해당 요일로
  const e2 = ev({ date: '2026-11-17', repeat: { freq: 'weekly', days: [1, 3, 5] } });
  assert.strictEqual(e2.date, '2026-11-18');
  const daily = ev({ repeat: { freq: 'daily' } });
  assert.ok(S.occursOn(daily, '2026-11-17') && S.occursOn(daily, '2026-12-25'));
});

test('일정: 그날 목록과 실제 시각, 자정 넘김, 하루 시작 시각', () => {
  const a = ev({ id: 'a', start: '19:00', end: '21:00' });
  const b = ev({ id: 'b', start: '9:00', end: '10:00' });
  const night = ev({ id: 'n', start: '23:00', end: '1:00' });
  const day = S.forDay([a, b, night], '2026-11-16');
  assert.deepStrictEqual(day.map((o) => o.id), ['b', 'a', 'n']);
  assert.strictEqual(day[2].from, at(16, 23));
  assert.strictEqual(day[2].to, at(17, 1));
  assert.strictEqual(day[2].minutes, 120);
  const full = ev({ start: '22:00', end: '24:00' });
  assert.strictEqual(S.span(full, '2026-11-16')[1], at(17, 0));
  // 하루 시작이 새벽 4시면 2시는 다음 달력 날의 새벽
  withStart(4, () => {
    const late = ev({ start: '2:00', end: '3:00' });
    assert.deepStrictEqual(S.span(late, '2026-11-16'), [at(17, 2), at(17, 3)]);
    const n2 = ev({ start: '23:00', end: '1:00' });
    assert.deepStrictEqual(S.span(n2, '2026-11-16'), [at(16, 23), at(17, 1)]);
  });
});

test('일정: 실제 공부와 견주기 (같은 과목만, 80%면 계획대로)', () => {
  const e = ev({});
  const occ = S.forDay([e], '2026-11-16')[0];
  const sw = (sid, h1, m1, h2, m2) => ({ subjectId: sid, minutes: (at(16, h2, m2) - at(16, h1, m1)) / 60000, endedAt: at(16, h2, m2) });
  assert.strictEqual(S.actualMinutes(occ, [sw('math', 15, 30, 16, 30)]), 30); // 겹친 만큼만
  assert.strictEqual(S.actualMinutes(occ, [sw('eng', 16, 0, 18, 0)]), 0); // 다른 과목
  assert.strictEqual(S.status(occ, [sw('math', 16, 0, 17, 40)], at(16, 19)), 'done'); // 100분 ≥ 96분
  assert.strictEqual(S.status(occ, [sw('math', 16, 0, 16, 30)], at(16, 19)), 'part');
  assert.strictEqual(S.status(occ, [], at(16, 19)), 'missed');
  assert.strictEqual(S.status(occ, [], at(16, 17)), 'now');
  assert.strictEqual(S.status(occ, [], at(16, 9)), 'later');
  // 직접 기록(시각 있음)도 센다
  const manual = { subjectId: 'math', minutes: 120, startAt: at(16, 16), endedAt: at(16, 18), manual: true };
  assert.strictEqual(S.status(occ, [manual], at(16, 19)), 'done');
  // 지금 재는 중인 시간도 센다
  assert.strictEqual(S.actualMinutes(occ, [], { from: at(16, 16), to: at(16, 17), subjectId: 'math' }), 60);
  // 과목 없는 공부 일정은 어떤 공부든 센다
  const free = ev({ subjectId: null, title: '자습' });
  const o2 = S.forDay([free], '2026-11-16')[0];
  assert.strictEqual(S.actualMinutes(o2, [sw('eng', 16, 0, 17, 0)]), 60);
});

test('일정: 지금 할 공부 일정, 계획한 시간 합계', () => {
  const e = ev({ id: 'm', repeat: { freq: 'weekly', days: [1, 3, 5] } });
  const o = ev({ id: 'o', kind: 'other', title: '운동', start: '15:00', end: '16:00' });
  assert.strictEqual(S.current([e, o], at(16, 15, 55)).id, 'm'); // 10분 안에 시작
  assert.strictEqual(S.current([e, o], at(16, 15, 30)), null);
  assert.strictEqual(S.current([e, o], at(16, 17)).id, 'm');
  assert.strictEqual(S.current([e, o], at(16, 18)), null);
  assert.strictEqual(S.current([e], at(17, 17)), null); // 화요일엔 없음
  // 어제 시작해 자정을 넘긴 일정도 찾는다
  const night = ev({ id: 'n', start: '23:00', end: '1:00' });
  assert.strictEqual(S.current([night], at(17, 0, 30)).id, 'n');
  assert.strictEqual(S.plannedMinutes([e, o], '2026-11-16', '2026-11-22'), 360); // 월수금 2시간씩, 다른 일정은 빼고
});
