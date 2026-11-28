/* 폰 잠금 모드: 정한 시간 동안 잠금 화면만 보이게 한다.
 * 웹앱은 폰 자체를 잠글 수 없어서, 할 수 있는 만큼 막는다:
 *  - 전체 화면 + 화면 꺼짐 방지
 *  - 뒤로 가기 막기
 *  - 앱을 닫았다 다시 열어도 끝나는 시각까지 잠금 화면 유지 (localStorage)
 *  - 화면을 끄거나 다른 앱으로 나간 횟수와 시간 기록 (웹앱은 둘을 구별할 수 없다. 보여 주기만 하고 공부 시간에서 빼지 않는다)
 *  - 포기는 3초 길게 눌러야 가능 */
(function (root) {
  const KEY = 'studypromotion.lock';

  // 잠금 기록에서 공부 시간(분) 계산 (순수 함수, 테스트 대상)
  //  lock: { startAt, endAt }  at: 끝낸 시각
  //  화면을 꺼 둔 시간도 센다 (4.6.1): 웹앱은 화면을 끈 것과 다른 앱에 간 것을 구별할 수 없어서,
  //  전에는 화면을 끄고 공부해도 그 시간이 다 빠져 0분이 되고 기록이 남지 않았다. 나간 시간(awayMs)은 잠금 화면에 보여 주기만 한다
  function studiedMinutes(lock, at) {
    const end = Math.min(at, lock.endAt);
    return Math.floor(Math.max(0, end - lock.startAt) / 60000);
  }
  // 스톱워치를 켜 둔 채 잠갔는데 잠금이 끝나기 전에 스톱워치가 먼저 멈췄을 때(다른 창 등):
  // 스톱워치가 기록한 끝(from) 뒤부터 잠금이 끝날 때까지만 센다. 나가 있던 시간은 그 구간 길이만큼 나눠서 뺀다
  function tailMinutes(lock, at, from) {
    const end = Math.min(at, lock.endAt);
    const start = Math.max(lock.startAt, from || 0);
    if (!(end > start)) return 0;
    const away = (lock.awayMs || 0) * (end - start) / Math.max(1, end - lock.startAt);
    return Math.floor(Math.max(0, end - start - away) / 60000);
  }
  const lib = { studiedMinutes, tailMinutes };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  const App = root.App;
  if (!App) return;
  const { store, toast, ask, $, $$ } = App;

  const MSGS = ['지금은 공부 시간이에요.', '한 칸씩 전진 중이에요.', '폰은 내려놓고, 책을 펴요.', '끝나면 스스로를 칭찬해 줘요.', '집중한 만큼 승급해요.'];
  let lock = null; // { startAt, endAt, minutes, subjectId, leaves, awayMs, hiddenAt, sw }
  // sw: 스톱워치를 켜 둔 채 잠갔다. 공부 시간은 스톱워치가 재고(잠금은 따로 기록하지 않음), 화면을 꺼 둔 시간도 빼지 않는다
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

  // 잠글 과목 고르기: 확인 창 안에 과목 칩을 넣는다 (스톱워치가 재는 중이면 그 과목, 아니면 위 ‘과목’ 칸이 먼저 골라져 있다)
  //  swSid: 재는 중인 스톱워치 과목('' = 과목 없이, null = 스톱워치 안 켬)  tm: 집중 타이머가 진행 중이면 'focus'
  function lockAskBody(pick, swSid, tm) {
    const subs = store.get().subjects || [];
    const box = document.createElement('div');
    box.className = 'lock-ask';
    const name = (id) => { const s = id && App.subjectById(id); return s ? s.name : '과목 없음'; };
    const chip = (id, label, color) => `<button type="button" class="chip lock-subj-chip" role="radio" data-lsub="${App.esc(id)}">`
      + `<i class="sel-dot${color ? '' : ' none'}"${color ? ` style="background:${App.esc(color)}"` : ''}></i><span>${App.esc(label)}</span></button>`;
    box.innerHTML = (subs.length
      ? `<p class="lock-ask-label" id="lock-subj-label">과목</p><div class="lock-subj" role="radiogroup" aria-labelledby="lock-subj-label">`
        + subs.map((x) => chip(x.id, x.name, x.color)).join('') + chip('', '과목 없음', '') + '</div>'
      : '')
      + '<p class="lock-ask-note" id="lock-ask-note"></p>';
    const note = box.querySelector('#lock-ask-note');
    const paint = () => {
      box.querySelectorAll('[data-lsub]').forEach((b) => {
        const on = b.dataset.lsub === pick;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      const lines = [];
      if (swSid != null) {
        lines.push('재고 있던 스톱워치는 멈추지 않고 이어서 재요. 화면을 꺼 둔 시간도 그대로 세요.');
        if (pick !== swSid) {
          const SW = window.Stopwatch, live = SW && SW.live ? SW.live() : null;
          const m = live ? Math.floor((live.to - live.from) / 60000) : 0;
          const ro = (id) => name(id) + (id ? Stats.josa(name(id), '으로/로') : '으로');
          lines.push(`지금까지 잰 ${m >= 1 ? Stats.formatMinutes(m) : '시간'}은 ${ro(swSid)} 기록하고, ${ro(pick)} 이어서 재요.`);
        }
      }
      else lines.push('화면을 꺼 둔 시간도 공부 시간으로 세요.');
      if (tm === 'focus') lines.push('진행 중인 집중 타이머는 멈추고 지금까지를 기록해요.');
      lines.push('중간에 그만두려면 3초 길게 눌러야 해요.');
      note.textContent = lines.join('\n');
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lsub]');
      if (!b) return;
      pick = b.dataset.lsub;
      paint();
    });
    // 화살표로 옆 과목 (라디오 묶음처럼)
    box.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const list = [...box.querySelectorAll('[data-lsub]')];
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const n = list[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? list.length - 1 : 1)) % list.length];
      pick = n.dataset.lsub;
      paint();
      n.focus();
    });
    paint();
    return { box, picked: () => pick };
  }

  let asking = false;
  $('#lock-start').addEventListener('click', async () => {
    if (lock || asking) return;
    commitLockEdit(); // 분을 적다가 바로 ‘잠금 시작’을 눌러도 적은 시간으로
    const mins = chosen;
    const sel = $('#timer-subject');
    const SW = window.Stopwatch;
    const live = SW && SW.live ? SW.live() : null;
    const valid = (id) => (id && App.subjectById(id) ? id : '');
    // 스톱워치가 재는 중이면 멈추지 않고 그대로 둔다 (잠금 시간은 스톱워치가 재므로 같은 시간이 두 번 쌓이지 않게 잠금은 따로 기록하지 않는다)
    // 집중 타이머는 끝나는 소리가 잠금 중에 울리지 않게 지금까지를 기록하고 멈춘다
    const swSid = live ? valid(live.subjectId) : null;
    const tm = App.timerBusy ? App.timerBusy() : null;
    const body = lockAskBody(live ? swSid : valid(sel && sel.value), swSid, tm);
    asking = true;
    let yes;
    try { yes = await ask(`${Stats.formatMinutes(mins)} 동안 잠글까요?`, { ok: '잠그기', extra: body.box }); } finally { asking = false; }
    if (!yes || lock) return;
    const sid = valid(body.picked());
    let swOn = !!(SW && SW.running());
    // 다른 과목을 골랐으면 스톱워치도 지금까지를 기록하고 그 과목으로 이어서 잰다
    if (swOn && SW.switchSubject) { await SW.switchSubject(sid); swOn = SW.running(); }
    if (App.timerBusy && App.timerBusy()) App.stopTimer();
    // 위 ‘과목’ 칸도 고른 과목으로 (다음에 잠그거나 집중 타이머를 켤 때 그대로)
    if (sel && sel.value !== sid) { sel.value = sid; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    if (lock) return;
    const t = Date.now();
    const subj = sid ? App.subjectById(sid) : null;
    lock = { startAt: t, endAt: t + mins * 60000, minutes: mins, subjectId: sid || null, subjectName: subj ? subj.name : '', leaves: 0, awayMs: 0, hiddenAt: null };
    if (swOn) lock.sw = true;
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
    $('#lock-sw').hidden = true;
    $('#lock-msg').textContent = MSGS[Math.floor(Math.random() * MSGS.length)];
    clearInterval(tick);
    tick = setInterval(update, 500);
    update();
    if (lock.sw && !window.Stopwatch) later(update); // 앱을 다시 열 때는 스톱워치가 이 파일보다 늦게 준비된다: 준비되면 스톱워치 줄도 바로
  }

  function update() {
    if (!lock) return;
    const left = Math.max(0, Math.ceil((lock.endAt - Date.now()) / 1000));
    $('#lock-time').textContent = clock(left);
    $('#lock-leaves').textContent = lock.leaves ? `화면을 끄거나 나간 횟수 ${lock.leaves}번 · ${Stats.formatMinutes(Math.round(lock.awayMs / 60000))}` : '';
    // 같이 재는 스톱워치: 이번에 잰 시간
    const live = lock.sw && window.Stopwatch && window.Stopwatch.live ? window.Stopwatch.live() : null;
    const swEl = $('#lock-sw');
    swEl.hidden = !live;
    if (live) swEl.textContent = `스톱워치 ${clock(Math.max(0, Math.floor((live.to - live.from) / 1000)))} · 계속 재는 중`;
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
    const done = lock;
    lock = null;
    write();
    hide();
    const SW = window.Stopwatch;
    // 화면을 끄거나 다른 앱에 가 있는 동안 잠금 시간이 끝났으면 그 시간도 나가 있던 시간으로 (보여 주기용, 공부 시간에서는 빼지 않음)
    if (done.hiddenAt) {
      done.awayMs = (done.awayMs || 0) + Math.max(0, Math.min(at, done.endAt) - done.hiddenAt);
      done.hiddenAt = null;
    }
    const swKeeps = !!(done.sw && SW && SW.running());
    let minutes = 0;
    if (!done.sw) minutes = studiedMinutes(done, at);
    else if (!swKeeps) {
      // 스톱워치가 먼저 멈췄으면 스톱워치가 기록한 뒤의 잠금 시간만 (겹치는 시간은 다시 넣지 않는다)
      // 스톱워치처럼 화면을 꺼 둔 시간은 빼지 않는다
      const from = store.get().sessions.reduce((m, x) => (x.kind === 'stopwatch' && x.endedAt >= done.startAt && x.endedAt <= at ? Math.max(m, x.endedAt) : m), done.startAt);
      minutes = tailMinutes(Object.assign({}, done, { awayMs: 0 }), at, from);
    }
    // 시작 시각으로 정한 id: 탭 두 개에서 같은 잠금이 끝나도 한 번만 기록
    const id = 'lock-' + done.startAt;
    if (minutes > 0 && !store.get().sessions.some((x) => x.id === id)) {
      store.update((st) => st.sessions.push({ id, subjectId: done.subjectId, minutes, endedAt: Math.min(at, done.endAt), label: completed ? '잠금 모드 완료' : '잠금 모드 (중단)', lock: true, leaves: done.leaves }));
    }
    try { if (completed && navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* 무시 */ }
    if (swKeeps) {
      // 스톱워치는 그대로 돈다: 타이머 화면에서 바로 보이게 스톱워치 쪽을 연다
      if (SW.showTab) SW.showTab('sw');
      toast(completed ? '잠금 완료! 스톱워치는 계속 재고 있어요' : '잠금을 그만뒀어요. 스톱워치는 계속 재고 있어요');
      return;
    }
    // 1분이 안 되면 기록하지 않는다 ('0분 공부를 기록했어요'라고 하면 기록이 있는 줄 안다)
    if (minutes < 1) toast(completed ? '잠금이 끝났어요. 1분이 안 돼서 기록하지 않았어요' : '잠금을 그만뒀어요. 1분이 안 돼서 기록하지 않았어요');
    else toast(completed ? `잠금 완료! ${Stats.formatMinutes(minutes)} 공부를 기록했어요` : `잠금을 그만뒀어요. ${Stats.formatMinutes(minutes)}만 기록했어요`);
  }

  // 나가 있던 시간을 잠금에 더한다 (화면 끔과 다른 앱은 구별할 수 없다). 잠금 화면에 보여 주기만 하고 공부 시간에서는 빼지 않는다
  function addAway(ms) {
    lock.awayMs += ms;
    lock.hiddenAt = null;
    write();
  }
  function later(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else setTimeout(fn, 0);
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
        addAway(Math.max(0, Math.min(Date.now(), lock.endAt) - lock.hiddenAt));
        $('#lock-msg').textContent = lock.sw ? '돌아왔네요. 스톱워치는 계속 재고 있어요.' : '돌아왔네요. 화면을 꺼 둔 시간도 공부 시간으로 세요.';
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
    if (await ask(`아직 ${Stats.formatMinutes(left)} 남았어요. 정말 그만둘까요?`, { ok: '그만두기', cancel: '계속하기', danger: true })) { if (lock) finish(false); }
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
    if (lock.hiddenAt) addAway(Math.max(0, Math.min(Date.now(), lock.endAt) - lock.hiddenAt)); // 앱이 닫혀 있던 시간도 나가 있던 시간으로 적는다 (공부 시간에서는 빼지 않음)
    if (Date.now() >= lock.endAt) later(() => { if (lock) finish(true); }); // 동기화·스톱워치 등 다른 스크립트가 다 준비된 뒤 기록
    else show(false);
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
