// 배포용 파일 만들기: node tools/build.js
//  dist/studypromotion.html : CSS·JS·아이콘을 모두 담은 파일 하나 (메일·메신저로 보내 바로 열기)
//  dist/web/           : 웹 호스팅(GitHub Pages, Netlify 등)에 그대로 올릴 폴더 (설치형 앱·오프라인 지원)
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'web'), { recursive: true });

// 1) 한 파일 버전
let html = read('index.html');
// 한 파일 버전은 글꼴 파일을 담기엔 커서 Pretendard를 CDN에서 불러온다(인터넷 없으면 시스템 글꼴)
html = html.replace(/<link rel="stylesheet" href="fonts\/pretendard\/pretendard.css">/, '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">');
html = html.replace(/<link rel="stylesheet" href="styles.css">/, () => `<style>\n${read('styles.css')}\n</style>`);
html = html.replace(/<script src="(js\/[\w.]+)"><\/script>/g, (_, src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);
const favicon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'icons/favicon-64.png')).toString('base64');
const touch = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'icons/apple-touch-icon.png')).toString('base64');
html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
html = html.replace(/(href|src)="icons\/favicon-64.png"/g, (_, attr) => `${attr}="${favicon}"`);
html = html.replace(/href="icons\/apple-touch-icon.png"/, `href="${touch}"`);
if (/src="js\/|href="styles.css"|href="fonts\/|(href|src)="icons\//.test(html)) throw new Error('외부 파일 참조가 남았습니다');
fs.writeFileSync(path.join(dist, 'studypromotion.html'), html);

// 2) 웹 호스팅용 폴더
const files = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'README.md'];
for (const f of fs.readdirSync(path.join(root, 'js'))) files.push('js/' + f);
for (const f of fs.readdirSync(path.join(root, 'icons'))) files.push('icons/' + f);
for (const f of fs.readdirSync(path.join(root, 'fonts/pretendard'), { recursive: true })) {
  if (fs.statSync(path.join(root, 'fonts/pretendard', f)).isFile()) files.push('fonts/pretendard/' + f);
}
// 업데이트 이야기(컷씬): 앱이 iframe으로 여는 cutscene/index.html과 그 페이지가 부르는 스크립트만 (캐릭터 시험 페이지·설명서는 빼고)
files.push(...cutsceneFiles());
function cutsceneFiles() {
  const page = read('cutscene/index.html');
  const list = ['cutscene/index.html'];
  for (const m of page.matchAll(/<script src="([\w.]+\.js)"><\/script>/g)) list.push('cutscene/' + m[1]);
  if (list.length < 5) throw new Error('cutscene/index.html에서 스크립트를 찾지 못했습니다');
  // 서비스 워커가 미리 받아 두는 목록(ASSETS)에도 모두 있어야 오프라인에서 열린다
  const sw = read('sw.js');
  for (const f of list) if (!sw.includes(`'./${f}'`)) throw new Error(`sw.js ASSETS에 ./${f}가 없습니다`);
  return list;
}
for (const f of files) {
  const to = path.join(dist, 'web', f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, f), to);
}
// 서비스 워커는 저장본을 먼저 쓰므로, 파일이 하나라도 바뀌면 CACHE 이름도 꼭 바뀌어야 새 버전이 전달된다.
// 버전 올리기를 깜빡해도 되도록 배포본 CACHE 이름 끝에 앱 파일 내용의 해시를 붙인다.
{
  const crypto = require('crypto');
  const h = crypto.createHash('sha256');
  for (const f of files.filter((x) => x !== 'sw.js').sort()) h.update(f).update(fs.readFileSync(path.join(root, f)));
  const swPath = path.join(dist, 'web', 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  const stamped = sw.replace(/(const CACHE = 'studypromotion-v\d+)'/, `$1-${h.digest('hex').slice(0, 8)}'`);
  if (stamped === sw) throw new Error('sw.js에서 CACHE 이름을 찾지 못했습니다');
  fs.writeFileSync(swPath, stamped);
}
console.log(`dist/studypromotion.html (${Math.round(html.length / 1024)}KB), dist/web/ (${files.length}개 파일)`);
