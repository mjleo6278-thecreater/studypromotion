/* AI 도우미 화면: 오른쪽 아래 둥근 단추, 대화 창(폰은 아래에서 올라오는 시트, 넓은 화면은 옆 창),
 * AI가 낸 제안의 미리 보기(적용·되돌리기), 공부 시간 보여 주기, 복습 카드로 저장.
 *
 * 순수한 계산(지시문, 답 읽기, 동작 검사, 적용·되돌리기)은 aicore.js(window.AICore)가 맡는다.
 * AI를 부르는 쪽은 갈아 끼울 수 있다.
 *   - 실제 앱: AI_ENDPOINT(무료 서버 주소)에 로그인 확인표와 함께 보낸다. 비밀 키는 앱에 없다.
 *   - 미리 보기: window.AIMock (preview.js가 넣는 가짜 AI)
 * 주소도 가짜 AI도 없으면 단추를 만들지 않는다 (앱은 예전 그대로다).
 *
 * 대화는 이 기기에만 저장한다 (localStorage 'studypromotion.ai'). 계정 동기화에는 들어가지 않는다. */
(function () {
  'use strict';
  const App = window.App, Core = window.AICore;
  if (!App || !Core) return;

  const AI_ENDPOINT = ''; // 무료 서버(Cloudflare Worker) 주소. 비어 있으면 AI 도우미가 꺼진다
  const NAME = '세컨드';
  const KEY = 'studypromotion.ai';
  const KEEP = 60; // 남겨 두는 말의 수

  const { store, esc, toast } = App;
  const Stats = window.Stats;
  const fm = (m) => Stats.formatMinutes(m);
  const $ = (sel, el) => (el || document).querySelector(sel);
  const ic = (name) => App.ic(name);
  const ICON = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3.6l1.7 4.7a2 2 0 0 0 1.2 1.2l4.7 1.7-4.7 1.7a2 2 0 0 0-1.2 1.2L11 18.8l-1.7-4.7a2 2 0 0 0-1.2-1.2l-4.7-1.7 4.7-1.7a2 2 0 0 0 1.2-1.2z"/><path d="M18.6 15.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5.6"/><path d="m6.2 11.2 5.8-5.8 5.8 5.8"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>',
    fresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5V7.6A2.6 2.6 0 0 1 7.6 5h8.8A2.6 2.6 0 0 1 19 7.6v5.8a2.6 2.6 0 0 1-2.6 2.6H10l-4 3.2V16"/><path d="M12 8.2v4.6M9.7 10.5h4.6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5.6 12.6 4.2 4.2 8.6-9.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.6v12.8M5.6 12h12.8"/></svg>',
  };

  /* ---------- AI를 부르는 쪽 ---------- */
  // ask(messages, { signal, onText }) → { text, left } (left: 오늘 남은 횟수, 모르면 null). 실패하면 err.aiCode에 까닭
  const fail = (code, more) => Object.assign(new Error(code), { aiCode: code }, more || {});
  const remote = {
    needsLogin: true,
    async ask(messages, opts) {
      const user = window.Cloud && window.Cloud.user;
      if (!user) throw fail('login');
      let token, res;
      try { token = await user.getIdToken(); } catch (e) { throw fail('offline'); }
      try {
        res = await fetch(AI_ENDPOINT.replace(/\/+$/, '') + '/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ messages }), signal: opts.signal,
        });
      } catch (e) { if (e && e.name === 'AbortError') throw e; throw fail('offline'); }
      if (!res.ok) {
        let j = {};
        try { j = await res.json(); } catch (e) { /* 글이 아닌 답 */ }
        throw fail(j.error || (res.status === 429 ? 'limit' : res.status === 401 ? 'login' : 'server'), { scope: j.scope });
      }
      // 답은 조금씩 온다: 한 줄에 data: {"t":"글 조각"} 또는 data: {"left":37}, 끝은 data: [DONE]
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '', text = '', left = null;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        buf += dec.decode(part.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let j = null;
          try { j = JSON.parse(data); } catch (e) { continue; }
          if (j.error) throw fail(j.error, { scope: j.scope });
          if (typeof j.t === 'string') { text += j.t; opts.onText(text); }
          if (typeof j.left === 'number') left = j.left;
        }
      }
      return { text, left };
    },
  };
  const provider = () => window.AIMock || (AI_ENDPOINT ? remote : null);
  if (!provider()) return; // 서버 주소가 없으면 여기서 끝: 단추도 창도 만들지 않는다

  /* ---------- 저장 ---------- */
  // 말 하나: { id, role: 'user'|'ai', text, cards?, plan?, stats?, nav?, note?, error? }
  //  plan: { lines: [{ line, sub, warn }], rejected: [], state: 'ready'|'applied'|'undone'|'cancelled'|'expired', off: [빼 둔 줄 번호], go } — 적용에 필요한 실제 동작은 live에만 있다
  let S = { v: 1, msgs: [], deck: '', left: null, leftAt: 0 };
  const live = {}; // 이번에 연 동안만: { [말 id]: { ops, inv } }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.v === 1 && Array.isArray(saved.msgs)) S = Object.assign(S, saved);
  } catch (e) { /* 읽지 못하면 빈 대화로 */ }
  S.msgs = S.msgs.filter((m) => m && m.id && (m.role === 'user' || m.role === 'ai'));
  S.msgs.forEach((m) => { if (m.plan && m.plan.state === 'ready') m.plan.state = 'expired'; }); // 다시 열면 지난 제안은 적용할 수 없다
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, msgs: S.msgs.filter((m) => !m.pending).slice(-KEEP), deck: S.deck, left: S.left, leftAt: S.leftAt })); } catch (e) { /* 저장이 막힌 환경: 이번 동안만 보인다 */ }
  }
  let seq = 0;
  const newId = () => 'm' + Date.now().toString(36) + (seq++).toString(36);
  const find = (id) => S.msgs.find((m) => m.id === id);

  /* ---------- 화면 만들기 ---------- */
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ai-fab';
  fab.id = 'ai-fab';
  fab.setAttribute('aria-label', `AI 도우미 ${NAME} 열기`);
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.title = `AI 도우미 ${NAME}`;
  fab.innerHTML = ICON.spark;

  const back = document.createElement('div');
  back.className = 'ask-backdrop ai-back';
  back.id = 'ai-panel';
  back.hidden = true;
  back.innerHTML =
    '<section class="ai-sheet" role="dialog" aria-labelledby="ai-title">' +
      '<header class="ai-head">' +
        `<div class="ai-title"><span class="ai-mark">${ICON.spark}</span><b id="ai-title">${esc(NAME)}</b><small id="ai-left"></small></div>` +
        `<button type="button" class="icon-btn" id="ai-new" aria-label="새 대화 시작" title="새 대화">${ICON.fresh}</button>` +
        `<button type="button" class="icon-btn" id="ai-close" aria-label="닫기" title="닫기">${ic('x')}</button>` +
      '</header>' +
      '<div class="ai-log" id="ai-log" role="log" aria-live="polite" aria-label="대화"></div>' +
      '<form class="ai-form" id="ai-form" novalidate>' +
        `<textarea id="ai-input" rows="1" maxlength="2000" placeholder="모르는 표현을 묻거나 할 일을 말해 보세요" aria-label="${esc(NAME)}에게 보낼 말"></textarea>` +
        `<button type="submit" class="ai-send" id="ai-send" aria-label="보내기">${ICON.send}</button>` +
      '</form>' +
      `<p class="ai-foot">${esc(provider().note || 'AI의 답은 틀릴 수 있어요. 기록은 확인한 뒤에만 바뀌어요.')}</p>` +
    '</section>';
  document.body.appendChild(fab);
  document.body.appendChild(back);
  $('.ai-sheet', back).tabIndex = -1;
  const sheet = $('.ai-sheet', back), log = $('#ai-log', back), form = $('#ai-form', back), input = $('#ai-input', back), sendBtn = $('#ai-send', back);

  const isPhone = () => matchMedia('(max-width: 720px)').matches;
  const fine = () => matchMedia('(pointer: fine)').matches;

  /* ---------- 그리기 ---------- */
  const lines = (s) => esc(s).replace(/\n/g, '<br>');
  function examples() {
    const subj = (store.get().subjects[0] || {}).name || '수학';
    return [
      ['물어보기', ['Ojalá no llueva mañana 구문 해석해 줘', 'echar de menos가 무슨 뜻이야?']],
      ['시키기', [`내일 오후 4시부터 6시까지 ${subj} 일정 넣어 줘`, '못 끝낸 할 일을 내일로 미뤄 줘', '이번 주 공부 시간 보여 줘']],
    ];
  }
  function emptyHTML() {
    return '<div class="ai-empty">' +
      `<p class="ai-hello"><b>${esc(NAME)}</b>예요. 체스 선수 곁에서 수를 같이 연구하는 조력자를 세컨드라고 해요.<br>모르는 표현을 물어보거나, 앱에서 할 일을 말로 시켜 보세요.</p>` +
      examples().map(([head, list]) => `<p class="ai-eg-h">${head}</p>` + list.map((t) => `<button type="button" class="ai-eg" data-eg="${esc(t)}">${esc(t)}</button>`).join('')).join('') +
      '</div>';
  }

  function statsHTML(d) {
    const st = store.get(), today = App.todayKey();
    const r = Core.stats(st, d.from, d.to, d.subjectId);
    const subj = d.subjectId ? st.subjects.find((s) => s.id === d.subjectId) : null;
    const period = d.from === d.to ? Core.dateLabel(d.from, today) : `${Core.dateLabel(d.from, today)} ~ ${Core.dateLabel(d.to, today)}`;
    const max = Math.max(1, ...r.rows.map((x) => x.minutes));
    const sub = r.total
      ? (r.span > 1 ? `${r.span}일 중 ${r.days}일 공부 · 하루 평균 ${fm(Math.round(r.total / r.span))}` : '')
      : '이 기간에는 공부 기록이 없어요';
    return '<div class="ai-card ai-stats">' +
      `<p class="ai-card-h">${esc(period)}${subj ? ' · ' + esc(subj.name) : ''}</p>` +
      `<p class="ai-total"><b>${esc(fm(r.total))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</p>` +
      (r.rows.length > 1 || (r.rows.length === 1 && !subj)
        ? '<ul class="ai-bars">' + r.rows.slice(0, 8).map((x) => `<li><span><i class="dot"${x.color ? ` style="background:${esc(x.color)}"` : ''}></i>${esc(x.name)}</span><b><i style="width:${Math.max(3, Math.round(x.minutes / max * 100))}%${x.color ? ';background:' + esc(x.color) : ''}"></i></b><em>${esc(fm(x.minutes))}</em></li>`).join('') + '</ul>'
        : '') +
      '<div class="ai-card-act"><button type="button" class="btn link" data-ai-go="stats">통계에서 보기</button></div></div>';
  }

  function planHTML(m) {
    const p = m.plan, lv = live[m.id];
    const ready = p.state === 'ready' && lv;
    const off = p.off || [];
    const rows = p.lines.map((l, i) => {
      const op = ready ? lv.ops[i] : null;
      const picks = op && op.choices
        ? '<span class="ai-pick">' + op.choices.map((c) => `<button type="button" class="chip${op.data.subjectId === c.id ? ' active' : ''}" data-plan-subj="${i}" data-id="${esc(c.id)}" aria-pressed="${op.data.subjectId === c.id}">${esc(c.name)}</button>`).join('') + '</span>'
        : '';
      const body = `<span class="ai-op-t"><b>${esc(l.line)}</b>${l.sub ? `<small>${esc(l.sub)}</small>` : ''}${l.warn ? `<em>${esc(l.warn)}</em>` : ''}</span>`;
      const skipped = off.includes(i);
      return `<li class="ai-op${skipped ? ' off' : ''}">` +
        (ready && p.lines.length > 1 ? `<label><input type="checkbox" data-plan-on="${i}"${skipped ? '' : ' checked'}>${body}</label>` : `<div>${body}</div>`) + picks + '</li>';
    }).join('');
    const rej = (p.rejected || []).length ? `<p class="ai-rej">${p.rejected.map(esc).join('<br>')}</p>` : '';
    let foot = '';
    if (ready) {
      const onlyStart = lv.ops.every((o) => o.kind === 'effect' || o.kind === 'nav');
      foot = `<div class="ai-card-act"><button type="button" class="btn primary" data-plan-apply>${onlyStart ? '시작하기' : '적용'}</button><button type="button" class="btn" data-plan-cancel>취소</button></div>`;
    } else if (p.state === 'applied') {
      foot = `<div class="ai-card-act done"><span class="ai-done">${ICON.check}적용했어요</span>` +
        (lv && lv.inv && lv.inv.length ? `<button type="button" class="btn link" data-plan-undo>되돌리기</button>` : '') +
        (p.go ? `<button type="button" class="btn link" data-ai-go="${esc(p.go.view)}"${p.go.date ? ` data-date="${esc(p.go.date)}"` : ''}>${esc(Core.VIEWS[p.go.view] || '')}에서 보기</button>` : '') + '</div>';
    } else {
      foot = `<p class="ai-state">${{ undone: '되돌렸어요.', cancelled: '적용하지 않았어요.', expired: '적용하지 않은 지난 제안이에요. 필요하면 다시 말해 주세요.' }[p.state] || ''}</p>`;
    }
    const head = ready ? (p.lines.length > 1 ? `이렇게 ${p.lines.length}가지를 할게요` : '이렇게 할게요') : p.state === 'applied' ? '적용한 내용' : '제안';
    return `<div class="ai-card ai-plan is-${esc(p.state)}"><p class="ai-card-h">${head}</p><ul class="ai-ops">${rows}</ul>${rej}${foot}</div>`;
  }

  function cardsHTML(m) {
    const left = m.cards.filter((c) => !c.saved).length;
    const deck = deckLabel();
    return '<div class="ai-card ai-cards">' +
      `<p class="ai-card-h">복습 카드로 저장<button type="button" class="btn link" data-deck-pick>${esc(deck)}</button></p>` +
      '<ul class="ai-cardlist">' + m.cards.map((c, i) =>
        `<li><span><b>${esc(c.front)}</b><small>${esc(c.back)}</small></span>` +
        (c.saved ? `<span class="ai-saved" aria-label="저장됨">${ICON.check}</span>` : `<button type="button" class="ai-add" data-card="${i}" aria-label="${esc(c.front)} 카드 저장">${ICON.plus}</button>`) + '</li>').join('') + '</ul>' +
      (left > 1 ? `<div class="ai-card-act"><button type="button" class="btn" data-card="all">${left}장 모두 저장</button></div>` : '') + '</div>';
  }

  const ERR = {
    login: 'AI 도우미는 로그인한 뒤에 쓸 수 있어요. 한 사람이 하루에 쓰는 횟수를 세기 위해서예요.',
    limit: '오늘 쓸 수 있는 횟수를 다 썼어요. 내일 오전 9시에 다시 채워져요.',
    'limit-all': '오늘은 모두가 쓸 수 있는 양을 다 썼어요. 내일 오전 9시부터 다시 쓸 수 있어요.',
    offline: '인터넷에 연결되지 않아 답을 받지 못했어요.',
    server: 'AI가 지금 답하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  };
  function errorHTML(m) {
    const code = m.error === 'limit' && m.scope === 'all' ? 'limit-all' : m.error;
    const retry = code === 'offline' || code === 'server' || !ERR[code];
    return `<div class="ai-card ai-err"><p>${esc(ERR[code] || ERR.server)}</p><div class="ai-card-act">` +
      (code === 'login' ? '<button type="button" class="btn primary" data-ai-go="account">로그인하러 가기</button>' : '') +
      (retry ? '<button type="button" class="btn primary" data-retry>다시 보내기</button>' : '') +
      '<button type="button" class="btn" data-copy-q>질문 복사</button></div></div>';
  }

  function msgHTML(m) {
    if (m.role === 'user') return `<div class="ai-msg me" data-id="${esc(m.id)}"><div class="ai-bubble">${lines(m.text)}</div></div>`;
    let h = `<div class="ai-msg ai" data-id="${esc(m.id)}">`;
    if (m.pending) h += `<div class="ai-text">${m.text ? Core.md(m.text) : ''}</div><p class="ai-typing" aria-label="답을 쓰는 중"><i></i><i></i><i></i></p>`;
    else if (m.text) h += `<div class="ai-text">${Core.md(m.text)}</div>`;
    if (m.stopped) h += '<p class="ai-state">여기서 멈췄어요.</p>';
    if (m.error) h += errorHTML(m);
    (m.stats || []).forEach((d) => { h += statsHTML(d); });
    if (m.plan) h += planHTML(m);
    if (m.note && m.note.length) h += `<p class="ai-rej">${m.note.map(esc).join('<br>')}</p>`;
    if (m.nav) h += `<div class="ai-card-act"><button type="button" class="btn primary" data-ai-go="${esc(m.nav.view)}"${m.nav.date ? ` data-date="${esc(m.nav.date)}"` : ''}>${esc(Core.VIEWS[m.nav.view] || '화면')} 열기</button></div>`;
    if (m.cards && m.cards.length) h += cardsHTML(m);
    return h + '</div>';
  }

  const nearEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toEnd = () => { log.scrollTop = log.scrollHeight; };
  function renderAll() {
    log.innerHTML = S.msgs.length ? S.msgs.map(msgHTML).join('') : emptyHTML();
    renderLeft();
    toEnd();
  }
  function renderMsg(m, stick) {
    const el = log.querySelector(`[data-id="${m.id}"]`);
    if (!el) return renderAll();
    const follow = stick || nearEnd();
    el.outerHTML = msgHTML(m);
    if (follow) toEnd();
  }
  // 한도는 한국 시각 오전 9시(= 0시 UTC)에 다시 채워진다. 그 전에 받은 남은 횟수만 보여 준다
  const quotaDay = (t) => Math.floor(t / 86400000);
  function renderLeft() {
    const known = typeof S.left === 'number' && quotaDay(S.leftAt) === quotaDay(Date.now());
    $('#ai-left', back).textContent = known ? `오늘 ${Math.max(0, S.left)}번 남음` : 'AI 도우미';
  }

  /* ---------- 열고 닫기 ---------- */
  let lastFocus = null, closeTimer = null;
  function fit() {
    // 폰에서 글자판이 올라오면 보이는 높이에 맞춘다 (글자판이 입력 칸을 가리지 않게)
    const vv = window.visualViewport;
    if (!vv || !isPhone() || back.hidden) { back.style.removeProperty('--ai-vh'); back.style.removeProperty('--ai-kb'); return; }
    back.style.setProperty('--ai-vh', Math.round(vv.height) + 'px');
    back.style.setProperty('--ai-kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px');
  }
  function open() {
    if (!back.hidden && back.classList.contains('in')) return;
    clearTimeout(closeTimer);
    lastFocus = document.activeElement;
    back.hidden = false;
    renderAll();
    fit();
    requestAnimationFrame(() => { back.classList.add('in'); toEnd(); });
    document.body.classList.add('ai-open');
    fab.setAttribute('aria-expanded', 'true');
    // 넓은 화면에서는 바로 적을 수 있게. 폰에서는 글자판이 갑자기 올라오지 않게 창에만 초점을 둔다
    setTimeout(() => (fine() ? input : sheet).focus({ preventScroll: true }), 60);
  }
  function close() {
    if (back.hidden) return;
    back.classList.remove('in');
    document.body.classList.remove('ai-open');
    fab.setAttribute('aria-expanded', 'false');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { back.hidden = true; }, 200);
    if (lastFocus && document.contains(lastFocus) && back.contains(document.activeElement)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
  }
  fab.addEventListener('click', () => (back.hidden || !back.classList.contains('in') ? open() : close()));
  $('#ai-close', back).addEventListener('click', close);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  back.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.ui-back:not(.out)')) { e.stopPropagation(); close(); } });
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }
  window.addEventListener('resize', fit);

  $('#ai-new', back).addEventListener('click', async () => {
    if (!S.msgs.length) return;
    if (busy) stop();
    if (!(await App.ask('지금 대화를 지우고 새로 시작할까요?\n적용한 기록은 그대로 남아요.', { ok: '새 대화', cancel: '그대로 두기' }))) return;
    S.msgs = [];
    Object.keys(live).forEach((k) => delete live[k]);
    save();
    renderAll();
  });

  /* ---------- 보내기 ---------- */
  let busy = false, ctrl = null;
  function setBusy(on) {
    busy = on;
    sendBtn.innerHTML = on ? ICON.stop : ICON.send;
    sendBtn.setAttribute('aria-label', on ? '답 멈추기' : '보내기');
    sendBtn.classList.toggle('stop', on);
  }
  function stop() { if (ctrl) ctrl.abort(); }
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 132) + 'px'; }
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    // 글자를 조합하는 중(한글 입력)에는 Enter가 글자를 마무리하는 키다
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && fine()) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : sendBtn.click(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return stop();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    grow();
    send(text);
  });

  function historyFor() {
    return S.msgs.filter((m) => !m.pending && !m.error && m.text).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', text: m.text }));
  }

  async function send(text) {
    const p = provider();
    if (!p || busy) return;
    const hist = historyFor();
    const mine = { id: newId(), role: 'user', text };
    const m = { id: newId(), role: 'ai', text: '', pending: true };
    if (!S.msgs.length) log.innerHTML = '';
    S.msgs.push(mine, m);
    log.insertAdjacentHTML('beforeend', msgHTML(mine) + msgHTML(m));
    toEnd();
    save();
    setBusy(true);
    ctrl = new AbortController();
    const st = store.get(), now = App.now(), ctx = Core.buildContext(st, now);
    let raw = '', frame = 0;
    const onText = (t) => {
      raw = t;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = log.querySelector(`[data-id="${m.id}"] .ai-text`);
        if (!el || !m.pending) return;
        const follow = nearEnd();
        el.innerHTML = Core.md(Core.visibleText(raw));
        if (follow) toEnd();
      });
    };
    try {
      // 앱 정보가 필요 없어 보이는 말은 짧게 보낸다. AI가 '앱 정보가 필요하다'고 답하면 그때 붙여서 다시 보낸다
      let withApp = Core.needsApp(text);
      let out = await p.ask(Core.messages(text, ctx, hist, withApp), { signal: ctrl.signal, onText });
      let r = Core.parseReply(out.text);
      if (r.needApp && !withApp) {
        raw = '';
        out = await p.ask(Core.messages(text, ctx, hist, true), { signal: ctrl.signal, onText });
        r = Core.parseReply(out.text);
      }
      if (typeof out.left === 'number') { S.left = out.left; S.leftAt = Date.now(); }
      finish(m, r, ctx);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        m.text = Core.parseReply(Core.visibleText(raw)).text;
        if (m.text) m.stopped = true;
        else { S.msgs = S.msgs.filter((x) => x !== m); }
      } else {
        m.text = '';
        m.error = (e && e.aiCode) || 'server';
        if (e && e.scope) m.scope = e.scope;
        m.q = text;
      }
    } finally {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      m.pending = false;
      ctrl = null;
      setBusy(false);
      save();
      if (S.msgs.includes(m)) renderMsg(m, true); else renderAll();
      renderLeft();
    }
  }

  // AI의 답을 화면에 낼 모양으로: 글, 카드 후보, 그리고 검사를 통과한 동작(제안·보여 주기·화면 열기)
  function finish(m, r, ctx) {
    m.text = r.text;
    if (r.cards.length) m.cards = r.cards.map((c) => ({ front: c.front, back: c.back, saved: false }));
    if (r.actions.length) {
      const res = Core.validate(r.actions, store.get(), ctx, App.now());
      const reads = res.ops.filter((o) => o.kind === 'read').slice(0, 3);
      const rest = res.ops.filter((o) => o.kind !== 'read');
      if (reads.length) m.stats = reads.map((o) => o.data);
      if (rest.length && rest.every((o) => o.kind === 'nav')) m.nav = rest[0].data;
      else if (rest.length) {
        m.plan = { lines: rest.map((o) => ({ line: o.line, sub: o.sub, warn: o.warn })), rejected: res.rejected, state: 'ready', off: [] };
        live[m.id] = { ops: rest, inv: null };
      }
      if (!m.plan && res.rejected.length) m.note = res.rejected;
    } else if (r.broken) m.note = ['제안을 읽지 못했어요. 한 번 더 말해 주세요.'];
    if (!m.text && !m.plan && !m.stats && !m.nav && !m.cards && !m.note) m.text = '답을 받지 못했어요. 한 번 더 말해 주세요.';
  }

  /* ---------- 제안 적용·되돌리기 ---------- */
  const env = () => ({ now: App.now(), uid: App.uid });
  // 적용한 것을 어디서 볼 수 있는지
  function whereOf(op) {
    const d = op.data, day = (t) => Stats.dayKey(t);
    if (op.type === 'add_event') return { view: 'timetable', date: d.ev.date };
    if (op.type === 'move_event') return { view: 'timetable', date: d.ev.date };
    if (op.type === 'add_session') return { view: 'timetable', date: d.from ? day(d.from) : d.date };
    if (op.type === 'add_card') return { view: 'review' };
    if (op.type === 'add_exam' || op.type === 'set_exam_date') return { view: 'home' };
    if (op.type === 'set_goal') return null;
    return { view: 'plan' };
  }
  function goTo(d) {
    close();
    if (d.view === 'timetable' && window.Timetable) window.Timetable.open(d.date || null);
    else App.go(d.view);
  }
  async function runEffect(op) {
    const d = op.data, SW = window.Stopwatch;
    if (window.Lock && window.Lock.state) return;
    if ((App.timerBusy && App.timerBusy()) || (SW && SW.running())) { toast('이미 시간을 재고 있어요. 먼저 멈춘 뒤에 다시 말해 주세요'); return; }
    close();
    if (d.kind === 'stopwatch' && SW) { SW.showTab('sw'); App.go('timer'); await SW.start(d.subjectId || ''); }
    else if (App.startFocus) App.startFocus({ subjectId: d.subjectId, minutes: d.minutes });
  }

  function applyPlan(m) {
    const lv = live[m.id], p = m.plan;
    if (!lv || !p || p.state !== 'ready') return;
    const picked = lv.ops.filter((o, i) => !(p.off || []).includes(i));
    if (!picked.length) return toast('적용할 것을 하나 이상 골라 주세요');
    const changes = picked.filter((o) => o.kind === 'change');
    if (changes.length) {
      // 바꾸기 전 기록을 자동 백업에 남긴다 (설정 → 자동 백업에서 되돌릴 수 있다)
      try { if (App.backup && App.backup.add) App.backup.add(JSON.stringify(store.get()), 'ai', p.lines[0].line); } catch (e) { /* 백업을 못 해도 적용은 한다 */ }
      store.update((st) => { lv.inv = Core.applyOps(st, changes, env()); });
      if (changes.some((o) => o.type === 'set_goal') && App.syncTimerLen) App.syncTimerLen();
      const where = whereOf(changes[0]);
      if (where) p.go = where;
    }
    p.state = 'applied';
    save();
    renderMsg(m);
    const eff = picked.find((o) => o.kind === 'effect'), nav = picked.find((o) => o.kind === 'nav');
    // 창이 열려 있는 동안에는 카드에 '적용했어요 · 되돌리기'가 보이므로, 창을 닫고 다른 화면으로 갈 때만 따로 알린다
    if (changes.length && (eff || nav)) toast(changes.length > 1 ? `${changes.length}가지를 적용했어요` : '적용했어요', { action: '되돌리기', onAction: () => undoPlan(m) });
    if (eff) runEffect(eff);
    else if (nav) goTo(nav.data);
  }
  function undoPlan(m) {
    const lv = live[m.id];
    if (!lv || !lv.inv || !m.plan || m.plan.state !== 'applied') return;
    let n = 0;
    store.update((st) => { n = Core.undoOps(st, lv.inv); });
    lv.inv = null;
    m.plan.state = 'undone';
    if (App.syncTimerLen) App.syncTimerLen();
    save();
    renderMsg(m);
    toast(n ? '되돌렸어요' : '그사이 직접 고친 내용이라 그대로 두었어요');
  }

  /* ---------- 복습 카드로 저장 ---------- */
  const NEW_DECK = '\u0000new';
  function deckLabel() {
    const decks = store.get().decks;
    const cur = decks.find((d) => d.name === S.deck);
    if (cur) return `${cur.name} 덱에`;
    return decks.length && S.deck !== Core.DEFAULT_DECK ? '덱 고르기' : `새 덱 '${Core.DEFAULT_DECK}'에`;
  }
  // 저장할 덱 이름. 덱이 없으면 '표현 모음'을 새로 만든다. 고르다 닫으면 undefined
  async function pickDeck(force) {
    const decks = store.get().decks;
    if (!decks.length) return Core.DEFAULT_DECK;
    if (!force && (decks.some((d) => d.name === S.deck) || S.deck === Core.DEFAULT_DECK)) return S.deck; // 전에 고른 덱 (새 덱을 골랐으면 없을 때 다시 만든다)
    const hasDefault = decks.some((d) => d.name === Core.DEFAULT_DECK);
    const v = await App.choose('어느 덱에 저장할까요?',
      decks.map((d) => ({ value: d.name, label: d.name })).concat(hasDefault ? [] : [{ value: NEW_DECK, label: `새 덱 '${Core.DEFAULT_DECK}' 만들기`, hint: 'AI에게 물어본 표현을 모아 두는 덱' }]),
      { note: '한 번 고르면 다음부터는 이 덱에 바로 저장해요.' });
    if (v === undefined) return undefined;
    S.deck = v === NEW_DECK ? Core.DEFAULT_DECK : v;
    save();
    return S.deck;
  }
  async function saveCards(m, which) {
    const list = which === 'all' ? m.cards.filter((c) => !c.saved) : [m.cards[+which]].filter((c) => c && !c.saved);
    if (!list.length) return;
    const deck = await pickDeck(false);
    if (deck === undefined) return;
    const st = store.get(), now = App.now();
    const res = Core.validate(list.map((c) => ({ type: 'add_card', deck, front: c.front, back: c.back })), st, Core.buildContext(st, now), now);
    if (!res.ops.length) return toast('카드를 저장하지 못했어요');
    let inv = [];
    store.update((s) => { inv = Core.applyOps(s, res.ops, env()); });
    S.deck = deck;
    list.forEach((c) => { c.saved = true; });
    save();
    renderMsg(m);
    toast(`복습 카드 ${list.length}장을 '${deck}' 덱에 저장했어요`, {
      action: '되돌리기',
      onAction: () => { store.update((s) => { Core.undoOps(s, inv); }); list.forEach((c) => { c.saved = false; }); save(); renderMsg(m); },
    });
  }

  /* ---------- 누르기 ---------- */
  log.addEventListener('click', async (e) => {
    const t = e.target;
    const eg = t.closest('[data-eg]');
    if (eg) return send(eg.dataset.eg);
    const box = t.closest('.ai-msg');
    const m = box ? find(box.dataset.id) : null;
    const go = t.closest('[data-ai-go]');
    if (go) return goTo({ view: go.dataset.aiGo, date: go.dataset.date || null });
    if (!m) return;
    if (t.closest('[data-plan-apply]')) return applyPlan(m);
    if (t.closest('[data-plan-undo]')) return undoPlan(m);
    if (t.closest('[data-plan-cancel]')) { m.plan.state = 'cancelled'; delete live[m.id]; save(); return renderMsg(m); }
    const subj = t.closest('[data-plan-subj]');
    if (subj && live[m.id]) {
      const op = live[m.id].ops[+subj.dataset.planSubj];
      op.data.subjectId = op.data.subjectId === subj.dataset.id ? null : subj.dataset.id;
      return renderMsg(m);
    }
    const card = t.closest('[data-card]');
    if (card) return saveCards(m, card.dataset.card);
    if (t.closest('[data-deck-pick]')) { if ((await pickDeck(true)) !== undefined) renderMsg(m); return; }
    if (t.closest('[data-retry]')) {
      // 답을 못 받은 질문과 그 알림을 지우고 같은 질문을 다시 보낸다
      const q = m.q || '', i = S.msgs.indexOf(m), withQ = i > 0 && S.msgs[i - 1].role === 'user';
      S.msgs.splice(withQ ? i - 1 : i, withQ ? 2 : 1);
      renderAll();
      if (q) send(q);
      return;
    }
    if (t.closest('[data-copy-q]')) {
      try { await navigator.clipboard.writeText(m.q || ''); toast('질문을 복사했어요'); } catch (err) { toast('복사하지 못했어요'); }
    }
  });
  log.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-plan-on]');
    if (!cb) return;
    const box = cb.closest('.ai-msg'), m = box ? find(box.dataset.id) : null;
    if (!m || !m.plan) return;
    const i = +cb.dataset.planOn, off = new Set(m.plan.off || []);
    if (cb.checked) off.delete(i); else off.add(i);
    m.plan.off = [...off];
    cb.closest('.ai-op').classList.toggle('off', !cb.checked);
  });

  // 기록이 바뀌면(다른 화면에서 고쳤거나 동기화) 공부 시간 카드와 덱 이름을 새로 그린다
  store.subscribe(() => { if (!back.hidden && !busy) { const y = log.scrollTop; log.innerHTML = S.msgs.length ? S.msgs.map(msgHTML).join('') : emptyHTML(); log.scrollTop = y; } });

  window.AI = { open, close, send, get busy() { return busy; }, get messages() { return S.msgs; },
    // 대화를 모두 지운다 ('모든 데이터 초기화'에서도 부른다)
    clear() { if (busy) stop(); S.msgs = []; S.deck = ''; Object.keys(live).forEach((k) => delete live[k]); save(); if (!back.hidden) renderAll(); },
  };
})();
