/* 스터디 프로모션 서비스 워커: 앱 파일을 저장해 두고 오프라인에서도 열리게 한다 */
const CACHE = 'studypromotion-v39';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './fonts/pretendard/pretendard.css',
  './manifest.webmanifest',
  './js/srs.js',
  './js/stats.js',
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
  './js/cloud.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선(최신 버전), 실패하면 저장본 — 오프라인에서도 동작
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 브라우저 HTTP 캐시를 건너뛰고 서버에 새 버전이 있는지 매번 확인한다
  const fresh = req.mode === 'navigate'
    ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')))
  );
});
