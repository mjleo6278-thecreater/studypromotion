/* 스터디 플래너 계산 (순수 함수). 화면은 js/planner.js가 그린다.
 *
 * 할 일 하나 = 플래너 한 줄. 할 일의 due가 그 일을 '하는 날'이다 (예전 이름은 마감일).
 *   { id, title, subjectId, due: 'YYYY-MM-DD'|null(날짜 안 정함), estimateMin, done, doneAt, createdAt,
 *     topicId?  범위에서 넣은 할 일이면 그 범위 항목. 끝내면 범위에도 체크되고, 범위에서 체크해도 이 할 일이 끝난다
 *     rep?      { id, days: [0~6] } 반복으로 만든 할 일 묶음 (0=일, 매일이면 7개 모두). 날마다 한 줄씩 따로 저장한다
 *     pos?      그날 목록에서의 차례 (없으면 createdAt) }
 * 날짜별 목표·메모: state.planner = { 'YYYY-MM-DD': { goal, memo } }
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

  // 그날 요약: 할 일 수, 끝낸 수, 계획(예상 시간 합)
  function daySummary(tasks, key) {
    const list = dayTasks(tasks, key);
    const done = list.filter((t) => t.done).length;
    return { list, total: list.length, done, left: list.length - done, planMin: list.reduce((a, t) => a + estOf(t), 0) };
  }
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
  // 새 할 일 (반복이면 여러 개). input: { title, subjectId, due, estimateMin, topicId, rep: { days, until } }
  // env: { uid, now }. 반환 할 일 목록 (이름이 없으면 빈 목록)
  function makeTasks(input, env) {
    const title = cleanTitle(input.title);
    if (!title) return [];
    const base = { title, subjectId: input.subjectId || null, estimateMin: cleanEst(input.estimateMin), done: false };
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
  // 할 일 고치기. patch: { title, subjectId, due, estimateMin } (없는 칸은 그대로). all: 반복 묶음의 그날부터 앞으로 모두 (날짜는 이 할 일만)
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
      if (x.done) {
        const c = (state.sessions || []).find((s) => s.doneOf === 'task:' + x.id && Stats.dayKey(s.endedAt) === today);
        if (c && x.estimateMin) Object.assign(c, { minutes: x.estimateMin, subjectId: x.subjectId, label: x.title });
        else if (c) Stats.uncreditDone(state, 'task:' + x.id, now);
      }
    });
    if ('due' in patch && patch.due !== t.due) moveTask(state, id, patch.due, now);
    return list.length;
  }
  // 할 일을 다른 날로 (key 'YYYY-MM-DD', 없으면 날짜 안 정함). 옮긴 날의 맨 아래에 놓는다
  function moveTask(state, id, key, now) {
    const t = (state.tasks || []).find((x) => x && x.id === id);
    if (!t) return false;
    t.due = S.isKey(key) ? key : null;
    t.pos = now;
    return true;
  }
  // 지난 날 못 한 할 일을 모두 오늘로 (오늘 목록 맨 위에, 원래 차례대로). 반환 [{ id, due, pos }] (되돌리기용 옛 값)
  function carryOver(state, today, now) {
    const list = overdue(state.tasks, today);
    if (!list.length) return [];
    const first = dayTasks(state.tasks, today)[0];
    const base = first ? order(first) : now;
    return list.map((t, i) => {
      const prev = { id: t.id, due: t.due, pos: t.pos };
      t.due = today;
      t.pos = base - (list.length - i);
      return prev;
    });
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
      if (a && !t.done) { t.done = true; t.doneAt = now; out.done.push(t.id); }
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
  // 목표·메모를 적는다. 둘 다 비면 그날 칸을 지운다
  function setNote(state, key, patch) {
    if (!S.isKey(key)) return;
    if (!state.planner || typeof state.planner !== 'object' || Array.isArray(state.planner)) state.planner = {};
    const cur = noteOf(state, key);
    const next = {
      goal: 'goal' in patch ? String(patch.goal || '').replace(/\s+/g, ' ').trim().slice(0, 80) : cur.goal,
      memo: 'memo' in patch ? String(patch.memo || '').slice(0, 2000) : cur.memo,
    };
    if (!next.goal && !next.memo.trim()) delete state.planner[key];
    else state.planner[key] = next;
  }

  const api = {
    WD, REP_MAX, dayTitle, shortDay, relDay, nextExam, ddayText, weekKeys,
    dayTasks, undated, overdue, daySummary, studyMinutes, taskMinutes, taskColor,
    repeatDates, repText, defaultUntil, makeTasks, seriesFrom, editTask, moveTask, carryOver,
    topicComplete, linkState, syncLinked, setDone, topicTask, scopeChoices, noteOf, setNote,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
