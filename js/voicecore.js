/* 말로 복습 (v4.5): 말한 답 채점 · 말로 하는 명령 알아듣기 · 카드 언어 짐작 · 읽어 줄 글 다듬기
 * 화면·마이크와 상관없는 순수 함수만 둔다 (node 시험에서 그대로 부른다). 화면 쪽은 js/voice.js.
 * 채점은 너그럽게: 뜻이 여러 개면 하나만 맞아도, 품사(n. v.)·괄호 속 말은 빼도, 끝말(하다/해/한다)이 달라도,
 * 음성 인식이 한 글자쯤 다르게 적어도 맞음. 영어·스페인어는 대소문자·악센트를 안 따진다.
 * (4.5.2) 한국어는 소리 나는 대로도 비교한다: 마자써 = 맞았어, 고똥 = 고통 (받침이 넘어가는 소리·된소리·거센소리·ㅐ/ㅔ를 같게).
 * '음·어·그러니까' 같은 말은 답에서 빼고, 그것만 말했으면 답으로 치지 않는다.
 */
(function (root) {
  // 카드 언어 (인식·읽어 주기에 쓰는 BCP-47 이름)
  const LANGS = [
    { id: 'ko-KR', name: '한국어' },
    { id: 'en-US', name: '영어' },
    { id: 'es-ES', name: '스페인어' },
    { id: 'ja-JP', name: '일본어' },
    { id: 'zh-CN', name: '중국어' },
    { id: 'fr-FR', name: '프랑스어' },
    { id: 'de-DE', name: '독일어' },
  ];
  const langName = (id) => (LANGS.find((l) => l.id === id) || { name: id }).name;
  const isKo = (lang) => /^ko/i.test(lang || '');
  const isCjk = (lang) => /^(ko|ja|zh)/i.test(lang || '');

  const HANGUL = /[가-힣]/;
  const KANA = /[぀-ヿ]/;
  const HAN = /[一-鿿]/;
  const ES_MARK = /[ñáéíóúü¿¡]/i;

  // 카드 글 여러 개(와 덱 이름)를 보고 언어를 짐작한다
  function guessLang(texts, deckName) {
    const name = String(deckName || '');
    const list = (texts || []).map((t) => String(t || '')).filter(Boolean);
    let ko = 0, ja = 0, zh = 0, es = 0, latin = 0;
    list.forEach((t) => {
      if (HANGUL.test(t)) ko++;
      else if (KANA.test(t)) ja++;
      else if (HAN.test(t)) zh++;
      else if (/[a-z]/i.test(t)) { latin++; if (ES_MARK.test(t)) es++; }
    });
    const n = list.length || 1;
    if (ko / n >= 0.5) return 'ko-KR';
    if (ja / n >= 0.3) return 'ja-JP';
    if (zh / n >= 0.3) return 'zh-CN';
    if (latin) {
      if (/스페인|에스파냐|español|espanol|spanish/i.test(name)) return 'es-ES';
      if (/프랑스|français|french/i.test(name)) return 'fr-FR';
      if (/독일|deutsch|german/i.test(name)) return 'de-DE';
      if (es && es / latin >= 0.08) return 'es-ES';
      if (/영어|영단어|english|토익|수능/i.test(name)) return 'en-US';
      return 'en-US';
    }
    return ko ? 'ko-KR' : 'en-US';
  }

  // 앞면·뒷면 언어를 함께 짐작 (둘이 같으면 덱 이름의 외국어를 앞면으로)
  function guessPair(cards, deckName) {
    const front = guessLang((cards || []).map((c) => c.front), deckName);
    const back = guessLang((cards || []).map((c) => c.back), deckName);
    return { front, back };
  }

  /* ---------- 글 다듬기 ---------- */
  const POS = /^(?:n|v|a|ad|adj|adv|prep|conj|pron|int|interj|phr|vt|vi|aux)\.\s*/i;
  const POS_KO = /^(?:\[(?:명|동|형|부|대|전|접|감)[^\]]{0,3}\]|(?:명|동|형|부)\.)\s*/;

  function stripAccents(s) {
    // NFD로 나눈 뒤 악센트 표시만 지우고 다시 합친다 (한글은 NFC에서 그대로 돌아온다)
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  }
  // 비교용: 소문자·악센트 없음·글자와 숫자만, 띄어쓰기 하나
  function norm(s, lang) {
    let t = String(s || '').toLowerCase();
    if (!isCjk(lang)) t = stripAccents(t);
    t = t.replace(/[’'`´]/g, '');
    t = t.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return t;
  }

  // 카드 한 면에서 말로 맞힐 수 있는 답들. "n. 고통, 괴로움; v. 괴롭히다" → [고통, 괴로움, 괴롭히다]
  function answers(text) {
    const raw = String(text || '').replace(/\r/g, '');
    const out = [];
    raw.split(/[;\n；]/).forEach((sense) => {
      // 괄호 안은 빼고 나눈다 (괄호 안의 · , 로 잘못 나뉘지 않게). 빼고 나서 비면 괄호 안 글을 쓴다
      const bare = sense.replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）/g, ' ');
      const src = bare.replace(POS, '').replace(POS_KO, '').trim() ? bare : sense.replace(/[()[\]（）]/g, ' ');
      src.split(/[,，/·]|\s또는\s|\s혹은\s/).forEach((p) => {
        let a = p.replace(/[~∼…]+|\.\.\./g, ' ').replace(/\s+/g, ' ').trim();
        a = a.replace(POS, '').replace(POS_KO, '').trim();
        a = a.replace(/^[\s.:\-–—]+|[\s.:\-–—!?]+$/g, '').trim();
        if (a && !out.includes(a)) out.push(a);
      });
    });
    return out;
  }

  // 읽어 줄 글: 품사 표시·물결·괄호 기호를 빼고 읽기 좋게
  function speakText(text) {
    return String(text || '')
      .split(/\n/).map((line) => line.split(/;/).map((s) => s.trim().replace(POS, '').replace(POS_KO, '')).join(', ')).join(', ')
      .replace(/[~∼…]+|\.\.\./g, ' ')
      .replace(/[()[\]（）]/g, ' ')
      .replace(/\s*\/\s*/g, ', ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- 한국어 끝말 ---------- */
  // 긴 것부터. 낱말 끝에서 하나만 떼어 줄기를 비교한다 (확보하다 = 확보해 = 확보한다 → 확보)
  // '이다'는 넣지 않는다: 단어장에서는 모이다·줄이다처럼 줄기의 일부인 경우가 많다 ('고통이다'는 답을 품고 있어 따로 맞음)
  const ENDINGS = [
    '하였습니다', '했습니다', '합니다', '했어요', '하세요', '하는데', '이에요', '입니다',
    '하다', '한다', '해요', '했다', '했어', '하는', '하기', '하게', '하고', '해서', '하여', '되다', '된다', '되는', '돼요', '됐다',
    '스럽다', '스러운', '스러움', '롭다', '로운', '로움', '적인', '에요', '예요', '어요', '아요', '이요', '이야',
    '해', '함', '한', '할', '됨', '된', '돼', '되', '다', '요', '야', '지', '은', '는', '을', '를', '이', '가', '의', '에', '로', '와', '과', '도', '인', '운', '음', '기', '게', '고',
  ];
  function stemKo(w) {
    for (const e of ENDINGS) {
      if (w.length > e.length && w.endsWith(e)) return w.slice(0, -e.length);
    }
    return w;
  }

  // 한글을 자모로 풀기 (한 글자쯤 다르게 알아들어도 가깝게 나오도록)
  function jamo(s) {
    let out = '';
    for (const ch of s) {
      const c = ch.charCodeAt(0) - 0xac00;
      if (c >= 0 && c < 11172) {
        out += String.fromCharCode(0x1100 + Math.floor(c / 588), 0x1161 + Math.floor((c % 588) / 28));
        if (c % 28) out += String.fromCharCode(0x11a7 + (c % 28));
      } else out += ch;
    }
    return out;
  }
  // 소리 나는 대로 비교할 열쇠 (한 소리 = 한 글자). 첫소리 ㅇ은 빼고(받침이 넘어가는 소리 맞추기), 받침은 첫소리와 같은 글자로,
  // 예사소리·된소리·거센소리(ㄱㄲㅋ, ㄷㄸㅌ, ㅂㅃㅍ, ㅈㅉㅊ, ㅅㅆ)와 ㅐ/ㅔ, ㅒ/ㅖ, ㅙ/ㅚ/ㅞ는 같게, 받침 ㅎ은 뺀다.
  // 맞았어(ㅁㅏㅈ.ㅏㅆ.ㅓ) = 마자써 = majaso, 고통 = 고똥, 상대 = 상태
  const P_INIT = 'ggndd' + 'rmbbs' + 'sxjjj' + 'gdbh';           // ㄱㄲㄴㄷㄸ ㄹㅁㅂㅃㅅ ㅆ(ㅇ)ㅈㅉㅊ ㅋㅌㅍㅎ (ㅇ 자리 x는 뺀다)
  const P_VOW = 'AEYZOEQZUWXXVKLXPTFGI';                         // ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ
  const P_FIN = ['g', 'g', 'gs', 'n', 'nj', 'n', 'd', 'r', 'rg', 'rm', 'rb', 'rs', 'rd', 'rb', 'r', 'm', 'b', 'bs', 's', 's', 'N', 'j', 'j', 'g', 'd', 'b', ''];
  function phon(s) {
    let out = '';
    for (const ch of String(s || '')) {
      const c = ch.charCodeAt(0) - 0xac00;
      if (c >= 0 && c < 11172) {
        const i = Math.floor(c / 588), v = Math.floor((c % 588) / 28), f = c % 28;
        if (P_INIT[i] !== 'x') out += P_INIT[i];
        out += P_VOW[v];
        if (f) out += P_FIN[f - 1];
      } else if (ch !== ' ') out += ch;
    }
    return out;
  }
  function lev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function sim(a, b) {
    const n = Math.max(a.length, b.length);
    return n ? 1 - lev(a, b) / n : 1;
  }

  // 자모로 이만큼 같으면 같은 말로 본다. 두 글자 낱말은 한 자모만 달라도 0.8이라(확고↔확보, 상대↔상태) 그보다 높게
  const NEAR = 0.85;
  // 말한 글 하나와 답 하나가 맞는지 (0~1, 0.8 넘으면 맞음)
  const ARTICLES = /^(?:the|a|an|to|el|la|los|las|un|una|unos|unas|le|les|der|die|das)\s+/;
  function matchOne(heard, alt, lang) {
    const ko = isKo(lang), cjk = isCjk(lang);
    let H = norm(heard, lang), A = norm(alt, lang);
    if (!A || !H) return 0;
    if (!cjk) { H = H.replace(ARTICLES, ''); A = A.replace(ARTICLES, ''); }
    const Hs = H.replace(/ /g, ''), As = A.replace(/ /g, '');
    if (!As) return 0;
    if (Hs === As) return 1;
    if (cjk) {
      // 답을 그대로 품고 말함 ("고통이요", "그건 고통") — 한 글자 답은 낱말 시작에서만
      // 두 글자 이하 답은 낱말 시작에서만 ('내다'가 '지어내다' 안에 있다고 맞게 하지 않음)
      if (As.length >= 3 && Hs.includes(As)) return 1;
      if (As.length <= 2 && (' ' + H).includes(' ' + As)) return 1;
    } else if ((' ' + H + ' ').includes(' ' + A + ' ')) return 1;
    const aw = A.split(' '), hw = H.split(' ');
    if (ko) {
      // 낱말마다 줄기를 맞춰 본다: "거리 두기" ↔ "거리를 두는"
      const as = aw.map(stemKo), hs = hw.map(stemKo);
      const near = (x, y) => Math.max(sim(jamo(x), jamo(y)), sim(phon(x), phon(y)));
      if (inOrder(as, hs, (x, y) => x === y || (x.length >= 2 && y.length >= 2 && near(x, y) >= NEAR))) return 1;
      const sa = stemKo(As), sh = stemKo(Hs);
      if (sa.length >= 1 && sa === sh) return 1;
      // 소리가 같으면 맞음 (음성 인식이 소리 나는 대로 적음: 괴로운↔괴로움은 아래 자모 비교로)
      if (As.length >= 2 && phon(Hs) === phon(As)) return 0.97;
      // 통째로 비교한 것과 줄기끼리 비교한 것 중 높은 쪽 ('괴로움'은 줄기가 '괴'라 통째로 봐야 함). 자모와 소리 중 높은 쪽
      const s = Math.max(As.length >= 2 ? near(Hs, As) : 0, sa.length >= 2 ? near(sh, sa) : 0);
      if (s >= NEAR) return s;
      // 답의 앞부분만 말함 ("감수" ↔ "감수성") — 자모 60% 넘게
      const jh = jamo(Hs), ja = jamo(As);
      if (Hs.length >= 2 && As.startsWith(Hs) && jh.length / ja.length >= 0.6) return 0.95;
      return Math.max(0, s - 0.2);
    }
    if (!cjk) {
      const close = (x, y) => x === y || (x.length >= 5 && y.length >= 5 && sim(x, y) >= 0.8);
      if (inOrder(aw.filter((w) => w.length > 1 || aw.length === 1), hw, close)) return 1;
      const s = sim(Hs, As);
      if (As.length >= 5 && s >= 0.85) return s;
      return Math.max(0, s - 0.2);
    }
    const s = sim(Hs, As);
    return As.length >= 3 && s >= 0.8 ? s : Math.max(0, s - 0.2);
  }
  // a의 낱말이 h 안에 차례대로 다 있나
  function inOrder(a, h, eq) {
    if (!a.length) return false;
    let j = 0;
    for (const w of a) {
      while (j < h.length && !eq(w, h[j])) j++;
      if (j >= h.length) return false;
      j++;
    }
    return true;
  }

  /* ---------- 군말 ---------- */
  // 답 앞뒤에 붙는 생각하는 소리. 답에서 빼고, 이것만 말했으면 답으로 치지 않는다
  const FILLERS = {
    ko: ['음', '음음', '으음', '흠', '어', '어어', '아', '에', '그', '저', '저기', '그게', '그러니까', '그니까', '뭐더라', '뭐였더라', '뭐지', '뭐였지', '아마', '있잖아', '그거', '이거'],
    en: ['um', 'uh', 'uhm', 'hmm', 'er', 'erm', 'well', 'like', 'so', 'maybe', 'it is', 'its', 'i think'],
    es: ['eh', 'em', 'este', 'pues', 'bueno', 'a ver', 'mmm'],
  };
  const fillerSet = (lang) => (/^es/i.test(lang) ? FILLERS.es : /^ko/i.test(lang) ? FILLERS.ko : FILLERS.en).concat(FILLERS.ko).map((w) => norm(w, 'en'));
  // 앞뒤 군말을 뺀 글 (다 빼면 빈 글)
  function dropFillers(text, lang) {
    const set = fillerSet(lang);
    let words = norm(text, lang).split(' ').filter(Boolean);
    const isF = (i, n) => set.includes(words.slice(i, i + n).join(' '));
    for (let moved = true; moved && words.length;) {
      moved = false;
      for (const n of [2, 1]) {
        if (words.length >= n && isF(0, n)) { words = words.slice(n); moved = true; break; }
        if (words.length >= n && isF(words.length - n, n)) { words = words.slice(0, -n); moved = true; break; }
      }
    }
    return words.join(' ');
  }
  // 후보가 모두 군말이나 한 글자 잡음뿐인지 (물소리·'음…' → 답으로 치지 않고 다시 듣는다)
  function noAnswer(heard, lang) {
    const list = (Array.isArray(heard) ? heard : [heard]).map((h) => String(h || '').trim()).filter(Boolean);
    return !!list.length && list.every((h) => dropFillers(h, lang).replace(/ /g, '').length <= 1);
  }

  /**
   * 채점. heard: 음성 인식이 돌려준 후보 글들(가장 그럴듯한 것부터), text: 맞혀야 할 카드 면,
   * extra: 카드 글 말고도 맞다고 볼 답 (AI가 같은 뜻이라고 한 말, card.voiceOk)
   * → { ok, alt: 맞힌 답(카드 글의 그 부분), heard: 맞은 후보(없으면 첫 후보), score }
   */
  function judge(heard, text, lang, extra) {
    const list = (Array.isArray(heard) ? heard : [heard]).map((h) => String(h || '').trim()).filter(Boolean);
    const alts = answers(text);
    if (!alts.length) alts.push(String(text || ''));
    (extra || []).forEach((e) => { const a = String(e || '').trim(); if (a && !alts.includes(a)) alts.push(a); });
    let best = { ok: false, alt: '', heard: list[0] || '', score: 0 };
    list.forEach((h, i) => {
      const hc = dropFillers(h, lang) || h; // '음 고통' → '고통'
      alts.forEach((a) => {
        const s = Math.max(matchOne(h, a, lang), matchOne(hc, a, lang)) - i * 0.001; // 같은 점수면 앞 후보
        if (s > best.score) best = { ok: s >= 0.8 - i * 0.001, alt: a, heard: h, score: s };
      });
    });
    best.score = Math.max(0, Math.min(1, Math.round(best.score * 1000) / 1000));
    if (!best.ok) { best.heard = list[0] || ''; best.alt = ''; } // 틀리면 가장 그럴듯한 첫 후보를 보여 준다
    return best;
  }

  /* ---------- 말로 하는 명령 ---------- */
  const COMMANDS = {
    ko: {
      pass: ['몰라', '몰라요', '모르겠어', '모르겠어요', '모르겠다', '모름', '패스', '넘어가', '넘어가자', '넘겨', '스킵', '다음', '다음 거', '다음 카드'],
      repeat: ['다시', '다시요', '다시 읽어', '다시 읽어 줘', '다시 읽어줘', '다시 말해 줘', '다시 말해줘', '한 번 더', '한번 더', '한번더', '뭐라고', '뭐라고요'],
      right: ['맞았어', '맞았어요', '맞았다', '맞았잖아', '맞잖아', '맞아', '맞아요', '맞다', '맞은 걸로', '맞은걸로', '맞게 해 줘', '맞게 말했어', '정답', '정답이야', '정답이잖아', '맞는데', '내가 맞았어'],
      stop: ['그만', '그만해', '그만할래', '그만하자', '끝', '끝내', '끝낼래', '끝내자', '종료'],
      resume: ['계속', '계속해', '계속하자', '이어서', '이어서 해', '다시 시작', '시작'],
      pause: ['잠깐', '잠깐만', '멈춰', '멈춤', '일시 정지', '일시정지'],
    },
    en: {
      pass: ['pass', 'skip', 'next', 'i dont know', 'dont know', 'no idea', 'i have no idea'],
      repeat: ['again', 'repeat', 'say again', 'say it again', 'one more time', 'what'],
      right: ['correct', 'i was right', 'that was right', 'thats right', 'mark it right', 'mark correct'],
      stop: ['stop', 'finish', 'quit', 'end', 'im done'],
      resume: ['continue', 'resume', 'go on', 'keep going', 'start'],
      pause: ['wait', 'pause', 'hold on'],
    },
    es: {
      pass: ['paso', 'no se', 'no lo se', 'siguiente', 'saltar'],
      repeat: ['otra vez', 'repite', 'repitelo', 'de nuevo', 'como'],
      right: ['correcto', 'tenia razon', 'estaba bien', 'era correcto'],
      stop: ['basta', 'terminar', 'termina', 'fin', 'parar'],
      resume: ['sigue', 'seguir', 'continua', 'continuar', 'empezar'],
      pause: ['espera', 'pausa', 'un momento'],
    },
  };
  // 그 언어의 명령 낱말 (화면 안내용, 대표 셋)
  function commandWords(lang) {
    const k = /^es/i.test(lang) ? 'es' : /^ko/i.test(lang) ? 'ko' : 'en';
    return { ko: { pass: '몰라', repeat: '다시', right: '맞았어', stop: '그만', resume: '계속' },
      en: { pass: 'pass', repeat: 'again', right: 'correct', stop: 'stop', resume: 'continue' },
      es: { pass: 'paso', repeat: 'otra vez', right: 'correcto', stop: 'basta', resume: 'sigue' } }[k];
  }
  // 말한 글이 명령인지. 명령만 말한 경우만 (뒤에 '요'·'줘' 정도는 괜찮음). 한국어 명령은 어느 언어로 들을 때도 받아 준다
  function command(heard, lang) {
    const list = (Array.isArray(heard) ? heard : [heard]).map((h) => norm(h, 'en').replace(/(?: ?요| ?줘| ?좀| please)$/, '').trim()).filter(Boolean);
    const sets = [COMMANDS.ko];
    if (/^es/i.test(lang)) sets.push(COMMANDS.es);
    else if (!/^ko/i.test(lang)) sets.push(COMMANDS.en);
    for (const h of list) {
      const hp = HANGUL.test(h) ? phon(h) : null; // 한국어는 소리로도 (마자써 = 맞았어)
      for (const set of sets) {
        for (const [cmd, words] of Object.entries(set)) {
          if (words.some((w) => norm(w, 'en') === h || (hp && set === COMMANDS.ko && phon(w) === hp))) return cmd;
        }
      }
    }
    return null;
  }
  // 틀렸다고 나온 바로 뒤 '맞았어'를 기다릴 때: 명령보다 너그럽게 ('아니 맞았는데', '마자', '정답이라고')
  const RIGHT_SOUNDS = ['mAjA', 'mAjO', 'mAjF', 'mAjgE', 'mAjnF', 'mAjdA', 'mAjjI', 'jONdAb']; // 맞아·맞았(마자) 맞어 맞은·맞음 맞게 맞는 맞다 맞지 정답
  const NOT_RIGHT = ['AnmAj', 'mAjjIAn', 'jONdAbAn', 'jONdAbIAn']; // 안 맞아, 맞지 않아, 정답 아냐
  function saysRight(heard, lang) {
    if (command(heard, lang) === 'right') return true;
    const list = (Array.isArray(heard) ? heard : [heard]).map((h) => norm(h, 'en')).filter(Boolean);
    return list.some((t) => {
      if (HANGUL.test(t)) { const p = phon(t); return RIGHT_SOUNDS.some((k) => p.includes(k)) && !NOT_RIGHT.some((k) => p.includes(k)); }
      return /\b(correct|right|yes|yeah|correcto|si|bien)\b/.test(t) && !/\b(not|no|wrong|incorrecto)\b/.test(t);
    });
  }

  /* ---------- 채점 → 간격 반복 평가 ---------- */
  // 맞음 = 보통, '다시' 듣고 맞음 = 어려움, 틀림·몰라 = 다시
  function gradeOf(result) {
    if (!result || !result.ok) return 'again';
    return result.repeated ? 'hard' : 'good';
  }

  // 맞힌 답을 카드 글에서 찾아 [앞, 맞힌 부분, 뒤]로 (화면에서 표시하려고). 못 찾으면 null
  function highlight(text, alt) {
    const t = String(text || ''), a = String(alt || '');
    if (!a) return null;
    const i = t.indexOf(a);
    if (i < 0) return null;
    return [t.slice(0, i), a, t.slice(i + a.length)];
  }

  const api = { LANGS, langName, guessLang, guessPair, answers, speakText, norm, stemKo, jamo, phon, sim, matchOne, judge, dropFillers, noAnswer, command, saysRight, commandWords, gradeOf, highlight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoiceCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
