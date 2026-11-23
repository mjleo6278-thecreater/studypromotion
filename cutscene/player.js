// 컷씬 재생기: 시작 단추, 건너뛰기·소리·다시 보기, 시험용 고리(window.Cutscene)
(function () {
  'use strict';
  const scene = window.ShowerScene;
  const $ = (id) => document.getElementById(id);
  let st;
  try {
    // ?still(시험·영상 뽑기)일 때만 그린 그림을 남겨 둔다. 폰에서 재생할 때는 남기지 않아야 빠르다.
    st = new Stage({ gl: $('gl'), hud: $('hud'), scene, preserve: /[?&]still/.test(location.search) });
  } catch (e) {
    $('nogl').style.display = 'grid';
    $('start').remove();
    return;
  }
  const sfx = new Sfx();
  const CUES = scene.cues();
  scene.ui = { muted: false };
  scene.waiting = !/[?&]still/.test(location.search);

  // 픽셀 단추 위에 투명한 진짜 단추 (손가락 44px 이상)
  const hits = $('hits');
  function syncHits() {
    const bs = scene.buttons || [];
    while (hits.children.length > bs.length) hits.lastChild.remove();
    while (hits.children.length < bs.length) { const b = document.createElement('button'); b.className = 'hit'; b.addEventListener('click', onHit); hits.appendChild(b); }
    const P = st.pix.px;
    bs.forEach((bt, i) => {
      const el = hits.children[i];
      const w = Math.max(44, bt.w * P), h = Math.max(44, bt.h * P);
      const cx = (bt.x + bt.w / 2) * P, cy = (bt.y + bt.h / 2) * P;
      const left = Math.max(0, Math.min(st.cssW - w, cx - w / 2)) + st.offX;
      const css = `left:${left}px;top:${Math.max(0, cy - h / 2) + st.offY}px;width:${w}px;height:${h}px`;
      // 바뀐 것만 고친다 (매 프레임 스타일을 다시 쓰면 폰에서 프레임이 떨어진다)
      if (el._css !== css) { el.style.cssText = css; el._css = css; }
      if (el.dataset.id !== bt.id) { el.dataset.id = bt.id; el.setAttribute('aria-label', bt.label); }
    });
  }
  function onHit(e) {
    const id = e.currentTarget.dataset.id;
    if (id === 'sound') {
      scene.ui.muted = !scene.ui.muted;
      sfx.on = !scene.ui.muted;
      if (sfx.on && st.playing) { sfx.unlock(); sfx.start(CUES, st.t); } else sfx.stop();
      if (!st.playing) draw(st.t);
    } else if (id === 'skip') {
      go(scene.SHOT.END);
    } else if (id === 'replay') {
      go(0);
    }
  }
  let lastSub = '';
  function draw(t) {
    st.renderAt(t);
    syncHits();
    // 화면 읽기 프로그램용 자막
    const s = scene.SUBS.find((x) => t >= x.t0 && t <= x.t1);
    const txt = s ? Pix.plain(s.text).replace('\n', ' ') : t >= scene.SHOT.END ? '새 기능: 말로 외우는 단어장. 뜻을 소리 내어 말하면 넘어가요.' : '';
    if (txt !== lastSub) { lastSub = txt; if (txt) $('live').textContent = txt; }
  }
  // Stage의 재생 고리가 그릴 때마다 단추도 맞춘다
  const origRender = st.renderAt.bind(st);
  st.renderAt = (t) => { const f = origRender(t); syncHits(); const s = scene.SUBS.find((x) => t >= x.t0 && t <= x.t1); const txt = s ? Pix.plain(s.text).replace('\n', ' ') : ''; if (txt && txt !== lastSub) { lastSub = txt; $('live').textContent = txt; } return f; };

  function go(t) {
    scene.waiting = false;
    $('start').hidden = true;
    st.pause();
    if (sfx.on) { sfx.unlock(); sfx.start(CUES, t); }
    st.play(t);
  }
  scene.onEnd = () => { syncHits(); };

  // 첫 화면: 제목 카드에서 기다림 ("눌러서 보기"가 깜빡)
  let idle = 0;
  function waitLoop(now) {
    if (!scene.waiting) return;
    draw(Math.floor(now / 500) % 2 ? 1.6 : 2.1);
    idle = requestAnimationFrame(waitLoop);
  }
  $('start').addEventListener('click', () => { cancelAnimationFrame(idle); go(0); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.playing) go(scene.SHOT.END);
  });

  const ready = document.fonts && document.fonts.load ? Promise.all([document.fonts.load('800 16px "Pretendard Variable"', '샤워하다 생긴 기능' + scene.SUBS.map((s) => s.text || '').join('')), document.fonts.ready]).catch(() => {}) : Promise.resolve();
  ready.then(() => {
    if (scene.waiting) idle = requestAnimationFrame(waitLoop);
    else { $('start').hidden = true; draw(0); }
  });

  // 시험용 고리
  window.Cutscene = {
    duration: scene.duration,
    renderAt(t) { scene.waiting = false; $('start').hidden = true; st.pause(); draw(t); return { stats: Object.assign({}, st.R.stats), buttons: (scene.buttons || []).map((b) => b.id) }; },
    play: go,
    state: () => ({ t: st.t, playing: st.playing, muted: scene.ui.muted, buttons: (scene.buttons || []).map((b) => b.id) }),
    cues: () => CUES,
    renderAudio: async () => {
      const { bytes, peak } = await Sfx.render(CUES, scene.duration);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { b64: btoa(s), peak };
    },
  };
})();
