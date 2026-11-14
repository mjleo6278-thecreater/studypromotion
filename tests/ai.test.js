// AI 도우미의 순수 로직: AI에게 보낼 정보, 답 읽기, 동작 검사, 적용과 되돌리기
const test = require('node:test');
const assert = require('node:assert');
const AI = require('../js/aicore.js');
const Stats = require('../js/stats.js');
const { defaults } = require('../js/store.js');

const NOW = new Date(2026, 10, 14, 10, 30).getTime(); // 2026-11-14(토) 10:30
let seq = 0;
const env = () => ({ now: NOW, uid: () => 'n' + (++seq) });

function sample() {
  Stats.setDayStart(0);
  const st = defaults();
  st.subjects = [{ id: 's-kor', name: '국어', color: '#e05a4f' }, { id: 's-m1', name: '수학 I', color: '#3d96e0' }, { id: 's-m2', name: '수학 II', color: '#45a865' }, { id: 's-eng', name: '영어', color: '#e3ae24' }];
  st.tasks = [
    { id: 'k1', title: '영어 단어 50개', subjectId: 's-eng', due: '2026-11-13', done: false, createdAt: 1 },
    { id: 'k2', title: '국어 문법 정리', subjectId: 's-kor', due: '2026-11-14', done: false, createdAt: 2 },
    { id: 'k3', title: '끝낸 일', subjectId: null, due: '2026-11-10', done: true, createdAt: 3 },
    { id: 'k4', title: '마감 없는 일', subjectId: null, due: null, done: false, createdAt: 4 },
  ];
  st.exams = [{ id: 'x1', name: '기말고사', date: '2026-12-01', createdAt: 1 }];
  st.decks = [{ id: 'd1', name: '스페인어', createdAt: 1 }];
  st.sessions = [
    { id: 'ss1', subjectId: 's-kor', minutes: 60, endedAt: new Date(2026, 10, 13, 20, 0).getTime() },
    { id: 'ss2', subjectId: 's-eng', minutes: 30, endedAt: new Date(2026, 10, 14, 9, 0).getTime() },
    { id: 'ss3', subjectId: 's-kor', minutes: 45, endedAt: new Date(2026, 10, 5, 9, 0).getTime() },
  ];
  return st;
}
// 일정: 매주 월·수 수학 학원(16~18시), 내일 저녁 영어 단어, 모레 친구 약속, 한참 뒤의 일정
function events() {
  return [
    { id: 'ev-a', kind: 'study', title: '학원', subjectId: 's-m1', taskId: null, date: '2026-11-02', start: '16:00', end: '18:00', repeat: { freq: 'weekly', days: [1, 3], until: null }, skip: [], createdAt: 1 },
    { id: 'ev-b', kind: 'study', title: '', subjectId: 's-eng', taskId: 'k1', date: '2026-11-15', start: '20:00', end: '21:00', repeat: null, skip: [], createdAt: 2 },
    { id: 'ev-c', kind: 'other', title: '친구 약속', subjectId: null, taskId: null, date: '2026-11-16', start: '18:30', end: '20:00', repeat: null, skip: [], createdAt: 3 },
    { id: 'ev-d', kind: 'study', title: '겨울 특강', subjectId: null, taskId: null, date: '2027-01-05', start: '10:00', end: '12:00', repeat: null, skip: [], createdAt: 4 },
  ];
}
const withEvents = () => { const st = sample(); st.events = events(); return st; };
const check = (actions, st) => { st = st || sample(); const ctx = AI.buildContext(st, NOW); return { st, ctx, res: AI.validate(actions, st, ctx, NOW) }; };

/* ---------- AI에게 보낼 정보 ---------- */
test('AI에게는 안 끝낸 할 일만, 짧은 번호로 보낸다', () => {
  const ctx = AI.buildContext(sample(), NOW);
  assert.deepStrictEqual(ctx.tasks.map((t) => t.title), ['영어 단어 50개', '국어 문법 정리', '마감 없는 일']);
  assert.deepStrictEqual(ctx.tasks.map((t) => t.k), ['t1', 't2', 't3']);
  assert.strictEqual(ctx.keys.tasks.t1, 'k1');
  assert.strictEqual(ctx.keys.exams.e1, 'x1');
  assert.strictEqual(ctx.todayMin, 30);
});
test('AI에게 보내는 글에는 기록의 id나 공부 기록 전체가 없다', () => {
  const st = sample();
  st.cards = [{ id: 'c1', deckId: 'd1', front: '비밀 카드 앞면', back: '비밀 카드 뒷면' }];
  st.events = events();
  const text = AI.contextText(AI.buildContext(st, NOW));
  for (const secret of ['k1', 'x1', 's-kor', 'ss1', 'ev-a', '비밀 카드', '끝낸 일']) assert.ok(!text.includes(secret), secret);
  assert.match(text, /t1 "영어 단어 50개" \[영어\] 마감 2026-11-13/);
  assert.match(text, /e1 "기말고사" 2026-12-01/);
});
test('날짜표에 오늘·내일·요일과 이번 주·다음 주가 들어간다', () => {
  const cal = AI.calendarText('2026-11-14');
  assert.match(cal, /오늘 2026-11-14\(토\), 내일 2026-11-15\(일\), 모레 2026-11-16\(월\)/);
  assert.match(cal, /어제 2026-11-13\(금\)/);
  assert.match(cal, /이번 주는 2026-11-09\(월\)부터 2026-11-15\(일\)까지, 다음 주는 2026-11-16\(월\)부터 2026-11-22\(일\)까지/);
  assert.match(AI.calendarText('2026-11-15'), /이번 주는 2026-11-09\(월\)부터/); // 일요일도 그 주에 든다
});
test('할 일이 많으면 40개까지만 보내고 나머지는 개수만', () => {
  const st = sample();
  for (let i = 0; i < 60; i++) st.tasks.push({ id: 'm' + i, title: '일 ' + i, due: null, done: false, createdAt: 10 + i });
  const ctx = AI.buildContext(st, NOW);
  assert.strictEqual(ctx.tasks.length, 40);
  assert.strictEqual(ctx.moreTasks, 23);
});
test('앱 정보가 필요한 말인지 가린다', () => {
  for (const t of ['내일 수학 할 일 추가해 줘', '오늘 못 한 거 미뤄 줘', '영어 25분 집중 시작', '이번 주 몇 시간 했어?', '기말고사 날짜 바꿔 줘']) assert.ok(AI.needsApp(t), t);
  for (const t of ['echar de menos가 무슨 뜻이야?', 'Ojalá no llueva mañana 구문 해석해 줘', '접속법은 언제 써?']) assert.ok(!AI.needsApp(t), t);
});
test('지시문: 앱 정보는 필요할 때만 붙이고, 지난 대화는 여섯 개까지만', () => {
  const ctx = AI.buildContext(sample(), NOW);
  const hist = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '말 ' + i }));
  const ask = AI.messages('hola 뜻', ctx, hist, false), app = AI.messages('할 일 추가', ctx, hist, true);
  assert.strictEqual(ask.length, 8);
  assert.strictEqual(ask[0].role, 'system');
  assert.ok(!ask[0].content.includes('[앱 정보]') && ask[0].content.includes('<need_app/>'));
  assert.ok(app[0].content.includes('[앱 정보]') && app[0].content.includes('영어 단어 50개'));
  assert.ok(!/delete|remove|지우는 동작은 있다/.test(app[0].content));
  assert.deepStrictEqual(ask[ask.length - 1], { role: 'user', content: 'hola 뜻' });
});

/* ---------- 답 읽기 ---------- */
test('답에서 글과 동작 목록을 나눈다', () => {
  const r = AI.parseReply('내일로 옮길게요.\n<actions>[{"type":"move_task","task":"t1","due":"2026-11-15"}]</actions>');
  assert.strictEqual(r.text, '내일로 옮길게요.');
  assert.deepStrictEqual(r.actions, [{ type: 'move_task', task: 't1', due: '2026-11-15' }]);
  assert.strictEqual(r.broken, false);
});
test('조금 틀리게 적은 동작 목록도 읽는다', () => {
  const body = '[{"type":"add_task","title":"가"},]';
  for (const raw of [
    `<actions>\n\`\`\`json\n${body}\n\`\`\`\n</actions>`, // 코드 울타리 안
    `<actions>${body}`, // 닫는 꼬리표 없음
    `<actions>{"actions":${body}}</actions>`, // 한 겹 더 쌈
    `<actions>{"type":"add_task","title":"가"}</actions>`, // 하나만
    `이렇게 할게요.\n\`\`\`json\n${body}\n\`\`\``, // 꼬리표 없이 울타리만
  ]) assert.deepStrictEqual(AI.parseReply(raw).actions, [{ type: 'add_task', title: '가' }], raw);
});
test('읽지 못한 동작 목록은 버리고 알린다', () => {
  const r = AI.parseReply('바꿀게요 <actions>[{"type": 고장</actions>');
  assert.deepStrictEqual(r.actions, []);
  assert.strictEqual(r.broken, true);
  assert.strictEqual(r.text, '바꿀게요');
});
test('카드 후보는 다섯 개까지, 앞뒤가 다 있는 것만', () => {
  const cards = Array.from({ length: 7 }, (_, i) => ({ front: 'f' + i, back: 'b' + i })).concat([{ front: '', back: 'x' }]);
  const r = AI.parseReply('설명입니다.\n<cards>' + JSON.stringify(cards) + '</cards>');
  assert.strictEqual(r.cards.length, 5);
  assert.deepStrictEqual(r.cards[0], { front: 'f0', back: 'b0' });
  assert.strictEqual(r.text, '설명입니다.');
});
test('앱 정보가 필요하다는 신호를 알아챈다', () => {
  assert.strictEqual(AI.parseReply('<need_app/>').needApp, true);
  assert.strictEqual(AI.parseReply('<need_app/>').text, '');
  assert.strictEqual(AI.parseReply('hola는 안녕').needApp, false);
});
test('답이 오는 도중에는 꼬리표를 화면에 보이지 않는다', () => {
  assert.strictEqual(AI.visibleText('옮길게요.\n<actions>[{"type"'), '옮길게요.');
  assert.strictEqual(AI.visibleText('옮길게요.\n<act'), '옮길게요.');
  assert.strictEqual(AI.visibleText('뜻은 이래요 <car'), '뜻은 이래요');
  assert.strictEqual(AI.visibleText('a < b 이면'), 'a < b 이면'); // 그냥 부등호는 그대로
  assert.strictEqual(AI.visibleText('<need_app/>'), '');
});

/* ---------- 동작 검사 ---------- */
test('앱에 없는 동작, 지우는 동작은 버린다', () => {
  const { res } = check([{ type: 'delete_task', task: 't1' }, { type: 'reset' }, { type: '__proto__' }, { nope: 1 }, null, 'x']);
  assert.strictEqual(res.ops.length, 0);
  assert.strictEqual(res.rejected.length, 6);
  assert.match(res.rejected[0], /앱에 없는 동작이라 뺐어요: delete_task/);
});
test('할 일 추가: 과목·마감일·예상 시간을 맞춰 준다', () => {
  const { res } = check([{ type: 'add_task', title: '  영어  본문 암기 ', subject: '영어', due: '2026-11-15', minutes: 60 }]);
  assert.deepStrictEqual(res.ops[0].data, { title: '영어 본문 암기', subjectId: 's-eng', due: '2026-11-15', est: 60 });
  assert.strictEqual(res.ops[0].line, '할 일 추가: 영어 본문 암기');
  assert.strictEqual(res.ops[0].sub, '영어 · 내일 11/15(일)까지 · 1시간');
});
test('할 일 추가: 이름이 없거나 날짜가 틀리면 뺀다', () => {
  const { res } = check([{ type: 'add_task', title: '' }, { type: 'add_task', title: '가', due: '2026-02-30' }, { type: 'add_task', title: '나', due: '내일' }, { type: 'add_task', title: '다', due: '2099-01-01' }]);
  assert.strictEqual(res.ops.length, 0);
  assert.strictEqual(res.rejected.length, 4);
});
test('없는 과목은 과목 없이, 여러 개에 맞으면 고르게 한다', () => {
  const { res } = check([{ type: 'add_task', title: '가', subject: '물리' }, { type: 'add_task', title: '나', subject: '수학' }, { type: 'add_task', title: '다', subject: '수학 I' }]);
  assert.strictEqual(res.ops[0].data.subjectId, null);
  assert.match(res.ops[0].warn, /'물리' 과목이 없어서/);
  assert.deepStrictEqual(res.ops[1].choices.map((c) => c.name), ['수학 I', '수학 II']);
  assert.match(res.ops[1].warn, /골라 주세요/);
  assert.strictEqual(res.ops[2].data.subjectId, 's-m1');
});
test('마감일 옮기기: 번호로 가리킨 할 일만, 같은 날짜면 건너뛴다', () => {
  const { res } = check([{ type: 'move_task', task: 't1', due: '2026-11-15' }, { type: 'move_task', task: 't2', due: '2026-11-14' }, { type: 'move_task', task: 't9', due: '2026-11-15' }, { type: 'move_task', task: 'k1', due: '2026-11-15' }]);
  assert.strictEqual(res.ops.length, 1);
  assert.deepStrictEqual(res.ops[0].data, { id: 'k1', due: '2026-11-15', prev: '2026-11-13' });
  assert.strictEqual(res.ops[0].sub, '어제 11/13(금) → 내일 11/15(일)');
  assert.strictEqual(res.rejected.length, 2); // 없는 번호, 진짜 id를 직접 적은 것
});
test('공부 기록: 시각으로 적으면 시작·끝을 계산하고 겹치면 알린다', () => {
  const { res } = check([{ type: 'add_session', subject: '국어', date: '2026-11-13', start: '19:00', end: '21:00' }]);
  const d = res.ops[0].data;
  assert.strictEqual(d.from, new Date(2026, 10, 13, 19, 0).getTime());
  assert.strictEqual(d.to, new Date(2026, 10, 13, 21, 0).getTime());
  assert.strictEqual(res.ops[0].sub, '어제 11/13(금) 19:00~21:00 · 2시간');
  assert.match(res.ops[0].warn, /이미 있는 기록과 1시간 겹쳐요/); // 19:00~20:00 국어 기록이 있다
});
test('공부 기록: 앞날이나 아직 오지 않은 시각은 받지 않는다', () => {
  const { res } = check([
    { type: 'add_session', date: '2026-11-15', minutes: 60 },
    { type: 'add_session', date: '2026-11-14', start: '10:00', end: '12:00' },
    { type: 'add_session', date: '2026-11-14', start: '25:00', end: '26:00' },
    { type: 'add_session', date: '2026-11-14', minutes: 0 },
  ]);
  assert.strictEqual(res.ops.length, 0);
  assert.match(res.rejected[1], /아직 오지 않은 시각/);
});
test('공부 기록: 자정을 넘긴 공부는 다음 날로 이어진다', () => {
  const { st, res } = check([{ type: 'add_session', subject: '영어', date: '2026-11-12', start: '23:00', end: '1:00' }]);
  assert.strictEqual(res.ops[0].sub, '11/12(목) 23:00~다음 날 1:00 · 2시간');
  AI.applyOps(st, res.ops, env());
  const added = st.sessions.slice(-2);
  assert.deepStrictEqual(added.map((s) => s.minutes), [60, 60]);
  assert.deepStrictEqual(added.map((s) => Stats.dayKey(s.endedAt)), ['2026-11-12', '2026-11-13']);
  assert.ok(added.every((s) => s.manual && s.subjectId === 's-eng' && s.startAt > 0));
});
test('설정 바꾸기: 범위를 벗어난 값은 버리고 그대로인 값은 건너뛴다', () => {
  const { res } = check([{ type: 'set_goal', dailyMinutes: 180, focusMinutes: 25, breakMinutes: 600 }]);
  assert.deepStrictEqual(res.ops[0].data.sets, [{ key: 'dailyGoalMin', value: 180, prev: 120 }]);
  assert.strictEqual(res.ops[0].sub, '하루 목표 2시간 → 3시간');
  assert.strictEqual(check([{ type: 'set_goal', focusMinutes: 25 }]).res.ops.length, 0);
});
test('공부 시간 보기: 끝이 앞날이면 오늘까지만, 앱이 직접 계산한다', () => {
  const { st, res } = check([{ type: 'show_stats', from: '2026-11-09', to: '2026-11-15' }, { type: 'show_stats', from: '2026-11-09', to: '2026-11-15', subject: '국어' }]);
  assert.strictEqual(res.ops[0].kind, 'read');
  assert.deepStrictEqual(res.ops[0].data, { from: '2026-11-09', to: '2026-11-14', subjectId: null });
  const all = AI.stats(st, '2026-11-09', '2026-11-14', null);
  assert.strictEqual(all.total, 90);
  assert.strictEqual(all.days, 2);
  assert.deepStrictEqual(all.rows.map((r) => [r.name, r.minutes]), [['국어', 60], ['영어', 30]]);
  assert.strictEqual(AI.stats(st, '2026-11-09', '2026-11-14', 's-kor').total, 60);
});
test('타이머 시작과 화면 열기는 한 번씩만', () => {
  const { res } = check([{ type: 'start_timer', kind: 'focus', subject: '영어', minutes: 25 }, { type: 'start_timer', kind: 'stopwatch' }, { type: 'open_view', view: 'stats' }, { type: 'open_view', view: 'account' }]);
  assert.deepStrictEqual(res.ops.map((o) => o.kind), ['effect', 'nav']);
  assert.deepStrictEqual(res.ops[0].data, { kind: 'focus', subjectId: 's-eng', minutes: 25 });
  assert.strictEqual(res.ops[0].sub, '영어 · 25분');
  assert.strictEqual(res.rejected.length, 1); // 계정 화면은 열 수 없다
});
test('한 번에 스무 개까지만 받는다', () => {
  const { res } = check(Array.from({ length: 25 }, (_, i) => ({ type: 'add_task', title: '일 ' + i })));
  assert.strictEqual(res.ops.length, 20);
  assert.match(res.rejected[0], /20개까지만/);
});
test('사용자 기록에 든 글자는 그대로 글자로만 다룬다', () => {
  const { st, res } = check([{ type: 'add_task', title: '<img src=x onerror=alert(1)>' }]);
  AI.applyOps(st, res.ops, env());
  assert.strictEqual(st.tasks[st.tasks.length - 1].title, '<img src=x onerror=alert(1)>'); // 저장은 그대로, 화면에서 esc
});

/* ---------- 적용과 되돌리기 ---------- */
test('적용하면 기록이 바뀌고, 되돌리면 처음과 똑같아진다', () => {
  const { st, res } = check([
    { type: 'add_task', title: '새 할 일', subject: '영어', due: '2026-11-16' },
    { type: 'move_task', task: 't1', due: '2026-11-15' },
    { type: 'complete_task', task: 't2' },
    { type: 'add_session', subject: '국어', date: '2026-11-12', start: '14:00', end: '15:30', memo: '모의고사' },
    { type: 'add_session', date: '2026-11-11', minutes: 40 },
    { type: 'add_exam', name: '모의고사', date: '2026-11-20' },
    { type: 'set_exam_date', exam: 'e1', date: '2026-12-08' },
    { type: 'set_goal', dailyMinutes: 180, monthlyHours: 40 },
    { type: 'add_subject', name: '스페인어' },
    { type: 'add_card', front: 'echar de menos', back: '그리워하다' },
    { type: 'add_card', deck: '새 덱', front: 'ojalá', back: '~이면 좋겠다' },
    { type: 'add_card', deck: '새 덱', front: 'quizás', back: '아마도' },
  ]);
  assert.strictEqual(res.rejected.length, 0);
  assert.strictEqual(res.ops.length, 12);
  const before = JSON.stringify(st);
  const inv = AI.applyOps(st, res.ops, env());
  const task = st.tasks.find((t) => t.title === '새 할 일');
  assert.deepStrictEqual([task.subjectId, task.due, task.done], ['s-eng', '2026-11-16', false]);
  assert.strictEqual(st.tasks.find((t) => t.id === 'k1').due, '2026-11-15');
  assert.strictEqual(st.tasks.find((t) => t.id === 'k2').done, true);
  const timed = st.sessions.find((s) => s.label === '모의고사');
  assert.deepStrictEqual([timed.minutes, timed.manual, timed.startAt], [90, true, new Date(2026, 10, 12, 14, 0).getTime()]);
  assert.strictEqual(Stats.dayKey(st.sessions[st.sessions.length - 1].endedAt), '2026-11-11');
  assert.strictEqual(st.exams.length, 2);
  assert.strictEqual(st.exams[0].date, '2026-12-08');
  assert.deepStrictEqual([st.settings.dailyGoalMin, st.settings.monthlyGoalMin], [180, 2400]);
  assert.ok(st.subjects.some((s) => s.name === '스페인어' && /^#/.test(s.color)));
  assert.deepStrictEqual(st.decks.map((d) => d.name), ['스페인어', '새 덱']); // 덱이 하나뿐이면 그 덱에, 이름을 적으면 새 덱 하나만
  assert.deepStrictEqual(st.cards.map((c) => [c.front, st.decks.find((d) => d.id === c.deckId).name]), [['echar de menos', '스페인어'], ['ojalá', '새 덱'], ['quizás', '새 덱']]);
  assert.ok(st.cards.every((c) => c.ease === 2.5 && c.reps === 0 && c.due > 0));
  assert.strictEqual(AI.undoOps(st, inv) > 0, true);
  assert.strictEqual(JSON.stringify(st), before);
});
test('되돌릴 때 그사이 직접 고친 것은 건드리지 않는다', () => {
  const { st, res } = check([{ type: 'move_task', task: 't1', due: '2026-11-15' }, { type: 'set_goal', dailyMinutes: 180 }, { type: 'add_subject', name: '스페인어' }]);
  const inv = AI.applyOps(st, res.ops, env());
  st.tasks.find((t) => t.id === 'k1').due = '2026-11-20'; // 사용자가 다시 고침
  st.settings.dailyGoalMin = 200;
  st.tasks.push({ id: 'z', title: '스페인어 숙제', subjectId: st.subjects.find((s) => s.name === '스페인어').id, done: false });
  assert.strictEqual(AI.undoOps(st, inv), 0);
  assert.strictEqual(st.tasks.find((t) => t.id === 'k1').due, '2026-11-20');
  assert.strictEqual(st.settings.dailyGoalMin, 200);
  assert.ok(st.subjects.some((s) => s.name === '스페인어')); // 이미 쓰는 과목은 남긴다
});
test('타이머 시작·화면 열기·보여 주기는 기록을 바꾸지 않는다', () => {
  const { st, res } = check([{ type: 'start_timer', kind: 'focus' }, { type: 'open_view', view: 'stats' }, { type: 'show_stats', from: '2026-11-09', to: '2026-11-14' }]);
  const before = JSON.stringify(st);
  assert.deepStrictEqual(AI.applyOps(st, res.ops, env()), []);
  assert.strictEqual(JSON.stringify(st), before);
});
test('하루 시작 시각이 새벽이면 그 전 새벽은 전날 공부로 적는다', () => {
  const st = sample();
  Stats.setDayStart(4);
  try {
    const now = new Date(2026, 10, 14, 10, 30).getTime(), ctx = AI.buildContext(st, now);
    const res = AI.validate([{ type: 'add_session', date: '2026-11-13', start: '23:00', end: '2:00' }], st, ctx, now);
    AI.applyOps(st, res.ops, { now, uid: () => 'd' + (++seq) });
    const s = st.sessions[st.sessions.length - 1];
    assert.strictEqual(s.minutes, 180); // 새벽 4시 전이라 나누지 않는다
    assert.strictEqual(Stats.dayKey(s.endedAt), '2026-11-13');
  } finally { Stats.setDayStart(0); }
});

/* ---------- 일정 ---------- */
test('일정은 3주 안의 것만, 가까운 날 순서로 짧은 번호를 붙여 보낸다', () => {
  const ctx = AI.buildContext(withEvents(), NOW);
  assert.deepStrictEqual(ctx.events.map((e) => [e.k, e.name, e.date, e.time]), [
    ['p1', '영어 · 영어 단어 50개', '2026-11-15', '20:00~21:00'],
    ['p2', '수학 I · 학원', '2026-11-16', '16:00~18:00'],
    ['p3', '친구 약속', '2026-11-16', '18:30~20:00'],
  ]);
  assert.strictEqual(ctx.keys.events.p2, 'ev-a');
  const text = AI.contextText(ctx);
  assert.match(text, /p2 "수학 I · 학원" 매주 월·수 16:00~18:00, 가장 가까운 날 2026-11-16/);
  assert.match(text, /p3 "친구 약속" \[다른 일정\] 2026-11-16\(월\) 18:30~20:00/);
  assert.ok(!text.includes('겨울 특강'));
  assert.match(AI.contextText(AI.buildContext(sample(), NOW)), /c\) 일정\(어제부터 3주 동안\): 없음/);
});
test('일정 추가: 과목·날짜·시각을 맞추고, 끝 시각이 없으면 1시간', () => {
  const { res } = check([
    { type: 'add_event', subject: '국어', title: '문법 인강', date: '2026-11-15', start: '14:00', end: '15:30' },
    { type: 'add_event', kind: 'other', title: '치과', date: '2026-11-17', start: '17' },
    { type: 'add_event', subject: '영어', date: '2026-11-16', start: '19:00', minutes: 90 },
    { type: 'add_event', task: 't1', date: '2026-11-14', start: '21:00', end: '22:00' },
    { type: 'add_event', subject: '체육', date: '2026-11-18', start: '9:00', end: '10:00' },
  ]);
  assert.deepStrictEqual(res.rejected, []);
  assert.deepStrictEqual(res.ops.map((o) => [o.line, o.sub, o.warn]), [
    ['일정 추가: 국어 · 문법 인강', '내일 11/15(일) 14:00~15:30', ''],
    ['일정 추가: 치과', '11/17(화) 17:00~18:00 · 다른 일정', '끝 시각이 없어서 1시간으로 넣어요'],
    ['일정 추가: 영어', '11/16(월) 19:00~20:30', ''],
    ['일정 추가: 영어 · 영어 단어 50개', '오늘 11/14(토) 21:00~22:00', ''],
    ['일정 추가: 체육', '11/18(수) 9:00~10:00', "'체육' 과목이 없어서 과목 없이 넣어요"],
  ]);
  assert.deepStrictEqual([res.ops[3].data.ev.taskId, res.ops[3].data.subjectId], ['k1', 's-eng']);
  assert.strictEqual(res.ops[1].data.ev.kind, 'other');
});
test('반복 일정: 요일은 글자로 받고, 요일이 없으면 그 날짜의 요일', () => {
  const { res } = check([
    { type: 'add_event', subject: '수학 I', title: '학원', date: '2026-11-16', start: '16:00', end: '18:00', repeat: 'weekly', days: ['월', '수요일'], until: '2026-12-31' },
    { type: 'add_event', subject: '영어', date: '2026-11-17', start: '7:00', end: '7:30', repeat: 'weekly' },
    { type: 'add_event', kind: 'other', title: '운동', date: '2026-11-15', start: '6:30', end: '7:00', repeat: 'daily' },
    { type: 'add_event', subject: '국어', date: '2026-11-17', start: '8:00', end: '9:00', repeat: 'weekly', until: '어느 날' },
  ]);
  assert.deepStrictEqual(res.ops.map((o) => o.sub), [
    '11/16(월) 16:00~18:00 · 매주 월·수 · 12월 31일까지',
    '11/17(화) 7:00~7:30 · 매주 화',
    '내일 11/15(일) 6:30~7:00 · 매일 · 다른 일정',
  ]);
  assert.deepStrictEqual(res.ops[0].data.ev.repeat, { freq: 'weekly', days: [1, 3], until: '2026-12-31' });
  assert.deepStrictEqual(res.rejected, ['반복이 끝나는 날을 읽지 못했어요']);
});
test('일정 추가: 겹치는 일정을 알려 주고, 잘못 적은 것은 뺀다', () => {
  const { res } = check([
    { type: 'add_event', subject: '국어', date: '2026-11-16', start: '17:00', end: '19:00' },
    { type: 'add_event', subject: '국어', date: '2026-11-16', start: '25:00', end: '26:00' },
    { type: 'add_event', subject: '국어', date: '11월 16일', start: '17:00' },
    { type: 'add_event', kind: 'other', date: '2026-11-16', start: '17:00' },
    { type: 'add_event', subject: '국어', date: '2026-11-16', start: '17:00', end: '17:00' },
  ], withEvents());
  assert.strictEqual(res.ops.length, 1);
  assert.strictEqual(res.ops[0].warn, '그 시간에 다른 일정이 있어요: 수학 I · 학원');
  assert.deepStrictEqual(res.rejected, ['일정의 시작 시각을 읽지 못했어요', '일정 날짜를 읽지 못했어요', '일정을 넣지 못했어요: 일정 이름을 적어 주세요', '일정을 넣지 못했어요: 끝 시각을 시작 시각과 다르게 적어 주세요']);
});
test('과목이 여러 개와 맞으면 고르게 하고, 고르면 임시 이름을 지운다', () => {
  const { st, res } = check([{ type: 'add_event', subject: '수학', date: '2026-11-15', start: '10:00', end: '11:00' }]);
  const op = res.ops[0];
  assert.deepStrictEqual([op.line, op.warn, op.choices.map((c) => c.name)], ['일정 추가: 수학', '과목을 골라 주세요', ['수학 I', '수학 II']]);
  op.data.subjectId = 's-m2'; // 화면에서 고름
  AI.applyOps(st, res.ops, env());
  assert.deepStrictEqual([st.events[0].subjectId, st.events[0].title], ['s-m2', '']);
  const again = check([{ type: 'add_event', subject: '수학', date: '2026-11-15', start: '10:00', end: '11:00' }]);
  AI.applyOps(again.st, again.res.ops, env()); // 안 고르면 이름만 남는다
  assert.deepStrictEqual([again.st.events[0].subjectId, again.st.events[0].title], [null, '수학']);
});
test('일정 옮기기: 한 번짜리는 날짜·시각을 바꾸고, 시작만 바꾸면 길이는 그대로', () => {
  const { res } = check([
    { type: 'move_event', event: 'p1', date: '2026-11-17' },
    { type: 'move_event', event: 'p3', start: '19:00' },
    { type: 'move_event', event: 'p3', start: '18:30', end: '20:00' },
    { type: 'move_event', event: 'p9', start: '19:00' },
    { type: 'move_event', event: 'p1' },
    { type: 'move_event', event: 'p1', start: '아침' },
  ], withEvents());
  assert.deepStrictEqual(res.ops.map((o) => [o.line, o.sub]), [
    ['일정 옮기기: 영어 · 영어 단어 50개', '내일 11/15(일) 20:00~21:00 → 11/17(화) 20:00~21:00'],
    ['일정 옮기기: 친구 약속', '11/16(월) 18:30~20:00 → 11/16(월) 19:00~20:30'],
  ]);
  assert.deepStrictEqual(res.rejected, ['옮길 일정을 찾지 못했어요', "'영어 · 영어 단어 50개' 일정을 어디로 옮길지 읽지 못했어요", "'영어 · 영어 단어 50개' 일정의 새 시각을 읽지 못했어요"]);
});
test('반복 일정 옮기기: 날짜를 적으면 그날만, 시각만 적으면 반복 전체', () => {
  const { st, res } = check([
    { type: 'move_event', event: 'p2', on: '2026-11-18', date: '2026-11-19', start: '17:00' },
    { type: 'move_event', event: 'p2', start: '17:00', end: '19:00' },
    { type: 'move_event', event: 'p2', date: '2026-11-19' },
    { type: 'move_event', event: 'p2', on: '2026-11-17', date: '2026-11-19' },
  ], withEvents());
  assert.deepStrictEqual(res.ops.map((o) => [o.line, o.sub]), [
    ['일정 옮기기(이 날만): 수학 I · 학원', '11/18(수) 16:00~18:00 → 11/19(목) 17:00~19:00'],
    ['일정 시각 바꾸기(반복 전체): 수학 I · 학원', '매주 월·수 16:00~18:00 → 17:00~19:00'],
  ]);
  assert.deepStrictEqual(res.rejected, ["'수학 I · 학원' 일정은 반복 일정이에요. 어느 날 것을 옮길지 알려 주세요", "그날에는 '수학 I · 학원' 일정이 없어요"]);
  const before = JSON.stringify(st);
  const inv = AI.applyOps(st, [res.ops[0]], env());
  const orig = st.events.find((e) => e.id === 'ev-a'), moved = st.events[st.events.length - 1];
  assert.deepStrictEqual(orig.skip, ['2026-11-18']);
  assert.deepStrictEqual([moved.date, moved.start, moved.end, moved.repeat, moved.subjectId, moved.title], ['2026-11-19', '17:00', '19:00', null, 's-m1', '학원']);
  AI.undoOps(st, inv);
  assert.strictEqual(JSON.stringify(st), before);
});
test('일정을 넣고 옮긴 뒤 되돌리면 처음과 똑같고, 그사이 직접 고친 일정은 그대로 둔다', () => {
  const { st, res } = check([
    { type: 'add_event', subject: '국어', date: '2026-11-15', start: '14:00', end: '15:30' },
    { type: 'move_event', event: 'p1', date: '2026-11-17', start: '21:00' },
    { type: 'move_event', event: 'p2', start: '17:00' },
  ], withEvents());
  const before = JSON.stringify(st);
  const inv = AI.applyOps(st, res.ops, env());
  assert.strictEqual(st.events.length, 5);
  assert.deepStrictEqual([st.events[1].date, st.events[1].start, st.events[1].end, st.events[1].id, st.events[1].createdAt], ['2026-11-17', '21:00', '22:00', 'ev-b', 2]);
  assert.deepStrictEqual([st.events[0].start, st.events[0].end], ['17:00', '19:00']);
  const copy = JSON.parse(JSON.stringify(st));
  AI.undoOps(st, inv);
  assert.strictEqual(JSON.stringify(st), before);
  copy.events[1].start = '22:00'; // 사용자가 다시 고침
  AI.undoOps(copy, inv);
  assert.strictEqual(copy.events[1].start, '22:00');
  assert.strictEqual(copy.events.length, 4);
});
test('타임테이블은 날짜를 정해 열 수 있다', () => {
  const { res } = check([{ type: 'open_view', view: 'timetable', date: '2026-11-16' }]);
  assert.deepStrictEqual([res.ops[0].line, res.ops[0].sub, res.ops[0].data], ['화면 열기: 타임테이블', '11/16(월)', { view: 'timetable', date: '2026-11-16' }]);
});

/* ---------- 글 꾸미기 ---------- */
test('AI가 쓴 글의 태그는 글자로만 보인다', () => {
  const html = AI.md('<script>alert(1)</script> **굵게** <img src=x onerror=1>');
  assert.ok(!/<script|<img/.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<b>굵게<\/b>/);
});
test('제목·목록·표를 알아본다', () => {
  const html = AI.md('## 뜻\n내일 비가 안 오면 좋겠다.\n\n- ojalá: ~이면 좋겠다\n- llueva: llover의 접속법\n\n1. 첫째\n2. 둘째\n\n| 단어 | 뜻 |\n| --- | --- |\n| mañana | 내일 |');
  assert.match(html, /<p class="ai-h"><b>뜻<\/b><\/p><p>내일 비가 안 오면 좋겠다\.<\/p>/);
  assert.match(html, /<ul><li>ojalá: ~이면 좋겠다<\/li><li>llueva: llover의 접속법<\/li><\/ul>/);
  assert.match(html, /<ol><li>첫째<\/li><li>둘째<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>단어<\/th><th>뜻<\/th><\/tr><\/thead><tbody><tr><td>mañana<\/td><td>내일<\/td><\/tr><\/tbody><\/table>/);
});
