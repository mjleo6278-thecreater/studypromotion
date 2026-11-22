/* 스터디 플래너 계산 (순수 함수). 화면은 js/planner.js가 그린다.
 *
 * 할 일 하나 = 플래너 한 줄. 할 일의 due가 그 일을 '하는 날'이다 (예전 이름은 마감일).
 *   { id, title, subjectId, due: 'YYYY-MM-DD'|null(날짜 안 정함), estimateMin, done, doneAt, createdAt,
 *     topicId?  범위에서 넣은 할 일이면 그 범위 항목. 끝내면 범위에도 체크되고, 범위에서 체크해도 이 할 일이 끝난다
 *     rep?      { id, days: [0~6] } 반복으로 만든 할 일 묶음 (0=일, 매일이면 7개 모두). 날마다 한 줄씩 따로 저장한다
 *     pos?      그날 목록에서의 차례 (없으면 createdAt)
 *     part?     true = 세모(△, 덜 끝냄). 끝내면(done) 지운다. 진행 칸은 빈칸 → ○(done) → △(part) → 빈칸 (v3.10)
 *     slotId?   어디서·언제 할지 (state.slots의 id: 집·독서실·야자1 같은 사용자 목록). 정하지 않아도 된다 (v3.10)
 *     from?     지난 날에서 옮겨 온 일이면 처음 날짜 ('어제부터' 꼬리표) (v3.10) }
 * 날짜별 목표·메모·복습 체크: state.planner = { 'YYYY-MM-DD': { goal, memo, rv: [선생님 id] } }
 * 장소·시간 목록: state.slots = [{ id, name }] (위에 있을수록 먼저. 한 번도 고치지 않았으면 기본 목록)
 * 복습 선생님: state.teachers = [{ id, name, subjectId, days: [0~6] }] (수업 있는 요일에 복습 줄에 나온다)
 * 하루 시작 시각을 새벽으로 옮겼으면 그 전의 새벽은 전날이다 (Stats.dayKey와 같은 규칙).
 */
(function (root) {
  const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
  const Stats = need('Stats', './stats.js');
  const Scope = need('Scope', './scope.js');
  const S = need('Schedule', './schedule.js');
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const REP_MAX = 120; // 반복으로 한 번에 만드는 최대 개수
  const REP_DAYS = 200; // 반복 기간 최대(일)
  const EST_MAX = 24 * 60;

  /* ---------- 날짜 ---------- */
  const dayTitle = (key) => { const d = S.keyDate(key); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
  const shortDay = (key) => { const d = S.keyDate(key); return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`; };
  // 오늘 기준으로 그날을 부르는 말: 오늘·내일·모레·어제, 그 밖은 N일 뒤·N일 전
  function relDay(key, today) {
    const n = S.daysBetween(today, key);
    if (n === 0) return '오늘';
    if (n === 1) return '내일';
    if (n === 2) return '모레';
    if (n === -1) return '어제';
    return n > 0 ? `${n}일 뒤` : `${-n}일 전`;
  }
  // 그날 기준으로 가장 가까운 시험(그날이나 그 뒤). { exam, days } 또는 null
  function nextExam(exams, key) {
    let best = null;
    (exams || []).forEach((e) => { if (e && S.isKey(e.date) && e.date >= key && (!best || e.date < best.date)) best = e; });
    return best ? { exam: best, days: S.daysBetween(key, best.date) } : null;
  }
  const ddayText = (n) => (n === 0 ? 'D-day' : 'D-' + n);
  // 그 주의 날짜 7개 (월요일부터)
  const weekKeys = (key) => { const ws = S.weekStart(key); return [0, 1, 2, 3, 4, 5, 6].map((i) => S.shiftKey(ws, i)); };

  /* ---------- 목록 ---------- */
  const order = (t) => (typeof t.pos === 'number' ? t.pos : +t.createdAt || 0);
  const byOrder = (a, b) => order(a) - order(b) || (String(a.id) < String(b.id) ? -1 : 1);
  // 그날의 할 일: 적은 차례대로, 끝낸 것도 그 자리에 둔다 (체크해도 줄이 움직이지 않게)
  const dayTasks = (tasks, key) => (tasks || []).filter((t) => t && t.due === key).sort(byOrder);
  // 날짜 안 정한 할 일 (안 끝낸 것)
  const undated = (tasks) => (tasks || []).filter((t) => t && !t.due && !t.done).sort(byOrder);
  // 지난 날 못 한 할 일 (오래된 날부터)
  const overdue = (tasks, today) => (tasks || []).filter((t) => t && !t.done && t.due && t.due < today)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : byOrder(a, b)));
  const estOf = (t) => (+t.estimateMin > 0 ? Math.round(+t.estimateMin) : 0);

  // 그날 요약: 할 일 수, 끝낸 수, 세모 수, 계획(예상 시간 합)
  function daySummary(tasks, key) {
    const list = dayTasks(tasks, key);
    const done = list.filter((t) => t.done).length;
    const part = list.filter((t) => !t.done && t.part).length;
    return { list, total: list.length, done, part, left: list.length - done, planMin: list.reduce((a, t) => a + estOf(t), 0) };
  }

  /* ---------- 장소·시간 (할 일 왼쪽 칸) ---------- */
  const DEFAULT_SLOTS = ['야자1', '야자2', '독서실', '집'];
  const SLOT_MAX = 20;
  const cleanSlot = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 10);
  // 장소·시간 목록 (위에 있을수록 먼저). 한 번도 고치지 않았으면 기본 목록 (id가 정해져 있어서 고를 때 그대로 적어 둔다)
  function slotList(state) {
    if (Array.isArray(state.slots)) return state.slots.filter((x) => x && x.id && cleanSlot(x.name));
    return DEFAULT_SLOTS.map((name, i) => ({ id: 'slot' + (i + 1), name }));
  }
  function ensureSlots(state) { if (!Array.isArray(state.slots)) state.slots = slotList(state); return state.slots; }
  const slotOf = (state, t) => (t && t.slotId ? slotList(state).find((x) => x.id === t.slotId) || null : null);
  // 할 일의 장소를 정하거나(slotId) 비운다(''/null). 반환 바꿨나
  function setSlot(state, id, slotId) {
    const t = (state.tasks || []).find((x) => x && x.id === id);
    if (!t) return false;
    const ok = slotId && slotList(state).some((x) => x.id === slotId);
    if (ok) { ensureSlots(state); if (t.slotId === slotId) return false; t.slotId = slotId; return true; }
    if (!t.slotId) return false;
    delete t.slotId;
    return true;
  }
  // 새 장소·시간. 같은 이름이 있으면 그것을 돌려준다. 반환 { id, name } 또는 null
  function addSlot(state, name, uid) {
    const v = cleanSlot(name);
    if (!v) return null;
    const list = ensureSlots(state);
    const same = list.find((x) => x.name === v);
    if (same) return same;
    if (list.length >= SLOT_MAX) return null;
    const x = { id: uid(), name: v };
    list.push(x);
    return x;
  }
  function renameSlot(state, id, name) {
    const v = cleanSlot(name);
    const x = ensureSlots(state).find((y) => y.id === id);
    if (!x || !v) return false;
    x.name = v;
    return true;
  }
  // 지우면 그 장소를 고른 할 일도 '정하지 않음'으로. 반환 비운 할 일 수
  function removeSlot(state, id) {
    const list = ensureSlots(state);
    const i = list.findIndex((y) => y.id === id);
    if (i < 0) return 0;
    list.splice(i, 1);
    let n = 0;
    (state.tasks || []).forEach((t) => { if (t && t.slotId === id) { delete t.slotId; n++; } });
    return n;
  }
  // 목록에서 자리 바꾸기 (to = 새 자리 번호)
  function moveSlot(state, id, to) {
    const list = ensureSlots(state);
    const i = list.findIndex((y) => y.id === id);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(list.length - 1, Math.round(+to || 0)));
    if (i === j) return false;
    list.splice(j, 0, list.splice(i, 1)[0]);
    return true;
  }

  /* ---------- 정렬 ---------- */
  // 그날 목록의 차례: 하나라도 장소·시간을 정했으면 장소 목록 순서(안 정한 일은 맨 아래), 아니면 과목 순서
  // (과목 관리 순서, 과목 없는 일은 맨 아래). 같은 칸 안에서는 과목 → 적은 차례. opts.noSlot: 장소 칸을 꺼 두었으면 과목 순만.
  // 반환 { list, by: 'slot'|'subject' }
  function sortDay(state, list, opts) {
    const subs = new Map((state.subjects || []).map((x, i) => [x.id, i]));
    const slots = new Map(slotList(state).map((x, i) => [x.id, i]));
    const BIG = 1e6;
    const si = (t) => (t.subjectId && subs.has(t.subjectId) ? subs.get(t.subjectId) : BIG);
    const pi = (t) => (t.slotId && slots.has(t.slotId) ? slots.get(t.slotId) : BIG);
    const by = !(opts && opts.noSlot) && (list || []).some((t) => pi(t) < BIG) ? 'slot' : 'subject';
    const out = (list || []).slice().sort((a, b) => (by === 'slot' ? pi(a) - pi(b) : 0) || si(a) - si(b) || byOrder(a, b));
    return { list: out, by };
  }
  const dayList = (state, key, opts) => sortDay(state, dayTasks(state.tasks, key), opts);

  /* ---------- 진행 표시 (오른쪽 칸) ---------- */
  // 'o' 끝냄 / 't' 세모(덜 끝냄) / '' 아직
  const markOf = (t) => (t && t.done ? 'o' : t && t.part ? 't' : '');
  // 진행 칸을 누를 때마다: 빈칸 → ○ → △ → 빈칸
  const nextMark = (m) => (m === 'o' ? 't' : m === 't' ? '' : 'o');
  // 그날 공부한 시간(기록된 것만. 지금 재는 시간은 화면에서 더한다)
  function studyMinutes(sessions, key) {
    return (sessions || []).reduce((a, s) => a + (s && s.minutes > 0 && Stats.dayKey(s.endedAt) === key ? s.minutes : 0), 0);
  }
  // 할 일 한 줄에 쌓인 공부 시간: 이 할 일로 잰 기록(타이머·스톱워치·끝내서 넣은 시간)과, 이은 범위로 잰 기록
  function taskMinutes(sessions, t) {
    return (sessions || []).reduce((a, s) => a + (s && s.minutes > 0 && (s.taskId === t.id || (t.topicId && !s.taskId && s.topicId === t.topicId)) ? s.minutes : 0), 0);
  }

  // 줄 색: 과목 색, 과목이 없으면 이은 범위의 과목 카드 색, 둘 다 없으면 ''
  function taskColor(state, t) {
    const s = t.subjectId ? (state.subjects || []).find((x) => x.id === t.subjectId) : null;
    if (s && s.color) return s.color;
    if (t.topicId) {
      const by = new Map((state.topics || []).map((n) => [n.id, n]));
      let n = by.get(t.topicId);
      while (n && n.parentId && by.get(n.parentId)) n = by.get(n.parentId);
      if (n && n.color) return n.color;
    }
    return '';
  }

  /* ---------- 반복 ---------- */
  // 반복할 날짜: start부터 until까지(둘 다 넣음) days 요일마다. 최대 REP_MAX개, REP_DAYS일까지
  function repeatDates(start, days, until) {
    if (!S.isKey(start) || !Array.isArray(days) || !days.length) return [];
    const set = new Set(days.map(Number));
    const last = S.isKey(until) && until >= start ? until : start;
    const cap = S.shiftKey(start, REP_DAYS);
    const out = [];
    for (let k = start; k <= last && k <= cap && out.length < REP_MAX; k = S.shiftKey(k, 1)) if (set.has(S.weekday(k))) out.push(k);
    return out;
  }
  // '매일' '평일마다' '주말마다' '월·수·금' '수요일마다'
  function repText(rep) {
    const days = rep && Array.isArray(rep.days) ? rep.days.map(Number) : [];
    if (!days.length) return '';
    if (days.length >= 7) return '매일';
    const ds = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d));
    if (ds.length === 5 && !days.includes(0) && !days.includes(6)) return '평일마다';
    if (ds.length === 2 && days.includes(0) && days.includes(6)) return '주말마다';
    return ds.length === 1 ? WD[ds[0]] + '요일마다' : ds.map((d) => WD[d]).join('·') + '마다';
  }
  // 반복을 언제까지 할지 처음 값: 120일 안에 시험이 있으면 시험 전날까지, 없으면 4주
  function defaultUntil(start, exams) {
    const ex = nextExam(exams, S.shiftKey(start, 1));
    if (ex && S.daysBetween(start, ex.exam.date) <= 120) return S.shiftKey(ex.exam.date, -1);
    return S.shiftKey(start, 27);
  }

  /* ---------- 만들기·고치기 ---------- */
  const cleanTitle = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 120);
  const cleanEst = (v) => { const n = Math.round(+v || 0); return n > 0 ? Math.min(EST_MAX, n) : null; };
  // 새 할 일 (반복이면 여러 개). input: { title, subjectId, due, estimateMin, slotId, topicId, rep: { days, until } }
  // env: { uid, now }. 반환 할 일 목록 (이름이 없으면 빈 목록)
  function makeTasks(input, env) {
    const title = cleanTitle(input.title);
    if (!title) return [];
    const base = { title, subjectId: input.subjectId || null, estimateMin: cleanEst(input.estimateMin), done: false };
    if (input.slotId) base.slotId = input.slotId;
    const due = S.isKey(input.due) ? input.due : null;
    const days = input.rep && Array.isArray(input.rep.days) ? [...new Set(input.rep.days.map(Number))].filter((d) => d >= 0 && d <= 6).sort() : [];
    if (due && days.length) {
      const gid = env.uid();
      return repeatDates(due, days, input.rep.until).map((k, i) => Object.assign({ id: env.uid() }, base, { due: k, createdAt: env.now + i, rep: { id: gid, days } }));
    }
    const t = Object.assign({ id: env.uid() }, base, { due, createdAt: env.now });
    if (input.topicId) t.topicId = input.topicId;
    return [t];
  }
  // 같은 반복 묶음에서 그날부터 앞으로의 할 일 (그날 것 포함)
  function seriesFrom(tasks, t) {
    if (!t || !t.rep || !t.rep.id) return t ? [t] : [];
    return (tasks || []).filter((x) => x && x.rep && x.rep.id === t.rep.id && (x.id === t.id || (x.due && t.due && x.due >= t.due)));
  }
  // 할 일 고치기. patch: { title, subjectId, due, estimateMin, slotId } (없는 칸은 그대로). all: 반복 묶음의 그날부터 앞으로 모두 (날짜는 이 할 일만)
  // 끝낸 할 일의 예상 시간을 고치면 오늘 넣은 공부 기록도 새 시간·과목으로 맞춘다. 반환 고친 개수
  function editTask(state, id, patch, now, all) {
    const t = (state.tasks || []).find((x) => x && x.id === id);
    if (!t) return 0;
    const list = all ? seriesFrom(state.tasks, t) : [t];
    const today = Stats.dayKey(now);
    list.forEach((x) => {
      if ('title' in patch) { const v = cleanTitle(patch.title); if (v) x.title = v; }
      if ('subjectId' in patch) x.subjectId = patch.subjectId || null;
      if ('estimateMin' in patch) x.estimateMin = cleanEst(patch.estimateMin);
      if ('slotId' in patch) { if (patch.slotId) x.slotId = patch.slotId; else delete x.slotId; }
      if (x.done) {
        const c = (state.sessions || []).find((s) => s.doneOf === 'task:' + x.id && Stats.dayKey(s.endedAt) === today);
        if (c && x.estimateMin) Object.assign(c, { minutes: x.estimateMin, subjectId: x.subjectId, label: x.title });
        else if (c) Stats.uncreditDone(state, 'task:' + x.id, now);
      }
    });
    if ('due' in patch && patch.due !== t.due) moveTask(state, id, patch.due, now, { keepTwin: true }); // 고치기 창에서 날짜를 바꾼 건 합치지 않는다 (반복으로 바꾸기와 겹치지 않게)
    return list.length;
  }
  // 옮기기 전 날짜를 남긴다: 오늘이나 지난 날의 안 끝낸 일을 뒤로 미루면 처음 날짜(from)를 적고, 그날이나 그 앞으로 되돌리면 지운다
  function markFrom(t, key, today) {
    if (t.done || !S.isKey(key)) { delete t.from; return; }
    const first = t.from || t.due;
    if (S.isKey(first) && first <= today && key > first) t.from = first;
    else delete t.from;
  }
  // 같은 일인가: 둘 다 범위와 이었으면 같은 범위 항목일 때만. 아니면 같은 반복 묶음이거나 이름·과목이 같을 때 (4.2.1)
  function sameTask(a, b) {
    if (!a || !b) return false;
    if (a.topicId && b.topicId) return a.topicId === b.topicId;
    if (a.rep && b.rep && a.rep.id && a.rep.id === b.rep.id) return true;
    return cleanTitle(a.title) === cleanTitle(b.title) && (a.subjectId || null) === (b.subjectId || null);
  }
  // 그날(key)에 이미 있는 같은 일 (안 끝낸 것, t 말고). 없으면 null
  const twinOn = (tasks, t, key) => (S.isKey(key) ? dayTasks(tasks, key).find((x) => x.id !== t.id && !x.done && sameTask(x, t)) || null : null);
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const MERGE_KEYS = ['from', 'part', 'slotId', 'estimateMin', 'topicId'];
  // 옮긴 할 일 t를 그날 이미 있던 같은 일 keep에 합치고 t는 목록에서 뺀다 (같은 일이 두 줄이 되지 않게, 4.2.1).
  // 처음 날짜는 더 이른 쪽, 세모·장소·예상 시간·범위는 keep에 없을 때만 t 것을 쓰고, t로 잰 공부 시간·타임테이블 일정은 keep으로 옮긴다.
  // before: 옮기기 전 t 사본. 반환 되돌리기용 { into, task, at, keep(keep의 옛 값), sessions, events }
  function absorb(state, t, keep, before) {
    const old = {};
    MERGE_KEYS.forEach((k) => { old[k] = keep[k]; });
    if (S.isKey(t.from) && t.from < keep.due && (!S.isKey(keep.from) || t.from < keep.from)) keep.from = t.from;
    if (t.part && !keep.part) keep.part = true;
    if (t.slotId && !keep.slotId) keep.slotId = t.slotId;
    if (+t.estimateMin > 0 && !(+keep.estimateMin > 0)) keep.estimateMin = t.estimateMin;
    if (t.topicId && !keep.topicId) keep.topicId = t.topicId;
    const sessions = [], events = [];
    (state.sessions || []).forEach((s) => { if (s && s.taskId === t.id) { s.taskId = keep.id; sessions.push(s.id); } });
    (state.events || []).forEach((e) => { if (e && e.taskId === t.id) { e.taskId = keep.id; events.push(e.id); } });
    const at = state.tasks.indexOf(t);
    state.tasks.splice(at, 1);
    return { into: keep.id, task: before, at, keep: old, sessions, events };
  }
  // 합친 것 되돌리기: 뺀 할 일을 제자리에 다시 넣고, keep의 옛 값과 기록·일정의 할 일을 돌린다
  function unabsorb(state, m) {
    const keep = (state.tasks || []).find((x) => x && x.id === m.into);
    if (keep) MERGE_KEYS.forEach((k) => { if (m.keep[k] === undefined) delete keep[k]; else keep[k] = m.keep[k]; });
    const back = (list, ids) => { const set = new Set(ids); (list || []).forEach((x) => { if (x && set.has(x.id) && x.taskId === m.into) x.taskId = m.task.id; }); };
    back(state.sessions, m.sessions);
    back(state.events, m.events);
    if (!state.tasks.some((x) => x && x.id === m.task.id)) state.tasks.splice(Math.min(m.at, state.tasks.length), 0, copy(m.task));
  }
  // 할 일을 다른 날로 (key 'YYYY-MM-DD', 없으면 날짜 안 정함). 옮긴 날의 맨 아래에 놓는다.
  // 그날에 같은 일(안 끝낸 것)이 이미 있으면 그 줄에 합친다 (opts.keepTwin이면 합치지 않음).
  // 반환 되돌리기용 { id, due, pos, from, merged? } (merged가 있으면 합쳐서 이 할 일은 없어짐). 할 일이 없으면 false
  function moveTask(state, id, key, now, opts) {
    const t = (state.tasks || []).find((x) => x && x.id === id);
    if (!t) return false;
    const prev = { id: t.id, due: t.due, pos: t.pos, from: t.from };
    const before = copy(t);
    markFrom(t, key, Stats.dayKey(now));
    t.due = S.isKey(key) ? key : null;
    t.pos = now;
    const keep = !t.done && !(opts && opts.keepTwin) ? twinOn(state.tasks, t, t.due) : null;
    if (keep) prev.merged = absorb(state, t, keep, before);
    return prev;
  }
  // 지난 날 못 한 할 일을 오늘로 (오늘 목록 맨 위에, 원래 차례대로). ids를 주면 그 할 일만.
  // 세모·장소·잰 시간은 할 일에 붙어 있어서 그대로 같이 가고, 처음 날짜(from)를 남긴다.
  // 오늘에 같은 일이 이미 있으면(같이 옮긴 다른 날의 같은 일도) 한 줄로 합친다.
  // 반환 [{ id, due, pos, from, merged? }] (되돌리기용 옛 값)
  function carryOver(state, today, now, ids) {
    const want = Array.isArray(ids) ? new Set(ids) : null;
    const list = overdue(state.tasks, today).filter((t) => !want || want.has(t.id));
    if (!list.length) return [];
    const first = dayTasks(state.tasks, today)[0];
    const base = first ? order(first) : now;
    return list.map((t, i) => {
      const prev = { id: t.id, due: t.due, pos: t.pos, from: t.from };
      const before = copy(t);
      t.from = t.from || t.due;
      t.due = today;
      t.pos = base - (list.length - i);
      const keep = twinOn(state.tasks, t, today);
      if (keep) prev.merged = absorb(state, t, keep, before);
      return prev;
    });
  }
  // 되돌리기: carryOver·moveTask 전에 찍어 둔 { id, due, pos, from, merged? }로 돌린다 (나중 것부터)
  function restoreMoves(state, prev) {
    (prev || []).slice().reverse().forEach((p) => {
      if (p.merged) { unabsorb(state, p.merged); return; }
      const x = (state.tasks || []).find((y) => y && y.id === p.id);
      if (!x) return;
      x.due = p.due;
      if (p.pos === undefined) delete x.pos; else x.pos = p.pos;
      if (p.from === undefined) delete x.from; else x.from = p.from;
    });
  }
  // 오늘로 옮길지 물어볼 지난 날 못 끝낸 일 (최근 날부터, 그날 안에서는 목록 차례).
  // 오늘에 같은 일(같은 범위·반복 묶음·이름과 과목)이 이미 있거나, 더 최근 날에 같은 일이 있으면 처음에 체크를 꺼 둔다.
  // merge: 오늘에 안 끝낸 같은 일이 있어서 옮기면 그 줄과 합쳐진다
  // 반환 [{ t, on, merge }]
  function carryChoices(state, today) {
    const list = overdue(state.tasks, today);
    if (!list.length) return [];
    const seen = dayTasks(state.tasks, today).slice();
    const days = [...new Set(list.map((t) => t.due))].sort().reverse();
    const out = [];
    days.forEach((k) => sortDay(state, list.filter((t) => t.due === k)).list.forEach((t) => {
      out.push({ t, on: !seen.some((x) => sameTask(x, t)), merge: !!twinOn(state.tasks, t, today) });
      seen.push(t);
    }));
    return out;
  }
  // 줄에 붙는 꼬리표: 오늘 칸의 어제 일이면 '어제부터', 아니면 '11/18부터'. 옮겨 온 일이 아니면 ''
  function fromText(t, today) {
    if (!t || !S.isKey(t.from) || !S.isKey(t.due) || t.from >= t.due) return '';
    if (t.due === today && t.from === S.shiftKey(today, -1)) return '어제부터';
    return shortDay(t.from).split(' ')[0] + '부터';
  }

  /* ---------- 범위와 잇기 ---------- */
  // 범위 항목이 다 끝났나 (하위 항목이 있으면 모두). 그런 항목이 없으면 null
  function topicComplete(topics, id) {
    if (!(topics || []).some((n) => n.id === id && n.kind !== 'note')) return null;
    const p = Scope.progress(topics, id);
    return p.total > 0 && p.state === 'all';
  }
  // 할 일이 가리키는 범위마다 다 끝났는지 (바꾸기 전에 찍어 두고 syncLinked에 넘긴다)
  function linkState(state) {
    const out = new Map();
    (state.tasks || []).forEach((t) => { if (t && t.topicId && !out.has(t.topicId)) out.set(t.topicId, topicComplete(state.topics, t.topicId)); });
    return out;
  }
  // 범위 체크가 바뀐 뒤: 다 끝난 범위와 이은 할 일은 끝냄으로, 다시 풀린 범위의 할 일은 끝냄을 푼다.
  // 공부 시간은 범위 쪽(stats.js syncTopicCredits)이 맡고, 끝냄을 풀면 그 할 일로 오늘 넣은 시간만 뺀다.
  // skip: 이미 직접 바꾼 할 일 id. 반환 { done: [id], undone: [id], removed: 분 }
  function syncLinked(state, before, now, skip) {
    const out = { done: [], undone: [], removed: 0 };
    if (!before || !before.size) return out;
    const after = linkState(state);
    (state.tasks || []).forEach((t) => {
      if (!t || !t.topicId || t.id === skip || !before.has(t.topicId)) return;
      const a = after.get(t.topicId), b = before.get(t.topicId);
      if (a === null || b === null || a === b) return; // 지운 범위는 건드리지 않는다
      if (a && !t.done) { t.done = true; t.doneAt = now; delete t.part; out.done.push(t.id); }
      else if (!a && t.done) { t.done = false; t.doneAt = null; out.removed += Stats.uncreditDone(state, 'task:' + t.id, now); out.undone.push(t.id); }
    });
    return out;
  }

  // 할 일 끝냄 표시 (App.setTaskDone이 부른다). state를 직접 고친다.
  //  - 예상 시간을 적은 할 일을 끝내면 그 시간을 오늘 공부 기록에 넣고 (stats.js creditTask), 끝냄을 풀면 오늘 넣은 것을 뺀다.
  //  - 범위와 이은 할 일이면 범위도 같이 체크하거나 풀고(폰이 전진), 같은 범위와 이은 다른 할 일도 맞춘다.
  //    공부 시간은 한 번만: 이 할 일로 잰 기록이 있으면 넣지 않고, 할 일의 예상 시간 → (없으면) 범위의 소요시간 차례로 본다.
  //  - 날짜 안 정한 할 일을 끝내면 끝낸 날의 할 일로 남긴다 (플래너에서 그날 한 일로 보인다).
  // 반환 null(그런 할 일 없음) 또는 { changed, added: 넣은 분, ids: 새 기록 id, removed: 뺀 분, topic: 같이 바꾼 범위 id }
  function setDone(state, id, done, now, uid) {
    const t = (state.tasks || []).find((x) => x && x.id === id);
    if (!t) return null;
    done = !!done;
    const out = { changed: false, added: 0, ids: [], removed: 0, topic: null };
    if (!!t.done === done) return out;
    out.changed = true;
    const topics = state.topics || [];
    const link = t.topicId && topicComplete(topics, t.topicId) !== null ? t.topicId : null;
    const before = link ? linkState(state) : null;
    const beforeDone = link ? Stats.doneTopicIds(state) : null;
    t.done = done;
    t.doneAt = done ? now : null;
    if (done) delete t.part;
    if (done && !t.due) t.due = Stats.dayKey(now);
    if (done) {
      const timed = (state.sessions || []).some((s) => s.taskId === t.id);
      const rec = Stats.creditTask(state, t, now, uid());
      if (rec) { out.added += rec.minutes; out.ids.push(rec.id); }
      if (link && !topicComplete(topics, link)) {
        Scope.setDone(topics, link, true, now);
        out.topic = link;
        if (!rec && !timed) { const got = Stats.syncTopicCredits(state, beforeDone, now, uid); out.added += got.added; out.ids.push(...got.ids); }
      }
    } else {
      out.removed += Stats.uncreditDone(state, 'task:' + t.id, now);
      if (link && topicComplete(topics, link)) {
        Scope.setDone(topics, link, false, now);
        out.topic = link;
        out.removed += Stats.syncTopicCredits(state, beforeDone, now, uid).removed;
      }
    }
    if (link) out.removed += syncLinked(state, before, now, t.id).removed;
    return out;
  }

  // 진행 표시를 바꾼다. ○는 setDone(공부 시간·범위 체크)과 같고, △와 빈칸은 끝냄을 풀고(오늘 넣은 시간은 뺀다) 세모만 다르다.
  // △는 아직 안 끝난 일로 쳐서 공부 시간을 넣지 않는다(타이머로 잰 기록은 그대로).
  // 반환 null(그런 할 일 없음) 또는 setDone 결과 + { mark, prev }
  function setMark(state, id, mark, now, uid) {
    const t = (state.tasks || []).find((x) => x && x.id === id);
    if (!t) return null;
    mark = mark === 'o' || mark === 't' ? mark : '';
    const prev = markOf(t);
    const out = setDone(state, id, mark === 'o', now, uid);
    if (mark === 't') t.part = true; else delete t.part;
    out.mark = mark;
    out.prev = prev;
    out.changed = prev !== mark;
    return out;
  }

  // 범위 항목 → 플래너 할 일. 과목 이름과 같은 과목 카드면 과목이 줄에 따로 보이므로 이름에서 카드 이름은 빼고,
  // 바로 위 단계 이름은 앞에 붙인다(‘비문학 · 수특 1강’). 예상 시간은 남은 소요시간. 반환 할 일 또는 null
  function topicTask(state, topicId, key, env) {
    const topics = state.topics || [];
    const by = new Map(topics.map((n) => [n.id, n]));
    const n = by.get(topicId);
    if (!n || n.kind === 'note') return null;
    let card = n;
    while (card.parentId && by.get(card.parentId)) card = by.get(card.parentId);
    const subj = (state.subjects || []).find((s) => s.name === card.title) || null;
    const parent = n.parentId ? by.get(n.parentId) : null;
    const title = card.id === n.id ? n.title
      : [subj ? '' : card.title, parent && parent.id !== card.id ? parent.title : '', n.title].filter(Boolean).join(' · ');
    const left = Math.round(Scope.progress(topics, n.id).timeLeft);
    return { id: env.uid(), title: cleanTitle(title) || '범위', subjectId: subj ? subj.id : null, due: S.isKey(key) ? key : null,
      estimateMin: left > 0 ? Math.min(EST_MAX, left) : null, done: false, createdAt: env.now, topicId: n.id };
  }

  // 범위에서 고르기 목록: 다가오는 시험부터(날짜 없는 시험은 뒤, 지난 시험은 빼고), 과목 카드마다 아직 안 끝낸 잎 항목.
  // planned: 그 항목과 이은 안 끝낸 할 일의 날짜('' = 날짜 안 정함, null = 없음)
  // 반환 [{ exam, days(D-day 또는 null), cards: [{ card, items: [{ n, path, left, planned }] }] }]
  function scopeChoices(state, today) {
    const topics = state.topics || [];
    const index = Scope.indexByParent(topics);
    const kidsOf = (id) => (index.get(id) || []).filter((k) => k.kind !== 'note');
    const planned = new Map();
    (state.tasks || []).forEach((t) => { if (t && t.topicId && !t.done && !planned.has(t.topicId)) planned.set(t.topicId, t.due || ''); });
    const exams = (state.exams || []).filter((e) => e && (!S.isKey(e.date) || e.date >= today))
      .sort((a, b) => { const ad = S.isKey(a.date) ? a.date : '9999', bd = S.isKey(b.date) ? b.date : '9999'; return ad < bd ? -1 : ad > bd ? 1 : 0; });
    const out = [];
    exams.forEach((ex) => {
      const cards = [];
      kidsOf('root:' + ex.id).forEach((card) => {
        const items = [];
        (function walk(n, path) {
          const ks = kidsOf(n.id);
          if (!ks.length) {
            if (n !== card && Scope.leafPct(n) < 100) {
              const est = +n.est || 0;
              items.push({ n, path, left: est > 0 ? Math.max(1, Math.round((est * (100 - Scope.leafPct(n))) / 100)) : 0, planned: planned.has(n.id) ? planned.get(n.id) : null });
            }
            return;
          }
          ks.forEach((k) => walk(k, n === card ? [] : path.concat(n.title)));
        })(card, []);
        if (items.length) cards.push({ card, items });
      });
      if (cards.length) out.push({ exam: ex, days: S.isKey(ex.date) ? S.daysBetween(today, ex.date) : null, cards });
    });
    return out;
  }

  /* ---------- 날짜별 목표·메모 ---------- */
  const noteOf = (state, key) => { const p = state.planner && state.planner[key]; return { goal: (p && p.goal) || '', memo: (p && p.memo) || '' }; };
  // 그날 칸 (없으면 만든다). 다 비면 tidyDay가 지운다
  function dayEntry(state, key) {
    if (!state.planner || typeof state.planner !== 'object' || Array.isArray(state.planner)) state.planner = {};
    const cur = state.planner[key];
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) state.planner[key] = {};
    return state.planner[key];
  }
  function tidyDay(state, key) {
    const p = state.planner && state.planner[key];
    if (!p) return;
    if (!p.goal) delete p.goal;
    if (!p.memo) delete p.memo;
    if (Array.isArray(p.rv) && !p.rv.length) delete p.rv;
    if (!Object.keys(p).some((k) => (k === 'memo' ? String(p.memo).trim() : true))) delete state.planner[key];
  }
  // 목표·메모를 적는다. 그날 칸이 다 비면 지운다 (복습 체크는 그대로 둔다)
  function setNote(state, key, patch) {
    if (!S.isKey(key)) return;
    const cur = noteOf(state, key);
    const p = dayEntry(state, key);
    p.goal = 'goal' in patch ? String(patch.goal || '').replace(/\s+/g, ' ').trim().slice(0, 80) : cur.goal;
    p.memo = 'memo' in patch ? String(patch.memo || '').slice(0, 2000) : cur.memo;
    tidyDay(state, key);
  }

  /* ---------- 복습 줄 (선생님 이름, 누르면 체크) ---------- */
  const WEEKDAYS = [1, 2, 3, 4, 5];
  const cleanName = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 8);
  const cleanDays = (d) => { const a = Array.isArray(d) ? [...new Set(d.map(Number))].filter((x) => x >= 0 && x <= 6).sort() : []; return a.length ? a : WEEKDAYS.slice(); };
  const teacherList = (state) => (Array.isArray(state.teachers) ? state.teachers.filter((x) => x && x.id && cleanName(x.name)) : []);
  const reviewedOn = (state, key) => { const p = state.planner && state.planner[key]; return Array.isArray(p && p.rv) ? p.rv : []; };
  // 그날 복습 줄에 나올 선생님: 수업 요일이 그날인 사람 + 그날 이미 체크한 사람 (등록한 차례대로)
  function teachersOn(state, key) {
    if (!S.isKey(key)) return [];
    const wd = S.weekday(key);
    const done = new Set(reviewedOn(state, key));
    return teacherList(state).filter((t) => done.has(t.id) || cleanDays(t.days).includes(wd));
  }
  // 그날 복습 체크를 바꾼다 (on을 안 주면 뒤집기). 반환 바뀐 뒤 체크했나
  function toggleReview(state, key, id, on) {
    if (!S.isKey(key) || !teacherList(state).some((t) => t.id === id)) return false;
    const p = dayEntry(state, key);
    const set = new Set(Array.isArray(p.rv) ? p.rv : []);
    const want = on === undefined ? !set.has(id) : !!on;
    if (want) set.add(id); else set.delete(id);
    p.rv = [...set];
    tidyDay(state, key);
    return want;
  }
  // 선생님 등록. input: { name, subjectId, days }. 반환 새 선생님 또는 null(이름 없음)
  function addTeacher(state, input, uid) {
    const name = cleanName(input && input.name);
    if (!name) return null;
    if (!Array.isArray(state.teachers)) state.teachers = [];
    const sid = input.subjectId && (state.subjects || []).some((x) => x.id === input.subjectId) ? input.subjectId : null;
    const t = { id: uid(), name, subjectId: sid, days: cleanDays(input.days) };
    state.teachers.push(t);
    return t;
  }
  function editTeacher(state, id, patch) {
    const t = teacherList(state).find((x) => x.id === id);
    if (!t) return false;
    if ('name' in patch) { const v = cleanName(patch.name); if (v) t.name = v; }
    if ('subjectId' in patch) t.subjectId = patch.subjectId && (state.subjects || []).some((x) => x.id === patch.subjectId) ? patch.subjectId : null;
    if ('days' in patch) t.days = cleanDays(patch.days);
    return true;
  }
  // 지워도 지난 날 체크 기록(rv)의 id는 남는다 (화면에는 안 나온다)
  function removeTeacher(state, id) {
    if (!Array.isArray(state.teachers)) return false;
    const n = state.teachers.length;
    state.teachers = state.teachers.filter((x) => !x || x.id !== id);
    return state.teachers.length !== n;
  }
  function moveTeacher(state, id, to) {
    if (!Array.isArray(state.teachers)) return false;
    const i = state.teachers.findIndex((x) => x && x.id === id);
    if (i < 0) return false;
    const j = Math.max(0, Math.min(state.teachers.length - 1, Math.round(+to || 0)));
    if (i === j) return false;
    state.teachers.splice(j, 0, state.teachers.splice(i, 1)[0]);
    return true;
  }

  const api = {
    WD, REP_MAX, dayTitle, shortDay, relDay, nextExam, ddayText, weekKeys,
    dayTasks, undated, overdue, daySummary, studyMinutes, taskMinutes, taskColor,
    repeatDates, repText, defaultUntil, makeTasks, seriesFrom, editTask, moveTask, carryOver, restoreMoves, carryChoices, fromText, sameTask, twinOn,
    topicComplete, linkState, syncLinked, setDone, topicTask, scopeChoices, noteOf, setNote,
    DEFAULT_SLOTS, slotList, ensureSlots, slotOf, setSlot, addSlot, renameSlot, removeSlot, moveSlot, sortDay, dayList,
    markOf, nextMark, setMark, teacherList, teachersOn, reviewedOn, toggleReview, addTeacher, editTeacher, removeTeacher, moveTeacher,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
