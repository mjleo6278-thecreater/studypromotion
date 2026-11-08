/* 자동 백업: 기록이 사라지지 않게 이 기기 안(IndexedDB)에 사본을 남긴다
 * - 앱을 업데이트했을 때 (업데이트 전에 저장돼 있던 그대로)
 * - 백업 파일 불러오기, 계정 기록 받기, 초기화, 되돌리기처럼 기록을 통째로 바꾸기 직전
 * - 하루에 한 번 (앱을 처음 열 때)
 * - 저장된 기록을 읽지 못했을 때 그 원본
 * 계정·설정 > 백업 > 자동 백업에서 골라 되돌릴 수 있다. */
(function (root) {
  const DB_NAME = 'studypromotion-backup';
  const OS = 'snaps';
  // 까닭별로 남기는 개수 (오래된 것부터 지움)
  const KEEP = { daily: 7, update: 5, import: 3, cloud: 3, 'cloud-remote': 3, reset: 3, restore: 3, broken: 2 };
  const MAX_TOTAL = 25 * 1024 * 1024; // 모두 합쳐 25MB를 넘으면 오래된 것부터
  const REASON = {
    daily: '하루 자동 백업',
    update: '앱 업데이트 때',
    import: '백업 파일 불러오기 전',
    cloud: '계정 기록을 받기 전',
    'cloud-remote': '계정에 있던 기록 (이 기기 기록으로 바꾸기 전)',
    reset: '모든 데이터 초기화 전',
    restore: '자동 백업으로 되돌리기 전',
    broken: '읽지 못한 기록 원본',
  };

  // 지울 사본 고르기 (순수 함수): list는 { id, reason, at, size }
  function prune(list) {
    const sorted = list.slice().sort((a, b) => b.at - a.at);
    const seen = {};
    const keep = [];
    const drop = [];
    for (const s of sorted) {
      const n = (seen[s.reason] = (seen[s.reason] || 0) + 1);
      if (n > (KEEP[s.reason] || 3)) drop.push(s.id); else keep.push(s);
    }
    let total = 0;
    keep.forEach((s, i) => {
      total += s.size || 0;
      if (i > 0 && total > MAX_TOTAL) drop.push(s.id); // 가장 최근 것은 남긴다
    });
    return drop;
  }

  // 사본에 든 기록 개수 (순수 함수). 읽을 수 없으면 null
  function summary(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { return null; }
    if (!d || typeof d !== 'object') return null;
    const len = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
    const minutes = Array.isArray(d.sessions) ? d.sessions.reduce((a, s) => a + (Number(s && s.minutes) || 0), 0) : 0;
    return { sessions: len('sessions'), minutes, tasks: len('tasks'), topics: len('topics'), cards: len('cards'), exams: len('exams') };
  }
  const isEmpty = (sum) => !!sum && !sum.sessions && !sum.tasks && !sum.topics && !sum.cards && !sum.exams;

  const lib = { prune, summary, isEmpty, KEEP, REASON };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  const App = root.App;
  if (!App) return;
  const { store, toast, ask, $, esc } = App;
  const KEY = StoreLib.KEY;
  const DAY_KEY = 'studypromotion.backupDay';
  const VER_KEY = 'studypromotion.appVersion';
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } };

  /* ---------- IndexedDB ---------- */
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!root.indexedDB) return reject(new Error('no-idb'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(OS, { keyPath: 'id', autoIncrement: true });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('idb'));
        req.onblocked = () => reject(new Error('idb-blocked'));
      }).catch((e) => { dbPromise = null; throw e; });
    }
    return dbPromise;
  }
  function run(mode, fn) {
    return db().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(OS, mode);
      const req = fn(t.objectStore(OS));
      t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abort'));
    }));
  }
  const all = () => run('readonly', (os) => os.getAll()).then((l) => (l || []).sort((a, b) => b.at - a.at));

  // 사본 남기기 (차례대로 하나씩)
  let queue = Promise.resolve();
  function add(text, reason, note) {
    if (typeof text !== 'string' || !text) return Promise.resolve(false);
    const sum = summary(text);
    if (reason !== 'broken' && (!sum || isEmpty(sum))) return Promise.resolve(false); // 빈 기록은 남길 필요 없음
    queue = queue.then(async () => {
      const list = await all();
      const latest = list[0];
      if (latest && latest.text === text && reason !== 'broken') return 'same'; // 바로 앞 사본과 같으면 건너뜀
      await run('readwrite', (os) => os.add({ at: Date.now(), reason, note: note || '', version: App.version || '', size: text.length, text }));
      const drop = prune((await all()).map(({ id, reason: r, at, size }) => ({ id, reason: r, at, size })));
      if (drop.length) await run('readwrite', (os) => { drop.forEach((id) => os.delete(id)); return null; });
      return true;
    }).catch(() => false).then((ok) => { if (ok === true && $('#autobk').open) renderList(); return ok; });
    return queue;
  }

  // 지금 저장돼 있는 그대로 (아직 이 버전이 손대기 전의 원본)
  const savedText = () => lsGet(KEY) || JSON.stringify(store.get());

  /* ---------- 언제 남기나 ---------- */
  // 1) 기록을 통째로 바꾸기 직전
  store.onBeforeReplace((text, reason) => { add(text, reason); });

  // 2) 저장된 기록을 읽지 못했을 때: 원본을 보관하고 알린다
  const issue = store.loadIssue();
  if (issue && issue.raw) {
    add(issue.raw, 'broken');
    setTimeout(() => toast('저장된 기록을 읽지 못했어요. 자동 백업에서 되돌릴 수 있어요', { action: '자동 백업', onAction: openList }), 800);
  }

  // 3) 앱이 업데이트됐을 때 (업데이트 전 기록 그대로)
  const lastVer = lsGet(VER_KEY);
  if (App.version && lastVer !== App.version) {
    add(savedText(), 'update', lastVer ? `${lastVer} → ${App.version}` : App.version);
    lsSet(VER_KEY, App.version);
  }

  // 4) 하루에 한 번 (앱을 처음 열 때. 아직 기록이 없으면 기록이 생긴 뒤에)
  function daily() {
    const day = Stats.dayKey(Date.now());
    if (lsGet(DAY_KEY) === day) return;
    add(savedText(), 'daily').then((ok) => { if (ok) lsSet(DAY_KEY, day); });
  }
  setTimeout(daily, 1500);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') daily(); });
  let dailyTimer = null;
  store.subscribe(() => {
    if (lsGet(DAY_KEY) === Stats.dayKey(Date.now())) return;
    clearTimeout(dailyTimer);
    dailyTimer = setTimeout(daily, 4000);
  });

  // 저장에 실패하면 (저장 공간 부족 등) 바로 알린다
  let warnedAt = 0;
  store.onSaveError(() => {
    if (Date.now() - warnedAt < 30000) return;
    warnedAt = Date.now();
    toast('저장 공간이 부족해서 기록을 저장하지 못했어요. 백업 파일을 받아 두세요', { action: '백업', onAction: () => { App.go('account'); setTimeout(() => $('#export-btn').scrollIntoView({ block: 'center' }), 50); } });
  });

  /* ---------- 화면: 계정·설정 > 백업 > 자동 백업 ---------- */
  const fmt = (at) => new Date(at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function sumText(s) {
    if (!s) return '읽을 수 없는 기록이에요. 파일로 받아서 보관할 수 있어요.';
    const parts = [];
    if (s.minutes) parts.push(`공부 ${Stats.formatMinutes(s.minutes)}`);
    parts.push(`기록 ${s.sessions}개`, `할 일 ${s.tasks}개`, `범위 ${s.topics}개`, `카드 ${s.cards}장`);
    return parts.join(' · ');
  }
  let shown = [];
  function renderList() {
    const ul = $('#autobk-list');
    return all().then((list) => {
      shown = list;
      $('#autobk-count').textContent = list.length ? `${list.length}개` : '';
      ul.innerHTML = list.length ? list.map((s) => {
        const sum = summary(s.text);
        return `<li class="autobk-item"><div class="autobk-info"><b>${esc(fmt(s.at))}</b><span class="muted small">${esc(REASON[s.reason] || s.reason)}${s.note ? ' · ' + esc(s.note) : ''}</span><small class="muted">${esc(sumText(sum))}</small></div>` +
          (sum ? `<button class="btn" type="button" data-bk-restore="${s.id}">되돌리기</button>` : `<button class="btn" type="button" data-bk-save="${s.id}">파일로 받기</button>`) + '</li>';
      }).join('') : '<li class="muted small">아직 자동 백업이 없어요. 기록이 생기면 하루에 한 번 남겨요.</li>';
    }).catch(() => {
      $('#autobk-count').textContent = '';
      ul.innerHTML = '<li class="muted small">이 브라우저에서는 자동 백업을 쓸 수 없어요. 위의 ‘백업 내보내기’로 파일을 받아 두세요.</li>';
    });
  }
  function openList() {
    App.go('account');
    const d = $('#autobk');
    d.open = true;
    renderList();
    setTimeout(() => d.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
  }
  $('#autobk').addEventListener('toggle', () => { if ($('#autobk').open) renderList(); });
  $('#autobk-list').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-bk-restore]');
    const f = e.target.closest('[data-bk-save]');
    const snap = shown.find((s) => String(s.id) === ((r || f) && (r || f).dataset[r ? 'bkRestore' : 'bkSave']));
    if (!snap) return;
    if (f) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([snap.text], { type: 'application/json' }));
      a.download = `studypromotion-autobackup-${Stats.dayKey(snap.at)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    }
    if (!(await ask(`${fmt(snap.at)} 기록으로 되돌릴까요?\n지금 기록도 자동 백업에 남겨 두니까 다시 돌아올 수 있어요.`, { ok: '되돌리기' }))) return;
    try {
      store.importJSON(snap.text, 'restore');
      toast('그때 기록으로 되돌렸어요');
      setTimeout(renderList, 300);
    } catch (err) { toast('되돌리지 못했어요: ' + err.message); }
  });

  App.backup = { add, list: all, openList, renderList };
})(typeof window !== 'undefined' ? window : globalThis);
