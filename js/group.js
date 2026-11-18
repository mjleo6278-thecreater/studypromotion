/* 그룹 스터디 (v3.11): 친구들과 그룹을 만들어 서로의 공부 시간을 보고, 목표를 같이 정하고, 함께 집중한다.
 * - 서버: AI 도우미와 같은 서버의 /group (worker/src/group.js). 로그인한 사람만 쓰고, 다른 사람에게는 별명만 보인다.
 * - 보내는 것: 최근 15일의 날별 공부 시간(분)과 '공부 중' 표시(무엇으로 재는지, 시작·끝 시각, 고르면 과목 이름)뿐.
 *   할 일·시험 범위·메모·기록 내용은 보내지 않는다. 그룹에 들지 않았으면 아무것도 보내지 않는다.
 * - 화면: 그룹 탭(#group)과 홈 '우리 그룹' 칸. 초대 링크(…/#join=코드)를 누르면 앱이 열리고 들어갈지 묻는다(js/app.js가 코드를 맡겨 둔다).
 * - 이번 주·순위·목표 계산은 아래 순수 함수로 하고 node에서 시험한다 (tests/group.test.js).
 */
(function (root) {
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  // 응원 (서버 worker/src/group.js의 CHEER_KINDS와 개수가 같아야 한다)
  const CHEERS = [
    { e: '👏', t: '대단해요' },
    { e: '🔥', t: '힘내요' },
    { e: '💪', t: '같이 해요' },
    { e: '☕', t: '쉬엄쉬엄' },
  ];
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------- 날짜: 'YYYY-MM-DD'끼리 계산 (시간대와 상관없게 UTC로) ---------- */
  const toT = (k) => { const p = String(k).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
  const toK = (t) => new Date(t).toISOString().slice(0, 10);
  const addKey = (k, n) => toK(toT(k) + n * DAY);
  const weekdayOf = (k) => new Date(toT(k)).getUTCDay(); // 0 = 일요일
  const weekStart = (k) => addKey(k, -((weekdayOf(k) + 6) % 7)); // 그 주 월요일
  const weekKeys = (k) => { const s = weekStart(k); return [0, 1, 2, 3, 4, 5, 6].map((i) => addKey(s, i)); };

  /* ---------- 공부 중 표시 { k: 'sw'|'focus'|'lock', at 시작, end 끝나는 시각?, s 과목? } ---------- */
  // 지금도 공부 중인가: 끝나는 시각이 있으면 그 전까지, 스톱워치는 시작한 지 16시간까지 (서버와 같은 규칙)
  const liveOn = (lv, now) => !!lv && lv.at <= now + MIN && (lv.end ? lv.end > now : now - lv.at < 16 * HOUR);
  // 공부 중인 시간 가운데 from(오늘이 시작된 시각) 뒤의 분
  function liveMin(lv, now, from) {
    if (!liveOn(lv, now)) return 0;
    const end = lv.end ? Math.min(lv.end, now) : now;
    return Math.max(0, Math.floor((end - Math.max(lv.at, from || 0)) / MIN));
  }

  /* ---------- 한 사람의 숫자 ----------
   * m: 서버가 보낸 사람 { id, n, d: { 'YYYY-MM-DD': 분 }, lv }
   * ctx: { today: 보는 사람의 오늘 날짜, start: 오늘이 시작된 시각, now }
   * 오늘·이번 주에는 지금 재고 있는 시간도 더한다 (홈 '오늘 공부'처럼)
   */
  function nums(m, ctx) {
    const d = (m && m.d) || {};
    const live = liveOn(m && m.lv, ctx.now);
    const today = Math.min(1440, (d[ctx.today] || 0) + (live ? liveMin(m.lv, ctx.now, ctx.start) : 0));
    const days = weekKeys(ctx.today).map((k) => (k === ctx.today ? today : k > ctx.today ? 0 : d[k] || 0));
    const last = weekKeys(addKey(ctx.today, -7)).map((k) => d[k] || 0);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    return { today, week: sum(days), lastWeek: sum(last), days, last, live };
  }
  // 순위: 많은 순, 같으면 같은 등수(1, 2, 2, 4)이고 먼저 들어온 사람이 위. key: 'today' | 'week' | 'lastWeek'
  function ranked(rows, key) {
    const list = rows.slice().sort((a, b) => b[key] - a[key] || a.order - b.order);
    let rank = 0, prev = null;
    return list.map((r, i) => {
      if (prev === null || r[key] !== prev) rank = i + 1;
      prev = r[key];
      return Object.assign({}, r, { rank });
    });
  }
  // 그룹 한눈에: 사람마다 숫자, 공부 중인 사람, 오늘 하루 목표를 채운 사람, 이번 주 합과 주간 목표 진행
  function summary(g, ctx) {
    const goal = (g && g.goal) || { day: 0, week: 0 };
    const rows = ((g && g.ms) || []).map((m, i) => Object.assign({ m, order: i }, nums(m, ctx)));
    const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
    const weekTotal = sum('week'), lastTotal = sum('lastWeek');
    const left = 7 - ((weekdayOf(ctx.today) + 6) % 7); // 오늘부터 일요일까지 (오늘 포함)
    const remain = Math.max(0, (goal.week || 0) - weekTotal);
    return {
      rows,
      studying: rows.filter((r) => r.live),
      achieved: goal.day ? rows.filter((r) => r.today >= goal.day) : [],
      todayTotal: sum('today'), weekTotal, lastTotal,
      weekPct: goal.week ? Math.min(100, Math.floor((weekTotal / goal.week) * 100)) : 0,
      remain, left, perDay: remain ? Math.ceil(remain / left) : 0,
      weekDone: !!goal.week && weekTotal >= goal.week,
      lastDone: !!goal.week && lastTotal >= goal.week,
    };
  }
  // 내 기록 → 서버에 보낼 날별 분: 오늘까지 최근 15일, 0분인 날은 빼고, 하루 1440분까지
  function myDays(sessions, today, dayKey) {
    const lo = addKey(today, -15), out = {};
    for (const s of sessions || []) {
      if (!s || !(s.minutes > 0) || !s.endedAt) continue;
      const k = dayKey(s.endedAt);
      if (k < lo || k > today) continue;
      out[k] = (out[k] || 0) + s.minutes;
    }
    for (const k of Object.keys(out)) {
      out[k] = Math.min(1440, Math.round(out[k]));
      if (!out[k]) delete out[k];
    }
    return out;
  }

  /* ---------- 받은 값 검사 (서버 worker/src/group.js와 같은 규칙) ---------- */
  const NICK_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _-]+$/;
  const GNAME_RE = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ _\-·.,!?&()#+~]+$/;
  const tidy = (v) => String(v == null ? '' : v).normalize('NFC').replace(/\s+/g, ' ').trim();
  const cleanNick = (v) => { const s = tidy(v); return s && [...s].length <= 12 && NICK_RE.test(s) ? s : null; };
  const cleanGroupName = (v) => { const s = tidy(v); return s && [...s].length <= 20 && GNAME_RE.test(s) ? s : null; };
  const cleanCode = (v) => { const s = String(v == null ? '' : v).toUpperCase().replace(/[\s-]/g, ''); return /^[2-9A-HJKMNP-Z]{6}$/.test(s) ? s : null; };
  // 초대 링크의 주소 끝(#join=K7M2QX 또는 #group&join=K7M2QX)에서 코드 꺼내기
  const linkCode = (hash) => { const m = /^#?(?:group&)?join=([0-9A-Za-z-]{4,12})$/.exec(String(hash || '')); return m ? cleanCode(m[1]) : null; };
  // 얼마나 지났는지: '방금' · '12분 전' · '3시간 전' · '어제' · '3일 전'
  function ago(t, now) {
    const m = Math.floor((now - t) / MIN);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    if (m < 24 * 60) return Math.floor(m / 60) + '시간 전';
    const d = Math.floor(m / (24 * 60));
    return d === 1 ? '어제' : d + '일 전';
  }

  const lib = { CHEERS, WD, addKey, weekStart, weekKeys, weekdayOf, liveOn, liveMin, nums, ranked, summary, myDays, cleanNick, cleanGroupName, cleanCode, linkCode, ago };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  /* =====================================================================
   *  브라우저
   * ===================================================================== */
  const App = root.App;
  if (!App) return;
  const { store, $, esc, toast, ask, choose } = App;
  const doc = root.document;
  const API = 'https://studypromotion-ai.mj-leo6278.workers.dev'; // AI 도우미·벽 튕기기와 같은 서버
  const HOME = 'https://mjleo6278-thecreater.github.io';            // 서버는 이 주소의 앱에서 온 요청만 받는다
  const APP_URL = HOME + '/studypromotion/';
  const remote = () => location.origin === HOME;
  const featOn = () => !root.Features || root.Features.on('group');
  const user = () => (root.Cloud && root.Cloud.user) || null;
  const fmt = (min) => Stats.formatMinutes(min);
  const ic = (name) => App.ic(name);
  const CROWN = '<svg class="gr-crown" viewBox="0 0 20 20" aria-hidden="true"><path d="M3.4 14.8 2.6 6.4l4.2 4L10 3.6l3.2 6.8 4.2-4-.8 8.4z"/><circle cx="2.6" cy="5.6" r="1.4"/><circle cx="10" cy="2.8" r="1.4"/><circle cx="17.4" cy="5.6" r="1.4"/><rect x="3.2" y="15.4" width="13.6" height="3" rx="1"/></svg>';
  const PAWN = '<path d="M7.6 8.6h4.8l-.6 1.3c1.4 1.6 2.4 3.6 2.6 6H5.6c.2-2.4 1.2-4.4 2.6-6z"/><circle cx="10" cy="5.2" r="3"/><rect x="4.2" y="15.6" width="11.6" height="2.8" rx="1"/>';

  const CACHE_KEY = 'studypromotion.group';   // 마지막으로 받은 그룹 { u 계정, at, s 상태 } (인터넷이 없을 때 보여 준다)
  const UI_KEY = 'studypromotion.groupUI';     // { cur 보고 있는 그룹, tab 순위 기간, seen 마지막으로 알린 응원, room 마지막으로 알린 함께 집중 }
  const JOIN_KEY = 'studypromotion.groupJoin'; // 초대 링크로 받은 코드 (로그인·별명을 기다리는 중, js/app.js가 넣는다)
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장이 막힌 환경 */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } };
  const readJSON = (k) => { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } };

  let S = null, sAt = 0, sUid = null; // 서버가 준 마지막 상태 { me: { id, n }, groups, lim }, 받은 시각, 어느 계정의 것인지
  let busy = false, failed = null;    // 받는 중 · 마지막으로 못 받은 까닭
  const saved = readJSON(UI_KEY);
  const ui = Object.assign({ cur: null, tab: 'today', seen: 0, room: 0 }, saved && typeof saved === 'object' ? saved : null);
  const saveUI = () => lsSet(UI_KEY, JSON.stringify(ui));

  // 지금 계정의 상태 (없으면 이 기기에 남겨 둔 마지막 상태)
  function state() {
    const u = user();
    const uid = u ? u.uid : (root.Cloud && root.Cloud.meta && root.Cloud.meta.uid) || null;
    if (!uid) return null;
    if (S && sUid === uid) return S;
    const c = readJSON(CACHE_KEY);
    if (c && c.u === uid && c.s && Array.isArray(c.s.groups)) { S = c.s; sAt = c.at || 0; sUid = uid; return S; }
    return null;
  }
  const inGroups = () => { const s = state(); return !!(s && s.groups.length); };
  const findGroup = (gid) => { const s = state(); return (s && s.groups.find((g) => g.id === gid)) || null; };
  const curGroup = () => { const s = state(); return s && s.groups.length ? s.groups.find((g) => g.id === ui.cur) || s.groups[0] : null; };
  const memberOf = (g, id) => (g && g.ms.find((m) => m.id === id)) || null;
  const nickOf = (g, id) => { const m = memberOf(g, id); return m ? m.n : '나간 사람'; };

  /* ---------- 서버와 주고받기 ---------- */
  const fail = (code) => Object.assign(new Error(code), { code });
  async function call(body, opts) {
    const u = user();
    if (!u) throw fail('login');
    let tok;
    try { tok = await u.getIdToken(); } catch (e) { throw fail('offline'); }
    const headers = { Authorization: 'Bearer ' + tok };
    if (body) headers['Content-Type'] = 'application/json';
    const ctl = root.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 15000);
    try {
      let res;
      try {
        res = await fetch(API + '/group', { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
          signal: ctl ? ctl.signal : undefined, keepalive: !!(opts && opts.keepalive) });
      } catch (e) { throw fail('offline'); }
      let j = null;
      try { j = await res.json(); } catch (e) { /* 아래에서 */ }
      if (!res.ok || !j || !j.ok) throw fail((j && j.error) || 'server');
      return j;
    } finally { clearTimeout(timer); }
  }
  const ERR = {
    offline: '인터넷 연결을 확인해 주세요',
    login: '로그인이 필요해요',
    name: '별명을 먼저 정해 주세요',
    badname: '별명은 한글·영어·숫자로 12자까지 쓸 수 있어요',
    gname: '그룹 이름은 20자까지, 한글·영어·숫자와 · . , ! ? & ( ) # + ~ 만 쓸 수 있어요',
    code: '없는 초대 코드예요. 다시 확인해 주세요',
    full: '그룹이 가득 찼어요 (20명까지)',
    many: '그룹은 5개까지 들 수 있어요',
    banned: '리더가 내보낸 그룹이라 들어갈 수 없어요',
    lead: '리더만 할 수 있어요',
    nogroup: '그룹을 찾지 못했어요. 새로 불러올게요',
    wait: '같은 친구에게는 10분 뒤에 다시 응원할 수 있어요',
    slow: '초대 코드를 너무 많이 틀렸어요. 내일 다시 해 주세요',
    room: '이미 함께 집중하는 중이에요',
    noroom: '함께 집중이 이미 끝났어요',
    busy: '지금은 새 그룹을 만들 수 없어요. 나중에 다시 해 주세요',
    origin: '앱 주소에서만 쓸 수 있어요',
    server: '서버에 문제가 있어요. 잠시 뒤에 다시 해 주세요',
    bad: '요청을 처리하지 못했어요',
  };
  const errText = (code) => ERR[code] || ERR.server;

  function gotState(s) {
    if (!s || !Array.isArray(s.groups)) return;
    const u = user();
    S = s; sAt = Date.now(); sUid = u ? u.uid : sUid; failed = null;
    lsSet(CACHE_KEY, JSON.stringify({ u: sUid, at: sAt, s }));
    if (!s.groups.some((g) => g.id === ui.cur)) { ui.cur = s.groups.length ? s.groups[0].id : null; saveUI(); }
    notice();
    paint();
  }
  function forgetState() {
    S = null; sAt = 0; sUid = null; failed = null; sentSig = null;
    lsDel(CACHE_KEY);
    paint();
  }

  // 보낼 것: 날별 공부 시간과 공부 중 표시
  let device = lsGet('studypromotion.device') || '';
  if (!/^[0-9a-z]{1,16}$/.test(device)) device = '';
  function liveNow() {
    const show = store.get().settings.groupSubject !== false;
    const subj = (id) => { const s = show && id ? App.subjectById(id) : null; return s ? s.name : undefined; };
    const pack = (o) => { Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]); return o; };
    const sw = root.Stopwatch && root.Stopwatch.live ? root.Stopwatch.live() : null;
    if (sw) return pack({ k: 'sw', at: Math.round(sw.from), s: subj(sw.subjectId) });
    const lk = root.Lock && root.Lock.state;
    if (lk && lk.endAt > Date.now()) return pack({ k: 'lock', at: Math.round(lk.startAt), end: Math.round(lk.endAt), s: subj(lk.subjectId) });
    const tm = App.timerLive ? App.timerLive() : null;
    if (tm && tm.end) return pack({ k: 'focus', at: Math.round(tm.from), end: Math.round(tm.end), s: subj(tm.subjectId) });
    return null;
  }
  function payload() {
    if (!device) device = lsGet('studypromotion.device') || ''; // 계정 동기화(js/cloud.js)가 만든 이 기기 번호
    return { op: 'sync', d: myDays(store.get().sessions, App.todayKey(), Stats.dayKey), lv: liveNow(), dv: /^[0-9a-z]{1,16}$/.test(device) ? device : undefined };
  }
  const sigOf = (p) => JSON.stringify([p.d, p.lv]);
  const canTalk = () => remote() && featOn() && !!user() && navigator.onLine !== false;

  let sentSig = null, pushing = false, pushAgain = false, pushTimer = null;
  // 내 숫자가 바뀌었으면 보낸다 (보내면 그룹 상태도 같이 받는다)
  async function push(opts) {
    opts = opts || {};
    if (!canTalk() || !inGroups()) return false;
    if (root.Cloud && root.Cloud.syncing) { schedulePush(3000); return false; } // 계정 기록을 맞추는 중: 다 받은 뒤에 보낸다
    const p = payload(), sig = sigOf(p);
    if (!opts.force && sig === sentSig) return false;
    if (pushing) { pushAgain = true; return false; }
    pushing = true;
    try { gotState(await call(p, { keepalive: !!opts.keepalive })); sentSig = sig; return true; }
    catch (e) { failed = e.code; if (e.code === 'login') forgetState(); return false; }
    finally { pushing = false; if (pushAgain) { pushAgain = false; schedulePush(400); } }
  }
  function schedulePush(ms) { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), ms); }
  // 그룹 상태 받기
  async function pull() {
    if (!canTalk() || busy) return;
    busy = true;
    paint();
    try { gotState(await call(null)); }
    catch (e) { failed = e.code; if (e.code === 'login') forgetState(); }
    finally { busy = false; paint(); }
  }
  // 그룹을 쓰지 않는 사람은 서버를 덜 부른다: 그룹 화면을 보거나, 그룹에 들었거나, 초대 코드를 기다리거나,
  // 이 계정으로 받은 적이 없거나, 받은 지 반나절이 지났을 때만 (다른 기기에서 들어간 그룹도 언젠가는 홈에 보이게)
  function worth() {
    if (App.view === 'group' || cleanCode(lsGet(JOIN_KEY))) return true;
    const s = state();
    return !s || s.groups.length > 0 || Date.now() - sAt > 12 * HOUR;
  }
  // 보낼 것이 있으면 보내면서 받고, 없으면 받기만
  async function refresh() {
    if (inGroups() && sigOf(payload()) !== sentSig && await push()) return;
    await pull();
  }

  /* ---------- 알림: 나에게 온 응원, 새로 시작한 함께 집중 ---------- */
  function notice() {
    if (!S || !S.me) return;
    const now = Date.now();
    if (!ui.seen) ui.seen = now - HOUR; // 처음: 한 시간 안에 온 응원만 알린다
    let newest = null, count = 0, top = ui.seen;
    for (const g of S.groups) {
      for (const c of g.ch || []) {
        if (c.t !== S.me.id || c.at <= ui.seen) continue;
        count++;
        if (!newest || c.at > newest.c.at) newest = { c, g };
        top = Math.max(top, c.at);
      }
    }
    let changed = top !== ui.seen;
    ui.seen = top;
    if (newest) {
      const ch = CHEERS[newest.c.e] || CHEERS[0];
      toast(`${nickOf(newest.g, newest.c.f)} 님이 응원했어요 ${ch.e} ${ch.t}${count > 1 ? ` (응원 ${count}개)` : ''}`, App.view === 'group' ? undefined : { action: '보기', onAction: () => { ui.cur = newest.g.id; saveUI(); App.go('group'); } });
    }
    // 다른 사람이 함께 집중을 막 시작했으면 (10분 안) 한 번 알린다
    for (const g of S.groups) {
      const r = g.room;
      if (!r || r.end <= now || r.at <= (ui.room || 0) || r.by === S.me.id || r.ms.includes(S.me.id) || now - r.at > 10 * MIN) continue;
      ui.room = r.at; changed = true;
      if (featOn() && focusOK()) {
        toast(`${nickOf(g, r.by)} 님이 함께 집중을 시작했어요 · ${Math.ceil((r.end - now) / MIN)}분 남음`, { action: '같이 하기', onAction: () => joinRoom(g.id) });
      }
      break;
    }
    if (changed) saveUI();
  }

  /* ---------- 화면 ---------- */
  const AV_COLORS = ['#e05a4f', '#ef7d3c', '#c18f13', '#45a865', '#2aa893', '#3d96e0', '#5e6cd6', '#9468d9', '#e36299', '#8f7056'];
  function avColor(id) { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
  const initial = (n) => ([...String(n || '?').trim()][0] || '?').toUpperCase();
  function av(m, o) {
    o = o || {};
    return `<span class="gr-av${o.cls ? ' ' + o.cls : ''}${o.crown ? ' won' : ''}" style="--c:${avColor(m.id)}" aria-hidden="true">${esc(initial(m.n))}${o.crown ? CROWN : ''}${o.live ? '<i class="gr-av-live"></i>' : ''}</span>`;
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const clock = (t) => { const d = new Date(t); return d.getHours() + ':' + pad2(d.getMinutes()); };
  const md = (k) => `${+k.slice(5, 7)}/${+k.slice(8)}`;
  const short = (min) => (min < 60 ? min + '분' : (Math.round((min / 60) * 10) / 10) + '시간');
  function ctxNow() {
    const now = Date.now(), off = Stats.dayOffset(), d = new Date(now - off);
    return { now, today: Stats.dayKey(now), start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() + off };
  }
  const KIND = { sw: '스톱워치', focus: '집중 타이머', lock: '폰 잠금' };
  // room: 이 사람이 같이 하고 있는 함께 집중이면 '집중 타이머' 대신 '함께 집중'
  function liveText(lv, now, room) {
    const el = Math.floor(((lv.end ? Math.min(lv.end, now) : now) - lv.at) / MIN);
    const together = room && lv.k === 'focus' && lv.end && Math.abs(lv.end - room.end) < 2 * MIN;
    const parts = [lv.s || (together ? '함께 집중' : KIND[lv.k]) || '공부', el < 1 ? '방금 시작' : fmt(el) + '째'];
    if (lv.end) parts.push(Math.max(1, Math.ceil((lv.end - now) / MIN)) + '분 남음');
    return parts.join(' · ');
  }
  const focusOK = () => !root.Features || root.Features.on('focus'); // 함께 집중은 집중 타이머로 한다
  const roomOf = (g, id, now) => (g && g.room && g.room.end > now && g.room.ms.includes(id) ? g.room : null);
  const meLive = () => !!liveNow();

  function paint() {
    if (App.view === 'group') renderGroup();
    else if (App.view === 'home') renderHome();
  }
  // 1분마다 '몇 분째' 같은 글자만 새로: 입력 중인 칸이 있으면 건드리지 않는다
  function paintTimes() {
    const a = doc.activeElement;
    if (a && a.closest && a.closest('#gr-body') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    paint();
  }

  function renderGroup() {
    const box = $('#gr-body'), head = $('#gr-head-btns');
    if (!box) return;
    const s = state();
    head.innerHTML = '';
    if (!remote()) {
      box.innerHTML = `<div class="panel gr-empty"><h2>그룹은 앱 주소에서 쓸 수 있어요</h2><p class="muted small">친구와 공부 시간을 나누는 그룹은 서버를 거쳐서, 설치한 앱이나 <b>${esc(APP_URL)}</b> 에서 열 때만 돼요.</p></div>`;
      return;
    }
    if (!user()) {
      const waiting = root.Cloud && root.Cloud.meta && root.Cloud.meta.uid && root.Cloud.syncing;
      const code = cleanCode(lsGet(JOIN_KEY));
      box.innerHTML = waiting && s ? dashHTML(s) : `<div class="panel gr-empty">${artHTML()}<h2>${waiting ? '계정을 확인하는 중이에요…' : '로그인하면 친구들과 그룹을 만들 수 있어요'}</h2>
        <p class="muted small">${code ? `초대 코드 <b>${esc(code)}</b>로 들어가려면 먼저 로그인해 주세요. 로그인하면 바로 이어서 물어볼게요.<br>` : ''}그룹은 계정으로 친구를 알아봐요. 다른 사람에게는 이메일이나 계정 이름 대신 직접 정한 별명만 보여요.</p>
        ${waiting ? '' : '<div class="btn-row left"><a class="btn primary" href="#account" data-go="account">로그인하러 가기</a></div>'}</div>`;
      return;
    }
    if (!s) {
      box.innerHTML = `<div class="panel gr-empty"><p class="muted">${busy || !failed ? '그룹을 불러오는 중이에요…' : esc(errText(failed))}</p>${!busy && failed ? '<div class="btn-row left"><button class="btn" type="button" data-gr="retry">다시 불러오기</button></div>' : ''}</div>`;
      if (!busy && !failed) pull();
      return;
    }
    if (s.groups.length) head.innerHTML = `<button class="btn sm gr-add" type="button" data-gr="add" aria-label="그룹 만들기 또는 들어가기"><span aria-hidden="true">＋</span>그룹</button>`;
    box.innerHTML = dashHTML(s);
    askJoinFromLink();
  }
  function artHTML() {
    // 친구 폰 셋이 나란히 전진하고, 앞의 하나는 퀸으로
    const piece = (x, q) => `<g transform="translate(${x} 4)">${q ? '<path d="M3.4 14.8 2.6 6.4l4.2 4L10 3.6l3.2 6.8 4.2-4-.8 8.4z"/><circle cx="2.6" cy="5.6" r="1.4"/><circle cx="10" cy="2.8" r="1.4"/><circle cx="17.4" cy="5.6" r="1.4"/><rect x="3.2" y="15.4" width="13.6" height="3" rx="1"/>' : PAWN}</g>`;
    return `<svg class="gr-art" viewBox="0 0 96 28" aria-hidden="true"><g class="gr-art-sq"><rect x="0" y="22" width="96" height="4" rx="2"/></g><g class="gr-art-p">${piece(4)}${piece(28)}${piece(52)}</g><g class="gr-art-q">${piece(76, true)}</g></svg>`;
  }
  function dashHTML(s) {
    const offline = failed === 'offline' || navigator.onLine === false;
    const note = offline && sAt ? `<p class="gr-stale">${ic('clock')}인터넷이 없어 ${esc(ago(sAt, Date.now()))}에 받은 내용을 보여 줘요</p>` : '';
    if (!s.groups.length) return note + emptyHTML(s);
    const g = curGroup(), ctx = ctxNow(), sm = summary(g, ctx);
    const chips = s.groups.length > 1 ? `<div class="gr-switch" role="tablist" aria-label="그룹 고르기">${s.groups.map((x) => `<button type="button" class="chip${x.id === g.id ? ' active' : ''}" role="tab" aria-selected="${x.id === g.id}" data-gr-pick="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>` : '';
    return note + chips + heroHTML(g, sm, ctx) + goalsHTML(g, sm) + rankHTML(g, sm) + gridHTML(g, sm, ctx) + cheersHTML(g, ctx) + mineHTML(s, g);
  }
  function emptyHTML(s) {
    return `<div class="panel gr-empty">${artHTML()}<h2>친구들과 같이 공부해요</h2>
      <ul class="gr-perks">
        <li><b>공부 시간 나누기</b><span>서로의 오늘·이번 주 공부 시간과 순위를 봐요</span></li>
        <li><b>지금 공부 중</b><span>누가 무슨 과목을 공부하고 있는지 바로 보여요</span></li>
        <li><b>함께 정한 목표</b><span>한 사람당 하루 목표와 이번 주에 다 같이 채울 시간을 정해요</span></li>
        <li><b>함께 집중</b><span>같은 시각에 끝나는 집중 타이머를 같이 켜요</span></li>
      </ul>
      <div class="btn-row left"><button class="btn primary" type="button" data-gr="create">그룹 만들기</button><button class="btn" type="button" data-gr="join">초대 코드로 들어가기</button></div>
      <p class="muted small gr-privacy">그룹 사람들에게는 내가 정한 별명${s.me && s.me.n ? `(<b>${esc(s.me.n)}</b>)` : ''}과 날마다 공부한 시간, 공부 중 표시만 보여요. 이메일·계정 이름·할 일·시험 범위는 보이지 않아요.</p></div>`;
  }
  function heroHTML(g, sm, ctx) {
    const lead = memberOf(g, g.lead);
    const list = sm.studying.length
      ? `<ul class="gr-live-list">${sm.studying.map((r) => `<li><button type="button" class="gr-live-btn" data-gr-m="${esc(r.m.id)}">${av(r.m, { live: true })}<span><b>${esc(r.m.n)}${r.m.id === S.me.id ? ' <em>나</em>' : ''}</b><small>${esc(liveText(r.m.lv, ctx.now, roomOf(g, r.m.id, ctx.now)))}</small></span></button></li>`).join('')}</ul>`
      : '<p class="gr-none muted small">지금은 공부 중인 사람이 없어요. 먼저 시작해 볼까요?</p>';
    const inRoom = g.room && g.room.end > ctx.now && g.room.ms.includes(S.me.id);
    const go = meLive() || inRoom ? '' : `<div class="gr-go"><button class="btn primary sm" type="button" data-gr="study">${ic('play')}공부 시작하기</button>${focusOK() && !(g.room && g.room.end > ctx.now) ? `<button class="btn sm" type="button" data-gr="room-start">${ic('timer')}함께 집중</button>` : ''}</div>`;
    return `<div class="panel gr-hero">
      <div class="gr-top">
        <div class="gr-name"><h2>${esc(g.name)}</h2><p class="muted small">${g.ms.length}명 · 리더 ${esc(lead ? lead.n : '?')}</p></div>
        <button class="btn sm" type="button" data-gr="invite">${ic('link')}초대</button>
        <button class="icon-btn gr-more" type="button" data-gr="menu" aria-label="그룹 메뉴">${ic('more')}</button>
      </div>
      <div class="gr-live">
        <p class="gr-live-head"><span class="gr-dot${sm.studying.length ? ' on' : ''}" aria-hidden="true"></span>지금 공부 중 <b>${sm.studying.length}명</b></p>
        ${list}
      </div>
      ${roomHTML(g, ctx)}${go}
    </div>`;
  }
  function roomHTML(g, ctx) {
    const r = g.room;
    if (!r || r.end <= ctx.now) return '';
    const inIt = r.ms.includes(S.me.id);
    const people = r.ms.map((id) => memberOf(g, id)).filter(Boolean);
    const btn = inIt ? `<span class="gr-room-me">${ic('check')}같이 하는 중</span><button class="btn link inline" type="button" data-gr="room-leave">그만하기</button>`
      : focusOK() ? '<button class="btn primary sm" type="button" data-gr="room-join">같이 하기</button>' : '';
    return `<div class="gr-room${inIt ? ' in' : ''}">
      <div class="gr-room-head">${ic('timer')}<b>함께 집중</b><span class="gr-room-left">${Math.max(1, Math.ceil((r.end - ctx.now) / MIN))}분 남음</span></div>
      <p class="muted small">${esc(nickOf(g, r.by))} 님이 시작 · ${clock(r.end)}에 같이 끝나요</p>
      <div class="gr-room-foot"><span class="gr-room-people">${people.map((m) => av(m, { cls: 'sm' })).join('')}<small>${people.length}명</small></span>${btn}</div>
    </div>`;
  }
  function goalsHTML(g, sm) {
    const goal = g.goal || {}, lead = g.lead === S.me.id;
    const edit = lead ? `<button class="btn link inline" type="button" data-gr="goal">${goal.day || goal.week ? '바꾸기' : '정하기'}</button>` : '';
    let html = `<div class="panel gr-goals"><div class="panel-head"><h2>함께 정한 목표</h2>${edit}</div>`;
    if (!goal.day && !goal.week) {
      return html + `<p class="gr-none muted small">${lead ? '한 사람당 하루 목표와 이번 주에 다 같이 채울 시간을 정해 보세요.' : '아직 목표가 없어요. 리더가 정하면 여기에 보여요.'}</p></div>`;
    }
    if (goal.day) {
      html += `<div class="gr-goal">
        <div class="gr-goal-top"><b>하루 목표</b><span class="muted small">한 사람당 ${fmt(goal.day)}</span></div>
        <p class="gr-goal-val">오늘 <b>${sm.achieved.length}</b><span>/ ${g.ms.length}명</span> 승급${sm.achieved.length && sm.achieved.length === g.ms.length ? ' · 모두 달성 ♛' : ''}</p>
        <ul class="gr-crowns">${sm.rows.map((r) => { const ok = r.today >= goal.day; return `<li class="${ok ? 'ok' : ''}">${av(r.m, { crown: ok })}<small>${ok ? '달성' : Math.floor((r.today / goal.day) * 100) + '%'}</small></li>`; }).join('')}</ul>
      </div>`;
    }
    if (goal.week) {
      html += `<div class="gr-goal">
        <div class="gr-goal-top"><b>주간 목표</b><span class="muted small">다 같이 ${fmt(goal.week)}</span></div>
        <div class="gr-week-row"><span class="pawn-track" aria-label="진행률 ${sm.weekPct}%">${App.pawnTrack(sm.weekDone ? 100 : sm.weekPct)}</span><b>${sm.weekPct}%</b></div>
        <p class="muted small">${sm.weekDone ? `이번 주 ${fmt(sm.weekTotal)} · 목표 달성! 다 같이 퀸으로 승급했어요 ♛` : `지금까지 ${fmt(sm.weekTotal)} · 남은 ${fmt(sm.remain)} · 일요일까지 ${sm.left}일, 하루 ${fmt(sm.perDay)}씩`}</p>
      </div>`;
    }
    return html + '</div>';
  }
  function rankHTML(g, sm) {
    const tab = ['today', 'week', 'lastWeek'].includes(ui.tab) ? ui.tab : 'today';
    const goal = g.goal || {};
    const list = ranked(sm.rows, tab);
    const top = Math.max(1, ...list.map((r) => r[tab]));
    const target = tab === 'today' ? goal.day : tab === 'week' && goal.day ? goal.day * 7 : 0;
    const rows = list.map((r) => {
      const m = r.m, me = m.id === S.me.id, v = r[tab];
      const w = target ? Math.min(100, Math.round((v / target) * 100)) : Math.round((v / top) * 100);
      const sub = [m.id === g.lead ? '리더' : '', r.live && tab !== 'lastWeek' ? '공부 중' + (m.lv.s ? ' · ' + m.lv.s : '') : ''].filter(Boolean).join(' · ');
      return `<li class="gr-row${me ? ' me' : ''}${r.live ? ' live' : ''}"><button type="button" class="gr-row-btn" data-gr-m="${esc(m.id)}" aria-label="${r.rank}등 ${esc(m.n)} ${fmt(v)}">
        <span class="gr-rank${r.rank === 1 && v > 0 ? ' first' : ''}">${r.rank}</span>
        ${av(m, { live: r.live && tab !== 'lastWeek', crown: tab === 'today' && goal.day && r.today >= goal.day })}
        <span class="gr-who"><b>${esc(m.n)}${me ? '<em>나</em>' : ''}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="gr-min">${fmt(v)}</span>
        <span class="gr-bar" aria-hidden="true"><i style="width:${w}%"></i></span>
      </button></li>`;
    }).join('');
    const tabs = [['today', '오늘'], ['week', '이번 주'], ['lastWeek', '지난주']];
    let line = '';
    if (tab === 'today') line = `다 같이 오늘 ${fmt(sm.todayTotal)}`;
    else if (tab === 'week') line = `다 같이 이번 주 ${fmt(sm.weekTotal)}`;
    else line = `다 같이 지난주 ${fmt(sm.lastTotal)}${goal.week ? (sm.lastDone ? ' · 주간 목표 달성 ♛' : ` · 주간 목표의 ${Math.floor((sm.lastTotal / goal.week) * 100)}%`) : ''}`;
    return `<div class="panel gr-ranks">
      <div class="panel-head"><h2>공부 시간</h2><div class="seg gr-tabs" role="group" aria-label="기간">${tabs.map(([k, t]) => `<button class="seg-btn${k === tab ? ' active' : ''}" type="button" data-gr-tab="${k}" aria-pressed="${k === tab}">${t}</button>`).join('')}</div></div>
      <p class="gr-sum muted small">${esc(line)}</p>
      <ol class="gr-list">${rows}</ol>
      <p class="gr-tip muted small">이름을 누르면 이번 주 기록을 보고 응원을 보낼 수 있어요.</p>
    </div>`;
  }
  const level = (v) => (v <= 0 ? 0 : v < 60 ? 1 : v < 120 ? 2 : v < 240 ? 3 : 4); // 통계 탭 공부 달력과 같은 단계
  function gridHTML(g, sm, ctx) {
    const keys = weekKeys(ctx.today), goal = g.goal || {};
    const head = keys.map((k) => `<th scope="col"${k === ctx.today ? ' class="today"' : ''}>${WD[weekdayOf(k)]}</th>`).join('');
    const body = sm.rows.map((r) => `<tr${r.m.id === S.me.id ? ' class="me"' : ''}><th scope="row">${esc(r.m.n)}</th>${r.days.map((v, i) => {
      const k = keys[i], fut = k > ctx.today, ok = !fut && goal.day && v >= goal.day;
      return `<td class="${fut ? 'fut' : 'lv' + level(v)}${k === ctx.today ? ' today' : ''}${ok ? ' ok' : ''}" title="${esc(r.m.n)} ${md(k)} ${fut ? '' : fmt(v)}">${ok ? CROWN : ''}</td>`;
    }).join('')}<td class="gr-grid-sum">${short(r.week)}</td></tr>`).join('');
    return `<div class="panel gr-week">
      <div class="panel-head"><h2>이번 주 출석</h2><span class="muted small">${md(keys[0])} ~ ${md(keys[6])}</span></div>
      <div class="gr-grid-wrap"><table class="gr-grid"><thead><tr><th scope="col"><span class="sr">이름</span></th>${head}<th scope="col">합계</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="gr-legend muted small"><span><i class="lv1"></i>1시간 미만</span><span><i class="lv2"></i>1~2시간</span><span><i class="lv3"></i>2~4시간</span><span><i class="lv4"></i>4시간 이상</span>${goal.day ? `<span class="gr-legend-crown">${CROWN}하루 목표 달성</span>` : ''}</p>
    </div>`;
  }
  function cheersHTML(g, ctx) {
    const list = (g.ch || []).slice().sort((a, b) => b.at - a.at).slice(0, 6);
    if (!list.length) return '';
    return `<div class="panel gr-cheers"><div class="panel-head"><h2>응원</h2><span class="muted small">최근 일주일</span></div><ul>${list.map((c) => {
      const ch = CHEERS[c.e] || CHEERS[0], toMe = c.t === S.me.id;
      return `<li${toMe ? ' class="to-me"' : ''}><span class="gr-cheer-e" aria-hidden="true">${ch.e}</span><span class="gr-cheer-t"><b>${esc(c.f === S.me.id ? '나' : nickOf(g, c.f))}</b> → <b>${esc(toMe ? '나' : nickOf(g, c.t))}</b> ${esc(ch.t)}</span><small class="muted">${esc(ago(c.at, ctx.now))}</small></li>`;
    }).join('')}</ul></div>`;
  }
  function mineHTML(s, g) {
    const sub = store.get().settings.groupSubject !== false;
    return `<div class="panel gr-mine">
      <div class="gr-mine-row"><span class="muted small">내 별명</span><b>${esc(s.me.n || '')}</b><button class="btn link inline" type="button" data-gr="nick">바꾸기</button></div>
      <label class="check-field"><input type="checkbox" id="gr-sub"${sub ? ' checked' : ''}> 공부 중일 때 과목 이름도 보이기</label>
      <p class="muted small gr-privacy">그룹 사람들에게는 별명과 날마다 공부한 시간, 공부 중 표시만 보여요. 이메일·계정 이름·할 일·시험 범위는 보이지 않아요.</p>
      <button class="btn link danger" type="button" data-gr="leave">${esc(g.name)} 나가기</button>
    </div>`;
  }

  /* ---------- 홈 '우리 그룹' 칸 ---------- */
  function renderHome() {
    const panel = $('#h-group-panel');
    if (!panel) return;
    const s = remote() && featOn() ? state() : null;
    const g = s && s.groups.length ? curGroup() : null;
    panel.hidden = !g;
    if (!g) return;
    const ctx = ctxNow(), sm = summary(g, ctx), goal = g.goal || {};
    const top = ranked(sm.rows, 'today').slice(0, 3);
    const bits = [sm.studying.length ? `<span class="gr-dot on" aria-hidden="true"></span>${sm.studying.length}명 공부 중` : '지금 공부 중인 사람 없음'];
    if (goal.day) bits.push(`오늘 승급 ${sm.achieved.length}/${g.ms.length}명`);
    if (goal.week) bits.push(`이번 주 ${sm.weekPct}%`);
    const r = g.room && g.room.end > ctx.now ? g.room : null;
    $('#h-group-title').textContent = g.name;
    $('#h-group').innerHTML = `<p class="gr-home-sub muted small">${bits.join(' · ')}</p>
      <ol class="gr-mini">${top.map((x) => `<li${x.m.id === S.me.id ? ' class="me"' : ''}><span class="gr-rank${x.rank === 1 && x.today > 0 ? ' first' : ''}">${x.rank}</span>${av(x.m, { cls: 'sm', live: x.live, crown: goal.day && x.today >= goal.day })}<b>${esc(x.m.n)}</b><span class="gr-min">${fmt(x.today)}</span></li>`).join('')}</ol>
      ${r ? `<div class="gr-room mini${r.ms.includes(S.me.id) ? ' in' : ''}"><span>${ic('timer')}<b>함께 집중</b> ${Math.max(1, Math.ceil((r.end - ctx.now) / MIN))}분 남음 · ${r.ms.length}명</span>${r.ms.includes(S.me.id) || !focusOK() ? '' : `<button class="btn primary sm" type="button" data-gr-home="room-join" data-g="${esc(g.id)}">같이 하기</button>`}</div>` : ''}`;
  }

  /* ---------- 입력 창 (만들기·들어가기·별명·목표) ---------- */
  let dlgSubmit = null;
  function openDlg(o) {
    const dlg = $('#gr-dlg');
    $('#gr-dlg-h').textContent = o.title;
    $('#gr-dlg-body').innerHTML = o.body;
    $('#gr-dlg-ok').textContent = o.ok || '확인';
    $('#gr-dlg-ok').disabled = false;
    setErr('');
    dlgSubmit = o.submit;
    dlg.hidden = false;
    if (root.UI) root.UI.enhanceAll($('#gr-dlg-body'));
    // 처음 초점: 첫 입력 칸 (o.focus === false면 확인 단추. 초대 링크로 코드가 이미 들어 있을 때 키보드가 뜨지 않게)
    const f = o.focus === false ? $('#gr-dlg-ok') : $('#gr-dlg-body').querySelector('input:not([type=hidden]):not([type=checkbox])');
    if (f) setTimeout(() => { try { f.focus(); } catch (e) { /* 무시 */ } }, 30);
    if (o.onOpen) o.onOpen();
  }
  function closeDlg() { $('#gr-dlg').hidden = true; dlgSubmit = null; }
  function setErr(msg) { const e = $('#gr-dlg-err'); e.textContent = msg || ''; e.hidden = !msg; }
  $('#gr-dlg-cancel').addEventListener('click', closeDlg);
  $('#gr-form').addEventListener('input', (e) => {
    setErr('');
    if (e.target && e.target.id === 'gr-code') { const pk = $('#gr-peek'); if (pk) pk.hidden = true; $('#gr-dlg-ok').textContent = '확인'; }
  });
  $('#gr-dlg').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeDlg(); } });
  $('#gr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!dlgSubmit) return;
    const ok = $('#gr-dlg-ok');
    if (ok.disabled) return;
    ok.disabled = true;
    try { if (await dlgSubmit()) closeDlg(); }
    catch (err) { setErr(errText(err.code)); }
    finally { ok.disabled = false; }
  });

  // 별명 칸: 아직 별명이 없을 때만. 벽 튕기기 순위에 쓴 별명이 있으면 미리 넣어 둔다
  function nickField() {
    let hint = '';
    try { const o = JSON.parse(lsGet('studypromotion.eggName') || 'null'); hint = (o && cleanNick(o.n)) || ''; } catch (e) { /* 무시 */ }
    return `<label class="gr-f"><span class="gr-lab">내 별명 <small>그룹 사람들에게 보일 이름</small></span><input id="gr-nick" maxlength="12" autocomplete="nickname" spellcheck="false" placeholder="예: 공부왕" value="${esc(hint)}" enterkeyhint="done"></label>`;
  }
  const needNick = () => !(S && S.me && S.me.n);
  const DAY_OPTS = [0, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600];
  const WEEK_OPTS = [0, 600, 1200, 1800, 2400, 3000, 3600, 4800, 6000, 9000, 12000, 18000];
  function goalFields(goal, count) {
    goal = goal || { day: 0, week: 0 };
    const opt = (list, cur) => (list.includes(cur) ? list : list.concat(cur).sort((a, b) => a - b))
      .map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v ? fmt(v) : '정하지 않음'}</option>`).join('');
    return `<div class="gr-f2">
      <label class="gr-f"><span class="gr-lab">하루 목표 <small>한 사람당</small></span><select id="gr-goal-day">${opt(DAY_OPTS, goal.day || 0)}</select></label>
      <label class="gr-f"><span class="gr-lab">주간 목표 <small>다 같이 한 주에</small></span><select id="gr-goal-week">${opt(WEEK_OPTS, goal.week || 0)}</select></label>
    </div><p class="muted small gr-goal-hint" id="gr-goal-hint" data-n="${count || 1}"></p>`;
  }
  function goalHint() {
    const el = $('#gr-goal-hint');
    if (!el) return;
    const day = +$('#gr-goal-day').value, n = +el.dataset.n || 1;
    el.textContent = day ? `참고: ${n}명이 하루 ${fmt(day)}씩 5일 공부하면 한 주에 ${fmt(day * 5 * n)}이에요.` : '하루 목표를 채운 사람은 순위와 출석표에 왕관(♛)이 붙어요.';
  }
  doc.addEventListener('change', (e) => { if (e.target && e.target.id === 'gr-goal-day') goalHint(); });
  const readGoal = () => ({ day: +$('#gr-goal-day').value || 0, week: +$('#gr-goal-week').value || 0 });

  function openCreate() {
    if (S && S.lim && S.groups.length >= S.lim.groups) return toast(ERR.many);
    openDlg({
      title: '그룹 만들기', ok: '만들기',
      body: `<label class="gr-f"><span class="gr-lab">그룹 이름</span><input id="gr-gname" maxlength="20" autocomplete="off" placeholder="예: 수학 스터디, 수능 D-100" enterkeyhint="next"></label>
        ${needNick() ? nickField() : ''}${goalFields({ day: 180, week: 0 }, 1)}
        <p class="muted small">만든 사람이 리더가 돼요. 이름과 목표는 나중에 바꿀 수 있어요.</p>`,
      onOpen: goalHint,
      submit: async () => {
        const name = cleanGroupName($('#gr-gname').value);
        if (!name) { setErr(ERR.gname); $('#gr-gname').focus(); return false; }
        const body = { op: 'create', name, goal: readGoal() };
        if (needNick()) { const n = cleanNick($('#gr-nick').value); if (!n) { setErr(ERR.badname); $('#gr-nick').focus(); return false; } body.n = n; }
        const s = await call(body);
        ui.cur = s.made; saveUI();
        gotState(s);
        push({ force: true });
        setTimeout(() => openInvite(s.made, true), 250);
        return true;
      },
    });
  }
  function openJoin(code) {
    if (S && S.lim && S.groups.length >= S.lim.groups) return toast(ERR.many);
    let peeked = null;
    openDlg({
      title: '초대 코드로 들어가기', ok: '확인', focus: !code,
      body: `<label class="gr-f"><span class="gr-lab">초대 코드 <small>친구에게 받은 6자리</small></span><input id="gr-code" class="gr-code-in" maxlength="11" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="예: K7M2QX" value="${esc(code || '')}" enterkeyhint="go"></label>
        <div id="gr-peek" class="gr-peek" hidden></div>${needNick() ? nickField() : ''}`,
      onOpen: () => { if (code) $('#gr-dlg-ok').click(); },
      submit: async () => {
        const c = cleanCode($('#gr-code').value);
        if (!c) { setErr('초대 코드 6자리를 적어 주세요 (숫자 0·1과 영어 O·I·L은 쓰지 않아요)'); $('#gr-code').focus(); return false; }
        if (!peeked || peeked.code !== c) { // 먼저 어떤 그룹인지 보여 준다
          setErr('');
          const p = (await call({ op: 'peek', code: c })).peek;
          peeked = { code: c, p };
          const box = $('#gr-peek');
          box.hidden = false;
          const goal = [p.goal && p.goal.day ? `하루 ${fmt(p.goal.day)}` : '', p.goal && p.goal.week ? `한 주 다 같이 ${fmt(p.goal.week)}` : ''].filter(Boolean).join(' · ');
          box.innerHTML = `<b>${esc(p.name)}</b><span class="muted small">${p.count}/${p.max}명${p.lead ? ` · 리더 ${esc(p.lead)}` : ''}${goal ? ` · 목표 ${esc(goal)}` : ''}</span>`;
          if (p.member) { $('#gr-dlg-ok').textContent = '그룹 보기'; return false; }
          if (p.banned) { setErr(ERR.banned); return false; }
          if (p.full) { setErr(ERR.full); return false; }
          $('#gr-dlg-ok').textContent = '들어가기';
          const nk = $('#gr-nick');
          if (nk && !cleanNick(nk.value)) setTimeout(() => { try { nk.focus(); } catch (e) { /* 무시 */ } }, 30);
          return false;
        }
        if (peeked.p.member) { ui.cur = peeked.p.id; saveUI(); lsDel(JOIN_KEY); paint(); return true; }
        const body = { op: 'join', code: c };
        if (needNick()) { const n = cleanNick($('#gr-nick').value); if (!n) { setErr(ERR.badname); $('#gr-nick').focus(); return false; } body.n = n; }
        const s = await call(body);
        lsDel(JOIN_KEY);
        ui.cur = s.joined; saveUI();
        gotState(s);
        push({ force: true });
        toast(`‘${peeked.p.name}’ 그룹에 들어왔어요`);
        return true;
      },
    });
  }
  // 초대 링크로 열었으면(코드를 맡겨 둠) 들어갈지 묻는다
  function askJoinFromLink() {
    const code = cleanCode(lsGet(JOIN_KEY));
    if (!code) { if (lsGet(JOIN_KEY)) lsDel(JOIN_KEY); return; }
    if (!$('#gr-dlg').hidden || !S) return;
    const g = S.groups.find((x) => x.code === code);
    if (g) { lsDel(JOIN_KEY); ui.cur = g.id; saveUI(); renderGroup(); return; }
    lsDel(JOIN_KEY);
    setTimeout(() => openJoin(code), 0);
  }
  function openNick() {
    openDlg({
      title: '내 별명', ok: '저장',
      body: `<label class="gr-f"><span class="gr-lab">그룹 사람들에게 보일 이름 <small>한글·영어·숫자 12자까지, 모든 그룹에 같아요</small></span><input id="gr-nick" maxlength="12" spellcheck="false" value="${esc((S && S.me && S.me.n) || '')}" enterkeyhint="done"></label>`,
      submit: async () => {
        const n = cleanNick($('#gr-nick').value);
        if (!n) { setErr(ERR.badname); return false; }
        if (S && S.me && n === S.me.n) return true;
        gotState(await call({ op: 'name', n }));
        toast('별명을 바꿨어요');
        return true;
      },
    });
  }
  function openGoal(gid) {
    const g = findGroup(gid);
    if (!g) return;
    openDlg({
      title: '함께 정한 목표', ok: '저장',
      body: goalFields(g.goal, g.ms.length) + '<p class="muted small">바꾼 목표는 그룹 사람 모두에게 바로 보여요.</p>',
      onOpen: goalHint,
      submit: async () => { gotState(await call({ op: 'edit', g: gid, goal: readGoal() })); toast('목표를 바꿨어요'); return true; },
    });
  }
  function openRename(gid) {
    const g = findGroup(gid);
    if (!g) return;
    openDlg({
      title: '그룹 이름 바꾸기', ok: '저장',
      body: `<label class="gr-f"><span class="gr-lab">그룹 이름</span><input id="gr-gname" maxlength="20" autocomplete="off" value="${esc(g.name)}" enterkeyhint="done"></label>`,
      submit: async () => {
        const name = cleanGroupName($('#gr-gname').value);
        if (!name) { setErr(ERR.gname); return false; }
        gotState(await call({ op: 'edit', g: gid, name }));
        toast('그룹 이름을 바꿨어요');
        return true;
      },
    });
  }

  /* ---------- 시트: 초대, 사람, 메뉴 ---------- */
  const inviteURL = (code) => APP_URL + '#join=' + code;
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래 방법으로 */ }
    try {
      const t = doc.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      doc.body.appendChild(t); t.select();
      const ok = doc.execCommand('copy');
      t.remove();
      return ok;
    } catch (e) { return false; }
  }
  function openInvite(gid, fresh) {
    const g = findGroup(gid);
    if (!g || !root.UI) return;
    const lead = g.lead === S.me.id;
    const body = `<div class="gr-inv">
      ${fresh ? '<p class="gr-inv-new">그룹을 만들었어요! 친구에게 초대 링크를 보내 보세요.</p>' : ''}
      <p class="gr-inv-lab muted small">초대 코드</p>
      <p class="gr-inv-code" aria-label="초대 코드 ${esc(g.code.split('').join(' '))}">${esc(g.code.slice(0, 3))}<span aria-hidden="true"></span>${esc(g.code.slice(3))}</p>
      <div class="gr-inv-btns"><button class="btn primary" type="button" data-inv="share">${ic('link')}초대 링크 보내기</button><button class="btn" type="button" data-inv="copy">코드 복사</button></div>
      <p class="muted small">링크를 받은 친구가 누르면 앱이 열리고 이 그룹에 들어갈지 물어봐요. 그룹 탭의 <b>초대 코드로 들어가기</b>에 코드를 적어도 돼요. 코드를 아는 사람은 누구나 들어올 수 있으니 같이 공부할 친구에게만 보내 주세요.</p>
      ${lead ? '<button class="btn link" type="button" data-inv="new">초대 코드 새로 만들기</button>' : ''}
    </div>`;
    root.UI.openSheet({
      title: `${g.name} 초대하기`, body, cls: 'gr-sheet',
      onClick: async (e, close) => {
        const b = e.target.closest('[data-inv]');
        if (!b) return;
        const what = b.dataset.inv;
        const url = inviteURL(g.code);
        if (what === 'share') {
          const text = `스터디 프로모션 ‘${g.name}’ 그룹에서 같이 공부해요! 초대 코드 ${g.code}`;
          if (navigator.share) {
            try { await navigator.share({ title: '스터디 프로모션 그룹 초대', text, url }); return; }
            catch (err) { if (err && err.name === 'AbortError') return; }
          }
          toast((await copyText(text + '\n' + url)) ? '초대 링크를 복사했어요. 메신저에 붙여 넣어 보내세요' : url);
        } else if (what === 'copy') toast((await copyText(g.code)) ? `초대 코드 ${g.code}를 복사했어요` : g.code);
        else if (what === 'new') {
          close();
          if (!(await ask('초대 코드를 새로 만들까요?\n예전 코드와 링크로는 더 들어올 수 없어요. 이미 들어온 사람은 그대로예요.', { ok: '새로 만들기' }))) return;
          if (await act({ op: 'code', g: gid }, '초대 코드를 새로 만들었어요')) openInvite(gid);
        }
      },
    });
  }
  function openMember(gid, mid) {
    const g = findGroup(gid), m = memberOf(g, mid);
    if (!m || !root.UI) return;
    const ctx = ctxNow(), r = nums(m, ctx), me = mid === S.me.id, lead = g.lead === S.me.id, goal = g.goal || {};
    const keys = weekKeys(ctx.today);
    const max = Math.max(goal.day || 0, ...r.days, 60);
    const status = [m.id === g.lead ? '리더' : '', r.live ? '공부 중 · ' + liveText(m.lv, ctx.now, roomOf(g, m.id, ctx.now)) : m.up ? `마지막 기록 ${ago(m.up, ctx.now)}` : '', `${md(Stats.dayKey(m.at))}에 들어옴`].filter(Boolean).join(' · ');
    const bars = r.days.map((v, i) => {
      const k = keys[i], fut = k > ctx.today;
      return `<div class="gr-bc${k === ctx.today ? ' today' : ''}${fut ? ' fut' : ''}"><span class="gr-bt"><span class="gr-bv${v ? '' : ' zero'}" style="height:${fut ? 0 : Math.max(v ? 4 : 0, Math.round((v / max) * 100))}%">${goal.day && v >= goal.day ? CROWN : ''}</span></span><small>${WD[weekdayOf(k)]}</small></div>`;
    }).join('');
    const body = `<div class="gr-ms">
      <div class="gr-ms-top">${av(m, { cls: 'lg', live: r.live })}<div><b>${esc(m.n)}${me ? ' <em>나</em>' : ''}</b><small class="muted">${esc(status)}</small></div></div>
      <div class="gr-ms-nums"><div><small>오늘</small><b>${fmt(r.today)}</b></div><div><small>이번 주</small><b>${fmt(r.week)}</b></div><div><small>지난주</small><b>${fmt(r.lastWeek)}</b></div></div>
      <div class="gr-chart" role="img" aria-label="이번 주 날마다 공부 시간">${goal.day ? `<i class="gr-goal-line" style="bottom:calc(18px + (100% - 34px) * ${(goal.day / max).toFixed(3)})"><span>${fmt(goal.day)}</span></i>` : ''}${bars}</div>
      ${me ? '' : `<p class="gr-ms-h">응원 보내기</p><div class="gr-cheer-btns">${CHEERS.map((c, i) => `<button type="button" class="gr-cheer-btn" data-gr-cheer="${i}"><span aria-hidden="true">${c.e}</span>${esc(c.t)}</button>`).join('')}</div>`}
      ${lead && !me ? '<div class="gr-ms-lead"><button class="btn sm" type="button" data-gr-act="lead">리더 넘기기</button><button class="btn sm danger" type="button" data-gr-act="kick">그룹에서 내보내기</button></div>' : ''}
    </div>`;
    root.UI.openSheet({
      title: me ? '내 기록' : `${m.n} 님`, body, cls: 'gr-sheet', focusSel: '.gr-cheer-btn, .ui-x',
      onClick: async (e, close) => {
        const c = e.target.closest('[data-gr-cheer]');
        if (c) { close(); const ch = CHEERS[+c.dataset.grCheer]; await act({ op: 'cheer', g: gid, m: mid, e: +c.dataset.grCheer }, `${m.n} 님에게 ${ch.e} ${ch.t}를 보냈어요`); return; }
        const a = e.target.closest('[data-gr-act]');
        if (!a) return;
        close();
        if (a.dataset.grAct === 'kick') {
          if (await ask(`${m.n} 님을 그룹에서 내보낼까요?\n다시 들어오려면 리더가 그룹 메뉴의 ‘내보낸 사람 다시 받기’를 눌러야 해요.`, { ok: '내보내기', danger: true })) await act({ op: 'kick', g: gid, m: mid }, `${m.n} 님을 내보냈어요`);
        } else if (await ask(`${m.n} 님에게 리더를 넘길까요?\n그룹 이름·목표·초대 코드는 새 리더가 바꿔요.`, { ok: '리더 넘기기' })) await act({ op: 'lead', g: gid, m: mid }, `${m.n} 님이 리더가 됐어요`);
      },
    });
  }
  async function openMenu(gid) {
    const g = findGroup(gid);
    if (!g) return;
    const lead = g.lead === S.me.id;
    const pick = await choose(g.name, [
      { value: 'invite', label: '초대하기', hint: `초대 코드 ${g.code}` },
      lead ? { value: 'rename', label: '그룹 이름 바꾸기' } : null,
      lead ? { value: 'goal', label: '목표 바꾸기', hint: '한 사람당 하루 목표 · 다 같이 주간 목표' } : null,
      lead ? { value: 'code', label: '초대 코드 새로 만들기', hint: '예전 코드로는 더 못 들어와요' } : null,
      lead && g.ban ? { value: 'unban', label: '내보낸 사람 다시 받기', hint: `${g.ban}명이 다시 들어올 수 있게 해요` } : null,
      { value: 'nick', label: '내 별명 바꾸기', hint: S.me.n || '' },
      { value: 'leave', label: '그룹 나가기' },
      lead ? { value: 'drop', label: '그룹 없애기', hint: '모든 사람이 그룹에서 빠지고 되돌릴 수 없어요' } : null,
    ].filter(Boolean));
    if (!pick) return;
    if (pick === 'invite') openInvite(gid);
    else if (pick === 'rename') openRename(gid);
    else if (pick === 'goal') openGoal(gid);
    else if (pick === 'nick') openNick();
    else if (pick === 'leave') leave(gid);
    else if (pick === 'code') {
      if (await ask('초대 코드를 새로 만들까요?\n예전 코드와 링크로는 더 들어올 수 없어요. 이미 들어온 사람은 그대로예요.', { ok: '새로 만들기' })) {
        if (await act({ op: 'code', g: gid }, '초대 코드를 새로 만들었어요')) openInvite(gid);
      }
    } else if (pick === 'unban') await act({ op: 'unban', g: gid }, '내보낸 사람도 다시 들어올 수 있어요');
    else if (pick === 'drop') {
      if (await ask(`‘${g.name}’ 그룹을 없앨까요?\n${g.ms.length}명 모두 그룹에서 빠지고 되돌릴 수 없어요. 각자의 공부 기록은 그대로예요.`, { ok: '그룹 없애기', danger: true })) await act({ op: 'drop', g: gid }, '그룹을 없앴어요');
    }
  }
  async function leave(gid) {
    const g = findGroup(gid);
    if (!g) return;
    const next = g.lead === S.me.id ? g.ms.find((m) => m.id !== S.me.id) : null;
    const msg = `‘${g.name}’ 그룹에서 나갈까요?\n그룹 사람들에게 내 공부 시간이 더는 보이지 않아요.` + (next ? `\n리더는 ${next.n} 님이 이어받아요.` : g.ms.length === 1 ? '\n혼자 남은 그룹이라 그룹이 없어져요.' : '');
    if (await ask(msg, { ok: '나가기', danger: true })) await act({ op: 'leave', g: gid }, '그룹에서 나왔어요');
  }
  // 서버에 부탁하고 결과를 받는다. 실패하면 까닭을 알려 주고 null
  async function act(body, okMsg) {
    try {
      const s = await call(body);
      gotState(s);
      if (okMsg) toast(okMsg);
      return s;
    } catch (e) {
      toast(errText(e.code));
      if (e.code === 'nogroup' || e.code === 'lead') pull();
      return null;
    }
  }

  /* ---------- 함께 집중 ---------- */
  // 다른 것을 재는 중이면 멈출지 묻는다. 시작해도 되면 true
  async function readyToFocus() {
    if (root.Lock && root.Lock.state) { toast('폰 잠금 모드가 끝나면 같이 할 수 있어요'); return false; }
    if (root.Stopwatch && root.Stopwatch.running()) {
      if (!(await ask('스톱워치가 재는 중이에요.\n지금까지 잰 시간을 기록하고 함께 집중으로 바꿀까요?', { ok: '기록하고 바꾸기' }))) return false;
      await root.Stopwatch.stop();
      if (root.Stopwatch.running()) return false;
    }
    const busyMode = App.timerBusy && App.timerBusy();
    if (busyMode) {
      const q = busyMode === 'focus' ? '집중 타이머가 도는 중이에요.\n지금까지 집중한 시간을 기록하고 함께 집중으로 바꿀까요?' : '휴식 타이머가 도는 중이에요.\n휴식을 끝내고 함께 집중할까요?';
      if (!(await ask(q, { ok: '바꾸기' }))) return false;
      App.stopTimer();
    }
    return true;
  }
  function focusUntil(end, name) {
    const sec = Math.floor((end - Date.now()) / 1000);
    if (sec < 30) { toast('함께 집중이 곧 끝나요'); return false; }
    const ok = App.startFocus({ seconds: sec, label: '함께 집중 · ' + name });
    if (ok) { toast(`함께 집중 시작! ${clock(end)}에 같이 끝나요`); schedulePush(300); } // 친구들에게 공부 중 표시를 바로
    else toast('다른 타이머가 재는 중이라 시작하지 못했어요');
    return ok;
  }
  async function startRoom(gid) {
    if (!focusOK()) return;
    const min = await choose('함께 집중', [
      { value: 25, label: '25분' }, { value: 50, label: '50분' }, { value: 90, label: '90분' },
    ], { note: '그룹 사람들에게 보이고, ‘같이 하기’를 누른 친구는 같은 시각에 끝나는 집중 타이머가 켜져요.' });
    if (!min || !(await readyToFocus())) return;
    const s = await act({ op: 'room', g: gid, min });
    const g = s && findGroup(gid);
    if (g && g.room) focusUntil(g.room.end, g.name);
  }
  async function joinRoom(gid) {
    const g0 = findGroup(gid);
    if (!g0 || !g0.room || !focusOK() || !(await readyToFocus())) return;
    const s = await act({ op: 'room-join', g: gid });
    const g = s && findGroup(gid);
    if (g && g.room) focusUntil(g.room.end, g.name);
  }
  async function leaveRoom(gid) {
    const running = App.timerBusy && App.timerBusy() === 'focus';
    if (!(await ask('함께 집중을 그만할까요?' + (running ? '\n지금까지 집중한 시간은 기록해 둘게요.' : ''), { ok: '그만하기' }))) return;
    if (running) App.stopTimer();
    await act({ op: 'room-leave', g: gid });
  }

  /* ---------- 누르기 ---------- */
  doc.addEventListener('click', async (e) => {
    const home = e.target.closest('[data-gr-home]');
    if (home) { e.preventDefault(); return joinRoom(home.dataset.g); }
    if (!e.target.closest('#view-group')) return;
    const pick = e.target.closest('[data-gr-pick]');
    if (pick) { ui.cur = pick.dataset.grPick; saveUI(); renderGroup(); return; }
    const tab = e.target.closest('[data-gr-tab]');
    if (tab) { ui.tab = tab.dataset.grTab; saveUI(); renderGroup(); return; }
    const m = e.target.closest('[data-gr-m]');
    const g = curGroup();
    if (m && g) return openMember(g.id, m.dataset.grM);
    const b = e.target.closest('[data-gr]');
    if (!b) return;
    const what = b.dataset.gr;
    if (what === 'retry') return pull();
    if (what === 'create') return openCreate();
    if (what === 'join') return openJoin('');
    if (what === 'add') {
      const v = await choose('그룹 추가', [{ value: 'create', label: '새 그룹 만들기', hint: '내가 리더가 돼요' }, { value: 'join', label: '초대 코드로 들어가기', hint: '친구에게 받은 6자리 코드' }]);
      if (v === 'create') openCreate(); else if (v === 'join') openJoin('');
      return;
    }
    if (what === 'nick') return openNick();
    if (!g) return;
    if (what === 'invite') return openInvite(g.id);
    if (what === 'menu') return openMenu(g.id);
    if (what === 'goal') return openGoal(g.id);
    if (what === 'leave') return leave(g.id);
    if (what === 'study') {
      if (root.Stopwatch && (!root.Features || root.Features.on('stopwatch'))) return root.Stopwatch.startFlow();
      return App.go('timer');
    }
    if (what === 'room-start') return startRoom(g.id);
    if (what === 'room-join') return joinRoom(g.id);
    if (what === 'room-leave') return leaveRoom(g.id);
  });
  doc.addEventListener('change', (e) => {
    if (!e.target || e.target.id !== 'gr-sub') return;
    const on = e.target.checked;
    store.update((st) => { if (on) delete st.settings.groupSubject; else st.settings.groupSubject = false; });
    toast(on ? '공부 중일 때 과목 이름도 보여요' : '공부 중일 때 과목 이름은 보이지 않아요');
    push();
  });

  /* ---------- 언제 주고받나 ---------- */
  // 기록이 바뀌면(공부 기록이 생기거나 지움) 잠시 뒤 보낸다
  store.subscribe(() => { if (inGroups()) schedulePush(2500); });
  // 10초마다: 공부를 시작·멈췄으면 바로 보내고, 그룹 화면은 30초마다·홈은 2분마다 새로 받는다. 글자(몇 분째)는 1분마다
  let lastPaint = 0;
  setInterval(() => {
    if (!canTalk() || doc.visibilityState !== 'visible') return;
    const view = App.view;
    if (inGroups() && !pushing && sigOf(payload()) !== sentSig) push();
    const age = Date.now() - sAt;
    if (view === 'group' && age > 30000) refresh();
    else if (view === 'home' && inGroups() && age > 120000) refresh();
    if ((view === 'group' || view === 'home') && Date.now() - lastPaint > 55000) { lastPaint = Date.now(); paintTimes(); }
  }, 10000);
  // 앱을 내려 두면 바뀐 것을 바로 보낸다 (닫혀도 끝까지 가게 keepalive)
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') { if (canTalk() && inGroups() && sigOf(payload()) !== sentSig) push({ keepalive: true }); }
    else if (canTalk() && Date.now() - sAt > 20000 && (inGroups() || App.view === 'group')) refresh();
  });
  root.addEventListener('online', () => { if (canTalk() && worth()) refresh(); });
  // 로그인이 바뀌면 (js/cloud.js가 알림)
  root.addEventListener('cloud-user', () => {
    const u = user();
    if (!u) { forgetState(); return; }
    if (sUid && sUid !== u.uid) { S = null; sentSig = null; }
    if (remote() && featOn() && worth()) refresh();
    paint();
    resumeJoin();
  });
  // 초대 링크를 연 뒤 로그인하러 갔다면: 계정 기록 맞추기가 끝나고 다른 창이 닫히면 그룹 화면으로 돌아가 들어갈지 이어서 묻는다
  let joinWait = null;
  function resumeJoin() {
    if (joinWait || !cleanCode(lsGet(JOIN_KEY)) || !remote() || !featOn()) return;
    const t0 = Date.now();
    joinWait = setInterval(() => {
      const free = !(root.Cloud && root.Cloud.syncing) && $('#ask').hidden && !doc.querySelector('.ui-back:not(.out)') && !(root.Lock && root.Lock.state);
      if (!free && Date.now() - t0 < 15000) return;
      clearInterval(joinWait); joinWait = null;
      if (!user() || !cleanCode(lsGet(JOIN_KEY))) return;
      if (App.view === 'group') renderGroup(); else App.go('group');
    }, 300);
  }
  // 그룹 탭을 다시 켜면 바로 맞춘다
  if (root.Features) root.Features.onChange(() => { if (featOn() && canTalk() && worth()) refresh(); paint(); });

  paint(); // 처음 한 번 (app.js가 먼저 그렸을 때는 이 파일이 없었다)

  root.Group = {
    render: renderGroup,
    renderHome,
    refresh,
    // 시험용
    get state() { return state(); },
    payload,
  };
})(typeof window !== 'undefined' ? window : globalThis);
