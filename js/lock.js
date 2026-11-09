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
  const { store, toast, ask, $, $$ } = App;

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

  // 시간 고르기: 30분·1시간·1시간 30분·2시간, ‘직접’을 누르면 분을 적는 칸 (타이머의 시간 고르기와 같은 모양)
  const LOCK_PRESETS = [30, 60, 90, 120];
  const LOCK_MAX = 600;
  let chosen = 60, lockEditing = false;
  function renderLockChips() {
    const box = $('#lock-chips');
    const opts = LOCK_PRESETS.includes(chosen) ? LOCK_PRESETS : LOCK_PRESETS.concat(chosen).sort((a, b) => a - b);
    box.innerHTML = opts.map((m) => `<button class="chip${m === chosen ? ' active' : ''}" data-lock="${m}" type="button" aria-pressed="${m === chosen}">${Stats.formatMinutes(m)}</button>`).join('')
      + (lockEditing
        ? `<form class="len-custom" id="lock-form" novalidate><input type="number" id="lock-input" inputmode="numeric" min="1" max="${LOCK_MAX}" step="1" value="${chosen}" aria-label="잠글 시간(분), 1~${LOCK_MAX}"><span aria-hidden="true">분</span><button type="submit">확인</button></form>`
        : '<button class="chip len-edit" data-lock-edit type="button" aria-label="잠글 시간 직접 정하기">직접</button>');
    if (lockEditing) { const inp = $('#lock-input'); inp.focus({ preventScroll: true }); inp.select(); }
  }
  function setLock(v) {
    let m = Math.round(Number(v));
    if (!(m >= 1)) return false;
    if (m > LOCK_MAX) { m = LOCK_MAX; toast(`잠금은 ${Stats.formatMinutes(LOCK_MAX)}까지 정할 수 있어요`); }
    chosen = m;
    lockEditing = false;
    renderLockChips();
    return true;
  }
  function closeLockEdit(focusChip) {
    if (!lockEditing) return;
    lockEditing = false;
    renderLockChips();
    if (focusChip) { const b = $('#lock-chips [data-lock-edit]'); if (b) b.focus(); }
  }
  // 적는 칸이 열려 있으면 적어 둔 분을 반영하고 닫는다 (숫자를 바꿨을 때만)
  function commitLockEdit() {
    if (!lockEditing) return;
    const inp = $('#lock-input');
    const v = inp ? Math.round(Number(inp.value)) : NaN;
    if (v >= 1 && v !== chosen) setLock(v); else closeLockEdit(false);
  }
  $('#lock-chips').addEventListener('click', (e) => {
    if (e.target.closest('[data-lock-edit]')) { lockEditing = true; renderLockChips(); return; }
    const b = e.target.closest('[data-lock]');
    if (b) { chosen = +b.dataset.lock; lockEditing = false; renderLockChips(); }
  });
  $('#lock-chips').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!setLock($('#lock-input').value)) { toast('1분 이상으로 적어 주세요'); $('#lock-input').focus(); }
  });
  $('#lock-chips').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lockEditing) { e.stopPropagation(); closeLockEdit(true); }
  });
  // 칸 밖을 누르면: 숫자를 바꿨으면 그 시간으로, 아니면 그냥 닫기 (휴대폰 키보드의 ‘완료’)
  $('#lock-chips').addEventListener('focusout', () => {
    if (!lockEditing) return;
    setTimeout(() => {
      if (!lockEditing || $('#lock-chips').contains(document.activeElement)) return;
      commitLockEdit();
    }, 200);
  });
  renderLockChips();

  $('#lock-start').addEventListener('click', async () => {
    commitLockEdit(); // 분을 적다가 바로 ‘잠금 시작’을 눌러도 적은 시간으로
    const mins = chosen;
    const sel = $('#timer-subject');
    const subName = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    // 잠금 시간과 스톱워치·집중 타이머가 같은 시간을 두 번 기록하지 않게, 돌던 것은 멈추고 지금까지를 기록
    const swOn = !!(window.Stopwatch && window.Stopwatch.running());
    const tm = App.timerBusy ? App.timerBusy() : null;
    const note = (swOn ? '\n재고 있던 스톱워치는 멈추고 지금까지를 기록해요.' : '') + (tm === 'focus' ? '\n진행 중인 집중 타이머는 멈추고 지금까지를 기록해요.' : '');
    if (!(await ask(`${Stats.formatMinutes(mins)} 동안 잠글까요?${subName ? `\n과목: ${subName}` : ''}${note}\n\n중간에 그만두려면 3초 길게 눌러야 해요.`))) return;
    if (swOn) await window.Stopwatch.stop();
    if (App.timerBusy && App.timerBusy()) App.stopTimer();
    const t = Date.now();
    lock = { startAt: t, endAt: t + mins * 60000, minutes: mins, subjectId: (sel && sel.value) || null, subjectName: subName, leaves: 0, awayMs: 0, hiddenAt: null };
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

  function hide() {
    clearInterval(tick);
    $('#lock-screen').hidden = true;
    document.body.style.overflow = '';
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* 무시 */ }
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* 무시 */ }
  }

  function finish(completed) {
    const at = Date.now();
    const minutes = studiedMinutes(lock, at);
    const done = lock;
    lock = null;
    write();
    hide();
    // 시작 시각으로 정한 id: 탭 두 개에서 같은 잠금이 끝나도 한 번만 기록
    const id = 'lock-' + done.startAt;
    if (minutes > 0 && !store.get().sessions.some((x) => x.id === id)) {
      store.update((st) => st.sessions.push({ id, subjectId: done.subjectId, minutes, endedAt: Math.min(at, done.endAt), label: completed ? '잠금 모드 완료' : '잠금 모드 (중단)', lock: true, leaves: done.leaves }));
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
    if (Date.now() >= lock.endAt) {
      // 동기화 등 다른 스크립트가 다 준비된 뒤 기록
      const done = () => { if (lock) finish(true); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', done, { once: true });
      else setTimeout(done, 0);
    } else show(false);
  }

  // 다른 탭(창)에서 잠금을 시작하거나 끝내면 이 탭도 맞춘다
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    let next = null;
    try { next = e.newValue ? JSON.parse(e.newValue) : null; } catch (err) { next = null; }
    if (next && next.endAt) {
      const was = lock;
      lock = next;
      if (!was) show(false); else update();
    } else if (lock) {
      lock = null;
      hide();
    }
  });

  root.Lock = { get state() { return lock; } };
})(typeof window !== 'undefined' ? window : globalThis);
