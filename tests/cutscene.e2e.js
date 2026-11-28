// 업데이트 컷씬 시제품 눌러 보기: 시작 → 소리 끄기·켜기 → 건너뛰기 → 다시 보기, 폰 세로·가로
// 실행: NODE_PATH=$(npm root -g) node tests/cutscene.e2e.js  (저장소 루트를 http://127.0.0.1:8765 로 띄운 상태)
const { chromium } = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://127.0.0.1:8765';

(async () => {
  const b = await chromium.launch();
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
    const p = await b.newPage({ viewport: vp, hasTouch: true });
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE + '/cutscene/index.html');
    await p.waitForFunction(() => window.Cutscene);
    // 1) 처음엔 제목 카드에서 기다린다 (재생 안 함)
    await p.waitForTimeout(400);
    let s = await p.evaluate(() => window.Cutscene.state());
    assert.strictEqual(s.playing, false, '누르기 전엔 재생하지 않음');
    // 2) 화면을 누르면 재생
    await p.touchscreen.tap(vp.width / 2, vp.height / 2);
    await p.waitForTimeout(700);
    s = await p.evaluate(() => window.Cutscene.state());
    assert.ok(s.playing && s.t > 0.2, '누르면 재생: ' + JSON.stringify(s));
    assert.deepStrictEqual(s.buttons.sort(), ['skip', 'sound'], '재생 중 단추: 소리, 건너뛰기');
    // 단추 크기 44px 이상
    const sizes = await p.$$eval('.hit', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.id, Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.right)]; }));
    for (const [id, w, h, l, r] of sizes) {
      assert.ok(w >= 44 && h >= 44, `${id} 단추가 44px보다 작음 ${w}x${h}`);
      assert.ok(l >= 0 && r <= vp.width, `${id} 단추가 화면 밖 ${l}~${r}`);
    }
    // 3) 소리 끄기 → 켜기
    await p.click('.hit[data-id="sound"]');
    s = await p.evaluate(() => window.Cutscene.state());
    assert.strictEqual(s.muted, true, '소리 끄기');
    await p.click('.hit[data-id="sound"]');
    s = await p.evaluate(() => window.Cutscene.state());
    assert.strictEqual(s.muted, false, '소리 켜기');
    // 4) 건너뛰기 → 끝 화면, 다시 보기 단추가 나온다
    await p.click('.hit[data-id="skip"]');
    await p.waitForTimeout(900);
    s = await p.evaluate(() => window.Cutscene.state());
    assert.ok(s.t >= 27.8, '건너뛰기 → 끝 화면: ' + s.t);
    assert.ok(s.buttons.includes('replay') && !s.buttons.includes('skip'), '끝 화면 단추: ' + s.buttons);
    // 5) 다시 보기 → 처음부터
    await p.click('.hit[data-id="replay"]');
    await p.waitForTimeout(500);
    s = await p.evaluate(() => window.Cutscene.state());
    assert.ok(s.playing && s.t < 2, '다시 보기 → 처음부터: ' + s.t);
    // 6) 끝까지 두면 멈추고 다시 보기 단추가 남는다 (빨리 감기로 확인)
    await p.evaluate(() => window.Cutscene.play(31.5));
    await p.waitForTimeout(1200);
    s = await p.evaluate(() => window.Cutscene.state());
    assert.ok(!s.playing && s.t === 32 && s.buttons.includes('replay'), '끝에서 멈춤: ' + JSON.stringify(s));
    // 7) 소리 일정과 오프라인 소리: 비어 있지 않음
    const audio = await p.evaluate(() => window.Cutscene.renderAudio().then((a) => a.peak));
    assert.ok(audio > 0.05 && audio <= 1, '소리 크기 ' + audio);
    assert.deepStrictEqual(errs, [], '페이지 오류');
    console.log(`ok ${vp.width}x${vp.height}: 시작·소리·건너뛰기·다시 보기·끝, 소리 최고 ${audio.toFixed(2)}`);
    await p.close();
  }
  // 겹침 없음: 0.05초마다 캐릭터(몸·머리·손)가 벽·선반·바디워시 통·수도꼭지·폰 속으로 들어가지 않고, 폰도 벽·선반에 파고들지 않음
  // (2026-11-24 사용자: "폰의 일부분이 자꾸 벽에 껴있다" — 큰 블록 캐릭터로 바꾼 뒤 머리가 벽·통을 뚫던 문제)
  {
    const q = await b.newPage({ viewport: { width: 390, height: 844 } });
    await q.goto(BASE + '/cutscene/index.html?still');
    await q.waitForFunction(() => window.ShowerScene && window.ShowerScene.LAYOUT);
    const r = await q.evaluate(() => {
      const S = window.ShowerScene, M4 = window.Vox3D.M4, Pawn = window.Pawn, Sets = window.Sets, L = S.LAYOUT;
      const dummy = { body: 'body', head: 'head', hand: 'hand', point: 'hand', thumb: 'hand', sweat: 'x', eyes: { normal: 'x' }, mouths: { closed: 'x' }, blush: 'x' };
      // pawn.js의 칸 범위 (몸: 받침 6×6 · 4×4 · 목 2×2 · 목도리 6×6, 머리 6×5×6, 손 한 칸)
      const shapes = { body: [[-3, 0, -3, 3, 1, 3], [-2, 1, -2, 2, 2, 2], [-1, 2, -1, 1, 4, 1], [-3, 4, -3, 3, 5, 3]], head: [[-3, 0, -3, 3, 5, 3]], hand: [[0, 0, 0, 1, 1, 1]] };
      const pts = (bx, n = 4) => { const o = []; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) o.push([bx[0] + (bx[3] - bx[0]) * i / n, bx[1] + (bx[4] - bx[1]) * j / n, bx[2] + (bx[5] - bx[2]) * k / n]); return o; };
      const back = -Sets.BATH.back;
      const toPhone = (m, w) => { const d = [w[0] - m[12], w[1] - m[13], w[2] - m[14]]; return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2] + 4, m[4] * d[0] + m[5] * d[1] + m[6] * d[2], m[8] * d[0] + m[9] * d[1] + m[10] * d[2] + 0.5]; };
      const hitsOf = (w, pm) => {
        const h = [];
        if (w[2] < back) h.push('벽');
        for (const [x0, x1] of Sets.SHELVES) if (w[0] >= x0 && w[0] <= x1 + 1 && w[1] >= Sets.SHELF_Y - 2 && w[1] <= Sets.SHELF_Y && w[2] <= back + 5) h.push('선반');
        if (Math.hypot(w[0] - L.BOTTLE_AT[0], w[2] - L.BOTTLE_AT[2]) < 2.9 && w[1] >= L.BOTTLE_AT[1] && w[1] <= L.BOTTLE_AT[1] + 10) h.push('통');
        if (w[0] >= -4 && w[0] <= 3 && w[1] >= 27 && w[1] <= 30 && w[2] <= back + 3) h.push('수도꼭지');
        const c = toPhone(pm, w);
        if (c[0] > 0 && c[0] < 8 && c[1] > 0 && c[1] < 14 && c[2] > -1 && c[2] < 1) h.push('폰');
        return h;
      };
      const bad = [];
      for (let t = 0; t <= S.duration + 1e-6; t += 0.05) {
        const pose = S.pawnPose(t), pm = S.phoneMatrix(t), seen = new Set();
        for (const it of Pawn.items(dummy, pose)) {
          if (!shapes[it.mesh]) continue;
          for (const bx of shapes[it.mesh]) for (const p of pts(bx)) for (const h of hitsOf(M4.apply(it.m, p), pm)) seen.add(it.mesh + '→' + h);
        }
        for (const p of pts([0, 0, -1, 8, 14, 1])) { const w = M4.apply(pm, p); if (w[2] < back - 0.01) seen.add('폰→벽'); if (w[1] < Sets.SHELF_Y - 0.01) seen.add('폰→선반'); }
        if (seen.size) bad.push(t.toFixed(2) + 's ' + [...seen].join(','));
      }
      // 얼굴(눈·입·볼)은 그림자를 만들지 않고, 머리는 그림자를 받지 않는다
      const its = Pawn.items(dummy, S.pawnPose(18));
      const face = its.filter((i) => i.mesh === 'x');
      const head = its.find((i) => i.mesh === 'head');
      return { bad, faceOk: face.length >= 3 && face.every((i) => i.shadow === false && i.recv === false), headOk: head.recv === false };
    });
    assert.deepStrictEqual(r.bad.slice(0, 5), [], '겹치는 순간 ' + r.bad.length + '번');
    assert.ok(r.faceOk && r.headOk, '얼굴 그림자 끔');
    console.log('ok 겹침 없음 (0.05초마다 641장면) · 얼굴 그림자 끔');
    await q.close();
  }
  // 글씨 선명: 글자 층 캔버스가 기기 해상도이고, 글자 가장자리가 매끈하다(반투명 단계가 여럿)
  // (2026-11-24 사용자: "적은 픽셀로 표현하는데 치중해서 글씨가 더러워 보이고 잘 안 읽혀")
  {
    const q = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    await q.goto(BASE + '/cutscene/index.html?still');
    await q.waitForFunction(() => window.Cutscene && document.fonts.status === 'loaded');
    const r = await q.evaluate(() => {
      window.Cutscene.renderAt(6); // 자막 "샤워할 때도 / 단어를 외우고 싶었어요"
      const cv = document.getElementById('hud'), g = cv.getContext('2d');
      const y0 = Math.round(cv.height * 0.75), d = g.getImageData(0, y0, cv.width, cv.height - y0).data;
      const cols = new Set();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) cols.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return { w: cv.width, css: cv.getBoundingClientRect().width, colors: cols.size };
    });
    assert.ok(Math.abs(r.w - r.css * 3) <= 6, '글자 층이 기기 해상도: ' + r.w + ' / ' + r.css);
    assert.ok(r.colors > 40, '글자 가장자리 색 단계 ' + r.colors);
    console.log('ok 글씨 선명 (캔버스 ' + r.w + 'px, 자막 색 단계 ' + r.colors + ')');
    await q.close();
  }
  // 캐릭터 화면: 표정 단추 누르기
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await p.goto(BASE + '/cutscene/character.html');
  await p.waitForFunction(() => window.Sheet);
  await p.waitForTimeout(300);
  const n = await p.$$eval('.hit', (els) => els.length);
  assert.strictEqual(n, 4, '표정 단추 4개');
  await p.click('.hit:nth-child(3)');
  assert.strictEqual(await p.evaluate(() => window.Sheet.scene.expr), 2, '답답 표정으로 바뀜');
  console.log('ok 캐릭터 화면: 표정 단추');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
