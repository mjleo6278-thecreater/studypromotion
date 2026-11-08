/* 구글 계정 연동: 공부 기록을 내 구글 드라이브의 파일 하나에 저장하고, 다른 기기에서 불러온다.
 * - 권한은 drive.file (이 앱이 만든 파일만 보고 쓸 수 있음, 다른 드라이브 파일은 못 봄)
 * - 구글 Cloud 콘솔에서 만든 "OAuth 클라이언트 ID"가 있어야 동작한다 (README 참고) */
(function (root) {
  // ▼ 구글 Cloud 콘솔 → API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)
  const CLIENT_ID = '';

  const FILE_NAME = 'studypromotion-data.json';
  const META_KEY = 'studypromotion.google';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';

  // 동기화 방향 정하기 (순수 함수, 테스트 대상)
  //  meta: { remoteModified, dirty }  remote: { modifiedTime } | null
  //  반환: 'upload' | 'download' | 'ask' | 'none'
  function decide(meta, remote) {
    meta = meta || {};
    if (!remote) return 'upload';
    const remoteChanged = remote.modifiedTime !== meta.remoteModified;
    if (!meta.remoteModified) return 'ask'; // 이 기기에서 처음 연결: 드라이브에 이미 기록이 있음
    if (remoteChanged && meta.dirty) return 'ask';
    if (remoteChanged) return 'download';
    if (meta.dirty) return 'upload';
    return 'none';
  }

  const lib = { decide, FILE_NAME };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  const App = root.App;
  if (!App) return;
  const { store, toast, ask, $ } = App;

  function loadMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
  let meta = loadMeta();
  function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 무시 */ } }

  let token = null; // { value, exp }
  let tokenClient = null;
  let busy = false;
  let applyingRemote = false;
  let pushTimer = null;

  const el = {
    status: $('#g-status'), connect: $('#g-connect'), sync: $('#g-sync'), disconnect: $('#g-disconnect'),
  };

  function render(msg) {
    const on = !!meta.email;
    el.connect.hidden = on;
    el.sync.hidden = !on;
    el.disconnect.hidden = !on;
    el.connect.disabled = !CLIENT_ID;
    let text;
    if (!CLIENT_ID) text = '구글 연동 준비 중이에요 (관리자가 구글 클라이언트 ID를 넣어야 켜져요).';
    else if (!on) text = '구글 계정을 연결하면 기록이 내 구글 드라이브에 저장되고, 다른 폰·PC에서도 이어서 쓸 수 있어요.';
    else {
      const when = meta.syncedAt ? new Date(meta.syncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '아직 없음';
      text = `${meta.email} 연결됨 · 마지막 동기화 ${when}${meta.dirty ? ' · 올릴 변경 있음' : ''}`;
    }
    el.status.textContent = msg || text;
  }

  function loadGis() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('구글 로그인 도구를 불러오지 못했어요 (인터넷 연결 확인)'));
      document.head.appendChild(s);
    });
  }

  // 반드시 사용자 탭(클릭) 안에서 불러야 팝업이 막히지 않는다
  async function getToken(interactive) {
    if (token && token.exp > Date.now() + 60000) return token.value;
    await loadGis();
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        tokenClient = root.google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
      }
      tokenClient.callback = (res) => {
        if (res.error) return reject(new Error(res.error_description || res.error));
        token = { value: res.access_token, exp: Date.now() + (res.expires_in || 3600) * 1000 };
        resolve(token.value);
      };
      tokenClient.error_callback = (err) => reject(new Error(err && err.type === 'popup_closed' ? '로그인 창이 닫혔어요' : '로그인하지 못했어요'));
      tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '', login_hint: meta.email || undefined });
    });
  }

  async function api(url, opts) {
    const res = await fetch(url, Object.assign({}, opts, {
      headers: Object.assign({ Authorization: 'Bearer ' + token.value }, (opts && opts.headers) || {}),
    }));
    if (res.status === 401) { token = null; throw new Error('구글 로그인이 만료됐어요. 동기화 버튼을 다시 눌러 주세요.'); }
    if (!res.ok) throw new Error('구글 드라이브 오류 (' + res.status + ')');
    return res;
  }

  async function findRemote() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`);
    const files = (await res.json()).files || [];
    return files[0] || null;
  }

  async function download(remote) {
    const res = await api(`https://www.googleapis.com/drive/v3/files/${remote.id}?alt=media`);
    const text = await res.text();
    applyingRemote = true;
    try { store.importJSON(text); } finally { applyingRemote = false; }
    meta.fileId = remote.id;
    meta.remoteModified = remote.modifiedTime;
    meta.dirty = false;
    meta.syncedAt = Date.now();
    saveMeta();
    App.render();
  }

  async function upload() {
    const body = store.exportJSON();
    let res;
    if (meta.fileId) {
      res = await api(`https://www.googleapis.com/upload/drive/v3/files/${meta.fileId}?uploadType=media&fields=id,modifiedTime`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
      }).catch(async (e) => {
        if (/\(404\)/.test(e.message)) { meta.fileId = null; return null; } // 드라이브에서 지운 경우 새로 만든다
        throw e;
      });
    }
    if (!res) {
      const boundary = 'sp' + Math.random().toString(36).slice(2);
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', description: '스터디 프로모션 공부 기록 (앱이 자동으로 관리해요)' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
        method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart,
      });
    }
    const file = await res.json();
    meta.fileId = file.id;
    meta.remoteModified = file.modifiedTime;
    meta.dirty = false;
    meta.syncedAt = Date.now();
    saveMeta();
  }

  async function sync(interactive) {
    if (busy) return;
    busy = true;
    render('동기화 중…');
    try {
      await getToken(interactive);
      if (!meta.email) {
        try {
          const info = await (await api('https://openidconnect.googleapis.com/v1/userinfo')).json();
          meta.email = info.email || '구글 계정';
        } catch (e) { meta.email = '구글 계정'; }
        saveMeta();
      }
      const remote = await findRemote();
      if (remote && meta.fileId !== remote.id && meta.remoteModified) meta.remoteModified = null; // 다른 파일이면 처음처럼
      let action = decide(meta, remote);
      const st = store.get();
      const localEmpty = !st.tasks.length && !st.sessions.length && !st.cards.length && !st.topics.length && !st.exams.length;
      if (action === 'ask' && localEmpty) action = 'download';
      if (action === 'ask') {
        const when = new Date(remote.modifiedTime).toLocaleString('ko-KR');
        const useRemote = await ask(`구글 드라이브에 저장된 기록이 있어요 (${when}).\n드라이브 기록을 이 기기로 불러올까요?\n\n취소를 누르면 이 기기의 기록을 드라이브에 올려요.`);
        action = useRemote ? 'download' : 'upload';
        if (!useRemote) meta.fileId = remote.id;
      }
      if (action === 'download') { await download(remote); toast('드라이브에서 기록을 불러왔어요'); }
      else if (action === 'upload') { await upload(); if (interactive) toast('드라이브에 저장했어요'); }
      else if (interactive) { meta.syncedAt = Date.now(); saveMeta(); toast('이미 최신이에요'); }
      render();
    } catch (e) {
      render();
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  // 기록이 바뀌면 몇 초 뒤 자동으로 드라이브에 올린다 (로그인이 살아 있을 때)
  store.subscribe(() => {
    if (applyingRemote || !meta.email) return;
    if (!meta.dirty) { meta.dirty = true; saveMeta(); }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 4000);
  });
  function pushNow() {
    clearTimeout(pushTimer);
    if (!meta.email || !meta.dirty || busy || !token || token.exp < Date.now() + 60000) { render(); return; }
    busy = true;
    upload().catch((e) => toast(e.message)).finally(() => { busy = false; render(); });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pushNow(); });

  // 다시 열었을 때: 첫 번째 탭에서 조용히 로그인을 이어 받아 최신 기록을 확인한다
  if (CLIENT_ID && meta.email) {
    const resume = () => { document.removeEventListener('pointerdown', resume, true); sync(false); };
    document.addEventListener('pointerdown', resume, true);
  }

  el.connect.addEventListener('click', () => sync(true));
  el.sync.addEventListener('click', () => sync(false));
  el.disconnect.addEventListener('click', async () => {
    if (!(await ask('구글 연결을 끊을까요? 드라이브에 저장된 기록은 그대로 남아요.'))) return;
    try { if (token && root.google) root.google.accounts.oauth2.revoke(token.value, () => {}); } catch (e) { /* 무시 */ }
    token = null;
    meta = {};
    saveMeta();
    render();
    toast('구글 연결을 끊었어요');
  });

  root.GSync = { sync, get meta() { return meta; } };
  render();
})(typeof window !== 'undefined' ? window : globalThis);
