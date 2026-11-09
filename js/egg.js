/* 이스터에그: 앱 소개의 비밀 입력칸
 * 베타테스트에 피드백을 보내 준 사람이 자기 이름을 넣으면, 그 피드백이 어떤 업데이트에 어떻게 반영됐는지 보여 준다.
 * 이름은 소스에 그대로 두지 않고 해시로만 둔다 (공개 저장소에 이름이 남지 않고, 소스를 봐도 비밀 단어가 바로 보이지 않게).
 * 새 피드백을 넣을 때: node tools/egg-key.js 이름  → 나온 값을 KEYS에 넣고 ENTRIES에 내용을 적는다. */
(function (root) {
  // 이름 다듬기: 띄어쓰기·끝의 '님'·문장부호를 없애고 소문자로
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFC').toLowerCase()
      .replace(/[\s.,!?~'"`’‘“”·:;()\[\]{}<>]/g, '').replace(/님$/, '');
  }
  // cyrb53 해시 (짧고 빠른 문자열 해시)
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const key = (word) => hash('studypromotion:' + norm(word));

  // 피드백 내용 (누구 것인지는 KEYS로만 연결)
  const ENTRIES = {
    a: {
      items: [
        { ver: '2.6', title: '핑크 테마', text: '계정·설정 › 설정 › 테마 색에서 핑크를 고르면 버튼, 타이머, 진행 칸까지 앱 전체가 핑크로 바뀌어요.' },
        { ver: '2.7', title: '전체 핑크 테마', text: '이 비밀 입력칸에 특별한 비밀 단어를 넣으면 포인트 색뿐 아니라 배경과 카드까지 앱 전체가 핑크로 바뀌어요. 한 번 더 넣으면 원래대로 돌아와요.' },
      ],
    },
    b: {
      items: [
        { ver: '2.6', title: '왼쪽 위 이름을 누르면 홈으로', text: '어느 화면에 있든 왼쪽 위 ‘스터디 프로모션’을 누르면 바로 홈으로 돌아와요.' },
      ],
    },
    c: {
      maker: true,
      items: [
        { ver: '2.6', title: '기록 지키기', text: '앱이 업데이트될 때와 기록을 통째로 바꾸기 전, 그리고 하루에 한 번 자동 백업을 남겨서 기록이 사라지지 않게 했어요.' },
        { ver: '2.6', title: '이스터에그', text: '피드백을 준 사람의 이름을 넣으면 반영된 내용을 보여 주는, 지금 보고 있는 바로 이 비밀 입력칸이에요.' },
        { ver: '2.7', title: '범위 단계 나누기', text: '항목 옆 ＋로 국어 › 비문학 › 수특 1강 › 분석처럼 몇 단계든 나누고, ⋯ 메뉴는 표시·옮기기로 묶어 짧게 줄였어요.' },
        { ver: '2.7', title: '타이머 시간 직접 정하기', text: '정해진 시간 말고도 ‘직접’을 눌러 원하는 분을 적어요.' },
        { ver: '2.7', title: '스톱워치', text: '열품타처럼 과목을 눌러 공부 시간을 재고, 멈추면 공부 기록에 남아요.' },
        { ver: '2.7', title: '앱 디자인 선택창·색 팔레트', text: '기본 모양이던 선택창과 날짜·색 고르기를 앱 디자인으로 바꾸고, 과목 색을 색 계열별 50가지로 늘렸어요.' },
        { ver: '2.7', title: '시작 화면', text: '앱을 켜면 폰이 체스판을 한 칸씩 올라가 퀸으로 승급하는 모션이 나와요.' },
      ],
    },
  };
  // 이름(성까지 / 이름만) → 내용
  const KEYS = {
    '1an7mm0bmsl': 'a', el4y9uoav9: 'a',
    kc7a3czsdp: 'b', '1l4hadu92ka': 'b',
    bebyavobri: 'c', '1sw0f56sgyk': 'c',
  };

  // 테마 비밀 단어: 넣을 때마다 앱 전체(배경까지) 핑크 테마를 켜고 끈다
  const SKIN_KEYS = { '10zjsj579q2': 'pink' };
  const SKIN_STORE = 'studypromotion.skin';
  const skinOf = (word) => SKIN_KEYS[key(word)] || null;
  function getSkin() { try { return localStorage.getItem(SKIN_STORE) || ''; } catch (e) { return ''; } }
  function applySkin(skin) {
    const d = document.documentElement;
    if (skin) d.setAttribute('data-skin', skin); else d.removeAttribute('data-skin');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', skin === 'pink' ? '#ff5c9a' : '#0a0a0a');
  }
  function toggleSkin(skin) {
    const next = getSkin() === skin ? '' : skin;
    try { if (next) localStorage.setItem(SKIN_STORE, next); else localStorage.removeItem(SKIN_STORE); } catch (e) { /* 무시 */ }
    const d = document.documentElement;
    d.classList.add('skin-fade');
    applySkin(next);
    setTimeout(() => d.classList.remove('skin-fade'), 700);
    return next;
  }

  function find(word) {
    const n = norm(word);
    if (!n) return null;
    const id = KEYS[key(n)];
    return id ? Object.assign({ id, name: n }, ENTRIES[id]) : null;
  }

  const lib = { norm, hash, key, find, skinOf, ENTRIES, KEYS, SKIN_KEYS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = lib; return; }

  const App = root.App;
  if (!App) return;
  const { $, esc, pawnTrack } = App;

  function showSkin(on) {
    const out = $('#egg-out');
    out.hidden = false;
    out.classList.remove('miss', 'hit');
    void out.offsetWidth;
    out.classList.add('hit');
    out.innerHTML = on
      ? '<div class="pawn-track egg-track" aria-hidden="true">' + pawnTrack(100) + '</div><h3>핑크 테마가 켜졌어요</h3><p class="muted small">배경부터 버튼, 타이머, 진행 칸까지 앱 전체가 핑크로 바뀌었어요. 같은 비밀 단어를 한 번 더 넣으면 원래 테마로 돌아가요.</p>'
      : '<h3>원래 테마로 돌아왔어요</h3><p class="muted small">같은 비밀 단어를 다시 넣으면 핑크 테마가 다시 켜져요.</p>';
  }

  function show(word) {
    const skin = skinOf(word);
    if (skin) { showSkin(!!toggleSkin(skin)); return true; }
    const out = $('#egg-out');
    const typed = String(word || '').trim().replace(/\s*님$/, '');
    const hit = find(word);
    out.hidden = false;
    out.classList.remove('miss', 'hit');
    void out.offsetWidth; // 애니메이션 다시 시작
    if (!hit) {
      out.classList.add('miss');
      out.innerHTML = typed
        ? '<p class="egg-miss">…아무 일도 일어나지 않았어요. 다른 단어를 넣어 보세요.</p>'
        : '<p class="egg-miss">비밀 단어를 넣어 주세요.</p>';
      return false;
    }
    out.classList.add('hit');
    const who = esc(typed);
    const head = hit.maker
      ? `<h3>만든 사람을 찾았어요</h3><p class="muted small">${who}님은 스터디 프로모션을 만든 사람이에요. 직접 낸 아이디어도 이렇게 들어갔어요.</p>`
      : `<h3>${who}님, 고마워요!</h3><p class="muted small">베타테스트에서 보내 준 피드백이 이렇게 반영됐어요.</p>`;
    out.innerHTML = `<div class="pawn-track egg-track" aria-hidden="true">${pawnTrack(100)}</div>${head}` +
      '<ul class="egg-list">' + hit.items.map((it) => `<li><span class="egg-ver">v${esc(it.ver)}</span><div><b>${esc(it.title)}</b><span>${esc(it.text)}</span></div></li>`).join('') + '</ul>';
    return true;
  }

  $('#egg-form').addEventListener('submit', (e) => {
    e.preventDefault();
    show($('#egg-input').value);
  });
  $('#egg-input').addEventListener('input', () => { if (!$('#egg-out').classList.contains('hit')) $('#egg-out').hidden = true; });

  App.egg = { show, find, key, KEYS, toggleSkin, getSkin };
  applySkin(getSkin());
})(typeof window !== 'undefined' ? window : globalThis);
