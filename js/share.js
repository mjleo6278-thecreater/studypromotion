/* 공부 인증 이미지: 하루 공부 시간·과목·10분 칸 시간표를 1080×1920 그림으로 (인스타 스토리 크기) */
(function (root) {
  const W = 1080, H = 1920, X0 = 96, X1 = W - 96;
  const FONT = '"Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const C = { bg: '#0a0a0a', text: '#f5f5f5', sub: '#a3a3a3', faint: '#6b6b6b', cell: '#1c1c1c', line: '#2a2a2a', accent: '#04becd', none: '#8f8f8f' };
  // 앱 아이콘(책 위 왕관)과 체스 말 — 화면에서 쓰는 SVG와 같은 모양
  const ICON = {
    book: 'M50 80 C40 74 28 73 18 75 L18 47 C28 45 40 46 50 52 C60 46 72 45 82 47 L82 75 C72 73 60 74 50 80 Z',
    spine: 'M50 52 L50 80',
    crown: 'M31 40 L28 20 L40 29 L50 15 L60 29 L72 20 L69 40 Z',
  };
  const PAWN_BODY = 'M7.6 8.6h4.8l-.6 1.3c1.4 1.6 2.4 3.6 2.6 6H5.6c.2-2.4 1.2-4.4 2.6-6z';
  const QUEEN_BODY = 'M3.4 14.8 2.6 6.4l4.2 4L10 3.6l3.2 6.8 4.2-4-.8 8.4z';

  const font = (size, weight) => `${weight || 500} ${size}px ${FONT}`;

  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function text(ctx, s, x, y, size, weight, color, align) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  // 칸보다 길면 뒤를 줄여 …을 붙인다 (ctx.font가 정해진 상태에서)
  function fit(ctx, s, max) {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  function piece(ctx, kind, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 20, size / 20);
    ctx.fillStyle = color;
    if (kind === 'queen') {
      ctx.fill(new Path2D(QUEEN_BODY));
      [[2.6, 5.6], [10, 2.8], [17.4, 5.6]].forEach(([cx, cy]) => { ctx.beginPath(); ctx.arc(cx, cy, 1.4, 0, Math.PI * 2); ctx.fill(); });
      rrect(ctx, 3.2, 15.4, 13.6, 3, 1); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(10, 5.2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fill(new Path2D(PAWN_BODY));
      rrect(ctx, 4.2, 15.6, 11.6, 2.8, 1); ctx.fill();
    }
    ctx.restore();
  }

  function logo(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.fillStyle = C.cell;
    rrect(ctx, 0, 0, 100, 100, 22); ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke(new Path2D(ICON.book));
    ctx.stroke(new Path2D(ICON.spine));
    const crown = new Path2D(ICON.crown);
    ctx.lineWidth = 2; ctx.fill(crown); ctx.stroke(crown);
    ctx.restore();
  }

  // '5시간 8분' → 숫자는 크게, 단위는 작게
  function bigTime(ctx, min, x, y) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    const parts = [];
    if (h) parts.push([String(h), 1], ['시간', 0]);
    if (m || !h) parts.push([String(m), 1], ['분', 0]);
    let cx = x;
    parts.forEach(([s, isNum], i) => {
      const w = text(ctx, s, cx, y, isNum ? 210 : 76, isNum ? 800 : 700, isNum ? C.text : C.sub);
      cx += w + (isNum ? 12 : i < parts.length - 1 ? 34 : 0);
    });
    return cx - x;
  }

  function fm(min) {
    min = Math.round(min);
    if (min < 60) return min + '분';
    const h = Math.floor(min / 60), m = min % 60;
    return m ? h + '시간 ' + m + '분' : h + '시간';
  }

  /** 하루 공부를 그린 캔버스를 돌려준다.
   *  d: { title, date, total, goal, exam: {name, dday}|null, subjects: [{name, color, minutes}],
   *       timeline: Stats.dayTimeline 결과, colorOf(subjectId), range: '9:00 ~ 17:03', track: {square, promoted} }
   */
  async function render(d) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    // 글꼴 조각(한글은 글자마다 파일이 나뉨)을 먼저 받아 둔다
    const all = [d.title, d.date, d.range || '', (d.exam && d.exam.name + d.exam.dday) || '', d.subjects.map((s) => s.name + fm(s.minutes)).join(''),
      '스터디 프로모션한 칸씩 전진해서, 시험 날엔 퀸으로.하루 목표달성 · 퀸으로 승급!공부 시간표과목별기타시간분0123456789%~:직접 기록은 시간표 밖'].join('');
    if (document.fonts && document.fonts.load) {
      try {
        await Promise.race([
          Promise.all([document.fonts.load(font(40, 500), all), document.fonts.load(font(210, 800), '0123456789')]),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
      } catch (e) { /* 시스템 글꼴로 */ }
    }

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    // 맨 위 체스판 띠
    for (let i = 0; i < 18; i++) { ctx.fillStyle = i % 2 ? '#141414' : '#0f0f0f'; ctx.fillRect(i * 60, 0, 60, 24); }

    // 머리: 아이콘 · 앱 이름 · 날짜
    logo(ctx, X0, 96, 88);
    text(ctx, '스터디 프로모션', X0 + 112, 154, 40, 700, C.text);
    text(ctx, d.date, X1, 154, 34, 500, C.sub, 'right');

    // 오늘의 공부 + 다가오는 시험
    let y = 330;
    text(ctx, d.title, X0, y, 46, 700, C.sub);
    if (d.exam) {
      ctx.font = font(34, 700);
      const label = fit(ctx, `${d.exam.name} ${d.exam.dday}`, 420);
      const w = ctx.measureText(label).width + 48;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 3;
      rrect(ctx, X1 - w, y - 46, w, 62, 31); ctx.stroke();
      text(ctx, label, X1 - w / 2, y - 3, 34, 700, C.accent, 'center');
    }
    y += 230;
    bigTime(ctx, d.total, X0 - 6, y);

    // 하루 목표
    y += 90;
    if (d.goal > 0) {
      const pct = Math.round((d.total / d.goal) * 100);
      text(ctx, `하루 목표 ${fm(d.goal)} · ${pct}%`, X0, y, 36, 600, C.sub);
      if (pct >= 100) {
        const w = text(ctx, '목표 달성 · 퀸으로 승급!', X1, y, 36, 700, C.accent, 'right');
        piece(ctx, 'queen', X1 - w - 56, y - 38, 44, C.accent);
      }
      y += 34;
      ctx.fillStyle = C.line; rrect(ctx, X0, y, X1 - X0, 22, 11); ctx.fill();
      ctx.fillStyle = C.accent; rrect(ctx, X0, y, Math.max(22, (X1 - X0) * Math.min(1, d.total / d.goal)), 22, 11); ctx.fill();
      y += 22;
    }

    // 과목별: 한 줄 막대 + 두 칸 목록
    const subs = d.subjects.slice(0, 6);
    if (d.subjects.length > 6) {
      const rest = d.subjects.slice(5).reduce((a, s) => a + s.minutes, 0);
      subs.splice(5, 1, { name: '기타', color: C.none, minutes: rest });
    }
    y += 84;
    text(ctx, '과목별', X0, y, 36, 600, C.sub);
    y += 34;
    const sum = subs.reduce((a, s) => a + s.minutes, 0) || 1;
    ctx.save();
    rrect(ctx, X0, y, X1 - X0, 30, 15); ctx.clip();
    let sx = X0;
    subs.forEach((s) => { const w = ((X1 - X0) * s.minutes) / sum; ctx.fillStyle = s.color || C.none; ctx.fillRect(sx, y, w + 1, 30); sx += w; });
    ctx.restore();
    y += 30 + 26;
    const gutter = 64, colW = (X1 - X0 - gutter) / 2;
    subs.forEach((s, i) => {
      const cx = X0 + (i % 2) * (colW + gutter), cy = y + Math.floor(i / 2) * 66 + 44;
      ctx.fillStyle = s.color || C.none;
      ctx.beginPath(); ctx.arc(cx + 12, cy - 13, 12, 0, Math.PI * 2); ctx.fill();
      ctx.font = font(36, 500);
      const t = fm(s.minutes);
      const tw = ctx.measureText(t).width;
      ctx.font = font(38, 600);
      text(ctx, fit(ctx, s.name, colW - tw - 64), cx + 38, cy, 38, 600, C.text);
      text(ctx, t, cx + colW, cy, 36, 500, C.sub, 'right');
    });
    y += Math.ceil(subs.length / 2) * 66 + 20;

    // 10분 칸 시간표
    const tl = d.timeline;
    const footTop = H - 250;
    if (tl && tl.hours.length) {
      y += 70;
      text(ctx, '공부 시간표', X0, y, 36, 600, C.sub);
      if (d.range) text(ctx, d.range, X1, y, 34, 500, C.sub, 'right');
      y += 34;
      const n = tl.hours.length;
      const rowH = Math.max(18, Math.min(58, (footTop - 40 - y) / n));
      const cellH = Math.max(12, rowH - Math.min(10, rowH * 0.2));
      const gx = X0 + 76, gap = 8, cellW = (X1 - gx - gap * 5) / 6;
      tl.hours.forEach((h, r) => {
        const ry = y + r * rowH;
        if (rowH >= 26 || r % 2 === 0) {
          ctx.font = font(Math.round(Math.min(32, rowH * 0.62)), 600);
          ctx.fillStyle = C.faint; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(String(h.hour), X0 + 50, ry + cellH / 2 + 1);
        }
        for (let c = 0; c < 6; c++) {
          const cx = gx + c * (cellW + gap);
          ctx.save();
          rrect(ctx, cx, ry, cellW, cellH, Math.min(8, cellH / 3));
          ctx.fillStyle = C.cell; ctx.fill();
          ctx.clip();
          h.segs.forEach((g) => {
            const a = Math.max(g.from, c * 10), b = Math.min(g.to, c * 10 + 10);
            if (b <= a) return;
            ctx.fillStyle = d.colorOf(g.subjectId) || C.none;
            ctx.fillRect(cx + ((a - c * 10) / 10) * cellW, ry, ((b - a) / 10) * cellW + 0.5, cellH);
          });
          ctx.restore();
        }
      });
    } else if (tl && tl.untimed) {
      y += 70;
      text(ctx, '직접 기록한 공부만 있는 날이에요', X0, y, 34, 500, C.faint);
    }

    // 발: 체스 진행 + 한 줄
    const sq = 64, tx = (W - sq * 8) / 2, ty = H - 210;
    const tr = d.track || { square: 0, promoted: false };
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#1c1c1c' : '#262626';
      ctx.fillRect(tx + i * sq, ty, sq, sq);
      if (i < tr.square || tr.promoted) { ctx.fillStyle = 'rgba(4, 190, 205, .28)'; ctx.fillRect(tx + i * sq, ty, sq, sq); }
    }
    piece(ctx, tr.promoted ? 'queen' : 'pawn', tx + tr.square * sq + 8, ty + 8, sq - 16, tr.promoted ? C.accent : '#ffffff');
    text(ctx, '한 칸씩 전진해서, 시험 날엔 퀸으로.', W / 2, H - 76, 32, 500, C.faint, 'center');
    return canvas;
  }

  root.StudyCard = { render, W, H };
})(typeof window !== 'undefined' ? window : globalThis);
