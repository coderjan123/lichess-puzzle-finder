#!/usr/bin/env node
/**
 * Prüft die zwei Dinge, an denen man beim localen Testen und beim Anmelden
 * schon gescheitert ist.
 *
 *   node build/anmeldetest.mjs [--live]
 *
 * 1. **Keine alte Seite auf localhost.** localhost gilt als sichere Herkunft,
 *    ein Service Worker läuft also auch beim Testen. Vorher hat er jede
 *    Navigation gecacht und alte Fassungen ausgeliefert - vier Fehler waren
 *    behoben und es war nichts davon zu sehen. Der Test legt deshalb einen
 *    Köder in den Cache, lädt die Seite neu und prüft, dass der Köder
 *    nicht wieder ausgeliefert wird.
 *
 * 2. **Die Anmelde-URL wird von lichess angenommen.** Gemessen wird nur der
 *    erste Aufruf (ohne sich anzumelden): 303 auf die Anmeldeseite heisst
 *    "Parameter in Ordnung", 400 heisst "abgelehnt". Genau daran ist es
 *    gescheitert: `scope=opening_explorer` gibt 400, und ohne scope 303.
 *
 * Ohne `--live` wird nichts ins Netz geschickt; dann wird nur geprüft, ob
 * die Seite ein Log-in anbietet und die Gründe benennt.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { startServer } from './serve.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(hier, '..');
const live = process.argv.includes('--live');

const probleme = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  probleme.push(msg);
  console.log(`  FEHLER ${msg}`);
};
const step = (msg) => console.log(`\n== ${msg}`);

// ------------------------------------------------------------------ 1 Cache

step('1 · localhost liefert keine alte Seite');

const { port } = await startServer({ port: 0, root: path.join(repo, 'docs') });
const browser = await firefox.launch({ headless: true });
const kontext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-GB' });
const seite = await kontext.newPage();
seite.setDefaultTimeout(30_000);

await seite.goto(`http://127.0.0.1:${port}/board.html`, { waitUntil: 'load' });
await seite.waitForSelector('.feld');

// Den echten sw.js anmelden - ein Worker aus einem Blob darf Firefox nicht -
// und danach einen "alten Stand" in seinen Cache legen. Genau so sah es aus:
// der Worker lieferte beim naechsten Aufruf die alte Datei aus dem Cache.
await seite.evaluate(async () => {
  await navigator.serviceWorker.register('./sw.js', { scope: './' });
});
await seite
  .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 })
  .catch(() => {});
await seite.evaluate(async () => {
  const cache = await caches.open('lpf-v3');
  await cache.put(
    new URL('./board.html', location.href).href,
    new Response('<!doctype html><html><body>ALTER STAND</body></html>', {
      headers: { 'content-type': 'text/html' },
    }),
  );
});

// Jetzt neu laden - mit einem aktiven Worker im Weg.
await seite.reload({ waitUntil: 'load' });
await seite.waitForTimeout(1200);
const koeder = await seite.evaluate(() => document.body.innerText.slice(0, 40));
const felder = await seite.locator('.feld').count();

if (koeder.includes('ALTER STAND')) {
  bad('der alte Stand wird immer noch ausgeliefert - so war der Fehler sichtbar');
} else if (felder !== 64) {
  bad(`die Seite ist unvollständig: ${felder} Felder statt 64`);
} else {
  ok(`die Seite ist echt (64 Felder), nicht der alte Stand ("${koeder.trim().slice(0, 22)}…")`);
}

const reste = await seite.evaluate(async () => ({
  worker: (await navigator.serviceWorker.getRegistrations()).length,
  caches: (await caches.keys()).length,
}));
reste.worker === 0
  ? ok('kein Service Worker mehr angemeldet')
  : bad(`${reste.worker} Service Worker noch angemeldet`);
reste.caches === 0 ? ok('keine Caches mehr') : bad(`${reste.caches} Caches noch da: ${reste.caches}`);

// Und noch einmal laden, damit sicher ist, dass es stabil bleibt.
await seite.reload({ waitUntil: 'load' });
await seite.waitForTimeout(800);
(await seite.locator('.feld').count()) === 64
  ? ok('auch beim zweiten Laden ist die Seite frisch')
  : bad('beim zweiten Laden kommt wieder Altes');

// ------------------------------------------------------------------ 2 Anmeldung

step('2 · Anmeldung');

const knopfSichtbar = await seite.locator('#explorerAnmelden').isVisible();
const hinweis = (await seite.locator('#explorerZeilen').textContent()).trim();
knopfSichtbar
  ? ok('das Fenster bietet "Log in with lichess" an')
  : bad('es gibt keinen Log-in-Knopf');
/Log in/i.test(hinweis)
  ? ok(`und sagt, was ohne Anmeldung fehlt: "${hinweis.slice(0, 50)}"`)
  : bad(`unklarer Text in der Datenbank: "${hinweis.slice(0, 70)}"`);

if (!live) {
  console.log('\n  --    Netzanfrage übersprungen (mit --live prüfen)');
} else {
  // Die URL im Test gebaut - unabhaengig vom Modul, damit der Weg geprueft
  // wird und nicht die eigene Abstraktion.
  const crypto = await import('node:crypto');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const weiterleitung = `http://127.0.0.1:${port}/board.html`;
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: '127.0.0.1',
    redirect_uri: weiterleitung,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: 'pruefung',
    scope: 'email:read',
  });
  const antwort = await fetch(`https://lichess.org/oauth?${p}`, {
    redirect: 'manual',
    headers: { 'user-agent': 'Mozilla/5.0 Firefox/130' },
  });
  const ort = antwort.headers.get('location');
  antwort.status === 303 && ort && ort.includes('/login')
    ? ok(`lichess nimmt die Anfrage an (303 auf ${ort.split('?')[0]}) - scope email:read ist gueltig`)
    : bad(`lichess lehnt die Anfrage ab: HTTP ${antwort.status}${ort ? ` → ${ort.slice(0, 80)}` : ''}`);

  // Und zum Vergleich: die beiden Varianten, die es nicht gibt.
  for (const scope of ['opening_explorer', 'opening_explorer:read']) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: '127.0.0.1',
      redirect_uri: weiterleitung,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state: 'pruefung',
      scope,
    });
    const r = await fetch(`https://lichess.org/oauth?${q}`, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 Firefox/130' },
    });
    r.status === 400
      ? ok(`"${scope}" wird abgelehnt (400) - das war der Fehler, und ist damit festgenagelt`)
      : bad(`"${scope}" wird angenommen (HTTP ${r.status}) - dann war es nicht die Ursache`);
  }
}

await browser.close();

console.log('');
if (probleme.length) {
  console.log(`${probleme.length} PROBLEME`);
  for (const p of probleme) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Alles grün.');