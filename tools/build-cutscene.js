// 컷씬 미리 보기용 한 파일 만들기: node tools/build-cutscene.js
//  dist/cutscene/index.html, dist/cutscene/character.html
//  - JS를 모두 안에 넣는다
//  - Pretendard는 컷씬에 쓰인 글자가 들어 있는 조각(woff2)만 골라 data: 주소로 넣는다 (인터넷 없이 열림)
//  - dist/cutscene/artifact/*.html: 미리 보기 페이지용 (바깥 틀이 doctype·head·body를 붙이므로 뺀 판)
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'cutscene');
const out = path.join(root, 'dist', 'cutscene');
fs.mkdirSync(path.join(out, 'artifact'), { recursive: true });

// 쓰인 글자 모으기 (JS 문자열 안의 한글·라틴 확장 등)
const used = new Set();
for (const f of fs.readdirSync(dir)) if (/\.(js|html)$/.test(f)) for (const ch of fs.readFileSync(path.join(dir, f), 'utf8')) used.add(ch.codePointAt(0));

// pretendard.css의 조각마다 unicode-range를 읽어 필요한 것만
const css = fs.readFileSync(path.join(root, 'fonts/pretendard/pretendard.css'), 'utf8');
const blocks = css.split('@font-face').slice(1);
let faces = '', kept = 0, bytes = 0;
for (const b of blocks) {
  const src = /url\(([^)]+\.woff2)\)/.exec(b);
  const range = /unicode-range:\s*([^;]+);/.exec(b);
  if (!src || !range) continue;
  const hit = range[1].split(',').some((r) => {
    const m = /U\+([0-9a-f]+)(?:-([0-9a-f]+))?/i.exec(r.trim());
    if (!m) return false;
    const a = parseInt(m[1], 16), z = m[2] ? parseInt(m[2], 16) : a;
    for (const c of used) if (c >= a && c <= z) return true;
    return false;
  });
  if (!hit) continue;
  const file = path.join(root, 'fonts/pretendard', src[1].replace(/['"]/g, ''));
  const data = fs.readFileSync(file);
  bytes += data.length; kept++;
  faces += `@font-face{font-family:'Pretendard Variable';font-weight:45 920;font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');unicode-range:${range[1].trim()};}\n`;
}

for (const page of ['index.html', 'character.html']) {
  let html = fs.readFileSync(path.join(dir, page), 'utf8');
  html = html.replace(/<link rel="stylesheet" href="..\/fonts\/pretendard\/pretendard.css">/, () => `<style>\n${faces}</style>`);
  html = html.replace(/<script src="([\w.]+)"><\/script>/g, (_, src) => `<script>\n${fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`);
  if (/src="[\w.]+\.js"|href="\.\.\//.test(html)) throw new Error(page + ': 바깥 파일 참조가 남았습니다');
  fs.writeFileSync(path.join(out, page), html);
  // 미리 보기 판: <title>을 맨 위로, 문서 틀 태그와 charset·viewport 메타는 뺀다
  const title = /<title>[^<]*<\/title>/.exec(html)[0];
  const art = title + '\n' + html
    .replace(/<!doctype html>\s*/i, '').replace(/<\/?html[^>]*>\s*/gi, '').replace(/<\/?head>\s*/gi, '').replace(/<\/?body>\s*/gi, '')
    .replace(/<meta charset="utf-8">\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '').replace(title, '').replace(/^\s+/, '');
  fs.writeFileSync(path.join(out, 'artifact', page), art);
  console.log(`dist/cutscene/${page} ${Math.round(html.length / 1024)}KB (글꼴 조각 ${kept}개, ${Math.round(bytes / 1024)}KB)`);
}
