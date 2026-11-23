// 컷씬 고화질 영상 뽑기: 프레임을 무손실 PNG로 찍어 ffmpeg에 바로 넣고(디스크에 프레임을 쌓지 않음) 소리를 붙인다.
// 사용법 (저장소 루트를 http://127.0.0.1:8765 로 띄운 상태): NODE_PATH=$(npm root -g) node tools/export-cutscene.js out.mp4 390 844 3 60 [t0 t1] [crf]
// 예: 390×844 화면을 3배 → 1170×2532, 60fps. 32초에 약 10분.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
(async () => {
  const [out, w, h, dpr, fps] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6]];
  const crf = process.argv[9] || '17';
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:8765/cutscene/index.html?still');
  await p.waitForFunction(() => window.Cutscene);
  await p.evaluate(() => document.fonts.ready);
  const dur = await p.evaluate(() => window.Cutscene.duration);
  const t0 = process.argv[7] ? +process.argv[7] : 0, t1 = process.argv[8] ? +process.argv[8] : dur;
  const full = t0 === 0 && t1 === dur;
  const tmp = out + '.video.mp4';
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', crf, '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps), tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((t1 - t0) * fps);
  const start = Date.now();
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fps;
    await p.evaluate((t) => window.Cutscene.renderAt(t), t);
    const buf = await p.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`frames ${n} in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  // 소리: 같은 일정을 오프라인으로 만들어 구간만 잘라 붙인다
  const a = await p.evaluate(() => window.Cutscene.renderAudio());
  fs.writeFileSync(out + '.wav', Buffer.from(a.b64, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-ss', String(t0), '-t', String(t1 - t0), '-i', out + '.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  fs.unlinkSync(tmp); fs.unlinkSync(out + '.wav');
  console.log('audio peak', a.peak.toFixed(3), 'full', full, 'errors', errs.join(' | ') || 'none');
  await b.close();
})();
