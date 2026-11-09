/* 화면 부품: 브라우저 기본 모양 대신 앱 디자인으로 그리는 선택창과 색 고르기
 *  - 선택창(select): 원래 <select>는 값·이벤트 담당으로 그대로 두고 (숨김), 그 옆에 앱 모양 버튼을 붙인다.
 *    누르면 폰에서는 아래에서 올라오는 시트, 넓은 화면에서는 버튼 아래 목록이 뜬다. 고르면 원래 select의 change가 그대로 일어난다.
 *  - 색 고르기: 색 계열별로 정리한 팔레트 시트 (UI.pickColor)
 */
(function (root) {
  // 색 계열별 팔레트: 각 줄은 연한 → 진한 순서, 흰 바탕·검은 바탕 모두에서 글자·막대가 잘 보이는 톤
  const PALETTE = [
    { name: '레드', colors: ['#f2a7a1', '#ec7b72', '#e05a4f', '#c43d33', '#982b24'] },
    { name: '코랄·오렌지', colors: ['#f8bc94', '#f59a62', '#ef7d3c', '#d96424', '#a94b19'] },
    { name: '옐로·머스터드', colors: ['#f6dd8a', '#f2c94c', '#e3ae24', '#c18f13', '#8f6a0e'] },
    { name: '그린', colors: ['#a8dcb0', '#73c286', '#45a865', '#2f8a4e', '#1f6639'] },
    { name: '민트·틸', colors: ['#9fe0d2', '#5cc8b2', '#2aa893', '#1c8a78', '#14675a'] },
    { name: '스카이·블루', colors: ['#a6d4f5', '#6db6ee', '#3d96e0', '#2a76c2', '#1d5794'] },
    { name: '네이비·인디고', colors: ['#b3bdf2', '#8593e6', '#5e6cd6', '#4450b3', '#2f3880'] },
    { name: '퍼플·라벤더', colors: ['#d2bdf2', '#b493e8', '#9468d9', '#774bbd', '#57348f'] },
    { name: '핑크·로즈', colors: ['#f6b9d3', '#ef8db8', '#e36299', '#c7457d', '#97305d'] },
    { name: '브라운·뉴트럴', colors: ['#d6c3ad', '#b89a7c', '#8f7056', '#6b6f76', '#3d4147'] },
  ];
  const ALL = PALETTE.reduce((a, f) => a.concat(f.colors), []);

  if (typeof module !== 'undefined' && module.exports) { module.exports = { PALETTE, ALL }; return; }
  const doc = root.document;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const narrow = () => root.matchMedia('(max-width: 720px)').matches;

  /* ---------- 공용 시트 ---------- */
  let sheet = null; // { el, close }
  function closeSheet(v) { if (sheet) sheet.close(v); }

  // body: 시트 안 HTML, anchor: 넓은 화면에서 붙일 요소. onPick(el) → 값 돌려주면 닫힌다
  function openSheet({ title, body, anchor, cls, onClick, onKey, focusSel }) {
    closeSheet();
    return new Promise((resolve) => {
      const back = doc.createElement('div');
      const pop = !narrow() && anchor;
      back.className = 'ui-back' + (pop ? ' pop' : '');
      back.innerHTML = `<div class="ui-sheet ${cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(title || '선택')}">` +
        (pop ? '' : '<div class="ui-grip" aria-hidden="true"></div>') +
        (title ? `<div class="ui-sheet-head"><b>${esc(title)}</b><button type="button" class="ui-x" data-ui-close aria-label="닫기">✕</button></div>` : '') +
        `<div class="ui-sheet-body">${body}</div></div>`;
      doc.body.appendChild(back);
      const box = back.firstElementChild;
      const prevFocus = doc.activeElement;
      if (pop) {
        const r = anchor.getBoundingClientRect();
        const w = Math.max(r.width, 220);
        box.style.minWidth = w + 'px';
        const bw = box.offsetWidth, bh = box.offsetHeight;
        let left = Math.min(r.left, innerWidth - bw - 8);
        let top = r.bottom + 6;
        if (top + bh > innerHeight - 8) top = Math.max(8, r.top - bh - 6);
        box.style.left = Math.max(8, left) + 'px';
        box.style.top = top + 'px';
      }
      requestAnimationFrame(() => back.classList.add('in'));
      let done = false;
      const close = (v) => {
        if (done) return;
        done = true;
        sheet = null;
        back.classList.remove('in');
        back.classList.add('out');
        setTimeout(() => back.remove(), 180);
        doc.removeEventListener('keydown', key, true);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
        resolve(v);
      };
      const key = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(undefined); return; }
        if (onKey) onKey(e, box, close);
      };
      doc.addEventListener('keydown', key, true);
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-ui-close]')) { close(undefined); return; }
        if (onClick) onClick(e, close);
      });
      sheet = { el: back, close };
      const f = box.querySelector(focusSel || '[aria-selected="true"], button');
      if (f) f.focus({ preventScroll: true });
      if (f && f.scrollIntoView) f.scrollIntoView({ block: 'nearest' });
    });
  }

  /* ---------- 선택창 ---------- */
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const protoIdx = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  const chevron = '<svg class="sel-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function optColor(o) { return o && o.dataset ? o.dataset.color || '' : ''; }

  function refresh(sel) {
    const btn = sel._uiBtn;
    if (!btn) return;
    const o = sel.options[protoIdx.get.call(sel)];
    const c = optColor(o);
    btn.innerHTML = (c ? `<i class="sel-dot" style="background:${esc(c)}"></i>` : '') +
      `<span class="sel-label">${esc(o ? o.textContent : '')}</span>${chevron}`;
    btn.disabled = sel.disabled;
    btn.hidden = sel.hidden;
    btn.title = o ? o.textContent : '';
  }

  function openSelect(sel) {
    const btn = sel._uiBtn;
    const cur = protoIdx.get.call(sel);
    let html = '<div class="ui-opts" role="listbox">';
    const add = (o, i) => {
      if (o.hidden) return;
      const c = optColor(o);
      const on = i === cur;
      html += `<button type="button" role="option" class="ui-opt${on ? ' on' : ''}${o.value === '__new' ? ' new' : ''}" data-i="${i}" aria-selected="${on}"${o.disabled ? ' disabled' : ''}>` +
        (c ? `<i class="sel-dot" style="background:${esc(c)}"></i>` : '') +
        `<span>${esc(o.textContent)}</span>${on ? '<svg class="ui-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}</button>`;
    };
    let i = 0;
    for (const ch of sel.children) {
      if (ch.tagName === 'OPTGROUP') {
        html += `<div class="ui-group">${esc(ch.label)}</div>`;
        for (const o of ch.children) add(o, i++);
      } else add(ch, i++);
    }
    html += '</div>';
    const label = sel.getAttribute('aria-label') || (sel.closest('label') && sel.closest('label').firstChild && sel.closest('label').firstChild.textContent.trim()) || '선택';
    btn.setAttribute('aria-expanded', 'true');
    openSheet({
      title: label, body: html, anchor: btn, cls: 'ui-select',
      onClick: (e, close) => {
        const b = e.target.closest('.ui-opt');
        if (b && !b.disabled) close(Number(b.dataset.i));
      },
      onKey: (e, box) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const list = [...box.querySelectorAll('.ui-opt:not([disabled])')];
        const k = list.indexOf(doc.activeElement);
        const n = list[Math.max(0, Math.min(list.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (n) n.focus();
      },
    }).then((idx) => {
      btn.setAttribute('aria-expanded', 'false');
      if (idx == null || idx === protoIdx.get.call(sel)) return;
      protoIdx.set.call(sel, idx);
      refresh(sel);
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function enhance(sel) {
    if (sel._uiBtn || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'sel-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    if (sel.id) btn.dataset.for = sel.id;
    sel._uiBtn = btn;
    sel.classList.add('sel-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    sel.after(btn);
    // 코드가 value / selectedIndex를 바꿔도 버튼 글자가 따라오게
    Object.defineProperty(sel, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); refresh(this); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return protoIdx.get.call(this); }, set(v) { protoIdx.set.call(this, v); refresh(this); } });
    new MutationObserver(() => refresh(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'selected'] });
    sel.addEventListener('change', () => refresh(sel));
    btn.addEventListener('click', () => openSelect(sel));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openSelect(sel); }
    });
    // 라벨을 누르면 버튼으로
    const lab = sel.closest('label');
    if (lab) lab.addEventListener('click', (e) => { if (e.target === lab) { e.preventDefault(); btn.focus(); } });
    refresh(sel);
  }

  function enhanceAll(rootEl) {
    (rootEl || doc).querySelectorAll('select').forEach(enhance);
  }

  /* ---------- 색 고르기 ---------- */
  function swatchGrid(current) {
    const cur = String(current || '').toLowerCase();
    return '<div class="ui-palette">' + PALETTE.map((f) =>
      `<div class="ui-fam"><span class="ui-fam-name">${esc(f.name)}</span><div class="ui-fam-row">` +
      f.colors.map((c) => `<button type="button" class="ui-sw${c === cur ? ' on' : ''}" data-color="${c}" style="--c:${c}" aria-label="${esc(f.name)} ${c}" aria-pressed="${c === cur}"></button>`).join('') +
      '</div></div>').join('') + '</div>';
  }
  function pickColor(opts) {
    opts = opts || {};
    return openSheet({
      title: opts.title || '색 고르기', body: swatchGrid(opts.current), anchor: opts.anchor, cls: 'ui-colors',
      focusSel: '.ui-sw.on, .ui-sw',
      onClick: (e, close) => { const b = e.target.closest('.ui-sw'); if (b) close(b.dataset.color); },
      onKey: (e, box) => {
        const map = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 5, ArrowUp: -5 };
        if (!(e.key in map)) return;
        e.preventDefault();
        const list = [...box.querySelectorAll('.ui-sw')];
        const k = list.indexOf(doc.activeElement);
        const n = list[Math.max(0, Math.min(list.length - 1, (k < 0 ? 0 : k) + map[e.key]))];
        if (n) n.focus();
      },
    });
  }

  // <input type="color">를 팔레트 버튼으로 바꾼다 (input은 숨긴 채 값을 그대로 가진다)
  function enhanceColor(input) {
    if (input._uiBtn) return;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'color-btn';
    btn.setAttribute('aria-label', input.getAttribute('aria-label') || '색 고르기');
    input._uiBtn = btn;
    input.type = 'hidden';
    input.after(btn);
    const paint = () => { btn.style.setProperty('--c', input.value); btn.title = '색: ' + input.value; };
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); paint(); } });
    btn.addEventListener('click', async () => {
      const c = await pickColor({ title: input.getAttribute('aria-label') || '색 고르기', current: input.value, anchor: btn });
      if (!c) return;
      input.value = c;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    paint();
  }

  enhanceAll();
  doc.querySelectorAll('input[type="color"]').forEach(enhanceColor);
  // 나중에 그려지는 선택창도 (할 일 고치기 등)
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'SELECT') enhance(n);
      else if (n.querySelector) {
        if (n.querySelector('select')) enhanceAll(n);
        n.querySelectorAll('input[type="color"]').forEach(enhanceColor);
      }
    }
  }).observe(doc.body, { childList: true, subtree: true });

  root.UI = { PALETTE, ALL, pickColor, openSheet, closeSheet, enhance, enhanceAll, refresh };
})(typeof window !== 'undefined' ? window : globalThis);
