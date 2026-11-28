// 공식 카드 (v4.6, js/formulas.js): 공식이 맞는지, 그림 속 함수가 공식과 맞는지, 카드 글자·그리기가 안전한지
const test = require('node:test');
const assert = require('node:assert');
const F = require('../js/formulas.js');

// 심프슨 적분 (실수)
function integrate(f, a, b, n = 2000) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return s * h / 3;
}
const close = (x, y, tol = 1e-6) => Math.abs(x - y) <= tol * Math.max(1, Math.abs(y));

test('그림마다: 칠한 넓이를 직접 재면 공식 값과 같다', () => {
  for (const [key, g] of Object.entries(F.FIGS)) {
    const areas = g.areas.map((ar) => integrate((x) => ar.top(x) - ar.bot(x), ar.a, ar.b));
    assert.ok(close(areas[0], g.check.want), `${key}: 넓이 ${areas[0]} ≠ 공식 ${g.check.want}`);
    if (g.check.want2 != null) assert.ok(close(areas[1], g.check.want2), `${key}: 두 번째 넓이 ${areas[1]} ≠ ${g.check.want2}`);
  }
});

test('그림마다: 칠한 곳에서 위 함수가 아래 함수보다 늘 위에 있고, 양 끝(세로선 빼고)에서 만난다', () => {
  for (const [key, g] of Object.entries(F.FIGS)) {
    for (const ar of g.areas) {
      for (let i = 1; i < 200; i++) {
        const x = ar.a + (ar.b - ar.a) * i / 200;
        assert.ok(ar.top(x) - ar.bot(x) >= -1e-9, `${key}: x=${x}에서 위아래가 바뀜`);
      }
      assert.ok(Math.abs(ar.top(ar.a) - ar.bot(ar.a)) < 1e-9, `${key}: 왼쪽 끝 x=${ar.a}에서 안 만남`);
      if (key !== 'q-tanv') assert.ok(Math.abs(ar.top(ar.b) - ar.bot(ar.b)) < 1e-9, `${key}: 오른쪽 끝 x=${ar.b}에서 안 만남`);
    }
    // 점·점선 표시는 그려진 곡선 위에 있다 (아래 가장자리에 붙인 β 표시는 빼고)
    for (const d of (g.dots || []).concat((g.marks || []).filter((m) => m[3] !== 'none'))) {
      assert.ok(g.curves.some((c) => Math.abs(c.f(d[0]) - d[1]) < 1e-9), `${key}: 점 (${d[0]}, ${d[1]})이 곡선 위에 없음`);
    }
  }
});

test('그림 속 접선은 정말 접선이다 (기울기가 같다)', () => {
  const slope = (f, x) => (f(x + 1e-6) - f(x - 1e-6)) / 2e-6;
  const g = F.FIGS;
  const tan = (key, ci, li, xs) => xs.forEach((x) => assert.ok(Math.abs(slope(g[key].curves[ci].f, x) - slope(g[key].curves[li].f, x)) < 1e-5, `${key}: x=${x}에서 접하지 않음`));
  tan('q-tan2', 0, 1, [-1]); tan('q-tan2', 0, 2, [2]);
  tan('q-tanv', 0, 1, [-0.5]);
  tan('c-tan', 0, 1, [-0.8]);
  tan('c-ratio', 0, 1, [0.4]); tan('c-ratio', 0, 2, [-0.8]);
  tan('f-dtan', 0, 1, [-1, 1]);
  tan('f-tri', 0, 1, [-0.6]);
  // 변곡점: 이계도함수가 0
  const d2 = (f, x) => (f(x + 1e-4) - 2 * f(x) + f(x - 1e-4)) / 1e-8;
  assert.ok(Math.abs(d2(g['f-tri'].curves[0].f, -0.6)) < 1e-3, 'f-tri: x=−0.6이 변곡점');
  assert.ok(Math.abs(d2(g['c-sym'].curves[0].f, 0)) < 1e-3, 'c-sym: x=0이 변곡점');
});

// 무작위 함수로 공식 자체를 확인 (정확한 분수 검산은 tools/verify_area.py)
test('공식: 무작위 함수 200개씩 넓이를 재서 공식과 맞춘다', () => {
  let seed = 7;
  const rnd = (lo, hi) => { seed = (seed * 16807) % 2147483647; return lo + (hi - lo) * (seed / 2147483647); };
  const nz = () => { let v = 0; while (Math.abs(v) < 0.2) v = rnd(-3, 3); return v; };
  for (let k = 0; k < 200; k++) {
    let al = rnd(-3, 3), be = rnd(-3, 3);
    if (Math.abs(be - al) < 0.3) be = al + 1;
    if (be < al) [al, be] = [be, al];
    const a = nz(), m = rnd(-3, 3), n = rnd(-3, 3);
    const L = (x) => m * x + n;
    const h = be - al;
    const area = (d) => Math.abs(integrate(d, al, be));
    // 이차-직선, 삼차-접선, 사차-이중접선, 사차-변곡접선: f − L의 꼴
    assert.ok(close(area((x) => a * (x - al) * (x - be)), Math.abs(a) * h ** 3 / 6));
    assert.ok(close(area((x) => a * (x - al) ** 2 * (x - be)), Math.abs(a) * h ** 4 / 12));
    assert.ok(close(area((x) => a * (x - al) ** 2 * (x - be) ** 2), Math.abs(a) * h ** 5 / 30));
    assert.ok(close(area((x) => a * (x - al) ** 3 * (x - be)), Math.abs(a) * h ** 5 / 20));
    // 이차함수 y = ax² + bx + c 와 x = α, β에서의 두 접선
    const b = rnd(-3, 3), c = rnd(-3, 3);
    const q = (x) => a * x * x + b * x + c, dq = (x) => 2 * a * x + b;
    const t1 = (x) => q(al) + dq(al) * (x - al), t2 = (x) => q(be) + dq(be) * (x - be);
    const xm = (al + be) / 2;
    assert.ok(Math.abs(t1(xm) - t2(xm)) < 1e-9, '두 접선은 x = (α+β)/2에서 만남');
    const s2 = Math.abs(integrate((x) => q(x) - t1(x), al, xm)) + Math.abs(integrate((x) => q(x) - t2(x), xm, be));
    assert.ok(close(s2, Math.abs(a) * h ** 3 / 12));
    assert.ok(close(Math.abs(integrate((x) => q(x) - t1(x), al, be)), Math.abs(a) * h ** 3 / 3));
    void L;
  }
});

test('원리: ∫(x−α)^m(β−x)^n dx = m!n!/(m+n+1)! (β−α)^(m+n+1), 표의 계수', () => {
  const fact = (k) => (k <= 1 ? 1 : k * fact(k - 1));
  for (let m = 0; m <= 4; m++) for (let n = 0; n <= 4; n++) {
    const al = -0.7, be = 1.9;
    const v = integrate((x) => (x - al) ** m * (be - x) ** n, al, be);
    assert.ok(close(v, fact(m) * fact(n) / fact(m + n + 1) * (be - al) ** (m + n + 1)), `m=${m}, n=${n}`);
  }
  assert.deepStrictEqual([[1, 1], [2, 1], [2, 2], [3, 1]].map(([m, n]) => fact(m + n + 1) / (fact(m) * fact(n))), [6, 12, 30, 20]);
});

test('공식 덱: 카드 이름이 겹치지 않고, 글자는 앱 입력 칸 길이 안이고, 그림이 다 있다', () => {
  const p = F.PACKS.area;
  const keys = p.cards.map((c) => c.key);
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.strictEqual(p.cards.length, 10);
  for (const c of p.cards) {
    assert.ok(c.front.length <= 300 && c.back.length <= 500, c.key + ' 글자 길이');
    assert.ok(p.groups.some((g) => g.id === c.g), c.key + ' 묶음');
    if (c.g !== 'r') assert.ok(F.FIGS[c.key], c.key + ' 그림');
    assert.ok(F.find('area/' + c.key), c.key + ' 찾기');
  }
  assert.strictEqual(F.find('area/없음'), null);
  assert.strictEqual(F.find('<x>/y'), null);
  assert.strictEqual(F.find(undefined), null);
  // 뒷면 글자에 공식 계수가 들어 있다 (카드 목록·채팅으로 보내기에 보이는 글자)
  const back = Object.fromEntries(p.cards.map((c) => [c.key, c.back]));
  assert.match(back['q-line'], /\(β − α\)³ \/ 6$/);
  assert.match(back['q-two'], /\|a − a'\|\(β − α\)³ \/ 6$/);
  assert.match(back['q-tan2'], /\/ 12$/);
  assert.match(back['q-tanv'], /\/ 3$/);
  assert.match(back['c-tan'], /\(β − α\)⁴ \/ 12$/);
  assert.match(back['c-ratio'], /1 : 16$/);
  assert.match(back['f-dtan'], /\(β − α\)⁵ \/ 30$/);
  assert.match(back['f-tri'], /\(β − α\)⁵ \/ 20$/);
});

test('카드 그리기: 그대로면 그림 + 수식, 고친 글자는 그대로 (HTML로 안 읽힘), 그림 이름이 없으면 null', () => {
  const d = F.PACKS.area.cards[0];
  const card = { fig: 'area/' + d.key, front: d.front, back: d.back };
  const front = F.face(card, 'front'), back = F.face(card, 'back');
  assert.match(front, /<svg class="mf-fig"/);
  assert.match(front, /이차함수와 직선으로 둘러싸인 넓이/);
  assert.match(back, /mf-frac/);
  const edited = { fig: card.fig, front: '<img src=x onerror=alert(1)>', back: '<b>내 답</b>' };
  assert.ok(!/<img/.test(F.face(edited, 'front')) && /&lt;img/.test(F.face(edited, 'front')));
  assert.match(F.face(edited, 'front'), /<svg/, '고쳐도 그림은 남음');
  assert.ok(/&lt;b&gt;내 답/.test(F.face(edited, 'back')));
  assert.strictEqual(F.face({ front: 'a', back: 'b' }, 'front'), null);
  assert.match(F.thumb(card), /mf-thumb/);
  assert.strictEqual(F.thumb({ fig: 'area/basis' }), '');
});

test('그림: 같은 그림을 여러 번 그려도 잘라 내기 id가 겹치지 않고, 숫자가 아닌 좌표가 없다', () => {
  const a = F.figSVG('q-line'), b = F.figSVG('q-line');
  const id = (s) => /clipPath id="([^"]+)"/.exec(s)[1];
  assert.notStrictEqual(id(a), id(b));
  for (const key of Object.keys(F.FIGS)) assert.ok(!/NaN|Infinity|undefined/.test(F.figSVG(key)), key);
  assert.strictEqual(F.figSVG('없음'), '');
  const poster = F.poster('area');
  assert.strictEqual((poster.match(/<svg/g) || []).length, Object.keys(F.FIGS).length);
  assert.match(poster, /원리/);
  assert.strictEqual(F.poster('없음'), '');
});
