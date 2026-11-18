/* 기능 켜기·끄기와 탭·홈 화면 순서 (계정·설정 › 기능과 탭 편집)
 * - 기능 목록(LIST)은 여기 한 곳에만 있다. 탭 막대·편집 화면·숨기기가 모두 여기서 이름·아이콘·설명을 읽는다.
 *   새 탭을 만들면 LIST에 한 줄 넣고, 그 기능의 화면 조각에 data-feature="id"를 단다.
 * - 설정은 기록의 settings.layout = { tabs: [탭 순서], home: [홈 칸 순서], off: [꺼 둔 것] } (계정 동기화·백업에 같이 들어간다)
 *   없으면 기본 배치(지금 모습). 새 기능은 켜진 채로, 기본 순서에서 바로 앞에 있는 것 뒤에 끼워 넣는다.
 *   이 버전이 모르는 이름(새 버전에서 생긴 기능)은 지우지 않고 그대로 둔다 (옛 버전 화면이 저장해도 사라지지 않게).
 * - 꺼진 기능의 화면 조각: <html>에 off-<id> 클래스가 붙으면 [data-feature~="<id>"]가 숨는다.
 *   여러 기능에 걸친 조각은 data-feature="a b" (하나라도 꺼지면 숨음). 나중에 그려지는 조각도 그대로 숨는다.
 * - 꺼도 기록은 지우지 않는다. 다시 켜면 그대로 돌아온다.
 */
(function (root) {
  // kind: tab(탭 막대의 화면) / sub(탭 안의 기능, 켜고 끄기만) / home(홈 화면 칸)
  // always: 끌 수 없음 · parent: 이 탭이 꺼지면 같이 꺼짐 · needs: 이 기능이 꺼지면 같이 숨음
  const LIST = [
    { id: 'home', kind: 'tab', name: '홈', icon: 'home', desc: '오늘 공부와 시험 준비를 한눈에', always: true },
    { id: 'board', kind: 'tab', name: '범위', icon: 'board', desc: '시험 범위 목록 · 화이트보드' },
    { id: 'plan', kind: 'tab', name: '플래너', icon: 'planner', desc: '오늘과 앞날의 할 일 · 목표 · 과목' },
    { id: 'timer', kind: 'tab', name: '타이머', icon: 'timer', desc: '집중 타이머 · 스톱워치 · 폰 잠금' },
    { id: 'review', kind: 'tab', name: '복습', icon: 'review', desc: '플래시카드' },
    { id: 'stats', kind: 'tab', name: '통계', icon: 'stats', desc: '월간 · 최근 7일 · 공부 달력' },
    { id: 'focus', kind: 'sub', parent: 'timer', group: '타이머 안', name: '집중 타이머', desc: '정한 시간 집중하고 쉬어요' },
    { id: 'stopwatch', kind: 'sub', parent: 'timer', group: '타이머 안', name: '스톱워치', desc: '과목별로 공부 시간을 재요' },
    { id: 'lock', kind: 'sub', parent: 'timer', group: '타이머 안', name: '폰 잠금 모드', desc: '정한 시간 동안 이 화면만 보여요' },
    { id: 'ai', kind: 'sub', group: '어디서나', name: 'AI 도우미 세컨드', desc: '오른쪽 아래 둥근 버튼' },
    { id: 'home-sum', kind: 'home', name: '오늘 요약', desc: '공부 시간 · 할 일 · 연속 학습일', always: true },
    { id: 'home-tt', kind: 'home', name: '오늘 타임테이블', desc: '오늘 언제 공부했는지 · 지금과 다음 일정' },
    { id: 'home-exams', kind: 'home', name: '시험 준비', desc: 'D-day · 진행률 · 오늘 더 할 양', needs: 'board' },
    { id: 'home-next', kind: 'home', name: '오늘 할 범위', desc: '가까운 시험에서 오늘 할 양 추천', needs: 'board' },
    { id: 'home-tasks', kind: 'home', name: '오늘 할 일', desc: '플래너의 오늘 칸', needs: 'plan' },
  ];
  // 한꺼번에 끌 수 없는 묶음 (타이머 탭이 빈 화면이 되지 않게). 둘 다 꺼진 기록이 오면 둘 다 켠다
  const ONE_OF = [['focus', 'stopwatch']];

  const item = (id) => LIST.find((x) => x.id === id) || null;
  const idsOf = (kind) => LIST.filter((x) => x.kind === kind).map((x) => x.id);
  const isId = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v);
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);

  // 저장된 순서에서 아는 것만 남기고, 빠진 것은 기본 순서에서 바로 앞에 있는 것 뒤에 끼운다 (앞에 아무것도 없으면 맨 앞)
  function mergeOrder(saved, known) {
    const out = uniq((Array.isArray(saved) ? saved : []).filter((id) => known.includes(id)));
    known.forEach((id, i) => {
      if (out.includes(id)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(known[j]); if (k >= 0) { at = k + 1; break; } }
      out.splice(at, 0, id);
    });
    return out;
  }

  // settings.layout → { tabs, home, off } (이상한 값은 기본으로). off에는 모르는 이름도 남긴다
  function read(settings) {
    const raw = rawOf(settings);
    let off = uniq((Array.isArray(raw.off) ? raw.off : []).filter(isId)).filter((id) => { const f = item(id); return !f || !f.always; });
    ONE_OF.forEach((g) => { if (g.every((id) => off.includes(id))) off = off.filter((id) => !g.includes(id)); });
    return { tabs: mergeOrder(raw.tabs, idsOf('tab')), home: mergeOrder(raw.home, idsOf('home')), off };
  }
  function rawOf(settings) {
    const raw = settings && settings.layout;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
  // 저장할 모양으로. 지금 버전이 모르는 탭·홈 칸(새 버전의 것)은 지우지 않고, 전에 있던 자리(바로 앞 이름 뒤)에 그대로 끼워 둔다
  function keepUnknown(order, prevArr, known) {
    const prev = uniq((Array.isArray(prevArr) ? prevArr : []).filter(isId));
    const out = order.slice();
    prev.forEach((id, i) => {
      if (known.includes(id) || out.includes(id)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const k = out.indexOf(prev[j]); if (k >= 0) { at = k + 1; break; } }
      out.splice(at, 0, id);
    });
    return out;
  }
  function pack(L, prevRaw) {
    const prev = prevRaw && typeof prevRaw === 'object' ? prevRaw : {};
    return {
      tabs: keepUnknown(L.tabs, prev.tabs, idsOf('tab')),
      home: keepUnknown(L.home, prev.home, idsOf('home')),
      off: uniq(L.off.slice()),
    };
  }

  // 켜져 있나: 꺼 둔 목록에 없고, 딸린 탭(parent)과 필요한 기능(needs)도 켜져 있어야 한다. 모르는 이름은 켜진 것으로
  function isOn(L, id) {
    const f = item(id);
    if (f && f.always) return true;
    if (L.off.includes(id)) return false;
    if (f && f.parent && !isOn(L, f.parent)) return false;
    if (f && f.needs && !isOn(L, f.needs)) return false;
    return true;
  }
  // 이 스위치를 끌 수 없는 까닭 (끌 수 있으면 '')
  function lockReason(L, id) {
    const f = item(id);
    if (!f) return '';
    if (f.always) return '항상 켜져 있어요';
    if (f.parent && !isOn(L, f.parent)) return `${item(f.parent).name} 탭이 꺼져 있어요`;
    if (f.needs && !isOn(L, f.needs)) return `${item(f.needs).name} 탭이 꺼져 있어서 안 보여요`;
    const g = ONE_OF.find((x) => x.includes(id));
    if (g && !L.off.includes(id) && g.filter((x) => x !== id).every((x) => L.off.includes(x))) {
      return `${g.map((x) => item(x).name).join('와 ')} 중 하나는 켜 둬야 해요`;
    }
    return '';
  }
  // 켜고 끈 새 배치
  function toggle(L, id, on) {
    const f = item(id);
    if (f && f.always) return L;
    const off = L.off.filter((x) => x !== id);
    if (!on) {
      off.push(id);
      // 묶음을 모두 끄게 되면 끄지 않는다
      if (ONE_OF.some((g) => g.includes(id) && g.every((x) => off.includes(x)))) return L;
    }
    return { tabs: L.tabs, home: L.home, off };
  }
  // 순서 바꾸기: kind('tabs'|'home')의 id를 to번째로
  function moveTo(L, kind, id, to) {
    const arr = L[kind].filter((x) => x !== id);
    if (arr.length === L[kind].length) return L;
    arr.splice(Math.max(0, Math.min(arr.length, to)), 0, id);
    return Object.assign({}, L, { [kind]: arr });
  }
  const DEFAULT = read(null);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // 처음 배치 그대로인가 (모르는 이름은 보지 않는다)
  function isDefault(L) {
    return same(L.tabs, DEFAULT.tabs) && same(L.home, DEFAULT.home) && !L.off.some((id) => item(id));
  }

  const api = { LIST, ONE_OF, item, idsOf, mergeOrder, read, pack, isOn, lockReason, toggle, moveTo, isDefault, DEFAULT };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---------- 화면에 적용 (브라우저) ---------- */
  const doc = root.document;
  const BAR_KEY = 'studypromotion.tabbar'; // 첫 화면이 그려지기 전에 탭 순서를 맞추려고 index.html 머리에서 읽는 사본
  const listeners = [];
  let store = null;
  let cur = DEFAULT;
  let sig = '';

  // 꺼진 기능 숨기기 규칙 (목록에 있는 기능마다 하나씩)
  const css = doc.createElement('style');
  css.id = 'feat-css';
  css.textContent = LIST.filter((f) => !f.always).map((f) => `.off-${f.id} [data-feature~="${f.id}"]`).join(',\n') + ' { display: none !important; }';
  doc.head.appendChild(css);

  const offBy = (el, L) => String(el.dataset.feature || '').split(/\s+/).some((id) => id && !isOn(L, id));
  function makeTab(f) {
    const b = doc.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.view = f.id;
    b.innerHTML = `<span class="ico"><svg aria-hidden="true"><use href="#i-${f.icon}"/></svg></span><span class="tab-name"></span>`;
    return b;
  }
  function apply(settings, force) {
    const L = read(settings);
    const s = JSON.stringify(L);
    if (s === sig && !force) return false;
    sig = s;
    cur = L;
    const html = doc.documentElement;
    LIST.forEach((f) => { if (!f.always) html.classList.toggle('off-' + f.id, !isOn(L, f.id)); });
    // 탭 막대: 정한 순서로 놓고, 꺼진 탭은 숨긴다. 이름·아이콘은 목록에서 읽는다
    const nav = doc.querySelector('nav.tabs');
    if (nav) {
      L.tabs.forEach((id) => {
        const f = item(id);
        let b = nav.querySelector(`.tab[data-view="${id}"]`);
        if (!b) b = makeTab(f);
        const name = b.querySelector('.ico + span') || b.querySelector('span:last-child');
        if (name && name.textContent !== f.name) name.textContent = f.name;
        const use = b.querySelector('use');
        if (use && use.getAttribute('href') !== '#i-' + f.icon) use.setAttribute('href', '#i-' + f.icon);
        nav.appendChild(b);
        b.hidden = !isOn(L, id);
      });
      const pre = doc.getElementById('tabbar-pre');
      if (pre) pre.remove();
      const shown = L.tabs.filter((id) => isOn(L, id));
      html.classList.toggle('one-tab', shown.length < 2);
      try {
        const bar = JSON.stringify({ o: L.tabs, x: L.tabs.filter((id) => !isOn(L, id)) });
        if (localStorage.getItem(BAR_KEY) !== bar) {
          if (isDefault(L)) localStorage.removeItem(BAR_KEY); else localStorage.setItem(BAR_KEY, bar);
        }
      } catch (e) { /* 저장이 막힌 환경 */ }
    }
    // 홈 화면 칸 순서 (맨 아래 '이야기·사용설명서' 줄 앞에 차례로)
    const about = doc.querySelector('#view-home > .home-about');
    if (about) L.home.forEach((id) => { const el = doc.querySelector(`#view-home > [data-home="${id}"]`); if (el) about.before(el); });
    // 오늘 요약 카드가 몇 장 보이는지 (3장이면 맨 앞 카드를 한 줄로)
    const sum = doc.querySelector('#view-home .cards4');
    if (sum) sum.dataset.n = String([...sum.children].filter((x) => !offBy(x, L)).length);
    // 집중 타이머를 끄면 폰 잠금 모드 칸을 스톱워치 쪽으로 옮긴다
    const lock = doc.querySelector('.lock-setup');
    if (lock) {
      const to = doc.getElementById(isOn(L, 'focus') ? 'timer-pane-focus' : 'timer-pane-sw');
      if (to && lock.parentNode !== to) to.appendChild(lock);
    }
    listeners.forEach((fn) => { try { fn(L); } catch (e) { /* 무시 */ } });
    return true;
  }

  function update(fn) {
    if (!store) return;
    store.update((st) => {
      const L = read(st.settings);
      const next = fn(L);
      if (next === L) return;
      const packed = pack(next, st.settings.layout);
      // 처음 배치 그대로면 칸을 비운다 (새 버전의 탭 자리처럼 이 버전이 모르는 것이 남아 있으면 둔다)
      if (isDefault(next) && !packed.off.length && packed.tabs.length === next.tabs.length && packed.home.length === next.home.length) delete st.settings.layout;
      else st.settings.layout = packed;
    });
  }

  Object.assign(api, {
    // app.js가 기록을 만든 바로 뒤에 부른다 (첫 화면을 그리기 전에)
    init(s) {
      store = s;
      apply(s.get().settings, true);
      s.subscribe(() => apply(s.get().settings));
    },
    apply: (settings) => apply(settings || (store ? store.get().settings : null), true),
    get: () => cur,
    on: (id) => isOn(cur, id),
    // 탭으로 여는 화면이 꺼져 있으면 false (탭이 아닌 화면은 언제나 true)
    viewOn: (view) => { const f = item(view); return !f || f.kind !== 'tab' || isOn(cur, view); },
    why: (id) => lockReason(cur, id),
    set: (id, on) => update((L) => toggle(L, id, on)),
    move: (kind, id, to) => update((L) => moveTo(L, kind, id, to)),
    // 처음 배치로: 순서와 꺼 둔 것을 모두 지운다
    reset: () => { if (store) store.update((st) => { delete st.settings.layout; }); },
    onChange: (fn) => listeners.push(fn),
  });
  root.Features = api;
})(typeof window !== 'undefined' ? window : globalThis);
