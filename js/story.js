/* 업데이트 이야기(컷씬): "왜 이 기능을 만들었나"를 짧은 3D 복셀 애니메이션으로 보여 준다.
 * - 업데이트한 사람이 그 버전을 처음 열 때 한 번 저절로 뜬다. 새로 설치한 사람에게는 저절로 띄우지 않는다.
 * - 업데이트 소식의 그 버전 칸에 '업데이트 이야기 보기' 단추가 있어 언제든 다시 본다.
 * - 컷씬은 cutscene/index.html?embed를 화면 전체 iframe으로 연다. 웹 배포본에만 들어 있어서
 *   한 파일 버전(dist/studypromotion.html)과 미리 보기에서는 단추도 숨고 저절로 뜨지도 않는다.
 * - 끝 화면의 '말로 복습 해 보기'를 누르면 오늘 복습할 카드가 가장 많은 덱으로 말로 복습 시작 창을 연다.
 * 이 파일은 js/backup.js보다 먼저 읽혀야 한다 (backup.js가 '지난번에 연 버전'을 지금 버전으로 고쳐 쓰기 전에 읽는다). */
(function () {
  'use strict';
  const App = window.App;
  if (!App) return;
  const { $, toast } = App;

  // 이야기 목록. 새 이야기를 만들면 하나 더 넣고, index.html 그 버전 소식에 data-story 단추를 둔다
  const STORIES = [{ id: 'shower-1', ver: '4.5', title: '샤워하다 생긴 기능', src: 'cutscene/index.html' }];
  const SEEN_KEY = 'studypromotion.storySeen'; // 본(또는 저절로 띄울 필요 없는) 이야기 id를 쉼표로
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } };
  const seenList = () => (lsGet(SEEN_KEY) || '').split(',').filter(Boolean);
  const isSeen = (s) => seenList().includes(s.id);
  const markSeen = (s) => { const l = seenList(); if (!l.includes(s.id)) lsSet(SEEN_KEY, l.concat(s.id).join(',')); };

  // 지난번에 연 버전이 없으면 처음 설치: 지금 버전까지의 이야기는 저절로 띄우지 않는다 (소식에서 볼 수 있음)
  const prevVer = lsGet('studypromotion.appVersion');
  const sameVer = (v) => App.version === v || String(App.version).startsWith(v + '.');
  if (prevVer == null) STORIES.forEach(markSeen);

  // 컷씬 파일이 있는 곳에서만 (웹 배포본: 설치 정보 manifest가 있고 http(s)로 열림)
  let availP = null;
  function available() {
    if (availP) return availP;
    const web = /^https?:$/.test(location.protocol) && !!document.querySelector('link[rel="manifest"]');
    availP = !web ? Promise.resolve(false) : fetch(STORIES[0].src).then((r) => r.ok).catch(() => false);
    return availP;
  }
  function canGL() {
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; }
  }
  const voiceOn = () => !!window.Voice && (!window.Features || window.Features.on('voice'));

  /* ---------- 화면 전체 창 ---------- */
  let box = null, frame = null, lastFocus = null, barWas = null, inerted = [];
  function open(story) {
    if (box) return;
    lastFocus = document.activeElement;
    box = document.createElement('div');
    box.className = 'story';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '업데이트 이야기: ' + story.title);
    frame = document.createElement('iframe');
    frame.title = '업데이트 이야기: ' + story.title;
    frame.setAttribute('allow', 'autoplay');
    frame.src = story.src + '?embed' + (voiceOn() ? '' : '&try=0');
    frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch (e) { /* 무시 */ } });
    box.appendChild(frame);
    // 뒤의 앱은 눌리거나 Tab으로 가지 않게
    inerted = Array.from(document.body.children).filter((el) => el !== box && !el.inert && el.id !== 'toast');
    inerted.forEach((el) => { el.inert = true; });
    document.body.appendChild(box);
    document.documentElement.classList.add('story-on');
    // 폰 상단 바도 무대 색으로
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) { barWas = m.getAttribute('content'); m.setAttribute('content', '#16181d'); }
    requestAnimationFrame(() => { if (box) box.classList.add('in'); });
  }
  function close() {
    if (!box) return false;
    const b = box;
    box = null; frame = null;
    inerted.forEach((el) => { el.inert = false; });
    inerted = [];
    document.documentElement.classList.remove('story-on');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m && barWas != null) m.setAttribute('content', barWas);
    barWas = null;
    b.classList.remove('in');
    b.classList.add('out');
    setTimeout(() => b.remove(), 240); // 사라지는 동안 소리·그림은 이미 멈춰 있다(iframe이 멈춘 뒤 알림)
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    return true;
  }

  // 끝 화면 '말로 복습 해 보기': 오늘 복습할 카드가 가장 많은 덱(같으면 카드가 많은 덱)으로
  function tryVoice() {
    const st = App.store.get();
    const decks = st.decks || [];
    if (!decks.length) { App.openDeck(null); toast('덱을 하나 만들면 덱 화면에서 ‘말로 복습’을 쓸 수 있어요'); return; }
    const t = App.now();
    const due = (c) => (window.SRS ? window.SRS.isDue(c, t) : true);
    const score = decks.map((d) => { const cs = st.cards.filter((c) => c.deckId === d.id); return { d, due: cs.filter(due).length, all: cs.length }; });
    score.sort((a, b) => b.due - a.due || b.all - a.all);
    const best = score[0];
    App.openDeck(best.d.id);
    if (!best.all) { toast('카드를 넣으면 ‘말로 복습’을 쓸 수 있어요'); return; }
    setTimeout(() => { if (window.Voice) window.Voice.open(best.d.id); }, 200);
  }

  window.addEventListener('message', (e) => {
    if (!frame || e.origin !== location.origin || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (!d || d.sp !== 'cutscene') return;
    if (d.action === 'close') close();
    else if (d.action === 'try') { close(); tryVoice(); }
    else if (d.action === 'nogl') { close(); toast('이 기기에서는 업데이트 이야기를 볼 수 없어요'); }
  });
  document.addEventListener('keydown', (e) => { if (box && e.key === 'Escape') close(); });

  /* ---------- 업데이트 소식의 '업데이트 이야기 보기' ---------- */
  const storyOf = (id) => STORIES.find((s) => s.id === id) || null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-story]');
    if (!b) return;
    const s = storyOf(b.dataset.story);
    if (!s) return;
    if (!canGL()) { toast('이 기기에서는 업데이트 이야기를 볼 수 없어요'); return; }
    markSeen(s);
    open(s);
  });
  available().then((ok) => { if (ok) document.querySelectorAll('[data-story]').forEach((b) => { const p = b.closest('.ver-story'); (p || b).hidden = false; }); });

  /* ---------- 업데이트한 뒤 처음 열 때 한 번 ---------- */
  // 그 버전이거나(4.5, 4.5.1 …), 그 버전 전에 마지막으로 열고 건너뛰어 올라온 사람(4.4.1 → 4.6)에게
  const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  const jumped = (v) => prevVer != null && cmpVer(prevVer, v) < 0 && cmpVer(v, App.version) <= 0;
  const pending = STORIES.find((s) => (sameVer(s.ver) || jumped(s.ver)) && !isSeen(s));
  // 다른 일을 하는 중이면 띄우지 않는다 (타이머·잠금·확인 창·시트·말로 복습·게임·시작 화면)
  function busy() {
    return document.visibilityState !== 'visible' || !!document.getElementById('splash') ||
      (App.timerBusy && App.timerBusy()) || (window.Stopwatch && window.Stopwatch.running && window.Stopwatch.running()) ||
      !!(window.Lock && window.Lock.state) || (window.Voice && window.Voice.active && window.Voice.active()) ||
      (window.Bounce && window.Bounce.isOpen && window.Bounce.isOpen()) ||
      !!document.querySelector('.ask-backdrop:not([hidden]), .ui-back:not(.out)') ||
      (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
  }
  if (pending && canGL()) {
    available().then((ok) => {
      if (!ok) return;
      let tries = 0;
      const attempt = () => {
        if (box || isSeen(pending)) return;
        if (busy()) { if (++tries < 40) setTimeout(attempt, 1500); return; } // 1분쯤 기다려도 바쁘면 다음에 열 때
        markSeen(pending);
        open(pending);
      };
      setTimeout(attempt, 900);
    });
  }

  window.Story = { open: (id) => { const s = storyOf(id || STORIES[0].id); if (s) open(s); }, close, back: close, get isOpen() { return !!box; }, stories: STORIES, seen: seenList };
})();
