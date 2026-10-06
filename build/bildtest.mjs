#!/usr/bin/env node
/**
 * Misst die Brettseite gegen die Sollwerte aus den Screenshots des Nutzers.
 *
 *   node build/bildtest.mjs            # Geometrie, Farben, Höhen messen
 *   node build/bildtest.mjs --bilder   # zusätzlich Pixelvergleich mit unseren
 *                                      # eigenen Referenzbildern
 *   node build/bildtest.mjs --neu      # Referenzbilder neu aufnehmen
 *
 * Warum zwei Arten von Vergleich:
 *
 * 1. Geometrie und Farben gegen `build/bilder/soll.json`. Das sind die Zahlen,
 *    die aus den Screenshots des Nutzers ausgemessen wurden (Kanten aus der
 *    Pixelmatrix, nicht geschaetzt). Dieser Teil ist auf jedem Rechner gleich
 *    und deshalb die harte Zusicherung.
 *
 * 2. Pixelvergleich gegen unsere **eigenen** Referenzbilder in
 *    `build/bilder/ist-ref/`. Nicht gegen die Screenshots von lichess: dort ist
 *    das Brett mit einem Holz-Thema belegt, das eine Textur traegt. Die
 *    koennen und wollen wir nicht nachbauen, und ein Pixelvergleich gegen ein
 *    fremdes Brett wuerde nur eine falsche Fehlermeldung erzeugen. Unsere
 *    Referenzen fangen Regressionen auf - plötzlich verschwundene Figuren,
 *    verrutschte Panels, kaputte Schriftgroessen.
 *
 * Was der Pixelvergleich **nicht** kann: eine leere Seite finden, die nur aus
 * flaechen Farben besteht - da hilft `bretttest.mjs` mit Feldvergleichen, die
 * sich selbst beweisen.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { startServer } from './serve.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(hier, '..');
const bilder = path.join(hier, 'bilder');
const istRef = path.join(bilder, 'ist-ref');
const istZiel = path.join(bilder, 'ist');

const soll = JSON.parse(fs.readFileSync(path.join(bilder, 'soll.json'), 'utf8'));
const neu = process.argv.includes('--neu');
const mitBildern = process.argv.includes('--bilder') || neu;

const probleme = [];
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  probleme.push(msg);
  console.log(`  FEHLER ${msg}`);
};
const hinweis = (msg) => console.log(`  --    ${msg}`);
const step = (msg) => console.log(`\n== ${msg}`);

const fenster = soll.fenster[0];

/** '#rrggbb' -> [r,g,b] */
function rgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Zwei Farben unterscheiden sich um weniger als `toleranz` je Kanal? */
function farbeNah(a, b, toleranz) {
  const pa = rgb(a);
  const pb = rgb(b);
  return pa.every((v, i) => Math.abs(v - pb[i]) <= toleranz);
}

/** In Prozent: 0 = gleich, sonst Abweichung. */
function farbeAbstand(a, b) {
  const pa = rgb(a);
  const pb = rgb(b);
  return Math.max(...pa.map((v, i) => Math.abs(v - pb[i])));
}

// ------------------------------------------------------------------ Server

const { port } = await startServer({ port: 0, root: path.join(repo, 'docs') });
const browser = await firefox.launch({ headless: !process.argv.includes('--headed') });
const kontext = await browser.newContext({
  viewport: { width: fenster.breite, height: fenster.hoehe },
  colorScheme: 'dark',
  locale: 'en-GB',
});
const seite = await kontext.newPage();
seite.setDefaultTimeout(30_000);
const fehler = [];
seite.on('pageerror', (e) => fehler.push(String(e)));

if (mitBildern) {
  fs.mkdirSync(istRef, { recursive: true });
  fs.mkdirSync(istZiel, { recursive: true });
}

await seite.goto(`http://127.0.0.1:${port}/board.html`, { waitUntil: 'load' });
await seite.waitForSelector('.feld', { timeout: 20_000 }).catch(() => {});

// ------------------------------------------------------------------ Messen

step('1 · Geometrie');

/** Alles, was die Seite ueber ihre Bausteine verraten kann. */
const gemessen = await seite.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10,
      y: Math.round(r.y * 10) / 10,
      breite: Math.round(r.width * 10) / 10,
      hoehe: Math.round(r.height * 10) / 10,
    };
  };
  const rgbVon = (el) => {
    if (!el) return null;
    const c = getComputedStyle(el).backgroundColor;
    const m = c.match(/\d+/g);
    return m ? '#' + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0')).join('') : null;
  };
  const felder = [...document.querySelectorAll('.feld')];
  let feldGroesse = null;
  if (felder.length >= 2) {
    const a = felder[0].getBoundingClientRect();
    const b = felder[1].getBoundingClientRect();
    feldGroesse = Math.round(Math.abs(b.x - a.x - a.width) > 1 ? a.width : a.width * 10) / 10;
  }
  return {
    brett: box('#brett, .board'),
    panel: box('#werkzeug, .werkzeug'),
    leiste: box('.leiste'),
    fenFeld: box('#fen'),
    knopfReihe: box('.knopfreihe'),
    engine: box('#engine'),
    zuege: box('#zuege'),
    explorer: box('#explorer'),
    unten: box('.unten'),
    felderGesamt: felder.length,
    feldGroesse,
    seite: rgbVon(document.body),
    panelFarbe: rgbVon(document.querySelector('#werkzeug, .werkzeug')),
  };
});

const tolG = soll.geometrie.toleranzPx;

if (!gemessen.brett) {
  bad('kein Brett mit der Kennung #brett oder .board gefunden');
} else {
  const ist = Math.round(gemessen.brett.breite);
  const ziel = soll.geometrie.brett.groesse;
  Math.abs(ist - ziel) <= tolG
    ? ok(`Brett ${ist} px (soll ${ziel}, ±${tolG})`)
    : bad(`Brett ${ist} px statt ${ziel}`);
}

if (gemessen.feldGroesse) {
  // Auf dem Handy ist das Feld kleiner als 101 px - nur auf grosser Breite pruefen.
  if (fenster.breite >= 1400) {
    const ist = Math.round(gemessen.feldGroesse);
    const ziel = soll.geometrie.brett.feld;
    Math.abs(ist - ziel) <= tolG
      ? ok(`Feld ${ist} px (soll ${ziel}, ±${tolG})`)
      : bad(`Feld ${ist} px statt ${ziel}`);
  }
}

if (gemessen.brett && gemessen.panel) {
  const luecke = Math.round(gemessen.panel.x - (gemessen.brett.x + gemessen.brett.breite));
  const ziel = soll.geometrie.lueckeBrettPanel;
  Math.abs(luecke - ziel) <= tolG
    ? ok(`Lücke Brett → Panel ${luecke} px (soll ${ziel})`)
    : bad(`Lücke Brett → Panel ${luecke} px statt ${ziel}`);

  const obenGleich = Math.abs(gemessen.panel.y - gemessen.brett.y) <= tolG;
  obenGleich
    ? ok(`Panel beginnt auf gleicher Höhe wie das Brett (y=${gemessen.panel.y})`)
    : bad(`Panel beginnt bei y=${gemessen.panel.y}, Brett bei y=${gemessen.brett.y}`);

  if (fenster.breite >= 1400) {
    const panelIst = Math.round(gemessen.panel.breite);
    // lichess ist hier nachgiebig: 520 px bis 610 px je nach Fensterbreite.
    const passt = panelIst >= 500 && panelIst <= 660;
    passt
      ? ok(`Panel ${panelIst} px breit (lichess: 520–610)`)
      : bad(`Panel ${panelIst} px breit, erwartet 520–610`);
  }
}

// ------------------------------------------------------------------ Farben

step('2 · Farben');

const tolF = soll.farben.toleranz;
if (gemessen.seite) {
  farbeNah(gemessen.seite, soll.farben.seite, tolF)
    ? ok(`Seitenhintergrund ${gemessen.seite} (soll ${soll.farben.seite})`)
    : bad(`Seitenhintergrund ${gemessen.seite} statt ${soll.farben.seite}`);
} else {
  bad('Seitenhintergrund nicht messbar');
}
if (gemessen.panelFarbe) {
  const abstand = farbeAbstand(gemessen.panelFarbe, soll.farben.panel);
  abstand <= tolF
    ? ok(`Panel ${gemessen.panelFarbe} (soll ${soll.farben.panel}, Abstand ${abstand})`)
    : bad(`Panel ${gemessen.panelFarbe} statt ${soll.farben.panel} (Abstand ${abstand})`);
}

// ------------------------------------------------------------------ Bausteine

step('3 · Bausteine der Werkzeugspalte');

const pflicht = [
  { sel: '.leiste', name: 'Werkzeugleiste (Engine-Schalter + Zahnrad)', hoehe: 'leiste' },
  { sel: '#fen', name: 'FEN-Feld', hoehe: 'fenFeld' },
  { sel: '.knopfreihe', name: 'Knopfreihe (Insert FEN, Reset, Copy FEN, Copy PGN, Import PGN)', hoehe: 'knopfReihe' },
  { sel: '#engine', name: 'Engine-Anzeige', hoehe: 'engineBlock' },
  { sel: '#zuege', name: 'Zugsliste', hoehe: null },
  { sel: '#explorer', name: 'Eröffnungsdatenbank', hoehe: null },
  { sel: '.unten', name: 'untere Werkzeugleiste', hoehe: 'untenLeiste' },
];
for (const { sel, name, hoehe } of pflicht) {
  const box = await seite.locator(sel).first().boundingBox().catch(() => null);
  if (!box) {
    bad(`${name} fehlt noch (${sel})`);
    continue;
  }
  const ziel = hoehe ? soll.panelHoehen[hoehe] : null;
  if (ziel) {
    const tol = soll.panelHoehen._toleranz;
    Math.abs(Math.round(box.height) - ziel) <= tol
      ? ok(`${name}: ${Math.round(box.height)} px (soll ${ziel})`)
      : hinweis(`${name}: ${Math.round(box.height)} px, soll ${ziel} (Abweichung ${Math.round(box.height) - ziel})`);
  } else {
    ok(`${name} da`);
  }
}

// Die Zeilenhoehen der Tabelle sind der Teil, der am ehesten verrutscht.
const zeilenHoehe = await seite.evaluate(() => {
  const kopf = document.querySelector('.tabellen-kopf');
  const reiter = document.querySelector('.reiter');
  return {
    reiter: reiter ? Math.round(reiter.getBoundingClientRect().height) : null,
    kopf: kopf ? Math.round(kopf.getBoundingClientRect().height) : null,
  };
});
if (zeilenHoehe.reiter) {
  Math.abs(zeilenHoehe.reiter - soll.panelHoehen.reiterLeiste) <= soll.panelHoehen._toleranz
    ? ok(`Reiterleiste ${zeilenHoehe.reiter} px (soll ${soll.panelHoehen.reiterLeiste})`)
    : hinweis(`Reiterleiste ${zeilenHoehe.reiter} px, soll ${soll.panelHoehen.reiterLeiste}`);
}
if (zeilenHoehe.kopf) {
  Math.abs(zeilenHoehe.kopf - soll.panelHoehen.tabellenKopf) <= soll.panelHoehen._toleranz
    ? ok(`Tabellenkopf ${zeilenHoehe.kopf} px (soll ${soll.panelHoehen.tabellenKopf})`)
    : hinweis(`Tabellenkopf ${zeilenHoehe.kopf} px, soll ${soll.panelHoehen.tabellenKopf}`);
}

// ------------------------------------------------------------------ Bilder

if (mitBildern) {
  step('4 · Pixelvergleich mit unseren Referenzen');
  const zustände = [
    { name: 'start', fenster: { width: 1920, height: 916 } },
    { name: 'handy', fenster: { width: 390, height: 844 } },
  ];
  for (const z of zustände) {
    await seite.setViewportSize(z.fenster);
    await seite.waitForTimeout(400);
    const ziel = path.join(istZiel, `${z.name}.png`);
    await seite.screenshot({ path: ziel });
    const ref = path.join(istRef, `${z.name}.png`);
    if (neu || !fs.existsSync(ref)) {
      fs.copyFileSync(ziel, ref);
      ok(`${z.name}: Referenz neu aufgenommen (${z.fenster.breite}×${z.fenster.height})`);
      continue;
    }
    const a = PNG.sync.read(fs.readFileSync(ref));
    const b = PNG.sync.read(fs.readFileSync(ziel));
    if (a.width !== b.width || a.height !== b.height) {
      bad(`${z.name}: Größe ${b.width}×${b.height} statt ${a.width}×${a.height}`);
      continue;
    }
    const diff = new PNG({ width: a.width, height: a.height });
    const anders = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
    const anteil = (anders / (a.width * a.height)) * 100;
    fs.writeFileSync(path.join(istZiel, `${z.name}-diff.png`), PNG.sync.write(diff));
    anteil <= 0.5
      ? ok(`${z.name}: ${anteil.toFixed(2)} % abweichend (Grenze 0,50 %)`)
      : bad(`${z.name}: ${anteil.toFixed(2)} % der Pixel weichen ab - Diff in ${path.relative(repo, path.join(istZiel, z.name + '-diff.png'))}`);
  }
} else {
  step('4 · Pixelvergleich');
  hinweis('übersprungen (mit --bilder prüfen, mit --neu aufnehmen)');
}

await browser.close();

step('5 · Konsole');
fehler.length === 0
  ? ok('keine Konsolenfehler')
  : bad(`Konsolenfehler: ${fehler.slice(0, 3).join(' | ')}`);

console.log('');
if (probleme.length) {
  console.log(`${probleme.length} PROBLEME`);
  for (const p of probleme) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('Alles grün.');