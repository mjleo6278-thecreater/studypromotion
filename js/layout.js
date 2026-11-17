/* 기능과 탭 편집 화면 (계정·설정 › 기능과 탭 편집)
 * - 탭·홈 화면 칸: 줄을 꾹(0.4초) 누르거나 왼쪽 손잡이를 잡고 끌어서 순서를 바꾼다. 손잡이에서 위·아래 화살표 키로도 옮긴다.
 *   꾹 누르는 시간과 들어 올린 모양은 범위 목록의 끌어 옮기기(js/board.js)와 같게.
 * - 스위치로 켜고 끈다. 바꾸면 바로 적용되고 기록(settings.layout)에 저장된다. 목록·저장은 js/features.js
 */
(function () {
  'use strict';
  const App = window.App, F = window.Features;
  const view = document.getElementById('view-layout');
  if (!App || !F || !view) return;
  const { $, esc, toast, ask } = App;
  const ic = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const josa = (w, pair) => (window.Stats && window.Stats.josa ? window.Stats.josa(w, pair) : pair.split('/')[0]);
  const lists = { tabs: $('#lay-tabs'), home: $('#lay-home') };
  const live = $('#lay-live');
  const say = (msg) => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 40); };

  /* ---------- 그리기 ---------- */
  function row(f, L, movable) {
    const self = !L.off.includes(f.id); // 이 줄의 스위치 (딸린 탭이 꺼져 있어도 제 값을 보여 준다)
    const why = F.lockReason(L, f.id);
    const locked = !!why && !f.always;
    const cls = ['lay-row'];
    if (!F.isOn(L, f.id)) cls.push('off');
    if (!self) cls.push('self-off');
    if (locked) cls.push('locked');
    const kindName = f.kind === 'tab' ? `${f.name} 탭` : f.kind === 'home' ? `홈의 ${f.name} 칸` : f.name;
    return `<li class="${cls.join(' ')}" data-id="${esc(f.id)}">` +
      (movable ? `<button type="button" class="lay-grip" aria-label="${esc(kindName)} 순서 바꾸기" title="끌거나 위·아래 화살표 키로 순서 바꾸기">${ic('grip')}</button>` : '') +
      (f.icon ? `<span class="lay-ico" aria-hidden="true">${ic(f.icon)}</span>` : '') +
      `<span class="lay-text"><b>${esc(f.name)}</b><small id="lay-d-${esc(f.id)}">${esc(locked ? why : f.desc)}</small></span>` +
      (f.always ? '<span class="lay-always">항상 켜짐</span>'
        : `<label class="lay-switch"><input type="checkbox" role="switch" data-sw="${esc(f.id)}"${self ? ' checked' : ''}${locked ? ' disabled' : ''} aria-label="${esc(kindName)} 켜기" aria-describedby="lay-d-${esc(f.id)}"></label>`) +
      '</li>';
  }

  let drag = null, dirty = false;
  function render() {
    if (drag) { dirty = true; return; } // 끄는 중에는 다 놓은 뒤에 그린다
    const L = F.get();
    const a = document.activeElement;
    const keep = a && view.contains(a) ? (a.dataset.sw ? `[data-sw="${a.dataset.sw}"]` : a.classList.contains('lay-grip') ? `[data-id="${a.closest('.lay-row').dataset.id}"] .lay-grip` : '') : '';
    lists.tabs.innerHTML = L.tabs.map((id) => row(F.item(id), L, true)).join('');
    lists.home.innerHTML = L.home.map((id) => row(F.item(id), L, true)).join('');
    const groups = [];
    F.LIST.filter((f) => f.kind === 'sub').forEach((f) => {
      let g = groups.find((x) => x.name === f.group);
      if (!g) groups.push((g = { name: f.group, items: [] }));
      g.items.push(f);
    });
    $('#lay-subs').innerHTML = groups.map((g) => `<p class="lay-group">${esc(g.name)}</p><ul class="lay-list flat">${g.items.map((f) => row(f, L, false)).join('')}</ul>`).join('');
    $('#lay-reset').disabled = F.isDefault(L);
    if (keep) { const el = view.querySelector(keep); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------- 켜고 끄기 ---------- */
  // 끄려는 기능이 지금 재는 중이면 먼저 멈출지 묻는다. 멈췄거나 상관없으면 true
  async function stopFirst(id) {
    const SW = window.Stopwatch;
    if ((id === 'timer' || id === 'stopwatch') && SW && SW.running()) {
      const yes = await ask('스톱워치가 재는 중이에요.\n지금까지 잰 시간을 기록하고 끌까요?', { ok: '기록하고 끄기' });
      if (!yes) return false;
      await SW.stop();
      if (SW.running()) return false;
    }
    if ((id === 'timer' || id === 'focus') && App.timerBusy && App.timerBusy()) {
      const yes = await ask('집중·휴식 타이머가 진행 중이에요.\n지금까지 한 만큼은 기록하고 끌까요?', { ok: '기록하고 끄기' });
      if (!yes) return false;
      if (App.stopTimer) App.stopTimer();
    }
    return true;
  }
  view.addEventListener('change', async (e) => {
    const inp = e.target.closest('input[data-sw]');
    if (!inp) return;
    const f = F.item(inp.dataset.sw), on = inp.checked;
    if (!f) return;
    if (!on && !(await stopFirst(f.id))) { inp.checked = true; return; }
    F.set(f.id, on);
    render(); // 끌 수 없던 경우에도 스위치를 제자리로
    if (F.get().off.includes(f.id) === on) return; // 바뀌지 않았으면(함께 끌 수 없는 묶음) 알리지 않는다
    let msg;
    if (f.kind === 'tab') msg = on ? `${f.name} 탭을 켰어요` : `${f.name} 탭을 껐어요. 기록은 그대로 있어요.`;
    else if (f.kind === 'home') msg = on ? `홈에 ${f.name} 칸을 다시 보여 줘요` : `홈에서 ${f.name} 칸을 숨겼어요`;
    else msg = `${f.name}${josa(f.name, '을/를')} ${on ? '켰어요' : '껐어요'}`;
    toast(msg);
  });

  $('#lay-reset').addEventListener('click', async () => {
    const yes = await ask('탭 순서와 홈 화면을 처음 배치로 돌리고, 꺼 둔 기능을 모두 켤까요?', { ok: '처음 배치로' });
    if (!yes) return;
    F.reset();
    render();
    toast('처음 배치로 되돌렸어요');
  });

  /* ---------- 순서 바꾸기: 꾹 눌러 끌기 · 손잡이 끌기 · 화살표 키 ---------- */
  const HOLD_MS = 400; // 범위 목록과 같은 시간
  let hold = null;
  let eatClickUntil = 0; // 놓은 뒤 바로 따라오는 click은 무시 (놓은 자리의 스위치가 눌리지 않게)
  const rowsOf = (list) => [...list.children].filter((x) => x.classList.contains('lay-row'));
  const where = (kind, id) => {
    const L = F.get(), f = F.item(id);
    return `${f.name}, ${L[kind].indexOf(id) + 1}번째로 옮겼어요`;
  };
  // 화면을 굴릴 경계: 위 앱 바 아래 ~ 아래 탭 막대 위
  function edges() {
    const bar = document.querySelector('.topbar');
    const top = bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
    let bottom = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const nav = document.querySelector('nav.tabs');
    if (nav && getComputedStyle(nav).position === 'fixed') { const r = nav.getBoundingClientRect(); if (r.height && r.top < bottom) bottom = r.top; }
    return { top, bottom };
  }
  function begin(list, el, y, pid) {
    const sibs = rowsOf(list);
    const i0 = sibs.indexOf(el);
    if (i0 < 0 || sibs.length < 2) return false;
    const rects = sibs.map((x) => x.getBoundingClientRect());
    const r = rects[i0];
    const near = rects[i0 + 1] ? rects[i0 + 1].top - r.bottom : rects[i0 - 1] ? r.top - rects[i0 - 1].bottom : 0;
    drag = { list, el, id: el.dataset.id, kind: list.dataset.kind, sibs, rects, i0, idx: i0, y0: y, y, s0: window.scrollY, shift: r.height + Math.max(0, near), raf: 0, pid };
    el.classList.add('drag-lift');
    list.classList.add('drag-on');
    document.documentElement.classList.add('row-dragging');
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* 무시 */ }
    try { list.setPointerCapture(pid); } catch (e) { /* 무시 */ }
    const step = () => {
      if (!drag) return;
      const { top, bottom } = edges();
      const edge = Math.min(72, (bottom - top) / 5);
      const yy = drag.y;
      const v = yy < top + edge ? -(top + edge - yy) : yy > bottom - edge ? yy - (bottom - edge) : 0;
      if (v) {
        const before = window.scrollY;
        window.scrollBy(0, Math.max(-18, Math.min(18, Math.round(v / 3))));
        if (window.scrollY !== before) move(yy);
      }
      drag.raf = requestAnimationFrame(step);
    };
    drag.raf = requestAnimationFrame(step);
    return true;
  }
  function move(y) {
    const d = drag;
    if (!d) return;
    d.y = y;
    const dy = y - d.y0 + (window.scrollY - d.s0); // 처음 자리에서 움직인 거리 (화면을 굴린 만큼 더해서)
    d.el.style.transform = `translateY(${dy}px)`;
    // 위로 끌면 윗변이 위 줄의 가운데를, 아래로 끌면 아랫변이 아래 줄의 가운데를 넘을 때 자리를 바꾼다
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
  function end(commit) {
    const d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.raf);
    eatClickUntil = Date.now() + 400;
    d.sibs.forEach((x) => { x.style.transform = ''; });
    d.el.classList.remove('drag-lift');
    d.list.classList.remove('drag-on');
    document.documentElement.classList.remove('row-dragging');
    if (commit && d.idx !== d.i0) {
      dirty = false;
      F.move(d.kind, d.id, d.idx);
      render();
      const el = d.list.querySelector(`[data-id="${d.id}"]`);
      if (el) { el.classList.remove('drag-drop'); void el.offsetWidth; el.classList.add('drag-drop'); }
      say(where(d.kind, d.id));
    } else if (dirty) { dirty = false; render(); }
  }
  function cancelHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }
  document.addEventListener('pointerdown', () => { if (!drag) eatClickUntil = 0; }, true); // 새로 누르면 그 click은 그대로 (범위 목록과 같게)

  Object.values(lists).forEach((list) => {
    list.addEventListener('pointerdown', (e) => {
      if (drag || hold || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const el = e.target.closest('.lay-row');
      if (!el || el.parentElement !== list || e.target.closest('.lay-switch')) return;
      if (e.target.closest('.lay-grip')) { begin(list, el, e.clientY, e.pointerId); return; } // 손잡이는 바로 든다
      const h = { el, sx: e.clientX, sy: e.clientY, y: e.clientY, pid: e.pointerId };
      h.timer = setTimeout(() => {
        if (hold !== h) return;
        hold = null;
        if (el.isConnected) begin(list, el, h.y, h.pid);
      }, HOLD_MS);
      hold = h;
    });
    list.addEventListener('pointermove', (e) => {
      if (hold && e.pointerId === hold.pid) {
        if (Math.hypot(e.clientX - hold.sx, e.clientY - hold.sy) > (e.pointerType === 'mouse' ? 6 : 10)) cancelHold(); // 움직였으면 화면 굴리기
        else hold.y = e.clientY;
      }
      if (drag && drag.pid === e.pointerId) { e.preventDefault(); move(e.clientY); }
    });
    ['pointerup', 'pointercancel'].forEach((type) => list.addEventListener(type, (e) => {
      if (hold && e.pointerId === hold.pid) cancelHold();
      if (drag && drag.pid === e.pointerId) end(type === 'pointerup');
    }));
    // 들고 있는 동안에는 화면이 손가락을 따라 굴러가지 않게
    list.addEventListener('touchmove', (e) => { if (drag && e.cancelable) e.preventDefault(); }, { passive: false });
    // 꾹 누르면 뜨는 휴대폰 메뉴(복사 등)·글자 선택을 막는다
    list.addEventListener('contextmenu', (e) => { if (hold || drag || Date.now() < eatClickUntil) e.preventDefault(); });
    list.addEventListener('click', (e) => {
      if (Date.now() < eatClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    // 손잡이에서 위·아래 화살표 키
    list.addEventListener('keydown', (e) => {
      const g = e.target.closest('.lay-grip');
      if (!g || drag || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const el = g.closest('.lay-row'), id = el.dataset.id, kind = list.dataset.kind;
      const ids = rowsOf(list).map((x) => x.dataset.id);
      const to = ids.indexOf(id) + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= ids.length) return;
      F.move(kind, id, to);
      render();
      const ng = list.querySelector(`[data-id="${id}"] .lay-grip`);
      if (ng) ng.focus();
      say(where(kind, id));
    });
  });

  window.Layout = { render, get dragging() { return !!drag; } };
  if (App.view === 'layout') render();
})();
