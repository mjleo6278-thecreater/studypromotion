/* 스터디 플래너 화면 (계획 탭 자리): 오늘과 앞날의 할 일을 날짜별로 적고 체크한다.
   계산은 js/plan.js(window.Plan), 끝냄은 App.setTaskDone, 일정은 js/events.js, 시간 띠는 js/timetable.js가 맡는다.
   - 하루: 주간 띠(날짜·과목 색 점) → 그날 요약(D-day·목표·진행률) → 할 일 → 시간 계획(띠·일정) → 돌아보기·메모
   - 주간: 월~일 날짜별 할 일. 달력 창(📅)에서 아무 날이나 고른다
   - 맨 아래: 날짜 안 정한 할 일, 과목 관리 (과목 목록은 app.js가 그린다), 복습 선생님, 장소·시간 목록
   홈의 '오늘 할 일' 칸과 요약 카드도 여기서 그린다 (플래너의 오늘 칸).
   v3.10 (종이 플래너처럼): 할 일 한 줄 = [왼쪽 장소·시간 칸][과목 색 줄][이름·메타][▶][오른쪽 진행 칸 빈칸→○→△].
   목록은 과목 순, 장소를 정한 날은 장소 순. 할 일 맨 위 복습 줄. 그날 처음 열면 지난 날 못 끝낸 일을 옮길지 묻는다. */
(function () {
  'use strict';
  const App = window.App, P = window.Plan, S = window.Schedule;
  if (!App || !P || !S || !document.getElementById('view-plan')) return;
  const { store, $, $$, esc, toast, ic, uid } = App;
  const now = () => App.now();
  const fm = Stats.formatMinutes;
  const today = () => App.todayKey();
  const featOn = (id) => !window.Features || window.Features.on(id);
  const slotOn = () => featOn('plslot');
  const sortOf = (list) => P.sortDay(store.get(), list, { noSlot: !slotOn() });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MODE_KEY = 'studypromotion.plMode';
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const EST_OPTS = [10, 15, 20, 30, 40, 45, 60, 90, 120, 180];
  const ASK_KEY = 'studypromotion.plCarryAsk'; // 어제 못 끝낸 일을 물어본 날 (이 기기)
  // 동글동글한 ○·△ (굵고 둥근 선)
  const MARK_SVG = {
    o: '<svg class="pl-mk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.9"/></svg>',
    t: '<svg class="pl-mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.2 18.9 17.4H5.1z"/></svg>',
    '': '',
  };
  const MARK_NAME = { '': '아직 안 함', o: '끝냄(○)', t: '덜 끝냄(△)' };
  const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

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
  // 오른쪽 진행 칸: 누를 때마다 빈칸 → ○ → △ → 빈칸
  let drawn = null; // 방금 누른 진행 칸 { id, at }: 그 칸만 톡 튀어나오는 움직임
  function markHTML(t, sm) {
    const m = P.markOf(t);
    const draw = m && drawn && drawn.id === t.id && Date.now() - drawn.at < 900;
    return `<button type="button" class="pl-mark${sm ? ' sm' : ''}${m ? ' ' + m : ''}${draw ? ' pop' : ''}" data-pl-mark aria-label="${esc(t.title)} ${MARK_NAME[m]}. 누르면 ${MARK_NAME[P.nextMark(m)]}">${MARK_SVG[m]}</button>`;
  }
  // 왼쪽 장소·시간 칸 (정하지 않아도 된다)
  function slotHTML(t) {
    if (!slotOn()) return '';
    const x = P.slotOf(store.get(), t);
    return `<button type="button" class="pl-slot${x ? '' : ' empty'}" data-pl-slot data-feature="plslot" aria-label="${x ? `장소·시간 ${esc(x.name)}, 바꾸기` : '장소·시간 정하기'}">${x ? esc(x.name) : '장소'}</button>`;
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
    const mark = P.markOf(t);
    const meta = [];
    if (s) meta.push(`<span class="pl-sub">${esc(s.name)}</span>`);
    if (opts.dated && t.due) meta.push(`<span class="overdue">${esc(P.shortDay(t.due))}</span>`);
    if (+t.estimateMin > 0) meta.push(`<span>${fm(+t.estimateMin)}</span>`);
    const ft = opts.dated ? '' : P.fromText(t, tk);
    if (ft && !t.done) meta.push(`<span class="pl-tag from" title="${esc(P.dayTitle(t.from))}에서 옮겨 온 할 일">${ic('carry')}${esc(ft)}</span>`);
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
    return `<li class="pl-item${mark === 'o' ? ' done' : ''}${mark === 't' ? ' part' : ''}${liveMin !== null ? ' live' : ''}" data-pl-id="${esc(t.id)}" style="--c:${esc(colorOf(t))}">` +
      slotHTML(t) +
      `<div class="pl-body" data-pl-more><button type="button" class="pl-title" data-pl-more aria-label="${esc(t.title)}${mark === 't' ? ' (덜 끝냄)' : ''}, 메뉴 열기">${esc(t.title)}</button>${meta.length ? `<div class="pl-meta">${meta.join('')}</div>` : ''}</div>` +
      right + markHTML(t) + '</li>';
  }
  // 복습 줄: 그날 수업 있는 선생님 이름, 누르면 체크. where 'plan'이면 아직 아무도 없을 때 적어 두라고 알려 준다
  function reviewHTML(key, where) {
    if (!featOn('plreview')) return '';
    const st = store.get();
    const list = P.teachersOn(st, key);
    if (!list.length) {
      if (where !== 'plan' || P.teacherList(st).length) return '';
      return `<div class="pl-rv empty" data-feature="plreview"><span class="pl-rv-h">복습</span><button type="button" class="btn link pl-rv-add" data-pl-rv-setup>＋ 수업 복습을 체크할 선생님 이름 적기</button></div>`;
    }
    const done = new Set(P.reviewedOn(st, key));
    const n = list.filter((t) => done.has(t.id)).length;
    return `<div class="pl-rv" data-feature="plreview" role="group" aria-label="복습 ${list.length}명 중 ${n}명 체크"><span class="pl-rv-h" aria-hidden="true">복습<small>${n}/${list.length}</small></span><div class="pl-rv-names">` +
      list.map((t) => {
        const on = done.has(t.id);
        const sb = subjOf(t.subjectId);
        return `<button type="button" class="pl-rv-name${on ? ' on' : ''}" data-pl-rv="${esc(t.id)}" data-pl-rv-day="${key}" aria-pressed="${on}" aria-label="${esc(sb ? sb.name + ' ' : '')}${esc(t.name)} 복습" style="--c:${esc(sb ? sb.color : 'var(--muted)')}">${on ? ic('check') : '<i></i>'}${esc(t.name)}</button>`;
      }).join('') + '</div></div>';
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
      const studied = Math.min(Stats.DAY_MAX, P.studyMinutes(st.sessions, key) + (key === tk ? liveTodayMin() : 0));
      const pct = sum.total ? Math.round((sum.done / sum.total) * 100) : 0;
      prog = `<div class="pl-prog"><div class="pl-prog-top"><b>할 일 ${sum.done} / ${sum.total}${sum.part ? `<em class="pl-part-n" title="덜 끝낸 일">△ ${sum.part}</em>` : ''}</b><span>${sum.planMin ? `계획 ${fm(sum.planMin)} · ` : ''}공부 <b class="pl-studied">${fm(studied)}</b></span></div>` +
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
    const empty = key < tk ? '이날 적어 둔 할 일이 없어요.' : key === tk ? '오늘 할 일을 적어 보세요. 끝내면 오른쪽 칸을 눌러 ○, 덜 끝냈으면 한 번 더 눌러 △.' : '이날 할 일을 미리 적어 두세요.';
    const sorted = sortOf(sum.list);
    const by = sum.list.length > 1 ? `<small class="pl-sort">${sorted.by === 'slot' ? '장소·시간 순' : '과목 순'}</small>` : '';
    return `<div class="panel-head"><h2>할 일${by}</h2>${featOn('board') ? `<button type="button" class="btn link pl-scope" data-pl-scope data-feature="board">${ic('board')}범위에서 고르기</button>` : ''}</div>` +
      reviewHTML(key, 'plan') +
      (key === tk ? carryHTML() : '') +
      `<ul class="pl-list" id="pl-list">${sorted.list.length ? sorted.list.map((t) => rowHTML(t)).join('') : `<li class="empty">${empty}</li>`}</ul>` +
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
      const lis = sortOf(sum.list).list.map((t) => {
        const m = P.markOf(t);
        const x = slotOn() ? P.slotOf(st, t) : null;
        return `<li class="pl-wi${m === 'o' ? ' done' : ''}${m === 't' ? ' part' : ''}" data-pl-id="${esc(t.id)}"><i class="dot" style="background:${esc(colorOf(t))}"></i>` +
          `<button type="button" class="t" data-pl-more>${esc(t.title)}</button>${x ? `<small class="pl-wslot">${esc(x.name)}</small>` : ''}${+t.estimateMin > 0 ? `<small>${fm(+t.estimateMin)}</small>` : ''}${markHTML(t, true)}</li>`;
      }).join('');
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
    if (App.view === 'home') { renderHome(); maybeAsk(); return; }
    if (App.view !== 'plan') return;
    paintMode();
    if (mode === 'week') renderWeek(); else renderDay();
    renderUndated();
    $('#pl-subj-n').textContent = store.get().subjects.length + '과목';
    renderTeachers();
    renderSlots();
    maybeAsk();
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
    setHTML($('#h-pl-top'), (note.goal ? `<p class="pl-home-goal"><span>오늘의 목표</span><b>${esc(note.goal)}</b></p>` : '') + reviewHTML(tk, 'home') + carryHTML());
    setHTML(list, sum.list.length ? sortOf(sum.list).list.map((t) => rowHTML(t)).join('')
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
    if (sd && App.view === 'plan' && mode === 'day' && viewKey() === today()) sd.textContent = fm(Math.min(Stats.DAY_MAX, P.studyMinutes(store.get().sessions, today()) + liveTodayMin()));
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
    let prev = [];
    store.update((st) => { const p = P.moveTask(st, t.id, key, now()); if (p) prev = [p]; });
    if (!prev.length) return;
    // 그날에 같은 일이 이미 있으면 한 줄로 합쳐진다 (4.4.1)
    const msg = !key ? '날짜 안 정한 할 일로 옮겼어요' : prev[0].merged ? `${withJosa(key, '에/에')} 같은 할 일이 있어서 한 줄로 합쳤어요` : `${withJosa(key, '으로/로')} 옮겼어요`;
    toast(msg, { action: '되돌리기', onAction: () => store.update((st) => P.restoreMoves(st, prev)) });
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

  /* ---------- 지난 날 못 끝낸 일 옮기기 ---------- */
  // 고르는 창: 체크한 것만 오늘로. 세모·장소·잰 시간은 할 일에 붙어 있어서 같이 간다. 반환 옮긴 개수
  async function openCarry() {
    const tk = today(), y = S.shiftKey(tk, -1);
    const st = store.get();
    const ch = P.carryChoices(st, tk);
    if (!ch.length) { toast('옮길 할 일이 없어요'); return 0; }
    const chosen = new Set(ch.filter((o) => o.on).map((o) => o.t.id));
    const onlyY = ch.every((o) => o.t.due === y);
    const many = new Set(ch.map((o) => o.t.due)).size > 1;
    let last = null;
    const items = ch.map(({ t, merge }) => {
      let h = '';
      if (many && t.due !== last) { last = t.due; h = `<p class="ui-group pl-cy-day">${esc(P.dayTitle(t.due))} · ${esc(P.relDay(t.due, tk))}</p>`; }
      const on = chosen.has(t.id);
      const sb = subjOf(t.subjectId);
      const m = P.markOf(t);
      const x = slotOn() ? P.slotOf(st, t) : null;
      const got = P.taskMinutes(st.sessions, t);
      const sub = [sb ? sb.name : '', +t.estimateMin > 0 ? fm(+t.estimateMin) : '', x ? x.name : '', got ? '공부 ' + fm(got) : '', P.repText(t.rep)].filter(Boolean).join(' · ');
      return h + `<button type="button" class="pl-sc-item pl-cy-item${on ? ' on' : ''}" data-pl-cy="${esc(t.id)}" role="checkbox" aria-checked="${on}"><span class="pl-sc-box">${ic('check')}</span>` +
        `<span class="pl-sc-text"><b>${esc(t.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}${merge ? '<small class="pl-cy-twin">오늘에도 있어요 · 옮기면 한 줄로 합쳐져요</small>' : ''}</span><span class="pl-cy-mark${m ? ' ' + m : ''}" title="${MARK_NAME[m]}">${MARK_SVG[m]}</span></button>`;
    }).join('');
    const okText = () => (chosen.size ? `${chosen.size}개 오늘로 옮기기` : '옮길 일을 골라 주세요');
    const lead = onlyY ? `어제 ${P.dayTitle(y)}에 덜 끝낸 할 일이에요.` : '지난 날 덜 끝낸 할 일이에요.';
    const body = `<div class="pl-cy"><p class="pl-cy-sub">${esc(lead)}<br>오늘 할 것만 체크해 두고 옮겨요.</p>${items}` +
      `<p class="pl-cy-note">세모(△) 표시와 그동안 잰 공부 시간${slotOn() ? ', 정해 둔 장소' : ''}도 같이 옮겨져요. 옮기지 않은 일은 그날 칸에 남고, 오늘 칸 위 띠에서 나중에 옮길 수 있어요.</p>` +
      `<div class="pl-cy-foot"><button type="button" class="btn" data-pl-cy-no>그대로 두기</button><button type="button" class="btn primary" data-pl-cy-ok${chosen.size ? '' : ' disabled'}>${okText()}</button></div></div>`;
    const ids = await window.UI.openSheet({
      title: `${onlyY ? '어제' : '지난 날'} 못 끝낸 할 일 ${ch.length}개`, body, cls: 'pl-scope-sheet pl-cy-sheet', focusSel: '[data-pl-cy-ok]',
      onClick: (e, close) => {
        const b = e.target.closest('[data-pl-cy]');
        if (b) {
          const id = b.dataset.plCy;
          if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
          b.classList.toggle('on', chosen.has(id));
          b.setAttribute('aria-checked', String(chosen.has(id)));
          const ok = e.currentTarget.querySelector('[data-pl-cy-ok]');
          ok.disabled = !chosen.size;
          ok.textContent = okText();
          return;
        }
        if (e.target.closest('[data-pl-cy-no]')) { close(null); return; }
        if (e.target.closest('[data-pl-cy-ok]') && chosen.size) close([...chosen]);
      },
    });
    if (!ids || !ids.length) return 0;
    let prev = [];
    store.update((s) => { prev = P.carryOver(s, today(), now(), ids); });
    if (!prev.length) return 0;
    carryOpen = false;
    const merged = prev.filter((p) => p.merged).length;
    const msg = !merged ? `할 일 ${prev.length}개를 오늘로 옮겼어요`
      : merged === prev.length ? `오늘에 같은 할 일이 있어서 한 줄로 합쳤어요${merged > 1 ? ` (${merged}개)` : ''}`
      : `할 일 ${prev.length}개를 오늘로 옮겼어요 · ${merged}개는 같은 할 일과 한 줄로 합쳤어요`;
    toast(msg, { action: '되돌리기', onAction: () => store.update((s) => P.restoreMoves(s, prev)) });
    return prev.length;
  }
  // 그날 처음 홈이나 플래너를 열면 한 번 묻는다 (시작 화면·잠금·다른 창이 없어지고, 계정 기록과 맞춘 뒤)
  const askedToday = () => { try { return localStorage.getItem(ASK_KEY) === today(); } catch (e) { return true; } };
  const markAsked = () => { try { localStorage.setItem(ASK_KEY, today()); } catch (e) { /* 무시 */ } };
  let asking = false;
  async function maybeAsk() {
    if (asking || askedToday() || !featOn('plan') || !featOn('plcarry')) return;
    if (navigator.webdriver && !window.__plCarryTest) return; // 화면 시험에서는 시험이 직접 켤 때만 (시작 화면과 같게)
    if (!P.carryChoices(store.get(), today()).length) return;
    asking = true;
    const t0 = Date.now();
    const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
    const free = () => !document.hidden && !document.getElementById('splash') && !(window.Lock && window.Lock.state) && $('#ask').hidden && $('#pl-dlg').hidden &&
      !document.querySelector('.ui-back:not(.out)') && !document.querySelector('.ask-backdrop:not([hidden])') && !typing() && (App.view === 'home' || App.view === 'plan');
    const cloudBusy = () => window.Cloud && window.Cloud.syncing && Date.now() - t0 < 8000;
    try {
      while (!free() || cloudBusy()) {
        if (Date.now() - t0 > 60000) return; // 1분 넘게 바쁘면 다음에 화면을 그릴 때 다시
        await sleep(400);
      }
    } finally { asking = false; }
    if (askedToday() || !P.carryChoices(store.get(), today()).length) return;
    markAsked();
    openCarry();
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
  let dlg = null; // { id(고치는 할 일), subjectId, slotId, rep: ''|'daily'|'weekly', days: Set, back }
  let lastSubject = '';
  const SUBJ_COLORS = ['#e05a4f', '#3d96e0', '#45a865', '#9468d9', '#ef7d3c', '#2aa893', '#e36299', '#5e6cd6', '#e3ae24', '#8f7056'];

  function paintSubj() {
    const subs = store.get().subjects;
    const on = (id) => (dlg.subjectId || '') === id;
    $('#pl-subj').innerHTML = subs.map((s) => `<button type="button" class="chip${on(s.id) ? ' active' : ''}" data-pl-subj="${esc(s.id)}" role="radio" aria-checked="${on(s.id)}"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)}</button>`).join('') +
      `<button type="button" class="chip${on('') ? ' active' : ''}" data-pl-subj="" role="radio" aria-checked="${on('')}">과목 없음</button>` +
      '<button type="button" class="chip pl-chip-new" data-pl-newsub>＋ 새 과목</button>';
  }
  function paintSlotChips() {
    const list = P.slotList(store.get());
    const on = (id) => (dlg.slotId || '') === id;
    $('#pl-slot-chips').innerHTML = list.map((x) => `<button type="button" class="chip${on(x.id) ? ' active' : ''}" data-pl-slotc="${esc(x.id)}" role="radio" aria-checked="${on(x.id)}">${esc(x.name)}</button>`).join('') +
      `<button type="button" class="chip${on('') ? ' active' : ''}" data-pl-slotc="" role="radio" aria-checked="${on('')}">정하지 않음</button>`;
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
    dlg = { id: t ? t.id : null, subjectId: t ? t.subjectId || '' : opts.subjectId != null ? opts.subjectId : lastSubject, slotId: t ? t.slotId || '' : opts.slotId || '', rep: '', days: new Set(), back: document.activeElement };
    if (dlg.subjectId && !subjOf(dlg.subjectId)) dlg.subjectId = '';
    if (dlg.slotId && !P.slotList(st).some((x) => x.id === dlg.slotId)) dlg.slotId = '';
    $('#pl-dlg-h').textContent = t ? '할 일 고치기' : '할 일 추가';
    $('#pl-save').textContent = t ? '저장' : '추가';
    $('#pl-title').value = t ? t.title : '';
    $('#pl-date').value = t ? t.due || '' : opts.date != null ? opts.date : viewKey();
    setEst(t ? t.estimateMin : null);
    paintSubj();
    paintSlotChips();
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
    const slotId = slotOn() && dlg.slotId && P.slotList(store.get()).some((x) => x.id === dlg.slotId) ? dlg.slotId : null;
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
      const keepSlot = slotOn() ? slotId : t.slotId || null; // 장소 칸을 꺼 두었으면 고르던 장소는 그대로
      const changed = title !== t.title || subjectId !== (t.subjectId || null) || (est || null) !== (t.estimateMin || null) || keepSlot !== (t.slotId || null);
      if (t.rep && series.length > 1 && changed) {
        const pick = await App.choose('반복 할 일을 어떻게 바꿀까요?', [
          { value: 'one', label: '이 날만', hint: t.due ? P.dayTitle(t.due) : '' },
          { value: 'all', label: '이 날부터 앞으로 모두', hint: `${series.length}개 · 날짜는 이 날만 바뀌어요` },
        ]);
        if (!pick) return;
        all = pick === 'all';
      }
      // 반복이 아니던 할 일을 반복으로 바꾸면, 이 날 다음부터 같은 할 일을 넣는다
      const more = rep && !t.rep ? P.makeTasks({ title, subjectId, due, estimateMin: est, slotId: keepSlot, rep }, { uid, now: now() }).filter((x) => x.due !== due) : [];
      store.update((s) => {
        if (keepSlot) P.ensureSlots(s);
        P.editTask(s, t.id, { title, subjectId, due, estimateMin: est, slotId: keepSlot }, now(), all);
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
    const list = P.makeTasks({ title, subjectId, due, estimateMin: est, slotId, rep }, { uid, now: now() });
    if (!list.length) { toast(rep ? '이 기간에는 고른 요일이 없어요' : '할 일을 적어 주세요'); return; }
    store.update((s) => { if (slotId) P.ensureSlots(s); s.tasks.push(...list); });
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
    const sl = e.target.closest('[data-pl-slotc]');
    if (sl) { dlg.slotId = sl.dataset.plSlotc; paintSlotChips(); return; }
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

  /* ---------- 장소·시간 고르기 (할 일 왼쪽 칸) ---------- */
  async function openSlotPick(id) {
    const t = taskOf(id);
    if (!t) return;
    const list = P.slotList(store.get());
    const sb = subjOf(t.subjectId);
    const cur = t.slotId && list.some((x) => x.id === t.slotId) ? t.slotId : '';
    const opt = (x) => `<button type="button" class="pl-sp-item${x.id === cur ? ' on' : ''}" data-pl-sp="${esc(x.id)}" role="radio" aria-checked="${x.id === cur}">${x.id === cur ? ic('check') : ''}${esc(x.name)}</button>`;
    const body = `<p class="pl-sp-sub">${esc([t.title, sb ? sb.name : '', +t.estimateMin > 0 ? fm(+t.estimateMin) : ''].filter(Boolean).join(' · '))}</p>` +
      `<div class="pl-sp-grid" role="radiogroup" aria-label="장소·시간">${list.map(opt).join('')}` +
      `<button type="button" class="pl-sp-item none${cur ? '' : ' on'}" data-pl-sp="" role="radio" aria-checked="${!cur}">정하지 않음</button></div>` +
      `<div class="pl-sp-foot"><span>${list.length ? '같은 장소·시간끼리 모여서 정렬돼요' : '목록이 비어 있어요'}</span><button type="button" class="btn link" data-pl-sp-edit>${list.length ? '목록 고치기' : '장소 넣기'}</button></div>`;
    const pick = await window.UI.openSheet({
      title: '언제·어디서 할까요?', body, cls: 'pl-menu-sheet pl-sp-sheet', focusSel: '.pl-sp-item.on, .pl-sp-item',
      onClick: (e, close) => {
        const b = e.target.closest('[data-pl-sp]');
        if (b) { close({ slot: b.dataset.plSp }); return; }
        if (e.target.closest('[data-pl-sp-edit]')) close({ edit: true });
      },
    });
    if (!pick) return;
    if (pick.edit) { showFold('pl-slots-fold', '#pl-slot-name'); return; }
    if (pick.slot === cur) return;
    store.update((st) => { P.setSlot(st, id, pick.slot); });
  }

  // 플래너 맨 아래 접이를 펼쳐 보여 준다 (focus: 그 안에서 초점을 줄 칸)
  function showFold(id, focus) {
    if (App.view !== 'plan') App.go('plan');
    const f = $('#' + id);
    if (!f) return;
    f.open = true;
    requestAnimationFrame(() => {
      try { f.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { f.scrollIntoView(); }
      const i = focus && f.querySelector(focus);
      if (i) i.focus({ preventScroll: true });
    });
  }

  /* ---------- 맨 아래: 복습 선생님 ---------- */
  const tchDays = new Set([1, 2, 3, 4, 5]); // 새 선생님의 수업 요일 (처음엔 평일)
  const dayText = (days) => {
    const ds = WD_ORDER.filter((d) => days.includes(d));
    if (ds.length === 7) return '매일';
    if (ds.length === 5 && !days.includes(0) && !days.includes(6)) return '평일 매일';
    return ds.map((d) => P.WD[d]).join(' ');
  };
  const wdButtons = (set, attr) => WD_ORDER.map((d) => `<button type="button" class="${set.has(d) ? 'on' : ''}" ${attr}="${d}" aria-pressed="${set.has(d)}">${P.WD[d]}</button>`).join('');
  function subjOptions(cur) {
    return '<option value="">과목 없음</option>' + store.get().subjects.map((x) => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  }
  function renderTeachers() {
    const list = P.teacherList(store.get());
    $('#pl-tch-n').textContent = list.length ? list.length + '명' : '';
    setHTML($('#pl-tch'), list.length ? list.map((t) => {
      const sb = subjOf(t.subjectId);
      const days = Array.isArray(t.days) && t.days.length ? t.days.map(Number) : [1, 2, 3, 4, 5];
      return `<li data-id="${esc(t.id)}" style="--c:${esc(sb ? sb.color : 'var(--muted)')}">` +
        (list.length > 1 ? `<span class="pl-grip" data-pl-grip role="button" tabindex="0" aria-label="${esc(t.name)} 순서 바꾸기 (위·아래 화살표)">${ic('grip')}</span>` : '') +
        `<i class="dot"></i><button type="button" class="pl-tch-name" data-pl-tch="${esc(t.id)}"><b>${esc(t.name)}</b><span class="sub">${esc(sb ? sb.name : '과목 없음')}</span><span class="days">${esc(dayText(days))}</span></button>` +
        `<button type="button" class="icon-btn" data-pl-tch="${esc(t.id)}" aria-label="${esc(t.name)} 고치기">${ic('more')}</button></li>`;
    }).join('') : '<li class="empty">아직 없어요. 아래에 이름을 적고 수업 있는 요일을 골라 넣어요.</li>');
    const sel = $('#pl-tch-subj');
    const want = subjOptions(sel.value);
    if (sel._plHTML !== want) { const v = sel.value; sel.innerHTML = want; sel._plHTML = want; sel.value = store.get().subjects.some((x) => x.id === v) ? v : ''; }
    setHTML($('#pl-tch-days'), wdButtons(tchDays, 'data-pl-twd'));
  }
  $('#pl-tch-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#pl-tch-name');
    const name = inp.value.trim();
    if (!name) { toast('선생님 이름을 적어 주세요'); inp.focus(); return; }
    if (!tchDays.size) { toast('수업 있는 요일을 골라 주세요'); return; }
    let t = null;
    store.update((st) => { t = P.addTeacher(st, { name, subjectId: $('#pl-tch-subj').value, days: [...tchDays] }, uid); });
    if (!t) return;
    inp.value = '';
    toast(`'${t.name}' 선생님을 넣었어요 · ${dayText(t.days)} 복습 줄에 나와요`);
  });
  $('#pl-tch-days').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pl-twd]');
    if (!b) return;
    const d = +b.dataset.plTwd;
    if (tchDays.has(d)) tchDays.delete(d); else tchDays.add(d);
    setHTML($('#pl-tch-days'), wdButtons(tchDays, 'data-pl-twd'));
  });
  $('#pl-tch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pl-tch]');
    if (b) editTeacher(b.dataset.plTch);
  });
  // 선생님 고치기 창: 이름 · 과목 · 수업 요일 · 지우기
  async function editTeacher(id) {
    const st = store.get();
    const t = P.teacherList(st).find((x) => x.id === id);
    if (!t) return;
    const days = new Set(Array.isArray(t.days) && t.days.length ? t.days.map(Number) : [1, 2, 3, 4, 5]);
    let subj = t.subjectId || '';
    const chips = () => st.subjects.map((x) => `<button type="button" class="chip${subj === x.id ? ' active' : ''}" data-pl-ts="${esc(x.id)}" role="radio" aria-checked="${subj === x.id}"><i class="dot" style="background:${esc(x.color)}"></i>${esc(x.name)}</button>`).join('') +
      `<button type="button" class="chip${subj ? '' : ' active'}" data-pl-ts="" role="radio" aria-checked="${!subj}">과목 없음</button>`;
    const body = `<div class="pl-te"><label class="pl-lab" for="pl-te-name">이름</label><input id="pl-te-name" maxlength="8" value="${esc(t.name)}" autocomplete="off">` +
      `<span class="pl-lab">과목</span><div class="pl-chips" data-pl-te-subj role="radiogroup" aria-label="과목">${chips()}</div>` +
      `<span class="pl-lab">수업 있는 요일</span><div class="pl-wdays" data-pl-te-days role="group" aria-label="수업 있는 요일">${wdButtons(days, 'data-pl-tewd')}</div>` +
      `<div class="pl-te-foot"><button type="button" class="btn danger" data-pl-te-del>지우기</button><span class="sp"></span><button type="button" class="btn primary" data-pl-te-ok>저장</button></div></div>`;
    const res = await window.UI.openSheet({
      title: '복습 선생님 고치기', body, cls: 'pl-menu-sheet pl-te-sheet', focusSel: '#pl-te-name',
      onKey: (e, box, close) => { if (e.key === 'Enter' && e.target.id === 'pl-te-name') { e.preventDefault(); close({ ok: true, name: e.target.value }); } },
      onClick: (e, close) => {
        const box = e.currentTarget;
        const sb = e.target.closest('[data-pl-ts]');
        if (sb) { subj = sb.dataset.plTs; box.querySelector('[data-pl-te-subj]').innerHTML = chips(); return; }
        const wd = e.target.closest('[data-pl-tewd]');
        if (wd) { const d = +wd.dataset.plTewd; if (days.has(d)) days.delete(d); else days.add(d); box.querySelector('[data-pl-te-days]').innerHTML = wdButtons(days, 'data-pl-tewd'); return; }
        if (e.target.closest('[data-pl-te-del]')) { close({ del: true }); return; }
        if (e.target.closest('[data-pl-te-ok]')) close({ ok: true, name: box.querySelector('#pl-te-name').value });
      },
    });
    if (!res) return;
    if (res.del) {
      const ok = await App.ask(`'${t.name}' 선생님을 지울까요?\n지난 날 체크한 기록은 남지만 복습 줄에는 더 안 나와요.`, { ok: '지우기', cancel: '두기', danger: true });
      if (ok) { store.update((s) => { P.removeTeacher(s, id); }); toast(`'${t.name}' 선생님을 지웠어요`); }
      return;
    }
    if (!days.size) { toast('수업 있는 요일을 하나 이상 골라 주세요'); return; }
    store.update((s) => { P.editTeacher(s, id, { name: res.name, subjectId: subj, days: [...days] }); });
  }

  /* ---------- 맨 아래: 장소·시간 목록 ---------- */
  function renderSlots() {
    const st = store.get();
    const list = P.slotList(st);
    $('#pl-slot-n').textContent = list.length + '개';
    const used = new Map();
    const tk = today();
    st.tasks.forEach((t) => { if (t && t.slotId && !t.done && (!t.due || t.due >= tk)) used.set(t.slotId, (used.get(t.slotId) || 0) + 1); });
    setHTML($('#pl-slot-list'), list.length ? list.map((x) => `<li data-id="${esc(x.id)}">` +
      (list.length > 1 ? `<span class="pl-grip" data-pl-grip role="button" tabindex="0" aria-label="${esc(x.name)} 순서 바꾸기 (위·아래 화살표)">${ic('grip')}</span>` : '') +
      `<button type="button" class="pl-slot-name" data-pl-slot-ren="${esc(x.id)}" aria-label="${esc(x.name)} 이름 바꾸기"><b>${esc(x.name)}</b>${used.get(x.id) ? `<span class="n">할 일 ${used.get(x.id)}개</span>` : ''}</button>` +
      `<button type="button" class="icon-btn" data-pl-slot-del="${esc(x.id)}" aria-label="${esc(x.name)} 지우기">${ic('x')}</button></li>`).join('')
      : '<li class="empty">비어 있어요. 아래에 적어 넣어요.</li>');
  }
  $('#pl-slot-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#pl-slot-name');
    const v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    const before = P.slotList(store.get()).length;
    let x = null;
    store.update((st) => { x = P.addSlot(st, v, uid); });
    if (!x) { toast('장소·시간은 20개까지 넣을 수 있어요'); return; }
    inp.value = '';
    toast(P.slotList(store.get()).length > before ? `'${x.name}'을 넣었어요` : `'${x.name}'은 이미 있어요`);
  });
  $('#pl-slot-list').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-pl-slot-del]');
    if (del) {
      const id = del.dataset.plSlotDel;
      const x = P.slotList(store.get()).find((y) => y.id === id);
      if (!x) return;
      const n = store.get().tasks.filter((t) => t && t.slotId === id).length;
      if (n && !(await App.ask(`'${x.name}'을 지울까요?\n이 장소를 고른 할 일 ${n}개는 '정하지 않음'이 돼요.`, { ok: '지우기', cancel: '두기', danger: true }))) return;
      store.update((st) => { P.removeSlot(st, id); });
      toast(`'${x.name}'을 지웠어요`);
      return;
    }
    const ren = e.target.closest('[data-pl-slot-ren]');
    if (ren) {
      const id = ren.dataset.plSlotRen;
      const x = P.slotList(store.get()).find((y) => y.id === id);
      if (!x) return;
      const res = await window.UI.openSheet({
        title: '이름 바꾸기', cls: 'pl-menu-sheet pl-te-sheet', focusSel: '#pl-sr-name',
        body: `<div class="pl-te"><input id="pl-sr-name" maxlength="10" value="${esc(x.name)}" autocomplete="off" enterkeyhint="done" aria-label="장소·시간 이름"><div class="pl-te-foot"><span class="sp"></span><button type="button" class="btn primary" data-pl-sr-ok>저장</button></div></div>`,
        onKey: (ev, box, close) => { if (ev.key === 'Enter' && ev.target.id === 'pl-sr-name') { ev.preventDefault(); close(ev.target.value); } },
        onClick: (ev, close) => { if (ev.target.closest('[data-pl-sr-ok]')) close(ev.currentTarget.querySelector('#pl-sr-name').value); },
      });
      if (typeof res === 'string' && res.trim() && res.trim() !== x.name) store.update((st) => { P.renameSlot(st, id, res); });
    }
  });

  // 손잡이로 끌거나 위·아래 화살표로 순서 바꾸기 (onMove(id, 새 자리))
  function sortable(list, onMove) {
    let d = null;
    list.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-pl-grip]');
      if (!g || d || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const el = g.closest('li');
      const sibs = [...list.children];
      const i0 = sibs.indexOf(el);
      if (i0 < 0 || sibs.length < 2) return;
      e.preventDefault();
      const rects = sibs.map((x) => x.getBoundingClientRect());
      d = { el, sibs, rects, i0, idx: i0, y0: e.clientY, pid: e.pointerId, h: rects[i0].height };
      el.classList.add('pl-lift');
      list.classList.add('pl-sorting');
      try { list.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    });
    list.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.pid) return;
      e.preventDefault();
      const dy = e.clientY - d.y0;
      d.el.style.transform = `translateY(${dy}px)`;
      const r = d.rects[d.i0], top = r.top + dy, bottom = r.bottom + dy;
      let idx = d.i0;
      for (let j = d.i0 - 1; j >= 0 && top < d.rects[j].top + d.rects[j].height / 2; j--) idx = j;
      for (let j = d.i0 + 1; j < d.rects.length && bottom > d.rects[j].top + d.rects[j].height / 2; j++) idx = j;
      d.idx = idx;
      d.sibs.forEach((x, j) => {
        if (j === d.i0) return;
        const off = j < d.i0 && j >= idx ? d.h : j > d.i0 && j <= idx ? -d.h : 0;
        x.style.transform = off ? `translateY(${off}px)` : '';
      });
    });
    const end = (e) => {
      if (!d || e.pointerId !== d.pid) return;
      const x = d;
      d = null;
      x.sibs.forEach((y) => { y.style.transform = ''; });
      x.el.classList.remove('pl-lift');
      list.classList.remove('pl-sorting');
      if (e.type === 'pointerup' && x.idx !== x.i0) onMove(x.el.dataset.id, x.idx);
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
    list.addEventListener('touchmove', (e) => { if (d && e.cancelable) e.preventDefault(); }, { passive: false });
    list.addEventListener('keydown', (e) => {
      const g = e.target.closest('[data-pl-grip]');
      if (!g || d || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const el = g.closest('li');
      const i = [...list.children].indexOf(el);
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= list.children.length) return;
      onMove(el.dataset.id, to);
      const ng = list.querySelector(`[data-id="${el.dataset.id}"] [data-pl-grip]`);
      if (ng) ng.focus();
    });
  }
  sortable($('#pl-slot-list'), (id, to) => store.update((st) => { P.moveSlot(st, id, to); }));
  sortable($('#pl-tch'), (id, to) => store.update((st) => { P.moveTeacher(st, id, to); }));

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

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pl-subjects]')) { e.preventDefault(); showSubjects(); return; }
    const zone = e.target.closest('#view-plan, #h-tasks-panel');
    if (!zone || e.target.closest('[data-tt-open]')) return; // 일정 시각·타임테이블 단추는 timetable.js가 연다
    const b = e.target.closest('[data-pl-mode], [data-pl-nav], [data-pl-today], [data-pl-cal], [data-pl-day], [data-pl-open], [data-pl-goal], [data-pl-add], [data-pl-scope], [data-pl-carry], [data-pl-carry-open], [data-pl-evadd], [data-pl-play], [data-pl-mark], [data-pl-slot], [data-pl-rv], [data-pl-rv-setup], [data-pl-more], [data-pl-place]');
    if (!b) return;
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
    else if ('plCarry' in d) openCarry();
    else if ('plCarryOpen' in d) { carryOpen = !carryOpen; render(); }
    else if ('plEvadd' in d) { if (window.Events) window.Events.open({ date: d.plEvadd }); }
    else if (id && 'plPlay' in d) { const t = taskOf(id); if (t) startTask(t); }
    else if (id && 'plMark' in d) { const t = taskOf(id); if (t) { drawn = { id, at: Date.now() }; App.setTaskMark(id, P.nextMark(P.markOf(t))); } }
    else if (id && 'plSlot' in d) openSlotPick(id);
    else if ('plRv' in d) store.update((st) => { P.toggleReview(st, d.plRvDay, d.plRv); });
    else if ('plRvSetup' in d) showFold('pl-teachers-fold', '#pl-tch-name');
    else if (id && 'plPlace' in d) { const t = taskOf(id); if (t) moveTo(t, viewKey()); }
    else if (id && 'plMore' in d) openMenu(id);
  });

  window.Planner = { render, renderHome, open, setMode, openAdd: openDlg, pickDay: openMonth, placeTopic, addFromScope: openScope, showSubjects, openCarry, maybeAsk, openSlotPick, get day() { return viewKey(); }, get mode() { return mode; } };
  render();
})();
