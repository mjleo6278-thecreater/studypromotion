/* 일정: 추가·고치기 창, 끝난 일정을 ‘계획대로 했어요’로 기록하기, 일정으로 공부 시작하기.
   일정 계산은 schedule.js(window.Schedule), 표 그리기는 timetable.js가 맡는다.
   window.Events.add/update/remove는 화면 없이 일정을 고치는 함수다 (나중에 AI 도우미가 말로 일정을 바꿀 때 쓴다). */
(function () {
  'use strict';
  const App = window.App;
  const S = window.Schedule;
  if (!App || !S || !document.getElementById('ev-dlg')) return;
  const { store, $, $$, esc, toast, uid } = App;
  const now = () => App.now();
  const fm = Stats.formatMinutes;
  const pad2 = (n) => String(n).padStart(2, '0');
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const dayLabel = (key) => { const d = S.keyDate(key); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
  const subjectOf = (id) => (id ? App.subjectById(id) : null) || null;
  const taskOf = (id) => (id ? store.get().tasks.find((t) => t.id === id) : null) || null;
  // 일정 이름: 과목 · 이름 (과목이 없으면 이름만)
  function nameOf(ev) {
    const s = ev.kind === 'study' ? subjectOf(ev.subjectId) : null;
    const t = taskOf(ev.taskId);
    const what = ev.title || (t ? t.title : '');
    return s ? (what ? `${s.name} · ${what}` : s.name) : (what || '공부');
  }
  const findEv = (id) => store.get().events.find((x) => x.id === id) || null;
  function occOf(id, date) {
    const ev = findEv(id);
    return ev ? S.forDay([ev], date)[0] || null : null;
  }

  /* ---------- 일정 창 ---------- */
  let editing = null; // 고치는 중이면 { id, date(누른 날) }
  let kind = 'study', rep = '', days = new Set();
  let returnFocus = null;

  function setKind(k) {
    kind = k === 'other' ? 'other' : 'study';
    $$('[data-ev-kind]').forEach((b) => { const on = b.dataset.evKind === kind; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#ev-subject-f').hidden = kind === 'other';
    $('#ev-task-f').hidden = kind === 'other';
    $('#ev-name-label').innerHTML = kind === 'other' ? '이름' : '이름 <small>(선택)</small>';
    $('#ev-name').placeholder = kind === 'other' ? '예: 친구 약속, 운동, 병원' : '예: 학원, 문제집 3단원';
    renderSum();
  }
  function setRep(r) {
    rep = r === 'daily' || r === 'weekly' ? r : '';
    $$('[data-ev-rep]').forEach((b) => { const on = b.dataset.evRep === rep; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#ev-days').hidden = rep !== 'weekly';
    $('#ev-until-f').hidden = !rep;
    if (rep === 'weekly' && !days.size && S.isKey($('#ev-date').value)) days.add(S.weekday($('#ev-date').value));
    paintDays();
    renderSum();
  }
  function paintDays() {
    $$('[data-ev-day]').forEach((b) => { const on = days.has(+b.dataset.evDay); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  function fill(hSel, mSel, min) {
    $(hSel).value = min == null ? '' : Math.floor(min / 60);
    $(mSel).value = min == null ? '' : pad2(min % 60);
  }
  // 적은 시각 → 분 (비었으면 null, 잘못이면 NaN)
  function readTime(hSel, mSel, maxH) {
    const hv = $(hSel).value.trim(), mv = $(mSel).value.trim();
    if (hv === '') return null;
    const h = Number(hv), m = mv === '' ? 0 : Number(mv);
    if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > maxH || m < 0 || m > 59 || (h === 24 && m)) return NaN;
    return h * 60 + m;
  }
  function taskOptions(sel) {
    const list = store.get().tasks.filter((t) => !t.done || t.id === sel);
    return '<option value="">연결 안 함</option>' + list.map((t) => `<option value="${esc(t.id)}"${t.id === sel ? ' selected' : ''}>${esc(t.title)}</option>`).join('');
  }

  // 창에 적힌 값 → Schedule.clean에 넘길 값 (시각을 잘못 적었으면 { error, focus })
  function readForm() {
    const a = readTime('#ev-sh', '#ev-sm', 23), b = readTime('#ev-eh', '#ev-em', 24);
    if (a === null) return { error: '시작 시각을 적어 주세요', focus: '#ev-sh' };
    if (b === null) return { error: '끝 시각을 적어 주세요', focus: '#ev-eh' };
    if (Number.isNaN(a)) return { error: '시작 시각을 바르게 적어 주세요 (0~23시, 0~59분)', focus: '#ev-sh' };
    if (Number.isNaN(b)) return { error: '끝 시각을 바르게 적어 주세요 (0~24시, 0~59분)', focus: '#ev-eh' };
    return {
      kind, title: $('#ev-name').value, subjectId: kind === 'study' ? $('#ev-subject').value || null : null,
      taskId: kind === 'study' ? $('#ev-task').value || null : null,
      date: $('#ev-date').value, start: S.fmtHM(a), end: S.fmtHM(b),
      repeat: rep ? { freq: rep, days: [...days], until: $('#ev-until').value || null } : null,
    };
  }

  // 아래 한 줄: ‘16:00 ~ 18:00 · 2시간 · 매주 월·수·금’
  function renderSum() {
    const el = $('#ev-sum');
    if (!el) return;
    const a = readTime('#ev-sh', '#ev-sm', 23), b = readTime('#ev-eh', '#ev-em', 24);
    if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b) || a === b) { el.hidden = true; return; }
    const len = b > a ? b - a : b + 1440 - a;
    const r = rep ? S.repeatText({ repeat: { freq: rep, days: [...days], until: $('#ev-until').value || null } }) : '';
    el.hidden = false;
    el.classList.remove('bad');
    el.textContent = `${S.fmtHM(a)} ~ ${b <= a ? '다음 날 ' : ''}${S.fmtHM(b)} · ${fm(len)}${r ? ' · ' + r : ''}`;
  }

  // opts: { id, date } 고치기 / { date, start(분), end(분), subjectId, taskId, title, kind } 새로 추가
  function open(opts) {
    opts = opts || {};
    returnFocus = document.activeElement;
    const ev = opts.id ? findEv(opts.id) : null;
    editing = ev ? { id: ev.id, date: S.isKey(opts.date) ? opts.date : ev.date } : null;
    const src = ev || {};
    const tk = App.todayKey();
    const date = ev ? editing.date : (S.isKey(opts.date) ? opts.date : tk);
    $('#ev-date').value = date;
    days = new Set(src.repeat && src.repeat.freq === 'weekly' ? src.repeat.days : []);
    $('#ev-until').value = (src.repeat && src.repeat.until) || '';
    setKind(src.kind || opts.kind || 'study');
    const task = taskOf(src.taskId || opts.taskId);
    $('#ev-subject').innerHTML = App.subjectOptions(src.subjectId || opts.subjectId || (task && task.subjectId) || '', true);
    $('#ev-task').innerHTML = taskOptions(src.taskId || opts.taskId || '');
    $('#ev-name').value = src.title || opts.title || '';
    // 시각: 고치면 그대로, 새로 추가면 누른 시각(없으면 다음 정시)부터 한 시간
    let a = ev ? S.parseHM(ev.start) : opts.start != null ? opts.start : null;
    if (a == null) { const d = new Date(now()); a = Math.min(23, d.getHours() + 1) * 60; }
    const b = ev ? S.parseHM(ev.end) : opts.end != null ? opts.end : Math.min(a + 60, 1440);
    fill('#ev-sh', '#ev-sm', a);
    fill('#ev-eh', '#ev-em', b);
    setRep(src.repeat ? src.repeat.freq : '');
    $('#ev-title-h').textContent = ev ? '일정 고치기' : '일정 추가';
    $('#ev-save').textContent = ev ? '저장' : '추가';
    $('#ev-del').hidden = !ev;
    renderSum();
    $('#ev-dlg').hidden = false;
    const f = ev || opts.start != null ? '#ev-name' : '#ev-sh';
    try { $(f).focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }
  function close() {
    $('#ev-dlg').hidden = true;
    editing = null;
    try { if (returnFocus && returnFocus.focus && document.contains(returnFocus)) returnFocus.focus(); } catch (e) { /* 무시 */ }
  }
  const isOpen = () => !$('#ev-dlg').hidden;

  // 반복 일정을 고치거나 지울 때 어디까지인지 묻는다
  function askScope(verb, date) {
    return App.choose(`반복 일정을 어떻게 ${verb}?`, [
      { value: 'one', label: verb === '지울까요' ? '이 날만 빼기' : '이 날만', hint: dayLabel(date) },
      { value: 'future', label: verb === '지울까요' ? '이 날부터 앞으로 지우기' : '이 날부터 앞으로' },
      { value: 'all', label: verb === '지울까요' ? '반복 전체 지우기' : '반복 전체' },
    ]);
  }

  function undoToast(text, before) {
    toast(text, { action: '되돌리기', onAction: () => store.update((s) => { s.events = before; }) });
  }

  async function save(e) {
    e.preventDefault();
    const input = readForm();
    if (input.error) { toast(input.error); if (input.focus) $(input.focus).focus(); return; }
    const before = clone(store.get().events);
    const orig = editing ? findEv(editing.id) : null;
    if (!orig) {
      const ev = S.clean(input, { uid, now });
      if (ev.error) { toast(ev.error); return; }
      store.update((s) => s.events.push(ev));
      close();
      undoToast(`${dayLabel(ev.date)} ${S.fmtHM(S.parseHM(ev.start))} ${nameOf(ev)} 일정을 추가했어요`, before);
      return;
    }
    let scope = 'all';
    if (orig.repeat) {
      // 먼저 맞는지 검사해서, 잘못 적었으면 묻지 않는다
      const test = S.clean(Object.assign({}, input, { id: orig.id }), { uid, now });
      if (test.error) { toast(test.error); return; }
      scope = await askScope('바꿀까요', editing.date);
      if (scope === undefined) return;
    }
    const at = editing.date;
    let ev;
    if (scope === 'all') {
      // 날짜 칸을 그대로 두고 반복 전체를 바꾸면 처음 날짜를 지킨다
      const keepStart = orig.repeat && input.repeat && input.date === at;
      ev = S.clean(Object.assign({}, input, { id: orig.id, createdAt: orig.createdAt, date: keepStart ? orig.date : input.date, skip: orig.skip }), { uid, now });
    } else if (scope === 'one') {
      ev = S.clean(Object.assign({}, input, { repeat: null }), { uid, now });
    } else {
      ev = S.clean(input, { uid, now });
    }
    if (ev.error) { toast(ev.error); return; }
    store.update((s) => {
      const i = s.events.findIndex((x) => x.id === orig.id);
      if (i < 0) { s.events.push(ev); return; }
      if (scope === 'all') s.events[i] = ev;
      else if (scope === 'one') { s.events[i] = S.skipDay(orig, at); s.events.push(ev); }
      else {
        const cut = S.endBefore(orig, at);
        if (cut) s.events[i] = cut; else s.events.splice(i, 1);
        s.events.push(ev);
      }
    });
    close();
    undoToast('일정을 고쳤어요', before);
  }

  async function del() {
    const orig = editing ? findEv(editing.id) : null;
    if (!orig) { close(); return; }
    let scope = 'all';
    if (orig.repeat) { scope = await askScope('지울까요', editing.date); if (scope === undefined) return; }
    const at = editing.date;
    const before = clone(store.get().events);
    store.update((s) => {
      const i = s.events.findIndex((x) => x.id === orig.id);
      if (i < 0) return;
      if (scope === 'one') s.events[i] = S.skipDay(orig, at);
      else if (scope === 'future') { const cut = S.endBefore(orig, at); if (cut) s.events[i] = cut; else s.events.splice(i, 1); }
      else s.events.splice(i, 1);
    });
    close();
    undoToast(scope === 'one' ? `${dayLabel(at)} 일정을 뺐어요` : `${nameOf(orig)} 일정을 지웠어요`, before);
  }

  $('#ev-form').addEventListener('submit', save);
  $('#ev-cancel').addEventListener('click', close);
  $('#ev-del').addEventListener('click', del);
  $('#ev-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.ui-back.in')) close(); });
  $('#ev-dlg').addEventListener('click', (e) => {
    if (e.target === $('#ev-dlg')) return close();
    const k = e.target.closest('[data-ev-kind]');
    if (k) return setKind(k.dataset.evKind);
    const r = e.target.closest('[data-ev-rep]');
    if (r) return setRep(r.dataset.evRep);
    const d = e.target.closest('[data-ev-day]');
    if (d) {
      const n = +d.dataset.evDay;
      if (days.has(n)) days.delete(n); else days.add(n);
      paintDays();
      renderSum();
    }
  });
  ['#ev-sh', '#ev-sm', '#ev-eh', '#ev-em'].forEach((sel) => $(sel).addEventListener('input', renderSum));
  $('#ev-until').addEventListener('change', renderSum);
  // 날짜를 바꾸면 매주 반복의 요일이 하나뿐일 때 그 요일도 따라간다
  $('#ev-date').addEventListener('change', () => {
    const v = $('#ev-date').value;
    if (rep === 'weekly' && S.isKey(v) && days.size === 1) { days = new Set([S.weekday(v)]); paintDays(); renderSum(); }
  });
  // 할 일을 고르면 그 할 일의 과목으로
  $('#ev-task').addEventListener('change', () => {
    const t = taskOf($('#ev-task').value);
    if (t && t.subjectId && subjectOf(t.subjectId) && $('#ev-subject').value !== t.subjectId) {
      $('#ev-subject').value = t.subjectId;
      $('#ev-subject').dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // ‘＋ 일정 추가’ 단추: 타임테이블에서 누르면 보고 있는 날
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev-open]');
    if (!b) return;
    e.preventDefault();
    const tk = App.todayKey();
    let date = tk;
    if (window.Timetable) {
      const d = b.dataset.evOpen === 'week' ? window.Timetable.week : window.Timetable.day;
      if (d && d > tk) date = d;
    }
    open({ date });
  });

  /* ---------- 끝난 일정을 기록하기, 일정으로 시작하기 ---------- */
  async function logDone(id, date) {
    const occ = occOf(id, date);
    if (!occ || occ.ev.kind !== 'study') return;
    if (occ.to > now()) { toast('일정이 끝난 뒤에 기록할 수 있어요'); return; }
    const hits = App.logOverlaps ? App.logOverlaps(occ.from, occ.to) : [];
    if (hits.length) {
      const min = hits.reduce((a, h) => a + h.min, 0);
      if (!(await App.ask(`이 시간에 이미 다른 공부 기록이 ${fm(min)} 있어요. 그래도 ${fm(occ.minutes)}을 기록할까요?`, { ok: '기록하기' }))) return;
    }
    const t = taskOf(occ.ev.taskId);
    const label = occ.ev.title || (t ? t.title : '') || '';
    const ids = App.recordSpan(occ.from, occ.to, subjectOf(occ.ev.subjectId) ? occ.ev.subjectId : null, label);
    toast(`${nameOf(occ.ev)} ${fm(occ.minutes)}을 기록했어요`, { action: '되돌리기', onAction: () => store.update((s) => { s.sessions = s.sessions.filter((x) => !ids.includes(x.id)); }) });
  }

  function start(id, date) {
    const occ = occOf(id, date || App.todayKey());
    if (!occ) return;
    if (window.Stopwatch && window.Stopwatch.startPlan) window.Stopwatch.startPlan(occ.ev);
  }

  // 일정 목록·주간 표·홈의 단추: 고치기 / 시작 / 계획대로 했어요
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev-edit], [data-ev-start], [data-ev-done]');
    if (!b) return;
    const row = b.closest('[data-ev-id]');
    if (!row) return;
    e.preventDefault();
    const id = row.dataset.evId, date = row.dataset.evDate;
    if (b.hasAttribute('data-ev-start')) start(id, date);
    else if (b.hasAttribute('data-ev-done')) logDone(id, date);
    else open({ id, date });
  });

  /* ---------- 화면 없이 고치는 함수 (AI 도우미용) ---------- */
  // add(값) → 저장한 일정 또는 { error }
  function add(input) {
    const ev = S.clean(input, { uid, now });
    if (ev.error) return ev;
    store.update((s) => s.events.push(ev));
    return ev;
  }
  // update(id, 바꿀 칸) → 고친 일정 또는 { error }
  function update(id, patch) {
    const orig = findEv(id);
    if (!orig) return { error: '그런 일정이 없어요' };
    const ev = S.clean(Object.assign({}, orig, patch || {}, { id: orig.id, createdAt: orig.createdAt }), { uid, now });
    if (ev.error) return ev;
    store.update((s) => { const i = s.events.findIndex((x) => x.id === id); if (i >= 0) s.events[i] = ev; });
    return ev;
  }
  function remove(id) {
    if (!findEv(id)) return false;
    store.update((s) => { s.events = s.events.filter((x) => x.id !== id); });
    return true;
  }

  window.Events = { open, close, isOpen, logDone, start, nameOf, add, update, remove, list: () => clone(store.get().events) };
})();
