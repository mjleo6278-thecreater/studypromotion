// 개선안 미리 보기 만들기: node tools/build-preview.js
//  dist/preview/index.html      : 미리 보기 페이지 조각 (CSS·JS를 모두 담음, <html>·<head>·<body> 없이. Claude 아티팩트로 올리는 용도)
//  dist/preview/standalone.html : 같은 내용을 온전한 HTML 문서로 감싼 것 (내 컴퓨터에서 열어 보거나 테스트하는 용도)
//  dist/preview/fonts/          : Pretendard 글꼴 (페이지 옆에 같이 올린다)
//
// 실제 앱과 완전히 따로 돌게 세 가지를 바꾼다.
//  1) 저장 이름: 'studypromotion.*' → 'studypromotion-preview.*', 자동 백업 저장소도 따로. 실제 앱과 같은 주소에서 열어도 실제 기록을 읽거나 바꾸지 않는다.
//  2) 로그인: Firebase 설정을 비워 계정 기능을 끈다. 미리 보기에서 실제 계정의 기록을 덮어쓸 수 없다.
//  3) 서비스 워커·설치 정보(manifest)를 뺀다. 실제 앱의 저장본(캐시)을 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'preview');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const must = (s, re, what) => { if (!re.test(s)) throw new Error('미리 보기 빌드: ' + what + '을(를) 찾지 못했습니다'); return s; };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let html = read('index.html');
const favicon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'icons/favicon-64.png')).toString('base64');

// 문서 껍데기와 머리글의 설치·검색용 정보는 뺀다 (아티팩트가 껍데기를 따로 씌운다)
must(html, /<body>/, '<body>');
const headInline = (html.match(/<head>[\s\S]*?<\/head>/)[0].match(/<script>[\s\S]*?<\/script>/g) || []).join('\n');
let body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));

// AI 도우미: 진짜 AI 대신 가짜 AI(preview/ai-mock.js)를 ai.js 바로 앞에 넣는다. 실제 서버로는 아무것도 보내지 않는다
must(body, /<script src="js\/ai\.js"><\/script>/, 'AI 도우미 스크립트');
body = body.replace('<script src="js/ai.js"></script>', `<script>\n${read('preview/ai-mock.js').replace(/<\/script/gi, '<\\/script')}\n</script>\n<script src="js/ai.js"></script>`);

// CSS·JS를 안에 담는다
body = body.replace(/<script src="(js\/[\w.]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
body = body.replace(/(href|src)="icons\/favicon-64.png"/g, (_, attr) => `${attr}="${favicon}"`);
if (/src="js\//.test(body)) throw new Error('미리 보기 빌드: 담지 못한 스크립트가 남았습니다');

let page = [
  '<title>스터디 프로모션 미리 보기</title>',
  '<link rel="stylesheet" href="fonts/pretendard/pretendard.css">',
  `<style>\n${read('styles.css')}\n</style>`,
  `<style>\n${read('preview/preview.css')}\n</style>`,
  "<script>document.documentElement.lang = 'ko';</script>",
  headInline,
  body,
  `<script>\n${read('preview/preview.js').replace(/<\/script/gi, '<\\/script')}\n</script>`,
].join('\n');

// 1) 저장 이름을 따로
const keys = (page.match(/(['"`])studypromotion\./g) || []).length;
if (keys < 15) throw new Error('미리 보기 빌드: 저장 이름을 충분히 찾지 못했습니다 (' + keys + ')');
page = page.replace(/(['"`])studypromotion\./g, '$1studypromotion-preview.');
page = must(page, /'studypromotion-backup'/, '자동 백업 저장소 이름').replace(/'studypromotion-backup'/g, "'studypromotion-preview-backup'");
// 이름을 바꾸기 전 저장 위치(studygambit.v1 등)에서 옮겨 오는 것도 끈다
page = must(page, /const LEGACY_KEYS = \[[^\]]*\];/, '예전 저장 위치 목록').replace(/const LEGACY_KEYS = \[[^\]]*\];/, 'const LEGACY_KEYS = [];');

// 2) 로그인 끄기
page = must(page, /const FIREBASE_CONFIG = \{[\s\S]*?\n {2}\};/, 'Firebase 설정').replace(/const FIREBASE_CONFIG = \{[\s\S]*?\n {2}\};/, 'const FIREBASE_CONFIG = null; // 미리 보기: 실제 계정과 연결하지 않는다');
page = must(page, /계정 기능 준비 중이에요\. 곧 구글 계정이나 이메일로 로그인해서 여러 기기에서 같은 기록을 쓸 수 있어요\./, '로그인 안내 문구')
  .replace('계정 기능 준비 중이에요. 곧 구글 계정이나 이메일로 로그인해서 여러 기기에서 같은 기록을 쓸 수 있어요.', '미리 보기에서는 로그인하지 않아요. 실제 계정의 기록을 건드리지 않도록 막아 두었어요.');

// 3) 서비스 워커 등록 끄기
page = must(page, /navigator\.serviceWorker\.register\('sw\.js'/, '서비스 워커 등록').replace(/if \(\/\^https\?:\$\/\.test\(location\.protocol\) && 'serviceWorker' in navigator\) \{/, "if (false && 'serviceWorker' in navigator) { // 미리 보기: 서비스 워커를 쓰지 않는다");

// '뒤로' 버튼은 설치한 앱처럼 움직이게 (홈에서 누르면 페이지를 떠나는 대신 '한 번 더 누르면 닫혀요'라고 알려 준다)
page = must(page, /const isInstalled = \(\) => \{[^\n]*\};/, '설치 여부 확인').replace(/const isInstalled = \(\) => \{[^\n]*\};/, 'const isInstalled = () => true; // 미리 보기: 설치한 앱처럼');

// 확인: 실제 앱의 저장 이름·계정 설정이 남아 있으면 안 된다
for (const [re, what] of [
  [/['"`]studypromotion\.(v1|timer|stopwatch|cloud|lock)/, '실제 앱의 저장 이름'],
  [/'studypromotion-backup'/, '실제 앱의 자동 백업 저장소 이름'],
  [/apiKey: '/, 'Firebase 설정'],
  [/studygambit\.v1/, '예전 저장 위치'],
  [/<link rel="manifest"/, '설치 정보(manifest)'],
  [/const AI_ENDPOINT = '[^']/, 'AI 서버 주소'],
  [/if \(\/\^https\?:\$\/\.test\(location\.protocol\) && 'serviceWorker' in navigator\)/, '서비스 워커 등록'],
]) if (re.test(page)) throw new Error('미리 보기 빌드: ' + what + '이(가) 남아 있습니다');

fs.writeFileSync(path.join(out, 'index.html'), page);
fs.writeFileSync(path.join(out, 'standalone.html'), `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n${page}\n</body>\n</html>\n`);
let fonts = 0;
for (const f of fs.readdirSync(path.join(root, 'fonts/pretendard'), { recursive: true })) {
  const from = path.join(root, 'fonts/pretendard', f);
  if (!fs.statSync(from).isFile()) continue;
  const to = path.join(out, 'fonts/pretendard', f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fonts++;
}
console.log(`dist/preview/index.html (${Math.round(page.length / 1024)}KB, 저장 이름 ${keys}곳 바꿈), 글꼴 ${fonts}개 파일`);
