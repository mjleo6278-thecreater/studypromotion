/* 시험 범위 트리 (순수 함수)
 *
 * 노드: { id, examId, parentId, kind: 'topic'|'note', title, done, flags: {star, hard, review},
 *         order, collapsed, x, y, color }   (x, y, color는 최상위 카드에만 의미 있음)
 * 체크 상태는 '잎' 항목(하위 항목이 없는 항목)에만 저장하고, 상위 항목은 잎으로부터 계산한다.
 */
(function (root) {
  const CARD_W = 300;
  const GAP = 40;
  const COLORS = ['#e86a5c', '#4a7fd4', '#3fa774', '#c98a1a', '#8a6fd1', '#d0638f', '#2a9fb0', '#7d8a2e'];

  function childrenOf(nodes, parentId, examId) {
    return nodes
      .filter((n) => n.parentId === parentId && (parentId !== null || n.examId === examId))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function indexByParent(nodes) {
    const map = new Map();
    for (const n of nodes) {
      const k = n.parentId || 'root:' + n.examId;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(n);
    }
    for (const list of map.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));
    return map;
  }

  function kids(index, id) {
    return index.get(id) || [];
  }

  // 하위 전체 (자기 자신 포함)
  function subtreeIds(nodes, id, index) {
    index = index || indexByParent(nodes);
    const out = [id];
    for (let i = 0; i < out.length; i++) kids(index, out[i]).forEach((c) => out.push(c.id));
    return out;
  }

  function leavesUnder(nodes, id, index) {
    index = index || indexByParent(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return subtreeIds(nodes, id, index)
      .map((x) => byId.get(x))
      .filter((n) => n && n.kind !== 'note' && kids(index, n.id).length === 0);
  }

  /** {done, total, pct, state: 'none'|'some'|'all'} */
  function progress(nodes, id, index) {
    const leaves = leavesUnder(nodes, id, index);
    const total = leaves.length;
    const done = leaves.filter((n) => n.done).length;
    return {
      done,
      total,
      pct: total ? Math.round((done / total) * 100) : 0,
      state: done === 0 ? 'none' : done === total ? 'all' : 'some',
    };
  }

  function examProgress(nodes, examId) {
    const leaves = nodes.filter((n) => n.examId === examId && n.kind !== 'note' && !nodes.some((c) => c.parentId === n.id));
    const done = leaves.filter((n) => n.done).length;
    return { done, total: leaves.length, pct: leaves.length ? Math.round((done / leaves.length) * 100) : 0 };
  }

  // 항목(또는 상위 항목 아래 전체)의 체크 상태를 바꾼다. nodes를 직접 수정.
  function setDone(nodes, id, done, now) {
    const leaves = leavesUnder(nodes, id);
    for (const n of leaves) {
      n.done = !!done;
      n.doneAt = done ? now || Date.now() : null;
    }
    return leaves.length;
  }

  function toggle(nodes, id, now) {
    const p = progress(nodes, id);
    const target = p.state !== 'all';
    setDone(nodes, id, target, now);
    return target;
  }

  function removeSubtree(nodes, id) {
    const ids = new Set(subtreeIds(nodes, id));
    return nodes.filter((n) => !ids.has(n.id));
  }

  function depthOf(nodes, id) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let d = 0;
    let n = byId.get(id);
    while (n && n.parentId) { d++; n = byId.get(n.parentId); }
    return d;
  }

  function nextOrder(nodes, parentId, examId) {
    const sib = childrenOf(nodes, parentId, examId);
    return sib.length ? Math.max(...sib.map((s) => s.order || 0)) + 1 : 0;
  }

  /**
   * 들여쓰기 목록을 트리로 바꾼다.
   * 지원: 스페이스/탭 들여쓰기, "- ", "* ", "• ", "1. ", "1) ", "# 제목"(#의 개수 = 단계)
   * 반환: [{ title, children: [...] }]
   */
  function parseOutline(text) {
    const roots = [];
    const stack = []; // { indent, node }
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let indent;
      let body;
      const h = raw.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) {
        indent = (h[1].length - 1) * 1000; // 제목은 들여쓰기보다 항상 위 단계
        body = h[2];
      } else {
        const ws = raw.match(/^[ \t　]*/)[0];
        indent = 0;
        for (const ch of ws) indent += ch === '\t' ? 4 : ch === '　' ? 2 : 1;
        indent += 6000; // 제목(#) 아래에 오는 일반 줄
        body = raw.slice(ws.length);
      }
      let done = false;
      for (let k = 0; k < 3; k++) {
        const m = body.match(/^([-*•·▪◦]|\d+[.)]|[a-zA-Z가-힣][.)]|\[([ xXvV✓✔]?)\])\s+/);
        if (!m) break;
        if (m[1][0] === '[' && m[2] && m[2].trim()) done = true;
        body = body.slice(m[0].length);
      }
      body = body.trim();
      if (!body) continue;
      const node = { title: body.slice(0, 200), done, children: [] };
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (stack.length) stack[stack.length - 1].node.children.push(node);
      else roots.push(node);
      stack.push({ indent, node });
    }
    return roots;
  }

  function countOutline(tree) {
    let n = 0;
    (function walk(list) { for (const t of list) { n++; walk(t.children); } })(tree);
    return n;
  }

  // 카드 높이 대략값 (자동 배치용)
  function estimateHeight(nodes, cardId, index) {
    index = index || indexByParent(nodes);
    const card = nodes.find((n) => n.id === cardId);
    if (card && card.kind === 'note') return 60 + Math.ceil(((card.title || '').length || 1) / 18) * 22;
    let rows = 0;
    (function walk(id) {
      for (const c of kids(index, id)) {
        rows++;
        if (!c.collapsed) walk(c.id);
      }
    })(cardId);
    return 96 + rows * 34;
  }

  // 최상위 카드들을 열 단위로 쌓아서 배치 (가장 낮은 열에 차례로)
  function autoLayout(nodes, examId, opts) {
    opts = opts || {};
    const index = indexByParent(nodes);
    const cards = kids(index, 'root:' + examId);
    const cols = opts.cols || Math.max(1, Math.min(6, Math.ceil(Math.sqrt(cards.length * 1.4))));
    const ox = opts.x != null ? opts.x : 80;
    const oy = opts.y != null ? opts.y : 80;
    const heights = new Array(cols).fill(oy);
    for (const c of cards) {
      let col = 0;
      for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
      c.x = ox + col * (CARD_W + GAP);
      c.y = heights[col];
      heights[col] += estimateHeight(nodes, c.id, index) + GAP;
    }
    return nodes;
  }

  /**
   * parseOutline 결과를 노드로 만들어 nodes에 추가한다.
   * 최상위 항목 하나가 화이트보드 카드 하나가 된다.
   */
  function addOutline(nodes, examId, tree, uid, opts) {
    opts = opts || {};
    const existing = childrenOf(nodes, null, examId).length;
    let order = nextOrder(nodes, null, examId);
    const added = [];
    tree.forEach((t, i) => {
      const card = {
        id: uid(), examId, parentId: null, kind: 'topic', title: t.title, done: !!t.done,
        flags: {}, order: order++, collapsed: false, x: 0, y: 0,
        color: COLORS[(existing + i) % COLORS.length],
      };
      nodes.push(card);
      added.push(card);
      (function walk(list, parentId) {
        list.forEach((c, j) => {
          const n = { id: uid(), examId, parentId, kind: 'topic', title: c.title, done: !!c.done, flags: {}, order: j, collapsed: false };
          nodes.push(n);
          walk(c.children, n.id);
        });
      })(t.children, card.id);
    });
    // 새 카드만 기존 카드 오른쪽(또는 맨 위)에 배치
    if (added.length) {
      const others = childrenOf(nodes, null, examId).filter((c) => !added.includes(c));
      const index = indexByParent(nodes);
      const startX = others.length ? Math.max(...others.map((c) => (c.x || 0) + CARD_W)) + GAP * 2 : 80;
      const cols = opts.cols || Math.max(1, Math.min(6, Math.ceil(Math.sqrt(added.length * 1.4))));
      const heights = new Array(cols).fill(80);
      for (const c of added) {
        let col = 0;
        for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
        c.x = startX + col * (CARD_W + GAP);
        c.y = heights[col];
        heights[col] += estimateHeight(nodes, c.id, index) + GAP;
      }
    }
    return added;
  }

  // 카드들을 감싸는 사각형 (화면 맞춤용)
  function bounds(nodes, examId, heightOf) {
    const cards = childrenOf(nodes, null, examId);
    if (!cards.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of cards) {
      const h = heightOf ? heightOf(c) : estimateHeight(nodes, c.id);
      x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
      x2 = Math.max(x2, c.x + CARD_W); y2 = Math.max(y2, c.y + h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function daysUntil(dateStr, now) {
    if (!dateStr) return null;
    const t = new Date(dateStr + 'T00:00');
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return Math.round((t - d) / 86400000);
  }

  function ddayLabel(dateStr, now) {
    const n = daysUntil(dateStr, now);
    if (n === null || isNaN(n)) return '';
    if (n === 0) return 'D-DAY';
    return n > 0 ? 'D-' + n : 'D+' + -n;
  }

  // 시험까지 남은 항목을 끝내려면 하루에 몇 개씩 해야 하는지
  function pace(left, dateStr, now) {
    const days = daysUntil(dateStr, now);
    if (days === null || isNaN(days) || left <= 0) return null;
    if (days <= 0) return { days: 0, perDay: left };
    return { days, perDay: Math.ceil(left / days) };
  }

  // 체스 진행 표시: 폰이 8칸을 전진하고, 100%가 되면 퀸으로 승급
  function pawnRank(pct) {
    if (pct >= 100) return { square: 7, promoted: true };
    return { square: Math.min(6, Math.floor((Math.max(0, pct) / 100) * 7)), promoted: false };
  }

  // 텍스트로 내보내기 (들여쓰기 + 체크 표시)
  function toOutline(nodes, examId) {
    const index = indexByParent(nodes);
    const lines = [];
    (function walk(key, depth) {
      for (const n of kids(index, key)) {
        if (n.kind === 'note') continue;
        const isLeaf = kids(index, n.id).length === 0;
        const mark = isLeaf ? (n.done ? '[x] ' : '[ ] ') : '';
        lines.push('  '.repeat(depth) + '- ' + mark + n.title);
        walk(n.id, depth + 1);
      }
    })('root:' + examId, 0);
    return lines.join('\n');
  }

  const SAMPLE = [
    '# 국어',
    '- 문학',
    '  - 현대시: 진달래꽃, 사평역에서',
    '  - 고전시가: 관동별곡',
    '  - 현대소설: 운수 좋은 날',
    '- 문법',
    '  - 음운의 변동',
    '  - 문장의 짜임',
    '- 독서: 인문·과학 지문 6개',
    '# 수학',
    '- 1단원 다항식',
    '  - 다항식의 연산',
    '  - 나머지 정리',
    '  - 인수분해',
    '- 2단원 방정식과 부등식',
    '  - 복소수',
    '  - 이차방정식',
    '  - 이차함수와 이차방정식',
    '- 학습지 1~3회',
    '# 영어',
    '- 교과서 1~3과 본문',
    '- 어휘 Day 1~15',
    '- 문법: 관계대명사, 분사구문',
    '- 모의고사 지문 10개',
    '# 한국사',
    '- 선사 시대와 고조선',
    '- 삼국의 성립과 발전',
    '- 남북국 시대',
    '# 통합과학',
    '- 물질의 규칙성',
    '  - 원소의 생성',
    '  - 주기율표',
    '- 화학 결합',
  ].join('\n');

  const api = {
    CARD_W, GAP, COLORS, SAMPLE,
    childrenOf, indexByParent, subtreeIds, leavesUnder, progress, examProgress,
    setDone, toggle, removeSubtree, depthOf, nextOrder,
    parseOutline, countOutline, addOutline, autoLayout, estimateHeight, bounds,
    daysUntil, ddayLabel, toOutline, pace, pawnRank,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scope = api;
})(typeof window !== 'undefined' ? window : globalThis);
