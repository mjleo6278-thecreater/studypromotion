// 개발자 폰 캐릭터: 적은 픽셀(큰 블록)로 만든 체스 폰. 가로 6칸 × 세로 10칸.
// 블록 한 칸 = U(2.2) 세계 단위. 장면이 쓰는 좌표(손 위치·머리 높이)는 예전 단위 그대로 받는다.
(function (global) {
  'use strict';
  const { Vox, buildMesh, boxesToArray, M4 } = global.Vox3D;

  const U = 2.2;
  const C = {
    ivory: 0xf6f1e6, base: 0xd9d1bf, rim: 0xc8bfac,
    teal: 0x04becd, tealDark: 0x0398a5, mitt: 0x22b8c6,
    eye: 0x1c1f26, shine: 0xffffff, blush: 0xff9aa2, mouth: 0x5b2f33, tongue: 0xff7f8a,
    sweat: 0x8fd8ff,
  };

  // 몸: 칸 좌표 x,z는 -3..2 (가운데가 0), y는 0부터
  //  y0 받침 6×6(모서리 깎음) · y1 4×4 · y2~3 목 2×2 · y4 청록 목도리 6×6(모서리 깎음)
  function bodyVox() {
    const v = new Vox({ jitter: 0.03 });
    const corner = (x, z, n) => (x === -n || x === n - 1) && (z === -n || z === n - 1);
    for (let x = -3; x <= 2; x++) for (let z = -3; z <= 2; z++) if (!corner(x, z, 3)) v.set(x, 0, z, C.base);
    v.box(-2, 1, -2, 1, 1, 1, C.ivory);
    v.box(-1, 2, -1, 0, 3, 0, C.ivory);
    // 목도리는 머리만큼 넓게 (머리 밑으로 청록 띠가 보이게)
    for (let x = -3; x <= 2; x++) for (let z = -3; z <= 2; z++) if (!corner(x, z, 3)) v.set(x, 4, z, (x + z + 6) % 3 ? C.teal : C.tealDark);
    return v;
  }
  const BODY_TOP = 5; // 칸

  // 머리: 6×5×6 네모 상자 (모서리를 깎으면 작은 칸에서는 모자처럼 보여서 깎지 않는다). 가운데 = (0, 2.5, 0)
  function headVox() {
    return new Vox({ jitter: 0.02 }).box(-3, 0, -3, 2, 4, 2, C.ivory);
  }
  const HEAD_H = 5, FACE_Z = 3; // 앞면은 z = 3

  // 얼굴: 반 칸(0.5) 격자에 [열, 행, 색]. 열 -6..5, 행은 머리 가운데 기준 (0이 가운데 바로 위)
  function face(px, depth = 0.12) {
    const boxes = [];
    for (const [c, r, col] of px) {
      const x = c * 0.5, y = HEAD_H / 2 + r * 0.5;
      boxes.push([x, y, FACE_Z, x + 0.5, y + 0.5, FACE_Z + depth, col]);
    }
    return new Float32Array(boxesToArray(boxes));
  }
  const K = C.eye, W = C.shine;
  const sq = (c, r, col = K) => [[c, r, col], [c + 1, r, col], [c, r + 1, col], [c + 1, r + 1, col]];
  const EYES = {
    normal: [...sq(-4, 0), ...sq(2, 0)],
    sparkle: [...sq(-4, 0), ...sq(2, 0)].map(([c, r, col]) => [c, r, (c === -4 || c === 2) && r === 1 ? W : col]),
    blink: [[-4, 0, K], [-3, 0, K], [2, 0, K], [3, 0, K]],
    happy: [[-4, 1, K], [-3, 1, K], [2, 1, K], [3, 1, K]],
    squeeze: [[-4, 1, K], [-3, 0, K], [3, 1, K], [2, 0, K]], // 바깥이 높고 안쪽이 낮은 \ /
    worried: [[-4, 0, K], [3, 0, K]], // 멍: 콩알
  };
  const M = C.mouth;
  const MOUTHS = {
    closed: [[-1, -2, M], [0, -2, M]],
    smile: [[-2, -1, M], [-1, -2, M], [0, -2, M], [1, -1, M]],
    open: [[-1, -2, M], [0, -2, M], [-1, -3, C.tongue], [0, -3, C.tongue]],
    o: [...sq(-1, -3, M)],
    wavy: [[-2, -2, M], [-1, -3, M], [0, -2, M], [1, -3, M]],
    flat: [[-2, -2, M], [-1, -2, M], [0, -2, M], [1, -2, M]],
  };
  const BLUSH = [[-6, -1, C.blush], [-5, -1, C.blush], [4, -1, C.blush], [5, -1, C.blush]];

  // 손: 한 칸짜리 청록 블록. 가리키기·엄지는 작은 막대 하나
  function handMesh(extra) {
    const boxes = [[0, 0, 0, 1, 1, 1, C.mitt]];
    if (extra === 'point') boxes.push([0.3, 0.3, 1, 0.7, 0.7, 1.6, C.mitt]);
    if (extra === 'thumb') boxes.push([0.3, 1, 0.3, 0.7, 1.5, 0.7, C.mitt]);
    return new Float32Array(boxesToArray(boxes));
  }
  const FINGER = (0.5 + 0.6) * U; // 손 가운데에서 손가락 끝까지 (세계 단위)

  // 땀방울: 반 칸 두 개
  function sweatMesh() {
    return new Float32Array(boxesToArray([[0, 0, 0, 0.5, 0.5, 0.4, C.sweat], [0, 0.5, 0, 0.5, 0.9, 0.4, 0xd6f3ff]]));
  }

  function create(R) {
    const P = {
      body: R.mesh(buildMesh(bodyVox(), { ao: 0.9 })),
      head: R.mesh(buildMesh(headVox(), { ao: 0.7 })),
      hand: R.mesh(handMesh()),
      point: R.mesh(handMesh('point')),
      thumb: R.mesh(handMesh('thumb')),
      sweat: R.mesh(sweatMesh()),
      eyes: {}, mouths: {},
      blush: R.mesh(face(BLUSH, 0.06)),
    };
    for (const k in EYES) P.eyes[k] = R.mesh(face(EYES[k]));
    for (const k in MOUTHS) P.mouths[k] = R.mesh(face(MOUTHS[k]));
    return P;
  }

  const AXIS = [0.5, 0, 0.5]; // 예전 단위에서 몸 가운데 축
  const HEAD_AT = [0.5, BODY_TOP * U + (HEAD_H / 2) * U, 0.5]; // = 16.5
  const DEFAULT = {
    pos: [0, 0, 0], rotY: 0, lean: [0, 0], squash: 1,
    head: [0, 0, 0], bob: 0,
    handL: [-7.6, 8.5, 2.5], handR: [8.6, 8.5, 2.5], handRotL: [0, 0, 0], handRotR: [0, 0, 0],
    eyes: 'normal', mouth: 'closed', blush: true, sweat: 0, tint: null, hidden: false,
  };
  function rootOf(s) {
    const sq = s.squash, wide = 1 + (1 - sq) * 0.6;
    return M4.compose(s.pos, [s.lean[0], s.rotY, s.lean[1]], [wide, sq, wide], AXIS);
  }

  // 자세 → 그릴 것 목록. 손 좌표는 예전 몸 단위(가운데 0.5, 바닥 0)
  function items(P, pose) {
    const s = Object.assign({}, DEFAULT, pose);
    if (s.hidden) return [];
    const root = rootOf(s);
    const bm = M4.mul(root, M4.compose(AXIS, [0, 0, 0], [U, U, U], [0, 0, 0]));
    const hm = M4.mul(root, M4.compose([HEAD_AT[0], HEAD_AT[1] + s.bob, HEAD_AT[2]], s.head, [U, U, U], [0, HEAD_H / 2, 0]));
    const tint = s.tint || undefined;
    const out = [
      { mesh: P.body, m: bm, tint },
      { mesh: P.head, m: hm, tint },
      { mesh: P.eyes[s.eyes] || P.eyes.normal, m: hm, tint },
      { mesh: P.mouths[s.mouth] || P.mouths.closed, m: hm, tint },
    ];
    if (s.blush) out.push({ mesh: P.blush, m: hm, tint });
    if (s.sweat > 0) {
      const k = s.sweat;
      const sm = M4.mul(hm, M4.compose([3.05, 3.4 - (1 - k) * 0.8, 1.6], [0, 0, 0], [k, k, 1], [0.25, 0.45, 0.2]));
      out.push({ mesh: P.sweat, m: sm, shadow: false, emit: 0.35 });
    }
    for (const [hp, hr, pt, th] of [[s.handL, s.handRotL, false, s.thumbL], [s.handR, s.handRotR, s.pointR, false]]) {
      if (!hp) continue;
      out.push({ mesh: pt ? P.point : th ? P.thumb : P.hand, m: M4.mul(root, M4.compose(hp, hr, [U, U, U], [0.5, 0.5, 0.5])), tint });
    }
    return out;
  }

  // 세계 좌표 구하기 (말풍선 위치 등)
  function headTop(pose) {
    const s = Object.assign({}, DEFAULT, pose);
    return M4.apply(rootOf(s), [0.5, HEAD_AT[1] + 6.5 + s.bob, 0.5]);
  }
  function handWorld(pose, which) {
    const s = Object.assign({}, DEFAULT, pose);
    return M4.apply(rootOf(s), which === 'L' ? s.handL : s.handR);
  }

  global.Pawn = { create, items, headTop, handWorld, C, DEFAULT, EYES, MOUTHS, FINGER, U };
})(typeof window !== 'undefined' ? window : globalThis);
