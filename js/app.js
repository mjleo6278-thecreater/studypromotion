/* 스터디 프로모션 화면 로직 */
(function () {
  'use strict';

  let storage = null;
  try { storage = window.localStorage; storage.getItem('x'); } catch (e) { storage = null; }
  const store = StoreLib.createStore(storage);
  const uid = StoreLib.uid;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const now = () => Date.now();
  const todayKey = () => Stats.dayKey(now());

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function subjectById(id) {
    return store.get().subjects.find((s) => s.id === id);
  }

  function subjectOptions(selected, includeNone) {
    const opts = store.get().subjects.map((s) => `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`);
    if (includeNone) opts.unshift(`<option value=""${!selected ? ' selected' : ''}>과목 없음</option>`);
    return opts.join('');
  }

  // 브라우저 confirm 대신 쓰는 확인 창 (임베드 환경에서도 동작)
  function ask(message) {
    return new Promise((resolve) => {
      const dlg = $('#ask');
      $('#ask-msg').textContent = message;
      dlg.hidden = false;
      $('#ask-ok').focus();
      const done = (v) => { dlg.hidden = true; $('#ask-ok').onclick = $('#ask-cancel').onclick = dlg.onkeydown = null; resolve(v); };
      $('#ask-ok').onclick = () => done(true);
      $('#ask-cancel').onclick = () => done(false);
      dlg.onkeydown = (ev) => { if (ev.key === 'Escape') done(false); };
    });
  }

  /* ---------- 라우팅 ---------- */
  const VIEWS = ['home', 'board', 'plan', 'timer', 'review', 'stats'];
  let currentView = 'home';

  function go(view) {
    if (!VIEWS.includes(view)) view = 'home';
    currentView = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    document.body.classList.toggle('board-mode', view === 'board');
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) return go(tab.dataset.view);
    const link = e.target.closest('[data-go]');
    if (link) { e.preventDefault(); go(link.dataset.go); }
  });
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

  /* ---------- 할 일 ---------- */
  let taskFilter = 'open';

  function dueLabel(due) {
    if (!due) return '';
    const t = todayKey();
    if (due < t) return `<span class="overdue">기한 지남 (${esc(due.slice(5).replace('-', '/'))})</span>`;
    if (due === t) return '<span>오늘까지</span>';
    const diff = Math.round((new Date(due + 'T00:00') - new Date(t + 'T00:00')) / SRS.DAY);
    return `<span>D-${diff} (${esc(due.slice(5).replace('-', '/'))})</span>`;
  }

  function taskItem(t) {
    const s = subjectById(t.subjectId);
    return `<li class="task${t.done ? ' done' : ''}" data-id="${esc(t.id)}">
      <input type="checkbox" class="task-check" ${t.done ? 'checked' : ''} aria-label="완료">
      <div class="task-body">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">
          ${s ? `<span><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</span>` : ''}
          ${t.estimateMin ? `<span>${Stats.formatMinutes(t.estimateMin)}</span>` : ''}
          ${t.done ? '' : dueLabel(t.due)}
        </div>
      </div>
      <button class="icon-btn task-del" aria-label="삭제" title="삭제">✕</button>
    </li>`;
  }

  function sortTasks(list) {
    return list.slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.due || '9999', bd = b.due || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
  }

  function filteredTasks() {
    const t = todayKey();
    const tasks = store.get().tasks;
    switch (taskFilter) {
      case 'today': return tasks.filter((x) => !x.done && x.due && x.due <= t);
      case 'done': return tasks.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      case 'all': return sortTasks(tasks);
      default: return sortTasks(tasks.filter((x) => !x.done));
    }
  }

  function renderTaskList(el, list, emptyText) {
    el.innerHTML = list.length ? list.map(taskItem).join('') : `<li class="empty">${emptyText}</li>`;
  }

  function onTaskListClick(e) {
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('task-check')) {
      store.update((st) => {
        const t = st.tasks.find((x) => x.id === id);
        if (t) { t.done = e.target.checked; t.doneAt = t.done ? now() : null; }
      });
      if (e.target.checked) toast('잘했어요! 할 일 하나 완료');
    } else if (e.target.classList.contains('task-del')) {
      store.update((st) => { st.tasks = st.tasks.filter((x) => x.id !== id); });
    }
  }
  $('#tasklist').addEventListener('click', onTaskListClick);
  $('#h-tasklist').addEventListener('click', onTaskListClick);

  $('#task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('#t-title').value.trim();
    if (!title) return;
    const est = parseInt($('#t-est').value, 10);
    store.update((st) => st.tasks.push({
      id: uid(), title, subjectId: $('#t-subject').value || null,
      due: $('#t-due').value || null, estimateMin: est > 0 ? est : null,
      done: false, createdAt: now(),
    }));
    $('#t-title').value = '';
    $('#t-est').value = '';
    $('#t-title').focus();
  });

  $('#task-filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    taskFilter = b.dataset.filter;
    $$('#task-filters .chip').forEach((c) => c.classList.toggle('active', c === b));
    renderPlan();
  });

  $('#subject-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#s-name').value.trim();
    if (!name) return;
    store.update((st) => st.subjects.push({ id: uid(), name, color: $('#s-color').value }));
    $('#s-name').value = '';
  });

  $('#subject-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-subject]');
    if (!b) return;
    const id = b.dataset.delSubject;
    const s = subjectById(id);
    if (!(await ask(`'${s.name}' 과목을 삭제할까요? 할 일과 기록은 '과목 없음'으로 남습니다.`))) return;
    store.update((st) => {
      st.subjects = st.subjects.filter((x) => x.id !== id);
      st.tasks.forEach((t) => { if (t.subjectId === id) t.subjectId = null; });
    });
  });

  function renderPlan() {
    const sel = $('#t-subject').value;
    $('#t-subject').innerHTML = subjectOptions(sel, true);
    const emptyText = { open: '남은 할 일이 없어요. 위에서 추가해 보세요.', today: '오늘까지 할 일이 없어요.', done: '아직 완료한 일이 없어요.', all: '할 일이 없어요.' }[taskFilter];
    renderTaskList($('#tasklist'), filteredTasks(), emptyText);
    $('#subject-list').innerHTML = store.get().subjects.map((s) =>
      `<span class="subject-pill"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}<button class="icon-btn" data-del-subject="${esc(s.id)}" aria-label="${esc(s.name)} 삭제">✕</button></span>`
    ).join('') || '<span class="muted">과목이 없어요.</span>';
  }

  /* ---------- 홈 ---------- */
  function activeDays() {
    const st = store.get();
    const keys = st.sessions.map((s) => Stats.dayKey(s.endedAt));
    st.reviewLog.forEach((r) => keys.push(Stats.dayKey(r.at)));
    return keys;
  }

  function dueCards() {
    const t = now();
    return store.get().cards.filter((c) => SRS.isDue(c, t));
  }

  // 체스 말 그림 (글꼴마다 체스 기호 모양이 달라서 직접 그린다)
  const PAWN_SVG = '<svg class="pt-piece" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="5.2" r="3"/><path d="M7.6 8.6h4.8l-.6 1.3c1.4 1.6 2.4 3.6 2.6 6H5.6c.2-2.4 1.2-4.4 2.6-6z"/><rect x="4.2" y="15.6" width="11.6" height="2.8" rx="1"/></svg>';
  const QUEEN_SVG = '<svg class="pt-piece queen" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.4 14.8 2.6 6.4l4.2 4L10 3.6l3.2 6.8 4.2-4-.8 8.4z"/><circle cx="2.6" cy="5.6" r="1.4"/><circle cx="10" cy="2.8" r="1.4"/><circle cx="17.4" cy="5.6" r="1.4"/><rect x="3.2" y="15.4" width="13.6" height="3" rx="1"/></svg>';

  // 체스 진행 표시: 8칸 위를 폰이 전진, 100%면 퀸
  function pawnTrack(pct) {
    const r = Scope.pawnRank(pct);
    let html = '';
    for (let i = 0; i < 8; i++) {
      const piece = i === r.square ? (r.promoted ? QUEEN_SVG : PAWN_SVG) : '';
      html += `<span class="pt-sq${i % 2 ? ' dark' : ''}${i < r.square || r.promoted ? ' passed' : ''}">${piece}</span>`;
    }
    return html;
  }

  function renderHomeExams() {
    const st = store.get();
    const t = now();
    const exams = st.exams.slice().sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
    $('#h-exams').innerHTML = exams.length ? exams.map((ex) => {
      const p = Scope.examProgress(st.topics, ex.id);
      const dd = Scope.ddayLabel(ex.date, t);
      return `<a class="exam-row" href="#board" data-open-exam="${esc(ex.id)}">
        <span class="exam-name">${esc(ex.name)}</span>${dd ? `<span class="badge">${dd}</span>` : ''}
        <span class="pawn-track" aria-label="진행률 ${p.pct}%">${pawnTrack(p.pct)}</span>
        <span class="exam-pct">${p.done}/${p.total} · ${p.pct}%${(() => { const pc = Scope.pace(p.total - p.done, ex.date, t); return pc && pc.days > 0 ? ` · 하루 ${pc.perDay}개` : ''; })()}</span></a>`;
    }).join('') : '<p class="muted" style="margin:0">시험 범위를 화이트보드에 펼쳐 놓고 하나씩 체크해 보세요. <a href="#board" data-go="board">시험 만들기</a></p>';
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-open-exam]');
    if (!a) return;
    e.preventDefault();
    store.update((st) => { st.activeExamId = a.dataset.openExam; }, { silent: true });
    go('board');
  });

  function renderHome() {
    const st = store.get();
    const mins = Stats.minutesOn(st.sessions, now());
    const goal = st.settings.dailyGoalMin;
    const pct = goal ? Math.min(100, Math.round((mins / goal) * 100)) : 0;
    $('#h-today').textContent = Stats.formatMinutes(mins);
    $('#h-goalbar').style.width = pct + '%';
    $('#h-goal').textContent = `목표 ${Stats.formatMinutes(goal)} 중 ${pct}%`;
    const open = st.tasks.filter((t) => !t.done);
    const tk = todayKey();
    const todayList = sortTasks(st.tasks.filter((t) => (!t.done && t.due && t.due <= tk) || (t.done && t.doneAt && Stats.dayKey(t.doneAt) === tk)));
    $('#h-tasks').textContent = open.length;
    const overdue = open.filter((t) => t.due && t.due < tk).length;
    $('#h-tasks-sub').innerHTML = overdue ? `<span class="overdue">기한 지난 일 ${overdue}개</span>` : '기한 지난 일 없음';
    $('#h-due').textContent = dueCards().length;
    const sk = Stats.streak(activeDays(), now());
    $('#h-streak').textContent = sk + '일';
    const h = new Date().getHours();
    $('#home-greeting').textContent = h < 12 ? '좋은 아침이에요' : h < 18 ? '오늘도 한 걸음씩' : '오늘 하루 마무리해 볼까요';
    renderHomeExams();
    renderTaskList($('#h-tasklist'), todayList, '오늘까지 할 일이 없어요. <a href="#plan" data-go="plan">계획 추가하기</a>');
  }

  /* ---------- 타이머 ---------- */
  const timer = { mode: 'focus', running: false, endAt: 0, remaining: 0, total: 0, startedAt: 0, tick: null };
  const CIRC = 2 * Math.PI * 88;
  $('#ring-fg').style.strokeDasharray = CIRC;

  function modeSeconds(mode) {
    const s = store.get().settings;
    return (mode === 'focus' ? s.focusMin : s.breakMin) * 60;
  }

  function setMode(mode) {
    stopTick();
    timer.mode = mode;
    timer.running = false;
    timer.total = timer.remaining = modeSeconds(mode);
    renderTimer();
  }

  function stopTick() { clearInterval(timer.tick); timer.tick = null; }

  function startTimer() {
    if (timer.running) return;
    timer.running = true;
    timer.endAt = now() + timer.remaining * 1000;
    if (!timer.startedAt) timer.startedAt = now();
    stopTick();
    timer.tick = setInterval(onTick, 250);
    if (window.Notification && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) { /* 무시 */ }
    }
    renderTimer();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, Math.round((timer.endAt - now()) / 1000));
    timer.running = false;
    stopTick();
    renderTimer();
  }

  function onTick() {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - now()) / 1000));
    if (timer.remaining <= 0) return finishPhase(true);
    renderTimerFace();
  }

  function recordFocus(minutes) {
    if (minutes < 1) return;
    store.update((st) => st.sessions.push({ id: uid(), subjectId: $('#timer-subject').value || null, minutes, endedAt: now(), label: timer.label || null, topicId: timer.topicId || null }));
  }

  function finishPhase(completed) {
    stopTick();
    timer.running = false;
    if (timer.mode === 'focus') {
      const elapsedMin = completed ? timer.total / 60 : Math.floor((timer.total - timer.remaining) / 60);
      recordFocus(Math.round(elapsedMin));
      if (completed) { beep(); notify('집중 완료! 잠깐 쉬어요.'); toast(`${Stats.formatMinutes(elapsedMin)} 집중 기록 완료`); }
      else if (elapsedMin >= 1) toast(`${Stats.formatMinutes(elapsedMin)} 기록했어요`);
    } else if (completed) { beep(); notify('휴식 끝! 다시 집중해 볼까요?'); }
    timer.startedAt = 0;
    setMode(timer.mode === 'focus' ? 'break' : 'focus');
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.15, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch (e) { /* 소리 불가 */ }
  }

  function notify(msg) {
    try { if (window.Notification && Notification.permission === 'granted') new Notification('스터디 프로모션', { body: msg }); } catch (e) { /* 무시 */ }
  }

  function fmtClock(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function renderTimerFace() {
    $('#timer-time').textContent = fmtClock(timer.remaining);
    const frac = timer.total ? timer.remaining / timer.total : 1;
    $('#ring-fg').style.strokeDashoffset = CIRC * (1 - frac);
    document.title = timer.running ? `${fmtClock(timer.remaining)} · ${timer.mode === 'focus' ? '집중' : '휴식'}` : '스터디 프로모션';
  }

  function renderTimer() {
    $('.timer-panel').classList.toggle('break', timer.mode === 'break');
    $$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === timer.mode));
    $('#timer-mode').textContent = timer.mode === 'focus' ? '집중' : '휴식';
    $('#timer-start').textContent = timer.running ? '일시정지' : (timer.remaining < timer.total ? '계속' : '시작');
    const sel = timer.subjectPick !== undefined ? timer.subjectPick : $('#timer-subject').value;
    timer.subjectPick = undefined;
    $('#timer-subject').innerHTML = subjectOptions(sel, true);
    $('#timer-topic').hidden = !timer.label;
    $('#timer-topic-text').textContent = timer.label ? '공부 중: ' + timer.label : '';
    const st = store.get();
    const todays = st.sessions.filter((s) => Stats.dayKey(s.endedAt) === todayKey());
    $('#timer-today').textContent = `오늘 집중 ${todays.length}회 · ${Stats.formatMinutes(todays.reduce((a, s) => a + s.minutes, 0))}`;
    renderTimerFace();
  }

  $('#timer-start').addEventListener('click', () => (timer.running ? pauseTimer() : startTimer()));
  $('#timer-reset').addEventListener('click', () => { timer.startedAt = 0; setMode(timer.mode); });
  $('#timer-skip').addEventListener('click', () => finishPhase(false));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
    if (timer.running && !(await ask('진행 중인 타이머를 멈추고 바꿀까요?'))) return;
    timer.startedAt = 0;
    setMode(b.dataset.mode);
  }));

  /* ---------- 플래시카드 ---------- */
  let openDeckId = null;
  let queue = [];
  let reviewedCount = 0;

  function deckCards(id) { return store.get().cards.filter((c) => c.deckId === id); }

  function showReviewPane(name) {
    $('#deck-home').hidden = name !== 'home';
    $('#deck-detail').hidden = name !== 'detail';
    $('#study').hidden = name !== 'study';
  }

  function renderDecks() {
    const st = store.get();
    const t = now();
    $('#deck-list').innerHTML = st.decks.length ? st.decks.map((d) => {
      const cards = deckCards(d.id);
      const due = cards.filter((c) => SRS.isDue(c, t)).length;
      return `<li class="deck" data-deck="${esc(d.id)}"><div><div class="deck-name">${esc(d.name)}</div><div class="muted" style="font-size:13px">카드 ${cards.length}장</div></div>
        <span class="badge${due ? '' : ' zero'}">${due ? `복습 ${due}장` : '복습 완료'}</span></li>`;
    }).join('') : '<li class="empty">덱이 없어요. 아래에서 첫 덱을 만들어 보세요.</li>';
  }

  function renderDeckDetail() {
    const d = store.get().decks.find((x) => x.id === openDeckId);
    if (!d) { openDeckId = null; showReviewPane('home'); return renderDecks(); }
    const cards = deckCards(d.id);
    const t = now();
    const due = cards.filter((c) => SRS.isDue(c, t)).length;
    $('#deck-title').textContent = d.name;
    $('#deck-summary').textContent = `카드 ${cards.length}장 · 오늘 복습할 카드 ${due}장`;
    $('#deck-study').disabled = due === 0;
    $('#card-list').innerHTML = cards.map((c) => {
      const next = SRS.isDue(c, t) ? '복습 대기' : `${Stats.dayKey(c.due).slice(5).replace('-', '/')} 복습`;
      return `<li class="card-row" data-card="${esc(c.id)}"><span>${esc(c.front)}</span><span class="muted-text">${esc(c.back)}</span><span class="muted">${next}</span><button class="icon-btn card-del" aria-label="카드 삭제">✕</button></li>`;
    }).join('') || '<li class="empty">카드를 추가해 보세요.</li>';
  }

  $('#deck-list').addEventListener('click', (e) => {
    const li = e.target.closest('[data-deck]');
    if (!li) return;
    openDeckId = li.dataset.deck;
    showReviewPane('detail');
    renderDeckDetail();
  });

  $('#deck-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#d-name').value.trim();
    if (!name) return;
    const id = uid();
    store.update((st) => st.decks.push({ id, name, createdAt: now() }));
    $('#d-name').value = '';
    openDeckId = id;
    showReviewPane('detail');
    renderDeckDetail();
    $('#c-front').focus();
  });

  $('#deck-back').addEventListener('click', () => { openDeckId = null; showReviewPane('home'); renderDecks(); });
  $('#deck-delete').addEventListener('click', async () => {
    const d = store.get().decks.find((x) => x.id === openDeckId);
    if (!d || !(await ask(`'${d.name}' 덱과 카드 ${deckCards(d.id).length}장을 삭제할까요?`))) return;
    store.update((st) => {
      st.decks = st.decks.filter((x) => x.id !== d.id);
      st.cards = st.cards.filter((c) => c.deckId !== d.id);
    });
    openDeckId = null;
    showReviewPane('home');
    renderDecks();
  });

  function addCards(pairs) {
    const t = now();
    store.update((st) => pairs.forEach(([front, back]) => st.cards.push(SRS.newCard({ id: uid(), deckId: openDeckId, front, back, createdAt: t }, t))));
  }

  $('#card-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = $('#c-front').value.trim(), b = $('#c-back').value.trim();
    if (!f || !b) return;
    addCards([[f, b]]);
    $('#c-front').value = ''; $('#c-back').value = '';
    $('#c-front').focus();
  });

  function parseBulk(text) {
    return text.split(/\r?\n/).map((line) => {
      line = line.trim();
      if (!line) return null;
      let parts = line.split('\t');
      if (parts.length < 2) parts = line.split(/\s+-\s+/);
      if (parts.length < 2) parts = line.split(/\s*[:：]\s*/);
      if (parts.length < 2) return null;
      return [parts[0].trim(), parts.slice(1).join(' - ').trim()];
    }).filter((p) => p && p[0] && p[1]);
  }

  $('#bulk-add').addEventListener('click', () => {
    const pairs = parseBulk($('#bulk-text').value);
    if (!pairs.length) return toast('형식을 확인해 주세요. 예: apple - 사과');
    addCards(pairs);
    $('#bulk-text').value = '';
    toast(`카드 ${pairs.length}장을 추가했어요`);
  });

  $('#card-list').addEventListener('click', (e) => {
    if (!e.target.classList.contains('card-del')) return;
    const id = e.target.closest('[data-card]').dataset.card;
    store.update((st) => { st.cards = st.cards.filter((c) => c.id !== id); });
  });

  function startStudy() {
    const t = now();
    queue = deckCards(openDeckId).filter((c) => SRS.isDue(c, t)).map((c) => c.id);
    // 섞기
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    reviewedCount = 0;
    showReviewPane('study');
    showCard();
  }

  function currentCard() { return store.get().cards.find((c) => c.id === queue[0]); }

  function showCard() {
    const c = currentCard();
    const done = !c;
    $('#flash').hidden = done;
    $('#grades').hidden = true;
    $('#study-done').hidden = !done;
    if (done) {
      $('#study-meta').textContent = '';
      $('#study-done-text').textContent = `${reviewedCount}번 복습했어요. 다음 복습일에 다시 알려 드릴게요.`;
      return;
    }
    $('#study-meta').textContent = `남은 카드 ${queue.length}장 · 복습 ${reviewedCount}회`;
    $('#flash-front').textContent = c.front;
    $('#flash-back').textContent = c.back;
    $('#flash-back').hidden = true;
    $('#flash-hint').hidden = false;
    $('#flash').focus();
  }

  function flip() {
    const c = currentCard();
    if (!c || !$('#flash-back').hidden) return;
    $('#flash-back').hidden = false;
    $('#flash-hint').hidden = true;
    $('#grades').hidden = false;
    const t = now();
    $$('#grades [data-grade]').forEach((b) => { b.querySelector('small').textContent = SRS.previewLabel(c, b.dataset.grade, t); });
  }

  function grade(g) {
    const c = currentCard();
    if (!c || $('#grades').hidden) return;
    const t = now();
    const next = SRS.review(c, g, t);
    store.update((st) => {
      const i = st.cards.findIndex((x) => x.id === c.id);
      st.cards[i] = next;
      st.reviewLog.push({ cardId: c.id, grade: g, at: t });
    });
    reviewedCount++;
    queue.shift();
    if (g === 'again') queue.splice(Math.min(queue.length, 3), 0, c.id); // 몇 장 뒤에 다시
    showCard();
  }

  $('#deck-study').addEventListener('click', startStudy);
  $('#flash').addEventListener('click', flip);
  $('#grades').addEventListener('click', (e) => { const b = e.target.closest('[data-grade]'); if (b) grade(b.dataset.grade); });
  $('#study-back').addEventListener('click', () => { showReviewPane('detail'); renderDeckDetail(); });
  $('#study-finish').addEventListener('click', () => { showReviewPane('detail'); renderDeckDetail(); });

  document.addEventListener('keydown', (e) => {
    if (currentView !== 'review' || $('#study').hidden) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    const map = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
    if (map[e.key]) grade(map[e.key]);
  });

  /* ---------- 통계 ---------- */
  function renderStats() {
    const st = store.get();
    const days = Stats.lastNDays(st.sessions, now(), 7);
    const max = Math.max(60, ...days.map((d) => d.minutes));
    const total = days.reduce((a, d) => a + d.minutes, 0);
    $('#week-total').textContent = `합계 ${Stats.formatMinutes(total)} · 하루 평균 ${Stats.formatMinutes(total / 7)}`;
    $('#week-chart').innerHTML = days.map((d, i) => `<div class="wc-col${i === 6 ? ' today' : ''}">
      <div class="wc-val">${d.minutes ? Stats.formatMinutes(d.minutes) : ''}</div>
      <div class="wc-bar${d.minutes ? '' : ' zero'}" style="height:${Math.round((d.minutes / max) * 130)}px" title="${d.key} ${Stats.formatMinutes(d.minutes)}"></div>
      <div class="wc-label">${d.label}</div></div>`).join('');

    const by = Stats.minutesBySubject(st.sessions);
    const rows = Object.keys(by).map((k) => {
      const s = subjectById(k);
      return { name: s ? s.name : '과목 없음', color: s ? s.color : 'var(--muted)', minutes: by[k] };
    }).sort((a, b) => b.minutes - a.minutes);
    const top = rows.length ? rows[0].minutes : 1;
    $('#subject-bars').innerHTML = rows.length ? rows.map((r) => `<div class="sb-row"><span>${esc(r.name)}</span>
      <div class="sb-track"><div class="sb-fill" style="width:${(r.minutes / top) * 100}%;background:${esc(r.color)}"></div></div>
      <span class="sb-val">${Stats.formatMinutes(r.minutes)}</span></div>`).join('') : '<p class="muted">타이머로 집중하면 여기에 쌓여요.</p>';

    const recent = st.sessions.slice().sort((a, b) => b.endedAt - a.endedAt).slice(0, 10);
    $('#session-list').innerHTML = recent.length ? recent.map((s) => {
      const sub = subjectById(s.subjectId);
      const d = new Date(s.endedAt);
      return `<li><span>${sub ? `<i class="dot" style="background:${esc(sub.color)}"></i>${esc(sub.name)}` : '과목 없음'}${s.label ? ` <span class="muted">· ${esc(s.label)}</span>` : ''}</span>
        <span class="muted">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${Stats.formatMinutes(s.minutes)}</span></li>`;
    }).join('') : '<li class="empty">아직 기록이 없어요.</li>';

    const set = st.settings;
    if (document.activeElement.closest('#settings-form') == null) {
      $('#set-goal').value = set.dailyGoalMin;
      $('#set-focus').value = set.focusMin;
      $('#set-break').value = set.breakMin;
    }
  }

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const clamp = (v, lo, hi, d) => { v = parseInt(v, 10); return isNaN(v) ? d : Math.min(hi, Math.max(lo, v)); };
    store.update((st) => {
      st.settings.dailyGoalMin = clamp($('#set-goal').value, 10, 1440, 120);
      st.settings.focusMin = clamp($('#set-focus').value, 1, 120, 25);
      st.settings.breakMin = clamp($('#set-break').value, 1, 60, 5);
    });
    if (!timer.running) setMode(timer.mode);
    $('#set-goal').blur();
    renderStats();
    toast('설정을 저장했어요');
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `studypromotion-backup-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!(await ask('지금 데이터를 백업 파일 내용으로 바꿀까요?'))) { e.target.value = ''; return; }
        store.importJSON(reader.result);
        setMode('focus');
        toast('백업을 불러왔어요');
      } catch (err) { toast('불러오기 실패: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('#reset-btn').addEventListener('click', async () => {
    if (!(await ask('모든 할 일, 기록, 카드가 삭제됩니다. 계속할까요?'))) return;
    store.reset();
    setMode('focus');
    toast('초기화했어요');
  });

  /* ---------- 렌더 ---------- */
  function render() {
    if (currentView === 'home') renderHome();
    else if (currentView === 'plan') renderPlan();
    else if (currentView === 'timer') renderTimer();
    else if (currentView === 'review') {
      if (!$('#deck-detail').hidden) renderDeckDetail();
      else if ($('#study').hidden) renderDecks();
    } else if (currentView === 'stats') renderStats();
    else if (currentView === 'board' && window.Board) window.Board.render();
  }

  store.subscribe(() => { if ($('#study').hidden || currentView !== 'review') render(); });

  // 자정이 지나면 화면 갱신
  let lastDay = todayKey();
  setInterval(() => { if (todayKey() !== lastDay) { lastDay = todayKey(); render(); } }, 60000);

  window.addEventListener('beforeunload', (e) => {
    if (timer.running && timer.mode === 'focus') { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- 설치형 앱(PWA) ---------- */
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) { /* 무시 */ }
    installEvent = null;
    $('#install-btn').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; toast('스터디 프로모션를 설치했어요'); });
  if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 임베드 등 등록 불가 환경 */ });
    });
  }
  // 브라우저가 저장 공간을 정리할 때 데이터가 지워지지 않도록 요청
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 무시 */ }

  // 화이트보드 항목에서 바로 타이머 시작
  function focusOn(opts) {
    if (timer.running) pauseTimer();
    timer.label = opts.label || null;
    timer.topicId = opts.topicId || null;
    const subj = opts.subjectName ? store.get().subjects.find((s) => s.name === opts.subjectName) : null;
    timer.subjectPick = subj ? subj.id : '';
    timer.startedAt = 0;
    setMode('focus');
    go('timer');
  }
  $('#timer-topic-clear').addEventListener('click', () => { timer.label = null; timer.topicId = null; renderTimer(); });

  /* ---------- 화면 밝기(자동/밝게/어둡게) ---------- */
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: '자동', light: '밝게', dark: '어둡게' };
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('#theme-btn').title = '화면 밝기: ' + THEME_LABEL[t];
    $('#theme-btn').textContent = t === 'dark' ? '☾' : t === 'light' ? '☀' : '◐';
  }
  let theme = 'auto';
  try { theme = localStorage.getItem('studypromotion.theme') || localStorage.getItem('studygambit.theme') || localStorage.getItem('studymate.theme') || 'auto'; } catch (e) { /* 무시 */ }
  if (!THEMES.includes(theme)) theme = 'auto';
  applyTheme(theme);
  $('#theme-btn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem('studypromotion.theme', theme); } catch (e) { /* 무시 */ }
    applyTheme(theme);
    toast('화면 밝기: ' + THEME_LABEL[theme]);
  });

  window.App = { store, focusOn, pawnTrack, $, $$, esc, toast, ask, uid, go, now, render, get view() { return currentView; } };

  setMode('focus');
  go(location.hash.slice(1) || 'home');

  // 테스트/디버그용
  window.__studypromotion = { store, timer, finishPhase, parseBulk };
})();
