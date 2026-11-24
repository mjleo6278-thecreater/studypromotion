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
