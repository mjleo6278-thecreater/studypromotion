/* 일정 (순수 함수): 공부 계획과 다른 일정을 날짜·시각으로 적어 두고, 실제 공부 기록과 견준다.
 *
 * 일정 한 개 (store의 events 목록에 한 줄씩. 나중에 AI 도우미가 말로 고치기 쉽게 글자 그대로 둔다)
 *   { id, kind: 'study'|'other', title, subjectId, taskId,
 *     date: 'YYYY-MM-DD',              공부 날짜(하루 시작 시각 기준). 반복이면 첫날
 *     start: 'HH:MM', end: 'HH:MM',    끝이 시작보다 이르거나 같으면 자정을 넘긴 일정 (예: 23:00 ~ 01:00), 끝은 '24:00'도 됨
 *     repeat: null | { freq: 'daily'|'weekly', days: [0~6 (0=일)], until: 'YYYY-MM-DD'|null },
 *     skip: ['YYYY-MM-DD'],            반복 중 빼는 날
 *     createdAt }
 * 하루 시작 시각을 새벽으로 옮겼으면, 그보다 이른 시각은 다음 달력 날의 새벽이다 (직접 기록 창과 같은 규칙).
 */
(function (root) {
  const Stats = root.Stats || (typeof require === 'function' ? require('./stats.js') : null);
  const DAY = 864e5;
  const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n) => String(n).padStart(2, '0');
  const offsetHours = () => Math.round((Stats ? Stats.dayOffset() : 0) / 3600000);

  /* ---------- 날짜·시각 ---------- */
  function keyDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
  function dateToKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shiftKey(key, n) { const d = keyDate(key); d.setDate(d.getDate() + n); return dateToKey(d); }
  function weekday(key) { return keyDate(key).getDay(); }
  function isKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) return false;
    return dateToKey(keyDate(key)) === key; // 2월 30일 같은 없는 날은 안 됨
  }
  // 그 주의 월요일
  function weekStart(key) { const w = weekday(key); return shiftKey(key, w === 0 ? -6 : 1 - w); }
  // 두 날짜 사이의 날 수 (b - a)
  function daysBetween(a, b) { return Math.round((keyDate(b) - keyDate(a)) / DAY); }

  // '7:05' '07:05' '24:00' → 분. 잘못 적었으면 NaN
  function parseHM(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return NaN;
    const h = +m[1], mm = +m[2];
    if (mm > 59 || h > 24 || (h === 24 && mm)) return NaN;
    return h * 60 + mm;
  }
  function fmtHM(min) { min = Math.round(min); return Math.floor(min / 60) + ':' + pad(min % 60); }
  const hm2 = (min) => pad(Math.floor(min / 60)) + ':' + pad(min % 60); // 저장용 'HH:MM'

  // 공부 날짜 key의 h시 m분이 실제로 언제인지
  function clockAt(key, min) {
    const d = keyDate(key), h = Math.floor(min / 60);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (h < offsetHours() ? 1 : 0), h, min % 60).getTime();
  }
  // 일정이 그날 실제로 차지하는 [시작, 끝] (ms)
  function span(ev, key) {
    const a = parseHM(ev.start), b = parseHM(ev.end);
    const from = clockAt(key, a);
    let to = clockAt(key, b);
    if (to <= from) to += DAY;
    return [from, to];
  }

  /* ---------- 반복 ---------- */
  function occursOn(ev, key) {
    if (!ev || !isKey(ev.date) || !isKey(key)) return false;
    if (Array.isArray(ev.skip) && ev.skip.includes(key)) return false;
    const r = ev.repeat;
    if (!r) return ev.date === key;
    if (key < ev.date || (r.until && key > r.until)) return false;
    if (r.freq === 'daily') return true;
    return Array.isArray(r.days) && r.days.includes(weekday(key));
  }

  // 그날의 일정 [{ id, ev, date, from, to, minutes }] (시작 순)
  function forDay(events, key) {
    const out = [];
    for (const ev of events || []) {
      if (!occursOn(ev, key)) continue;
      const [from, to] = span(ev, key);
      out.push({ id: ev.id, ev, date: key, from, to, minutes: Math.round((to - from) / 60000) });
    }
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
  }

  // fromKey부터 toKey까지(둘 다 포함) 날마다 { key: [일정...] }
  function range(events, fromKey, toKey) {
    const out = {};
    for (let k = fromKey, i = 0; k <= toKey && i < 400; k = shiftKey(k, 1), i++) out[k] = forDay(events, k);
    return out;
  }

  /* ---------- 검사 ---------- */
  // 받은 값을 저장할 모양으로 맞춘다. 잘못이면 { error }
  function clean(input, opts) {
    opts = opts || {};
    const x = input || {};
    const kind = x.kind === 'other' ? 'other' : 'study';
    const title = String(x.title == null ? '' : x.title).trim().slice(0, 40);
    const subjectId = kind === 'study' && x.subjectId ? String(x.subjectId) : null;
    if (!title && !subjectId) return { error: kind === 'study' ? '과목을 고르거나 이름을 적어 주세요' : '일정 이름을 적어 주세요' };
    if (!isKey(x.date)) return { error: '날짜를 골라 주세요' };
    const a = parseHM(x.start), b = parseHM(x.end);
    if (Number.isNaN(a) || a >= 1440) return { error: '시작 시각을 바르게 적어 주세요 (0:00 ~ 23:59)' };
    if (Number.isNaN(b)) return { error: '끝 시각을 바르게 적어 주세요 (0:00 ~ 24:00)' };
    if (a === b || (b === 1440 && a === 0)) return { error: '끝 시각을 시작 시각과 다르게 적어 주세요' };
    let repeat = null;
    if (x.repeat && (x.repeat.freq === 'daily' || x.repeat.freq === 'weekly')) {
      const days = x.repeat.freq === 'weekly'
        ? [...new Set((Array.isArray(x.repeat.days) ? x.repeat.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
        : [];
      if (x.repeat.freq === 'weekly' && !days.length) return { error: '반복할 요일을 하나 이상 골라 주세요' };
      const until = x.repeat.until ? String(x.repeat.until) : null;
      if (until && !isKey(until)) return { error: '반복이 끝나는 날을 바르게 골라 주세요' };
      if (until && until < x.date) return { error: '반복이 끝나는 날은 시작하는 날보다 뒤여야 해요' };
      repeat = { freq: x.repeat.freq, days, until };
    }
    const ev = {
      id: x.id || (opts.uid ? opts.uid() : 'ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      kind, title, subjectId,
      taskId: kind === 'study' && x.taskId ? String(x.taskId) : null,
      date: x.date, start: hm2(a), end: b === 1440 ? '24:00' : hm2(b),
      repeat,
      skip: repeat && Array.isArray(x.skip) ? x.skip.filter(isKey) : [],
      createdAt: x.createdAt || (opts.now ? opts.now() : Date.now()),
    };
    // 반복 일정의 첫날이 반복 요일이 아니면, 다음 해당 요일로 옮긴다 (첫 칸이 빈 채로 시작하지 않게)
    if (repeat && repeat.freq === 'weekly' && !repeat.days.includes(weekday(ev.date))) {
      let k = ev.date;
      for (let i = 0; i < 7 && !repeat.days.includes(weekday(k)); i++) k = shiftKey(k, 1);
      if (repeat.until && k > repeat.until) return { error: '반복 기간 안에 고른 요일이 없어요' };
      ev.date = k;
    }
    return ev;
  }

  /* ---------- 실제 공부와 견주기 ---------- */
  // 그 일정 시간에 한 공부(분). 과목이 있는 공부 일정은 같은 과목만 센다. live = 지금 재는 중인 구간 {from, to, subjectId}
  function actualMinutes(occ, sessions, live) {
    if (occ.ev.kind === 'other') return 0;
    const sub = occ.ev.subjectId || null;
    const same = (sid) => !sub || (sid || null) === sub;
    let ms = 0;
    for (const s of sessions || []) {
      if (!same(s.subjectId)) continue;
      const sp = Stats && Stats.sessionSpan(s);
      if (!sp) continue;
      ms += Math.max(0, Math.min(sp[1], occ.to) - Math.max(sp[0], occ.from));
    }
    if (live && same(live.subjectId)) ms += Math.max(0, Math.min(live.to, occ.to) - Math.max(live.from, occ.from));
    return Math.min(occ.minutes, Math.round(ms / 60000));
  }

  // 'other' | 'later'(아직) | 'now'(하는 중) | 'done'(계획의 80% 이상) | 'part'(조금 함) | 'missed'(기록 없음)
  function status(occ, sessions, now, live) {
    if (occ.ev.kind === 'other') return 'other';
    const got = actualMinutes(occ, sessions, live);
    if (got >= occ.minutes * 0.8) return 'done';
    if (now < occ.from) return 'later';
    if (now < occ.to) return 'now';
    return got > 0 ? 'part' : 'missed';
  }

  // 지금 하고 있어야 하는(또는 곧 시작하는) 공부 일정. soonMin분 안에 시작하는 것까지
  function current(events, now, soonMin) {
    const soon = (soonMin == null ? 10 : soonMin) * 60000;
    const k = Stats ? Stats.dayKey(now) : dateToKey(new Date(now));
    const list = forDay(events, shiftKey(k, -1)).concat(forDay(events, k)).filter((o) => o.ev.kind === 'study' && o.to > now && o.from - soon <= now);
    return list.sort((a, b) => a.from - b.from)[0] || null;
  }

  // 기간 안에 계획한 공부 시간(분)
  function plannedMinutes(events, fromKey, toKey) {
    let sum = 0;
    const r = range(events, fromKey, toKey);
    Object.keys(r).forEach((k) => r[k].forEach((o) => { if (o.ev.kind === 'study') sum += o.minutes; }));
    return sum;
  }

  /* ---------- 반복 일정 고치기 ---------- */
  // 반복 중 하루만 뺀다
  function skipDay(ev, key) {
    const out = Object.assign({}, ev, { skip: (ev.skip || []).filter((k) => k !== key).concat(key).sort() });
    return out;
  }
  // key 날부터의 반복을 끊는다: 앞쪽(그 전날까지)만 남긴 일정. 남는 날이 없으면 null
  function endBefore(ev, key) {
    if (!ev.repeat) return null;
    if (key <= ev.date) return null;
    return Object.assign({}, ev, { repeat: Object.assign({}, ev.repeat, { until: shiftKey(key, -1) }), skip: (ev.skip || []).filter((k) => k < key) });
  }

  const api = { parseHM, fmtHM, keyDate, dateToKey, shiftKey, weekday, weekStart, daysBetween, isKey, clockAt, span, occursOn, forDay, range, clean, actualMinutes, status, current, plannedMinutes, skipDay, endBefore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Schedule = api;
})(typeof window !== 'undefined' ? window : globalThis);
