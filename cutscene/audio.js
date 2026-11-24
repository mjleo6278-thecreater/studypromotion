// 효과음: 파일 없이 Web Audio로 합성. 같은 일정(cues)을 실시간으로도, 오프라인(영상용)으로도 재생한다.
(function (global) {
  'use strict';
  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI 번호 → Hz

  let noiseBuf = null;
  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    return noiseBuf;
  }
  function env(g, t, a, peak, d, end = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(end, t + a + d);
  }
  function tone(ctx, out, t, type, f0, f1, dur, vol, a = 0.004) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, a, vol, dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + a + dur + 0.02);
    return o;
  }
  function hiss(ctx, out, t, dur, vol, type, f0, f1, q = 1, a = 0.01) {
    const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, a, vol, dur);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + a + dur + 0.02);
    return s;
  }

  // 소리 하나: (ctx, 출력, 시각, 값)
  const SFX = {
    blip(c, o, t, p) { tone(c, o, t, 'square', p.f || 660, null, 0.035, 0.035); },
    voice(c, o, t, p) { // 캐릭터 말소리 (뜻 없는 음절)
      const f = p.f || 520;
      tone(c, o, t, 'square', f, f * (p.up ? 1.25 : 0.85), 0.09, 0.06);
      tone(c, o, t, 'triangle', f * 2, f * 2.2, 0.07, 0.03);
    },
    shower(c, o, t, p) { // 물소리 (길게)
      const dur = p.dur || 5;
      const s = c.createBufferSource(); s.buffer = noise(c); s.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.5;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
      const g = c.createGain();
      const v = p.vol || 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.6);
      g.gain.setValueAtTime(v, t + Math.max(0.7, dur - 0.8));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(bp).connect(hp).connect(g).connect(o); s.start(t); s.stop(t + dur + 0.05);
    },
    note(c, o, t, p) { tone(c, o, t, 'triangle', NOTE(p.n), null, p.d || 0.22, p.v || 0.07, 0.01); },
    pump(c, o, t) { hiss(c, o, t, 0.16, 0.12, 'lowpass', 1800, 300, 1); tone(c, o, t, 'sine', 180, 90, 0.08, 0.12); },
    squish(c, o, t) { hiss(c, o, t, 0.12, 0.07, 'bandpass', 900, 1600, 3); },
    pop(c, o, t, p) { tone(c, o, t, 'sine', p.f || 900, (p.f || 900) * 1.6, 0.04, 0.06); },
    tap(c, o, t) { tone(c, o, t, 'sine', 1900, 1500, 0.02, 0.09, 0.001); hiss(c, o, t, 0.03, 0.05, 'highpass', 3000, null, 1, 0.001); },
    error(c, o, t) { tone(c, o, t, 'square', 233, 233, 0.08, 0.06); tone(c, o, t + 0.1, 'square', 175, 175, 0.12, 0.06); },
    squeak(c, o, t) { tone(c, o, t, 'sine', 1500, 700, 0.22, 0.07, 0.01); },
    grr(c, o, t) { tone(c, o, t, 'sawtooth', 110, 90, 0.35, 0.05, 0.02); tone(c, o, t + 0.05, 'sawtooth', 116, 95, 0.3, 0.03, 0.02); },
    idea(c, o, t) { [84, 88, 91, 96].forEach((n, i) => tone(c, o, t + i * 0.06, 'square', NOTE(n), null, 0.12, 0.05)); hiss(c, o, t + 0.2, 0.4, 0.03, 'highpass', 6000, 9000, 1); },
    whoosh(c, o, t) { hiss(c, o, t, 0.28, 0.08, 'bandpass', 400, 2400, 1.5, 0.05); },
    mic(c, o, t) { tone(c, o, t, 'sine', NOTE(76), NOTE(83), 0.12, 0.06, 0.01); },
    correct(c, o, t) { tone(c, o, t, 'triangle', NOTE(88), null, 0.12, 0.09); tone(c, o, t + 0.09, 'triangle', NOTE(93), null, 0.3, 0.09); tone(c, o, t + 0.09, 'square', NOTE(81), null, 0.2, 0.025); },
    flip(c, o, t) { hiss(c, o, t, 0.09, 0.06, 'bandpass', 1200, 3000, 2, 0.005); },
    wipe(c, o, t) { hiss(c, o, t, 0.5, 0.05, 'bandpass', 300, 3000, 1.2, 0.08); },
    jingle(c, o, t) {
      const mel = [[72, 0, 0.12], [76, 0.12, 0.12], [79, 0.24, 0.12], [84, 0.36, 0.5]];
      for (const [n, s, d] of mel) { tone(c, o, t + s, 'square', NOTE(n), null, d, 0.05); tone(c, o, t + s, 'triangle', NOTE(n - 12), null, d, 0.06); }
      tone(c, o, t + 0.36, 'triangle', NOTE(64), null, 0.6, 0.04); tone(c, o, t + 0.36, 'triangle', NOTE(67), null, 0.6, 0.04);
    },
    hop(c, o, t) { tone(c, o, t, 'square', 300, 600, 0.07, 0.035); },
  };

  class Sfx {
    constructor() { this.ctx = null; this.on = true; this.live = []; }
    unlock() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.out = this.ctx.createGain(); this.out.gain.value = 3.2; this.out.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    // 시각 from부터 cues를 예약 (지금 = from)
    start(cues, from) {
      this.stop();
      if (!this.ctx || !this.on) return;
      const now = this.ctx.currentTime + 0.03;
      this.bus = this.ctx.createGain(); this.bus.connect(this.out);
      for (const q of cues) {
        if (q.t < from - (q.dur || 0)) continue;
        const fn = SFX[q.s]; if (!fn) continue;
        const at = now + Math.max(0, q.t - from);
        const p = Object.assign({}, q);
        if (q.t < from && q.dur) p.dur = q.dur - (from - q.t);
        try { fn(this.ctx, this.bus, at, p); } catch (e) { /* 소리 하나 실패는 넘어감 */ }
      }
    }
    stop() { if (this.bus) { try { this.bus.disconnect(); } catch (e) { /* 무시 */ } this.bus = null; } }
    // 오프라인 렌더링 → 16비트 WAV (영상에 붙이기, 소리가 비어 있지 않은지 시험)
    static async render(cues, dur, rate = 44100) {
      const ctx = new OfflineAudioContext(2, Math.ceil(dur * rate), rate);
      const out = ctx.createGain(); out.gain.value = 3.2; out.connect(ctx.destination);
      for (const q of cues) { const fn = SFX[q.s]; if (fn) fn(ctx, out, Math.max(0, q.t), Object.assign({}, q)); }
      const buf = await ctx.startRendering();
      return Sfx.wav(buf);
    }
    static wav(buf) {
      const ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate;
      const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
      const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, rate, true);
      dv.setUint32(28, rate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * ch * 2, true);
      const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
      let o = 44, peak = 0;
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); peak = Math.max(peak, Math.abs(v)); dv.setInt16(o, v * 32767, true); o += 2; }
      return { bytes: new Uint8Array(dv.buffer), peak };
    }
  }
  global.Sfx = Sfx;
  global.SFX_LIST = Object.keys(SFX);
})(typeof window !== 'undefined' ? window : globalThis);
