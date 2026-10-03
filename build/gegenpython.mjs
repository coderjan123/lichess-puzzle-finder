/**
 * Gegenseite zu build/gegenpython.py: liest eine Liste von FENs samt der
 * Zuege, die python-chess dort legal gefunden hat, und schreibt je Stellung
 * die Stellung nach jedem Zug.
 *
 *   node build/gegenpython.mjs soll.json uns.json
 *
 * Geprueft wird nicht die Zugmenge (das macht build/zugtest.mjs), sondern
 * das Ergebnis: kommt die Figur dort an, wo sie sein soll, bleibt das
 * En-passant-Feld richtig, sind die Rochaderechte richtig gepflegt.
 *
 * Genau dieser Vergleich hat den Rochade-Fehler gefunden: 0x07 + 1 liegt
 * ausserhalb des Bretts, der Turm wurde neben das Brett geschrieben, und
 * beide Generatoren machten denselben Fehler.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseFen, legalMoves, moveToUci, makeMove, undoMove, toFen } from '../src/chess.js';

const [, , sollPfad, unsPfad] = process.argv;
if (!sollPfad || !unsPfad) {
  console.error('Aufruf: node build/gegenpython.mjs soll.json uns.json');
  process.exit(2);
}

const soll = JSON.parse(readFileSync(sollPfad, 'utf8'));
const raus = {};

for (const [fen, zuege] of Object.entries(soll)) {
  const pos = parseFen(fen);
  for (const uci of zuege) {
    const zug = legalMoves(pos).find((m) => moveToUci(m) === uci);
    if (zug === undefined) continue;
    makeMove(pos, zug);
    raus[`${fen}|${uci}`] = toFen(pos);
    undoMove(pos);
  }
}

writeFileSync(unsPfad, JSON.stringify(raus));
console.log(`${Object.keys(raus).length} Züge ausgewertet`);