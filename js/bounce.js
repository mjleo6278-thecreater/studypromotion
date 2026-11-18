/* 이스터에그 '벽 튕기기' (v3.8): 앱 소개의 비밀 입력칸에 비밀 단어를 넣으면 열리는 작은 공 게임 (js/egg.js가 연다).
 * - 화면을 좌우로 끌어 아래 막대를 움직이고, 공을 받아 넘긴다(1점). 공은 양옆 벽과 천장에 튕기고, 천장의 골대에 들어가면 1점 더.
 *   공은 시간이 갈수록 끝없이 빨라진다 (사용자 규칙, 2026-11-18). 끝나면 이 기기의 기록 순위(상위 10개)를 보여 준다.
 * - 공 얼굴: '얼굴 사진'으로 기기 안의 사진을 고르면 얼굴 부분을 동그랗게 잘라 공으로 쓴다.
 *   잘린 사진은 이 기기의 localStorage(studypromotion.eggBall)에만 둔다. 공부 기록(studypromotion.v1)과 따로라
 *   계정 동기화·자동 백업·내보내기에 들어가지 않고, 앱 파일과 저장소에도 사진을 담지 않는다.
 * - 사진을 안 고르면 기본 공(빨강·흰 세로 줄무늬에 남색 테두리, 가운데 'K7'. 구단 문장은 넣지 않는다).
 * 계산(자르기 처음 자리, 공 움직임)은 화면 없이도 돌아서 tests/bounce.test.js가 확인한다. */
(function (root) {
  const BALL_KEY = 'studypromotion.eggBall';
  const BEST_KEY = 'studypromotion.eggBest';
  const BOARD_KEY = 'studypromotion.eggBoard'; // 기록 순위 [{ s 점수, g 골, sec 버틴 초, t 끝난 때 }]
  const BOARD_MAX = 10;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- 사진 자르기 계산 (사진 픽셀 기준: 동그라미 가운데 cx·cy, 지름 d) ---------- */
  function cropLimits(w, h) {
    return { min: Math.max(24, Math.min(w, h) * 0.06), max: Math.max(w, h) * 1.2 };
  }
  // 동그라미 가운데는 사진 안에, 크기는 너무 작거나 크지 않게
  function clampCrop(c, w, h) {
    const L = cropLimits(w, h);
    return { cx: clamp(c.cx, 0, w), cy: clamp(c.cy, 0, h), d: clamp(c.d, L.min, L.max) };
  }
  // 처음 자리: 사람 사진은 얼굴이 대개 위쪽 가운데에 있다. 세로로 긴 사진(셀카)은 얼굴이 더 크고 조금 아래
  function initialCrop(w, h) {
    const tall = h > w * 1.15;
    const d = Math.min(w, h) * (tall ? 0.5 : 0.32);
    return clampCrop({ cx: w / 2, cy: Math.max(d / 2, h * (tall ? 0.34 : 0.185)), d }, w, h);
  }
  // 브라우저가 얼굴을 찾아 주면(지원하는 기기만) 그 자리로: 머리카락까지 들어가게 조금 크게
  function cropFromFace(box, w, h) {
    return clampCrop({ cx: box.x + box.width / 2, cy: box.y + box.height * 0.42, d: Math.max(box.width, box.height) * 1.5 }, w, h);
  }
  // 크기 막대(0~100) ↔ 지름. 로그 눈금이라 어느 크기에서나 고르게 움직인다 (0 = 사진 전체, 100 = 가장 크게)
  function zoomToD(z, w, h) { const L = cropLimits(w, h); return L.max * Math.pow(L.min / L.max, clamp(z, 0, 100) / 100); }
  function dToZoom(d, w, h) { const L = cropLimits(w, h); return clamp(100 * Math.log(d / L.max) / Math.log(L.min / L.max), 0, 100); }

  /* ---------- 공 움직임 (게임 판 W×H, 왼쪽 위가 0,0) ----------
     막대 윗면 py, 가운데 px, 폭 pw. 골대는 천장의 gx를 가운데로 폭 gw. 아래쪽은 열려 있어 공을 놓치면 끝 */
  const SPEED_PER_SEC = 0.012; // 공 빠르기: 1초에 처음 빠르기의 1.2%씩 (10초에 12%, 1분에 1.7배) 끝없이 빨라진다
  const FAST_CUE = 15;        // 15초마다 '빨라져요!' 알림
  const speedOf = (g) => g.base * (1 + SPEED_PER_SEC * g.t);
  function createGame(W, H) {
    const g = { W: 0, H: 0, r: 20, pw: 100, ph: 14, py: 0, px: W / 2, pv: 0, gw: 120, gx: W / 2, ga: 0, base: 400, t: 0,
      state: 'ready', score: 0, cue: 0, hits: 0, goals: 0, ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 } };
    layoutGame(g, W, H);
    serve(g);
    return g;
  }
  // 화면 크기가 바뀌면(돌리기 등) 크기를 다시 정하고, 공·막대는 비율대로 옮긴다
  function layoutGame(g, W, H) {
    const fx = g.W ? g.ball.x / g.W : 0.5, fy = g.H ? g.ball.y / g.H : 0.5, fp = g.W ? g.px / g.W : 0.5, fg = g.W ? g.gx / g.W : 0.5;
    g.W = W; g.H = H;
    g.r = clamp(Math.min(W, H) * 0.09, 20, 46);
    g.pw = clamp(W * 0.28, 84, 160);
    g.py = H - clamp(H * 0.06, 22, 44) - g.ph;
    g.gw = clamp(W * 0.34, g.r * 3, 200);
    g.base = clamp(H * 0.85, 300, 700); // 처음 빠르기(초당 px): 화면을 1초쯤에 오간다
    g.px = clamp(fp * W, g.pw / 2, W - g.pw / 2);
    g.gx = clamp(fg * W, g.gw / 2, W - g.gw / 2);
    if (g.state === 'ready') stick(g);
    else { g.ball.x = clamp(fx * W, g.r, W - g.r); g.ball.y = Math.min(fy * H, g.py - g.r); }
  }
  function stick(g) { g.ball.x = g.px; g.ball.y = g.py - g.r - 1; g.ball.vx = 0; g.ball.vy = 0; }
  // 새 판: 공은 막대 위에서 기다린다
  function serve(g) {
    g.state = 'ready'; g.score = 0; g.cue = 0; g.hits = 0; g.goals = 0; g.t = 0; g.ga = 0; g.gx = g.W / 2;
    stick(g);
  }
  // 위로 차 올리기 (rnd 0~1: 기울기, 테스트에서 정해 줄 수 있음)
  function launch(g, rnd) {
    if (g.state !== 'ready') return false;
    const a = ((rnd == null ? Math.random() : rnd) - 0.5) * 0.8; // 위쪽 ±23°
    g.ball.vx = Math.sin(a) * g.base; g.ball.vy = -Math.cos(a) * g.base;
    g.state = 'play';
    return true;
  }
  // 막대를 손가락 쪽으로 (바로 붙지 않고 빠르게 따라가서 부드럽다). 움직이는 빠르기 pv는 받아 칠 때 공을 조금 더 꺾는다
  function movePaddle(g, tx, dt) {
    const before = g.px;
    g.px += (clamp(tx, g.pw / 2, g.W - g.pw / 2) - g.px) * Math.min(1, dt * 28);
    g.pv = dt > 0 ? (g.px - before) / dt : 0;
    if (g.state === 'ready') stick(g);
  }
  // 몇 번 받아 넘기면 골대가 천천히 좌우로 움직이기 시작한다
  const goalSwing = (g) => Math.max(0, g.W / 2 - g.gw / 2 - 6) * clamp((g.hits - 5) / 12, 0, 1);
  // dt초 진행. 일어난 일(벽·천장·골·막대·놓침)을 돌려준다
  function step(g, dt) {
    const ev = [];
    if (g.state !== 'play' || !(dt > 0)) return ev;
    g.t += dt;
    g.ga += (goalSwing(g) - g.ga) * Math.min(1, dt * 1.5);
    g.gx = g.W / 2 + Math.sin(g.t * 0.8) * g.ga;
    const b = g.ball, r = g.r;
    { const v = Math.hypot(b.vx, b.vy); if (v > 0) { const k = speedOf(g) / v; b.vx *= k; b.vy *= k; } } // 시간에 맞춰 빨라진다
    if (Math.floor(g.t / FAST_CUE) > g.cue) { g.cue = Math.floor(g.t / FAST_CUE); ev.push({ type: 'faster', cue: g.cue, x: b.x, y: b.y }); }
    const n = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / (r * 0.35))); // 빨라도 막대·벽을 뚫고 지나가지 않게 잘게 나눈다
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const prevBottom = b.y + r;
      b.x += b.vx * h; b.y += b.vy * h;
      if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); ev.push({ type: 'wall', side: 'left', x: 0, y: b.y }); }
      else if (b.x > g.W - r) { b.x = g.W - r; b.vx = -Math.abs(b.vx); ev.push({ type: 'wall', side: 'right', x: g.W, y: b.y }); }
      if (b.y < r) {
        b.y = r; b.vy = Math.abs(b.vy);
        if (Math.abs(b.x - g.gx) < g.gw / 2 - r * 0.25) { g.score += 1; g.goals++; ev.push({ type: 'goal', x: b.x, y: 0 }); }
        else ev.push({ type: 'top', x: b.x, y: 0 });
      }
      const reach = g.pw / 2 + r * 0.6;
      if (b.vy > 0 && prevBottom <= g.py + 1 && b.y + r >= g.py && Math.abs(b.x - g.px) <= reach) {
        b.y = g.py - r;
        const off = clamp((b.x - g.px) / reach, -1, 1);
        g.score += 1; g.hits++;
        ev.push({ type: 'paddle', x: b.x, y: g.py, off });
        const sp = speedOf(g); // 빠르기는 시간으로만 정해진다 (몇 번 쳤는지와 상관없음)
        const a = clamp(off + clamp(g.pv / 3000, -0.25, 0.25), -1.1, 1.1); // 막대 끝으로 받을수록 비스듬히 (최대 약 63°)
        b.vx = Math.sin(a) * sp; b.vy = -Math.cos(a) * sp;
      }
      if (b.y - r > g.H) { g.state = 'over'; ev.push({ type: 'miss', x: b.x, y: g.H }); break; }
    }
    return ev;
  }

  // 기록 순위에 넣기: 점수 높은 순, 같은 점수면 먼저 낸 기록이 위. 넣은 자리(0부터, 순위 밖이면 -1)를 돌려준다
  function addRecord(list, rec, max) {
    const n = max || BOARD_MAX;
    const arr = (Array.isArray(list) ? list : []).filter((r) => r && Number.isFinite(r.s));
    let i = arr.findIndex((r) => rec.s > r.s);
    if (i < 0) i = arr.length;
    arr.splice(i, 0, rec);
    return { list: arr.slice(0, n), rank: i < n ? i : -1 };
  }
  // 버틴 시간 글자: 45초, 1분 12초, 2분
  function fmtSec(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    if (s < 60) return s + '초';
    return Math.floor(s / 60) + '분' + (s % 60 ? ' ' + (s % 60) + '초' : '');
  }

  const lib = { BALL_KEY, BEST_KEY, BOARD_KEY, BOARD_MAX, SPEED_PER_SEC, FAST_CUE, speedOf, addRecord, fmtSec, cropLimits, clampCrop, initialCrop, cropFromFace, zoomToD, dToZoom, createGame, layoutGame, serve, launch, movePaddle, step };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  /* ================= 화면 ================= */
  const App = root.App;
  if (!App) return;
  const { ic, toast } = App;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } };
  const q = (s) => el.querySelector(s);

  let el = null; // 게임 창 (처음 열 때 만든다)
  let g = null;
  let raf = 0, last = 0, dpr = 1;
  let tx = null; // 손가락(또는 화살표 키)이 가리키는 막대 자리
  const keys = { l: 0, r: 0 };
  let face = null; // 고른 얼굴 사진 (Image). 없으면 기본 공
  let sprite = null, spriteKey = '';
  let col = {};
  const fx = { floats: [], flashes: [], squash: null, net: 0, fast: 0, angle: 0 };
  function readBoard() {
    try { const a = JSON.parse(lsGet(BOARD_KEY) || '[]'); return Array.isArray(a) ? a.filter((r) => r && Number.isFinite(r.s)).slice(0, BOARD_MAX) : []; } catch (e) { return []; }
  }
  let board = readBoard();
  let best = Math.max(Number(lsGet(BEST_KEY)) || 0, board.length ? board[0].s : 0);
  let lastRank = -1;
  let crop = null; // 자르는 중인 사진 { src, w, h, c, touched }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
    col = { surface: v('--surface', '#fff'), bg: v('--bg', '#f5f5f5'), text: v('--text', '#0a0a0a'), muted: v('--muted', '#737373'), line: v('--line', '#e5e5e5'),
      ink: v('--ink', '#0a0a0a'), accent: v('--accent', '#04becd'), accentSoft: v('--accent-soft', '#e0f7f9'), accentText: v('--accent-text', '#058a96') };
    sprite = null;
  }

  function build() {
    el = document.createElement('div');
    el.className = 'bounce';
    el.id = 'bounce';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', '벽 튕기기');
    el.innerHTML = `
      <div class="bounce-bar">
        <div class="bounce-scores"><b id="bounce-score">0</b><span>점</span><span class="bounce-best">최고 <b id="bounce-best">0</b></span><span class="bounce-speed" id="bounce-speed" title="공 빠르기">×1.0</span></div>
        <button class="btn sm" type="button" id="bounce-photo">얼굴 사진</button>
        <button class="bounce-x" type="button" id="bounce-close" aria-label="게임 닫기">${ic('x')}</button>
      </div>
      <div class="bounce-stage" id="bounce-stage">
        <canvas id="bounce-canvas" role="img" aria-label="벽 튕기기 게임 화면"></canvas>
        <div class="bounce-card" id="bounce-card" hidden></div>
      </div>
      <input type="file" id="bounce-file" accept="image/*" hidden>
      <div class="bounce-crop" id="bounce-crop" hidden>
        <div class="crop-box">
          <h3>얼굴을 동그라미에 맞춰요</h3>
          <p class="muted small">사진을 끌어 옮기고, 두 손가락으로 벌리거나 아래 막대로 크기를 바꿔요.</p>
          <canvas class="crop-canvas" id="crop-canvas" aria-label="사진 자르기"></canvas>
          <label class="crop-zoom"><span class="muted small">작게</span><input type="range" id="crop-zoom" min="0" max="100" step="0.5" aria-label="얼굴 크기"><span class="muted small">크게</span></label>
          <div class="crop-actions"><button class="btn" type="button" id="crop-cancel">취소</button><button class="btn primary" type="button" id="crop-ok">이 얼굴로 하기</button></div>
          <p class="muted small crop-note">고른 사진은 이 기기에만 저장돼요. 계정 동기화나 백업에는 들어가지 않아요.</p>
        </div>
      </div>`;
    document.body.appendChild(el);

    q('#bounce-close').addEventListener('click', close);
    q('#bounce-photo').addEventListener('click', pickPhoto);
    q('#bounce-card').addEventListener('click', (e) => {
      const b = e.target.closest('[data-b]');
      if (!b) return;
      const act = b.dataset.b;
      if (act === 'start' || act === 'again') play();
      else if (act === 'resume') { card(null); g.state = 'play'; last = 0; }
      else if (act === 'photo') pickPhoto();
      else if (act === 'plain') { lsDel(BALL_KEY); face = null; sprite = null; card(g.state === 'over' ? 'over' : 'ready'); toast('기본 공으로 바꿨어요'); }
    });
    q('#bounce-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) openPhoto(f); });

    // 막대: 화면 아무 데나 대고 좌우로 끌기
    const cv = q('#bounce-canvas');
    const aim = (e) => { const rc = cv.getBoundingClientRect(); tx = e.clientX - rc.left; };
    cv.addEventListener('pointerdown', (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      aim(e);
      if (g.state === 'ready' && q('#bounce-card').hidden) launch(g);
    });
    cv.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons || e.pressure > 0) aim(e); });

    // 사진 자르기: 끌어 옮기기, 두 손가락 벌리기, 마우스 휠, 크기 막대
    const cc = q('#crop-canvas');
    const pts = new Map();
    let pinch = null;
    cc.addEventListener('pointerdown', (e) => {
      if (!crop) return;
      try { cc.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      crop.touched = true; pinch = null;
    });
    cc.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p || !crop) return;
      const sc = cropScale();
      if (pts.size === 1) { crop.c.cx -= (e.clientX - p.x) / sc; crop.c.cy -= (e.clientY - p.y) / sc; }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch) {
          crop.c.cx -= (mid.x - pinch.mid.x) / sc; crop.c.cy -= (mid.y - pinch.mid.y) / sc;
          crop.c.d *= pinch.dist / Math.max(1, dist);
        }
        pinch = { dist, mid };
      }
      cropChanged();
    });
    const lift = (e) => { pts.delete(e.pointerId); pinch = null; };
    cc.addEventListener('pointerup', lift);
    cc.addEventListener('pointercancel', lift);
    cc.addEventListener('wheel', (e) => {
      if (!crop) return;
      e.preventDefault();
      crop.touched = true;
      crop.c.d *= Math.exp(e.deltaY * 0.0015);
      cropChanged();
    }, { passive: false });
    q('#crop-zoom').addEventListener('input', (e) => {
      if (!crop) return;
      crop.touched = true;
      crop.c.d = zoomToD(Number(e.target.value), crop.w, crop.h);
      crop.c = clampCrop(crop.c, crop.w, crop.h);
      drawCrop();
    });
    q('#crop-cancel').addEventListener('click', () => { hideCrop(); card(g.state === 'over' ? 'over' : 'ready'); });
    q('#crop-ok').addEventListener('click', useCrop);

    if (root.ResizeObserver) new root.ResizeObserver(() => { if (!el.hidden) { resize(); if (crop) drawCrop(); } }).observe(q('#bounce-stage'));
    else root.addEventListener('resize', () => { if (!el.hidden) { resize(); if (crop) drawCrop(); } });
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keys.l = 0; if (e.key === 'ArrowRight') keys.r = 0; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && isOpen() && g.state === 'play') pause(); });
    root.addEventListener('blur', () => { if (isOpen() && g.state === 'play') pause(); });
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (isOpen()) readColors(); }); } catch (e) { /* 무시 */ }
    loadFace();
    try { document.fonts.ready.then(() => { sprite = null; if (isOpen() && !q('#bounce-card').hidden) refreshCard(); }); } catch (e) { /* 무시 */ }
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); back(); return; }
    if (crop) return;
    if (e.key === 'ArrowLeft') { keys.l = 1; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { keys.r = 1; e.preventDefault(); }
    else if ((e.key === ' ' || e.key === 'Enter') && g.state === 'ready' && q('#bounce-card').hidden) { e.preventDefault(); launch(g); }
  }

  /* ---------- 공 그림 ---------- */
  function loadFace() {
    const url = lsGet(BALL_KEY);
    if (!url || !/^data:image\//.test(url)) return;
    setFace(url);
  }
  function setFace(url) {
    const img = new Image();
    img.onload = () => { face = img; sprite = null; if (isOpen() && !q('#bounce-card').hidden) refreshCard(); };
    img.onerror = () => { face = null; };
    img.src = url;
  }
  // 기본 공: 빨강·흰 세로 줄무늬에 남색 테두리, 가운데 'K7' (아틀레티코 유니폼 색 느낌만, 구단 문장은 넣지 않는다)
  const STRIPE_RED = '#cb3524', STRIPE_NAVY = '#272e61', BALL_TEXT = 'K7';
  function stripedBall(x, R) {
    const n = 7, w = (2 * R) / n; // 가운데 줄이 빨강, 양끝은 흰색
    for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? STRIPE_RED : '#ffffff'; x.fillRect(-R + i * w - 0.3, -R, w + 0.6, 2 * R); }
    const gr = x.createRadialGradient(0, 0, R * 0.25, 0, 0, R); // 가장자리를 살짝 어둡게 해서 둥글게
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
    x.fillStyle = gr; x.fillRect(-R, -R, 2 * R, 2 * R);
    // 가운데 글자 'K7' (사용자 요청): 남색 글자에 흰 테를 둘러 줄무늬 위에서도 잘 보이게
    x.font = `900 ${Math.round(R * 0.8)}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    x.lineWidth = Math.max(2, R * 0.16); x.strokeStyle = '#ffffff';
    x.strokeText(BALL_TEXT, 0, R * 0.05);
    x.fillStyle = STRIPE_NAVY; x.fillText(BALL_TEXT, 0, R * 0.05);
  }
  function paintBall(x, R, img) {
    x.save();
    x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.closePath(); x.clip();
    if (img) { x.fillStyle = '#ffffff'; x.fillRect(-R, -R, 2 * R, 2 * R); x.drawImage(img, -R, -R, 2 * R, 2 * R); }
    else stripedBall(x, R);
    x.restore();
    const lw = img ? 1.8 : Math.max(2, R * 0.09);
    x.beginPath(); x.arc(0, 0, R - lw / 2, 0, Math.PI * 2);
    x.lineWidth = lw; x.strokeStyle = img ? col.ink : STRIPE_NAVY; x.stroke();
  }
  function getSprite() {
    const key = (face ? face.src.length : 0) + ':' + g.r + ':' + dpr + ':' + col.ink;
    if (sprite && spriteKey === key) return sprite;
    const R = g.r, m = 2, size = Math.ceil((2 * R + 2 * m) * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    x.scale(dpr, dpr); x.translate(R + m, R + m);
    paintBall(x, R, face);
    sprite = c; spriteKey = key;
    return c;
  }

  /* ---------- 가운데 안내 카드 (시작 / 끝 / 멈춤) ---------- */
  let cardKind = null, lastScore = 0, newBest = false;
  function card(kind) {
    cardKind = kind;
    const c = q('#bounce-card');
    c.className = 'bounce-card' + (kind ? ' ' + kind : '');
    if (!kind) { c.hidden = true; c.innerHTML = ''; return; }
    c.hidden = false;
    refreshCard();
    const first = c.querySelector('.btn.primary');
    if (first) try { first.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }
  function refreshCard() {
    const c = q('#bounce-card');
    const photo = face
      ? '<button class="btn" type="button" data-b="photo">사진 바꾸기</button><button class="btn link" type="button" data-b="plain">기본 공으로</button>'
      : '<button class="btn" type="button" data-b="photo">얼굴 사진 고르기</button>';
    const prev = '<canvas class="bounce-prev" aria-hidden="true"></canvas>';
    if (cardKind === 'ready') {
      c.innerHTML = `${prev}<h3>벽 튕기기</h3><p class="muted small">화면을 좌우로 끌어 막대를 움직여요. 공을 치면 1점, 위쪽 골대에 넣으면 1점 더! 시간이 갈수록 공이 점점 빨라지고, 놓치면 끝나요.</p>` +
        `<div class="bounce-acts"><button class="btn primary" type="button" data-b="start">시작하기</button>${photo}</div>` +
        (face ? '' : '<p class="muted small bounce-note">사진을 고르면 얼굴만 동그랗게 잘라 공으로 써요. 사진은 이 기기에만 저장돼요.</p>');
    } else if (cardKind === 'over') {
      c.innerHTML = `${prev}<h3>${lastScore}점</h3><p class="muted small">${newBest && lastScore > 0 ? '새 최고 기록이에요!' : '최고 기록 ' + best + '점'} · 골 ${g.goals}번 · ${fmtSec(g.t)}</p>` +
        boardHTML() +
        `<div class="bounce-acts"><button class="btn primary" type="button" data-b="again">다시 하기</button>${photo}</div>`;
    } else if (cardKind === 'pause') {
      c.innerHTML = `${prev}<h3>잠깐 멈췄어요</h3><p class="muted small">지금 ${g.score}점이에요.</p>` +
        '<div class="bounce-acts"><button class="btn primary" type="button" data-b="resume">이어 하기</button><button class="btn" type="button" data-b="again">처음부터</button></div>';
    }
    const me = c.querySelector('.bounce-board li.me');
    if (me) { const ol = me.parentNode; ol.scrollTop = Math.max(0, me.offsetTop - ol.clientHeight / 2); }
    const pc = c.querySelector('.bounce-prev');
    if (pc && g) {
      const S = 64;
      pc.width = pc.height = S * dpr;
      const x = pc.getContext('2d');
      x.scale(dpr, dpr); x.translate(S / 2, S / 2);
      paintBall(x, S / 2 - 2, face);
    }
  }

  // 기록 순위 (이 기기에만 저장)
  const two = (n) => String(n).padStart(2, '0');
  const when = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`; };
  function boardHTML() {
    if (!board.length) return '';
    const rows = board.map((r, i) => `<li${i === lastRank ? ' class="me"' : ''}><span class="bb-rk">${i + 1}</span><b>${r.s}점</b>` +
      `<span class="bb-sub">골 ${r.g || 0} · ${fmtSec(r.sec)}</span><span class="bb-when">${i === lastRank ? '방금' : when(r.t)}</span></li>`).join('');
    const outside = lastRank < 0 && lastScore > 0 ? `<p class="muted small bb-out">이번 ${lastScore}점은 10위 밖이에요.</p>` : '';
    return `<div class="bounce-board"><h4>기록 순위 <span class="muted">이 기기</span></h4><ol>${rows}</ol>${outside}</div>`;
  }

  /* ---------- 진행 ---------- */
  function play() {
    card(null);
    serve(g);
    tx = g.px;
    scoreUI();
    launch(g);
    last = 0;
  }
  function pause() {
    if (g.state !== 'play') return;
    g.state = 'pause';
    card('pause');
  }
  function over() {
    lastScore = g.score;
    newBest = g.score > best;
    if (newBest) { best = g.score; lsSet(BEST_KEY, String(best)); }
    lastRank = -1;
    if (g.score > 0) { // 0점 판은 순위에 넣지 않는다
      const r = addRecord(board, { s: g.score, g: g.goals, sec: Math.round(g.t), t: Date.now() });
      board = r.list; lastRank = r.rank;
      lsSet(BOARD_KEY, JSON.stringify(board));
    }
    scoreUI();
    buzz(60);
    setTimeout(() => { if (isOpen() && g.state === 'over') card('over'); }, 450);
  }
  function scoreUI() {
    q('#bounce-score').textContent = g.score;
    speedUI();
    q('#bounce-best').textContent = Math.max(best, g.score);
  }
  function speedUI() {
    const t = '×' + (speedOf(g) / g.base).toFixed(1);
    const s = q('#bounce-speed');
    if (s.textContent !== t) s.textContent = t;
  }
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* 무시 */ } };
  function float(text, x, y, strong) { fx.floats.push({ text, x, y, t: 0, strong }); }
  function squash(axis) { fx.squash = { axis, t: 0.16 }; }

  function handle(evs) {
    for (const e of evs) {
      if (e.type === 'paddle') { float('+1', e.x, g.py - g.r * 2.4); squash('y'); }
      else if (e.type === 'wall') { fx.flashes.push({ side: e.side, at: e.y, t: 0 }); squash('x'); }
      else if (e.type === 'top') { fx.flashes.push({ side: 'top', at: e.x, t: 0 }); squash('y'); }
      else if (e.type === 'goal') { float('골! +1', clamp(e.x, 50, g.W - 50), g.r * 3.2, true); fx.net = 0.7; squash('y'); buzz(25); }
      else if (e.type === 'faster') { float('빨라져요!', g.W / 2, g.H * 0.45, true); fx.fast = 0.6; }
      else if (e.type === 'miss') over();
    }
    if (evs.length) scoreUI();
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.034, (t - last) / 1000) : 0;
    last = t;
    if (!g) return;
    if (keys.l || keys.r) tx = clamp((tx == null ? g.px : tx) + (keys.r - keys.l) * g.W * 1.3 * dt, g.pw / 2, g.W - g.pw / 2);
    movePaddle(g, tx == null ? g.px : tx, dt);
    if (g.state === 'play') { handle(step(g, dt)); speedUI(); }
    fx.angle += (g.ball.vx / g.r) * dt * 0.35;
    if (fx.squash && (fx.squash.t -= dt) <= 0) fx.squash = null;
    fx.net = Math.max(0, fx.net - dt);
    fx.fast = Math.max(0, fx.fast - dt);
    fx.floats = fx.floats.filter((f) => (f.t += dt) < 0.9);
    fx.flashes = fx.flashes.filter((f) => (f.t += dt) < 0.3);
    draw();
  }

  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t); x.lineTo(l + w - r, t); x.arc(l + w - r, t + r, r, -Math.PI / 2, 0);
    x.lineTo(l + w, t + h - r); x.arc(l + w - r, t + h - r, r, 0, Math.PI / 2);
    x.lineTo(l + r, t + h); x.arc(l + r, t + h - r, r, Math.PI / 2, Math.PI);
    x.lineTo(l, t + r); x.arc(l + r, t + r, r, Math.PI, Math.PI * 1.5);
    x.closePath();
  }

  function draw() {
    const cv = q('#bounce-canvas');
    const x = cv.getContext('2d');
    const { W, H } = g;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = col.surface; x.fillRect(0, 0, W, H);

    // 운동장 선 (골대 앞 상자, 가운데 원)
    x.strokeStyle = col.line; x.lineWidth = 2;
    const bw = Math.min(W - 24, g.gw * 2.1), bh = Math.min(H * 0.16, 130);
    x.strokeRect(W / 2 - bw / 2, -2, bw, bh + 2);
    x.beginPath(); x.arc(W / 2, bh, Math.min(bw * 0.22, 46), 0, Math.PI); x.stroke();
    x.beginPath(); x.moveTo(0, H * 0.6); x.lineTo(W, H * 0.6); x.stroke();
    x.beginPath(); x.arc(W / 2, H * 0.6, Math.min(W, H) * 0.15, 0, Math.PI * 2); x.stroke();

    // 골대 (천장)
    const gd = Math.max(10, g.r * 0.5), gl = g.gx - g.gw / 2;
    x.save();
    x.beginPath(); x.rect(gl, 0, g.gw, gd); x.clip();
    x.fillStyle = col.accentSoft; x.fillRect(gl, 0, g.gw, gd);
    x.strokeStyle = col.accent; x.globalAlpha = 0.6; x.lineWidth = 1;
    const wob = fx.net > 0 ? Math.sin(fx.net * 38) * 4 * fx.net : 0;
    for (let i = -gd; i < g.gw + gd; i += 8) {
      x.beginPath(); x.moveTo(gl + i + wob, 0); x.lineTo(gl + i + gd, gd); x.stroke();
      x.beginPath(); x.moveTo(gl + i + gd + wob, 0); x.lineTo(gl + i, gd); x.stroke();
    }
    x.restore();
    x.fillStyle = col.ink;
    x.fillRect(gl - 3, 0, 6, gd + 6); x.fillRect(gl + g.gw - 3, 0, 6, gd + 6);

    // 벽 (양옆·천장). 아래는 열려 있다
    x.fillStyle = col.ink;
    x.fillRect(0, 0, 3, H); x.fillRect(W - 3, 0, 3, H);
    x.fillRect(0, 0, gl - 3, 3); x.fillRect(gl + g.gw + 3, 0, W - gl - g.gw - 3, 3);
    for (const f of fx.flashes) {
      x.globalAlpha = 1 - f.t / 0.3; x.fillStyle = col.accent;
      if (f.side === 'left') x.fillRect(0, f.at - 34, 5, 68);
      else if (f.side === 'right') x.fillRect(W - 5, f.at - 34, 5, 68);
      else x.fillRect(f.at - 34, 0, 68, 5);
    }
    x.globalAlpha = 1;

    // 빨라질 때 양옆 벽이 잠깐 포인트 색으로
    if (fx.fast > 0) {
      x.globalAlpha = Math.min(1, fx.fast / 0.3); x.fillStyle = col.accent;
      x.fillRect(0, 0, 5, H); x.fillRect(W - 5, 0, 5, H);
      x.globalAlpha = 1;
    }

    // 막대
    x.fillStyle = col.ink;
    roundRect(x, g.px - g.pw / 2, g.py, g.pw, g.ph, g.ph / 2); x.fill();

    // 공 (그림자 → 공)
    const b = g.ball;
    x.globalAlpha = 0.12; x.fillStyle = '#000';
    x.beginPath(); x.ellipse(b.x + 3, b.y + g.r * 0.95, g.r * 0.8, g.r * 0.22, 0, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1;
    x.save();
    x.translate(b.x, b.y);
    if (fx.squash) {
      const k = fx.squash.t / 0.16, a = 1 - 0.16 * k, c = 1 + 0.1 * k;
      if (fx.squash.axis === 'x') x.scale(a, c); else x.scale(c, a);
    }
    x.rotate(fx.angle);
    const s = getSprite(), half = g.r + 2;
    x.drawImage(s, -half, -half, half * 2, half * 2);
    x.restore();

    // 점수 글자
    for (const f of fx.floats) {
      x.globalAlpha = 1 - f.t / 0.9;
      x.fillStyle = f.strong ? col.accentText : col.muted;
      x.font = `800 ${f.strong ? 26 : 17}px "Pretendard Variable", Pretendard, system-ui, sans-serif`;
      x.textAlign = 'center';
      x.fillText(f.text, f.x, f.y - f.t * 30);
    }
    x.globalAlpha = 1;
  }

  function resize() {
    const st = q('#bounce-stage');
    const w = st.clientWidth, h = st.clientHeight;
    if (!w || !h) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    const cv = q('#bounce-canvas');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    if (!g) g = createGame(w, h); else layoutGame(g, w, h);
    if (tx != null) tx = clamp(tx, g.pw / 2, w - g.pw / 2);
    sprite = null;
  }

  /* ---------- 사진 고르기·자르기 ---------- */
  function pickPhoto() {
    if (g && g.state === 'play') pause();
    const inp = q('#bounce-file');
    inp.value = '';
    inp.click();
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }
  // 큰 사진은 줄여서 다룬다 (폰 사진 그대로면 자를 때 느리다)
  function shrink(img, max) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const s = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  async function findFace(src) {
    try {
      if (!root.FaceDetector) return null;
      const found = await new root.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }).detect(src);
      return (found && found[0] && found[0].boundingBox) || null;
    } catch (e) { return null; }
  }
  async function openPhoto(file) {
    if (file.type && !/^image\//.test(file.type)) { toast('사진 파일을 골라 주세요'); return; }
    let img;
    try { img = await loadImage(file); } catch (e) { toast('사진을 열지 못했어요. 다른 사진을 골라 주세요'); return; }
    const src = shrink(img, 1600);
    crop = { src, w: src.width, h: src.height, c: initialCrop(src.width, src.height), touched: false };
    card(null);
    q('#bounce-crop').hidden = false;
    syncZoom(); drawCrop();
    try { q('#crop-ok').focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    const box = await findFace(src);
    if (box && crop && crop.src === src && !crop.touched) { crop.c = cropFromFace(box, crop.w, crop.h); syncZoom(); drawCrop(); }
  }
  const cropSize = () => q('#crop-canvas').clientWidth || 280;
  const cropScale = () => cropSize() * 0.78 / crop.c.d; // 사진 1px이 화면에서 몇 px인지
  function cropChanged() { crop.c = clampCrop(crop.c, crop.w, crop.h); syncZoom(); drawCrop(); }
  function syncZoom() { if (crop) q('#crop-zoom').value = String(dToZoom(crop.c.d, crop.w, crop.h)); }
  function drawCrop() {
    if (!crop) return;
    const cv = q('#crop-canvas'), S = cropSize(), dp = Math.min(2, root.devicePixelRatio || 1);
    if (cv.width !== Math.round(S * dp)) cv.width = cv.height = Math.round(S * dp);
    const x = cv.getContext('2d'), D = S * 0.78, sc = D / crop.c.d;
    x.setTransform(dp, 0, 0, dp, 0, 0);
    x.fillStyle = '#2a2a2a'; x.fillRect(0, 0, S, S);
    x.save();
    x.translate(S / 2, S / 2); x.scale(sc, sc); x.translate(-crop.c.cx, -crop.c.cy);
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, crop.w, crop.h); // 배경이 투명한 사진도 공에서처럼 흰 바탕으로 보이게
    x.drawImage(crop.src, 0, 0);
    x.restore();
    x.fillStyle = 'rgba(0,0,0,.58)';
    x.beginPath(); x.rect(0, 0, S, S); x.arc(S / 2, S / 2, D / 2, 0, Math.PI * 2, true); x.fill();
    x.strokeStyle = '#ffffff'; x.lineWidth = 2;
    x.beginPath(); x.arc(S / 2, S / 2, D / 2, 0, Math.PI * 2); x.stroke();
  }
  function hideCrop() { crop = null; if (el) q('#bounce-crop').hidden = true; }
  function useCrop() {
    if (!crop) return;
    const N = 256, out = document.createElement('canvas');
    out.width = out.height = N;
    const x = out.getContext('2d'), s = N / crop.c.d;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
    x.setTransform(s, 0, 0, s, -(crop.c.cx - crop.c.d / 2) * s, -(crop.c.cy - crop.c.d / 2) * s);
    x.drawImage(crop.src, 0, 0);
    const url = out.toDataURL('image/jpeg', 0.88);
    const saved = lsSet(BALL_KEY, url);
    hideCrop();
    setFace(url);
    if (g.state !== 'ready') serve(g);
    card('ready');
    toast(saved ? '얼굴 공을 만들었어요' : '이 기기에 저장하지 못해서 이번에만 써요');
  }

  /* ---------- 열기·닫기 ---------- */
  const isOpen = () => !!(el && !el.hidden);
  function open() {
    if (!el) build();
    const a = document.activeElement;
    if (a && a.blur && a !== document.body) a.blur(); // 비밀 단어 칸의 키보드를 닫는다
    el.hidden = false;
    document.body.classList.add('bounce-open');
    readColors();
    resize();
    serve(g);
    tx = g.px;
    scoreUI();
    card('ready');
    last = 0;
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function close() {
    if (!isOpen()) return;
    hideCrop();
    el.hidden = true;
    document.body.classList.remove('bounce-open');
    cancelAnimationFrame(raf); raf = 0;
    keys.l = keys.r = 0;
    if (g.state === 'play' || g.state === 'pause') g.state = 'ready';
    const again = document.querySelector('[data-egg-game]');
    if (again) try { again.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
  }
  // 휴대폰 '뒤로'·Esc: 자르기 창 → 게임 순서로 닫는다. 닫은 게 있으면 true
  function back() {
    if (!isOpen()) return false;
    if (crop) { hideCrop(); card(g.state === 'over' ? 'over' : 'ready'); } else close();
    return true;
  }

  root.Bounce = Object.assign({ open, close, back, isOpen, get game() { return g; }, get hasFace() { return !!face; } }, lib);
})(typeof window !== 'undefined' ? window : globalThis);
