/* 타임테이블: 공부한 시간이 하루 시간표에 과목 색으로 칠해진다 (한 줄 = 한 시간, 한 칸 = 10분).
   스톱워치나 집중 타이머로 공부하는 동안에는 지금 재는 구간도 바로 칠한다.
   홈에는 오늘 하루를 한 줄로 줄인 띠가, 타임테이블 화면에는 날짜별 시간표와 그날의 기록이 나온다. */
(function () {
  'use strict';
  const App = window.App;
  if (!App || !document.getElementById('view-timetable')) return;
  const { store, $, esc, toast, ic } = App;
  const now = () => App.now();
  const fm = Stats.formatMinutes;
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const DAY_MIN = 1440;
  const EARLY = 6; // 이 시각 전의 새벽 줄은 공부한 적이 없으면 접어 둔다

  let pick = null; // 보고 있는 날 'YYYY-MM-DD' (null = 오늘을 따라감)
  const today = () => App.todayKey();
  const viewKey = () => (pick && pick < today() ? pick : today());
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

  // 지금 재고 있는 구간: 스톱워치, 없으면 집중 타이머
  function live() {
    return (window.Stopwatch && window.Stopwatch.live && window.Stopwatch.live()) || (App.timerLive && App.timerLive()) || null;
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
    return { tl, list, subjects, total, live: lv && lv.to > d0 && lv.from < d1 ? lv : null, d0, d1 };
  }

  const legendHTML = (subjects) => subjects.map((s) => `<span class="tt-chip"><i class="dot" style="background:${esc(s.color)}"></i>${esc(s.name)} <b>${fm(s.minutes)}</b></span>`).join('');
  const segHTML = (g, left, width) => `<i${g.live ? ' class="live"' : ''} style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${esc(colorOf(g.subjectId))}"></i>`;

  /* ---------- 홈: 오늘 하루를 한 줄로 ---------- */
  function renderHome() {
    const el = $('#h-tt');
    if (!el) return;
    const key = today();
    const d = dayData(key);
    const t = now();
    let segs = '';
    d.tl.hours.forEach((h, i) => h.segs.forEach((g) => { segs += segHTML(g, ((i * 60 + g.from) / DAY_MIN) * 100, ((g.to - g.from) / DAY_MIN) * 100); }));
    const nowPct = Math.max(0, Math.min(100, ((t - d.d0) / 60000 / DAY_MIN) * 100));
    const h0 = d.tl.hours.length ? d.tl.hours[0].hour : 0;
    const ticks = [0, 6, 12, 18, 24].map((n) => `<span>${n === 24 && !h0 ? 24 : (h0 + n) % 24}</span>`).join('');
    const range = d.tl.start !== null ? `${hm(d.tl.start)}부터 ${hmEnd(d.tl.end, key)}까지, ` : '';
    el.innerHTML = `<a class="day-strip" href="#timetable" data-go="timetable" aria-label="오늘 타임테이블: ${range}공부 ${fm(d.total)}. 눌러서 전체 보기">` +
      `<span class="ds-bar">${segs}<em class="ds-now" style="left:${nowPct.toFixed(2)}%"></em></span><span class="ds-ticks" aria-hidden="true">${ticks}</span></a>` +
      (d.subjects.length ? `<div class="tt-legend">${legendHTML(d.subjects)}</div>`
        : '<p class="muted small tt-empty">공부를 시작하면 공부한 시간대가 과목 색으로 칠해져요.</p>');
  }

  /* ---------- 타임테이블 화면 ---------- */
  function gridHTML(d, key) {
    const t = now();
    const nowRow = t >= d.d0 && t < d.d1 ? Math.floor((t - d.d0) / 3600000) : -1;
    // 새벽 줄은 공부한 적이 없으면 접어 둔다 (지금이 새벽이면 그대로 둔다)
    let first = 0;
    while (first < d.tl.hours.length && d.tl.hours[first].hour < EARLY && !d.tl.hours[first].segs.length && first !== nowRow) first++;
    const rows = d.tl.hours.map((h, i) => {
      if (i < first) return '';
      const nowMark = i === nowRow ? `<em class="tt-now" style="left:${(((t - d.d0) / 60000 - i * 60) / 60 * 100).toFixed(2)}%"></em>` : '';
      return `<div class="tt-row${i === nowRow ? ' now' : ''}"><span class="tt-h">${h.hour}</span><div class="tt-bar">${h.segs.map((g) => segHTML(g, (g.from / 60) * 100, ((g.to - g.from) / 60) * 100)).join('')}${nowMark}</div></div>`;
    }).join('');
    const label = d.tl.start !== null ? `${hm(d.tl.start)}부터 ${hmEnd(d.tl.end, key)}까지, 공부 ${fm(d.tl.timed)}` : '공부 기록 없음';
    return `<div class="tt tt-full" role="img" aria-label="타임테이블: ${label}">` +
      '<div class="tt-row tt-head" aria-hidden="true"><span class="tt-h"></span><div class="tt-ticks"><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span></div></div>' + rows + '</div>';
  }

  function listHTML(d, key) {
    if (!d.list.length && !d.live) return '<li class="empty">이날은 공부 기록이 없어요.</li>';
    const rows = d.list.map((s) => ({ s, from: s.manual ? Infinity : s.endedAt - s.minutes * 60000 })).sort((a, b) => a.from - b.from).map(({ s, from }) => {
      const sub = subjectOf(s.subjectId);
      let label = s.manual && s.label === '직접 기록' ? '' : s.label;
      if (label && sub && label.startsWith(sub.name + ' · ')) label = label.slice(sub.name.length + 3);
      const when = s.manual ? '시각 없음' : `${hm(Math.max(from, d.d0))} ~ ${hmEnd(s.endedAt, key)}`;
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

  // tick: 30초마다 '지금' 표시와 재는 중인 구간만 고칠 때 (목록은 그대로 둬서 누르려던 버튼이 사라지지 않게)
  function renderView(tick) {
    const key = viewKey(), tk = today();
    const d = dayData(key);
    const dd = keyDate(key);
    $('#ttv-title').textContent = `${dd.getMonth() + 1}월 ${dd.getDate()}일 (${WEEK[dd.getDay()]})${key === tk ? ' · 오늘' : ''}`;
    $('#ttv-next').disabled = key >= tk;
    $('#ttv-today').hidden = key === tk;
    $('#ttv-sum').innerHTML = d.total || d.live
      ? `<b>${fm(d.total)}</b>${d.tl.start !== null ? `<span class="muted"> · ${hm(d.tl.start)} ~ ${d.live ? '지금' : hmEnd(d.tl.end, key)}</span>` : ''}`
      : `<span class="muted">${key === tk ? '아직 오늘 공부 기록이 없어요. 스톱워치나 타이머로 공부하면 여기에 바로 칠해져요.' : '공부 기록이 없는 날이에요.'}</span>`;
    $('#ttv-legend').innerHTML = legendHTML(d.subjects);
    $('#ttv-legend').hidden = !d.subjects.length;
    $('#ttv-grid').innerHTML = gridHTML(d, key);
    $('#ttv-foot').innerHTML = `<span class="muted small">${d.tl.untimed ? `직접 기록한 ${fm(d.tl.untimed)}은 공부한 시각이 없어 칸에는 안 칠해져요.` : '한 줄이 한 시간, 한 칸이 10분이에요.'}</span>` +
      (d.list.length ? `<button type="button" class="btn link tt-share" data-tt-share="${key}">인증 이미지</button>` : '');
    if (!tick) $('#ttv-list').innerHTML = listHTML(d, key);
  }

  function render(tick) {
    if (App.view === 'home') renderHome();
    else if (App.view === 'timetable') renderView(tick === true);
  }

  // 다른 화면에서 날짜를 골라 연다 (통계의 공부 달력)
  function open(key) {
    pick = key && key < today() ? key : null;
    App.go('timetable');
  }

  /* ---------- 이벤트 ---------- */
  $('#ttv-prev').addEventListener('click', () => { pick = shiftKey(viewKey(), -1); renderView(); });
  $('#ttv-next').addEventListener('click', () => { const k = shiftKey(viewKey(), 1); pick = k < today() ? k : null; renderView(); });
  $('#ttv-today').addEventListener('click', () => { pick = null; renderView(); });
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
    if (App.view === 'home' || dayChanged || viewKey() === lastDay) render(!dayChanged);
  }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

  window.Timetable = { render, open, get day() { return viewKey(); } };
  render();
})();
