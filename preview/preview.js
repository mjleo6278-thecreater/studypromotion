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
    const decks = [{ id: 'd1', name: '영단어 Day 1', createdAt: now - 9 * DAY }];
    const today0 = window.SRS ? window.SRS.startOfDay(now) : now;
    const cards = [['abandon', '버리다, 포기하다'], ['benevolent', '자비로운'], ['candid', '솔직한'], ['diligent', '성실한'], ['eloquent', '유창한'], ['frugal', '검소한']]
      .map(([front, back], i) => ({ id: id('c'), deckId: 'd1', front, back, createdAt: now - 9 * DAY, ease: 2.5, interval: i < 3 ? 0 : 3, reps: i < 3 ? 0 : 2, lapses: 0, due: i < 4 ? today0 : today0 + 3 * DAY }));
    return {
      version: 2, subjects, tasks, sessions, decks, cards, reviewLog: [{ cardId: cards[0].id, grade: 'good', at: now - DAY }],
      exams, topics, strokes: [], boardView: {}, activeExamId: 'ex1',
      settings: { dailyGoalMin: 180, focusMin: 25, breakMin: 5, monthlyGoalMin: 60 * 60, keepAwake: true, dayStartHour: 0, autoBreak: false },
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
  const ITEMS = [
    {
      title: '지우기 전에 묻는 창이 더 분명해졌어요',
      before: "무엇을 지우든 버튼이 똑같이 '확인'이에요.",
      after: "지우는 버튼은 빨간색에 '삭제'라고 적혀 있고, Enter를 잘못 눌러도 지워지지 않아요. 로그인할 때 기록을 고르는 창도 '계정 기록 불러오기' / '이 기기 기록 올리기'로 적혀 있어요.",
      tryLabel: '과목 삭제 창 띄워 보기',
      hint: "'취소'를 누르면 아무것도 지워지지 않아요.",
      run() {
        App.go('plan');
        later(() => { const b = document.querySelector('#subject-list [data-del-subject]'); if (b) b.click(); else toast('과목이 없어요. 예시 기록을 넣고 다시 눌러 주세요.'); });
      },
    },
    {
      title: '타이머를 초기화하기 전에 기록할지 물어봐요',
      before: "집중하다가 '초기화'를 누르면 그때까지 한 시간이 말없이 사라져요.",
      after: "1분 넘게 집중했으면 '기록하고 초기화 / 기록 없이 초기화 / 계속하기' 중에 고를 수 있어요.",
      tryLabel: '7분 집중한 상태 만들기',
      hint: "타이머 화면에서 '초기화'를 눌러 보세요.",
      run() {
        const t = timerOf();
        if (window.Stopwatch) window.Stopwatch.showTab('focus');
        App.go('timer');
        if (!t) return;
        if (window.Stopwatch && window.Stopwatch.running()) return toast('스톱워치가 돌고 있어요. 멈춘 뒤 다시 눌러 주세요.');
        later(() => {
          if (t.mode !== 'focus') { const f = document.querySelector('.mode-switch [data-mode="focus"]'); if (f) f.click(); }
          if (!t.running) $('#timer-start').click();
          const min = Math.min(7, Math.floor(t.total / 60) - 1);
          if (t.running && min >= 1 && t.total - Math.ceil((t.endAt - Date.now()) / 1000) < 60) t.endAt -= min * 60000;
          later(() => { hit($('#timer-reset')); toast("집중하던 중이에요. 이제 '초기화'를 눌러 보세요."); }, 400);
        });
      },
    },
    {
      title: "휴대폰 '뒤로' 버튼이 앱처럼 움직여요",
      before: "'뒤로'를 누르면 어느 화면에 있든 앱이 바로 닫혀요.",
      after: '열려 있는 창이 먼저 닫히고, 그다음엔 홈으로 가고, 홈에서 한 번 더 누르면 앱이 닫혀요.',
      tryLabel: "창을 열고 '뒤로' 눌러 보기",
      hint: "왼쪽 아래에 생기는 '뒤로' 단추가 휴대폰의 뒤로 버튼을 대신해요.",
      run() {
        App.go('stats');
        later(() => { App.openLog(); showBack(); });
      },
    },
    {
      title: '하루 시작 시각을 새벽으로 옮길 수 있어요',
      before: '자정이 지나면 새 하루라서, 새벽 1시에 한 공부는 다음 날 공부로 들어가요.',
      after: "설정에서 '새벽 4시'처럼 정하면 그 전의 새벽 공부는 전날 공부로 쳐요. 오늘 공부, 연속 학습일, 달력, D-day가 모두 같은 기준이에요.",
      tryLabel: '설정에서 바꿔 보기',
      hint: "예시 기록에는 자정을 넘긴 공부가 섞여 있어요. '새벽 4시'로 저장하고 통계의 달력을 보세요.",
      run() { App.go('account'); later(() => hit($('#set-daystart').closest('.field'))); },
    },
    {
      title: '집중이 끝나면 휴식을 바로 시작할 수 있어요',
      before: "집중이 끝나면 휴식 타이머는 멈춰 있고, '시작'을 한 번 더 눌러야 해요.",
      after: "설정을 켜 두면 집중이 끝나자마자 휴식이 돌아요. 휴식 뒤의 집중은 직접 시작해요.",
      tryLabel: '10초 뒤 끝나는 집중으로 보기',
      hint: '설정을 켜고 집중 타이머를 10초만 남겨 둬요. 예시로 집중 기록이 한 줄 생겨요.',
      run() {
        const t = timerOf();
        if (!t) return;
        if (App.timerBusy() || (window.Stopwatch && window.Stopwatch.running())) return toast('돌고 있는 타이머가 있어요. 초기화한 뒤 다시 눌러 주세요.');
        App.store.update((st) => { st.settings.autoBreak = true; });
        if (window.Stopwatch) window.Stopwatch.showTab('focus');
        App.go('timer');
        later(() => {
          if (t.mode !== 'focus') { const f = document.querySelector('.mode-switch [data-mode="focus"]'); if (f) f.click(); }
          $('#timer-start').click();
          if (t.running) t.endAt = Date.now() + 10000;
          toast('10초 뒤 집중이 끝나고 휴식이 바로 시작돼요.');
        });
      },
    },
    {
      title: '최근 7일을 그 전 7일과 비교해 줘요',
      before: "통계의 '최근 7일 공부 시간'에는 합계와 하루 평균만 있어요.",
      after: '그 전 7일보다 얼마나 더 했는지, 덜 했는지 한 줄로 보여 줘요.',
      tryLabel: '통계에서 보기',
      hint: '',
      run() { App.go('stats'); later(() => hit($('#week-compare').hidden ? $('#week-chart') : $('#week-compare'))); },
    },
  ];

  function openPanel() {
    const body =
      '<p class="pv-note"><b>미리 보기</b>예요. 여기서 쓰는 기록은 이 미리 보기 안에만 저장돼요. 실제 앱의 기록이나 계정과는 이어져 있지 않으니 마음껏 눌러 보세요.</p>' +
      '<ol class="pv-list">' + ITEMS.map((it, i) =>
        `<li class="pv-item"><h3><span class="pv-no">${i + 1}</span><span>${esc(it.title)}</span></h3>` +
        `<dl class="pv-diff"><dt>지금 앱</dt><dd>${esc(it.before)}</dd><dt>미리 보기</dt><dd class="pv-after">${esc(it.after)}</dd></dl>` +
        `<div class="pv-try"><button type="button" class="btn primary" data-pv-try="${i}">${esc(it.tryLabel)}</button>${it.hint ? `<span>${esc(it.hint)}</span>` : ''}</div></li>`).join('') + '</ol>' +
      '<div class="pv-foot"><div class="pv-row"><button type="button" class="btn" data-pv-sample>예시 기록 다시 넣기</button><button type="button" class="btn" data-pv-empty>기록 비우고 처음부터 써 보기</button></div>' +
      '<p>미리 보기에서는 로그인(계정 동기화), 앱 설치, 파일 내보내기·저장이 동작하지 않아요. 나머지는 실제 앱과 같아요.</p></div>';
    UI.openSheet({
      title: `미리 보기에서 달라진 점 ${ITEMS.length}가지`, body, cls: 'pv-sheet', focusSel: '[data-ui-close]',
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
  pill.className = 'pv-pill' + (lsGet(SEEDED) ? '' : ' pv-new');
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
    setTimeout(() => { if (pill.classList.contains('pv-new')) toast("미리 보기예요. 위의 '미리 보기'를 누르면 달라진 점을 볼 수 있어요.", { action: '달라진 점', onAction: openPanel }); }, 2600);
  }
  window.Preview = { open: openPanel, loadSample, showBack, items: ITEMS };
})();
