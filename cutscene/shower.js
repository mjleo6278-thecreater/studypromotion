// 컷씬 #1 "샤워하다 생긴 기능": 샤워 중 단어를 외우고 싶은데 거품 묻은 손으론 화면이 안 눌림 → 말로 외우는 단어장
// 모든 그림은 시간 t의 함수다 (renderAt(t)가 늘 같은 그림을 낸다).
(function (global) {
  'use strict';
  const { M4, E, buildMesh, boxesToArray, Vox } = global.Vox3D;
  const { seg, clamp, lerp, lerp3, inOut, rand } = E;
  const easeOut = E.out, back = E.back;

  const INK = '#1c1f26', PAPER = '#fffdf8', TEAL = '#04becd', TEAL_TEXT = '#058a96', CORAL = '#e8505b', MUTED = '#4f545b';
  const DUR = 32;
  const SHOT = { title: 0, A: 3.0, B: 8.0, C: 12.6, D: 17.2, E: 19.0, F: 22.2, END: 27.8 };
  const SUBS = [
    { t0: 3.3, t1: 7.8, text: '샤워할 때도\n[단어]를 외우고 싶었어요' },
    { t0: 8.3, t1: 12.4, text: '그런데 손에\n[바디워시] 거품이 가득!' },
    { t0: 12.9, t1: 17.0, text: '거품 묻은 손으론\n화면이 {안 눌려요}' },
    { t0: 19.4, t1: 22.1, text: '…그럼,\n[말로] 하면 되잖아?' },
    { t0: 22.6, t1: 27.6, text: '뜻을 [말하면]\n알아서 채점하고 넘겨요' },
  ];
  const CPS = 15; // 자막 글자/초

  // 자리
  const SHOWER = [-0.5, 41.5, -6.5];
  const POS_A = [-0.5, 0, -6.5];
  const POS_B = [3.5, 0, -8];
  const POS_C = [7, 0, -6.5];
  const BOTTLE_AT = [9.5, 9, -13.6];
  const PHONE_AT = [18.5, 9, -14.4], PHONE_R = [-0.14, -0.2, 0];
  const DUCK_AT = [-15, 1, 16];

  const TAPS = [ // 손가락 누르기: 시각, 화면 좌표(u,v), 미끄러짐
    { t: 13.5, u: 0.5, v: 0.8 },
    { t: 14.4, u: 0.4, v: 0.76 },
    { t: 15.3, u: 0.6, v: 0.58, slide: 0.32 },
  ];
  const CARDS = [
    { word: 'la ducha', mean: '샤워' },
    { word: 'el jabón', mean: '비누' },
    { word: 'la toalla', mean: '수건' },
  ];
  const SAYS = [ // 말하기: 말풍선 시각, 글, 음절 시각
    { t0: 22.75, t1: 24.0, text: '샤워!', syl: [22.8, 23.0] },
    { t0: 24.85, t1: 26.0, text: '비누!', syl: [24.9, 25.1] },
  ];
  const CORRECT = [23.4, 25.5];
  const FLIPS = [24.1, 26.1];
  const HUM = [[3.4, 72], [3.75, 74], [4.1, 76], [4.45, 72], [5.2, 76], [5.55, 77], [5.9, 79], [6.6, 81], [6.95, 79], [7.3, 76]];

  const faceTo = (a, b) => Math.atan2(b[0] - a[0], b[2] - a[2]);
  const frac = (x) => x - Math.floor(x);

  // ---------- 폰 ----------
  function phoneMatrix(t) {
    let shake = 0;
    for (const tp of TAPS) { const k = t - tp.t; if (k > 0 && k < 0.3) shake += Math.sin(k * 60) * 0.035 * (1 - k / 0.3); }
    return M4.compose(PHONE_AT, [PHONE_R[0], PHONE_R[1] + shake, PHONE_R[2]], [1, 1, 1], [4, 0, 0.5]);
  }
  // 화면 위 점(u: 왼→오, v: 위→아래) → 세계 좌표. off = 화면 밖으로 띄우기
  function screenPoint(t, u, v, off = 0.05) {
    return M4.apply(phoneMatrix(t), [0.8 + 6.4 * u, 13 - 12 * v, 1 + off]);
  }
  function screenState(t) {
    const smudges = [];
    for (const tp of TAPS) {
      if (t < tp.t) continue;
      if (tp.slide) {
        const k = clamp((t - tp.t) / 0.5);
        const n = Math.round(1 + k * 6);
        for (let i = 0; i < n; i++) smudges.push([tp.u + Math.sin(i * 2.1) * 0.02, tp.v + (tp.slide * i) / 6, 0.07 + 0.02 * rand(i + 40)]);
      } else smudges.push([tp.u, tp.v, 0.1]);
    }
    let card = 0, mode = 'idle', flip = 0;
    if (t >= SHOT.F + 0.2) mode = 'listen';
    for (let i = 0; i < CORRECT.length; i++) if (t >= CORRECT[i] && t < FLIPS[i]) mode = 'correct';
    for (let i = 0; i < FLIPS.length; i++) {
      if (t >= FLIPS[i]) card = i + 1;
      const k = (t - FLIPS[i]) / 0.3;
      if (k >= 0 && k < 1) { flip = k; card = k < 0.5 ? i : i + 1; mode = k < 0.5 ? 'correct' : 'idle'; }
    }
    // 거품 자국: 번뜩 뒤 물에 씻겨 2초 동안 사라진다 (정답 글자를 가리지 않게)
    const fade = 1 - clamp((t - 19.3) / 2);
    return { card, mode, flip, smudges: fade > 0 ? smudges : [], fade, voice: t >= SHOT.F, t };
  }

  // ---------- 캐릭터 움직임 ----------
  function hop(t, t0, dur, from, to, h) {
    const k = clamp((t - t0) / dur);
    const p = lerp3(from, to, inOut(k));
    p[1] += Math.sin(k * Math.PI) * h;
    return { p, k };
  }
  // 세계 좌표 → 몸 좌표 (손을 세계의 한 점에 두고 싶을 때)
  function toLocal(pose, w) {
    const dx = w[0] - pose.pos[0], dy = w[1] - pose.pos[1], dz = w[2] - pose.pos[2];
    const c = Math.cos(pose.rotY), s = Math.sin(pose.rotY);
    return [c * dx - s * dz + 0.5, dy, s * dx + c * dz + 0.5];
  }
  const REST_L = [-7.6, 8.5, 2.5], REST_R = [8.6, 8.5, 2.5];

  function pawnPose(t) {
    const p = { pos: POS_A.slice(), rotY: 0.3, lean: [0, 0], squash: 1, head: [0, 0, 0], bob: 0, eyes: 'normal', mouth: 'smile', sweat: 0, handL: REST_L.slice(), handR: REST_R.slice() };
    const blink = (t % 2.9) > 2.78;
    if (t < SHOT.B) {
      // A: 물 맞으며 흥얼흥얼 (좌우로 흔들)
      const w = Math.sin(t * 2.7);
      p.rotY = 0.35 + w * 0.14; p.lean = [0, w * 0.05]; p.bob = Math.abs(Math.sin(t * 5.4)) * 0.35;
      p.eyes = 'happy'; p.mouth = HUM.some(([n]) => t >= n && t < n + 0.18) ? 'o' : 'smile';
      p.handL = [-7.8, 10 + Math.sin(t * 5.4) * 1.2, 3]; p.handR = [8.8, 10 - Math.sin(t * 5.4) * 1.2, 3];
      p.head = [0, 0, w * 0.08];
    } else if (t < SHOT.C) {
      // B: 옆으로 깡충 → 바디워시 펌프 → 손 비비기
      const h1 = hop(t, 8.0, 0.42, POS_A, lerp3(POS_A, POS_B, 0.5), 3);
      const h2 = hop(t, 8.42, 0.42, lerp3(POS_A, POS_B, 0.5), POS_B, 3);
      p.pos = t < 8.42 ? h1.p : h2.p;
      const land = [8.42, 8.84].map((x) => t - x).find((k) => k > 0 && k < 0.14);
      if (land != null) p.squash = 0.88 + land * 0.85;
      p.rotY = lerp(0.35, 1.15, inOut(seg(t, 8.0, 9.0)));
      p.eyes = blink ? 'blink' : 'normal';
      const pumpTop = [BOTTLE_AT[0] + 0.5, BOTTLE_AT[1] + 15, BOTTLE_AT[2] + 0.5];
      if (t >= 9.0 && t < 10.7) {
        const reach = inOut(seg(t, 9.0, 9.4)) * (1 - inOut(seg(t, 10.35, 10.7)));
        const press = pumpPress(t);
        const target = toLocal(p, [pumpTop[0], pumpTop[1] - press, pumpTop[2]]);
        p.handR = lerp3(REST_R, target, reach);
        p.head = [0.15 * reach, 0.25 * reach, 0];
      }
      if (t >= 10.6) {
        // 손 비비기 (몸 앞에서 동그랗게) → 11.3부터 거품 가득한 손을 들어 보며 당황
        const k = inOut(seg(t, 10.6, 11.0));
        p.rotY = lerp(1.15, 0.3, k);
        const a = t * 17, rub = 1 - inOut(seg(t, 11.2, 11.5));
        const show = inOut(seg(t, 11.2, 11.5));
        const rl = [-2.2 + Math.cos(a) * 1.1 * rub, 10 + Math.sin(a) * 1.1 * rub, 7.5], rr = [3.2 - Math.cos(a) * 1.1 * rub, 10 - Math.sin(a) * 1.1 * rub, 7.5];
        p.handL = lerp3(REST_L, lerp3(rl, [-5.5, 10.8, 8], show), k);
        p.handR = lerp3(REST_R, lerp3(rr, [6.5, 10.8, 8], show), k);
        p.eyes = t > 11.3 ? (blink ? 'blink' : 'normal') : 'happy'; p.mouth = t > 11.3 ? 'o' : 'open';
        p.head = [0.22 * show, 0, 0];
        p.sweat = clamp((t - 11.6) * 4);
        p.bob = Math.abs(Math.sin(t * 8.5)) * 0.4 * rub;
      }
    } else if (t < SHOT.D) {
      // C: 폰 앞으로 깡충 → 눌러 보기 (안 눌림)
      const h = hop(t, 12.6, 0.5, POS_B, POS_C, 3.5);
      p.pos = h.p;
      if (t - 13.1 > 0 && t - 13.1 < 0.14) p.squash = 0.88 + (t - 13.1) * 0.85;
      // 세 번째 실패(미끄러짐) 뒤 놀라서 보는 사람 쪽으로 돈다
      p.rotY = lerp(lerp(0.35, 1.35, inOut(seg(t, 12.6, 13.1))), 0.6, inOut(seg(t, 15.7, 16.1)));
      p.eyes = t > 14.6 ? 'worried' : blink ? 'blink' : 'normal';
      p.mouth = t > 14.6 ? 'wavy' : 'closed';
      const FT = 3.5 * Pawn.HAND_S + 0.2; // 손 가운데에서 손가락 끝까지
      const ready = screenPoint(t, 0.5, 0.7, FT + 3);
      let target = ready, reach = inOut(seg(t, 13.1, 13.4)) * (1 - inOut(seg(t, 16.0, 16.5)));
      for (const tp of TAPS) {
        const k = t - tp.t;
        if (k > -0.14 && k < 0.35 + (tp.slide ? 0.5 : 0)) {
          const inK = clamp((k + 0.14) / 0.14), outK = clamp((k - 0.12 - (tp.slide ? 0.5 : 0)) / 0.23);
          const sv = tp.slide ? clamp((k - 0.05) / 0.5) * tp.slide : 0;
          const hold = screenPoint(t, tp.u, tp.v + sv, FT);
          const near = screenPoint(t, tp.u, tp.v, FT + 2.5);
          target = lerp3(lerp3(near, hold, inOut(inK)), near, inOut(outK));
        }
      }
      p.handR = lerp3(REST_R, toLocal(p, target), reach);
      if (reach > 0.3) {
        // 손가락이 화면을 향하게
        const wx = Math.sin(-PHONE_R[1]), wz = -Math.cos(PHONE_R[1]);
        const c = Math.cos(p.rotY), s = Math.sin(p.rotY);
        p.handRotR = [0, Math.atan2(c * wx - s * wz, s * wx + c * wz), 0];
        p.pointR = true;
      }
      p.head = [0.1, 0, 0];
      p.sweat = clamp((t - 15.7) * 4);
      if (t > 15.6 && t < 16.4) { p.eyes = 'sparkle'; p.mouth = 'o'; } // 놀라서 동그래진 눈
      if (t > 16.2) { p.squash = 1 - 0.06 * inOut(seg(t, 16.2, 16.8)); p.lean = [0.08 * inOut(seg(t, 16.2, 16.8)), 0]; }
    } else if (t < SHOT.E) {
      // D: 답답 (><, 땀, 부들부들)
      p.pos = POS_C.slice();
      p.rotY = lerp(0.6, 0.55, inOut(seg(t, 17.2, 17.5)));
      const shaking = t > 17.35 && t < 18.6;
      p.eyes = t > 18.65 ? 'blink' : 'squeeze'; p.mouth = 'wavy';
      p.sweat = clamp((t - 17.3) * 4);
      p.lean = [0, shaking ? Math.sin(t * 40) * 0.05 : 0];
      const fl = shaking ? Math.sin(t * 16) : 0;
      p.handL = [-8.2, 12 + fl * 2.5, 3]; p.handR = [9.2, 12 - fl * 2.5, 3];
      p.squash = 0.95;
    } else if (t < SHOT.F) {
      // E: 번뜩!
      p.pos = POS_C.slice();
      p.rotY = 0.55;
      const k = t - 19.15;
      if (k > 0 && k < 0.5) { p.pos[1] = Math.sin((k / 0.5) * Math.PI) * 4; p.squash = k < 0.12 ? 1.12 : 1; }
      p.eyes = t > 19.15 ? 'sparkle' : 'blink'; p.mouth = t > 19.15 && t < 20.4 ? 'o' : 'smile';
      const up = inOut(seg(t, 19.15, 19.35)) * (1 - inOut(seg(t, 19.9, 20.3)));
      p.handL = lerp3(REST_L, [-8.5, 19, 2], up); p.handR = lerp3(REST_R, [9.5, 19, 2], up);
      if (t > 20.3) { p.head = [Math.sin((t - 20.3) * 9) * 0.06 * clamp(1 - (t - 20.3)), 0, 0.1]; p.eyes = blink ? 'blink' : 'sparkle'; }
    } else {
      // F: 말하기 → 정답 / END: 신나서 깡충
      p.pos = POS_C.slice();
      p.rotY = 0.6;
      p.eyes = blink ? 'blink' : 'normal'; p.mouth = 'smile';
      p.handR = [8.6, 8, 2];
      for (const s of SAYS) {
        const k = t - s.t0;
        if (k >= 0 && k < 0.65) { p.mouth = Math.floor(k / 0.16) % 2 ? 'o' : 'open'; p.eyes = 'normal'; p.head = [-0.18, 0.12, 0]; p.squash = 1.04; p.handL = [-8.6, 11.5, 3]; p.handR = [8, 9, 4]; }
      }
      for (const c of CORRECT) {
        const k = t - c;
        if (k > 0 && k < 0.7) { p.eyes = 'happy'; p.mouth = 'open'; p.pos[1] = Math.sin(clamp(k / 0.4) * Math.PI) * 2.5; p.handL = [-9.5, 19, 2.5]; p.handR = [7.5, 18, 5.5]; }
      }
      if (t > 26.6) {
        // 신나서 깡충 + 왼손 엄지척 (손은 폰에 대지 않는다)
        const k = (t - 26.6) % 0.9;
        p.pos[1] = Math.sin(clamp(k / 0.45) * Math.PI) * 2.2; p.eyes = 'happy'; p.mouth = 'open';
        p.rotY = 0.6 - inOut(seg(t, 26.6, 27.4)) * 0.45;
        p.handL = [-8.8, 14.5 + Math.sin(t * 5) * 0.6, 4.5]; p.thumbL = true;
        p.handR = [7.6, 5 + Math.sin(t * 5) * 0.4, 3.5];
        if (k > 0.45 && k < 0.55) p.squash = 0.92;
      }
    }
    return p;
  }
  function pumpPress(t) {
    let d = 0;
    for (const pt of [9.6, 10.1]) { const k = t - pt; if (k > 0 && k < 0.22) d = Math.max(d, Math.sin((k / 0.22) * Math.PI) * 1.3); }
    return d;
  }
  // 손의 거품 양 (0~1)
  function foam(t, which) {
    if (which === 'R') return clamp((t - 10.1) / 0.2) * 0.45 + clamp((t - 10.7) / 0.8) * 0.55;
    return clamp((t - 10.7) / 0.8);
  }
  // 거품 덩어리 크기 (거품을 보여 줄 때 크게)
  const foamScale = (t) => 1 + 0.45 * clamp((t - 11.2) / 0.3) * (1 - clamp((t - 12.6) / 0.6));

  // ---------- 카메라 ----------
  function camAt(t, aspect, pose) {
    const portrait = aspect < 1;
    const sh = portrait ? -0.12 : -0.05;
    // 가로 화면: 위 단추 줄과 아래 자막 사이에 들어오게 높이 여유를 더 주고, 위로 덜 올린다
    const S = (target, rw, rh, yaw, pitch, extra = {}) => {
      const e = Object.assign({ shiftY: sh }, extra);
      if (!portrait) { rh *= 1.32; if (extra.shiftY != null) e.shiftY = extra.shiftY * 0.35; }
      return fitCam(target, rw, rh, yaw, pitch, 0.55, aspect, e);
    };
    const head = Pawn.headTop(pose);
    const headC = [head[0], head[1] - 6, head[2]];
    if (t < SHOT.B) {
      const k = inOut(seg(t, SHOT.A, SHOT.B));
      return S(lerp3([6.5, 22, -9], [6, 21, -9], k), lerp(18, 16.5, k), lerp(25, 23, k), lerp(0.4, 0.3, k), 0.3);
    }
    if (t < SHOT.C) {
      const k = inOut(seg(t, SHOT.B, SHOT.C));
      return S(lerp3([7, 14, -9], [7, 13, -8.5], k), lerp(14.5, 13.5, k), 15, lerp(0.58, 0.5, k), 0.26);
    }
    if (t < SHOT.D) {
      const k = inOut(seg(t, SHOT.C, SHOT.D));
      const pc = screenPoint(SHOT.C, 0.5, 0.5, 0);
      let jx = 0;
      for (const tp of TAPS) { const q = t - tp.t; if (q > 0 && q < 0.25) jx += Math.sin(q * 70) * 0.12 * (1 - q / 0.25); }
      const b = inOut(seg(t, 15.75, 16.35));
      return S(lerp3([pc[0] + 0.4 + jx, pc[1] - 0.3, pc[2] + 1], [12.5, 14.5, -9.5], b), lerp(lerp(8.5, 7.8, k), 16, b), lerp(lerp(10, 9.4, k), 14, b), lerp(0.24, 0.3, b), lerp(0.14, 0.18, b));
    }
    if (t < SHOT.E) {
      let j = 0; if (t > 17.35 && t < 18.6) j = Math.sin(t * 50) * 0.08;
      return S([headC[0] + j, headC[1] - 1.5, headC[2]], 12, 12, 0.5, 0.12);
    }
    if (t < SHOT.F) {
      const k = t - 19.15;
      const r = k < 0 ? 1 : 1 - 0.18 * back(clamp(k / 0.25));
      let j = 0; if (k > 0 && k < 0.3) j = Math.sin(k * 80) * 0.15 * (1 - k / 0.3);
      const c = [POS_C[0] + 0.5, 16.5, POS_C[2] + 0.5];
      return S([c[0] + j, c[1] + 3.5 + j, c[2]], 10.5 * r, 12 * r, 0.5, 0.12);
    }
    if (t < SHOT.END) {
      const k = inOut(seg(t, SHOT.F, SHOT.END));
      let push = 0;
      // 말하기 0.6초 전부터 정답 뒤까지 폰 쪽으로 당겨 카드 글자를 크게
      SAYS.forEach((sy, i) => { const c = CORRECT[i]; push = Math.max(push, inOut(seg(t, sy.t0 - 0.6, sy.t0 - 0.1)) * (1 - inOut(seg(t, c + 0.6, c + 1.0)))); });
      const pc = screenPoint(SHOT.F, 0.5, 0.5, 0);
      // 폰 전체(오른쪽 정답 배지까지)가 늘 화면 안에: 머리 뒤쪽은 잘려도 얼굴·입은 보이게
      const base = lerp3([12, 15.5, -9.5], [11.5, 15.5, -9.5], k);
      return S(lerp3(base, [pc[0] - 3.5, pc[1] + 0.5, pc[2] + 3], push * 0.6), lerp(lerp(17.5, 17, k), 16, push), 14 * (1 - push * 0.15), lerp(0.32, 0.26, k), 0.2);
    }
    const k = inOut(seg(t, SHOT.END, DUR));
    return S([10.5, 14, -8.5], lerp(12.5, 13, k), lerp(14, 15, k), lerp(0.26, 0.36, k), 0.24, { shiftY: portrait ? -0.42 : -0.3 });
  }

  // ---------- 입자 ----------
  function water(t, pose, out) {
    const N = 34, L = SHOWER[1] - 0.5, speed = 52;
    const head = Pawn.headTop(pose);
    const under = Math.hypot(pose.pos[0] - SHOWER[0], pose.pos[2] - SHOWER[2]) < 4;
    for (let i = 0; i < N; i++) {
      const u = frac(t * speed / L + rand(i * 3));
      const a = 6.283 * rand(i * 3 + 1), r0 = 2.6 * Math.sqrt(rand(i * 3 + 2));
      const r = r0 * (1 + u * 0.5);
      const x = SHOWER[0] + 0.5 + Math.cos(a) * r, z = SHOWER[2] + 0.5 + Math.sin(a) * r;
      const y = SHOWER[1] - 0.6 - u * L;
      const onHead = under && Math.hypot(x - head[0], z - head[2]) < 5.2;
      if (onHead && y < head[1] - 0.5) continue;
      out.push([x - 0.3, y, z - 0.3, x + 0.3, y + 1.3, z + 0.3, i % 3 ? 0x6fc6f2 : 0xa8e0fb]);
    }
    // 튀는 물: 머리 위 (밑에 있을 때) 또는 바닥
    const M = 22;
    for (let i = 0; i < M; i++) {
      const per = 0.45, ph = frac(t / per + rand(i + 200));
      const a = 6.283 * rand(i + 300), sp = 2 + 3 * rand(i + 400);
      const baseY = under ? head[1] - 0.6 : 0;
      const cx = under ? head[0] : SHOWER[0] + 0.5, cz = under ? head[2] : SHOWER[2] + 0.5;
      const rr = (under ? 2.5 : 2) * rand(i + 500) + ph * sp;
      const y = baseY + ph * 7 * (1 - ph) * (under ? 1.2 : 0.8);
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      out.push([x - 0.2, y, z - 0.2, x + 0.2, y + 0.4, z + 0.2, 0x9fdcfb]);
    }
  }
  function bubblesOnHand(pose, which, amt, t, out) {
    if (amt <= 0) return;
    const c = Pawn.handWorld(pose, which);
    const n = Math.round(amt * 16);
    for (let j = 0; j < n; j++) {
      const id = j + (which === 'L' ? 0 : 100);
      const fs = foamScale(t);
      const ox = (rand(id) - 0.5) * 3.4 * fs, oy = (rand(id + 7) - 0.3) * 3.0 * fs, oz = (rand(id + 13) - 0.5) * 3.4 * fs;
      const s = (0.42 + rand(id + 21) * 0.45) * fs + Math.sin(t * 6 + j) * 0.05;
      const x = c[0] + ox, y = c[1] + oy, z = c[2] + oz;
      out.push([x - s, y - s, z - s, x + s, y + s, z + s, j % 3 ? 0xffffff : 0xd2efff]);
    }
  }
  // 떠오르는 비눗방울: 손 비빌 때 생겨서 위로
  const FLOATERS = Array.from({ length: 24 }, (_, k) => ({ b: 10.9 + k * 0.2, life: 2.6 + rand(k + 900) * 1.4, w: k % 2 ? 'L' : 'R', s: 0.45 + rand(k + 77) * 0.5 }));
  function floaters(t, out, pops) {
    for (let k = 0; k < FLOATERS.length; k++) {
      const f = FLOATERS[k];
      const age = t - f.b;
      if (age < 0 || age > f.life) { if (age > f.life && age < f.life + 0.25 && pops) pops.push({ k, f, age: age - f.life }); continue; }
      const start = Pawn.handWorld(pawnPose(f.b), f.w);
      const x = start[0] + Math.sin(age * 2 + k) * 1.5 + (rand(k + 5) - 0.5) * 4 * age;
      const y = start[1] + age * 3.2;
      const z = start[2] + Math.cos(age * 1.7 + k) * 1.2 + 1.5 * age;
      const s = f.s * Math.min(1, age * 4);
      out.push([x - s, y - s, z - s, x + s, y + s, z + s, 0xf3fbff]);
    }
  }
  function confetti(t, out) {
    const COLS = [0x04becd, 0xffd23f, 0xff9aa2, 0xffffff, 0x7fd8de];
    for (let b = 0; b < CORRECT.length; b++) {
      const age = t - CORRECT[b];
      if (age < 0 || age > 1.5) continue;
      for (let i = 0; i < 12; i++) {
        const id = b * 50 + i;
        const side = i % 2 ? 1 : -1;
        const o = screenPoint(CORRECT[b], side > 0 ? 1.08 : -0.08, 0.15 + 0.5 * rand(id + 990), 0.5);
        const sp = 5 + rand(id + 1100) * 7;
        const vx = side * sp, vz = rand(id + 1200) * 2, vy = 9 + rand(id + 1300) * 8;
        const x = o[0] + vx * age, y = o[1] + vy * age - 18 * age * age, z = o[2] + vz * age;
        const s = 0.35;
        out.push([x - s, y - s, z - s, x + s, y + s * 0.6, z + s, COLS[i % COLS.length]]);
      }
    }
  }

  // ---------- 폰 화면 그리기 (작은 픽셀 캔버스) ----------
  function drawScreen(px, st) {
    const g = px.ctx, W = px.w, H = px.h;
    g.clearRect(0, 0, W, H);
    px.rect(0, 0, W, H, '#f6f5f2');
    px.rect(0, 0, W, 6, '#1c1f26');
    px.rect(3, 2, 6, 2, '#ffffff'); px.rect(W - 9, 2, 6, 2, '#ffffff');
    px.text('단어장', 4, 9, 9, INK, { weight: 800 });
    if (st.voice) { // 말로 하기 켜짐: 위 오른쪽에 마이크 + 빨간 점
      px.round(W - 15, 8, 12, 11, '#e0f7f9', 2);
      px.icon('mic', W - 11, 9, TEAL_TEXT);
      px.rect(W - 5, 9, 2, 2, CORAL);
    }
    px.rect(4, 21, W - 8, 2, '#e4e2dc'); px.rect(4, 21, Math.round((W - 8) * (0.3 + st.card * 0.2)), 2, TEAL);
    // 카드 (뒤집힐 때 가로로 납작)
    const card = CARDS[st.card];
    const ok = st.mode === 'correct';
    let off = 0;
    if (st.flip) off = st.flip < 0.5 ? -Math.round((st.flip / 0.5) * W) : Math.round((1 - (st.flip - 0.5) / 0.5) * W);
    const cw = W - 8, cx = 4 + off;
    px.panel(cx, 26, cw, 34, { fill: '#ffffff', border: ok ? TEAL : '#cfcbc0', r: 2 });
    px.text(card.word, cx + cw / 2, ok ? 31 : 36, 9, INK, { align: 'center' });
    if (ok) px.text(card.mean, cx + cw / 2, 44, 10, TEAL_TEXT, { align: 'center' });
    // 아래: 단추 / 듣는 중 / 정답
    if (st.mode === 'idle') {
      px.round(6, 66, W - 12, 14, TEAL, 2);
      px.text('뜻 보기', W / 2, 68, 9, '#ffffff', { align: 'center' });
    } else if (st.mode === 'listen') {
      px.round(6, 64, W - 12, 18, '#e0f7f9', 2);
      px.icon('mic', 9, 65, TEAL_TEXT, 2);
      for (let i = 0; i < 5; i++) {
        const h = 2 + Math.round((Math.sin(st.t * 14 + i * 1.3) * 0.5 + 0.5) * 9);
        px.rect(21 + i * 4, 73 - Math.floor(h / 2), 2, h, TEAL);
      }
    } else {
      px.round(6, 66, W - 12, 14, TEAL, 2);
      px.icon('check', 11, 70, '#ffffff');
      px.text('정답!', 21, 68, 9, '#ffffff');
    }
    // 거품 자국
    g.globalAlpha = st.fade;
    for (const [u, v, s] of st.smudges) {
      const x = u * W, y = v * H, r = Math.max(2, s * W);
      g.fillStyle = 'rgba(255,255,255,0.88)';
      g.beginPath(); g.arc(Math.round(x), Math.round(y), r, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(190,230,245,0.9)';
      g.fillRect(Math.round(x + r * 0.3), Math.round(y - r * 0.5), 2, 2);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.arc(Math.round(x - r * 0.9), Math.round(y + r * 0.6), r * 0.5, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    // 화면 반사광 한 줄
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 10; i++) g.fillRect(W - 14 + i, i * 2, 3, 2);
  }

  // ---------- 장면 ----------
  const scene = {
    duration: DUR,
    init(st) {
      const R = st.R;
      this.P = Pawn.create(R);
      this.room = R.mesh(buildMesh(Sets.bathroom(), { ao: 0.9, skip: (nx, ny, nz) => nz < 0 || nx < 0 || ny < 0 }));
      this.phone = R.mesh(buildMesh(Sets.phone()));
      this.bottle = R.mesh(buildMesh(Sets.bottle()));
      this.pump = R.mesh(buildMesh(Sets.pump()));
      this.head = R.mesh(buildMesh(Sets.showerHead()));
      this.duck = R.mesh(buildMesh(Sets.duck()));
      const cube = new Vox(); cube.set(0, 0, 0, 0xffffff);
      const blob = new Vox(); blob.disc(0, 7.2, 0x000000);
      this.blob = R.mesh(buildMesh(blob, { noAO: true }));
      this.cube = R.mesh(buildMesh(cube, { noAO: true }));
      // 폰 화면 텍스처
      const sc = document.createElement('canvas'); sc.width = 48; sc.height = 88;
      this.scrPix = new Pix(sc); this.scrPix.w = 48; this.scrPix.h = 88; this.scrPix.ctx.imageSmoothingEnabled = false;
      this.scrTex = R.texture(sc);
      this.scrQuad = R.quad(6.4, 12);
      this.scrKey = '';
    },
    frame(t, st) {
      const pose = pawnPose(t);
      this.pose = pose;
      const items = [{ mesh: this.room, m: M4.ident(), shadow: false }];
      items.push({ mesh: this.head, m: M4.compose(SHOWER, [0, 0, 0], [1, 1, 1], [0.5, 0, 0.5]), shadow: false });
      const pm = phoneMatrix(t);
      items.push({ mesh: this.phone, m: pm });
      items.push({ mesh: this.bottle, m: M4.compose(BOTTLE_AT, [0, -0.3, 0], [1, 1, 1], [0.5, 0, 0.5]) });
      items.push({ mesh: this.pump, m: M4.compose([BOTTLE_AT[0], BOTTLE_AT[1] + 10 - pumpPress(t), BOTTLE_AT[2]], [0, -0.3, 0], [1, 1, 1], [0.5, 0, 0.5]) });
      items.push({ mesh: this.duck, m: M4.compose(DUCK_AT, [0, -0.6 + Math.sin(t * 1.3) * 0.08, 0], [1, 1, 1], [0.5, 0, 0.5]) });
      items.push(...Pawn.items(this.P, pose));
      // 입자
      const boxes = [];
      water(t, pose, boxes);
      bubblesOnHand(pose, 'R', foam(t, 'R'), t, boxes);
      bubblesOnHand(pose, 'L', foam(t, 'L'), t, boxes);
      this.pops = [];
      floaters(t, boxes, this.pops);
      confetti(t, boxes);
      const dyn = boxesToArray(boxes);
      // 김 (반투명) + 발밑 그림자
      const glass = [];
      const lift = pose.pos[1];
      glass.push({ mesh: this.blob, m: M4.compose([pose.pos[0], 0.03, pose.pos[2]], [0, 0, 0], [1 - lift * 0.04, 0.05, 1 - lift * 0.04], [0.5, 0, 0.5]), alpha: 0.32 * (1 - lift * 0.08), tint: [0, 0, 0], emit: 1 });
      for (let i = 0; i < 12; i++) {
        const per = 7, k = frac(t / per + rand(i + 600));
        const x = -18 + 34 * rand(i + 610), z = -14 + 16 * rand(i + 620), y = 14 + 18 * rand(i + 630) + k * 14;
        const s = 3 + k * 5;
        glass.push({ mesh: this.cube, m: M4.compose([x, y, z], [0, k * 0.6, 0], [s, s * 0.8, s], [0.5, 0.5, 0.5]), alpha: 0.13 * Math.sin(k * Math.PI), emit: 0.7 });
      }
      // 폰 화면
      const ss = screenState(t);
      const key = ss.card + ss.mode + ss.flip.toFixed(2) + ss.smudges.length + ss.fade.toFixed(2) + ss.voice + (ss.mode === 'listen' ? Math.floor(t * 12) : '');
      if (key !== this.scrKey) { drawScreen(this.scrPix, ss); this.scrTex.update(); this.scrKey = key; }
      const planes = [{ quad: this.scrQuad, tex: this.scrTex, m: M4.mul(pm, M4.compose([4, 7, 1.04], [0, 0, 0], [1, 1, 1], [0, 0, 0])), bright: 1 }];
      const cam = camAt(t, st.aspect, pose);
      const d = Math.hypot(cam.eye[0] - cam.target[0], cam.eye[1] - cam.target[1], cam.eye[2] - cam.target[2]);
      this.cam = cam;
      return {
        cam, items, dyn, glass, planes, dynShadow: false,
        bg: [0.13, 0.12, 0.14],
        light: { dir: global.LIGHT_DIR || [-0.45, 1, 0.85], center: [8, 14, -4], radius: 62, shadow: !global.NO_SHADOW },
        lightCol: [0.86, 0.74, 0.6], sky: [0.5, 0.55, 0.64], ground: [0.36, 0.31, 0.28],
        fogCol: [0.13, 0.12, 0.14], fog: [d + 40, d + 140],
      };
    },
    hud(t, px, frame, st) { drawHud(this, t, px, st); },
  };

  // ---------- 화면 위 픽셀 층 ----------
  function layoutSub(px, text, landscape) {
    let lines = text.split('\n');
    const size = landscape || px.w < 190 ? 11 : 12;
    const maxW = Math.min(px.w - 12, landscape ? 330 : 210);
    if (landscape) {
      const one = lines.join(' ');
      if (px.textWidth(Pix.plain(one), size) <= maxW - 20) lines = [one];
    }
    const widths = lines.map((l) => px.textWidth(Pix.plain(l), size));
    const w = Math.min(maxW, Math.max(...widths) + 24);
    const lh = size + 5;
    return { lines, size, w, h: lines.length * lh + (landscape ? 9 : 14), lh, pad: landscape ? 4 : 7 };
  }
  function drawHud(sc, t, px, st) {
    const W = px.w, H = px.h, landscape = st.aspect > 1.2;
    const proj = (p) => { const s = st.R.project(p); return [Math.round(s[0] * W), Math.round(s[1] * H)]; };
    const head = proj(Pawn.headTop(sc.pose));
    scene.buttons = [];

    // 흥얼 음표
    for (let i = 0; i < HUM.length; i++) {
      const k = t - HUM[i][0];
      if (k < 0 || k > 1.1 || t > SHOT.B) continue;
      const x = head[0] + (i % 2 ? 10 : -14) + Math.round(Math.sin(k * 6) * 3), y = head[1] - 6 - Math.round(k * 22);
      px.icon(i % 3 ? 'note' : 'note2', x, y, i % 2 ? TEAL : INK);
    }
    // 펌프 "칙"
    for (const pt of [9.6, 10.1]) if (t > pt && t < pt + 0.4) { const b = proj([BOTTLE_AT[0] + 0.5, BOTTLE_AT[1] + 17, BOTTLE_AT[2]]); px.text('칙!', Math.min(W - 30, b[0] + 8), b[1] - 14 - Math.round((t - pt) * 14), 14, '#ffffff', { outline: INK }); }
    // 손 비빌 때 "뽀글뽀글"
    if (t > 10.75 && t < 11.9) {
      const hpos = proj(Pawn.handWorld(sc.pose, 'R'));
      const wob = Math.round(Math.sin(t * 20) * 1.5);
      px.text('뽀글뽀글', Math.min(W - 70, hpos[0] + 18), hpos[1] - 40 + wob, 14, '#ffffff', { outline: INK });
    }
    // 비눗방울 터짐
    const ht = Pawn.headTop(sc.pose), faceC = proj([ht[0], ht[1] - 6.5, ht[2]]), faceR = Math.abs(faceC[1] - head[1]) * 1.1;
    for (const p of sc.pops || []) {
      const end = Pawn.handWorld(pawnPose(p.f.b), p.f.w);
      const age = p.f.life;
      const w3 = [end[0] + Math.sin(age * 2 + p.k) * 1.5 + (rand(p.k + 5) - 0.5) * 4 * age, end[1] + age * 3.2, end[2] + Math.cos(age * 1.7 + p.k) * 1.2 + 1.5 * age];
      const s = proj(w3);
      // 얼굴 위에서 터지면 표정을 가리니 그리지 않는다
      if (Math.abs(s[0] - faceC[0]) < faceR && Math.abs(s[1] - faceC[1]) < faceR) continue;
      px.sparkle(s[0], s[1], 1 + Math.round(p.age * 8), '#ffffff');
    }
    // 눌렀는데 안 됨: 빨간 X
    for (const tp of TAPS) {
      const k = t - tp.t;
      if (k < 0.05 || k > 0.75) continue;
      const s = proj(screenPoint(t, tp.u, tp.v + (tp.slide ? clamp((k - 0.05) / 0.5) * tp.slide : 0)));
      const sc2 = k < 0.15 ? 7 : 6, cs = 5 * sc2;
      const xx = Math.max(4, Math.min(W - cs - 6, s[0] + 6)), xy = Math.max(30, s[1] - cs - 30);
      px.icon('cross', xx - 1, xy - 1, INK, sc2); px.icon('cross', xx + 1, xy + 1, INK, sc2);
      px.icon('cross', xx + 1, xy - 1, INK, sc2); px.icon('cross', xx - 1, xy + 1, INK, sc2);
      px.icon('cross', xx, xy, CORAL, sc2);
      if (tp.slide && k > 0.1 && k < 0.8) {
        // 미끄러진 자국 선 + "미끌!"
        const top = proj(screenPoint(t, tp.u, tp.v));
        for (let j = 0; j < 3; j++) px.rect(top[0] - 14 + j * 4, top[1], 2, Math.max(2, s[1] - top[1]), j === 1 ? '#ffffff' : 'rgba(255,255,255,.7)');
        px.text('미끌!', s[0] + 26, s[1] - 4, 14, '#ffffff', { outline: INK });
      }
    }
    // 답답 "끙…"
    if (t > 17.45 && t < 18.7) {
      const bx = Math.min(px.w - 44, head[0] + 10), by = Math.max(30, head[1] - 26);
      px.panel(bx, by, 38, 22, { fill: PAPER, border: INK, shadow: 'rgba(0,0,0,.35)' });
      px.text('끙…', bx + 19, by + 4, 12, INK, { align: 'center' });
      px.rect(bx + 3, by + 21, 3, 2, INK); px.rect(bx + 1, by + 23, 2, 2, INK);
    }
    // 번뜩 "!"
    if (t > 19.15 && t < 19.95) {
      const k = t - 19.15;
      const sc3 = k < 0.12 ? 5 : 4;
      const bx = head[0] - sc3, by = head[1] - 14 - sc3 * 6 - Math.round(Math.sin(Math.min(1, k * 3) * Math.PI) * 4);
      px.icon('bang', bx + 1, by + 1, INK, sc3);
      px.icon('bang', bx, by, '#ffd23f', sc3);
      if (k < 0.9) {
        const r0 = 12 + k * 40;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          for (let j = 0; j < 4; j++) px.rect(head[0] + Math.cos(a) * (r0 + j * 2), head[1] - 22 + Math.sin(a) * (r0 + j * 2), 2, 2, i % 2 ? '#ffd23f' : '#ffffff');
        }
      }
    }
    // 떠올린 생각: 마이크 (말로 하면 되잖아!)
    if (t > 19.85 && t < SHOT.F) {
      const k = t - 19.85, pop = back(clamp(k / 0.25));
      const r = Math.round(20 * pop);
      if (r > 2) {
        const cx = Math.max(r + 6, Math.min(W - r - 6, head[0] + 6)), cy = Math.max(r + 30, head[1] - r - 18);
        // 생각 꼬리 (작은 동그라미 두 개)
        px.round(head[0] - 6, head[1] - 9, 6, 6, INK, 2); px.round(head[0] - 5, head[1] - 8, 4, 4, '#ffffff', 1);
        px.round(head[0] - 1, head[1] - 17, 8, 8, INK, 2); px.round(head[0], head[1] - 16, 6, 6, '#ffffff', 2);
        px.panel(cx - r, cy - r, r * 2, r * 2, { fill: '#ffffff', border: INK, shadow: 'rgba(0,0,0,.35)', r: 3 });
        if (pop > 0.8) {
          const ms = 3;
          px.icon('mic', cx - 2 * ms, cy - 4 * ms - 1, TEAL_TEXT, ms);
          const wv = Math.floor(t * 4) % 2;
          px.icon('wave', cx + 3 * ms + wv, cy - 4 * ms + 2, TEAL, 2);
          px.icon('waveL', cx - 3 * ms - 6 - wv, cy - 4 * ms + 2, TEAL, 2);
        }
      }
    }
    // 말풍선: 얼굴 옆(폰 반대쪽)에, 꼬리는 입을 가리킨다. 입에서 폰 쪽으로 소리 물결
    const pose = sc.pose;
    const hc = Pawn.headTop(pose); hc[1] -= 6.2;
    const cam = sc.cam;
    let fx = cam.target[0] - cam.eye[0], fz = cam.target[2] - cam.eye[2];
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const right = [-fz, 0, fx];
    const fwd = [Math.sin(pose.rotY), 0, Math.cos(pose.rotY)];
    const mouthW = [hc[0] + fwd[0] * 5.5, hc[1] - 2.2, hc[2] + fwd[2] * 5.5];
    const mouth = proj(mouthW);
    const headL = proj([hc[0] - right[0] * 7, hc[1], hc[2] - right[2] * 7]);
    for (const s of SAYS) {
      if (t < s.t0 || t > s.t1) continue;
      const pop = clamp((t - s.t0) / 0.12);
      const tw = px.textWidth(s.text, 14);
      const bw = Math.round((tw + 16) * (0.6 + 0.4 * pop)), bh = 24;
      const headT = proj(Pawn.headTop(pose));
      const side = headL[0] - bw - 10 >= 4;
      const bx = side ? headL[0] - bw - 10 : Math.max(4, Math.min(W - bw - 4, headT[0] - Math.round(bw * 0.8)));
      const by = side ? Math.max(28, Math.min(H - 80, mouth[1] - bh - 6)) : Math.max(28, headT[1] - bh - 8);
      px.panel(bx, by, bw, bh, { fill: '#ffffff', border: INK, shadow: 'rgba(0,0,0,.35)' });
      if (pop >= 1) px.text(s.text, bx + bw / 2, by + 4, 14, INK, { align: 'center' });
      // 꼬리: 상자 오른쪽 아래에서 입 쪽으로
      if (side) {
        const tx0 = bx + bw - 2, ty0 = by + bh - 6;
        const steps = Math.max(2, Math.min(10, Math.round((mouth[0] - tx0) / 3)));
        for (let i = 0; i < steps; i++) px.rect(tx0 + i * 3, ty0 + Math.round(((mouth[1] - ty0) * i) / steps), 3, 2, INK);
      } else {
        for (let i = 0; i < 4; i++) px.rect(bx + Math.round(bw * 0.7) + i * 2, by + bh - 1 + i, 3, 1, INK);
      }
      // 소리 물결: 입 → 폰
      const k = t - s.t0, ci = CORRECT[SAYS.indexOf(s)], span = ci - s.t0;
      if (k < span) {
        const ph = proj(screenPoint(t, 0.3, 0.86, 0.5));
        for (let i = 0; i < 3; i++) {
          // 물결 3개가 차례로 입 → 폰 마이크 칸. 마지막 물결이 닿는 순간 정답
          const q = clamp((k - i * 0.12) / (span - 0.24));
          if (q <= 0 || q >= 1) continue;
          const e = 0.12 + q * 0.88;
          const x = Math.round(mouth[0] + (ph[0] - mouth[0]) * e), y = Math.round(mouth[1] + (ph[1] - mouth[1]) * e);
          const ws = q > 0.6 ? 3 : 2;
          px.icon('wave', x + 1, y - 3 * ws + 1, '#ffffff', ws);
          px.icon('wave', x, y - 3 * ws, TEAL_TEXT, ws);
        }
      }
    }
    // 정답: 폰 위에 큰 체크
    for (const c of CORRECT) {
      const k = t - c;
      if (k < 0 || k > 0.65) continue;
      const ph = proj(screenPoint(t, 1.2, -0.04, 0.5));
      const sc4 = k < 0.08 ? 1 : 2;
      const r = 9 + sc4;
      px.round(ph[0] - r, ph[1] - r, r * 2, r * 2, INK, 3);
      px.round(ph[0] - r + 1, ph[1] - r + 1, r * 2 - 2, r * 2 - 2, TEAL, 3);
      px.icon('check', ph[0] - Math.round(3.5 * sc4), ph[1] - 3 * sc4, '#ffffff', sc4);
    }
    // 정답 반짝이
    for (const c of CORRECT) {
      const k = t - c;
      if (k < 0.15 || k > 1.0) continue;
      const q = (k - 0.15) / 0.85;
      const pts = [[-0.25, 0.1], [-0.3, 0.55], [-0.22, 0.95], [1.25, 0.45], [1.28, 0.85], [0.5, 1.12]];
      pts.forEach(([u, v], i) => {
        const s = proj(screenPoint(c, u + (u < 0.5 ? -q * 0.25 : u > 0.9 ? q * 0.25 : 0), v + (v > 1 ? q * 0.1 : 0), 0.5));
        px.sparkle(s[0], s[1], Math.max(1, 3 - Math.round(q * 2.5)), i % 2 ? '#ffd23f' : '#ffffff');
      });
    }

    // 시각 표시 (첫 장면)
    if (t > SHOT.A + 0.2 && t < SHOT.B - 0.2) {
      const y = 30;
      px.panel(8, y, 62, 17, { fill: INK, border: TEAL });
      px.icon('clock', 14, y + 6, TEAL);
      px.text('PM 11:40', 22, y + 3, 10, '#ffffff');
    }
    // 자막
    if (t < SHOT.END) {
      for (const s of SUBS) {
        if (t < s.t0 || t > s.t1) continue;
        const L = layoutSub(px, s.text, landscape);
        const appear = clamp((t - s.t0) / 0.15);
        const x = Math.round((W - L.w) / 2), y = H - L.h - (landscape ? 6 : 12) + Math.round((1 - appear) * 6);
        px.panel(x, y, L.w, L.h, { fill: PAPER, border: INK, shadow: 'rgba(0,0,0,.4)', sy: 2 });
        px.round(x + 6, y - 5, 12, 11, INK, 2);
        px.round(x + 7, y - 4, 10, 9, TEAL, 2);
        px.icon('pawn', x + 9, y - 4, '#ffffff');
        let shown = Math.floor((t - s.t0) * CPS) + 1;
        L.lines.forEach((line, i) => {
          const n = Pix.plain(line).length;
          px.rich(line, W / 2, y + L.pad + i * L.lh, L.size, { base: INK, hl: TEAL_TEXT, hl2: CORAL }, { align: 'center', chars: shown });
          shown -= n;
        });
      }
    }
    // 끝 화면
    if (t >= SHOT.END) drawEnd(t, px, st);
    // 위쪽 줄: 진행(체스 8칸) · 소리 · 건너뛰기
    drawTop(t, px, st);
    // 제목 카드 + 체스판 무늬로 걷히기
    if (t < SHOT.A) drawTitle(t, px);
    // 번뜩 흰 번쩍
    if (t > 19.15 && t < 19.32) { px.ctx.globalAlpha = 0.55 * (1 - (t - 19.15) / 0.17); px.rect(0, 0, W, H, '#ffffff'); px.ctx.globalAlpha = 1; }
  }

  function drawTitle(t, px) {
    const W = px.w, H = px.h;
    const cell = 12, nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
    const k = seg(t, 2.35, 3.0);
    const BG = '#16181d';
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const th = ((i + j) / (nx + ny)) * 0.7 + ((i + j) % 2 ? 0.3 : 0);
      if (k > th) continue;
      px.rect(i * cell, j * cell, cell, cell, (i + j) % 2 ? BG : '#1b1e24');
    }
    if (k > 0.05) return;
    const cy = Math.round(H * 0.42);
    const a = clamp(t / 0.4);
    px.icon('pawn', W / 2 - 6, cy - 46 + Math.round((1 - a) * 6), TEAL, 2);
    px.text('업데이트 이야기 #1', W / 2, cy - 22, 10, TEAL, { align: 'center' });
    const title = '샤워하다 생긴 기능';
    const n = Math.floor(seg(t, 0.4, 1.3) * title.length);
    px.text(title, W / 2, cy - 4, 16, '#ffffff', { align: 'center', chars: n, shadow: '#000000' });
    if (t > 1.4) px.text('개발자 폰의 이야기', W / 2, cy + 22, 10, '#9aa0a8', { align: 'center' });
    if (scene.waiting && Math.floor(t * 2) % 2 === 0) {
      px.icon('play', W / 2 - 34, cy + 52, '#ffffff');
      px.text('눌러서 보기', W / 2 + 6, cy + 49, 10, '#ffffff', { align: 'center' });
    }
  }

  function drawTop(t, px, st) {
    const W = px.w;
    const ui = scene.ui || {};
    // 진행: 체스 8칸 위로 폰이 전진, 끝나면 퀸
    const n = 8, sq = 7, x0 = Math.round(W / 2 - (n * sq) / 2), y0 = 13;
    const pos = Math.min(n - 1, Math.floor((t / DUR) * n));
    px.rect(x0 - 1, y0 - 1, n * sq + 2, sq + 2, 'rgba(0,0,0,.45)');
    for (let i = 0; i < n; i++) px.rect(x0 + i * sq, y0, sq, sq, i <= pos ? (i % 2 ? '#7fd8de' : '#bfeef2') : (i % 2 ? '#3a3f47' : '#5a606a'));
    const end = t >= DUR - 0.6;
    px.icon(end ? 'queen' : 'pawn', x0 + pos * sq + 1 - 0, y0 - 9, '#ffffff');
    px.icon(end ? 'queen' : 'pawn', x0 + pos * sq, y0 - 10, INK);
    if (ui.hideButtons) return;
    // 소리
    px.panel(6, 4, 20, 18, { fill: 'rgba(28,31,38,.85)', border: '#ffffff', r: 2 });
    px.icon(ui.muted ? 'soundOff' : 'soundOn', 12, 9, '#ffffff');
    scene.buttons.push({ id: 'sound', x: 6, y: 4, w: 20, h: 18, label: ui.muted ? '소리 켜기' : '소리 끄기' });
    // 건너뛰기 (끝 화면에서는 숨김)
    if (t < SHOT.END) {
      const bw = 58;
      px.panel(W - bw - 6, 4, bw, 18, { fill: 'rgba(28,31,38,.85)', border: '#ffffff', r: 2 });
      px.text('건너뛰기', W - bw - 6 + 6, 7, 10, '#ffffff');
      px.icon('skip', W - 16, 10, '#ffffff');
      scene.buttons.push({ id: 'skip', x: W - bw - 6, y: 4, w: bw, h: 18, label: '건너뛰기' });
    }
  }

  function drawEnd(t, px, st) {
    const W = px.w, H = px.h;
    const k = back(clamp((t - SHOT.END - 0.1) / 0.45));
    const cw = Math.min(W - 16, 200), ch = 104;
    const x = Math.round((W - cw) / 2), y = Math.round(H - ch - 14 + (1 - k) * (ch + 20));
    px.panel(x, y, cw, ch, { fill: PAPER, border: INK, shadow: 'rgba(0,0,0,.45)', sy: 3 });
    px.round(x + 10, y + 10, 40, 14, TEAL, 2);
    px.text('새 기능', x + 30, y + 12, 10, '#ffffff', { align: 'center' });
    px.text('그래서 만들었어요', x + 56, y + 12, 10, MUTED, { weight: 700 });
    px.text('말로 외우는 단어장', x + cw / 2, y + 32, 16, INK, { align: 'center' });
    px.text('뜻을 소리 내어 말하면 넘어가요', x + cw / 2, y + 54, 10, MUTED, { align: 'center', weight: 700 });
    const bw = 76, bx = Math.round(x + (cw - bw) / 2), by = y + ch - 30;
    px.panel(bx, by, bw, 20, { fill: INK, border: INK, shadow: 'rgba(0,0,0,.3)' });
    px.icon('replay', bx + 10, by + 6, '#ffffff');
    px.text('다시 보기', bx + 22, by + 4, 10, '#ffffff');
    if (k > 0.9) scene.buttons.push({ id: 'replay', x: bx, y: by, w: bw, h: 20, label: '다시 보기' });
    // 반짝이
    for (let i = 0; i < 6; i++) {
      const ph = frac(t * 0.8 + i / 6);
      px.sparkle(x + 12 + ((i * 37) % (cw - 24)), y - 6 - Math.round(ph * 20), ph < 0.5 ? 2 : 1, i % 2 ? '#ffd23f' : '#ffffff');
    }
  }

  // ---------- 소리 일정 ----------
  function cues() {
    const q = [];
    q.push({ t: 0.35, s: 'wipe' });
    q.push({ t: 2.4, s: 'wipe' });
    q.push({ t: 2.6, s: 'shower', dur: DUR - 2.6, vol: 0.06 });
    for (const [t, n] of HUM) q.push({ t, s: 'note', n, v: 0.06 });
    for (const s of SUBS) {
      const n = Pix.plain(s.text).replace(/\s/g, '').length;
      for (let i = 0; i < n; i += 2) q.push({ t: s.t0 + i / CPS, s: 'blip', f: 620 + (i % 4) * 40 });
    }
    q.push({ t: 8.0, s: 'hop' }, { t: 8.42, s: 'hop' }, { t: 12.6, s: 'hop' });
    q.push({ t: 9.6, s: 'pump' }, { t: 10.1, s: 'pump' });
    for (let i = 0; i < 9; i++) q.push({ t: 10.8 + i * 0.19, s: 'squish' });
    for (let k = 0; k < FLOATERS.length; k += 3) q.push({ t: FLOATERS[k].b + FLOATERS[k].life, s: 'pop', f: 800 + (k % 5) * 90 });
    for (const tp of TAPS) { q.push({ t: tp.t, s: 'tap' }, { t: tp.t + 0.08, s: 'error' }); if (tp.slide) q.push({ t: tp.t + 0.1, s: 'squeak' }); }
    q.push({ t: 17.4, s: 'grr' }, { t: 17.9, s: 'grr' });
    q.push({ t: 19.05, s: 'whoosh' }, { t: 19.15, s: 'idea' });
    q.push({ t: 22.4, s: 'mic' }, { t: 24.45, s: 'mic' }, { t: 26.45, s: 'mic' });
    for (const s of SAYS) s.syl.forEach((t, i) => q.push({ t, s: 'voice', f: 500 + i * 90, up: i === s.syl.length - 1 }));
    for (const c of CORRECT) q.push({ t: c, s: 'correct' });
    for (const f of FLIPS) q.push({ t: f, s: 'flip' });
    q.push({ t: 26.6, s: 'hop' }, { t: 27.4, s: 'hop' });
    q.push({ t: SHOT.END, s: 'wipe' }, { t: SHOT.END + 0.3, s: 'jingle' });
    return q.sort((a, b) => a.t - b.t);
  }

  scene.cues = cues;
  scene.SHOT = SHOT;
  scene.SUBS = SUBS;
  scene.pawnPose = pawnPose;
  global.ShowerScene = scene;
})(typeof window !== 'undefined' ? window : globalThis);
