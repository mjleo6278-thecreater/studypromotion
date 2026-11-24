// 말로 복습 (v4.5): 채점 · 명령 · 언어 짐작 · 읽어 줄 글
const test = require('node:test');
const assert = require('node:assert');
const V = require('../js/voicecore.js');

const ok = (heard, back, lang = 'ko-KR') => V.judge(heard, back, lang).ok;

test('카드 한 면에서 답 고르기: 품사·괄호·물결을 빼고 , ; / 로 나눔', () => {
  assert.deepStrictEqual(V.answers('n. 고통, 괴로움'), ['고통', '괴로움']);
  assert.deepStrictEqual(V.answers('v. (생각·자원을) 끌어들이다, 동원하다; 모집하다'), ['끌어들이다', '동원하다', '모집하다']);
  assert.deepStrictEqual(V.answers('n. 죽음(을 피할 수 없음); 사망률'), ['죽음', '사망률']);
  assert.deepStrictEqual(V.answers('~에 달려 있다, ~에 좌우되다'), ['에 달려 있다', '에 좌우되다']);
  assert.deepStrictEqual(V.answers('a. 큰 / 넓은'), ['큰', '넓은']);
  assert.deepStrictEqual(V.answers('(속기)'), ['속기'], '괄호뿐이면 괄호 안 글');
  assert.deepStrictEqual(V.answers('comer (v.)'), ['comer']);
  assert.deepStrictEqual(V.answers('n. 반대 의견; v. 반대하다'), ['반대 의견', '반대하다']);
});

test('뜻이 여러 개면 하나만 말해도 맞음, 품사·괄호 속 말은 안 해도 됨', () => {
  assert.ok(ok('고통', 'n. 고통, 괴로움'));
  assert.ok(ok('괴로움', 'n. 고통, 괴로움'));
  assert.ok(ok('거리 두기', 'n. (감정적) 거리 두기, 무심함'));
  assert.ok(ok('감정적 거리 두기', 'n. (감정적) 거리 두기, 무심함'), '괄호 속 말까지 해도 맞음');
  assert.ok(ok('사망률', 'n. 죽음(을 피할 수 없음); 사망률'), '; 뒤 뜻도');
  assert.ok(ok('고통 괴로움', 'n. 고통, 괴로움'), '둘 다 말해도');
});

test('끝말이 달라도 맞음 (하다/해/한다, 요, 조사)', () => {
  assert.ok(ok('확보해', 'v. 확보하다, 얻어 내다'));
  assert.ok(ok('확보한다', 'v. 확보하다, 얻어 내다'));
  assert.ok(ok('고통이요', 'n. 고통, 괴로움'));
  assert.ok(ok('음 고통', 'n. 고통, 괴로움'));
  assert.ok(ok('줄이는', 'v. 줄이다, 제한하다'), '줄이다의 이는 줄기 (이다를 떼지 않음)');
  assert.ok(ok('한데 모이는 거', 'v. 한데 모이다, 수렴하다'));
  assert.ok(ok('불안정하다', 'a. 불안정한, 위태로운'));
  assert.ok(ok('잠재적', 'a. 장래의, 잠재적인'));
  assert.ok(ok('거리를 두는', 'n. 거리 두기'));
  assert.ok(ok('무심해', 'n. 거리 두기, 무심함'));
});

test('음성 인식이 한 글자쯤 다르게 적어도 맞음, 띄어쓰기는 안 따짐', () => {
  assert.ok(ok('괴로음', 'n. 고통, 괴로움'), '받침 하나');
  assert.ok(ok('지시대상', 'n. 지시 대상'));
  assert.ok(ok('설득력있는', 'a. 설득력 있는'));
  assert.ok(ok('감수', 'n. 감수성'), '앞부분만 (자모 60% 넘음)');
});

test('다른 말은 틀림 (두 글자 낱말은 한 자모 차이도 다른 말)', () => {
  assert.ok(!ok('분리', 'n. (감정적) 거리 두기, 무심함'));
  assert.ok(!ok('확보하다', 'a. 탄탄한, 확고한'));
  assert.ok(!ok('상태', 'n. 상대, 짝'));
  assert.ok(!ok('지어내다', 'v. (결과를) 내다, 낳다'), '두 글자 답이 다른 낱말 속에 있으면 아님');
  assert.ok(ok('이겨 내다', 'v. 내다, 낳다'), '따로 떨어진 낱말이면 그 답을 말한 것');
  assert.ok(!ok('distress', 'n. 고통, 괴로움'), '앞면을 따라 읽은 것');
  assert.ok(!ok('', 'n. 고통, 괴로움'));
  assert.ok(!ok('사과', 'n. 고통, 괴로움'));
});

test('후보 여러 개 중 하나라도 맞으면 맞음, 맞힌 답과 후보를 알려 줌', () => {
  const r = V.judge(['고독', '고통'], 'n. 고통, 괴로움', 'ko-KR');
  assert.ok(r.ok);
  assert.strictEqual(r.alt, '고통');
  assert.strictEqual(r.heard, '고통');
  const w = V.judge(['분리', '분리해'], 'n. 거리 두기, 무심함', 'ko-KR');
  assert.ok(!w.ok);
  assert.strictEqual(w.heard, '분리', '틀리면 첫 후보를 보여 줌');
});

test('영어·스페인어: 대소문자·악센트·관사 무시, 낱말 차례, 철자 조금 다름', () => {
  assert.ok(ok('Distress', 'distress', 'en-US'));
  assert.ok(ok('capture the fancy of', 'capture the fancy of', 'en-US'));
  assert.ok(ok('strip him of', 'strip ~ of', 'en-US'), '물결 자리에 다른 말');
  assert.ok(ok('be left to ones own devices', "be left to one's own devices", 'en-US'));
  assert.ok(ok('adios', 'adiós', 'es-ES'));
  assert.ok(ok('biblioteca', 'la biblioteca', 'es-ES'), '관사 빼도');
  assert.ok(ok('la biblioteca', 'biblioteca', 'es-ES'), '관사 붙여도');
  assert.ok(ok('Qué tal', '¿Qué tal?', 'es-ES'));
  assert.ok(ok('discrepency', 'discrepancy', 'en-US'), '긴 낱말은 한 글자 차이');
  assert.ok(!ok('comer', 'beber', 'es-ES'));
  assert.ok(!ok('pool', 'poll', 'en-US'), '짧은 낱말은 철자가 같아야');
  assert.ok(!ok('detach', 'detachment', 'en-US'));
});

test('말로 하는 명령: 명령만 말했을 때, 언어별, 끝의 요·줘는 괜찮음', () => {
  assert.strictEqual(V.command(['몰라'], 'ko-KR'), 'pass');
  assert.strictEqual(V.command(['모르겠어요'], 'ko-KR'), 'pass');
  assert.strictEqual(V.command(['다시 읽어 줘'], 'ko-KR'), 'repeat');
  assert.strictEqual(V.command(['맞았어'], 'ko-KR'), 'right');
  assert.strictEqual(V.command(['그만'], 'ko-KR'), 'stop');
  assert.strictEqual(V.command(['계속'], 'ko-KR'), 'resume');
  assert.strictEqual(V.command(['잠깐만'], 'ko-KR'), 'pause');
  assert.strictEqual(V.command(['고통'], 'ko-KR'), null);
  assert.strictEqual(V.command(['다시는 안 해'], 'ko-KR'), null, '명령 낱말이 들어 있기만 하면 아님');
  assert.strictEqual(V.command(['Pass'], 'en-US'), 'pass');
  assert.strictEqual(V.command(["I don't know"], 'en-US'), 'pass');
  assert.strictEqual(V.command(['again'], 'en-US'), 'repeat');
  assert.strictEqual(V.command(['stop'], 'en-US'), 'stop');
  assert.strictEqual(V.command(['no sé'], 'es-ES'), 'pass');
  assert.strictEqual(V.command(['otra vez'], 'es-ES'), 'repeat');
  assert.strictEqual(V.command(['basta'], 'es-ES'), 'stop');
  assert.strictEqual(V.command(['그만'], 'en-US'), 'stop', '한국어 명령은 어느 언어로 들을 때도');
  assert.strictEqual(V.command(['pass'], 'ko-KR'), null, '한국어로 들을 때 영어 명령은 안 받음');
  assert.deepStrictEqual(V.commandWords('es-ES'), { pass: 'paso', repeat: 'otra vez', right: 'correcto', stop: 'basta', resume: 'sigue' });
});

test('언어 짐작: 글자와 덱 이름', () => {
  assert.strictEqual(V.guessLang(['distress', 'detachment', 'secure'], '영어II 중간'), 'en-US');
  assert.strictEqual(V.guessLang(['n. 고통, 괴로움', 'v. 확보하다'], '영어II 중간'), 'ko-KR');
  assert.strictEqual(V.guessLang(['comer', 'beber', 'hablar'], '스페인어 3과'), 'es-ES', '악센트 없어도 덱 이름으로');
  assert.strictEqual(V.guessLang(['adiós', 'mañana', 'comer', 'beber'], '단어'), 'es-ES', '악센트·ñ가 있으면');
  assert.strictEqual(V.guessLang(['ありがとう', 'こんにちは'], ''), 'ja-JP');
  assert.strictEqual(V.guessLang(['apple'], ''), 'en-US');
  assert.deepStrictEqual(V.guessPair([{ front: 'hola', back: '안녕' }], '스페인어'), { front: 'es-ES', back: 'ko-KR' });
});

test('읽어 줄 글: 품사·괄호 기호·물결을 빼고 ; 와 / 는 쉼표로', () => {
  assert.strictEqual(V.speakText('n. 고통, 괴로움'), '고통, 괴로움');
  assert.strictEqual(V.speakText('n. (감정적) 거리 두기, 무심함'), '감정적 거리 두기, 무심함');
  assert.strictEqual(V.speakText('v. 조화시키다; 화해시키다'), '조화시키다, 화해시키다');
  assert.strictEqual(V.speakText('~의 마음을 사로잡다'), '의 마음을 사로잡다');
  assert.strictEqual(V.speakText('comer (v.)'), 'comer v.');
  assert.strictEqual(V.speakText('big / large'), 'big, large');
});

test('채점 → 간격 반복 평가: 맞음 보통, 다시 듣고 맞음 어려움, 틀림 다시', () => {
  assert.strictEqual(V.gradeOf({ ok: true }), 'good');
  assert.strictEqual(V.gradeOf({ ok: true, repeated: true }), 'hard');
  assert.strictEqual(V.gradeOf({ ok: false }), 'again');
  assert.strictEqual(V.gradeOf(null), 'again');
});

test('맞힌 답 표시 자리', () => {
  assert.deepStrictEqual(V.highlight('n. 고통, 괴로움', '괴로움'), ['n. 고통, ', '괴로움', '']);
  assert.strictEqual(V.highlight('n. 고통', '없음'), null);
});
