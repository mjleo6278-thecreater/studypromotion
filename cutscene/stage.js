// 무대: 캔버스 크기 맞추기, 카메라 맞추기, 시간 → 그림 (renderAt), 재생 고리
(function (global) {
  'use strict';
  const { Renderer } = global.Vox3D;

  // 상자(가운데 target, 반폭 rw, 반높이 rh)가 화면에 다 들어오게 카메라 거리 정하기.
  // 세로 폰에서는 폭이, 가로 화면에서는 높이가 거리를 정한다.
  function fitCam(target, rw, rh, yaw, pitch, fov, aspect, extra = {}) {
    const tv = Math.tan(fov / 2), th = tv * aspect;
    const d = Math.max(rw / th, rh / tv);
    const cp = Math.cos(pitch);
    const eye = [target[0] + Math.sin(yaw) * cp * d, target[1] + Math.sin(pitch) * d, target[2] + Math.cos(yaw) * cp * d];
    const r = Math.max(rw, rh);
    return Object.assign({ eye, target, fov, near: Math.max(0.5, d - r * 4), far: d + r * 5 }, extra);
  }

  class Stage {
    // maxDpr: 3D를 그릴 최대 화면 밀도. 느린 기기에서는 재생 중에 minDpr까지 자동으로 낮춘다(프레임 우선).
    constructor({ gl, hud, scene, maxDpr = 3, minDpr = 1.5, preserve = false }) {
      this.glCanvas = gl; this.hudCanvas = hud; this.scene = scene; this.maxDpr = maxDpr; this.minDpr = minDpr;
      this.dprCap = maxDpr;
      this.R = new Renderer(gl, { preserve });
      this.pix = new global.Pix(hud);
      this.t = 0; this.playing = false; this.speed = 1;
      scene.init(this);
      this.resize();
      let pending = 0;
      addEventListener('resize', () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { this.resize(); this.renderAt(this.t); }); });
    }
    resize() {
      const box = this.glCanvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(box.width || innerWidth)), h = Math.max(1, Math.round(box.height || innerHeight));
      this.offX = box.left || 0; this.offY = box.top || 0;
      const dev = devicePixelRatio || 1;
      const dpr = Math.min(this.dprCap, dev);
      this.dpr = dpr;
      this.glCanvas.width = Math.round(w * dpr); this.glCanvas.height = Math.round(h * dpr);
      this.cssW = w; this.cssH = h; this.aspect = w / h;
      this.pix.resize(w, h, dev);
      if (this.scene.resize) this.scene.resize(this);
    }
    renderAt(t) {
      this.t = t;
      const frame = this.scene.frame(t, this);
      this.R.render(frame);
      this.pix.clear();
      if (this.scene.hud) this.scene.hud(t, this.pix, frame, this);
      return frame;
    }
    play(from) {
      if (from != null) this.t = from;
      this.playing = true;
      this._last = performance.now();
      this._slow = 0; this._n = 0;
      const tick = (now) => {
        if (!this.playing) return;
        const raw = (now - this._last) / 1000;
        const dt = Math.min(0.1, raw);
        this._last = now;
        this._adapt(raw);
        let t = this.t + dt * this.speed;
        const D = this.scene.duration;
        if (D && t >= D) { t = D; this.playing = false; if (this.scene.onEnd) this.scene.onEnd(this); }
        this.renderAt(t);
        if (this.playing) this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
    pause() { this.playing = false; cancelAnimationFrame(this._raf); }
    // 45프레임 동안 평균이 24ms(약 42fps)보다 느리면 3D 해상도를 한 단계(×0.8) 낮춘다. 다시 올리지는 않는다.
    _adapt(raw) {
      if (raw <= 0 || raw > 0.25) return; // 탭을 떠났다 온 경우 등은 세지 않음
      this._n++; this._slow += raw;
      if (this._n < 45) return;
      const avg = this._slow / this._n;
      this._n = 0; this._slow = 0;
      if (avg > 0.024 && this.dpr > this.minDpr + 0.01) {
        this.dprCap = Math.max(this.minDpr, this.dpr * 0.8);
        this.resize();
      }
    }
  }

  global.Stage = Stage;
  global.fitCam = fitCam;
})(typeof window !== 'undefined' ? window : globalThis);
