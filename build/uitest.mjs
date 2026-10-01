#!/usr/bin/env node
/**
 * UI-Test mit echtem Browser (Playwright/Firefox).
 *
 *   node build/uitest.mjs [--headed]
 *
 * Geprüft wird:
 *   1. Startseite lädt den Index, alle 73 Themes sind wählbar
 *   2. Suche liefert exakt dieselben Puzzle-IDs wie der Daten-Reader
 *   3. UND-Suche, Rating-Range, Anzahl, Themesuche
 *   4. Jede Ergebniszeile verlinkt auf lichess.org/training/<ID> in einem
 *      neuen Tab, "IDs kopieren" liefert die ID-Liste
 *   5. Reload: die letzte Suche wird wieder angeboten
 *   6. Hinweis bei file://, damit niemand die Datei per Doppelklick öffnet
 *   7. Desktop-Ansicht, keine Konsolenfehler
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const shots = '/tmp/opencode/shots';
fs.mkdirSync(shots, { recursive: true });

const problems = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  problems.push(msg);
  console.log(`  FEHLER ${msg}`);
};
const step = (msg) => console.log(`\n== ${msg}`);

const { port } = await startServer({ port: 0, root: path.join(repo, 'docs') });
process.env.LPF_BASE = `http://127.0.0.1:${port}/`;
const BASE = `http://127.0.0.1:${port}/`;
// reader.js liest LPF_BASE beim Import, darum erst jetzt der dynamische Import.
const { runQuery } = await import('../src/reader.js');
const manifest = await (await fetch(BASE + 'data/manifest.json')).json();

const browser = await firefox.launch({ headless: !process.argv.includes('--headed') });

/// Zurück bis zur Startseite (die Historie kann mehrere Ebenen tief sein).
async function goHome(page) {
  for (let i = 0; i < 4; i++) {
    if (await page.locator('#viewHome').isVisible()) return;
    await page.click('.topbar .icon-btn');
    await page.waitForTimeout(200);
  }
  if (!(await page.locator('#viewHome').isVisible())) throw new Error('Startseite nicht erreicht');
}

async function search(page, { theme, themes, count, mode, order, min, max }) {
  await goHome(page);
  await page.click('#clearThemes');
  for (const t of themes ?? [theme]) await page.click(`.chip[data-theme="${t}"]`);
  if (mode && (themes ?? [theme]).length > 1) await page.click(`#modeSeg button[data-v="${mode}"]`);
  if (order) await page.click(`#orderSeg button[data-v="${order}"]`);
  if (min !== undefined) {
    await page.fill('#minRating', String(min));
    await page.fill('#maxRating', String(max));
  }
  await page.fill('#count', String(count));
  await page.click('#searchBtn');
  await page.waitForSelector('#viewResults:not([hidden])', { timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 120000 });
  return page.$$eval('#resultList li', (nodes) =>
    nodes.map((n) => ({
      id: n.querySelector('.id').textContent,
      rating: Number(n.querySelector('.rating').textContent),
    })),
  );
}

// ------------------------------------------------------------------ Tests

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'de-DE',
  hasTouch: true,
});
const page = await ctx.newPage();
page.setDefaultTimeout(90_000); // Rechner kann gerade belegt sein
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

/**
 * Wartet, bis die App bereit ist: Index geladen, Theme-Liste gefüllt.
 * Nicht auf Sichtbarkeit einer Klasse warten - das ist unter Last unzuverlässig.
 */
async function waitForApp(p) {
  await p.waitForFunction(
    () => document.querySelectorAll('#themeList .chip').length > 10,
    null,
    { timeout: 90_000 },
  );
}

step('1 · Startseite');
await page.goto(BASE, { waitUntil: 'load' });
await waitForApp(page);
const chipCount = await page.locator('.chip').count();
const themeCount = Object.keys(manifest.themes).length;
chipCount === themeCount ? ok(`${chipCount} Themes angezeigt`) : bad(`${chipCount} statt ${themeCount} Themes`);
(await page.locator('#statusCard').isHidden()) ? ok('Index geladen') : bad('Ladeanzeige bleibt sichtbar');
ok(`Kopfzeile: ${(await page.locator('#topMeta').textContent()).trim()}`);
await page.screenshot({ path: `${shots}/01-start.png`, fullPage: true });

step('2 · Theme suchen und auswählen');
await page.fill('#themeSearch', 'mate in');
await page.waitForTimeout(150);
const filtered = await page.locator('.chip').count();
filtered > 0 && filtered < themeCount ? ok(`Suche filtert (${filtered} Treffer)`) : bad(`Filter funktioniert nicht (${filtered})`);
await page.fill('#themeSearch', '');
await page.click('.chip[data-theme="mateIn2"]');
await page.click('.chip[data-theme="backRankMate"]');
(await page.locator('#modeCard').isVisible()) ? ok('UND/ODER-Karte erscheint bei 2 Themes') : bad('UND/ODER-Karte fehlt');
await page.click('#modeSeg button[data-v="AND"]');
const hint = await page.locator('#modeHint').textContent();
hint.includes('all of the selected themes') ? ok(`Hinweis: "${hint.trim()}"`) : bad('Hinweis falsch');
ok(`Datenschätzung: ${(await page.locator('#estimate').textContent()).trim()}`);

step('3 · Suche (ODER, schwerste zuerst)');
await page.click('#modeSeg button[data-v="OR"]');
await page.click('.chip[data-theme="backRankMate"]');
await page.fill('#count', '25');
await page.click('#searchBtn');
await page.waitForSelector('#viewResults:not([hidden])', { timeout: 60000 });
const ids = await page.$$eval('#resultList li', (nodes) => nodes.map((n) => n.querySelector('.id').textContent));
const expected = await runQuery(manifest, { themes: ['mateIn2'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 25 }, {});
ids.length === expected.items.length && ids.every((v, i) => v === expected.items[i].id)
  ? ok(`25 Treffer, identisch zum Daten-Reader (${ids[0]} … ${ids[24]})`)
  : bad(`Treffer weichen ab: ${ids.slice(0, 3)} vs ${expected.items.slice(0, 3).map((x) => x.id)}`);
ok(`Ergebniszeile: ${(await page.locator('#resultInfo').textContent()).replace(/\s+/g, ' ').trim().slice(0, 80)}`);
await page.screenshot({ path: `${shots}/02-ergebnis.png`, fullPage: true });

step('4 · Links auf lichess');
const links = await page.$$eval('#resultList li a', (nodes) =>
  nodes.map((n) => ({ href: n.getAttribute('href'), target: n.getAttribute('target'), rel: n.getAttribute('rel') })),
);
const wanted = 'https://lichess.org/training/';
const hrefOk = links.length === 25 && links.every((l, i) => l.href === wanted + ids[i]);
const targetOk = links.every((l) => l.target === '_blank' && (l.rel || '').includes('noopener'));
hrefOk ? ok(`25 Zeilen verlinken auf ${wanted}<ID>`) : bad('Links falsch: ' + JSON.stringify(links.slice(0, 2)));
targetOk ? ok('neuer Tab + noopener gesetzt') : bad('target/rel falsch');

// Der erste Link muss auch wirklich zu lichess führen (nur HEAD, kein Spielstart).
const first = await page.getAttribute('#resultList li:first-child a', 'href');
const head = await fetch(first, { redirect: 'manual' });
head.status < 400 ? ok(`Link erreichbar (HTTP ${head.status})`) : bad(`Link antwortet mit ${head.status}`);

step('5 · IDs kopieren');
// Firefox erlaubt keine Clipboard-Berechtigungen über CDP; deshalb wird der
// Inhalt abgefangen, indem der Klick in einen eigenen Kanal umgeleitet wird.
await page.evaluate(() => {
  window.__copied = null;
  navigator.clipboard.writeText = async (text) => {
    window.__copied = text;
  };
});
await page.click('#copyIds');
await page.waitForFunction(() => window.__copied !== null, null, { timeout: 5000 });
const clip = await page.evaluate(() => window.__copied);
const lines = clip.split('\n').filter(Boolean);
lines.length === 25 && lines[0] === ids[0] && lines[24] === ids[24]
  ? ok(`IDs kopiert: ${lines.length} Stück, ${lines[0]} … ${lines[24]}`)
  : bad(`kopierte Liste falsch: ${lines.length} Einträge, Anfang ${lines[0]}`);
(await page.locator('#toast').isVisible()) ? ok('Rückmeldung sichtbar') : bad('keine Rückmeldung nach dem Kopieren');

step('6 · UND-Suche');
const andList = await search(page, { themes: ['mateIn2', 'backRankMate'], count: 10, mode: 'AND' });
const andExpected = await runQuery(manifest, { themes: ['mateIn2', 'backRankMate'], mode: 'AND', order: 'hardest', min: 0, max: 9999, count: 10 }, {});
andList.length === andExpected.items.length && andList.length > 0 && andList.every((x, i) => x.id === andExpected.items[i].id)
  ? ok(`UND-Treffer korrekt: ${andList.map((x) => x.id).join(' ')}`)
  : bad(`UND-Treffer weichen ab: ${andList.map((x) => x.id)}`);

step('7 · Rating-Range');
const rangeList = await search(page, { theme: 'mateIn2', count: 15, order: 'range', min: 1000, max: 1100 });
const inRange = rangeList.every((x) => x.rating >= 1000 && x.rating <= 1100);
inRange && rangeList.length === 15
  ? ok(`15 Treffer, alle im Fenster 1000–1100`)
  : bad(`Range-Ergebnis falsch: ${rangeList.length} Treffer, ${inRange ? 'Fenster ok' : 'außerhalb'}`);

step('8 · einfachste zuerst / unbekanntes Theme');
const easyList = await search(page, { theme: 'mateIn2', count: 20, order: 'easiest' });
const asc = easyList.every((x, i) => i === 0 || x.rating >= easyList[i - 1].rating);
asc && easyList.length === 20 ? ok('einfachste zuerst liefert aufsteigende Ratings') : bad('Reihenfolge falsch');

step('9 · Reload: letzte Suche');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#resumeCard:not([hidden])', { timeout: 30000 });
ok(`Angeboten: ${(await page.locator('#resumeTitle').textContent()).trim()} · ${(await page.locator('#resumeInfo').textContent()).trim()}`);
await page.click('#resumeBtn');
await page.waitForSelector('#viewResults:not([hidden])');
const resumed = await page.$$eval('#resultList li', (n) => n.length);
resumed === easyList.length ? ok(`Liste wiederhergestellt (${resumed} Zeilen)`) : bad(`nur ${resumed} Zeilen`);
await page.click('#resumeDrop').catch(() => {});

step('10 · Hinweis bei file://');
const fileCtx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const filePage = await fileCtx.newPage();
filePage.setDefaultTimeout(90_000);
await filePage.goto('file://' + path.join(repo, 'docs', 'index.html'));
await filePage.waitForTimeout(400);
(await filePage.locator('#fileHint').isVisible())
  ? ok('Dateiaufruf zeigt Anleitung statt leerer Seite')
  : bad('kein file://-Hinweis sichtbar');
await filePage.screenshot({ path: `${shots}/09-datei-hinweis.png` });
await fileCtx.close();

step('11 · Desktop-Ansicht');
const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'de-DE' });
const desk = await deskCtx.newPage();
desk.setDefaultTimeout(90_000);
await desk.goto(BASE, { waitUntil: 'load' });
await waitForApp(desk);
await desk.screenshot({ path: `${shots}/06-desktop.png` });
await desk.click('.chip[data-theme="fork"]');
await desk.fill('#count', '50');
await desk.click('#searchBtn');
await desk.waitForSelector('#viewResults:not([hidden])', { timeout: 60000 });
await desk.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
const deskRows = await desk.locator('#resultList li').count();
deskRows === 50 ? ok('Desktop: 50 Zeilen') : bad(`Desktop: ${deskRows} Zeilen`);
await desk.screenshot({ path: `${shots}/07-desktop-ergebnis.png` });

step('12 · Unmögliche UND-Kombination');
{
  // mateIn2 und mateIn3 kommen in den Daten nie gemeinsam vor. Die Website
  // soll das vorab sagen und keine Daten laden.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const p2 = await ctx2.newPage();
  p2.setDefaultTimeout(90_000);
  await p2.goto(BASE, { waitUntil: 'load' });
  await waitForApp(p2);

  for (const t of ['mateIn2', 'mateIn3']) {
    await p2.fill('#themeSearch', t);
    await p2.locator(`#themeList .chip[data-theme="${t}"]`).click();
  }
  await p2.fill('#themeSearch', '');
  await p2.click('#modeSeg button[data-v="AND"]');
  await p2.waitForFunction(() => document.querySelector('#modeHint').textContent.includes('never occur together'), null, {
    timeout: 10000,
  });
  ok('Warnung erscheint: UND-Kombination ohne gemeinsame Puzzles');

  const estimate = await p2.textContent('#estimate');
  /0 results/.test(estimate || '')
    ? ok(`Anzeige nennt 0 Treffer: "${(estimate || '').trim()}"`)
    : bad(`Anzeige ohne Treffer-Hinweis: "${(estimate || '').trim()}"`);

  let dataRequests = 0;
  p2.on('request', (r) => {
    if (r.url().includes('/data/')) dataRequests++;
  });
  await p2.click('#searchBtn');
  await p2.waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 20000 });
  const toast2 = await p2.textContent('#toast');
  await p2.waitForTimeout(300);
  dataRequests === 0
    ? ok('keine einzige Datendatei geladen')
    : bad(`${dataRequests} Datendateien geladen, obwohl 0 Treffer möglich sind`);
  /0 results/.test(toast2 || '')
    ? ok(`Meldung: "${(toast2 || '').trim()}"`)
    : bad(`unerwartete Meldung: "${(toast2 || '').trim()}"`);
  await p2.screenshot({ path: `${shots}/10-unmoegliche-kombi.png` });
  await ctx2.close();
}

step('13 · Konsole');
const realErrors = consoleErrors.filter((e) => !/favicon|Content-Security|net::ERR_FILE/i.test(e));
realErrors.length === 0 ? ok('keine Konsolenfehler') : bad(`Konsolenfehler: ${realErrors.slice(0, 5).join(' | ')}`);

await browser.close();

console.log(`\n${problems.length === 0 ? 'ALLES GRÜN' : problems.length + ' PROBLEME'}`);
console.log(`Screenshots: ${shots}`);
process.exit(problems.length ? 1 : 0);
