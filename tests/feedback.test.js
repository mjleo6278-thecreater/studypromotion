// 베타테스트 피드백 (v2.6): 기록 지키기, 자동 백업 정리, 이스터에그
const test = require('node:test');
const assert = require('node:assert');
const StoreLib = require('../js/store.js');
const Backup = require('../js/backup.js');
const Egg = require('../js/egg.js');

function memStorage(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    _m: m,
  };
}

test('기록 지키기: 이 버전이 모르는 항목(새 버전에서 생긴 기록)도 지우지 않는다', () => {
  const out = StoreLib.normalize({ tasks: [], sessions: [{ id: 's' }], futureThing: [{ id: 'f1' }], settings: { dailyGoalMin: 90, newOption: true } });
  assert.deepStrictEqual(out.futureThing, [{ id: 'f1' }]);
  assert.strictEqual(out.settings.newOption, true);
  assert.strictEqual(out.settings.dailyGoalMin, 90);
  assert.strictEqual(out.settings.focusMin, 25); // 없는 설정은 기본값
  assert.deepStrictEqual(out.sessions, [{ id: 's' }]);
  // 옛 버전이 불러와서 다시 저장해도 남아 있다
  const st = memStorage({ [StoreLib.KEY]: JSON.stringify(out) });
  const store = StoreLib.createStore(st);
  store.update((s) => { s.tasks.push({ id: 't' }); });
  const saved = JSON.parse(st.getItem(StoreLib.KEY));
  assert.deepStrictEqual(saved.futureThing, [{ id: 'f1' }]);
  assert.strictEqual(saved.tasks.length, 1);
});

test('기록 지키기: 형식이 이상한 값은 기본값으로 바꾸되 배열·설정 구조는 지킨다', () => {
  const out = StoreLib.normalize({ tasks: 'oops', settings: 'bad', subjects: [] });
  assert.deepStrictEqual(out.tasks, []);
  assert.strictEqual(out.settings.dailyGoalMin, 120);
  assert.ok(Array.isArray(StoreLib.normalize([1, 2]).subjects));
});

test('기록 지키기: 깨진 기록은 빈 기록으로 덮기 전에 원본을 따로 남긴다', () => {
  const st = memStorage({ [StoreLib.KEY]: '{"tasks":[{"id":"a"' });
  const store = StoreLib.createStore(st);
  assert.strictEqual(st.getItem(StoreLib.BROKEN_KEY), '{"tasks":[{"id":"a"');
  assert.strictEqual(store.loadIssue().raw, '{"tasks":[{"id":"a"');
  store.update((s) => { s.tasks.push({ id: 'new' }); });
  assert.strictEqual(st.getItem(StoreLib.BROKEN_KEY), '{"tasks":[{"id":"a"'); // 새로 저장해도 원본은 그대로
  // 정상 기록이면 문제 없음
  assert.strictEqual(StoreLib.createStore(memStorage()).loadIssue(), null);
});

test('기록 지키기: 통째로 바꾸기(불러오기·초기화) 직전에 지금 기록을 넘겨준다', () => {
  const st = memStorage();
  const store = StoreLib.createStore(st);
  store.update((s) => { s.tasks.push({ id: 'keep-me' }); });
  const seen = [];
  store.onBeforeReplace((text, reason) => seen.push({ reason, tasks: JSON.parse(text).tasks.map((t) => t.id) }));
  store.importJSON(JSON.stringify({ tasks: [{ id: 'other' }] }), 'cloud');
  store.importJSON(JSON.stringify({ tasks: [] }));
  store.reset();
  assert.deepStrictEqual(seen, [
    { reason: 'cloud', tasks: ['keep-me'] },
    { reason: 'import', tasks: ['other'] },
    { reason: 'reset', tasks: [] },
  ]);
});

test('기록 지키기: 저장에 실패하면 알린다 (화면에서는 계속 동작)', () => {
  const st = memStorage();
  const store = StoreLib.createStore(st);
  let errors = 0;
  store.onSaveError(() => errors++);
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  store.update((s) => { s.tasks.push({ id: 'x' }); });
  store.update((s) => { s.tasks.push({ id: 'y' }); }, { silent: true });
  assert.strictEqual(errors, 2);
  assert.strictEqual(store.get().tasks.length, 2);
});

test('자동 백업: 까닭별 개수만 남기고 오래된 것부터 지운다', () => {
  const list = [];
  for (let i = 0; i < 10; i++) list.push({ id: 'd' + i, reason: 'daily', at: 1000 + i, size: 10 });
  for (let i = 0; i < 4; i++) list.push({ id: 'c' + i, reason: 'cloud', at: 2000 + i, size: 10 });
  list.push({ id: 'u0', reason: 'update', at: 10, size: 10 });
  const drop = Backup.prune(list).sort();
  assert.deepStrictEqual(drop, ['c0', 'd0', 'd1', 'd2']); // 하루 7개, 계정 3개, 업데이트는 오래돼도 남김
});

test('자동 백업: 모두 합쳐 너무 크면 오래된 것부터 (가장 최근 것은 남김)', () => {
  const big = 20 * 1024 * 1024;
  const drop = Backup.prune([
    { id: 'new', reason: 'daily', at: 3, size: big },
    { id: 'mid', reason: 'update', at: 2, size: big },
    { id: 'old', reason: 'import', at: 1, size: 1 },
  ]);
  assert.deepStrictEqual(drop.sort(), ['mid', 'old']);
});

test('자동 백업: 사본 요약과 빈 기록 판단', () => {
  const s = Backup.summary(JSON.stringify({ sessions: [{ minutes: 30 }, { minutes: 15 }], tasks: [{}], topics: [{}, {}], cards: [], exams: [] }));
  assert.deepStrictEqual(s, { sessions: 2, minutes: 45, tasks: 1, topics: 2, cards: 0, exams: 0 });
  assert.strictEqual(Backup.summary('{broken'), null);
  assert.ok(Backup.isEmpty(Backup.summary(JSON.stringify(StoreLib.defaults()))));
  assert.ok(!Backup.isEmpty(s));
});

test('이스터에그: 띄어쓰기·끝의 님·문장부호와 상관없이 같은 단어로 본다', () => {
  // 실제 이름은 공개 저장소에 남기지 않으려고, 테스트용 단어를 잠시 넣어 확인한다
  Egg.KEYS[Egg.key('테스트이름')] = 'a';
  Egg.KEYS[Egg.key('만든이')] = 'c';
  try {
    for (const w of ['테스트이름', '테스트 이름', '테스트이름님', ' 테스트 이름 님! ']) assert.strictEqual(Egg.find(w).id, 'a', w);
    assert.strictEqual(Egg.find('테스트이름').items[0].title, '핑크 테마');
    const maker = Egg.find('만든이');
    assert.ok(maker.maker && maker.items.length >= 2);
    for (const w of ['', '   ', '테스트', '퀸', '<b>테스트이름</b>']) assert.strictEqual(Egg.find(w), null, w);
  } finally {
    delete Egg.KEYS[Egg.key('테스트이름')];
    delete Egg.KEYS[Egg.key('만든이')];
  }
});

test('이스터에그: 해시가 바뀌지 않는다 (이미 넣어 둔 이름들이 계속 열리도록)', () => {
  assert.strictEqual(Egg.key('스터디프로모션'), 'cmbjycfyzq');
  assert.strictEqual(Egg.key('체크메이트'), 'w6myrxs27j');
  assert.strictEqual(Egg.key('체크 메이트 님'), 'w6myrxs27j');
  assert.strictEqual(Object.keys(Egg.KEYS).length, 6); // 세 사람 × (성까지 / 이름만)
});

test('이스터에그: 소스에 이름이 그대로 들어 있지 않다', () => {
  const src = require('fs').readFileSync(require.resolve('../js/egg.js'), 'utf8');
  assert.ok(!/[가-힣]{2,4}님, 고마워요/.test(src.replace('${who}님, 고마워요', ''))); // 이름은 입력한 그대로만 보여 줌
  // 모든 KEYS가 실제 내용을 가리킨다
  for (const id of Object.values(Egg.KEYS)) assert.ok(Egg.ENTRIES[id], id);
});
