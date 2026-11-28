/* 링크로 플래시카드 가져오기
 * 사진 속 단어를 Claude 같은 도우미가 읽고, 이 앱 주소 뒤에 카드를 붙인 링크를 만들어 준다.
 * 링크를 누르면 앱이 열리면서 '카드 N장을 추가할까요?' 창이 뜨고, 확인하면 고른 덱에 들어간다.
 * 서버도 열쇠도 없이 주소(#뒤, 서버로 가지 않는 부분)만으로 카드를 건넨다.
 *
 * 형식 (자세히: README '링크로 카드 가져오기')
 *  1) 글자 그대로 (사람·AI가 손으로 써도 틀리지 않게)
 *     https://mjleo6278-thecreater.github.io/studypromotion/#cards&deck=스페인어+1과&c=hola~안녕&c=adiós~잘+가
 *     - c 하나가 카드 한 장: 앞면~뒷면 (첫 번째 ~에서 나눈다). deck(덱 이름)은 없어도 된다.
 *     - 띄어쓰기는 + (또는 %20). 글자로 쓰려면 바꿔 적을 것: + %2B, & %26, # %23, % %25, ~ %7E, ( %28, ) %29
 *     - 한글·악센트(á ñ ¿)·쉼표·물음표 같은 나머지 글자는 그대로 쓴다.
 *  2) 압축 (아주 긴 목록을 프로그램으로 만들 때)
 *     …/studypromotion/#cards&z=<base64url( deflate-raw( UTF-8 JSON {"deck":"…","cards":[["앞","뒤"],…]} ) )>
 */
(function (root) {
  const HOME = 'https://mjleo6278-thecreater.github.io/studypromotion/';
  const LIMIT = { cards: 1000, front: 300, back: 500, deck: 40 }; // 앞·뒤 길이는 카드 고치기 칸과 같게

  const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
  const sameKey = (f, b) => clean(f, LIMIT.front).toLowerCase() + '\u0000' + clean(b, LIMIT.back).toLowerCase();

  // 이 앱에 카드를 건네는 주소인가 (#cards, #cards&… )
  function isLink(hash) { return /^#?cards(&|$)/.test(String(hash || '')); }

  // 주소 글자 풀기: + → 빈칸, %XX → 글자. 잘못된 %는 그대로 둔다 ('50%' 같은 손으로 쓴 글)
  function decodePart(s) {
    s = String(s).replace(/\+/g, ' ');
    try { return decodeURIComponent(s); } catch (e) { /* 아래에서 조각마다 */ }
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (run) => { try { return decodeURIComponent(run); } catch (e) { return run; } });
  }

  // 'hola~안녕' → ['hola', '안녕']. 풀기 전의 글자에서 첫 ~로 나눈다 (%7E로 적은 ~는 글자로 남는다)
  // 그런 ~가 없으면 (어딘가에서 ~까지 %7E로 바꿔 버린 링크) 풀어 놓은 첫 ~, 그것도 없으면 ' - '나 탭으로 나눠 본다 (너그럽게)
  function splitCard(raw) {
    const i = raw.indexOf('~');
    if (i >= 0) return [decodePart(raw.slice(0, i)), decodePart(raw.slice(i + 1))];
    const v = decodePart(raw);
    const m = /~|\t|\s+[-–—]\s+/.exec(v);
    return m ? [v.slice(0, m.index), v.slice(m.index + m[0].length)] : null;
  }

  // '#cards&deck=…&c=…' → [[이름, 풀기 전 값], …]
  function fields(hash) {
    return String(hash || '').replace(/^#/, '').split('&').map((seg) => {
      const i = seg.indexOf('=');
      return i < 0 ? [decodePart(seg), ''] : [decodePart(seg.slice(0, i)), seg.slice(i + 1)];
    });
  }

  // 읽은 카드를 다듬는다: 빈 칸·너무 긴 글·링크 안에서 겹친 카드를 정리
  function tidy(deck, list, bad) {
    const cards = [], seen = new Set();
    let dup = 0, over = 0;
    list.forEach((p) => {
      const f = clean(p && p[0], LIMIT.front), b = clean(p && p[1], LIMIT.back);
      if (!f || !b) { bad++; return; }
      const k = sameKey(f, b);
      if (seen.has(k)) { dup++; return; }
      if (cards.length >= LIMIT.cards) { over++; return; }
      seen.add(k);
      cards.push([f, b]);
    });
    return { deck: clean(deck, LIMIT.deck), cards, bad, dup, over };
  }

  function b64urlBytes(s) {
    const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '') + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function pipe(bytes, stream) {
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(buf);
  }

  // 주소의 # 뒷부분 → { deck, cards: [[앞, 뒤], …], bad(읽지 못한 칸), dup(겹친 카드), over(너무 많아 뺀 카드) }
  async function read(hash) {
    const fs = fields(hash);
    const get = (k) => { const f = fs.find((x) => x[0] === k); return f ? f[1] : null; };
    const z = get('z');
    if (z) {
      if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축한 카드 링크를 열지 못해요. 브라우저를 업데이트해 주세요.');
      let data;
      try { data = JSON.parse(new TextDecoder().decode(await pipe(b64urlBytes(z), new DecompressionStream('deflate-raw')))); }
      catch (e) { throw new Error('링크가 중간에 잘렸거나 망가졌어요. 링크를 다시 받아 주세요.'); }
      const list = Array.isArray(data && data.cards) ? data.cards : [];
      return tidy(data && data.deck, list.map((c) => (Array.isArray(c) ? c : c && [c.front, c.back])), 0);
    }
    let bad = 0;
    const list = [];
    fs.forEach(([k, v]) => {
      if (k !== 'c') return;
      const p = splitCard(v);
      if (p) list.push(p); else if (decodePart(v).trim()) bad++;
    });
    const deck = get('deck');
    return tidy(deck == null ? '' : decodePart(deck), list, bad);
  }

  // 링크 만들기 (테스트·도구용). 바꿔 적어야 하는 글자만 %로, 나머지는 그대로 둔다
  function enc(s) {
    return clean(s, 100000)
      .replace(/[%&#+~()<>"\\[\]^`{|}]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
      .replace(/ /g, '+');
  }
  function build(data, base) {
    return (base || HOME) + '#cards' + (data.deck ? '&deck=' + enc(data.deck) : '') +
      (data.cards || []).map((c) => '&c=' + enc(c[0]) + '~' + enc(c[1])).join('');
  }
  async function buildZip(data, base) {
    const json = JSON.stringify({ deck: data.deck || '', cards: data.cards || [] });
    return (base || HOME) + '#cards&z=' + bytesB64url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
  }

  // 채팅으로 받은 단어장(js/chatattach.js) → read()와 같은 모양 { deck, cards, bad, dup, over }
  const prepare = (deck, cards) => tidy(deck, Array.isArray(cards) ? cards : [], 0);
  const api = { isLink, read, build, buildZip, enc, decodePart, sameKey, prepare, LIMIT, HOME };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.CardLink = api;

  /* ---------- 앱에서: 링크를 받아 확인 창 띄우기 ---------- */
  const PENDING = 'studypromotion.cardLink'; // 새 버전으로 바뀌며 다시 열려도 링크를 잃지 않게 잠시 맡겨 둔다
  let memPending = null;
  const getPending = () => { try { return sessionStorage.getItem(PENDING) || memPending; } catch (e) { return memPending; } };
  const setPending = (v) => { memPending = v; try { if (v) sessionStorage.setItem(PENDING, v); else sessionStorage.removeItem(PENDING); } catch (e) { /* 무시 */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // app.js가 시작할 때와 주소가 바뀔 때 부른다. 카드 링크면 맡겨 두고 주소를 #review로 바꾼 뒤 true
  function take(hash) {
    if (!isLink(hash)) return false;
    setPending(String(hash));
    try { history.replaceState(history.state, '', location.pathname + location.search + '#review'); } catch (e) { /* 무시 */ }
    schedule();
    return true;
  }

  // 시작 화면·잠금 화면·다른 창이 없어지고, 계정 기록과 맞추기가 끝나면 (길어야 8초) 창을 연다
  let waiting = false;
  async function schedule() {
    if (waiting) return;
    waiting = true;
    const t0 = Date.now();
    const free = () => root.App && root.UI && document.readyState !== 'loading' && !document.getElementById('splash') &&
      !(root.Lock && root.Lock.state) && document.getElementById('ask').hidden && !document.querySelector('.ui-back:not(.out)');
    const cloudBusy = () => root.Cloud && root.Cloud.syncing && Date.now() - t0 < 8000;
    while (!free() || cloudBusy()) await sleep(250);
    waiting = false;
    run();
  }

  const norm = (s) => clean(s, 100).toLowerCase();
  const shortDate = () => { const d = new Date(); return `${d.getMonth() + 1}/${d.getDate()}`; };

  function confirmSheet(data) {
    const { esc, store } = root.App;
    const decks = store.get().decks;
    const name0 = data.deck || `가져온 카드 ${shortDate()}`;
    const same = decks.find((d) => norm(d.name) === norm(name0));
    let pick = same ? same.id : ''; // '' = 새 덱
    const signedIn = !!(root.Cloud && root.Cloud.meta && root.Cloud.meta.uid);
    const notes = [];
    if (data.bad) notes.push(`형식이 맞지 않는 ${data.bad}칸은 뺐어요.`);
    if (data.dup) notes.push(`링크 안에서 겹친 카드 ${data.dup}장은 한 장만 넣어요.`);
    if (data.over) notes.push(`한 번에 ${LIMIT.cards}장까지만 넣어요. 나머지 ${data.over}장은 뺐어요.`);
    const deckOpt = (id, label, hint) => `<button type="button" class="ui-opt cl-deck" data-cl-deck="${esc(id)}" role="radio">` +
      `<span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</span><svg class="ui-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
    const body =
      `<p class="cl-where muted small">${signedIn ? '확인하면 이 기기와 로그인한 계정에 함께 저장돼요.' : '로그인하지 않아 이 기기에만 저장돼요. 계정에도 넣으려면 먼저 로그인해 주세요.'}</p>` +
      (notes.length ? `<p class="cl-note small">${esc(notes.join(' '))}</p>` : '') +
      '<p class="ui-group">넣을 덱</p><div class="ui-opts cl-decks" role="radiogroup" aria-label="넣을 덱">' +
      deckOpt('', '새 덱 만들기') +
      `<label class="cl-name"><input class="cl-name-in" value="${esc(name0)}" maxlength="${LIMIT.deck}" autocomplete="off" aria-label="새 덱 이름"></label>` +
      decks.map((d) => deckOpt(d.id, d.name, `카드 ${store.get().cards.filter((c) => c.deckId === d.id).length}장`)).join('') + '</div>' +
      `<p class="ui-group">카드 ${data.cards.length}장</p><ol class="cl-list">` +
      data.cards.map((c, i) => `<li data-i="${i}"><b>${esc(c[0])}</b><span>${esc(c[1])}</span></li>`).join('') + '</ol>' +
      '<div class="cl-foot"><button type="button" class="btn" data-cl-cancel>넣지 않기</button><button type="button" class="btn primary" data-cl-ok></button></div>';

    let box = null; // 이 창 (닫히는 중인 앞 창이 잠깐 남아 있어도 헷갈리지 않게 이 안에서만 찾는다)
    const paint = () => {
      box.querySelectorAll('[data-cl-deck]').forEach((b) => {
        const on = b.dataset.clDeck === pick;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      box.querySelector('.cl-name').hidden = pick !== '';
      const have = pick ? new Set(store.get().cards.filter((c) => c.deckId === pick).map((c) => sameKey(c.front, c.back))) : null;
      let n = 0;
      box.querySelectorAll('.cl-list li').forEach((li) => {
        const c = data.cards[+li.dataset.i];
        const dup = !!(have && have.has(sameKey(c[0], c[1])));
        li.classList.toggle('dup', dup);
        if (!dup) n++;
      });
      const ok = box.querySelector('[data-cl-ok]');
      ok.textContent = n ? `카드 ${n}장 추가` : '모두 이미 있는 카드예요';
      ok.disabled = !n;
      const dupN = data.cards.length - n;
      let hint = box.querySelector('.cl-dup');
      if (!hint) { hint = document.createElement('p'); hint.className = 'cl-dup small'; box.querySelector('.cl-foot').before(hint); }
      hint.textContent = dupN ? `이 덱에 이미 있는 카드 ${dupN}장은 빼고 넣어요.` : '';
      hint.hidden = !dupN;
    };

    const result = root.UI.openSheet({
      title: `카드 ${data.cards.length}장을 추가할까요?`, body, cls: 'ui-cardlink', focusSel: '[data-cl-ok]',
      onClick: (e, close) => {
        const d = e.target.closest('[data-cl-deck]');
        if (d) { pick = d.dataset.clDeck; paint(); if (!pick) box.querySelector('.cl-name-in').focus(); return; }
        if (e.target.closest('[data-cl-cancel]')) return close(null);
        const ok = e.target.closest('[data-cl-ok]');
        if (ok && !ok.disabled) close({ deckId: pick, name: clean(box.querySelector('.cl-name-in').value, LIMIT.deck) || name0 });
      },
      onKey: (e) => {
        if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('cl-name-in') && !e.isComposing) { e.preventDefault(); box.querySelector('[data-cl-ok]').click(); }
      },
    });
    box = document.querySelector('.ui-back:not(.out) .ui-cardlink');
    paint();
    return result;
  }

  // 계정과 맞추는 중이면 끝날 때까지 잠깐 기다렸다가 넣는다 (받아 온 계정 기록이 방금 넣은 카드를 덮지 않게)
  async function settle() {
    for (let i = 0; i < 32 && root.Cloud && root.Cloud.syncing; i++) await sleep(250);
  }

  // 같은 덱에 이미 있는 카드(앞·뒤가 같으면)는 빼고 넣는다. 같은 링크를 두 번 눌러도 한 벌만
  //  o: { open: false 넣은 뒤 복습 화면으로 가지 않음 (채팅에서 담을 때), from 카드가 어디서 왔는지 }
  function apply(data, choice, o) {
    o = o || {};
    const stay = o.open === false;
    const { store, uid, now } = root.App;
    const t = now();
    const added = [];
    let deckId = null, deckName = '', madeDeck = false;
    store.update((st) => {
      let d = choice.deckId ? st.decks.find((x) => x.id === choice.deckId) : null;
      if (!d) { // 새 덱 (고른 덱이 그사이 다른 기기에서 지워졌으면 같은 이름으로 다시 만든다)
        d = { id: uid(), name: (choice.deckId && choice.deckName) || choice.name, createdAt: t };
        st.decks.push(d);
        madeDeck = true;
      }
      deckId = d.id; deckName = d.name;
      const have = new Set(st.cards.filter((c) => c.deckId === d.id).map((c) => sameKey(c.front, c.back)));
      data.cards.forEach(([front, back]) => {
        const k = sameKey(front, back);
        if (have.has(k)) return;
        have.add(k);
        const id = uid();
        added.push(id);
        st.cards.push(root.SRS.newCard({ id, deckId: d.id, front, back, createdAt: t, from: o.from || 'link' }, t));
      });
    });
    if (root.App.openDeck && !stay) root.App.openDeck(deckId);
    root.App.toast(`'${deckName}' 덱에 카드 ${added.length}장을 넣었어요`, {
      action: '되돌리기',
      onAction: () => {
        const ids = new Set(added);
        store.update((st) => {
          st.cards = st.cards.filter((c) => !ids.has(c.id));
          if (madeDeck && !st.cards.some((c) => c.deckId === deckId)) st.decks = st.decks.filter((x) => x.id !== deckId);
        });
        if (madeDeck && root.App.openDeck && !stay) root.App.openDeck(null);
        root.App.toast(stay ? '담은 카드를 뺐어요' : '가져온 카드를 뺐어요');
      },
    });
    return { deckId, added: added.length };
  }

  let running = false;
  async function run() {
    const hash = getPending();
    if (!hash || running) return;
    running = true;
    const done = () => { if (getPending() === hash) setPending(null); }; // 창이 떠 있는 사이 새로 온 링크는 지우지 않는다
    try {
      let data;
      try { data = await read(hash); } catch (e) { done(); root.App.toast(e.message); return; }
      if (!data.cards.length) { done(); root.App.toast('링크에서 카드를 찾지 못했어요. 링크를 다시 받아 주세요.'); return; }
      if (root.AI && root.AI.close) root.AI.close();
      // 복습을 꺼 두었으면 켤지 먼저 묻는다 (켜지 않으면 가져오지 않는다)
      const F = root.Features;
      if (F && !F.on('review')) {
        const yes = await root.App.ask(`링크에 카드 ${data.cards.length}장이 있어요.\n복습이 꺼져 있는데, 켜고 가져올까요?`, { ok: '복습 켜고 가져오기', cancel: '가져오지 않기' });
        if (!yes) { done(); return; }
        F.set('review', true);
      }
      root.App.go('review');
      const choice = await confirmSheet(data);
      done();
      if (!choice) return;
      if (choice.deckId) { const d = root.App.store.get().decks.find((x) => x.id === choice.deckId); choice.deckName = d ? d.name : ''; }
      await settle();
      apply(data, choice);
    } finally {
      running = false;
      if (getPending()) schedule(); // 창을 띄운 사이 다른 링크가 또 왔으면 이어서
    }
  }

  // 새 버전으로 바뀌며 다시 열렸을 때 맡겨 둔 링크를 이어서 처리
  if (getPending()) schedule();

  api.take = take;
  // 채팅의 '내 복습에 담기' (js/chatattach.js): 같은 확인 창과 넣기
  api.confirm = confirmSheet;
  api.apply = apply;
  api.settle = settle;
})(typeof window !== 'undefined' ? window : globalThis);
