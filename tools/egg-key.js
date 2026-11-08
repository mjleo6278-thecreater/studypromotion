// 이스터에그 비밀 단어(이름)의 해시 만들기: node tools/egg-key.js 이름 [이름 ...]
// 나온 값을 js/egg.js 의 KEYS에 넣는다 (이름 자체는 소스에 남기지 않음)
const Egg = require('../js/egg.js');
const words = process.argv.slice(2);
if (!words.length) { console.log('사용법: node tools/egg-key.js 이름 [이름 ...]'); process.exit(1); }
for (const w of words) console.log(`'${Egg.key(w)}'  // ${Egg.norm(w).length}글자`);
