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
for (const f of files) {
  const to = path.join(dist, 'web', f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(root, f), to);
}
console.log(`dist/studypromotion.html (${Math.round(html.length / 1024)}KB), dist/web/ (${files.length}개 파일)`);
