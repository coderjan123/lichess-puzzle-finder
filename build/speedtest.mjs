#!/usr/bin/env node
/**
 * Misst, wie lange der Weg vom Klick bis zur Ergebnisliste dauert - mit
 * künstlich verlangsamter Leitung, die ein altes Handy im schlechten WLAN
 * nachbildet.
 *
 * Simuliert werden zwei Dinge, die Playwright für Firefox nicht direkt
 * drosseln kann:
 *   - Wartezeit pro Request (Round-Trip)
 *   - Übertragungszeit, abhängig von der Antwortgröße
 *
 * Profile:
 *   schnell  80 ms RTT, ~4 Mbit/s   (gutes WLAN)
 *   mittel  180 ms RTT, ~1 Mbit/s   (normales WLAN)
 *   langsam 320 ms RTT, ~380 kbit/s (altes Handy, schlechtes Netz)
 *
 *   node build/speedtest.mjs [--profile langsam] [--szenario and]
 */

import { firefox } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const docsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');

const PROFILES = {
  schnell: { rtt: 80, bps: 4_000_000, label: 'gutes WLAN' },
  mittel: { rtt: 180, bps: 1_000_000, label: 'normales WLAN' },
  langsam: { rtt: 320, bps: 380_000, label: 'altes Handy, schlechtes Netz' },
};

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const profileName = arg('profile', 'langsam');
const profile = PROFILES[profileName];
if (!profile) {
  console.error(`Unbekanntes Profil. Verfügbar: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}

/** Die Suche, um die es geht: UND, schwerste zuerst, 100 Puzzles. */
const SCENARIOS = {
  and: {
    name: 'Matt in 3 \u2229 Heranziehen \u00b7 UND \u00b7 schwerste zuerst \u00b7 100',
    themes: ['mateIn3', 'attraction'],
    mode: 'AND',
    order: 'hardest',
    count: 100,
  },
  and2: {
    name: 'Matt in 3 \u2229 Abzugscheck \u00b7 UND \u00b7 schwerste zuerst \u00b7 100',
    themes: ['mateIn3', 'discoveredCheck'],
    mode: 'AND',
    order: 'hardest',
    count: 100,
  },
  and3: {
    name: 'Matt in 3 \u2229 Blockade \u00b7 UND \u00b7 schwerste zuerst \u00b7 100',
    themes: ['mateIn3', 'interference'],
    mode: 'AND',
    order: 'hardest',
    count: 100,
  },
  single: {
    name: 'Matt in 3 \u00b7 schwerste zuerst \u00b7 100',
    themes: ['mateIn3'],
    mode: 'OR',
    order: 'hardest',
    count: 100,
  },
  or: {
    name: 'Matt in 3 \u222a Heranziehen \u00b7 ODER \u00b7 schwerste zuerst \u00b7 100',
    themes: ['mateIn3', 'attraction'],
    mode: 'OR',
    order: 'hardest',
    count: 100,
  },
};
const scenarioName = arg('szenario', 'and');
const scenario = SCENARIOS[scenarioName];
if (!scenario) {
  console.error(`Unbekanntes Szenario. Verfügbar: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}

const LIMIT_MS = Number(arg('limit', 3000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = await startServer({ port: 0, root: docsDir });
const base = `http://127.0.0.1:${srv.port}/`;

const browser = await firefox.launch();
// Der Service Worker wird blockiert: Requests, die er selbst stellt, umgehen
// die Verlangsamung unten und der Test würde zu schön aussehen.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // typisches Handy
  deviceScaleFactor: 2,
  serviceWorkers: 'block',
});
const page = await context.newPage();

// Antworten werden aus dem docs/-Verzeichnis gelesen und selbst ausgeliefert.
// Grund: Playwright liefert Responses bereits dekomprimiert - würde man die
// Übertragungszeit auf diese Bytes rechnen, wären alle Werte um das
// Kompressionsverhältnis (~4,5x) zu pessimistisch. Hier wird gezählt, was
// tatsächlich über die Leitung geht: die .gz-Dateien so, wie sie auf der
// Platte liegen, Textdateien als gzip (wie es GitHub Pages auch tut).
const cache = new Map();
const stats = { requests: 0, wireBytes: 0, paths: [] };
const load = (rel) => {
  if (cache.has(rel)) return cache.get(rel);
  const clean = rel === '/' ? '/index.html' : rel;
  const file = path.join(docsDir, decodeURIComponent(clean.replace(/^\//, '')));
  let body;
  let type;
  try {
    body = fs.readFileSync(file);
    type = clean.endsWith('.svg')
      ? 'image/svg+xml'
      : clean.endsWith('.json')
        ? 'application/json'
        : clean.endsWith('.js')
          ? 'text/javascript'
          : 'text/html; charset=utf-8';
  } catch {
    cache.set(rel, null);
    return null;
  }
  if (clean.endsWith('.tsv.gz')) {
    // Bereits komprimiert: genau diese Bytes gehen raus.
    const entry = { body, type: 'application/gzip', wire: body.length };
    cache.set(rel, entry);
    return entry;
  }
  // Textdateien werden unkomprimiert ausgeliefert (Playwright wertet
  // content-encoding beim fulfill nicht aus), die Wartezeit aber aus der
  // gzip-Größe berechnet - das ist die Größe, die ein echter Server
  // (GitHub Pages, nginx) tatsächlich überträgt.
  const gz = body.length > 512 ? gzipSync(body, { level: 6 }).length : body.length;
  const entry = { body, type, wire: gz };
  cache.set(rel, entry);
  return entry;
};

// Geteilte Leitung: die Antworten laufen zwar gleichzeitig an, teilen sich aber
// dieselbe Bandbreite. Ohne das waere der Test zu optimistisch - 14 Dateien
// gleichzeitig waeren so billig wie die groesste davon.
let freeAt = 0;

/** Wartezeit einer Antwort auf einer gemeinsam genutzten Leitung. */
function schedule(wire) {
  const duration = (wire / profile.bps) * 1000;
  const start = Math.max(Date.now() + profile.rtt, freeAt);
  freeAt = start + duration;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, start + duration - Date.now())));
}

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(base).origin) return route.continue();
  const entry = load(url.pathname);
  if (!entry) return route.fulfill({ status: 404, body: 'not found' });
  await schedule(entry.wire);
  stats.requests += 1;
  stats.wireBytes += entry.wire;
  stats.paths.push(`${url.pathname} ${entry.wire}`);
  await route.fulfill({
    status: 200,
    headers: { 'content-type': entry.type },
    body: entry.body,
  });
});

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('console: ' + m.text());
});

// --- Kaltstart: Seite laden, bedienbar machen -------------------------------
const tPage = Date.now();
await page.goto(base, { waitUntil: 'load' });
// "bedienbar" = Index geladen, Theme-Liste gefüllt, Suchknopf aktiviert,
// sobald ein Theme gewählt ist.
await page.waitForFunction(() => document.getElementById('statusCard').hidden, null, {
  timeout: 60000,
});
await page.waitForFunction(
  () => document.querySelectorAll('#themeList .chip').length > 10,
  null,
  { timeout: 60000 },
);
const tReady = Date.now() - tPage;
const shellBytes = stats.wireBytes;
const shellRequests = stats.requests;

// --- Suche wie ein Mensch: Theme eintippen, klicken, suchen ------------------
for (const t of scenario.themes) {
  await page.fill('#themeSearch', t);
  const node = page.locator(`#themeList .chip[data-theme="${t}"]`);
  await node.waitFor({ state: 'visible', timeout: 15000 });
  await node.click();
}
await page.fill('#themeSearch', '');
if (scenario.mode === 'AND') await page.click('#modeSeg button[data-v="AND"]');
await page.click(`#orderSeg button[data-v="${scenario.order}"]`);
await page.fill('#count', String(scenario.count));

const estimate = await page.textContent('#estimate');
const tQuery0 = Date.now();
const predicted = await page.evaluate(() => document.getElementById('estimate').textContent);
void tQuery0;

const tClick = Date.now();
await page.click('#searchBtn');
await page.waitForSelector('#viewResults:not([hidden])', { timeout: 60000 });
const tResults = Date.now() - tClick;

const count = await page.locator('#resultList li').count();
const first = count ? await page.locator('#resultList li a').first().getAttribute('href') : '-';
const toastText = await page.textContent('#toast');

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
const biggest = stats.paths
  .map((line) => {
    const i = line.lastIndexOf(' ');
    return [line.slice(0, i), Number(line.slice(i + 1))];
  })
  .sort((a, b) => b[1] - a[1]);

console.log(`\nProfil "${profileName}" (${profile.label}): ${profile.rtt} ms Wartezeit, ${(profile.bps / 1000).toFixed(0)} kbit/s`);
console.log(`Szenario: ${scenario.name}\n`);
console.log(`  Seite bedienbar        ${String(tReady).padStart(6)} ms   ${kb(shellBytes)} in ${shellRequests} Requests`);
console.log(`  Klick → Ergebnisliste  ${String(tResults).padStart(6)} ms   ${kb(stats.wireBytes - shellBytes)} in ${stats.requests - shellRequests} Requests`);
console.log(`\n  Treffer: ${count}   erstes: ${first}`);
console.log(`  Meldung: ${toastText}`);
console.log(`  Anzeige vor dem Klick: "${(estimate || '').trim()}"`);
console.log('  Requests der Suche:');
for (const line of stats.paths.slice(shellRequests)) {
  const i = line.lastIndexOf(' ');
  console.log(`    ${kb(Number(line.slice(i + 1))).padStart(9)}  ${line.slice(0, i)}`);
}
if (pageErrors.length) {
  console.log('\n  FEHLER in der Konsole:');
  for (const e of [...new Set(pageErrors)]) console.log(`    ${e}`);
}

const ok = tReady + tResults < LIMIT_MS && count > 0 && pageErrors.length === 0;
console.log(
  `\n  ${ok ? 'ERGEBNIS: bestanden' : 'ERGEBNIS: NICHT bestanden'} - ` +
    `bedienbar + Ergebnisliste = ${tReady + tResults} ms (Grenze ${LIMIT_MS} ms)\n`,
);

await context.close();
await browser.close();
await new Promise((r) => srv.server.close(r));
process.exit(ok ? 0 : 1);
