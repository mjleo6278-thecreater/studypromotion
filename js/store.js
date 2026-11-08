/* 데이터 저장소: localStorage에 하나의 JSON으로 저장 */
(function (root) {
  const KEY = 'studypromotion.v1';
  const LEGACY_KEYS = ['studygambit.v1', 'studymate.v1']; // 이름을 바꾸기 전 저장 위치 (자동으로 옮겨 옴)
  const VERSION = 2;
  const UNDO_LIMIT = 60;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaults() {
    return {
      version: VERSION,
      subjects: [
        { id: uid(), name: '국어', color: '#e86a5c' },
        { id: uid(), name: '수학', color: '#4a7fd4' },
        { id: uid(), name: '영어', color: '#3fa774' },
      ],
      tasks: [],
      sessions: [],
      decks: [],
      cards: [],
      reviewLog: [], // { cardId, grade, at }
      exams: [], // { id, name, date }
      topics: [], // 시험 범위 트리 노드 (scope.js 참고)
      strokes: [], // 화이트보드 펜 자국 { id, examId, d, color, width }
      boardView: {}, // examId → { x, y, z }
      activeExamId: null,
      settings: { dailyGoalMin: 120, focusMin: 25, breakMin: 5, monthlyGoalMin: 0, keepAwake: true },
    };
  }

  // 가져온 데이터나 오래된 데이터를 현재 형식에 맞춘다
  function normalize(data) {
    const base = defaults();
    if (!data || typeof data !== 'object') return base;
    const out = {
      version: VERSION,
      subjects: Array.isArray(data.subjects) ? data.subjects : base.subjects,
      tasks: Array.isArray(data.tasks) ? data.tasks : [],
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      decks: Array.isArray(data.decks) ? data.decks : [],
      cards: Array.isArray(data.cards) ? data.cards : [],
      reviewLog: Array.isArray(data.reviewLog) ? data.reviewLog : [],
      exams: Array.isArray(data.exams) ? data.exams : [],
      topics: Array.isArray(data.topics) ? data.topics : [],
      strokes: Array.isArray(data.strokes) ? data.strokes : [],
      boardView: data.boardView && typeof data.boardView === 'object' ? data.boardView : {},
      activeExamId: data.activeExamId || null,
      settings: Object.assign({}, base.settings, data.settings || {}),
    };
    return out;
  }

  function createStore(storage) {
    let state;
    const listeners = [];

    function load() {
      try {
        let raw = storage && storage.getItem(KEY);
        if (!raw && storage) for (const k of LEGACY_KEYS) { raw = storage.getItem(k); if (raw) break; }
        state = raw ? normalize(JSON.parse(raw)) : defaults();
      } catch (e) {
        state = defaults();
      }
      return state;
    }

    function save() {
      try {
        storage && storage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        /* 저장 불가(사생활 보호 모드 등) — 메모리에서는 계속 동작 */
      }
      listeners.forEach((fn) => fn(state));
    }

    // opts.undoable: 되돌리기 기록을 남긴다 / opts.silent: 화면 갱신 알림 없이 저장만
    // 되돌리기는 시험 범위(항목·시험·펜 자국)만 되돌린다. 그사이 쌓인 공부 기록·카드·할 일은 그대로 둔다.
    const UNDO_KEYS = ['topics', 'exams', 'strokes', 'activeExamId'];
    const undoStack = [];
    function update(fn, opts) {
      opts = opts || {};
      if (opts.undoable) {
        const snap = {};
        UNDO_KEYS.forEach((k) => { snap[k] = state[k]; });
        undoStack.push(JSON.stringify(snap));
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      }
      fn(state);
      if (opts.silent) {
        try { storage && storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 무시 */ }
      } else save();
    }

    function undo() {
      if (!undoStack.length) return false;
      const keepView = state.boardView;
      state = normalize(Object.assign({}, state, JSON.parse(undoStack.pop())));
      state.boardView = keepView;
      save();
      return true;
    }

    function exportJSON() {
      return JSON.stringify(state, null, 2);
    }

    function importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !('tasks' in parsed || 'cards' in parsed)) {
        throw new Error('스터디 프로모션 백업 파일이 아닙니다.');
      }
      state = normalize(parsed);
      save();
    }

    function reset() {
      state = defaults();
      save();
    }

    // 다른 탭(창)에서 저장한 기록을 받아 온다. 같은 기기에서 탭 두 개를 열어도 서로 덮어쓰지 않게.
    // 리스너에는 { external: true }를 같이 넘긴다 (계정 동기화는 이 변경을 다시 올리지 않음).
    function adopt(raw) {
      if (!raw) return false;
      let next;
      try { next = normalize(JSON.parse(raw)); } catch (e) { return false; }
      next.boardView = state.boardView; // 보드 보는 위치는 탭마다 따로
      state = next;
      undoStack.length = 0; // 다른 탭의 변경까지 되돌리지 않게
      listeners.forEach((fn) => fn(state, { external: true }));
      return true;
    }
    try {
      if (typeof window !== 'undefined' && window.addEventListener && storage && storage === window.localStorage) {
        window.addEventListener('storage', (e) => { if (e.key === KEY && e.storageArea === storage) adopt(e.newValue); });
      }
    } catch (e) { /* 저장소 접근 불가 */ }

    load();
    return {
      get: () => state,
      update,
      undo,
      canUndo: () => undoStack.length > 0,
      subscribe: (fn) => listeners.push(fn),
      adopt,
      exportJSON,
      importJSON,
      reset,
    };
  }

  const api = { createStore, uid, normalize, defaults, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StoreLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
