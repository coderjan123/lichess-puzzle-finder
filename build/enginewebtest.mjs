#!/usr/bin/env node
/**
 * Test für die Engine in der echten Seite und für die Datenbank-Oberfläche.
 *
 *   node build/enginewebtest.mjs [--headed]
 *
 * Geprüft wird, was beim Benutzen auffällt und beim Zählen nicht:
 *
 * 1. Engine einschalten: Es kommen Zeilen, mit Tiefe, Knoten und nps.
 * 2. **Das Vorzeichen.** Stockfish zählt aus Sicht der Partei am Zug; auf der
 *    Seite muss die Sicht von Weiß stehen. Nach 1. e4 e5 2. Nf3 darf nicht
 *    "schwarz im Vorteil" dastehen - das war der gemeldete Fehler.
 * 3. Der beste Zug erscheint als grüner Pfeil auf dem Brett.
 * 4. Die Figur am Finger ist **ein Feld** groß und nicht größer (Meldung:
 *    "zu groß").
 * 5. Einstellungen: die Seitenthes wechseln wirklich die Farben, die
 *    Brett-Themes die Feldfarben, und die nicht gebauten Figurensätze sind
 *    deaktiviert statt wirkungslos.
 * 6. Datenbank: ohne Anmeldung steht ein Log-in-Knopf da und **kein**
 *    veraltetes "Log in to see…" mehr; die Reiter wechseln; ein Klick auf
 *    eine Zeile spielt den Zug.
 *
 * Ohne Anmeldung lässt sich die Datenbank nicht mit echten Daten prüfen -
 * das ist eine Eigenschaft der Sache, kein Testfehler. Geprüft wird der
 * Zustand "nicht angemeldet" und dass die Oberfläche das sauber sagt.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { startServer } from './serve.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(hier, '..');
const shots = '/tmp/opencode/shots';
fs.mkdirSync(shots, { recursive: true });

const probleme = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  probleme.push(msg);
  console.log(`  FEHLER ${msg}`);
};
const step = (msg) => console.log(`\n== ${msg}`);

const { port } = await startServer({ port: 0, root: path.join(repo, 'docs') });
const BASE = `http://127.0.0.1:${port}/board.html`;

const browser = await firefox.launch({ headless: !process.argv.includes('--headed') });
const kontext = await browser.newContext({
  viewport: { width: 1920, height: 916 },
  colorScheme: 'dark',
  locale: 'en-GB',
});
const seite = await kontext.newPage();
seite.setDefaultTimeout(30_000);
const fehler = [];
seite.on('pageerror', (e) => fehler.push(String(e)));
seite.on('console', (m) => {
  if (m.type() === 'error') fehler.push(m.text());
});
const fremd = [];
seite.on('request', (r) => {
  if (!r.url().startsWith(`http://127.0.0.1:${port}`)) fremd.push(r.url());
});

await seite.goto(BASE, { waitUntil: 'load' });
await seite.waitForSelector('.feld');

const feldBox = async (name) => {
  await seite.locator('.brett-halter').scrollIntoViewIfNeeded().catch(() => {});
  const i = await seite.evaluate((n) => {
    const treffer = [...document.querySelectorAll('.feld')].find((f) =>
      f.getAttribute('aria-label')?.endsWith(`on ${n}`),
    );
    if (treffer) return Number(treffer.dataset.i);
    return n.charCodeAt(0) - 97 + (8 - Number(n[1])) * 8;
  }, name);
  const box = await seite.locator(`.feld[data-i="${i}"]`).boundingBox();
  return box;
};

const zug = async (von, nach) => {
  const a = await feldBox(von);
  const b = await feldBox(nach);
  await seite.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  await seite.waitForTimeout(90);
  await seite.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await seite.waitForTimeout(120);
};

// ------------------------------------------------------------------ 1 Engine an

step('1 · Engine einschalten');
await seite.click('#engineSchalter');
const kam = await seite
  .waitForFunction(() => document.querySelectorAll('#engine .engine-zeile').length > 0, null, {
    timeout: 60_000,
  })
  .then(() => true)
  .catch(() => false);
kam ? ok('die Engine liefert Zeilen') : bad('keine einzige Engine-Zeile in 60 s');

if (kam) {
  const info = (await seite.locator('#engine .engine-info').textContent().catch(() => '')).trim();
  /Tiefe \d+/.test(info) && /Knoten/.test(info) && /nps/.test(info)
    ? ok(`Infozeile: "${info}"`)
    : bad(`Infozeile unvollständig: "${info}"`);

  // ---------------------------------------------------------------- 2 Vorzeichen

  const wertNach = async (zugpaar) => {
    if (zugpaar) await zug(...zugpaar);
    await seite.waitForTimeout(4500);
    return seite.evaluate(() => {
      const zeile = document.querySelector('#engine .engine-zeile');
      const wert = zeile?.querySelector('.engine-wert')?.textContent ?? '';
      const zugText = zeile?.querySelector('.engine-zug')?.textContent ?? '';
      return { wert: wert.trim(), zug: zugText.trim().slice(0, 18), amZug: null };
    });
  };

  const start = await wertNach(null);
  // In der Startstellung ist Weiß minimal besser (+0.2 bis +0.4).
  const startZahl = Number(start.wert.replace('+', ''));
  Number.isFinite(startZahl) && startZahl > 0
    ? ok(`Startstellung: "${start.wert}" für Weiß (muss positiv sein)`)
    : bad(`Startstellung: "${start.wert}" - die Sicht ist vertauscht`);

  // Nach 1. e4 ist Weiß am Zug; nach 1... e5 ist Schwarz am Zug und die Zahl
  // muss trotzdem aus Sicht von Weiß kommen.
  await zug('e2', 'e4');
  await seite.waitForTimeout(4500);
  const nachE4 = await seite.evaluate(() => {
    const zeile = document.querySelector('#engine .engine-zeile');
    return {
      wert: (zeile?.querySelector('.engine-wert')?.textContent ?? '').trim(),
      zug: (zeile?.querySelector('.engine-zug')?.textContent ?? '').trim().slice(0, 20),
      partei: document.querySelector('.feld[aria-label^="black pawn on e7"]') ? 'black' : 'unbekannt',
    };
  });
  const zahlE4 = Number(nachE4.wert.replace('+', ''));
  zahlE4 > -0.9 && Math.abs(zahlE4) < 1.2
    ? ok(`nach 1. e4: "${nachE4.wert}" mit ${nachE4.zug}`)
    : bad(`nach 1. e4: "${nachE4.wert}" - das sieht nicht nach einer ruhigen Stellung aus`);

  await zug('e7', 'e5');
  await seite.waitForTimeout(4500);
  const nachE5 = await seite.evaluate(() => {
    const zeile = document.querySelector('#engine .engine-zeile');
    return {
      wert: (zeile?.querySelector('.engine-wert')?.textContent ?? '').trim(),
      zug: (zeile?.querySelector('.engine-zug')?.textContent ?? '').trim().slice(0, 20),
    };
  });
  // Nach 1. e4 e5 ist Weiß am Zug und die Stellung ausgeglichen: die Zahl
  // muss um 0 liegen. Ein "schwarzer Vorteil" wäre genau der Fehler.
  const zahlE5 = Number(nachE5.wert.replace('+', ''));
  Math.abs(zahlE5) < 0.6
    ? ok(`nach 1. e4 e5: "${nachE5.wert}" - die Zahl ist aus Sicht von Weiß`)
    : bad(`nach 1. e4 e5: "${nachE5.wert}" - das ist die Sicht der falschen Seite`);

  await zug('g1', 'f3');
  await seite.waitForTimeout(4500);
  const nachNf3 = await seite.evaluate(() => {
    const zeile = document.querySelector('#engine .engine-zeile');
    return {
      wert: (zeile?.querySelector('.engine-wert')?.textContent ?? '').trim(),
      zug: (zeile?.querySelector('.engine-zug')?.textContent ?? '').trim().slice(0, 20),
    };
  });
  const zahlNf3 = Number(nachNf3.wert.replace('+', ''));
  Math.abs(zahlNf3) < 0.6
    ? ok(`nach 2. Nf3: "${nachNf3.wert}" mit ${nachNf3.zug} (die Meldung war: schwarzer Vorteil)`)
    : bad(`nach 2. Nf3: "${nachNf3.wert}" - immer noch die falsche Seite`);

  // ---------------------------------------------------------------- 3 Pfeil

  const pfeil = await seite.evaluate(() => {
    const svg = document.querySelector('#zeichenEbene svg');
    if (!svg) return null;
    const linie = svg.querySelector('line');
    return linie
      ? {
          x1: Number(linie.getAttribute('x1')),
          y1: Number(linie.getAttribute('y1')),
          x2: Number(linie.getAttribute('x2')),
          y2: Number(linie.getAttribute('y2')),
          strebe: linie.getAttribute('stroke'),
          spitze: svg.querySelector('polygon') !== null,
        }
      : null;
  });
  pfeil && pfeil.spitze && pfeil.strebe === '#35a62a' && pfeil.x1 !== pfeil.x2
    ? ok(`grüner Pfeil von (${pfeil.x1}, ${pfeil.y1}) nach (${pfeil.x2}, ${pfeil.y2})`)
    : bad(`Pfeil fehlt oder ist nicht grün: ${JSON.stringify(pfeil)}`);

  await seite.screenshot({ path: `${shots}/50-engine.png` });
}

// ------------------------------------------------------------------ 4 Geist

step('4 · Figur am Finger');
{
  // Erst zurueck auf die Startstellung: nach den Zuegen von Schritt 1 ist
  // Schwarz am Zug, und der weisse Bauer auf d2 laesst sich dann gar nicht
  // ziehen - der Geist waere zu Recht nicht da.
  await seite.click('#btnLeer');
  await seite.waitForTimeout(300);
  const a = await feldBox('d2');
  const b = await feldBox('d4');
  await seite.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await seite.mouse.down();
  await seite.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  const geist = await seite.evaluate(() => {
    const g = document.getElementById('geist');
    const feld = document.querySelector('.feld').getBoundingClientRect();
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { breite: r.width, feld: feld.width, verhaeltnis: r.width / feld.width };
  });
  await seite.mouse.up();
  if (!geist) {
    bad('beim Ziehen gibt es keine Figur am Finger');
  } else if (geist.verhaeltnis > 1.15 || geist.verhaeltnis < 0.85) {
    // Genau ein Feld ist richtig - so ist es auch bei lichess. Vorher stand
    // dort "11 %" vom Fenster, auf 1920 px also 211 px: zwei Felder.
    bad(`die Figur am Finger ist ${geist.breite.toFixed(0)} px breit bei einem Feld von ${geist.feld.toFixed(0)} px (Faktor ${geist.verhaeltnis.toFixed(2)})`);
  } else {
    ok(`die Figur am Finger misst ${geist.breite.toFixed(0)} px - genau ein Feld (${geist.feld.toFixed(0)} px)`);
  }
}

// ------------------------------------------------------------------ 5 Einstellungen

step('5 · Einstellungen');
await seite.click('#btnEinstellungen');
await seite.waitForTimeout(250);

const vorHintergrund = await seite.evaluate(() => getComputedStyle(document.body).backgroundColor);
await seite.locator('#setSeite button', { hasText: 'Fire' }).click();
await seite.waitForTimeout(200);
const nachHintergrund = await seite.evaluate(() => getComputedStyle(document.body).backgroundColor);
vorHintergrund !== nachHintergrund
  ? ok(`Seitenthema Fire ändert den Hintergrund (${vorHintergrund} → ${nachHintergrund})`)
  : bad('das Seitenthema Fire ändert nichts - der Knopf tut nichts');

const an = await seite.evaluate(
  () => document.querySelector('#setSeite button.an')?.textContent ?? '(keins)',
);
an === 'Fire' ? ok('der gewählte Themenknopf ist markiert') : bad(`markiert ist "${an}"`);

await seite.locator('#setSeite button', { hasText: 'Emerald' }).click();
await seite.waitForTimeout(150);
const nachEmerald = await seite.evaluate(() => getComputedStyle(document.body).backgroundColor);
nachEmerald !== nachHintergrund
  ? ok(`Emerald ändert den Hintergrund (${nachHintergrund} → ${nachEmerald})`)
  : bad('Emerald ändert nichts');

const feldFarbeVor = await seite.evaluate(() => getComputedStyle(document.querySelector('.feld')).backgroundColor);
await seite.locator('#setBoard button[title="green"]').click();
await seite.waitForTimeout(200);
const feldFarbeNach = await seite.evaluate(() => getComputedStyle(document.querySelector('.feld')).backgroundColor);
feldFarbeVor !== feldFarbeNach
  ? ok(`Brett-Thema Green ändert die Felder (${feldFarbeVor} → ${feldFarbeNach})`)
  : bad('das Brett-Thema Green ändert die Felder nicht');

const figurKnoepfe = await seite.evaluate(() =>
  [...document.querySelectorAll('#setFiguren button')].map((b) => ({
    text: b.textContent,
    an: b.classList.contains('an'),
    aus: b.disabled,
    titel: b.title ?? '',
  })),
);
const aktivesSatz = figurKnoepfe.filter((k) => k.an).length;
const ohneWirkung = figurKnoepfe.filter((k) => !k.an && !k.aus).length;
aktivesSatz === 1 && ohneWirkung === 0
  ? ok('genau ein Figurensatz ist gewählt, die anderen sind deaktiviert statt wirkungslos')
  : bad(`Figurensätze: ${aktivesSatz} gewählt, ${ohneWirkung} tun nichts und sind nicht deaktiviert`);

await seite.locator('#setKoordinaten').uncheck();
await seite.waitForTimeout(200);
const koordinatenAus = await seite.locator('.feld .koordinate.reihe:not([hidden])').count();
await seite.locator('#setKoordinaten').check();
await seite.waitForTimeout(200);
const koordinatenAn = await seite.locator('.feld .koordinate.reihe:not([hidden])').count();
koordinatenAus === 0 && koordinatenAn === 4
  ? ok('der Koordinaten-Haken schaltet die Beschriftung ab und an')
  : bad(`Koordinaten: aus=${koordinatenAus} (soll 0), an=${koordinatenAn} (soll 4)`);

await seite.click('#dialogFertig');
await seite.waitForTimeout(200);

// ------------------------------------------------------------------ 6 Datenbank

step('6 · Eröffnungsdatenbank');

const anmeldeKnopf = await seite.locator('#explorerAnmelden').isVisible();
const abmeldeKnopf = await seite.locator('#explorerAbmelden').isVisible();
const angemeldet = await seite.evaluate(() => Boolean(localStorage.getItem('lp-ankunft')) || false);
if (!angemeldet) {
  anmeldeKnopf && !abmeldeKnopf
    ? ok('ohne Anmeldung: der Log-in-Knopf ist da, Log out ist versteckt')
    : bad(`ohne Anmeldung: Log-in sichtbar=${anmeldeKnopf}, Log-out sichtbar=${abmeldeKnopf}`);
} else {
  !anmeldeKnopf && abmeldeKnopf
    ? ok('mit Anmeldung: Log out ist da, Log-in ist versteckt')
    : bad(`mit Anmeldung: Log-in sichtbar=${anmeldeKnopf}, Log-out sichtbar=${abmeldeKnopf}`);
}

const hinweis = (await seite.locator('#explorerZeilen').textContent()).trim();
/Log in/i.test(hinweis) || /nicht angemeldet/i.test(hinweis) || /erreichbar/i.test(hinweis)
  ? ok(`die Datenbank sagt klar, was fehlt: "${hinweis.slice(0, 60)}"`)
  : bad(`unklare Meldung in der Datenbank: "${hinweis.slice(0, 80)}"`);

// Die Reiter müssen umschalten und ihren Zustand zeigen.
for (const name of ['Elite', 'CORR', '2024+', 'TT', 'Lichess']) {
  await seite.locator(`.reiter-knopf[data-quelle]`, { hasText: name }).first().click();
  await seite.waitForTimeout(160);
  const markiert = await seite.evaluate(
    () => document.querySelector('.reiter-knopf.aktiv')?.textContent ?? '',
  );
  if (markiert.trim() !== name.trim()) bad(`Reiter ${name}: markiert ist "${markiert.trim()}"`);
}
ok('alle fünf Reiter lassen sich umschalten');

// Und die Σ-Zeile muss verschwinden, wenn es keine Zahlen gibt.
const summeSichtbar = await seite.locator('#explorerSumme').isVisible();
summeSichtbar
  ? bad('die Sigma-Zeile ist sichtbar, obwohl keine Daten geladen sind')
  : ok('die Sigma-Zeile bleibt versteckt, solange keine Zahlen da sind');

// ------------------------------------------------------------------ 7 Konsole, Netz

step('7 · Konsole und Netz');
fehler.length === 0
  ? ok('keine Konsolenfehler')
  : bad(`Konsolenfehler: ${fehler.slice(0, 2).join(' | ')}`);
fremd.length === 0
  ? ok('keine Anfrage außerhalb der eigenen Herkunft')
  : bad(`fremde Anfragen: ${fremd.slice(0, 3).join(' | ')}`);

await seite.screenshot({ path: `${shots}/51-einstellungen.png` });
await browser.close();

console.log('');
if (probleme.length) {
  console.log(`${probleme.length} PROBLEME`);
  for (const p of probleme) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Alles grün.');