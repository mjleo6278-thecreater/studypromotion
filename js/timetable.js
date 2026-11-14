/* 타임테이블: 공부한 시간이 하루 시간표에 과목 색으로 칠해지고, 세워 둔 일정은 점선으로 겹쳐 보인다 (한 줄 = 한 시간, 한 칸 = 10분).
   스톱워치나 집중 타이머로 공부하는 동안에는 지금 재는 구간도 바로 칠한다.
   ‘하루’ 보기: 날짜별 시간표, 그날의 일정(계획대로 했는지)과 공부 기록. 앞으로의 날도 열어 일정을 넣을 수 있다.
   ‘주간’ 보기: 월~일 학교 시간표 모양. 옅은 칸 = 일정, 오른쪽 진한 줄 = 실제 공부.
   홈에는 오늘 하루를 한 줄로 줄인 띠와 지금·다음 일정이 나온다.
   지나간 칸을 누르면 공부 시간을 직접 적는 창(app.js), 앞으로의 칸을 누르면 일정 창(events.js)이 열린다. */
(function () {
  'use strict';
  const App = window.App;
  if (!App || !document.getElementById('view-timetable')) return;
  const { store, $, $$, esc, toast, ic } = App;
  const S = window.Schedule;
  const now = () => App.now();
  const fm = Stats.formatMinutes;
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const DAY_MIN = 1440;
  const EARLY = 6; // 이 시각 전의 새벽 줄은 공부한 적이 없으면 접어 둔다
  const MODE_KEY = 'studypromotion.ttMode';
  const HH = 30; // 주간 표 한 시간 높이(px)

  let pick = null; // 보고 있는 날 'YYYY-MM-DD' (null = 오늘을 따라감). 앞으로의 날도 된다
  let wkPick = null; // 보고 있는 주의 월요일 (null = 이번 주)
  let mode = 'day';
  try { if (localStorage.getItem(MODE_KEY) === 'week') mode = 'week'; } catch (e) { /* 무시 */ }

  const today = () => App.todayKey();
  const viewKey = () => pick || today();
  const weekKey = () => wkPick || S.weekStart(today());
  const pad = (n) => String(n).padStart(2, '0');
  const keyDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const shiftKey = (key, n) => { const d = keyDate(key); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  // 그날이 시작하고 끝나는 시각 (하루 시작 시각 설정을 따른다)
  const dayRange = (key) => { const d = keyDate(key), off = Stats.dayOffset(); return [d.getTime() + off, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() + off]; };
  const hm = (t) => { const d = new Date(t); return d.getHours() + ':' + pad(d.getMinutes()); };
  // 그날 끝에 딱 맞춰 끝난 기록은 '24:00'으로 (하루 시작 시각을 옮겼으면 그 시각 그대로)
  const hmEnd = (t, key) => (t === dayRange(key)[1] && !Stats.dayOffset() ? '24:00' : hm(t));
  const subjectOf = (id) => (id ? App.subjectById(id) : null) || null;
  const colorOf = (id) => { const s = subjectOf(id); return s ? s.color : 'var(--muted)'; };
  const nameOf = (id) => { const s = subjectOf(id); return s ? s.name : '과목 없음'; };
  const OTHER = '#9aa0a8';
  const planColor = (ev) => (ev.kind === 'other' ? OTHER : ev.subjectId && subjectOf(ev.subjectId) ? subjectOf(ev.subjectId).color : 'var(--text)');
  const evName = (ev) => (window.Events ? window.Events.nameOf(ev) : ev.title || '공부');
  const dayTitle = (key) => { const d = keyDate(key); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };

  // 지금 재고 있는 구간: 스톱워치, 없으면 집중 타이머
  function live() {
    return (window.Stopwatch && window.Stopwatch.live && window.Stopwatch.live()) || (App.timerLive && App.timerLive()) || null;
  }

  // 그날의 일정과 계획대로 했는지
  function plansOf(key, st, lv) {
    if (!S) return [];
    const t = now();
    return S.forDay(st.events || [], key).map((o) => Object.assign(o, {
      got: S.actualMinutes(o, st.sessions, lv),
      status: S.status(o, st.sessions, t, lv),
    }));
  }

  // 그날의 시간표와 합계. 지금 재는 중인 시간도 그날 몫만큼 넣는다
  function dayData(key) {
    const st = store.get();
    const [d0, d1] = dayRange(key);
    const lv = live();
    const lvMin = lv ? Math.max(0, Math.floor((Math.min(lv.to, d1) - Math.max(lv.from, d0)) / 60000)) : 0;
    const tl = Stats.dayTimeline(st.sessions, key, { full: true, live: lv });
    const list = st.sessions.filter((x) => x.minutes > 0 && Stats.dayKey(x.endedAt) === key);
    const by = Stats.minutesBySubject(list);
    if (lvMin > 0) { const k = subjectOf(lv.subjectId) ? lv.subjectId : 'none'; by[k] = (by[k] || 0) + lvMin; }
    // 지워진 과목의 기록은 '과목 없음'으로 모은다
    const merged = {};
    Object.keys(by).forEach((k) => { const id = subjectOf(k) ? k : 'none'; merged[id] = (merged[id] || 0) + by[k]; });
    const subjects = Object.keys(merged).sort((a, b) => merged[b] - merged[a]).map((k) => ({ name: nameOf(k), color: colorOf(k), minutes: merged[k] }));
    const total = list.reduce((a, x) => a + x.minutes, 0) + lvMin;
    const plans = plansOf(key, st, lv);
    const planned = plans.reduce((a, o) => a + (o.ev.kind === 'study' ? o.minutes : 0), 0);
    return { tl, list, subjects, total, live: lv && lv.to > d0 && lv.from < d1 ? lv : null, d0, d1, plans, planned };
  }

  const legendHTML = (subjects) => subjects.map((s) => `<span class="tt-chip"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)} <b>${fm(s.minutes)}</b></span>`).join('');
  const segHTML = (g, left, width) => `<i${g.live ? ' class="live"' : ''} style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${esc(colorOf(g.subjectId))}"></i>`;
  // 일정 칸(점선). a~b는 그 줄 안의 [시작, 끝] 비율(%)
  const planSeg = (o, left, width) => `<b class="plan${o.ev.kind === 'other' ? ' other' : ''}" style="--c:${esc(planColor(o.ev))};left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></b>`;
  // [t0, t1] 구간에 걸친 일정 칸들
  function planSegs(plans, t0, t1) {
    let out = '';
    plans.forEach((o) => {
      const a = Math.max(o.from, t0), b = Math.min(o.to, t1);
      if (b > a) out += planSeg(o, ((a - t0) / (t1 - t0)) * 100, ((b - a) / (t1 - t0)) * 100);
    });
    return out;
  }

  /* ---------- 홈: 오늘 하루를 한 줄로, 지금·다음 일정 ---------- */
  function renderHome() {
    const el = $('#h-tt');
    if (!el) return;
    const key = today();
    const d = dayData(key);
    const t = now();
    let segs = planSegs(d.plans, d.d0, d.d1);
    d.tl.hours.forEach((h, i) => h.segs.forEach((g) => { segs += segHTML(g, ((i * 60 + g.from) / DAY_MIN) * 100, ((g.to - g.from) / DAY_MIN) * 100); }));
    const nowPct = Math.max(0, Math.min(100, ((t - d.d0) / 60000 / DAY_MIN) * 100));
    const h0 = d.tl.hours.length ? d.tl.hours[0].hour : 0;
    const ticks = [0, 6, 12, 18, 24].map((n) => `<span>${n === 24 && !h0 ? 24 : (h0 + n) % 24}</span>`).join('');
    const range = d.tl.start !== null ? `${hm(d.tl.start)}부터 ${hmEnd(d.tl.end, key)}까지, ` : '';
    el.innerHTML = `<a class="day-strip" href="#timetable" data-go="timetable" aria-label="오늘 타임테이블: ${range}공부 ${fm(d.total)}${d.planned ? `, 계획한 공부 ${fm(d.planned)}` : ''}. 눌러서 전체 보기">` +
      `<span class="ds-bar">${segs}<em class="ds-now" style="left:${nowPct.toFixed(2)}%"></em></span><span class="ds-ticks" aria-hidden="true">${ticks}</span></a>` +
      (d.subjects.length ? `<div class="tt-legend">${legendHTML(d.subjects)}</div>`
        : d.plans.length ? '' : '<p class="muted small tt-empty">공부를 시작하면 공부한 시간대가 과목 색으로 칠해져요.</p>');
    renderHomePlan(d);
  }

  // 지금 일정(시작 단추) 또는 오늘 다음 일정 한 줄
  function renderHomePlan(d) {
    const el = $('#h-plan');
    if (!el) return;
    const t = now();
    const cur = d.plans.find((o) => o.ev.kind === 'study' && o.from - 10 * 60000 <= t && o.to > t && o.status !== 'done');
    const next = d.plans.find((o) => o.from > t);
    const lv = d.live;
    const when = (o) => `${hm(o.from)} ~ ${hm(o.to)}`;
    const dot = (o) => `<i class="dot" style="background:${esc(planColor(o.ev))}"></i>`;
    if (cur) {
      const doing = lv && (lv.subjectId || null) === (cur.ev.subjectId || null);
      el.innerHTML = `<div class="h-plan" data-ev-id="${esc(cur.ev.id)}" data-ev-date="${esc(cur.date)}"><span class="h-plan-what"><span class="muted">${cur.from > t ? '곧 시작' : '지금 일정'}</span> ${dot(cur)}<b>${esc(evName(cur.ev))}</b> <span class="muted">${when(cur)}</span></span>` +
        (doing ? '<span class="sl-tag on">하는 중</span>' : `<button class="btn primary sm" type="button" data-ev-start>${ic('play')}시작</button>`) + '</div>';
    } else if (next) {
      el.innerHTML = `<div class="h-plan"><span class="h-plan-what"><span class="muted">다음 일정</span> ${dot(next)}<b>${esc(evName(next.ev))}</b> <span class="muted">${when(next)}</span></span><a href="#timetable" data-go="timetable" class="small">일정 보기</a></div>`;
    } else {
      el.innerHTML = `<div class="h-plan empty"><button class="btn link" type="button" data-ev-open="day">＋ 일정 추가</button><span class="muted small">${d.plans.length ? '오늘 일정은 다 지나갔어요' : '공부할 시간을 미리 정해 두면 여기서 바로 시작해요'}</span></div>`;
    }
  }

  /* ---------- 하루 보기 ---------- */
  function gridHTML(d, key) {
    const t = now();
    const nowRow = t >= d.d0 && t < d.d1 ? Math.floor((t - d.d0) / 3600000) : -1;
    const rowStart = (i) => d.d0 + i * 3600000;
    const hasPlan = (i) => d.plans.some((o) => o.from < rowStart(i + 1) && o.to > rowStart(i));
    // 새벽 줄은 공부·일정이 없으면 접어 둔다 (지금이 새벽이면 그대로 둔다)
    let first = 0;
    while (first < d.tl.hours.length && d.tl.hours[first].hour < EARLY && !d.tl.hours[first].segs.length && !hasPlan(first) && first !== nowRow) first++;
    const rows = d.tl.hours.map((h, i) => {
      if (i < first) return '';
      const nowMark = i === nowRow ? `<em class="tt-now" style="left:${(((t - d.d0) / 60000 - i * 60) / 60 * 100).toFixed(2)}%"></em>` : '';
      return `<div class="tt-row${i === nowRow ? ' now' : ''}" data-tt-row="${i}"><span class="tt-h">${h.hour}</span><div class="tt-bar">${planSegs(d.plans, rowStart(i), rowStart(i + 1))}${h.segs.map((g) => segHTML(g, (g.from / 60) * 100, ((g.to - g.from) / 60) * 100)).join('')}${nowMark}</div></div>`;
    }).join('');
    const label = (d.tl.start !== null ? `${hm(d.tl.start)}부터 ${hmEnd(d.tl.end, key)}까지, 공부 ${fm(d.tl.timed)}` : '공부 기록 없음') + (d.plans.length ? `, 일정 ${d.plans.length}개` : '');
    return `<div class="tt tt-full" role="img" aria-label="타임테이블: ${label}">` +
      '<div class="tt-row tt-head" aria-hidden="true"><span class="tt-h"></span><div class="tt-ticks"><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span></div></div>' + rows + '</div>';
  }

  function listHTML(d, key) {
    if (!d.list.length && !d.live) return '<li class="empty">이날은 공부 기록이 없어요.</li>';
    const rows = d.list.map((s) => { const sp = Stats.sessionSpan(s); return { s, sp, from: sp ? sp[0] : Infinity }; }).sort((a, b) => a.from - b.from).map(({ s, sp, from }) => {
      const sub = subjectOf(s.subjectId);
      let label = s.manual && s.label === '직접 기록' ? '' : s.label;
      if (label && sub && label.startsWith(sub.name + ' · ')) label = label.slice(sub.name.length + 3);
      const when = !sp ? '시각 없음' : `${hm(Math.max(from, d.d0))} ~ ${hmEnd(Math.min(sp[1], d.d1), key)}`;
      return `<li><span class="sl-what">${sub ? `<i class="dot" style="background:${esc(sub.color)}"></i>${esc(sub.name)}` : '과목 없음'}${s.manual ? ' <span class="sl-tag">직접</span>' : s.kind === 'stopwatch' ? ' <span class="sl-tag">스톱워치</span>' : ''}${label ? ` <span class="muted">· ${esc(label)}</span>` : ''}</span>` +
        `<span class="muted sl-when">${when} · ${fm(s.minutes)}</span>` +
        `<button class="icon-btn" data-tt-del="${esc(s.id)}" aria-label="이 기록 삭제" title="기록 삭제">${ic('x')}</button></li>`;
    });
    if (d.live) {
      const sub = subjectOf(d.live.subjectId);
      rows.push(`<li class="tt-live-row"><span class="sl-what">${sub ? `<i class="dot" style="background:${esc(sub.color)}"></i>${esc(sub.name)}` : '과목 없음'} <span class="sl-tag on">재는 중</span>${d.live.label ? ` <span class="muted">· ${esc(d.live.label)}</span>` : ''}</span>` +
        `<span class="muted sl-when">${hm(Math.max(d.live.from, d.d0))} ~ 지금</span></li>`);
    }
    return rows.join('');
  }

  // 그날의 일정 목록: 시각, 무엇, 계획대로 했는지 / 시작 / 계획대로 했어요
  function plansHTML(d, key) {
    const tk = today();
    if (!d.plans.length) return `<li class="empty">${key >= tk ? '이날은 일정이 없어요. 시간표의 빈칸을 누르거나 ‘＋ 일정 추가’로 넣어 보세요.' : '이날은 일정이 없었어요.'}</li>`;
    const t = now();
    return d.plans.map((o) => {
      const ev = o.ev;
      const sub = ev.kind === 'study' ? subjectOf(ev.subjectId) : null;
      const task = ev.taskId ? store.get().tasks.find((x) => x.id === ev.taskId) : null;
      const head = sub ? `<i class="dot" style="background:${esc(sub.color)}"></i>${esc(sub.name)}` : ev.kind === 'other' ? `<i class="dot" style="background:${OTHER}"></i>${esc(ev.title)}` : esc(ev.title || '공부');
      const subline = [sub && ev.title ? ev.title : '', task ? '할 일: ' + task.title : '', ev.kind === 'other' ? '다른 일정' : '', S.repeatText(ev)].filter(Boolean).map(esc).join(' · ');
      const doing = d.live && ev.kind === 'study' && (d.live.subjectId || null) === (ev.subjectId || null) && d.live.from < o.to && d.live.to > o.from;
      let st = '';
      if (ev.kind === 'other') st = '';
      else if (doing) st = '<span class="sl-tag on">하는 중</span>';
      else if (o.status === 'done') st = `<span class="ev-st done">✓ ${fm(o.got)}</span>`;
      else if (o.status === 'part') st = `<span class="ev-st">${fm(o.got)} / ${fm(o.minutes)}</span>`;
      else if (o.status === 'missed') st = '<button class="btn sm" type="button" data-ev-done>계획대로 했어요</button>';
      else if (o.status === 'now' || (key === tk && o.from - t < 3 * 3600000)) st = `<button class="btn ${o.status === 'now' ? 'primary ' : ''}sm" type="button" data-ev-start>${ic('play')}시작</button>`;
      else st = '<span class="ev-st muted">예정</span>';
      return `<li class="ev-row${ev.kind === 'other' ? ' other' : ''}${o.status === 'now' ? ' now' : ''}" data-ev-id="${esc(ev.id)}" data-ev-date="${esc(o.date)}">` +
        `<button type="button" class="ev-main" data-ev-edit aria-label="${esc(evName(ev))} ${hm(o.from)} 일정 고치기"><span class="ev-when">${hm(o.from)} ~ ${hm(o.to)}</span>` +
        `<span class="ev-what"><span>${head}</span>${subline ? `<small>${subline}</small>` : ''}</span></button>${st}</li>`;
    }).join('');
  }

  // tick: 30초마다 '지금' 표시와 재는 중인 구간만 고칠 때 (목록은 그대로 둬서 누르려던 버튼이 사라지지 않게)
  function renderView(tick) {
    const key = viewKey(), tk = today();
    const future = key > tk;
    const d = dayData(key);
    $('#ttv-title').textContent = dayTitle(key) + (key === tk ? ' · 오늘' : '');
    $('#ttv-today').hidden = key === tk;
    const plan = d.planned ? `<span class="muted"> · 계획한 공부 ${fm(d.planned)}</span>` : '';
    $('#ttv-sum').innerHTML = future
      ? (d.plans.length ? `<b>일정 ${d.plans.length}개</b>${plan}` : '<span class="muted">아직 일정이 없는 날이에요. 시간표의 칸을 누르면 그 시각으로 일정을 넣을 수 있어요.</span>')
      : d.total || d.live
        ? `<b>${fm(d.total)}</b>${d.tl.start !== null ? `<span class="muted"> · ${hm(d.tl.start)} ~ ${d.live ? '지금' : hmEnd(d.tl.end, key)}</span>` : ''}${plan}`
        : `<span class="muted">${key === tk ? '아직 오늘 공부 기록이 없어요. 스톱워치나 타이머로 공부하면 여기에 바로 칠해져요.' : '공부 기록이 없는 날이에요.'}</span>${plan}`;
    $('#ttv-legend').innerHTML = legendHTML(d.subjects);
    $('#ttv-legend').hidden = !d.subjects.length;
    $('#ttv-grid').innerHTML = gridHTML(d, key);
    const untimed = d.tl.untimed ? `시간만 적은 직접 기록 ${fm(d.tl.untimed)}은 공부한 시각이 없어 칸에는 안 칠해져요. ` : '';
    $('#ttv-foot').innerHTML = `<span class="muted small">${untimed}${future ? '칸을 누르면 그 시각으로 일정을 넣어요.' : key === tk ? '지나간 칸을 누르면 공부 시간을, 앞으로의 칸을 누르면 일정을 넣어요.' : '칸을 누르면 그 시각부터 공부 시간을 적을 수 있어요.'}</span>` +
      (d.list.length ? `<button type="button" class="btn link tt-share" data-tt-share="${key}">인증 이미지</button>` : '');
    $('#ttv-plans-title').textContent = key === tk ? '오늘 일정' : '이날의 일정';
    $('#ttv-log-panel').hidden = future;
    if (!tick) { $('#ttv-list').innerHTML = listHTML(d, key); $('#ttv-plans').innerHTML = plansHTML(d, key); }
  }

  /* ---------- 주간 보기 ---------- */
  // 겹치는 일정은 나란히: 각 일정에 lane(몇 번째 줄)과 lanes(그 무리의 줄 수)
  function layLanes(list) {
    let group = [], groupEnd = -Infinity;
    const flush = () => {
      const ends = [];
      group.forEach((o) => { let l = ends.findIndex((e) => e <= o.from); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = o.to; o.lane = l; });
      group.forEach((o) => { o.lanes = ends.length; });
      group = [];
    };
    list.forEach((o) => {
      if (group.length && o.from >= groupEnd) { flush(); groupEnd = -Infinity; }
      group.push(o);
      groupEnd = Math.max(groupEnd, o.to);
    });
    if (group.length) flush();
    return list;
  }

  function weekData(ws) {
    const st = store.get();
    const lv = live();
    const keys = [0, 1, 2, 3, 4, 5, 6].map((i) => shiftKey(ws, i));
    const days = keys.map((key) => {
      const [d0, d1] = dayRange(key);
      const mid = keyDate(key).getTime(); // 그날 0시 (표의 시각은 0시부터 센다)
      const plans = layLanes(plansOf(key, st, lv));
      const acts = [];
      st.sessions.forEach((s) => {
        const sp = Stats.sessionSpan(s);
        if (!sp) return;
        const a = Math.max(sp[0], d0), b = Math.min(sp[1], d1);
        if (b - a >= 60000) acts.push({ a, b, subjectId: s.subjectId });
      });
      if (lv) { const a = Math.max(lv.from, d0), b = Math.min(lv.to, d1); if (b - a >= 60000) acts.push({ a, b, subjectId: lv.subjectId, live: true }); }
      const minutes = st.sessions.filter((x) => x.minutes > 0 && Stats.dayKey(x.endedAt) === key).reduce((a, x) => a + x.minutes, 0) +
        (lv ? Math.max(0, Math.floor((Math.min(lv.to, d1) - Math.max(lv.from, d0)) / 60000)) : 0);
      const due = st.tasks.filter((t) => !t.done && t.due === key).length;
      const exams = st.exams.filter((e) => e.date === key);
      return { key, d0, d1, mid, plans, acts, minutes, due, exams };
    });
    return { keys, days };
  }

  function weekHTML(w) {
    const t = now(), tk = today();
    const off = Stats.dayOffset() / 3600000;
    // 보여 줄 시각: 기본 8시~24시, 일정·공부가 그 밖에 있으면 넓힌다 (그날의 하루 범위 안에서)
    let lo = Math.max(8, off), hi = 24;
    w.days.forEach((d) => {
      d.plans.forEach((o) => { lo = Math.min(lo, (o.from - d.mid) / 3600000); hi = Math.max(hi, (Math.min(o.to, d.d1) - d.mid) / 3600000); });
      d.acts.forEach((a) => { lo = Math.min(lo, (a.a - d.mid) / 3600000); hi = Math.max(hi, (a.b - d.mid) / 3600000); });
    });
    lo = Math.max(off, Math.floor(lo));
    hi = Math.min(off + 24, Math.ceil(hi));
    const H = (hi - lo) * HH;
    const y = (ms, d) => ((ms - d.mid) / 3600000 - lo) * HH;
    const head = '<span class="wk-corner"></span>' + w.days.map((d) => {
      const dd = keyDate(d.key);
      const badge = d.exams.length ? `<span class="wk-badge ex">${esc(d.exams[0].name)}</span>` : d.due ? `<span class="wk-badge">할 일 ${d.due}</span>` : '<span class="wk-badge"></span>';
      return `<button type="button" class="wk-dh${d.key === tk ? ' today' : ''}" data-wk-day="${d.key}" aria-label="${dayTitle(d.key)} 하루 보기">${WEEK[dd.getDay()]}<b>${dd.getDate()}</b>${badge}</button>`;
    }).join('');
    let hours = `<div class="wk-hours" style="height:${H}px" aria-hidden="true">`;
    for (let h = lo; h <= hi; h += 2) hours += `<span style="top:${(h - lo) * HH}px">${h > 24 ? h - 24 : h}</span>`;
    hours += '</div>';
    const cols = w.days.map((d) => {
      let inner = '';
      d.plans.forEach((o) => {
        const top = Math.max(0, y(o.from, d)), bot = Math.min(H, y(Math.min(o.to, d.d1), d));
        const hgt = Math.max(14, bot - top - 2);
        const ev = o.ev;
        const sub = ev.kind === 'study' ? subjectOf(ev.subjectId) : null;
        const big = sub ? sub.name : ev.title || '공부';
        const small = sub && ev.title ? ev.title : '';
        const w100 = 100 / o.lanes;
        inner += `<button type="button" class="wk-ev${ev.kind === 'other' ? ' other' : ''}${o.status === 'done' ? ' ok' : ''}" data-ev-id="${esc(ev.id)}" data-ev-date="${esc(o.date)}" data-ev-edit ` +
          `style="--c:${esc(planColor(ev))};top:${top.toFixed(1)}px;height:${hgt.toFixed(1)}px;left:calc(${(o.lane * w100).toFixed(2)}% + 1px);width:calc(${w100.toFixed(2)}% - 2px)" ` +
          `aria-label="${esc(evName(ev))} ${hm(o.from)}부터 ${hm(o.to)}까지${o.status === 'done' ? ', 계획대로 함' : ''}"><b>${esc(big)}</b>${small && hgt > 26 ? `<small>${esc(small)}</small>` : ''}</button>`;
      });
      d.acts.forEach((a) => {
        const top = y(a.a, d), hgt = Math.max(2, y(a.b, d) - top);
        inner += `<i class="wk-act${a.live ? ' live' : ''}" style="--c:${esc(colorOf(a.subjectId))};top:${top.toFixed(1)}px;height:${hgt.toFixed(1)}px"></i>`;
      });
      if (d.key === tk && t >= d.d0 && t < d.d1) { const ny = y(t, d); if (ny >= 0 && ny <= H) inner += `<em class="wk-now" style="top:${ny.toFixed(1)}px"></em>`; }
      return `<div class="wk-col${d.key === tk ? ' today' : ''}" data-wk-col="${d.key}" style="height:${H}px">${inner}</div>`;
    }).join('');
    return `<div class="wk" style="--hh:${HH}px" data-lo="${lo}">${head}${hours}${cols}</div>`;
  }

  function renderWeek() {
    const ws = weekKey();
    const w = weekData(ws);
    const a = keyDate(ws), b = keyDate(shiftKey(ws, 6));
    $('#wk-title').textContent = `${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${a.getMonth() === b.getMonth() ? '' : b.getMonth() + 1 + '월 '}${b.getDate()}일`;
    const thisWeek = S.weekStart(today());
    $('#wk-today').hidden = ws === thisWeek;
    const st = store.get();
    const planned = S.plannedMinutes(st.events || [], ws, shiftKey(ws, 6));
    const studied = w.days.reduce((s, d) => s + (d.key <= today() ? d.minutes : 0), 0);
    const label = ws === thisWeek ? '이번 주' : '이 주';
    $('#wk-sum').innerHTML = ws > thisWeek
      ? (planned ? `<span class="muted">${label} 계획한 공부</span> <b>${fm(planned)}</b>` : '<span class="muted">아직 일정이 없는 주예요. 표의 칸을 누르면 그 시각으로 일정을 넣을 수 있어요.</span>')
      : `<span class="muted">${label} 공부</span> <b>${fm(studied)}</b>${planned ? `<span class="muted"> · 계획한 공부 ${fm(planned)}</span>` : ''}`;
    // 다가오는 시험 하나 (이 주와 상관없이 가장 가까운 시험)
    const tk = today();
    const ex = st.exams.filter((e) => e.date && e.date >= tk).sort((x, y) => (x.date < y.date ? -1 : 1))[0];
    $('#wk-exam').hidden = !ex;
    if (ex) $('#wk-exam').innerHTML = `<span class="wk-ex-tag">시험</span> ${esc(ex.name)} <b>${esc(Scope.ddayLabel(ex.date, now()))}</b> <span class="muted">· ${dayTitle(ex.date)}</span>`;
    $('#wk-grid').innerHTML = weekHTML(w);
  }

  function paintMode() {
    $$('[data-tt-mode]').forEach((b) => { const on = b.dataset.ttMode === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    $('#ttv-day').hidden = mode !== 'day';
    $('#ttv-week').hidden = mode !== 'week';
  }

  function render(tick) {
    if (App.view === 'home') renderHome();
    else if (App.view === 'timetable') {
      paintMode();
      if (mode === 'week') renderWeek(); else renderView(tick === true);
    }
  }

  // 다른 화면에서 날짜를 골라 연다 (통계의 공부 달력, 할 일의 일정 표시)
  function open(key) {
    pick = key && S.isKey(key) && key !== today() ? key : null;
    mode = 'day';
    App.go('timetable');
  }
  function setMode(m) {
    mode = m === 'week' ? 'week' : 'day';
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 무시 */ }
    // 주간에서 하루로 오면 보던 주의 오늘(또는 월요일)로, 하루에서 주간으로 가면 보던 날의 주로
    if (mode === 'week') { const ws = S.weekStart(viewKey()); wkPick = ws === S.weekStart(today()) ? null : ws; }
    render();
  }

  /* ---------- 이벤트 ---------- */
  $('#ttv-prev').addEventListener('click', () => { const k = shiftKey(viewKey(), -1); pick = k === today() ? null : k; renderView(); });
  $('#ttv-next').addEventListener('click', () => { const k = shiftKey(viewKey(), 1); pick = k === today() ? null : k; renderView(); });
  $('#ttv-today').addEventListener('click', () => { pick = null; renderView(); });
  $('#wk-prev').addEventListener('click', () => { wkPick = shiftKey(weekKey(), -7); if (wkPick === S.weekStart(today())) wkPick = null; renderWeek(); });
  $('#wk-next').addEventListener('click', () => { wkPick = shiftKey(weekKey(), 7); if (wkPick === S.weekStart(today())) wkPick = null; renderWeek(); });
  $('#wk-today').addEventListener('click', () => { wkPick = null; renderWeek(); });
  $$('[data-tt-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.ttMode)));

  // 시각을 골랐을 때: 지나간 시각이면 공부 시간 적기, 앞으로의 시각이면 일정 넣기 (일정 위를 누르면 그 일정)
  function pickTime(key, start, plans) {
    const hit = plans.find((o) => o.from <= start && o.to > start);
    if (start < now() - 60000) {
      if (hit && hit.ev.kind === 'other') { window.Events.open({ id: hit.ev.id, date: hit.date }); return; }
      if (!App.openLog) return;
      App.openLog(hit ? { mode: 'time', day: key, start, end: hit.to, subjectId: hit.ev.subjectId, label: hit.ev.title } : { mode: 'time', day: key, start });
      return;
    }
    if (!window.Events) return;
    if (hit) { window.Events.open({ id: hit.ev.id, date: hit.date }); return; }
    const d = new Date(start);
    window.Events.open({ date: key, start: d.getHours() * 60 + d.getMinutes() });
  }

  // 시간표 칸을 누르면 그 10분 칸부터
  $('#ttv-grid').addEventListener('click', (e) => {
    const row = e.target.closest('[data-tt-row]');
    if (!row) return;
    const bar = row.querySelector('.tt-bar');
    const r = bar.getBoundingClientRect();
    const slot = e.target.closest('.tt-bar') ? Math.max(0, Math.min(5, Math.floor(((e.clientX - r.left) / r.width) * 6))) : 0;
    const key = viewKey();
    const start = dayRange(key)[0] + (+row.dataset.ttRow * 60 + slot * 10) * 60000;
    if (start >= now() - 60000 && !window.Events) { toast('아직 오지 않은 시간이에요. 지나간 시간에만 공부를 추가할 수 있어요'); return; }
    pickTime(key, start, plansOf(key, store.get(), null));
  });
  // 주간 표: 날짜를 누르면 그날 하루 보기, 빈칸을 누르면 30분 단위로 그 시각
  $('#wk-grid').addEventListener('click', (e) => {
    const dh = e.target.closest('[data-wk-day]');
    if (dh) { pick = dh.dataset.wkDay === today() ? null : dh.dataset.wkDay; setMode('day'); return; }
    if (e.target.closest('[data-ev-edit]')) return; // 일정 칸은 events.js가 연다
    const col = e.target.closest('[data-wk-col]');
    if (!col) return;
    const lo = +col.closest('.wk').dataset.lo;
    const r = col.getBoundingClientRect();
    const key = col.dataset.wkCol;
    const min = Math.floor(((lo + (e.clientY - r.top) / HH) * 60) / 30) * 30;
    const start = keyDate(key).getTime() + min * 60000;
    const [d0, d1] = dayRange(key);
    if (start < d0 || start >= d1) return;
    pickTime(key, start, plansOf(key, store.get(), null));
  });
  $('#ttv-foot').addEventListener('click', (e) => { const b = e.target.closest('[data-tt-share]'); if (b && App.openShare) App.openShare(b.dataset.ttShare); });
  $('#ttv-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tt-del]');
    if (!b) return;
    const id = b.dataset.ttDel;
    const s = store.get().sessions.find((x) => x.id === id);
    if (!s) return;
    const d = new Date(s.endedAt - Stats.dayOffset());
    store.update((st) => { st.sessions = st.sessions.filter((x) => x.id !== id); });
    toast(`${d.getMonth() + 1}/${d.getDate()} ${fm(s.minutes)} 기록을 지웠어요`, { action: '되돌리기', onAction: () => store.update((st) => { if (!st.sessions.some((x) => x.id === id)) st.sessions.push(s); }) });
  });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-tt-open]'); if (b) { e.preventDefault(); open(b.dataset.ttOpen); } });

  // 재는 중인 구간과 '지금' 표시가 따라 움직이게 (보이는 동안만, 30초마다)
  let lastDay = today();
  setInterval(() => {
    if (document.hidden || (App.view !== 'home' && App.view !== 'timetable')) return;
    const dayChanged = lastDay !== today(); // 하루가 넘어가면 목록까지 새로
    lastDay = today();
    if (App.view === 'home' || mode === 'week' || dayChanged || viewKey() === lastDay) render(!dayChanged);
  }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

  window.Timetable = { render, open, setMode, get day() { return viewKey(); }, get week() { return weekKey(); }, get mode() { return mode; } };
  render();
})();
