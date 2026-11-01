// ============================================
// Barra Fit 360 — Service Worker (PWA)
// Estrategia: red primero, caché como respaldo (offline).
// Las APIs (/api) NUNCA se cachean aquí: los datos para vender sin internet los guarda
// app3.js (catálogo en localStorage, ventas pendientes en la tablet).
// ============================================

const CACHE_NAME = 'barrafit360-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Además del shell, se guardan los archivos que usa la página (app3.js?v=…, index.css?v=…,
// vendor/…), leyéndolos del propio index.html: así la app abre sin internet aunque cambien
// las versiones, sin tener que actualizar esta lista en cada subida.
async function guardarArchivosDeLaPagina(cache) {
  try {
    const res = await fetch('./index.html', { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();
    const rutas = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|png|json)(?:\?[^"]*)?)"/g)) rutas.add('./' + m[1].replace(/^\.?\//, ''));
    await Promise.all([...rutas].map(r => cache.add(r).catch(() => {})));
  } catch (e) { /* sin red: se guardarán al usarse */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL).then(() => guardarArchivosDeLaPagina(cache)))
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
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => {
        // Sin red: navegaciones → la página guardada; archivos → su copia guardada.
        if (req.mode === 'navigate') {
          return caches.match(req, { ignoreSearch: true })
            .then((cached) => cached || caches.match('./index.html'))
            .then((cached) => cached || caches.match('./'));
        }
        return caches.match(req).then((cached) => cached || Response.error());
      })
  );
});
