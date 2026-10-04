#!/usr/bin/env node
/**
 * Test für die Brettseite (Playwright/Firefox).
 *
 *   node build/bretttest.mjs [--headed]
 *
 * Geprüft wird, was ein Nutzer tatsächlich tut: antippen, ziehen, zurück,
 * Brett drehen, Stellung eintippen, Umbau wählen. Dazu die Eigenschaften,
 * die stillschweigend kaputtgehen: ein illegaler Zug darf nichts tun, ein
 * Feld muss auf dem Handy mindestens 46 px groß sein, und nach jedem Zug
 * muss die Algebraische Notation das sagen, was der Zuggenerator geliefert
 * hat - nicht was man selbst geraten hat.
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
const BASE = `http://127.0.0.1:${port}/board.html`;

// Die Regelmaschine als unabhaengige Quelle fuer die Erwartungen.
const { parseFen, legalMoves, moveFrom, moveToUci, moveToSan, toFen, parseSquare } = await import('../src/chess.js');

/** SAN, die unser Generator fuer den naechsten Zug nennt (rein lesend). */
function erwarteterZug(fen, uci) {
  const pos = parseFen(fen);
  const zug = legalMoves(pos).find((m) => moveToUci(m) === uci);
  return zug === undefined ? null : moveToSan(pos, zug);
}

const browser = await firefox.launch({ headless: !process.argv.includes('--headed') });
// WICHTIG: hasTouch nicht einschalten. Mit aktiviertem Touch erzeugt
// Playwrights page.mouse KEINE Pointer-Events - die Maus laeuft dann nur an
// pointerdown vorbei, und man prueft eine Bedienung, die es so nicht gibt.
// Fuer den Fingerweg gibt es einen eigenen Kontext weiter unten.
const kontext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'en-GB',
});
const seite = await kontext.newPage();
seite.setDefaultTimeout(30_000);
const konsolenfehler = [];
seite.on('console', (m) => {
  if (m.type() === 'error') konsolenfehler.push(m.text());
});
seite.on('pageerror', (e) => konsolenfehler.push(String(e)));

/** Feld über seinen Namen finden - "e2" ist Feld 12, egal ob gedreht. */
async function feld(page, name) {
  const i = await page.evaluate((n) => {
    // Beschriftung zuerst: die stimmt immer, auch wenn das Brett gedreht ist.
    const felder = [...document.querySelectorAll('.feld')];
    const treffer = felder.find((f) => f.getAttribute('aria-label')?.endsWith(`on ${n}`));
    if (treffer) return Number(treffer.dataset.i);
    const datei = n.charCodeAt(0) - 97;
    const rang = Number(n[1]);
    const zeile = 8 - rang;
    const brettIndex = datei + zeile * 8;
    const gedreht = document.querySelector('.feld[data-i="0"] .koordinate.reihe').textContent === 'h';
    return gedreht ? 63 - brettIndex : brettIndex;
  }, name);
  const box = await page.locator(`.feld[data-i="${i}"]`).boundingBox();
  return { i, box };
}

/**
 * Brett in eine bekannte Lage drehen.
 *
 * Ohne das wird jeder weitere Schritt davon abhaengig, was der vorherige
 * gelassen hat - und nach einem Drehen liegen die Felder an anderen
 * Stellen. Ecke oben links ist genau dann "a", wenn nicht gedreht ist.
 */
async function dreheAuf(page, gedreht) {
  for (let i = 0; i < 3; i++) {
    const istGedreht = await page.evaluate(
      () => document.querySelector('.feld[data-i="0"] .koordinate.reihe').textContent === 'h',
    );
    if (istGedreht === gedreht) return;
    await page.click('#btnDrehen');
    await page.waitForTimeout(140);
  }
}

/** Zwei Felder nacheinander antippen (die Art, die man einhändig bedient). */
async function tippeZug(page, von, nach) {
  const a = await feld(page, von);
  const b = await feld(page, nach);
  await page.mouse.click(a.box.x + a.box.width / 2, a.box.y + a.box.height / 2);
  await page.waitForTimeout(60);
  await page.mouse.click(b.box.x + b.box.width / 2, b.box.y + b.box.height / 2);
  await page.waitForTimeout(80);
}

// ------------------------------------------------------------------ 1 laden

step('1 · Seite lädt');
await seite.goto(BASE, { waitUntil: 'load' });
await seite.waitForSelector('.feld', { timeout: 20_000 });

const felder = await seite.locator('.feld').count();
felder === 64 ? ok('64 Felder') : bad(`${felder} Felder statt 64`);

const sprite = await seite.locator('#sprite symbol').count();
sprite === 12 ? ok('12 Figuren im Sprite') : bad(`${sprite} Figuren statt 12`);

const figuren = await seite.locator('.feld .figur use').count();
figuren === 32 ? ok('32 Figuren auf dem Brett') : bad(`${figuren} Figuren statt 32`);

// Die Figuren muessen auch wirklich eine Form haben, nicht nur ein Element.
const pfadSichtbar = await seite.evaluate(() => {
  const u = document.querySelector('.feld .figur use');
  if (!u) return false;
  const ziel = document.querySelector(u.getAttribute('href'));
  return Boolean(ziel && ziel.querySelector('path'));
});
pfadSichtbar ? ok('Figuren haben eine Form (Pfad vorhanden)') : bad('Figur ohne Pfad');

// ------------------------------------------------------------------ 2 Tippen

step('2 · Zug durch Antippen');
const sanE4 = erwarteterZug('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4');
await tippeZug(seite, 'e2', 'e4');
let zuege = await seite.locator('#zuege button').allTextContents();
zuege[0] === sanE4
  ? ok(`Notation wie der Generator: "${zuege[0]}"`)
  : bad(`Notation "${zuege[0]}" statt "${sanE4}"`);

const stand = await seite.locator('#stand').textContent();
stand.trim() === '1/1' ? ok('Stand 1/1') : bad(`Stand "${stand}" statt 1/1`);

const feldE4 = await seite.locator('.feld.besetzt, .feld').nth(0);
await seite.screenshot({ path: `${shots}/20-brett.png`, fullPage: true });

// Der Zug muss auch in der FEN stehen - das ist der Weg, ueber den die
// Seite zurueckgesetzt wird.
const fenNach = await seite.locator('#fen').inputValue();
toFen(parseFen(fenNach)) === fenNach
  ? ok(`FEN stimmt: ${fenNach}`)
  : bad(`FEN kaputt: ${fenNach}`);

// ------------------------------------------------------------------ 3 illegal

step('3 · Ein illegaler Zug tut nichts');
const vorher = await seite.locator('#fen').inputValue();
// Nach dem weissen Zug ist Schwarz am Zug. Ein weisses Bauer darf sich jetzt
// nicht bewegen lassen - er wird gar nicht erst als auswählbar erkannt.
const d2 = await feld(seite, 'd2');
const d4 = await feld(seite, 'd4');
await seite.mouse.click(d2.box.x + d2.box.width / 2, d2.box.y + d2.box.height / 2);
await seite.waitForTimeout(60);
const gewaehltNachWeiss = await seite.locator('.feld.gewaehlt').count();
await seite.mouse.click(d4.box.x + d4.box.width / 2, d4.box.y + d4.box.height / 2);
await seite.waitForTimeout(80);
const nachher = await seite.locator('#fen').inputValue();
nachher === vorher && gewaehltNachWeiss === 0
  ? ok('Weiß kann nicht zweimal ziehen, das Feld wird gar nicht erst ausgewählt')
  : bad(`Nach dem Klick hat sich etwas bewegt: ${nachher} (Auswahl: ${gewahltNachWeiss})`);

// Und jetzt der Gegenbeweis: Schwarz ist dran, da geht es.
await tippeZug(seite, 'e7', 'e5');
const schwarzZog = await seite.locator('#fen').inputValue();
/4p3/.test(schwarzZog) && schwarzZog.includes(' b ') === false
  ? ok('Schwarz zieht, sobald Schwarz dran ist')
  : bad(`Schwarz kam nicht dran: ${schwarzZog}`);

await seite.click('#btnNeu');
await seite.waitForTimeout(100);

// e2 nach e5 geht nicht: zwei Felder ueberspringen kann ein Bauer nicht.
await tippeZug(seite, 'e2', 'e5');
const nachSprung = await seite.locator('#fen').inputValue();
nachSprung === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  ? ok('Zwei-Felder-Sprung abgelehnt')
  : bad(`Bauer durfte zwei Felder springen: ${nachSprung}`);
await seite.click('#btnNeu');
await seite.waitForTimeout(100);

// ------------------------------------------------------------------ 4 Ziehen

step('4 · Zug durch Ziehen');
const g1 = await feld(seite, 'g1');
const f3 = await feld(seite, 'f3');
await seite.mouse.move(g1.box.x + g1.box.width / 2, g1.box.y + g1.box.height / 2);
await seite.mouse.down();
await seite.mouse.move(f3.box.x + f3.box.width / 2, f3.box.y + f3.box.height / 2, { steps: 12 });
await seite.mouse.up();
await seite.waitForTimeout(120);
zuege = await seite.locator('#zuege button').allTextContents();
zuege[0] === 'Nf3' ? ok('Ziehen ergibt denselben Zug wie Antippen') : bad(`Nach dem Ziehen: "${zuege[0]}"`);
await seite.screenshot({ path: `${shots}/21-brett-nach-zug.png`, fullPage: true });

// ------------------------------------------------------------------ 5 Auswahl

step('5 · Mögliche Züge werden angezeigt');
// Offenes Brett mit einer Dame: die Zahl der Markierungen wird aus dem
// Zuggenerator geholt, nicht geraten.
const offen = '7k/8/8/3Q4/8/8/8/7K w - - 0 1';
await seite.fill('#fen', offen);
await seite.click('#btnSetzen');
await seite.waitForTimeout(120);
const d5 = await feld(seite, 'd5');
await seite.mouse.click(d5.box.x + d5.box.width / 2, d5.box.y + d5.box.height / 2);
await seite.waitForTimeout(120);
// Nur die Zuege der Dame zaehlen - nicht alle Zuege der Partie, denn der
// weisse Koenig hat noch drei eigene.
const dame = parseSquare('d5');
const zuegeDame = legalMoves(parseFen(offen)).filter((m) => moveFrom(m) === dame).length;
const hinweise = await seite.locator('.feld .hinweis').count();
hinweise === zuegeDame
  ? ok(`${zuegeDame} Markierungen, genau so viele wie der Zuggenerator findet`)
  : bad(`${hinweise} Markierungen statt ${zuegeDame}`);
const ringe = await seite.locator('.feld.besetzt .hinweis').count();
const posOffen = parseFen(offen);
const schlagt = legalMoves(posOffen).filter((m) => {
  const uci = moveToUci(m);
  return posOffen.board[parseSquare(uci.slice(2, 4))] !== 0;
}).length;
ringe === schlagt
  ? ok(`${ringe} Ringe um besetzte Felder - so viele Schlagziele gibt es wirklich`)
  : bad(`${ringe} Ringe statt ${schlagt}`);
await seite.screenshot({ path: `${shots}/22-auswahl.png`, fullPage: true });
await seite.click('#btnNeu');
await seite.waitForTimeout(100);

// ------------------------------------------------------------------ 6 Zurueck

step('6 · Zurück und Springen');
await tippeZug(seite, 'e2', 'e4');
await tippeZug(seite, 'e7', 'e5');
await seite.click('#btnZurueck');
await seite.waitForTimeout(80);
let text = (await seite.locator('#zuege button').allTextContents()).filter((t) => t.trim());
text.length === 1 && text[0] === 'e4'
  ? ok('Ein Zug zurückgenommen')
  : bad(`Nach Rückgängig: ${JSON.stringify(text)}`);
const fenNachUndo = await seite.locator('#fen').inputValue();
fenNachUndo.includes('4p3') === false
  ? ok('der schwarze Bauer ist wieder auf e7')
  : bad(`FEN nach Rückgängig: ${fenNachUndo}`);

await seite.click('#btnStart');
await seite.waitForTimeout(150);
const standAnfang = (await seite.locator('#stand').textContent()).trim();
standAnfang === '0/1' ? ok('Sprung zum Anfang') : bad(`Sprung zum Anfang: Stand "${standAnfang}" statt 0/1`);
const fenStart = await seite.locator('#fen').inputValue();
fenStart === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  ? ok('Startstellung wiederhergestellt')
  : bad(`FEN am Anfang: ${fenStart}`);
await seite.click('#btnEnd');
await seite.waitForTimeout(80);

// Klick auf einen Zug in der Liste springt dorthin.
await seite.locator('#zuege button').nth(0).click();
await seite.waitForTimeout(80);
(await seite.locator('#stand').textContent()).trim() === '1/1'
  ? ok('Klick auf "e4" in der Liste springt dorthin')
  : bad('Klick in der Liste sprang nicht');

// ------------------------------------------------------------------ 7 Drehen

step('7 · Brett drehen');
// Beim Drehen wird die Ecke oben links zur Ecke unten rechts. Ihre
// Beschriftung muss mitgehen - und zwar die des Quadrats, das dort liegt.
const eckeObenLinks = async () =>
  seite.evaluate(() => {
    const f = document.querySelector('.feld[data-i="0"]');
    return `${f.querySelector('.koordinate.reihe').textContent}${f.querySelector('.koordinate.spalte').textContent}`;
  });
const k0 = await eckeObenLinks();
await seite.click('#btnDrehen');
await seite.waitForTimeout(150);
const k1 = await eckeObenLinks();
const belegt = await seite.locator('.feld[data-i="0"]').getAttribute('aria-label');
k0 === 'a8' && k1 === 'h1' && belegt === 'white rook on h1'
  ? ok(`Ecke oben links: "${k0}" → "${k1}", dort liegt der weiße Turm von h1`)
  : bad(`Drehen: Ecke "${k0}" → "${k1}", Inhalt "${belegt}"`);
const dreimal = await seite.evaluate(() => {
  const f = document.querySelector('.feld');
  return getComputedStyle(f).backgroundColor;
});
dreimal ? ok(`Felder eingefärbt (${dreimal})`) : bad('Hintergrundfarbe fehlt');

// Nach dem Drehen muss auch die Hervorhebung des letzten Zuges an der
// RICHTIGEN Stelle stehen. Genau daran ist es vorher gescheitert: die
// Hervorhebung rechnete mit dem Brettindex, gezeichnet wurde aber der
// Anzeigeindex - ungedreht identisch, gedreht falsch.
// Erst in eine bekannte Lage drehen, dann spielen, dann drehen - sonst
// haengt der Schritt daran, was der vorherige zurueckgelassen hat.
await dreheAuf(seite, false);
await seite.click('#btnNeu');
await seite.waitForTimeout(120);
await tippeZug(seite, 'e2', 'e4');
const fenGespielt = await seite.locator('#fen').inputValue();
if (!/4P3/.test(fenGespielt)) bad(`der Zug e2-e4 kam nicht zustande: ${fenGespielt}`);
await dreheAuf(seite, true);
const standGedreht = await seite.evaluate(() => {
  // Brettindex von e4, dann in die Anzeige gedreht.
  const e4 = 4 + 4 * 8;
  const ziel = 63 - e4;
  const zelle = document.querySelector(`.feld[data-i="${ziel}"]`);
  const von = document.querySelector(`.feld[data-i="${63 - 52}"]`); // Brettindex von e2
  return {
    ziel,
    zielFigur: zelle.querySelector('.figur use')?.getAttribute('href') ?? '-',
    zielMarkiert: zelle.classList.contains('hervor'),
    vonFigur: von.querySelector('.figur use')?.getAttribute('href') ?? '-',
    vonMarkiert: von.classList.contains('hervor'),
  };
});
standGedreht.zielFigur === '#wP' &&
  standGedreht.zielMarkiert &&
  standGedreht.vonFigur === '-' &&
  standGedreht.vonMarkiert
  ? ok(`gedreht liegen Figur und Hervorhebung zusammen (Anzeige ${standGedreht.ziel})`)
  : bad(`gedreht falsch: ${JSON.stringify(standGedreht)}`);

await dreheAuf(seite, false);

// ------------------------------------------------------------------ 8 Umbau

step('8 · Umbau');
await seite.fill('#fen', '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
await seite.click('#btnSetzen');
await seite.waitForTimeout(120);
await tippeZug(seite, 'a7', 'a8');
await seite.waitForSelector('#promo:not([hidden])', { timeout: 5000 }).catch(() => {});
const dialogOffen = await seite.locator('#promo').isVisible();
dialogOffen ? ok('Der Dialog fragt nach, was werden soll') : bad('kein Umbau-Dialog');
if (dialogOffen) {
  const anzahl = await seite.locator('#promoStuecke button').count();
  anzahl === 4 ? ok('vier Figuren zur Wahl') : bad(`${anzahl} Figuren zur Wahl`);
  await seite.screenshot({ path: `${shots}/23-umbau.png`, fullPage: true });
  await seite.locator('#promoStuecke button').nth(3).click(); // Springer
  await seite.waitForTimeout(150);
  zuege = (await seite.locator('#zuege button').allTextContents()).filter((t) => t.trim());
  zuege[0] === 'a8=N'
    ? ok('Springer gewählt, Notation sagt a8=N')
    : bad(`Notation "${zuege[0]}" statt a8=N`);
  const fenPromo = await seite.locator('#fen').inputValue();
  fenPromo.startsWith('N3k3/8/8/8/8/8/8/4K3')
    ? ok('der Springer steht auf a8')
    : bad(`FEN nach dem Umbau: ${fenPromo}`);
}

// ------------------------------------------------------------------ 9 Matt

step('9 · Matt und Remis werden erkannt');
await seite.fill('#fen', 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
await seite.click('#btnSetzen');
await seite.waitForTimeout(120);
const mattText = await seite.locator('#hinweis').textContent();
/Black wins/i.test(mattText)
  ? ok(`eine eingetippte Endstellung wird angesagt: "${mattText.trim()}"`)
  : bad(`Endstellung nicht angesagt: "${mattText.trim()}"`);

// Und der Matt muss auch entstehen, wenn er gespielt wird.
await seite.fill('#fen', 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 3');
await seite.click('#btnSetzen');
await seite.waitForTimeout(120);
await tippeZug(seite, 'd8', 'h4'); // Damenopfer, das ist Matt
const mattGespielt = await seite.locator('#hinweis').textContent();
/Black wins|Black wins/i.test(mattGespielt)
  ? ok(`der gespielte Matt wird erkannt: "${mattGespielt.trim()}"`)
  : bad(`Matt beim Spielen nicht erkannt: "${mattGespielt.trim()}"`);

// ------------------------------------------------------------------ 10 FEN

step('10 · Stellung eintippen');
await seite.fill('#fen', 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
await seite.click('#btnSetzen');
await seite.waitForTimeout(120);
const feldC4 = await seite.locator('.feld .figur use').count();
feldC4 === 32 ? ok('32 Figuren geladen') : bad(`${feldC4} Figuren geladen`);
const c4Da = await seite.evaluate(() => {
  const f = [...document.querySelectorAll('.feld')].find((x) =>
    x.getAttribute('aria-label') === 'white bishop on c4');
  return Boolean(f);
});
c4Da ? ok('der Laeufer steht auf c4, wie eingetippt') : bad('der Laeufer steht nicht auf c4');

await seite.fill('#fen', 'das ist keine stellung');
await seite.click('#btnSetzen');
await seite.waitForTimeout(150);
const fehlerText = await seite.locator('#hinweis').textContent();
// Wichtig ist das Brett, nicht das Eingabefeld: dort steht weiterhin, was
// getippt wurde - das ist Absicht, damit man korrigieren kann.
const laeuftWeiter = await seite.evaluate(
  () => Boolean([...document.querySelectorAll('.feld')].find((f) => f.getAttribute('aria-label') === 'white bishop on c4')),
);
fehlerText.includes('FEN') && laeuftWeiter
  ? ok(`kaputtes FEN wird abgewiesen, das Brett bleibt stehen: "${fehlerText.trim()}"`)
  : bad(`kaputtes FEN: "${fehlerText.trim()}" / Brett unverändert: ${laeuftWeiter}`);

// ------------------------------------------------------------------ 11 Groesse

step('11 · Bedienbarkeit mit einer Hand');
const masse = await seite.evaluate(() => {
  const r = document.querySelector('.feld').getBoundingClientRect();
  const k = document.getElementById('btnNeu').getBoundingClientRect();
  return { feld: r.width, knopf: k.height };
});
masse.feld >= 46
  ? ok(`Feld ${masse.feld.toFixed(0)} px groß (Mindestmaß 46)`)
  : bad(`Feld nur ${masse.feld.toFixed(0)} px`);
masse.knopf >= 44
  ? ok(`Knopf ${masse.knopf.toFixed(0)} px hoch`)
  : bad(`Knopf nur ${masse.knopf.toFixed(0)} px hoch`);

const ueberlauf = await seite.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
ueberlauf <= 1 ? ok('kein waagerechter Überlauf') : bad(`${ueberlauf} px Überlauf`);

// ------------------------------------------------------------------ 12 Adresse

step('12 · Stellung in der Adresse');
await seite.click('#btnNeu');
await seite.waitForTimeout(100);
await seite.click('#btnTeilen');
await seite.waitForTimeout(150);
const url = seite.url();
url.includes('#') ? ok('Adresse enthält die Stellung') : bad(`Adresse ohne Stellung: ${url}`);
const seite2 = await kontext.newPage();
await seite2.goto(url, { waitUntil: 'load' });
await seite2.waitForSelector('.feld');
const stand2 = await seite2.locator('#stand').textContent();
stand2.trim() === '0/0' ? ok('geladene Seite startet in der Startstellung') : bad(`Stand ${stand2}`);
await seite2.close();

// ------------------------------------------------------------------ 13 Finger

step('13 · Mit dem Finger');
{
  // Zweiter Kontext mit Touch. Hier wird mit touchscreen.getippt, nicht mit
  // der Maus - nur so kommen echte pointerdown-Ereignisse an.
  const touchKontext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: 'en-GB',
  });
  const tp = await touchKontext.newPage();
  tp.setDefaultTimeout(30_000);
  const touchFehler = [];
  tp.on('pageerror', (e) => touchFehler.push(String(e)));
  await tp.goto(BASE, { waitUntil: 'load' });
  await tp.waitForSelector('.feld');
  // Anzeigeindex: Zeile 0 ist die achte Reihe, also ist e2 die 52 und e4 die 36.
  const ziel = await tp.locator('.feld[data-i="36"]').boundingBox();
  const start = await tp.locator('.feld[data-i="52"]').boundingBox();
  await tp.touchscreen.tap(start.x + start.width / 2, start.y + start.height / 2);
  await tp.waitForTimeout(80);
  const markierungen = await tp.locator('.feld .hinweis').count();
  markierungen === 2
    ? ok('Antippen mit dem Finger zeigt die zwei möglichen Züge')
    : bad(`${markierungen} Markierungen statt 2`);
  await tp.touchscreen.tap(ziel.x + ziel.width / 2, ziel.y + ziel.height / 2);
  await tp.waitForTimeout(150);
  const sanTouch = (await tp.locator('#zuege button').allTextContents())[0];
  sanTouch === 'e4'
    ? ok('Zug mit dem Finger funktioniert')
    : bad(`Mit dem Finger: "${sanTouch}" statt e4`);
  await tp.screenshot({ path: `${shots}/24-finger.png`, fullPage: true });
  touchFehler.length === 0
    ? ok('keine Fehler auf dem Weg')
    : bad(`Fehler mit Touch: ${touchFehler.join(' | ')}`);
  await touchKontext.close();
}

// ------------------------------------------------------------------ 14 Datei

step('13 · Auch als Datei');
const dateiKontext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const dateiSeite = await dateiKontext.newPage();
dateiSeite.setDefaultTimeout(30_000);
const dateiFehler = [];
dateiSeite.on('pageerror', (e) => dateiFehler.push(String(e)));
await dateiSeite.goto(`file://${path.join(repo, 'docs', 'board.html')}`, { waitUntil: 'load' });
await dateiSeite.waitForSelector('.feld', { timeout: 20_000 }).catch(() => {});
const dateiFelder = await dateiSeite.locator('.feld').count();
dateiFelder === 64 && dateiFehler.length === 0
  ? ok('die Brettseite läuft auch aus dem Dateisystem')
  : bad(`datei:// ${dateiFelder} Felder, ${dateiFehler.length} Fehler: ${dateiFehler.join(' | ')}`);
await dateiKontext.close();

// ------------------------------------------------------------------ 15 Konsole

step('14 · Konsole');
konsolenfehler.length === 0
  ? ok('keine Konsolenfehler')
  : bad(`Konsolenfehler: ${konsolenfehler.slice(0, 3).join(' | ')}`);

await browser.close();

console.log('');
if (problems.length) {
  console.log(`${problems.length} PROBLEME`);
  console.log(problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log('Alles grün.');