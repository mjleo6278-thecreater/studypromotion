/* 그룹 채팅 (v4.1)
 * 같은 그룹 사람끼리 글로 이야기한다. 그룹 화면의 '채팅' 칸을 누르면 채팅 창이 열린다 (탭은 그대로).
 * - 서버: js/group.js와 같은 /group (op chat·say·unsay, 리더의 edit chat). 그룹마다 최근 150개·7일만 남는다.
 * - 새 메시지는 채팅 창이 열려 있을 때만 자주 묻는다 (방금 오갔으면 3초, 1분 넘게 조용하면 8초, 5분 넘으면 20초).
 *   닫혀 있을 때는 그룹 상태를 받을 때 같이 오는 요약(chat: { on, v, nu, tail })으로 '새 메시지 N'을 그린다.
 * - 어디까지 읽었는지(r)와 가린 사람(h)은 이 기기에만 둔다 (studypromotion.groupChat).
 * - 공부하는 동안(스톱워치·집중 타이머·폰 잠금)은 새 메시지 표시를 숨기고, 창을 열면 한 번 묻는다 (settings.groupChatStudy === false면 끔).
 * - 욕설은 보는 사람의 앱에서 ✱✱로 가린다 (settings.groupChatFilter === false면 끔). 링크는 글자로만 보인다.
 * - 읽음 표시·입력 중 표시·앱 밖 알림은 없다.
 * 위쪽(lib)은 node 시험에서도 쓰는 순수 함수, 아래는 브라우저 화면.
 */
(function (root) {
  'use strict';
  const MIN = 60000, DAY = 86400000;
  const QUICK = ['같이 공부하자 ✏️', '10분 쉬고 올게 ☕', '질문 있어 🙋', '오늘 목표 채웠다 ♛', '잘 자 🌙'];
  const LEN = 200, LINES = 8, KEEP = 150, DAYS = 7, UNREAD = 50; // 서버(worker/src/group.js CHAT)와 같은 값
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const pad2 = (n) => String(n).padStart(2, '0');

  // 서버의 cleanMsg와 같은 다듬기: 보이지 않는 글자를 빼고, 빈칸을 하나로, 빈 줄은 두 개까지
  function tidyMsg(v) {
    if (typeof v !== 'string') return '';
    return v.normalize('NFC').replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/[^\S\n]+/g, ' ')
      .split('\n').map((l) => l.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  // 보낼 수 없는 까닭: 'empty' | 'long' | 'lines' | null
  function msgProblem(v) {
    const s = tidyMsg(v);
    if (!s) return 'empty';
    if ([...s].length > LEN) return 'long';
    if (s.split('\n').length > LINES) return 'lines';
    return null;
  }
  const cleanMsg = (v) => (msgProblem(v) ? null : tidyMsg(v));

  /* ---------- 욕설 가리기 ----------
   * 자주 쓰는 심한 욕만. 글자 사이에 점·숫자 같은 것을 끼워 넣어도 찾는다(빈칸은 아님: '3시 발표' 같은 말이 걸리지 않게).
   * 보통 말과 겹치는 것은 넣지 않는다: 씹다, 좇다, 새끼(아기 동물), 미친(듯이), 시발점·시발역 */
  const GAP = '[._\\-~*·,!?0-9ㆍ]{0,2}';
  const spread = (w) => [...w].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(GAP);
  const BAD_WORDS = ['씨발', '씨바', '씨빨', '씨팔', '시팔', '시빨', '쓰발', '씹새', '씹년', '씹창', '씹할', 'ㅅㅂ', 'ㅆㅂ', 'ㅄ', 'ㅂㅅ', 'ㅈㄹ', 'ㅈㄴ',
    '병신', '븅신', '빙신', '좆', '존나', '개새끼', '개새기', '개색기', '개색끼', '개쌔끼', '개쉐이', '미친놈', '미친년', '지랄',
    '느금마', '니애미', '니미럴', '니기미', '엠창', '썅', '쌍놈', '쌍년', '창녀'];
  const BAD_RE = new RegExp(BAD_WORDS.map(spread).concat([
    spread('시발') + '(?![점역])',
    '\\b(?:mother)?fuck\\w*', '\\bshit\\w*', '\\bbitch\\w*', '\\basshole\\w*', '\\bbastard\\w*',
  ]).join('|'), 'gi');
  const maskBad = (t) => String(t == null ? '' : t).replace(BAD_RE, '✱✱');

  /* ---------- 연락처처럼 보이는 글 (보내기 전에 한 번 묻는다) ---------- */
  const CONTACT = [
    /(?:^|\D)(?:\+?82[\s.-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/,          // 휴대폰
    /(?:^|\D)0(?:2|[3-6][1-5]|70)[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/,                     // 집·인터넷 전화
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,                // 이메일
    /(?:카톡|카카오톡|카카오|오픈\s?채팅|인스타|insta(?:gram)?|텔레(?:그램)?|telegram|디코|디스코드|discord|페북|페이스북|facebook|라인|틱톡|tiktok|스냅|snapchat)\s*(?:아이디|id)?\s*[:：]?\s*@?[A-Za-z0-9._-]{3,}/i,
    /open\.kakao\.com|discord\.gg\/|t\.me\//i,                                          // 오픈채팅·초대 링크
    /(?:^|\s)@[A-Za-z0-9._]{4,}/,                                                        // @아이디
  ];
  const looksContact = (t) => CONTACT.some((re) => re.test(String(t || '')));

  // 새 메시지 수: 요약의 nu([번호, 보낸 사람])에서 읽은 번호 뒤의 것, 가린 사람 것은 빼고
  function unreadCount(chat, read, hidden) {
    if (!chat || chat.on === false || !Array.isArray(chat.nu)) return 0;
    let r = Number.isInteger(read) && read > 0 ? read : 0;
    if (Number.isInteger(chat.v) && r > chat.v) r = 0; // 서버 기록이 새로 시작된 경우
    const h = Array.isArray(hidden) ? hidden : [];
    return chat.nu.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && p[0] > r && !h.includes(p[1])).length;
  }
  // 채팅 창이 열려 있을 때 다음에 물을 때까지 (마지막으로 메시지가 오간 뒤 지난 시간에 따라)
  const pollDelay = (idle) => (idle < MIN ? 3000 : idle < 5 * MIN ? 8000 : 20000);

  const okLine = (m) => !!m && typeof m === 'object' && Number.isInteger(m.s) && Number.isInteger(m.v) && Number.isFinite(m.at) && typeof m.f === 'string';
  // 받은 줄을 가진 줄에 합친다. full이면 서버가 준 것이 전부(오래되어 지워진 줄은 빠짐).
  // stale: 늦게 도착한 옛 답 (전부라도 빠진 줄을 지우지 않는다). 같은 번호면 더 새 판(v)만.
  // 보내는 중인 줄(pend)은 서버 줄에 같은 앱 번호(c)가 보이면 뺀다.
  function mergeLines(list, chat, now, stale) {
    list = Array.isArray(list) ? list : [];
    const incoming = (chat && Array.isArray(chat.ms) ? chat.ms : []).filter(okLine);
    const full = !!(chat && chat.full) && !stale;
    const byS = new Map();
    if (!full) for (const x of list) if (!x.pend && okLine(x)) byS.set(x.s, x);
    for (const m of incoming) { const old = byS.get(m.s); if (!old || !(old.v > m.v)) byS.set(m.s, m); }
    const got = new Set();
    for (const x of byS.values()) if (x.c) got.add(x.c);
    const pend = list.filter((x) => x && x.pend && !got.has(x.c)).sort((a, b) => a.at - b.at);
    const lines = [...byS.values()].filter((x) => now - x.at < DAYS * DAY).sort((a, b) => a.s - b.s).slice(-KEEP);
    return lines.concat(pend);
  }
  const dayNum = (t) => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  // 날 구분 줄: 오늘 · 어제 · 11월 18일 화요일
  function dayLabel(t, now) {
    if (dayNum(t) === dayNum(now)) return '오늘';
    const n = new Date(now);
    if (dayNum(t) === dayNum(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1).getTime())) return '어제';
    const d = new Date(t);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`;
  }
  const ampm = (t) => { const d = new Date(t), h = d.getHours(); return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + pad2(d.getMinutes()); };
  // 앱이 붙이는 메시지 번호 (다시 보낼 때 서버가 같은 메시지를 두 번 넣지 않게)
  const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(-12);

  const lib = { QUICK, LEN, LINES, KEEP, DAYS, UNREAD, tidyMsg, msgProblem, cleanMsg, maskBad, looksContact, unreadCount, pollDelay, mergeLines, dayLabel, ampm, newId };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  /* =====================================================================
   *  브라우저
   * ===================================================================== */
  const App = root.App;
  const G = root.Group && root.Group._;
  if (!App || !G) return;
  const { store, $, esc, toast, ask, choose } = App;
  const doc = root.document;
  const ic = (name, cls) => App.ic(name, cls);
  const featOn = () => !root.Features || root.Features.on('grchat');
  const canChat = () => G.canTalk() && featOn();
  const settings = () => store.get().settings || {};
  const studyOn = () => settings().groupChatStudy !== false;
  const filterOn = () => settings().groupChatFilter !== false;
  const quiet = () => studyOn() && !!G.liveNow(); // 공부 중: 새 메시지 표시를 숨긴다
  const fine = () => { try { return matchMedia('(pointer: fine)').matches; } catch (e) { return false; } };
  const isPhone = () => { try { return matchMedia('(max-width: 720px), (max-height: 520px) and (pointer: coarse)').matches; } catch (e) { return true; } };
  const me = () => { const s = G.state(); return s && s.me ? s.me.id : ''; };
  const shown = (t) => (filterOn() ? maskBad(t) : String(t || ''));
  const count = (n) => (n >= UNREAD ? UNREAD + '+' : String(n));

  // 이 기기에만: { u 계정, r { 그룹: 읽은 번호 }, h [{ id, n }] 가린 사람 }
  const KEY = 'studypromotion.groupChat';
  function load() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { m = null; }
    m = m && typeof m === 'object' ? m : {};
    const r = {};
    if (m.r && typeof m.r === 'object') for (const [k, v] of Object.entries(m.r)) if (Number.isInteger(v) && v > 0) r[k] = v;
    const h = (Array.isArray(m.h) ? m.h : []).filter((x) => x && typeof x.id === 'string').map((x) => ({ id: x.id, n: String(x.n || '') }));
    return { u: typeof m.u === 'string' ? m.u : '', r, h };
  }
  let mem = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* 저장이 막힌 환경 */ } };
  const hiddenIds = () => mem.h.map((x) => x.id);

  // 그룹별로 받아 둔 채팅 (이 앱이 열려 있는 동안만): { lines, v, on, loaded, seq 마지막으로 반영한 요청 }
  let caches = {};
  const cacheOf = (gid) => caches[gid] || (caches[gid] = { lines: [], v: 0, on: true, loaded: false, seq: 0 });
  const drafts = {};
  let openGid = null, lastAct = 0, pollT = null, polling = false, pollAgain = false, netErr = null, reqNo = 0, lastFocus = null, lastHTML = '';

  const nameOf = (g, x) => { const m = G.memberOf(g, x.f); return m ? m.n : x.n || '나간 사람'; };
  // 그룹 상태의 요약과 받아 둔 채팅 중 더 새것으로 요약을 만든다 (채팅 창을 닫은 뒤에도 방금 본 것이 보이게)
  function sumOf(g) {
    const base = (g && g.chat) || { on: true, v: 0, nu: [], tail: [] };
    const c = g && caches[g.id];
    if (!c || !c.loaded || base.on === false || c.on === false || c.v < base.v) return base;
    const my = me();
    const talk = c.lines.filter((x) => !x.pend && !x.k && !x.x);
    return { on: true, v: c.v, nu: talk.filter((x) => x.f !== my).slice(-UNREAD).map((x) => [x.s, x.f]), tail: talk.slice(-2) };
  }
  function unread(g) {
    if (!g || g.id === openGid) return 0;
    return unreadCount(sumOf(g), mem.r[g.id], hiddenIds());
  }

  /* ---------- 그룹 화면의 '채팅' 칸 · 홈 '우리 그룹'의 새 메시지 줄 (js/group.js가 부른다) ---------- */
  function when(t, now) {
    if (dayNum(t) === dayNum(now)) return ampm(t);
    const l = dayLabel(t, now);
    return l === '어제' ? l : `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
  }
  function cardHTML(g) {
    if (!g || !featOn() || !G.remote()) return '';
    const my = me(), lead = g.lead === my, sm = sumOf(g), now = Date.now();
    const head = (pill) => `<div class="panel-head"><h2>채팅${pill}</h2><span class="muted small">7일 동안 남아요</span></div>`;
    if (sm.on === false) {
      return `<div class="panel gc-card off">${head('')}<p class="gc-quiet muted small">리더가 채팅을 꺼 두었어요.${lead ? ' 다시 켜면 그룹 사람들이 이야기할 수 있어요.' : ''}</p>${lead ? `<button class="btn sm" type="button" data-gc="on" data-g="${esc(g.id)}">채팅 켜기</button>` : ''}</div>`;
    }
    const q = quiet(), n = unread(g);
    const pill = q ? ' <span class="gc-new quiet">공부 중이라 숨김</span>' : n ? ` <span class="gc-new">새 메시지 ${count(n)}</span>` : '';
    let body;
    if (q) body = '<p class="gc-quiet muted small">공부하는 동안은 새 메시지를 숨겨요. 끝나면 쌓인 메시지 수가 보여요.</p>';
    else {
      const hid = hiddenIds();
      const tail = (sm.tail || []).filter((x) => x && typeof x.t === 'string' && (x.f === my || !hid.includes(x.f)));
      body = tail.length
        ? `<ul class="gc-prev">${tail.map((x) => `<li>${G.av(G.memberOf(g, x.f) || { id: x.f, n: x.n }, { cls: 'sm' })}<b>${esc(x.f === my ? '나' : nameOf(g, x))}</b><span class="t">${esc(shown(x.t).replace(/\s*\n+\s*/g, ' '))}</span><small>${esc(when(x.at, now))}</small></li>`).join('')}</ul>`
        : '<p class="gc-quiet muted small">아직 메시지가 없어요. 먼저 인사해 볼까요?</p>';
    }
    return `<div class="panel gc-card">${head(pill)}${body}<button class="btn sm gc-open" type="button" data-gc="open" data-g="${esc(g.id)}">${ic('chat')}채팅 열기</button></div>`;
  }
  function homeHTML(g) {
    if (!g || !featOn() || quiet() || sumOf(g).on === false) return '';
    const n = unread(g);
    if (!n) return '';
    return `<button class="gc-home" type="button" data-gc-home="${esc(g.id)}">${ic('chat')}<b>채팅</b><span class="gc-new">새 메시지 ${count(n)}</span>${ic('chev', 'gc-chev')}</button>`;
  }

  // 그룹 탭의 새 메시지 점
  let dotOn = false, wasQuiet = null;
  function updateDot() {
    const t = doc.querySelector('nav.tabs .tab[data-view="group"]');
    const s = G.state();
    const on = !!(s && featOn() && G.remote() && !quiet() && s.groups.some((g) => unread(g) > 0));
    if (t) {
      t.classList.toggle('has-new', on);
      if (on) t.setAttribute('aria-label', '그룹 (새 메시지)');
      else if (dotOn) t.removeAttribute('aria-label');
    }
    dotOn = on;
  }

  /* ---------- 채팅 창 ---------- */
  const back = $('#gc');
  if (!back) return;
  const box = back.querySelector('.gc-box'), list = $('#gc-list'), ta = $('#gc-text'), form = $('#gc-form'), sendBtn = form.querySelector('.gc-send'), jump = $('#gc-jump');
  $('#gc-quick').innerHTML = QUICK.map((t, i) => `<button class="gc-chip" type="button" data-gc-q="${i}">${esc(t)}</button>`).join('');

  function fit() {
    // 폰에서 글자판이 올라오면 보이는 높이에 맞춘다 (입력 칸이 글자판에 가리지 않게)
    const vv = root.visualViewport;
    if (!vv || !isPhone() || back.hidden) { back.style.removeProperty('--gc-kb'); back.style.removeProperty('--gc-top'); return; }
    const stick = nearBottom();
    back.style.setProperty('--gc-top', Math.max(0, Math.round(vv.offsetTop)) + 'px');
    back.style.setProperty('--gc-kb', Math.max(0, Math.round(root.innerHeight - vv.height - vv.offsetTop)) + 'px');
    if (stick) list.scrollTop = list.scrollHeight;
  }
  if (root.visualViewport) { root.visualViewport.addEventListener('resize', fit); root.visualViewport.addEventListener('scroll', fit); }

  function paintHead(g) {
    $('#gc-title').textContent = g ? g.name : '채팅';
    const off = netErr === 'offline' || navigator.onLine === false;
    $('#gc-sub').textContent = off ? '인터넷 연결을 확인해 주세요' : g ? `${g.ms.length}명 · 채팅` : '';
    $('#gc-sub').classList.toggle('bad', off);
  }

  async function open(gid, opts) {
    opts = opts || {};
    const g = G.findGroup(gid);
    if (!g || !featOn() || !G.remote()) return;
    if (sumOf(g).on === false) { toast(G.errText('chatoff')); return; }
    if (!opts.force && quiet() && !(await ask('공부 중이에요. 채팅은 끝나고 볼까요?', { ok: '그래도 보기', cancel: '끝나고 볼게요' }))) return;
    if (openGid && openGid !== gid) close();
    G.pick(gid);
    if (openGid !== gid) lastFocus = doc.activeElement;
    openGid = gid;
    lastAct = Date.now();
    netErr = null;
    back.hidden = false;
    doc.body.classList.add('gc-open');
    paintHead(g);
    ta.value = drafts[gid] || '';
    grow(); meta('');
    jump.hidden = true;
    lastHTML = '';
    renderList({ stick: true });
    fit();
    // 손가락 화면에서는 글자판이 바로 올라오지 않게 창에 초점을 두고, 마우스 화면은 입력 칸에
    try { (fine() ? ta : box).focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    poll();
    G.paint();
    updateDot();
  }
  function close() {
    if (!openGid) return;
    markRead();
    drafts[openGid] = ta.value;
    openGid = null;
    clearTimeout(pollT); pollT = null;
    back.hidden = true;
    doc.body.classList.remove('gc-open');
    back.style.removeProperty('--gc-kb'); back.style.removeProperty('--gc-top');
    if (ta === doc.activeElement) ta.blur();
    const f = lastFocus; lastFocus = null;
    if (f && f.isConnected && f.focus) try { f.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    G.paint();
    updateDot();
  }

  /* ---------- 받기 ---------- */
  async function poll() {
    clearTimeout(pollT); pollT = null;
    const gid = openGid;
    if (!gid || doc.visibilityState === 'hidden') return;
    if (!canChat()) { netErr = navigator.onLine === false ? 'offline' : netErr; paintHead(G.findGroup(gid)); return schedule(); }
    if (polling) { pollAgain = true; return; }
    polling = true;
    const c = cacheOf(gid), no = ++reqNo;
    try {
      const j = await G.call({ op: 'chat', g: gid, since: c.loaded ? c.v : 0 });
      netErr = null;
      take(gid, j.chat, no);
    } catch (e) {
      netErr = e.code;
      if (e.code === 'nogroup' && gid === openGid) { close(); toast(G.errText('nogroup')); G.pull(); }
      else if (e.code === 'login' && gid === openGid) close();
      else if (gid === openGid) { paintHead(G.findGroup(gid)); if (!c.loaded) renderList(); }
    } finally {
      polling = false;
      schedule();
    }
  }
  function schedule() {
    clearTimeout(pollT); pollT = null;
    if (!openGid || doc.visibilityState === 'hidden') return;
    const d = pollAgain ? 0 : netErr ? Math.max(8000, pollDelay(Date.now() - lastAct)) : pollDelay(Date.now() - lastAct);
    pollAgain = false;
    pollT = setTimeout(poll, d);
  }
  // 서버가 준 채팅을 반영한다. no: 이 답을 받은 요청의 차례 (늦게 온 옛 답은 덜 믿는다)
  function take(gid, chat, no) {
    if (!chat || typeof chat !== 'object') return;
    const c = cacheOf(gid), now = Date.now();
    const stale = no < c.seq;
    if (!stale) c.seq = no;
    if (chat.on === false) {
      if (stale) return;
      caches[gid] = { lines: [], v: 0, on: false, loaded: true, seq: no };
      const g = G.findGroup(gid);
      if (g) g.chat = { on: false, v: 0, nu: [], tail: [] };
      if (gid === openGid) { close(); toast('리더가 채팅을 꺼 두었어요'); }
      G.paint(); updateDot();
      return;
    }
    const my = me();
    const top = c.lines.reduce((a, x) => (x.pend ? a : Math.max(a, x.s)), 0);
    c.on = true;
    c.lines = mergeLines(c.lines, chat, now, stale);
    if (!stale && Number.isInteger(chat.v)) c.v = chat.full ? chat.v : Math.max(c.v, chat.v);
    c.loaded = true;
    const fresh = c.lines.some((x) => !x.pend && !x.k && x.s > top && x.f !== my);
    if (fresh) lastAct = now;
    if (gid === openGid) renderList({ fresh });
  }
  // 열어 둔 채팅의 마지막 번호까지 읽음 (이 기기에만)
  function markRead() {
    const gid = openGid, c = gid && caches[gid];
    if (!c || !c.loaded) return;
    const top = c.lines.reduce((a, x) => (x.pend ? a : Math.max(a, x.s)), 0);
    if (top > (mem.r[gid] || 0)) { mem.r[gid] = top; save(); }
  }

  /* ---------- 그리기 ---------- */
  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  function sysHTML(g, x, now, my) {
    const who = x.f === my ? '' : `${esc(nameOf(g, x))} 님이 `;
    if (x.k === 'in') return `<p class="gc-sys">${who}그룹에 들어왔어요</p>`;
    if (x.k === 'out') return `<p class="gc-sys">${who}그룹을 나갔어요</p>`;
    if (x.k !== 'room') return '';
    const r = g.room, live = x.end > now;
    const inIt = !!(r && r.end === x.end && r.ms.includes(my));
    let tail = '';
    if (live && inIt) tail = `<span class="gc-sys-tag">${ic('check')}같이 하는 중</span>`;
    else if (live && x.f !== my && G.focusOK()) tail = '<button class="btn primary sm" type="button" data-gc-room>같이 하기</button>';
    else if (!live) tail = `<span>· ${esc(ampm(x.end))}에 끝남</span>`;
    return `<p class="gc-sys room">${ic('timer')}<span>${who}함께 집중 ${esc(x.min)}분을 시작했어요</span>${tail}</p>`;
  }
  function msgHTML(g, x, o) {
    const name = o.mine ? '나' : nameOf(g, x);
    const sr = `<span class="gc-sr">${esc(name)}${x.pend ? '' : ', ' + esc(ampm(x.at))}: </span>`;
    let b;
    if (x.x) b = `<p class="gc-b del">${sr}${x.x === 2 ? '리더가 지운 메시지예요' : '지운 메시지예요'}</p>`;
    else b = `<p class="gc-b" tabindex="0" role="button" aria-haspopup="menu" ${x.pend ? `data-gc-c="${esc(x.c)}"` : `data-gc-s="${x.s}"`}>${sr}${esc(shown(x.t))}</p>`;
    let side = '';
    if (x.pend) side = x.fail ? `<span class="gc-st fail">${esc(x.fail)}<button type="button" class="gc-retry" data-gc-retry="${esc(x.c)}">다시 보내기</button></span>` : '<span class="gc-st">보내는 중</span>';
    else if (o.time) side = `<time aria-hidden="true">${esc(ampm(x.at))}</time>`;
    const cls = 'gc-msg' + (o.mine ? ' me' : '') + (o.cont ? ' cont' : '') + (x.pend ? (x.fail ? ' failed' : ' sending') : '');
    if (o.mine) return `<div class="${cls}"><div class="gc-line">${b}${side}</div></div>`;
    const m = G.memberOf(g, x.f) || { id: x.f, n: name };
    return `<div class="${cls}">${o.cont ? '<span class="gc-av-sp" aria-hidden="true"></span>' : G.av(m)}<div class="gc-who">${o.cont ? '' : `<small aria-hidden="true">${esc(name)}</small>`}<div class="gc-line">${b}${side}</div></div></div>`;
  }
  const hiddenHTML = (n) => `<p class="gc-sys gc-hid">가린 사람의 메시지${n > 1 ? ' ' + n + '개' : ''}</p>`;
  function listHTML(g, c, now) {
    const note = `<p class="gc-note">${ic('lock')}그룹 사람만 볼 수 있고, 7일이 지나면 지워져요</p>`;
    if (!c.loaded) {
      const err = netErr && netErr !== 'nogroup';
      return note + `<p class="gc-wait muted small">${err ? esc(G.errText(netErr)) : '메시지를 불러오는 중이에요…'}</p>`;
    }
    if (!c.lines.length) return note + '<div class="gc-empty"><b>아직 메시지가 없어요</b><span class="muted small">아래 빠른 말을 눌러 먼저 인사해 보세요.</span></div>';
    const my = me(), hid = hiddenIds(), lines = c.lines, out = [note];
    let day = 0, prev = null;
    for (let i = 0; i < lines.length; i++) {
      const x = lines[i], dk = dayNum(x.at);
      if (dk !== day) { day = dk; prev = null; out.push(`<p class="gc-day"><span>${esc(dayLabel(x.at, now))}</span></p>`); }
      if (x.k) { out.push(sysHTML(g, x, now, my)); prev = null; continue; }
      const mine = x.f === my;
      if (!mine && hid.includes(x.f)) {
        if (prev && prev.hidden && prev.f === x.f) { prev.n += 1; out[prev.idx] = hiddenHTML(prev.n); }
        else { prev = { hidden: true, f: x.f, n: 1, idx: out.length }; out.push(hiddenHTML(1)); }
        continue;
      }
      const cont = !!(prev && !prev.hidden && !prev.pend && !x.pend && prev.f === x.f && x.at - prev.at < 3 * MIN);
      const nx = lines[i + 1];
      const time = !x.pend && !(nx && !nx.k && !nx.pend && nx.f === x.f && dayNum(nx.at) === dk && ampm(nx.at) === ampm(x.at) && (mine || !hid.includes(nx.f)));
      out.push(msgHTML(g, x, { mine, cont, time }));
      prev = x;
    }
    return out.join('');
  }
  function renderList(o) {
    o = o || {};
    const gid = openGid, g = gid && G.findGroup(gid);
    if (!g) return;
    const c = cacheOf(gid);
    const stick = o.stick || nearBottom();
    const html = listHTML(g, c, Date.now());
    if (html !== lastHTML) {
      const keep = list.scrollTop;
      list.innerHTML = html;
      lastHTML = html;
      if (stick) list.scrollTop = list.scrollHeight;
      else { list.scrollTop = keep; if (o.fresh) jump.hidden = false; }
    }
    paintHead(g);
    markRead();
    updateDot();
  }

  /* ---------- 보내기 ---------- */
  function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 124) + 'px'; }
  function meta(err) {
    const n = [...tidyMsg(ta.value)].length;
    const e = $('#gc-err'), cnt = $('#gc-count');
    e.textContent = err || '';
    e.hidden = !err;
    cnt.textContent = n > LEN - 40 ? `${n}/${LEN}` : '';
    cnt.classList.toggle('over', n > LEN);
    sendBtn.disabled = !n;
  }
  const queue = [];
  let sending = false, lastSent = 0;
  function send(t) {
    const gid = openGid;
    if (!gid) return;
    const s = G.state();
    const x = { pend: 1, c: newId(), t, at: Date.now(), f: me(), n: (s && s.me && s.me.n) || '', g: gid };
    cacheOf(gid).lines.push(x);
    lastAct = Date.now();
    renderList({ stick: true });
    queue.push(x);
    pump();
  }
  async function pump() {
    if (sending) return;
    const x = queue.shift();
    if (!x) return;
    sending = true;
    try {
      const wait = 1100 - (Date.now() - lastSent); // 서버는 한 사람이 1초에 1개까지 받는다
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const c = cacheOf(x.g);
      if (!c.lines.includes(x)) return; // 기다리는 동안 '보내지 않기'를 눌렀다
      if (!canChat()) throw Object.assign(new Error('offline'), { code: navigator.onLine === false ? 'offline' : 'server' });
      const no = ++reqNo;
      const j = await G.call({ op: 'say', g: x.g, t: x.t, c: x.c, since: c.loaded ? c.v : 0 });
      lastSent = Date.now();
      take(x.g, j.chat, no);
    } catch (e) {
      lastSent = Date.now();
      x.fail = e.code === 'offline' ? '못 보냈어요' : e.code === 'fast' ? '너무 빨라요' : e.code === 'daymax' ? '오늘은 그만' : '못 보냈어요';
      if (['fast', 'daymax', 'chatoff', 'name', 'nogroup'].includes(e.code)) toast(G.errText(e.code));
      if (e.code === 'chatoff' || e.code === 'nogroup') G.pull();
      if (x.g === openGid) renderList();
    } finally {
      sending = false;
      if (queue.length) pump();
    }
  }
  function retry(cid) {
    const gid = openGid, c = gid && caches[gid];
    const x = c && c.lines.find((y) => y.pend && y.c === cid);
    if (!x || !x.fail || queue.includes(x)) return;
    delete x.fail;
    renderList();
    queue.push(x);
    pump();
  }
  function dropPending(cid) {
    const gid = openGid, c = gid && caches[gid];
    if (!c) return;
    c.lines = c.lines.filter((y) => !(y.pend && y.c === cid));
    renderList();
  }
  async function submit() {
    if (!openGid) return;
    const prob = msgProblem(ta.value);
    if (prob === 'empty') return;
    if (prob) { meta(prob === 'long' ? `한 번에 ${LEN}자까지 보낼 수 있어요` : `한 번에 ${LINES}줄까지 보낼 수 있어요`); return; }
    const t = cleanMsg(ta.value);
    if (looksContact(t) && !(await ask('전화번호나 이메일 같은 개인 연락처는 그룹 사람 모두에게 보여요.\n그래도 보낼까요?', { ok: '보내기', cancel: '고치기' }))) {
      try { ta.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
      return;
    }
    if (!openGid) return;
    ta.value = '';
    drafts[openGid] = '';
    grow(); meta('');
    send(t);
  }

  // 한글을 조합하는 중에 보내기를 누르면: 조합을 끝낸 뒤에 보낸다 (마지막 글자가 빠지지 않게)
  let composing = false;
  ta.addEventListener('compositionstart', () => { composing = true; });
  ta.addEventListener('compositionend', () => { composing = false; });
  function afterComposition(fn) {
    if (!composing) return fn();
    let done = false;
    const run = () => { if (done) return; done = true; composing = false; ta.removeEventListener('compositionend', run); setTimeout(fn, 0); };
    ta.addEventListener('compositionend', run);
    setTimeout(run, 500);
  }
  ta.addEventListener('input', () => { grow(); meta(''); if (openGid) drafts[openGid] = ta.value; });
  ta.addEventListener('keydown', (e) => {
    // 마우스 화면은 Enter로 보내고 Shift+Enter로 줄 바꿈. 손가락 화면의 Enter는 줄 바꿈 (보내기 단추로 보낸다)
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && fine()) { e.preventDefault(); submit(); }
  });
  // 보내기 단추를 눌러도 입력 칸의 초점(글자판)을 그대로 둔다
  sendBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (composing && doc.activeElement === ta) { ta.blur(); ta.focus({ preventScroll: true }); }
    afterComposition(submit);
  });

  /* ---------- 메시지 메뉴 (꾹 누르기 · 오른쪽 클릭 · 마우스로 누르기) ---------- */
  const lineOf = (el) => {
    const c = openGid && caches[openGid];
    if (!c || !el) return null;
    if (el.dataset.gcS) return c.lines.find((x) => !x.pend && x.s === +el.dataset.gcS) || null;
    if (el.dataset.gcC) return c.lines.find((x) => x.pend && x.c === el.dataset.gcC) || null;
    return null;
  };
  const preview = (t) => { const s = String(t || '').replace(/\s+/g, ' '); return [...s].length > 60 ? [...s].slice(0, 60).join('') + '…' : s; };
  let menuOpen = false;
  async function msgMenu(el) {
    const x = lineOf(el), gid = openGid, g = gid && G.findGroup(gid);
    if (!x || !g || x.x || menuOpen) return;
    if (x.pend && !x.fail) return;
    const my = me(), mine = x.f === my, lead = g.lead === my, name = mine ? '나' : nameOf(g, x);
    menuOpen = true;
    el.classList.add('pick');
    let v;
    try {
      if (x.pend) {
        v = await choose('보내지 못한 메시지', [
          { value: 'retry', label: '다시 보내기' },
          { value: 'drop', label: '보내지 않기', hint: '이 기기에서 지워요' },
          { value: 'copy', label: '복사' },
        ], { note: preview(x.t) });
      } else {
        const opts = [{ value: 'copy', label: '복사' }];
        if (!mine) opts.push({ value: 'hide', label: `${name} 님 메시지 가리기`, hint: '내 화면에서만 가려지고 상대는 몰라요' });
        if (mine || lead) opts.push({ value: 'del', label: '메시지 지우기', hint: mine ? '모두에게 ‘지운 메시지예요’로 보여요' : '리더 · 모두에게 ‘리더가 지운 메시지예요’로 보여요' });
        v = await choose(mine ? '내 메시지' : `${name} 님의 메시지`, opts, { note: preview(shown(x.t)) });
      }
    } finally {
      menuOpen = false;
      el.classList.remove('pick');
    }
    if (!v || gid !== openGid) return;
    if (v === 'copy') toast((await G.copyText(shown(x.t))) ? '메시지를 복사했어요' : '복사하지 못했어요');
    else if (v === 'retry') retry(x.c);
    else if (v === 'drop') dropPending(x.c);
    else if (v === 'hide') hide(x.f, name);
    else if (v === 'del') unsay(gid, x, mine);
  }
  async function unsay(gid, x, mine) {
    const msg = mine ? '이 메시지를 지울까요?\n모두의 화면에서 ‘지운 메시지예요’로 바뀌어요.' : '이 메시지를 지울까요?\n모두의 화면에서 ‘리더가 지운 메시지예요’로 바뀌어요.';
    if (!(await ask(msg, { ok: '지우기', danger: true }))) return;
    const c = cacheOf(gid), no = ++reqNo;
    try {
      const j = await G.call({ op: 'unsay', g: gid, s: x.s, since: c.loaded ? c.v : 0 });
      take(gid, j.chat, no);
      toast('메시지를 지웠어요');
    } catch (e) {
      toast(G.errText(e.code));
      if (e.code === 'gone' || e.code === 'lead') poll();
      if (e.code === 'nogroup') G.pull();
    }
  }
  function hide(id, name) {
    if (!id || id === me() || hiddenIds().includes(id)) return;
    mem.h.push({ id, n: name || '' });
    save();
    refreshAll();
    toast(`${name} 님 메시지를 가렸어요. 채팅 메뉴에서 다시 볼 수 있어요`, { action: '되돌리기', onAction: () => unhide(id) });
  }
  function unhide(id) {
    const h = mem.h.find((x) => x.id === id);
    if (!h) return;
    mem.h = mem.h.filter((x) => x.id !== id);
    save();
    refreshAll();
    toast(`${h.n || '그 사람'} 님 메시지가 다시 보여요`);
  }
  function refreshAll() { if (openGid) renderList(); G.paint(); updateDot(); }

  /* ---------- 채팅 메뉴 (⋯) ---------- */
  function setSetting(key, on) {
    store.update((st) => { if (on) delete st.settings[key]; else st.settings[key] = false; });
  }
  async function chatMenu() {
    const gid = openGid, g = gid && G.findGroup(gid);
    if (!g) return;
    const lead = g.lead === me(), hid = mem.h;
    const v = await choose(`${g.name} 채팅`, [
      { value: 'study', label: '공부하는 동안 새 메시지 숨기기', hint: studyOn() ? '켜짐 · 누르면 꺼요' : '꺼짐 · 누르면 켜요' },
      { value: 'filter', label: '욕설 가리기', hint: filterOn() ? '켜짐 · 심한 욕을 ✱✱로 가려 보여요' : '꺼짐 · 누르면 켜요' },
      hid.length ? { value: 'hidden', label: '가린 사람', hint: `${hid.length}명 · 눌러서 다시 보기` } : null,
      lead ? { value: 'off', label: '채팅 끄기', hint: '리더 · 아무도 보내지 못하고 지난 메시지도 숨어요' } : null,
    ].filter(Boolean), { note: '읽음 표시와 입력 중 표시는 없어요. 메시지는 그룹 사람만 보고 7일이 지나면 지워져요.' });
    if (!v || gid !== openGid) return;
    if (v === 'study') {
      const on = !studyOn();
      setSetting('groupChatStudy', on);
      toast(on ? '공부하는 동안 새 메시지 표시를 숨겨요' : '공부하는 동안에도 새 메시지 표시가 보여요');
    } else if (v === 'filter') {
      const on = !filterOn();
      setSetting('groupChatFilter', on);
      toast(on ? '심한 욕을 ✱✱로 가려 보여요' : '욕설을 가리지 않아요');
    } else if (v === 'hidden') {
      const id = await choose('가린 사람', mem.h.map((x) => ({ value: x.id, label: x.n || '이름 없음', hint: '눌러서 다시 보기' })), { note: '가린 사람의 메시지는 이 기기에서만 숨겨져요. 상대는 몰라요.' });
      if (id) unhide(id);
    } else if (v === 'off') setOn(gid, false);
    refreshAll();
  }
  // 리더: 채팅 켜기·끄기 (그룹 메뉴와 채팅 칸에서도)
  async function setOn(gid, on) {
    const g = G.findGroup(gid);
    if (!g) return;
    if (!on && !(await ask('채팅을 끌까요?\n그동안 아무도 보내지 못하고 지난 메시지도 숨겨져요. 그룹 메뉴에서 다시 켤 수 있어요.', { ok: '채팅 끄기', danger: true }))) return;
    if (!on && openGid === gid) close();
    const s = await G.act({ op: 'edit', g: gid, chat: !!on }, on ? '채팅을 켰어요' : '채팅을 껐어요');
    if (s) delete caches[gid];
  }

  /* ---------- 누르기 ---------- */
  doc.addEventListener('click', (e) => {
    const home = e.target.closest('[data-gc-home]');
    if (home) { e.preventDefault(); const gid = home.dataset.gcHome; G.pick(gid); App.go('group'); open(gid); return; }
    const b = e.target.closest('[data-gc]');
    if (!b || !b.closest('#view-group')) return;
    if (b.dataset.gc === 'open') open(b.dataset.g);
    else if (b.dataset.gc === 'on') setOn(b.dataset.g, true);
  });
  $('#gc-close').addEventListener('click', close);
  $('#gc-menu').addEventListener('click', chatMenu);
  back.addEventListener('click', (e) => {
    if (e.target === back) return close(); // 넓은 화면: 창 바깥
    const q = e.target.closest('[data-gc-q]');
    if (q) {
      const wasTyping = doc.activeElement === ta;
      send(QUICK[+q.dataset.gcQ]);
      if (wasTyping) try { ta.focus({ preventScroll: true }); } catch (err) { /* 무시 */ }
      return;
    }
    const r = e.target.closest('[data-gc-retry]');
    if (r) return retry(r.dataset.gcRetry);
    if (e.target.closest('[data-gc-room]')) { const gid = openGid; close(); G.joinRoom(gid); return; }
    if (e.target.closest('#gc-jump')) { list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }); jump.hidden = true; return; }
    const bub = e.target.closest('.gc-b[data-gc-s], .gc-b[data-gc-c]');
    // 마우스는 눌러서 메뉴, 손가락은 꾹 눌러서 (보내지 못한 메시지는 그냥 눌러도)
    if (bub && (fine() || bub.closest('.failed')) && Date.now() - pressAt > 800) msgMenu(bub);
  });
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const bub = e.target.closest && e.target.closest('.gc-b[data-gc-s], .gc-b[data-gc-c]');
    if (bub && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); msgMenu(bub); }
  });
  // 꾹 누르기 (0.48초). 안드로이드는 꾹 누르면 contextmenu도 오므로 한 번만 연다
  let pressT = null, pressXY = null, pressAt = 0;
  const unpress = () => { if (pressT) { clearTimeout(pressT); pressT = null; } list.querySelectorAll('.pressing').forEach((x) => x.classList.remove('pressing')); };
  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const bub = e.target.closest('.gc-b[data-gc-s], .gc-b[data-gc-c]');
    if (!bub) return;
    unpress();
    pressXY = [e.clientX, e.clientY];
    bub.classList.add('pressing');
    pressT = setTimeout(() => { pressT = null; bub.classList.remove('pressing'); pressAt = Date.now(); msgMenu(bub); }, 480);
  });
  list.addEventListener('pointermove', (e) => { if (pressT && pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 8) unpress(); });
  list.addEventListener('pointerup', unpress);
  list.addEventListener('pointercancel', unpress);
  list.addEventListener('contextmenu', (e) => {
    const bub = e.target.closest('.gc-b[data-gc-s], .gc-b[data-gc-c]');
    if (!bub) return;
    e.preventDefault();
    if (Date.now() - pressAt < 1000) return;
    unpress();
    pressAt = Date.now();
    msgMenu(bub);
  });
  list.addEventListener('scroll', () => { unpress(); if (!jump.hidden && nearBottom()) jump.hidden = true; }, { passive: true });

  /* ---------- 언제 다시 그리나 ---------- */
  function onState(s) {
    if (!s) { close(); caches = {}; updateDot(); return; }
    const u = G.user && G.user();
    if (u && mem.u !== u.uid) { mem = { u: u.uid, r: {}, h: [] }; save(); } // 다른 계정: 이 기기의 읽음·가리기를 새로
    let pruned = false;
    for (const gid of Object.keys(mem.r)) if (!s.groups.some((g) => g.id === gid)) { delete mem.r[gid]; pruned = true; }
    if (pruned) save();
    if (openGid) {
      const g = G.findGroup(openGid);
      if (!g || !featOn()) close();
      else if (g.chat && g.chat.on === false) { close(); toast('리더가 채팅을 꺼 두었어요'); }
      else renderList();
    }
    updateDot();
  }
  doc.addEventListener('visibilitychange', () => {
    if (!openGid) return;
    if (doc.visibilityState === 'hidden') { clearTimeout(pollT); pollT = null; markRead(); }
    else { lastAct = Date.now(); poll(); }
  });
  root.addEventListener('online', () => { if (openGid) { netErr = null; poll(); } });
  root.addEventListener('offline', () => { if (openGid) { netErr = 'offline'; paintHead(G.findGroup(openGid)); } });
  root.addEventListener('cloud-user', () => { const u = G.user && G.user(); if (!u) { close(); caches = {}; } });
  if (root.Features) root.Features.onChange(() => { if (!featOn()) close(); updateDot(); });
  store.subscribe(() => { updateDot(); if (openGid) renderList(); });
  // 10초마다: 공부를 시작·멈추면 숨김을 바꾸고, 열어 둔 창의 '같이 하기'·시각을 새로
  setInterval(() => {
    const q = quiet();
    if (wasQuiet !== null && q !== wasQuiet) G.paint();
    wasQuiet = q;
    updateDot();
    if (openGid && doc.visibilityState === 'visible') renderList();
  }, 10000);

  root.GroupChat = {
    cardHTML, homeHTML, onState, open, close, setOn,
    get openId() { return openGid; },
    // 시험용
    unread: (gid) => unread(G.findGroup(gid)),
    poll,
  };
  updateDot();
})(typeof window !== 'undefined' ? window : globalThis);
