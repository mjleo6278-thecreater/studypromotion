// 픽셀 화면 층: 판·아이콘은 큰 픽셀 칸(CSS 2~3px)으로 또박또박, 글자는 기기 해상도로 매끈하게.
// 캔버스는 기기 픽셀 그대로 만들고 "픽셀 한 칸 = 기기 픽셀 k개"로 늘려 그린다(setTransform).
// 그래서 좌표·크기는 예전처럼 픽셀 칸 단위로 쓰고, 글자만 앱에 들어 있는 Pretendard로 선명하게 나온다.
// (예전에는 글자도 작은 칸에 그린 뒤 반투명을 없앴더니 한글 획이 뭉개져 읽기 어려웠다.)
(function (global) {
  'use strict';
  const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const PAD = 2; // 글자 그림 둘레 여백 (칸): 테두리·그림자 자리

  // 작은 아이콘 (# = 칠함)
  const ICONS = {
    pawn: ['..##..', '.####.', '.####.', '..##..', '.####.', '..##..', '.####.', '######'],
    queen: ['#.##.#', '#.##.#', '######', '.####.', '.####.', '..##..', '.####.', '######'],
    note: ['..###', '..#.#', '..#.#', '..#..', '###..', '###..'],
    note2: ['.####', '.#..#', '.#..#', '##.##', '##.##'],
    bang: ['##', '##', '##', '##', '..', '##'],
    ques: ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'],
    skip: ['#...#..#', '##..##.#', '###.####', '##..##.#', '#...#..#'],
    soundOn: ['...#....', '..##.#..', '####..#.', '####..#.', '####..#.', '..##.#..', '...#....'],
    soundOff: ['...#....', '..##....', '####.#.#', '####..#.', '####.#.#', '..##....', '...#....'],
    replay: ['..####..', '.#....#.', '#......#', '#....###', '#.....#.', '.#......', '..####..'],
    play: ['#....', '##...', '###..', '####.', '###..', '##...', '#....'],
    check: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
    cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    mic: ['.##.', '####', '####', '####', '.##.', '#..#', '.##.', '.##.'],
    clock: ['.###.', '#.#.#', '#.###', '#...#', '.###.'],
    spark: ['..#..', '..#..', '##.##', '..#..', '..#..'],
    heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
    hand: ['.#.#.', '.#.#.', '#####', '#####', '.###.'],
    wave: ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
    waveL: ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  };

  class Pix {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.cache = new Map();
      this.px = 2; this.w = 1; this.h = 1; this.k = 1;
      // 글꼴 조각이 늦게 들어오면(처음 쓰는 글자) 대신 글꼴로 만든 글자 그림을 버리고 다시 만든다
      if (global.document && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => this.cache.clear());
    }
    _scale(k) {
      if (k !== this.k) this.cache.clear();
      this.k = k;
      this.ctx.setTransform(k, 0, 0, k, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
    }
    // 픽셀 한 칸 = CSS 2px(큰 화면 3px)에 가깝되, 기기 픽셀로는 딱 정수 k가 되게 (2.75배 폰에서도 칸 크기가 고르게)
    resize(cssW, cssH, dpr = 1) {
      const minSide = Math.min(cssW, cssH);
      const want = minSide >= 700 ? 3 : 2;
      const k = Math.max(1, Math.round(want * dpr));
      this.px = k / dpr;
      this.w = Math.ceil(cssW / this.px);
      this.h = Math.ceil(cssH / this.px);
      this.cv.width = this.w * k; this.cv.height = this.h * k;
      this.cv.style.width = this.w * this.px + 'px';
      this.cv.style.height = this.h * this.px + 'px';
      this._scale(k);
    }
    // 캔버스 크기는 그대로 두고 w×h 칸을 칸당 k픽셀로 쓰기 (폰 화면 텍스처)
    fixed(w, h, k) { this.w = w; this.h = h; this.px = 1; this._scale(k); }
    clear() { this.ctx.clearRect(0, 0, this.w, this.h); }
    // 화면 비율 좌표(0~1) → 픽셀 좌표
    at(fx, fy) { return [Math.round(fx * this.w), Math.round(fy * this.h)]; }

    // ----- 글자 (기기 해상도로 그려 둔 그림을 붙인다) -----
    _font(size, weight) { return `${weight} ${size * this.k}px ${FONT}`; }
    _measure() { if (!this._mg) this._mg = document.createElement('canvas').getContext('2d'); return this._mg; }
    // 글자 폭 (칸, 소수): 기기 해상도 글꼴로 잰다
    _wf(str, size, weight = 800) {
      const key = 'w|' + size + '|' + weight + '|' + str;
      let v = this.cache.get(key);
      if (v == null) {
        const g = this._measure(); g.font = this._font(size, weight);
        v = g.measureText(str).width / this.k;
        this.cache.set(key, v);
      }
      return v;
    }
    textWidth(str, size, weight = 800) { return Math.ceil(this._wf(str, size, weight)); }
    _glyph(str, size, weight, color, outline, shadow) {
      const key = 'g|' + size + '|' + weight + '|' + color + '|' + (outline || '') + '|' + (shadow || '') + '|' + str;
      let t = this.cache.get(key);
      if (t) return t;
      const k = this.k, c = document.createElement('canvas'), g = c.getContext('2d');
      g.font = this._font(size, weight);
      const tw = g.measureText(str).width;
      c.width = Math.max(1, Math.ceil(tw + PAD * 2 * k)); c.height = Math.ceil((size * 1.3 + PAD * 2) * k);
      g.font = this._font(size, weight); g.textBaseline = 'alphabetic';
      const bx = PAD * k, by = (PAD + size * 0.98) * k; // 글자 밑줄: 예전 픽셀 글자와 같은 자리
      if (shadow) { g.fillStyle = shadow; g.fillText(str, bx, by + k); }
      if (outline) { g.strokeStyle = outline; g.lineWidth = 2.6 * k; g.lineJoin = 'round'; g.strokeText(str, bx, by); }
      g.fillStyle = color; g.fillText(str, bx, by);
      // 글자마다 끝 위치 (타자기처럼 한 글자씩 보일 때), 기기 픽셀
      const adv = [];
      for (let i = 1; i <= str.length; i++) adv.push(bx + g.measureText(str.slice(0, i)).width);
      t = { cv: c, adv, edge: outline ? 1.3 * k : 1 };
      this.cache.set(key, t);
      return t;
    }
    // align: 'left' | 'center' | 'right'. outline: 테두리 색, shadow: 1칸 아래 그림자 색
    text(str, x, y, size, color, opts = {}) {
      if (!str) return 0;
      const weight = opts.weight || 800;
      const wf = this._wf(str, size, weight), w = Math.ceil(wf), k = this.k;
      const t = this._glyph(str, size, weight, color, opts.outline, opts.shadow);
      let dx = x;
      if (opts.align === 'center') dx = x - wf / 2;
      else if (opts.align === 'right') dx = x - wf;
      dx = Math.round(dx * k) / k; // 기기 픽셀에 딱 맞춰 붙여야 흐려지지 않는다
      const n = opts.chars == null ? str.length : Math.min(opts.chars, str.length);
      if (n <= 0) return w;
      const src = n >= str.length ? t.cv.width : Math.min(t.cv.width, Math.ceil(t.adv[n - 1] + t.edge));
      this.ctx.drawImage(t.cv, 0, 0, src, t.cv.height, dx - PAD, y - PAD, src / k, t.cv.height / k);
      return w;
    }
    // [강조], {강조2} 표시가 들어간 한 줄. chars = 보일 글자 수
    rich(line, x, y, size, colors, opts = {}) {
      const segs = [];
      let cur = { s: '', c: colors.base };
      for (const ch of line) {
        if (ch === '[' || ch === '{') { if (cur.s) segs.push(cur); cur = { s: '', c: ch === '[' ? colors.hl : colors.hl2 }; continue; }
        if (ch === ']' || ch === '}') { if (cur.s) segs.push(cur); cur = { s: '', c: colors.base }; continue; }
        cur.s += ch;
      }
      if (cur.s) segs.push(cur);
      const total = segs.reduce((a, s) => a + this._wf(s.s, size, opts.weight), 0);
      let cx = opts.align === 'center' ? x - total / 2 : x;
      let left = opts.chars == null ? Infinity : opts.chars;
      for (const sg of segs) {
        if (left <= 0) break;
        const n = Math.min(left, sg.s.length);
        this.text(sg.s, cx, y, size, sg.c, { chars: n, shadow: opts.shadow, outline: opts.outline, weight: opts.weight });
        cx += this._wf(sg.s, size, opts.weight);
        left -= sg.s.length;
      }
      return Math.ceil(total);
    }
    static plain(line) { return line.replace(/[\[\]{}]/g, ''); }

    // ----- 도형 -----
    rect(x, y, w, h, c) { this.ctx.fillStyle = c; this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    // 모서리가 계단처럼 깎인 상자 (r = 0~3)
    round(x, y, w, h, c, r = 2) {
      const g = this.ctx; g.fillStyle = c;
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      const steps = r === 3 ? [3, 1, 1] : r === 2 ? [2, 1] : r === 1 ? [1] : [];
      g.fillRect(x, y + steps.length, w, h - steps.length * 2);
      steps.forEach((s, i) => {
        g.fillRect(x + s, y + i, w - s * 2, 1);
        g.fillRect(x + s, y + h - 1 - i, w - s * 2, 1);
      });
    }
    // 테두리 있는 판: 그림자 → 테두리 → 속
    panel(x, y, w, h, o = {}) {
      const bw = o.bw || 1;
      if (o.shadow) this.round(x + (o.sx || 0), y + (o.sy == null ? 2 : o.sy), w, h, o.shadow, o.r == null ? 3 : o.r);
      this.round(x, y, w, h, o.border || '#1c1f26', o.r == null ? 3 : o.r);
      this.round(x + bw, y + bw, w - bw * 2, h - bw * 2, o.fill || '#fff', Math.max(0, (o.r == null ? 3 : o.r) - 1));
    }
    icon(name, x, y, color, scale = 1) {
      const rows = ICONS[name];
      if (!rows) return;
      const g = this.ctx; g.fillStyle = color;
      rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(Math.round(x + i * scale), Math.round(y + j * scale), scale, scale); });
    }
    iconSize(name) { const r = ICONS[name]; return r ? [r[0].length, r.length] : [0, 0]; }
    // 반짝이 (십자 모양), 크기 s
    sparkle(x, y, s, color) {
      x = Math.round(x); y = Math.round(y); s = Math.max(1, Math.round(s));
      this.rect(x - s, y, s * 2 + 1, 1, color);
      this.rect(x, y - s, 1, s * 2 + 1, color);
      if (s >= 3) { this.rect(x - 1, y - 1, 3, 3, color); }
    }
  }

  global.Pix = Pix;
  global.PIX_ICONS = ICONS;
})(typeof window !== 'undefined' ? window : globalThis);
