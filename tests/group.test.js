// 그룹 스터디 (v4.0): 앱 쪽 계산 (js/group.js의 순수 함수) — 이번 주, 공부 중, 순위, 함께 정한 목표, 보낼 날별 시간, 받은 값 검사
const test = require('node:test');
const assert = require('node:assert');
const G = require('../js/group.js');

const MIN = 60000, HOUR = 3600000;
// 2026-11-19(목) 한국 시각 오후 3시. 오늘이 시작된 시각은 그날 0시 (한국 시각)
const NOW = Date.parse('2026-11-19T15:00:00+09:00');
const CTX = { today: '2026-11-19', now: NOW, start: Date.parse('2026-11-19T00:00:00+09:00') };

test('날짜: 한 주는 월요일부터, 날짜끼리 더하기', () => {
  assert.strictEqual(G.weekdayOf('2026-11-19'), 4, '목요일');
  assert.strictEqual(G.weekStart('2026-11-19'), '2026-11-16');
  assert.strictEqual(G.weekStart('2026-11-16'), '2026-11-16', '월요일은 그날부터');
  assert.strictEqual(G.weekStart('2026-11-22'), '2026-11-16', '일요일은 그 주 월요일부터');
  assert.deepStrictEqual(G.weekKeys('2026-11-19'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.strictEqual(G.addKey('2026-11-30', 1), '2026-12-01', '달이 바뀌어도');
  assert.strictEqual(G.addKey('2027-01-01', -1), '2026-12-31', '해가 바뀌어도');
  assert.deepStrictEqual(G.weekKeys('2026-12-31').slice(0, 1).concat(G.weekKeys('2026-12-31').slice(-1)), ['2026-12-28', '2027-01-03'], '해를 넘는 주');
});

test('공부 중: 끝나는 시각이 있으면 그 전까지, 스톱워치는 16시간까지 (서버와 같은 규칙)', () => {
  assert.ok(G.liveOn({ k: 'focus', at: NOW - 10 * MIN, end: NOW + 15 * MIN }, NOW));
  assert.ok(!G.liveOn({ k: 'focus', at: NOW - 30 * MIN, end: NOW - MIN }, NOW), '끝난 타이머');
  assert.ok(G.liveOn({ k: 'sw', at: NOW - 15 * HOUR }, NOW));
  assert.ok(!G.liveOn({ k: 'sw', at: NOW - 17 * HOUR }, NOW), '켜 둔 채 잊은 스톱워치');
  assert.ok(!G.liveOn({ k: 'sw', at: NOW + 5 * MIN }, NOW), '미래에 시작');
  assert.ok(!G.liveOn(null, NOW));
  // 오늘(0시 뒤)에 잰 분만
  assert.strictEqual(G.liveMin({ k: 'sw', at: NOW - 40 * MIN }, NOW, CTX.start), 40);
  assert.strictEqual(G.liveMin({ k: 'sw', at: CTX.start - 30 * MIN }, NOW, CTX.start), 15 * 60, '어제 밤부터 잰 스톱워치는 오늘 몫만');
  assert.strictEqual(G.liveMin({ k: 'focus', at: NOW - 20 * MIN, end: NOW + 5 * MIN }, NOW, CTX.start), 20);
  assert.strictEqual(G.liveMin({ k: 'focus', at: NOW - 20 * MIN, end: NOW - MIN }, NOW, CTX.start), 0, '끝났으면 0 (기록으로 들어감)');
});

test('한 사람의 숫자: 오늘(지금 재는 시간까지)·이번 주·지난주', () => {
  const m = { id: 'a', n: '지우', d: { '2026-11-16': 120, '2026-11-18': 200, '2026-11-19': 90, '2026-11-12': 300, '2026-11-15': 60, '2026-11-20': 999 }, lv: { k: 'sw', at: NOW - 30 * MIN } };
  const r = G.nums(m, CTX);
  assert.strictEqual(r.today, 120, '기록 90분 + 재는 중 30분');
  assert.deepStrictEqual(r.days, [120, 0, 200, 120, 0, 0, 0], '앞날(기기 시계가 틀린 날)은 0');
  assert.strictEqual(r.week, 440);
  assert.strictEqual(r.lastWeek, 360, '지난주 월~일');
  assert.ok(r.live);
  assert.strictEqual(G.nums({ id: 'b', d: { '2026-11-19': 1430 }, lv: { k: 'sw', at: NOW - 60 * MIN } }, CTX).today, 1440, '하루는 1440분까지');
  assert.strictEqual(G.nums({ id: 'c' }, CTX).week, 0, '기록이 없는 사람');
});

test('순위: 많은 순, 같으면 같은 등수(1, 2, 2, 4)이고 먼저 들어온 사람이 위', () => {
  const rows = [{ m: { n: 'a' }, order: 0, today: 30 }, { m: { n: 'b' }, order: 1, today: 90 }, { m: { n: 'c' }, order: 2, today: 30 }, { m: { n: 'd' }, order: 3, today: 0 }, { m: { n: 'e' }, order: 4, today: 120 }];
  const r = G.ranked(rows, 'today');
  assert.deepStrictEqual(r.map((x) => x.m.n + x.rank), ['e1', 'b2', 'a3', 'c3', 'd5']);
  assert.strictEqual(rows[0].rank, undefined, '원래 목록은 그대로');
});

test('그룹 한눈에: 공부 중, 하루 목표 승급, 주간 목표와 하루에 더 할 양', () => {
  const g = {
    goal: { day: 120, week: 1200 },
    ms: [
      { id: 'a', n: 'A', d: { '2026-11-16': 200, '2026-11-19': 130 }, lv: null },
      { id: 'b', n: 'B', d: { '2026-11-17': 100, '2026-11-19': 100 }, lv: { k: 'focus', at: NOW - 25 * MIN, end: NOW + 25 * MIN } },
      { id: 'c', n: 'C', d: { '2026-11-10': 600, '2026-11-11': 700 }, lv: null },
    ],
  };
  const s = G.summary(g, CTX);
  assert.deepStrictEqual(s.studying.map((r) => r.m.id), ['b']);
  assert.deepStrictEqual(s.achieved.map((r) => r.m.id), ['a', 'b'], 'B는 기록 100분 + 재는 중 25분으로 하루 목표 120분 달성');
  assert.strictEqual(s.todayTotal, 130 + 125);
  assert.strictEqual(s.weekTotal, 200 + 130 + 100 + 125);
  assert.strictEqual(s.lastTotal, 1300);
  assert.strictEqual(s.weekPct, Math.floor((555 / 1200) * 100));
  assert.strictEqual(s.left, 4, '목요일부터 일요일까지 4일');
  assert.strictEqual(s.remain, 1200 - 555);
  assert.strictEqual(s.perDay, Math.ceil(645 / 4));
  assert.ok(!s.weekDone && s.lastDone, '이번 주는 아직, 지난주는 달성');
  const none = G.summary({ goal: { day: 0, week: 0 }, ms: g.ms }, CTX);
  assert.deepStrictEqual(none.achieved, [], '하루 목표가 없으면 승급도 없음');
  assert.ok(none.weekPct === 0 && none.perDay === 0 && !none.weekDone);
  const sunday = G.summary(g, { today: '2026-11-22', now: NOW + 3 * 86400000, start: CTX.start + 3 * 86400000 });
  assert.strictEqual(sunday.left, 1, '일요일은 오늘 하루');
});

test('보낼 날별 시간: 최근 15일, 하루 1440분까지, 0분인 날은 빼기', () => {
  const dayKey = (t) => new Date(t + 9 * HOUR).toISOString().slice(0, 10); // 한국 날짜
  const at = (k, h) => Date.parse(k + 'T' + String(h).padStart(2, '0') + ':00:00+09:00');
  const sessions = [
    { minutes: 50, endedAt: at('2026-11-19', 10) },
    { minutes: 25, endedAt: at('2026-11-19', 14) },
    { minutes: 1000, endedAt: at('2026-11-18', 9) },
    { minutes: 900, endedAt: at('2026-11-18', 22) },
    { minutes: 30, endedAt: at('2026-11-04', 12) },  // 15일 전: 넣음
    { minutes: 30, endedAt: at('2026-11-03', 12) },  // 16일 전: 뺌
    { minutes: 40, endedAt: at('2026-11-20', 12) },  // 내일(시계가 틀린 기록): 뺌
    { minutes: 0, endedAt: at('2026-11-17', 12) },
    { minutes: 20 },
    null,
  ];
  assert.deepStrictEqual(G.myDays(sessions, '2026-11-19', dayKey), { '2026-11-19': 75, '2026-11-18': 1440, '2026-11-04': 30 });
  assert.deepStrictEqual(G.myDays([], '2026-11-19', dayKey), {});
});

test('받은 값 검사: 서버(worker/src/group.js)와 같은 규칙', async () => {
  const S = await import('../worker/src/group.js');
  const nicks = ['공부왕', '  지우  ', 'Kai_07', 'a-b c', '', ' ', '열세글자가넘는별명이에요요', '<b>', 'www.a.com', '😀', 'ㄱㄴ', null];
  for (const v of nicks) assert.strictEqual(G.cleanNick(v), S.cleanNick(v), '별명 ' + JSON.stringify(v));
  const names = ['수능 D-100 스터디', '수학 & 영어 (2학년)', '#1 팀!', '<script>', '스물한글자가넘는그룹이름입니다아아아아', '', 'a/b'];
  for (const v of names) assert.strictEqual(G.cleanGroupName(v), S.cleanGroupName(v), '그룹 이름 ' + JSON.stringify(v));
  const codes = ['K7M2QX', 'k7m2qx', 'k7m-2qx', 'K7M 2QX', 'K7M2Q', 'K7M2QXX', 'O0I1L2', 'ABCDEF'];
  for (const v of codes) assert.strictEqual(G.cleanCode(v), S.cleanCode(v), '초대 코드 ' + JSON.stringify(v));
  assert.strictEqual(G.CHEERS.length, S.CHEER_KINDS, '응원 종류 수');
});

test('초대 링크의 주소 끝에서 코드 꺼내기', () => {
  assert.strictEqual(G.linkCode('#join=K7M2QX'), 'K7M2QX');
  assert.strictEqual(G.linkCode('#group&join=k7m-2qx'), 'K7M2QX');
  assert.strictEqual(G.linkCode('join=K7M2QX'), 'K7M2QX');
  assert.strictEqual(G.linkCode('#join=K7M2Q'), null, '6자가 아니면');
  assert.strictEqual(G.linkCode('#join=K7M2QX&x=1'), null, '다른 것이 붙으면');
  assert.strictEqual(G.linkCode('#group'), null);
  assert.strictEqual(G.linkCode(''), null);
});

test('얼마나 지났는지', () => {
  assert.strictEqual(G.ago(NOW - 20 * 1000, NOW), '방금');
  assert.strictEqual(G.ago(NOW - 12 * MIN, NOW), '12분 전');
  assert.strictEqual(G.ago(NOW - 3 * HOUR, NOW), '3시간 전');
  assert.strictEqual(G.ago(NOW - 30 * HOUR, NOW), '어제');
  assert.strictEqual(G.ago(NOW - 80 * HOUR, NOW), '3일 전');
});
