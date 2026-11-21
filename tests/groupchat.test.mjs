// v4.1 그룹 채팅 앱 쪽 순수 함수 (js/groupchat.js의 lib): 글 다듬기가 서버와 같은지, 욕설 가리기, 연락처 찾기, 새 메시지 수, 합치기
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanMsg as serverClean, CHAT } from '../worker/src/group.js';

const require = createRequire(import.meta.url);
const C = require('../js/groupchat.js');
const MIN = 60000, DAY = 86400000;
const ZW = String.fromCharCode(0x200b), SHY = String.fromCharCode(0xad), BOM = String.fromCharCode(0xfeff), LS = String.fromCharCode(0x2028), RLO = String.fromCharCode(0x202e);

test('글 다듬기와 길이 한도는 서버와 같다', () => {
  assert.equal(C.LEN, CHAT.len);
  assert.equal(C.LINES, CHAT.lines);
  assert.equal(C.KEEP, CHAT.keep);
  assert.equal(C.DAYS, CHAT.days);
  assert.equal(C.UNREAD, CHAT.unread);
  const samples = [
    '  오늘 8시에 같이 하자  ', '줄\r\n바꿈\r마침', 'a\n\n\n\nb', '탭\t\t사이   빈칸', `보이지${ZW}않는${SHY}글자${BOM}`, `방향${RLO}바꾸기${LS}줄`,
    '가'.repeat(200), '가'.repeat(201), '😀'.repeat(200), '😀'.repeat(201), Array(8).fill('줄').join('\n'), Array(9).fill('줄').join('\n'),
    '', '   ', '\n\n', ZW, '한글 ㅋㅋ e-mail@ok? 100%', 'é', 'ㄱㅏ',
  ];
  for (const v of samples) assert.equal(C.cleanMsg(v), serverClean(v), JSON.stringify(v));
  for (const v of [null, undefined, 3, {}, ['a']]) { assert.equal(C.cleanMsg(v), null); assert.equal(serverClean(v), null); }
  assert.equal(C.msgProblem('   '), 'empty');
  assert.equal(C.msgProblem('가'.repeat(201)), 'long');
  assert.equal(C.msgProblem('😀'.repeat(200)), null, '이모지 하나는 한 글자로 센다');
  assert.equal(C.msgProblem(Array(9).fill('줄').join('\n')), 'lines');
  assert.equal(C.msgProblem('a\n\n\n\n\n\n\n\n\nb'), null, '빈 줄이 많아도 두 줄로 줄인 뒤에 센다');
  assert.equal(C.cleanMsg('  오늘\n\n\n 8시  '), '오늘\n\n8시');
});

test('욕설 가리기: 자주 쓰는 심한 욕만, 보통 말은 그대로', () => {
  const masked = ['씨발', '아 씨발 어렵다', '시1발', '씨.발', 'ㅅㅂ', 'ㅆㅂ 진짜', '병신', '병~신', '개새끼야', '존나 어렵네', '지랄하네', 'ㅄ', '미친놈', 'fuck', 'Fucking hard', 'SHIT', 'what a bitch'];
  for (const t of masked) assert.ok(C.maskBad(t).includes('✱✱'), t);
  assert.equal(C.maskBad('아 씨발 미적분 어렵다'), '아 ✱✱ 미적분 어렵다');
  assert.equal(C.maskBad('씨발 씨발'), '✱✱ ✱✱');
  const clean = ['시발점부터 다시', '시발역에서 만나', '3시 발표 준비', '껌 씹어도 돼?', '꿈을 좇다', '새끼 고양이 귀여워', '미친 듯이 공부했다', '존재', '수능 D-100 스터디', '지 랄', 'classic assignment', 'Shiitake', '같이 공부하자 ✏️', ''];
  for (const t of clean) assert.equal(C.maskBad(t), t, t);
});

test('연락처처럼 보이는 글', () => {
  const yes = ['010-1234-5678', '내 번호 01012345678', '+82 10 1234 5678', '010 1234 5678로 연락해', '02-123-4567', '031)123-4567'.replace(')', '-'), '070-1234-5678',
    'me@test.com', 'my.name+study@school.ac.kr', '카톡 아이디 jiwoo99', '인스타 @study.min', 'insta: math_king', '디코 study#1234 아니 studyking', 'open.kakao.com/o/abcd', '@jiwoo_99 팔로우'];
  for (const t of yes) assert.ok(C.looksContact(t), t);
  const no = ['오늘 3시 10분에', '2026-11-20', '수학 22번 질문 있어', '10분 쉬고 올게 ☕', '010', '디코 할 사람', '1234-5678', '점수 95점 100점', '오후 8:52', '11월 20일 10시', 'p.123 1번', '나 @ 독서실', ''];
  for (const t of no) assert.ok(!C.looksContact(t), t);
});

test('새 메시지 수: 읽은 번호 뒤, 가린 사람 것은 빼고', () => {
  const chat = { on: true, v: 12, nu: [[3, 'a'], [5, 'b'], [8, 'a'], [11, 'c']] };
  assert.equal(C.unreadCount(chat, 0), 4, '처음이면 전부');
  assert.equal(C.unreadCount(chat, undefined), 4);
  assert.equal(C.unreadCount(chat, 5), 2);
  assert.equal(C.unreadCount(chat, 11), 0);
  assert.equal(C.unreadCount(chat, 5, ['a']), 1, '가린 사람 것은 세지 않음');
  assert.equal(C.unreadCount(chat, 99), 4, '서버 번호보다 크게 읽었다면(서버 기록이 새로 시작) 처음부터');
  assert.equal(C.unreadCount({ on: false, v: 0, nu: [[1, 'a']] }, 0), 0, '꺼 둔 채팅');
  assert.equal(C.unreadCount(null, 0), 0);
  assert.equal(C.unreadCount({ on: true, v: 3, nu: [['x', 'a'], null, [2, 'b']] }, 0), 1, '이상한 줄은 무시');
});

test('채팅 창을 열어 두었을 때 묻는 간격', () => {
  assert.equal(C.pollDelay(0), 3000);
  assert.equal(C.pollDelay(MIN - 1), 3000);
  assert.equal(C.pollDelay(MIN), 8000);
  assert.equal(C.pollDelay(5 * MIN - 1), 8000);
  assert.equal(C.pollDelay(5 * MIN), 20000);
  assert.equal(C.pollDelay(DAY), 20000);
});

test('받은 줄 합치기: 전부·새것만·지운 것·보내는 중·오래된 것', () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const L = (s, v, o) => Object.assign({ s, v, at: now - (20 - s) * MIN, f: 'a', n: 'A', t: 'm' + s }, o);
  let list = C.mergeLines([], { full: true, v: 3, ms: [L(1, 1), L(2, 2), L(3, 3)] }, now);
  assert.deepEqual(list.map((x) => x.s), [1, 2, 3]);
  // 새것만: 4번이 생기고 2번이 지워짐(판이 올라감)
  list = C.mergeLines(list, { full: false, v: 5, ms: [L(4, 4), Object.assign(L(2, 5), { t: undefined, x: 1 })] }, now);
  assert.deepEqual(list.map((x) => [x.s, x.x || 0]), [[1, 0], [2, 1], [3, 0], [4, 0]]);
  // 늦게 온 옛 답: 지운 2번을 되살리지 않고, 전부라도 빠진 줄을 지우지 않는다
  list = C.mergeLines(list, { full: true, v: 3, ms: [L(1, 1), L(2, 2), L(3, 3)] }, now, true);
  assert.deepEqual(list.map((x) => [x.s, x.x || 0]), [[1, 0], [2, 1], [3, 0], [4, 0]]);
  // 전부 (새 답): 서버에 없는 줄(오래되어 지워짐)은 빠진다
  list = C.mergeLines(list, { full: true, v: 6, ms: [L(3, 3), L(4, 4), L(6, 6, { f: 'me', c: 'abc123' })] }, now);
  assert.deepEqual(list.map((x) => x.s), [3, 4, 6]);
  // 보내는 중인 줄: 서버 줄에 같은 앱 번호가 보이면 뺀다. 아니면 맨 뒤에 그대로
  const pend = [{ pend: 1, c: 'abc123', t: 'x', at: now, f: 'me' }, { pend: 1, c: 'zzz999', t: 'y', at: now + 5, f: 'me' }];
  list = C.mergeLines(list.concat(pend), { full: false, v: 6, ms: [] }, now);
  assert.deepEqual(list.map((x) => x.pend ? 'p:' + x.c : x.s), [3, 4, 6, 'p:zzz999']);
  // 7일이 지난 줄과 150개 넘는 줄은 버린다
  const many = Array.from({ length: 160 }, (_, i) => ({ s: i + 1, v: i + 1, at: now - (160 - i) * MIN, f: 'a', n: 'A', t: 't' }));
  many[0].at = now - 8 * DAY;
  list = C.mergeLines([], { full: true, v: 160, ms: many }, now);
  assert.equal(list.length, 150);
  assert.equal(list[0].s, 11);
  assert.deepEqual(C.mergeLines([], { full: true, v: 1, ms: [{ s: 1, v: 1, at: now - 8 * DAY, f: 'a', t: 'old' }] }, now), []);
  // 모양이 틀린 줄은 버린다
  assert.deepEqual(C.mergeLines([], { full: true, v: 2, ms: [{ s: '1', v: 1, at: now, f: 'a' }, null, { s: 2, v: 2, at: now, f: 'a', t: 'ok' }] }, now).map((x) => x.s), [2]);
});

test('날 구분과 시각 글자', () => {
  const now = new Date(2026, 10, 20, 21, 10).getTime();
  assert.equal(C.dayLabel(new Date(2026, 10, 20, 0, 5).getTime(), now), '오늘');
  assert.equal(C.dayLabel(new Date(2026, 10, 19, 23, 59).getTime(), now), '어제');
  assert.equal(C.dayLabel(new Date(2026, 10, 18, 9).getTime(), now), '11월 18일 수요일');
  assert.equal(C.dayLabel(new Date(2026, 10, 30).getTime(), new Date(2026, 11, 1, 8).getTime()), '어제', '달이 바뀌어도');
  assert.equal(C.ampm(new Date(2026, 10, 20, 0, 5).getTime()), '오전 12:05');
  assert.equal(C.ampm(new Date(2026, 10, 20, 9, 5).getTime()), '오전 9:05');
  assert.equal(C.ampm(new Date(2026, 10, 20, 12, 0).getTime()), '오후 12:00');
  assert.equal(C.ampm(new Date(2026, 10, 20, 20, 52).getTime()), '오후 8:52');
});

test('앱이 붙이는 메시지 번호', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i++) { const id = C.newId(); assert.match(id, /^[0-9a-z]{6,16}$/); seen.add(id); }
  assert.ok(seen.size > 295, '거의 겹치지 않음');
  assert.equal(C.QUICK.length, 5);
  assert.ok(C.QUICK.every((q) => C.cleanMsg(q) === q), '빠른 말은 그대로 보낼 수 있는 글');
});
