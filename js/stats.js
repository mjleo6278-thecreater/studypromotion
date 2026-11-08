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

  const api = { monthKey, lastNMonths, dayKey, addDays, minutesByDay, minutesOn, lastNDays, streak, minutesBySubject, formatMinutes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
