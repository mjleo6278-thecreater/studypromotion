/* 계정과 기기 간 동기화 (Firebase 로그인 + Firestore 저장)
 * - 구글 계정 로그인 또는 이메일·비밀번호 가입
 * - 공부 기록 전체를 users/{uid} 문서 하나에 저장하고, 다른 기기의 변경을 실시간으로 받는다
 * - 인터넷이 없으면 이 기기에만 저장하고, 연결되면 올린다
 * Firebase 콘솔의 웹 앱 설정값을 아래 FIREBASE_CONFIG에 넣어야 동작한다. */
(function (root) {
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCVU1TC83-4CquiKHZKJ-4F_lcUHZUcqCA',
    authDomain: 'studypromotionbyleo.firebaseapp.com',
    projectId: 'studypromotionbyleo',
    storageBucket: 'studypromotionbyleo.firebasestorage.app',
    messagingSenderId: '1023406231883',
    appId: '1:1023406231883:web:ee44f5259650d1994658ce',
  };

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const META_KEY = 'studypromotion.cloud';
  const DEVICE_KEY = 'studypromotion.device';
  const MAX_BYTES = 900000; // Firestore 문서 한도(1MB)보다 조금 작게

  // 동기화 방향 (순수 함수, 테스트 대상)
  //  meta: { remoteAt, dirty }  remote: { updatedAt } | null  localEmpty: 이 기기에 기록이 없음
  function decide(meta, remote, localEmpty) {
    meta = meta || {};
    if (!remote) return 'upload';
    if (localEmpty) return 'download';
    if (!meta.remoteAt) return 'ask'; // 이 기기에서 처음 로그인했는데 계정에 기록이 있음
    const remoteChanged = remote.updatedAt !== meta.remoteAt;
    if (remoteChanged && meta.dirty) return 'ask';
    if (remoteChanged) return 'download';
    if (meta.dirty) return 'upload';
    return 'none';
  }

  // Firebase 오류를 한국어로
  function errorText(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-email': '이메일 형식이 맞지 않아요.',
      'auth/missing-password': '비밀번호를 입력해 주세요.',
      'auth/weak-password': '비밀번호는 6자 이상이어야 해요.',
      'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인을 눌러 주세요.',
      'auth/invalid-credential': '이메일이나 비밀번호가 맞지 않아요.',
      'auth/wrong-password': '비밀번호가 맞지 않아요.',
      'auth/user-not-found': '가입되지 않은 이메일이에요. 새 계정 만들기를 눌러 주세요.',
      'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해 주세요.',
      'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
      'auth/popup-closed-by-user': '로그인 창이 닫혔어요.',
      'auth/cancelled-popup-request': '로그인 창이 닫혔어요.',
      'auth/unauthorized-domain': '이 주소가 Firebase 승인된 도메인에 없어요.',
      'auth/operation-not-allowed': 'Firebase에서 이 로그인 방법이 꺼져 있어요.',
      'permission-denied': '저장 권한이 없어요 (Firestore 보안 규칙 확인).',
    };
    return map[code] || (e && e.message) || '문제가 생겼어요.';
  }

  const lib = { decide, errorText, MAX_BYTES };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  const App = root.App;
  if (!App) return;
  const { store, toast, ask, $ } = App;

  const loadJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
  let meta = loadJSON(META_KEY);
  const saveMeta = () => { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 무시 */ } };
  let device = '';
  try { device = localStorage.getItem(DEVICE_KEY) || ''; if (!device) { device = Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, device); } } catch (e) { device = 'x'; }

  let fb = null; // firebase 네임스페이스
  let user = null;
  let docRef = null;
  let unsub = null;
  let busy = false;
  let applyingRemote = false;
  let pushTimer = null;

  function render(msg) {
    const on = !!user;
    $('#acc-out').hidden = on;
    $('#acc-in').hidden = !on;
    const ready = !!FIREBASE_CONFIG;
    $('#acc-google').disabled = !ready;
    $('#acc-form').querySelectorAll('button, input').forEach((b) => { b.disabled = !ready; });
    let text;
    if (!ready) text = '계정 기능 준비 중이에요. 곧 구글 계정이나 이메일로 로그인해서 여러 기기에서 같은 기록을 쓸 수 있어요.';
    else if (!on) text = '구글 계정이나 이메일로 로그인할 수 있어요.';
    else {
      const when = meta.syncedAt ? new Date(meta.syncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '아직 없음';
      text = `${user.email || '구글 계정'} 로그인됨 · 마지막 동기화 ${when}${meta.dirty ? ' · 올릴 변경 있음' : ''}${navigator.onLine === false ? ' · 오프라인' : ''}`;
    }
    $('#acc-status').textContent = msg || text;
    // 계정 화면 머리글과 오른쪽 위 아이콘
    const name = on ? (user.displayName || (user.email || '').split('@')[0] || '내 계정') : '';
    const title = $('#acc-title');
    if (title) title.textContent = on ? `${name} 님` : '로그인하지 않았어요';
    const av = $('#acc-avatar');
    if (av) {
      av.classList.toggle('on', on);
      if (on) av.textContent = (name || '나').trim().charAt(0).toUpperCase();
      else if (!av.querySelector('svg')) av.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.4" r="3.9"/><path d="M4.6 20c1.1-3.9 4-6 7.4-6s6.3 2.1 7.4 6"/></svg>';
    }
    const btn = $('#account-btn');
    if (btn) { btn.classList.toggle('on', on); btn.title = on ? `계정·설정 (${user.email || name} 로그인됨)` : '계정·설정 (로그인 안 함)'; }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('로그인 도구를 불러오지 못했어요 (인터넷 연결 확인)'));
      document.head.appendChild(s);
    });
  }

  let initPromise = null;
  function init() {
    if (!FIREBASE_CONFIG) return Promise.reject(new Error('계정 기능 준비 중이에요.'));
    if (!initPromise) {
      initPromise = (async () => {
        if (!root.firebase) {
          await loadScript(SDK + 'firebase-app-compat.js');
          await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
        }
        fb = root.firebase;
        if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
        try { fb.firestore().enablePersistence && await fb.firestore().enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 여러 탭 등: 무시 */ }
        fb.auth().onAuthStateChanged(onUser);
        try { await fb.auth().getRedirectResult(); } catch (e) { toast(errorText(e)); }
      })().catch((e) => { initPromise = null; throw e; });
    }
    return initPromise;
  }

  function localEmpty() {
    const st = store.get();
    return !st.tasks.length && !st.sessions.length && !st.cards.length && !st.topics.length && !st.exams.length;
  }

  async function onUser(u) {
    if (unsub) { unsub(); unsub = null; }
    user = u;
    docRef = u ? fb.firestore().collection('users').doc(u.uid) : null;
    if (!u) { render(); return; }
    if (meta.uid !== u.uid) { meta = { uid: u.uid }; saveMeta(); } // 다른 계정이면 처음처럼
    render();
    await syncNow(false);
    // 다른 기기에서 바꾸면 바로 받기
    unsub = docRef.onSnapshot((snap) => {
      if (!snap.exists || snap.metadata.hasPendingWrites) return;
      const d = snap.data();
      if (d.device === device || d.updatedAt === meta.remoteAt) return;
      if (meta.dirty) { syncNow(false); return; }
      applyRemote(d);
      toast('다른 기기의 기록을 받아 왔어요');
    }, () => { /* 권한 오류 등은 syncNow에서 안내 */ });
  }

  function applyRemote(d) {
    applyingRemote = true;
    try { store.importJSON(d.data, 'cloud'); } finally { applyingRemote = false; }
    meta.remoteAt = d.updatedAt;
    meta.dirty = false;
    meta.syncedAt = Date.now();
    saveMeta();
    App.render();
    render();
  }

  async function upload() {
    const data = store.exportJSON();
    if (data.length > MAX_BYTES) throw new Error('기록이 너무 커서 저장하지 못했어요. 펜 자국을 조금 지워 주세요.');
    const updatedAt = Date.now();
    await docRef.set({ data, updatedAt, device, email: user.email || null });
    meta.remoteAt = updatedAt;
    meta.dirty = false;
    meta.syncedAt = Date.now();
    saveMeta();
  }

  async function syncNow(interactive) {
    if (!user || busy) return;
    busy = true;
    render('동기화 중…');
    try {
      const snap = await docRef.get();
      const remote = snap.exists ? snap.data() : null;
      let action = decide(meta, remote, localEmpty());
      if (action === 'ask') {
        const when = new Date(remote.updatedAt).toLocaleString('ko-KR');
        const useRemote = await ask(`이 계정에 저장된 기록이 있어요 (${when}).\n어느 쪽 기록을 쓸까요?\n\n고르지 않은 쪽은 이 기기의 자동 백업에 남겨 둬요.`, { ok: '계정 기록 불러오기', cancel: '이 기기 기록 올리기', mustChoose: true });
        action = useRemote ? 'download' : 'upload';
        // 계정에 있던 기록을 이 기기 기록으로 덮기 전에 이 기기에 사본을 남긴다
        if (!useRemote && App.backup && remote.data) await App.backup.add(remote.data, 'cloud-remote');
      }
      if (action === 'download') { applyRemote(remote); toast('계정의 기록을 불러왔어요'); }
      else if (action === 'upload') { await upload(); if (interactive) toast('계정에 저장했어요'); }
      else if (interactive) { meta.syncedAt = Date.now(); saveMeta(); toast('이미 최신이에요'); }
    } catch (e) {
      toast(errorText(e));
    } finally {
      busy = false;
      render();
    }
  }

  // 기록이 바뀌면 잠시 뒤 계정에 올린다 (다른 탭에서 받아 온 변경은 그 탭이 올린다)
  store.subscribe((st, info) => {
    if (applyingRemote || !meta.uid || (info && info.external)) return;
    if (!meta.dirty) { meta.dirty = true; saveMeta(); }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 2500);
  });
  function pushNow() {
    clearTimeout(pushTimer);
    if (!user || !meta.dirty || busy) return;
    busy = true;
    upload().catch((e) => toast(errorText(e))).finally(() => { busy = false; render(); });
  }
  // 앱을 내려 두면 바로 올리고, 다시 열면 다른 기기 변경을 확인한다
  let lastCheck = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pushNow();
    else if (user && Date.now() - lastCheck > 20000) { lastCheck = Date.now(); syncNow(false); }
  });
  window.addEventListener('online', () => { render(); if (user) syncNow(false); });
  window.addEventListener('offline', () => render());

  // 버튼
  $('#acc-google').addEventListener('click', async () => {
    try {
      await init();
      const provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try { await fb.auth().signInWithPopup(provider); }
      catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) { meta.redirecting = true; saveMeta(); await fb.auth().signInWithRedirect(provider); }
        else throw e;
      }
    } catch (e) { toast(errorText(e)); }
  });
  let formMode = 'login';
  $('#acc-form').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) formMode = b.dataset.mode; });
  $('#acc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#acc-email').value.trim();
    const pass = $('#acc-pass').value;
    try {
      await init();
      if (formMode === 'signup') { await fb.auth().createUserWithEmailAndPassword(email, pass); toast('계정을 만들었어요'); }
      else { await fb.auth().signInWithEmailAndPassword(email, pass); toast('로그인했어요'); }
      $('#acc-pass').value = '';
    } catch (err) { toast(errorText(err)); }
  });
  $('#acc-reset').addEventListener('click', async () => {
    const email = $('#acc-email').value.trim();
    if (!email) { toast('이메일을 먼저 적어 주세요'); $('#acc-email').focus(); return; }
    try { await init(); await fb.auth().sendPasswordResetEmail(email); toast('비밀번호 재설정 메일을 보냈어요'); }
    catch (e) { toast(errorText(e)); }
  });
  $('#acc-sync').addEventListener('click', () => syncNow(true));
  $('#acc-logout').addEventListener('click', async () => {
    if (!(await ask('로그아웃할까요? 계정에 저장된 기록은 그대로 남고, 이 기기의 기록도 지워지지 않아요.', { ok: '로그아웃' }))) return;
    // 아직 계정에 올리지 못한 변경이 있으면 로그아웃 전에 마저 올린다 (올리는 도중에 로그아웃되면 저장이 실패할 수 있다)
    clearTimeout(pushTimer);
    if (user && meta.dirty && !busy && navigator.onLine !== false) {
      busy = true;
      render('계정에 저장하는 중…');
      try { await Promise.race([upload(), new Promise((res, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]); } catch (e) { /* 올리지 못해도 이 기기의 기록은 그대로 남는다 */ }
      busy = false;
    }
    try { await fb.auth().signOut(); } catch (e) { /* 무시 */ }
    meta = {}; saveMeta();
    render();
    toast('로그아웃했어요');
  });

  // 전에 로그인했던 기기면 열 때 바로 이어서 연결
  if (FIREBASE_CONFIG && (meta.uid || meta.redirecting)) { delete meta.redirecting; saveMeta(); init().catch(() => render()); }

  root.Cloud = { get meta() { return meta; }, get user() { return user; }, syncNow };
  render();
})(typeof window !== 'undefined' ? window : globalThis);
