/* 스톱워치: 열품타처럼 과목을 눌러 공부 시간을 재고, 멈추면 공부 기록으로 남긴다 */
(function () {
  'use strict';
  const App = window.App;
  if (!App || !document.getElementById('timer-pane-sw')) return;
  const { store, $, $$, esc, toast, ask } = App;
  const now = () => App.now();

  const KEY = 'studypromotion.stopwatch';
  const TAB_KEY = 'studypromotion.timerTab';
  const LONG_SEC = 5 * 3600; // 이보다 오래 켜져 있었으면 기록하기 전에 물어봄 (끄는 걸 잊었을 수 있어서)
  const ICON_PLAY = '<svg class="sw-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.7v12.6a1 1 0 0 0 1.53.85l9.9-6.3a1 1 0 0 0 0-1.7l-9.9-6.3A1 1 0 0 0 8 5.7z"/></svg>';
  const ICON_STOP = '<svg class="sw-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.2"/></svg>';
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

  // running: 재는 중, startAt: 시작 시각, subjectId: 재는 과목('' = 과목 없이), last: 마지막으로 잰 과목(null = 아직 없음)
  // label: 무엇을 공부하는지(고른 할 일 이름 등), taskId: 고른 할 일, topicId: 이어서 재는 시험 범위 (없으면 null)
  const str = (v) => (v == null || v === '' ? null : String(v));
  function read() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') {
        const running = !!s.running && +s.startAt > 0;
        return { running, startAt: running ? +s.startAt : 0, subjectId: running ? String(s.subjectId || '') : '', last: s.last == null ? null : String(s.last),
          label: running ? str(s.label) : null, taskId: running ? str(s.taskId) : null, topicId: running ? str(s.topicId) : null };
      }
    } catch (e) { /* 무시 */ }
    return { running: false, startAt: 0, subjectId: '', last: null, label: null, taskId: null, topicId: null };
  }
  const idle = (last) => ({ running: false, startAt: 0, subjectId: '', last, label: null, taskId: null, topicId: null });
  const run = (startAt, id, extra) => ({ running: true, startAt, subjectId: id, last: id, label: str(extra && extra.label), taskId: str(extra && extra.taskId), topicId: str(extra && extra.topicId) });
  function save() { try { localStorage.setItem(KEY, JSON.stringify(sw)); } catch (e) { /* 무시 */ } }

  let sw = read();
  let tab = 'focus';
  try { tab = localStorage.getItem(TAB_KEY) === 'sw' ? 'sw' : 'focus'; } catch (e) { /* 무시 */ }
  if (sw.running) tab = 'sw';
  else if (App.timerBusy && App.timerBusy()) tab = 'focus';
  let busy = false; // 묻는 창이 떠 있는 동안 또 누르지 않게

  /* ---------- 시간 계산 ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  // 홈의 좁은 칸용 짧은 시계: 25:12, 1:02:05
  const shortClock = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600); return (h ? h + ':' : '') + pad(Math.floor((sec % 3600) / 60)) + ':' + pad(sec % 60); };
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor((sec % 3600) / 60)) + ':' + pad(sec % 60);
  }
  // 하루의 시작과 끝: 기본은 자정, 설정에서 하루 시작 시각을 새벽으로 옮겼으면 그 시각
  function dayStart(ts) { const off = Stats.dayOffset(); const d = new Date(ts - off); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + off; }
  function nextDay(ts) { const off = Stats.dayOffset(); const d = new Date(ts - off); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() + off; }
  const secOf = (s) => (s.sec > 0 ? s.sec : (Number(s.minutes) || 0) * 60);
  const subjects = () => store.get().subjects || [];
  const subjectOf = (id) => subjects().find((s) => s.id === id) || null;
  const nameOf = (id) => { const s = subjectOf(id); return s ? s.name : '과목 없이'; };
  // 이번에 잰 시간(초). 오늘 몫은 자정 이후만
  const runSec = (t) => (sw.running ? Math.max(0, (t - sw.startAt) / 1000) : 0);
  const runTodaySec = (t) => (sw.running ? Math.max(0, (t - Math.max(sw.startAt, dayStart(t))) / 1000) : 0);

  // 오늘 이미 기록된 공부(타이머·직접 기록·스톱워치 모두): 그릴 때마다 한 번만 센다
  let base = { day: '', total: 0, by: new Map() };
  function countBase() {
    const day = Stats.dayKey(now());
    const by = new Map();
    let total = 0;
    for (const s of store.get().sessions) {
      if (!(s.minutes > 0) || Stats.dayKey(s.endedAt) !== day) continue;
      const sec = secOf(s);
      total += sec;
      const k = s.subjectId && subjectOf(s.subjectId) ? s.subjectId : '';
      by.set(k, (by.get(k) || 0) + sec);
    }
    base = { day, total, by };
  }

  // 다음에 시작할 과목: 마지막으로 잰 과목, 없으면 첫 과목
  function nextSubject() {
    if (sw.last === '') return '';
    if (sw.last && subjectOf(sw.last)) return sw.last;
    const list = subjects();
    return list.length ? list[0].id : '';
  }

  /* ---------- 기록 ---------- */
  // startAt~end를 기록한다. 자정을 넘기면 날마다 나눠서 (하루 공부 시간이 맞게). 1분이 안 되는 조각은 버림. 기록한 초를 돌려줌
  function recordRange(startAt, end, subjectId, meta) {
    meta = meta || {};
    let parts = [];
    for (let a = startAt; a < end;) {
      const b = Math.min(end, nextDay(a));
      const sec = Math.round((b - a) / 1000);
      if (sec >= 60) parts.push({ a, b, sec, last: b === end });
      a = b;
    }
    // 자정 앞뒤로 조각이 다 1분이 안 되지만 합치면 1분이 넘으면(예: 23:59:30~00:00:40) 끝난 날로 한 번에
    const total = Math.round((end - startAt) / 1000);
    if (!parts.length && total >= 60) parts = [{ a: startAt, b: end, sec: total, last: true }];
    if (!parts.length) return 0;
    const sid = subjectId && subjectOf(subjectId) ? subjectId : null;
    store.update((st) => {
      for (const p of parts) {
        const id = 'sw-' + Math.round(p.a); // 같은 스톱워치를 두 창에서 멈춰도 한 번만
        if (st.sessions.some((x) => x.id === id)) continue;
        st.sessions.push({ id, subjectId: sid, minutes: Math.max(1, Math.round(p.sec / 60)), sec: p.sec, endedAt: p.last ? p.b : p.b - 1, label: meta.label || null, topicId: meta.topicId || null, kind: 'stopwatch' });
      }
    });
    return parts.reduce((x, p) => x + p.sec, 0);
  }

  // 지금까지 잰 시간을 기록. 너무 오래 켜져 있었으면 먼저 물어봄. 기록한 초(안 하기로 했으면 -1)
  async function finishRun(end) {
    const startAt = sw.startAt, sid = sw.subjectId, meta = { label: sw.label, topicId: sw.topicId };
    const sec = Math.floor((end - startAt) / 1000);
    if (sec >= LONG_SEC) {
      busy = true;
      const yes = await ask(`스톱워치가 ${Stats.formatMinutes(sec / 60)} 동안 켜져 있었어요.\n모두 공부한 시간으로 기록할까요?`, { ok: '모두 기록', cancel: '기록하지 않기' });
      busy = false;
      if (!yes) {
        toast('기록하지 않았어요. 실제로 공부한 만큼은 직접 기록할 수 있어요', { action: '직접 기록', onAction: () => App.openLog && App.openLog() });
        return -1;
      }
    }
    return recordRange(startAt, end, sid, meta);
  }

  /* ---------- 시작·멈춤·과목 바꾸기 ---------- */
  // extra: { label, taskId, topicId } 무엇을 공부하는지 (홈 ‘공부 시작하기’에서 고른 할 일, 집중 타이머에서 이어 온 범위)
  async function start(id, extra) {
    id = id || '';
    if (busy || (window.Lock && window.Lock.state)) return;
    if (sw.running) return extra ? switchTo(id, extra) : sw.subjectId === id ? stop() : switchTo(id);
    const tb = App.timerBusy ? App.timerBusy() : null;
    if (tb === 'focus') {
      busy = true;
      const yes = await ask('집중 타이머가 진행 중이에요.\n집중 타이머를 멈추고(지금까지 한 만큼은 기록돼요) 스톱워치를 시작할까요?', { ok: '멈추고 시작' });
      busy = false;
      if (!yes || sw.running) return;
    }
    if (tb) App.stopTimer();
    sw = run(now(), id, extra);
    save();
    begin();
    render();
  }

  async function stop() {
    if (!sw.running || busy) return;
    const sid = sw.subjectId, label = sw.label, taskId = sw.taskId, topicId = sw.topicId;
    const sec = await finishRun(now());
    sw = idle(sid);
    save();
    halt();
    render();
    if (sec > 0) {
      // 할 일을 골라서 시작했으면 끝냈는지 바로 표시할 수 있게
      const task = taskId ? store.get().tasks.find((t) => t.id === taskId && !t.done) : null;
      toast(`${nameOf(sid)}${label ? ' · ' + label : ''} ${Stats.formatMinutes(sec / 60)} 기록했어요`, task ? { action: '할 일 완료', onAction: () => finishTask(task.id) } : undefined);
      if (topicId && App.askTopicDone) App.askTopicDone(topicId, label);
    } else if (sec === 0) toast('1분이 안 돼서 기록하지 않았어요');
  }
  function finishTask(id) {
    store.update((st) => { const t = st.tasks.find((x) => x.id === id); if (t && !t.done) { t.done = true; t.doneAt = now(); } });
    toast('잘했어요! 할 일 하나 완료');
  }

  // 재는 중에 다른 과목을 누르면: 지금 과목을 기록하고 바로 새 과목으로
  async function switchTo(id, extra) {
    if (busy) return;
    const end = now(), old = sw.subjectId;
    const sec = await finishRun(end);
    sw = run(end, id, extra);
    save();
    begin();
    render();
    if (sec >= 0) toast(sec > 0 ? `${nameOf(old)} ${Stats.formatMinutes(sec / 60)} 기록 · ${nameOf(id)} 시작` : (subjectOf(id) ? `${nameOf(id)}${Stats.josa(nameOf(id), '으로/로')} 바꿨어요` : '과목 없이 재도록 바꿨어요')); // -1이면 ‘기록하지 않았어요’ 알림을 그대로
  }

  function toggle() { return sw.running ? stop() : start(nextSubject()); }

  /* ---------- 흐르는 시간 ---------- */
  let tick = null, lastShown = -1;
  function begin() {
    clearInterval(tick);
    lastShown = -1;
    tick = setInterval(onTick, 250);
    keepAwake();
    onTick();
  }
  function halt() {
    clearInterval(tick);
    tick = null;
    releaseAwake();
    if (!(App.timerRunning && App.timerRunning())) document.title = '스터디 프로모션';
    navDot();
  }
  let homeMin = -1;
  function onTick() {
    if (!sw.running) return;
    const t = now();
    const s = Math.floor(runSec(t));
    if (s === lastShown) return;
    lastShown = s;
    if (!(App.timerRunning && App.timerRunning())) document.title = `${clock(s)} · ${nameOf(sw.subjectId)}`;
    if (document.hidden) return;
    if (App.view === 'timer' && tab === 'sw') paint(t);
    else if (App.view === 'home') {
      const el = $('#h-sw-live b');
      if (el) el.textContent = shortClock(s);
      const m = Math.floor(runTodaySec(t) / 60);
      if (m !== homeMin) { homeMin = m; if (App.renderHomeToday) App.renderHomeToday(); } // ‘오늘 공부’ 분은 1분마다
    }
  }

  // 공부하는 동안 화면이 꺼지지 않게 (설정에서 끌 수 있음)
  let wake = null;
  async function keepAwake() {
    if (store.get().settings.keepAwake === false || !('wakeLock' in navigator) || wake) return;
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) { /* 지원 안 함 */ }
  }
  function releaseAwake() { try { if (wake) wake.release(); } catch (e) { /* 무시 */ } wake = null; }

  /* ---------- 그리기 ---------- */
  function navDot() { if (App.timerDot) App.timerDot(); }

  // 홈 ‘오늘 공부’ 칸 아래: 재는 중이면 과목과 이번 시간 (누르면 스톱워치로)
  function renderHomeLive() {
    const el = $('#h-sw-live');
    if (!el) return;
    const startBtn = $('#h-start');
    if (startBtn) startBtn.hidden = sw.running;
    el.hidden = !sw.running;
    if (!sw.running) { el.innerHTML = ''; return; }
    const s = subjectOf(sw.subjectId);
    el.innerHTML = `<i class="dot${s ? '' : ' none'}"${s ? ` style="background:${esc(s.color)}"` : ''}></i><span class="lv-txt"><span class="lv-name">${esc(nameOf(sw.subjectId))}</span><span class="lv-state">재는 중</span></span><b>${shortClock(runSec(now()))}</b>`;
    const what = nameOf(sw.subjectId) + (sw.label ? ' · ' + sw.label : '');
    el.setAttribute('aria-label', `스톱워치: ${what} 재는 중, 눌러서 스톱워치 열기`);
    el.title = `${what} 재는 중 · 눌러서 스톱워치 열기`;
  }

  function renderTabs() {
    $$('[data-ttab]').forEach((b) => {
      const on = b.dataset.ttab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('#timer-pane-focus').hidden = tab !== 'focus';
    $('#timer-pane-sw').hidden = tab !== 'sw';
  }

  function row(id, name, color) {
    const on = sw.running && sw.subjectId === id;
    return `<li class="sw-row${on ? ' on' : ''}${id ? '' : ' none'}"><button type="button" class="sw-pick" data-sw="${esc(id)}" aria-pressed="${on}" aria-label="${esc(name)} ${on ? '멈추고 기록' : sw.running ? '(으)로 바꾸기' : '시작'}">`
      + `<i class="dot"${color ? ` style="background:${esc(color)}"` : ''}></i><span class="sw-name">${esc(name)}</span>`
      + `<span class="sw-time" data-sw-time="${esc(id)}">00:00:00</span><span class="sw-play">${on ? ICON_STOP : ICON_PLAY}</span></button></li>`;
  }

  function render() {
    renderTabs();
    navDot();
    if (App.view === 'home') { renderHomeLive(); homeMin = -1; if (App.renderHomeToday) App.renderHomeToday(); }
    // 시작·멈춤이 타임테이블에도 바로 보이게 (재는 중 구간이 생기거나 기록된 칸으로 바뀐다)
    if (window.Timetable && (App.view === 'home' || App.view === 'timetable')) window.Timetable.render();
    if (App.view !== 'timer' || tab !== 'sw') return;
    countBase();
    const list = subjects();
    $('#sw-list').innerHTML = list.map((s) => row(s.id, s.name, s.color)).join('') + row('', '과목 없이', null);
    $('#sw-empty').hidden = list.length > 0;
    $('#timer-pane-sw').classList.toggle('on', sw.running);
    const main = $('#sw-main');
    main.innerHTML = sw.running ? `${ICON_STOP}<span>멈추고 기록</span>` : `${ICON_PLAY}<span>${esc(nextSubject() ? nameOf(nextSubject()) + ' ' : '')}시작</span>`;
    main.setAttribute('aria-pressed', String(sw.running));
    const s = subjectOf(sw.subjectId);
    $('#sw-now').hidden = !sw.running;
    $('#sw-now-dot').style.background = s ? s.color : '';
    $('#sw-now-dot').classList.toggle('none', !s);
    $('#sw-now-name').textContent = nameOf(sw.subjectId) + (sw.label ? ' · ' + sw.label : '');
    paint(now());
  }

  // 1초마다 바뀌는 숫자만 고친다
  function paint(t) {
    if (base.day !== Stats.dayKey(t)) countBase(); // 자정이 지나면 오늘 기록을 다시 셈
    const d = new Date(t - Stats.dayOffset());
    $('#sw-date').textContent = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`;
    const today = runTodaySec(t);
    $('#sw-total').textContent = clock(base.total + today);
    $$('#sw-list [data-sw-time]').forEach((el) => {
      const id = el.dataset.swTime;
      el.textContent = clock((base.by.get(id) || 0) + (sw.running && sw.subjectId === id ? today : 0));
    });
    if (sw.running) $('#sw-now-time').textContent = clock(runSec(t));
  }

  function showTab(t) {
    tab = t === 'sw' ? 'sw' : 'focus';
    try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* 무시 */ }
    render();
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ttab]');
    if (b) showTab(b.dataset.ttab);
  });
  $('.timer-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    showTab(tab === 'sw' ? 'focus' : 'sw');
    $(`[data-ttab="${tab}"]`).focus();
  });
  /* ---------- 홈 ‘공부 시작하기’: 과목 → 할 일 → 스톱워치 ---------- */
  function taskHint(t) {
    const parts = [];
    if (t.due) { const tk = App.todayKey(); parts.push(t.due < tk ? '기한 지남' : t.due === tk ? '오늘까지' : `${+t.due.slice(5, 7)}/${+t.due.slice(8)}까지`); }
    if (t.estimateMin) parts.push(Stats.formatMinutes(t.estimateMin));
    return parts.join(' · ');
  }
  // 그 과목의 아직 안 끝낸 할 일 (마감이 빠른 순, 마감 없는 것은 뒤)
  function openTasks(sid) {
    return store.get().tasks.filter((t) => !t.done && (t.subjectId && subjectOf(t.subjectId) ? t.subjectId : '') === sid)
      .sort((a, b) => { const ad = a.due || '9999', bd = b.due || '9999'; return ad !== bd ? (ad < bd ? -1 : 1) : a.createdAt - b.createdAt; });
  }
  let flowOpen = false;
  async function startFlow() {
    if (flowOpen || busy || sw.running || (window.Lock && window.Lock.state) || !App.choose) return;
    flowOpen = true;
    try {
      const list = subjects();
      let sid = '';
      if (list.length) {
        sid = await App.choose('어떤 과목을 공부할까요?',
          list.map((s) => ({ value: s.id, label: s.name, color: s.color })).concat([{ value: '', label: '과목 없이', color: '' }]), { cls: 'start-sheet' });
        if (sid === undefined) return;
      }
      const tasks = openTasks(sid);
      let extra;
      if (tasks.length) {
        const pick = await App.choose(sid ? `${nameOf(sid)} · 어떤 할 일을 할까요?` : '어떤 할 일을 할까요?',
          tasks.map((t) => ({ value: t.id, label: t.title, hint: taskHint(t) })).concat([{ value: '', label: sid ? `할 일 없이 ${nameOf(sid)}만 공부하기` : '할 일 없이 시작하기', last: true }]),
          { cls: 'start-sheet', note: '할 일에 없는 공부라면 맨 아래를 고르세요.' });
        if (pick === undefined) return;
        const t = pick && tasks.find((x) => x.id === pick);
        if (t) extra = { label: t.title, taskId: t.id };
      }
      if (sw.running) return; // 고르는 동안 다른 창에서 이미 시작함
      showTab('sw');
      App.go('timer');
      await start(sid, extra);
    } finally { flowOpen = false; }
  }
  const homeStart = $('#h-start');
  if (homeStart) homeStart.addEventListener('click', () => startFlow());

  $('#sw-main').addEventListener('click', () => toggle());
  const homeLive = $('#h-sw-live');
  if (homeLive) homeLive.addEventListener('click', () => { showTab('sw'); App.go('timer'); });
  $('#sw-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw]');
    if (b) start(b.dataset.sw);
  });
  // 다른 앱에 갔다 오면 바로 맞추고, 화면 켜 두기를 다시 건다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !sw.running) return;
    lastShown = -1;
    onTick();
    keepAwake();
  });
  // 다른 창에서 시작·멈추면 이 창도 맞춘다
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const was = sw.running;
    sw = read();
    if (sw.running) begin(); else if (was) halt();
    render();
  });

  // 오늘(자정 이후) 재고 있는 시간(분). 홈 ‘오늘 공부’에 더한다
  const todayMinutes = () => sw.running ? Math.floor(runTodaySec(now()) / 60) : 0;

  // 지금 재고 있는 구간 (타임테이블이 실시간으로 그린다). 재는 중이 아니면 null
  const live = () => (sw.running ? { from: sw.startAt, to: now(), subjectId: sw.subjectId && subjectOf(sw.subjectId) ? sw.subjectId : null, label: sw.label } : null);

  window.Stopwatch = { running: () => sw.running, stop, start, toggle, tab: () => tab, showTab, render, todayMinutes, live, startFlow };
  if (sw.running) begin();
  render();
})();
