// 하루 공부 기록은 24시간까지 (v4.6.3): 남은 시간 계산, 넘친 날 맞추기, 끝낸 할 일 넣기, 저장소에서 바로잡기
const test = require('node:test');
const assert = require('node:assert');
const Stats = require('../js/stats.js');
const StoreLib = require('../js/store.js');

const at = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime(); // 2026년 11월 d일 h시 m분
const hand = (id, d, minutes) => ({ id, subjectId: null, minutes, endedAt: at(d, 21), label: '직접 기록', manual: true });
const sw = (id, d, h, minutes) => ({ id, subjectId: null, minutes, sec: minutes * 60, endedAt: at(d, h), kind: 'stopwatch' });
const total = (sessions, key) => sessions.filter((s) => Stats.dayKey(s.endedAt) === key).reduce((a, s) => a + s.minutes, 0);

test('dayRoom: 그날 더 적을 수 있는 분 (0 ~ 1440)', () => {
  const ss = [sw('a', 27, 10, 90), hand('b', 27, 600), hand('c', 26, 1440)];
  assert.strictEqual(Stats.DAY_MAX, 1440);
  assert.strictEqual(Stats.dayRoom(ss, '2026-11-27'), 1440 - 690);
  assert.strictEqual(Stats.dayRoom(ss, '2026-11-26'), 0);
  assert.strictEqual(Stats.dayRoom(ss, '2026-11-25'), 1440);
  assert.strictEqual(Stats.dayRoom([hand('x', 25, 2000)], '2026-11-25'), 0); // 이미 넘친 날도 0
  assert.strictEqual(Stats.dayRoom([], '2026-11-25'), 1440);
});

test('fitDays: 312시간 넣은 날은 손으로 적은 기록부터, 나중 것부터 줄여 24시간에 맞춘다. 타이머 기록은 그대로', () => {
  const sessions = [sw('real', 27, 9, 180)];
  for (let i = 0; i < 13; i++) sessions.push(hand('h' + i, 27, 1440)); // 13 × 24시간 = 312시간
  sessions.push(hand('other', 26, 300));
  const st = { settings: {}, sessions };
  assert.strictEqual(total(st.sessions, '2026-11-27'), 180 + 312 * 60);
  const r = Stats.fitDays(st);
  assert.deepStrictEqual(r.days, ['2026-11-27']);
  assert.strictEqual(r.cut, 180 + 312 * 60 - 1440);
  assert.strictEqual(total(st.sessions, '2026-11-27'), 1440);
  // 타이머로 잰 3시간은 그대로, 처음 넣은 직접 기록이 21시간으로 남고 나머지는 지워진다
  assert.deepStrictEqual(st.sessions.map((s) => [s.id, s.minutes]), [['real', 180], ['h0', 1260], ['other', 300]]);
  // 다시 맞춰도 바뀌지 않는다
  assert.deepStrictEqual(Stats.fitDays(st), { cut: 0, days: [] });
});

test('fitDays: 손으로 적은 기록을 다 줄여도 넘으면 타이머 기록도 나중 것부터 (초도 같이)', () => {
  const st = { settings: {}, sessions: [sw('a', 27, 8, 800), hand('b', 27, 100), sw('c', 27, 20, 800)] };
  const r = Stats.fitDays(st);
  assert.strictEqual(r.cut, 260);
  assert.deepStrictEqual(st.sessions.map((s) => [s.id, s.minutes]), [['a', 800], ['c', 640]]);
  assert.strictEqual(st.sessions[1].sec, 640 * 60);
});

test('fitDays: 24시간 딱 맞는 날·기록이 없는 상태는 그대로', () => {
  const ss = [sw('a', 27, 10, 600), hand('b', 27, 840)];
  const st = { settings: {}, sessions: ss.map((s) => Object.assign({}, s)) };
  assert.deepStrictEqual(Stats.fitDays(st), { cut: 0, days: [] });
  assert.deepStrictEqual(st.sessions, ss);
  assert.deepStrictEqual(Stats.fitDays({ settings: {}, sessions: [] }), { cut: 0, days: [] });
  assert.deepStrictEqual(Stats.fitDays({}), { cut: 0, days: [] });
});

test('fitDays: 하루 시작 시각 설정으로 날을 나눈다 (새벽 4시면 새벽 2시 기록은 전날)', () => {
  const dawn = { id: 'dawn', subjectId: null, minutes: 120, endedAt: at(28, 2), label: '직접 기록', manual: true };
  // 자정 기준이면 27일 1440 + 28일 120 → 그대로
  const a = { settings: { dayStartHour: 0 }, sessions: [hand('d', 27, 1440), Object.assign({}, dawn)] };
  assert.strictEqual(Stats.fitDays(a).cut, 0);
  // 새벽 4시 기준이면 둘 다 27일 → 넘친 120분을 나중에 넣은 새벽 기록에서 뺀다
  const b = { settings: { dayStartHour: 4 }, sessions: [hand('d', 27, 1440), Object.assign({}, dawn)] };
  assert.deepStrictEqual(Stats.fitDays(b), { cut: 120, days: ['2026-11-27'] });
  assert.deepStrictEqual(b.sessions.map((s) => s.id), ['d']);
});

test('끝낸 할 일: 그날 남은 시간까지만 넣고, 꽉 찼으면 안 넣는다', () => {
  const now = at(28, 15);
  const st = { subjects: [], topics: [], tasks: [], sessions: [hand('x', 28, 1380)] };
  const t1 = { id: 't1', title: '수학 문제집', estimateMin: 120, done: true };
  assert.strictEqual(Stats.taskCreditMinutes(st, t1, now), 60);
  const r1 = Stats.creditTask(st, t1, now, 'c1');
  assert.strictEqual(r1.minutes, 60);
  const t2 = { id: 't2', title: '영어 단어', estimateMin: 30, done: true };
  assert.strictEqual(Stats.taskCreditMinutes(st, t2, now), 0);
  assert.strictEqual(Stats.creditTask(st, t2, now, 'c2'), null);
  assert.strictEqual(total(st.sessions, '2026-11-28'), 1440);
});

test('저장소: 읽을 때·바꿀 때·가져올 때 fix로 하루 24시간에 맞추고 바로 저장한다', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const many = [];
  for (let i = 0; i < 5; i++) many.push(hand('m' + i, 27, 1440));
  mem.set(StoreLib.KEY, JSON.stringify({ subjects: [], tasks: [], sessions: many, settings: {} }));
  const cuts = [];
  const fix = (st) => { const r = Stats.fitDays(st); if (r.cut) cuts.push(r.cut); return r.cut > 0; };
  const store = StoreLib.createStore(storage, { fix });
  // 읽자마자 24시간으로 맞추고 저장해 둔다
  assert.strictEqual(total(store.get().sessions, '2026-11-27'), 1440);
  assert.strictEqual(total(JSON.parse(mem.get(StoreLib.KEY)).sessions, '2026-11-27'), 1440);
  assert.deepStrictEqual(cuts, [4 * 1440]);
  // 타이머 기록이 더해지면 손으로 적은 기록을 줄인다
  store.update((st) => st.sessions.push(sw('t', 27, 23, 60)));
  assert.strictEqual(total(store.get().sessions, '2026-11-27'), 1440);
  assert.strictEqual(store.get().sessions.find((s) => s.id === 't').minutes, 60);
  assert.strictEqual(store.get().sessions.find((s) => s.id === 'm0').minutes, 1380);
  // 백업·계정 기록을 가져와도
  store.importJSON(JSON.stringify({ tasks: [], sessions: [hand('i1', 26, 1000), hand('i2', 26, 1000)] }), 'cloud');
  assert.strictEqual(total(store.get().sessions, '2026-11-26'), 1440);
  assert.deepStrictEqual(cuts, [4 * 1440, 60, 560]);
  // fix가 없으면 예전처럼 그대로 (다른 시험이 쓰는 저장소)
  const plain = StoreLib.createStore(null);
  plain.update((st) => { st.sessions.push(hand('p1', 25, 1440), hand('p2', 25, 1440)); });
  assert.strictEqual(total(plain.get().sessions, '2026-11-25'), 2880);
});
