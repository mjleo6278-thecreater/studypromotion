/* 스터디 프로모션 화면 로직 */
(function () {
  'use strict';

  let storage = null;
  try { storage = window.localStorage; storage.getItem('x'); } catch (e) { storage = null; }
  const store = StoreLib.createStore(storage);
  // 하루 시작 시각(설정)을 날짜 계산에 알려 준다. 기록이 바뀔 때마다(가져오기·계정 동기화 포함) 다른 화면이 그려지기 전에 맞춘다
  const applyDayStart = () => Stats.setDayStart(store.get().settings.dayStartHour);
  applyDayStart();
  store.subscribe(applyDayStart);
  const uid = StoreLib.uid;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const now = () => Date.now();
  // 선 아이콘 (index.html 맨 위 아이콘 묶음의 기호를 가져다 쓴다)
  const ic = (name, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const todayKey = () => Stats.dayKey(now());
  const dayNow = () => now() - Stats.dayOffset(); // 오늘이 며칠·몇 월인지 볼 때 쓰는 시각 (하루 시작 시각 전의 새벽은 전날)

  // opts.action / opts.onAction: 알림 옆에 '되돌리기' 같은 버튼 (5초 동안)
  function toast(msg, opts) {
    const t = $('#toast');
    t.textContent = msg;
    const act = !!(opts && opts.action && opts.onAction);
    if (act) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-act';
      b.textContent = opts.action;
      b.addEventListener('click', () => { clearTimeout(toast._t); t.classList.remove('show'); opts.onAction(); });
      t.appendChild(b);
    }
    t.classList.toggle('has-act', act);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), act ? 5000 : 2200);
  }

  function subjectById(id) {
    return store.get().subjects.find((s) => s.id === id);
  }

  function subjectOptions(selected, includeNone) {
    const opts = store.get().subjects.map((s) => `<option value="${esc(s.id)}" data-color="${esc(s.color || '')}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`);
    if (includeNone) opts.unshift(`<option value=""${!selected ? ' selected' : ''}>과목 없음</option>`);
    return opts.join('');
  }

  // 브라우저 confirm 대신 쓰는 확인 창 (임베드 환경에서도 동작)
  // opts.ok / opts.cancel: 버튼에 적을 말 (무엇을 하는 버튼인지 그대로 적는다)
  // opts.danger: 지우는 일처럼 되돌리기 어려운 동작 → 빨간 버튼, 처음 초점은 '취소'에 (Enter로 실수하지 않게)
  // opts.alt: 세 번째 선택지. 누르면 'alt'를 돌려준다
  // opts.mustChoose: Esc·뒤로 가기로 닫히지 않고 버튼을 골라야 한다
  function ask(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const dlg = $('#ask');
      const ok = $('#ask-ok'), cancel = $('#ask-cancel'), alt = $('#ask-alt');
      $('#ask-msg').textContent = message;
      ok.textContent = opts.ok || '확인';
      ok.classList.toggle('danger-fill', !!opts.danger);
      ok.classList.toggle('primary', !opts.danger);
      cancel.textContent = opts.cancel || '취소';
      alt.hidden = !opts.alt;
      alt.textContent = opts.alt || '';
      dlg.classList.toggle('three', !!opts.alt);
      dlg.dataset.mustChoose = opts.mustChoose ? '1' : '';
      dlg.hidden = false;
      (opts.danger ? cancel : ok).focus();
      const done = (v) => { dlg.hidden = true; ok.onclick = cancel.onclick = alt.onclick = dlg.onkeydown = null; resolve(v); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      alt.onclick = () => done('alt');
      dlg.onkeydown = (ev) => { if (ev.key === 'Escape' && !opts.mustChoose) done(false); };
    });
  }

  /* ---------- 라우팅 ---------- */
  const VIEWS = ['home', 'board', 'plan', 'timer', 'review', 'stats', 'account', 'about'];
  let currentView = 'home';

  function go(view) {
    if (!VIEWS.includes(view)) view = 'home';
    const prev = currentView;
    currentView = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab, .top-icon[data-view]').forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      if (t.classList.contains('tab')) t.setAttribute('aria-selected', String(on));
      else if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    document.body.classList.toggle('board-mode', view === 'board');
    if (location.hash !== '#' + view) { try { history.replaceState(history.state, '', '#' + view); } catch (e) { /* 방문 기록을 못 쓰는 환경 */ } }
    if (prev === 'about' && view !== 'about') stopAboutTrack();
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-view]');
    if (tab) { if (tab.tagName === 'A') e.preventDefault(); return go(tab.dataset.view); }
    const link = e.target.closest('[data-go]');
    if (link) { e.preventDefault(); go(link.dataset.go); }
  });
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

  /* ---------- 휴대폰 '뒤로' 버튼 ----------
     열린 창이 있으면 그 창만 닫고, 없으면 홈으로 가고, 홈에서는 앱을 나간다(설치한 앱은 한 번 더 눌러야 닫힘).
     방문 기록 맨 아래에 '바닥' 칸을 하나 깔고 그 위에 지금 화면을 올려 둔다. '뒤로'를 누르면 바닥으로 내려오므로, 그때 할 일을 정하고 다시 올라온다.
     화면을 옮길 때는 지금처럼 맨 위 칸의 주소만 바꾸므로 방문 기록이 쌓이지 않는다. */
  // 맨 위에 열려 있는 창(확인 창·선택 시트·메뉴·입력 창·열어 둔 덱)을 하나 닫는다. 닫을 게 있었으면 true
  function closeTopOverlay() {
    const askDlg = $('#ask');
    if (!askDlg.hidden) { if (!askDlg.dataset.mustChoose) $('#ask-cancel').click(); return true; }
    if (document.querySelector('.ui-back:not(.out)') && window.UI) { window.UI.closeSheet(); return true; }
    const menu = $('#pop-menu');
    if (menu && !menu.hidden) { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; } // 메뉴는 Esc로 닫히게 돼 있다
    const dlg = $$('.ask-backdrop:not([hidden])').pop();
    if (dlg) {
      const btn = dlg.querySelector('[id$="-cancel"], [id$="-close"]');
      if (btn) btn.click(); else dlg.hidden = true;
      return true;
    }
    if (currentView === 'review' && openDeckId) { $('#deck-back').click(); return true; }
    return false;
  }
  const isInstalled = () => { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
  const pushTop = () => { try { history.pushState({ sp: 'top' }, '', '#' + currentView); } catch (e) { /* 무시 */ } };
  let exitTimer = null;
  function onBack() {
    if (closeTopOverlay()) return pushTop();
    if (currentView !== 'home') { pushTop(); return go('home'); }
    if (!isInstalled()) {
      // 브라우저 탭: 평소처럼 이전 페이지로. 돌아갈 곳이 없어 그대로 남았으면 다시 칸을 올려 둔다
      try { history.back(); } catch (e) { /* 무시 */ }
      exitTimer = setTimeout(() => { if (history.state && history.state.sp === 'base') pushTop(); }, 400);
      return;
    }
    toast('한 번 더 누르면 앱이 닫혀요');
    exitTimer = setTimeout(pushTop, 2000);
  }
  window.addEventListener('popstate', (e) => {
    if (window.Lock && window.Lock.state) return; // 잠금 중에는 잠금 화면이 '뒤로'를 막는다
    clearTimeout(exitTimer);
    const st = e.state;
    if (st && st.sp === 'base') return onBack();
    // 잠금이 끝난 뒤 남은 칸에서 내려온 경우: 바닥까지 마저 내려가 '뒤로' 한 번으로 처리한다
    if (st && st.sp === 'top') { try { history.back(); } catch (err) { /* 무시 */ } }
  });
  function initHistory() {
    try {
      if (history.state && (history.state.sp === 'top' || history.state.lock)) return; // 새로 고침: 이미 깔려 있음
      history.replaceState({ sp: 'base' }, '', location.href);
      history.pushState({ sp: 'top' }, '', location.href);
    } catch (e) { /* 방문 기록을 못 쓰는 환경(파일로 열기 등)에서는 예전처럼 동작 */ }
  }

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

  let editingTaskId = null;
  let taskDraft = null; // 고치는 중 다시 그려질 때 입력값 유지
  function taskItem(t) {
    if (t.id === editingTaskId) {
      const d = taskDraft || { title: t.title, subjectId: t.subjectId || '', due: t.due || '', est: t.estimateMin || '' };
      return `<li class="task editing" data-id="${esc(t.id)}"><form class="task-edit" data-task-edit="${esc(t.id)}">
        <input name="title" value="${esc(d.title)}" required maxlength="120" aria-label="할 일" autocomplete="off">
        <select name="subject" aria-label="과목">${subjectOptions(d.subjectId, true)}</select>
        <input name="due" type="date" value="${esc(d.due)}" aria-label="마감일">
        <input name="est" type="number" min="5" step="5" value="${esc(d.est)}" placeholder="예상(분)" aria-label="예상 시간(분)">
        <span class="card-edit-actions"><button class="btn sm" type="button" data-task-cancel>취소</button><button class="btn primary sm" type="submit">저장</button></span>
      </form></li>`;
    }
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
      <button class="icon-btn task-edit-btn" aria-label="고치기" title="고치기">${ic('edit')}</button>
      <button class="icon-btn task-del" aria-label="삭제" title="삭제">${ic('x')}</button>
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
    const form = el.querySelector('.task-edit');
    const focus = form && document.activeElement && form.contains(document.activeElement) ? document.activeElement.name : null;
    if (form && form.dataset.taskEdit === editingTaskId) taskDraft = { title: form.title.value, subjectId: form.subject.value, due: form.due.value, est: form.est.value };
    if (editingTaskId && !store.get().tasks.some((t) => t.id === editingTaskId)) { editingTaskId = null; taskDraft = null; }
    el.innerHTML = list.length ? list.map(taskItem).join('') : `<li class="empty">${emptyText}</li>`;
    if (focus) { const f = el.querySelector(`.task-edit [name="${focus}"]`); if (f) f.focus(); }
  }

  function onTaskListClick(e) {
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.task-edit-btn')) {
      editingTaskId = id;
      taskDraft = null;
      render();
      const input = e.currentTarget.querySelector('.task-edit [name="title"]');
      if (input) { input.focus(); input.select(); }
      return;
    }
    if (e.target.closest('[data-task-cancel]')) { editingTaskId = null; taskDraft = null; render(); return; }
    if (e.target.classList.contains('task-check')) {
      store.update((st) => {
        const t = st.tasks.find((x) => x.id === id);
        if (t) { t.done = e.target.checked; t.doneAt = t.done ? now() : null; }
      });
      if (e.target.checked) toast('잘했어요! 할 일 하나 완료');
    } else if (e.target.closest('.task-del')) {
      const list = store.get().tasks;
      const i = list.findIndex((x) => x.id === id);
      if (i < 0) return;
      const removed = list[i];
      store.update((st) => { st.tasks = st.tasks.filter((x) => x.id !== id); });
      toast(`'${removed.title}' 지웠어요`, { action: '되돌리기', onAction: () => store.update((st) => { if (!st.tasks.some((x) => x.id === id)) st.tasks.splice(Math.min(i, st.tasks.length), 0, removed); }) });
    }
  }
  $('#tasklist').addEventListener('click', onTaskListClick);
  $('#h-tasklist').addEventListener('click', onTaskListClick);
  function onTaskEditSubmit(e) {
    const f = e.target.closest('.task-edit');
    if (!f) return;
    e.preventDefault();
    const title = f.title.value.trim();
    if (!title) return toast('할 일을 적어 주세요');
    const id = f.dataset.taskEdit;
    const est = parseInt(f.est.value, 10);
    editingTaskId = null;
    taskDraft = null;
    store.update((st) => {
      const t = st.tasks.find((x) => x.id === id);
      if (t) { t.title = title; t.subjectId = f.subject.value || null; t.due = f.due.value || null; t.estimateMin = est > 0 ? est : null; }
    });
    toast('할 일을 고쳤어요');
  }
  function onTaskEditKey(e) {
    if (e.key === 'Escape' && e.target.closest('.task-edit')) { editingTaskId = null; taskDraft = null; render(); }
  }
  ['#tasklist', '#h-tasklist'].forEach((sel) => { $(sel).addEventListener('submit', onTaskEditSubmit); $(sel).addEventListener('keydown', onTaskEditKey); });

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
    if (!(await ask(`'${s.name}' 과목을 삭제할까요? 할 일과 기록은 '과목 없음'으로 남습니다.`, { ok: '삭제', danger: true }))) return;
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
      `<span class="subject-pill"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}<button class="icon-btn" data-del-subject="${esc(s.id)}" aria-label="${esc(s.name)} 삭제">${ic('x')}</button></span>`
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
    // 다가오는 시험(가까운 순) → 날짜 없는 시험 → 끝난 시험(최근 순)
    const tk = todayKey();
    const past = (e) => !!e.date && e.date < tk;
    const exams = st.exams.slice().sort((a, b) => {
      if (past(a) !== past(b)) return past(a) ? 1 : -1;
      if (past(a)) return a.date < b.date ? 1 : -1;
      return (a.date || '9999') < (b.date || '9999') ? -1 : 1;
    });
    $('#h-exams').innerHTML = exams.length ? exams.map((ex) => {
      const p = Scope.examProgress(st.topics, ex.id);
      const dd = Scope.ddayLabel(ex.date, t);
      return `<a class="exam-row${past(ex) ? ' past' : ''}" href="#board" data-open-exam="${esc(ex.id)}">
        <span class="exam-name">${esc(ex.name)}</span>${dd ? `<span class="badge${past(ex) ? ' zero' : ''}">${past(ex) ? '끝남 · ' + dd : dd}</span>` : ''}
        <span class="pawn-track" aria-label="진행률 ${p.pct}%">${pawnTrack(p.pct)}</span>
        <span class="exam-pct">${(() => {
          const plan = Scope.timePlan(p, ex, t);
          if (plan) return `${p.pct}% · 남은 ${Stats.formatMinutes(plan.left)}` + (plan.finished ? '' : plan.days > 0 ? ` · 오늘 ${plan.todayLeft ? Stats.formatMinutes(plan.todayLeft) + ' 더' : '몫 완료 ✓'}` : '') + (plan.behind && !plan.finished ? ` · <span class="overdue">밀림 ${Stats.formatMinutes(plan.behind)}</span>` : '');
          const pc = Scope.pace(p.total - p.done, ex.date, t);
          return `${p.done}/${p.total} · ${p.pct}%` + (pc && pc.days > 0 ? ` · 하루 ${pc.perDay}개` : '');
        })()}</span></a>`;
    }).join('') : '<p class="muted" style="margin:0">시험 이름과 과목을 정하고, 과목마다 공부할 내용을 적어 하나씩 체크해 보세요. <a href="#board" data-go="board">시험 범위 만들기</a></p>';
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-open-exam]');
    if (!a) return;
    e.preventDefault();
    store.update((st) => { st.activeExamId = a.dataset.openExam; }, { silent: true });
    go('board');
  });

  // 홈 ‘오늘 공부’: 기록된 시간 + 지금 재고 있는 스톱워치 시간 (스톱워치가 1분마다 다시 부른다)
  function renderHomeToday() {
    const st = store.get();
    const live = window.Stopwatch ? window.Stopwatch.todayMinutes() : 0;
    const mins = Stats.minutesOn(st.sessions, now()) + live;
    const goal = st.settings.dailyGoalMin;
    const pct = goal ? Math.min(100, Math.round((mins / goal) * 100)) : 0;
    $('#h-today').textContent = Stats.formatMinutes(mins);
    $('#h-goalbar').style.width = pct + '%';
    $('#h-goal').textContent = `목표 ${Stats.formatMinutes(goal)} 중 ${pct}%`;
    const mg = Stats.monthGoal(st.settings.monthlyGoalMin || 0, Stats.lastNMonths(st.sessions, now(), 1)[0].minutes + live, now(), mins);
    $('#h-month-pace').hidden = !mg;
    if (mg) $('#h-month-pace').textContent = mg.done ? '이번 달 목표 달성 🎉' : mg.todayLeft ? `월 목표 페이스: 오늘 ${Stats.formatMinutes(mg.todayLeft)} 더` : '월 목표 페이스: 오늘 몫 완료 ✓';
  }

  function renderHome() {
    const st = store.get();
    renderHomeToday();
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
    $('#home-greeting').textContent = h < 5 ? '늦은 시간까지 수고 많아요' : h < 12 ? '좋은 아침이에요' : h < 18 ? '오늘도 한 걸음씩' : '오늘 하루 마무리해 볼까요';
    touchPlans();
    renderHomeExams();
    renderHomeNext();
    renderWelcome();
    renderTaskList($('#h-tasklist'), todayList, '오늘까지 할 일이 없어요. <a href="#plan" data-go="plan">계획 추가하기</a>');
  }

  // 시험마다 오늘 아침 남은 양을 기록해 둔다 (그래야 오늘 한 양·오늘 남은 양이 맞다)
  function touchPlans() {
    const st = store.get();
    const t = now();
    const changes = [];
    for (const ex of st.exams) {
      const copy = Object.assign({}, ex);
      if (Scope.touchPlan(copy, Scope.examProgress(st.topics, ex.id), t)) changes.push(copy);
    }
    if (changes.length) {
      store.update((s) => changes.forEach((c) => { const e = s.exams.find((x) => x.id === c.id); if (e) { e.planStart = c.planStart; e.paceSnap = c.paceSnap; } }), { silent: true });
    }
  }

  // 오늘 할 범위: 가장 가까운 시험에서, 과목을 번갈아 오늘 할 양만큼
  function nextExam() {
    const st = store.get();
    const tk = todayKey();
    // 날짜가 지난 시험은 빼고, 날짜가 가까운 시험부터 (날짜 없는 시험은 그다음)
    const left = st.exams.filter((e) => { if (e.date && e.date < tk) return false; const p = Scope.examProgress(st.topics, e.id); return p.total && p.done < p.total; });
    const upcoming = left.filter((e) => e.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    return upcoming[0] || left.find((e) => e.id === st.activeExamId) || left[0] || null;
  }

  function topicPath(byId, n) {
    const names = [];
    let cur = n.parentId ? byId.get(n.parentId) : null;
    while (cur) { names.unshift(cur.title); cur = cur.parentId ? byId.get(cur.parentId) : null; }
    return names;
  }

  function renderHomeNext() {
    const st = store.get();
    const ex = nextExam();
    $('#h-next-panel').hidden = !ex;
    if (!ex) return;
    const t = now();
    const p = Scope.examProgress(st.topics, ex.id);
    const plan = Scope.timePlan(p, ex, t);
    const pc = plan ? null : Scope.pace(p.total - p.done, ex.date, t);
    const quotaDone = plan && !plan.finished && plan.days > 0 && plan.todayLeft === 0;
    const quota = plan && !plan.finished && !quotaDone ? plan.todayLeft : 0;
    const items = Scope.suggestToday(st.topics, ex.id, quota, quotaDone ? 2 : plan ? 6 : Math.max(2, Math.min(5, pc ? pc.perDay : 3)));
    const dd = Scope.ddayLabel(ex.date, t);
    $('#h-next-sub').textContent = `${ex.name}${dd ? ' ' + dd : ''}` + (plan ? (plan.finished ? '' : plan.todayLeft ? ` · 오늘 ${Stats.formatMinutes(plan.todayLeft)} 더` : ' · 오늘 몫 완료 ✓') : pc && pc.days > 0 ? ` · 하루 ${pc.perDay}개씩` : '');
    if (!items.length) {
      $('#h-next').innerHTML = '';
      $('#h-next-foot').innerHTML = `과목마다 공부할 내용을 적으면, 여기에서 오늘 할 범위를 골라 드려요. <a href="#board" data-open-exam="${esc(ex.id)}">공부할 내용 적기</a>`;
      return;
    }
    const byId = new Map(st.topics.map((n) => [n.id, n]));
    $('#h-next').innerHTML = items.map((it) => {
      const n = byId.get(it.id);
      const card = byId.get(it.cardId);
      const path = topicPath(byId, n);
      const pct = Scope.leafPct(n);
      return `<li class="next-item">
        <button class="bchk s-${pct > 0 ? 'some' : 'none'}" data-next-check="${esc(n.id)}" role="checkbox" aria-checked="${pct > 0 ? 'mixed' : 'false'}" aria-label="${esc(n.title)} 끝냄"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.8 3.8 7.4-8.2"/><path class="dash" d="M5.5 10h9"/></svg></button>
        <div class="next-body"><div class="next-title">${esc(n.title)}</div>
          <div class="next-meta"><i class="dot" style="background:${esc(card.color || '#888')}"></i>${esc(path.join(' · ') || card.title)}${it.left ? ` · ${pct > 0 ? `${pct}% · ` : ''}남은 ${Stats.formatMinutes(it.left)}` : ''}</div></div>
        <button class="icon-btn next-play" data-next-focus="${esc(n.id)}" aria-label="${esc(n.title)} 타이머 시작" title="이 범위로 타이머 시작">${ic('play')}</button>
      </li>`;
    }).join('');
    $('#h-next-foot').innerHTML = quotaDone ? '오늘 몫을 다 했어요 🎉 더 하고 싶다면 위 범위를 이어서 해 보세요.'
      : !plan ? `항목마다 ${ic('timer')} 걸리는 시간을 적으면, 오늘 할 양에 딱 맞춰 골라 드려요.`
      : '과목을 번갈아 가며, 오늘 할 양만큼 골랐어요.';
  }

  $('#h-next').addEventListener('click', (e) => {
    const chk = e.target.closest('[data-next-check]');
    if (chk) {
      const id = chk.dataset.nextCheck;
      const n = store.get().topics.find((x) => x.id === id);
      if (!n) return;
      const prev = { done: n.done, pct: n.pct, doneAt: n.doneAt };
      store.update((s) => { Scope.setDone(s.topics, id, true); }, { undoable: true });
      const ep = Scope.examProgress(store.get().topics, n.examId);
      const ex = store.get().exams.find((x) => x.id === n.examId);
      toast(ep.total && ep.done === ep.total ? `체크메이트! ${ex ? ex.name + ' ' : ''}범위를 모두 끝냈어요 ♛` : `'${n.title}' 끝! 폰이 한 칸 전진 ♟`,
        { action: '되돌리기', onAction: () => store.update((s) => { const x = s.topics.find((t) => t.id === id); if (x) Object.assign(x, prev); }) });
      return;
    }
    const play = e.target.closest('[data-next-focus]');
    if (play) {
      const st = store.get();
      const byId = new Map(st.topics.map((x) => [x.id, x]));
      const n = byId.get(play.dataset.nextFocus);
      if (!n) return;
      let card = n;
      while (card.parentId && byId.get(card.parentId)) card = byId.get(card.parentId);
      focusOn({ label: card.id === n.id ? n.title : `${card.title} · ${n.title}`, subjectName: card.title, topicId: n.id });
    }
  });

  // 처음 쓰는 사람을 위한 안내
  const WELCOME_KEY = 'studypromotion.welcomeClosed';
  function renderWelcome() {
    const st = store.get();
    let closed = false;
    try { closed = !!localStorage.getItem(WELCOME_KEY); } catch (e) { /* 무시 */ }
    $('#h-welcome').hidden = closed || !!(st.exams.length || st.sessions.length || st.tasks.length || st.cards.length);
  }
  $('#welcome-close').addEventListener('click', () => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* 무시 */ }
    $('#h-welcome').hidden = true;
  });

  /* ---------- 타이머 ---------- */
  const TIMER_KEY = 'studypromotion.timer';
  const timer = { mode: 'focus', running: false, endAt: 0, remaining: 0, total: 0, startedAt: 0, tick: null, subjectId: '', label: null, topicId: null };
  const CIRC = 2 * Math.PI * 88;
  $('#ring-fg').style.strokeDasharray = CIRC;

  // 앱을 닫았다 열어도 타이머가 이어지게 상태를 저장한다
  function saveTimer() {
    try {
      const { mode, running, endAt, remaining, total, startedAt, subjectId, label, topicId } = timer;
      localStorage.setItem(TIMER_KEY, JSON.stringify({ mode, running, endAt, remaining, total, startedAt, subjectId, label, topicId }));
    } catch (e) { /* 무시 */ }
  }

  function modeSeconds(mode) {
    const s = store.get().settings;
    return (mode === 'focus' ? s.focusMin : s.breakMin) * 60;
  }

  function setMode(mode) {
    stopTick();
    lenEditing = false;
    timer.mode = mode;
    timer.running = false;
    timer.total = timer.remaining = modeSeconds(mode);
    releaseAwake();
    saveTimer();
    renderTimer();
  }

  function stopTick() { clearInterval(timer.tick); timer.tick = null; }

  // 타이머가 도는 동안 화면이 꺼지지 않게 (꺼지면 끝나는 소리·알림이 늦어진다)
  let awake = null;
  async function keepAwake() {
    if (store.get().settings.keepAwake === false || !('wakeLock' in navigator) || awake) return;
    try { awake = await navigator.wakeLock.request('screen'); awake.addEventListener('release', () => { awake = null; }); } catch (e) { /* 지원 안 함 */ }
  }
  function releaseAwake() { try { if (awake) awake.release(); } catch (e) { /* 무시 */ } awake = null; }

  function startTimer() {
    if (timer.running) return;
    if (timer.mode === 'focus' && window.Stopwatch && window.Stopwatch.running()) {
      ask('스톱워치가 공부 시간을 재고 있어요.\n스톱워치를 멈추고 기록한 뒤 집중 타이머를 시작할까요?', { ok: '멈추고 시작' }).then(async (yes) => {
        if (!yes) return;
        await window.Stopwatch.stop();
        if (!window.Stopwatch.running()) startTimer();
      });
      return;
    }
    timer.running = true;
    timer.endAt = now() + timer.remaining * 1000;
    if (!timer.startedAt) timer.startedAt = now();
    stopTick();
    timer.tick = setInterval(onTick, 250);
    if (window.Notification && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch (e) { /* 무시 */ }
    }
    keepAwake();
    saveTimer();
    renderTimer();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, Math.round((timer.endAt - now()) / 1000));
    timer.running = false;
    stopTick();
    releaseAwake();
    saveTimer();
    renderTimer();
  }

  function onTick() {
    timer.remaining = Math.max(0, Math.ceil((timer.endAt - now()) / 1000));
    if (timer.remaining <= 0) return finishPhase(true, { at: timer.endAt });
    renderTimerFace();
  }

  // id: 끝까지 마친 집중은 끝나는 시각으로 정한 id를 써서, 탭 두 개가 같은 타이머를 끝내도 한 번만 기록
  function recordFocus(minutes, at, id) {
    if (minutes < 1) return;
    if (id && store.get().sessions.some((x) => x.id === id)) return;
    const sid = timer.subjectId && subjectById(timer.subjectId) ? timer.subjectId : null;
    store.update((st) => st.sessions.push({ id: id || uid(), subjectId: sid, minutes, endedAt: Math.min(now(), at || now()), label: timer.label || null, topicId: timer.topicId || null }));
  }

  // opts.at: 끝난 시각, opts.quiet: 앱이 닫혀 있는 동안 끝남(소리 없이)
  function finishPhase(completed, opts) {
    opts = opts || {};
    stopTick();
    timer.running = false;
    const topicId = timer.topicId, label = timer.label;
    if (timer.mode === 'focus') {
      const elapsedMin = completed ? timer.total / 60 : Math.floor((timer.total - timer.remaining) / 60);
      const at = completed ? opts.at || timer.endAt : now();
      recordFocus(Math.round(elapsedMin), at, completed ? 'focus-' + Math.round(at) : null);
      if (completed) {
        if (opts.quiet) toast(`앱이 닫혀 있는 동안 집중 ${Stats.formatMinutes(elapsedMin)}이 끝나서 기록했어요`);
        else { beep(); notify('집중 완료! 잠깐 쉬어요.'); toast(`${Stats.formatMinutes(elapsedMin)} 집중 기록 완료`); }
        if (topicId) setTimeout(() => askTopicDone(topicId, label), opts.quiet ? 1200 : 500);
      } else if (elapsedMin >= 1) toast(`${Stats.formatMinutes(elapsedMin)} 기록했어요`);
    } else if (completed && !opts.quiet) { beep(); notify('휴식 끝! 다시 집중해 볼까요?'); }
    timer.startedAt = 0;
    setMode(timer.mode === 'focus' ? 'break' : 'focus');
  }

  // 집중 타이머가 돌거나 멈춰 있는 중이면 'focus'/'break', 아니면 null (스톱워치와 동시에 재지 않게)
  function timerBusy() { return timer.running || timer.remaining < timer.total ? timer.mode : null; }
  function stopTimerForStopwatch() {
    const mode = timerBusy();
    if (!mode) return;
    if (timer.running) timer.remaining = Math.max(0, Math.ceil((timer.endAt - now()) / 1000));
    stopTick();
    timer.running = false;
    if (mode === 'focus') {
      const min = Math.floor((timer.total - timer.remaining) / 60);
      recordFocus(min, now());
      if (min >= 1) toast(`집중 타이머의 ${Stats.formatMinutes(min)}을 기록했어요`);
    }
    timer.startedAt = 0;
    setMode('focus');
  }

  // 범위에서 시작한 집중이 끝나면: 그 범위를 끝냈는지 물어보고 체크
  async function askTopicDone(topicId, label) {
    const st = store.get();
    const n = st.topics.find((t) => t.id === topicId);
    if (!n || Scope.progress(st.topics, topicId).state === 'all') return;
    if (!$('#ask').hidden) return;
    const yes = await ask(`'${label || n.title}' 공부를 끝냈나요?\n끝냈다면 범위에서 체크해 둘게요.`, { ok: '끝냈어요 ✓', cancel: '아직이에요' });
    if (!yes) return;
    store.update((s) => { Scope.setDone(s.topics, topicId, true); }, { undoable: true });
    const ex = store.get().exams.find((e) => e.id === n.examId);
    const ep = Scope.examProgress(store.get().topics, n.examId);
    toast(ep.total && ep.done === ep.total ? `체크메이트! ${ex ? ex.name + ' ' : ''}범위를 모두 끝냈어요 ♛` : '범위에서 체크했어요. 폰이 한 칸 전진! ♟');
  }

  const readTimer = (raw) => { try { const s = JSON.parse(raw); return s && (s.mode === 'focus' || s.mode === 'break') ? s : null; } catch (e) { return null; } };

  // 저장된 타이머 상태를 이 화면에 적용한다. opened: 앱을 막 열었을 때(닫혀 있는 동안 끝났으면 기록)
  function applyTimerState(s, opened) {
    stopTick();
    timer.subjectId = s.subjectId || '';
    timer.label = s.label || null;
    timer.topicId = s.topicId || null;
    timer.mode = s.mode;
    timer.total = s.total > 0 ? s.total : modeSeconds(s.mode);
    timer.startedAt = s.startedAt || 0;
    if (s.running && s.endAt) {
      if (s.endAt > now() || !opened) {
        timer.endAt = s.endAt;
        timer.running = true;
        timer.remaining = Math.max(0, Math.ceil((s.endAt - now()) / 1000));
        timer.tick = setInterval(onTick, 250);
        keepAwake();
        renderTimer();
        return;
      }
      // 앱이 닫혀 있는 동안 끝남: 다른 스크립트(동기화 등)가 다 준비된 뒤 기록
      timer.running = false;
      timer.remaining = 0;
      renderTimer();
      const done = () => { if (!timer.running && timer.remaining === 0 && timer.mode === s.mode) finishPhase(true, { at: s.endAt, quiet: true }); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', done, { once: true });
      else setTimeout(done, 0);
      return;
    }
    timer.running = false;
    releaseAwake();
    if (!(s.remaining > 0 && s.remaining < timer.total)) { timer.total = modeSeconds(s.mode); timer.remaining = timer.total; } // 일시정지가 아니면 처음부터
    else timer.remaining = s.remaining;
    renderTimer();
  }

  // 저장해 둔 타이머 이어 가기 (없으면 false)
  function restoreTimer() {
    let s = null;
    try { s = readTimer(localStorage.getItem(TIMER_KEY)); } catch (e) { s = null; }
    if (!s) return false;
    applyTimerState(s, true);
    return true;
  }

  // 다른 탭(창)에서 타이머를 시작·멈추면 이 탭도 맞춘다 (두 탭이 따로 기록하지 않게)
  window.addEventListener('storage', (e) => {
    if (e.key !== TIMER_KEY || !e.newValue) return;
    const s = readTimer(e.newValue);
    if (s) applyTimerState(s, false);
  });

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
    try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch (e) { /* 무시 */ }
  }

  function notify(msg) {
    try {
      if (!window.Notification || Notification.permission !== 'granted') return;
      // 설치한 앱(서비스 워커)에서는 서비스 워커로 띄워야 휴대폰에서도 보인다
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((r) => r.showNotification('스터디 프로모션', { body: msg, icon: 'icons/icon-192.png', badge: 'icons/favicon-64.png', tag: 'timer', renotify: true })).catch(() => { /* 무시 */ });
      } else new Notification('스터디 프로모션', { body: msg });
    } catch (e) { /* 무시 */ }
  }

  function fmtClock(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function renderTimerFace() {
    $('#timer-time').textContent = fmtClock(timer.remaining);
    const frac = timer.total ? timer.remaining / timer.total : 1;
    $('#ring-fg').style.strokeDashoffset = CIRC * (1 - frac);
    if (timer.running) document.title = `${fmtClock(timer.remaining)} · ${timer.mode === 'focus' ? '집중' : '휴식'}`;
    else if (!(window.Stopwatch && window.Stopwatch.running())) document.title = '스터디 프로모션';
  }

  // 시작 전에는 집중·휴식 시간을 바로 고를 수 있게 (설정의 집중·휴식 시간과 같은 값). ‘직접’을 누르면 분을 적는 칸
  const LEN_MAX = { focus: 180, break: 60 };
  let lenEditing = false, lenDrawn = '';
  function renderLenChips() {
    const box = $('#len-chips');
    const fresh = !timer.running && timer.remaining === timer.total;
    if (!fresh) lenEditing = false;
    const cur = store.get().settings[timer.mode === 'focus' ? 'focusMin' : 'breakMin'];
    box.classList.toggle('off', !fresh);
    const sig = [timer.mode, cur, fresh, lenEditing].join('|');
    if (sig === lenDrawn && box.firstChild) return; // 적는 중인 칸이 다시 그려져 지워지지 않게
    lenDrawn = sig;
    const ti = fresh ? '' : ' tabindex="-1"';
    const opts = (timer.mode === 'focus' ? [25, 50, 90] : [5, 10, 15]).filter((m) => m !== cur).concat(cur).sort((a, b) => a - b);
    const what = timer.mode === 'focus' ? '집중' : '휴식';
    box.innerHTML = opts.map((m) => `<button type="button" class="chip${m === cur ? ' active' : ''}" data-len="${m}" aria-pressed="${m === cur}"${ti}>${m}분</button>`).join('')
      + (lenEditing
        ? `<form class="len-custom" id="len-form" novalidate><input type="number" id="len-input" inputmode="numeric" min="1" max="${LEN_MAX[timer.mode]}" step="1" value="${cur}" aria-label="${what} 시간(분), 1~${LEN_MAX[timer.mode]}"><span aria-hidden="true">분</span><button type="submit">확인</button></form>`
        : `<button type="button" class="chip len-edit" data-len-edit aria-label="${what} 시간 직접 정하기"${ti}>직접</button>`);
    if (lenEditing) { const inp = $('#len-input'); inp.focus({ preventScroll: true }); inp.select(); }
  }
  // 분을 정해 타이머에 바로 반영 (1분 미만·숫자가 아니면 false)
  function setLen(v) {
    const max = LEN_MAX[timer.mode];
    let m = Math.round(Number(v));
    if (!(m >= 1)) return false;
    if (m > max) { m = max; toast(`${timer.mode === 'focus' ? '집중' : '휴식'} 시간은 ${max}분까지 정할 수 있어요`); }
    lenEditing = false;
    store.update((st) => { st.settings[timer.mode === 'focus' ? 'focusMin' : 'breakMin'] = m; });
    timer.startedAt = 0;
    setMode(timer.mode);
    return true;
  }
  function closeLenEdit(focusChip) {
    if (!lenEditing) return;
    lenEditing = false;
    renderLenChips();
    if (focusChip) { const b = $('#len-chips [data-len-edit]'); if (b) b.focus(); }
  }
  // 적는 칸이 열려 있으면 적어 둔 분을 반영하고 닫는다 (숫자를 바꿨을 때만)
  function commitLenEdit() {
    if (!lenEditing) return;
    const inp = $('#len-input');
    const v = inp ? Math.round(Number(inp.value)) : NaN;
    if (v >= 1 && v !== store.get().settings[timer.mode === 'focus' ? 'focusMin' : 'breakMin']) setLen(v);
    else closeLenEdit(false);
  }

  // 하단 타이머 탭의 점: 집중·휴식 타이머나 스톱워치가 도는 중이면 (다른 화면에 있어도 알 수 있게)
  function timerDot() {
    const t = $('.tab[data-view="timer"]');
    if (!t) return;
    const sw = !!(window.Stopwatch && window.Stopwatch.running());
    const on = timer.running || sw;
    t.classList.toggle('timing', on);
    if (on) t.setAttribute('aria-label', sw ? '타이머 (스톱워치 재는 중)' : `타이머 (${timer.mode === 'focus' ? '집중' : '휴식'} 타이머 도는 중)`);
    else t.removeAttribute('aria-label');
  }

  function renderTimer() {
    timerDot();
    $('.timer-panel').classList.toggle('break', timer.mode === 'break');
    $$('.mode-switch [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === timer.mode));
    $('#timer-mode').textContent = timer.mode === 'focus' ? '집중' : '휴식';
    $('#timer-start').textContent = timer.running ? '일시정지' : (timer.remaining < timer.total ? '계속' : '시작');
    renderLenChips();
    if (timer.subjectId && !subjectById(timer.subjectId)) timer.subjectId = '';
    $('#timer-subject').innerHTML = subjectOptions(timer.subjectId, true);
    $('#timer-topic').hidden = !timer.label;
    $('#timer-topic-text').textContent = timer.label ? '공부 중: ' + timer.label : '';
    const st = store.get();
    const todays = st.sessions.filter((s) => Stats.dayKey(s.endedAt) === todayKey());
    // 직접 기록·스톱워치로 잰 시간은 공부 시간에는 넣고, 집중 횟수에는 넣지 않는다. 스톱워치가 재는 중인 시간도 홈과 같게 더한다
    const live = window.Stopwatch ? window.Stopwatch.todayMinutes() : 0;
    $('#timer-today').textContent = `오늘 공부 ${Stats.formatMinutes(todays.reduce((a, s) => a + s.minutes, 0) + live)} · 집중 ${todays.filter((s) => !s.manual && s.kind !== 'stopwatch').length}회`;
    renderTimerFace();
  }

  $('#timer-start').addEventListener('click', () => {
    if (timer.running) return pauseTimer();
    commitLenEdit(); // 분을 적다가 바로 ‘시작’을 눌러도 적은 시간으로
    startTimer();
  });
  // 초기화: 1분 넘게 집중했으면 그 시간을 버리기 전에 기록할지 물어본다
  const focusedMin = () => Math.floor((timer.total - (timer.running ? Math.max(0, Math.ceil((timer.endAt - now()) / 1000)) : timer.remaining)) / 60);
  $('#timer-reset').addEventListener('click', async () => {
    if (timer.mode === 'focus' && timerBusy() && focusedMin() >= 1) {
      const pick = await ask(`지금까지 집중한 ${Stats.formatMinutes(focusedMin())}을 기록할까요?`, { ok: '기록하고 초기화', alt: '기록 없이 초기화', cancel: '계속하기' });
      if (!pick) return;
      if (timer.mode !== 'focus' || !timerBusy()) return; // 묻는 동안 타이머가 끝나서 이미 기록됨
      const min = focusedMin();
      if (pick === true && min >= 1) { recordFocus(min, now()); toast(`${Stats.formatMinutes(min)} 기록했어요`); }
    }
    timer.startedAt = 0;
    setMode(timer.mode);
  });
  $('#timer-skip').addEventListener('click', () => finishPhase(false));
  $('#timer-subject').addEventListener('change', (e) => { timer.subjectId = e.target.value; saveTimer(); });
  $('#len-chips').addEventListener('click', (e) => {
    if (timer.running || timer.remaining !== timer.total) return;
    if (e.target.closest('[data-len-edit]')) { lenEditing = true; renderLenChips(); return; }
    const b = e.target.closest('[data-len]');
    if (b) setLen(b.dataset.len);
  });
  $('#len-chips').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!setLen($('#len-input').value)) { toast('1분 이상으로 적어 주세요'); $('#len-input').focus(); }
  });
  $('#len-chips').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lenEditing) { e.stopPropagation(); closeLenEdit(true); }
  });
  // 칸 밖을 누르면: 숫자를 바꿨으면 그 시간으로, 아니면 그냥 닫기
  $('#len-chips').addEventListener('focusout', () => {
    if (!lenEditing) return;
    setTimeout(() => {
      if (!lenEditing || $('#len-chips').contains(document.activeElement)) return;
      commitLenEdit();
    }, 200); // 다른 칩을 누른 거면 그 클릭이 먼저 처리되게 조금 기다림
  });
  // 집중/휴식 전환 (로그인 버튼 같은 다른 data-mode 버튼은 건드리지 않게 범위를 좁힘)
  $$('.mode-switch [data-mode]').forEach((b) => b.addEventListener('click', async () => {
    const to = b.dataset.mode;
    if (to === timer.mode) return; // 지금 모드를 다시 눌러도 하던 타이머가 처음으로 돌아가지 않게
    if (timer.running && !(await ask('진행 중인 타이머를 멈추고 바꿀까요?', { ok: '멈추고 바꾸기' }))) return;
    // 집중하다가 휴식으로 바꾸면 그때까지 한 시간은 ‘건너뛰기’처럼 기록한다 (말없이 사라지지 않게)
    if (timer.mode === 'focus' && timerBusy()) {
      if (timer.running) timer.remaining = Math.max(0, Math.ceil((timer.endAt - now()) / 1000));
      const min = Math.floor((timer.total - timer.remaining) / 60);
      if (min >= 1) { recordFocus(min, now()); toast(`${Stats.formatMinutes(min)} 기록했어요`); }
    }
    timer.startedAt = 0;
    setMode(to);
  }));
  // 다른 앱에 갔다 오면 바로 남은 시간을 맞추고, 화면 켜 두기를 다시 건다
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !timer.running) return;
    onTick();
    if (timer.running) keepAwake();
  });

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
    // 고치는 중인 카드는 다시 그려도 입력한 글자와 커서를 유지
    const form = $('#card-list .card-edit');
    const draft = form && form.dataset.cardEdit === editingCardId ? { front: form.front.value, back: form.back.value, focus: document.activeElement && form.contains(document.activeElement) ? document.activeElement.name : null } : null;
    if (editingCardId && !cards.some((c) => c.id === editingCardId)) editingCardId = null;
    $('#card-list').innerHTML = cards.map((c) => {
      if (c.id === editingCardId) {
        const f = draft ? draft.front : c.front, b = draft ? draft.back : c.back;
        return `<li class="card-row editing" data-card="${esc(c.id)}"><form class="card-edit" data-card-edit="${esc(c.id)}">
          <input name="front" value="${esc(f)}" required maxlength="300" aria-label="앞면 (질문)" autocomplete="off">
          <input name="back" value="${esc(b)}" required maxlength="500" aria-label="뒷면 (정답)" autocomplete="off">
          <span class="card-edit-actions"><button class="btn sm" type="button" data-card-cancel>취소</button><button class="btn primary sm" type="submit">저장</button></span></form></li>`;
      }
      const next = SRS.isDue(c, t) ? '복습 대기' : `${Stats.dateKey(c.due).slice(5).replace('-', '/')} 복습`;
      return `<li class="card-row" data-card="${esc(c.id)}"><span>${esc(c.front)}</span><span class="muted-text">${esc(c.back)}</span><span class="muted">${next}</span><button class="icon-btn card-edit-btn" aria-label="카드 고치기" title="고치기">${ic('edit')}</button><button class="icon-btn card-del" aria-label="카드 삭제" title="삭제">${ic('x')}</button></li>`;
    }).join('') || '<li class="empty">카드를 추가해 보세요.</li>';
    if (draft && draft.focus) { const el = $('#card-list .card-edit [name="' + draft.focus + '"]'); if (el) el.focus(); }
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

  $('#deck-back').addEventListener('click', () => { openDeckId = null; editingCardId = null; showReviewPane('home'); renderDecks(); });
  $('#deck-delete').addEventListener('click', async () => {
    const d = store.get().decks.find((x) => x.id === openDeckId);
    if (!d || !(await ask(`'${d.name}' 덱과 카드 ${deckCards(d.id).length}장을 삭제할까요?`, { ok: '삭제', danger: true }))) return;
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

  let editingCardId = null;
  $('#card-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-card]');
    if (!row) return;
    const id = row.dataset.card;
    if (e.target.closest('.card-del')) {
      if (editingCardId === id) editingCardId = null;
      const list = store.get().cards;
      const i = list.findIndex((c) => c.id === id);
      if (i < 0) return;
      const removed = list[i];
      store.update((st) => { st.cards = st.cards.filter((c) => c.id !== id); });
      toast(`카드 '${removed.front}' 지웠어요`, { action: '되돌리기', onAction: () => store.update((st) => { if (!st.cards.some((c) => c.id === id)) st.cards.splice(Math.min(i, st.cards.length), 0, removed); }) });
    } else if (e.target.closest('.card-edit-btn')) {
      editingCardId = id;
      renderDeckDetail();
      const input = $('#card-list .card-edit [name="front"]');
      if (input) { input.focus(); input.select(); }
    } else if (e.target.closest('[data-card-cancel]')) {
      editingCardId = null;
      renderDeckDetail();
    }
  });
  $('#card-list').addEventListener('submit', (e) => {
    const f = e.target.closest('.card-edit');
    if (!f) return;
    e.preventDefault();
    const front = f.front.value.trim(), back = f.back.value.trim();
    if (!front || !back) return toast('앞면과 뒷면을 모두 적어 주세요');
    const id = f.dataset.cardEdit;
    editingCardId = null;
    store.update((st) => { const c = st.cards.find((x) => x.id === id); if (c) { c.front = front; c.back = back; } });
    toast('카드를 고쳤어요');
  });
  $('#card-list').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.closest('.card-edit')) { editingCardId = null; renderDeckDetail(); }
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
    if (currentView !== 'timer' || e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button, [contenteditable]')) return;
    if (!$('#ask').hidden || !$('#log-dlg').hidden || (window.Lock && window.Lock.state)) return;
    e.preventDefault();
    if (window.Stopwatch && window.Stopwatch.tab() === 'sw') window.Stopwatch.toggle();
    else if (timer.running) pauseTimer(); else startTimer();
  });

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

    const months = Stats.lastNMonths(st.sessions, now(), 6);
    const cur = months[5], prev = months[4];
    $('#month-total').textContent = Stats.formatMinutes(cur.minutes);
    const daysInMonthSoFar = new Date(dayNow()).getDate();
    $('#month-sub').textContent = `${cur.month}월 합계 · 공부한 날 ${cur.days}일 / ${daysInMonthSoFar}일` + (cur.days ? ` · 공부한 날 평균 ${Stats.formatMinutes(cur.minutes / cur.days)}` : '');
    const diff = cur.minutes - prev.minutes;
    $('#month-compare').textContent = prev.minutes || cur.minutes
      ? `지난달(${prev.month}월) ${Stats.formatMinutes(prev.minutes)} · ${diff >= 0 ? '▲ ' : '▼ '}${Stats.formatMinutes(Math.abs(diff))}`
      : '';
    const goalMin = st.settings.monthlyGoalMin || 0;
    const todayMin = Stats.minutesOn(st.sessions, now());
    const g = Stats.monthGoal(goalMin, cur.minutes, now(), todayMin);
    $('#mg-label').textContent = goalMin ? `${cur.month}월 목표 ${Stats.formatMinutes(goalMin)}` : '이번 달 목표';
    $('#mg-edit').textContent = goalMin ? '목표 바꾸기' : '목표 설정';
    $('.mg-track').hidden = !g;
    $('#mg-fill').style.width = g ? g.pct + '%' : '0';
    $('#mg-fill').classList.toggle('behind', !!g && !g.onTrack && !g.done);
    $('#mg-text').textContent = !g ? '한 달 동안 공부할 목표 시간을 정해 보세요.'
      : g.done ? `🎉 목표 달성! (${g.pct}%)`
      : `${g.pct}% 달성 · 남은 ${Stats.formatMinutes(g.remaining)}` +
        (g.onTrack ? ' · 계획보다 앞서 있어요 👍' : ` · 계획보다 ${Stats.formatMinutes(-g.paceMin)} 뒤처졌어요`);
    $('#mg-pace').hidden = !g || g.done;
    if (g && !g.done) {
      $('#mg-today').textContent = g.todayLeft ? Stats.formatMinutes(g.todayLeft) : '완료 ✓';
      $('#mg-today-sub').textContent = `${Stats.formatMinutes(Math.min(todayMin, g.todayQuota))} 함`;
      $('#mg-need').textContent = Stats.formatMinutes(g.todayQuota);
      $('#mg-need-sub').textContent = `남은 ${g.daysLeft}일 기준`;
      $('#mg-base').textContent = Stats.formatMinutes(g.basePerDay);
      $('#mg-base-sub').textContent = `목표÷${new Date(new Date(dayNow()).getFullYear(), new Date(dayNow()).getMonth() + 1, 0).getDate()}일`;
    }
    const mMax = Math.max(60, goalMin, ...months.map((m) => m.minutes));
    $('#month-chart').innerHTML = months.map((m, i) => `<div class="wc-col${i === 5 ? ' today' : ''}">
      <div class="wc-val">${m.minutes ? (m.minutes < 60 ? m.minutes + '분' : (Math.round(m.minutes / 6) / 10) + '시간') : ''}</div>
      <div class="wc-bar${m.minutes ? '' : ' zero'}" style="height:${Math.round((m.minutes / mMax) * 100)}px" title="${m.key} ${Stats.formatMinutes(m.minutes)}"></div>
      <div class="wc-label">${m.label}</div></div>`).join('');

    renderCalendar();
    // 과목별 공부 시간: 최근 7일 / 이번 달 / 전체
    const d0 = new Date(dayNow()); d0.setHours(0, 0, 0, 0);
    const since = (subjPeriod === 'week' ? Stats.addDays(d0.getTime(), -6) : subjPeriod === 'month' ? new Date(d0.getFullYear(), d0.getMonth(), 1).getTime() : 0) + (subjPeriod === 'all' ? 0 : Stats.dayOffset());
    $$('#subj-period [data-period]').forEach((b) => { const on = b.dataset.period === subjPeriod; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    const by = Stats.minutesBySubject(st.sessions.filter((x) => x.endedAt >= since));
    const rows = Object.keys(by).map((k) => {
      const s = subjectById(k);
      return { name: s ? s.name : '과목 없음', color: s ? s.color : 'var(--muted)', minutes: by[k] };
    }).sort((a, b) => b.minutes - a.minutes);
    const top = rows.length ? rows[0].minutes : 1;
    $('#subject-bars').innerHTML = rows.length ? rows.map((r) => `<div class="sb-row"><span>${esc(r.name)}</span>
      <div class="sb-track"><div class="sb-fill" style="width:${(r.minutes / top) * 100}%;background:${esc(r.color)}"></div></div>
      <span class="sb-val">${Stats.formatMinutes(r.minutes)}</span></div>`).join('') : `<p class="muted">${subjPeriod === 'all' ? '타이머로 집중하면 여기에 쌓여요.' : subjPeriod === 'week' ? '최근 7일 동안의 기록이 없어요.' : '이번 달 기록이 아직 없어요.'}</p>`;

    const sorted = st.sessions.slice().sort((a, b) => b.endedAt - a.endedAt);
    const recent = sorted.slice(0, sessionLimit);
    const more = sorted.length - recent.length;
    $('#session-list').innerHTML = recent.length ? recent.map((s) => {
      const sub = subjectById(s.subjectId);
      const d = new Date(s.endedAt);
      let label = s.manual && s.label === '직접 기록' ? '' : s.label;
      // 범위에서 시작한 기록은 이름이 ‘과목 · 항목’이라, 앞에 적힌 과목 이름과 겹치지 않게 뒤쪽만 보여 준다
      if (label && sub && label.startsWith(sub.name + ' · ')) label = label.slice(sub.name.length + 3);
      return `<li><span class="sl-what">${sub ? `<i class="dot" style="background:${esc(sub.color)}"></i>${esc(sub.name)}` : '과목 없음'}${s.manual ? ' <span class="sl-tag">직접</span>' : s.kind === 'stopwatch' ? ' <span class="sl-tag">스톱워치</span>' : ''}${label ? ` <span class="muted">· ${esc(label)}</span>` : ''}</span>
        <span class="muted sl-when">${d.getMonth() + 1}/${d.getDate()}${s.manual ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`} · ${Stats.formatMinutes(s.minutes)}</span>
        <button class="icon-btn" data-del-session="${esc(s.id)}" aria-label="이 기록 삭제" title="기록 삭제">${ic('x')}</button></li>`;
    }).join('') + (more > 0 ? `<li class="sl-more"><button class="btn link" type="button" data-more-sessions>이전 기록 더 보기 (${more}개)</button></li>` : '')
      : '<li class="empty">아직 기록이 없어요. 타이머로 집중하거나 <button class="btn link inline" type="button" data-log-open>직접 기록</button>해 보세요.</li>';
  }
  let sessionLimit = 10;

  let subjPeriod = 'month';
  $('#subj-period').addEventListener('click', (e) => {
    const b = e.target.closest('[data-period]');
    if (!b) return;
    subjPeriod = b.dataset.period;
    renderStats();
  });

  /* 공부 달력: 날마다 공부한 만큼 진하게, 날짜를 누르면 그날 과목별 시간 */
  let calYM = null; // [연, 월(0~11)] — null이면 이번 달
  let calPick = null; // 고른 날 'YYYY-MM-DD'
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function renderCalendar() {
    const st = store.get();
    const t = new Date(dayNow());
    const [y, m] = calYM || [t.getFullYear(), t.getMonth()];
    const cal = Stats.monthCalendar(st.sessions, y, m);
    const tk = todayKey();
    $('#cal-title').textContent = `${y}년 ${m + 1}월`;
    $('#cal-next').disabled = y > t.getFullYear() || (y === t.getFullYear() && m >= t.getMonth());
    $('#cal-grid').innerHTML = '<span class="cal-cell blank"></span>'.repeat(cal.lead) + cal.days.map((d) => {
      const future = d.key > tk;
      return `<button type="button" class="cal-cell lv${d.level}${d.key === tk ? ' today' : ''}${future ? ' future' : ''}${d.key === calPick ? ' picked' : ''}" data-cal="${d.key}" aria-label="${m + 1}월 ${d.day}일 ${d.minutes ? Stats.formatMinutes(d.minutes) : '기록 없음'}"${future ? ' disabled' : ''}><i aria-hidden="true"></i><b>${d.day}</b></button>`;
    }).join('');
    $('#cal-sum').textContent = cal.studied ? `공부한 날 ${cal.studied}일 · 최고 ${Stats.formatMinutes(cal.best)}` : '이달에는 기록이 없어요';
    const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
    const key = calPick && calPick.startsWith(ym) ? calPick : (y === t.getFullYear() && m === t.getMonth() ? tk : null);
    const det = $('#cal-detail');
    if (!key) { det.textContent = '날짜를 누르면 그날 공부한 과목을 볼 수 있어요.'; det.classList.add('muted'); return; }
    det.classList.remove('muted');
    const list = st.sessions.filter((x) => Stats.dayKey(x.endedAt) === key);
    const sum = list.reduce((a, x) => a + x.minutes, 0);
    const bySub = Stats.minutesBySubject(list);
    const dd = new Date(key + 'T12:00');
    const parts = Object.keys(bySub).sort((a, b) => bySub[b] - bySub[a]).map((k) => { const sb = subjectById(k); return `<i class="dot" style="background:${esc(sb ? sb.color : 'var(--muted)')}"></i>${esc(sb ? sb.name : '과목 없음')} ${Stats.formatMinutes(bySub[k])}`; });
    det.innerHTML = `<p class="cal-day"><b>${dd.getMonth() + 1}월 ${dd.getDate()}일 (${WEEK[dd.getDay()]})${key === tk ? ' · 오늘' : ''}</b> ` +
      (sum ? `${Stats.formatMinutes(sum)}<span class="muted"> · ${parts.join(', ')}</span>` : '<span class="muted">공부 기록이 없어요</span>') + '</p>' +
      timetableHTML(st.sessions, key);
  }

  // 하루 시간표: 한 줄이 한 시간, 한 칸이 10분 (스터디 플래너처럼). 과목 색으로 칠한다
  function hhmm(t, key) {
    const d = new Date(t);
    // 자정에 끝난 기록은 '24:00'으로. 하루 시작 시각을 새벽으로 옮겼으면 그 시각 그대로(예: 4:00)
    return (Stats.dayKey(t) === key || Stats.dayOffset() ? d.getHours() : 24) + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function timetableHTML(sessions, key) {
    const tl = Stats.dayTimeline(sessions, key);
    const fm = Stats.formatMinutes;
    const share = `<button type="button" class="btn link tt-share" data-share-day="${key}">인증 이미지</button>`;
    if (!tl.hours.length) return tl.untimed ? `<div class="tt-foot"><span class="muted small">직접 기록한 ${fm(tl.untimed)}은 공부한 시각이 없어 시간표에는 안 나와요.</span>${share}</div>` : '';
    const color = (sid) => { const sb = sid && subjectById(sid); return sb ? sb.color : 'var(--muted)'; };
    const from = hhmm(tl.start, key), to = hhmm(tl.end, key);
    const rows = tl.hours.map((h) => `<div class="tt-row"><span class="tt-h">${h.hour}</span><div class="tt-bar">${h.segs.map((g) =>
      `<i style="left:${((g.from / 60) * 100).toFixed(2)}%;width:${(((g.to - g.from) / 60) * 100).toFixed(2)}%;background:${esc(color(g.subjectId))}"></i>`).join('')}</div></div>`).join('');
    return `<div class="tt" id="cal-tt" role="img" aria-label="공부 시간표: ${from}부터 ${to}까지, 공부 ${fm(tl.timed)}">` +
      `<div class="tt-row tt-head" aria-hidden="true"><span class="tt-h"></span><div class="tt-ticks"><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span></div></div>${rows}</div>` +
      `<div class="tt-foot"><span class="muted small">${from} ~ ${to}${tl.untimed ? ` · 직접 기록 ${fm(tl.untimed)}은 시간표 밖` : ''}</span>${share}</div>`;
  }

  /* ---------- 공부 인증 이미지 (인스타 스토리 크기) ---------- */
  function shareData(key) {
    const st = store.get();
    const list = st.sessions.filter((x) => Stats.dayKey(x.endedAt) === key);
    const total = list.reduce((a, x) => a + x.minutes, 0);
    const by = Stats.minutesBySubject(list);
    const colorOf = (sid) => { const sb = sid && subjectById(sid); return sb && /^#[0-9a-f]{3,8}$/i.test(sb.color || '') ? sb.color : '#8f8f8f'; };
    const subjects = Object.keys(by).sort((a, b) => by[b] - by[a]).map((k) => { const sb = subjectById(k); return { name: sb ? sb.name : '과목 없음', color: colorOf(k), minutes: by[k] }; });
    const tl = Stats.dayTimeline(st.sessions, key);
    const dd = new Date(key + 'T12:00');
    const goal = +st.settings.dailyGoalMin || 0;
    const isToday = key === todayKey();
    const ex = isToday ? nextExam() : null;
    const dday = ex && ex.date ? Scope.ddayLabel(ex.date, now()) : '';
    const track = goal ? Scope.pawnRank(Math.min(100, (total / goal) * 100)) : ex ? Scope.pawnRank(Scope.examProgress(st.topics, ex.id).pct) : Scope.pawnRank(0);
    return {
      title: isToday ? '오늘의 공부' : `${dd.getMonth() + 1}월 ${dd.getDate()}일의 공부`,
      date: `${dd.getFullYear()}. ${dd.getMonth() + 1}. ${dd.getDate()}. (${WEEK[dd.getDay()]})`,
      total, goal, subjects, timeline: tl, colorOf, track,
      range: tl.hours.length ? `${hhmm(tl.start, key)} ~ ${hhmm(tl.end, key)}` : '',
      exam: dday ? { name: ex.name, dday } : null,
    };
  }
  let shareURL = null, shareFile = null, shareReturn = null, shareSeq = 0;
  async function openShare(key) {
    if (!window.StudyCard) return;
    const seq = ++shareSeq;
    const dlg = $('#share-dlg'), img = $('#share-img'), save = $('#share-save');
    if (dlg.hidden) shareReturn = document.activeElement;
    img.hidden = true;
    $('#share-wait').hidden = false;
    $('#share-send').hidden = true;
    save.removeAttribute('href');
    save.classList.add('disabled');
    dlg.hidden = false;
    $('#share-close').focus();
    let blob = null;
    try {
      const canvas = await StudyCard.render(shareData(key));
      blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    } catch (e) { blob = null; }
    if (seq !== shareSeq || dlg.hidden) return;
    if (!blob) { closeShare(); toast('이미지를 만들지 못했어요'); return; }
    if (shareURL) URL.revokeObjectURL(shareURL);
    shareURL = URL.createObjectURL(blob);
    const name = `studypromotion-${key}.png`;
    try { shareFile = new File([blob], name, { type: 'image/png' }); } catch (e) { shareFile = null; }
    img.src = shareURL;
    img.hidden = false;
    $('#share-wait').hidden = true;
    save.href = shareURL;
    save.download = name;
    save.classList.remove('disabled');
    let can = false;
    try { can = !!(shareFile && navigator.canShare && navigator.canShare({ files: [shareFile] })); } catch (e) { can = false; }
    $('#share-send').hidden = !can;
  }
  function closeShare() {
    shareSeq++;
    $('#share-dlg').hidden = true;
    if (shareReturn && document.contains(shareReturn)) { try { shareReturn.focus(); } catch (e) { /* 무시 */ } }
    shareReturn = null;
  }
  $('#cal-detail').addEventListener('click', (e) => { const b = e.target.closest('[data-share-day]'); if (b) openShare(b.dataset.shareDay); });
  $('#share-close').addEventListener('click', closeShare);
  $('#share-dlg').addEventListener('click', (e) => { if (e.target.id === 'share-dlg') closeShare(); });
  $('#share-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShare(); });
  $('#share-send').addEventListener('click', async () => {
    if (!shareFile) return;
    try { await navigator.share({ files: [shareFile], title: '스터디 프로모션 · 공부 인증' }); } catch (e) { /* 취소하면 그대로 */ }
  });
  function shiftCalendar(delta) {
    const t = new Date(dayNow());
    const [y, m] = calYM || [t.getFullYear(), t.getMonth()];
    const d = new Date(y, m + delta, 1);
    calYM = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() ? null : [d.getFullYear(), d.getMonth()];
    renderCalendar();
  }
  $('#cal-prev').addEventListener('click', () => shiftCalendar(-1));
  $('#cal-next').addEventListener('click', () => shiftCalendar(1));
  $('#cal-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cal]');
    if (!b || b.disabled) return;
    calPick = b.dataset.cal;
    renderCalendar();
  });

  $('#session-list').addEventListener('click', async (e) => {
    if (e.target.closest('[data-more-sessions]')) { sessionLimit += 30; renderStats(); return; }
    const b = e.target.closest('[data-del-session]');
    if (!b) return;
    const id = b.dataset.delSession;
    const s = store.get().sessions.find((x) => x.id === id);
    if (!s) return;
    const d = new Date(s.endedAt);
    store.update((st) => { st.sessions = st.sessions.filter((x) => x.id !== id); });
    toast(`${d.getMonth() + 1}/${d.getDate()} ${Stats.formatMinutes(s.minutes)} 기록을 지웠어요`, { action: '되돌리기', onAction: () => store.update((st) => { if (!st.sessions.some((x) => x.id === id)) st.sessions.push(s); }) });
  });

  /* ---------- 공부 시간 직접 기록 (학원·독서실·인강 등) ---------- */
  let logReturnFocus = null;
  function openLog() {
    logReturnFocus = document.activeElement;
    const sid = timer.subjectId && subjectById(timer.subjectId) ? timer.subjectId : '';
    $('#log-subject').innerHTML = subjectOptions(sid, true);
    $('#log-h').value = '';
    $('#log-m').value = '';
    $('#log-date').value = todayKey();
    $('#log-date').max = todayKey();
    $('#log-label').value = '';
    $$('#log-quick [data-min]').forEach((x) => x.classList.remove('active'));
    $('#log-dlg').hidden = false;
    $('#log-h').focus();
  }
  function closeLog() {
    $('#log-dlg').hidden = true;
    try { if (logReturnFocus && logReturnFocus.focus) logReturnFocus.focus(); } catch (e) { /* 무시 */ }
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-log-open]')) { e.preventDefault(); openLog(); } });
  $('#log-cancel').addEventListener('click', closeLog);
  $('#log-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLog(); });
  $('#log-dlg').addEventListener('click', (e) => { if (e.target === $('#log-dlg')) closeLog(); });
  $('#log-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (!b) return;
    const m = +b.dataset.min;
    $('#log-h').value = Math.floor(m / 60) || '';
    $('#log-m').value = m % 60 || '';
    $$('#log-quick [data-min]').forEach((x) => x.classList.toggle('active', x === b));
  });
  ['#log-h', '#log-m'].forEach((sel) => $(sel).addEventListener('input', () => $$('#log-quick [data-min]').forEach((x) => x.classList.remove('active'))));
  $('#log-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const h = Math.max(0, parseInt($('#log-h').value, 10) || 0);
    const m = Math.max(0, parseInt($('#log-m').value, 10) || 0);
    const minutes = Math.min(24 * 60, h * 60 + m);
    if (minutes < 1) { toast('공부한 시간을 적어 주세요'); $('#log-h').focus(); return; }
    const tk = todayKey();
    const day = /^\d{4}-\d{2}-\d{2}$/.test($('#log-date').value) ? $('#log-date').value : tk;
    if (day > tk) { toast('오늘 이후 날짜는 기록할 수 없어요'); $('#log-date').focus(); return; }
    // 오늘이면 지금 시각, 지난 날이면 그날 저녁에 끝난 것으로 (날짜별 통계에 맞게 들어가도록)
    const endedAt = day === tk ? now() : new Date(day + 'T21:00').getTime();
    const memo = $('#log-label').value.trim();
    const subjectId = $('#log-subject').value || null;
    store.update((st) => st.sessions.push({ id: uid(), subjectId, minutes, endedAt, label: memo || '직접 기록', manual: true }));
    closeLog();
    toast(`${day === tk ? '오늘' : `${+day.slice(5, 7)}/${+day.slice(8)}`} ${Stats.formatMinutes(minutes)} 공부를 기록했어요`);
  });

  /* ---------- 계정·설정 ---------- */
  function renderAccount() {
    const set = store.get().settings;
    if (document.activeElement.closest('#settings-form') == null) {
      $('#set-goal').value = set.dailyGoalMin;
      $('#set-focus').value = set.focusMin;
      $('#set-break').value = set.breakMin;
      $('#set-awake').checked = set.keepAwake !== false;
      $('#set-daystart').value = String(Math.max(0, Math.min(6, +set.dayStartHour || 0)));
    }
  }

  /* ---------- 앱 소개 ---------- */
  const APP_VERSION = '2.8';
  const APP_DATE = '2026년 11월 11일';
  let aboutTimer = null;
  function stopAboutTrack() { clearInterval(aboutTimer); aboutTimer = null; }
  function renderAbout() {
    $('#app-version').textContent = `버전 ${APP_VERSION} · ${APP_DATE}`;
    if (aboutTimer) return;
    // 폰이 한 칸씩 전진해 끝 칸에서 퀸으로 승급하는 모습을 되풀이
    let step = 0;
    const draw = () => { $('#about-track').innerHTML = pawnTrack(step >= 7 ? 100 : Math.ceil((step / 7) * 100)); };
    draw();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { step = 7; draw(); return; }
    aboutTimer = setInterval(() => {
      if (document.hidden) return;
      step = step >= 10 ? 0 : step + 1; // 7 = 퀸, 8~10 잠시 머묾
      draw();
    }, 650);
  }

  $('#mg-edit').addEventListener('click', () => {
    const f = $('#mg-form');
    f.hidden = !f.hidden;
    const cur = store.get().settings.monthlyGoalMin || 0;
    $('#mg-input').value = cur ? Math.round(cur / 60) : '';
    if (!f.hidden) $('#mg-input').focus();
  });
  $('#mg-cancel').addEventListener('click', () => { $('#mg-form').hidden = true; });
  $('#mg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    let h = parseInt($('#mg-input').value, 10);
    h = isNaN(h) ? 0 : Math.min(744, Math.max(0, h));
    store.update((st) => { st.settings.monthlyGoalMin = h * 60; });
    $('#mg-form').hidden = true;
    renderStats();
    toast(h ? `월 목표를 ${h}시간으로 정했어요` : '월 목표를 지웠어요');
  });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const clamp = (v, lo, hi, d) => { v = parseInt(v, 10); return isNaN(v) ? d : Math.min(hi, Math.max(lo, v)); };
    store.update((st) => {
      st.settings.dailyGoalMin = clamp($('#set-goal').value, 10, 1440, 120);
      st.settings.focusMin = clamp($('#set-focus').value, 1, LEN_MAX.focus, 25);
      st.settings.breakMin = clamp($('#set-break').value, 1, LEN_MAX.break, 5);
      st.settings.keepAwake = $('#set-awake').checked;
      st.settings.dayStartHour = clamp($('#set-daystart').value, 0, 6, 0);
    });
    if (!store.get().settings.keepAwake) releaseAwake(); else if (timer.running) keepAwake();
    if (!timerBusy()) setMode(timer.mode); // 하던 타이머(일시정지 포함)는 그대로 두고, 새 시간은 다음 타이머부터
    $('#set-goal').blur();
    renderAccount();
    toast('설정을 저장했어요');
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `studypromotion-backup-${Stats.dateKey(now())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!(await ask('지금 기록을 백업 파일 내용으로 바꿀까요?\n지금 기록은 자동 백업에 남겨 둬요.', { ok: '백업 파일로 바꾸기', danger: true }))) { e.target.value = ''; return; }
        store.importJSON(reader.result);
        setMode('focus');
        toast('백업을 불러왔어요');
      } catch (err) { toast('불러오기 실패: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  $('#reset-btn').addEventListener('click', async () => {
    if (!(await ask('모든 할 일, 기록, 카드가 삭제됩니다. 계속할까요?', { ok: '모두 삭제', danger: true }))) return;
    store.reset();
    setMode('focus');
    toast('초기화했어요');
  });

  /* ---------- 렌더 ---------- */
  function render() {
    if (currentView === 'home') { renderHome(); if (window.Stopwatch) window.Stopwatch.render(); }
    else if (currentView === 'plan') renderPlan();
    else if (currentView === 'timer') { renderTimer(); if (window.Stopwatch) window.Stopwatch.render(); }
    else if (currentView === 'review') {
      if (!$('#deck-detail').hidden) renderDeckDetail();
      else if ($('#study').hidden) renderDecks();
    } else if (currentView === 'stats') renderStats();
    else if (currentView === 'account') renderAccount();
    else if (currentView === 'about') renderAbout();
    else if (currentView === 'board' && window.Board) window.Board.render();
  }

  store.subscribe(() => { if ($('#study').hidden || currentView !== 'review') render(); });

  // 오늘 공부 시간이 하루 목표를 넘는 순간 한 번 축하 (하루에 한 번만)
  const GOAL_KEY = 'studypromotion.goalDay';
  let goalSeen = { day: todayKey(), min: Stats.minutesOn(store.get().sessions, now()) };
  store.subscribe(() => {
    const day = todayKey();
    const min = Stats.minutesOn(store.get().sessions, now());
    const goal = store.get().settings.dailyGoalMin || 0;
    const before = goalSeen.day === day ? goalSeen.min : 0;
    goalSeen = { day, min };
    if (!goal || before >= goal || min < goal) return;
    let done = null;
    try { done = localStorage.getItem(GOAL_KEY); } catch (e) { /* 무시 */ }
    if (done === day) return;
    try { localStorage.setItem(GOAL_KEY, day); } catch (e) { /* 무시 */ }
    setTimeout(() => {
      toast(`오늘 목표 ${Stats.formatMinutes(goal)} 달성! 오늘의 폰이 퀸이 됐어요 ♛`, { action: '인증 이미지', onAction: () => openShare(todayKey()) });
      try { if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 160]); } catch (e) { /* 무시 */ }
    }, 2400); // 기록 알림을 먼저 보여 주고
  });

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
  window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; toast('스터디 프로모션을 설치했어요'); });
  if (/^https?:$/.test(location.protocol) && 'serviceWorker' in navigator) {
    // 새 버전이 배포되면: 쓰는 중이 아니면 바로 새로고침, 쓰는 중이면 안내 띠
    let swReg = null;
    let hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const busyNow = () => timer.running || !!(window.Lock && window.Lock.state) || !$('#ask').hidden ||
      (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
    const applyUpdate = () => {
      if (reloading) return;
      reloading = true;
      try { sessionStorage.setItem('studypromotion.updated', '1'); } catch (e) { /* 무시 */ }
      location.reload();
    };
    const onNewVersion = () => {
      if (!busyNow()) return applyUpdate();
      $('#update-bar').hidden = false;
    };
    $('#update-btn').addEventListener('click', applyUpdate);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; } // 처음 설치일 때는 새로고침 안 함
      onNewVersion();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { swReg = r; }).catch(() => { /* 임베드 등 등록 불가 환경 */ });
    });
    const checkUpdate = () => { try { if (swReg && navigator.onLine !== false) swReg.update(); } catch (e) { /* 무시 */ } };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
    setInterval(checkUpdate, 15 * 60 * 1000);
    // 안내 띠가 떠 있을 때 타이머 등이 끝나면 조용히 적용
    setInterval(() => { if (!$('#update-bar').hidden && !busyNow() && document.visibilityState === 'hidden') applyUpdate(); }, 5000);
    try {
      if (sessionStorage.getItem('studypromotion.updated')) {
        sessionStorage.removeItem('studypromotion.updated');
        setTimeout(() => toast('새 버전으로 업데이트했어요'), 600);
      }
    } catch (e) { /* 무시 */ }
  }
  // 브라우저가 저장 공간을 정리할 때 데이터가 지워지지 않도록 요청
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 무시 */ }

  // 화이트보드 항목에서 바로 타이머 시작
  // 집중 중에 다른 범위로 바꾸면, 그때까지 한 시간은 버리지 않고 기록할지 물어본다
  async function focusOn(opts) {
    if (window.Stopwatch) window.Stopwatch.showTab('focus');
    if (timer.mode === 'focus' && timer.label === (opts.label || null) && timer.topicId === (opts.topicId || null) && (timer.running || timer.remaining < timer.total)) return go('timer'); // 같은 범위면 이어서
    const left = timer.running ? Math.max(0, Math.ceil((timer.endAt - now()) / 1000)) : timer.remaining;
    const doneMin = timer.mode === 'focus' ? Math.floor((timer.total - left) / 60) : 0;
    if (doneMin >= 1) {
      const ok = await ask(`지금 집중 중인 ${Stats.formatMinutes(doneMin)}을 기록하고\n'${opts.label || '새 범위'}'${Stats.josa(opts.label || '새 범위', '으로/로')} 새로 시작할까요?`, { ok: '기록하고 바꾸기', cancel: '그대로 두기' });
      if (!ok) return go('timer');
      if (timer.running) pauseTimer();
      recordFocus(doneMin, now());
      toast(`${Stats.formatMinutes(doneMin)} 기록했어요`);
    } else if (timer.running) pauseTimer();
    timer.label = opts.label || null;
    timer.topicId = opts.topicId || null;
    const subj = opts.subjectName ? store.get().subjects.find((s) => s.name === opts.subjectName) : null;
    timer.subjectId = subj ? subj.id : '';
    timer.startedAt = 0;
    setMode('focus');
    go('timer');
  }
  $('#timer-topic-clear').addEventListener('click', () => { timer.label = null; timer.topicId = null; saveTimer(); renderTimer(); });

  /* ---------- 화면 밝기(자동/밝게/어둡게) ---------- */
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: '자동', light: '밝게', dark: '어둡게' };
  // 글꼴마다 모양이 다른 기호 대신 직접 그린 아이콘
  const THEME_ICON = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path class="fill" d="M12 3.8a8.2 8.2 0 0 1 0 16.4z"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M5.4 18.6 7 17M17 7l1.6-1.6"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.6 14.6A8 8 0 1 1 9.4 4.4a6.4 6.4 0 0 0 10.2 10.2z"/></svg>',
  };
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    $('#theme-btn').title = '화면 밝기: ' + THEME_LABEL[t];
    $('#theme-btn').setAttribute('aria-label', '화면 밝기 바꾸기 (지금: ' + THEME_LABEL[t] + ')');
    $('#theme-btn').innerHTML = THEME_ICON[t];
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

  /* ---------- 테마 색 (청록 / 핑크) ---------- */
  const ACCENTS = { teal: '청록', pink: '핑크' };
  let accent = 'teal';
  try { accent = localStorage.getItem('studypromotion.accent') || 'teal'; } catch (e) { /* 무시 */ }
  if (!ACCENTS[accent]) accent = 'teal';
  function applyAccent(a) {
    if (a === 'teal') document.documentElement.removeAttribute('data-accent');
    else document.documentElement.setAttribute('data-accent', a);
    $$('[data-accent-pick]').forEach((b) => {
      const on = b.dataset.accentPick === a;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
  }
  applyAccent(accent);
  $('#accent-picks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-accent-pick]');
    if (!b || b.dataset.accentPick === accent) return;
    accent = b.dataset.accentPick;
    try { localStorage.setItem('studypromotion.accent', accent); } catch (err) { /* 무시 */ }
    applyAccent(accent);
    toast('테마 색: ' + ACCENTS[accent]);
  });

  window.App = { store, focusOn, pawnTrack, ic, $, $$, esc, toast, ask, uid, go, now, render, openLog, timerBusy, stopTimer: stopTimerForStopwatch, timerRunning: () => timer.running, timerDot, renderHomeToday, version: APP_VERSION, get view() { return currentView; } };

  if (!restoreTimer()) setMode('focus');
  initHistory();
  go(location.hash.slice(1) || 'home');

  // 테스트/디버그용
  window.__studypromotion = { store, timer, finishPhase, parseBulk };
})();
