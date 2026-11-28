// 무대·소품 복셀 모델 (욕실, 체스판, 폰, 바디워시 통, 샤워기, 고무 오리)
(function (global) {
  'use strict';
  const { Vox, buildMesh, boxesToArray } = global.Vox3D;

  const COL = {
    sqLight: 0xefeae0, sqDark: 0xb9c7c5, sqRim: 0x8d9a98,
    tile: 0xe0906f, tileAlt: 0xd5846a, grout: 0xb36a52, band: 0xfff0dd, floor: 0xbcb1a5, floorAlt: 0xafa397, floorGrout: 0x8c8075,
    trim: 0xf7f7f4, chrome: 0xb9c2c8, chromeDark: 0x7f8a92, chromeLight: 0xe4eaee,
    phone: 0x2a2e36, phoneEdge: 0x3c414b, caseTeal: 0x04becd,
    bottle: 0xffb3c1, bottleDark: 0xf28fa6, pump: 0xffffff, label: 0xfff3f6,
    duck: 0xffd23f, duckBeak: 0xff8c2b, duckEye: 0x1c1f26,
    shelf: 0xf4f1ea, mat: 0x7fcfd6, matDark: 0x66bcc4, drain: 0x9aa4aa, curtain: 0xffffff, curtainShade: 0xe6f6f7,
    rail: 0xc9d2d7,
  };

  // 체스판 바닥: n×n칸, 한 칸 sq복셀
  function chessFloor(n = 3, sq = 16) {
    const v = new Vox({ jitter: 0.05 });
    const half = (n * sq) / 2;
    for (let i = 0; i < n * sq; i++) for (let j = 0; j < n * sq; j++) {
      const x = i - half, z = j - half;
      const dark = (Math.floor(i / sq) + Math.floor(j / sq)) % 2 === 1;
      v.set(x, -1, z, dark ? COL.sqDark : COL.sqLight);
      v.set(x, -2, z, COL.sqRim);
    }
    return v;
  }

  // 폰: 가운데 아래가 (0,0,0), 화면은 +z쪽. w×h, 두께 1
  const PHONE = { w: 8, h: 14 };
  function phone() {
    const v = new Vox({ jitter: 0.02 });
    const { w, h } = PHONE;
    v.box(0, 0, 0, w - 1, h - 1, 0, COL.phone);
    // 모서리 깎기 + 옆 테두리 살짝 밝게
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) v.del(x, y, 0);
    v.box(0, 2, -1, 0, h - 3, -1, COL.caseTeal).box(w - 1, 2, -1, w - 1, h - 3, -1, COL.caseTeal)
      .box(1, 0, -1, w - 2, 0, -1, COL.caseTeal).box(1, h - 1, -1, w - 2, h - 1, -1, COL.caseTeal)
      .box(1, 1, -1, w - 2, h - 2, -1, COL.caseTeal);
    return v;
  }

  // 바디워시 통 (펌프는 따로 움직인다)
  function bottle() {
    const v = new Vox({ jitter: 0.04 });
    for (let y = 0; y <= 8; y++) v.disc(y, y < 1 ? 2.4 : 2.7, y === 0 ? COL.bottleDark : COL.bottle);
    v.box(-1, 2, 2, 1, 5, 2, COL.label);
    v.set(0, 4, 3, COL.bottleDark); // 상표 무늬 한 점
    v.disc(9, 1.5, COL.bottleDark);
    return v;
  }
  function pump() {
    const v = new Vox();
    v.box(0, 0, 0, 0, 2, 0, COL.pump).box(-1, 3, 0, 1, 3, 0, COL.pump).box(0, 3, 1, 0, 3, 2, COL.pump).set(0, 2, 2, COL.pump);
    return v;
  }

  function duck() {
    const v = new Vox({ jitter: 0.04 });
    v.box(-2, 0, -3, 2, 2, 2, COL.duck);
    v.del(-2, 2, -3).del(2, 2, -3).del(-2, 0, -3).del(2, 0, -3);
    v.box(-1, 3, 0, 1, 5, 2, COL.duck);
    v.box(-1, 2, -4, 1, 3, -4, COL.duck); // 꼬리
    v.box(-1, 3, 3, 1, 3, 4, COL.duckBeak);
    v.set(-1, 5, 2, COL.duckEye).set(1, 5, 2, COL.duckEye);
    return v;
  }

  // 욕실: 뒷벽 z = -back-1, 왼벽 x = -left-1, 바닥 y = -1
  // 왼쪽을 넓혀 바디워시 장면 카메라가 방 안에 있게, 바닥은 앞·오른쪽으로 넓혀 가로 화면 끝에 빈 곳(검정)이 보이지 않게. 왼벽은 sideTo까지만
  const BATH = { left: 40, right: 80, back: 16, front: 100, sideTo: 52, height: 58, tile: 4 };
  const SHELF_Y = 8; // 선반 윗면 높이 (소품은 여기 올린다)
  const SHELVES = [[-23, -14], [14, 27]]; // [왼쪽 x, 오른쪽 x] (칸 번호, 둘 다 포함)
  function bathroom() {
    const v = new Vox({ jitter: 0.06 });
    const { left, right, back, front, height, tile } = BATH;
    const band = 30;
    // 바닥 타일
    for (let x = -left; x <= right; x++) for (let z = -back; z <= front; z++) {
      const gx = (x + left) % tile === 0, gz = (z + back) % tile === 0;
      const alt = (Math.floor((x + left) / tile) + Math.floor((z + back) / tile)) % 2;
      v.set(x, -1, z, gx || gz ? COL.floorGrout : alt ? COL.floorAlt : COL.floor);
    }
    // 배수구
    v.box(-3, -1, -5, 1, -1, -1, COL.drain);
    for (let x = -3; x <= 1; x += 2) v.set(x, -1, -3, COL.chromeDark);
    // 뒷벽
    for (let x = -left - 1; x <= right; x++) for (let y = 0; y < height; y++) {
      const g = (x + left) % tile === 0 || y % tile === 0;
      const alt = (Math.floor((x + left) / tile) + Math.floor(y / tile)) % 2;
      v.set(x, y, -back - 1, y === band ? COL.band : g ? COL.grout : alt ? COL.tileAlt : COL.tile);
    }
    // 왼벽
    for (let z = -back; z <= BATH.sideTo; z++) for (let y = 0; y < height; y++) {
      const g = (z + back) % tile === 0 || y % tile === 0;
      const alt = (Math.floor((z + back) / tile) + Math.floor(y / tile)) % 2;
      v.set(-left - 1, y, z, y === band ? COL.band : g ? COL.grout : alt ? COL.tileAlt : COL.tile);
    }
    // 벽 아래 띠 (흰 몰딩)
    for (let x = -left; x <= right; x++) v.set(x, 0, -back, COL.trim);
    for (let z = -back; z <= BATH.sideTo; z++) v.set(-left, 0, z, COL.trim);
    // 선반 두 개 (뒷벽): 왼쪽은 바디워시, 오른쪽은 폰. 큰 블록 캐릭터의 목도리(높이 8.8)보다 낮게, 캐릭터가 서는 자리와 겹치지 않게
    for (const [x0, x1] of SHELVES) {
      v.box(x0, SHELF_Y - 1, -back, x1, SHELF_Y - 1, -back + 4, COL.shelf);
      v.box(x0, SHELF_Y - 2, -back, x1, SHELF_Y - 2, -back + 1, 0xdedad0);
    }
    // 샤워기 관: 벽에서 앞으로 나와 아래로
    v.box(-1, 45, -back, -1, 45, -7, COL.chrome);
    v.set(-1, 44, -7, COL.chrome);
    // 수도꼭지 (벽): 캐릭터 머리 꼭대기(22)보다 위
    v.box(-4, 27, -back, 2, 29, -back, COL.chromeDark);
    v.box(-2, 28, -back + 1, 0, 28, -back + 2, COL.chrome);
    // 수건걸이 + 수건 (왼벽)
    v.box(-left, 34, -6, -left, 34, 12, COL.rail);
    v.box(-left + 1, 20, -4, -left + 1, 34, 9, 0x2fb5c2);
    v.box(-left + 1, 20, -4, -left + 1, 20, 9, 0x1f97a3);
    for (let z = -4; z <= 9; z += 3) v.box(-left + 2, 21, z, -left + 2, 33, z, 0x5fcbd5);
    // 욕실 깔개
    v.box(-16, 0, 14, -2, 0, 24, (x, y, z) => ((x + z) % 3 === 0 ? COL.matDark : COL.mat));
    return v;
  }
  // 샤워기 머리 (물 나오는 쪽, 따로 그려서 흔들 수 있게)
  function showerHead() {
    const v = new Vox({ jitter: 0.03 });
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= 10) v.set(x, 0, z, COL.chrome);
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 5) v.set(x, 1, z, COL.chromeLight);
    for (let x = -2; x <= 2; x += 2) for (let z = -2; z <= 2; z += 2) if (x * x + z * z <= 5) v.set(x, -1, z, COL.chromeDark);
    v.box(0, 2, 0, 0, 3, 0, COL.chrome);
    return v;
  }

  global.Sets = { COL, chessFloor, phone, PHONE, bottle, pump, duck, bathroom, BATH, SHELF_Y, SHELVES, showerHead };
})(typeof window !== 'undefined' ? window : globalThis);
