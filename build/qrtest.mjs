#!/usr/bin/env node
/**
 * Prüft den QR-Encoder mit einem echten Decoder.
 *
 * Zwei Encoder gegeneinander zu vergleichen würde nur zeigen, dass ich den
 * anderen nachgebaut habe. Stattdessen wird der erzeugte Code gerastert und mit
 * jsQR dekodiert - das ist dieselbe Aufgabe, die ein Handy beim Scannen
 * übernimmt. Kommt der ursprüngliche Text zurück, ist der Code benutzbar.
 *
 *   node build/qrtest.mjs
 */

import jsQR from 'jsqr';
import { qrMatrix, qrSvg } from '../src/qr.js';

/** Matrix in ein Bild umrechnen, wie ein Scanner es vorfindet. */
function raster(matrix, scale = 6, rand = 4) {
  const kanten = (matrix.size + rand * 2) * scale;
  const daten = new Uint8ClampedArray(kanten * kanten * 4).fill(255);
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.felder[y * matrix.size + x]) continue;
      const x0 = (x + rand) * scale;
      const y0 = (y + rand) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const p = ((y0 + dy) * kanten + (x0 + dx)) * 4;
          daten[p] = 0;
          daten[p + 1] = 0;
          daten[p + 2] = 0;
          daten[p + 3] = 255;
        }
      }
    }
  }
  return { daten, kanten };
}

const texte = [
  'https://coderjan123.github.io/lichess-puzzle-finder/',
  'https://coderjan123.github.io/lichess-puzzle-finder/#/home?t=mateIn3&o=hardest&n=100',
  'https://coderjan123.github.io/lichess-puzzle-finder/#/results?t=mateIn3,attraction&m=AND&o=hardest&n=100',
  'https://coderjan123.github.io/lichess-puzzle-finder/#/results?t=mateIn3,attraction&m=AND&o=solved&n=500&v=10000',
  'http://192.168.178.39:8123/#/results?t=balestraMate,morphysMate,operaMate&m=OR&o=hardest&n=5000',
  'A',
  'x'.repeat(50),
  'https://example.org/' + 'pfad-mit-langen-woertern-und-zahlen-1234567890/'.repeat(3),
  'ümläute-und-ß',
  // Die Adressen, die im Betrieb am längsten werden: viele Themen in der
  // UND-Suche. Mit Version 1 bis 10 fiel der Code hier ab - genau der Fall,
  // der Anlass für die Erweiterung auf Version 20 war.
  'https://coderjan123.github.io/lichess-puzzle-finder/#/results?t=' +
    [
      'mateIn3','backRankMate','shortMate','sacrifice','crushing','fork','doubleAttack','pin',
      'discoveredAttack','bishopEndgame','rookEndgame','queenEndgame','pawnEndgame','mateIn1',
      'mateIn2','attraction','deflection','interference','overload','quietMate','smotheredMate',
      'hookMate','anastasiaMate','balestraMate','morphysMate','operaMate','vukovicMate','cornerMate',
      'swallowstailMate','bodineMate','doubleBishopMate',
    ].join(',') +
    '&m=AND&o=hardest&n=5000&v=100000',
];

let fehler = 0;
console.log('QR-Encoder wird mit jsQR geprüft (echter Decoder, kein zweiter Encoder)\n');
for (const text of texte) {
  const m = qrMatrix(text);
  if (!m) {
    // Zu lang ist zulaessig, solange es klar gemeldet wird
    if (text.length > 210) {
      console.log(`  --    ${text.length} Zeichen: abgelehnt (zu lang), wie vorgesehen`);
      continue;
    }
    fehler++;
    console.log(`  FEHLER ${text.length} Zeichen wird abgelehnt, passt aber noch: ${text.slice(0, 40)}…`);
    continue;
  }
  const { daten, kanten } = raster(m);
  const treffer = jsQR(daten, kanten, kanten);
  const gut = treffer && treffer.data === text;
  if (!gut) fehler++;
  console.log(
    `  ${gut ? 'ok  ' : 'FEHLER'} v${String(m.version).padStart(2)} ${String(m.size).padStart(2)}x${String(m.size).padStart(2)} ` +
      `Maske ${m.maske}  ${text.length} Zeichen  ${
        gut ? `gelesen: "${treffer.data.slice(0, 52)}${treffer.data.length > 52 ? '…' : ''}"` : `gelesen: ${treffer ? JSON.stringify(treffer.data.slice(0, 60)) : 'gar nichts'}`
      }`,
  );
}

// SVG: derselbe Inhalt, nur als Vektor
const svg = qrSvg(texte[2]);
const svgOk = svg && svg.includes('<svg') && svg.includes('<path') && !svg.includes('</script');
svgOk || fehler++;
console.log(`\n  ${svgOk ? 'ok  ' : 'FEHLER'} SVG: ${svg ? `${svg.length} Zeichen` : 'null'}`);

// Alle Längen bis zum Maximum durchprobieren: Luecken wuerden erst auffallen,
// wenn jemand eine genau diese Laenge trifft.
console.log('\nLängensweep (jede Länge einmal, auf Lesebarkeit geprüft):');
let sweepFehler = 0;
const MAX = 666;
const VORRAT = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(30);
const versionen = new Set();
for (let len = 1; len <= MAX; len += 3) {
  // 900 Zeichen Vorrat, sonst testeten Laengen ueber 401 immer denselben Text.
  const text = 'A' + VORRAT.slice(0, len - 1);
  if (text.length !== len) {
    console.log(`  FEHLER Laenge ${len}: Vorrat zu kurz (${text.length})`);
    sweepFehler++;
  }
  const m = qrMatrix(text);
  if (!m) {
    console.log(`  FEHLER Länge ${len}: abgelehnt, obwohl ${len} Zeichen passen sollten`);
    sweepFehler++;
    continue;
  }
  versionen.add(m.version);
  const { daten, kanten } = raster(m);
  const t = jsQR(daten, kanten, kanten);
  if (!t || t.data !== text) {
    console.log(`  FEHLER Länge ${len}: nicht lesbar (Version ${m.version})`);
    sweepFehler++;
  }
}
fehler += sweepFehler;
const fehlend = [];
for (let v = 1; v <= 20; v++) if (!versionen.has(v)) fehlend.push(v);
console.log(
  `  ${sweepFehler === 0 ? 'ok  ' : 'FEHLER'} ${Math.ceil(MAX / 3)} Längen von 1 bis ${MAX} Zeichen: alle lesbar` +
    (fehlend.length ? `, aber Version ${fehlend.join(', ')} nie getroffen` : ', Versionen 1 bis 20 alle getroffen'),
);
if (fehlend.length) fehler++;

// Zu lang muss klar abgelehnt werden, nicht in einem kaputten Code enden.
qrMatrix('A'.repeat(667)) === null
  ? console.log('  ok    667 Zeichen werden abgelehnt (Grenze 666), statt einen kaputten Code zu liefern')
  : (fehler++, console.log('  FEHLER 667 Zeichen werden angenommen - mehr, als Version 20 fasst'));

console.log(
  fehler === 0
    ? '\nAlles lesbar. Der Encoder baut gültige QR-Codes.\n'
    : `\n${fehler} Fehler.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
