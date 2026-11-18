/* 시험 범위 화이트보드
 * 넓은 보드 위에 과목/범주 카드를 펼쳐 놓고, 단원·세부 항목을 하나씩 체크한다.
 * 이동(드래그·휠), 확대(Ctrl+휠·핀치·버튼), 펜/형광펜/지우개, 메모(붙임쪽지·글 상자), 되돌리기를 지원한다.
 * 보드 보기는 전체 화면이다: 위 앱 바와 아래 탭을 숨기고(body.board-full) 도구는 아래 도구 띠(#board-dock)에 둔다.
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
  const dock = $('#board-dock');
  const noteBar = $('#note-bar');

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

  // 보기 방식: 목록(과목 → 공부할 내용) / 보드(화이트보드, 전체 화면).
  // 범위 탭은 늘 목록부터 열고, '보드'를 누르면 화이트보드가 화면 전체로 열린다. '목록'·뒤로 가기·Esc로 돌아온다.
  let mode = 'list';
  const FULL_TIP_KEY = 'studypromotion.boardFullTip'; // 전체 화면에서 돌아가는 방법은 처음 한 번만 알려 준다

  /* ---------- 메모: 붙임쪽지(기본)와 글 상자(style 'text') ----------
     노드: { kind: 'note', title(내용), x, y, w?(폭), color, size?('s'|'m'|'l'), style?('text') }
     쓰는 중인 메모는 noteEdit에 두고 다시 그릴 때마다 입력칸을 같이 그린다(다시 그려도 글자·커서가 남는다).
     새 메모는 글을 적어야 보드에 남는다(draftNote): 빈 채로 닫으면 사라지고, 되돌리기에도 빈 메모가 끼지 않는다. */
  const NOTE_W = 220;
  const NOTE_MIN_W = 120;
  const NOTE_MAX_W = 720;
  const NOTE_PAPER = ['#fff3a8', '#ffd3df', '#cdeecb', '#cfe6ff', '#e6dbff']; // 쪽지 종이 색
  const NOTE_INK = ['', '#e03131', '#1c7ed6', '#2b8a3e', '#f08c00']; // 글 상자 글자 색 ('' = 화면 기본 글자색)
  const NOTE_SIZES = ['s', 'm', 'l'];
  const NOTE_SIZE_LABEL = { s: '작게', m: '보통', l: '크게' };
  let noteEdit = null; // { id, value }
  let draftNote = null;
  let focusNote = false;
  const lastNote = { paper: NOTE_PAPER[0], ink: NOTE_INK[0], size: 'm' }; // 방금 쓴 색·크기로 다음 메모를 만든다
  const isText = (n) => n.style === 'text';
  const noteColors = (n) => (isText(n) ? NOTE_INK : NOTE_PAPER);
  const noteColor = (n) => { const list = noteColors(n); return list.includes(n.color) ? n.color : list[0]; }; // 예전 메모(다른 색 값)는 기본색으로
  const noteSize = (n) => (NOTE_SIZES.includes(n.size) ? n.size : 'm');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };

  // 한글 입력 중(조합 중)에 Enter가 눌려도 글자가 빠지지 않도록: 조합이 끝난 뒤에 처리
  let composing = false;
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; });
  function afterComposition(fn) {
    if (!composing) return fn();
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      composing = false;
      document.removeEventListener('compositionend', run);
      setTimeout(fn, 0);
    };
    document.addEventListener('compositionend', run);
    setTimeout(run, 500); // 조합이 끝났다는 알림이 끝내 안 와도 0.5초 뒤엔 처리 (추가가 멈춰 있지 않게)
  }
  // ‘추가’ 버튼을 손가락·마우스로 누른 경우: 휴대폰은 버튼을 눌러도 입력칸에 커서가 남아(키보드를 닫지 않으려고)
  // 마지막 글자의 조합이 저절로 끝나지 않는다. 그래서 다른 곳을 눌러야 추가되던 문제가 있었다.
  // 입력칸을 잠깐 떠났다 돌아와 조합을 끝내고 바로 추가한다. (Enter로 제출한 건 지금처럼 조합이 끝나길 기다림)
  function finishComposing(input) {
    if (!composing || !input || document.activeElement !== input) return;
    input.blur();
    input.focus({ preventScroll: true });
    composing = false;
  }
  // 버튼을 실제로 눌러 제출한 폼 (Enter로 제출하면 브라우저가 대신 누르는 클릭이라 detail이 0)
  let tappedForm = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    tappedForm = b && b.form && e.detail > 0 ? b.form : null;
  }, true);
  const tapped = (form) => { const t = tappedForm === form; tappedForm = null; return t; };

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
  // 체크가 바뀌는 변경: 소요시간을 적어 둔 항목을 끝내면 그 시간을 오늘 공부 기록에 넣고,
  // 체크를 풀면 오늘 넣은 것을 뺀다 (stats.js syncTopicCredits). 반환 { added, removed, ids }
  // 이 범위와 이은 플래너 할 일도 같이 끝냄·풀기 (plan.js syncLinked)
  function mutateDone(fn, undoable) {
    let got = null;
    mutate((s) => {
      const before = Stats.doneTopicIds(s), links = window.Plan ? Plan.linkState(s) : null;
      fn(s);
      got = Stats.syncTopicCredits(s, before, Date.now(), uid);
      if (links) { const r = Plan.syncLinked(s, links, Date.now()); got.removed += r.removed; }
    }, undoable);
    return got;
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
    const pad = 48, top = 56, bottom = 80; // 위쪽은 범례, 아래쪽은 도구 띠 자리
    const z = Math.min(1.2, (r.width - pad * 2) / b.w, (r.height - top - bottom) / b.h);
    view.z = Math.max(Z_MIN, z);
    view.x = (r.width - b.w * view.z) / 2 - b.x * view.z;
    view.y = Math.max(top, top + (r.height - top - bottom - b.h * view.z) / 2) - b.y * view.z;
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
    view.y = 56 - b.y * view.z; // 왼쪽 위 범례 아래부터
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
        <button class="chip" type="button" data-list-act="undo"${store.canUndo() ? '' : ' disabled'}>${A.ic('undo')}되돌리기</button>
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
    if (!est && !pct) label = A.ic('timer');
    else if (pct >= 100) label = est ? fm(est) : '100%';
    else if (pct > 0) label = est ? `${pct}%<span class="bt-left"> · 남은 ${fm(Math.round(est * (100 - pct) / 100))}</span>` : `${pct}%`; // 보드(좁은 카드)에서는 %만 보여 제목 자리를 남긴다
    else label = fm(est);
    return `<button class="btime${pct > 0 && pct < 100 ? ' partial' : ''}${!est ? ' empty' : ''}" data-time="${esc(n.id)}" style="--p:${pct}%" aria-label="${esc(n.title)} 소요시간·진행률">${label}</button>`;
  }

  function cardHtml(c, index) {
    if (c.kind === 'note') return noteHtml(c);
    const style = `left:${c.x || 0}px;top:${c.y || 0}px;--c:${esc(c.color || '#4a7fd4')}`;
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

  // 메모 한 장: 누르면 그 자리에서 고친다. 끌어서 옮기고, 오른쪽 아래 모서리를 끌어 폭을 바꾼다
  function noteHtml(c) {
    const text = isText(c);
    const col = noteColor(c);
    const editing = !!noteEdit && noteEdit.id === c.id;
    const w = +c.w > 0 && mode !== 'list' ? `width:${Math.round(c.w)}px;` : '';
    const cls = `bcard note ${text ? 'text' : 'sticky'} sz-${noteSize(c)}${editing ? ' editing' : ''}${w ? ' fixed-w' : ''}`;
    const what = text ? '글 상자' : '메모';
    const body = editing
      ? `<div class="bnote-grow" data-value="${esc(noteEdit.value)}"><textarea class="bnote-edit" data-keep="note:${esc(c.id)}" data-note-edit="${esc(c.id)}" maxlength="2000" rows="1" placeholder="${text ? '글을 적어 보세요' : '메모를 적어 보세요'}" aria-label="${what} 내용" autocomplete="off">${esc(noteEdit.value)}</textarea></div>`
      : `<div class="bnote-text" data-note="${esc(c.id)}" role="button" tabindex="0" aria-label="${what} 고치기">${esc(c.title) || '<span class="muted">눌러서 메모 쓰기</span>'}</div>`;
    return `<div class="${cls}" data-id="${esc(c.id)}" data-drag="${esc(c.id)}" style="left:${c.x || 0}px;top:${c.y || 0}px;${w}${col ? `--c:${esc(col)}` : ''}">${body}<span class="bnote-grip" data-resize="${esc(c.id)}" aria-hidden="true"></span></div>`;
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
    const plan = ex ? Scope.timePlan(p, ex, Date.now(), studiedToday()) : null;
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
      <span class="f-star${count('star') ? '' : ' zero'}">★ 중요 ${count('star')}</span>
      <span class="f-hard${count('hard') ? '' : ' zero'}">! 어려움 ${count('hard')}</span>
      <span class="f-review${count('review') ? '' : ' zero'}">↻ 다시 보기 ${count('review')}</span>
      <label class="bl-toggle"><input type="checkbox" id="bl-only-left"${onlyLeft ? ' checked' : ''}> 남은 것만</label>` : '';
    return { p, plan, pc };
  }

  // 오늘 공부한 시간(분): 홈 '오늘 공부'와 같은 값 (기록 + 지금 재는 스톱워치). '오늘 한 양'은 이 시간까지만 센다
  function studiedToday() {
    return Stats.minutesOn(st().sessions, Date.now()) + (window.Stopwatch ? window.Stopwatch.todayMinutes() : 0);
  }

  // 시험 시간 페이스 띠
  function renderPace(plan, p) {
    const el = $('#board-pace');
    el.classList.toggle('hint', !plan); // 안내만 있는 띠는 전체 화면 보드에서 숨긴다
    if (!plan) {
      el.hidden = !(p.total && !p.timeTotal);
      el.innerHTML = el.hidden ? '' : `<div class="bp-row"><span>${A.ic('timer')} 항목 옆 시계 버튼을 눌러 걸리는 시간을 적으면, 시험까지 하루에 몇 시간씩 해야 하는지 계산해 드려요.</span></div>`;
      return;
    }
    el.hidden = false;
    const dday = plan.days > 0 ? `시험까지 ${plan.days}일` : plan.days === 0 ? '오늘 시험' : '시험 끝';
    const today = plan.finished ? '모든 범위를 끝냈어요 ♛'
      : plan.todayLeft ? `오늘 할 양 <b>${fm(plan.todayLeft)}</b> 남음` : '오늘 할 양 <b>완료 ✓</b>';
    const behind = !plan.finished && plan.behind > 0 ? `<span class="bp-behind">밀린 양 ${fm(plan.behind)}</span>` : '';
    el.innerHTML = `<button class="bp-row" id="bp-toggle" aria-expanded="${paceOpen}">
        <span>${A.ic('timer')} ${today}</span>${behind}<span class="muted">${dday}</span><span class="bp-more">${paceOpen ? '접기 ▴' : '자세히 ▾'}</span>
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
    if (rowDrag) { dragDirty = true; return; } // 줄을 들고 옮기는 중에는 다 놓은 뒤에 그린다
    if (renderingNow) return;
    renderingNow = true;
    try {
      const keep = captureFocus();
      const prevExam = examId;
      examId = pickExam();
      const has = !!examId;
      const list = mode === 'list';
      if (prevExam !== examId) { noteEdit = null; draftNote = null; }
      if (noteEdit && !noteById(noteEdit.id)) noteEdit = null; // 쓰던 메모가 다른 기기에서 지워졌으면 쓰기를 접는다
      syncFull();
      dock.classList.toggle('disabled', !has);
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
        renderNoteBar();
        vp.style.backgroundPosition = '0 0';
        vp.style.backgroundSize = `${GRID * 4}px ${GRID * 4}px`; // 시험이 없을 때 체스판 무늬가 화면만 한 큰 네 칸으로 늘어나지 않게
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
      let cards = index.get('root:' + examId) || [];
      if (draftNote && draftNote.examId === examId) cards = cards.concat(draftNote); // 아직 저장하지 않은 새 메모
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
        if (needsFit) { needsFit = false; if (vtSync) firstView(); else requestAnimationFrame(firstView); }
      }
      if (!restoreFocus(keep) && focusAddTarget) {
        focusAddTarget = false;
        const input = cardsEl.querySelector('.badd-input');
        if (input) { input.focus({ preventScroll: true }); ensureVisible(input); }
      }
      renderNoteBar();
      if (focusNote) {
        focusNote = false;
        const ta = cardsEl.querySelector('[data-note-edit]');
        if (ta) {
          ta.focus({ preventScroll: true });
          try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* 무시 */ }
          revealNote(ta);
        }
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
  // 지금 화이트보드가 화면 전체로 열려 있는지 (보드 보기 + 시험이 있을 때). body.board-full로 앱 바·탭을 숨긴다
  function syncFull() {
    const on = A.view === 'board' && mode === 'board' && !!examId;
    document.body.classList.toggle('board-full', on);
    return on;
  }

  /* 목록 ↔ 보드(전체 화면) 전환 효과: 위 앱 바는 위로, 아래 탭은 아래로 빠지고, 보드 칸이 커지며 도구 띠가 아래에서 올라온다.
     View Transitions(크롬·삼성 인터넷·사파리 18 이상)로 바뀌기 전·후 화면을 이어 움직인다 (styles.css 'vt-full').
     안 되는 브라우저, '동작 줄이기' 설정, 자동 테스트(navigator.webdriver, 주소에 ?vt를 붙이면 효과를 씀)는 바로 바뀐다. */
  let vt = null; // 지금 도는 전환 효과
  let vtMode = null; // 효과가 끝나면 맞춰 둘 보기 방식 (효과 중에 또 누른 것)
  let vtSync = false; // 효과 안에서 그릴 때는 화면 맞춤을 다음 프레임으로 미루지 않는다 (바뀐 화면을 바로 찍어야 해서)
  function canAnimate() {
    if (!document.startViewTransition || document.hidden) return false;
    try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) { /* 무시 */ }
    return !navigator.webdriver || /[?&]vt\b/.test(location.search);
  }

  function setScopeMode(m) {
    if (m !== 'list' && m !== 'board') return;
    if (vt) { vtMode = m; return; }
    closeMenu();
    if (noteEdit) commitNote(true);
    if (mode === m) return render();
    const willFull = m === 'board' && A.view === 'board' && !!examId;
    if (willFull === document.body.classList.contains('board-full') || !canAnimate()) return applyMode(m);
    const root = document.documentElement;
    const done = () => { root.classList.remove('vt-full', 'vt-in', 'vt-out'); vt = null; };
    vtMode = m;
    root.classList.add('vt-full', willFull ? 'vt-in' : 'vt-out');
    try {
      vt = document.startViewTransition(() => {
        vtSync = true;
        try { applyMode(vtMode); } finally { vtSync = false; }
      });
    } catch (e) { done(); return applyMode(m); }
    vt.finished.catch(() => {}).then(() => {
      done();
      if (vtMode !== mode) setScopeMode(vtMode); // 효과 중에 다시 바꾼 경우
    });
  }

  function applyMode(m) {
    if (mode === m) return render();
    mode = m;
    addTarget = null;
    vp.scrollTop = 0;
    vp.scrollLeft = 0;
    if (m === 'board') { settleAll = true; if (examId && !st().boardView[examId]) needsFit = true; }
    render();
    vp.scrollTop = 0;
    if (m === 'board' && syncFull()) {
      let seen = true;
      try { seen = !!localStorage.getItem(FULL_TIP_KEY); localStorage.setItem(FULL_TIP_KEY, '1'); } catch (e) { /* 무시 */ }
      if (!seen) toast('화이트보드를 전체 화면으로 열었어요. ‘목록’이나 뒤로 가기를 누르면 돌아가요');
    }
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
      const got = mutateDone((s) => { nowDone = Scope.toggle(s.topics, id); });
      celebrate(id, nowDone, got);
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
    // 메모를 누르면 그 자리에서 고친다 (보드에서는 끌기와 구분하려고 포인터 쪽에서 처리)
    const note = e.target.closest('[data-note]');
    if (note && mode === 'list') startNoteEdit(note.dataset.note);
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
    if (tapped(f)) finishComposing(f.querySelector('input'));
    afterComposition(() => {
      let input = f.querySelector('input');
      // 조합이 끝나길 기다리는 사이 화면이 다시 그려졌으면 지금 보이는 입력칸으로 (적던 글자는 그 칸으로 옮겨져 있다)
      if (input && !input.isConnected && input.dataset.keep) input = cardsEl.querySelector(`[data-keep="${CSS.escape(input.dataset.keep)}"]`) || input;
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
    const got = mutateDone((s) => {
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
      // 끝낸 채로 소요시간만 고치면, 오늘 넣은 기록도 새 시간으로 맞춘다
      if (was >= 100 && n.done) {
        const today = Stats.dayKey(Date.now());
        const c = s.sessions.find((q) => q.doneOf === 'topic:' + id && Stats.dayKey(q.endedAt) === today);
        if (c && est >= 1) c.minutes = Math.min(24 * 60, est);
        else if (c) Stats.uncreditDone(s, 'topic:' + id, Date.now());
      }
    });
    celebrate(id, nowDone, got);
  });

  // 체크한 뒤 알림: 과목·시험을 다 끝냈으면 축하, 공부 시간에 넣거나 뺐으면 그 시간 (got: mutateDone 결과)
  function celebrate(id, nowDone, got) {
    let cheer = '';
    const n = nowDone ? byId(id) : null;
    if (n) {
      let card = n;
      while (card.parentId) card = byId(card.parentId);
      const cp = Scope.progress(st().topics, card.id);
      const ep = Scope.examProgress(st().topics, examId);
      if (ep.total && ep.done === ep.total) cheer = `체크메이트! ${exam().name} 범위를 모두 끝냈어요 ♛`;
      else if (cp.state === 'all') cheer = `'${card.title}' 승급 ♛ 남은 항목 ${ep.total - ep.done}개`;
    }
    creditToast(got, cheer);
  }
  function creditToast(got, cheer) {
    if (got && got.added) {
      const ids = got.ids.slice();
      toast(cheer ? `${cheer} · 공부 시간 +${fm(got.added)}` : `끝! 공부 시간에 ${fm(got.added)}을 넣었어요`, { action: '시간 빼기', onAction: () => A.dropCredit(ids) });
    } else if (got && got.removed) toast(cheer || `체크를 풀어서 공부 시간에서 ${fm(got.removed)}을 뺐어요`);
    else if (cheer) toast(cheer);
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

  /* ---------- 메모 쓰기·꾸미기 ---------- */
  const noteById = (id) => (draftNote && draftNote.id === id ? draftNote : byId(id));

  function startNoteEdit(id) {
    const n = noteById(id);
    if (!n || n.kind !== 'note' || (noteEdit && noteEdit.id === id)) return;
    if (noteEdit) commitNote(true); // 다른 메모를 쓰던 중이면 먼저 저장
    noteEdit = { id, value: n.title || '' };
    focusNote = true;
    render();
  }

  // 쓰기를 끝낸다. save가 false면 고치기 전 내용으로 둔다. 빈 메모는 남기지 않는다
  function commitNote(save) {
    const ed = noteEdit;
    if (!ed) return;
    noteEdit = null;
    const ta = cardsEl.querySelector('[data-note-edit]');
    const value = String(ta ? ta.value : ed.value).replace(/\s+$/, '').slice(0, 2000);
    const draft = draftNote && draftNote.id === ed.id ? draftNote : null;
    draftNote = null;
    if (draft) {
      if (save && value.trim()) mutate((s) => s.topics.push(Object.assign({}, draft, { title: value, order: Scope.nextOrder(s.topics, null, draft.examId) })));
      else render();
      return;
    }
    const n = byId(ed.id);
    if (!n) return render();
    if (save && !value.trim()) {
      mutate((s) => { s.topics = Scope.removeSubtree(s.topics, ed.id); });
      toast('빈 메모를 지웠어요 · 되돌리기로 복구할 수 있어요');
    } else if (save && value !== (n.title || '')) {
      mutate((s) => { const t = s.topics.find((x) => x.id === ed.id); if (t) t.title = value; });
    } else render();
  }

  // 색·크기·폭: 새 메모(아직 저장 전)는 그 자리에서, 이미 있는 메모는 바로 저장
  function setNoteProp(id, props) {
    const n = noteById(id);
    if (!n) return;
    if ('color' in props) lastNote[isText(n) ? 'ink' : 'paper'] = props.color;
    if ('size' in props) lastNote.size = props.size;
    if (draftNote && draftNote.id === id) { Object.assign(draftNote, props); return render(); }
    mutate((s) => { const t = s.topics.find((x) => x.id === id); if (t) Object.assign(t, props); });
  }

  function deleteNote(id) {
    const draft = draftNote && draftNote.id === id;
    if (noteEdit && noteEdit.id === id) noteEdit = null;
    if (draft) { draftNote = null; return render(); }
    if (!byId(id)) return render();
    mutate((s) => { s.topics = Scope.removeSubtree(s.topics, id); });
    toast('메모를 지웠어요 · 되돌리기로 복구할 수 있어요');
  }

  // 메모를 쓸 때 가리지 않고 보이는 높이: 위쪽은 메모 꾸미기 띠, 아래쪽은 도구 띠(손가락으로 쓰는 화면은 자판) 자리를 뺀다
  function noteZone(r) {
    const top = r.top + 60;
    const bottom = coarse() ? Math.max(top + 90, r.top + Math.min(r.height * 0.45, 320)) : r.bottom - 76;
    return { top, bottom };
  }
  // 메모 좌표: 보드 왼쪽·위쪽 바깥으로도 조금 나갈 수 있다 (과목 카드가 보드 맨 위에서 시작해도 그 위에 붙일 수 있게)
  const noteX = (x) => clamp(Math.round(x / SNAP) * SNAP, -3000, WORLD_W - NOTE_MIN_W);
  const noteY = (y) => clamp(Math.round(y / SNAP) * SNAP, -3000, WORLD_H - 60);

  // 새 메모: 보이는 화면에서 카드·다른 메모와 겹치지 않는 빈 곳에 놓고 바로 쓴다. 빈 곳이 없으면 가운데 위쪽
  function addNote(style) {
    if (!examId || mode !== 'board') return;
    if (noteEdit) commitNote(true);
    const text = style === 'text';
    const r = vp.getBoundingClientRect();
    if (view.z < 0.6) zoomAt(1, r.width / 2, r.height / 2); // 너무 작게 보는 중이면 글자가 읽히는 크기로
    const zone = noteZone(r);
    const w = (text ? 200 : NOTE_W) * view.z, h = (text ? 44 : 96) * view.z; // 화면에서 차지할 크기
    const want = { x: r.left + (r.width - w) / 2, y: coarse() ? zone.top + 8 : Math.max(zone.top, r.top + r.height * 0.38 - h / 2) };
    // 먼저 카드·메모 모두와 안 겹치는 곳, 없으면(휴대폰처럼 카드가 화면을 덮을 때) 다른 메모와만 안 겹치는 곳
    const spot = (sel) => {
      const rects = $$(sel).map((el) => el.getBoundingClientRect());
      let best = null;
      for (let y = zone.top; y + h <= zone.bottom; y += 20) {
        for (let x = r.left + 12; x + w <= r.right - 12; x += 20) {
          if (rects.some((b) => x < b.right + 10 && x + w > b.left - 10 && y < b.bottom + 10 && y + h > b.top - 10)) continue;
          const d = Math.hypot(x - want.x, y - want.y);
          if (!best || d < best.d) best = { x, y, d };
        }
      }
      return best;
    };
    const best = spot('#board-cards .bcard') || spot('#board-cards .bcard.note');
    const c = toWorld((best || want).x, (best || want).y);
    let x = noteX(c.x), y = noteY(c.y);
    // 빈 곳이 없어 같은 자리에 겹치게 되면 조금씩 비켜 놓는다
    const taken = Scope.childrenOf(st().topics, null, examId).filter((n) => n.kind === 'note');
    for (let i = 0; i < 12 && taken.some((n) => Math.abs((n.x || 0) - x) < 12 && Math.abs((n.y || 0) - y) < 12); i++) { x += 20; y += 20; }
    draftNote = {
      id: uid(), examId, parentId: null, kind: 'note', title: '', done: false, flags: {}, order: 0, collapsed: false,
      x, y, color: text ? lastNote.ink : lastNote.paper, size: lastNote.size,
    };
    if (text) draftNote.style = 'text'; else draftNote.w = NOTE_W;
    noteEdit = { id: draftNote.id, value: '' };
    focusNote = true;
    if (tool !== 'select') setTool('select');
    render();
  }

  // 쓰는 메모가 자판에 가리거나 화면 밖에 있으면 보이는 곳으로 보드를 옮긴다
  function revealNote(el) {
    if (mode !== 'board') return ensureVisible(el);
    const card = el.closest('.bcard');
    if (!card) return;
    const r = vp.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const zone = noteZone(r);
    let dx = 0, dy = 0;
    if (c.bottom > zone.bottom) dy = zone.bottom - c.bottom;
    if (c.top + dy < zone.top) dy = zone.top - c.top;
    if (c.right > r.right - 12) dx = r.right - 12 - c.right;
    if (c.left + dx < r.left + 12) dx = r.left + 12 - c.left;
    if (dx || dy) { view.x += dx; view.y += dy; applyView(); }
  }

  // 메모 꾸미기 띠: 메모를 쓰는 동안 보드 위쪽에 뜬다 (색, 글자 크기, 지우기, 완료)
  function renderNoteBar() {
    const n = noteEdit ? noteById(noteEdit.id) : null;
    noteBar.hidden = !n;
    if (!n) { noteBar.innerHTML = ''; return; }
    const cur = noteColor(n), size = noteSize(n), text = isText(n);
    const names = text ? ['기본', '빨강', '파랑', '초록', '주황'] : ['노랑', '분홍', '연두', '하늘', '보라'];
    noteBar.innerHTML = noteColors(n).map((c, i) => `<button type="button" class="nb-color${c === cur ? ' active' : ''}${c ? '' : ' auto'}" data-note-color="${c}"${c ? ` style="--c:${c}"` : ''} title="${names[i]}" aria-label="${text ? '글자 색' : '쪽지 색'} ${names[i]}" aria-pressed="${c === cur}"></button>`).join('') +
      '<span class="bd-sep" aria-hidden="true"></span>' +
      `<button type="button" class="bb-btn nb-size" data-note-size title="글자 크기 바꾸기" aria-label="글자 크기: ${NOTE_SIZE_LABEL[size]}"><span class="nb-ga" aria-hidden="true">가</span>${NOTE_SIZE_LABEL[size]}</button>` +
      `<button type="button" class="bb-btn nb-del" data-note-del title="메모 지우기" aria-label="메모 지우기">${A.ic('trash')}</button>` +
      '<button type="button" class="bb-btn nb-done" data-note-done>완료</button>';
  }
  // 띠를 눌러도 쓰던 칸의 커서(휴대폰 자판)가 그대로 있게
  ['pointerdown', 'mousedown'].forEach((ev) => noteBar.addEventListener(ev, (e) => e.preventDefault()));
  noteBar.addEventListener('click', (e) => {
    if (!noteEdit) return;
    const id = noteEdit.id;
    const col = e.target.closest('[data-note-color]');
    if (col) return setNoteProp(id, { color: col.dataset.noteColor });
    if (e.target.closest('[data-note-size]')) {
      const n = noteById(id);
      return setNoteProp(id, { size: NOTE_SIZES[(NOTE_SIZES.indexOf(noteSize(n)) + 1) % NOTE_SIZES.length] });
    }
    if (e.target.closest('[data-note-del]')) return deleteNote(id);
    if (e.target.closest('[data-note-done]')) return commitNote(true);
  });

  cardsEl.addEventListener('input', (e) => {
    const ta = e.target.closest && e.target.closest('[data-note-edit]');
    if (!ta || !noteEdit) return;
    noteEdit.value = ta.value;
    ta.parentNode.dataset.value = ta.value; // 글자 수만큼 칸이 자란다 (styles.css .bnote-grow)
  });
  cardsEl.addEventListener('keydown', (e) => {
    const ta = e.target.closest && e.target.closest('[data-note-edit]');
    if (!ta) return;
    if (e.key === 'Escape') { e.stopPropagation(); commitNote(false); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitNote(true); }
  });
  // 다른 곳을 누르면 쓰기 끝 (다시 그리느라 잠깐 빠진 커서, 꾸미기 띠를 누른 것은 빼고)
  cardsEl.addEventListener('focusout', (e) => {
    const ta = e.target.closest && e.target.closest('[data-note-edit]');
    if (!ta || renderingNow) return;
    const id = ta.dataset.noteEdit;
    setTimeout(() => {
      if (!noteEdit || noteEdit.id !== id) return;
      const a = document.activeElement;
      if (a && a.matches && a.matches('[data-note-edit]')) return;
      commitNote(true);
    }, 0);
  });
  cardsEl.addEventListener('keydown', (e) => {
    const note = e.target.closest && e.target.closest('[data-note]');
    if (note && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startNoteEdit(note.dataset.note); }
  });

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
    if (n.kind === 'note') return;
    if (page === 'flags') {
      html = mHead('표시') + Object.keys(FLAG_INFO).map((k) => mItem('flag:' + k, `${FLAG_INFO[k].icon}  ${FLAG_INFO[k].label}`, { check: true, on: !!(n.flags && n.flags[k]) })).join('');
    } else if (page === 'move') {
      const sib = Scope.childrenOf(st().topics, n.parentId, examId).filter((x) => (x.kind === 'note') === (n.kind === 'note'));
      const i = sib.findIndex((x) => x.id === id);
      const prev = i > 0 ? sib[i - 1] : null;
      const parent = n.parentId ? byId(n.parentId) : null;
      html = mHead('옮기기') + mItem('up', '위로', { disabled: i <= 0 }) + mItem('down', '아래로', { disabled: i < 0 || i >= sib.length - 1 });
      const tip = isCard ? '과목 이름 줄을 꾹 눌러 끌어도 옮겨져요' : '줄을 꾹 눌러 위아래로 끌어도 옮겨져요';
      if (!isCard) {
        html += mItem('indent', '한 단계 안으로', { hint: prev ? `‘${clip(prev.title)}’ 아래로` : '', disabled: !prev });
        html += mItem('outdent', '한 단계 밖으로', { hint: parent && parent.parentId ? `‘${clip(parent.title)}’ 다음으로` : '', disabled: !(parent && parent.parentId) });
        html += mItem('move-to', '다른 곳으로…');
      }
      if (sib.length > 1) html += `<p class="pm-tip">${tip}</p>`;
    } else {
      const p = Scope.progress(st().topics, id, index);
      html += mItem('add', isCard ? '공부할 내용 추가' : '하위 항목 추가');
      html += mItem('rename', '이름 바꾸기');
      if (!hasKids) html += mItem('time', '소요시간·진행률');
      const on = Object.keys(FLAG_INFO).filter((k) => n.flags && n.flags[k]).map((k) => FLAG_INFO[k].icon).join(' ');
      html += mItem('page:flags', '표시', { sub: true, hint: on });
      // 기능과 탭 편집에서 타이머·계획을 꺼 두었으면 그 메뉴는 빼고
      if (!window.Features || window.Features.on('timer')) html += mItem('focus', '이 범위로 타이머 시작');
      if (!window.Features || window.Features.on('plan')) html += mItem('to-task', '플래너에 넣기');
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
    } else if (act === 'uncheck-all') {
      creditToast(mutateDone((s) => Scope.setDone(s.topics, id, false)));
    } else if (act === 'focus') {
      let card = n;
      while (card.parentId) card = byId(card.parentId);
      A.focusOn({ label: card.id === n.id ? n.title : `${card.title} · ${n.title}`, subjectName: card.title, topicId: n.id });
    } else if (act === 'to-task') {
      // 스터디 플래너의 오늘·내일·고른 날에 할 일로 (js/planner.js). 끝내면 이 범위에도 체크된다
      if (window.Planner) { window.Planner.placeTopic(n.id); return; }
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
      const c = window.UI ? await UI.pickColor({ title: '과목 색', current: n.color }) : null;
      if (c) mutate((s) => { const t = s.topics.find((x) => x.id === id); if (t) t.color = c; });
    } else if (act === 'move-to') {
      openMoveDialog(id);
    } else if (act === 'delete') {
      const count = Scope.subtreeIds(st().topics, id).length - 1;
      const what = n.kind === 'note' ? '메모' : n.parentId ? '항목' : '과목';
      if (count > 0 && !(await ask(`'${n.title}' ${what}과 안에 든 항목 ${count}개를 삭제할까요? (되돌리기로 복구할 수 있어요)`, { ok: '삭제', danger: true }))) return;
      mutate((s) => keepPace(s, examId, () => { s.topics = Scope.removeSubtree(s.topics, id); }));
      toast(`${n.kind === 'note' ? '메모를' : `'${n.title}' ${what}을`} 삭제했어요 · 되돌리기로 복구할 수 있어요`);
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
    $('#move-sub').textContent = `‘${n.title}’${(Scope.indexByParent(st().topics).get(id) || []).length ? Stats.josa(n.title, '과/와') + ' 그 안의 항목을' : Stats.josa(n.title, '을/를')} 고른 곳 아래 맨 끝으로 옮겨요.`;
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
    toast(`‘${clip(n.title)}’${Stats.josa(n.title, '을/를')} ‘${clip(d.title)}’ 아래로 옮겼어요`);
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
      ['new-exam', '새 시험 만들기'],
      ['edit-exam', '시험 이름·날짜·과목 바꾸기'],
      ['add-subject', '과목 추가'],
      ['paste', '범위 목록 붙여넣기'],
      store.canUndo() ? ['undo', '되돌리기'] : null,
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
      if (!(await ask('이 시험의 체크를 모두 해제할까요?', { ok: '모두 해제' }))) return;
      // 체크와 함께 진행률(%)도 0으로 (진행률이 100으로 남으면 모두 99%로 보인다)
      creditToast(mutateDone((s) => s.topics.forEach((t) => { if (t.examId === examId) { t.done = false; t.doneAt = null; t.pct = 0; } })));
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
    if (tapped(e.target)) finishComposing($('#subj-name'));
    afterComposition(() => {
      const name = $('#subj-name').value.trim();
      if (!name) return $('#subj-name').focus();
      closeSubjectDlg();
      addSubjectCards([name]);
    });
  });
  $('#bb-add-note').addEventListener('click', () => addNote());
  $('#bb-add-text').addEventListener('click', () => addNote('text'));
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
    const before = Stats.doneTopicIds(st()), links = window.Plan ? Plan.linkState(st()) : null;
    if (!store.undo()) return;
    // 되돌리기는 범위만 되돌리고 공부 기록·할 일은 그대로 두므로, 끝냄이 되돌아간 항목의 공부 시간과 이은 할 일은 여기서 맞춘다
    let got = null;
    store.update((s) => { got = Stats.syncTopicCredits(s, before, Date.now(), uid); if (links) got.removed += Plan.syncLinked(s, links, Date.now()).removed; });
    toast(got.removed ? `되돌렸어요 · 공부 시간에서 ${fm(got.removed)}을 뺐어요` : got.added ? `되돌렸어요 · 공부 시간 +${fm(got.added)}` : '되돌렸어요');
  }

  // 아래 도구 띠: 선택·펜·형광펜·지우개, 붙임쪽지·글 상자, 되돌리기. 펜 색은 펜·형광펜을 고르면 띠 위에 뜬다
  dock.addEventListener('click', (e) => {
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
    dock.classList.toggle('inking', tool === 'pen' || tool === 'marker');
  }

  function setTool(t) {
    tool = t;
    $$('#board-dock [data-tool]').forEach((b) => { const on = b.dataset.tool === t; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    setToolClass();
    renderBar();
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
    addBtn.addEventListener('click', (e) => { if (e.detail > 0) finishComposing(input); afterComposition(addCustom); });
    // 시험 만들기 폼이 제출되지 않게: Enter는 과목 추가로
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); afterComposition(addCustom); } });
    api.draw();
    return api;
  }
  const wizard = subjectToggle($('#ex-subjects'), $('#ex-subject-custom'), $('#ex-subject-add'));
  const dlgSubjects = subjectToggle($('#ee-subjects'), $('#ee-subject-custom'), $('#ee-subject-add'));

  // 새 시험 + 고른 과목 → 목록 보기에서 과목마다 공부할 내용 적기
  function startExam(name, date, subjects) {
    createExam(name, date); // 보기 방식은 그대로 (범위 탭은 늘 목록부터 열리고, 보드에서 만들면 보드에 남는다)
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
    if (!(await ask(`'${ex.name}' 시험과 범위 카드를 모두 삭제할까요? (되돌리기로 복구할 수 있어요)`, { ok: '삭제', danger: true }))) return;
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

  /* ---------- 꾹 눌러 끌어서 순서 바꾸기 (v3.5.1) ----------
   *  목록: 항목 줄(제목 쪽)이나 과목 이름 줄을 꾹 누르면(0.4초) 줄이 들리고, 손가락·마우스를 따라 위아래로 움직여 놓은 자리로 순서가 바뀐다.
   *   같은 단계(같은 과목·같은 상위 항목) 안에서만 옮긴다. 다른 곳으로는 지금처럼 ⋯ › 옮기기. 위로·아래로 버튼도 그대로.
   *  보드: 카드 안 항목 줄을 꾹 누르면 같은 방법으로 (카드는 머리를 끌어 옮기던 그대로).
   *  누르는 사이 손가락이 움직이면 그냥 스크롤(보드는 화면 이동)로 본다. 들고 있을 때 화면 위·아래 끝에 가까이 가면 목록이 저절로 스크롤된다.
   */
  const HOLD_MS = 400;
  let hold = null;       // 목록에서 꾹 누르는 중 { el, x, y, sx, sy, pid, timer }
  let rowDrag = null;    // 줄을 들고 옮기는 중
  let dragDirty = false; // 옮기는 동안 미룬 다시 그리기
  let eatClickUntil = 0; // 놓은 뒤 바로 따라오는 click은 무시 (놓은 자리의 버튼이 눌리지 않게)

  // 끌 수 있는 줄: 항목 줄, 목록 보기의 과목 이름 줄 (버튼·입력칸을 누른 것은 빼고)
  function dragTarget(t) {
    if (!t || !t.closest || !examId || isInteractive(t) || t.closest('.brename, .note')) return null;
    const row = t.closest('.brow');
    if (row && cardsEl.contains(row)) return row.closest('.bitem');
    const head = mode === 'list' && t.closest('.bcard-head');
    return head && cardsEl.contains(head) ? head.closest('.bcard') : null;
  }
  function dragSiblings(el) {
    return el.classList.contains('bitem') ? [...el.parentElement.children].filter((x) => x.classList.contains('bitem'))
      : [...cardsEl.children].filter((x) => x.matches('.bcard:not(.note)'));
  }
  const dragScroller = () => (mode === 'list' ? vp : null);

  function beginRowDrag(el, y) {
    const sibs = dragSiblings(el);
    const i0 = sibs.indexOf(el);
    if (i0 < 0 || sibs.length < 2) return false; // 옮길 자리가 없다
    const rects = sibs.map((x) => x.getBoundingClientRect());
    const r = rects[i0];
    const scale = el.offsetHeight ? r.height / el.offsetHeight : 1; // 보드는 확대 배율만큼
    const near = rects[i0 + 1] ? rects[i0 + 1].top - r.bottom : rects[i0 - 1] ? r.top - rects[i0 - 1].bottom : 0;
    const sc = dragScroller();
    rowDrag = { el, id: el.dataset.id, sibs, rects, i0, idx: i0, y0: y, y, s0: sc ? sc.scrollTop : 0, scale, shift: (r.height + Math.max(0, near)) / scale, raf: 0, pid: null };
    if (!menu.hidden) closeMenu();
    el.classList.add('drag-lift');
    cardsEl.classList.add('drag-on');
    document.documentElement.classList.add('row-dragging');
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* 무시 */ }
    const step = () => {
      if (!rowDrag) return;
      const box = dragScroller();
      if (box) {
        const vr = box.getBoundingClientRect();
        const top = Math.max(vr.top, 0), bottom = Math.min(vr.bottom, window.visualViewport ? window.visualViewport.height : innerHeight);
        const edge = Math.min(72, (bottom - top) / 5);
        const yy = rowDrag.y;
        const v = yy < top + edge ? -(top + edge - yy) : yy > bottom - edge ? yy - (bottom - edge) : 0;
        if (v) {
          const before = box.scrollTop;
          box.scrollTop += Math.max(-18, Math.min(18, Math.round(v / 3)));
          if (box.scrollTop !== before) moveRowDrag(yy);
        }
      }
      rowDrag.raf = requestAnimationFrame(step);
    };
    rowDrag.raf = requestAnimationFrame(step);
    return true;
  }

  function moveRowDrag(y) {
    const d = rowDrag;
    if (!d) return;
    d.y = y;
    const sc = dragScroller();
    const dy = y - d.y0 + (sc ? sc.scrollTop - d.s0 : 0); // 처음 자리에서 움직인 거리(화면 px)
    d.el.style.transform = `translateY(${dy / d.scale}px)`;
    // 위로 끌면 들고 있는 줄의 윗변이 위 줄의 가운데를 넘을 때, 아래로 끌면 아랫변이 아래 줄의 가운데를 넘을 때 자리를 바꾼다
    const r = d.rects[d.i0], top = r.top + dy, bottom = r.bottom + dy;
    let idx = d.i0;
    for (let j = d.i0 - 1; j >= 0 && top < d.rects[j].top + d.rects[j].height / 2; j--) idx = j;
    for (let j = d.i0 + 1; j < d.rects.length && bottom > d.rects[j].top + d.rects[j].height / 2; j++) idx = j;
    if (idx === d.idx) return;
    d.idx = idx;
    d.sibs.forEach((x, j) => {
      if (j === d.i0) return;
      const off = j < d.i0 && j >= idx ? d.shift : j > d.i0 && j <= idx ? -d.shift : 0;
      x.style.transform = off ? `translateY(${off}px)` : '';
    });
  }

  function endRowDrag(commit) {
    const d = rowDrag;
    if (!d) return;
    rowDrag = null;
    cancelAnimationFrame(d.raf);
    eatClickUntil = Date.now() + 400;
    d.sibs.forEach((x) => { x.style.transform = ''; });
    d.el.classList.remove('drag-lift');
    cardsEl.classList.remove('drag-on');
    document.documentElement.classList.remove('row-dragging');
    const n = byId(d.id);
    if (!commit || d.idx === d.i0 || !n) { if (dragDirty) { dragDirty = false; render(); } return; }
    dragDirty = false;
    // 보이는 줄 순서로 놓을 자리를 정하고, 안 보이는 줄(‘남은 것만’에서 숨긴 것)은 그 앞뒤 그대로 둔다
    const shown = d.sibs.map((x) => x.dataset.id).filter((x) => x !== d.id);
    mutate((s) => {
      const me = s.topics.find((x) => x.id === d.id);
      if (!me) return;
      const all = Scope.childrenOf(s.topics, me.parentId, examId).filter((x) => x.kind !== 'note' && x.id !== d.id);
      let at = d.idx < shown.length ? all.findIndex((x) => x.id === shown[d.idx]) : all.findIndex((x) => x.id === shown[shown.length - 1]) + 1;
      if (at < 0) at = all.length;
      all.splice(at, 0, me);
      all.forEach((x, i) => { x.order = i; });
    });
    if (mode === 'board') settleAll = true;
    const row = cardsEl.querySelector(`[data-id="${CSS.escape(d.id)}"]`);
    if (row) { row.classList.remove('drag-drop'); void row.offsetWidth; row.classList.add('drag-drop'); }
  }

  // 목록 보기: 꾹 누르기를 알아본다 (보드는 아래 포인터 처리에서)
  function cancelHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }
  cardsEl.addEventListener('pointerdown', (e) => {
    if (mode !== 'list' || rowDrag || hold || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = dragTarget(e.target);
    if (!el) return;
    const h = { el, sx: e.clientX, sy: e.clientY, y: e.clientY, pid: e.pointerId };
    h.timer = setTimeout(() => {
      if (hold !== h) return;
      hold = null;
      if (!h.el.isConnected || !beginRowDrag(h.el, h.y)) return;
      rowDrag.pid = h.pid;
      try { cardsEl.setPointerCapture(h.pid); } catch (err) { /* 무시 */ }
    }, HOLD_MS);
    hold = h;
  });
  cardsEl.addEventListener('pointermove', (e) => {
    if (hold && e.pointerId === hold.pid) {
      if (Math.hypot(e.clientX - hold.sx, e.clientY - hold.sy) > (e.pointerType === 'mouse' ? 6 : 10)) cancelHold(); // 움직였으면 스크롤
      else hold.y = e.clientY;
    }
    if (rowDrag && rowDrag.pid === e.pointerId) { e.preventDefault(); moveRowDrag(e.clientY); }
  });
  ['pointerup', 'pointercancel'].forEach((type) => cardsEl.addEventListener(type, (e) => {
    if (hold && e.pointerId === hold.pid) cancelHold();
    if (rowDrag && rowDrag.pid === e.pointerId) endRowDrag(type === 'pointerup');
  }));
  // 들고 있는 동안에는 화면이 같이 스크롤되지 않게 (손가락으로 끄는 중)
  cardsEl.addEventListener('touchmove', (e) => { if (rowDrag && e.cancelable) e.preventDefault(); }, { passive: false });
  // 꾹 누르면 뜨는 휴대폰 메뉴(복사 등)·글자 선택을 막는다
  cardsEl.addEventListener('contextmenu', (e) => { if (hold || rowDrag || Date.now() < eatClickUntil) e.preventDefault(); });
  cardsEl.addEventListener('click', (e) => {
    if (Date.now() < eatClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('pointerdown', () => { if (!rowDrag) eatClickUntil = 0; }, true); // 새로 누르면 그 click은 그대로
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rowDrag) { e.preventDefault(); endRowDrag(false); } }, true);
  window.addEventListener('blur', () => { cancelHold(); endRowDrag(false); });

  /* ---------- 포인터: 이동·확대·카드 끌기·펜 ---------- */
  const pointers = new Map();
  let gesture = null;

  function isInteractive(el) {
    return !!el.closest('button, input, textarea, select, label, a, .badd-row');
  }

  vp.addEventListener('pointerdown', (e) => {
    if (mode === 'list' || !examId || e.target.closest('.board-empty, .board-legend')) return;
    // 쓰던 메모 바깥을 누르면 바로 저장 (커서가 빠지길 기다리지 않는다)
    if (noteEdit && !e.target.closest('.bcard.note.editing')) commitNote(true);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // 두 손가락: 확대/이동 (진행 중인 펜·끌기는 취소)
      if (gesture && gesture.type === 'ink' && gesture.el) gesture.el.remove();
      if (gesture) clearTimeout(gesture.hold);
      if (gesture && gesture.type === 'row') endRowDrag(false);
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

    // 메모 폭 바꾸기 (오른쪽 아래 모서리)
    const grip = e.target.closest('[data-resize]');
    if (grip && tool === 'select' && !panKey) {
      e.preventDefault(); // 쓰던 중이면 커서를 그대로 둔다
      const card = grip.closest('.bcard');
      gesture = { type: 'resize', id: grip.dataset.resize, el: card, sx: e.clientX, ow: card.offsetWidth, w: card.offsetWidth, pid: e.pointerId };
      try { vp.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      vp.classList.add('dragging');
      return;
    }

    const drag = e.target.closest('[data-drag]');
    if (drag && !isInteractive(e.target) && tool === 'select' && !panKey) {
      const card = drag.closest('.bcard');
      gesture = { type: 'maybe-card', id: drag.dataset.drag, el: card, note: card.classList.contains('note'), sx: e.clientX, sy: e.clientY, ox: parseFloat(card.style.left), oy: parseFloat(card.style.top), pid: e.pointerId };
      return;
    }
    if (isInteractive(e.target) && !panKey) return;
    gesture = { type: 'maybe-pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, pid: e.pointerId };
    // 카드 안 항목 줄을 꾹 누르면: 화면 이동 대신 그 줄을 들어 순서를 바꾼다
    const holdEl = tool === 'select' && !panKey && e.button === 0 ? dragTarget(e.target) : null;
    if (holdEl) {
      const g = gesture;
      g.holdable = true;
      g.hold = setTimeout(() => {
        if (gesture !== g || g.type !== 'maybe-pan' || pointers.size !== 1 || !holdEl.isConnected) return;
        const pt = pointers.get(g.pid);
        if (!beginRowDrag(holdEl, pt ? pt.y : g.sy)) return;
        g.type = 'row';
        rowDrag.pid = g.pid;
        try { vp.setPointerCapture(g.pid); } catch (err) { /* 무시 */ }
      }, HOLD_MS);
    }
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
    if (gesture.type === 'row') { moveRowDrag(e.clientY); return; }

    const dx = e.clientX - gesture.sx;
    const dy = e.clientY - gesture.sy;
    // 누른 뒤에 화면이 다시 그려졌으면(쓰던 메모가 저장되는 등) 새로 그려진 카드를 잡는다
    if (gesture.el && !gesture.el.isConnected && gesture.id) gesture.el = cardsEl.querySelector(`.bcard[data-id="${CSS.escape(gesture.id)}"]`) || gesture.el;
    if (gesture.type === 'resize') {
      gesture.w = clamp(gesture.ow + dx / view.z, NOTE_MIN_W, NOTE_MAX_W);
      gesture.el.style.width = gesture.w + 'px';
      gesture.el.classList.add('fixed-w');
      return;
    }
    if (gesture.type === 'maybe-card' || gesture.type === 'maybe-pan') {
      if (Math.hypot(dx, dy) < ((gesture.note || gesture.holdable) && e.pointerType === 'touch' ? 8 : 4)) return;
      clearTimeout(gesture.hold); // 움직였으면 꾹 누르기가 아니라 화면 이동
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
    clearTimeout(g.hold);
    if (g.type === 'row') { endRowDrag(e.type === 'pointerup'); return; }
    if (g.type === 'ink') {
      if (e.type === 'pointercancel') { g.el.remove(); return; }
      const id = uid();
      mutate((s) => s.strokes.push({ id, examId, points: g.points, color: inkColor, width: g.marker ? 18 : 3, marker: g.marker }));
    } else if (g.type === 'card') {
      g.el.classList.remove('lifted');
      const x = g.note ? noteX(parseFloat(g.el.style.left)) : clamp(Math.round(parseFloat(g.el.style.left) / SNAP) * SNAP, 0, WORLD_W - Scope.CARD_W);
      const y = g.note ? noteY(parseFloat(g.el.style.top)) : clamp(Math.round(parseFloat(g.el.style.top) / SNAP) * SNAP, 0, WORLD_H - 60);
      if (draftNote && draftNote.id === g.id) { draftNote.x = x; draftNote.y = y; render(); }
      else mutate((s) => { const c = s.topics.find((t) => t.id === g.id); if (c) { c.x = x; c.y = y; } });
    } else if (g.type === 'resize') {
      setNoteProp(g.id, { w: Math.round(g.w / SNAP) * SNAP });
    } else if (g.type === 'maybe-card' && g.note && e.type === 'pointerup') {
      startNoteEdit(g.id); // 끌지 않고 눌렀다 뗀 메모: 그 자리에서 고치기
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
  // Esc로 전체 화면에서 나가기: 같은 Esc로 방금 닫힌 창·메뉴가 있었으면 나가지 않는다 (먼저 잡아 둔다)
  let escBusy = false;
  const overlayOpen = () => !menu.hidden || !!document.querySelector('.ask-backdrop:not([hidden]), .ui-back:not(.out)') || document.body.classList.contains('ai-open');
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') escBusy = overlayOpen() || !!noteEdit; }, true);
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
    else if (k === 'n') { e.preventDefault(); addNote(); }
    else if (k === 't') { e.preventDefault(); addNote('text'); }
    else if (k === 'escape') {
      if (escBusy) return;
      if (tool !== 'select') setTool('select');
      else setScopeMode('list'); // 전체 화면에서 나가기
    }
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

  window.Board = {
    render, fit, get view() { return Object.assign({}, view); }, get mode() { return mode; }, get full() { return document.body.classList.contains('board-full'); },
    setMode: setScopeMode, setTool, zoomAt, addNote,
  };
  if (A.view === 'board') render();
})();
