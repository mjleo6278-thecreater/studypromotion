// 캐릭터 소개 화면: 체스판 위에서 도는 개발자 폰 + 표정 고르기
(function () {
  'use strict';
  const { M4, E, buildMesh } = Vox3D;
  const EXPR = [
    { id: 'normal', label: '기본', eyes: 'normal', mouth: 'smile' },
    { id: 'happy', label: '신남', eyes: 'happy', mouth: 'open' },
    { id: 'squeeze', label: '답답', eyes: 'squeeze', mouth: 'wavy', sweat: 1 },
    { id: 'idea', label: '번뜩', eyes: 'sparkle', mouth: 'o' },
  ];
  const INK = '#1c1f26', TEAL = '#04becd', TEAL_TEXT = '#058a96', PAPER = '#fffdf8';

  const scene = {
    duration: 0,
    expr: 0, exprAt: -10, drag: null, angle: null,
    init(st) {
      const R = st.R;
      this.P = Pawn.create(R);
      this.floor = R.mesh(buildMesh(Sets.chessFloor(3, 16)));
    },
    pose(t) {
      const ex = EXPR[this.expr];
      const since = t - this.exprAt;
      const blink = ex.id === 'normal' && (t % 3.2) > 3.05;
      const hop = ex.id === 'happy' ? Math.abs(Math.sin(t * 6)) * 2.2 : 0;
      const shake = ex.id === 'squeeze' ? Math.sin(t * 40) * 0.05 * Math.max(0, 1 - since) : 0;
      const pop = since < 0.35 ? 1 - Math.sin(since / 0.35 * Math.PI) * 0.12 : 1;
      const yaw = this.angle != null ? this.angle : t * 0.6;
      const f = Math.sin(t * 2.2) * 0.4;
      return {
        pos: [0, hop, 0], rotY: yaw, lean: [0, shake], squash: pop * (hop > 0 && hop < 0.4 ? 0.9 : 1),
        bob: Math.sin(t * 2.2) * 0.25,
        handL: [-7.6, 8.5 + f + (ex.id === 'happy' ? 5 + Math.sin(t * 12) : 0), 2.5],
        handR: [8.6, 8.5 - f + (ex.id === 'happy' ? 5 - Math.sin(t * 12) : 0), 2.5],
        eyes: blink ? 'blink' : ex.eyes, mouth: ex.mouth, sweat: ex.sweat ? E.clamp(since * 3) : 0,
      };
    },
    frame(t, st) {
      const pose = this.pose(t);
      const items = [{ mesh: this.floor, m: M4.ident() }, ...Pawn.items(this.P, pose)];
      const portrait = st.aspect < 1;
      const cam = fitCam([0.5, 10.5, 0.5], 16, 15, 0.0, 0.42, 0.5, st.aspect, { shiftY: portrait ? -0.1 : 0 });
      this.pose_ = pose;
      return {
        cam, items, bg: [0.86, 0.84, 0.8],
        light: { dir: [-0.55, 1, 0.75], center: [0, 8, 0], radius: 34 },
        lightCol: [0.78, 0.74, 0.66], sky: [0.5, 0.53, 0.6], ground: [0.32, 0.3, 0.28],
        fogCol: [0.86, 0.84, 0.8], fog: [cam.far * 0.5, cam.far * 0.85],
      };
    },
    hud(t, px, frame, st) {
      const W = px.w, H = px.h;
      const portrait = st.aspect < 1;
      // 이름표
      const cardW = Math.min(W - 16, 170), x0 = portrait ? Math.round((W - cardW) / 2) : 10, y0 = 10;
      px.panel(x0, y0, cardW, 58, { fill: PAPER, border: INK, shadow: 'rgba(0,0,0,.35)' });
      px.icon('pawn', x0 + 8, y0 + 9, TEAL, 2);
      px.text('개발자 폰', x0 + 26, y0 + 7, 14, INK);
      px.text('스터디 프로모션을 만드는 사람', x0 + 26, y0 + 25, 10, '#6a6f76', { weight: 700 });
      px.rect(x0 + 8, y0 + 40, cardW - 16, 1, '#e4e2dc');
      px.text('특기', x0 + 8, y0 + 43, 10, TEAL_TEXT);
      px.text('한 칸씩 전진', x0 + 32, y0 + 43, 10, INK, { weight: 700 });
      // 표정 단추
      const bw = 38, gap = 4, n = EXPR.length;
      const total = n * bw + (n - 1) * gap;
      const bx = Math.round((W - total) / 2), by = H - 30;
      this.buttons = [];
      EXPR.forEach((ex, i) => {
        const x = bx + i * (bw + gap), on = i === this.expr;
        px.panel(x, by, bw, 20, { fill: on ? TEAL : PAPER, border: INK, shadow: 'rgba(0,0,0,.35)' });
        px.text(ex.label, x + bw / 2, by + 4, 10, on ? '#ffffff' : INK, { align: 'center' });
        this.buttons.push({ x, y: by, w: bw, h: 20, i, label: ex.label });
      });
      px.text('표정', W / 2, by - 14, 10, '#9aa0a8', { align: 'center', weight: 700 });
      syncHits(this.buttons, px, (b) => { this.expr = b.i; this.exprAt = st.t; });
    },
  };

  // 픽셀 단추 위에 투명한 진짜 단추를 얹는다 (누르기·읽기 프로그램용)
  function syncHits(buttons, px, onTap) {
    const box = document.getElementById('hits');
    while (box.children.length < buttons.length) {
      const b = document.createElement('button'); b.className = 'hit'; box.appendChild(b);
    }
    buttons.forEach((bt, i) => {
      const el = box.children[i];
      const pad = 4;
      Object.assign(el.style, { left: bt.x * px.px - pad + 'px', top: bt.y * px.px - pad + 'px', width: bt.w * px.px + pad * 2 + 'px', height: bt.h * px.px + pad * 2 + 'px' });
      el.setAttribute('aria-label', '표정: ' + bt.label);
      el.onclick = () => onTap(bt);
    });
  }

  const st = new Stage({ gl: document.getElementById('gl'), hud: document.getElementById('hud'), scene });
  // 끌어서 돌리기
  const glc = document.getElementById('gl');
  glc.addEventListener('pointerdown', (e) => { scene.drag = { x: e.clientX, a: scene.angle != null ? scene.angle : st.t * 0.6 }; glc.setPointerCapture(e.pointerId); });
  glc.addEventListener('pointermove', (e) => { if (scene.drag) scene.angle = scene.drag.a + (e.clientX - scene.drag.x) * 0.012; });
  glc.addEventListener('pointerup', () => { scene.drag = null; });
  window.Sheet = {
    st, scene,
    renderAt(t, o = {}) { if (o.angle != null) scene.angle = o.angle; if (o.expr != null) { scene.expr = o.expr; scene.exprAt = o.exprAt != null ? o.exprAt : t - 2; } return st.renderAt(t); },
    stats: () => st.R.stats,
  };
  const go = () => { if (!/[?&]still/.test(location.search)) st.play(0); else st.renderAt(0); };
  (document.fonts && document.fonts.load ? Promise.all([document.fonts.load('800 14px "Pretendard Variable"', '개발자 폰'), document.fonts.ready]) : Promise.resolve()).then(go, go);
})();
