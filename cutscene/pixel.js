// 픽셀 화면 층: 낮은 해상도 캔버스에 그린 뒤 CSS로 크게 키운다(image-rendering: pixelated)
// 글자는 앱에 들어 있는 Pretendard를 작게 그린 다음 반투명 픽셀을 없애 진짜 픽셀 글꼴처럼 만든다.
(function (global) {
  'use strict';
  const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';

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
      this.px = 2; this.w = 1; this.h = 1;
      // 글꼴 조각이 늦게 들어오면(처음 쓰는 글자) 대신 글꼴로 만든 글자 그림을 버리고 다시 만든다
      if (global.document && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => this.cache.clear());
    }
    resize(cssW, cssH) {
      const minSide = Math.min(cssW, cssH);
      this.px = minSide >= 700 ? 3 : 2;
      this.w = Math.ceil(cssW / this.px);
      this.h = Math.ceil(cssH / this.px);
      this.cv.width = this.w; this.cv.height = this.h;
      this.cv.style.width = this.w * this.px + 'px';
      this.cv.style.height = this.h * this.px + 'px';
      this.ctx.imageSmoothingEnabled = false;
    }
    clear() { this.ctx.clearRect(0, 0, this.w, this.h); }
    // 화면 비율 좌표(0~1) → 픽셀 좌표
    at(fx, fy) { return [Math.round(fx * this.w), Math.round(fy * this.h)]; }

    // ----- 글자 -----
    _mask(str, size, weight) {
      const key = 'm|' + size + '|' + weight + '|' + str;
      let m = this.cache.get(key);
      if (m) return m;
      const c = document.createElement('canvas');
      const g = c.getContext('2d');
      const font = `${weight} ${size}px ${FONT}`;
      g.font = font;
      const wid = Math.ceil(g.measureText(str).width) + 2;
      const hgt = Math.round(size * 1.3) + 2;
      c.width = Math.max(1, wid); c.height = hgt;
      g.font = font; g.textBaseline = 'alphabetic'; g.fillStyle = '#fff';
      const base = Math.round(size * 0.98) + 1;
      g.fillText(str, 1, base);
      const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
      for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 100 ? 255 : 0;
      g.putImageData(img, 0, 0);
      // 글자마다 끝 위치 (타자기처럼 한 글자씩 보일 때)
      const adv = [];
      for (let i = 1; i <= str.length; i++) adv.push(Math.round(g.measureText(str.slice(0, i)).width) + 1);
      m = { cv: c, w: c.width, h: c.height, adv, base };
      this.cache.set(key, m);
      return m;
    }
    _tinted(str, size, weight, color) {
      const key = 't|' + size + '|' + weight + '|' + color + '|' + str;
      let t = this.cache.get(key);
      if (t) return t;
      const m = this._mask(str, size, weight);
      const c = document.createElement('canvas');
      c.width = m.w; c.height = m.h;
      const g = c.getContext('2d');
      g.drawImage(m.cv, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color; g.fillRect(0, 0, m.w, m.h);
      t = { cv: c, w: m.w, h: m.h, adv: m.adv, base: m.base };
      this.cache.set(key, t);
      return t;
    }
    textWidth(str, size, weight = 800) { return this._mask(str, size, weight).w - 2; }
    // align: 'left' | 'center' | 'right'. outline: 테두리 색(1픽셀)
    text(str, x, y, size, color, opts = {}) {
      if (!str) return 0;
      const weight = opts.weight || 800;
      const t = this._tinted(str, size, weight, color);
      let dx = x - 1;
      if (opts.align === 'center') dx = Math.round(x - (t.w - 2) / 2) - 1;
      else if (opts.align === 'right') dx = x - (t.w - 2) - 1;
      const dy = y - 1;
      const g = this.ctx;
      const shown = opts.chars == null ? t.w : opts.chars <= 0 ? 0 : t.adv[Math.min(opts.chars, t.adv.length) - 1] + 1;
      if (shown <= 0) return t.w - 2;
      if (opts.outline) {
        const o = this._tinted(str, size, weight, opts.outline);
        for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) g.drawImage(o.cv, 0, 0, shown, o.h, dx + ox, dy + oy, shown, o.h);
      }
      if (opts.shadow) {
        const s = this._tinted(str, size, weight, opts.shadow);
        g.drawImage(s.cv, 0, 0, shown, s.h, dx, dy + 1, shown, s.h);
      }
      g.drawImage(t.cv, 0, 0, shown, t.h, dx, dy, shown, t.h);
      return t.w - 2;
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
      const total = segs.reduce((a, s) => a + this.textWidth(s.s, size), 0);
      let cx = opts.align === 'center' ? Math.round(x - total / 2) : x;
      let left = opts.chars == null ? Infinity : opts.chars;
      for (const sg of segs) {
        if (left <= 0) break;
        const n = Math.min(left, sg.s.length);
        this.text(sg.s, cx, y, size, sg.c, { chars: n, shadow: opts.shadow, outline: opts.outline });
        cx += this.textWidth(sg.s, size);
        left -= sg.s.length;
      }
      return total;
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
