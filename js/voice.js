/* 말로 복습 (v4.5): 손을 안 쓰고 플래시카드 복습
 * 덱 화면 '말로 복습' → 시작 창 → [카드 읽어 주기 → 답 듣기 → 채점(js/voicecore.js) → 띵/뚱 → 틀리면 정답 읽기] → 다음 카드.
 * 채점 결과는 손으로 하는 복습과 같은 SRS.review로 들어간다 (기록에 via: 'voice'). 틀린 카드는 몇 장 뒤에 다시.
 * '듣기만' 모드: 단어 읽기 → 몇 초 뒤 뜻 읽기 → 다음. 채점·복습 일정은 그대로 둔다 (음성 인식이 안 되는 폰·시끄러운 곳).
 * 덱마다 고른 설정은 덱의 voice 칸에 남는다 (계정 동기화). 녹음은 어디에도 남기지 않는다.
 * 쓰는 브라우저 기능: SpeechRecognition(webkit 접두어), speechSynthesis, Wake Lock, Web Audio.
 * 시험(tests/voice.e2e.js)은 SpeechRecognition·speechSynthesis를 가짜로 바꿔 끼우고 끝까지 눌러 본다.
 * (4.5.1) 틀렸다고 나오자마자 '맞았어'를 듣고(정답 읽기는 그 뒤), 다음 카드에서 '맞았어'라고 해도 앞 카드를 고친다.
 * 카드 글과 다른 말이면 로그인한 사람은 서버 AI(/judge)에게 같은 뜻인지 묻고, 같은 뜻이면 그 말을 카드(voiceOk)에 남겨 다음엔 바로 맞힌다.
 */
(function (root) {
  const V = root.VoiceCore, A = root.App;
  if (!V || !A || !A.review) return;
  const { $, esc, store, toast, ic } = A;
  const doc = root.document;
  const Rec = () => root.SpeechRecognition || root.webkitSpeechRecognition || null;
  const synth = () => root.speechSynthesis || null;
  const canHear = () => !!Rec();
  const canSpeak = () => !!(synth() && root.SpeechSynthesisUtterance);
  const MIC_KEY = 'studypromotion.voiceMic'; // 마이크를 한 번이라도 켰는지 (처음에만 시작 단추를 누를 때 마이크부터 켠다)
  const WAITS = [6, 10, 15];
  const MODES = { meaning: '뜻 말하기', word: '단어 말하기', listen: '듣기만' };
  const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'bad-grammar'];
  // 같은 뜻인지 묻는 서버 (세컨드와 같은 서버, js/ai.js AI_ENDPOINT). 이 주소의 앱에서만 부른다
  const JUDGE_URL = 'https://studypromotion-ai.mj-leo6278.workers.dev/judge';
  const JUDGE_HOME = 'https://mjleo6278-thecreater.github.io';
  const KEEP_OK = 8; // 카드마다 남겨 두는 '같은 뜻' 말 수
  const CHECK = '<svg class="ui-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------- 덱 설정 ---------- */
  const deckOf = (id) => store.get().decks.find((d) => d.id === id) || null;
  const cardsOf = (id) => store.get().cards.filter((c) => c.deckId === id);
  const dueOf = (id) => { const t = A.now(); return cardsOf(id).filter((c) => SRS.isDue(c, t)); };
  function cfgOf(deck) {
    const g = V.guessPair(cardsOf(deck.id), deck.name);
    const v = Object.assign({ mode: 'meaning', read: true, wait: 10, ai: true }, deck.voice || {});
    if (!MODES[v.mode]) v.mode = 'meaning';
    if (!V.LANGS.some((l) => l.id === v.front)) v.front = g.front;
    if (!V.LANGS.some((l) => l.id === v.back)) v.back = g.back;
    if (!WAITS.includes(v.wait)) v.wait = 10;
    v.read = v.read !== false;
    v.ai = v.ai !== false;
    if (!canHear() && v.mode !== 'listen') v.mode = 'listen';
    return v;
  }
  function saveCfg(deckId, cfg) {
    const keep = { mode: cfg.mode, front: cfg.front, back: cfg.back, read: cfg.read, wait: cfg.wait, ai: cfg.ai };
    store.update((st) => { const d = st.decks.find((x) => x.id === deckId); if (d) d.voice = keep; });
  }

  /* ---------- 시작 창 ---------- */
  function openStart(deckId) {
    const deck = deckOf(deckId);
    if (!deck) return;
    const cfg = cfgOf(deck);
    const nDue = dueOf(deckId).length, nAll = cardsOf(deckId).length;
    const langOpts = (sel) => V.LANGS.map((l) => `<option value="${l.id}"${l.id === sel ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    const ex = exampleOf(deckId);
    const modeOpt = (id, hint, off) => `<button type="button" class="ui-opt vs-dir" data-vs-mode="${id}" role="radio"${off ? ' disabled' : ''}><span>${MODES[id]}<small>${hint}</small></span>${CHECK}</button>`;
    const body =
      `<p class="vs-lead">카드를 소리 내어 읽어 주고, 말한 답을 채점해서 다음 카드로 넘어가요. 시작한 뒤에는 화면을 누르지 않아도 돼요.</p>` +
      (canHear() ? '' : `<p class="vs-warn">이 브라우저는 음성 인식이 안 돼서 ‘듣기만’ 모드만 쓸 수 있어요. 안드로이드는 크롬에서 열어 주세요.</p>`) +
      '<p class="ui-group">무엇을 할까요</p><div class="ui-opts" role="radiogroup" aria-label="말로 복습 방법">' +
      modeOpt('meaning', `${esc(ex.front)}${josaHear(ex.front)} 듣고 → “${esc(ex.back)}”`, !canHear()) +
      modeOpt('word', `${esc(ex.back)}${josaHear(ex.back)} 듣고 → “${esc(ex.front)}” (발음 연습도 돼요)`, !canHear()) +
      modeOpt('listen', '단어를 읽고 몇 초 뒤 뜻을 읽어 줘요. 채점은 안 해요', !canSpeak()) + '</div>' +
      '<p class="ui-group">카드 언어</p><div class="vs-langs">' +
      `<label>앞면<select id="vs-front" aria-label="앞면 언어">${langOpts(cfg.front)}</select></label>` +
      `<label>뒷면<select id="vs-back" aria-label="뒷면 언어">${langOpts(cfg.back)}</select></label></div>` +
      `<label class="check-field vs-row"><span>문제를 소리 내어 읽어 주기<small>끄면 화면만 보고 말해요</small></span><input type="checkbox" id="vs-read"${cfg.read ? ' checked' : ''}${canSpeak() ? '' : ' disabled'}></label>` +
      `<label class="check-field vs-row vs-ai-row"><span>비슷한 뜻도 맞게 보기<small>${aiLogin() ? '카드 글과 다르게 말하면 AI에게 같은 뜻인지 물어봐요' : '로그인하면 카드 글과 다르게 말해도 AI가 같은 뜻인지 봐 줘요'}</small></span><input type="checkbox" id="vs-ai"${cfg.ai ? ' checked' : ''}></label>` +
      '<p class="ui-group vs-wait-head">답을 기다리는 시간</p><div class="vs-chips">' +
      WAITS.map((w) => `<button type="button" class="chip" data-vs-wait="${w}">${w}초</button>`).join('') + '</div>' +
      `<p class="vs-note">${canHear() ? '처음 한 번만 마이크를 허락해 주세요. 말소리는 폰의 음성 인식(안드로이드는 구글)이 글자로 바꿔 주고, 앱은 녹음을 남기지 않아요. 인터넷이 있어야 해요.' : '소리를 켜 두세요. 화면은 꺼지지 않아요.'}</p>` +
      `<div class="vs-foot"><button type="button" class="btn primary" data-vs-start>${ic('mic')}<span></span></button></div>`;

    let box = null;
    const paint = () => {
      box.querySelectorAll('[data-vs-mode]').forEach((b) => { const on = b.dataset.vsMode === cfg.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      box.querySelectorAll('[data-vs-wait]').forEach((b) => b.classList.toggle('active', +b.dataset.vsWait === cfg.wait));
      const listen = cfg.mode === 'listen';
      box.querySelector('.vs-ai-row').hidden = cfg.mode !== 'meaning';
      box.querySelector('.vs-wait-head').textContent = listen ? '뜻을 읽기 전에 생각할 시간' : '답을 기다리는 시간';
      const n = listen ? (nDue || nAll) : nDue;
      const go = box.querySelector('[data-vs-start]');
      go.disabled = !n;
      go.querySelector('span').textContent = !n ? '오늘 복습할 카드가 없어요' : listen ? `${nDue ? '오늘 카드' : '카드'} ${n}장 듣기` : `오늘 카드 ${n}장 말로 복습`;
      go.querySelector('.ic').innerHTML = `<use href="#i-${listen ? 'sound' : 'mic'}"/>`;
    };
    const p = root.UI.openSheet({
      title: '말로 복습', body, cls: 'ui-voice', focusSel: '.vs-dir.on', // 시작 단추에 맞추면 창이 아래로 굴러 설명이 가려진다
      onClick: (e, close) => {
        const m = e.target.closest('[data-vs-mode]');
        if (m && !m.disabled) { cfg.mode = m.dataset.vsMode; return paint(); }
        const w = e.target.closest('[data-vs-wait]');
        if (w) { cfg.wait = +w.dataset.vsWait; return paint(); }
        if (e.target.closest('[data-vs-start]')) {
          cfg.front = box.querySelector('#vs-front').value;
          cfg.back = box.querySelector('#vs-back').value;
          cfg.read = box.querySelector('#vs-read').checked;
          cfg.ai = box.querySelector('#vs-ai').checked;
          saveCfg(deckId, cfg);
          close('start');
          start(deckId, cfg); // 누른 그 순간에 시작해야 소리·마이크가 열린다
        }
      },
    });
    box = doc.querySelector('.ui-back:not(.out) .ui-voice');
    paint();
    return p;
  }
  // 예시: 이 덱의 첫 카드 (없으면 기본)
  function exampleOf(deckId) {
    const c = cardsOf(deckId)[0];
    if (!c) return { front: 'distress', back: '고통' };
    const f = V.answers(c.front)[0] || c.front, b = V.answers(c.back)[0] || c.back;
    const cut = (s) => (s.length > 16 ? s.slice(0, 15) + '…' : s);
    return { front: cut(f), back: cut(b) };
  }
  // '~을/를 듣고' (받침이 있으면 을)
  function josaHear(word) {
    const ch = String(word).trim().slice(-1);
    const code = ch.charCodeAt(0) - 0xac00;
    if (code >= 0 && code < 11172) return code % 28 ? '을' : '를';
    return /[lmn]$/i.test(ch) ? '을' : '를'; // 영어·스페인어는 한국어로 읽은 소리로 (distress → 디스트레스를, pool → 풀을)
  }

  /* ---------- 한 번의 말로 복습 ---------- */
  let S = null;
  // S = { deckId, cfg, queue, run, paused, stats:{ok1, ok2, wrong, heard}, missed:Set, startedAt, poke, hush, ctx, wake }

  function start(deckId, cfg) {
    stop(true);
    const deck = deckOf(deckId);
    if (!deck) return;
    const listen = cfg.mode === 'listen';
    let list = dueOf(deckId);
    if (listen && !list.length) list = cardsOf(deckId);
    const queue = list.map((c) => c.id);
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    S = { deckId, cfg, queue, run: 0, paused: false, stats: { ok1: 0, ok2: 0, wrong: 0, heard: 0 }, missed: new Set(), startedAt: Date.now(), total: queue.length, poke: null, hush: null, ctx: null, wake: null, undo: null, aiSeen: new Map(), aiOff: false };
    A.review.pane('voice');
    $('#vr-done').hidden = true;
    $('#vr-card').hidden = false;
    unlockAudio();
    keepAwake(true);
    // 처음 쓰는 폰이면 누른 그 순간에 마이크부터 켜서 허락을 받는다 (소리를 먼저 내면 누른 순간이 지나 버린다)
    if (!listen && !micKnown()) return warmMic();
    next();
  }
  const alive = (run) => !!S && S.run === run && !S.paused;
  function next() {
    if (!S) return;
    S.paused = false;
    S.pending = null;
    const run = ++S.run;
    loop(run);
  }
  function micKnown() { try { return localStorage.getItem(MIC_KEY) === '1'; } catch (e) { return false; } }
  function micOk() { try { localStorage.setItem(MIC_KEY, '1'); } catch (e) { /* 무시 */ } }

  function warmMic() {
    const run = ++S.run;
    paintCard(current());
    status('listen', '마이크를 허락해 주세요', '허락하면 바로 시작해요');
    actions([['pause', '잠깐 멈춤']]);
    cmds('');
    let r = null, done = false;
    const fin = (err) => {
      if (done) return;
      done = true;
      try { r.abort(); } catch (e) { /* 무시 */ }
      if (!S || S.run !== run) return;
      if (err && FATAL.includes(err)) return fail(err);
      micOk();
      next();
    };
    try {
      const R = Rec();
      r = new R();
      r.lang = langOf('a');
      r.onaudiostart = () => fin();
      r.onstart = () => setTimeout(() => fin(), 400);
      r.onerror = (e) => fin(e.error);
      r.onend = () => fin();
      r.start();
    } catch (e) { fin('start'); }
  }

  const current = () => (S ? store.get().cards.find((c) => c.id === S.queue[0]) || null : null);
  // 묻는 쪽·답하는 쪽 (뜻 말하기 = 앞면 보고 뒷면, 단어 말하기 = 뒷면 보고 앞면)
  const qSide = () => (S.cfg.mode === 'word' ? 'back' : 'front');
  const aSide = () => (S.cfg.mode === 'word' ? 'front' : 'back');
  function langOf(which) { const side = which === 'q' ? qSide() : aSide(); return S.cfg[side]; }

  async function loop(run) {
    while (alive(run)) {
      let c = current();
      while (S.queue.length && !c) { S.queue.shift(); c = current(); } // 그사이 지운 카드는 건너뜀
      if (!c) return finish();
      paintCard(c);
      const r = S.cfg.mode === 'listen' ? await listenCard(c, run) : await askCard(c, run);
      if (!alive(run)) return;
      if (r === 'stop') return finish();
      if (r === 'pause') return pause('quiet');
      if (r && r.error) return fail(r.error);
    }
  }

  // 말하기: 읽기 → 듣기 → 채점
  async function askCard(c, run) {
    let silent = 0, read = S.cfg.read;
    let repeated = false, echoed = false;
    for (;;) {
      if (read) {
        status('speak', '읽어 주는 중', '다 읽으면 바로 들어요');
        actions([['pause', '잠깐 멈춤'], ['reveal', '정답 보기']]);
        await say(V.speakText(c[qSide()]), langOf('q'));
        if (!alive(run)) return;
        await wait(250, run); // 읽은 소리 끝자락을 듣지 않게 조금 쉬고 듣는다
        if (!alive(run)) return;
      }
      read = S.cfg.read;
      status('listen', '듣고 있어요', S.cfg.mode === 'word' ? `${V.langName(langOf('a'))} 단어를 말해 보세요` : '뜻을 말해 보세요');
      actions([['pause', '잠깐 멈춤'], ['reveal', '정답 보기']]);
      cmds('ask');
      const h = await hear(S.cfg.wait * 1000, langOf('a'), run, true);
      if (!alive(run)) return;
      if (h.error) return h;
      if (h.cmd === 'pause') return 'pause';
      if (h.cmd === 'reveal') return wrong(c, null, run);
      if (!h.alts.length) {
        if (++silent >= 2) return 'pause'; // 두 번 조용하면 채점하지 않고 멈춤
        repeated = true;
        continue;
      }
      const j = V.judge(h.alts, c[aSide()], langOf('a'), c.voiceOk);
      if (j.ok) return right(c, j, repeated, run);
      const cmd = V.command(h.alts, langOf('a'));
      // 물소리 같은 한 글자 잡음, '음…' 같은 군말만 잡힌 것은 답으로 치지 않고 다시 듣는다 (되풀이되면 조용할 때처럼 멈춤)
      if (!cmd && V.noAnswer(h.alts, langOf('a'))) {
        if (++silent >= 2) return 'pause';
        read = false;
        continue;
      }
      // 읽어 준 문제(다른 언어)의 소리가 마이크로 들어온 것: 한 번은 답으로 치지 않고 다시 듣는다
      if (!cmd && !echoed && langOf('q') !== langOf('a') && V.judge(h.alts, c[qSide()], langOf('q')).ok) { echoed = true; read = false; continue; }
      silent = 0;
      if (cmd === 'repeat') { repeated = true; read = true; continue; }
      if (cmd === 'stop') return 'stop';
      if (cmd === 'pause') return 'pause';
      // 앞 카드가 틀렸다고 나온 뒤에 '맞았어'라고 하면 앞 카드를 맞은 걸로 고친다
      if (cmd === 'right' && S.undo && Date.now() - S.undo.at < UNDO_MS) {
        const same = fixLast();
        sound(true);
        status('ok', '앞 카드를 맞은 걸로 바꿨어요', same ? '다음 카드로 넘어가요' : '이 카드를 다시 읽어 줘요');
        actions([['pause', '잠깐 멈춤']]);
        cmds('');
        await wait(900, run);
        if (!alive(run)) return;
        if (same) return 'next';
        paintCard(c);
        read = S.cfg.read;
        continue;
      }
      if (cmd === 'right' || cmd === 'resume') { read = false; continue; }
      if (cmd === 'pass') return wrong(c, null, run);
      // 카드 글과 다르게 말함: 같은 뜻인지 AI에게 묻는다 (로그인했고 뜻 말하기일 때만)
      if (canAsk()) {
        status('think', '같은 뜻인지 확인하는 중', '카드 글과 달라서 AI에게 물어봐요');
        actions([['pause', '잠깐 멈춤']]);
        cmds('');
        heardLive(h.alts[0]);
        const yes = await askSame(c, h.alts);
        if (!alive(run)) return;
        if (yes) {
          keepOk(c, h.alts[0]);
          return right(c, { heard: h.alts[0], alt: '' }, repeated, run, '카드 글과 달라도 같은 뜻이라 맞았어요');
        }
      }
      return wrong(c, j.heard, run);
    }
  }

  /* ---------- 같은 뜻인지 AI에게 묻기 (4.5.1) ---------- */
  const aiLogin = () => !!(root.VoiceAIMock || (root.location.origin === JUDGE_HOME && root.Cloud && root.Cloud.user));
  const canAsk = () => !!S && !S.aiOff && S.cfg.ai !== false && S.cfg.mode === 'meaning' && aiLogin() && root.navigator.onLine !== false;
  // true: 같은 뜻, false: 다른 뜻, null: 못 물어봄 (틀린 것으로 둔다). 같은 카드에 같은 말은 한 번만 묻는다
  async function askSame(c, alts) {
    const said = alts.slice(0, 3).map((a) => String(a).slice(0, 120));
    const key = c.id + '|' + said.join('|');
    if (S.aiSeen.has(key)) return S.aiSeen.get(key);
    let yes = null;
    try {
      if (root.VoiceAIMock) yes = await root.VoiceAIMock({ q: c[qSide()], a: c[aSide()], said });
      else {
        const tok = await root.Cloud.user.getIdToken();
        const ctl = root.AbortController ? new AbortController() : null;
        const timer = setTimeout(() => { if (ctl) ctl.abort(); }, 6000);
        try {
          const res = await fetch(JUDGE_URL, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: c[qSide()].slice(0, 200), a: c[aSide()].slice(0, 400), said }),
            signal: ctl ? ctl.signal : undefined,
          });
          const out = await res.json().catch(() => null);
          if (res.ok && out && typeof out.ok === 'boolean') yes = out.ok;
          else if (out && out.error === 'limit') S.aiOff = true; // 오늘 횟수를 다 씀: 이번 복습에서는 더 묻지 않는다
        } finally { clearTimeout(timer); }
      }
    } catch (e) { yes = null; }
    if (typeof yes === 'boolean') S.aiSeen.set(key, yes);
    return yes === true;
  }
  // AI가 같은 뜻이라고 한 말을 카드에 남긴다 (다음부터는 묻지 않고 바로 맞음)
  function keepOk(c, said) {
    const w = V.dropFillers(said, langOf('a')) || V.norm(said, langOf('a'));
    if (!w) return;
    store.update((st) => {
      const x = st.cards.find((y) => y.id === c.id);
      if (!x) return;
      const list = (x.voiceOk || []).filter((v) => v !== w);
      list.push(w);
      x.voiceOk = list.slice(-KEEP_OK);
    });
  }

  async function right(c, j, repeated, run, note) {
    sound(true);
    paintResult(c, true, j.heard, j.alt);
    status('ok', '띵! 다음 카드로 넘어가요', note || (S.cfg.read ? (S.cfg.mode === 'word' ? `${V.langName(langOf('a'))} 목소리로 한 번 읽어 줘요` : '뜻 전체를 한 번 읽어 줘요') : ''));
    actions([['pause', '잠깐 멈춤']]);
    cmds('');
    apply(c, V.gradeOf({ ok: true, repeated }));
    if (S.cfg.read) await say(V.speakText(c[aSide()]), langOf('a'));
    await wait(S.cfg.read ? 300 : 900, run);
    return 'next';
  }

  async function wrong(c, heard, run) {
    sound(false);
    paintResult(c, false, heard, '');
    const ans = V.speakText(c[aSide()]), a = langOf('a');
    actions([['right', '맞은 걸로'], ['skip', '다음']]);
    let fix = null;
    // 잘못 알아들었으면 '맞았어': 뚱 하자마자 마이크를 켠다 (정답을 읽는 동안엔 못 들으니 정답은 그다음에 읽는다).
    // 몰라·정답 보기로 넘긴 카드는 묻지 않음
    // 단어 말하기(영어·스페인어로 듣는 중)여도 '맞았어'는 한국어로 하니 한국어로 듣는다
    if (heard) {
      status('listen', '잘못 알아들었으면 ‘맞았어’', '지금 바로 말하면 돼요');
      cmds('');
      await wait(200, run); // 뚱 소리가 마이크에 들어가지 않을 만큼만
      if (!alive(run)) return;
      const h = await hear(4000, 'ko-KR', run, true);
      if (!alive(run)) return;
      fix = h.cmd || (h.alts.length ? (V.saysRight(h.alts, 'ko-KR') ? 'right' : V.command(h.alts, a)) : null);
    }
    if (!['right', 'skip', 'stop', 'pause'].includes(fix)) {
      status('bad', `“정답은 ${ans}”`, '이 카드는 몇 장 뒤에 다시 나와요');
      cmds(heard ? 'late' : '');
      if (S.cfg.read) {
        if (/^ko/i.test(a)) await say('정답은 ' + ans, a);
        else { await say('정답은', 'ko-KR'); if (alive(run)) await say(ans, a); }
      }
      if (!alive(run)) return;
      // 단추로 고칠 시간
      const h = await idle(S.cfg.read ? 600 : 1800, run);
      if (!alive(run)) return;
      if (h && h.cmd) fix = h.cmd;
    }
    if (fix === 'right') {
      paintResult(c, true, heard, '');
      sound(true);
      status('ok', '맞은 걸로 바꿨어요', '다음 카드로 넘어가요');
      apply(c, 'good', true);
      await wait(700, run);
      return 'next';
    }
    apply(c, 'again', false, !!heard); // 말한 답이 틀린 것은 다음 카드에서 '맞았어'로 고칠 수 있게
    if (fix === 'stop') return 'stop';
    if (fix === 'pause') return 'pause';
    return 'next';
  }

  // 듣기만: 읽기 → 생각할 시간 → 뜻 읽기 → 다음 (채점 없음)
  async function listenCard(c, run) {
    status('speak', '읽어 주는 중', '');
    actions([['pause', '잠깐 멈춤'], ['skip', '다음']]);
    cmds('');
    await say(V.speakText(c[qSide()]), langOf('q'));
    if (!alive(run)) return;
    const think = Math.max(3, Math.round(S.cfg.wait / 2)) * 1000;
    status('think', '생각해 보세요', '조금 뒤 뜻을 읽어 줘요');
    const h = await idle(think, run, true);
    if (!alive(run)) return;
    if (!(h && h.cmd === 'skip')) {
      paintResult(c, null, '', '');
      status('speak', '뜻을 읽어 주는 중', '');
      await say(V.speakText(c[aSide()]), langOf('a'));
      if (!alive(run)) return;
      await idle(1200, run);
      if (!alive(run)) return;
    }
    S.stats.heard++;
    S.queue.shift();
    return 'next';
  }

  // 채점 결과를 간격 반복에 넣는다 (손으로 하는 복습 grade()와 같은 규칙)
  // undoable: 말한 답이 틀렸다고 본 것. 다음 카드에서 '맞았어'라고 하면 fixLast()로 되돌린다
  const UNDO_MS = 45000;
  function apply(c, grade, fixed, undoable) {
    const t = A.now();
    const cur = store.get().cards.find((x) => x.id === c.id);
    S.undo = cur && undoable && grade === 'again' ? { id: c.id, before: JSON.parse(JSON.stringify(cur)), at: Date.now(), missed: S.missed.has(c.id) } : null;
    if (cur) {
      const nextCard = SRS.review(cur, grade, t);
      store.update((st) => {
        const i = st.cards.findIndex((x) => x.id === c.id);
        if (i >= 0) st.cards[i] = nextCard;
        st.reviewLog.push({ cardId: c.id, grade, at: t, via: 'voice' });
      });
    }
    if (grade === 'again') { S.stats.wrong++; S.missed.add(c.id); }
    else if (S.missed.has(c.id) && !fixed) S.stats.ok2++;
    else S.stats.ok1++;
    S.queue.shift();
    if (grade === 'again') S.queue.splice(Math.min(S.queue.length, 3), 0, c.id); // 몇 장 뒤에 다시
    meta();
  }
  // 바로 앞에 틀렸다고 본 카드를 맞은 걸로 고친다 (기록도 '다시' → '보통'). 고친 카드가 지금 카드면 true
  function fixLast() {
    const u = S.undo;
    S.undo = null;
    if (!u) return false;
    const t = A.now();
    store.update((st) => {
      const i = st.cards.findIndex((x) => x.id === u.id);
      if (i >= 0) st.cards[i] = SRS.review(u.before, 'good', t);
      for (let k = st.reviewLog.length - 1; k >= 0; k--) {
        const e = st.reviewLog[k];
        if (e.cardId === u.id && e.grade === 'again' && e.via === 'voice') { st.reviewLog[k] = { cardId: u.id, grade: 'good', at: t, via: 'voice' }; break; }
      }
    });
    S.stats.wrong = Math.max(0, S.stats.wrong - 1);
    S.stats.ok1++;
    if (!u.missed) S.missed.delete(u.id);
    const same = S.queue[0] === u.id;
    const at = S.queue.indexOf(u.id, same ? 0 : 1); // 몇 장 뒤에 다시 넣어 둔 것을 뺀다
    if (at >= 0) S.queue.splice(at, 1);
    meta();
    return same;
  }

  /* ---------- 멈춤 · 끝 ---------- */
  function pause(why) {
    if (!S) return;
    S.paused = true;
    S.run++;
    hushAll();
    status('pause', why === 'away' ? '다른 화면에 다녀와서 멈췄어요' : why === 'quiet' ? '말이 없어서 잠깐 멈췄어요' : '잠깐 멈췄어요',
      S.cfg.mode === 'listen' ? '계속하기를 누르면 이어서 해요' : `‘${V.commandWords(langOf('a')).resume}’이라고 말하거나 계속하기를 눌러요`);
    actions([['resume', '계속하기'], ['stop', '그만하기']]);
    cmds(S.cfg.mode === 'listen' ? '' : 'pause');
    if (S.cfg.mode !== 'listen' && why !== 'away') waitResume();
  }
  // 멈춘 뒤 1분 동안 '계속'·'그만'을 듣는다
  async function waitResume() {
    const run = S.run, until = Date.now() + 60000; // hear()는 S.run만 보므로 멈춘 채로 듣는다
    while (S && S.run === run && Date.now() < until) {
      const h = await hear(Math.min(10000, until - Date.now()), langOf('a'), run, false);
      if (!S || S.run !== run) return;
      if (h.error) break;
      const cmd = h.cmd || (h.alts.length ? V.command(h.alts, langOf('a')) : null);
      if (cmd === 'resume' || cmd === 'repeat') return next();
      if (cmd === 'stop') return finish();
    }
    if (!S || S.run !== run) return;
    S.paused = true;
    status('pause', '잠깐 멈췄어요', '계속하기를 누르면 이어서 해요');
    cmds('');
  }
  function fail(err) {
    if (!S) return;
    S.paused = true;
    S.run++;
    hushAll();
    const msg = {
      'not-allowed': ['마이크를 쓸 수 없어요', '브라우저 설정에서 이 사이트의 마이크를 허락한 뒤 계속하기를 눌러 주세요'],
      'service-not-allowed': ['음성 인식을 쓸 수 없어요', '이 브라우저에서는 ‘듣기만’으로 해 보세요'],
      'audio-capture': ['마이크를 찾지 못했어요', '다른 앱이 마이크를 쓰고 있지 않은지 봐 주세요'],
      network: ['인터넷이 필요해요', '음성 인식은 인터넷으로 해요. 연결을 확인하고 계속하기를 눌러 주세요'],
      'language-not-supported': [`이 폰은 ${V.langName(langOf('a'))} 음성 인식을 못 해요`, '언어를 바꾸거나 ‘듣기만’으로 해 보세요'],
    }[err] || ['음성 인식이 자꾸 멈춰요', '이 브라우저에서는 ‘듣기만’으로 해 보세요'];
    status('err', msg[0], msg[1]);
    actions([['resume', '계속하기'], ['listen', '듣기만으로 바꾸기']]);
    cmds('');
  }
  function finish() {
    if (!S) return;
    const s = S.stats, listen = S.cfg.mode === 'listen';
    const min = Math.max(1, Math.round((Date.now() - S.startedAt) / 60000));
    S.paused = true;
    S.run++;
    hushAll();
    $('#vr-card').hidden = true;
    $('#vr-status').hidden = true;
    $('#vr-cmds').hidden = true;
    $('#vr-actions').hidden = true;
    $('#vr-meta').textContent = '';
    const left = S.queue.length;
    const missed = [...S.missed].map((id) => store.get().cards.find((c) => c.id === id)).filter(Boolean);
    const done = $('#vr-done');
    done.hidden = false;
    done.innerHTML = listen
      ? `<h2>듣기 끝!</h2><p class="muted vr-done-sub">카드 ${s.heard}장을 들었어요 · ${min}분</p>` +
        '<div class="vr-done-btns"><button type="button" class="btn primary" data-vr="back">덱으로 돌아가기</button></div>'
      : `<h2>말로 복습 ${left ? '그만!' : '끝!'}</h2><p class="muted vr-done-sub">${left ? `카드 ${left}장이 남았어요` : `${S.total}장을 모두 말했어요`} · ${min}분</p>` +
        `<div class="vr-sum"><div class="ok"><b>${s.ok1}</b><span>한 번에 맞힘</span></div><div><b>${s.ok2}</b><span>다시 해서 맞힘</span></div><div class="bad"><b>${s.wrong}</b><span>틀린 횟수</span></div></div>` +
        (missed.length ? '<p class="ui-group vr-miss-head">헷갈린 카드</p><ul class="vr-miss">' + missed.slice(0, 30).map((c) => `<li><b>${esc(c.front)}</b><span>${esc(c.back)}</span></li>`).join('') + '</ul>' : '') +
        '<div class="vr-done-btns"><button type="button" class="btn primary" data-vr="back">덱으로 돌아가기</button></div>';
    const total = s.ok1 + s.ok2;
    const line = listen ? `듣기 끝! 카드 ${s.heard}장을 들었어요.` : `말로 복습 ${left ? '그만' : '끝'}! ${total}장을 맞혔어요.` + (missed.length ? ` 헷갈린 카드는 ${missed.length}장이에요.` : '');
    S.done = true;
    if (canSpeak()) say(line, 'ko-KR', true);
    keepAwake(false);
  }
  // 끝낸다. quiet면 결과 화면 없이 (다른 탭으로 갔을 때)
  function stop(quiet) {
    if (!S) { if (!$('#voice-study').hidden) { A.review.pane('detail'); A.review.detail(); } return; }
    const had = S.stats.ok1 + S.stats.ok2 + S.stats.wrong + S.stats.heard;
    if (!quiet && !S.done && had) return finish();
    S.run++;
    S.paused = true;
    hushAll();
    keepAwake(false);
    const wasDone = S.done;
    S = null;
    if (!quiet || wasDone) { A.review.pane('detail'); A.review.detail(); }
    else if (A.view === 'review' && !$('#voice-study').hidden) { A.review.pane('detail'); A.review.detail(); }
  }
  const active = () => !!S || !$('#voice-study').hidden;

  /* ---------- 소리 내기 · 듣기 ---------- */
  let voices = [];
  function loadVoices() { try { voices = synth() ? synth().getVoices() || [] : []; } catch (e) { voices = []; } }
  if (synth()) { loadVoices(); try { synth().addEventListener('voiceschanged', loadVoices); } catch (e) { /* 무시 */ } }
  function voiceFor(lang) {
    if (!voices.length) loadVoices();
    const L = lang.toLowerCase(), P = L.slice(0, 2);
    const same = voices.filter((v) => String(v.lang || '').replace('_', '-').toLowerCase() === L);
    const near = same.length ? same : voices.filter((v) => String(v.lang || '').toLowerCase().startsWith(P));
    return near.find((v) => v.localService) || near[0] || null;
  }
  // 읽어 주기. 끝나면 풀리는 약속 (onend가 안 오는 폰을 위해 글 길이만큼 기다리면 풀림)
  function say(text, lang, keep) {
    return new Promise((resolve) => {
      const s = synth();
      if (!s || !text || !root.SpeechSynthesisUtterance) return resolve();
      const u = new root.SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = voiceFor(lang);
      if (v) u.voice = v;
      u.rate = /^ko/i.test(lang) ? 1.05 : 0.95;
      let done = false;
      const t = setTimeout(() => end(), 2000 + text.length * 160);
      function end() { if (done) return; done = true; clearTimeout(t); if (S && S.hush === hush) S.hush = null; resolve(); }
      const hush = () => { try { s.cancel(); } catch (e) { /* 무시 */ } end(); };
      u.onend = end;
      u.onerror = end;
      if (S && !keep) S.hush = hush;
      try { s.cancel(); s.speak(u); } catch (e) { end(); }
    });
  }
  // 누른 순간에 소리 길을 열어 둔다 (휴대폰은 누르지 않고 처음 내는 소리를 막는다)
  function unlockAudio() {
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (Ctx) { S.ctx = new Ctx(); if (S.ctx.resume) S.ctx.resume(); }
    } catch (e) { S.ctx = null; }
    try {
      if (canSpeak()) { const u = new root.SpeechSynthesisUtterance(' '); u.volume = 0; synth().speak(u); }
    } catch (e) { /* 무시 */ }
  }
  // 띵(맞음) · 뚱(틀림)
  function sound(ok) {
    const ctx = S && S.ctx;
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime + 0.01;
      const notes = ok ? [[880, 0, 0.12], [1320, 0.11, 0.22]] : [[247, 0, 0.32]];
      notes.forEach(([f, at, len]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = ok ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(ok ? 0.22 : 0.3, t0 + at + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        o.start(t0 + at); o.stop(t0 + at + len + 0.02);
      });
    } catch (e) { /* 소리 불가 */ }
    try { if (!ok && navigator.vibrate) navigator.vibrate(120); } catch (e) { /* 무시 */ }
  }

  /**
   * 듣기. ms 동안 (말을 시작했으면 끝날 때까지 조금 더) 듣고 { alts: [후보…] } 를 돌려준다. 조용하면 alts가 빈 배열.
   * 단추를 누르면 { alts: [], cmd } 로 바로 풀린다 (S.poke). ring: 남은 시간 고리를 그릴지
   */
  function hear(ms, lang, run, ring) {
    return new Promise((resolve) => {
      const R = Rec();
      if (!R || !S) return resolve({ alts: [], error: 'service-not-allowed' });
      if (S.pending) { const cmd = S.pending; S.pending = null; return resolve({ alts: [], cmd }); }
      let done = false, rec = null, interim = '', lastStart = 0, quick = 0, on = false; // on: 지금 인식기가 켜졌나
      const t0 = Date.now();
      let deadline = t0 + ms;
      const ringEl = $('#vr-ring');
      ringEl.hidden = !ring;
      const tick = setInterval(() => {
        if (!S || S.run !== run) return finish({ alts: [] });
        const left = deadline - Date.now();
        if (ring) paintRing(left, ms);
        // 지금 인식기가 1.5초 넘게 켜지지 않은 채 시간이 다 됐으면 고장 (일부 아이폰 홈 화면 앱, 마이크를 다른 앱이 잡음)
        if (left <= 0) finish(interim ? { alts: [interim] } : on || Date.now() - lastStart < 1500 ? { alts: [] } : { alts: [], error: 'unstable' });
      }, 100);
      if (ring) paintRing(ms, ms);
      function finish(r) {
        if (done) return;
        done = true;
        clearInterval(tick);
        ringEl.hidden = true;
        if (S && S.poke === poke) S.poke = null;
        try { if (rec) rec.abort(); } catch (e) { /* 무시 */ }
        if (r.alts.length || r.cmd) micOk();
        resolve(r);
      }
      const poke = (cmd) => finish({ alts: [], cmd });
      S.poke = poke;
      const later = () => { deadline = Math.max(deadline, Date.now() + 2500); }; // 말을 시작했으면 끝까지 듣는다
      function begin() {
        if (done) return;
        try {
          rec = new R();
          rec.lang = lang;
          rec.interimResults = true;
          rec.maxAlternatives = 5;
          rec.continuous = false;
        } catch (e) { return finish({ alts: [], error: 'start' }); }
        lastStart = Date.now();
        on = false;
        rec.onresult = (e) => {
          let fin = null;
          interim = '';
          for (let i = e.resultIndex || 0; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) fin = Array.from({ length: res.length }, (_, k) => String(res[k].transcript || '').trim()).filter(Boolean);
            else interim += res[0].transcript;
          }
          interim = interim.trim();
          on = true;
          if (interim) { heardLive(interim); later(); }
          if (fin && fin.length) finish({ alts: fin });
        };
        rec.onspeechstart = later;
        rec.onstart = rec.onaudiostart = () => { on = true; };
        rec.onerror = (e) => { if (FATAL.includes(e.error)) finish({ alts: [], error: e.error }); };
        rec.onend = () => {
          if (done) return;
          if (interim) return finish({ alts: [interim] }); // 끝났는데 최종 결과가 없으면 들은 데까지
          quick = Date.now() - lastStart < 400 ? quick + 1 : 0;
          if (quick >= 5) return finish({ alts: [], error: 'unstable' }); // 켜자마자 꺼지기를 되풀이 (일부 아이폰)
          if (Date.now() < deadline - 300) setTimeout(begin, quick ? 250 : 0); // 말이 없어 먼저 끝났으면 다시 듣기
          else finish({ alts: [] });
        };
        try { rec.start(); } catch (e) { finish({ alts: [], error: 'start' }); }
      }
      begin();
    });
  }
  // 아무것도 안 하고 기다리기 (단추는 받는다)
  function idle(ms, run, ring) {
    return new Promise((resolve) => {
      if (!S) return resolve(null);
      if (S.pending) { const cmd = S.pending; S.pending = null; return resolve({ cmd }); }
      const t0 = Date.now();
      const ringEl = $('#vr-ring');
      ringEl.hidden = !ring;
      const tick = setInterval(() => {
        if (!S || S.run !== run) return end(null);
        const left = ms - (Date.now() - t0);
        if (ring) paintRing(left, ms);
        if (left <= 0) end(null);
      }, 100);
      let done = false;
      function end(v) { if (done) return; done = true; clearInterval(tick); ringEl.hidden = true; if (S && S.poke === poke) S.poke = null; resolve(v); }
      const poke = (cmd) => end({ cmd });
      S.poke = poke;
    });
  }
  const wait = (ms, run) => idle(ms, run, false);
  function hushAll() {
    if (!S) return;
    const p = S.poke, h = S.hush;
    S.poke = null; S.hush = null;
    try { if (h) h(); else if (synth()) synth().cancel(); } catch (e) { /* 무시 */ }
    if (p) p('stop-internal');
  }

  // 화면이 꺼지지 않게
  async function keepAwake(on) {
    if (!on) { try { if (S && S.wake) S.wake.release(); } catch (e) { /* 무시 */ } if (S) S.wake = null; return; }
    if (!S || S.wake || !('wakeLock' in navigator)) return;
    try { const w = await navigator.wakeLock.request('screen'); if (S) { S.wake = w; w.addEventListener('release', () => { if (S && S.wake === w) S.wake = null; }); } else w.release(); } catch (e) { /* 지원 안 함 */ }
  }
  doc.addEventListener('visibilitychange', () => {
    if (!S || S.done) return;
    if (doc.hidden) { if (!S.paused) pause('away'); }
    else keepAwake(true);
  });

  /* ---------- 그리기 ---------- */
  function meta() {
    if (!S) return;
    const s = S.stats;
    $('#vr-meta').textContent = S.cfg.mode === 'listen' ? `남은 카드 ${S.queue.length}장` : `남은 카드 ${S.queue.length}장 · 맞음 ${s.ok1 + s.ok2} · 틀림 ${s.wrong}`;
  }
  function paintCard(c) {
    if (!S || !c) return;
    meta();
    $('#vr-card').hidden = false;
    $('#vr-status').hidden = false;
    $('#vr-cmds').hidden = false;
    $('#vr-actions').hidden = false;
    $('#vr-card').className = 'flash vr-card';
    const ql = V.langName(langOf('q')), al = V.langName(langOf('a'));
    $('#vr-lang').textContent = S.cfg.mode === 'listen' ? `${ql} → ${al} 듣기` : S.cfg.mode === 'word' ? `${ql} → ${al}로 말하기` : `${ql} → 뜻을 ${al}로`;
    $('#vr-front').textContent = c[qSide()];
    $('#vr-ans').hidden = true;
    $('#vr-heard').hidden = true;
    $('#vr-verdict').hidden = true;
  }
  function heardLive(text) {
    const el = $('#vr-heard');
    el.hidden = false;
    el.innerHTML = `<b>“${esc(text)}…”</b>`;
  }
  // ok: true 맞음 / false 틀림 / null 듣기만(정답만 보여 줌)
  function paintResult(c, ok, heard, alt) {
    const ans = c[aSide()];
    const el = $('#vr-ans');
    el.hidden = false;
    const hl = ok && alt ? V.highlight(ans, alt) : null;
    el.innerHTML = hl ? `${esc(hl[0])}<mark>${esc(hl[1])}</mark>${esc(hl[2])}` : esc(ans);
    const h = $('#vr-heard');
    h.hidden = !heard;
    if (heard) h.innerHTML = `들은 말 <b>“${esc(heard)}”</b>`;
    const v = $('#vr-verdict');
    v.hidden = ok === null;
    if (ok !== null) v.innerHTML = ok ? `${ic('check')}맞았어요` : `${ic('x')}${heard ? '아쉬워요' : '정답을 들어 봐요'}`;
    $('#vr-card').className = 'flash vr-card' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
  }
  function status(kind, title, sub) {
    const st = $('#vr-status');
    st.hidden = false;
    st.className = 'vr-status ' + kind;
    const icon = kind === 'listen' ? 'mic' : kind === 'pause' ? 'pause' : kind === 'err' ? 'x' : kind === 'think' ? 'clock' : 'sound';
    st.querySelector('.vr-dot').innerHTML = ic(icon);
    $('#vr-say').textContent = title;
    $('#vr-sub').textContent = sub || '';
    $('#vr-sub').hidden = !sub;
  }
  function paintRing(left, ms) {
    const r = $('#vr-ring');
    const p = Math.max(0, Math.min(1, left / ms));
    r.style.setProperty('--p', p.toFixed(3));
    r.querySelector('b').textContent = String(Math.max(0, Math.ceil(left / 1000)));
  }
  const ACT_ICON = { pause: 'pause', resume: 'play', reveal: null, right: 'check', skip: 'next', stop: null, listen: 'sound' };
  function actions(list) {
    const el = $('#vr-actions');
    el.hidden = false;
    el.innerHTML = list.map(([id, label]) => `<button type="button" class="btn" data-vr="${id}">${ACT_ICON[id] ? ic(ACT_ICON[id]) : ''}${esc(label)}</button>`).join('');
  }
  function cmds(kind) {
    const el = $('#vr-cmds');
    if (!kind || !S) { el.hidden = true; el.innerHTML = ''; return; }
    const w = V.commandWords(langOf('a'));
    const ko = /^ko/i.test(langOf('a'));
    const chip = (word, mean) => `<b>${esc(word)}${!ko && mean ? `<small>${esc(mean)}</small>` : ''}</b>`;
    el.hidden = false;
    if (kind === 'ask') el.innerHTML = '말로 할 수 있어요 ' + chip(w.pass, '몰라') + chip(w.repeat, '다시') + chip(w.stop, '그만') + (S.undo ? chip(w.right + ' (앞 카드)', '맞았어') : '');
    else if (kind === 'late') el.innerHTML = '놓쳤으면 다음 카드에서 ' + chip(w.right, '맞았어') + ' 라고 해도 고쳐져요';
    else if (kind === 'pause') el.innerHTML = '말로 할 수 있어요 ' + chip(w.resume, '계속') + chip(w.stop, '그만');
  }

  /* ---------- 단추 ---------- */
  $('#deck-voice').addEventListener('click', () => { const id = A.review.deckId(); if (id) openStart(id); });
  $('#vr-back').addEventListener('click', () => stop());
  $('#voice-study').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vr]');
    if (!b) return;
    const what = b.dataset.vr;
    if (what === 'back') { stop(true); A.review.pane('detail'); A.review.detail(); return; }
    if (!S) return;
    if (what === 'pause') return pause('button');
    if (what === 'resume') { S.run++; hushAll(); return next(); }
    if (what === 'stop') return stop();
    if (what === 'listen') { S.cfg.mode = 'listen'; saveCfg(S.deckId, S.cfg); S.run++; hushAll(); return next(); }
    // reveal(정답 보기) · right(맞은 걸로) · skip(다음): 읽는 중이면 멈추고, 듣거나 기다리는 중이면 바로 그 뜻으로.
    // 읽는 중에 눌렀으면 다음 듣기·기다리기가 시작하자마자 받는다 (S.pending)
    S.pending = what;
    if (S.hush) S.hush();
    if (S.poke) { const p = S.poke; S.pending = null; p(what); }
  });
  // 키보드(PC): Esc 멈춤, 스페이스 계속
  doc.addEventListener('keydown', (e) => {
    if (!S || A.view !== 'review' || $('#voice-study').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (doc.querySelector('.ui-back:not(.out)')) return;
    if (e.key === 'Escape') { e.preventDefault(); if (!S.paused) pause('button'); }
    else if (e.key === ' ' && S.paused && !S.done) { e.preventDefault(); next(); }
  });

  root.Voice = { open: openStart, start, stop, active, get state() { return S ? { mode: S.cfg.mode, queue: S.queue.slice(), stats: Object.assign({}, S.stats), paused: S.paused, done: !!S.done } : null; } };
})(typeof window !== 'undefined' ? window : globalThis);
