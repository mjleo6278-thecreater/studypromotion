/* 그룹 채팅에 붙이는 것 (v4.3): 사진 · 공부 기록 카드 · 단어장
 * 채팅 창(js/groupchat.js) 입력 칸 왼쪽의 + 단추로 보낸다. 서버는 같은 /group (say의 p, thumbs, file — worker/src/group.js)
 * - 사진: 한 번에 1장 + 설명 한 줄. 앱이 긴 변 1600픽셀 JPEG로 다시 그려 보낸다(찍은 장소·기기 정보는 이때 없어진다).
 *   작은 그림(긴 변 480)도 같이 보내 채팅에는 작은 그림, 누르면 화면 가득(두 손가락·휠로 확대), 꾹 누르면 '사진 저장'.
 *   받은 그림은 이 앱이 열려 있는 동안만 기억한다 (기기에 따로 쌓아 두지 않음: 지운 사진이 남지 않게).
 * - 공부 기록 카드: 오늘 또는 이번 주(월요일부터 오늘)의 총 공부 시간·하루 목표 %·과목별 시간(많은 순 5개 + 기타)·
 *   집중 타이머 횟수·끝낸 할 일 수·연속 공부일. 보내는 순간의 숫자 그대로이고, 할 일 제목·메모·시험 범위는 보내지 않는다.
 *   과목 이름은 빼고 보낼 수 있다(‘과목 1, 2’로 보임).
 * - 단어장: 복습 탭의 덱 하나 (이름과 카드 앞·뒤 글자만, 1000장까지. 외운 정도·다음 복습 날짜는 보내지 않음).
 *   받은 사람은 '내 복습에 담기' → 링크로 가져오기(js/cardlink.js)와 같은 확인 창. 담은 카드는 새 카드로 시작한다.
 * 위쪽(lib)은 node 시험에서도 쓰는 순수 함수, 아래는 브라우저 화면.
 */
(function (root) {
  'use strict';
  const DAY = 86400000;
  // 서버(worker/src/group.js ATTACH)와 같은 한도
  const LIMIT = Object.freeze({ side: 1600, thumb: 480, img: 900 * 1024, th: 80 * 1024, cap: 100, memo: 40, cards: 1000, front: 300, back: 500, deck: 40, chars: 200000 });
  const WD = ['일', '월', '화', '수', '목', '금', '토'];

  const fm = (m) => {
    m = Math.max(0, Math.round(+m || 0));
    if (m < 60) return m + '분';
    const h = Math.floor(m / 60), r = m % 60;
    return r ? h + '시간 ' + r + '분' : h + '시간';
  };
  // 긴 변을 max에 맞춘 크기 (이미 작으면 그대로)
  function fitSize(w, h, max) {
    w = Math.max(1, Math.round(+w || 1)); h = Math.max(1, Math.round(+h || 1));
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  const cps = (s) => [...String(s)];
  const sliceCp = (s, n) => { const a = cps(s); return a.length > n ? a.slice(0, n).join('') : String(s); };
  // 사진 설명·한마디: 서버의 cleanCaption과 같은 다듬기 (한 줄, 보이지 않는 글자 빼기, 빈칸 하나로)
  const tidyLine = (v) => String(v == null ? '' : v).normalize('NFC').replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim();
  // 카드 글자·과목 이름: 서버(cardText·cleanSubject)와 같은 다듬기
  const cardText = (v) => String(v == null ? '' : v).normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  const subjText = (v) => sliceCp(String(v == null ? '' : v).normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').replace(/\s+/g, ' ').trim(), 20);
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const keyDate = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
  const daysIn = (a, b) => Math.round((keyDate(b) - keyDate(a)) / DAY) + 1;

  /* ---------- 공부 기록 카드 ----------
   * st: 앱 상태 (sessions, subjects, tasks, settings), span: 'd' 오늘 | 'w' 이번 주
   * env: { today 오늘 키, dayKey(시각) → 키, weekStart(키) → 월요일 키, streak 연속일, live { min, subjectId } 재는 중인 스톱워치, names 과목 이름 넣기 }
   * → 서버의 cleanRecord가 받는 모양 */
  function buildRecord(st, span, env) {
    const to = env.today, from = span === 'w' ? env.weekStart(to) : to;
    const most = span === 'w' ? 7 * 1440 : 1440;
    const inRange = (k) => k >= from && k <= to;
    const subj = new Map((st.subjects || []).map((x) => [x.id, x]));
    const by = new Map();
    let m = 0, fo = 0;
    const add = (id, v) => { const k = id && subj.has(id) ? id : ''; by.set(k, (by.get(k) || 0) + v); m += v; };
    for (const s of st.sessions || []) {
      if (!s || !inRange(env.dayKey(s.endedAt))) continue;
      const v = Math.max(0, Math.round(+s.minutes || 0));
      if (v) add(s.subjectId, v);
      if (!s.manual && s.kind !== 'stopwatch') fo++; // 집중 타이머 (타이머 화면의 '집중 N회'와 같게)
    }
    if (env.live && env.live.min > 0) add(env.live.subjectId, Math.round(env.live.min));
    const list = [...by].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const sb = list.slice(0, 5).map(([k, v]) => {
      if (!k) return { x: 1, m: Math.min(most, v), c: '' };
      const s = subj.get(k), o = { m: Math.min(most, v), c: COLOR_RE.test(s.color || '') ? s.color.toLowerCase() : '' };
      const n = env.names ? subjText(s.name) : '';
      if (n) o.n = n;
      return o;
    });
    const tasks = (st.tasks || []).filter((t) => t && t.due && inRange(t.due));
    const goal = Math.round(+((st.settings || {}).dailyGoalMin) || 0);
    const r = { sp: span === 'w' ? 'w' : 'd', d: from };
    if (span === 'w') r.e = to;
    return Object.assign(r, {
      m: Math.min(most, m), g: Math.max(0, Math.min(1440, goal)), fo: Math.min(999, fo),
      td: [Math.min(999, tasks.filter((t) => t.done).length), Math.min(999, tasks.length)],
      sk: Math.max(0, Math.min(9999, Math.round(+env.streak || 0))), sb,
      o: Math.min(most, list.slice(5).reduce((a, x) => a + x[1], 0)),
    });
  }
  // 카드에 쓰는 날짜: 11월 21일 (토) · 11월 17일 ~ 21일
  function spanLabel(r) {
    const a = keyDate(r.d), md = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
    if (r.sp !== 'w' || !r.e || r.e === r.d) return `${md(a)} (${WD[a.getDay()]})`;
    const b = keyDate(r.e);
    return a.getMonth() === b.getMonth() ? `${md(a)} ~ ${b.getDate()}일` : `${md(a)} ~ ${md(b)}`;
  }
  // 카드 그리기에 쓰는 값: { title, date, goal: { pre, pct, bar, crown } | null, note 평균, subs [{ label, m, pct, color }], chips }
  function recordView(r) {
    const week = r.sp === 'w', days = week ? Math.max(1, daysIn(r.d, r.e || r.d)) : 1;
    const avg = Math.round(r.m / days);
    let goal = null;
    if (r.g > 0) {
      const pct = Math.round((r.m / (r.g * days)) * 100);
      goal = { pre: week ? `하루 평균 ${fm(avg)} · 목표의 ` : `하루 목표 ${fm(r.g)} · `, pct, bar: Math.min(100, pct), crown: pct >= 100 };
    }
    const rows = (r.sb || []).map((s) => ({ s, m: s.m })).concat(r.o > 0 ? [{ etc: true, m: r.o }] : []);
    const top = Math.max(1, ...rows.map((x) => x.m));
    let hid = 0;
    const subs = rows.map((x) => {
      const label = x.etc ? '기타' : x.s.x ? '과목 없음' : x.s.n || `과목 ${++hid}`;
      return { label, m: x.m, pct: Math.max(x.m > 0 ? 3 : 0, Math.round((x.m / top) * 100)), color: !x.etc && x.s.c && COLOR_RE.test(x.s.c) ? x.s.c : '' };
    });
    const chips = [];
    if (r.fo > 0) chips.push(`집중 ${r.fo}번`);
    if (r.td && r.td[1] > 0) chips.push(`할 일 ${r.td[0]}/${r.td[1]}`);
    if (r.sk > 0) chips.push(`${r.sk}일 연속`);
    return { title: week ? '이번 주 공부 기록' : '오늘 공부 기록', date: spanLabel(r), goal, note: week && !goal ? `하루 평균 ${fm(avg)}` : '', subs, chips };
  }

  /* ---------- 단어장 ----------
   * 덱 이름과 카드([{ front, back }]) → 서버로 보낼 { n, cs [[앞, 뒤]] }와 뺀 수 { cut 한도를 넘어 뺀 카드, skip 빈 카드 } */
  function deckPayload(name, cards) {
    const cs = [];
    let chars = 0, cut = 0, skip = 0;
    for (const c of cards || []) {
      const f = sliceCp(cardText(c && c.front), LIMIT.front), b = sliceCp(cardText(c && c.back), LIMIT.back);
      if (!f || !b) { skip++; continue; }
      if (cs.length >= LIMIT.cards || chars + f.length + b.length > LIMIT.chars) { cut++; continue; }
      chars += f.length + b.length;
      cs.push([f, b]);
    }
    return { n: sliceCp(cardText(name), LIMIT.deck) || '단어장', cs, cut, skip };
  }
  // 미리 보기 글 (서버의 altText와 같게: 붙인 것을 그리지 못하는 예전 앱과 그룹 화면의 미리 보기에 보인다)
  function altText(x) {
    if (x.p === 'img') return '📷 사진' + (x.t ? ' · ' + x.t : '');
    if (x.p === 'rec') return `📊 ${x.r.sp === 'w' ? '이번 주' : '오늘'} 공부 ${fm(x.r.m)}` + (x.t ? ' · ' + x.t : '');
    if (x.p === 'deck') return `🗂️ 단어장 ‘${x.dn}’ 카드 ${x.cn}장`;
    return x.t || '';
  }
  // 파일 크기 글: 0.3MB · 64KB
  const sizeText = (n) => (n >= 100 * 1024 ? (n / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

  const lib = { LIMIT, fm, fitSize, tidyLine, cardText, buildRecord, spanLabel, recordView, deckPayload, altText, sizeText };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  /* =====================================================================
   *  브라우저
   * ===================================================================== */
  const App = root.App, G = root.Group && root.Group._, C = root.GroupChat && root.GroupChat._;
  if (!App || !G || !C || !root.UI) return;
  const { store, $, esc, toast, ask } = App;
  const doc = root.document;
  const ic = (name, cls) => App.ic(name, cls);
  const fine = () => { try { return matchMedia('(pointer: fine)').matches; } catch (e) { return false; } };
  const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장이 막힌 환경 */ } };
  const sheetBox = (cls) => doc.querySelector(`.ui-back:not(.out) .${cls}`);
  const fail = (code, msg) => Object.assign(new Error(msg || code), { code });

  /* ---------- base64 ---------- */
  function b64Blob(b64) {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: 'image/jpeg' });
  }
  const blobB64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error || new Error('read'));
    r.readAsDataURL(blob);
  });

  /* ---------- 받은 사진 (이 앱이 열려 있는 동안만) ---------- */
  const thumbs = new Map(); // 파일 번호 → 작은 그림 주소(blob:), '' = 없어진 사진
  const fulls = new Map();  // 파일 번호 → { blob, url } 최근 8장
  const want = new Set();
  let wantGid = null, thumbBusy = false, thumbFailAt = 0;
  function keepFull(aid, blob, url) {
    fulls.delete(aid);
    fulls.set(aid, { blob, url: url || URL.createObjectURL(blob) });
    for (const [k, v] of fulls) {
      if (fulls.size <= 8) break;
      if (V.x && V.x.a === k) continue; // 크게 보는 중인 사진은 놓지 않는다
      URL.revokeObjectURL(v.url);
      fulls.delete(k);
    }
  }
  function forget() {
    for (const u of thumbs.values()) if (u) URL.revokeObjectURL(u);
    for (const v of fulls.values()) URL.revokeObjectURL(v.url);
    thumbs.clear(); fulls.clear(); want.clear();
  }
  // 채팅 목록의 사진에 작은 그림을 채운다 (받아 둔 것은 바로, 없는 것은 12장씩 서버에서)
  function paintThumbs(el) {
    (el || $('#gc-list')).querySelectorAll('img[data-gx-th]').forEach((img) => {
      const u = thumbs.get(img.dataset.gxTh);
      if (u) { if (img.getAttribute('src') !== u) img.src = u; }
      else if (u === '') img.closest('.gx-ph').classList.add('gone');
    });
  }
  function hydrate(el, gid) {
    if (gid !== wantGid) { want.clear(); wantGid = gid; }
    el.querySelectorAll('img[data-gx-th]').forEach((img) => { if (!thumbs.has(img.dataset.gxTh)) want.add(img.dataset.gxTh); });
    paintThumbs(el);
    if (want.size && !thumbBusy && Date.now() - thumbFailAt > 10000) loadThumbs(gid);
  }
  async function loadThumbs(gid) {
    thumbBusy = true;
    try {
      while (want.size && C.openId === gid && wantGid === gid) {
        const batch = [...want].slice(0, 12);
        let j;
        try { j = await G.call({ op: 'thumbs', g: gid, as: batch }, { timeout: 30000 }); }
        catch (e) { thumbFailAt = Date.now(); if (e.code === 'chatoff' || e.code === 'nogroup') want.clear(); break; }
        for (const a of batch) {
          want.delete(a);
          const b = j.th && j.th[a];
          if (!thumbs.has(a)) thumbs.set(a, b ? URL.createObjectURL(b64Blob(b)) : '');
        }
        if (C.openId === gid) paintThumbs();
      }
    } finally { thumbBusy = false; }
  }
  // 원본 사진 (Blob)
  async function fullBlob(x, gid) {
    if (x.pend) { if (x.loc && x.loc.blob) return x.loc.blob; throw fail('gone'); }
    const hit = fulls.get(x.a);
    if (hit) { keepFull(x.a, hit.blob, hit.url); return hit.blob; }
    const j = await G.call({ op: 'file', g: gid, a: x.a }, { timeout: 60000 });
    if (!j.img) throw fail('gone');
    const blob = b64Blob(j.img);
    keepFull(x.a, blob);
    return blob;
  }

  /* ---------- 채팅 속 모양 (js/groupchat.js의 msgHTML이 부른다) ----------
   * o: { mine, name 보낸 사람(나), sr 화면 읽기 프로그램용 '이름, 시각: ', key 메뉴를 여는 번호 속성 } */
  const shown = (t) => C.shown(t);
  function bubbleHTML(g, x, o) {
    if (x.p === 'img') return photoHTML(x, o);
    if (x.p === 'rec') return `<div class="gx-rec" tabindex="0" role="button" aria-haspopup="menu" ${o.key}>${o.sr}${recHTML(x.r, x.cap ? shown(x.cap) : '')}</div>`;
    if (x.p === 'deck') return `<div class="gx-deck" ${o.key}>${o.sr}${deckInner(x, deckBtn(x, o))}</div>`;
    return `<p class="gc-b" ${o.key}>${o.sr}${esc(shown(x.t))}</p>`;
  }
  function photoHTML(x, o) {
    const src = x.pend ? x.loc && x.loc.th : thumbs.get(x.a);
    const label = `${o.name === '나' ? '내' : o.name + ' 님의'} 사진${x.cap ? ': ' + shown(x.cap) : ''} · 크게 보기`;
    const img = `<img alt="" draggable="false"${x.pend ? '' : ` data-gx-th="${esc(x.a)}"`}${src ? ` src="${esc(src)}"` : ''}>`;
    const box = `<button type="button" class="gx-ph${src === '' ? ' gone' : ''}" ${o.key} data-gx-open aria-haspopup="dialog" aria-label="${esc(label)}" style="--ar:${Math.max(1, x.w | 0) || 4}/${Math.max(1, x.h | 0) || 3}">${img}<span class="gx-ph-gone">사진이 지워졌어요</span></button>`;
    const cap = x.cap ? `<p class="gc-b gx-cap" tabindex="0" role="button" aria-haspopup="menu" ${o.key}>${o.sr}${esc(shown(x.cap))}</p>` : '';
    return `<div class="gx-stack">${box}${cap}</div>`;
  }
  // 공부 기록 카드 속 (채팅과 보내기 창에서 같이 쓴다). memo는 이미 보여 줄 글로 바꾼 것
  function recHTML(r, memo) {
    const v = recordView(r);
    const goal = v.goal
      ? `<div class="gx-rec-goal" aria-hidden="true"><i style="width:${v.goal.bar}%"></i></div><p class="gx-rec-gt">${esc(v.goal.pre)}<b>${v.goal.pct}%${v.goal.crown ? ' ♛' : ''}</b></p>`
      : v.note ? `<p class="gx-rec-gt">${esc(v.note)}</p>` : '';
    const subs = v.subs.length
      ? `<ul class="gx-rec-sub">${v.subs.map((s) => `<li><span>${esc(s.label)}</span><i aria-hidden="true"><b style="width:${s.pct}%${s.color ? `;background:${esc(s.color)}` : ''}"></b></i><em>${esc(fm(s.m))}</em></li>`).join('')}</ul>`
      : '<p class="gx-rec-none">아직 공부한 기록이 없어요</p>';
    const chips = v.chips.length ? `<div class="gx-rec-meta">${v.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : '';
    return `<div class="gx-rec-h">${ic('stats')}<b>${esc(v.title)}</b><span>${esc(v.date)}</span></div><div class="gx-rec-big">${esc(fm(r.m))}</div>${goal}${subs}${chips}${memo ? `<p class="gx-rec-memo">${esc(memo)}</p>` : ''}`;
  }
  function deckInner(x, btn) {
    const pv = (x.pv || []).map((c) => `<li><b>${esc(shown(c[0]))}</b><span>${esc(shown(c[1]))}</span></li>`).join('');
    return `<div class="gx-deck-h">${ic('review')}<span>단어장</span></div><b class="gx-deck-name">${esc(shown(x.dn))}</b><span class="gx-deck-n">카드 ${esc(x.cn)}장</span>${pv ? `<ol>${pv}</ol>` : ''}${btn || ''}`;
  }

  /* ---------- 내 복습에 담은 단어장 (이 기기에만: 파일 번호 → 덱 번호) ---------- */
  const DECKS_KEY = 'studypromotion.chatDecks';
  const taken = () => { try { const m = JSON.parse(lsGet(DECKS_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; } };
  function remember(aid, deckId) {
    const m = taken();
    delete m[aid];
    m[aid] = deckId;
    const keys = Object.keys(m);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete m[k];
    lsSet(DECKS_KEY, JSON.stringify(m));
  }
  const takenDeck = (aid) => { const id = taken()[aid]; return id && store.get().decks.some((d) => d.id === id) ? id : null; };
  function deckBtn(x, o) {
    if (o.mine || x.pend) return '';
    if (takenDeck(x.a)) return `<button class="btn sm gx-deck-go" type="button" data-gx-act="go">${ic('check')}담았어요 · 복습에서 보기</button>`;
    return '<button class="btn primary sm" type="button" data-gx-act="import">내 복습에 담기</button>';
  }

  /* ---------- 보낸 뒤 (js/groupchat.js의 pump가 부른다) ---------- */
  function sent(x, chat) {
    const m = chat && Array.isArray(chat.ms) ? chat.ms.find((y) => y.c === x.c) : null;
    if (x.p === 'img' && x.loc) {
      if (m && m.a) { // 내가 보낸 사진은 다시 받지 않는다
        thumbs.set(m.a, x.loc.th);
        keepFull(m.a, x.loc.blob, x.loc.full);
        x.loc.kept = true;
      }
    }
    delete x.up; // 올린 내용은 이제 필요 없다
  }
  function dropped(x) {
    if (x.loc && !x.loc.kept) { URL.revokeObjectURL(x.loc.th); URL.revokeObjectURL(x.loc.full); }
  }

  /* ---------- + 메뉴 ---------- */
  const fileIn = doc.createElement('input');
  fileIn.id = 'gx-file';
  fileIn.type = 'file';
  fileIn.accept = 'image/*';
  fileIn.hidden = true;
  fileIn.setAttribute('aria-hidden', 'true');
  fileIn.tabIndex = -1;
  doc.body.appendChild(fileIn);
  let pickGid = null;
  function pickFile(camera) {
    pickGid = C.openId;
    if (camera) fileIn.setAttribute('capture', 'environment'); else fileIn.removeAttribute('capture');
    fileIn.value = '';
    fileIn.click(); // 누른 그 자리에서 (나중에 열면 브라우저가 막는다)
  }
  fileIn.addEventListener('change', () => {
    const f = fileIn.files && fileIn.files[0];
    if (f && pickGid) photoFlow(f, pickGid);
  });

  async function menu() {
    const gid = C.openId;
    if (!gid) return;
    const items = [['album', 'image', '앨범'], coarse() ? ['camera', 'camera', '사진 찍기'] : null, ['rec', 'stats', '공부 기록'], ['deck', 'review', '단어장']].filter(Boolean);
    const v = await root.UI.openSheet({
      title: '보내기', cls: 'gx-menu-sheet',
      body: `<div class="gx-menu" style="--n:${items.length}">${items.map(([k, i, l]) => `<button type="button" data-gx-pick="${k}"><i>${ic(i)}</i>${l}</button>`).join('')}</div>` +
        '<p class="gx-hint">사진은 긴 변 1600픽셀로 줄여 보내고, 찍은 장소 같은 정보는 지워요.</p>',
      onClick: (e, close) => {
        const b = e.target.closest('[data-gx-pick]');
        if (!b) return;
        const k = b.dataset.gxPick;
        if (k === 'album' || k === 'camera') pickFile(k === 'camera');
        close(k);
      },
    });
    if (C.openId !== gid) return;
    if (v === 'rec') recordSheet(gid);
    else if (v === 'deck') deckSheet(gid);
  }
  async function askContact(t) {
    return !t || !C.looksContact(t) || ask('전화번호나 이메일 같은 개인 연락처는 그룹 사람 모두에게 보여요.\n그래도 보낼까요?', { ok: '보내기', cancel: '고치기' });
  }

  /* ---------- 사진: 줄여 다시 그리기 ---------- */
  async function decode(file) {
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* 아래 <img>로 */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await (img.decode ? img.decode() : new Promise((ok, no) => { img.onload = ok; img.onerror = no; }));
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  function canvasOf(src, w, h) {
    const cv = doc.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; // 투명한 그림(PNG)은 흰 바탕으로
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return cv;
  }
  const jpegOf = (cv, q) => new Promise((resolve) => {
    if (cv.toBlob) cv.toBlob((b) => resolve(b), 'image/jpeg', q);
    else resolve(b64Blob(cv.toDataURL('image/jpeg', q).replace(/^data:[^,]*,/, '')));
  });
  // 고른 사진 → { full 긴 변 1600 JPEG, th 긴 변 480 JPEG, w, h }. 새로 그린 그림이라 사진 속 위치·기기 정보(EXIF)는 남지 않는다
  async function makePhoto(file) {
    if (!file || (file.type && !/^image\//.test(file.type))) throw fail('type', '사진 파일만 보낼 수 있어요');
    if (file.size > 60 * 1024 * 1024) throw fail('big', '사진 파일이 너무 커요');
    let src;
    try { src = await decode(file); } catch (e) { throw fail('decode', '이 사진은 열 수 없어요. 다른 사진을 골라 주세요'); }
    const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    if (!W || !H) { if (src.close) src.close(); throw fail('decode', '이 사진은 열 수 없어요. 다른 사진을 골라 주세요'); }
    // 보통 사진은 첫 단계(긴 변 1600, 0.2~0.4MB)에서 끝난다. 아주 자세한 사진만 화질·크기를 조금씩 낮춘다
    let size = null, cv = null, full = null;
    try {
      for (const [side, q] of [[LIMIT.side, 0.82], [LIMIT.side, 0.72], [1280, 0.72], [1024, 0.62]]) {
        const s = fitSize(W, H, side);
        if (!size || s.w !== size.w) { if (cv) cv.width = 0; size = s; cv = canvasOf(src, s.w, s.h); }
        full = await jpegOf(cv, q);
        if (full && full.size <= 600 * 1024) break;
      }
    } finally { if (src.close) src.close(); }
    if (!full || full.size > LIMIT.img) { cv.width = 0; throw fail('big', '사진이 너무 커요. 다른 사진을 골라 주세요'); }
    const ts = fitSize(size.w, size.h, LIMIT.thumb), tc = canvasOf(cv, ts.w, ts.h);
    let th = await jpegOf(tc, 0.72);
    if (th && th.size > LIMIT.th) { const t2 = fitSize(size.w, size.h, 360); th = await jpegOf(canvasOf(cv, t2.w, t2.h), 0.6); }
    cv.width = 0; tc.width = 0; // 캔버스 메모리를 바로 놓아준다 (폰 Safari)
    if (!th || th.size > LIMIT.th) throw fail('big', '사진을 줄이지 못했어요. 다른 사진을 골라 주세요');
    return { full, th, w: size.w, h: size.h };
  }

  /* ---------- 사진 보내기 ---------- */
  const NOTE_KEY = 'studypromotion.chatPhotoNote'; // 개인정보 안내를 본 기기
  async function photoFlow(file, gid) {
    if (C.openId !== gid) return;
    let ph;
    const slow = setTimeout(() => toast('사진을 줄이는 중이에요…'), 500);
    try { ph = await makePhoto(file); }
    catch (e) { clearTimeout(slow); toast(e.message || '사진을 열지 못했어요'); return; }
    clearTimeout(slow);
    if (C.openId !== gid) return;
    const full = URL.createObjectURL(ph.full), th = URL.createObjectURL(ph.th);
    const note = !lsGet(NOTE_KEY);
    const body = `<img class="gx-prev" src="${esc(full)}" alt="보낼 사진">` +
      `<input class="gx-cap-in" maxlength="${LIMIT.cap}" placeholder="설명 한 줄 (안 적어도 돼요)" aria-label="사진 설명" autocomplete="off" enterkeyhint="send">` +
      (note ? `<p class="gx-note">${ic('lock')}<span>얼굴, 이름표, 학교, 집 주소가 보이는 사진은 그룹 사람 모두에게 보여요.</span></p>` : '') +
      `<div class="gx-row"><span class="gx-small">${esc(sizeText(ph.full.size))} · 찍은 장소 정보는 지워요</span><button class="btn primary" type="button" data-gx-send>보내기</button></div>`;
    let box = null, busy = false;
    const submit = async (close) => {
      if (busy) return;
      busy = true;
      const cap = tidyLine(box.querySelector('.gx-cap-in').value);
      const ok = await askContact(cap);
      busy = false;
      if (ok) close({ cap: sliceCp(cap, LIMIT.cap).trim() });
    };
    const p = root.UI.openSheet({
      title: '사진 보내기', body, cls: 'gx-photo-sheet', focusSel: fine() ? '.gx-cap-in' : '[data-gx-send]',
      onClick: (e, close) => { if (e.target.closest('[data-gx-send]')) submit(close); },
      onKey: (e, b, close) => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('gx-cap-in') && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(close); }
      },
    });
    box = sheetBox('gx-photo-sheet');
    const res = await p;
    if (!res || C.openId !== gid) { URL.revokeObjectURL(full); URL.revokeObjectURL(th); return; }
    if (note) lsSet(NOTE_KEY, '1');
    let img, small;
    try { [img, small] = await Promise.all([blobB64(ph.full), blobB64(ph.th)]); }
    catch (e) { URL.revokeObjectURL(full); URL.revokeObjectURL(th); toast('사진을 읽지 못했어요'); return; }
    if (C.openId !== gid) { URL.revokeObjectURL(full); URL.revokeObjectURL(th); return; }
    const up = { img, th: small, w: ph.w, h: ph.h };
    if (res.cap) up.t = res.cap;
    C.send(altText({ p: 'img', t: res.cap }), { p: 'img', w: ph.w, h: ph.h, cap: res.cap || undefined, up, loc: { th, full, blob: ph.full } });
  }

  /* ---------- 사진 크게 보기 · 저장 ---------- */
  const V = { el: $('#gx-view'), x: null, gid: null, from: null };
  const vImg = $('#gx-view-img'), stage = $('#gx-view-stage'), vWait = $('#gx-view-wait');
  const Z = { sc: 1, tx: 0, ty: 0, pts: new Map(), st: null, moved: false, drag: 0, tapAt: 0, tapXY: null };
  function applyZ() {
    vImg.style.transform = Z.drag ? `translateY(${Z.drag}px)` : `translate(${Z.tx}px, ${Z.ty}px) scale(${Z.sc})`;
    V.el.classList.toggle('zoomed', Z.sc > 1.01);
    V.el.style.setProperty('--gx-fade', String(Z.drag ? Math.max(0.35, 1 - Math.abs(Z.drag) / 420) : 1));
  }
  function resetZ() { Z.sc = 1; Z.tx = 0; Z.ty = 0; Z.drag = 0; Z.pts.clear(); Z.st = null; applyZ(); }
  function clampZ() {
    const r = stage.getBoundingClientRect();
    const nw = vImg.naturalWidth || (V.x && V.x.w) || 1, nh = vImg.naturalHeight || (V.x && V.x.h) || 1;
    const k = Math.min(r.width / nw, r.height / nh);
    const mx = Math.max(0, (nw * k * Z.sc - r.width) / 2), my = Math.max(0, (nh * k * Z.sc - r.height) / 2);
    Z.tx = Math.max(-mx, Math.min(mx, Z.tx));
    Z.ty = Math.max(-my, Math.min(my, Z.ty));
  }
  // 화면의 (cx, cy)가 그 자리에 있게 배율을 바꾼다
  function zoomAt(sc, cx, cy) {
    const r = stage.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    sc = Math.max(1, Math.min(5, sc));
    Z.tx = px - (px - Z.tx) * (sc / Z.sc);
    Z.ty = py - (py - Z.ty) * (sc / Z.sc);
    Z.sc = sc;
    if (sc <= 1.01) { Z.sc = 1; Z.tx = 0; Z.ty = 0; }
    clampZ(); applyZ();
  }
  const center = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    Z.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...Z.pts.values()];
    if (ps.length >= 2) {
      const [a, b] = ps;
      Z.drag = 0;
      Z.st = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, sc: Z.sc, tx: Z.tx, ty: Z.ty };
      Z.moved = true;
    } else { Z.st = { x: e.clientX, y: e.clientY, tx: Z.tx, ty: Z.ty }; Z.moved = false; }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!Z.pts.has(e.pointerId) || !Z.st) return;
    Z.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ps = [...Z.pts.values()];
    if (ps.length >= 2 && Z.st.d) { // 두 손가락: 벌리면 확대, 가운데를 따라 옮김
      const [a, b] = ps, c = center();
      const sc = Math.max(1, Math.min(5, Z.st.sc * (Math.hypot(a.x - b.x, a.y - b.y) / Z.st.d)));
      const mx = (a.x + b.x) / 2 - c.x, my = (a.y + b.y) / 2 - c.y;
      Z.tx = mx - ((Z.st.mx - c.x) - Z.st.tx) * (sc / Z.st.sc);
      Z.ty = my - ((Z.st.my - c.y) - Z.st.ty) * (sc / Z.st.sc);
      Z.sc = sc;
      clampZ(); applyZ();
    } else if (ps.length === 1 && Z.st.x != null) {
      const dx = e.clientX - Z.st.x, dy = e.clientY - Z.st.y;
      if (Math.hypot(dx, dy) > 6) Z.moved = true;
      if (!Z.moved) return;
      if (Z.sc > 1.01) { Z.tx = Z.st.tx + dx; Z.ty = Z.st.ty + dy; clampZ(); applyZ(); }
      else if (e.pointerType !== 'mouse') { Z.drag = dy; applyZ(); } // 확대하지 않았으면 위아래로 끌어 닫기
    }
  });
  function pointerEnd(e) {
    if (!Z.pts.has(e.pointerId)) return;
    Z.pts.delete(e.pointerId);
    if (Z.pts.size === 1) { const p = [...Z.pts.values()][0]; Z.st = { x: p.x, y: p.y, tx: Z.tx, ty: Z.ty }; return; } // 남은 한 손가락으로 이어서 옮김
    if (Z.pts.size) return;
    if (Z.drag) {
      const far = Math.abs(Z.drag) > 110;
      Z.drag = 0; applyZ();
      if (far && e.type === 'pointerup') { closeView(); return; }
    }
    if (!Z.moved && e.type === 'pointerup') { // 두 번 누르면 확대 · 되돌리기
      const now = Date.now();
      if (now - Z.tapAt < 320 && Z.tapXY && Math.hypot(e.clientX - Z.tapXY.x, e.clientY - Z.tapXY.y) < 30) {
        Z.tapAt = 0;
        if (Z.sc > 1.01) { Z.sc = 1; Z.tx = 0; Z.ty = 0; applyZ(); } else zoomAt(2.5, e.clientX, e.clientY);
      } else { Z.tapAt = now; Z.tapXY = { x: e.clientX, y: e.clientY }; }
    }
    Z.st = null;
    if (Z.sc <= 1.01) { Z.sc = 1; Z.tx = 0; Z.ty = 0; applyZ(); }
  }
  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', pointerEnd);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(Z.sc * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); }, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault()); // 꾹 누르면 뜨는 브라우저 메뉴 대신 저장 단추
  root.addEventListener('resize', () => { if (!V.el.hidden) { clampZ(); applyZ(); } });

  async function view(x, gid) {
    if (!x || x.x || x.p !== 'img' || !gid) return;
    const g = G.findGroup(gid);
    V.from = doc.activeElement;
    V.x = x; V.gid = gid;
    resetZ();
    $('#gx-view-name').textContent = x.f === C.me() ? '나' : g ? C.nameOf(g, x) : x.n || '';
    $('#gx-view-time').textContent = x.pend ? '보내는 중' : `${new Date(x.at).getMonth() + 1}월 ${new Date(x.at).getDate()}일 ${C.ampm(x.at)}`;
    const cap = $('#gx-view-cap');
    cap.textContent = x.cap ? shown(x.cap) : '';
    cap.hidden = !x.cap;
    $('#gx-view-save').disabled = !!x.pend;
    const small = x.pend ? x.loc && x.loc.th : thumbs.get(x.a);
    if (small) vImg.src = small; else vImg.removeAttribute('src');
    vImg.alt = x.cap ? `사진: ${shown(x.cap)}` : '사진';
    vWait.hidden = true;
    V.el.hidden = false;
    doc.body.classList.add('gx-viewing');
    try { V.el.querySelector('.gx-view-box').focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    if (x.pend) { if (x.loc) vImg.src = x.loc.full; return; }
    const hit = fulls.get(x.a);
    if (hit) { vImg.src = hit.url; return; }
    const waitT = setTimeout(() => { if (V.x === x) { vWait.textContent = '사진을 불러오는 중이에요…'; vWait.hidden = false; } }, 250);
    try {
      await fullBlob(x, gid);
      if (V.x === x && !V.el.hidden) { vImg.src = fulls.get(x.a).url; vWait.hidden = true; }
    } catch (e) {
      if (V.x === x && !V.el.hidden) { vWait.textContent = e.code === 'gone' ? '지워진 사진이에요' : G.errText(e.code); vWait.hidden = false; }
    } finally { clearTimeout(waitT); }
  }
  function closeView() {
    if (V.el.hidden) return;
    V.el.hidden = true;
    V.x = null;
    resetZ();
    vImg.removeAttribute('src');
    doc.body.classList.remove('gx-viewing');
    const f = V.from;
    V.from = null;
    if (f && f.isConnected && f.focus) try { f.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }
  $('#gx-view-close').addEventListener('click', closeView);
  $('#gx-view-save').addEventListener('click', () => { if (V.x) savePhoto(V.x, V.gid); });
  V.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeView(); }
    else if (e.key === '+' || e.key === '=') { const c = center(); zoomAt(Z.sc * 1.4, c.x, c.y); }
    else if (e.key === '-') { const c = center(); zoomAt(Z.sc / 1.4, c.x, c.y); }
  });

  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const stamp = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
  let saving = false;
  // 저장: 아이폰은 공유 창(‘이미지 저장’), 나머지는 내려받기
  async function savePhoto(x, gid) {
    if (saving || !x || x.pend) return;
    saving = true;
    try {
      let blob;
      try { blob = await fullBlob(x, gid); } catch (e) { toast(e.code === 'gone' ? '지워진 사진이에요' : G.errText(e.code)); return; }
      const name = `studypromotion-${stamp(x.at)}.jpg`;
      if (isIOS() && root.File && navigator.canShare) {
        const file = new File([blob], name, { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
        }
      }
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.hidden = true;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('사진을 저장했어요');
    } finally { saving = false; }
  }

  /* ---------- 공부 기록 카드 보내기 ---------- */
  const NAMES_KEY = 'studypromotion.chatRecNames'; // 과목 이름 넣기 (이 기기에서 마지막으로 고른 것)
  const namesPref = () => { const v = lsGet(NAMES_KEY); return v === '0' ? false : v === '1' ? true : store.get().settings.groupSubject !== false; };
  function recEnv(names) {
    const st = store.get(), now = App.now();
    const keys = (st.sessions || []).map((s) => root.Stats.dayKey(s.endedAt));
    (st.reviewLog || []).forEach((r) => keys.push(root.Stats.dayKey(r.at)));
    const sw = root.Stopwatch && root.Stopwatch.live ? root.Stopwatch.live() : null;
    const min = sw && root.Stopwatch.todayMinutes ? root.Stopwatch.todayMinutes() : 0;
    return { today: App.todayKey(), dayKey: root.Stats.dayKey, weekStart: root.Schedule.weekStart, streak: root.Stats.streak(keys, now), live: min > 0 ? { min, subjectId: sw.subjectId } : null, names };
  }
  async function recordSheet(gid) {
    let span = 'd', names = namesPref(), box = null, busy = false;
    const card = () => `<div class="gx-rec in-sheet">${recHTML(buildRecord(store.get(), span, recEnv(names)), '')}</div>`;
    const body = '<div class="gx-seg" role="radiogroup" aria-label="기간"><button type="button" role="radio" data-gx-span="d">오늘</button><button type="button" role="radio" data-gx-span="w">이번 주</button></div>' +
      `<div class="gx-rec-slot">${card()}</div>` +
      '<div class="gx-opt"><span>과목 이름 넣기<small class="gx-small" data-gx-names-off>끄면 ‘과목 1, 2’로 보여요</small></span><button type="button" class="gx-sw" role="switch" aria-label="과목 이름 넣기" data-gx-names></button></div>' +
      `<input class="gx-cap-in" maxlength="${LIMIT.memo}" placeholder="한마디 (40자까지, 안 적어도 돼요)" aria-label="한마디" autocomplete="off" enterkeyhint="send">` +
      '<div class="gx-row"><span class="gx-small">할 일 제목·메모·시험 범위는 보내지 않아요</span><button class="btn primary" type="button" data-gx-send>보내기</button></div>';
    const paint = (full) => {
      if (full) box.querySelector('.gx-rec-slot').innerHTML = card();
      box.querySelectorAll('[data-gx-span]').forEach((b) => { const on = b.dataset.gxSpan === span; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      const sw = box.querySelector('[data-gx-names]');
      sw.setAttribute('aria-checked', String(names));
      sw.classList.toggle('off', !names);
    };
    const submit = async (close) => {
      if (busy) return;
      busy = true;
      const memo = sliceCp(tidyLine(box.querySelector('.gx-cap-in').value), LIMIT.memo).trim();
      const ok = await askContact(memo);
      busy = false;
      if (ok) close({ memo });
    };
    const p = root.UI.openSheet({
      title: '공부 기록 보내기', body, cls: 'gx-rec-sheet', focusSel: '[data-gx-send]',
      onClick: (e, close) => {
        const s = e.target.closest('[data-gx-span]');
        if (s) { span = s.dataset.gxSpan; paint(true); return; }
        if (e.target.closest('[data-gx-names]')) { names = !names; lsSet(NAMES_KEY, names ? '1' : '0'); paint(true); return; }
        if (e.target.closest('[data-gx-send]')) submit(close);
      },
      onKey: (e, b, close) => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('gx-cap-in') && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(close); }
      },
    });
    box = sheetBox('gx-rec-sheet');
    paint(false);
    const res = await p;
    if (!res || C.openId !== gid) return;
    const r = buildRecord(store.get(), span, recEnv(names)); // 보내는 순간의 숫자
    const up = { r };
    if (res.memo) up.t = res.memo;
    C.send(altText({ p: 'rec', r, t: res.memo }), { p: 'rec', r, cap: res.memo || undefined, up });
  }

  /* ---------- 단어장 보내기 ---------- */
  async function deckSheet(gid) {
    const st = store.get();
    const decks = st.decks.map((d) => ({ d, cards: st.cards.filter((c) => c.deckId === d.id) }));
    if (!decks.length) { toast('복습 탭에 덱이 없어요. 덱을 먼저 만들어 주세요'); return; }
    let pick = null, box = null;
    const listView = () => '<p class="gx-hint">복습 탭의 덱 하나를 통째로 보내요. 받은 사람은 자기 복습에 담을 수 있어요.</p>' +
      `<div class="ui-opts gx-decks">${decks.map(({ d, cards }) => `<button type="button" class="ui-opt" data-gx-deck="${esc(d.id)}"${cards.length ? '' : ' disabled'}><span><b>${esc(d.name)}</b><small>${cards.length ? `카드 ${cards.length}장` : '카드가 없어요'}</small></span>${ic('chev', 'gx-chev')}</button>`).join('')}</div>`;
    const pickView = () => {
      const d = decks.find((x) => x.d.id === pick), pl = deckPayload(d.d.name, d.cards);
      const notes = [];
      if (pl.cut) notes.push(`한 번에 ${LIMIT.cards}장까지 보내요. 뒤의 ${pl.cut}장은 빼요.`);
      if (pl.skip) notes.push(`앞이나 뒤가 빈 카드 ${pl.skip}장은 빼요.`);
      return `<div class="gx-deck in-sheet">${deckInner({ dn: pl.n, cn: pl.cs.length, pv: pl.cs.slice(0, 3) }, '')}</div>` +
        (notes.length ? `<p class="gx-small gx-warn">${esc(notes.join(' '))}</p>` : '') +
        '<p class="gx-small">덱 이름과 카드 앞·뒤 글자만 보내요. 외운 정도·다음 복습 날짜 같은 내 복습 기록은 보내지 않아요.</p>' +
        `<div class="gx-row"><button class="btn" type="button" data-gx-back>다른 덱</button><button class="btn primary" type="button" data-gx-send${pl.cs.length ? '' : ' disabled'}>카드 ${pl.cs.length}장 보내기</button></div>`;
    };
    const show = () => {
      box.querySelector('.ui-sheet-body').innerHTML = pick ? pickView() : listView();
      const f = box.querySelector(pick ? '[data-gx-send]' : '[data-gx-deck]:not([disabled])');
      if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    };
    const p = root.UI.openSheet({
      title: '단어장 보내기', body: listView(), cls: 'gx-deck-sheet', focusSel: '[data-gx-deck]:not([disabled])',
      onClick: (e, close) => {
        const d = e.target.closest('[data-gx-deck]');
        if (d && !d.disabled) { pick = d.dataset.gxDeck; show(); return; }
        if (e.target.closest('[data-gx-back]')) { pick = null; show(); return; }
        if (e.target.closest('[data-gx-send]')) close(pick);
      },
    });
    box = sheetBox('gx-deck-sheet');
    const id = await p;
    if (!id || C.openId !== gid) return;
    const cur = store.get(), d = cur.decks.find((x) => x.id === id);
    if (!d) { toast('덱을 찾지 못했어요'); return; }
    const pl = deckPayload(d.name, cur.cards.filter((c) => c.deckId === id)); // 보내는 순간의 카드
    if (!pl.cs.length) { toast('보낼 카드가 없어요'); return; }
    C.send(altText({ p: 'deck', dn: pl.n, cn: pl.cs.length }), { p: 'deck', dn: pl.n, cn: pl.cs.length, pv: pl.cs.slice(0, 3), up: { deck: { n: pl.n, cs: pl.cs } } });
  }

  /* ---------- 받은 단어장: 내 복습에 담기 ---------- */
  let importing = false;
  async function importDeck(x, gid) {
    const CL = root.CardLink;
    if (importing || !x || x.x || x.pend || !x.a || !CL || !CL.confirm) return;
    importing = true;
    const btn = doc.querySelector(`#gc-list [data-gc-s="${x.s}"] [data-gx-act]`);
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = '불러오는 중…'; }
    try {
      let j;
      try { j = await G.call({ op: 'file', g: gid, a: x.a }, { timeout: 60000 }); }
      catch (e) { toast(e.code === 'gone' ? '이미 지워진 단어장이에요' : G.errText(e.code)); return; }
      const data = CL.prepare(j.deck && j.deck.n, (j.deck && j.deck.cs) || []);
      if (!data.cards.length) { toast('단어장에 카드가 없어요'); return; }
      const F = root.Features;
      if (F && !F.on('review')) { // 복습을 꺼 두었으면 켤지 먼저
        const yes = await ask(`단어장에 카드 ${data.cards.length}장이 있어요.\n복습이 꺼져 있는데, 켜고 담을까요?`, { ok: '복습 켜고 담기', cancel: '담지 않기' });
        if (!yes) return;
        F.set('review', true);
      }
      const choice = await CL.confirm(data);
      if (!choice) return;
      if (choice.deckId) { const d = store.get().decks.find((y) => y.id === choice.deckId); choice.deckName = d ? d.name : ''; }
      await CL.settle();
      const r = CL.apply(data, choice, { open: false, from: 'chat' });
      if (r && r.deckId) remember(x.a, r.deckId);
    } finally {
      importing = false;
      if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
      C.refresh();
    }
  }
  function act(v, x, gid) {
    if (!x) return;
    if (v === 'save') savePhoto(x, gid);
    else if (v === 'import') importDeck(x, gid);
    else if (v === 'go') { const id = takenDeck(x.a); if (!id) { C.refresh(); return; } C.close(); App.openDeck(id); }
  }

  // 로그아웃하면 받아 둔 사진을 놓아준다
  root.addEventListener('cloud-user', () => { const u = G.user && G.user(); if (!u) { closeView(); forget(); } });

  root.ChatAttach = {
    bubbleHTML, hydrate, sent, dropped, menu, view, act, closeView,
    get viewing() { return !V.el.hidden; },
    // 시험용
    makePhoto, buildRecord: (span, names) => buildRecord(store.get(), span, recEnv(names)), lib,
  };
})(typeof window !== 'undefined' ? window : globalThis);
