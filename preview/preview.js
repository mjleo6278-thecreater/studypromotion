/* 미리 보기 전용: '미리 보기' 단추, 달라진 점 목록, 예시 기록, '뒤로' 눌러 보기.
 * 실제 앱에는 들어가지 않는다 (tools/build-preview.js가 미리 보기 파일에만 넣는다).
 * 미리 보기 파일은 저장 이름이 따로라서(studypromotion-preview.*) 실제 앱의 기록을 읽거나 바꾸지 않고, 로그인도 막혀 있다. */
(function () {
  'use strict';
  const App = window.App, Stats = window.Stats, UI = window.UI;
  if (!App || !Stats || !UI) return;
  const $ = App.$, esc = App.esc, toast = App.toast;
  const SEEDED = 'studypromotion.pvSeeded';
  const DAY = 86400000;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } };
  const timerOf = () => (window.__studypromotion || {}).timer;

  /* ---------- 예시 기록 ---------- */
  function sample(now) {
    let n = 0;
    const id = (p) => p + (++n).toString(36);
    const key = (ts) => Stats.dateKey(ts);
    const at = (daysAgo, h, m) => { const d = new Date(now - daysAgo * DAY); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
    const subjects = [
      { id: 's-kor', name: '국어', color: '#e05a4f' },
      { id: 's-math', name: '수학', color: '#3d96e0' },
      { id: 's-eng', name: '영어', color: '#45a865' },
      { id: 's-hist', name: '한국사', color: '#e3ae24' },
    ];
    const exams = [{ id: 'ex1', name: '예시: 2학기 기말고사', date: key(now + 16 * DAY), createdAt: now - 8 * DAY, planStart: key(now - 6 * DAY) }];
    const topics = [];
    const add = (parentId, title, o) => {
      const t = Object.assign({ id: id('t'), examId: 'ex1', parentId, kind: 'topic', title, done: false, flags: {}, order: topics.filter((x) => x.parentId === parentId).length, collapsed: false }, o || {});
      topics.push(t);
      return t.id;
    };
    const kor = add(null, '국어', { x: 80, y: 80, color: '#e05a4f' });
    const lit = add(kor, '문학');
    add(lit, '현대시: 진달래꽃', { done: true, pct: 100, est: 60, doneAt: now - 2 * DAY });
    add(lit, '고전시가: 관동별곡', { est: 90, pct: 50, flags: { hard: true } });
    add(lit, '현대소설: 운수 좋은 날', { est: 45, flags: { star: true } });
    const gram = add(kor, '문법');
    add(gram, '음운의 변동', { est: 40 });
    add(gram, '문장의 짜임', { est: 40 });
    const math = add(null, '수학', { x: 420, y: 80, color: '#3d96e0' });
    const m1 = add(math, '1단원 다항식');
    add(m1, '다항식의 연산', { done: true, pct: 100, est: 60, doneAt: now - 4 * DAY });
    add(m1, '나머지 정리', { done: true, pct: 100, est: 60, doneAt: now - 3 * DAY });
    add(m1, '인수분해', { est: 90, pct: 25 });
    const m2 = add(math, '2단원 방정식과 부등식');
    add(m2, '복소수', { est: 60 });
    add(m2, '이차방정식', { est: 60, flags: { review: true } });
    const eng = add(null, '영어', { x: 760, y: 80, color: '#45a865' });
    add(eng, '교과서 1~3과 본문', { done: true, pct: 100, est: 120, doneAt: now - 5 * DAY });
    add(eng, '어휘 Day 1~15', { est: 60, pct: 50 });
    const hist = add(null, '한국사', { x: 80, y: 520, color: '#e3ae24' });
    add(hist, '선사 시대와 고조선', { est: 30 });
    add(hist, '삼국의 성립과 발전', { est: 45 });

    // 공부 기록: 지난 15일. 밤늦게 자정을 넘겨 공부한 날이 섞여 있다 (하루 시작 시각을 바꿔 보면 차이가 보인다)
    const sessions = [];
    const push = (daysAgo, h, m, minutes, subjectId, extra) => {
      const endedAt = at(daysAgo, h, m);
      if (endedAt > now - 60000) return;
      sessions.push(Object.assign({ id: id('se'), subjectId, minutes, endedAt, label: null, topicId: null }, extra || {}));
    };
    const plan = [
      [14, [[17, 30, 50, 's-math'], [21, 0, 40, 's-kor']]],
      [13, [[18, 10, 25, 's-eng']]],
      [12, [[16, 40, 50, 's-math'], [20, 30, 50, 's-hist'], [22, 20, 25, 's-kor']]],
      [10, [[19, 0, 90, 's-math']]],
      [9, [[17, 0, 25, 's-eng'], [0, 40, 50, 's-kor']]],
      [8, [[18, 30, 50, 's-kor'], [21, 40, 50, 's-math']]],
      [7, [[20, 0, 40, 's-hist']]],
      [6, [[17, 20, 50, 's-math'], [19, 10, 50, 's-kor'], [22, 0, 25, 's-eng']]],
      [5, [[18, 0, 90, 's-eng'], [0, 50, 40, 's-math']]],
      [4, [[16, 30, 25, 's-kor'], [20, 10, 50, 's-math'], [21, 30, 50, 's-hist']]],
      [3, [[19, 30, 50, 's-kor'], [1, 10, 60, 's-math']]],
      [2, [[17, 40, 50, 's-eng'], [20, 20, 90, 's-math']]],
      [1, [[18, 20, 50, 's-kor'], [22, 30, 50, 's-math'], [23, 40, 40, 's-eng']]],
      [0, [[0, 50, 45, 's-math'], [8, 40, 25, 's-kor'], [10, 30, 50, 's-math']]],
    ];
    plan.forEach(([d, list]) => list.forEach(([h, m, min, s]) => push(d, h, m, min, s)));
    push(11, 21, 0, 120, 's-math', { label: '학원 수학 수업', manual: true });
    push(2, 12, 30, 62, 's-eng', { kind: 'stopwatch', sec: 62 * 60 });

    const tasks = [
      { id: id('k'), title: '수학 문제집 3단원 풀기', subjectId: 's-math', due: Stats.dayKey(now), estimateMin: 50, done: false, createdAt: now - 3 * DAY },
      { id: id('k'), title: '영어 독해 지문 5개', subjectId: 's-eng', due: Stats.dayKey(now - 2 * DAY), estimateMin: 40, done: false, createdAt: now - 4 * DAY },
      { id: id('k'), title: '국어 수행평가 보고서 초안', subjectId: 's-kor', due: Stats.dayKey(now + 3 * DAY), estimateMin: 120, done: false, createdAt: now - 2 * DAY },
      { id: id('k'), title: '한국사 요약 노트', subjectId: 's-hist', due: null, estimateMin: null, done: false, createdAt: now - DAY },
    ];
    // 일정: 매주 월·수·금 수학 학원, 오늘 저녁 영어, 내일 친구 약속, 모레 국어 (AI 도우미에게 옮겨 달라고 해 볼 수 있게)
    const ev = (o) => Object.assign({ id: id('ev'), kind: 'study', title: '', subjectId: null, taskId: null, repeat: null, skip: [], createdAt: now - 5 * DAY }, o);
    const events = [
      ev({ title: '학원', subjectId: 's-math', date: Stats.dayKey(now - 21 * DAY), start: '16:00', end: '18:00', repeat: { freq: 'weekly', days: [1, 3, 5], until: null } }),
      ev({ subjectId: 's-eng', taskId: tasks[1].id, date: Stats.dayKey(now), start: '20:00', end: '21:00' }),
      ev({ kind: 'other', title: '친구 약속', date: Stats.dayKey(now + DAY), start: '18:30', end: '20:00' }),
      ev({ subjectId: 's-kor', title: '수행평가', date: Stats.dayKey(now + 2 * DAY), start: '21:00', end: '22:00' }),
    ];
    const decks = [{ id: 'd1', name: '영단어 Day 1', createdAt: now - 9 * DAY }];
    const today0 = window.SRS ? window.SRS.startOfDay(now) : now;
    const cards = [['abandon', '버리다, 포기하다'], ['benevolent', '자비로운'], ['candid', '솔직한'], ['diligent', '성실한'], ['eloquent', '유창한'], ['frugal', '검소한']]
      .map(([front, back], i) => ({ id: id('c'), deckId: 'd1', front, back, createdAt: now - 9 * DAY, ease: 2.5, interval: i < 3 ? 0 : 3, reps: i < 3 ? 0 : 2, lapses: 0, due: i < 4 ? today0 : today0 + 3 * DAY }));
    return {
      version: 2, subjects, tasks, events, sessions, decks, cards, reviewLog: [{ cardId: cards[0].id, grade: 'good', at: now - DAY }],
      exams, topics, strokes: [], boardView: {}, activeExamId: 'ex1',
      settings: { dailyGoalMin: 180, focusMin: 25, breakMin: 5, monthlyGoalMin: 60 * 60, keepAwake: true, dayStartHour: 0 },
    };
  }
  const isEmpty = () => { const st = App.store.get(); return !st.tasks.length && !st.sessions.length && !st.cards.length && !st.topics.length && !st.exams.length; };
  function loadSample() {
    App.store.importJSON(JSON.stringify(sample(Date.now())), 'import');
    lsSet(SEEDED, '1');
    lsSet('studypromotion.welcomeClosed', '1');
    App.render();
  }

  /* ---------- 달라진 점 ---------- */
  const hit = (el) => {
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('pv-hit'); void el.offsetWidth; el.classList.add('pv-hit');
    setTimeout(() => el.classList.remove('pv-hit'), 2600);
  };
  const later = (fn, ms) => setTimeout(fn, ms || 260);
  // 미리 보기에만 있는 변경을 여기에 적는다.
  // 항목 모양: { title, before(지금 앱), after(미리 보기), tryLabel(써 보기 단추 글자), hint, run() }
  const ask = (text) => () => { if (!window.AI) return; window.AI.open(); later(() => window.AI.send(text), 320); };
  const ITEMS = [
    {
      title: 'AI 도우미 세컨드: 모르는 표현 물어보기',
      before: 'AI 기능이 없어요.',
      after: '어느 화면에서나 오른쪽 아래 둥근 단추를 누르면 대화 창이 열려요. 스페인어 문장을 물으면 뜻, 구문 풀이, 단어, 문법 순서로 답하고, 외울 표현은 복습 카드로 바로 저장할 수 있어요.',
      tryLabel: '문장 풀이 물어보기', hint: '답 아래의 ＋를 누르면 복습 카드가 돼요.',
      run: ask('Ojalá no llueva mañana 구문 해석해 줘'),
    },
    {
      title: '말로 일정과 할 일 바꾸기',
      before: '일정과 할 일은 화면에서 하나씩 눌러 고쳐요.',
      after: '말로 시키면 무엇을 바꿀지 먼저 보여 줘요. 적용을 눌러야 기록이 바뀌고, 바꾼 뒤에도 되돌릴 수 있어요. 지우는 일은 AI가 하지 못해요.',
      tryLabel: '일정 넣어 달라고 하기', hint: "'못 끝낸 할 일을 내일로 미뤄 줘'도 해 보세요.",
      run: ask('내일 오후 4시부터 6시까지 수학 일정 넣어 줘'),
    },
    {
      title: '공부 시간 물어보기, 타이머 켜기',
      before: '통계 화면과 타이머 화면에 가서 직접 봐요.',
      after: "'이번 주 공부 시간 보여 줘'라고 하면 앱이 기록에서 직접 계산해 보여 줘요(AI가 숫자를 지어내지 않아요). '영어 25분 집중 시작해 줘'라고 하면 타이머를 켤 수 있어요.",
      tryLabel: '이번 주 공부 시간 보기', hint: '',
      run: ask('이번 주 공부 시간 보여 줘'),
    },
  ];

  function openPanel() {
    const body =
      '<p class="pv-note"><b>미리 보기</b>예요. 여기서 쓰는 기록은 이 미리 보기 안에만 저장돼요. 실제 앱의 기록이나 계정과는 이어져 있지 않으니 마음껏 눌러 보세요.</p>' +
      (ITEMS.length ? '' : '<p class="pv-none">지금은 미리 보기에만 있는 변경이 없어요. 전에 여기서 보여 드린 개선안은 실제 앱(버전 2.9)에 들어갔어요. 새 개선안이 생기면 이 목록에 다시 나와요.</p>') +
      '<ol class="pv-list">' + ITEMS.map((it, i) =>
        `<li class="pv-item"><h3><span class="pv-no">${i + 1}</span><span>${esc(it.title)}</span></h3>` +
        `<dl class="pv-diff"><dt>지금 앱</dt><dd>${esc(it.before)}</dd><dt>미리 보기</dt><dd class="pv-after">${esc(it.after)}</dd></dl>` +
        `<div class="pv-try"><button type="button" class="btn primary" data-pv-try="${i}">${esc(it.tryLabel)}</button>${it.hint ? `<span>${esc(it.hint)}</span>` : ''}</div></li>`).join('') + '</ol>' +
      '<div class="pv-foot"><div class="pv-row"><button type="button" class="btn" data-pv-sample>예시 기록 다시 넣기</button><button type="button" class="btn" data-pv-empty>기록 비우고 처음부터 써 보기</button></div>' +
      '<p>미리 보기에서는 로그인(계정 동기화), 앱 설치, 파일 내보내기·저장이 동작하지 않아요. AI 도우미는 진짜 AI가 아니라 정해 둔 예시에만 답하는 가짜예요. 나머지는 실제 앱과 같아요.</p></div>';
    UI.openSheet({
      title: ITEMS.length ? `미리 보기에서 달라진 점 ${ITEMS.length}가지` : '미리 보기', body, cls: 'pv-sheet', focusSel: '[data-ui-close]',
      onClick: async (e, close) => {
        const t = e.target.closest('[data-pv-try]');
        if (t) { close(); later(() => ITEMS[+t.dataset.pvTry].run(), 220); return; }
        if (e.target.closest('[data-pv-sample]')) {
          close();
          if (!isEmpty() && !(await App.ask('지금 미리 보기에 있는 기록을 예시 기록으로 바꿀까요?', { ok: '예시 기록으로 바꾸기' }))) return;
          loadSample();
          toast('예시 기록을 넣었어요');
          return;
        }
        if (e.target.closest('[data-pv-empty]')) {
          close();
          if (!(await App.ask('미리 보기의 기록을 모두 비울까요?\n실제 앱의 기록은 그대로예요.', { ok: '모두 비우기', danger: true }))) return;
          App.store.reset();
          lsSet(SEEDED, '1');
          try { localStorage.removeItem('studypromotion.welcomeClosed'); } catch (err) { /* 무시 */ }
          App.go('home');
          toast('비웠어요. 처음 쓰는 사람의 화면이에요.');
        }
      },
    });
    const pill = $('#pv-open');
    if (pill) pill.classList.remove('pv-new');
  }

  /* ---------- '뒤로' 눌러 보기 ---------- */
  function showBack() {
    if ($('#pv-back')) return;
    const box = document.createElement('div');
    box.className = 'pv-back';
    box.id = 'pv-back';
    box.innerHTML = '<button type="button" class="pv-back-go" id="pv-back-go" aria-label="휴대폰의 뒤로 버튼 누르기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>뒤로</button>' +
      '<button type="button" class="pv-back-x" id="pv-back-x" aria-label="뒤로 단추 숨기기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4"/></svg></button>';
    document.body.appendChild(box);
    $('#pv-back-go').addEventListener('click', () => {
      // 실제 '뒤로' 버튼과 같은 길로: 방문 기록을 한 칸 내려간다. 앱이 닫힐 차례(홈에서 두 번째)에는 닫는 대신 알려 준다
      if (history.state && history.state.sp === 'base') return toast('여기서 한 번 더 누르면 실제 앱은 닫혀요.');
      try { history.back(); } catch (e) { /* 무시 */ }
    });
    $('#pv-back-x').addEventListener('click', () => box.remove());
  }

  /* ---------- 시작 ---------- */
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pv-pill' + (lsGet(SEEDED) || !ITEMS.length ? '' : ' pv-new');
  pill.id = 'pv-open';
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.innerHTML = '<i aria-hidden="true"></i>미리 보기';
  const actions = document.querySelector('.top-actions');
  if (actions) actions.insertBefore(pill, actions.firstChild);
  pill.addEventListener('click', openPanel);

  // 처음 열면 예시 기록을 넣어 둔다 (빈 화면 대신 바로 써 볼 수 있게). 한 번 비우거나 넣은 뒤에는 다시 넣지 않는다
  if (!lsGet(SEEDED) && isEmpty()) {
    try { loadSample(); } catch (e) { /* 저장이 막힌 환경: 빈 화면으로 시작 */ }
    // 그 사이에 이미 달라진 점 목록을 열어 봤으면 다시 알리지 않는다
    setTimeout(() => {
      if (!ITEMS.length) return toast('미리 보기예요. 여기서 쓰는 기록은 실제 앱과 따로 저장돼요.');
      if (pill.classList.contains('pv-new')) toast("미리 보기예요. 위의 '미리 보기'를 누르면 달라진 점을 볼 수 있어요.", { action: '달라진 점', onAction: openPanel });
    }, 2600);
  }
  window.Preview = { open: openPanel, loadSample, showBack, items: ITEMS };
})();
