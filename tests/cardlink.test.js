// 링크로 플래시카드 가져오기 (v3.5): 링크 형식 읽기·만들기
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const CardLink = require('../js/cardlink.js');

const HOME = CardLink.HOME;

test('카드 링크인지 알아본다 (#cards로 시작)', () => {
  assert.ok(CardLink.isLink('#cards&c=a~b'));
  assert.ok(CardLink.isLink('cards&deck=x'));
  assert.ok(CardLink.isLink('#cards'));
  assert.ok(!CardLink.isLink('#review'));
  assert.ok(!CardLink.isLink('#cardsx&c=a~b'));
  assert.ok(!CardLink.isLink(''));
  assert.ok(!CardLink.isLink(null));
});

test('글자 그대로 쓴 링크: 덱 이름, 띄어쓰기 +, 한글·악센트는 그대로', async () => {
  const r = await CardLink.read('#cards&deck=스페인어+1과&c=hola~안녕&c=adiós~잘+가&c=¿Qué+tal?~어떻게+지내?');
  assert.strictEqual(r.deck, '스페인어 1과');
  assert.deepStrictEqual(r.cards, [['hola', '안녕'], ['adiós', '잘 가'], ['¿Qué tal?', '어떻게 지내?']]);
  assert.strictEqual(r.bad, 0);
});

test('바꿔 적은 글자(%2B %26 %7E %28 %29 %25 %23)를 되살린다', async () => {
  const r = await CardLink.read('#cards&c=comer+%28v.%29~먹다+%26+마시다&c=1%2B1~2&c=a%7Eb~물결+%25+%23');
  assert.deepStrictEqual(r.cards, [['comer (v.)', '먹다 & 마시다'], ['1+1', '2'], ['a~b', '물결 % #']]);
});

test('브라우저가 한글을 %로 바꿔 넘겨도 똑같이 읽는다', async () => {
  const raw = '#cards&deck=스페인어&c=hola~안녕';
  const encoded = '#' + encodeURI(raw.slice(1)); // 브라우저 주소창이 하는 것처럼
  assert.notStrictEqual(encoded, raw);
  assert.deepStrictEqual(await CardLink.read(encoded), await CardLink.read(raw));
});

test('뒷면에 ~가 또 있으면 첫 ~에서만 나눈다', async () => {
  const r = await CardLink.read('#cards&c=a~1~2개');
  assert.deepStrictEqual(r.cards, [['a', '1~2개']]);
});

test('어딘가에서 모든 글자를 %로 바꿔 버린 링크도 읽는다', async () => {
  const r = await CardLink.read('#cards&deck=' + encodeURIComponent('스페인어 1과') + '&c=' + encodeURIComponent('hola~안녕') + '&c=' + encodeURIComponent('comer (v.)~먹다'));
  assert.strictEqual(r.deck, '스페인어 1과');
  assert.deepStrictEqual(r.cards, [['hola', '안녕'], ['comer (v.)', '먹다']]);
});

test('너그럽게: ~ 대신 " - "나 탭으로 나눠도 읽고, 못 읽은 칸은 센다', async () => {
  const r = await CardLink.read('#cards&c=apple+-+사과&c=dog%09개&c=그냥글자&c=~뒤만&c=앞만~&c=');
  assert.deepStrictEqual(r.cards, [['apple', '사과'], ['dog', '개']]);
  assert.strictEqual(r.bad, 3); // '그냥글자', '~뒤만', '앞만~' (빈 c=는 세지 않음)
});

test('링크 안에서 겹친 카드는 한 장만, 앞뒤 빈칸·줄바꿈은 정리', async () => {
  const r = await CardLink.read('#cards&c=Hola~안녕&c=+hola++~+안녕+&c=hola~안녕하세요&c=a%0Ab~c%0A%0Ad');
  assert.deepStrictEqual(r.cards, [['Hola', '안녕'], ['hola', '안녕하세요'], ['a b', 'c d']]);
  assert.strictEqual(r.dup, 1);
});

test('너무 긴 글과 너무 많은 카드는 자른다', async () => {
  const long = 'x'.repeat(400);
  const r1 = await CardLink.read(`#cards&c=${long}~${'y'.repeat(600)}`);
  assert.strictEqual(r1.cards[0][0].length, CardLink.LIMIT.front);
  assert.strictEqual(r1.cards[0][1].length, CardLink.LIMIT.back);
  const many = Array.from({ length: CardLink.LIMIT.cards + 5 }, (_, i) => `&c=w${i}~v${i}`).join('');
  const r2 = await CardLink.read('#cards' + many);
  assert.strictEqual(r2.cards.length, CardLink.LIMIT.cards);
  assert.strictEqual(r2.over, 5);
});

test('카드가 없거나 덱 이름이 없어도 오류 없이 빈 결과', async () => {
  const r = await CardLink.read('#cards');
  assert.deepStrictEqual(r.cards, []);
  assert.strictEqual(r.deck, '');
  const r2 = await CardLink.read('#cards&c=50%~반');
  assert.deepStrictEqual(r2.cards, [['50%', '반']], '잘못된 % 글자도 그대로 남긴다');
});

// 별난 글자를 섞은 카드로 만들기 → 읽기가 그대로 돌아오는지
const tricky = [
  ['hola', '안녕'], ['¿Cómo estás?', '어떻게 지내?'], ['comer (to eat)', '먹다 (동사)'], ['1+1=2', '덧셈 & 등호'],
  ['50% off', '반값 #세일'], ['a~b', '물결~표'], ['"quoted" <tag>', '[괄호] {중괄호} |파이프| `백틱` ^ \\'],
  ['el/la', '정관사 · 남/여'], ['¡Ojo!', '조심해!'], ['niño, niña', '남자아이, 여자아이'], ["l'eau", '물; 생수'],
];

test('만들기 → 읽기: 별난 글자도 그대로 돌아온다', async () => {
  const url = CardLink.build({ deck: '스페인어 (1과) & 복습', cards: tricky });
  assert.ok(url.startsWith(HOME + '#cards&deck='));
  assert.ok(!/\s/.test(url), '링크에 빈칸이 없다');
  assert.ok(!/[()]/.test(url), '괄호는 바꿔 적어 마크다운 링크가 끊기지 않는다');
  assert.ok(url.includes('안녕') && url.includes('¿Cómo'), '한글·악센트는 그대로라 짧고 읽기 쉽다');
  const r = await CardLink.read(url.slice(url.indexOf('#')));
  assert.strictEqual(r.deck, '스페인어 (1과) & 복습');
  assert.deepStrictEqual(r.cards, tricky);
});

test('만들기 → 읽기: 아무 글자나 섞어도 (무작위 300번)', async () => {
  const pool = 'abcñáé 가나다라 ~+&#%()<>"\'[]{}|^`\\/?=;:,.!¿¡@$*_-\t\n0123';
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const word = () => { let s = ''; const n = 1 + rnd(12); for (let i = 0; i < n; i++) s += pool[rnd(pool.length)]; return s; };
  for (let k = 0; k < 300; k++) {
    const cards = [[word(), word()], [word(), word()]];
    const want = cards.map((c) => c.map((x) => x.replace(/\s+/g, ' ').trim())).filter((c) => c[0] && c[1]);
    const url = CardLink.build({ cards });
    const r = await CardLink.read(url.slice(url.indexOf('#')));
    const uniq = [];
    want.forEach((c) => { if (!uniq.some((u) => CardLink.sameKey(u[0], u[1]) === CardLink.sameKey(c[0], c[1]))) uniq.push(c); });
    assert.deepStrictEqual(r.cards, uniq, JSON.stringify(cards));
  }
});

test('압축 링크: 만들기 → 읽기, 다른 프로그램이 만든 deflate-raw도 읽는다', async () => {
  const url = await CardLink.buildZip({ deck: '긴 목록', cards: tricky });
  assert.ok(url.startsWith(HOME + '#cards&z='));
  const r = await CardLink.read(url.slice(url.indexOf('#')));
  assert.strictEqual(r.deck, '긴 목록');
  assert.deepStrictEqual(r.cards, tricky);
  // Node zlib(= 파이썬 zlib과 같은 방식)으로 만든 링크
  const json = JSON.stringify({ deck: 'zlib', cards: [['uno', '하나'], { front: 'dos', back: '둘' }] });
  const z = zlib.deflateRawSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64url');
  const r2 = await CardLink.read('#cards&z=' + z);
  assert.deepStrictEqual(r2.cards, [['uno', '하나'], ['dos', '둘']]);
  // 잘린 링크
  await assert.rejects(CardLink.read('#cards&z=' + z.slice(0, 10)), /잘렸거나/);
});

test('압축하면 긴 목록이 짧아진다 (200장)', async () => {
  const cards = Array.from({ length: 200 }, (_, i) => [`palabra número ${i}`, `스페인어 단어 ${i}번의 뜻`]);
  const plain = CardLink.build({ deck: '200장', cards });
  const zip = await CardLink.buildZip({ deck: '200장', cards });
  const plainBytes = encodeURI(plain).length; // 브라우저가 실제로 보내는 길이 (한글은 %로)
  assert.ok(zip.length < plainBytes / 3, `압축 ${zip.length} < 그대로 ${plainBytes}/3`);
  const r = await CardLink.read(zip.slice(zip.indexOf('#')));
  assert.strictEqual(r.cards.length, 200);
});

test('도구: tools/card_link.py가 만든 링크를 앱이 그대로 읽는다', async (t) => {
  let out;
  const input = tricky.map((c) => c.join('\t')).join('\n');
  try {
    out = execFileSync('python3', [path.join(__dirname, '..', 'tools', 'card_link.py'), '--deck', '파이썬 (도구)'], { input, encoding: 'utf8' });
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('python3 없음');
    throw e;
  }
  const url = out.trim().split('\n').pop();
  assert.strictEqual(url, CardLink.build({ deck: '파이썬 (도구)', cards: tricky }), '자바스크립트로 만든 링크와 글자 하나까지 같다');
  const zipOut = execFileSync('python3', [path.join(__dirname, '..', 'tools', 'card_link.py'), '--zip'], { input, encoding: 'utf8' }).trim();
  const r = await CardLink.read(zipOut.slice(zipOut.indexOf('#')));
  assert.deepStrictEqual(r.cards, tricky);
});
