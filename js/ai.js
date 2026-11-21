/* AI 도우미 화면: 오른쪽 아래 둥근 단추, 대화 창(폰은 아래에서 올라오는 시트, 넓은 화면은 옆 창),
 * AI가 낸 제안의 미리 보기(적용·되돌리기), 공부 시간 보여 주기, 복습 카드로 저장.
 *
 * 순수한 계산(지시문, 답 읽기, 동작 검사, 적용·되돌리기)은 aicore.js(window.AICore)가 맡는다.
 * AI를 부르는 쪽은 갈아 끼울 수 있다.
 *   - 실제 앱: AI_ENDPOINT(무료 서버 주소)에 로그인 확인표와 함께 보낸다. 비밀 키는 앱에 없다.
 *   - 미리 보기: window.AIMock (preview.js가 넣는 가짜 AI)
 * 주소도 가짜 AI도 없으면 단추를 만들지 않는다 (앱은 예전 그대로다).
 *
 * 대화는 이 기기에만 저장한다 (localStorage 'studypromotion.ai'). 계정 동기화에는 들어가지 않는다.
 *
 * 사진 보내기(v4.4): 입력 칸 왼쪽 카메라 단추 → 앨범·사진 찍기 → 사진 한 장을 질문과 함께 보낸다.
 *   앱이 긴 변 1280픽셀 JPEG로 다시 그려 보낸다(찍은 장소 같은 사진 속 정보가 지워진다). 서버는 모델에 넘기기만 한다.
 *   기기에는 대화에 보이는 작은 그림만 남는다. 세컨드가 사진에서 읽은 글(<read>)을 답에 접어 두고, 이어지는 질문에는
 *   사진 대신 그 글을 보낸다. 서버가 사진을 열어 준 계정(GET /me의 photo)에만 단추가 보인다. */
(function () {
  'use strict';
  const App = window.App, Core = window.AICore;
  if (!App || !Core) return;

  const AI_ENDPOINT = 'https://studypromotion-ai.mj-leo6278.workers.dev'; // 무료 서버(Cloudflare Worker) 주소. 비어 있으면 AI 도우미가 꺼진다
  const AI_HOME = 'https://mjleo6278-thecreater.github.io'; // 서버는 이 주소의 앱에서 온 요청만 받는다. 다른 주소(개발용 등)에서는 AI 도우미를 켜지 않는다
  const GATE_KEY = 'studypromotion.ai.gate';
  const GATE_FRESH = 10 * 60 * 1000; // 서버에 다시 묻기까지 기다리는 시간
  const NAME = '세컨드';
  const KEY = 'studypromotion.ai';
  const KEEP = 60; // 남겨 두는 말의 수
  const PHOTO = { max: 1280, small: 1024, chars: 1400000, thumb: 240, keepThumbs: 12, file: 40 * 1024 * 1024 }; // 보내는 사진의 긴 변·글자 수 상한, 대화에 남기는 작은 그림, 고를 수 있는 파일 크기
  const PHOTO_CHIPS = ['해석해 줘', '단어 뜻 알려 줘', '카드로 만들어 줘', '풀이 힌트만 줘'];
  const PHOTO_ASK = '이 사진을 풀이해 줘'; // 사진만 보내고 글을 안 쓰면

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
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.6A2.1 2.1 0 0 1 6.1 6.5h1.7l1.3-2h5.8l1.3 2h1.7A2.1 2.1 0 0 1 20 8.6v8.3a2.1 2.1 0 0 1-2.1 2.1H6.1A2.1 2.1 0 0 1 4 16.9z"/><circle cx="12" cy="12.6" r="3.4"/></svg>',
    album: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="16" height="15" rx="2.6"/><circle cx="9.2" cy="9.6" r="1.6"/><path d="m4.6 17.4 4.6-4.4 3.4 3.1 2.6-2.4 4.2 3.9"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  };

  /* ---------- AI를 부르는 쪽 ---------- */
  // ask(messages, { signal, onText, again }) → { text, left, unlimited, cut, diag }
  //  again: 방금 한 질문을 앱 정보와 함께 다시 묻는 것 (서버가 한 번만 센다)
  //  left: 오늘 남은 횟수(모르면 null), unlimited: 횟수 제한이 없는 계정, cut: 답이 오다가 연결이 끊김,
  //  diag: 무슨 일이 있었는지 알려 주는 숫자들(문제가 생겼을 때 '자세히'에 보여 준다). 실패하면 err.aiCode에 까닭
  const fail = (code, more) => Object.assign(new Error(code), { aiCode: code }, more || {});
  const remote = {
    needsLogin: true,
    async ask(messages, opts) {
      const user = window.Cloud && window.Cloud.user;
      if (!user) throw fail('login');
      const t0 = Date.now();
      const d = { status: 0, mode: '', n: 0, chars: 0, think: 0, finish: '', usage: null, ms: 0, cut: '', detail: '' };
      const done = () => { d.ms = Date.now() - t0; return d; };
      let token, res;
      try { token = await user.getIdToken(); } catch (e) { throw fail('offline'); }
      try {
        res = await fetch(AI_ENDPOINT.replace(/\/+$/, '') + '/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify(Object.assign({ messages, v: 2 }, opts.again ? { again: true } : {})), signal: opts.signal, // v 2: 서버가 모델의 답을 손대지 않고 넘겨 준다
        });
      } catch (e) { if (e && e.name === 'AbortError') throw e; throw fail('offline'); }
      d.status = res.status;
      if (!res.ok) {
        let j = {};
        try { j = await res.json(); } catch (e) { /* 글이 아닌 답 */ }
        if (typeof j.detail === 'string') d.detail = j.detail.slice(0, 200);
        throw fail(j.error || (res.status === 429 ? 'limit' : res.status === 401 ? 'login' : 'server'), { scope: j.scope, diag: done() });
      }
      // 남은 횟수는 머리말로 온다 (예전 서버는 답의 끝에 적어 보낸다)
      const head = (k) => { try { return res.headers.get(k); } catch (e) { return null; } };
      let text = '', left = null, unlimited = head('X-AI-Unlimited') === '1', cut = false;
      if (/^\d+$/.test(head('X-AI-Left') || '')) left = +head('X-AI-Left');
      d.mode = head('X-AI-Mode') || '';
      // 답은 조금씩 온다: 한 줄에 data: { 글 조각 }, 끝은 data: [DONE]. 줄의 모양은 AICore.readChunk가 읽는다
      const take = (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return;
        let j = null;
        try { j = JSON.parse(data); } catch (e) { return; }
        const c = Core.readChunk(j);
        d.n++;
        if (c.error) { d.detail = c.detail; throw fail(c.error, { scope: c.scope || undefined, diag: done() }); }
        if (c.think) d.think += c.think.length;
        if (c.finish) d.finish = c.finish;
        if (c.usage) d.usage = c.usage;
        if (c.left !== null) left = c.left;
        if (c.unlimited) unlimited = true;
        if (c.text) { text += c.text; d.chars = text.length; opts.onText(text); }
      };
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        let part;
        try { part = await reader.read(); }
        catch (e) {
          if (e && e.name === 'AbortError') throw e;
          // 답이 오다가 연결이 끊김: 받은 데까지는 보여 준다
          d.cut = String((e && e.message) || e).slice(0, 80);
          cut = true;
          break;
        }
        if (part.done) break;
        buf += dec.decode(part.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          take(line);
        }
      }
      if (!cut) take(buf.trim()); // 줄바꿈 없이 끝난 마지막 줄
      if (!text.trim()) throw fail(cut ? 'server' : 'empty', { diag: done() }); // 한 글자도 못 받음
      return { text, left, unlimited, cut, diag: done() };
    },
  };
  const useRemote = !!AI_ENDPOINT && location.origin === AI_HOME;
  const provider = () => window.AIMock || (useRemote ? remote : null);
  if (!provider()) return; // 서버 주소가 없으면 여기서 끝: 단추도 창도 만들지 않는다

  /* ---------- 저장 ---------- */
  // 말 하나: { id, role: 'user'|'ai', text, cards?, plan?, stats?, nav?, note?, error?, photo?, img?, read? }
  //  photo·img: 사진을 붙인 질문과 그 작은 그림(최근 PHOTO.keepThumbs장만 남긴다), read: 세컨드가 그 사진에서 읽은 글
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
    let n = 0;
    const thin = (m) => { const c = Object.assign({}, m); delete c.img; return c; };
    const msgs = S.msgs.filter((m) => !m.pending).slice(-KEEP).reverse().map((m) => (m.img && ++n > PHOTO.keepThumbs ? thin(m) : m)).reverse();
    const put = (list) => localStorage.setItem(KEY, JSON.stringify({ v: 1, msgs: list, deck: S.deck, left: S.left, leftAt: S.leftAt }));
    try { put(msgs); } catch (e) {
      try { put(msgs.map((m) => (m.img ? thin(m) : m))); } catch (err) { /* 저장이 막힌 환경: 이번 동안만 보인다 */ } // 저장 공간이 꽉 차면 작은 그림 없이
    }
  }
  let seq = 0;
  const newId = () => 'm' + Date.now().toString(36) + (seq++).toString(36);
  const find = (id) => S.msgs.find((m) => m.id === id);

  /* ---------- 화면 만들기 ---------- */
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ai-fab';
  fab.id = 'ai-fab';
  fab.dataset.feature = 'ai'; // 기능과 탭 편집에서 끌 수 있다 (js/features.js)
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
      '<div class="ai-pmenu" id="ai-pmenu" hidden>' +
        `<button type="button" class="ai-pm" data-pick="album">${ICON.album}<span>앨범에서 고르기</span></button>` +
        `<button type="button" class="ai-pm" data-pick="camera">${ICON.camera}<span>사진 찍기</span></button>` +
        `<p class="ai-note">${ICON.lock}<span>사진은 답을 만드는 데만 쓰고, 서버에는 남기지 않아요.</span></p>` +
      '</div>' +
      '<div class="ai-att" id="ai-att" hidden></div>' +
      '<form class="ai-form" id="ai-form" novalidate>' +
        `<button type="button" class="ai-photo" id="ai-photo" aria-label="사진 보내기" aria-expanded="false" aria-controls="ai-pmenu" hidden>${ICON.camera}</button>` +
        `<textarea id="ai-input" rows="1" maxlength="2000" placeholder="모르는 표현을 묻거나 할 일을 말해 보세요" aria-label="${esc(NAME)}에게 보낼 말"></textarea>` +
        `<button type="submit" class="ai-send" id="ai-send" aria-label="보내기">${ICON.send}</button>` +
      '</form>' +
      `<p class="ai-foot">${esc(provider().note || 'AI의 답은 틀릴 수 있어요. 기록은 확인한 뒤에만 바뀌어요.')}</p>` +
      '<input type="file" id="ai-file" accept="image/*" hidden tabindex="-1" aria-hidden="true">' +
      '<input type="file" id="ai-cam" accept="image/*" capture="environment" hidden tabindex="-1" aria-hidden="true">' +
    '</section>';
  document.body.appendChild(fab);
  document.body.appendChild(back);
  $('.ai-sheet', back).tabIndex = -1;
  const sheet = $('.ai-sheet', back), log = $('#ai-log', back), form = $('#ai-form', back), input = $('#ai-input', back), sendBtn = $('#ai-send', back);
  const photoBtn = $('#ai-photo', back), pmenu = $('#ai-pmenu', back), attBox = $('#ai-att', back);
  const PLACEHOLDER = input.placeholder;

  // 가로로 눕힌 폰(높이가 낮은 터치 화면)도 폰처럼 아래 시트 + 자판 높이 맞추기
  const isPhone = () => matchMedia('(max-width: 720px), (max-height: 520px) and (pointer: coarse)').matches;
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
      (photoOn() ? '<p class="ai-eg-h">사진으로 묻기</p>' +
        [['교과서 사진을 찍고 “해석해 줘”', '해석해 줘'], ['단어장 사진을 보내고 “카드로 만들어 줘”', '카드로 만들어 줘']]
          .map(([t, q]) => `<button type="button" class="ai-eg" data-photo-eg="${esc(q)}">${esc(t)}</button>`).join('') : '') +
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
      '<div class="ai-card-act" data-feature="stats"><button type="button" class="btn link" data-ai-go="stats">통계에서 보기</button></div></div>';
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
    return '<div class="ai-card ai-cards" data-feature="review">' +
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
    closed: 'AI 도우미는 지금 먼저 써 보는 중이라 곧 열려요.',
    offline: '인터넷에 연결되지 않아 답을 받지 못했어요.',
    server: 'AI가 지금 답하지 못했어요. 잠시 뒤에 다시 해 주세요.',
    empty: 'AI가 빈 답을 보냈어요. 다시 보내 주세요.',
    bad: '보낸 글이 너무 길어서 AI가 받지 못했어요. 질문을 줄이거나 새 대화를 시작해 주세요.',
    photo: '사진 보내기는 지금 먼저 써 보는 중이라 곧 열려요. 글로 물어봐 주세요.',
  };
  // 문제가 생겼을 때 '자세히'에 보여 줄 글: 서버와 모델이 어떻게 답했는지 (고칠 때 이 글을 보고 까닭을 찾는다)
  function diagText(d, raw) {
    if (!d) return '';
    const bits = [];
    if (d.status) bits.push('응답 ' + d.status + (d.mode ? ' ' + d.mode : ''));
    bits.push(`조각 ${d.n}`, `글 ${d.chars}자`);
    if (d.think) bits.push(`생각 ${d.think}자`);
    if (d.finish) bits.push('끝 ' + d.finish);
    if (d.usage) bits.push(`쓴 양 ${d.usage.out}` + (d.usage.think ? `(생각 ${d.usage.think})` : ''));
    bits.push((d.ms / 1000).toFixed(1) + '초');
    if (d.cut) bits.push('끊김 ' + d.cut);
    if (d.detail) bits.push(d.detail);
    const tail = String(raw || '').replace(/\s+/g, ' ').trim().slice(-140);
    return bits.join(' · ') + (tail ? '\n끝부분: ' + tail : '');
  }
  function errorHTML(m) {
    const code = m.error === 'limit' && m.scope === 'all' ? 'limit-all' : m.error;
    const retry = code === 'offline' || code === 'server' || code === 'empty' || !ERR[code];
    return `<div class="ai-card ai-err"><p>${esc(ERR[code] || ERR.server)}</p><div class="ai-card-act">` +
      (code === 'login' ? '<button type="button" class="btn primary" data-ai-go="account">로그인하러 가기</button>' : '') +
      (retry ? '<button type="button" class="btn primary" data-retry>다시 보내기</button>' : '') +
      '<button type="button" class="btn" data-copy-q>질문 복사</button></div></div>';
  }

  function msgHTML(m) {
    if (m.role === 'user') {
      const shot = !m.photo ? '' : /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(m.img || '')
        ? `<img class="ai-shot" src="${m.img}" alt="보낸 사진">` : `<span class="ai-shot gone">${ICON.album}사진</span>`; // 오래된 사진은 작은 그림을 지웠다
      return `<div class="ai-msg me" data-id="${esc(m.id)}">${shot}<div class="ai-bubble">${lines(m.text)}</div></div>`;
    }
    let h = `<div class="ai-msg ai" data-id="${esc(m.id)}">`;
    if (m.read) h += `<details class="ai-read"><summary>사진에서 읽은 글</summary><p>${lines(m.read)}</p></details>`;
    if (m.pending) h += `<div class="ai-text">${m.text ? Core.md(m.text) : ''}</div><p class="ai-typing" aria-label="답을 쓰는 중"><i></i><i></i><i></i></p>`;
    else if (m.text) h += `<div class="ai-text">${Core.md(m.text)}</div>`;
    if (m.stopped) h += '<p class="ai-state">여기서 멈췄어요.</p>';
    if (m.error) h += errorHTML(m);
    (m.stats || []).forEach((d) => { h += statsHTML(d); });
    if (m.plan) h += planHTML(m);
    if (m.note && m.note.length) h += `<p class="ai-rej">${m.note.map(esc).join('<br>')}</p>`;
    if (m.diag) h += `<details class="ai-diag"><summary>자세히</summary><p>${lines(m.diag)}</p></details>`;
    if (m.nav) h += `<div class="ai-card-act"><button type="button" class="btn primary" data-ai-go="${esc(m.nav.view)}"${m.nav.date ? ` data-date="${esc(m.nav.date)}"` : ''}>${esc(Core.VIEWS[m.nav.view] || '화면')} 열기</button></div>`;
    if (m.cards && m.cards.length) h += cardsHTML(m);
    return h + '</div>';
  }

  const nearEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toEnd = () => { log.scrollTop = log.scrollHeight; };
  // 새 대화 단추는 지울 대화가 있을 때만 보인다 (비어 있을 때 눌러도 아무 일이 없어 고장처럼 보였다)
  const renderNew = () => { $('#ai-new', back).hidden = !S.msgs.length; };
  function renderAll() {
    log.innerHTML = S.msgs.length ? S.msgs.map(msgHTML).join('') : emptyHTML();
    renderNew();
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
    const today = quotaDay(S.leftAt) === quotaDay(Date.now());
    $('#ai-left', back).textContent = today && S.left === 'unlimited' ? '횟수 제한 없음'
      : today && typeof S.left === 'number' ? `오늘 ${Math.max(0, S.left)}번 남음` : 'AI 도우미';
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
    showMenu(false);
    back.classList.remove('in');
    document.body.classList.remove('ai-open');
    fab.setAttribute('aria-expanded', 'false');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { back.hidden = true; }, 200);
    if (lastFocus && document.contains(lastFocus) && back.contains(document.activeElement)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
  }
  fab.addEventListener('click', () => (back.hidden || !back.classList.contains('in') ? open() : close()));

  /* ---------- 먼저 써 보기: 서버가 열어 준 사람에게만 단추를 보인다 ---------- */
  // 서버에 GET /me로 묻는다(횟수를 쓰지 않는다). 답은 이 기기에 기억해 두어 다음에 열 때 바로 쓰고, 로그인이 바뀌면 다시 묻는다.
  // 가짜 AI(미리 보기·테스트)는 서버가 없으니 묻지 않고 언제나 보인다
  const gated = () => !window.AIMock;
  let gate = { open: false, uid: '', at: 0, photo: false };
  let gateSeq = 0;
  let asking = null; // 지금 서버에 묻고 있는 계정 ('' = 로그인 안 함). 같은 계정으로 겹쳐 묻지 않는다
  function showFab() {
    const on = !gated() || gate.open;
    fab.hidden = !on;
    if (!on && !back.hidden) close();
  }
  // 기능과 탭 편집에서 세컨드를 끄면 (다른 기기에서 꺼도) 열려 있던 창도 닫는다. 단추는 data-feature로 숨는다
  if (window.Features) window.Features.onChange(() => { if (!window.Features.on('ai') && !back.hidden) close(); });
  async function checkGate(force) {
    if (!gated()) return;
    const user = window.Cloud && window.Cloud.user;
    const uid = user ? user.uid : '';
    if (!force && (asking === uid || (gate.uid === uid && Date.now() - gate.at < GATE_FRESH))) return;
    const my = ++gateSeq;
    asking = uid;
    let j = null;
    try {
      const headers = {};
      if (user) headers.Authorization = 'Bearer ' + await user.getIdToken();
      const res = await fetch(AI_ENDPOINT.replace(/\/+$/, '') + '/me', { headers });
      if (res.ok) j = await res.json();
    } catch (e) { /* 인터넷이 없으면 기억해 둔 답을 그대로 쓴다 */ }
    if (my !== gateSeq) return; // 그사이 로그인이 바뀌어 새로 물었다
    asking = null;
    if (!j) return; // 답을 못 받음
    gate = { open: j.open === true, uid, at: Date.now(), photo: j.photo === true };
    try { localStorage.setItem(GATE_KEY, JSON.stringify(gate)); } catch (e) { /* 저장이 막힌 환경 */ }
    if (j.unlimited === true) { S.left = 'unlimited'; S.leftAt = Date.now(); }
    else if (typeof j.left === 'number') { S.left = j.left; S.leftAt = Date.now(); }
    else if (S.left === 'unlimited') S.left = null; // 다른 계정으로 바뀜
    save();
    showFab();
    renderLeft();
    renderPhoto();
  }
  if (gated()) {
    try {
      const saved = JSON.parse(localStorage.getItem(GATE_KEY) || 'null');
      if (saved && typeof saved.open === 'boolean') gate = { open: saved.open, uid: String(saved.uid || ''), at: Number(saved.at) || 0, photo: saved.photo === true };
    } catch (e) { /* 읽지 못하면 닫힌 것으로 */ }
    window.addEventListener('cloud-user', () => checkGate(false)); // 로그인·로그아웃 (js/cloud.js가 알린다). 계정이 그대로이고 방금 물었으면 다시 묻지 않는다
    window.addEventListener('online', () => checkGate(false));
    const start = () => {
      // 전에 로그인했던 기기면 로그인이 이어진 뒤(cloud-user)에 묻는다: 그 전에 물으면 로그인 안 한 사람으로 답이 온다
      const c = window.Cloud;
      if (!c || !c.meta || !c.meta.uid || c.user) checkGate(false);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
  showFab();
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
    Object.keys(photos).forEach((k) => delete photos[k]);
    save();
    renderAll();
    sheet.focus({ preventScroll: true }); // 단추가 숨으니 초점은 창으로
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
    if (!text && !att) return;
    input.value = '';
    grow();
    sendWithPhoto(text);
  });
  // 붙여 둔 사진이 있으면 같이 보내고 사진 줄을 비운다
  function sendWithPhoto(text) {
    const photo = att;
    att = null;
    renderAtt();
    showMenu(false);
    send(text || (photo ? PHOTO_ASK : ''), photo);
  }

  /* ---------- 사진 ---------- */
  // 사진 보내기를 쓸 수 있는지: 서버가 열어 준 계정(GET /me의 photo). 가짜 AI는 photo: false라고 하지 않으면 쓸 수 있다
  const photoOn = () => (gated() ? gate.photo === true : !!window.AIMock && window.AIMock.photo !== false);
  let att = null; // 보내려고 붙여 둔 사진 { full, thumb } (data: 주소)
  const photos = {}; // 이번에 연 동안만: { [질문 id]: 보낸 사진 } — 다시 보내기에 쓴다. 기기에 저장하지 않는다
  function renderPhoto() {
    const on = photoOn();
    photoBtn.hidden = !on;
    form.classList.toggle('with-photo', on);
    input.placeholder = on ? (att ? '사진에 대해 물어보세요' : '물어보거나 시켜 보세요') : PLACEHOLDER;
    if (!on) { att = null; showMenu(false); renderAtt(); }
    // 빈 화면 예시에 '사진으로 묻기'가 생기거나 사라진다
    if (!S.msgs.length && !back.hidden) log.innerHTML = emptyHTML();
  }
  function showMenu(on) {
    pmenu.hidden = !on;
    photoBtn.classList.toggle('on', on);
    photoBtn.setAttribute('aria-expanded', String(on));
    if (on) {
      // 넓은 화면(마우스)은 찍기가 없으니 '사진 고르기' 하나만
      const cam = $('[data-pick="camera"]', pmenu);
      cam.hidden = fine() && !matchMedia('(pointer: coarse)').matches;
      $('[data-pick="album"] span', pmenu).textContent = cam.hidden ? '사진 고르기' : '앨범에서 고르기';
    }
  }
  function renderAtt() {
    attBox.hidden = !att;
    attBox.innerHTML = att
      ? `<div class="ai-att-th"><img src="${att.thumb}" alt="보낼 사진"><button type="button" class="ai-att-x" data-att-x aria-label="사진 빼기">${ICON.x}</button></div>` +
        '<div class="ai-chips">' + PHOTO_CHIPS.map((t) => `<button type="button" class="chip" data-chip="${esc(t)}">${esc(t)}</button>`).join('') + '</div>'
      : '';
    if (photoOn()) input.placeholder = att ? '사진에 대해 물어보세요' : '물어보거나 시켜 보세요';
  }
  // 사진을 다시 그려서 줄인다: 캔버스로 다시 그리면 찍은 장소·기기 같은 사진 속 정보(EXIF)가 남지 않는다.
  // 폰 사진의 돌림 정보는 브라우저가 그림을 읽을 때 반영한다. 투명한 곳은 흰색으로
  function draw(img, max, q) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  }
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      if (!(img.naturalWidth > 0)) throw new Error('empty');
      let full = draw(img, PHOTO.max, 0.85);
      if (full.length > PHOTO.chars) full = draw(img, PHOTO.small, 0.72); // 아주 복잡한 사진
      if (full.length > PHOTO.chars) throw new Error('big');
      return { full, thumb: draw(img, PHOTO.thumb, 0.7) };
    } finally { URL.revokeObjectURL(url); }
  }
  async function takeFile(file) {
    if (!file || !photoOn()) return;
    if (!/^image\//.test(file.type || '')) return toast('사진 파일만 보낼 수 있어요');
    if (file.size > PHOTO.file) return toast('사진이 너무 커요. 다른 사진을 골라 주세요');
    showMenu(false);
    try { att = await shrink(file); }
    catch (e) { att = null; toast('사진을 열지 못했어요. 다른 사진을 골라 주세요'); }
    renderAtt();
    if (att && fine()) input.focus({ preventScroll: true });
  }
  photoBtn.addEventListener('click', () => showMenu(pmenu.hidden));
  pmenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) $(b.dataset.pick === 'camera' ? '#ai-cam' : '#ai-file', back).click();
  });
  ['#ai-file', '#ai-cam'].forEach((sel) => {
    const f = $(sel, back);
    f.addEventListener('change', () => { const file = f.files && f.files[0]; f.value = ''; takeFile(file); });
  });
  attBox.addEventListener('click', (e) => {
    if (e.target.closest('[data-att-x]')) { att = null; renderAtt(); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip && !busy) { const typed = input.value.trim(); input.value = ''; grow(); sendWithPhoto(typed ? typed + ' ' + chip.dataset.chip : chip.dataset.chip); }
  });
  // 넓은 화면: 복사한 사진을 입력 칸에 붙여 넣어도 된다
  input.addEventListener('paste', (e) => {
    const items = (e.clipboardData && e.clipboardData.files) || [];
    const file = [...items].find((f) => /^image\//.test(f.type));
    if (file && photoOn()) { e.preventDefault(); takeFile(file); }
  });
  renderPhoto();

  // 지난 대화: AI의 답에는 그때 낸 제안과 그 뒤에 어떻게 됐는지를 붙인다 ("그거 7시로 바꿔 줘"를 알아듣게)
  const PLAN_WORD = { ready: '아직 적용 안 함', expired: '적용 안 함', cancelled: '취소함', applied: '적용함', undone: '적용했다가 되돌림' };
  function historyFor() {
    return S.msgs.filter((m) => !m.pending && !m.error).map((m) => {
      if (m.role !== 'ai') return { role: 'user', text: m.text, photo: !!m.photo };
      const bits = [m.text];
      if (m.plan && m.plan.lines) {
        const off = m.plan.state === 'applied' ? m.plan.off || [] : [];
        const ls = m.plan.lines.filter((l, i) => !off.includes(i)).map((l) => l.line + (l.sub ? ' (' + l.sub + ')' : ''));
        if (ls.length) bits.push(`[앱 기록: 이때 낸 제안 ${PLAN_WORD[m.plan.state] || ''} — ${ls.join(' / ')}]`);
      }
      if (m.cards && m.cards.length) bits.push('[앱 기록: 카드 후보 ' + m.cards.map((c) => c.front).join(', ') + ']');
      return { role: 'assistant', text: bits.filter(Boolean).join('\n'), read: m.read || '' };
    }).filter((m) => m.text);
  }

  // photo: { full, thumb } 이번 질문에 붙이는 사진 (없으면 글만)
  async function send(text, photo) {
    const p = provider();
    if (!p || busy) return;
    if (photo && !photoOn()) photo = null;
    const hist = historyFor();
    const mine = { id: newId(), role: 'user', text };
    if (photo) { mine.photo = true; mine.img = photo.thumb; photos[mine.id] = photo; }
    const m = { id: newId(), role: 'ai', text: '', pending: true };
    if (!S.msgs.length) log.innerHTML = '';
    S.msgs.push(mine, m);
    renderNew();
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
        const vis = Core.visibleText(raw);
        el.innerHTML = vis ? Core.md(vis) : photo && /<read\b/i.test(raw) ? '<p class="ai-state">사진을 읽고 있어요…</p>' : '';
        if (follow) toEnd();
      });
    };
    try {
      // 앱 정보가 필요 없어 보이는 말은 짧게 보낸다. AI가 '앱 정보가 필요하다'고 답하면 그때 붙여서 다시 보낸다
      // 사진은 이번 질문(마지막 말)에만 붙인다: [사진, 글]
      const build = (app) => {
        const list = Core.messages(text, ctx, hist, app, { photo: !!photo });
        if (photo) { const q = list[list.length - 1]; q.content = [{ type: 'image_url', image_url: { url: photo.full } }, { type: 'text', text: q.content }]; }
        return list;
      };
      // 바로 앞 답이 사진을 읽은 것이면 '카드로 만들어 줘'도 그 사진 이야기다 (앱 정보 없이 카드 후보로)
      let withApp = Core.needsApp(text, !!photo || hist.slice(-1).some((h) => h.read));
      let out = await p.ask(build(withApp), { signal: ctrl.signal, onText });
      let r = Core.parseReply(out.text);
      if (r.needApp && !withApp) {
        raw = '';
        out = await p.ask(build(true), { signal: ctrl.signal, onText, again: true });
        r = Core.parseReply(out.text);
      }
      if (out.unlimited) { S.left = 'unlimited'; S.leftAt = Date.now(); }
      else if (typeof out.left === 'number') { S.left = out.left; S.leftAt = Date.now(); }
      finish(m, r, ctx, out);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        m.text = Core.parseReply(Core.visibleText(raw)).text;
        if (m.text) m.stopped = true;
        else { S.msgs = S.msgs.filter((x) => x !== m); }
      } else {
        m.text = '';
        m.error = (e && e.aiCode) || 'server';
        if (e && e.scope) m.scope = e.scope;
        if (e && e.diag) m.diag = diagText(e.diag, raw);
        else if (e && !e.aiCode) m.diag = String(e.message || e).slice(0, 200); // 앱 안에서 난 오류
        m.q = text;
        if (m.error === 'photo') { gate.at = 0; checkGate(true); } // 서버가 사진을 닫았다: 단추를 다시 맞춘다
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
  function finish(m, r, ctx, out) {
    out = out || {};
    const d = out.diag;
    m.text = r.text;
    if (r.read) m.read = r.read;
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
    }
    // 답이 온전히 오지 않았으면 알린다
    const long = d && d.finish === 'length';
    const odd = r.partial ? '답이 중간에 끊겨서 읽은 데까지만 보여 드려요. 빠진 것이 있으면 한 번 더 말해 주세요.'
      : r.broken ? (long ? '답이 길어서 제안이 끝까지 오지 못했어요. 나눠서 한 번 더 말해 주세요.' : '제안을 읽지 못했어요. 한 번 더 말해 주세요.')
      : out.cut ? '답이 오는 중에 연결이 끊겼어요. 다시 보내면 끝까지 받을 수 있어요.'
      : long ? '답이 길어서 끝까지 오지 못했어요. 나눠서 물어보면 끝까지 받을 수 있어요.' : '';
    if (odd) {
      if (m.plan) m.plan.rejected = (m.plan.rejected || []).concat(odd); else m.note = (m.note || []).concat(odd);
      if (d) m.diag = diagText(d, out.text);
    }
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
    const peg = t.closest('[data-photo-eg]');
    if (peg) { input.value = peg.dataset.photoEg; grow(); showMenu(true); return; }
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
      const asked = withQ ? S.msgs[i - 1] : null, photo = asked && asked.photo ? photos[asked.id] : null;
      S.msgs.splice(withQ ? i - 1 : i, withQ ? 2 : 1);
      renderAll();
      if (asked && asked.photo && !photo) {
        // 앱을 다시 열어서 보낸 사진이 없다: 질문을 입력 칸에 되돌리고 사진을 다시 고르게 한다
        input.value = q === PHOTO_ASK ? '' : q;
        grow();
        save();
        showMenu(true);
        return toast('사진을 다시 골라 주세요');
      }
      if (q) send(q, photo);
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
    clear() { if (busy) stop(); S.msgs = []; S.deck = ''; att = null; renderAtt(); Object.keys(live).forEach((k) => delete live[k]); Object.keys(photos).forEach((k) => delete photos[k]); save(); if (!back.hidden) renderAll(); },
    get photoOn() { return photoOn(); },
  };
})();
