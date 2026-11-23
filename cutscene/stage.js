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
    constructor({ gl, hud, scene, maxDpr = 2 }) {
      this.glCanvas = gl; this.hudCanvas = hud; this.scene = scene; this.maxDpr = maxDpr;
      this.R = new Renderer(gl, { preserve: true });
      this.pix = new global.Pix(hud);
      this.t = 0; this.playing = false; this.speed = 1;
      scene.init(this);
      this.resize();
      let pending = 0;
      addEventListener('resize', () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => { this.resize(); this.renderAt(this.t); }); });
    }
    resize() {
      const w = innerWidth, h = innerHeight;
      const dpr = Math.min(this.maxDpr, devicePixelRatio || 1);
      this.glCanvas.width = Math.round(w * dpr); this.glCanvas.height = Math.round(h * dpr);
      this.cssW = w; this.cssH = h; this.aspect = w / h;
      this.pix.resize(w, h);
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
      const tick = (now) => {
        if (!this.playing) return;
        const dt = Math.min(0.1, (now - this._last) / 1000);
        this._last = now;
        let t = this.t + dt * this.speed;
        const D = this.scene.duration;
        if (D && t >= D) { t = D; this.playing = false; if (this.scene.onEnd) this.scene.onEnd(this); }
        this.renderAt(t);
        if (this.playing) this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }
    pause() { this.playing = false; cancelAnimationFrame(this._raf); }
  }

  global.Stage = Stage;
  global.fitCam = fitCam;
})(typeof window !== 'undefined' ? window : globalThis);
