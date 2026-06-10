const CACHE = 'backend-handbook-v1';
const ASSETS = [
  'index.html',
  'shared.css',
  'shared.js',
  'manifest.json',
  'backend-fundamentals.html',
  'api-design.html',
  'database-engineering.html',
  'backend-performance.html',
  'caching-guide.html',
  'authentication-security.html',
  'message-queues.html',
  'distributed-systems.html',
  'microservices.html',
  'observability.html',
  'production-engineering.html',
  'senior-engineer-roadmap.html',
  'interview-guide.html',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.document) return caches.match('index.html');
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
