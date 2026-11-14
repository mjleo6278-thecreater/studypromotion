/* 스터디 프로모션 서비스 워커: 앱 파일을 한 벌 저장해 두고, 앱을 켤 때 저장본에서 바로 연다.
 * - 인터넷을 기다리지 않으니 시작이 빠르고(폰의 시작 화면이 짧아짐) 오프라인에서도 열린다.
 * - 새 버전: 아래 CACHE 이름이 바뀐 sw.js가 배포되면 브라우저가 알아채고 새 파일을 통째로 받아 둔 뒤
 *   앱이 새로고침된다(쓰는 중이면 '새 버전' 안내 띠). 그래서 배포할 때마다 CACHE 버전을 꼭 올린다.
 *   (tools/build.js가 배포본의 CACHE 이름 끝에 파일 내용 해시를 붙여, 깜빡해도 새 파일이 전달되게 한다.)
 */
const CACHE = 'studypromotion-v49';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './fonts/pretendard/pretendard.css',
  './manifest.webmanifest',
  './js/srs.js',
  './js/stats.js',
  './js/schedule.js',
  './js/store.js',
  './js/scope.js',
  './js/share.js',
  './js/ui.js',
  './js/app.js',
  './js/backup.js',
  './js/egg.js',
  './js/board.js',
  './js/lock.js',
  './js/stopwatch.js',
  './js/timetable.js',
  './js/events.js',
  './js/aicore.js',
  './js/ai.js',
  './js/cloud.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

const FONT_CACHE = 'studypromotion-fonts-v1'; // 글꼴 파일(바뀌지 않음)은 버전과 상관없이 오래 둔다

self.addEventListener('install', (e) => {
  // 브라우저 HTTP 캐시를 건너뛰고 서버의 최신 파일로 한 벌을 받는다 (옛 파일이 섞이지 않게)
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 받아 와서 저장해 두기 (실패한 응답은 저장하지 않음)
function fetchAndKeep(req, cacheName) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(req, copy));
    }
    return res;
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 앱 열기(페이지): 저장해 둔 index.html을 바로 — 없을 때만 네트워크
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html', { cacheName: CACHE })
        .then((hit) => hit || fetchAndKeep(req, CACHE))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // 글꼴 조각: 한 번 받으면 계속 저장본
  if (/\/fonts\/.+\.woff2$/.test(url.pathname)) {
    e.respondWith(caches.match(req, { cacheName: FONT_CACHE }).then((hit) => hit || fetchAndKeep(req, FONT_CACHE)));
    return;
  }
  // 나머지 앱 파일: 저장본 먼저, 없으면 받아서 저장
  e.respondWith(
    caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || fetchAndKeep(req, CACHE))
  );
});
