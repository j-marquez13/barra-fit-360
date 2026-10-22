// ============================================
// Barra Fit 360 — Service Worker (PWA)
// Estrategia: red primero, caché como respaldo (offline).
// Las APIs (/api) NUNCA se cachean para evitar datos viejos o sensibles.
// ============================================

const CACHE_NAME = 'barrafit360-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // No interceptar: APIs (siempre en vivo) ni dominios externos (fuentes/CDN).
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => {
        // Solo en navegaciones se devuelve el shell como respaldo offline.
        if (req.mode === 'navigate') {
          return caches.match(req).then((cached) => cached || caches.match('./index.html'));
        }
        return caches.match(req);
      })
  );
});
