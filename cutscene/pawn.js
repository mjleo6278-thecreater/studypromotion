// 개발자 폰 캐릭터: 체스 폰 모양 복셀 몸 + 둥근 네모 머리 + 떠 있는 손 + 바꿔 끼우는 표정
(function (global) {
  'use strict';
  const { Vox, buildMesh, boxesToArray, M4 } = global.Vox3D;

  const C = {
    ivory: 0xf6f1e6, base: 0xd9d1bf, rim: 0xc8bfac,
    teal: 0x04becd, tealDark: 0x0398a5, mitt: 0x22b8c6, mittDark: 0x1597a3,
    eye: 0x1c1f26, shine: 0xffffff, blush: 0xff9aa2, mouth: 0x5b2f33, tongue: 0xff7f8a,
    sweat: 0x8fd8ff,
  };

  function bodyVox() {
    const v = new Vox({ jitter: 0.035 });
    v.disc(0, 6.4, C.rim);
    v.disc(1, 6.4, C.base);
    v.disc(2, 5.5, C.ivory);
    v.disc(3, 4.5, C.ivory);
    v.disc(4, 3.7, C.ivory);
    for (let y = 5; y <= 7; y++) v.disc(y, 3.2, C.ivory);
    v.disc(8, 3.7, C.ivory);
    v.disc(9, 4.8, C.teal);
    v.disc(10, 4.8, (x, y, z) => (Math.abs(x) + Math.abs(z) > 5 ? C.tealDark : C.teal));
    v.disc(11, 3.2, C.ivory);
    return v;
  }

  // 머리: 둥근 네모(초타원체). 가운데 칸이 (0,0,0)
  const HR = { x: 5.4, y: 5.2, p: 4.2 };
  function headVox() {
    const v = new Vox({ jitter: 0 });
    for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) for (let z = -6; z <= 6; z++) {
      const f = Math.pow(Math.abs(x) / HR.x, HR.p) + Math.pow(Math.abs(y) / HR.y, HR.p) + Math.pow(Math.abs(z) / HR.x, HR.p);
      if (f <= 1) v.set(x, y, z, C.ivory);
    }
    return v;
  }

  // 얼굴 그림: [x, y, 색] 목록을 머리 앞면에 얇게 붙인다
  function decal(head, px, depth = 0.24) {
    const boxes = [];
    for (const [x, y, c] of px) {
      const z = head.frontZ(x, y);
      if (z == null) continue;
      boxes.push([x, y, z + 1, x + 1, y + 1, z + 1 + depth, c]);
    }
    return new Float32Array(boxesToArray(boxes));
  }

  const K = C.eye, W = C.shine;
  const eye2x3 = (x0, shine) => {
    const px = [];
    for (let y = 0; y <= 1; y++) for (let x = x0; x <= x0 + 1; x++) px.push([x, y, K]);
    for (const [sx, sy] of shine) { const p = px.find((q) => q[0] === x0 + sx && q[1] === sy); if (p) p[2] = W; }
    return px;
  };
  const EYES = {
    normal: [...eye2x3(-3, [[0, 1]]), ...eye2x3(2, [[0, 1]])],
    sparkle: [...eye2x3(-3, [[0, 1], [1, 0]]), ...eye2x3(2, [[0, 1], [1, 0]]), [-3, 2, K], [-2, 2, K], [2, 2, K], [3, 2, K]],
    blink: [[-3, 0, K], [-2, 0, K], [2, 0, K], [3, 0, K]],
    happy: [[-4, 0, K], [-3, 1, K], [-2, 0, K], [2, 0, K], [3, 1, K], [4, 0, K]],
    // > < (3줄, 위에 눈썹 자리를 남긴다)
    squeeze: [[-4, 2, K], [-3, 1, K], [-2, 0, K], [-3, -1, K], [-4, -2, K], [4, 2, K], [3, 1, K], [2, 0, K], [3, -1, K], [4, -2, K]],
    worried: [[-3, 0, K], [-2, 0, K], [-3, 1, K], [-2, 1, K], [-2, 2, K], [2, 0, K], [3, 0, K], [2, 1, K], [3, 1, K], [2, 2, K]],
  };
  const M = C.mouth;
  const MOUTHS = {
    closed: [[0, -2, M]],
    smile: [[-1, -2, M], [0, -3, M], [1, -2, M]],
    open: [[-1, -2, M], [0, -2, M], [1, -2, M], [0, -3, C.tongue]],
    o: [[0, -2, M], [0, -3, M]],
    wavy: [[-2, -3, M], [-1, -2, M], [0, -3, M], [1, -2, M], [2, -3, M]],
    flat: [[-1, -2, M], [0, -2, M], [1, -2, M]],
  };
  const BLUSH = [[-5, -1, C.blush], [-4, -1, C.blush], [4, -1, C.blush], [5, -1, C.blush]];

  function handVox() {
    const v = new Vox({ jitter: 0.03 });
    v.box(0, 0, 0, 2, 2, 2, C.mitt);
    v.box(0, 0, 0, 2, 0, 2, C.mittDark);
    return v;
  }

  // 땀방울 (머리 기준, 오른쪽 위)
  function sweatVox() {
    const v = new Vox();
    v.box(-1, 0, 0, 1, 1, 0, C.sweat).set(0, -1, 0, C.sweat).set(0, 2, 0, C.sweat).set(0, 3, 0, C.sweat).set(-1, 1, 0, 0xe6f8ff);
    return v;
  }

  // 메시 한 번 만들기 (렌더러마다)
  function create(R) {
    const head = headVox();
    const P = {
      body: R.mesh(buildMesh(bodyVox(), { ao: 0.8 })),
      head: R.mesh(buildMesh(head, { ao: 0.45 })),
      hand: R.mesh(buildMesh(handVox())),
      point: R.mesh(buildMesh(handVox().box(1, 1, 3, 1, 1, 4, C.mitt))),
      thumb: R.mesh(buildMesh(handVox().box(1, 3, 1, 1, 4, 1, C.mitt))),
      sweat: R.mesh(buildMesh(sweatVox(), { noAO: true })),
      eyes: {}, mouths: {},
      blush: R.mesh(decal(head, BLUSH, 0.12)),
    };
    for (const k in EYES) P.eyes[k] = R.mesh(decal(head, EYES[k]));
    for (const k in MOUTHS) P.mouths[k] = R.mesh(decal(head, MOUTHS[k]));
    return P;
  }

  const HEAD_AT = [0.5, 16.5, 0.5];
  const DEFAULT = {
    pos: [0, 0, 0], rotY: 0, lean: [0, 0], squash: 1,
    head: [0, 0, 0], bob: 0,
    handL: [-7.6, 8.5, 2.5], handR: [8.6, 8.5, 2.5], handRotL: [0, 0, 0], handRotR: [0, 0, 0],
    eyes: 'normal', mouth: 'closed', blush: true, sweat: 0, tint: null, hidden: false,
  };

  // 자세 → 그릴 것 목록. 손 좌표는 몸 복셀 좌표(가운데 0.5, 바닥 0)
  function items(P, pose) {
    const s = Object.assign({}, DEFAULT, pose);
    if (s.hidden) return [];
    const sq = s.squash, wide = 1 + (1 - sq) * 0.6;
    const root = M4.compose(s.pos, [s.lean[0], s.rotY, s.lean[1]], [wide, sq, wide], [0.5, 0, 0.5]);
    const hm = M4.mul(root, M4.compose([HEAD_AT[0], HEAD_AT[1] + s.bob, HEAD_AT[2]], s.head, [1, 1, 1], [0.5, 0.5, 0.5]));
    const tint = s.tint || undefined;
    const out = [
      { mesh: P.body, m: root, tint },
      { mesh: P.head, m: hm, tint },
      { mesh: P.eyes[s.eyes] || P.eyes.normal, m: hm, tint },
      { mesh: P.mouths[s.mouth] || P.mouths.closed, m: hm, tint },
    ];
    if (s.blush) out.push({ mesh: P.blush, m: hm, tint });
    if (s.sweat > 0) {
      const sm = M4.mul(hm, M4.compose([6.4, 3.2 - (1 - s.sweat) * 2, 2.6], [0, 0, 0.3], [0.8 * s.sweat, 0.8 * s.sweat, 0.8], [0.5, 0.5, 0.5]));
      out.push({ mesh: P.sweat, m: sm, shadow: false, emit: 0.35 });
    }
    for (const [hp, hr, pt, th] of [[s.handL, s.handRotL, false, s.thumbL], [s.handR, s.handRotR, s.pointR, false]]) {
      if (!hp) continue;
      out.push({ mesh: pt ? P.point : th ? P.thumb : P.hand, m: M4.mul(root, M4.compose(hp, hr, [1, 1, 1], [1.5, 1.5, 1.5])), tint });
    }
    return out;
  }

  // 세계 좌표 구하기 (말풍선 위치 등)
  function headTop(pose) {
    const s = Object.assign({}, DEFAULT, pose);
    const sq = s.squash, wide = 1 + (1 - sq) * 0.6;
    const root = M4.compose(s.pos, [s.lean[0], s.rotY, s.lean[1]], [wide, sq, wide], [0.5, 0, 0.5]);
    return M4.apply(root, [0.5, HEAD_AT[1] + 6.5 + s.bob, 0.5]);
  }
  function handWorld(pose, which) {
    const s = Object.assign({}, DEFAULT, pose);
    const sq = s.squash, wide = 1 + (1 - sq) * 0.6;
    const root = M4.compose(s.pos, [s.lean[0], s.rotY, s.lean[1]], [wide, sq, wide], [0.5, 0, 0.5]);
    return M4.apply(root, which === 'L' ? s.handL : s.handR);
  }

  global.Pawn = { create, items, headTop, handWorld, C, DEFAULT, EYES, MOUTHS };
})(typeof window !== 'undefined' ? window : globalThis);
