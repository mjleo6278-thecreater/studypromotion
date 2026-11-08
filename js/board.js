/* 시험 범위 화이트보드
 * 넓은 보드 위에 과목/범주 카드를 펼쳐 놓고, 단원·세부 항목을 하나씩 체크한다.
 * 이동(드래그·휠), 확대(Ctrl+휠·핀치·버튼), 펜/형광펜/지우개, 메모, 되돌리기를 지원한다.
 */
(function () {
  'use strict';
  const A = window.App;
  if (!A) return;
  const { store, $, $$, esc, toast, ask, uid } = A;

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
  let renderingNow = false;

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
      store.update((s) => { s.boardView[id] = { x: Math.round(view.x), y: Math.round(view.y), z: +view.z.toFixed(3) }; }, { silent: true });
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

  function addRow(parentId) {
    return `<li class="badd-row"><input class="badd-input" data-add-input="${esc(parentId)}" placeholder="항목 이름 입력 후 Enter" maxlength="200"></li>`;
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
        ${hasKids ? `<span class="bcount">${p.done}/${p.total}</span>` : ''}
        <button class="bmenu" data-menu="${esc(n.id)}" aria-label="${esc(n.title)} 메뉴">⋯</button>
      </div>
      ${childHtml || adding ? `<ul>${childHtml}${adding ? addRow(n.id) : ''}</ul>` : ''}
    </li>`;
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
    const list = kids.map((k) => itemHtml(k, index, 0)).join('');
    const adding = addTarget === c.id;
    const doneAll = p.state === 'all';
    return `<div class="bcard s-${p.state}${doneAll ? ' complete' : ''}" data-id="${esc(c.id)}" style="${style}">
      <div class="bcard-head" data-drag="${esc(c.id)}">
        ${checkBtn(c.id, p.state, c.title)}
        <div class="bcard-title" data-rename="${esc(c.id)}">${esc(c.title)}</div>
        ${flagsHtml(c)}
        <button class="bmenu" data-menu="${esc(c.id)}" aria-label="${esc(c.title)} 메뉴">⋯</button>
      </div>
      <div class="bcard-prog"><div class="bbar"><div style="width:${p.pct}%"></div></div><span>${p.done}/${p.total} · ${p.pct}%</span></div>
      ${list || adding ? `<ul class="btree">${list}${adding ? addRow(c.id) : ''}</ul>` : ''}
      ${onlyLeft && kids.length && !list && !adding ? '<p class="bcard-done muted">이 카드는 다 끝냈어요</p>' : ''}
      <button class="badd" data-add="${esc(c.id)}">＋ 항목 추가</button>
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
    const pc = ex ? Scope.pace(p.total - p.done, ex.date, Date.now()) : null;
    $('#bb-pace').textContent = pc ? (pc.days > 0 ? `하루 ${pc.perDay}개씩` : `남은 ${pc.perDay}개`) : '';
    $('#bb-pace').title = pc && pc.days > 0 ? `시험까지 ${pc.days}일, 남은 항목 ${p.total - p.done}개` : '';
    $('#bb-pace').hidden = !pc;
    $('#bb-track').innerHTML = A.pawnTrack(p.pct);
    $('#bb-track').setAttribute('aria-label', `전체 진행률 ${p.pct}%`);
    $('#bb-pct').textContent = `${p.done}/${p.total} · ${p.pct}%`;
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
  }

  function render() {
    if (renderingNow) return;
    renderingNow = true;
    try {
      const prevExam = examId;
      examId = pickExam();
      const has = !!examId;
      $('#board-empty').hidden = has;
      world.hidden = !has;
      $('#board-bar').classList.toggle('disabled', !has);
      if (!has) {
        $('#board-legend').innerHTML = '';
        $('#bb-exam').innerHTML = '<option>시험 없음</option>';
        $('#bb-dday').hidden = true;
        $('#bb-pct').textContent = '';
        $('#bb-track').innerHTML = '';
        vp.style.backgroundPosition = '0 0';
        return;
      }
      if (prevExam !== examId) {
        const saved = st().boardView[examId];
        if (saved) Object.assign(view, saved);
        else needsFit = true;
        addTarget = null;
      }
      setToolClass();
      renderBar();
      const index = Scope.indexByParent(st().topics);
      const cards = index.get('root:' + examId) || [];
      cardsEl.innerHTML = cards.map((c) => cardHtml(c, index)).join('') ||
        '<div class="board-hint">위의 <b>범위 붙여넣기</b>로 시험 범위를 한 번에 넣거나, <b>＋ 카드</b>로 과목을 하나씩 추가하세요.</div>';
      renderInk();
      applyView();
      if (needsFit) { needsFit = false; requestAnimationFrame(firstView); }
      const input = cardsEl.querySelector('.badd-input');
      if (input) input.focus({ preventScroll: true });
    } finally {
      renderingNow = false;
    }
  }

  /* ---------- 체크·접기·추가·이름 바꾸기 ---------- */
  cardsEl.addEventListener('click', (e) => {
    const chk = e.target.closest('[data-check]');
    if (chk) {
      const id = chk.dataset.check;
      let nowDone = false;
      mutate((s) => { nowDone = Scope.toggle(s.topics, id); });
      celebrate(id, nowDone);
      return;
    }
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
    addTarget = parentId;
    const n = byId(parentId);
    if (n && n.collapsed) mutate((s) => { s.topics.find((x) => x.id === parentId).collapsed = false; }, false);
    else render();
  }

  cardsEl.addEventListener('keydown', (e) => {
    const input = e.target.closest('[data-add-input]');
    if (!input) return;
    if (e.key === 'Escape') { addTarget = null; render(); return; }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const title = input.value.trim();
    if (!title) { addTarget = null; render(); return; }
    const parentId = input.dataset.addInput;
    // 여러 줄 붙여넣기 대비: 한 줄씩
    mutate((s) => {
      let order = Scope.nextOrder(s.topics, parentId, examId);
      for (const line of title.split(/\n/)) {
        const t = line.trim();
        if (t) s.topics.push({ id: uid(), examId, parentId, kind: 'topic', title: t.slice(0, 200), done: false, flags: {}, order: order++, collapsed: false });
      }
      // 체크돼 있던 잎 항목에 하위가 생기면 그 체크는 하위로 옮겨 가지 않는다(새 항목은 미완료)
    });
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
  function closeMenu() { menu.hidden = true; menu.innerHTML = ''; }

  function openMenu(id, anchor) {
    const n = byId(id);
    if (!n) return;
    const isCard = !n.parentId;
    const items = [];
    if (n.kind === 'note') {
      items.push(['edit-note', '메모 고치기']);
      items.push(['colors', '']);
      items.push(['delete', '메모 삭제', 'danger']);
    } else {
      items.push(['add', isCard ? '항목 추가' : '하위 항목 추가']);
      items.push(['rename', '이름 바꾸기']);
      for (const k of Object.keys(FLAG_INFO)) items.push(['flag:' + k, `${FLAG_INFO[k].icon} ${FLAG_INFO[k].label} ${n.flags && n.flags[k] ? '표시 빼기' : '표시'}`]);
      items.push(['check-all', '모두 체크']);
      items.push(['uncheck-all', '모두 체크 해제']);
      items.push(['focus', '◷ 이 범위로 타이머 시작']);
      items.push(['to-task', '오늘 할 일로 보내기']);
      if (isCard) { items.push(['collapse-all', '모두 접기']); items.push(['expand-all', '모두 펼치기']); items.push(['colors', '']); }
      else { items.push(['up', '위로 옮기기']); items.push(['down', '아래로 옮기기']); }
      items.push(['delete', isCard ? '카드 삭제' : '항목 삭제', 'danger']);
    }
    menu.innerHTML = items.map(([act, label, cls]) => act === 'colors'
      ? `<div class="pm-colors">${Scope.COLORS.map((c) => `<button data-act="color" data-val="${c}" style="--c:${c}" aria-label="색 ${c}"></button>`).join('')}</div>`
      : `<button role="menuitem" data-act="${act}" class="${cls || ''}">${esc(label)}</button>`).join('');
    menu.dataset.id = id;
    menu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.right - mw;
    let top = r.bottom + 4;
    if (left < 8) left = 8;
    if (left + mw > innerWidth - 8) left = innerWidth - mw - 8;
    if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    const first = menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('[data-menu]') && !e.target.closest('#bb-more')) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) closeMenu(); });

  menu.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = menu.dataset.id;
    const act = b.dataset.act;
    closeMenu();
    if (id === '__board') return boardAction(act);
    const n = byId(id);
    if (!n) return;
    if (act === 'add') openAdd(id);
    else if (act === 'rename') {
      const el = cardsEl.querySelector(`[data-rename="${CSS.escape(id)}"]`);
      if (el) startRename(id, el);
    } else if (act === 'edit-note') {
      const el = cardsEl.querySelector(`[data-note="${CSS.escape(id)}"]`);
      if (el) startNoteEdit(id, el);
    } else if (act.startsWith('flag:')) {
      const k = act.slice(5);
      mutate((s) => { const x = s.topics.find((t) => t.id === id); x.flags = Object.assign({}, x.flags); x.flags[k] = !x.flags[k]; });
    } else if (act === 'check-all' || act === 'uncheck-all') {
      mutate((s) => Scope.setDone(s.topics, id, act === 'check-all'));
      if (act === 'check-all') celebrate(id, true);
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
    } else if (act === 'color') {
      mutate((s) => { s.topics.find((t) => t.id === id).color = b.dataset.val; });
    } else if (act === 'up' || act === 'down') {
      mutate((s) => {
        const sib = Scope.childrenOf(s.topics, n.parentId, examId);
        sib.forEach((x, i) => { x.order = i; });
        const i = sib.findIndex((x) => x.id === id);
        const j = act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= sib.length) return;
        sib[i].order = j;
        sib[j].order = i;
      });
    } else if (act === 'delete') {
      const count = Scope.subtreeIds(st().topics, id).length - 1;
      const what = n.kind === 'note' ? '메모' : n.parentId ? '항목' : '카드';
      if (count > 0 && !(await ask(`'${n.title}' ${what}과 하위 항목 ${count}개를 삭제할까요? (되돌리기로 복구할 수 있어요)`))) return;
      mutate((s) => { s.topics = Scope.removeSubtree(s.topics, id); });
    }
  });

  /* ---------- 보드 메뉴(⋯) ---------- */
  $('#bb-more').addEventListener('click', (e) => {
    if (!examId) return;
    menu.innerHTML = [
      ['new-exam', '＋ 새 시험 만들기'],
      ['copy-outline', '범위를 텍스트로 복사'],
      ['download-outline', '범위를 텍스트 파일로 저장'],
      ['print', '보드 인쇄 / PDF'],
      ['uncheck-exam', '이 시험 체크 모두 해제'],
      ['clear-ink', '펜 자국 모두 지우기'],
    ].map(([a, l]) => `<button role="menuitem" data-act="${a}">${l}</button>`).join('');
    menu.dataset.id = '__board';
    menu.hidden = false;
    const r = e.currentTarget.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
  });

  async function boardAction(act) {
    if (act === 'new-exam') return openExamDialog(null);
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
  $('#bb-add-card').addEventListener('click', () => addCardAtCenter('topic'));
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

  $('#exam-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#ex-name').value.trim();
    if (!name) return;
    createExam(name, $('#ex-date').value);
    $('#ex-name').value = '';
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
      createExam(name, date);
      openPaste();
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
    if (!examId || e.target.closest('.board-empty, .board-legend')) return;
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
    if (!examId || e.target.closest('.board-empty')) return;
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
    if (!$('#paste-dlg').hidden || !$('#exam-dlg').hidden || !$('#ask').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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

  window.Board = { render, fit, get view() { return Object.assign({}, view); }, setTool, zoomAt };
  if (A.view === 'board') render();
})();
