/* 통계 계산 (순수 함수) */
(function (root) {
  function dayKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function addDays(ts, n) {
    const d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  // { 'YYYY-MM-DD': 분 }
  function minutesByDay(sessions) {
    const out = {};
    for (const s of sessions) {
      const k = dayKey(s.endedAt);
      out[k] = (out[k] || 0) + s.minutes;
    }
    return out;
  }

  function minutesOn(sessions, ts) {
    return minutesByDay(sessions)[dayKey(ts)] || 0;
  }

  // 최근 n일 [{key, label, minutes}] (오래된 날 → 오늘)
  function lastNDays(sessions, now, n) {
    const map = minutesByDay(sessions);
    const names = ['일', '월', '화', '수', '목', '금', '토'];
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const ts = addDays(now, -i);
      const k = dayKey(ts);
      out.push({ key: k, label: i === 0 ? '오늘' : names[new Date(ts).getDay()], minutes: map[k] || 0 });
    }
    return out;
  }

  /**
   * 연속 학습일: 오늘(또는 오늘 아직 안 했으면 어제)부터 거꾸로
   * 공부 기록(세션 또는 카드 복습)이 있는 날이 이어진 수.
   */
  function streak(activeDayKeys, now) {
    const set = new Set(activeDayKeys);
    let cursor = now;
    if (!set.has(dayKey(cursor))) cursor = addDays(cursor, -1);
    let count = 0;
    while (set.has(dayKey(cursor))) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function minutesBySubject(sessions) {
    const out = {};
    for (const s of sessions) {
      const k = s.subjectId || 'none';
      out[k] = (out[k] || 0) + s.minutes;
    }
    return out;
  }

  function formatMinutes(min) {
    min = Math.round(min);
    if (min < 60) return min + '분';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? h + '시간 ' + m + '분' : h + '시간';
  }

  function monthKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // 최근 n개월 [{key, label, minutes, days}] (오래된 달 → 이번 달). days = 공부한 날 수
  function lastNMonths(sessions, now, n) {
    const mins = {}, daySets = {};
    for (const s of sessions) {
      const k = monthKey(s.endedAt);
      mins[k] = (mins[k] || 0) + s.minutes;
      (daySets[k] = daySets[k] || new Set()).add(dayKey(s.endedAt));
    }
    const out = [];
    const base = new Date(now);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const k = monthKey(d.getTime());
      out.push({ key: k, label: (d.getMonth() + 1) + '월', year: d.getFullYear(), month: d.getMonth() + 1, minutes: mins[k] || 0, days: daySets[k] ? daySets[k].size : 0 });
    }
    return out;
  }

  // 월 목표 진행: goalMin 목표(분), minutes 이번 달 공부(분), now 기준 남은 날(오늘 포함)로 하루 필요량 계산
  //  todayMin: 오늘 이미 한 양 (오늘 몫 계산에 사용)
  function monthGoal(goalMin, minutes, now, todayMin) {
    if (!goalMin) return null;
    const d = new Date(now);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const daysLeft = lastDay - d.getDate() + 1;
    const remaining = Math.max(0, goalMin - minutes);
    const expected = goalMin * (d.getDate() / lastDay); // 오늘까지 이 정도는 했어야 계획대로
    todayMin = todayMin || 0;
    const before = Math.max(0, minutes - todayMin); // 어제까지 한 양
    const todayQuota = Math.max(0, Math.ceil((goalMin - before) / daysLeft)); // 오늘 해야 할 양
    return {
      basePerDay: Math.ceil(goalMin / lastDay),
      todayQuota,
      todayLeft: Math.max(0, todayQuota - todayMin),
      pct: Math.min(100, Math.round((minutes / goalMin) * 100)),
      remaining,
      daysLeft,
      perDay: remaining ? Math.ceil(remaining / daysLeft) : 0,
      onTrack: minutes >= expected,
      paceMin: Math.round(minutes - expected),
      done: minutes >= goalMin,
    };
  }

  /**
   * 공부 달력: 그달 날마다 공부 시간과 진하기 단계.
   * level 0 없음 · 1 1시간 미만 · 2 1~2시간 · 3 2~4시간 · 4 4시간 이상
   * lead = 1일 앞의 빈칸 수 (일요일 시작)
   */
  function monthCalendar(sessions, year, month0) {
    const map = minutesByDay(sessions);
    const n = new Date(year, month0 + 1, 0).getDate();
    const days = [];
    let total = 0, studied = 0, best = 0;
    for (let d = 1; d <= n; d++) {
      const key = year + '-' + String(month0 + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const minutes = map[key] || 0;
      total += minutes;
      if (minutes > 0) studied++;
      if (minutes > best) best = minutes;
      days.push({ key, day: d, minutes, level: minutes <= 0 ? 0 : minutes < 60 ? 1 : minutes < 120 ? 2 : minutes < 240 ? 3 : 4 });
    }
    return { year, month: month0 + 1, lead: new Date(year, month0, 1).getDay(), days, total, studied, best };
  }

  /**
   * 하루 공부 시간표 (10분 칸 스터디 플래너처럼 시간대별로)
   *  key 'YYYY-MM-DD' 하루에 걸친 기록을 시(0~23)마다 조각으로 나눈다. 자정을 넘긴 기록은 그날 몫만.
   *  직접 기록은 언제 했는지 모르니 시간표에 넣지 않고 untimed(분)로 합만 낸다.
   *  반환: { hours: [{ hour, segs: [{ from, to, subjectId }] }], start, end, timed, untimed }
   *   hours는 처음 공부한 시부터 마지막 시까지, from/to는 그 시 안의 분(0~60), start/end는 시각(ms)
   */
  function dayTimeline(sessions, key) {
    const [y, m, d] = key.split('-').map(Number);
    const d0 = new Date(y, m - 1, d).getTime(), d1 = new Date(y, m - 1, d + 1).getTime();
    const segs = [];
    let untimed = 0, timed = 0, start = null, end = null;
    for (const s of sessions) {
      if (!(s.minutes > 0)) continue;
      if (s.manual) { if (dayKey(s.endedAt) === key) untimed += s.minutes; continue; }
      const from = Math.max(s.endedAt - s.minutes * 60000, d0), to = Math.min(s.endedAt, d1);
      if (to <= from) continue;
      timed += (to - from) / 60000;
      start = start === null ? from : Math.min(start, from);
      end = end === null ? to : Math.max(end, to);
      segs.push({ from, to, subjectId: s.subjectId || null });
    }
    const hours = [];
    if (segs.length) {
      segs.sort((a, b) => a.from - b.from);
      const h0 = new Date(start).getHours(), h1 = new Date(end - 1).getHours();
      for (let h = h0; h <= h1; h++) {
        const t0 = new Date(y, m - 1, d, h).getTime(), t1 = new Date(y, m - 1, d, h + 1).getTime();
        hours.push({ hour: h, segs: segs.filter((g) => g.to > t0 && g.from < t1).map((g) => ({
          from: Math.round(((Math.max(g.from, t0) - t0) / 60000) * 10) / 10,
          to: Math.round(((Math.min(g.to, t1) - t0) / 60000) * 10) / 10,
          subjectId: g.subjectId,
        })) });
      }
    }
    return { hours, start, end, timed: Math.round(timed), untimed };
  }

  const api = { monthGoal, monthKey, lastNMonths, monthCalendar, dayTimeline, dayKey, addDays, minutesByDay, minutesOn, lastNDays, streak, minutesBySubject, formatMinutes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
