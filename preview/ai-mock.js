/* 미리 보기 전용 가짜 AI. 실제 앱에는 들어가지 않는다 (tools/build-preview.js가 미리 보기 파일에만, ai.js 바로 앞에 넣는다).
 *
 * 진짜 AI 대신, 받은 지시문과 질문을 보고 정해 둔 규칙으로 답을 만든다.
 * 진짜 AI가 받는 것과 똑같은 글(지시문과 [앱 정보])만 보고 답하므로, 화면과 동작은 실제와 같은 길을 지난다:
 *   글이 조금씩 나옴 → <actions>/<cards> 꼬리표 → 앱이 검사 → 미리 보기 → 적용 → 되돌리기
 * 알아듣는 말은 예시 수준이다. 스페인어 풀이도 정해 둔 몇 가지뿐이다. */
(function () {
  'use strict';
  const LIMIT = 40;
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (n) => String(n).padStart(2, '0');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dateOf = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const wdOf = (k) => dateOf(k).getDay();
  const hm = (min) => pad(Math.floor(min / 60) % 24) + ':' + pad(min % 60);
  const hmSay = (s) => { const [h, m] = s.split(':').map(Number); return (h < 12 ? '오전 ' + (h || 12) : '오후 ' + (h === 12 ? 12 : h - 12)) + '시' + (m ? ' ' + m + '분' : ''); };
  const daySay = (k, today) => ({ 0: '오늘', 1: '내일', 2: '모레', '-1': '어제' }[Math.round((dateOf(k) - dateOf(today)) / 864e5)] || `${dateOf(k).getMonth() + 1}월 ${dateOf(k).getDate()}일(${WD[wdOf(k)]})`);
  const tag = (list) => '\n<actions>' + JSON.stringify(list) + '</actions>';

  /* ---------- 정해 둔 표현 풀이 ---------- */
  const CANNED = [
    [/ojal[aá]/i, [
      '**뜻**',
      '내일 비가 안 오면 좋겠다.',
      '',
      '**구문 풀이**',
      '- **Ojalá**: "~이면 좋겠다"라는 바람을 나타내는 말이에요. 뒤에는 항상 접속법이 와요. Ojalá que no llueva처럼 que를 넣어도 같은 뜻이에요.',
      '- **no llueva**: llover(비가 오다)의 접속법 현재 3인칭 단수예요. 직설법이면 llueve인데, Ojalá 뒤라서 llueva가 됐어요.',
      '- **mañana**: 내일(부사).',
      '',
      '**단어와 표현**',
      '| 단어 | 품사 | 뜻 |',
      '| --- | --- | --- |',
      '| ojalá | 감탄사 | ~이면 좋겠다 |',
      '| llover | 동사 (o→ue) | 비가 오다 |',
      '| mañana | 부사 | 내일 (la mañana는 아침) |',
      '',
      '**문법 포인트**',
      '- Ojalá + 접속법 현재: 이루어질 수 있는 바람. Ojalá no llueva. (비가 안 오면 좋겠다.)',
      '- Ojalá + 접속법 과거: 이루어지기 어려운 바람. Ojalá no lloviera. (비가 안 오면 좋으련만.)',
      '<cards>[{"front":"Ojalá + 접속법","back":"~이면 좋겠다 — Ojalá no llueva mañana. (내일 비가 안 오면 좋겠다.)"},{"front":"llover","back":"비가 오다 (접속법 현재 llueva) — Está lloviendo. (비가 오고 있다.)"}]</cards>',
    ]],
    [/echar\s+de\s+menos|echo\s+de\s+menos/i, [
      '**echar de menos**는 "(사람·장소·때를) 그리워하다, 보고 싶어 하다"라는 뜻이에요.',
      '',
      '**예문**',
      '- Te echo de menos. (네가 보고 싶어.)',
      '- Echo de menos la comida de mi madre. (엄마가 해 주신 음식이 그리워.)',
      '',
      '**비슷한 표현과 주의할 점**',
      '- **extrañar**도 같은 뜻이에요. 중남미에서는 extrañar를, 스페인에서는 echar de menos를 더 많이 써요. Te extraño. (네가 보고 싶어.)',
      '- 그리운 대상이 사람이면 앞에 a를 붙여요. Echo de menos **a** mis amigos.',
      '<cards>[{"front":"echar de menos","back":"그리워하다 — Te echo de menos. (네가 보고 싶어.)"},{"front":"extrañar","back":"그리워하다 (중남미에서 많이 씀) — Te extraño mucho. (네가 많이 보고 싶어.)"}]</cards>',
    ]],
    [/tener\s+ganas|tengo\s+ganas/i, [
      '**tener ganas de + 동사원형**은 "~하고 싶다, ~할 마음이 있다"라는 뜻이에요.',
      '',
      '**예문**',
      '- Tengo ganas de viajar. (여행 가고 싶어.)',
      '- No tengo ganas de salir hoy. (오늘은 나가고 싶지 않아.)',
      '',
      '**비슷한 표현**',
      '- querer + 동사원형: 더 직접적으로 "원하다". Quiero viajar.',
      '- apetecer: 스페인에서 많이 써요. Me apetece un café. (커피가 당겨.)',
      '<cards>[{"front":"tener ganas de + 동사원형","back":"~하고 싶다 — Tengo ganas de viajar. (여행 가고 싶어.)"}]</cards>',
    ]],
    [/se\s+me\s+olvid/i, [
      '**뜻**',
      '깜빡했어. (잊어버렸어.)',
      '',
      '**구문 풀이**',
      '- **se**: 일부러 한 일이 아니라 "그렇게 되어 버렸다"는 느낌을 주는 se예요.',
      '- **me**: 나에게(간접 목적격). 그 일이 나에게 일어났다는 뜻이에요.',
      '- **olvidó**: olvidar(잊다)의 부정 과거 3인칭 단수. 주어는 내가 아니라 잊어버린 것이에요.',
      '',
      '**문법 포인트**',
      '- 잊어버린 것이 여러 개면 동사도 복수가 돼요. Se me olvidaron las llaves. (열쇠를 깜빡했어.)',
      '- 같은 모양으로 Se me cayó el vaso. (컵을 떨어뜨렸어.), Se me perdió el móvil. (휴대폰을 잃어버렸어.)',
      '<cards>[{"front":"Se me olvidó","back":"깜빡했어 — Se me olvidaron las llaves. (열쇠를 깜빡했어.)"}]</cards>',
    ]],
  ];
  const FALLBACK = '미리 보기에 붙어 있는 것은 진짜 AI가 아니라, 정해 둔 예시에만 답하는 가짜예요. 그래서 이 말은 알아듣지 못했어요.\n\n이런 말은 알아들어요.\n- Ojalá no llueva mañana 구문 해석해 줘\n- echar de menos가 무슨 뜻이야?\n- 내일 오후 4시부터 6시까지 수학 일정 넣어 줘\n- 못 끝낸 할 일을 내일로 미뤄 줘\n- 이번 주 공부 시간 보여 줘\n- 영어 25분 집중 시작해 줘\n\n실제 앱에서는 진짜 AI가 자유롭게 묻는 말에 답해요.';

  /* ---------- 받은 [앱 정보] 읽기 ---------- */
  function readInfo(sys) {
    const m = /지금: (\d{4}-\d{2}-\d{2})\(.\) (\d+):(\d+)/.exec(sys) || [];
    const today = m[1] || keyOf(new Date());
    const subj = /\n과목: (.*)/.exec(sys);
    const subjects = subj && subj[1] !== '(없음)' ? subj[1].split(', ') : [];
    const tasks = [], exams = [], events = [];
    sys.split('\n').forEach((line) => {
      let x;
      if ((x = /^(t\d+) "(.*)"(?: \[(.*?)\])? (?:마감 (\d{4}-\d{2}-\d{2})|마감 없음)/.exec(line))) tasks.push({ k: x[1], title: x[2], subject: x[3] || '', due: x[4] || '' });
      else if ((x = /^(p\d+) "(.*)"( \[다른 일정\])? (.*)$/.exec(line))) {
        const rest = x[4], rep = /^(매일|매주 [^\s]+)/.exec(rest), day = /(\d{4}-\d{2}-\d{2})/.exec(rest), t = /(\d+:\d+)~(\d+:\d+)/.exec(rest);
        events.push({ k: x[1], name: x[2], other: !!x[3], repeat: rep ? rep[1] : '', date: day ? day[1] : today, start: t ? t[1] : '', end: t ? t[2] : '' });
      }
    });
    const ex = /\nb\) 시험: (.*)/.exec(sys);
    if (ex) ex[1].split('; ').forEach((s) => { const x = /^(e\d+) "(.*)" (\S+)/.exec(s); if (x) exams.push({ k: x[1], name: x[2], date: x[3] }); });
    return { today, nowMin: m[2] ? +m[2] * 60 + +m[3] : 0, subjects, tasks, exams, events };
  }

  /* ---------- 말에서 날짜·시각·과목 찾기 ---------- */
  function findDates(q, today) {
    const out = [];
    const push = (i, key) => out.push({ i, key });
    const words = { 그제: -2, 그저께: -2, 어제: -1, 오늘: 0, 내일: 1, 모레: 2 };
    Object.keys(words).forEach((w) => { for (let i = q.indexOf(w); i >= 0; i = q.indexOf(w, i + 1)) push(i, addDays(today, words[w])); });
    const mon = addDays(today, -((wdOf(today) + 6) % 7));
    const re = /(이번 ?주|다음 ?주|지난 ?주)?\s*([월화수목금토일])요일/g;
    let x, week = null; // 앞에서 '이번 주'·'다음 주'라고 했으면 뒤의 요일도 그 주로 본다
    while ((x = re.exec(q))) {
      const w = WD.indexOf(x[2]), off = (w + 6) % 7; // 월요일부터 며칠째
      let key;
      if (x[1]) { week = /다음/.test(x[1]) ? 7 : /지난/.test(x[1]) ? -7 : 0; key = addDays(mon, off + week); }
      else if (week !== null) key = addDays(mon, off + week);
      else { key = addDays(mon, off); if (key < today) key = addDays(key, 7); }
      push(x.index, key);
    }
    const md = /(\d{1,2})월\s*(\d{1,2})일/g;
    while ((x = md.exec(q))) {
      const y = dateOf(today).getFullYear();
      let key = keyOf(new Date(y, +x[1] - 1, +x[2]));
      if (key < addDays(today, -200)) key = keyOf(new Date(y + 1, +x[1] - 1, +x[2]));
      push(x.index, key);
    }
    return out.sort((a, b) => a.i - b.i);
  }
  function findTimes(q) {
    const out = [];
    const re = /(오전|오후|아침|저녁|밤|낮|새벽)?\s*(\d{1,2})시(?!간)\s*(반|(\d{1,2})분)?/g;
    let x, pm = null;
    while ((x = re.exec(q))) {
      let h = +x[2];
      const mi = x[3] === '반' ? 30 : +(x[4] || 0);
      if (x[1]) pm = /오후|저녁|밤|낮/.test(x[1]);
      if (pm === true && h < 12) h += 12;
      else if (pm === null && h >= 1 && h <= 7) h += 12; // 그냥 '4시'는 오후로 본다
      if (out.length && pm === null && h * 60 + mi <= out[out.length - 1].min && h < 12) h += 12;
      out.push({ i: x.index, min: h * 60 + mi });
    }
    return out;
  }
  function findMinutes(q) {
    const x = /(\d+)\s*시간\s*(반|(\d+)\s*분)?/.exec(q);
    if (x) return +x[1] * 60 + (x[2] === '반' ? 30 : +(x[3] || 0));
    const y = /(\d+)\s*분/.exec(q.replace(/\d{1,2}시\s*\d{1,2}분/g, ''));
    return y ? +y[1] : 0;
  }
  const findSubject = (q, info) => info.subjects.filter((s) => q.includes(s)).sort((a, b) => b.length - a.length)[0] || '';
  function findEvent(q, info) {
    let best = null, score = 0;
    info.events.forEach((e) => {
      const n = e.name.split(/[\s·]+/).filter((w) => w.length > 1 && q.includes(w)).length;
      if (n > score) { best = e; score = n; }
    });
    return best;
  }
  // 시키는 말에서 날짜·시간·'추가해 줘' 같은 말을 떼고 남는 이름
  const strip = (q) => q.replace(/(을|를)?\s*(할 ?일(로|에)?|숙제로|과제로)?\s*(추가|넣어|등록)[^\n]*$/, '').replace(/(그제|어제|오늘|내일|모레|(이번 ?주|다음 ?주)?\s*[월화수목금토일]요일|\d{1,2}월\s*\d{1,2}일)(까지|에)?/g, '').replace(/\d+\s*(시간|분)(\s*(짜리|걸리는|정도))?/g, '').replace(/\s+/g, ' ').trim();
  const happens = (e, key) => (e.repeat ? (e.repeat === '매일' || e.repeat.replace('매주 ', '').split('·').includes(WD[wdOf(key)])) && key >= e.date : e.date === key);

  /* ---------- 시키는 말 ---------- */
  const KIND = [
    ['delete', /지워|삭제|없애|취소해/],
    ['stats', /(공부 ?시간|몇 ?시간|얼마나).*(보여|알려|했|\?|야|지)|통계.*(보여|알려)/],
    ['timer', /(집중|타이머|스톱워치).*(시작|켜)|\d+분.*집중/],
    ['session', /공부했|공부 ?한 ?거|공부 ?기록.*(추가|넣어|남겨)|했다고 ?(기록|적어)/],
    ['movetask', /할 ?일.*(미뤄|미루|옮겨|당겨)/],
    ['done', /(끝냈|다 ?했|완료)/],
    ['moveevent', /(일정|약속|학원|수업|것만).*(옮겨|미뤄|당겨|바꿔)/],
    ['addevent', /(일정|약속|스케줄|시간표).*(넣어|추가|잡아|등록)|시(부터|에).*(넣어|추가|잡아|등록)/],
    ['exam', /(시험|고사).*(추가|등록|넣어|옮겨|바꿔|미뤄)/],
    ['goal', /목표.*\d+\s*(시간|분)/],
    ['subject', /과목.*(추가|만들어)/],
    ['addtask', /(할 ?일|숙제|과제).*(추가|넣어|등록)|추가해/],
    ['open', /(타임테이블|일정표|통계|계획|복습|타이머|홈|범위).*(열어|보여|가 ?줘|이동)/],
    ['list', /(일정|스케줄|약속).*(뭐|있어|알려|보여)|뭐 ?해야/],
  ];
  const classify = (q) => (KIND.find(([, re]) => re.test(q)) || [])[0] || null;

  function build(kind, q, info) {
    const today = info.today, dates = findDates(q, today), times = findTimes(q), subject = findSubject(q, info);
    const d0 = dates[0] ? dates[0].key : null;
    if (kind === 'delete') return '지우는 일은 화면에서 직접 해 주세요. 저는 넣고, 옮기고, 완료로 표시하는 일만 도와드려요.';

    if (kind === 'stats') {
      const mon = addDays(today, -((wdOf(today) + 6) % 7));
      let from = today, to = today, say = '오늘';
      if (/이번 ?주/.test(q)) { from = mon; to = addDays(mon, 6); say = '이번 주'; }
      else if (/지난 ?주/.test(q)) { from = addDays(mon, -7); to = addDays(mon, -1); say = '지난주'; }
      else if (/이번 ?달/.test(q)) { from = today.slice(0, 8) + '01'; say = '이번 달'; }
      else if (/지난 ?달/.test(q)) { const d = dateOf(today.slice(0, 8) + '01'); d.setDate(0); to = keyOf(d); from = to.slice(0, 8) + '01'; say = '지난달'; }
      else if (d0) { from = to = d0; say = daySay(d0, today); }
      const a = { type: 'show_stats', from, to };
      if (subject) a.subject = subject;
      return `${say}${subject ? ' ' + subject : ''} 공부 시간이에요.` + tag([a]);
    }

    if (kind === 'timer') {
      const sw = /스톱워치/.test(q), min = findMinutes(q);
      const a = { type: 'start_timer', kind: sw ? 'stopwatch' : 'focus' };
      if (subject) a.subject = subject;
      if (!sw && min) a.minutes = min;
      return `${subject ? subject + ' ' : ''}${sw ? '스톱워치를' : (min ? min + '분 ' : '') + '집중 타이머를'} 시작할게요. 아래 단추를 누르면 바로 시작해요.` + tag([a]);
    }

    if (kind === 'session') {
      const a = { type: 'add_session', date: d0 || today };
      if (subject) a.subject = subject;
      if (times.length >= 2) { a.start = hm(times[0].min); a.end = hm(times[1].min); }
      else { const min = findMinutes(q); if (!min) return '몇 시부터 몇 시까지, 또는 몇 분 동안 공부했는지 알려 주세요.'; a.minutes = min; }
      return `${daySay(a.date, today)} ${subject ? subject + ' ' : ''}공부를 기록할게요.` + tag([a]);
    }

    if (kind === 'movetask') {
      const to = dates.length ? dates[dates.length - 1].key : addDays(today, 1);
      const late = /못 ?끝낸|밀린|안 ?끝낸|못 ?한/.test(q);
      let list = info.tasks.filter((t) => (late ? t.due && t.due <= today : t.due === today) && t.due !== to);
      const named = info.tasks.filter((t) => t.title.split(/\s+/).some((w) => w.length > 1 && q.includes(w)));
      if (named.length && !late) list = named.filter((t) => t.due !== to);
      if (!list.length) return late ? '마감이 지났거나 오늘까지인 할 일이 없어요.' : '옮길 할 일을 찾지 못했어요. 할 일 이름을 같이 말해 주세요.';
      return `할 일 ${list.length}개의 마감일을 ${daySay(to, today)}로 옮길게요.` + tag(list.map((t) => ({ type: 'move_task', task: t.k, due: to })));
    }

    if (kind === 'done') {
      const t = info.tasks.filter((x) => x.title.split(/\s+/).some((w) => w.length > 1 && q.includes(w)))[0];
      if (!t) return '어떤 할 일을 끝냈는지 찾지 못했어요. 할 일 이름을 같이 말해 주세요.';
      return `'${t.title}' 할 일을 완료로 표시할게요.` + tag([{ type: 'complete_task', task: t.k }]);
    }

    if (kind === 'moveevent') {
      const e = findEvent(q, info);
      if (!e) return '어떤 일정인지 찾지 못했어요. 일정 이름을 같이 말해 주세요.';
      const a = { type: 'move_event', event: e.k };
      if (e.repeat) {
        if (dates.length >= 2) { a.on = dates[0].key; a.date = dates[1].key; }
        else if (dates.length === 1 && times.length) a.on = dates[0].key;
        else if (dates.length === 1) { a.on = e.date; a.date = dates[0].key; }
      } else if (dates.length) a.date = dates[dates.length - 1].key;
      if (times[0]) a.start = hm(times[0].min);
      if (times[1]) a.end = hm(times[1].min);
      if (!a.date && !a.start) return `'${e.name}' 일정을 언제로 옮길지 알려 주세요.`;
      return (e.repeat ? (a.on ? `'${e.name}' 일정에서 그날 것만 옮길게요.` : `'${e.name}' 일정의 시각을 반복 전체에서 바꿀게요.`) : `'${e.name}' 일정을 옮길게요.`) + tag([a]);
    }

    if (kind === 'addevent') {
      if (!times.length) return '몇 시에 시작하는 일정인지 알려 주세요.';
      const other = /(약속|운동|병원|치과|알바|아르바이트|모임|동아리)/.exec(q);
      const a = { type: 'add_event', date: d0 || today, start: hm(times[0].min) };
      if (times[1]) a.end = hm(times[1].min);
      else { const min = findMinutes(q); if (min) a.minutes = min; }
      if (subject) a.subject = subject;
      else if (other) { a.kind = 'other'; a.title = (/친구/.test(q) ? '친구 ' : '') + other[1]; }
      const extra = /(학원|과외|인강|자습|문제집|수업)/.exec(q);
      if (extra && !a.title) a.title = extra[1];
      if (!a.subject && !a.title) a.title = '공부';
      if (/매일/.test(q)) a.repeat = 'daily';
      else if (/매주/.test(q)) {
        a.repeat = 'weekly';
        const part = (/매주\s*([월화수목금토일][월화수목금토일·,\s와과랑]*)/.exec(q) || [])[1] || '';
        a.days = [...new Set(part.split('').filter((c) => WD.includes(c)))];
        if (!d0 && a.days.length) { let k = today; for (let i = 0; i < 7 && !a.days.includes(WD[wdOf(k)]); i++) k = addDays(k, 1); a.date = k; }
      }
      const rep = a.repeat === 'daily' ? '매일 ' : a.repeat ? `매주 ${a.days.join('·')}요일 ` : daySay(a.date, today) + ' ';
      return `${rep}${hmSay(a.start)}에 ${a.subject || a.title} 일정을 넣을게요.` + tag([a]);
    }

    if (kind === 'exam') {
      const old = info.exams.find((e) => e.name.split(/\s+/).some((w) => w.length > 1 && q.includes(w)));
      if (/(옮겨|바꿔|미뤄)/.test(q) && old) {
        if (!d0) return `'${old.name}' 날짜를 언제로 바꿀지 알려 주세요.`;
        return `'${old.name}' 날짜를 ${daySay(d0, today)}로 바꿀게요.` + tag([{ type: 'set_exam_date', exam: old.k, date: d0 }]);
      }
      const name = strip(q).replace(/(을|를)$/, '');
      if (!name || !d0) return '시험 이름과 날짜를 같이 알려 주세요. 예: 12월 10일에 영어 듣기 시험 추가해 줘';
      return `${daySay(d0, today)}에 '${name}'을 넣을게요.` + tag([{ type: 'add_exam', name, date: d0 }]);
    }

    if (kind === 'goal') {
      const min = findMinutes(q);
      const a = { type: 'set_goal' };
      if (/집중/.test(q)) a.focusMinutes = min; else if (/휴식|쉬는/.test(q)) a.breakMinutes = min; else if (/월|한 ?달/.test(q)) a.monthlyHours = Math.round(min / 60); else a.dailyMinutes = min;
      return '설정을 이렇게 바꿀게요.' + tag([a]);
    }

    if (kind === 'subject') {
      const name = (/([가-힣A-Za-z0-9]+)\s*(?:과목|을|를)?\s*과목/.exec(q) || /과목.*?([가-힣A-Za-z0-9]+)\s*(?:추가|만들어)/.exec(q) || [])[1];
      if (!name || /추가|과목/.test(name)) return '추가할 과목 이름을 알려 주세요. 예: 스페인어 과목 추가해 줘';
      return `'${name}' 과목을 추가할게요.` + tag([{ type: 'add_subject', name }]);
    }

    if (kind === 'addtask') {
      const title = strip(q);
      if (!title) return '어떤 할 일을 넣을지 알려 주세요. 예: 내일까지 수학 문제집 30쪽 할 일 추가해 줘';
      const a = { type: 'add_task', title };
      if (subject) a.subject = subject;
      if (d0) a.due = d0;
      const min = findMinutes(q);
      if (min) a.minutes = min;
      return `할 일을 넣을게요.` + tag([a]);
    }

    if (kind === 'open') {
      const map = [['타임테이블', 'timetable'], ['일정표', 'timetable'], ['통계', 'stats'], ['계획', 'plan'], ['복습', 'review'], ['타이머', 'timer'], ['범위', 'board'], ['홈', 'home']];
      const hit = map.find(([w]) => q.includes(w));
      const a = { type: 'open_view', view: hit[1] };
      if (hit[1] === 'timetable' && d0) a.date = d0;
      return `${hit[0]} 화면을 열 수 있어요.` + tag([a]);
    }

    if (kind === 'list') {
      const key = d0 || today;
      const evs = info.events.filter((e) => happens(e, key)).sort((a, b) => (a.start < b.start ? -1 : 1));
      const due = info.tasks.filter((t) => t.due === key);
      if (!evs.length && !due.length) return `${daySay(key, today)}은 적어 둔 일정과 마감인 할 일이 없어요.`;
      return [`**${daySay(key, today)} 일정**`].concat(evs.length ? evs.map((e) => `- ${e.start}~${e.end} ${e.name}`) : ['- 일정 없음'])
        .concat(due.length ? ['', '**마감인 할 일**'].concat(due.map((t) => `- ${t.title}`)) : []).join('\n') +
        tag([{ type: 'open_view', view: 'timetable', date: key }]);
    }
    return FALLBACK;
  }

  /* ---------- 답 만들기 ---------- */
  let used = 0;
  const abort = () => { try { return new DOMException('Aborted', 'AbortError'); } catch (e) { return Object.assign(new Error('Aborted'), { name: 'AbortError' }); } };
  window.AIMock = {
    mock: true,
    note: '미리 보기의 AI는 진짜가 아니에요. 정해 둔 예시에만 답해요.',
    async ask(messages, opts) {
      opts = opts || {};
      const sys = messages[0].content, q = String(messages[messages.length - 1].content || '').trim();
      // 알림 화면을 볼 수 있게: '한도', '오프라인'이라고 보내면 그때의 알림이 나온다
      const failWith = /^한도/.test(q) ? 'limit' : /^오프라인/.test(q) ? 'offline' : null;
      await wait(450);
      if (opts.signal && opts.signal.aborted) throw abort();
      if (failWith) throw Object.assign(new Error(failWith), { aiCode: failWith });
      const canned = CANNED.find(([re]) => re.test(q));
      const kind = canned ? null : classify(q);
      let reply;
      if (canned) reply = canned[1].join('\n');
      else if (kind && !sys.includes('[앱 정보]')) reply = '<need_app/>'; // 진짜 AI처럼: 앱 정보가 없으면 달라고 한다
      else if (kind) reply = build(kind, q, readInfo(sys));
      else reply = FALLBACK;
      let shown = '';
      for (let i = 0; i < reply.length; i += 4) {
        if (opts.signal && opts.signal.aborted) throw abort();
        shown = reply.slice(0, i + 4);
        if (opts.onText) opts.onText(shown);
        await wait(12);
      }
      used++;
      return { text: reply, left: Math.max(0, LIMIT - used) };
    },
  };
})();
