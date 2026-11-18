/* 스터디 플래너 화면 (계획 탭 자리): 오늘과 앞날의 할 일을 날짜별로 적고 체크한다.
   계산은 js/plan.js(window.Plan), 끝냄은 App.setTaskDone, 일정은 js/events.js, 시간 띠는 js/timetable.js가 맡는다.
   - 하루: 주간 띠(날짜·과목 색 점) → 그날 요약(D-day·목표·진행률) → 할 일 → 시간 계획(띠·일정) → 돌아보기·메모
   - 주간: 월~일 날짜별 할 일. 달력 창(📅)에서 아무 날이나 고른다
   - 맨 아래: 날짜 안 정한 할 일, 과목 관리 (과목 목록은 app.js가 그린다)
   홈의 '오늘 할 일' 칸과 요약 카드도 여기서 그린다 (플래너의 오늘 칸). */
(function () {
  'use strict';
  const App = window.App, P = window.Plan, S = window.Schedule;
  if (!App || !P || !S || !document.getElementById('view-plan')) return;
  const { store, $, $$, esc, toast, ic, uid } = App;
  const now = () => App.now();
  const fm = Stats.formatMinutes;
  const today = () => App.todayKey();
  const featOn = (id) => !window.Features || window.Features.on(id);
  const MODE_KEY = 'studypromotion.plMode';
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const EST_OPTS = [10, 15, 20, 30, 40, 45, 60, 90, 120, 180];

  let sel = null; // 보고 있는 날 'YYYY-MM-DD' (null = 오늘을 따라감)
  let mode = 'day';
  try { if (localStorage.getItem(MODE_KEY) === 'week') mode = 'week'; } catch (e) { /* 무시 */ }
  let goalEdit = null; // 목표를 고치는 중인 날
  let carryOpen = false; // 지난 날 못 한 일 목록을 펼쳤나
  const viewKey = () => sel || today();
  const subjOf = (id) => (id ? App.subjectById(id) : null) || null;
  const colorOf = (t) => P.taskColor(store.get(), t) || 'var(--muted)';
  const taskOf = (id) => store.get().tasks.find((x) => x.id === id) || null;
  const withJosa = (key, pair) => P.dayTitle(key) + Stats.josa(P.dayTitle(key), pair);
  // 지금 재고 있는 구간 (스톱워치, 없으면 집중 타이머). { from, to, taskId, … } 또는 null
  const liveOf = () => (window.Stopwatch && window.Stopwatch.live && window.Stopwatch.live()) || (App.timerLive && App.timerLive()) || null;
  const liveText = (min) => (min >= 1 ? `하는 중 ${fm(min)}` : '하는 중');
  // 같은 내용이면 다시 그리지 않는다 (기록이 바뀔 때마다 다시 그려도, 누르려던 단추가 그사이 바뀌어 눌림이 사라지지 않게)
  function setHTML(el, html) { if (el && el._plHTML !== html) { el.innerHTML = html; el._plHTML = html; } }

  /* ---------- 한 줄 ---------- */
  // 이 할 일과 이은 일정의 시각: 할 일의 날짜에 있으면 '20:00', 다른 날이면 다가오는 첫 일정 '11/18 20:00'. { text, key } 또는 null
  function planAt(t) {
    const evs = (store.get().events || []).filter((ev) => ev && ev.taskId === t.id);
    if (!evs.length) return null;
    const hm = (o) => S.fmtHM(S.parseHM(o.ev.start));
    const same = t.due ? S.forDay(evs, t.due)[0] : null;
    if (same) return { text: hm(same), key: t.due };
    const o = S.next(evs, now(), 60);
    return o ? { text: `${P.shortDay(o.date).split(' ')[0]} ${hm(o)}`, key: o.date } : null;
  }
  // opts.dated: 날짜도 적는다(지난 날 못 한 일), opts.place: '이날로' 단추(날짜 안 정한 일)
  function rowHTML(t, opts) {
    opts = opts || {};
    const st = store.get();
    const tk = today();
    const s = subjOf(t.subjectId);
    const lv = liveOf();
    const liveMin = lv && lv.taskId === t.id && !t.done ? Math.max(0, Math.floor((now() - lv.from) / 60000)) : null;
    const got = P.taskMinutes(st.sessions, t);
    const meta = [];
    if (s) meta.push(`<span class="pl-sub">${esc(s.name)}</span>`);
    if (opts.dated && t.due) meta.push(`<span class="overdue">${esc(P.shortDay(t.due))}</span>`);
    if (+t.estimateMin > 0) meta.push(`<span>${fm(+t.estimateMin)}</span>`);
    const rt = P.repText(t.rep);
    if (rt) meta.push(`<span class="pl-tag">${ic('repeat')}${esc(rt)}</span>`);
    const at = t.done ? null : planAt(t);
    if (at) meta.push(`<button type="button" class="pl-tag at" data-tt-open="${esc(at.key)}" aria-label="공부할 시각 ${esc(at.text)}, 타임테이블에서 보기">${ic('clock')}${esc(at.text)}</button>`);
    if (t.topicId && st.topics.some((n) => n.id === t.topicId)) meta.push(`<span class="pl-tag" title="범위와 이어진 할 일이에요. 끝내면 범위에도 체크돼요">${ic('board')}범위</span>`);
    if (got) meta.push(`<span class="pl-got">공부 ${fm(got)}</span>`);
    let right = '';
    if (liveMin !== null) right = `<span class="pl-live" data-pl-live="${esc(t.id)}"><i></i>${liveText(liveMin)}</span>`;
    else if (opts.place) right = `<button type="button" class="btn sm pl-place" data-pl-place>${viewKey() === tk ? '오늘로' : esc(P.shortDay(viewKey()).split(' ')[0]) + '로'}</button>`;
    else if (!t.done && t.due && t.due <= tk && featOn('timer')) right = `<button type="button" class="pl-play" data-pl-play data-feature="timer" aria-label="${esc(t.title)} 공부 시작" title="이 할 일로 공부 시작">${ic('play')}</button>`;
    return `<li class="pl-item${t.done ? ' done' : ''}${liveMin !== null ? ' live' : ''}" data-pl-id="${esc(t.id)}" style="--c:${esc(colorOf(t))}">` +
      `<input type="checkbox" class="pl-check"${t.done ? ' checked' : ''} aria-label="${esc(t.title)} 끝냄">` +
      `<div class="pl-body" data-pl-more><div class="pl-title">${esc(t.title)}</div>${meta.length ? `<div class="pl-meta">${meta.join('')}</div>` : ''}</div>` +
      right + `<button type="button" class="icon-btn pl-more" data-pl-more aria-label="${esc(t.title)} 메뉴" title="더 보기">${ic('more')}</button></li>`;
  }

  /* ---------- 하루 ---------- */
  function dotsHTML(key, max) {
    const list = P.dayTasks(store.get().tasks, key);
    return list.slice(0, max).map((t) => `<i class="${t.done ? 'f' : ''}" style="--c:${esc(colorOf(t))}"></i>`).join('') + (list.length > max ? '<em>+</em>' : '');
  }
  function weekTitle(key) {
    const ks = P.weekKeys(key);
    const a = S.keyDate(ks[0]), b = S.keyDate(ks[6]);
    return `${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${a.getMonth() === b.getMonth() ? '' : b.getMonth() + 1 + '월 '}${b.getDate()}일`;
  }
  // 위쪽 줄: ‹ 주 › 오늘 📅
  function navHTML(key, week) {
    const tk = today();
    const away = week ? S.weekStart(key) !== S.weekStart(tk) : key !== tk;
    return `<div class="pl-week-top"><button type="button" class="pl-nav" data-pl-nav="-7" aria-label="지난주">‹</button><b>${weekTitle(key)}</b>` +
      `<button type="button" class="pl-nav" data-pl-nav="7" aria-label="다음 주">›</button>` +
      (away ? '<button type="button" class="btn sm pl-today" data-pl-today>오늘</button>' : '') +
      `<button type="button" class="pl-cal" data-pl-cal aria-label="달력에서 날짜 고르기" title="달력">${ic('cal')}</button></div>`;
  }
  function stripHTML(key) {
    const st = store.get();
    const tk = today();
    const cells = P.weekKeys(key).map((k) => {
      const d = S.keyDate(k);
      const sum = P.daySummary(st.tasks, k);
      const exam = st.exams.some((e) => e.date === k);
      const cls = ['pl-day', k === key ? 'on' : '', k === tk ? 'today' : '', d.getDay() === 0 ? 'sun' : '', exam ? 'exam' : ''].filter(Boolean).join(' ');
      const label = `${d.getMonth() + 1}월 ${d.getDate()}일 ${P.WD[d.getDay()]}요일${k === tk ? ', 오늘' : ''}${exam ? ', 시험' : ''}${sum.total ? `, 할 일 ${sum.total}개${sum.done ? ` 중 ${sum.done}개 끝냄` : ''}` : ''}`;
      return `<button type="button" class="${cls}" data-pl-day="${k}" aria-pressed="${k === key}" aria-label="${label}"><span>${k === tk ? '오늘' : exam ? '시험' : P.WD[d.getDay()]}</span><b>${d.getDate()}</b><i class="pl-dots" aria-hidden="true">${dotsHTML(k, 5)}</i></button>`;
    }).join('');
    return navHTML(key, false) + `<div class="pl-days">${cells}</div>`;
  }
  const liveTodayMin = () => (window.Stopwatch ? window.Stopwatch.todayMinutes() : 0);
  function sumHTML(key) {
    const st = store.get();
    const tk = today();
    const sum = P.daySummary(st.tasks, key);
    const ex = P.nextExam(st.exams, key);
    const note = P.noteOf(st, key);
    const dd = ex ? `<span class="pl-dday" title="${esc(ex.exam.name)} · ${P.dayTitle(ex.exam.date)}">${esc(ex.exam.name)} ${P.ddayText(ex.days)}</span>` : '';
    const goalLabel = key === tk ? '오늘의 목표' : '이날의 목표';
    const goal = goalEdit === key
      ? `<form class="pl-goal-edit" data-pl-goal-form><label for="pl-goal-in">${goalLabel}</label><span class="pl-goal-row"><input id="pl-goal-in" maxlength="80" autocomplete="off" enterkeyhint="done" value="${esc(note.goal)}" placeholder="예: 수학 3단원 끝내기"><button class="btn primary sm" type="submit">저장</button></span></form>`
      : `<button type="button" class="pl-goal${note.goal ? '' : ' empty'}" data-pl-goal aria-label="${goalLabel} ${note.goal ? '고치기: ' + esc(note.goal) : '적기'}"><span>${goalLabel}</span><b>${esc(note.goal || '한 줄로 적어 두면 여기에 늘 보여요')}</b>${ic('edit')}</button>`;
    let prog;
    if (key <= tk) {
      const studied = P.studyMinutes(st.sessions, key) + (key === tk ? liveTodayMin() : 0);
      const pct = sum.total ? Math.round((sum.done / sum.total) * 100) : 0;
      prog = `<div class="pl-prog"><div class="pl-prog-top"><b>할 일 ${sum.done} / ${sum.total}</b><span>${sum.planMin ? `계획 ${fm(sum.planMin)} · ` : ''}공부 <b class="pl-studied">${fm(studied)}</b></span></div>` +
        `<div class="bar" role="progressbar" aria-label="할 일 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
    } else {
      prog = `<div class="pl-prog"><div class="pl-prog-top"><b>할 일 ${sum.total}개</b><span>${sum.planMin ? `계획 ${fm(sum.planMin)}` : ''}</span></div></div>`;
    }
    return `<div class="pl-date-row"><h2>${P.dayTitle(key)}<small>${P.relDay(key, tk)}</small></h2>${dd}</div>${goal}${prog}`;
  }
  // 지난 날 못 한 할 일: '오늘로 가져오기' 띠 (누르면 하나씩 볼 수 있게 펼친다)
  function carryHTML() {
    const list = P.overdue(store.get().tasks, today());
    if (!list.length) return '';
    const y = S.shiftKey(today(), -1);
    const names = list.slice(0, 2).map((t) => t.title).join(', ') + (list.length > 2 ? ` 외 ${list.length - 2}개` : '');
    return `<div class="pl-carry"><button type="button" class="pl-carry-text" data-pl-carry-open aria-expanded="${carryOpen}"><b>${list.every((t) => t.due === y) ? '어제' : '지난 날'} 못 한 할 일 ${list.length}개</b><small>${esc(names)}</small></button>` +
      `<button type="button" class="btn sm" data-pl-carry>오늘로 가져오기</button></div>` +
      (carryOpen ? `<ul class="pl-list pl-carry-list">${list.map((t) => rowHTML(t, { dated: true })).join('')}</ul>` : '');
  }
  function todoHTML(key) {
    const st = store.get();
    const tk = today();
    const sum = P.daySummary(st.tasks, key);
    const empty = key < tk ? '이날 적어 둔 할 일이 없어요.' : key === tk ? '오늘 할 일을 적어 보세요. 끝내면 체크해요.' : '이날 할 일을 미리 적어 두세요.';
    return `<div class="panel-head"><h2>할 일</h2>${featOn('board') ? `<button type="button" class="btn link pl-scope" data-pl-scope data-feature="board">${ic('board')}범위에서 고르기</button>` : ''}</div>` +
      (key === tk ? carryHTML() : '') +
      `<ul class="pl-list" id="pl-list">${sum.list.length ? sum.list.map((t) => rowHTML(t)).join('') : `<li class="empty">${empty}</li>`}</ul>` +
      `<button type="button" class="pl-add" data-pl-add="${key}"><span aria-hidden="true">＋</span>할 일 추가</button>`;
  }
  function timeHTML(key) {
    const tk = today();
    const T = window.Timetable;
    const parts = T && T.dayParts ? T.dayParts(key, key < tk ? '이날은 일정이 없었어요.' : '공부할 시간을 정해 두면 띠에 점선으로 보이고, 그 시간에 여기서 바로 시작할 수 있어요.') : null;
    return `<div class="panel-head"><h2>시간 계획</h2>${parts ? `<a class="small pl-link" href="#timetable" data-tt-open="${key}">타임테이블${ic('chev')}</a>` : ''}</div>` +
      (parts ? parts.strip + `<ul class="simple-list ev-list pl-ev">${parts.plans}</ul>` : '') +
      (window.Events ? `<button type="button" class="btn link pl-evadd" data-pl-evadd="${key}">＋ 일정 추가</button>` : '');
  }
  function grow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(320, Math.max(74, ta.scrollHeight + 2)) + 'px'; }
  function renderMemo(key) {
    const el = $('#pl-memo');
    const tk = today();
    const kind = key <= tk ? 'look' : 'note';
    let ta = el.querySelector('textarea');
    if (ta && ta.dataset.key === key && document.activeElement === ta) return; // 적는 중에는 그대로
    if (!ta || ta.dataset.key !== key || el.dataset.kind !== kind) {
      const ph = kind === 'note' ? '준비물이나 미리 챙길 것을 적어 두세요' : key === tk ? '오늘 공부는 어땠나요? 잘한 점, 아쉬운 점, 내일 고칠 점' : '이날 공부는 어땠나요?';
      el.innerHTML = `<div class="panel-head"><h2><label for="pl-memo-in">${kind === 'note' ? '메모' : '하루 돌아보기'}</label></h2><span class="muted small pl-memo-st" id="pl-memo-st" aria-live="polite"></span></div>` +
        `<textarea id="pl-memo-in" class="pl-memo-box" rows="3" maxlength="2000" data-key="${key}" placeholder="${esc(ph)}"></textarea>`;
      el.dataset.kind = kind;
      ta = el.querySelector('textarea');
    }
    const v = P.noteOf(store.get(), key).memo;
    if (ta.value !== v) ta.value = v;
    grow(ta);
  }
  function renderDay() {
    const key = viewKey();
    setHTML($('#pl-strip'), stripHTML(key));
    const gi = $('#pl-goal-in');
    if (!(goalEdit === key && gi && document.activeElement === gi)) setHTML($('#pl-sum'), sumHTML(key));
    setHTML($('#pl-todo'), todoHTML(key));
    setHTML($('#pl-time'), timeHTML(key));
    renderMemo(key);
  }

  /* ---------- 주간 ---------- */
  function renderWeek() {
    const st = store.get();
    const tk = today();
    const key = viewKey();
    const keys = P.weekKeys(key);
    let n = 0, done = 0, plan = 0;
    keys.forEach((k) => { const s = P.daySummary(st.tasks, k); n += s.total; done += s.done; plan += s.planMin; });
    const ex = P.nextExam(st.exams, tk);
    const rows = keys.map((k) => {
      const d = S.keyDate(k), sum = P.daySummary(st.tasks, k);
      const exams = st.exams.filter((e) => e.date === k);
      const evs = S.forDay(st.events || [], k).map((o) => `<span>${ic('clock')}${S.fmtHM(S.parseHM(o.ev.start))} ${esc(window.Events ? window.Events.nameOf(o.ev) : o.ev.title || '공부')}</span>`).join('');
      const lis = sum.list.map((t) => `<li class="pl-wi${t.done ? ' done' : ''}" data-pl-id="${esc(t.id)}"><input type="checkbox" class="pl-check"${t.done ? ' checked' : ''} aria-label="${esc(t.title)} 끝냄">` +
        `<i class="dot" style="background:${esc(colorOf(t))}"></i><button type="button" class="t" data-pl-more>${esc(t.title)}</button>${+t.estimateMin > 0 ? `<small>${fm(+t.estimateMin)}</small>` : ''}</li>`).join('');
      const badge = k === tk ? '<em>오늘</em>' : sum.total ? `<small>${k < tk ? `${sum.done}/${sum.total}` : `${sum.total}개`}</small>` : '';
      return `<div class="pl-wd${k === tk ? ' today' : ''}${k < tk ? ' past' : ''}${d.getDay() === 0 ? ' sun' : ''}" data-pl-wd="${k}">` +
        `<button type="button" class="pl-wd-date" data-pl-open="${k}" aria-label="${P.dayTitle(k)} 하루 보기"><span>${P.WD[d.getDay()]}</span><b>${d.getDate()}</b>${badge}</button>` +
        `<div class="pl-wd-main">${exams.map((e) => `<p class="pl-wd-exam">시험 · ${esc(e.name)}</p>`).join('')}${evs ? `<div class="pl-wev">${evs}</div>` : ''}${lis ? `<ul>${lis}</ul>` : ''}` +
        `<button type="button" class="pl-wd-add" data-pl-add="${k}">＋ ${sum.total ? '추가' : '할 일 넣기'}</button></div></div>`;
    }).join('');
    setHTML($('#pl-week'), navHTML(key, true) +
      `<p class="pl-wk-sum"><b>할 일 ${done} / ${n}</b>${plan ? `<span>계획 ${fm(plan)}</span>` : ''}</p>` +
      (ex ? `<p class="pl-wk-exam"><span class="pl-dday">시험</span>${esc(ex.exam.name)} <b>${P.ddayText(ex.days)}</b><span class="muted">· ${P.dayTitle(ex.exam.date)}</span></p>` : '') +
      `<div class="pl-wds">${rows}</div>`);
  }

  /* ---------- 날짜 안 정한 할 일 ---------- */
  function renderUndated() {
    const list = P.undated(store.get().tasks);
    $('#pl-undated-n').textContent = list.length ? list.length + '개' : '';
    setHTML($('#pl-undated'), list.length ? list.map((t) => rowHTML(t, { place: mode === 'day' })).join('')
      : '<li class="empty">날짜를 정하지 않은 할 일이 없어요. 언제 할지 모르는 일은 여기에 적어 두세요.</li>');
  }

  function paintMode() {
    $$('[data-pl-mode]').forEach((b) => { const on = b.dataset.plMode === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#pl-day').hidden = mode !== 'day';
    $('#pl-week').hidden = mode !== 'week';
  }

  function render() {
    if (App.view === 'home') return renderHome();
    if (App.view !== 'plan') return;
    paintMode();
    if (mode === 'week') renderWeek(); else renderDay();
    renderUndated();
    $('#pl-subj-n').textContent = store.get().subjects.length + '과목';
  }

  /* ---------- 홈: 플래너의 오늘 칸 ---------- */
  function renderHome() {
    const list = $('#h-tasklist');
    if (!list) return;
    const st = store.get();
    const tk = today();
    const sum = P.daySummary(st.tasks, tk);
    const late = P.overdue(st.tasks, tk);
    $('#h-tasks').textContent = sum.left;
    $('#h-tasks-sub').innerHTML = late.length ? `<span class="overdue">지난 날 못 한 일 ${late.length}개</span>`
      : sum.total ? (sum.left ? `${sum.total}개 중 ${sum.done}개 끝냄` : '오늘 할 일 끝 ✓') : '플래너에 적어 보세요';
    const note = P.noteOf(st, tk);
    setHTML($('#h-pl-top'), (note.goal ? `<p class="pl-home-goal"><span>오늘의 목표</span><b>${esc(note.goal)}</b></p>` : '') + carryHTML());
    setHTML(list, sum.list.length ? sum.list.map((t) => rowHTML(t)).join('')
      : '<li class="empty">오늘 할 일이 없어요. 아래에서 바로 적거나, 플래너에서 앞날까지 계획해 보세요.</li>');
  }

  /* ---------- 지금 재는 시간 따라가기 (30초마다 글자만 고친다. 목록을 다시 그리지 않아 누르려던 단추가 사라지지 않게) ---------- */
  let lastDay = today();
  setInterval(() => {
    if (document.hidden || (App.view !== 'plan' && App.view !== 'home')) return;
    if (lastDay !== today()) { lastDay = today(); sel = sel === lastDay ? null : sel; render(); return; }
    const lv = liveOf();
    $$('[data-pl-live]').forEach((el) => {
      if (!lv || lv.taskId !== el.dataset.plLive) return;
      el.lastChild.textContent = liveText(Math.max(0, Math.floor((now() - lv.from) / 60000)));
    });
    const sd = $('#pl-sum .pl-studied');
    if (sd && App.view === 'plan' && mode === 'day' && viewKey() === today()) sd.textContent = fm(P.studyMinutes(store.get().sessions, today()) + liveTodayMin());
  }, 30000);

  /* ---------- 달력 창 ---------- */
  // opts: { title, sel(처음 고른 날), ok(단추 글자) }. 고른 날을 돌려준다 (그냥 닫으면 undefined).
  // 날을 한 번 누르면 아래에 그날 할 일이 나오고, 단추나 같은 날을 한 번 더 누르면 정한다
  function openMonth(opts) {
    opts = opts || {};
    const tk = today();
    let cur = S.isKey(opts.sel) ? opts.sel : viewKey();
    let vy = +cur.slice(0, 4), vm = +cur.slice(5, 7) - 1;
    const st = store.get();
    const examOn = (k) => st.exams.filter((e) => e.date === k);
    const body = () => {
      const first = new Date(vy, vm, 1).getDay();
      const last = new Date(vy, vm + 1, 0).getDate();
      let h = `<div class="pl-month"><div class="ui-cal-head"><button type="button" class="ui-cal-nav" data-pl-mnav="-1" aria-label="이전 달">‹</button><b aria-live="polite">${vy}년 ${vm + 1}월</b><button type="button" class="ui-cal-nav" data-pl-mnav="1" aria-label="다음 달">›</button></div><div class="pl-mgrid">`;
      h += P.WD.map((w, i) => `<span class="pl-mwd${i === 0 ? ' sun' : ''}">${w}</span>`).join('');
      for (let i = 0; i < first; i++) h += '<span></span>';
      for (let d = 1; d <= last; d++) {
        const k = `${vy}-${String(vm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const wd = (first + d - 1) % 7;
        const ex = examOn(k);
        const n = P.daySummary(st.tasks, k).total;
        const cls = ['pl-md', k === cur ? 'on' : '', k === tk ? 'today' : '', wd === 0 ? 'sun' : '', ex.length ? 'exam' : '', k < tk ? 'past' : ''].filter(Boolean).join(' ');
        h += `<button type="button" class="${cls}" data-pl-md="${k}" aria-pressed="${k === cur}" aria-label="${vm + 1}월 ${d}일 ${P.WD[wd]}요일${k === tk ? ', 오늘' : ''}${ex.length ? ', 시험' : ''}${n ? `, 할 일 ${n}개` : ''}"><b>${d}</b>${ex.length ? '<em>시험</em>' : `<i class="pl-dots" aria-hidden="true">${dotsHTML(k, 4)}</i>`}</button>`;
      }
      const s = P.daySummary(st.tasks, cur);
      const ex = examOn(cur);
      h += `</div><div class="pl-mfoot"><span><b>${P.dayTitle(cur)}</b>${ex.length ? esc(ex.map((e) => e.name).join(', ')) + ' 시험 · ' : ''}${s.total ? `할 일 ${s.total}개${s.planMin ? ' · 계획 ' + fm(s.planMin) : ''}` : '할 일 없음'}</span>` +
        `<button type="button" class="btn primary sm" data-pl-mok>${esc(opts.ok || '이날 열기')}</button></div></div>`;
      return h;
    };
    const paint = (back, focusSel) => {
      back.querySelector('.ui-sheet-body').innerHTML = body();
      const f = focusSel && back.querySelector(focusSel);
      if (f) f.focus({ preventScroll: true });
    };
    return window.UI.openSheet({
      title: opts.title || '날짜 고르기', body: body(), cls: 'pl-month-sheet', focusSel: '.pl-md.on, .pl-md.today, .pl-md',
      onClick: (e, close) => {
        const back = e.currentTarget;
        const nav = e.target.closest('[data-pl-mnav]');
        if (nav) { const d = new Date(vy, vm + +nav.dataset.plMnav, 1); vy = d.getFullYear(); vm = d.getMonth(); paint(back, `[data-pl-mnav="${nav.dataset.plMnav}"]`); return; }
        const day = e.target.closest('[data-pl-md]');
        if (day) { if (day.dataset.plMd === cur) { close(cur); return; } cur = day.dataset.plMd; paint(back, `[data-pl-md="${cur}"]`); return; }
        if (e.target.closest('[data-pl-mok]')) close(cur);
      },
    });
  }

  /* ---------- 할 일 메뉴 (⋯) ---------- */
  async function openMenu(id) {
    const t = taskOf(id);
    if (!t) return;
    const tk = today();
    const s = subjOf(t.subjectId);
    const lv = liveOf();
    const items = [];
    if (!t.done && featOn('timer')) items.push(['start', 'play', lv && lv.taskId === t.id ? '공부하는 화면 열기' : '지금 공부 시작', featOn('stopwatch') ? '스톱워치가 이 할 일로 켜지고, 잰 시간이 이 줄에 쌓여요' : '집중 타이머가 이 할 일로 시작해요']);
    if (!t.done && t.due !== tk) items.push(['today', 'undo', '오늘로 가져오기', P.dayTitle(tk)]);
    if (!t.done && t.due) items.push(['next', 'next', t.due === tk ? '내일로 미루기' : '다음 날로 미루기', P.dayTitle(S.shiftKey(t.due, 1))]);
    if (!t.done) items.push(['pick', 'cal', t.due ? '다른 날로 옮기기' : '날짜 정하기', '달력에서 날짜 고르기']);
    if (!t.done && window.Events) items.push(['time', 'clock', '공부할 시각 정하기', '타임테이블에 일정으로 넣어요']);
    items.push(['edit', 'edit', '고치기', '']);
    items.push(['del', 'trash', '지우기', t.rep ? '이 날만 또는 이 날부터 앞으로' : '']);
    const sub = [s ? s.name : '', +t.estimateMin > 0 ? fm(+t.estimateMin) : '', t.due ? P.dayTitle(t.due) : '날짜 안 정함', P.repText(t.rep)].filter(Boolean).join(' · ');
    const body = `<div class="pl-menu"><p class="pl-menu-sub">${esc(sub)}</p>` + items.map(([v, icon, label, hint]) =>
      `<button type="button" class="pl-mi${v === 'start' ? ' main' : ''}${v === 'del' ? ' danger' : ''}" data-pl-mi="${v}"><span class="pl-mi-ic">${ic(icon)}</span><span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`).join('') + '</div>';
    const pick = await window.UI.openSheet({ title: t.title, body, cls: 'pl-menu-sheet', focusSel: '.pl-mi', onClick: (e, close) => { const b = e.target.closest('[data-pl-mi]'); if (b) close(b.dataset.plMi); } });
    if (pick) act(pick, id);
  }
  async function act(what, id) {
    const t = taskOf(id);
    if (!t) return;
    const tk = today();
    if (what === 'start') startTask(t);
    else if (what === 'today') moveTo(t, tk);
    else if (what === 'next') moveTo(t, S.shiftKey(t.due, 1));
    else if (what === 'pick') {
      const k = await openMonth({ title: t.due ? '어느 날로 옮길까요?' : '어느 날 할까요?', sel: t.due || viewKey(), ok: '이날로 옮기기' });
      if (k) moveTo(t, k);
    } else if (what === 'time' && window.Events) window.Events.open({ date: t.due && t.due >= tk ? t.due : tk, taskId: t.id, subjectId: t.subjectId });
    else if (what === 'edit') openDlg({ id: t.id });
    else if (what === 'del') removeTask(t);
  }
  function moveTo(t, key) {
    if (t.due === key) return;
    const prev = { due: t.due, pos: t.pos };
    store.update((st) => { P.moveTask(st, t.id, key, now()); });
    toast(key ? `${withJosa(key, '으로/로')} 옮겼어요` : '날짜 안 정한 할 일로 옮겼어요', { action: '되돌리기', onAction: () => store.update((st) => {
      const x = st.tasks.find((y) => y.id === t.id);
      if (!x) return;
      x.due = prev.due;
      if (prev.pos === undefined) delete x.pos; else x.pos = prev.pos;
    }) });
  }
  async function removeTask(t) {
    const series = P.seriesFrom(store.get().tasks, t);
    let scope = 'one';
    if (t.rep && series.length > 1) {
      scope = await App.choose('반복 할 일을 어떻게 지울까요?', [
        { value: 'one', label: '이 날만 지우기', hint: t.due ? P.dayTitle(t.due) : '' },
        { value: 'future', label: '이 날부터 앞으로 모두 지우기', hint: `${series.length}개` },
      ]);
      if (!scope) return;
    }
    const ids = new Set(scope === 'future' ? series.map((x) => x.id) : [t.id]);
    const removed = store.get().tasks.map((x, i) => ({ x, i })).filter((o) => ids.has(o.x.id));
    store.update((st) => { st.tasks = st.tasks.filter((x) => !ids.has(x.id)); });
    toast(ids.size > 1 ? `할 일 ${ids.size}개를 지웠어요` : `'${t.title}' 지웠어요`, { action: '되돌리기', onAction: () => store.update((st) => {
      removed.forEach((o) => { if (!st.tasks.some((y) => y.id === o.x.id)) st.tasks.splice(Math.min(o.i, st.tasks.length), 0, o.x); });
    }) });
  }
  // 이 할 일로 공부 시작: 스톱워치(꺼 두었으면 집중 타이머). 이미 이 할 일을 재는 중이면 그 화면만 연다
  function startTask(t) {
    const sid = t.subjectId && subjOf(t.subjectId) ? t.subjectId : '';
    const lv = liveOf();
    const sw = window.Stopwatch;
    if (lv && lv.taskId === t.id) { if (sw) sw.showTab(sw.running() ? 'sw' : 'focus'); App.go('timer'); return; }
    if (sw && featOn('stopwatch')) { sw.showTab('sw'); App.go('timer'); sw.start(sid, { label: t.title, taskId: t.id }); return; }
    if (App.startFocus && featOn('focus') && App.startFocus({ subjectId: sid, label: t.title, taskId: t.id })) return;
    App.go('timer');
  }

  /* ---------- 지난 일 가져오기 ---------- */
  function carry() {
    let prev = [];
    store.update((st) => { prev = P.carryOver(st, today(), now()); });
    if (!prev.length) return;
    carryOpen = false;
    toast(`할 일 ${prev.length}개를 오늘로 가져왔어요`, { action: '되돌리기', onAction: () => store.update((st) => prev.forEach((p) => {
      const x = st.tasks.find((y) => y.id === p.id);
      if (!x) return;
      x.due = p.due;
      if (p.pos === undefined) delete x.pos; else x.pos = p.pos;
    })) });
  }

  /* ---------- 목표·메모 ---------- */
  function startGoal() {
    goalEdit = viewKey();
    setHTML($('#pl-sum'), sumHTML(goalEdit));
    const i = $('#pl-goal-in');
    if (i) { i.focus(); i.select(); }
  }
  function saveGoal() {
    const i = $('#pl-goal-in');
    const key = goalEdit;
    goalEdit = null;
    if (!i || !key) return render();
    const v = i.value;
    if (v.trim() !== P.noteOf(store.get(), key).goal) store.update((st) => P.setNote(st, key, { goal: v }));
    else render();
  }
  let memoTimer = null;
  function saveMemo(ta, quietly) {
    clearTimeout(memoTimer);
    const key = ta.dataset.key;
    if (!S.isKey(key) || ta.value === P.noteOf(store.get(), key).memo) return;
    store.update((st) => P.setNote(st, key, { memo: ta.value }), { silent: !!quietly });
    const m = $('#pl-memo-st');
    if (m) m.textContent = '저장했어요';
  }
  $('#pl-memo').addEventListener('input', (e) => {
    const ta = e.target.closest('textarea');
    if (!ta) return;
    grow(ta);
    const m = $('#pl-memo-st');
    if (m) m.textContent = '';
    clearTimeout(memoTimer);
    memoTimer = setTimeout(() => saveMemo(ta, true), 600); // 적는 동안은 화면을 다시 그리지 않고 저장만
  });
  $('#pl-memo').addEventListener('focusout', (e) => { const ta = e.target.closest('textarea'); if (ta) saveMemo(ta, false); });
  $('#pl-sum').addEventListener('submit', (e) => { if (e.target.closest('[data-pl-goal-form]')) { e.preventDefault(); saveGoal(); } });
  $('#pl-sum').addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.id === 'pl-goal-in') { e.preventDefault(); goalEdit = null; render(); } });
  $('#pl-sum').addEventListener('focusout', (e) => {
    if (e.target.id !== 'pl-goal-in') return;
    setTimeout(() => { if (goalEdit && document.activeElement !== $('#pl-goal-in')) saveGoal(); }, 0);
  });

  /* ---------- 할 일 추가·고치기 창 ---------- */
  let dlg = null; // { id(고치는 할 일), subjectId, rep: ''|'daily'|'weekly', days: Set, back }
  let lastSubject = '';
  const SUBJ_COLORS = ['#e05a4f', '#3d96e0', '#45a865', '#9468d9', '#ef7d3c', '#2aa893', '#e36299', '#5e6cd6', '#e3ae24', '#8f7056'];

  function paintSubj() {
    const subs = store.get().subjects;
    const on = (id) => (dlg.subjectId || '') === id;
    $('#pl-subj').innerHTML = subs.map((s) => `<button type="button" class="chip${on(s.id) ? ' active' : ''}" data-pl-subj="${esc(s.id)}" role="radio" aria-checked="${on(s.id)}"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</button>`).join('') +
      `<button type="button" class="chip${on('') ? ' active' : ''}" data-pl-subj="" role="radio" aria-checked="${on('')}">과목 없음</button>` +
      '<button type="button" class="chip pl-chip-new" data-pl-newsub>＋ 새 과목</button>';
  }
  function setEst(v) {
    const sel = $('#pl-est');
    sel.querySelectorAll('option[data-extra]').forEach((o) => o.remove());
    const n = +v > 0 ? Math.round(+v) : 0;
    if (n && !EST_OPTS.includes(n)) {
      const o = document.createElement('option');
      o.value = String(n); o.textContent = fm(n); o.dataset.extra = '1';
      const after = [...sel.options].find((x) => +x.value > n);
      sel.insertBefore(o, after || sel.querySelector('option[value="custom"]'));
    }
    sel.value = n ? String(n) : '';
    $('#pl-est-custom-f').hidden = true;
    $('#pl-est-custom').value = '';
  }
  // 예상 시간(분). 비었으면 null, 잘못 적었으면 false
  function readEst() {
    const v = $('#pl-est').value;
    if (v !== 'custom') return +v > 0 ? +v : null;
    const raw = $('#pl-est-custom').value.trim();
    if (!raw) return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 1 && n <= 1440 ? n : false;
  }
  function paintRep() {
    $$('[data-pl-rep]').forEach((b) => { const on = b.dataset.plRep === dlg.rep; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#pl-days').hidden = dlg.rep !== 'weekly';
    $('#pl-until-f').hidden = !dlg.rep;
    $$('[data-pl-wd]').forEach((b) => { const on = dlg.days.has(+b.dataset.plWd); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    repSum();
  }
  // 반복 줄 아래 한 줄: '11월 29일까지 매일 · 13개'
  function repSum() {
    const el = $('#pl-rep-sum');
    const date = $('#pl-date').value;
    if (!dlg.rep) { el.hidden = true; return; }
    el.hidden = false;
    if (!S.isKey(date)) { el.textContent = '반복하려면 날짜를 먼저 정해 주세요'; return; }
    const days = dlg.rep === 'daily' ? ALL_DAYS : [...dlg.days];
    if (!days.length) { el.textContent = '반복할 요일을 골라 주세요'; return; }
    const until = $('#pl-until').value;
    const list = P.repeatDates(date, days, until);
    el.textContent = list.length ? `${P.repText({ days })} · ${list.length}개 (${P.shortDay(list[list.length - 1])}까지)${list.length >= P.REP_MAX ? ' · 한 번에 이만큼까지 넣어요' : ''}` : '이 기간에는 고른 요일이 없어요';
  }
  function setRep(r) {
    dlg.rep = r === 'daily' || r === 'weekly' ? r : '';
    const date = $('#pl-date').value;
    if (dlg.rep === 'weekly' && !dlg.days.size && S.isKey(date)) dlg.days.add(S.weekday(date));
    if (dlg.rep && S.isKey(date) && (!S.isKey($('#pl-until').value) || $('#pl-until').value < date)) $('#pl-until').value = P.defaultUntil(date, store.get().exams);
    paintRep();
  }

  // opts: { id } 고치기 / { date('YYYY-MM-DD', ''이면 날짜 안 정함), subjectId } 추가
  function openDlg(opts) {
    opts = opts || {};
    const st = store.get();
    const t = opts.id ? st.tasks.find((x) => x.id === opts.id) : null;
    dlg = { id: t ? t.id : null, subjectId: t ? t.subjectId || '' : opts.subjectId != null ? opts.subjectId : lastSubject, rep: '', days: new Set(), back: document.activeElement };
    if (dlg.subjectId && !subjOf(dlg.subjectId)) dlg.subjectId = '';
    $('#pl-dlg-h').textContent = t ? '할 일 고치기' : '할 일 추가';
    $('#pl-save').textContent = t ? '저장' : '추가';
    $('#pl-title').value = t ? t.title : '';
    $('#pl-date').value = t ? t.due || '' : opts.date != null ? opts.date : viewKey();
    setEst(t ? t.estimateMin : null);
    paintSubj();
    $('#pl-newsub').hidden = true;
    $('#pl-newsub-name').value = '';
    // 반복: 새 할 일이나 반복이 아닌 할 일만 고를 수 있다. 반복 할 일·범위와 이은 할 일은 알려 주기만
    const series = t && t.rep ? P.seriesFrom(st.tasks, t) : [];
    const linked = !!(t && t.topicId && st.topics.some((n) => n.id === t.topicId));
    $('#pl-rep-f').hidden = !!(t && (t.rep || linked));
    $('#pl-until').value = '';
    setRep('');
    $('#pl-rep-info').hidden = !(t && t.rep);
    if (t && t.rep) $('#pl-rep-info').textContent = `반복 할 일 · ${P.repText(t.rep)}${series.length > 1 ? ` · 이 날부터 ${series.length}개` : ''}`;
    $('#pl-link-info').hidden = !linked;
    $('#pl-scope-btn').hidden = !!t || !featOn('board');
    $('#pl-del').hidden = !t;
    $('#pl-dlg').hidden = false;
    try { $('#pl-title').focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }
  function closeDlg() {
    $('#pl-dlg').hidden = true;
    const back = dlg && dlg.back;
    dlg = null;
    try { if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }

  async function saveDlg(e) {
    e.preventDefault();
    if (!dlg) return;
    const title = $('#pl-title').value.replace(/\s+/g, ' ').trim();
    if (!title) { toast('할 일을 적어 주세요'); $('#pl-title').focus(); return; }
    const due = S.isKey($('#pl-date').value) ? $('#pl-date').value : null;
    const est = readEst();
    if (est === false) { toast('예상 시간을 1~1440분으로 적어 주세요'); $('#pl-est-custom').focus(); return; }
    const subjectId = dlg.subjectId || null;
    let rep = null;
    if (dlg.rep) {
      if (!due) { toast('반복하려면 날짜를 정해 주세요'); return; }
      const days = dlg.rep === 'daily' ? ALL_DAYS : [...dlg.days];
      if (!days.length) { toast('반복할 요일을 골라 주세요'); return; }
      const until = $('#pl-until').value;
      if (!S.isKey(until) || until < due) { toast('언제까지를 날짜와 같거나 뒤로 정해 주세요'); return; }
      rep = { days, until };
    }
    lastSubject = subjectId || '';
    const st = store.get();
    if (dlg.id) {
      const t = st.tasks.find((x) => x.id === dlg.id);
      if (!t) { closeDlg(); return; }
      let all = false;
      const series = P.seriesFrom(st.tasks, t);
      const changed = title !== t.title || subjectId !== (t.subjectId || null) || (est || null) !== (t.estimateMin || null);
      if (t.rep && series.length > 1 && changed) {
        const pick = await App.choose('반복 할 일을 어떻게 바꿀까요?', [
          { value: 'one', label: '이 날만', hint: t.due ? P.dayTitle(t.due) : '' },
          { value: 'all', label: '이 날부터 앞으로 모두', hint: `${series.length}개 · 날짜는 이 날만 바뀌어요` },
        ]);
        if (!pick) return;
        all = pick === 'all';
      }
      // 반복이 아니던 할 일을 반복으로 바꾸면, 이 날 다음부터 같은 할 일을 넣는다
      const more = rep && !t.rep ? P.makeTasks({ title, subjectId, due, estimateMin: est, rep }, { uid, now: now() }).filter((x) => x.due !== due) : [];
      store.update((s) => {
        P.editTask(s, t.id, { title, subjectId, due, estimateMin: est }, now(), all);
        if (rep && !t.rep) {
          const x = s.tasks.find((y) => y.id === t.id);
          if (x) x.rep = { id: more.length ? more[0].rep.id : uid(), days: rep.days.slice().sort() };
          s.tasks.push(...more);
        }
      });
      closeDlg();
      toast(more.length ? `할 일을 고치고 ${more.length}개를 더 넣었어요` : '할 일을 고쳤어요');
      return;
    }
    const list = P.makeTasks({ title, subjectId, due, estimateMin: est, rep }, { uid, now: now() });
    if (!list.length) { toast(rep ? '이 기간에는 고른 요일이 없어요' : '할 일을 적어 주세요'); return; }
    store.update((s) => { s.tasks.push(...list); });
    closeDlg();
    if (rep) toast(`${P.repText({ days: rep.days })} 할 일 ${list.length}개를 넣었어요 (${P.shortDay(list[list.length - 1].due)}까지)`);
    else if (!due) toast('날짜 안 정한 할 일에 넣었어요');
    else if (App.view === 'plan' && mode === 'day' && due === viewKey()) toast('할 일을 넣었어요');
    else toast(`${withJosa(due, '에/에')} 넣었어요`, App.view === 'plan' || featOn('plan') ? { action: '보기', onAction: () => open(due) } : undefined);
  }

  function addSubject() {
    const name = $('#pl-newsub-name').value.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) { $('#pl-newsub-name').focus(); return; }
    const subs = store.get().subjects;
    const same = subs.find((s) => s.name === name);
    if (same) { dlg.subjectId = same.id; }
    else {
      const used = new Set(subs.map((s) => String(s.color).toLowerCase()));
      const color = SUBJ_COLORS.find((c) => !used.has(c)) || SUBJ_COLORS[subs.length % SUBJ_COLORS.length];
      const id = uid();
      store.update((st) => st.subjects.push({ id, name, color }));
      dlg.subjectId = id;
      toast(`'${name}' 과목을 만들었어요`);
    }
    $('#pl-newsub').hidden = true;
    $('#pl-newsub-name').value = '';
    paintSubj();
  }

  $('#pl-form').addEventListener('submit', saveDlg);
  $('#pl-cancel').addEventListener('click', closeDlg);
  $('#pl-del').addEventListener('click', () => {
    const t = dlg && dlg.id ? taskOf(dlg.id) : null;
    closeDlg();
    if (t) removeTask(t);
  });
  $('#pl-scope-btn').addEventListener('click', async () => {
    const key = S.isKey($('#pl-date').value) ? $('#pl-date').value : viewKey();
    const n = await openScope(key);
    if (n) closeDlg();
  });
  $('#pl-dlg').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.querySelector('.ui-back.in')) { e.preventDefault(); closeDlg(); return; }
    if (e.key === 'Enter' && e.target.id === 'pl-newsub-name') { e.preventDefault(); addSubject(); }
  });
  $('#pl-dlg').addEventListener('click', (e) => {
    if (e.target === $('#pl-dlg')) { closeDlg(); return; }
    if (!dlg) return;
    const sb = e.target.closest('[data-pl-subj]');
    if (sb) { dlg.subjectId = sb.dataset.plSubj; paintSubj(); return; }
    if (e.target.closest('[data-pl-newsub]')) { $('#pl-newsub').hidden = false; $('#pl-newsub-name').focus(); return; }
    if (e.target.closest('#pl-newsub-ok')) { addSubject(); return; }
    const r = e.target.closest('[data-pl-rep]');
    if (r) { setRep(r.dataset.plRep); return; }
    const d = e.target.closest('[data-pl-wd]');
    if (d) { const n = +d.dataset.plWd; if (dlg.days.has(n)) dlg.days.delete(n); else dlg.days.add(n); paintRep(); }
  });
  $('#pl-est').addEventListener('change', () => {
    const custom = $('#pl-est').value === 'custom';
    $('#pl-est-custom-f').hidden = !custom;
    if (custom) $('#pl-est-custom').focus();
  });
  // 날짜를 바꾸면: 요일마다 반복의 요일이 하나뿐이면 그 요일도 따라가고, 언제까지가 날짜보다 앞서면 다시 정한다
  $('#pl-date').addEventListener('change', () => {
    if (!dlg) return;
    const v = $('#pl-date').value;
    if (dlg.rep === 'weekly' && S.isKey(v) && dlg.days.size <= 1) dlg.days = new Set([S.weekday(v)]);
    if (dlg.rep && S.isKey(v) && (!S.isKey($('#pl-until').value) || $('#pl-until').value < v)) $('#pl-until').value = P.defaultUntil(v, store.get().exams);
    paintRep();
  });
  $('#pl-until').addEventListener('change', repSum);

  /* ---------- 범위에서 고르기 ---------- */
  // 그날(key) 할 일로 넣을 범위 항목을 여러 개 고른다. 넣은 개수를 돌려준다
  async function openScope(key) {
    const st = store.get();
    const groups = P.scopeChoices(st, today());
    if (!groups.length) {
      const go = await App.ask(st.exams.length ? '남은 범위가 없어요. 범위 탭에서 공부할 내용을 적어 보세요.' : '아직 시험 범위가 없어요.\n범위 탭에서 시험과 공부할 내용을 먼저 적어 보세요.', { ok: '범위 탭 열기', cancel: '닫기' });
      if (go) { if (!$('#pl-dlg').hidden) closeDlg(); App.go('board'); }
      return 0;
    }
    const chosen = new Set();
    const okText = () => (chosen.size ? `${chosen.size}개를 ${withJosa(key, '에/에')} 넣기` : '넣을 범위를 골라 주세요');
    const body = groups.map((g) => `<p class="ui-group pl-sc-exam">${esc(g.exam.name)}${g.days !== null ? ` <small>${P.ddayText(g.days)}</small>` : ''}</p>` +
      g.cards.map((c) => `<p class="pl-sc-card"><i class="dot" style="background:${esc(c.card.color || '#888')}"></i>${esc(c.card.title)}</p>` +
        c.items.map((it) => {
          const hint = [it.path.join(' · '), it.left ? '남은 ' + fm(it.left) : '', it.planned !== null ? (it.planned ? P.shortDay(it.planned) + '에 넣어 둠' : '날짜 없이 넣어 둠') : ''].filter(Boolean).join(' · ');
          return `<button type="button" class="pl-sc-item${it.planned !== null ? ' planned' : ''}" data-pl-sc="${esc(it.n.id)}" role="checkbox" aria-checked="false"><span class="pl-sc-box">${ic('check')}</span><span class="pl-sc-text"><b>${esc(it.n.title)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span></button>`;
        }).join('')).join('')).join('') +
      `<div class="pl-sc-foot"><button type="button" class="btn primary" data-pl-sc-ok disabled>${okText()}</button></div>`;
    const ids = await window.UI.openSheet({
      title: `범위에서 고르기 · ${P.shortDay(key)}`, body, cls: 'pl-scope-sheet', focusSel: '.pl-sc-item',
      onClick: (e, close) => {
        const b = e.target.closest('[data-pl-sc]');
        if (b) {
          const id = b.dataset.plSc;
          if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
          b.classList.toggle('on', chosen.has(id));
          b.setAttribute('aria-checked', String(chosen.has(id)));
          const ok = e.currentTarget.querySelector('[data-pl-sc-ok]');
          ok.disabled = !chosen.size;
          ok.textContent = okText();
          return;
        }
        if (e.target.closest('[data-pl-sc-ok]') && chosen.size) close([...chosen]);
      },
    });
    if (!ids || !ids.length) return 0;
    const made = [];
    store.update((s) => {
      ids.forEach((id, i) => { const t = P.topicTask(s, id, key, { uid, now: now() + i }); if (t) { s.tasks.push(t); made.push(t); } });
    });
    if (made.length) toast(`범위 ${made.length}개를 ${withJosa(key, '에/에')} 넣었어요 · 끝내면 범위에도 체크돼요`, App.view === 'plan' && mode === 'day' && key === viewKey() ? undefined : { action: '보기', onAction: () => open(key) });
    return made.length;
  }

  // 범위 탭 ⋯ '플래너에 넣기': 오늘·내일·날짜 고르기
  async function placeTopic(topicId) {
    const st = store.get();
    const n = st.topics.find((x) => x.id === topicId);
    if (!n) return;
    const tk = today(), tm = S.shiftKey(tk, 1);
    const already = st.tasks.find((t) => t.topicId === topicId && !t.done);
    const pick = await App.choose(`'${n.title}' 언제 할까요?`, [
      { value: tk, label: '오늘', hint: P.dayTitle(tk) },
      { value: tm, label: '내일', hint: P.dayTitle(tm) },
      { value: 'pick', label: '날짜 고르기…', hint: '달력에서 아무 날이나' },
    ], { note: already ? `이미 ${already.due ? P.dayTitle(already.due) : '날짜 안 정한 할 일'}에 넣어 둔 범위예요. 한 번 더 넣을 수 있어요.` : '플래너 할 일로 넣어요. 끝내면 이 범위에도 체크돼요.' });
    if (!pick) return;
    const key = pick === 'pick' ? await openMonth({ title: '어느 날 할까요?', sel: tm, ok: '이날에 넣기' }) : pick;
    if (!key) return;
    let t = null;
    store.update((s) => { t = P.topicTask(s, topicId, key, { uid, now: now() }); if (t) s.tasks.push(t); });
    if (t) toast(`${withJosa(key, '에/에')} 넣었어요`, featOn('plan') ? { action: '보기', onAction: () => open(key) } : undefined);
  }

  /* ---------- 누르기 ---------- */
  function open(key) {
    sel = key && S.isKey(key) && key !== today() ? key : null;
    mode = 'day';
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 무시 */ }
    if (App.view === 'plan') { render(); window.scrollTo(0, 0); } else App.go('plan');
  }
  function setMode(m) {
    mode = m === 'week' ? 'week' : 'day';
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 무시 */ }
    render();
  }
  const pickDay = (k) => { sel = k === today() ? null : k; goalEdit = null; render(); };

  // 다른 화면(스톱워치 등)의 '과목 만들기': 플래너 맨 아래 과목 관리를 펼쳐 보여 준다
  function showSubjects() {
    if (App.view !== 'plan') App.go('plan');
    const f = $('#pl-subjects-fold');
    f.open = true;
    requestAnimationFrame(() => {
      try { f.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { f.scrollIntoView(); }
      const i = $('#s-name');
      if (i) i.focus({ preventScroll: true });
    });
  }

  document.addEventListener('change', (e) => {
    const c = e.target.closest && e.target.closest('.pl-check');
    if (!c) return;
    const li = c.closest('[data-pl-id]');
    if (li && !App.setTaskDone(li.dataset.plId, c.checked)) c.checked = !c.checked; // 그사이 지워진 할 일
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pl-subjects]')) { e.preventDefault(); showSubjects(); return; }
    const zone = e.target.closest('#view-plan, #h-tasks-panel');
    if (!zone || e.target.closest('[data-tt-open]')) return; // 일정 시각·타임테이블 단추는 timetable.js가 연다
    const b = e.target.closest('[data-pl-mode], [data-pl-nav], [data-pl-today], [data-pl-cal], [data-pl-day], [data-pl-open], [data-pl-goal], [data-pl-add], [data-pl-scope], [data-pl-carry], [data-pl-carry-open], [data-pl-evadd], [data-pl-play], [data-pl-more], [data-pl-place]');
    if (!b || e.target.closest('.pl-check')) return;
    const d = b.dataset;
    const id = b.closest('[data-pl-id]') ? b.closest('[data-pl-id]').dataset.plId : null;
    if ('plMode' in d) setMode(d.plMode);
    else if ('plNav' in d) pickDay(S.shiftKey(viewKey(), +d.plNav));
    else if ('plToday' in d) pickDay(today());
    else if ('plCal' in d) { const k = await openMonth({ sel: viewKey(), ok: mode === 'week' ? '이 주 보기' : '이날 열기' }); if (k) pickDay(k); }
    else if ('plDay' in d) pickDay(d.plDay);
    else if ('plOpen' in d) { sel = d.plOpen === today() ? null : d.plOpen; setMode('day'); window.scrollTo(0, 0); }
    else if ('plGoal' in d) startGoal();
    else if ('plAdd' in d) openDlg({ date: d.plAdd === 'today' ? today() : d.plAdd });
    else if ('plScope' in d) openScope(viewKey());
    else if ('plCarry' in d) carry();
    else if ('plCarryOpen' in d) { carryOpen = !carryOpen; render(); }
    else if ('plEvadd' in d) { if (window.Events) window.Events.open({ date: d.plEvadd }); }
    else if (id && 'plPlay' in d) { const t = taskOf(id); if (t) startTask(t); }
    else if (id && 'plPlace' in d) { const t = taskOf(id); if (t) moveTo(t, viewKey()); }
    else if (id && 'plMore' in d) openMenu(id);
  });

  window.Planner = { render, renderHome, open, setMode, openAdd: openDlg, pickDay: openMonth, placeTopic, addFromScope: openScope, showSubjects, get day() { return viewKey(); }, get mode() { return mode; } };
  render();
})();
