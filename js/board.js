/* 시험 범위 화이트보드
 * 넓은 보드 위에 과목/범주 카드를 펼쳐 놓고, 단원·세부 항목을 하나씩 체크한다.
 * 이동(드래그·휠), 확대(Ctrl+휠·핀치·버튼), 펜/형광펜/지우개, 메모, 되돌리기를 지원한다.
 */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const { store, $, $$, esc, toast, ask, uid } = A;
  const fm = (m) => Stats.formatMinutes(m);
  let paceOpen = false;

  const WORLD_W = 12000;
  const WORLD_H = 8000;
  const Z_MIN = 0.1;
  const Z_MAX = 3;
  const GRID = 24;
  const SNAP = 10;
  const INK_COLORS = ['#e03131', '#1c7ed6', '#2b8a3e', '#212529', '#f59f00'];
  const FLAG_INFO = {
    star: { icon: '★', label: '중요', cls: 'f-star' },
    hard: { icon: '!', label: '어려움', cls: 'f-hard' },
    review: { icon: '↻', label: '다시 보기', cls: 'f-review' },
  };

  const vp = $('#board-viewport');
  const world = $('#board-world');
  const cardsEl = $('#board-cards');
  const ink = $('#board-ink');
  const menu = $('#pop-menu');

  let examId = null;
  let tool = 'select';
  let inkColor = INK_COLORS[0];
  let onlyLeft = false;
  const view = { x: 0, y: 0, z: 1 };
  let needsFit = false;
  let addTarget = null; // 항목 추가 입력칸이 열린 부모 id
  let focusAddTarget = false; // 방금 연 입력칸에 커서 두기
  let renderingNow = false;
  let settleAll = false; // 다음 렌더 때 겹친 카드 모두 정리
  let lastH = new Map(); // 카드 높이 (자란 카드 아래 카드를 밀어 내리기 위해)

  // 보기 방식: 목록(과목 → 공부할 내용, 휴대폰 기본) / 보드(화이트보드)
  const MODE_KEY = 'studypromotion.scopeMode';
  let modePref = null;
  try { modePref = localStorage.getItem(MODE_KEY); } catch (e) { /* 무시 */ }
  let mode = modePref === 'list' || modePref === 'board' ? modePref : (window.innerWidth < 720 ? 'list' : 'board');

  // 한글 입력 중(조합 중)에 Enter가 눌려도 글자가 빠지지 않도록
  let composing = false;
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; });
  function afterComposition(fn) {
    if (!composing) return fn();
    const once = () => { document.removeEventListener('compositionend', once); setTimeout(fn, 0); };
    document.addEventListener('compositionend', once);
  }

  // 과목 추천 (내 과목 → 자주 보는 과목 순)
  const COMMON_SUBJECTS = ['국어', '수학', '영어', '한국사', '통합사회', '통합과학', '사회', '과학', '역사', '도덕', '정보', '기술·가정', '한문', '제2외국어'];
  function subjectSuggestions(exclude) {
    const ex = new Set((exclude || []).map((x) => String(x).trim()));
    const out = [];
    for (const n of st().subjects.map((s) => s.name).concat(COMMON_SUBJECTS)) {
      if (n && !ex.has(n) && !out.includes(n)) out.push(n);
    }
    return out;
  }

  /* ---------- 데이터 헬퍼 ---------- */
  const st = () => store.get();
  const byId = (id) => st().topics.find((n) => n.id === id);
  const exam = () => st().exams.find((e) => e.id === examId);

  function pickExam() {
    const s = st();
    if (s.activeExamId && s.exams.some((e) => e.id === s.activeExamId)) return s.activeExamId;
    return s.exams.length ? s.exams[0].id : null;
  }

  function mutate(fn, undoable) {
    store.update(fn, { undoable: undoable !== false });
  }

  /* ---------- 보기(이동·확대) ---------- */
  function applyView() {
    if (mode === 'list') return;
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    vp.style.setProperty('--z', view.z);
    const g = GRID * 4 * view.z; // 체스판 무늬 두 칸(48px × 2)
    vp.style.backgroundSize = `${g}px ${g}px`;
    vp.style.backgroundPosition = `${view.x}px ${view.y}px`;
    $('#bb-zoom-label').textContent = Math.round(view.z * 100) + '%';
    vp.classList.toggle('zoomed-out', view.z < 0.45);
    saveViewSoon();
  }

  let saveT = null;
  function saveViewSoon() {
    if (!examId) return;
    clearTimeout(saveT);
    const id = examId;
    saveT = setTimeout(() => {
      const v = { x: Math.round(view.x), y: Math.round(view.y), z: +view.z.toFixed(3) };
      const old = st().boardView[id];
      if (old && old.x === v.x && old.y === v.y && old.z === v.z) return; // 그대로면 저장 안 함 (다른 탭과 주고받기 반복 방지)
      store.update((s) => { s.boardView[id] = v; }, { silent: true });
    }, 300);
  }

  function zoomAt(z, cx, cy) {
    z = Math.min(Z_MAX, Math.max(Z_MIN, z));
    const wx = (cx - view.x) / view.z;
    const wy = (cy - view.y) / view.z;
    view.z = z;
    view.x = cx - wx * z;
    view.y = cy - wy * z;
    applyView();
  }

  function zoomBy(f) {
    const r = vp.getBoundingClientRect();
    zoomAt(view.z * f, r.width / 2, r.height / 2);
  }

  function toWorld(clientX, clientY) {
    const r = vp.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  }

  function contentBounds() {
    const els = $$('#board-cards .bcard');
    if (!els.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of els) {
      const x = parseFloat(el.style.left), y = parseFloat(el.style.top);
      x1 = Math.min(x1, x); y1 = Math.min(y1, y);
      x2 = Math.max(x2, x + el.offsetWidth); y2 = Math.max(y2, y + el.offsetHeight);
    }
    for (const s of st().strokes) {
      if (s.examId !== examId) continue;
      for (const [px, py] of s.points) { x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py); }
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function fit() {
    const b = contentBounds();
    const r = vp.getBoundingClientRect();
    if (!r.width || !r.height) { needsFit = true; return; }
    if (!b) { view.z = 1; view.x = 40; view.y = 40; return applyView(); }
    const pad = 48;
    const z = Math.min(1.2, (r.width - pad * 2) / b.w, (r.height - pad * 2 - 40) / b.h);
    view.z = Math.max(Z_MIN, z);
    view.x = (r.width - b.w * view.z) / 2 - b.x * view.z;
    view.y = Math.max(pad, (r.height - b.h * view.z) / 2) - b.y * view.z;
    applyView();
  }

  // 처음 열 때: 넓은 화면은 전체를 한눈에, 좁은 화면(휴대폰)은 첫 카드부터 읽을 수 있는 크기로
  function firstView() {
    const r = vp.getBoundingClientRect();
    if (r.width >= 700) return fit();
    const b = contentBounds();
    if (!b) return fit();
    view.z = Math.min(1, (r.width - 24) / Scope.CARD_W);
    view.x = 12 - b.x * view.z;
    view.y = 16 - b.y * view.z;
    applyView();
  }

  /* ---------- 렌더 ---------- */
  function checkBtn(id, state, label) {
    const aria = state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false';
    return `<button class="bchk s-${state}" data-check="${esc(id)}" role="checkbox" aria-checked="${aria}" aria-label="${esc(label)} 체크"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.8 3.8 7.4-8.2"/><path class="dash" d="M5.5 10h9"/></svg></button>`;
  }

  function flagsHtml(n) {
    const f = n.flags || {};
    return Object.keys(FLAG_INFO).filter((k) => f[k]).map((k) => `<span class="bflag ${FLAG_INFO[k].cls}" title="${FLAG_INFO[k].label}">${FLAG_INFO[k].icon}</span>`).join('');
  }

  // 하위 항목 입력칸 (폼이라서 휴대폰 키보드의 Enter·이동 키로도 추가된다)
  function addRow(parentId, title) {
    const ph = title ? `‘${clip(title)}’ 아래에 넣을 항목` : '항목 이름 입력 후 Enter';
    return `<li class="badd-row"><form class="badd-form" data-add-form="${esc(parentId)}"><input class="badd-input" data-add-input="${esc(parentId)}" data-keep="sub:${esc(parentId)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" maxlength="200" autocomplete="off"><button class="btn sm" type="submit">추가</button></form></li>`;
  }

  // 목록 보기: 과목마다 늘 보이는 '공부할 내용 추가' 칸
  function addFormHtml(cardId) {
    return `<form class="sadd" data-add-form="${esc(cardId)}"><input class="sadd-input" data-keep="add:${esc(cardId)}" placeholder="공부할 내용 추가 (예: 1단원 다항식)" maxlength="200" autocomplete="off" aria-label="공부할 내용 추가"><button class="btn" type="submit">추가</button></form>`;
  }

  // 과목 고르기 (추천 칩 + 직접 입력)
  function pickerHtml(cards) {
    const used = cards.filter((c) => c.kind !== 'note').map((c) => c.title);
    const first = !used.length;
    const sugg = subjectSuggestions(used).slice(0, 12);
    return `<div class="subj-picker${first ? ' first' : ''}" id="subj-picker">
      <h3>${first ? '어떤 과목을 준비하나요?' : '＋ 과목 추가'}</h3>
      ${first ? '<p class="muted small">과목을 고른 다음, 과목마다 공부할 내용을 하나씩 적어 보세요. 국어 › 비문학 › 수특 1강 › 분석처럼 단계를 나누고 싶으면 항목 옆 <b>＋</b>를 눌러 그 아래에 넣으면 돼요.</p>' : ''}
      ${sugg.length ? `<div class="sas-chips">${sugg.map((n) => `<button type="button" class="chip sas-chip" data-subject-add="${esc(n)}">＋ ${esc(n)}</button>`).join('')}</div>` : ''}
      <form class="sas-form" data-subject-form><input class="sas-input" data-keep="subject" placeholder="과목 이름 직접 입력" maxlength="40" autocomplete="off" aria-label="과목 이름"><button class="btn" type="submit">추가</button></form>
    </div>`;
  }

  // 목록 보기 맨 위: 진행률과 자주 쓰는 버튼
  function listHeadHtml(info) {
    const { p, plan, pc } = info;
    const pace = plan ? (plan.finished ? '다 끝냈어요 ♛' : plan.days > 0 ? `하루 ${fm(plan.perDay)}씩` : `남은 ${fm(plan.left)}`)
      : pc ? (pc.days > 0 ? `하루 ${pc.perDay}개씩` : `남은 ${pc.perDay}개`) : '';
    return `<div class="sl-head">
      <div class="sl-prog"><span class="pawn-track" aria-label="전체 진행률 ${p.pct}%">${A.pawnTrack(p.pct)}</span>
        <b>${p.total ? (p.timeTotal ? `${p.pct}% · 남은 ${fm(p.timeLeft)}` : `${p.done}/${p.total} · ${p.pct}%`) : '아직 공부할 내용이 없어요'}</b>${pace ? `<span class="sl-pace">${pace}</span>` : ''}</div>
      <div class="sl-actions">
        <button class="chip" type="button" data-list-act="add-subject">＋ 과목</button>
        <button class="chip" type="button" data-list-act="paste">목록 붙여넣기</button>
        <button class="chip" type="button" data-list-act="undo"${store.canUndo() ? '' : ' disabled'}>↶ 되돌리기</button>
        ${p.total ? `<label class="chip sl-left"><input type="checkbox" id="sl-only-left"${onlyLeft ? ' checked' : ''}> 남은 것만</label>` : ''}
      </div>
    </div>`;
  }

  function itemHtml(n, index, depth) {
    const kids = index.get(n.id) || [];
    const p = Scope.progress(st().topics, n.id, index);
    if (onlyLeft && p.state === 'all') return '';
    const hasKids = kids.length > 0;
    const childHtml = hasKids && !n.collapsed ? kids.map((c) => itemHtml(c, index, depth + 1)).join('') : '';
    const adding = addTarget === n.id;
    return `<li class="bitem s-${p.state}${hasKids ? ' parent' : ''}" data-id="${esc(n.id)}" style="--d:${depth}">
      <div class="brow">
        ${hasKids ? `<button class="btoggle" data-collapse="${esc(n.id)}" aria-label="${n.collapsed ? '펼치기' : '접기'}" aria-expanded="${!n.collapsed}">${n.collapsed ? '▸' : '▾'}</button>` : '<span class="btoggle-sp"></span>'}
        ${checkBtn(n.id, p.state, n.title)}
        <span class="btitle" data-rename="${esc(n.id)}">${esc(n.title)}</span>
        ${flagsHtml(n)}
        ${hasKids ? `<span class="bcount">${p.timeTotal ? `남은 ${fm(p.timeLeft)}` : `${p.done}/${p.total}`}</span>` : timeChip(n)}
        <button class="bsub" data-add="${esc(n.id)}" aria-label="${esc(n.title)} 아래에 하위 항목 추가" title="하위 항목 추가">＋</button>
        <button class="bmenu" data-menu="${esc(n.id)}" aria-label="${esc(n.title)} 메뉴">⋯</button>
      </div>
      ${childHtml || adding ? `<ul>${childHtml}${adding ? addRow(n.id, n.title) : ''}</ul>` : ''}
    </li>`;
  }

  // 잎 항목 옆 소요시간·진행률 칩 (누르면 입력 창)
  function timeChip(n) {
    const pct = Scope.leafPct(n);
    const est = +n.est || 0;
    let label;
    if (!est && !pct) label = '⏱';
    else if (pct >= 100) label = est ? fm(est) : '100%';
    else if (pct > 0) label = est ? `${pct}% · 남은 ${fm(Math.round(est * (100 - pct) / 100))}` : `${pct}%`;
    else label = fm(est);
    return `<button class="btime${pct > 0 && pct < 100 ? ' partial' : ''}${!est ? ' empty' : ''}" data-time="${esc(n.id)}" style="--p:${pct}%" aria-label="${esc(n.title)} 소요시간·진행률">${label}</button>`;
  }

  function cardHtml(c, index) {
    const style = `left:${c.x || 0}px;top:${c.y || 0}px;--c:${esc(c.color || '#4a7fd4')}`;
    if (c.kind === 'note') {
      return `<div class="bcard note" data-id="${esc(c.id)}" style="${style}">
        <div class="bnote-head" data-drag="${esc(c.id)}"><span>메모</span><button class="bmenu" data-menu="${esc(c.id)}" aria-label="메모 메뉴">⋯</button></div>
        <div class="bnote-text" data-note="${esc(c.id)}">${esc(c.title) || '<span class="muted">두 번 눌러 메모 쓰기</span>'}</div>
      </div>`;
    }
    const kids = index.get(c.id) || [];
    const p = Scope.progress(st().topics, c.id, index);
    const folded = !!c.collapsed && kids.length > 0;
    const list = folded ? '' : kids.map((k) => itemHtml(k, index, 0)).join('');
    const adding = addTarget === c.id && mode !== 'list';
    const doneAll = p.state === 'all';
    const listMode = mode === 'list';
    return `<div class="bcard s-${p.state}${doneAll ? ' complete' : ''}${folded ? ' folded' : ''}" data-id="${esc(c.id)}" style="${style}">
      <div class="bcard-head" data-drag="${esc(c.id)}">
        ${kids.length ? `<button class="btoggle" data-collapse="${esc(c.id)}" aria-label="${folded ? '펼치기' : '접기'}" aria-expanded="${!folded}">${folded ? '▸' : '▾'}</button>` : ''}
        ${checkBtn(c.id, p.state, c.title)}
        <div class="bcard-title" data-rename="${esc(c.id)}">${esc(c.title)}</div>
        ${flagsHtml(c)}
        <button class="bmenu" data-menu="${esc(c.id)}" aria-label="${esc(c.title)} 메뉴">⋯</button>
      </div>
      <div class="bcard-prog"><div class="bbar"><div style="width:${p.pct}%"></div></div><span>${!kids.length ? (c.done ? '완료 ✓' : '아직 공부할 내용이 없어요') : p.timeTotal ? `${p.pct}% · 남은 ${fm(p.timeLeft)}` : `${p.done}/${p.total} · ${p.pct}%`}</span></div>
      ${list || adding ? `<ul class="btree">${list}${adding ? addRow(c.id, c.title) : ''}</ul>` : ''}
      ${onlyLeft && kids.length && !list && !adding && !folded ? '<p class="bcard-done muted">이 과목은 다 끝냈어요</p>' : ''}
      ${folded ? '' : listMode ? addFormHtml(c.id) : `<button class="badd" data-add="${esc(c.id)}">＋ 공부할 내용 추가</button>`}
      ${doneAll ? '<div class="bstamp" aria-hidden="true">♛ 승급</div>' : ''}
    </div>`;
  }

  function strokePath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M${points[0][0]} ${points[0][1]}l0.1 0`;
    let d = `M${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i][0] + points[i + 1][0]) / 2;
      const my = (points[i][1] + points[i + 1][1]) / 2;
      d += `Q${points[i][0]} ${points[i][1]} ${mx} ${my}`;
    }
    const last = points[points.length - 1];
    d += `L${last[0]} ${last[1]}`;
    return d;
  }

  function strokeEl(s) {
    return `<path data-stroke="${esc(s.id)}" class="${s.marker ? 'marker' : 'pen'}" d="${strokePath(s.points)}" stroke="${esc(s.color)}" stroke-width="${s.width}"/>`;
  }

  function renderInk() {
    ink.innerHTML = st().strokes.filter((s) => s.examId === examId).map(strokeEl).join('');
  }

  function renderBar() {
    const s = st();
    $('#bb-exam').innerHTML = s.exams.map((e) => `<option value="${esc(e.id)}"${e.id === examId ? ' selected' : ''}>${esc(e.name)}</option>`).join('') + '<option value="__new">＋ 새 시험…</option>';
    const ex = exam();
    const p = Scope.examProgress(s.topics, examId);
    const dd = ex ? Scope.ddayLabel(ex.date, Date.now()) : '';
    $('#bb-dday').textContent = dd;
    $('#bb-dday').hidden = !dd;
    $('#bb-dday').classList.toggle('soon', !!ex && Scope.daysUntil(ex.date, Date.now()) !== null && Scope.daysUntil(ex.date, Date.now()) <= 7 && Scope.daysUntil(ex.date, Date.now()) >= 0);
    const plan = ex ? Scope.timePlan(p, ex, Date.now()) : null;
    const pc = ex && !plan ? Scope.pace(p.total - p.done, ex.date, Date.now()) : null;
    $('#bb-pace').textContent = plan ? (plan.finished ? '다 끝냈어요' : plan.days > 0 ? `하루 ${fm(plan.perDay)}씩` : `남은 ${fm(plan.left)}`) : pc ? (pc.days > 0 ? `하루 ${pc.perDay}개씩` : `남은 ${pc.perDay}개`) : '';
    $('#bb-pace').title = pc && pc.days > 0 ? `시험까지 ${pc.days}일, 남은 항목 ${p.total - p.done}개` : '';
    $('#bb-pace').hidden = !plan && !pc;
    renderPace(plan, p);
    $('#bb-track').innerHTML = A.pawnTrack(p.pct);
    $('#bb-track').setAttribute('aria-label', `전체 진행률 ${p.pct}%`);
    $('#bb-pct').textContent = p.timeTotal ? `${p.pct}%` : `${p.done}/${p.total} · ${p.pct}%`;
    $('#bb-undo').disabled = !store.canUndo();
    $('#bb-colors').innerHTML = INK_COLORS.map((c) => `<button class="bb-color${c === inkColor ? ' active' : ''}" data-color="${c}" style="--ink:${c}" aria-label="색 ${c}"></button>`).join('');

    // 범례: 남은 것 / 표시별 개수
    const nodes = s.topics.filter((n) => n.examId === examId && n.kind !== 'note');
    const count = (k) => nodes.filter((n) => n.flags && n.flags[k]).length;
    const left = p.total - p.done;
    $('#board-legend').innerHTML = p.total ? `
      <span>남은 항목 <b>${left}</b></span>
      <span class="f-star">★ 중요 ${count('star')}</span>
      <span class="f-hard">! 어려움 ${count('hard')}</span>
      <span class="f-review">↻ 다시 보기 ${count('review')}</span>
      <label class="bl-toggle"><input type="checkbox" id="bl-only-left"${onlyLeft ? ' checked' : ''}> 남은 것만</label>` : '';
    return { p, plan, pc };
  }

  // 시험 시간 페이스 띠
  function renderPace(plan, p) {
    const el = $('#board-pace');
    if (!plan) {
      el.hidden = !(p.total && !p.timeTotal);
      el.innerHTML = el.hidden ? '' : '<div class="bp-row"><span>⏱ 항목 옆 <b>⏱</b>을 눌러 걸리는 시간을 적으면, 시험까지 하루에 몇 시간씩 해야 하는지 계산해 드려요.</span></div>';
      return;
    }
    el.hidden = false;
    const dday = plan.days > 0 ? `시험까지 ${plan.days}일` : plan.days === 0 ? '오늘 시험' : '시험 끝';
    const today = plan.finished ? '모든 범위를 끝냈어요 ♛'
      : plan.todayLeft ? `오늘 할 양 <b>${fm(plan.todayLeft)}</b> 남음` : '오늘 할 양 <b>완료 ✓</b>';
    const behind = !plan.finished && plan.behind > 0 ? `<span class="bp-behind">밀린 양 ${fm(plan.behind)}</span>` : '';
    el.innerHTML = `<button class="bp-row" id="bp-toggle" aria-expanded="${paceOpen}">
        <span>⏱ ${today}</span>${behind}<span class="muted">${dday}</span><span class="bp-more">${paceOpen ? '접기 ▴' : '자세히 ▾'}</span>
      </button>
      ${paceOpen ? `<div class="bp-grid">
        <div><small>전체 소요시간</small><b>${fm(plan.total)}</b><small>${p.noEst ? `시간 안 적은 항목 ${p.noEst}개` : '모든 항목 기준'}</small></div>
        <div><small>한 만큼</small><b>${plan.pct}%</b><small>${fm(plan.done)} 함</small></div>
        <div><small>남은 시간</small><b>${fm(plan.left)}</b><small>${100 - plan.pct}% 남음</small></div>
        <div><small>오늘 할 양</small><b>${fm(plan.todayQuota)}</b><small>${fm(plan.todayDone)} 함 · ${fm(plan.todayLeft)} 남음</small></div>
        <div><small>하루 기본 페이스</small><b>${fm(plan.basePerDay)}</b><small>처음 계획대로라면</small></div>
        <div class="${plan.behind ? 'warn' : ''}"><small>${plan.behind ? '밀려서 필요한 페이스' : '지금 필요한 페이스'}</small><b>${fm(plan.perDay)}</b><small>${plan.extraPerDay ? `하루 ${fm(plan.extraPerDay)} 더` : '계획대로 가고 있어요'}</small></div>
      </div>` : ''}`;
  }

  $('#board-pace').addEventListener('click', (e) => {
    if (e.target.closest('#bp-toggle')) { paceOpen = !paceOpen; renderBar(); }
  });

  // 다시 그려도 쓰던 입력칸(커서·글자)이 그대로 남게
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !cardsEl.contains(a) || !a.dataset || !a.dataset.keep) return null;
    return { key: a.dataset.keep, value: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f) return false;
    const el = cardsEl.querySelector(`[data-keep="${CSS.escape(f.key)}"]`);
    if (!el) return false;
    el.value = f.value;
    el.focus({ preventScroll: true });
    try { el.setSelectionRange(f.s, f.e); } catch (e) { /* 무시 */ }
    return true;
  }
  // 휴대폰 키보드에 가리지 않게 입력칸을 보이는 곳으로
  function ensureVisible(el) {
    if (mode !== 'list' || !el) return;
    const r = el.getBoundingClientRect();
    const vr = vp.getBoundingClientRect();
    const bottom = Math.min(vr.bottom, window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : innerHeight) - 12;
    if (r.bottom > bottom) vp.scrollTop += r.bottom - bottom;
    else if (r.top < vr.top + 8) vp.scrollTop -= vr.top + 8 - r.top;
  }

  function render() {
    if (renderingNow) return;
    renderingNow = true;
    try {
      const keep = captureFocus();
      const prevExam = examId;
      examId = pickExam();
      const has = !!examId;
      const list = mode === 'list';
      $('#view-board').classList.toggle('list-mode', list);
      vp.classList.toggle('list-mode', list);
      $$('[data-scope-mode]').forEach((b) => { const on = b.dataset.scopeMode === mode; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
      $('#board-empty').hidden = has;
      world.hidden = !has;
      $('#board-bar').classList.toggle('disabled', !has);
      if (!has) {
        $('#board-legend').innerHTML = '';
        $('#bb-exam').innerHTML = '<option>시험 없음</option>';
        $('#bb-dday').hidden = true;
        $('#bb-pct').textContent = '';
        $('#bb-track').innerHTML = '';
        $('#board-pace').hidden = true;
        vp.style.backgroundPosition = '0 0';
        wizard.draw();
        return;
      }
      if (prevExam !== examId) {
        const saved = st().boardView[examId];
        if (saved) Object.assign(view, saved);
        else needsFit = true;
        addTarget = null;
        settleAll = true;
        lastH = new Map();
      }
      setToolClass();
      const ex0 = exam();
      if (ex0) {
        const pp = Scope.examProgress(st().topics, examId);
        const copy = Object.assign({}, ex0);
        if (Scope.touchPlan(copy, pp, Date.now())) {
          store.update((s) => { const e = s.exams.find((x) => x.id === examId); e.planStart = copy.planStart; e.paceSnap = copy.paceSnap; }, { silent: true });
        }
      }
      const info = renderBar();
      const index = Scope.indexByParent(st().topics);
      const cards = index.get('root:' + examId) || [];
      if (list) {
        const subjects = cards.filter((c) => c.kind !== 'note');
        const notes = cards.filter((c) => c.kind === 'note');
        cardsEl.innerHTML = listHeadHtml(info) + subjects.map((c) => cardHtml(c, index)).join('') +
          notes.map((c) => cardHtml(c, index)).join('') + pickerHtml(cards);
      } else {
        cardsEl.innerHTML = cards.map((c) => cardHtml(c, index)).join('') ||
          '<div class="board-hint">위의 <b>＋ 과목</b>으로 과목을 하나씩 추가하거나, <b>붙여넣기</b>로 시험 범위 목록을 한 번에 넣으세요. 과목마다 <b>＋ 공부할 내용 추가</b>를 눌러 항목을 적으면 돼요.</div>';
        renderInk();
        applyView();
        settle();
        if (needsFit) { needsFit = false; requestAnimationFrame(firstView); }
      }
      if (!restoreFocus(keep) && focusAddTarget) {
        focusAddTarget = false;
        const input = cardsEl.querySelector('.badd-input');
        if (input) { input.focus({ preventScroll: true }); ensureVisible(input); }
      }
    } finally {
      renderingNow = false;
    }
  }

  // 카드가 자라서(항목 추가·휴대폰에서 줄바꿈) 아래 카드와 겹치면 아래 카드를 밀어 내린다
  function settle() {
    if (mode !== 'board') return;
    const items = $$('#board-cards .bcard:not(.note)').map((el) => ({ id: el.dataset.id, el, x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, h: el.offsetHeight }));
    if (!items.length) { settleAll = false; return; }
    const grew = settleAll || items.some((c) => lastH.has(c.id) && c.h > lastH.get(c.id) + 1);
    lastH = new Map(items.map((c) => [c.id, c.h]));
    settleAll = false;
    if (!grew) return;
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const placed = [];
    const moved = [];
    for (const c of items) {
      const y0 = c.y;
      for (let guard = 0; guard < 50; guard++) {
        const hit = placed.find((o) => o.x < c.x + Scope.CARD_W && c.x < o.x + Scope.CARD_W && c.y < o.y + o.h + 12 && o.y < c.y + c.h);
        if (!hit) break;
        c.y = Math.round((hit.y + hit.h + Scope.GAP) / SNAP) * SNAP;
      }
      if (c.y !== y0) { c.el.style.top = c.y + 'px'; moved.push(c); }
      placed.push(c);
    }
    if (moved.length) {
      store.update((s) => moved.forEach((m) => { const t = s.topics.find((x) => x.id === m.id); if (t) t.y = m.y; }), { silent: true });
    }
  }

  // 보기 방식 바꾸기
  function setScopeMode(m, remember) {
    if (m !== 'list' && m !== 'board') return;
    if (remember !== false) { modePref = m; try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* 무시 */ } }
    closeMenu();
    if (mode === m) return render();
    mode = m;
    addTarget = null;
    vp.scrollTop = 0;
    vp.scrollLeft = 0;
    if (m === 'board') { settleAll = true; if (examId && !st().boardView[examId]) needsFit = true; }
    render();
    vp.scrollTop = 0;
  }
  $('#view-board').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scope-mode]');
    if (b) setScopeMode(b.dataset.scopeMode);
  });

  /* ---------- 체크·접기·추가·이름 바꾸기 ---------- */
  cardsEl.addEventListener('click', (e) => {
    const sub = e.target.closest('[data-subject-add]');
    if (sub) { addSubjectCards([sub.dataset.subjectAdd]); return; }
    const la = e.target.closest('[data-list-act]');
    if (la && la.tagName === 'BUTTON') {
      const act = la.dataset.listAct;
      if (act === 'add-subject') {
        const pk = $('#subj-picker');
        if (pk) { pk.scrollIntoView({ block: 'center' }); const inp = pk.querySelector('input'); if (inp) inp.focus({ preventScroll: true }); }
      } else if (act === 'paste') openPaste();
      else if (act === 'undo') undo();
      return;
    }
    const chk = e.target.closest('[data-check]');
    if (chk) {
      const id = chk.dataset.check;
      let nowDone = false;
      mutate((s) => { nowDone = Scope.toggle(s.topics, id); });
      celebrate(id, nowDone);
      return;
    }
    const tm = e.target.closest('[data-time]');
    if (tm) { openTime(tm.dataset.time); return; }
    const col = e.target.closest('[data-collapse]');
    if (col) {
      mutate((s) => { const n = s.topics.find((x) => x.id === col.dataset.collapse); if (n) n.collapsed = !n.collapsed; }, false);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) { openAdd(add.dataset.add); return; }
    const m = e.target.closest('[data-menu]');
    if (m) { openMenu(m.dataset.menu, m); return; }
  });

  // 추가 버튼을 눌러도 입력칸의 커서(휴대폰 키보드)가 그대로 있게
  ['pointerdown', 'mousedown'].forEach((ev) => cardsEl.addEventListener(ev, (e) => {
    if (e.target.closest('.sadd button, .sas-form button, .badd-form button')) e.preventDefault();
  }));

  cardsEl.addEventListener('change', (e) => {
    if (e.target.id === 'sl-only-left') { onlyLeft = e.target.checked; render(); }
  });

  // 공부할 내용·하위 항목·과목 추가 (폼 제출)
  cardsEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    afterComposition(() => {
      const input = f.querySelector('input');
      if (!input) return;
      const text = input.value.trim();
      if (f.matches('[data-subject-form]')) {
        if (!text) { input.focus(); return; }
        input.value = '';
        addSubjectCards([text]);
        return;
      }
      const parentId = f.dataset.addForm;
      if (!parentId) return;
      if (!text) {
        if (input.dataset.addInput) { addTarget = null; render(); }
        return;
      }
      input.value = '';
      addItems(parentId, text);
      const again = cardsEl.querySelector(`[data-keep="${CSS.escape(input.dataset.keep)}"]`);
      if (again && document.activeElement !== again) again.focus({ preventScroll: true });
      ensureVisible(again);
    });
  });

  // 시간 바꾸기 등 공부가 아닌 변경으로 남은 시간이 달라지면, 오늘 아침 기준도 같이 옮긴다
  // (그래야 항목을 지우거나 나눈 것이 '오늘 한 양'으로 잘못 잡히지 않는다)
  function keepPace(s, exId, fn) {
    const ex = s.exams.find((x) => x.id === exId);
    const before = Scope.examProgress(s.topics, exId).timeLeft;
    fn();
    const after = Scope.examProgress(s.topics, exId).timeLeft;
    if (ex && ex.paceSnap && ex.paceSnap.day === Stats.dayKey(Date.now()) && after !== before) {
      ex.paceSnap.left = Math.max(0, ex.paceSnap.left + (after - before));
    }
  }

  function addItems(parentId, text) {
    mutate((s) => keepPace(s, examId, () => {
      let order = Scope.nextOrder(s.topics, parentId, examId);
      for (const line of String(text).split(/\n/)) {
        const t = line.trim();
        if (t) s.topics.push({ id: uid(), examId, parentId, kind: 'topic', title: t.slice(0, 200), done: false, flags: {}, order: order++, collapsed: false });
      }
    }));
  }

  // 과목 카드 만들기 (계획·타이머·통계에서 쓰는 과목 목록에도 없으면 넣는다)
  function addSubjectCards(names, opts) {
    opts = opts || {};
    if (!examId) return [];
    const existing = new Set(Scope.childrenOf(st().topics, null, examId).filter((c) => c.kind !== 'note').map((c) => c.title));
    const list = [];
    names.map((n) => String(n).trim().slice(0, 40)).forEach((n) => { if (n && !existing.has(n) && !list.includes(n)) list.push(n); });
    if (!list.length) { if (names.length) toast('이미 있는 과목이에요'); return []; }
    let created = [];
    mutate((s) => {
      const added = Scope.addOutline(s.topics, examId, list.map((t) => ({ title: t, done: false, children: [] })), uid);
      added.forEach((c) => {
        const subj = s.subjects.find((x) => x.name === c.title);
        if (subj) c.color = subj.color;
        else s.subjects.push({ id: uid(), name: c.title, color: c.color });
      });
      created = added.map((c) => c.id);
    });
    if (opts.quiet) return created;
    if (mode === 'list') {
      const inp = cardsEl.querySelector(`[data-keep="add:${CSS.escape(created[0])}"]`);
      if (inp) { inp.focus({ preventScroll: true }); inp.closest('.bcard').scrollIntoView({ block: 'nearest' }); ensureVisible(inp); }
    } else {
      settleAll = true;
      revealTopic(created[0]);
      openAdd(created[0]);
    }
    return created;
  }

  /* ---------- 소요시간·진행률 입력 ---------- */
  let timeId = null;
  function timeVals() {
    const h = parseInt($('#time-h').value, 10) || 0;
    const m = parseInt($('#time-m').value, 10) || 0;
    return { est: Math.max(0, Math.min(5999, h * 60 + m)), pct: +$('#time-pct').value || 0 };
  }
  function timePreview() {
    const { est, pct } = timeVals();
    $('#time-pct-label').textContent = pct + '%';
    $$('#time-pct-quick [data-pct]').forEach((b) => b.classList.toggle('active', +b.dataset.pct === pct));
    $$('#time-quick [data-min]').forEach((b) => b.classList.toggle('active', +b.dataset.min === est));
    $('#time-preview').textContent = est
      ? `${fm(est)} 중 ${fm(Math.round(est * pct / 100))} 한 셈이에요 · 남은 ${fm(Math.round(est * (100 - pct) / 100))}`
      : '걸리는 시간을 적으면 시험 페이스 계산에 들어가요.';
  }
  function openTime(id) {
    const n = byId(id);
    if (!n) return;
    timeId = id;
    let card = n;
    while (card.parentId) card = byId(card.parentId);
    $('#time-item').textContent = card.id === n.id ? n.title : `${card.title} · ${n.title}`;
    const est = +n.est || 0;
    $('#time-h').value = est ? Math.floor(est / 60) : '';
    $('#time-m').value = est ? est % 60 : '';
    $('#time-pct').value = Scope.leafPct(n);
    timePreview();
    $('#time-dlg').hidden = false;
    $('#time-h').focus();
  }
  function closeTime() { $('#time-dlg').hidden = true; timeId = null; }
  ['input', 'change'].forEach((ev) => $('#time-form').addEventListener(ev, timePreview));
  $('#time-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]'); if (!b) return;
    const v = +b.dataset.min; $('#time-h').value = Math.floor(v / 60) || ''; $('#time-m').value = v % 60 || (Math.floor(v / 60) ? 0 : ''); timePreview();
  });
  $('#time-pct-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pct]'); if (!b) return;
    $('#time-pct').value = b.dataset.pct; timePreview();
  });
  $('#time-cancel').addEventListener('click', closeTime);
  $('#time-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTime(); });
  $('#time-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = timeId;
    const { est, pct } = timeVals();
    closeTime();
    let nowDone = false;
    mutate((s) => {
      const n = s.topics.find((t) => t.id === id);
      if (!n) return;
      const ex = s.exams.find((x) => x.id === n.examId);
      const before = Scope.examProgress(s.topics, n.examId).timeLeft;
      n.est = est || null;
      const afterEst = Scope.examProgress(s.topics, n.examId).timeLeft;
      // 시간을 새로 적거나 고친 건 공부한 게 아니니 오늘 아침 기준도 같이 옮긴다
      if (ex && ex.paceSnap && ex.paceSnap.day === Stats.dayKey(Date.now())) ex.paceSnap.left = Math.max(0, ex.paceSnap.left + (afterEst - before));
      const was = Scope.leafPct(n);
      Scope.setLeafProgress(n, pct);
      nowDone = was < 100 && pct >= 100;
    });
    celebrate(id, nowDone);
  });

  function celebrate(id, nowDone) {
    if (!nowDone) return;
    const n = byId(id);
    if (!n) return;
    let card = n;
    while (card.parentId) card = byId(card.parentId);
    const cp = Scope.progress(st().topics, card.id);
    const ep = Scope.examProgress(st().topics, examId);
    if (ep.total && ep.done === ep.total) toast(`체크메이트! ${exam().name} 범위를 모두 끝냈어요 ♛`);
    else if (cp.state === 'all') toast(`'${card.title}' 승급 ♛ 남은 항목 ${ep.total - ep.done}개`);
  }

  function openAdd(parentId) {
    const n = byId(parentId);
    // 목록 보기에서 과목은 늘 보이는 입력칸으로
    if (mode === 'list' && n && !n.parentId) {
      if (n.collapsed) mutate((s) => { s.topics.find((x) => x.id === parentId).collapsed = false; }, false);
      const inp = cardsEl.querySelector(`[data-keep="add:${CSS.escape(parentId)}"]`);
      if (inp) { inp.focus({ preventScroll: true }); ensureVisible(inp); }
      return;
    }
    addTarget = parentId;
    focusAddTarget = true;
    if (n && n.collapsed) mutate((s) => { s.topics.find((x) => x.id === parentId).collapsed = false; }, false);
    else render();
  }

  cardsEl.addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-add-input]');
    if (!input) return;
    if (e.key === 'Escape') { addTarget = null; render(); }
  });

  cardsEl.addEventListener('focusout', (e) => {
    const input = e.target.closest && e.target.closest('[data-add-input]');
    if (!input || renderingNow) return;
    setTimeout(() => {
      if (renderingNow) return;
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-add-input]')) return;
      if (addTarget !== null && !input.value.trim()) { addTarget = null; render(); }
    }, 150);
  });

  cardsEl.addEventListener('dblclick', (e) => {
    const t = e.target.closest('[data-rename]');
    if (t) return startRename(t.dataset.rename, t);
    const note = e.target.closest('[data-note]');
    if (note) return startNoteEdit(note.dataset.note, note);
  });

  function startRename(id, el) {
    const n = byId(id);
    if (!n || el.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'brename';
    input.value = n.title;
    input.maxLength = 200;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== n.title) mutate((s) => { s.topics.find((x) => x.id === id).title = v; });
      else render();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); commit(true); }
      if (ev.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
  }

  function startNoteEdit(id, el) {
    const n = byId(id);
    if (!n || el.querySelector('textarea')) return;
    const ta = document.createElement('textarea');
    ta.className = 'bnote-edit';
    ta.value = n.title || '';
    ta.maxLength = 2000;
    el.textContent = '';
    el.appendChild(ta);
    ta.focus();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save && ta.value !== n.title) mutate((s) => { s.topics.find((x) => x.id === id).title = ta.value.trim(); });
      else render();
    };
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') commit(false); if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) commit(true); });
    ta.addEventListener('blur', () => commit(true));
  }

  /* ---------- 메뉴 ---------- */
  // ⋯ 메뉴: 첫 화면에는 자주 쓰는 것만 두고, 표시(중요·어려움·다시 보기)와 옮기기는 눌러서 들어가는 하위 메뉴로
  let menuAnchor = null;
  function closeMenu() { menu.hidden = true; menu.innerHTML = ''; menu.dataset.page = ''; menuAnchor = null; }
  function clip(t) { t = String(t || ''); return t.length > 12 ? t.slice(0, 11) + '…' : t; }

  function mItem(act, label, o) {
    o = o || {};
    const cls = [o.cls, o.sub && 'pm-sub', o.check && o.on && 'pm-on'].filter(Boolean).join(' ');
    return `<button type="button" role="${o.check ? 'menuitemcheckbox' : 'menuitem'}" data-act="${act}"${cls ? ` class="${cls}"` : ''}` +
      `${o.check ? ` aria-checked="${o.on ? 'true' : 'false'}"` : ''}${o.disabled ? ' disabled' : ''}>` +
      `<span class="pm-label">${esc(label)}</span>${o.hint ? `<span class="pm-hint">${esc(o.hint)}</span>` : ''}` +
      `${o.sub ? '<span class="pm-arrow" aria-hidden="true">›</span>' : ''}${o.check ? `<span class="pm-check" aria-hidden="true">${o.on ? '✓' : ''}</span>` : ''}</button>`;
  }
  const mHead = (title) => `<button type="button" role="menuitem" class="pm-head" data-act="page:main" aria-label="${esc(title)} 닫고 뒤로"><span class="pm-back" aria-hidden="true">‹</span><span class="pm-label">${esc(title)}</span></button>`;
  const colorItem = (n, label) => `<button type="button" role="menuitem" data-act="colors" class="pm-color-item"><i class="pm-swatch" style="background:${esc(n.color || '#888')}"></i><span class="pm-label">${esc(label)}</span></button>`;

  // page: 'main' | 'flags' | 'move'
  function openMenu(id, anchor, page) {
    const n = byId(id);
    if (!n) return;
    page = page || 'main';
    if (anchor) menuAnchor = anchor;
    const isCard = !n.parentId;
    const index = Scope.indexByParent(st().topics);
    const kidsOf = (x) => index.get(x) || [];
    const hasKids = kidsOf(id).length > 0;
    let html = '';
    if (n.kind === 'note') {
      html = mItem('edit-note', '메모 고치기') + colorItem(n, '메모 색 바꾸기') + mItem('delete', '메모 삭제', { cls: 'danger' });
    } else if (page === 'flags') {
      html = mHead('표시') + Object.keys(FLAG_INFO).map((k) => mItem('flag:' + k, `${FLAG_INFO[k].icon}  ${FLAG_INFO[k].label}`, { check: true, on: !!(n.flags && n.flags[k]) })).join('');
    } else if (page === 'move') {
      const sib = Scope.childrenOf(st().topics, n.parentId, examId).filter((x) => (x.kind === 'note') === (n.kind === 'note'));
      const i = sib.findIndex((x) => x.id === id);
      const prev = i > 0 ? sib[i - 1] : null;
      const parent = n.parentId ? byId(n.parentId) : null;
      html = mHead('옮기기') + mItem('up', '위로', { disabled: i <= 0 }) + mItem('down', '아래로', { disabled: i < 0 || i >= sib.length - 1 });
      if (!isCard) {
        html += mItem('indent', '한 단계 안으로', { hint: prev ? `‘${clip(prev.title)}’ 아래로` : '', disabled: !prev });
        html += mItem('outdent', '한 단계 밖으로', { hint: parent && parent.parentId ? `‘${clip(parent.title)}’ 다음으로` : '', disabled: !(parent && parent.parentId) });
        html += mItem('move-to', '다른 곳으로…');
      }
    } else {
      const p = Scope.progress(st().topics, id, index);
      html += mItem('add', isCard ? '공부할 내용 추가' : '하위 항목 추가');
      html += mItem('rename', '이름 바꾸기');
      if (!hasKids) html += mItem('time', '소요시간·진행률');
      const on = Object.keys(FLAG_INFO).filter((k) => n.flags && n.flags[k]).map((k) => FLAG_INFO[k].icon).join(' ');
      html += mItem('page:flags', '표시', { sub: true, hint: on });
      html += mItem('focus', '이 범위로 타이머 시작');
      html += mItem('to-task', '오늘 할 일로 보내기');
      if (p.state === 'some') html += mItem('uncheck-all', '체크 모두 해제');
      if (isCard && hasKids) {
        const anyOpen = Scope.subtreeIds(st().topics, id, index).some((x) => x !== id && kidsOf(x).length && !byId(x).collapsed);
        html += mItem(anyOpen ? 'collapse-all' : 'expand-all', anyOpen ? '안쪽 모두 접기' : '안쪽 모두 펼치기');
      }
      if (!isCard || mode === 'list') html += mItem('page:move', '옮기기', { sub: true });
      if (isCard) html += colorItem(n, '과목 색 바꾸기');
      html += mItem('delete', isCard ? '과목 삭제' : '항목 삭제', { cls: 'danger' });
    }
    const from = menu.dataset.id === id ? menu.dataset.page : ''; // 하위 메뉴에서 돌아오면 그 줄에 초점
    menu.innerHTML = html;
    menu.dataset.id = id;
    menu.dataset.page = page;
    menu.hidden = false;
    placeMenu(id);
    const back = page === 'main' && from && from !== 'main' ? menu.querySelector(`[data-act="page:${from}"]`) : null;
    const first = back || menu.querySelector(page === 'main' ? 'button:not([disabled])' : 'button:not(.pm-head):not([disabled])') || menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  // 메뉴를 ⋯ 버튼 옆에 둔다 (항목이 움직였으면 새 자리의 ⋯ 버튼을 다시 찾는다)
  function placeMenu(id) {
    const a = menuAnchor && menuAnchor.isConnected ? menuAnchor : cardsEl.querySelector(`[data-menu="${CSS.escape(id)}"]`);
    if (a) menuAnchor = a;
    let left = parseFloat(menu.style.left) || 8, top = parseFloat(menu.style.top) || 8;
    // 이전 자리에 붙은 채로 재면 오른쪽 공간만큼 좁아져 글자가 줄바꿈되므로, 왼쪽 끝에서 원래 너비를 잰다
    menu.style.left = '0px';
    menu.style.top = '0px';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (a) {
      const r = a.getBoundingClientRect();
      left = r.right - mw;
      top = r.bottom + 4;
      if (top + mh > innerHeight - 8) top = r.top - mh - 4;
    }
    menu.style.left = Math.max(8, Math.min(left, innerWidth - mw - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(top, innerHeight - mh - 8)) + 'px';
  }

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-menu]') && !e.target.closest('#bb-more')) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) closeMenu(); });
  // 키보드: ↑↓로 줄 이동, →로 하위 메뉴 열기, ←로 하위 메뉴에서 나오기
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button:not([disabled])')];
    const cur = document.activeElement;
    const i = items.indexOf(cur);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'ArrowRight' && cur && /^page:(?!main)/.test(cur.dataset.act || '')) { e.preventDefault(); cur.click(); return; }
    else if (e.key === 'ArrowLeft' && menu.dataset.page && menu.dataset.page !== 'main') { e.preventDefault(); openMenu(menu.dataset.id, null, 'main'); return; }
    else return;
    e.preventDefault();
    if (next) next.focus();
  });

  // 순서·단계 바꾸기 (하위 메뉴는 열어 둔 채로 여러 번 누를 수 있게)
  function moveStep(id, act) {
    const n = byId(id);
    if (!n) return;
    if (act === 'up' || act === 'down') {
      mutate((s) => {
        const sib = Scope.childrenOf(s.topics, n.parentId, examId).filter((x) => (x.kind === 'note') === (n.kind === 'note'));
        sib.forEach((x, i) => { x.order = i; });
        const i = sib.findIndex((x) => x.id === id);
        const j = act === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= sib.length) return;
        sib[i].order = j;
        sib[j].order = i;
      });
    } else if (act === 'indent' || act === 'outdent') {
      mutate((s) => { (act === 'indent' ? Scope.indent : Scope.outdent)(s.topics, id); });
    }
    if (mode === 'board') settleAll = true;
    const row = cardsEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (row) ensureVisible(row);
  }

  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const id = menu.dataset.id;
    const act = b.dataset.act;
    if (id === '__board') { closeMenu(); return boardAction(act); }
    if (act.startsWith('page:')) { openMenu(id, null, act.slice(5)); return; }
    const n = byId(id);
    if (!n) { closeMenu(); return; }
    if (act.startsWith('flag:')) {
      const k = act.slice(5);
      mutate((s) => { const x = s.topics.find((t) => t.id === id); x.flags = Object.assign({}, x.flags); x.flags[k] = !x.flags[k]; });
      openMenu(id, null, 'flags');
      return;
    }
    if (act === 'up' || act === 'down' || act === 'indent' || act === 'outdent') {
      moveStep(id, act);
      openMenu(id, null, 'move');
      return;
    }
    closeMenu();
    if (act === 'add') openAdd(id);
    else if (act === 'time') openTime(id);
    else if (act === 'rename') {
      const el = cardsEl.querySelector(`[data-rename="${CSS.escape(id)}"]`);
      if (el) startRename(id, el);
    } else if (act === 'edit-note') {
      const el = cardsEl.querySelector(`[data-note="${CSS.escape(id)}"]`);
      if (el) startNoteEdit(id, el);
    } else if (act === 'uncheck-all') {
      mutate((s) => Scope.setDone(s.topics, id, false));
    } else if (act === 'focus') {
      let card = n;
      while (card.parentId) card = byId(card.parentId);
      A.focusOn({ label: card.id === n.id ? n.title : `${card.title} · ${n.title}`, subjectName: card.title, topicId: n.id });
    } else if (act === 'to-task') {
      let card = n;
      while (card.parentId) card = byId(card.parentId);
      const title = card.id === n.id ? n.title : `${card.title} · ${n.title}`;
      const subj = st().subjects.find((s) => s.name === card.title);
      const today = Stats.dayKey(Date.now());
      store.update((s) => s.tasks.push({ id: uid(), title, subjectId: subj ? subj.id : null, due: today, estimateMin: null, done: false, createdAt: Date.now(), topicId: n.id }));
      toast('오늘 할 일에 추가했어요');
    } else if (act === 'collapse-all' || act === 'expand-all') {
      const ids = new Set(Scope.subtreeIds(st().topics, id));
      mutate((s) => s.topics.forEach((t) => { if (ids.has(t.id) && t.id !== id) t.collapsed = act === 'collapse-all'; }), false);
    } else if (act === 'colors') {
      // 색 계열별 팔레트에서 고른다
      const c = window.UI ? await UI.pickColor({ title: n.kind === 'note' ? '메모 색' : '과목 색', current: n.color }) : null;
      if (c) mutate((s) => { const t = s.topics.find((x) => x.id === id); if (t) t.color = c; });
    } else if (act === 'move-to') {
      openMoveDialog(id);
    } else if (act === 'delete') {
      const count = Scope.subtreeIds(st().topics, id).length - 1;
      const what = n.kind === 'note' ? '메모' : n.parentId ? '항목' : '과목';
      if (count > 0 && !(await ask(`'${n.title}' ${what}과 안에 든 항목 ${count}개를 삭제할까요? (되돌리기로 복구할 수 있어요)`))) return;
      mutate((s) => keepPace(s, examId, () => { s.topics = Scope.removeSubtree(s.topics, id); }));
      toast(`${n.kind === 'note' ? '메모를' : `'${n.title}' ${what}을`} 삭제했어요 · ↶ 되돌리기로 복구할 수 있어요`);
    }
  });

  /* ---------- 다른 곳으로 옮기기 (어느 과목·항목 아래로 갈지 고르기) ---------- */
  let moveId = null, moveReturn = null;
  function openMoveDialog(id) {
    const n = byId(id);
    if (!n) return;
    moveId = id;
    moveReturn = document.activeElement;
    const targets = Scope.moveTargets(st().topics, id);
    const colorOf = new Map(Scope.childrenOf(st().topics, null, examId).map((c) => [c.id, c.color]));
    $('#move-sub').textContent = `‘${n.title}’${(Scope.indexByParent(st().topics).get(id) || []).length ? '과 그 안의 항목을' : '을'} 고른 곳 아래 맨 끝으로 옮겨요.`;
    $('#move-list').innerHTML = targets.map((t) => `<li><button type="button" class="move-opt${t.depth ? '' : ' card'}" data-move-to="${esc(t.id)}" style="--d:${t.depth}"${t.current ? ' disabled aria-current="true"' : ''}>` +
      `${t.depth ? '' : `<i class="dot" style="background:${esc(colorOf.get(t.id) || '#888')}"></i>`}<span>${esc(t.title)}</span>${t.current ? '<small>지금 위치</small>' : ''}</button></li>`).join('');
    $('#move-dlg').hidden = false;
    const first = $('#move-list button:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }
  function closeMoveDialog() {
    $('#move-dlg').hidden = true;
    moveId = null;
    if (moveReturn && moveReturn.isConnected) { try { moveReturn.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    moveReturn = null;
  }
  $('#move-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-move-to]');
    if (!b || b.disabled || !moveId) return;
    const id = moveId, dest = b.dataset.moveTo;
    const n = byId(id), d = byId(dest);
    closeMoveDialog();
    if (!n || !d) return;
    let moved = false;
    mutate((s) => { moved = Scope.moveTo(s.topics, id, dest); });
    if (!moved) return;
    if (mode === 'board') settleAll = true;
    toast(`‘${clip(n.title)}’을 ‘${clip(d.title)}’ 아래로 옮겼어요`);
    const row = cardsEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (row) { if (mode === 'list') row.scrollIntoView({ block: 'center' }); else ensureVisible(row); }
  });
  $('#move-cancel').addEventListener('click', closeMoveDialog);
  $('#move-dlg').addEventListener('click', (e) => { if (e.target.id === 'move-dlg') closeMoveDialog(); });
  $('#move-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMoveDialog(); });

  /* ---------- 보드 메뉴(⋯) ---------- */
  $('#bb-more').addEventListener('click', (e) => {
    if (!examId) return;
    menu.innerHTML = [
      ['new-exam', '＋ 새 시험 만들기'],
      ['edit-exam', '✎ 시험 이름·날짜·과목 바꾸기'],
      ['add-subject', '＋ 과목 추가'],
      ['paste', '범위 목록 붙여넣기'],
      store.canUndo() ? ['undo', '↶ 되돌리기'] : null,
      ['copy-outline', '범위를 텍스트로 복사'],
      ['download-outline', '범위를 텍스트 파일로 저장'],
      ['print', mode === 'list' ? '범위 인쇄 / PDF' : '보드 인쇄 / PDF'],
      ['uncheck-exam', '이 시험 체크 모두 해제'],
      mode === 'board' ? ['clear-ink', '펜 자국 모두 지우기'] : null,
    ].filter(Boolean).map(([a, l]) => `<button role="menuitem" data-act="${a}">${l}</button>`).join('');
    menu.dataset.id = '__board';
    menu.dataset.page = '';
    menu.hidden = false;
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    const first = menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  });

  async function boardAction(act) {
    if (act === 'new-exam') return openExamDialog(null);
    if (act === 'edit-exam') return openExamDialog(examId);
    if (act === 'paste') return openPaste();
    if (act === 'undo') return undo();
    if (act === 'add-subject') return openSubjectAdd();
    if (act === 'copy-outline' || act === 'download-outline') {
      const text = `${exam().name}${exam().date ? ' (' + exam().date + ')' : ''}\n` + Scope.toOutline(st().topics, examId);
      if (act === 'copy-outline') {
        try { await navigator.clipboard.writeText(text); toast('범위를 복사했어요'); } catch (e) { downloadText(text); }
      } else downloadText(text);
      return;
    }
    if (act === 'print') { window.print(); return; }
    if (act === 'uncheck-exam') {
      if (!(await ask('이 시험의 체크를 모두 해제할까요?'))) return;
      mutate((s) => s.topics.forEach((t) => { if (t.examId === examId) { t.done = false; t.doneAt = null; } }));
    }
    if (act === 'clear-ink') {
      mutate((s) => { s.strokes = s.strokes.filter((x) => x.examId !== examId); });
    }
  }

  function downloadText(text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `${exam().name}-범위.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- 상단 바 ---------- */
  $('#bb-exam').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === '__new') { e.target.value = examId; return openExamDialog(null); }
    store.update((s) => { s.activeExamId = v; }, { silent: true });
    render();
  });

  $('#bb-exam-edit').addEventListener('click', () => examId && openExamDialog(examId));
  $('#bb-paste').addEventListener('click', openPaste);
  $('#bb-add-card').addEventListener('click', () => openSubjectAdd());

  // 과목 추가: 목록 보기는 맨 아래 칸으로, 보드는 작은 창으로
  function openSubjectAdd() {
    if (!examId) return;
    if (mode === 'list') {
      const pk = $('#subj-picker');
      if (pk) { pk.scrollIntoView({ block: 'center' }); const inp = pk.querySelector('input'); if (inp) inp.focus({ preventScroll: true }); }
      return;
    }
    const used = Scope.childrenOf(st().topics, null, examId).filter((c) => c.kind !== 'note').map((c) => c.title);
    $('#subj-chips').innerHTML = subjectSuggestions(used).slice(0, 14).map((n) => `<button type="button" class="chip sas-chip" data-subject-add="${esc(n)}">＋ ${esc(n)}</button>`).join('');
    $('#subj-name').value = '';
    $('#subj-dlg').hidden = false;
    $('#subj-name').focus();
  }
  const closeSubjectDlg = () => { $('#subj-dlg').hidden = true; };
  $('#subj-cancel').addEventListener('click', closeSubjectDlg);
  $('#subj-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSubjectDlg(); });
  $('#subj-dlg').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) return closeSubjectDlg();
    const b = e.target.closest('[data-subject-add]');
    if (!b) return;
    closeSubjectDlg();
    addSubjectCards([b.dataset.subjectAdd]);
  });
  $('#subj-form').addEventListener('submit', (e) => {
    e.preventDefault();
    afterComposition(() => {
      const name = $('#subj-name').value.trim();
      if (!name) return $('#subj-name').focus();
      closeSubjectDlg();
      addSubjectCards([name]);
    });
  });
  $('#bb-add-note').addEventListener('click', () => addCardAtCenter('note'));
  $('#bb-zoom-in').addEventListener('click', () => zoomBy(1.25));
  $('#bb-zoom-out').addEventListener('click', () => zoomBy(0.8));
  $('#bb-zoom-label').addEventListener('click', () => { const r = vp.getBoundingClientRect(); zoomAt(1, r.width / 2, r.height / 2); });
  $('#bb-fit').addEventListener('click', fit);
  $('#bb-arrange').addEventListener('click', () => {
    mutate((s) => {
      // 메모는 그대로 두고, 화면에 실제로 보이는 높이로 다시 쌓는다
      const heights = new Map($$('#board-cards .bcard').map((el) => [el.dataset.id, el.offsetHeight]));
      const cards = Scope.childrenOf(s.topics, null, examId).filter((c) => c.kind !== 'note');
      const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(cards.length * 1.4))));
      const colH = new Array(cols).fill(80);
      for (const c of cards) {
        let col = 0;
        for (let i = 1; i < cols; i++) if (colH[i] < colH[col]) col = i;
        c.x = 80 + col * (Scope.CARD_W + Scope.GAP);
        c.y = colH[col];
        colH[col] += (heights.get(c.id) || Scope.estimateHeight(s.topics, c.id)) + Scope.GAP;
      }
    });
    requestAnimationFrame(fit);
  });
  $('#bb-undo').addEventListener('click', undo);

  function undo() {
    if (store.undo()) toast('되돌렸어요');
  }

  $('#board-bar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]');
    if (t) return setTool(t.dataset.tool);
    const c = e.target.closest('[data-color]');
    if (c) {
      inkColor = c.dataset.color;
      if (tool === 'select' || tool === 'eraser') setTool('pen');
      else renderBar();
    }
  });

  $('#board-legend').addEventListener('change', (e) => {
    if (e.target.id === 'bl-only-left') { onlyLeft = e.target.checked; render(); }
  });

  function setToolClass() {
    ['select', 'pen', 'marker', 'eraser'].forEach((t) => vp.classList.toggle('tool-' + t, t === tool));
  }

  function setTool(t) {
    tool = t;
    $$('#board-bar [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    setToolClass();
    renderBar();
  }

  function addCardAtCenter(kind) {
    if (!examId) return;
    const r = vp.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const id = uid();
    const used = Scope.childrenOf(st().topics, null, examId).length;
    mutate((s) => s.topics.push({
      id, examId, parentId: null, kind, title: kind === 'note' ? '' : '새 카드', done: false, flags: {},
      order: Scope.nextOrder(s.topics, null, examId), collapsed: false,
      x: Math.round(c.x - Scope.CARD_W / 2 + (used % 5) * 16), y: Math.round(c.y - 60 + (used % 5) * 16),
      color: kind === 'note' ? '#f5d65b' : Scope.COLORS[used % Scope.COLORS.length],
    }));
    setTool('select');
    requestAnimationFrame(() => {
      const el = cardsEl.querySelector(kind === 'note' ? `[data-note="${id}"]` : `[data-rename="${id}"]`);
      if (!el) return;
      if (kind === 'note') startNoteEdit(id, el);
      else startRename(id, el);
    });
  }

  /* ---------- 시험 만들기·편집 ---------- */
  function createExam(name, date, outline) {
    const id = uid();
    store.update((s) => {
      s.exams.push({ id, name, date: date || null, createdAt: Date.now() });
      s.activeExamId = id;
      if (outline) Scope.addOutline(s.topics, id, Scope.parseOutline(outline), uid);
    }, { undoable: true });
    needsFit = true;
    render();
    return id;
  }

  // 과목 여러 개 고르기 (시험 만들 때)
  function subjectToggle(box, input, addBtn) {
    let picked = [];
    let extra = [];
    const names = () => { const base = subjectSuggestions([]); return base.concat(extra.filter((n) => !base.includes(n))); };
    const api = {
      draw() {
        box.innerHTML = names().map((n) => `<button type="button" class="chip sas-chip pick" aria-pressed="${picked.includes(n)}" data-pick="${esc(n)}">${picked.includes(n) ? '✓ ' : ''}${esc(n)}</button>`).join('');
      },
      picked() { const order = names(); return picked.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)); },
      reset() { picked = []; extra = []; input.value = ''; api.draw(); },
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const n = b.dataset.pick;
      picked = picked.includes(n) ? picked.filter((x) => x !== n) : picked.concat(n);
      api.draw();
    });
    const addCustom = () => {
      const n = input.value.trim().slice(0, 40);
      if (!n) return;
      if (!names().includes(n)) extra.push(n);
      if (!picked.includes(n)) picked.push(n);
      input.value = '';
      api.draw();
    };
    addBtn.addEventListener('click', () => afterComposition(addCustom));
    // 시험 만들기 폼이 제출되지 않게: Enter는 과목 추가로
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); afterComposition(addCustom); } });
    api.draw();
    return api;
  }
  const wizard = subjectToggle($('#ex-subjects'), $('#ex-subject-custom'), $('#ex-subject-add'));
  const dlgSubjects = subjectToggle($('#ee-subjects'), $('#ee-subject-custom'), $('#ee-subject-add'));

  // 새 시험 + 고른 과목 → 목록 보기에서 과목마다 공부할 내용 적기
  function startExam(name, date, subjects) {
    createExam(name, date);
    if (!modePref) mode = 'list';
    if (subjects.length) addSubjectCards(subjects, { quiet: true });
    render();
    if (mode === 'list') {
      vp.scrollTop = 0;
      const first = cardsEl.querySelector('.sadd-input') || cardsEl.querySelector('.sas-input');
      if (first) first.focus({ preventScroll: true });
      toast(subjects.length ? `${subjects[0]}부터 공부할 내용을 하나씩 적어 보세요` : '과목을 먼저 골라 주세요');
    } else {
      toast(subjects.length ? '과목 카드의 ＋ 공부할 내용 추가로 항목을 적어 보세요' : '＋ 과목으로 과목을 추가해 보세요');
    }
  }

  $('#exam-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#ex-name').value.trim();
    if (!name) return;
    const subjects = wizard.picked();
    startExam(name, $('#ex-date').value, subjects);
    $('#ex-name').value = '';
    $('#ex-date').value = '';
    wizard.reset();
  });

  $('#exam-paste').addEventListener('click', () => {
    const name = $('#ex-name').value.trim();
    if (!name) { toast('시험 이름을 먼저 적어 주세요'); $('#ex-name').focus(); return; }
    createExam(name, $('#ex-date').value);
    $('#ex-name').value = '';
    $('#ex-date').value = '';
    wizard.reset();
    openPaste();
  });

  $('#exam-sample').addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    createExam('예시: 2학기 중간고사', Stats.dayKey(d.getTime()), Scope.SAMPLE);
    toast('예시 범위를 펼쳤어요. 항목을 눌러 체크해 보세요');
  });

  let editingExam = null;
  function openExamDialog(id) {
    editingExam = id;
    const ex = id ? st().exams.find((e) => e.id === id) : null;
    $('#exam-dlg-title').textContent = ex ? '시험 편집' : '새 시험';
    $('#ee-name').value = ex ? ex.name : '';
    $('#ee-date').value = ex && ex.date ? ex.date : '';
    $('#ee-delete').hidden = !ex;
    $('#ee-subjects-wrap').hidden = !!ex;
    if (!ex) dlgSubjects.reset();
    $('#exam-dlg').hidden = false;
    $('#ee-name').focus();
  }
  const closeExamDialog = () => { $('#exam-dlg').hidden = true; };
  $('#ee-cancel').addEventListener('click', closeExamDialog);
  $('#exam-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExamDialog(); });
  $('#exam-edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#ee-name').value.trim();
    if (!name) return;
    const date = $('#ee-date').value || null;
    closeExamDialog();
    if (editingExam) {
      mutate((s) => { const ex = s.exams.find((x) => x.id === editingExam); ex.name = name; ex.date = date; });
    } else {
      startExam(name, date, dlgSubjects.picked());
    }
  });
  $('#ee-delete').addEventListener('click', async () => {
    const ex = st().exams.find((x) => x.id === editingExam);
    if (!ex) return;
    closeExamDialog();
    if (!(await ask(`'${ex.name}' 시험과 범위 카드를 모두 삭제할까요? (되돌리기로 복구할 수 있어요)`))) return;
    mutate((s) => {
      s.exams = s.exams.filter((x) => x.id !== ex.id);
      s.topics = s.topics.filter((t) => t.examId !== ex.id);
      s.strokes = s.strokes.filter((t) => t.examId !== ex.id);
      delete s.boardView[ex.id];
      if (s.activeExamId === ex.id) s.activeExamId = s.exams[0] ? s.exams[0].id : null;
    });
  });

  /* ---------- 검색 ---------- */
  let search = { q: '', hits: [], i: -1 };
  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) { search = { q: '', hits: [], i: -1 }; $('#bb-search-count').textContent = ''; return; }
    if (q !== search.q) {
      const hits = st().topics.filter((t) => t.examId === examId && (t.title || '').toLowerCase().includes(q)).map((t) => t.id);
      search = { q, hits, i: -1 };
    }
    if (!search.hits.length) { $('#bb-search-count').textContent = '없음'; return; }
    search.i = (search.i + 1) % search.hits.length;
    $('#bb-search-count').textContent = `${search.i + 1}/${search.hits.length}`;
    revealTopic(search.hits[search.i]);
  }

  // 항목이 보이도록 상위를 펼치고, 화면 가운데로 옮겨 잠깐 강조
  function revealTopic(id) {
    const chain = [];
    let n = byId(id);
    while (n && n.parentId) { n = byId(n.parentId); if (n) chain.push(n.id); }
    if (chain.some((cid) => byId(cid).collapsed)) {
      mutate((s) => s.topics.forEach((t) => { if (chain.includes(t.id)) t.collapsed = false; }), false);
    }
    if (onlyLeft) { onlyLeft = false; render(); }
    const sel = `[data-id="${CSS.escape(id)}"]`;
    const el = cardsEl.querySelector(`.bitem${sel} > .brow`) || cardsEl.querySelector(`.bcard${sel}`);
    if (!el) return;
    if (mode === 'list') {
      el.scrollIntoView({ block: 'center' });
      el.classList.remove('flash-hit'); void el.offsetWidth; el.classList.add('flash-hit');
      return;
    }
    const r = vp.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (view.z < 0.8) {
      const z = 1;
      const wx = (e.left + e.width / 2 - r.left - view.x) / view.z;
      const wy = (e.top + e.height / 2 - r.top - view.y) / view.z;
      view.z = z;
      view.x = r.width / 2 - wx * z;
      view.y = r.height / 2 - wy * z;
    } else {
      view.x += r.left + r.width / 2 - (e.left + e.width / 2);
      view.y += r.top + r.height / 2 - (e.top + e.height / 2);
    }
    applyView();
    el.classList.remove('flash-hit');
    void el.offsetWidth;
    el.classList.add('flash-hit');
  }

  $('#bb-search').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('#bb-search-input').value); });
  $('#bb-search-input').addEventListener('input', (e) => { if (!e.target.value) runSearch(''); });

  /* ---------- 범위 붙여넣기 ---------- */
  function openPaste() {
    if (!examId) return;
    $('#paste-dlg').hidden = false;
    updatePasteCount();
    $('#paste-text').focus();
  }
  const closePaste = () => { $('#paste-dlg').hidden = true; };
  function updatePasteCount() {
    const tree = Scope.parseOutline($('#paste-text').value);
    const n = Scope.countOutline(tree);
    $('#paste-count').textContent = n ? `카드 ${tree.length}개 · 항목 ${n}개` : '';
    $('#paste-ok').disabled = !n;
  }
  $('#paste-text').addEventListener('input', updatePasteCount);
  $('#paste-text').addEventListener('keydown', (e) => {
    // 탭 키로 들여쓰기
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.target;
      const s = ta.selectionStart, en = ta.selectionEnd;
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) {
        if (ta.value.slice(lineStart, lineStart + 2) === '  ') {
          ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineStart + 2);
          ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - 2);
        }
      } else {
        ta.value = ta.value.slice(0, lineStart) + '  ' + ta.value.slice(lineStart);
        ta.selectionStart = s + 2; ta.selectionEnd = en + 2;
      }
      updatePasteCount();
    }
    if (e.key === 'Escape') closePaste();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#paste-ok').click();
  });
  $('#paste-cancel').addEventListener('click', closePaste);
  $('#paste-sample').addEventListener('click', () => { $('#paste-text').value = Scope.SAMPLE; updatePasteCount(); });
  $('#paste-ok').addEventListener('click', () => {
    const tree = Scope.parseOutline($('#paste-text').value);
    if (!tree.length) return;
    let added = [];
    mutate((s) => { added = Scope.addOutline(s.topics, examId, tree, uid); });
    $('#paste-text').value = '';
    closePaste();
    needsFit = true;
    render();
    toast(`카드 ${added.length}개, 항목 ${Scope.countOutline(tree)}개를 추가했어요`);
  });

  /* ---------- 포인터: 이동·확대·카드 끌기·펜 ---------- */
  const pointers = new Map();
  let gesture = null;

  function isInteractive(el) {
    return !!el.closest('button, input, textarea, select, label, a, .badd-row');
  }

  vp.addEventListener('pointerdown', (e) => {
    if (mode === 'list' || !examId || e.target.closest('.board-empty, .board-legend')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // 두 손가락: 확대/이동 (진행 중인 펜·끌기는 취소)
      if (gesture && gesture.type === 'ink' && gesture.el) gesture.el.remove();
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), z: view.z, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vx: view.x, vy: view.y };
      return;
    }
    if (pointers.size > 2) return;

    const panKey = e.button === 1 || spaceDown;
    if ((tool === 'pen' || tool === 'marker') && !panKey && e.button === 0) {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      const marker = tool === 'marker';
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('class', marker ? 'marker' : 'pen');
      el.setAttribute('stroke', inkColor);
      el.setAttribute('stroke-width', marker ? 18 : 3);
      ink.appendChild(el);
      gesture = { type: 'ink', points: [[Math.round(p.x), Math.round(p.y)]], el, marker };
      el.setAttribute('d', strokePath(gesture.points));
      vp.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'eraser' && !panKey && e.button === 0) {
      e.preventDefault();
      gesture = { type: 'erase', first: true };
      eraseAt(e.clientX, e.clientY);
      vp.setPointerCapture(e.pointerId);
      return;
    }

    const drag = e.target.closest('[data-drag]');
    if (drag && !isInteractive(e.target) && tool === 'select' && !panKey) {
      const card = drag.closest('.bcard');
      gesture = { type: 'maybe-card', id: drag.dataset.drag, el: card, sx: e.clientX, sy: e.clientY, ox: parseFloat(card.style.left), oy: parseFloat(card.style.top), pid: e.pointerId };
      return;
    }
    if (isInteractive(e.target) && !panKey) return;
    gesture = { type: 'maybe-pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, pid: e.pointerId };
  });

  vp.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;

    if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = vp.getBoundingClientRect();
      const z = Math.min(Z_MAX, Math.max(Z_MIN, gesture.z * (dist / gesture.dist)));
      const wx = (gesture.mid.x - r.left - gesture.vx) / gesture.z;
      const wy = (gesture.mid.y - r.top - gesture.vy) / gesture.z;
      view.z = z;
      view.x = mid.x - r.left - wx * z;
      view.y = mid.y - r.top - wy * z;
      applyView();
      return;
    }
    if (gesture.type === 'ink') {
      const p = toWorld(e.clientX, e.clientY);
      const last = gesture.points[gesture.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * view.z < 2) return;
      gesture.points.push([Math.round(p.x), Math.round(p.y)]);
      gesture.el.setAttribute('d', strokePath(gesture.points));
      return;
    }
    if (gesture.type === 'erase') { eraseAt(e.clientX, e.clientY); return; }

    const dx = e.clientX - gesture.sx;
    const dy = e.clientY - gesture.sy;
    if (gesture.type === 'maybe-card' || gesture.type === 'maybe-pan') {
      if (Math.hypot(dx, dy) < 4) return;
      gesture.type = gesture.type === 'maybe-card' ? 'card' : 'pan';
      try { vp.setPointerCapture(gesture.pid); } catch (err) { /* 무시 */ }
      vp.classList.add('dragging');
      if (gesture.type === 'card') gesture.el.classList.add('lifted');
    }
    if (gesture.type === 'pan') {
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      applyView();
    } else if (gesture.type === 'card') {
      gesture.el.style.left = gesture.ox + dx / view.z + 'px';
      gesture.el.style.top = gesture.oy + dy / view.z + 'px';
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (!gesture) return;
    const g = gesture;
    if (g.type === 'pinch') {
      if (pointers.size < 2) gesture = null;
      return;
    }
    gesture = null;
    vp.classList.remove('dragging');
    if (g.type === 'ink') {
      if (e.type === 'pointercancel') { g.el.remove(); return; }
      const id = uid();
      mutate((s) => s.strokes.push({ id, examId, points: g.points, color: inkColor, width: g.marker ? 18 : 3, marker: g.marker }));
    } else if (g.type === 'card') {
      g.el.classList.remove('lifted');
      const x = Math.round(parseFloat(g.el.style.left) / SNAP) * SNAP;
      const y = Math.round(parseFloat(g.el.style.top) / SNAP) * SNAP;
      mutate((s) => { const c = s.topics.find((t) => t.id === g.id); if (c) { c.x = Math.max(0, Math.min(WORLD_W - Scope.CARD_W, x)); c.y = Math.max(0, Math.min(WORLD_H - 60, y)); } });
    }
  }
  vp.addEventListener('pointerup', endPointer);
  vp.addEventListener('pointercancel', endPointer);

  function eraseAt(cx, cy) {
    const p = toWorld(cx, cy);
    const tol = 10 / view.z;
    const hit = st().strokes.find((s) => s.examId === examId && s.points.some(([x, y], i, arr) => {
      if (Math.hypot(x - p.x, y - p.y) < tol + s.width / 2) return true;
      if (i === 0) return false;
      return distToSeg(p.x, p.y, arr[i - 1][0], arr[i - 1][1], x, y) < tol + s.width / 2;
    }));
    if (!hit) return;
    const undoable = gesture && gesture.first;
    if (gesture) gesture.first = false;
    store.update((s) => { s.strokes = s.strokes.filter((x) => x.id !== hit.id); }, { undoable });
  }

  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l = dx * dx + dy * dy;
    let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  vp.addEventListener('wheel', (e) => {
    if (mode === 'list' || !examId || e.target.closest('.board-empty')) return;
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(view.z * Math.exp(-e.deltaY * 0.0025 * (e.deltaMode === 1 ? 16 : 1)), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      applyView();
    }
  }, { passive: false });

  /* ---------- 키보드 ---------- */
  let spaceDown = false;
  document.addEventListener('keydown', (e) => {
    if (A.view !== 'board' || !examId) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (!$('#paste-dlg').hidden || !$('#exam-dlg').hidden || !$('#ask').hidden || !$('#subj-dlg').hidden || !$('#time-dlg').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || mode === 'list') return;
    if (e.key === ' ') { spaceDown = true; vp.classList.add('space-pan'); e.preventDefault(); return; }
    const k = e.key.toLowerCase();
    if (k === 'v') setTool('select');
    else if (k === 'p') setTool('pen');
    else if (k === 'h') setTool('marker');
    else if (k === 'e') setTool('eraser');
    else if (k === '0') fit();
    else if (k === '=' || k === '+') zoomBy(1.25);
    else if (k === '-') zoomBy(0.8);
    else if (k === 'escape' && tool !== 'select') setTool('select');
    else if (k === '/' || k === 'f') { e.preventDefault(); $('#bb-search-input').focus(); }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; vp.classList.remove('space-pan'); }
  });

  window.addEventListener('resize', () => { if (A.view === 'board') applyView(); });

  // 보드에서는 브라우저 스크롤 대신 보드 이동으로 (입력칸에 커서를 둘 때 브라우저가 밀어 올린 만큼을 옮겨 담는다)
  vp.addEventListener('scroll', () => {
    if (mode !== 'board' || (!vp.scrollTop && !vp.scrollLeft)) return;
    view.x -= vp.scrollLeft;
    view.y -= vp.scrollTop;
    vp.scrollTop = 0;
    vp.scrollLeft = 0;
    applyView();
  });

  window.Board = { render, fit, get view() { return Object.assign({}, view); }, get mode() { return mode; }, setMode: setScopeMode, setTool, zoomAt };
  if (A.view === 'board') render();
})();
