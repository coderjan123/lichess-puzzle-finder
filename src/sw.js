/**
 * Service Worker: macht den zweiten Aufruf praktisch sofort.
 *
 * - index.html: "stale while revalidate" - sofort aus dem Cache liefern, im
 *   Hintergrund die neue Version holen. Beim nächsten Start ist sie da.
 * - data/*: dauerhaft im Cache. Die Dateien ändern sich nur mit einem neuen
 *   Build; dann ändert sich auch CACHE (siehe unten), also liefert der Worker
 *   nie veraltete Daten.
 * - Alles andere (Favicon): nur durchreichen.
 */

const CACHE = 'lpf-v2';

const SHELL = ['./', './index.html', './sw.js', './icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // z. B. zu lichess.org

  // Seitenaufruf: sofort aus dem Cache, im Hintergrund auffrischen.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const fresh = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fresh;
        return res || new Response('Offline', { status: 503 });
      })(),
    );
    return;
  }

  // Daten und Icon: aus dem Cache, sonst holen und ablegen.
  if (url.pathname.includes('/data/') || url.pathname.endsWith('/icon.svg')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const res = await fetch(request);
        // Nur kleine Dateien cachen - ein 1,3-MB-Bucket gehört nicht in den
        // Cache-Speicher des Browsers, der normalerweise bei ein paar MB endet.
        if (res.ok && url.pathname.includes('/data/')) {
          const len = Number(res.headers.get('content-length') || '0');
          if (!len || len < 400_000) cache.put(request, res.clone());
        }
        return res;
      })(),
    );
  }
});
