/**
 * Service Worker: macht den zweiten Aufruf praktisch sofort.
 *
 * - index.html: "stale while revalidate" - sofort aus dem Cache liefern, im
 *   Hintergrund die neue Version holen. Beim nächsten Start ist sie da.
 * - Daten-Dateien und alles andere: nur durchreichen (siehe unten).
 *
 * Wichtig: Die Seite bricht laufende Downloads ab, sobald sie genug Treffer
 * hat. Ein solcher Abbruch sieht für den Worker wie ein fehlgeschlagener
 * Request aus. Ohne Fehlerbehandlung meldet der Browser dann
 * "A ServiceWorker intercepted the request and encountered an unexpected
 * error" - deshalb fängt der Handler jeden Fehler ab und antwortet mit einer
 * leeren Response, statt das Versprechen scheitern zu lassen.
 */

const CACHE = 'lpf-v3';

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
      .then((keys) => {
        const host = new URL(self.location.href).hostname;
        const lokal = host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
        return Promise.all(
          keys.filter((k) => lokal || k !== CACHE).map((k) => caches.delete(k)),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // z. B. zu lichess.org

  // Auf dem eigenen Testserver wird nichts zwischengespeichert. localhost
  // gilt als sichere Herkunft, dieser Worker laeuft also auch dort - und
  // dann sieht man beim Testen eine alte Seite, ohne es zu merken.
  const host = new URL(self.location.href).hostname;
  if (host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host)) return;

  // Seitenaufruf: sofort aus dem Cache, im Hintergrund auffrischen.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(CACHE);
          const fresh = fetch(request)
            .then((res) => {
              if (res.ok) cache.put(request, res.clone()).catch(() => {});
              return res;
            })
            .catch(() => null);
          const cached = await cache.match(request);
          if (cached) return cached;
          const res = await fresh;
          return res || new Response('Offline', { status: 503 });
        } catch {
          return new Response('Offline', { status: 503 });
        }
      })(),
    );
    return;
  }

  // Daten und Icon: bewusst NICHTintercepten.
  //
  // Die Seite bricht laufende Downloads ab, sobald sie genug Treffer hat, und
  // lädt viele Buckets gleichzeitig vor. Ein Service Worker dazwischen meldet
  // solche Abbrüche als "encountered an unexpected error" - der Browser zeigt
  // dann Fehler in der Konsole an, obwohl die Suche korrekt war. Für die
  // Wiederholung einer Suche reicht der normale HTTP-Cache der Daten-Dateien
  // (GitHub Pages liefert sie mit Cache-Control aus), und der Abbruch landet
  // dort, wo er hingehört: in der Seite.
});
