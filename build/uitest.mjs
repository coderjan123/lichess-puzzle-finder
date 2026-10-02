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

step('9 · Reload: aus der Adresse und aus dem Speicher');
// Nach einer Suche steht die Auswahl in der Adresse. Ein Reload fuehrt deshalb
// direkt zur Liste, ohne weiteren Klick.
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#viewResults:not([hidden])');
const perUrl = await page.$$eval('#resultList .id', (n) => n.map((x) => x.textContent.trim()).join(','));
perUrl === easyList.map((x) => x.id).join(',')
  ? ok(`Reload aus der Adresse zeigt dieselbe Liste (${easyList.length} IDs)`)
  : bad('Reload aus der Adresse zeigt eine andere Liste');

// Ohne Zustand in der Adresse bleibt die zuletzt gesuchte Liste im Speicher
// und wird angeboten.
await page.goto(BASE, { waitUntil: 'load' });
await waitForApp(page);
await page.waitForSelector('#resumeCard:not([hidden])', { timeout: 30000 });
ok(`Angeboten: ${(await page.locator('#resumeTitle').textContent()).trim()} · ${(await page.locator('#resumeInfo').textContent()).trim()}`);
await page.click('#resumeBtn');
await page.waitForSelector('#viewResults:not([hidden])');
const resumed = await page.$$eval('#resultList li', (n) => n.length);
resumed === easyList.length ? ok(`Liste aus dem Speicher wiederhergestellt (${resumed} Zeilen)`) : bad(`nur ${resumed} Zeilen`);
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

step('13 · Suchzustand in der Adresse');
{
  const ictx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ip = await ictx.newPage();
  ip.setDefaultTimeout(90_000);
  const consoleBefore = consoleErrors.length;

  await ip.goto(BASE, { waitUntil: 'load' });
  await waitForApp(ip);

  // Auswahl über die Oberfläche zusammenstellen
  for (const t of ['mateIn3', 'attraction']) {
    await ip.fill('#themeSearch', t);
    await ip.locator(`#themeList .chip[data-theme="${t}"]`).click();
  }
  await ip.fill('#themeSearch', '');
  await ip.click('#modeSeg button[data-v="AND"]');
  await ip.fill('#count', '25');

  const hash = await ip.evaluate(() => location.hash);
  const hatAll = /t=mateIn3,attraction/.test(hash) && /m=AND/.test(hash) && /n=25/.test(hash);
  hatAll
    ? ok(`Adresse enthält den Zustand: ${hash}`)
    : bad(`Adresse unvollständig: ${hash}`);

  // Reload: das Formular muss wiederhergestellt sein
  await ip.reload({ waitUntil: 'load' });
  await waitForApp(ip);
  const restored = await ip.evaluate(() => ({
    themes: [...document.querySelectorAll('#themeList .chip.on')].map((c) => c.dataset.theme).join(','),
    mode: document.querySelector('#modeSeg button.on')?.dataset.v,
    count: document.getElementById('count').value,
  }));
  restored.themes === 'mateIn3,attraction' && restored.mode === 'AND' && restored.count === '25'
    ? ok(`Reload stellt wieder her: ${restored.themes} · ${restored.mode} · ${restored.count}`)
    : bad(`Reload unvollständig: ${JSON.stringify(restored)}`);

  // Suchen und die Ergebnis-Adresse prüfen
  await ip.click('#searchBtn');
  await ip.waitForSelector('#viewResults:not([hidden])');
  const idsLocal = await ip.$$eval('#resultList .id', (ns) => ns.map((n) => n.textContent.trim()));
  const erwartet = (
    await runQuery(
      manifest,
      { themes: ['mateIn3', 'attraction'], mode: 'AND', order: 'hardest', min: 0, max: 9999, count: 25 },
      {},
    )
  ).items.map((x) => x.id);
  idsLocal.join() === erwartet.join()
    ? ok(`Ergebnisliste stimmt mit dem Daten-Reader überein (${idsLocal.length} IDs)`)
    : bad(`Ergebnisliste weicht ab: ${idsLocal.slice(0, 3)} …`);
  /#\/results\?t=mateIn3,attraction/.test(await ip.evaluate(() => location.hash))
    ? ok('Ergebnis-Adresse trägt denselben Zustand')
    : bad(`Ergebnis-Adresse: ${await ip.evaluate(() => location.hash)}`);

  // Kopierknopf
  await ip.click('#copyLink');
  await ip.waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 20000 });
  const toastLink = ((await ip.textContent('#toast')) || '').trim();
  /Link copied/.test(toastLink)
    ? ok(`Meldung: "${toastLink}"`)
    : bad(`unerwartete Meldung: "${toastLink}"`);

  // Zurück / vorwärts
  await ip.click('#backBtn');
  await ip.waitForSelector('#viewHome:not([hidden])');
  const backThemes = await ip.evaluate(() =>
    [...document.querySelectorAll('#themeList .chip.on')].map((c) => c.dataset.theme).join(','),
  );
  backThemes === 'mateIn3,attraction'
    ? ok('Zurück: Auswahl bleibt erhalten')
    : bad(`Zurück: Auswahl verloren (${backThemes || 'leer'})`);
  await ip.goForward();
  await ip.waitForSelector('#viewResults:not([hidden])');
  ok(`Adresse nach "vorwärts": ${await ip.evaluate(() => location.hash)}`);
  (await ip.locator('#resultList li').count()) === 25
    ? ok('Vorwärts: Liste wieder da')
    : bad('Vorwärts: Liste fehlt');

  const shareUrl = await ip.evaluate(() => location.href);

  // Geteilter Link in einem frischen Fenster: Liste ohne Klick
  const ip2 = await ictx.newPage();
  ip2.setDefaultTimeout(90_000);
  await ip2.goto(shareUrl, { waitUntil: 'load' });
  try {
    await ip2.waitForSelector('#viewResults:not([hidden])', { timeout: 60_000 });
    const idsShared = await ip2.$$eval('#resultList .id', (ns) => ns.map((n) => n.textContent.trim()));
    idsShared.join() === erwartet.join()
      ? ok(`Geteilter Link zeigt dieselbe Liste ohne Klick (${idsShared.length} IDs)`)
      : bad(`Geteilter Link zeigt eine andere Liste: ${idsShared.slice(0, 3).join(' ')} …`);
  } catch {
    // Zustand ausgeben, statt nur "fehlt" zu melden - sonst ist die Ursache
    // beim nächsten Lauf nicht sichtbar.
    const zustand = await ip2
      .evaluate(() => ({
        hash: location.hash,
        ergebnisse: !document.getElementById('viewResults').hidden,
        zeilen: document.querySelectorAll('#resultList li').length,
        chips: document.querySelectorAll('#themeList .chip').length,
        busy: !document.getElementById('loading').hidden,
      }))
      .catch(() => ({ fehler: 'Seite nicht erreichbar' }));
    bad(`Geteilter Link zeigt die Liste nicht von selbst: ${JSON.stringify(zustand)}\n     gelesene Adresse: ${shareUrl}`);
  }
  await ip2.close();

  // Absichtlich kaputte Adresse: darf nichts zerschießen
  const ip3 = await ictx.newPage();
  ip3.setDefaultTimeout(90_000);
  await ip3.goto(BASE + '#/home?t=gibtsnicht,mateIn3&m=QUATSCH&o=range&r=9999-100&n=abc', {
    waitUntil: 'load',
  });
  await waitForApp(ip3);
  const kaputt = await ip3.evaluate(() => ({
    themes: [...document.querySelectorAll('#themeList .chip.on')].map((c) => c.dataset.theme).join(','),
    mode: document.querySelector('#modeSeg button.on')?.dataset.v,
    order: document.querySelector('#orderSeg button.on')?.dataset.v,
    count: document.getElementById('count').value,
    min: document.getElementById('minRating').value,
    max: document.getElementById('maxRating').value,
    bereit: !document.getElementById('statusCard').hidden === false,
  }));
  kaputt.themes === 'mateIn3' && kaputt.mode === 'OR' && kaputt.order === 'range' && kaputt.count === '100'
    ? ok(`Kaputte Adresse landet in Standardwerten: ${kaputt.themes} · ${kaputt.mode} · ${kaputt.order} · ${kaputt.count} · ${kaputt.min}-${kaputt.max}`)
    : bad(`Kaputte Adresse falsch aufgelöst: ${JSON.stringify(kaputt)}`);
  await ip3.close();

  await ictx.close();
  const neuErrors = consoleErrors.length - consoleBefore;
  neuErrors === 0
    ? ok('keine Konsolenfehler in der Adressen-Prüfung')
    : bad(`${neuErrors} Konsolenfehler: ${consoleErrors.slice(consoleBefore, consoleBefore + 3).join(' | ')}`);
}

step('14 · Spielzahl: Reihenfolge und Schwelle');
{
  const sctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sp = await sctx.newPage();
  sp.setDefaultTimeout(90_000);
  await sp.goto(BASE, { waitUntil: 'load' });
  await waitForApp(sp);

  await sp.fill('#themeSearch', 'mateIn3');
  await sp.locator('#themeList .chip[data-theme="mateIn3"]').click();
  await sp.fill('#themeSearch', '');

  // "Meistgeloest zuerst"
  await sp.click('#orderSeg button[data-v="solved"]');
  const erwartetSolv = (
    await runQuery(manifest, { themes: ['mateIn3'], mode: 'OR', order: 'solved', min: 0, max: 9999, count: 30 }, {})
  ).items;
  await sp.fill('#count', '30');
  await sp.click('#searchBtn');
  await sp.waitForSelector('#viewResults:not([hidden])');
  const istSolv = await sp.$$eval('#resultList .id', (n) => n.map((x) => x.textContent.trim()));
  istSolv.join() === erwartetSolv.map((x) => x.id).join()
    ? ok(`"Most solved first" liefert dieselbe Liste wie der Reader (${istSolv.length} IDs)`)
    : bad(`"Most solved first" weicht ab: ${istSolv.slice(0, 3).join(' ')} …`);

  // Die Spielzahl steht in der Zeile und ist nicht leer.
  const anzeigen = await sp.$$eval('#resultList .solv', (n) => n.map((x) => x.textContent.trim()));
  anzeigen.length === 30 && anzeigen.every((t) => t.length > 0)
    ? ok(`Spielzahl in jeder Zeile, z. B. ${anzeigen.slice(0, 4).join(' · ')}`)
    : bad(`Spielzahl fehlt: ${JSON.stringify(anzeigen.slice(0, 4))}`);
  /^~[\d.]/.test(anzeigen[0] || '')
    ? ok('mit "~" gekennzeichnet (die Kodierung ist logarithmisch)')
    : bad(`keine Kennzeichnung als Näherung: "${anzeigen[0]}"`);

  // Schwelle
  await sp.click('#backBtn');
  await sp.waitForSelector('#viewHome:not([hidden])');
  await sp.click('#solvSeg button[data-s="10000"]');
  const erwartetSchwelle = (
    await runQuery(manifest, { themes: ['mateIn3'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 30, minSolv: 10000 }, {})
  ).items;
  await sp.click('#orderSeg button[data-v="hardest"]');
  await sp.click('#searchBtn');
  await sp.waitForSelector('#viewResults:not([hidden])');
  const istSchwelle = await sp.$$eval('#resultList .id', (n) => n.map((x) => x.textContent.trim()));
  istSchwelle.join() === erwartetSchwelle.map((x) => x.id).join()
    ? ok(`Schwelle "10,000+" liefert dieselbe Liste wie der Reader (${istSchwelle.length} IDs)`)
    : bad(`Schwelle weicht ab: ${istSchwelle.slice(0, 3).join(' ')} …`);

  // Und sie steht in der Adresse, damit die Suche teilbar bleibt.
  /v=10000/.test(await sp.evaluate(() => location.hash))
    ? ok('Schwelle steht in der Adresse')
    : bad(`Adresse ohne Schwelle: ${await sp.evaluate(() => location.hash)}`);

  // Schwelle in einem frischen Fenster
  const mitSchwelle = await sp.evaluate(() => location.href);
  const sp2 = await sctx.newPage();
  sp2.setDefaultTimeout(90_000);
  await sp2.goto(mitSchwelle, { waitUntil: 'load' });
  await sp2.waitForSelector('#viewResults:not([hidden])', { timeout: 60_000 });
  const ausNeu = await sp2.$$eval('#resultList .id', (n) => n.map((x) => x.textContent.trim()));
  ausNeu.join() === istSchwelle.join()
    ? ok('Geteilter Link behält die Schwelle und zeigt dieselbe Liste')
    : bad('Geteilter Link zeigt eine andere Liste');
  await sp2.close();
  await sctx.close();
}

step('15 · Deutsche Suchbegriffe und Mate-Hinweis');
{
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const dp = await dctx.newPage();
  dp.setDefaultTimeout(90_000);
  await dp.goto(BASE, { waitUntil: 'load' });
  await waitForApp(dp);

  // Wer "matt" tippt, muss die Matt-Motive finden - das war der Name vor dem
  // Sprachwechsel und ist fuer viele die natuerlichere Eingabe.
  const erwartet = [
    ['matt', 'mateIn1'],
    ['matt in 1', 'mateIn1'],
    ['matt in 5', 'mateIn5'],
    ['MATT IN 2', 'mateIn2'],
    ['hinlenkung', 'attraction'],
    ['ablenkung', 'deflection'],
    ['gabel', 'fork'],
    ['blockade', 'interference'],
    ['abzugscheck', 'discoveredCheck'],
    ['röntgen', 'xRayAttack'],
    ['rontgen', 'xRayAttack'], // ohne Umlaut
    ['durchstoß', 'skewer'],
    ['rochade', 'castling'],
    ['großmeister', 'superGM'],
    ['eröffnung', 'opening'],
    ['taktik', 'fork'], // Rubrik, nicht Einzelsuche
    ['endspiel', 'endgame'],
    ['mate in 3', 'mateIn3'],
    ['fork', 'fork'],
  ];
  let falsch = 0;
  for (const [begriff, theme] of erwartet) {
    await dp.fill('#themeSearch', begriff);
    await dp.waitForTimeout(90);
    const gefunden = await dp.$$eval(
      '#themeList .chip',
      (ns) => ns.map((x) => x.dataset.theme),
    );
    if (gefunden.includes(theme)) continue;
    falsch++;
    console.log(`  FEHLER "${begriff}" findet ${theme} nicht (nur: ${gefunden.slice(0, 4).join(', ')})`);
  }
  falsch === 0
    ? ok(`${erwartet.length} deutsche und englische Suchbegriffe treffen das richtige Theme`)
    : bad(`${falsch} von ${erwartet.length} Begriffen treffen nicht`);

  // "matt" muss die ganze Gruppe zeigen, nicht nur ein Theme.
  await dp.fill('#themeSearch', 'matt');
  await dp.waitForTimeout(90);
  const mattTreffer = await dp.$$eval('#themeList .chip', (ns) => ns.map((x) => x.dataset.theme));
  mattTreffer.length >= 20 && mattTreffer.includes('mate') && mattTreffer.includes('mateIn5')
    ? ok(`"matt" zeigt ${mattTreffer.length} Matt-Themes inklusive "Mate (any)" und "Mate in 5"`)
    : bad(`"matt" zeigt nur ${mattTreffer.length} Themes`);

  // Mate-Hinweis
  await dp.fill('#themeSearch', 'matt in 1');
  await dp.locator('#themeList .chip[data-theme="mateIn1"]').click();
  await dp.fill('#themeSearch', '');
  await dp.waitForFunction(() => !document.getElementById('mateHint').hidden, null, { timeout: 15_000 });
  const hinweis = ((await dp.textContent('#mateHint')) || '').trim();
  /exactly 1 move/.test(hinweis) && /Mate \(any\)/.test(hinweis)
    ? ok(`Hinweis erscheint: "${hinweis.slice(0, 72)}…"`)
    : bad(`Hinweis fehlt oder ist falsch: "${hinweis}"`);
  await dp.screenshot({ path: `${shots}/11-mate-hinweis.png` });

  await dp.click('#mateHint button');
  await dp.waitForFunction(
    () => {
      const an = [...document.querySelectorAll('#themeList .chip.on')].map((x) => x.dataset.theme);
      return an.length === 1 && an[0] === 'mate';
    },
    null,
    { timeout: 15_000 },
  );
  ok('Knopf im Hinweis wählt "Mate (any)" statt "Mate in 1"');
  await dp.waitForFunction(() => document.getElementById('mateHint').hidden, null, { timeout: 15_000 });
  ok('Hinweis verschwindet wieder');

  // Und "Mate (any)" liefert tatsächlich Matt in 1 bis 5.
  await dp.fill('#count', '100');
  await dp.click('#searchBtn');
  await dp.waitForSelector('#viewResults:not([hidden])');
  const ids = await dp.$$eval('#resultList .id', (ns) => ns.map((x) => x.textContent.trim()));
  const alle = new Set(
    (
      await runQuery(manifest, { themes: ['mate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 100 }, {})
    ).items.map((x) => x.id),
  );
  ids.join() === [...alle].join()
    ? ok(`"Mate (any)" liefert ${ids.length} Puzzles wie der Reader`)
    : bad('"Mate (any)" weicht vom Reader ab');
  await dctx.close();
}

step('16 · QR-Code der Adresse');
{
  const qctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const qp = await qctx.newPage();
  qp.setDefaultTimeout(90_000);
  await qp.goto(BASE, { waitUntil: 'load' });
  await waitForApp(qp);

  // Der Decoder wird nur fuer diesen Test in die Seite geladen - die Website
  // selbst braucht ihn nicht.
  await qp.addScriptTag({ path: path.join(repo, 'node_modules', 'jsqr', 'dist', 'jsQR.js') });

  const liesCode = () =>
    qp.evaluate(async () => {
      const svg = document.querySelector('#qrCode svg');
      if (!svg) return { fehler: 'kein SVG' };
      const vb = svg.viewBox.baseVal;
      const rand = 4; // ruhrand, siehe qrSvg()
      // Kantenlaenge aus dem Pfad ableiten: groesster Modulindex + rand*2
      const pfad = svg.querySelector('path').getAttribute('d');
      const teile = pfad.match(/M(-?[\d.]+) (-?[\d.]+)h1v1h-1z/g) || [];
      const module = new Set();
      for (const t of teile) {
        const m = /M(-?[\d.]+) (-?[\d.]+)/.exec(t);
        module.add(`${parseFloat(m[1]) - rand},${parseFloat(m[2]) - rand}`);
      }
      // Kantenlaenge direkt aus der ViewBox: das ist die Modulzahl plus der
      // Ruhezone an beiden Seiten.
      const size = Math.round(vb.width) - rand * 2;
      const skala = 6;
      const kanten = (size + rand * 2) * skala;
      const canvas = document.createElement('canvas');
      canvas.width = kanten;
      canvas.height = kanten;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, kanten, kanten);
      ctx.fillStyle = '#000';
      for (const t of teile) {
        const m = /M(-?[\d.]+) (-?[\d.]+)/.exec(t);
        const x = (parseFloat(m[1])) * skala;
        const y = (parseFloat(m[2])) * skala;
        ctx.fillRect(x, y, skala, skala);
      }
      const bild = ctx.getImageData(0, 0, kanten, kanten);
      const treffer = window.jsQR(bild.data, kanten, kanten);
      return {
        groesse: size,
        module: module.size,
        erwartet: size * size,
        gelesen: treffer ? treffer.data : null,
        jetzt: location.href,
        anzeige: document.getElementById('qrUrl').textContent,
      };
    });

  (await qp.locator('#qrBtn').isVisible())
    ? ok('QR-Knopf oben rechts sichtbar')
    : bad('QR-Knopf fehlt');
  const box = await qp.locator('#qrBtn').boundingBox();
  box && box.width >= 40 && box.height >= 40
    ? ok(`Tippfläche ${Math.round(box.width)}×${Math.round(box.height)} px`)
    : bad(`Tippfläche zu klein: ${JSON.stringify(box)}`);

  await qp.click('#qrBtn');
  await qp.waitForSelector('#qrOverlay:not([hidden])');
  await qp.waitForTimeout(150);
  await qp.screenshot({ path: `${shots}/12-qr-start.png` });

  let r = await liesCode();
  r.gelesen === r.jetzt
    ? ok(`Code wird gelesen und ergibt genau die Adresse (Version ${r.groesse}x${r.groesse}, ${r.module} von ${r.erwartet} Modulen dunkel)`)
    : bad(`Code ergibt "${r.gelesen}" statt "${r.jetzt}"`);
  r.anzeige === r.jetzt
    ? ok('Adresse steht als Text daneben')
    : bad(`Text daneben weicht ab: "${r.anzeige}"`);
  r.module < r.erwartet
    ? ok('Finder-, Zeit- und Ausrichtungsmuster vorhanden (nicht alle Module dunkel)')
    : bad('verdächtig: jedes zweite Modul ist dunkel');

  await qp.keyboard.press('Escape');
  await qp.waitForSelector('#qrOverlay', { state: 'hidden' });
  ok('Escape schließt');

  // Auf der Ergebnisliste muss der Code die Liste zeigen, nicht die Startseite.
  await qp.fill('#themeSearch', 'mateIn3');
  await qp.locator('#themeList .chip[data-theme="mateIn3"]').click();
  await qp.fill('#themeSearch', '');
  await qp.fill('#count', '42');
  await qp.click('#searchBtn');
  await qp.waitForSelector('#viewResults:not([hidden])');
  await qp.click('#qrBtn');
  await qp.waitForSelector('#qrOverlay:not([hidden])');
  await qp.waitForTimeout(150);
  await qp.screenshot({ path: `${shots}/13-qr-ergebnis.png` });

  r = await liesCode();
  r.gelesen === r.jetzt && /#\/results\?t=mateIn3/.test(r.gelesen || '')
    ? ok(`Code zeigt die Ergebnisliste: ${r.gelesen}`)
    : bad(`Code zeigt "${r.gelesen}" statt der Ergebnisliste`);

  await qp.mouse.click(4, 4);
  await qp.waitForSelector('#qrOverlay', { state: 'hidden' });
  ok('Klick daneben schließt');
  await qctx.close();
}

step('17 · Konsole');
const realErrors = consoleErrors.filter((e) => !/favicon|Content-Security|net::ERR_FILE/i.test(e));
realErrors.length === 0 ? ok('keine Konsolenfehler') : bad(`Konsolenfehler: ${realErrors.slice(0, 5).join(' | ')}`);

await browser.close();

console.log(`\n${problems.length === 0 ? 'ALLES GRÜN' : problems.length + ' PROBLEME'}`);
console.log(`Screenshots: ${shots}`);
process.exit(problems.length ? 1 : 0);
