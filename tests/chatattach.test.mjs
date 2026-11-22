// v4.3 채팅에 붙이는 것, 앱 쪽 순수 함수 (js/chatattach.js의 lib): 공부 기록 카드 만들기, 단어장 담기, 글 다듬기가 서버와 맞는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ATTACH, cleanCaption, cleanRecord, cleanDeck, altText as serverAlt } from '../worker/src/group.js';

const require = createRequire(import.meta.url);
const X = require('../js/chatattach.js');
const ZW = String.fromCharCode(0x200b), RLO = String.fromCharCode(0x202e), LS = String.fromCharCode(0x2028), BOM = String.fromCharCode(0xfeff);
const HOUR = 3600000;

// 날짜 키 (이 시험은 날 시작 시각을 0시로 본다)
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const at = (key, h) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, h == null ? 15 : h).getTime(); };
const monday = (key) => { const [y, m, d] = key.split('-').map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return keyOf(t.getTime()); };
const env = (today, o) => Object.assign({ today, dayKey: keyOf, weekStart: monday, streak: 0, live: null, names: true }, o);

test('한도는 서버와 같다', () => {
  assert.equal(X.LIMIT.img, ATTACH.img);
  assert.equal(X.LIMIT.th, ATTACH.thumb);
  assert.equal(X.LIMIT.cap, ATTACH.cap);
  assert.equal(X.LIMIT.memo, ATTACH.memo);
  assert.equal(X.LIMIT.cards, ATTACH.cards);
  assert.equal(X.LIMIT.front, ATTACH.front);
  assert.equal(X.LIMIT.back, ATTACH.back);
  assert.equal(X.LIMIT.deck, ATTACH.deckName);
  assert.equal(X.LIMIT.chars, ATTACH.deckChars);
  assert.ok(X.LIMIT.side <= ATTACH.side && X.LIMIT.thumb <= ATTACH.side, '보내는 사진 크기는 서버가 받는 크기 안');
});

test('사진 설명·한마디 다듬기는 서버와 같다', () => {
  const samples = ['  오늘 푼 문제  ', '줄\n바꿈\r\n두 번', `보이지${ZW}않는${BOM}글자`, `방향${RLO}바꾸기${LS}줄`, '탭\t\t빈칸   여럿', 'é', '😀 이모지', '가'.repeat(100)];
  for (const v of samples) assert.equal(X.tidyLine(v), cleanCaption(v, 100), JSON.stringify(v));
  assert.equal(X.tidyLine(null), '');
  assert.equal(X.tidyLine(`${ZW} \n `), '');
});

test('미리 보기 글은 서버와 같다', () => {
  const rec = { sp: 'd', d: '2026-11-21', m: 205, g: 180, fo: 2, td: [1, 2], sk: 3, sb: [], o: 0 };
  const cases = [
    { p: 'img' }, { p: 'img', t: '오늘 푼 문제' },
    { p: 'rec', r: rec }, { p: 'rec', r: rec, t: '내일도 화이팅' }, { p: 'rec', r: Object.assign({}, rec, { sp: 'w', e: '2026-11-21', d: '2026-11-16', m: 59 }) },
    { p: 'rec', r: Object.assign({}, rec, { m: 120 }) },
    { p: 'deck', dn: '영어 단어 Day 1', cn: 40 },
  ];
  for (const x of cases) assert.equal(X.altText(x), serverAlt(x), JSON.stringify(x));
  assert.equal(X.altText({ p: 'rec', r: rec, t: '굿' }), '📊 오늘 공부 3시간 25분 · 굿');
});

test('공부 기록 카드: 오늘', () => {
  const today = '2026-11-21'; // 토요일
  const st = {
    subjects: [
      { id: 'kor', name: '국어', color: '#E91E63' }, { id: 'math', name: '수학', color: '#2196F3' },
      { id: 'eng', name: '영어', color: 'red' }, { id: 'sci', name: '  과학  탐구 ', color: '#4caf50' },
      { id: 'his', name: '한국사', color: '#795548' }, { id: 'spa', name: '스페인어', color: '#ff9800' },
    ],
    sessions: [
      { subjectId: 'math', minutes: 50, endedAt: at(today, 9) }, // 집중 타이머
      { subjectId: 'math', minutes: 40, endedAt: at(today, 10), kind: 'stopwatch' },
      { subjectId: 'kor', minutes: 30, endedAt: at(today, 11), manual: true },
      { subjectId: 'eng', minutes: 25, endedAt: at(today, 12) },
      { subjectId: 'sci', minutes: 20, endedAt: at(today, 13) },
      { subjectId: 'his', minutes: 10, endedAt: at(today, 14), manual: true },
      { subjectId: 'spa', minutes: 5, endedAt: at(today, 15), manual: true },
      { subjectId: 'gone', minutes: 15, endedAt: at(today, 16), manual: true }, // 지운 과목
      { subjectId: null, minutes: 0, endedAt: at(today, 17) }, // 0분짜리 집중도 횟수에는 든다
      { subjectId: 'math', minutes: 99, endedAt: at('2026-11-20', 15) }, // 어제
    ],
    tasks: [
      { title: '비밀 할 일 제목', due: today, done: true }, { title: '수학 숙제', due: today, done: false },
      { title: '어제 일', due: '2026-11-20', done: true }, { title: '날짜 없는 일', done: true },
    ],
    settings: { dailyGoalMin: 180 },
  };
  const r = X.buildRecord(st, 'd', env(today, { streak: 4, live: { min: 12, subjectId: 'kor' } }));
  assert.deepEqual(r, {
    sp: 'd', d: today, m: 207, g: 180, fo: 4, td: [1, 2], sk: 4,
    sb: [
      { m: 90, c: '#2196f3', n: '수학' }, { m: 42, c: '#e91e63', n: '국어' }, { m: 25, c: '', n: '영어' },
      { m: 20, c: '#4caf50', n: '과학 탐구' }, { x: 1, m: 15, c: '' },
    ],
    o: 15,
  });
  assert.deepEqual(cleanRecord(r), r, '서버가 그대로 받는 모양');
  assert.ok(!JSON.stringify(r).includes('비밀 할 일 제목') && !JSON.stringify(r).includes('숙제'), '할 일 제목은 넣지 않는다');
  // 과목 이름 빼기
  const hid = X.buildRecord(st, 'd', env(today, { names: false }));
  assert.ok(hid.sb.every((s) => !('n' in s)) && hid.m === 195, '과목 이름을 빼면 n이 없다 (재는 중인 시간도 없으면 안 더한다)');
  assert.deepEqual(cleanRecord(hid), hid);
  const v = X.recordView(hid);
  assert.deepEqual(v.subs.map((s) => s.label), ['과목 1', '과목 2', '과목 3', '과목 4', '과목 없음', '기타']);
  // 빈 날
  const empty = X.buildRecord({ subjects: [], sessions: [], tasks: [], settings: {} }, 'd', env(today));
  assert.deepEqual(empty, { sp: 'd', d: today, m: 0, g: 0, fo: 0, td: [0, 0], sk: 0, sb: [], o: 0 });
  assert.deepEqual(cleanRecord(empty), empty);
});

test('공부 기록 카드: 이번 주는 월요일부터 오늘까지', () => {
  const today = '2026-11-19'; // 목요일
  const st = {
    subjects: [{ id: 'math', name: '수학', color: '#2196F3' }],
    sessions: [
      { subjectId: 'math', minutes: 60, endedAt: at('2026-11-16') }, // 월
      { subjectId: 'math', minutes: 30, endedAt: at('2026-11-18'), manual: true },
      { subjectId: 'math', minutes: 45, endedAt: at(today) },
      { subjectId: 'math', minutes: 500, endedAt: at('2026-11-15') }, // 지난 일요일
      { subjectId: 'math', minutes: 500, endedAt: at('2026-11-20') }, // 내일 (시계가 틀린 기록)
    ],
    tasks: [{ due: '2026-11-16', done: true }, { due: '2026-11-17', done: false }, { due: '2026-11-15', done: true }, { due: '2026-11-20', done: false }],
    settings: { dailyGoalMin: 60 },
  };
  const r = X.buildRecord(st, 'w', env(today, { streak: 2 }));
  assert.deepEqual(r, { sp: 'w', d: '2026-11-16', e: today, m: 135, g: 60, fo: 2, td: [1, 2], sk: 2, sb: [{ m: 135, c: '#2196f3', n: '수학' }], o: 0 });
  assert.deepEqual(cleanRecord(r), r);
  const v = X.recordView(r);
  assert.equal(v.title, '이번 주 공부 기록');
  assert.equal(v.date, '11월 16일 ~ 19일');
  assert.deepEqual(v.goal, { pre: '하루 평균 34분 · 목표의 ', pct: 56, bar: 56, crown: false }, '주는 지난 날 수(4일)로 나눈다');
  assert.deepEqual(v.chips, ['집중 2번', '할 일 1/2', '2일 연속']);
  // 월요일이면 이번 주 = 오늘 하루
  const mon = X.buildRecord(st, 'w', env('2026-11-16'));
  assert.equal(mon.d, '2026-11-16'); assert.equal(mon.e, '2026-11-16'); assert.equal(mon.m, 60);
  assert.deepEqual(cleanRecord(mon), mon);
  // 달이 바뀌는 주
  assert.equal(X.spanLabel({ sp: 'w', d: '2026-11-30', e: '2026-12-03' }), '11월 30일 ~ 12월 3일');
  assert.equal(X.spanLabel({ sp: 'd', d: '2026-11-21' }), '11월 21일 (토)');
});

test('공부 기록 카드 보이기: 목표 %, 왕관, 막대 길이', () => {
  const v = X.recordView({ sp: 'd', d: '2026-11-21', m: 200, g: 180, fo: 0, td: [0, 0], sk: 0, sb: [{ m: 150, c: '#2196f3', n: '수학' }, { m: 1, c: '' }], o: 49 });
  assert.equal(v.title, '오늘 공부 기록');
  assert.deepEqual(v.goal, { pre: '하루 목표 3시간 · ', pct: 111, bar: 100, crown: true });
  assert.deepEqual(v.subs.map((s) => [s.label, s.pct, s.color]), [['수학', 100, '#2196f3'], ['과목 1', 3, ''], ['기타', 33, '']], '짧아도 막대는 조금 보이게');
  assert.deepEqual(v.chips, []);
  const none = X.recordView({ sp: 'w', d: '2026-11-16', e: '2026-11-21', m: 0, g: 0, fo: 0, td: [0, 3], sk: 0, sb: [], o: 0 });
  assert.equal(none.goal, null);
  assert.equal(none.note, '하루 평균 0분');
  assert.deepEqual(none.chips, ['할 일 0/3']);
  assert.equal(X.fm(0), '0분'); assert.equal(X.fm(59), '59분'); assert.equal(X.fm(60), '1시간'); assert.equal(X.fm(125), '2시간 5분');
});

test('단어장 담기: 앞·뒤 글자만, 빈 카드는 빼고, 1000장까지', () => {
  const cards = [
    { front: '  apple ', back: '사과', ease: 2.5, due: 123, reps: 9 },
    { front: `ha${ZW}cer`, back: '하다\n(동사)' },
    { front: '빈 뒤', back: '   ' },
    { front: 'x'.repeat(400), back: 'y'.repeat(600) },
  ];
  const pl = X.deckPayload('  스페인어   동사 ', cards);
  assert.deepEqual(pl, { n: '스페인어 동사', cs: [['apple', '사과'], ['ha cer', '하다 (동사)'], ['x'.repeat(300), 'y'.repeat(500)]], cut: 0, skip: 1 });
  assert.deepEqual(cleanDeck(pl), { n: pl.n, cs: pl.cs }, '서버가 그대로 받는 모양 (복습 기록은 없음)');
  assert.equal(X.deckPayload('', [{ front: 'a', back: 'b' }]).n, '단어장');
  assert.equal(X.deckPayload('가'.repeat(50), [{ front: 'a', back: 'b' }]).n, '가'.repeat(40));
  const many = Array.from({ length: 1003 }, (_, i) => ({ front: 'w' + i, back: '뜻' + i }));
  const big = X.deckPayload('많은 덱', many);
  assert.equal(big.cs.length, 1000); assert.equal(big.cut, 3); assert.equal(big.cs[999][0], 'w999');
  assert.ok(cleanDeck(big), '1000장은 서버가 받는다');
  // 글자가 아주 많으면 20만 자에서 끊는다
  const long = Array.from({ length: 400 }, () => ({ front: 'f'.repeat(300), back: 'b'.repeat(500) }));
  const lp = X.deckPayload('긴 덱', long);
  assert.equal(lp.cs.length, 250); assert.equal(lp.cut, 150);
  assert.ok(cleanDeck(lp));
  assert.deepEqual(X.deckPayload('빈 덱', []), { n: '빈 덱', cs: [], cut: 0, skip: 0 });
});

test('사진 크기 맞추기와 크기 글', () => {
  assert.deepEqual(X.fitSize(4032, 3024, 1600), { w: 1600, h: 1200 });
  assert.deepEqual(X.fitSize(3024, 4032, 1600), { w: 1200, h: 1600 });
  assert.deepEqual(X.fitSize(800, 600, 1600), { w: 800, h: 600 }, '작은 사진은 키우지 않는다');
  assert.deepEqual(X.fitSize(10000, 10, 1600), { w: 1600, h: 2 });
  assert.deepEqual(X.fitSize(0, NaN, 480), { w: 1, h: 1 });
  assert.equal(X.sizeText(300 * 1024), '0.3MB');
  assert.equal(X.sizeText(1024 * 1024), '1MB');
  assert.equal(X.sizeText(64 * 1024), '64KB');
  assert.equal(X.sizeText(10), '1KB');
});

test('날 경계: 자정 전후 기록과 날 시작 시각', () => {
  const today = '2026-11-21';
  const st = { subjects: [], sessions: [{ subjectId: null, minutes: 30, endedAt: at(today, 0) + 1000 }, { subjectId: null, minutes: 20, endedAt: at(today, 0) - 1000 }], tasks: [], settings: {} };
  const r = X.buildRecord(st, 'd', env(today));
  assert.equal(r.m, 30);
  assert.deepEqual(r.sb, [{ x: 1, m: 30, c: '' }]);
  // 날 시작 시각을 바꾼 사람: dayKey가 새벽 기록을 어제로 본다
  const shifted = X.buildRecord(st, 'd', env(today, { dayKey: (t) => keyOf(t - 4 * HOUR) }));
  assert.equal(shifted.m, 0);
});
