/* 공식 카드 (v4.6): 그림이 있는 플래시카드 묶음 + 한눈에 보기 인포그래픽
 * - PACKS.area = 함수 넓이 공식 (이차·삼차·사차함수). 공식은 tests/formulas.test.js가 그림 속 실제 함수로 넓이를 다시 재서 맞춰 보고,
 *   tools/verify_area.py가 무작위 함수 300개씩 정확한 분수 적분으로 확인했다 (2026-11-26).
 * - 덱을 받으면 카드에는 글자(front·back)와 fig: 'area/q-line' 같은 이름만 저장한다. 그림은 앱이 그 자리에서 그린다
 *   (계정 용량이 거의 안 들고, 다크 모드·테마 색이 그대로 맞는다). 글자를 고친 카드는 고친 글자를 그대로 보여 준다.
 * - 그림의 색은 styles.css의 .mf-* 규칙(var(--text)·var(--accent))이 정한다.
 */
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 수식 조각 (믿을 수 있는 이 파일 안의 글자만 넣는다)
  const fr = (num, den) => `<span class="mf-frac"><span>${num}</span><span>${den}</span></span>`;
  const sup = (n) => `<sup>${n}</sup>`;
  const AB = '(β − α)';
  const S = '<i>S</i> = ';
  const S1 = '<i>S</i><sub>1</sub> = ', S2 = '<i>S</i><sub>2</sub> = ';
  // 뒷면 수식 (한 줄 또는 여러 줄) + 외우는 요령
  const mathHTML = (m) => { const ms = [].concat(m); return ms.map((x) => `<div class="mf-math${ms.length > 1 ? ' long' : ''}">${x}</div>`).join(''); };
  // 좁은 폰에서 '2γ − α −' / 'β'처럼 식 가운데가 끊기지 않게 − + × ÷ 양쪽은 줄바꿈 없는 띄어쓰기로 (= 에서는 끊겨도 된다)
  const nb = (x) => esc(x).replace(/ ([−+×÷]) /g, '\u00a0$1\u00a0');
  const tipHTML = (t) => (t && t.length ? `<div class="mf-tip"><b>외우는 요령</b><ul>${t.map((x) => `<li>${nb(x)}</li>`).join('')}</ul></div>` : '');

  /* ---------- 그림 ----------
   * x, y: 보이는 범위 (수학 좌표). curves: 그릴 곡선·직선 { f, k: 'c'(함수)|'l'(직선), from, to }
   * areas: 칠할 넓이 { top, bot, a, b, k: ''|'s1' }, marks: [x, y, 글자] = 점에서 아래로 점선 + 밑에 글자
   * labels: [x, y, 글자, cls] = 넓이 이름 등, dots: [x, y] = 접점·변곡점, segs: [x1, y1, x2, y2] = 세로선 같은 선분
   * check: 시험용. 그림 속 함수로 잰 넓이가 공식 값과 같아야 한다 */
  const cub = (x) => x * x * x;
  const FIGS = {
    // 이차함수 y = x², 직선 y = x + 2 → x = −1, 2에서 만남. 넓이 = 1·3³/6 = 4.5
    'q-line': {
      x: [-1.75, 2.55], y: [-0.9, 6.3],
      curves: [{ f: (x) => x * x }, { f: (x) => x + 2, k: 'l' }],
      areas: [{ top: (x) => x + 2, bot: (x) => x * x, a: -1, b: 2 }],
      dots: [[-1, 1], [2, 4]], marks: [[-1, 1, 'α'], [2, 4, 'β']], labels: [[0.5, 1.55, 'S']],
      check: { a: -1, b: 2, want: 1 * 27 / 6 },
    },
    // 두 이차함수 y = x², y = −x² + 2x + 4 → x = −1, 2에서 만남. 넓이 = |1 − (−1)|·3³/6 = 9
    'q-two': {
      x: [-1.7, 2.7], y: [-1.5, 6.3],
      curves: [{ f: (x) => x * x }, { f: (x) => -x * x + 2 * x + 4 }],
      areas: [{ top: (x) => -x * x + 2 * x + 4, bot: (x) => x * x, a: -1, b: 2 }],
      dots: [[-1, 1], [2, 4]], marks: [[-1, 1, 'α'], [2, 4, 'β']], labels: [[0.5, 2.35, 'S']],
      check: { a: -1, b: 2, want: 2 * 27 / 6 },
    },
    // y = x²과 x = −1, 2에서의 접선 y = −2x − 1, y = 4x − 4 (x = 1/2에서 만남). 넓이 = 3³/12 = 2.25
    'q-tan2': {
      x: [-1.6, 2.5], y: [-2.7, 6.3],
      curves: [{ f: (x) => x * x }, { f: (x) => -2 * x - 1, k: 'l', from: -1.6, to: 1.05 }, { f: (x) => 4 * x - 4, k: 'l', from: -0.05, to: 2.5 }],
      areas: [{ top: (x) => x * x, bot: (x) => Math.max(-2 * x - 1, 4 * x - 4), a: -1, b: 2 }],
      dots: [[-1, 1], [2, 4], [0.5, -2]], marks: [[-1, 1, 'α'], [0.5, -2, '(α+β)/2', 'sm'], [2, 4, 'β']], labels: [[0.5, -0.62, 'S']],
      check: { a: -1, b: 2, want: 27 / 12 },
    },
    // y = x², x = −1/2에서의 접선 y = −x − 1/4, 세로선 x = 3/2. 넓이 = 2³/3
    'q-tanv': {
      x: [-1.3, 2.05], y: [-2.3, 4.3],
      curves: [{ f: (x) => x * x }, { f: (x) => -x - 0.25, k: 'l', from: -1.3, to: 2.0 }],
      segs: [[1.5, -2.3, 1.5, 4.3]],
      areas: [{ top: (x) => x * x, bot: (x) => -x - 0.25, a: -0.5, b: 1.5 }],
      dots: [[-0.5, 0.25]], marks: [[-0.5, 0.25, 'α'], [1.5, -2.3, 'β', 'none']], labels: [[0.82, -0.12, 'S']],
      check: { a: -0.5, b: 1.5, want: 8 / 3 },
    },
    // 삼차함수 y = x³ − 3x와 x = −0.8에서의 접선 y = −1.08x + 1.024 → x = 1.6에서 다시 만남. 넓이 = 2.4⁴/12
    'c-tan': {
      x: [-2.0, 2.2], y: [-2.7, 3.1],
      curves: [{ f: (x) => cub(x) - 3 * x }, { f: (x) => -1.08 * x + 1.024, k: 'l', from: -2.0, to: 2.2 }],
      areas: [{ top: (x) => -1.08 * x + 1.024, bot: (x) => cub(x) - 3 * x, a: -0.8, b: 1.6 }],
      dots: [[-0.8, 1.888], [1.6, -0.704]], marks: [[-0.8, 1.888, 'α'], [1.6, -0.704, 'β']], labels: [[0.5, -0.32, 'S']],
      check: { a: -0.8, b: 1.6, want: Math.pow(2.4, 4) / 12 },
    },
    // y = x³ − 1.2x: x = 0.4의 접선이 x = −0.8에서, x = −0.8의 접선이 x = 1.6에서 다시 만남. S₁ : S₂ = 1 : 16
    'c-ratio': {
      x: [-1.3, 1.85], y: [-1.45, 2.85],
      curves: [{ f: (x) => cub(x) - 1.2 * x }, { f: (x) => -0.72 * x - 0.128, k: 'l', from: -1.3, to: 1.1 }, { f: (x) => 0.72 * x + 1.024, k: 'l', from: -1.3, to: 1.85 }],
      areas: [
        { top: (x) => cub(x) - 1.2 * x, bot: (x) => -0.72 * x - 0.128, a: -0.8, b: 0.4, k: 's1' },
        { top: (x) => 0.72 * x + 1.024, bot: (x) => cub(x) - 1.2 * x, a: -0.8, b: 1.6 },
      ],
      dots: [[0.4, -0.416], [-0.8, 0.448], [1.6, 2.176]], marks: [[-0.8, 0.448, 'β'], [0.4, -0.416, 'α'], [1.6, 2.176, 'γ']],
      labels: [[-0.32, -0.42, 'S₁', 'sm'], [0.5, 0.55, 'S₂']],
      check: { a: -0.8, b: 0.4, want: Math.pow(1.2, 4) / 12, a2: -0.8, b2: 1.6, want2: Math.pow(2.4, 4) / 12 },
    },
    // y = x³ − 3x와 변곡점 (0, 0)을 지나는 직선 y = −x → x = −√2, 0, √2에서 만남. 두 넓이 모두 1
    'c-sym': {
      x: [-2.05, 2.05], y: [-2.65, 2.65],
      curves: [{ f: (x) => cub(x) - 3 * x }, { f: (x) => -x, k: 'l', from: -2.05, to: 2.05 }],
      areas: [
        { top: (x) => cub(x) - 3 * x, bot: (x) => -x, a: -Math.SQRT2, b: 0 },
        { top: (x) => -x, bot: (x) => cub(x) - 3 * x, a: 0, b: Math.SQRT2 },
      ],
      dots: [[-Math.SQRT2, Math.SQRT2], [0, 0], [Math.SQRT2, -Math.SQRT2]],
      labels: [[-0.8, 1.2, 'S₁'], [0.8, -1.2, 'S₂'], [0.42, 0.5, '변곡점', 'note']],
      check: { a: -Math.SQRT2, b: 0, want: 1, a2: 0, b2: Math.SQRT2, want2: 1 },
    },
    // 삼차함수 y = x(x + 1.4)(x − 1) + 0.25x + 0.3과 직선 y = 0.25x + 0.3 → x = −1.4, 0, 1에서 만남 (α, β, γ)
    // S₁ = 1.4³·(2·1 + 1.4 − 0)/12, S₂ = 1³·(0 + 1 + 2.8)/12
    'c-three': {
      x: [-1.75, 1.35], y: [-0.75, 1.45],
      curves: [{ f: (x) => x * (x + 1.4) * (x - 1) + 0.25 * x + 0.3 }, { f: (x) => 0.25 * x + 0.3, k: 'l', from: -1.75, to: 1.35 }],
      areas: [
        { top: (x) => x * (x + 1.4) * (x - 1) + 0.25 * x + 0.3, bot: (x) => 0.25 * x + 0.3, a: -1.4, b: 0 },
        { top: (x) => 0.25 * x + 0.3, bot: (x) => x * (x + 1.4) * (x - 1) + 0.25 * x + 0.3, a: 0, b: 1, k: 's1' },
      ],
      dots: [[-1.4, -0.05], [0, 0.3], [1, 0.55]], marks: [[-1.4, -0.05, 'α'], [0, 0.3, 'β'], [1, 0.55, 'γ']],
      labels: [[-0.72, 0.52, 'S₁'], [0.5, 0.19, 'S₂', 'sm']],
      check: { a: -1.4, b: 0, want: Math.pow(1.4, 3) * 3.4 / 12, a2: 0, b2: 1, want2: 3.8 / 12 },
    },
    // 사차함수 y = x⁴ − 2x² + 0.4x와 x = ±1에서 동시에 접하는 직선 y = 0.4x − 1. 넓이 = 2⁵/30
    'f-dtan': {
      x: [-1.75, 1.75], y: [-1.95, 2.7],
      curves: [{ f: (x) => x * x * x * x - 2 * x * x + 0.4 * x }, { f: (x) => 0.4 * x - 1, k: 'l', from: -1.75, to: 1.75 }],
      areas: [{ top: (x) => x * x * x * x - 2 * x * x + 0.4 * x, bot: (x) => 0.4 * x - 1, a: -1, b: 1 }],
      dots: [[-1, -1.4], [1, -0.6]], marks: [[-1, -1.4, 'α'], [1, -0.6, 'β']], labels: [[0, -0.52, 'S']],
      check: { a: -1, b: 1, want: 32 / 30 },
    },
    // 사차함수 y = (x + 0.6)³(x − 1.2) + 0.5x + 0.3과 변곡점 x = −0.6에서 접하는 직선 y = 0.5x + 0.3 → x = 1.2에서 다시 만남. 넓이 = 1.8⁵/20
    'f-tri': {
      x: [-1.25, 1.6], y: [-1.05, 2.4],
      curves: [{ f: (x) => cub(x + 0.6) * (x - 1.2) + 0.5 * x + 0.3 }, { f: (x) => 0.5 * x + 0.3, k: 'l', from: -1.25, to: 1.6 }],
      areas: [{ top: (x) => 0.5 * x + 0.3, bot: (x) => cub(x + 0.6) * (x - 1.2) + 0.5 * x + 0.3, a: -0.6, b: 1.2 }],
      dots: [[-0.6, 0], [1.2, 0.9]], marks: [[-0.6, 0, 'α'], [1.2, 0.9, 'β']], labels: [[0.55, 0.12, 'S']],
      check: { a: -0.6, b: 1.2, want: Math.pow(1.8, 5) / 20 },
    },
  };

  const W = 220, H = 150, PL = 8, PR = 8, PT = 8, PB = 22;
  let seq = 0;
  const n2 = (v) => Math.round(v * 10) / 10;
  function figSVG(key, opt) {
    const g = FIGS[key];
    if (!g) return '';
    opt = opt || {};
    const id = 'mfc' + (++seq);
    const X = (x) => n2(PL + (x - g.x[0]) / (g.x[1] - g.x[0]) * (W - PL - PR));
    const Y = (y) => n2(H - PB - (y - g.y[0]) / (g.y[1] - g.y[0]) * (H - PT - PB));
    const bottom = H - PB;
    const path = (f, a, b, n) => { let d = ''; for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; d += (i ? 'L' : 'M') + X(x) + ' ' + Y(f(x)); } return d; };
    let s = `<svg class="mf-fig${opt.cls ? ' ' + opt.cls : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || '그래프')}">`;
    s += `<defs><clipPath id="${id}"><rect x="${PL}" y="${PT}" width="${W - PL - PR}" height="${H - PT - PB}"/></clipPath></defs>`;
    s += `<g clip-path="url(#${id})">`;
    for (const ar of g.areas || []) {
      const n = 60;
      let d = '';
      for (let i = 0; i <= n; i++) { const x = ar.a + (ar.b - ar.a) * i / n; d += (i ? 'L' : 'M') + X(x) + ' ' + Y(ar.top(x)); }
      for (let i = n; i >= 0; i--) { const x = ar.a + (ar.b - ar.a) * i / n; d += 'L' + X(x) + ' ' + Y(ar.bot(x)); }
      s += `<path class="mf-area${ar.k ? ' ' + ar.k : ''}" d="${d}Z"/>`;
    }
    for (const m of g.marks || []) if (m[3] !== 'none') s += `<path class="mf-dash" d="M${X(m[0])} ${Y(m[1])}V${bottom}"/>`;
    for (const sg of g.segs || []) s += `<path class="mf-line" d="M${X(sg[0])} ${Y(sg[1])}L${X(sg[2])} ${Y(sg[3])}"/>`;
    for (const c of g.curves) s += `<path class="${c.k === 'l' ? 'mf-line' : 'mf-curve'}" d="${path(c.f, c.from == null ? g.x[0] : c.from, c.to == null ? g.x[1] : c.to, c.k === 'l' ? 1 : 120)}"/>`;
    s += '</g>';
    s += `<path class="mf-base" d="M${PL} ${bottom}H${W - PR}"/>`;
    for (const d of g.dots || []) s += `<circle class="mf-dot" cx="${X(d[0])}" cy="${Y(d[1])}" r="2.6"/>`;
    for (const m of g.marks || []) s += `<text class="mf-mk${m[3] === 'sm' ? ' sm' : ''}" x="${X(m[0])}" y="${bottom + 15}" text-anchor="middle">${esc(m[2])}</text>`;
    for (const l of g.labels || []) s += `<text class="mf-lb${l[3] ? ' ' + l[3] : ''}" x="${X(l[0])}" y="${Y(l[1])}" text-anchor="middle" dominant-baseline="middle">${esc(l[2])}</text>`;
    return s + '</svg>';
  }

  /* ---------- 공식 덱 ----------
   * key: 카드 이름 (카드에 fig: '덱/이름'으로 저장), front·back: 저장하는 글자 (목록·검색·채팅으로 보내기에 그대로 쓰임)
   * title·sub·math·note: 그림 카드로 보여 줄 때 (저장한 글자가 그대로일 때만) */
  const AREA = {
    id: 'area',
    name: '함수 넓이 공식',
    blurb: '이차·삼차·사차함수 넓이 공식 11장',
    lead: '<b>a</b>는 두 식을 뺀 식(f − g)의 최고차항 계수, α &lt; β &lt; γ',
    groups: [
      { id: 'q', name: '이차함수', pow: `${AB}${sup(3)}` },
      { id: 'c', name: '삼차함수', pow: `${AB}${sup(4)}` },
      { id: 'f', name: '사차함수', pow: `${AB}${sup(5)}` },
      { id: 'r', name: '원리', pow: '' },
    ],
    cards: [
      { key: 'q-line', g: 'q', short: '이차함수와 직선',
        title: '이차함수와 직선으로 둘러싸인 넓이', sub: 'x = α, β에서 만날 때',
        front: '이차함수와 직선으로 둘러싸인 넓이 (x = α, β에서 만날 때)', back: 'S = |a|(β − α)³ / 6',
        math: S + fr(`|<i>a</i>|${AB}${sup(3)}`, '6'), note: 'a: 이차함수의 x² 계수. x축(y = 0)과 둘러싸인 넓이도 같아요.' },
      { key: 'q-two', g: 'q', short: '두 이차함수',
        title: '두 이차함수로 둘러싸인 넓이', sub: 'x = α, β에서 만날 때',
        front: '두 이차함수로 둘러싸인 넓이 (x = α, β에서 만날 때)', back: "S = |a − a'|(β − α)³ / 6",
        math: S + fr(`|<i>a</i> − <i>a′</i>|${AB}${sup(3)}`, '6'), note: "a, a': 두 함수의 x² 계수 (a ≠ a')" },
      { key: 'q-tan2', g: 'q', short: '이차함수와 두 접선',
        title: '이차함수와 두 접선으로 둘러싸인 넓이', sub: 'x = α, β인 점에서 접선을 그을 때',
        front: '이차함수와 두 접선으로 둘러싸인 넓이 (x = α, β인 점에서 그은 접선)', back: 'S = |a|(β − α)³ / 12',
        math: S + fr(`|<i>a</i>|${AB}${sup(3)}`, '12'), note: '두 접선은 x = (α + β)/2 에서 만나요. 직선일 때(/6)의 딱 절반.' },
      { key: 'q-tanv', g: 'q', short: '접선과 세로선',
        title: '이차함수, 접선, 직선 x = β로 둘러싸인 넓이', sub: 'x = α인 점에서 접선을 그을 때',
        front: '이차함수, x = α에서의 접선, 직선 x = β로 둘러싸인 넓이', back: 'S = |a|(β − α)³ / 3',
        math: S + fr(`|<i>a</i>|${AB}${sup(3)}`, '3'), note: '꼭짓점에서 그으면 직사각형의 1/3 (위아래 넓이 비 2 : 1)' },
      { key: 'c-tan', g: 'c', short: '삼차함수와 접선',
        title: '삼차함수와 접선으로 둘러싸인 넓이', sub: 'x = α에서 접하고 x = β에서 다시 만날 때',
        front: '삼차함수와 접선으로 둘러싸인 넓이 (x = α에서 접하고 x = β에서 다시 만날 때)', back: 'S = |a|(β − α)⁴ / 12',
        math: S + fr(`|<i>a</i>|${AB}${sup(4)}`, '12'), note: 'a: 삼차함수의 x³ 계수. x축에 접할 때도 같아요.' },
      { key: 'c-ratio', g: 'c', short: '이어 그은 접선',
        title: '이어 그은 두 접선이 만드는 넓이의 비', sub: 'x = α의 접선이 x = β에서, x = β의 접선이 x = γ에서 다시 만날 때',
        front: '삼차함수: x = α의 접선이 x = β에서, x = β의 접선이 x = γ에서 만날 때 두 넓이의 비', back: 'S₁ : S₂ = 1 : 16',
        math: '<i>S</i><sub>1</sub> : <i>S</i><sub>2</sub> = 1 : 16', note: '|β − α| : |γ − β| = 1 : 2 라서 넓이 비는 1⁴ : 2⁴' },
      { key: 'c-sym', g: 'c', short: '변곡점을 지나는 직선',
        title: '변곡점을 지나는 직선이 만드는 두 넓이', sub: '삼차함수와 세 점에서 만날 때',
        front: '삼차함수와 변곡점을 지나는 직선이 세 점에서 만날 때 두 넓이', back: 'S₁ = S₂',
        math: '<i>S</i><sub>1</sub> = <i>S</i><sub>2</sub>', note: '삼차함수의 그래프는 변곡점에 대해 점대칭이에요.' },
      // 세 실근: f − g = a(x − α)(x − β)(x − γ). tools/verify_area.py가 무작위 삼차함수로 정확한 분수 검산 (2026-11-26, 1,937개)
      { key: 'c-three', g: 'c', short: '세 점에서 만나는 직선', wide: true,
        title: '삼차함수와 직선이 세 점에서 만날 때 두 넓이', sub: 'x = α, β, γ에서 만날 때 (α < β < γ)',
        front: '삼차함수와 직선이 x = α, β, γ (α < β < γ)에서 만날 때 두 넓이 S₁(α~β), S₂(β~γ)',
        back: 'S₁ = |a|(β − α)³(2γ − α − β) / 12, S₂ = |a|(γ − β)³(β + γ − 2α) / 12 (요령: 구간 길이³ × 남은 한 점에서 구간 두 끝까지 거리의 합 ÷ 12)',
        math: [S1 + fr(`|<i>a</i>|${AB}${sup(3)}(2γ − α − β)`, '12'), S2 + fr(`|<i>a</i>|(γ − β)${sup(3)}(β + γ − 2α)`, '12')],
        note: 'a: 삼차함수의 x³ 계수 (f − g = a(x − α)(x − β)(x − γ))',
        tip: [
          '자기 구간 길이의 세제곱 × 남은 한 점에서 자기 구간 두 끝까지 거리의 합 ÷ 12',
          'S₁은 남은 점이 γ: (γ − α) + (γ − β) = 2γ − α − β',
          'S₂는 남은 점이 α: (β − α) + (γ − α) = β + γ − 2α',
          '확인: 간격이 같으면 S₁ = S₂, β가 α에 붙으면 접선 공식 |a|(γ − α)⁴ / 12',
        ] },
      { key: 'f-dtan', g: 'f', short: '두 점에서 접하는 직선',
        title: '사차함수와 두 점에서 접하는 직선으로 둘러싸인 넓이', sub: 'x = α, β에서 동시에 접할 때',
        front: '사차함수와 두 점에서 접하는 직선으로 둘러싸인 넓이 (x = α, β에서 접할 때)', back: 'S = |a|(β − α)⁵ / 30',
        math: S + fr(`|<i>a</i>|${AB}${sup(5)}`, '30'), note: 'a: 사차함수의 x⁴ 계수' },
      { key: 'f-tri', g: 'f', short: '변곡점에서 접하는 직선',
        title: '사차함수와 변곡점에서 접하는 직선으로 둘러싸인 넓이', sub: 'x = α(변곡점)에서 접하고 x = β에서 다시 만날 때',
        front: '사차함수와 변곡점 x = α에서 접하고 x = β에서 다시 만나는 직선으로 둘러싸인 넓이', back: 'S = |a|(β − α)⁵ / 20',
        math: S + fr(`|<i>a</i>|${AB}${sup(5)}`, '20'), note: 'f(x) − (직선) = a(x − α)³(x − β) 꼴일 때' },
      { key: 'basis', g: 'r', short: '모든 공식의 뿌리',
        title: '넓이 공식들의 뿌리', sub: 'α부터 β까지 적분',
        front: '넓이 공식들의 뿌리: α부터 β까지 ∫ (x − α)ᵐ(β − x)ⁿ dx = ?', back: '= m! n! / (m + n + 1)! × (β − α)ᵐ⁺ⁿ⁺¹',
        q: `<span class="mf-int"><b>∫</b><span class="mf-lim"><span>β</span><span>α</span></span></span>(<i>x</i> − α)<sup><i>m</i></sup>(β − <i>x</i>)<sup><i>n</i></sup> <i>dx</i>`,
        math: '= ' + fr('<i>m</i>! <i>n</i>!', '(<i>m</i> + <i>n</i> + 1)!') + ` ${AB}<sup><i>m</i>+<i>n</i>+1</sup>`,
        note: '(m, n) = (1, 1) → 1/6 · (2, 1) → 1/12 · (2, 2) → 1/30 · (3, 1) → 1/20' },
    ],
  };
  const PACKS = { area: AREA };

  // 카드의 fig 값('area/q-line') → { pack, card }
  function find(fig) {
    const m = /^([a-z0-9]+)\/([a-z0-9-]+)$/.exec(fig || '');
    const p = m && PACKS[m[1]];
    const c = p && p.cards.find((x) => x.key === m[2]);
    return c ? { pack: p, card: c } : null;
  }

  // 복습 카드 앞면·뒷면 HTML. 저장한 글자를 고쳤으면 그 글자를 그대로 (그림은 남긴다)
  function face(card, side) {
    const hit = find(card && card.fig);
    if (!hit) return null;
    const d = hit.card, g = hit.pack.groups.find((x) => x.id === d.g);
    if (side === 'front') {
      const fig = FIGS[d.key] ? `<div class="mf-card-fig">${figSVG(d.key, { label: d.title })}</div>` : '';
      const text = card.front === d.front
        ? `<div class="mf-q">${esc(d.title)}</div><div class="mf-sub">${esc(d.sub)}</div>${d.q ? `<div class="mf-math mf-qmath">${d.q}</div>` : ''}`
        : `<div class="mf-q">${esc(card.front)}</div>`;
      return `<div class="mf-chip">${esc(hit.pack.name)} · ${esc(g ? g.name : '')}</div>${fig}${text}`;
    }
    return card.back === d.back
      ? `${mathHTML(d.math)}<div class="mf-note">${nb(d.note)}</div>${tipHTML(d.tip)}`
      : `<div class="mf-math plain">${esc(card.back)}</div>`;
  }

  // 덱 화면 카드 목록에 붙일 작은 그림
  function thumb(card) {
    const hit = find(card && card.fig);
    return hit && FIGS[hit.card.key] ? figSVG(hit.card.key, { cls: 'mf-thumb', label: hit.card.short }) : '';
  }

  // 한눈에 보기 (인포그래픽 한 장)
  function poster(packId) {
    const p = PACKS[packId];
    if (!p) return '';
    let s = `<div class="mf-poster"><div class="mf-p-head"><h2>${esc(p.name)}</h2><p>${p.lead}</p></div>`;
    for (const g of p.groups) {
      const cards = p.cards.filter((c) => c.g === g.id);
      if (!cards.length) continue;
      if (g.id === 'r') {
        const c = cards[0];
        s += `<section class="mf-p-sec mf-p-root"><h3><span>${esc(g.name)}</span><small>${esc(c.title)}</small></h3>` +
          `<div class="mf-math mf-qmath">${c.q}</div><div class="mf-math">${c.math}</div>` +
          '<table class="mf-p-tbl"><thead><tr><th>꼴</th><th>(m, n)</th><th>계수</th></tr></thead><tbody>' +
          `<tr><td>이차 · 두 점</td><td>(1, 1)</td><td>${fr('1', '6')}</td></tr>` +
          `<tr><td>삼차 · 접선</td><td>(2, 1)</td><td>${fr('1', '12')}</td></tr>` +
          `<tr><td>사차 · 두 접점</td><td>(2, 2)</td><td>${fr('1', '30')}</td></tr>` +
          `<tr><td>사차 · 변곡 접선</td><td>(3, 1)</td><td>${fr('1', '20')}</td></tr>` +
          '</tbody></table><p class="mf-p-tip">f(x) − g(x) = a(x − α)ᵐ(x − β)ⁿ 꼴로 인수분해되면 바로 쓸 수 있어요.</p></section>';
        continue;
      }
      s += `<section class="mf-p-sec"><h3><span>${esc(g.name)}</span><small class="mf-math">${g.pow}</small></h3><div class="mf-p-grid">`;
      const norm = cards.filter((c) => !c.wide), wide = cards.filter((c) => c.wide);
      norm.concat(wide).forEach((c) => {
        const cls = c.wide ? ' wide' : (norm.length % 2 && c === norm[norm.length - 1] ? ' row' : '');
        const math = [].concat(c.math).map((m) => `<span class="mf-math">${m}</span>`).join('');
        s += `<figure class="mf-p-tile${cls}">${figSVG(c.key, { label: c.title })}<figcaption><b>${esc(c.short)}</b>${math}${c.wide ? tipHTML(c.tip) : ''}</figcaption></figure>`;
      });
      s += '</div></section>';
    }
    return s + '</div>';
  }

  const lib = { PACKS, FIGS, find, face, thumb, poster, figSVG };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }
  root.Formulas = lib;
})(typeof window !== 'undefined' ? window : globalThis);
