/* 폰 잠금 모드: 정한 시간 동안 잠금 화면만 보이게 한다.
 * 웹앱은 폰 자체를 잠글 수 없어서, 할 수 있는 만큼 막는다:
 *  - 전체 화면 + 화면 꺼짐 방지
 *  - 뒤로 가기 막기
 *  - 앱을 닫았다 다시 열어도 끝나는 시각까지 잠금 화면 유지 (localStorage)
 *  - 다른 앱으로 나간 횟수와 시간 기록
 *  - 포기는 3초 길게 눌러야 가능 */
(function (root) {
  const KEY = 'studypromotion.lock';

  // 잠금 기록에서 공부 시간(분) 계산 (순수 함수, 테스트 대상)
  //  lock: { startAt, endAt, awayMs }  at: 끝낸 시각
  function studiedMinutes(lock, at) {
    const end = Math.min(at, lock.endAt);
    const ms = Math.max(0, end - lock.startAt - (lock.awayMs || 0));
    return Math.floor(ms / 60000);
  }
  const lib = { studiedMinutes };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  const App = root.App;
  if (!App) return;
  const { store, toast, ask, $, $$, uid } = App;

  const MSGS = ['지금은 공부 시간이에요.', '한 칸씩 전진 중이에요.', '폰은 내려놓고, 책을 펴요.', '끝나면 스스로를 칭찬해 줘요.', '집중한 만큼 승급해요.'];
  let lock = null; // { startAt, endAt, minutes, subjectId, leaves, awayMs, hiddenAt }
  let tick = null;
  let wakeLock = null;

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const write = () => { try { lock ? localStorage.setItem(KEY, JSON.stringify(lock)) : localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } };
  const clock = (sec) => {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // 시간 고르기
  let chosen = 60;
  $$('#lock-chips [data-lock]').forEach((b) => b.addEventListener('click', () => {
    chosen = +b.dataset.lock;
    $('#lock-custom').value = '';
    $$('#lock-chips [data-lock]').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('#lock-custom').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (v > 0) { chosen = Math.min(600, v); $$('#lock-chips [data-lock]').forEach((x) => x.classList.remove('active')); }
  });

  $('#lock-start').addEventListener('click', async () => {
    const sel = $('#timer-subject');
    const subName = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    if (!(await ask(`${Stats.formatMinutes(chosen)} 동안 잠글까요?${subName ? `\n과목: ${subName}` : ''}\n\n중간에 그만두려면 3초 길게 눌러야 해요.`))) return;
    const t = Date.now();
    lock = { startAt: t, endAt: t + chosen * 60000, minutes: chosen, subjectId: (sel && sel.value) || null, subjectName: subName, leaves: 0, awayMs: 0, hiddenAt: null };
    write();
    show(true);
  });

  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* 지원 안 함 */ }
  }
  function goFullscreen() {
    const el = document.documentElement;
    try { if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch (e) { /* 무시 */ }
  }

  function show(fromTap) {
    $('#lock-screen').hidden = false;
    document.body.style.overflow = 'hidden';
    if (fromTap) goFullscreen();
    keepAwake();
    history.pushState({ lock: 1 }, '', location.href);
    $('#lock-sub').textContent = `${lock.subjectName ? lock.subjectName + ' · ' : ''}${Stats.formatMinutes(lock.minutes)} 잠금`;
    $('#lock-msg').textContent = MSGS[Math.floor(Math.random() * MSGS.length)];
    clearInterval(tick);
    tick = setInterval(update, 500);
    update();
  }

  function update() {
    if (!lock) return;
    const left = Math.max(0, Math.ceil((lock.endAt - Date.now()) / 1000));
    $('#lock-time').textContent = clock(left);
    $('#lock-leaves').textContent = lock.leaves ? `다른 앱으로 나간 횟수 ${lock.leaves}번 · ${Stats.formatMinutes(Math.round(lock.awayMs / 60000))}` : '';
    if (left <= 0) finish(true);
  }

  function finish(completed) {
    const at = Date.now();
    const minutes = studiedMinutes(lock, at);
    const done = lock;
    lock = null;
    write();
    clearInterval(tick);
    $('#lock-screen').hidden = true;
    document.body.style.overflow = '';
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* 무시 */ }
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* 무시 */ }
    if (minutes > 0) {
      store.update((st) => st.sessions.push({ id: uid(), subjectId: done.subjectId, minutes, endedAt: Math.min(at, done.endAt), label: completed ? '잠금 모드 완료' : '잠금 모드 (중단)', lock: true, leaves: done.leaves }));
    }
    try { if (completed && navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* 무시 */ }
    toast(completed ? `잠금 완료! ${Stats.formatMinutes(minutes)} 공부를 기록했어요` : `잠금을 그만뒀어요. ${Stats.formatMinutes(minutes)}만 기록했어요`);
  }

  // 다른 앱으로 나가면 기록
  document.addEventListener('visibilitychange', () => {
    if (!lock) return;
    if (document.visibilityState === 'hidden') {
      lock.hiddenAt = Date.now();
      lock.leaves++;
      write();
    } else {
      if (lock.hiddenAt) {
        lock.awayMs += Math.max(0, Math.min(Date.now(), lock.endAt) - lock.hiddenAt);
        lock.hiddenAt = null;
        write();
        $('#lock-msg').textContent = '돌아왔네요. 나가 있던 시간은 공부 시간에서 빠져요.';
      }
      keepAwake();
      update();
    }
  });

  // 뒤로 가기 막기
  window.addEventListener('popstate', () => {
    if (!lock) return;
    history.pushState({ lock: 1 }, '', location.href);
    const scr = $('#lock-screen');
    scr.classList.remove('shake'); void scr.offsetWidth; scr.classList.add('shake');
    $('#lock-msg').textContent = '잠금 중이에요. 시간이 끝나면 풀려요.';
  });

  // 3초 길게 눌러 포기
  const quit = $('#lock-quit');
  let holdT = null;
  const holdStart = (e) => { e.preventDefault(); quit.classList.add('holding'); holdT = setTimeout(async () => {
    quit.classList.remove('holding');
    if (!lock) return;
    const left = Math.ceil((lock.endAt - Date.now()) / 60000);
    if (await ask(`아직 ${Stats.formatMinutes(left)} 남았어요. 정말 그만둘까요?`)) { if (lock) finish(false); }
  }, 3000); };
  const holdEnd = () => { clearTimeout(holdT); quit.classList.remove('holding'); };
  quit.addEventListener('pointerdown', holdStart);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => quit.addEventListener(ev, holdEnd));
  quit.addEventListener('contextmenu', (e) => e.preventDefault());

  // 화면 아무 곳이나 누르면 다시 전체 화면으로
  $('#lock-screen').addEventListener('click', (e) => { if (e.target !== quit && !quit.contains(e.target)) goFullscreen(); });

  // 앱을 다시 열었을 때 잠금 이어 가기
  const saved = read();
  if (saved && saved.endAt) {
    lock = saved;
    if (lock.hiddenAt) { // 앱이 닫혀 있던 시간도 나가 있던 시간으로 친다
      lock.awayMs += Math.max(0, Math.min(Date.now(), lock.endAt) - lock.hiddenAt);
      lock.hiddenAt = null;
      write();
    }
    if (Date.now() >= lock.endAt) finish(true);
    else show(false);
  }

  root.Lock = { get state() { return lock; } };
})(typeof window !== 'undefined' ? window : globalThis);
