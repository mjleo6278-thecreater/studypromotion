// 말로 복습 (v4.5): 음성 인식·읽어 주기를 가짜로 바꿔 끼우고 처음부터 끝까지 눌러 본다
// 가짜 인식기는 __voice.listening._say('말') 로 말하고, 말하지 않으면 정한 시간 뒤 조용함으로 끝난다
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
const SHOTS = process.env.SHOTS; // 미리 보기 사진을 남길 폴더 (없으면 안 찍음)

// 가짜 음성 인식·읽어 주기 (앱보다 먼저 깔림)
function fakeSpeech(opts) {
  const V = window.__voice = { said: [], recs: [], starts: 0, listening: null, speakMs: 30 };
  if (opts.noSpeak) { try { delete window.speechSynthesis; } catch (e) { /* 무시 */ } Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); }
  else {
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; this.volume = 1; this.rate = 1; this.voice = null; } };
    const synth = {
      cur: null,
      getVoices() { return [{ lang: 'ko-KR', name: 'ko', localService: true }, { lang: 'en-US', name: 'en', localService: true }, { lang: 'es-ES', name: 'es', localService: true }]; },
      speak(u) {
        V.said.push({ text: u.text, lang: u.lang, volume: u.volume, voice: u.voice && u.voice.name });
        const t = setTimeout(() => { if (this.cur && this.cur.u === u) this.cur = null; if (u.onend) u.onend({}); }, V.speakMs);
        this.cur = { u, t };
      },
      cancel() { if (this.cur) { const { u, t } = this.cur; this.cur = null; clearTimeout(t); if (u.onerror) u.onerror({ error: 'interrupted' }); } },
      addEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  }
  if (opts.noHear) {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    return;
  }
  class Rec {
    constructor() { this.lang = ''; this.active = false; V.recs.push(this); }
    start() {
      if (this.active) throw new Error('InvalidStateError');
      this.active = true; V.starts++; V.listening = this; V.lastLang = this.lang;
      if (V.stall) return; // 켜지지 않는 인식기 (일부 아이폰)
      setTimeout(() => { if (!this.active) return; if (this.onstart) this.onstart({}); if (this.onaudiostart) this.onaudiostart({}); if (V.next !== undefined) { const x = V.next; V.next = undefined; setTimeout(() => this._say(x), 10); } }, 5);
    }
    _end() { this.active = false; if (V.listening === this) V.listening = null; if (this.onend) this.onend({}); }
    abort() { if (!this.active) return; this.active = false; if (V.listening === this) V.listening = null; setTimeout(() => { if (this.onerror) this.onerror({ error: 'aborted' }); if (this.onend) this.onend({}); }, 0); }
    stop() { this.abort(); }
    _say(x) {
      if (!this.active) return;
      if (x && x.error) { this.active = false; if (this.onerror) this.onerror({ error: x.error }); return this._end(); }
      const alts = Array.isArray(x) ? x : [x];
      if (this.onspeechstart) this.onspeechstart({});
      if (x && x.interim) { const r = [{ transcript: x.interim }]; r.isFinal = false; this.onresult({ resultIndex: 0, results: [r] }); return; }
      const r = alts.map((t) => ({ transcript: t, confidence: 0.9 })); r.isFinal = true;
      this.onresult({ resultIndex: 0, results: [r] });
      this._end();
    }
  }
  window.SpeechRecognition = undefined;
  window.webkitSpeechRecognition = Rec;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const assert = (c, msg) => { if (!c) throw new Error('실패: ' + msg); console.log('ok -', msg); };
  const browser = await chromium.launch();
  const errors = [];
  async function open(o = {}) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: o.dark ? 'dark' : 'light', deviceScaleFactor: SHOTS ? 2 : 1 }, o.ctx || {}));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { errors.push(e.message); if (process.env.DEBUG) console.log('PAGEERR', e.message, e.stack); });
    page.on('console', (m) => { if (process.env.DEBUG && m.type() === 'error') console.log('CONSOLE', m.text()); m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()); });
    await page.addInitScript(fakeSpeech, { noHear: !!o.noHear, noSpeak: !!o.noSpeak });
    await page.addInitScript((mic) => { try { localStorage.setItem('studypromotion.welcomeClosed', '1'); if (mic) localStorage.setItem('studypromotion.voiceMic', '1'); } catch (e) { /* 무시 */ } }, !!o.mic);
    await page.goto(base + '#review');
    await page.waitForFunction(() => window.App && window.Voice);
    await page.evaluate(() => {
      const t = Date.now();
      App.store.update((st) => {
        st.decks = [{ id: 'en', name: '영어II 중간 선지 어휘', createdAt: t }, { id: 'es', name: '스페인어 3과', createdAt: t }, { id: 'empty', name: '빈 덱', createdAt: t }];
        const en = [['distress', 'n. 고통, 괴로움'], ['detachment', 'n. (감정적) 거리 두기, 무심함'], ['secure', 'v. 확보하다, 얻어 내다'], ['referent', 'n. 지시 대상']];
        const es = [['comer', '먹다'], ['beber', '마시다'], ['la biblioteca', '도서관']];
        st.cards = en.map(([f, b], i) => SRS.newCard({ id: 'e' + i, deckId: 'en', front: f, back: b, createdAt: t }, t))
          .concat(es.map(([f, b], i) => SRS.newCard({ id: 's' + i, deckId: 'es', front: f, back: b, createdAt: t }, t)));
        st.reviewLog = [];
      });
    });
    return page;
  }
  const V = (page) => page.evaluate(() => ({ said: __voice.said.slice(), starts: __voice.starts, lang: __voice.lastLang, listening: !!(__voice.listening && __voice.listening.active) }));
  const listening = (page) => page.waitForFunction(() => __voice.listening && __voice.listening.active && document.querySelector('#vr-status').classList.contains('listen'), null, { timeout: 8000 });
  const say = async (page, x) => { await listening(page); await page.evaluate((v) => __voice.listening._say(v), x); };
  const front = (page) => page.textContent('#vr-front');
  const cardOf = (page, f) => page.evaluate((f) => App.store.get().cards.find((c) => c.front === f), f);
  const answerFor = { distress: '고통', detachment: '거리 두기', secure: '확보해', referent: '지시 대상' };
  const statusIs = (page, cls, ms) => page.waitForFunction((c) => document.querySelector('#vr-status').classList.contains(c), cls, { timeout: ms || 8000 });
  const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name) }); } };

  /* ===== 1) 덱 화면 · 시작 창 ===== */
  let page = await open();
  await page.evaluate(() => App.openDeck('empty'));
  assert(await page.isDisabled('#deck-voice'), '카드가 없는 덱은 말로 복습 단추가 꺼짐');
  await page.evaluate(() => App.openDeck('en'));
  assert(await page.isVisible('#deck-voice') && !(await page.isDisabled('#deck-voice')), '덱 화면에 말로 복습 단추');
  assert(/말로 복습/.test(await page.textContent('#deck-voice')), '단추 글: 말로 복습');
  await shot(page, 'v1-deck.png');
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  const sheet = await page.evaluate(() => {
    const b = document.querySelector('.ui-voice');
    return { front: b.querySelector('#vs-front').value, back: b.querySelector('#vs-back').value, mode: b.querySelector('.vs-dir.on').dataset.vsMode, read: b.querySelector('#vs-read').checked, wait: b.querySelector('[data-vs-wait].active').dataset.vsWait, go: b.querySelector('[data-vs-start]').textContent.trim(), hint: b.querySelector('[data-vs-mode="meaning"] small').textContent };
  });
  assert(sheet.front === 'en-US' && sheet.back === 'ko-KR', '언어 짐작: 앞면 영어, 뒷면 한국어');
  assert(sheet.mode === 'meaning' && sheet.read && sheet.wait === '10', '기본: 뜻 말하기 · 읽어 주기 켬 · 10초');
  assert(sheet.go === '오늘 카드 4장 말로 복습', '시작 단추: 오늘 카드 4장 말로 복습');
  assert(/distress를 듣고 → “고통”/.test(sheet.hint), '예시는 이 덱의 첫 카드: ' + sheet.hint);
  await page.tap('[data-vs-mode="listen"]');
  assert(await page.textContent('[data-vs-start]') === '오늘 카드 4장 듣기', '듣기만을 고르면 단추 글이 바뀜');
  assert(/생각할 시간/.test(await page.textContent('.vs-wait-head')), '듣기만: 기다리는 시간 → 생각할 시간');
  await page.tap('[data-vs-mode="meaning"]');
  await page.tap('[data-vs-wait="6"]');
  await shot(page, 'v2-sheet.png');

  /* ===== 2) 시작: 처음이면 누른 순간 마이크부터 → 읽기 → 듣기 ===== */
  await page.tap('[data-vs-start]');
  let v = await V(page);
  assert(v.starts === 1, '처음에는 누르자마자 마이크를 켬 (허락 받기)');
  await page.waitForFunction(() => !document.querySelector('#voice-study').hidden);
  assert(await page.evaluate(() => App.store.get().decks.find((d) => d.id === 'en').voice.wait) === 6, '고른 설정을 덱에 남김');
  assert(await page.evaluate(() => localStorage.getItem('studypromotion.voiceMic')) === '1', '마이크를 켰다고 기억 (다음엔 바로 읽기부터)');
  await listening(page);
  v = await V(page);
  let f = await front(page);
  assert(v.said.some((s) => s.text === f && s.lang === 'en-US' && s.voice === 'en'), `카드를 영어 목소리로 읽음 (${f})`);
  assert(v.said[0].volume === 0, '누른 순간 소리 길을 여는 빈 소리');
  assert(v.lang === 'ko-KR', '뜻은 한국어로 들음');
  assert(/듣고 있어요/.test(await page.textContent('#vr-say')) && !(await page.isHidden('#vr-ring')), '듣는 중: 남은 시간 고리');
  assert(/몰라.*다시.*그만/.test(await page.textContent('#vr-cmds')), '말로 할 수 있는 것 안내');
  await shot(page, 'v3-listen.png');

  /* ===== 3) 맞음 ===== */
  await page.evaluate(() => __voice.listening._say({ interim: '고' }));
  assert(/“고…”/.test(await page.textContent('#vr-heard')), '말하는 중에도 들은 말이 보임');
  await page.evaluate((a) => __voice.listening._say([a]), answerFor[f]);
  await page.waitForSelector('#vr-card.ok');
  assert(/맞았어요/.test(await page.textContent('#vr-verdict')), '맞았어요');
  assert(await page.$('#vr-ans mark'), '맞힌 뜻에 표시');
  let c = await cardOf(page, f);
  assert(c.reps === 1 && c.interval === 1, '맞으면 보통으로 채점 (내일 다시)');
  let log = await page.evaluate(() => App.store.get().reviewLog);
  assert(log.length === 1 && log[0].grade === 'good' && log[0].via === 'voice', '복습 기록에 말로 표시');
  await shot(page, 'v4-ok.png');
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f);
  v = await V(page);
  assert(v.said.some((s) => s.lang === 'ko-KR' && /,|대상|고통|두기|확보/.test(s.text)), '맞으면 뜻 전체를 한국어로 읽어 줌');

  /* ===== 4) 틀림 → '맞았어'로 고치기 ===== */
  f = await front(page);
  await say(page, ['사과']);
  await page.waitForSelector('#vr-card.bad');
  assert(/들은 말 “사과”/.test(await page.textContent('#vr-heard')) && /아쉬워요/.test(await page.textContent('#vr-verdict')), '틀리면 들은 말과 아쉬워요');
  assert(await page.isVisible('#vr-ans') && (await page.textContent('#vr-ans')).length > 1, '정답을 보여 줌');
  const t4 = Date.now();
  await page.waitForFunction(() => __voice.listening && __voice.listening.active && document.querySelector('#vr-status').classList.contains('listen'), null, { timeout: 1500 });
  assert(Date.now() - t4 < 1200 && /잘못 알아들었으면/.test(await page.textContent('#vr-say')), `틀리자마자 '맞았어'를 들음 (${Date.now() - t4}ms)`);
  assert(!(await V(page)).said.some((s) => /^정답은/.test(s.text)), '정답 읽기는 그 뒤로 미룸 (읽는 동안엔 마이크가 꺼져 있으니)');
  await shot(page, 'v5-bad.png');
  await say(page, ['마자써']);
  await page.waitForSelector('#vr-card.ok');
  c = await cardOf(page, f);
  assert(c.reps === 1 && c.lapses === 0, "소리 나는 대로 적힌 '마자써'도 맞은 걸로 (보통)");
  assert(!(await V(page)).said.some((s) => /^정답은/.test(s.text)), '고쳤으면 정답은 읽지 않음');

  /* ===== 5) 틀림 그대로 → 몇 장 뒤 다시 ===== */
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f);
  f = await front(page);
  await say(page, ['분리']);
  await page.waitForSelector('#vr-card.bad');
  await page.waitForFunction(() => __voice.said.some((s) => /^정답은 /.test(s.text)), null, { timeout: 8000 });
  assert(/정답은/.test(await page.textContent('#vr-say')) && /다음 카드에서/.test(await page.textContent('#vr-cmds')), "아무 말 없으면 정답을 읽고, 다음 카드에서 '맞았어'라고 해도 된다고 알려 줌");
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f, { timeout: 9000 });
  c = await cardOf(page, f);
  assert(c.lapses === 1 && c.reps === 0, '틀린 채로 두면 다시로 채점');
  let st = await page.evaluate(() => Voice.state);
  assert(st.queue.includes(c.id), '틀린 카드는 이번에 다시 나옴');

  /* ===== 6) '다시' → 한 번 더 읽고, 맞으면 어려움 ===== */
  f = await front(page);
  const readsBefore = (await V(page)).said.filter((s) => s.text === f).length;
  await say(page, ['다시']);
  await listening(page);
  assert((await V(page)).said.filter((s) => s.text === f).length === readsBefore + 1, "'다시'라고 하면 한 번 더 읽음");
  await say(page, [answerFor[f] || 'x']);
  await page.waitForSelector('#vr-card.ok');
  log = await page.evaluate(() => App.store.get().reviewLog);
  assert(log[log.length - 1].grade === 'hard', "'다시' 듣고 맞히면 어려움");

  /* ===== 7) '몰라' → 정답 읽고 다시 (고칠 시간 없이) ===== */
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f);
  f = await front(page);
  const n7 = (await page.evaluate(() => App.store.get().reviewLog)).length;
  await say(page, ['몰라']);
  await page.waitForSelector('#vr-card.bad');
  assert(/정답을 들어 봐요/.test(await page.textContent('#vr-verdict')) && await page.isHidden('#vr-heard'), '몰라: 들은 말 없이 정답');
  await page.waitForFunction((n) => App.store.get().reviewLog.length > n, n7, { timeout: 6000 });
  log = await page.evaluate(() => App.store.get().reviewLog);
  assert(log[log.length - 1].grade === 'again', '몰라는 다시로 채점');

  /* ===== 8) 단추: 정답 보기 · 잠깐 멈춤 · 계속하기 ===== */
  await listening(page);
  const n8 = (await page.evaluate(() => App.store.get().reviewLog)).length;
  await page.tap('[data-vr="reveal"]');
  await page.waitForSelector('#vr-card.bad');
  await page.tap('[data-vr="skip"]');
  await page.waitForFunction((n) => App.store.get().reviewLog.length > n, n8, { timeout: 4000 });
  log = await page.evaluate(() => App.store.get().reviewLog);
  assert(log[log.length - 1].grade === 'again', '정답 보기 → 다음: 다시로 채점');
  await listening(page);
  await page.tap('[data-vr="pause"]');
  await statusIs(page, 'pause');
  assert(/잠깐 멈췄어요/.test(await page.textContent('#vr-say')), '잠깐 멈춤');
  assert(await page.isVisible('[data-vr="resume"]'), '계속하기 단추');
  await shot(page, 'v6-pause.png');
  await page.waitForFunction(() => __voice.listening && __voice.listening.active); // 멈춘 동안에도 '계속'을 듣는다
  await page.evaluate(() => __voice.listening._say(['계속']));
  await page.waitForFunction(() => !document.querySelector('#vr-status').classList.contains('pause'));
  assert(true, "멈춘 뒤 '계속'이라고 하면 이어서");

  /* ===== 9) '그만' → 결과 ===== */
  await say(page, ['그만']);
  await page.waitForSelector('#vr-done:not([hidden])');
  const done = await page.evaluate(() => ({ sum: [...document.querySelectorAll('.vr-sum b')].map((b) => +b.textContent), miss: document.querySelectorAll('.vr-miss li').length, text: document.querySelector('#vr-done').textContent }));
  assert(done.sum[0] >= 2 && done.sum[2] >= 3, `결과: 한 번에 ${done.sum[0]} · 다시 ${done.sum[1]} · 틀림 ${done.sum[2]}`);
  assert(done.miss >= 1 && /헷갈린 카드/.test(done.text), '헷갈린 카드 목록');
  assert(/말로 복습 (그만|끝)!/.test(done.text), '끝 제목');
  await page.waitForFunction(() => __voice.said.some((s) => /^말로 복습 (그만|끝)!/.test(s.text)));
  assert(true, '결과를 소리로도 읽어 줌');
  await shot(page, 'v7-done.png');
  await page.tap('[data-vr="back"]');
  assert(await page.isVisible('#deck-detail') && await page.isHidden('#voice-study'), '덱으로 돌아가기');

  /* ===== 10) 두 번 조용하면 채점 없이 멈춤 → 다른 탭으로 가면 끝 ===== */
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  assert(await page.$eval('[data-vs-wait].active', (b) => b.dataset.vsWait) === '6', '덱에 남긴 설정을 다시 씀');
  const logN = (await page.evaluate(() => App.store.get().reviewLog)).length;
  const starts0 = (await V(page)).starts;
  await page.tap('[data-vs-start]');
  await listening(page);
  assert((await V(page)).starts === starts0 + 1, '두 번째부터는 마이크 먼저 켜지 않고 읽기부터');
  await statusIs(page, 'pause', 20000);
  assert(/말이 없어서/.test(await page.textContent('#vr-say')), '두 번 조용하면 멈춤 (약 12초)');
  assert((await page.evaluate(() => App.store.get().reviewLog)).length === logN, '조용한 카드는 채점하지 않음');
  await page.tap('.tab[data-view="home"]');
  await page.waitForTimeout(100);
  assert(await page.evaluate(() => !Voice.state), '다른 탭으로 가면 말로 복습이 끝남');
  v = await V(page);
  assert(!v.listening, '듣기도 멈춤');
  await page.tap('.tab[data-view="review"]');
  assert(await page.isHidden('#voice-study'), '복습 탭으로 돌아오면 덱 화면');

  /* ===== 10-2) 잡음 한 글자는 답으로 치지 않음 · 켜지지 않는 인식기 ===== */
  await page.evaluate(() => App.openDeck('en'));
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  await page.tap('[data-vs-start]');
  const n10 = (await page.evaluate(() => App.store.get().reviewLog)).length;
  await say(page, ['어']);
  await listening(page);
  assert((await page.evaluate(() => App.store.get().reviewLog)).length === n10 && !(await page.$('#vr-card.bad')), '물소리 같은 한 글자는 틀림으로 치지 않고 다시 들음');
  await page.evaluate(() => { __voice.stall = true; __voice.listening.abort(); });
  await statusIs(page, 'err', 12000);
  assert(/음성 인식이 자꾸 멈춰요/.test(await page.textContent('#vr-say')) && await page.isVisible('[data-vr="listen"]'), '인식기가 켜지지 않으면 알려 주고 듣기만을 권함');
  await page.evaluate(() => { __voice.stall = false; });
  await page.tap('#vr-back');
  await page.waitForFunction(() => document.querySelector('#voice-study').hidden || !document.querySelector('#vr-done').hidden);
  if (await page.isVisible('#vr-done')) await page.tap('[data-vr="back"]');

  /* ===== 10-3) 다음 카드에서 '맞았어' → 앞 카드 고치기 ===== */
  const resetEn = () => page.evaluate(() => App.store.update((st) => { const t = App.now(); st.cards.forEach((c) => { if (c.deckId === 'en') Object.assign(c, { due: t - 1000, reps: 0, interval: 0, lapses: 0, ease: 2.5 }); delete c.voiceOk; }); }));
  await resetEn();
  await page.evaluate(() => App.openDeck('en'));
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  await page.tap('[data-vs-start]');
  f = await front(page);
  await say(page, ['사과']);
  await page.waitForSelector('#vr-card.bad');
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f, { timeout: 9000 });
  c = await cardOf(page, f);
  assert(c.lapses === 1, '틀린 채로 넘어감');
  await listening(page);
  assert(/맞았어 \(앞 카드\)/.test(await page.textContent('#vr-cmds')), "다음 카드에서 '맞았어 (앞 카드)'를 알려 줌");
  const f2 = await front(page);
  const reads2 = (await V(page)).said.filter((s) => s.text === f2).length;
  await say(page, ['맞았어']);
  await statusIs(page, 'ok');
  assert(/앞 카드를 맞은 걸로 바꿨어요/.test(await page.textContent('#vr-say')), '앞 카드를 맞은 걸로 바꿨다고 알려 줌');
  await shot(page, 'v12-late-fix.png');
  c = await cardOf(page, f);
  assert(c.lapses === 0 && c.reps === 1 && c.interval === 1, '앞 카드: 다시 → 보통으로 고침');
  log = await page.evaluate((id) => App.store.get().reviewLog.filter((e) => e.cardId === id), c.id);
  assert(log.length >= 1 && log[log.length - 1].grade === 'good' && !log.slice(-1).some((e) => e.grade === 'again'), '기록도 보통으로 바꿈');
  st = await page.evaluate(() => Voice.state);
  assert(!st.queue.includes(c.id) && st.stats.wrong === 0, '다시 나오지 않고, 틀린 횟수에서도 뺌');
  await listening(page);
  assert(await front(page) === f2 && (await V(page)).said.filter((s) => s.text === f2).length === reads2 + 1, '지금 카드는 다시 읽고 들음');

  /* ===== 10-4) 카드 글과 다른 말 → AI에게 같은 뜻인지 묻기 ===== */
  await page.evaluate(() => { window.__ai = []; window.VoiceAIMock = async (b) => { window.__ai.push(b); await new Promise((r) => setTimeout(r, 900)); return b.said[0] === '같은 뜻 말'; }; __voice.speakMs = 700; }); // 맞음 화면이 금방 지나가지 않게 읽기를 느리게
  const f3 = await front(page);
  await say(page, ['같은 뜻 말']);
  await statusIs(page, 'think');
  assert(/같은 뜻인지 확인하는 중/.test(await page.textContent('#vr-say')), 'AI에게 묻는 동안 알려 줌');
  await shot(page, 'v13-ai-think.png');
  await page.waitForSelector('#vr-card.ok');
  assert(/같은 뜻이라 맞았어요/.test(await page.textContent('#vr-status')), '같은 뜻이면 맞음');
  await shot(page, 'v14-ai-ok.png');
  let ai = await page.evaluate(() => window.__ai);
  assert(ai.length === 1 && ai[0].q === f3 && ai[0].said[0] === '같은 뜻 말' && ai[0].a.length > 1, 'AI에게 문제 낱말·카드 뜻·말한 글을 보냄');
  c = await cardOf(page, f3);
  assert(JSON.stringify(c.voiceOk) === '["같은 뜻 말"]' && c.reps === 1, '같은 뜻이라고 한 말을 카드에 남김 (다음엔 묻지 않고 바로 맞음)');
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f3);
  await say(page, ['다른 뜻 말']);
  await page.waitForSelector('#vr-card.bad');
  ai = await page.evaluate(() => window.__ai);
  assert(ai.length === 2 && ai[1].said[0] === '다른 뜻 말', 'AI가 다른 뜻이라고 하면 틀림');
  await page.tap('[data-vr="skip"]');
  await listening(page);
  await say(page, ['음 그러니까']);
  await listening(page);
  assert((await page.evaluate(() => window.__ai)).length === 2 && !(await page.$('#vr-card.bad')), "'음 그러니까'만 말하면 답으로 치지 않고 다시 들음 (AI에게도 안 물음)");
  await page.evaluate(() => { __voice.speakMs = 30; });
  await page.tap('#vr-back');
  await page.waitForSelector('#vr-done:not([hidden])');
  await page.tap('[data-vr="back"]');
  // 시작 창에서 끄면 묻지 않는다 (남겨 둔 같은 뜻 말도 지우고)
  await resetEn();
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  assert(await page.isVisible('#vs-ai') && await page.isChecked('#vs-ai'), "시작 창 '비슷한 뜻도 맞게 보기' (켜짐)");
  await page.tap('[data-vs-mode="word"]');
  assert(await page.isHidden('.vs-ai-row'), '단어 말하기에서는 숨김 (그 단어를 말해야 하니까)');
  await page.tap('[data-vs-mode="meaning"]');
  await page.tap('.vs-ai-row');
  assert(!(await page.isChecked('#vs-ai')), '끄기');
  await page.tap('[data-vs-start]');
  await say(page, ['같은 뜻 말']);
  await page.waitForSelector('#vr-card.bad');
  assert((await page.evaluate(() => window.__ai)).length === 2, '끄면 AI에게 묻지 않음');
  assert(await page.evaluate(() => App.store.get().decks.find((d) => d.id === 'en').voice.ai === false), '덱에 끈 채로 남음');
  await page.evaluate(() => { delete window.VoiceAIMock; });
  await page.tap('#vr-back');
  await page.waitForFunction(() => document.querySelector('#voice-study').hidden || !document.querySelector('#vr-done').hidden);
  if (await page.isVisible('#vr-done')) await page.tap('[data-vr="back"]');

  /* ===== 11) 마이크 오류 → 듣기만으로 바꾸기 ===== */
  await page.evaluate(() => App.openDeck('en'));
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  await page.tap('[data-vs-start]');
  await say(page, { error: 'not-allowed' });
  await statusIs(page, 'err');
  assert(/마이크를 쓸 수 없어요/.test(await page.textContent('#vr-say')), '마이크가 막히면 알려 줌');
  const before = await page.evaluate(() => JSON.stringify(App.store.get().cards.filter((c) => c.deckId === 'en').map((c) => [c.due, c.reps])));
  await page.tap('[data-vr="listen"]');
  await page.waitForFunction(() => document.querySelector('#vr-lang').textContent.includes('듣기'));
  await page.waitForFunction(() => !document.querySelector('#vr-ans').hidden, null, { timeout: 8000 });
  assert(true, '듣기만: 몇 초 뒤 뜻을 보여 주고 읽어 줌');
  await page.tap('[data-vr="skip"]');
  const after = await page.evaluate(() => JSON.stringify(App.store.get().cards.filter((c) => c.deckId === 'en').map((c) => [c.due, c.reps])));
  assert(before === after, '듣기만은 복습 일정을 바꾸지 않음');
  assert(await page.evaluate(() => App.store.get().decks.find((d) => d.id === 'en').voice.mode) === 'listen', '바꾼 방법을 덱에 남김');
  // 오늘 복습할 카드가 한 장뿐이면 이미 끝 화면, 아니면 그만하기
  if (!(await page.evaluate(() => Voice.state && Voice.state.done))) await page.tap('#vr-back');
  await page.waitForSelector('#vr-done:not([hidden])');
  assert(/듣기 끝!/.test(await page.textContent('#vr-done')), '듣기만 끝 화면');
  await page.keyboard.press('Escape');
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.querySelector('#voice-study').hidden);
  assert(true, '휴대폰 뒤로 = 말로 복습 닫기');
  await page.context().close();

  /* ===== 12) 스페인어 단어 말하기 (다크) ===== */
  page = await open({ dark: true, mic: true });
  await page.evaluate(() => App.openDeck('es'));
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  assert(await page.$eval('#vs-front', (s) => s.value) === 'es-ES', '덱 이름으로 스페인어 짐작');
  await page.tap('[data-vs-mode="word"]');
  await page.tap('[data-vs-start]');
  await listening(page);
  v = await V(page);
  assert(v.lang === 'es-ES', '단어 말하기: 스페인어로 들음');
  f = await front(page);
  assert(['먹다', '마시다', '도서관'].includes(f), '뜻을 보여 줌: ' + f);
  assert(v.said.some((s) => s.text === f && s.lang === 'ko-KR'), '뜻은 한국어로 읽음');
  assert(/paso.*otra vez.*basta/.test(await page.textContent('#vr-cmds')), '명령어도 스페인어');
  const es = { 먹다: 'comer', 마시다: 'beber', 도서관: 'biblioteca' };
  await say(page, [es[f]]);
  await page.waitForSelector('#vr-card.ok');
  await page.waitForFunction(() => __voice.said.some((s) => s.lang === 'es-ES'));
  assert(true, '맞으면 스페인어 목소리로 단어를 읽어 줌');
  await shot(page, 'v8-es-dark.png');
  await page.waitForFunction((f) => document.querySelector('#vr-front').textContent !== f, f);
  await say(page, ['basta']);
  await page.waitForSelector('#vr-done:not([hidden])');
  assert(true, "스페인어로 'basta'라고 하면 끝");
  await page.context().close();

  /* ===== 13) 음성 인식이 없는 브라우저 ===== */
  page = await open({ noHear: true });
  await page.evaluate(() => App.openDeck('en'));
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  assert(/음성 인식이 안 돼서/.test(await page.textContent('.vs-warn')), '음성 인식이 안 되면 알려 줌');
  assert(await page.isDisabled('[data-vs-mode="meaning"]') && await page.isDisabled('[data-vs-mode="word"]'), '말하기 방법은 꺼짐');
  assert(await page.$eval('.vs-dir.on', (b) => b.dataset.vsMode) === 'listen', '듣기만이 골라져 있음');
  await shot(page, 'v9-nohear.png');
  await page.tap('[data-vs-start]');
  await page.waitForFunction(() => __voice.said.length > 1);
  assert(true, '듣기만은 바로 읽기 시작');
  await page.context().close();

  /* ===== 14) 기능 끄기 · 가로 화면 · 좁은 폭 ===== */
  page = await open({ mic: true, ctx: { viewport: { width: 800, height: 380 } } });
  await page.evaluate(() => App.openDeck('en'));
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  await page.tap('[data-vs-start]');
  await listening(page);
  const fit = await page.evaluate(() => {
    const a = document.querySelector('#vr-actions').getBoundingClientRect(), c = document.querySelector('#vr-card').getBoundingClientRect(), st = document.querySelector('#vr-status').getBoundingClientRect();
    return { ok: a.bottom <= innerHeight && c.bottom <= innerHeight && st.left >= c.right && document.documentElement.scrollWidth <= innerWidth, a: Math.round(a.bottom), c: Math.round(c.bottom) };
  });
  assert(fit.ok, `가로 화면: 왼쪽 카드 · 오른쪽 듣는 중과 단추, 스크롤 없이 다 보임 (단추 아래 ${fit.a}, 카드 아래 ${fit.c})`);
  await shot(page, 'v10-landscape.png');
  await say(page, answerFor[await front(page)]);
  await page.waitForSelector('#vr-card.ok');
  const fit2 = await page.evaluate(() => { const c = document.querySelector('#vr-card').getBoundingClientRect(); return Math.round(c.bottom) <= innerHeight; });
  assert(fit2, '가로 화면: 정답·들은 말이 나와도 카드가 화면 안');
  await shot(page, 'v11-landscape-ok.png');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await statusIs(page, 'pause');
  assert(/다른 화면에 다녀와서/.test(await page.textContent('#vr-say')), '다른 앱으로 가면 멈춤');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => Voice.stop(true));
  await page.evaluate(() => Features.set('voice', false));
  await page.evaluate(() => App.openDeck('en'));
  assert(await page.isHidden('#deck-voice'), '기능과 탭 편집에서 끄면 단추가 숨음');
  await page.context().close();

  page = await open({ mic: true, ctx: { viewport: { width: 360, height: 740 } } });
  await page.evaluate(() => App.openDeck('en'));
  const wide = await page.evaluate(() => [...document.querySelectorAll('.deck-actions .btn')].every((b) => b.getBoundingClientRect().right <= innerWidth - 8));
  assert(wide, '360px: 덱 단추가 화면 안');
  await page.tap('#deck-voice');
  await page.waitForSelector('.ui-back.in .ui-voice');
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!over, '360px: 가로로 넘치지 않음');
  await page.context().close();

  await browser.close();
  server.close();
  if (errors.length) { console.error('페이지 오류:', errors); process.exit(1); }
  console.log('말로 복습 화면 시험 통과');
})().catch((e) => { console.error(e); process.exit(1); });
