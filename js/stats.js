/* 통계 계산 (순수 함수) */
(function (root) {
  // 하루가 시작되는 시각(설정). 0이면 자정(기본). 예: 새벽 4시로 두면 새벽 1시에 한 공부는 전날 공부로 센다.
  // 시험 범위·카드 복습·스톱워치도 같은 값을 보도록 전역(root)에 둔다.
  const HOUR = 3600000;
  function dayOffset() { return root.__spDayStartMs || 0; }
  function setDayStart(hour) { root.__spDayStartMs = Math.max(0, Math.min(12, Math.floor(+hour || 0))) * HOUR; }

  // 달력 날짜 그대로 (파일 이름이나 카드 복습 날짜처럼 하루 시작 시각과 상관없는 곳에 쓴다)
  function dateKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // 공부한 날: 하루 시작 시각이 되기 전의 새벽은 전날로 친다
  function dayKey(ts) {
    return dateKey(ts - dayOffset());
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

  /* ---------- 하루 공부 기록은 24시간까지 (v4.6.3) ----------
   *  직접 기록을 여러 번 넣어 하루 24시간이 넘는 기록이 생기던 것을 막는다.
   *  - 기록을 넣는 곳(직접 기록·세컨드·끝낸 할 일·일정)은 dayRoom으로 그날 남은 시간을 보고, 넘으면 넣지 않는다.
   *  - 그 밖의 길(타이머와 직접 기록이 겹침, 가져오기·계정 동기화, 예전에 쌓인 기록)은 저장소가 fitDays로 24시간에 맞춘다.
   */
  const DAY_MAX = 24 * 60;
  // 그 공부 날짜(key)에 더 기록할 수 있는 분 (0 ~ 1440)
  function dayRoom(sessions, key) {
    let used = 0;
    for (const s of sessions || []) if (s && s.endedAt && s.minutes > 0 && dayKey(s.endedAt) === key) used += +s.minutes;
    return Math.max(0, DAY_MAX - Math.round(used));
  }
  // 하루 24시간이 넘는 날을 24시간에 맞춘다. state.sessions를 고친다.
  //  줄이는 순서: 손으로 적은 기록(직접 기록·끝낸 할 일·세컨드로 넣은 기록)을 나중에 넣은 것부터 줄이고, 0분이 되면 지운다.
  //  타이머·스톱워치·잠금으로 잰 기록은 손으로 적은 기록을 다 줄여도 넘을 때만 (나중 것부터) 줄인다.
  //  날짜는 그 기록의 하루 시작 시각 설정으로 나눈다 (저장소가 처음 읽을 때는 아직 전역 설정이 없어서)
  //  반환 { cut: 뺀 분, days: 맞춘 날짜들 }
  function fitDays(state) {
    const list = state && Array.isArray(state.sessions) ? state.sessions : null;
    if (!list || !list.length) return { cut: 0, days: [] };
    const set = state.settings && state.settings.dayStartHour;
    const off = set == null ? dayOffset() : Math.max(0, Math.min(12, Math.floor(+set || 0))) * HOUR;
    const key = (t) => dateKey(t - off);
    const counted = (s) => s && typeof s === 'object' && s.endedAt && +s.minutes > 0;
    const used = {};
    for (const s of list) if (counted(s)) { const k = key(s.endedAt); used[k] = (used[k] || 0) + +s.minutes; }
    const days = Object.keys(used).filter((k) => Math.round(used[k]) > DAY_MAX).sort();
    if (!days.length) return { cut: 0, days: [] };
    const gone = new Set();
    let cut = 0;
    for (const k of days) {
      let extra = Math.round(used[k]) - DAY_MAX;
      for (const hand of [true, false]) {
        for (let i = list.length - 1; i >= 0 && extra > 0; i--) {
          const s = list[i];
          if (!counted(s) || gone.has(s) || !!s.manual !== hand || key(s.endedAt) !== k) continue;
          const take = Math.min(+s.minutes, extra);
          s.minutes = Math.round(+s.minutes - take);
          if (s.sec > 0) s.sec = Math.min(s.sec, s.minutes * 60);
          if (!(s.minutes > 0)) gone.add(s);
          extra -= take;
          cut += take;
        }
      }
    }
    if (gone.size) state.sessions = list.filter((s) => !gone.has(s));
    return { cut: Math.round(cut), days };
  }

  // 최근 n일 [{key, label, minutes}] (오래된 날 → 오늘)
  function lastNDays(sessions, now, n) {
    const map = minutesByDay(sessions);
    const names = ['일', '월', '화', '수', '목', '금', '토'];
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const ts = addDays(now, -i);
      const k = dayKey(ts);
      out.push({ key: k, label: i === 0 ? '오늘' : names[new Date(ts - dayOffset()).getDay()], minutes: map[k] || 0 });
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

  // 받침에 맞는 조사를 고른다: josa('국어', '을/를') → '를', josa('수학', '을/를') → '을'
  // pair는 '받침 있을 때/없을 때' 순서 ('을/를', '이/가', '은/는', '과/와', '으로/로')
  function josa(word, pair) {
    const parts = String(pair).split('/');
    const s = String(word == null ? '' : word).replace(/[\s'"‘’“”)\]…·.,!?]+$/, '');
    const last = s.slice(-1);
    const code = last.charCodeAt(0);
    let jong = 0; // 받침 번호 (0이면 받침 없음, 8이면 ㄹ)
    if (code >= 0xac00 && code <= 0xd7a3) jong = (code - 0xac00) % 28;
    else if (/[0-9]/.test(last)) jong = [21, 8, 0, 16, 0, 0, 1, 8, 8, 0][+last]; // 영·일·이·삼·사·오·육·칠·팔·구
    else if (/[a-z]/i.test(last)) jong = /[lL]/.test(last) ? 8 : /[mnMN]/.test(last) || /ng$/i.test(s) ? 4 : 0;
    if (parts[0] === '으로') return jong && jong !== 8 ? '으로' : '로';
    return jong ? parts[0] : parts[1];
  }

  const ymKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  function monthKey(ts) {
    return ymKey(new Date(ts - dayOffset()));
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
    const base = new Date(now - dayOffset());
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const k = ymKey(d);
      out.push({ key: k, label: (d.getMonth() + 1) + '월', year: d.getFullYear(), month: d.getMonth() + 1, minutes: mins[k] || 0, days: daySets[k] ? daySets[k].size : 0 });
    }
    return out;
  }

  // 월 목표 진행: goalMin 목표(분), minutes 이번 달 공부(분), now 기준 남은 날(오늘 포함)로 하루 필요량 계산
  //  todayMin: 오늘 이미 한 양 (오늘 몫 계산에 사용)
  function monthGoal(goalMin, minutes, now, todayMin) {
    if (!goalMin) return null;
    const d = new Date(now - dayOffset());
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
   *  key 'YYYY-MM-DD' 하루에 걸친 기록을 시(0~23)마다 조각으로 나눈다. 하루가 끝나는 시각(기본 자정)을 넘긴 기록은 그날 몫만.
   *  직접 기록은 언제 했는지 모르니 시간표에 넣지 않고 untimed(분)로 합만 낸다.
   *  반환: { hours: [{ hour, segs: [{ from, to, subjectId }] }], start, end, timed, untimed }
   *   hours는 처음 공부한 시부터 마지막 시까지, from/to는 그 시 안의 분(0~60), start/end는 시각(ms)
   *  opts.live: 지금 재고 있는 구간 { from, to, subjectId } (아직 기록 전이지만 바로 칠한다, 조각에 live: true가 붙는다)
   *  opts.full: 공부한 시간대만이 아니라 하루 전체 24줄 (타임테이블 화면, 하루 시작 시각부터)
   */
  // 기록이 차지하는 시각 [시작, 끝] (ms). 시각 없이 시간만 적은 직접 기록은 null
  //  타이머·스톱워치 기록: 끝난 시각에서 공부한 분만큼 앞으로
  //  시각을 적은 직접 기록(manual + startAt): 적은 시작 시각부터 (하루 끝에 딱 맞춰 끝나면 endedAt을 1ms 당겨 그날에 넣어 둔다)
  function sessionSpan(s) {
    if (!s || !(s.minutes > 0)) return null;
    if (s.manual) return +s.startAt > 0 ? [+s.startAt, +s.startAt + s.minutes * 60000] : null;
    return [s.endedAt - s.minutes * 60000, s.endedAt];
  }

  function dayTimeline(sessions, key, opts) {
    opts = opts || {};
    const [y, m, d] = key.split('-').map(Number);
    const off = dayOffset();
    const d0 = new Date(y, m - 1, d).getTime() + off, d1 = new Date(y, m - 1, d + 1).getTime() + off;
    const segs = [];
    let untimed = 0, timed = 0, start = null, end = null;
    const add = (a, b, subjectId, live) => {
      const from = Math.max(a, d0), to = Math.min(b, d1);
      if (!(to > from)) return;
      timed += (to - from) / 60000;
      start = start === null ? from : Math.min(start, from);
      end = end === null ? to : Math.max(end, to);
      const g = { from, to, subjectId: subjectId || null };
      if (live) g.live = true;
      segs.push(g);
    };
    for (const s of sessions) {
      if (!(s.minutes > 0)) continue;
      const span = sessionSpan(s);
      if (!span) { if (dayKey(s.endedAt) === key) untimed += s.minutes; continue; }
      add(span[0], span[1], s.subjectId, false);
    }
    if (opts.live) add(opts.live.from, opts.live.to, opts.live.subjectId, true);
    const hours = [];
    if (segs.length || opts.full) {
      segs.sort((a, b) => a.from - b.from);
      // 하루 시작 시각이 새벽이면 그날의 시간표가 다음 날 새벽까지 이어진다 (… 22시, 23시, 0시, 1시)
      const midnight = new Date(y, m - 1, d).getTime();
      const h0 = opts.full ? Math.round(off / HOUR) : Math.floor((start - midnight) / HOUR);
      const h1 = opts.full ? h0 + 23 : Math.floor((end - 1 - midnight) / HOUR);
      for (let h = h0; h <= h1; h++) {
        const t0 = new Date(y, m - 1, d, h).getTime(), t1 = new Date(y, m - 1, d, h + 1).getTime();
        hours.push({ hour: h % 24, segs: segs.filter((g) => g.to > t0 && g.from < t1).map((g) => {
          const o = {
            from: Math.round(((Math.max(g.from, t0) - t0) / 60000) * 10) / 10,
            to: Math.round(((Math.min(g.to, t1) - t0) / 60000) * 10) / 10,
            subjectId: g.subjectId,
          };
          if (g.live) o.live = true;
          return o;
        }) });
      }
    }
    return { hours, start, end, timed: Math.round(timed), untimed };
  }

  /* ---------- 끝낸 할 일·범위의 소요 시간을 공부 기록으로 (v3.5.1) ----------
   *  할 일의 예상 시간이나 범위 항목의 소요시간을 적어 두고 끝냈다고 누르면, 그 시간을 오늘 공부 기록으로 남긴다.
   *  기록: { id, kind: 'done', manual: true, doneOf: 'task:<id>'|'topic:<id>', subjectId, minutes, endedAt, label, taskId?, topicId? }
   *   - manual이라 시각 없는 기록이다(타임테이블 '시각 없음', 집중 횟수에 안 셈).
   *   - 타이머·스톱워치로 이미 잰 항목(같은 할 일·범위로 남은 기록이 있음)은 두 번 넣지 않는다.
   *     범위에서 '오늘 할 일로 보내기'로 만든 할 일은 그 범위와 한 몸으로 본다(둘 다 체크해도 한 번만).
   *   - 끝냄을 취소하면 오늘 넣은 것만 뺀다. 지난날 넣은 기록은 그날 실제로 공부한 것이라 남긴다.
   */
  const DONE_MAX = 24 * 60; // 한 번에 넣는 최대(분): 직접 기록과 같게 하루치
  const doneMinutes = (v) => Math.min(DONE_MAX, Math.max(0, Math.round(+v || 0)));
  function doneCounted(sessions, o) {
    return sessions.some((s) => (s.taskId && o.taskIds.includes(s.taskId)) || (s.topicId && o.topicIds.includes(s.topicId)));
  }
  function taskDoneInfo(state, t) {
    return { key: 'task:' + t.id, minutes: doneMinutes(t.estimateMin), subjectId: t.subjectId || null, label: t.title || null,
      taskId: t.id, topicId: t.topicId || null, taskIds: [t.id], topicIds: t.topicId ? [t.topicId] : [] };
  }
  function topicDoneInfo(state, n) {
    const by = new Map(state.topics.map((x) => [x.id, x]));
    let card = n;
    while (card.parentId && by.get(card.parentId)) card = by.get(card.parentId);
    const subj = (state.subjects || []).find((x) => x.name === card.title);
    return { key: 'topic:' + n.id, minutes: doneMinutes(n.est), subjectId: subj ? subj.id : null, label: card.id === n.id ? n.title : `${card.title} · ${n.title}`,
      taskId: null, topicId: n.id, taskIds: (state.tasks || []).filter((t) => t.topicId === n.id).map((t) => t.id), topicIds: [n.id] };
  }
  function pushDone(state, o, now, id) {
    if (!(o.minutes >= 1) || doneCounted(state.sessions, o)) return null;
    const minutes = Math.min(o.minutes, dayRoom(state.sessions, dayKey(now))); // 하루 24시간까지
    if (minutes < 1) return null;
    const s = { id, kind: 'done', manual: true, doneOf: o.key, subjectId: o.subjectId, minutes, endedAt: now, label: o.label };
    if (o.taskId) s.taskId = o.taskId;
    if (o.topicId) s.topicId = o.topicId;
    state.sessions.push(s);
    return s;
  }
  // 끝낸 할 일 하나: 넣을 시간이 있으면 기록을 더하고 그 기록을 돌려준다 (없으면 null)
  function creditTask(state, t, now, id) {
    return t && t.done ? pushDone(state, taskDoneInfo(state, t), now, id) : null;
  }
  // 끝내면 몇 분이 들어갈지 (미리 보기용, 0이면 안 들어감)
  function taskCreditMinutes(state, t, now) {
    const o = taskDoneInfo(state, t);
    if (!(o.minutes >= 1) || doneCounted(state.sessions, o)) return 0;
    const m = Math.min(o.minutes, dayRoom(state.sessions, dayKey(now || Date.now())));
    return m >= 1 ? m : 0;
  }
  // 범위 잎 항목 하나 (하위 항목이 있는 항목·메모는 넣지 않는다)
  function creditTopic(state, n, now, id) {
    if (!n || !n.done || n.kind === 'note' || state.topics.some((x) => x.parentId === n.id)) return null;
    return pushDone(state, topicDoneInfo(state, n), now, id);
  }
  // 끝냄을 취소: 그 항목으로 오늘 넣은 기록을 뺀다. 뺀 분을 돌려준다
  function uncreditDone(state, key, now) {
    const today = dayKey(now);
    let min = 0;
    state.sessions = state.sessions.filter((s) => {
      const hit = s.doneOf === key && dayKey(s.endedAt) === today;
      if (hit) min += s.minutes;
      return !hit;
    });
    return min;
  }
  function doneTopicIds(state) {
    return new Set(state.topics.filter((n) => n.done && n.kind !== 'note').map((n) => n.id));
  }
  // 범위 체크가 바뀐 뒤(before = 바꾸기 전 doneTopicIds): 새로 끝낸 항목은 넣고, 체크를 푼 항목은 오늘 넣은 것을 뺀다.
  // 지운 항목은 빼지 않는다(공부한 것은 그대로). 반환 { added: 분, removed: 분, ids: 새 기록 id들 }
  function syncTopicCredits(state, before, now, uid) {
    const after = doneTopicIds(state);
    const out = { added: 0, removed: 0, ids: [] };
    for (const n of state.topics.slice()) {
      if (!after.has(n.id) || before.has(n.id)) continue;
      const s = creditTopic(state, n, now, uid());
      if (s) { out.added += s.minutes; out.ids.push(s.id); }
    }
    before.forEach((id) => {
      if (!after.has(id) && state.topics.some((n) => n.id === id)) out.removed += uncreditDone(state, 'topic:' + id, now);
    });
    return out;
  }

  const api = { monthGoal, monthKey, lastNMonths, monthCalendar, dayTimeline, sessionSpan, dayKey, dateKey, dayOffset, setDayStart, addDays, minutesByDay, minutesOn, lastNDays, streak, minutesBySubject, formatMinutes, josa,
    DAY_MAX, dayRoom, fitDays,
    creditTask, taskCreditMinutes, creditTopic, uncreditDone, doneTopicIds, syncTopicCredits };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
