#!/usr/bin/env node
/**
 * Prüft den Zuggenerator gegen publicierte Perft-Zahlen.
 *
 * Perft zählt, wie viele verschiedene Zugbäume eine Stellung bis zu einer
 * bestimmten Tiefe hat. Diese Zahlen sind für etliche bekannte Stellungen
 * veröffentlicht und seit Jahrzehnten stabil - sie sind das, was
 * Schachprogramme gegeneinander messen. Stimmt unsere Zählung, stimmt der
 * Generator: Rochade durch ein angegriffenes Feld, En passant, Umbau, Matt,
 * Patt und alle drei Figurarten werden dabei zwangsläufig mitgeprüft.
 *
 *   node build/perft.mjs           Standard: sechs Stellungen, Tiefe 4
 *   node build/perft.mjs --tief 5  mehr Tiefe, dauert deutlich laenger
 *   node build/perft.mjs --nur 2   nur die zweite Stellung (Rochade und so)
 */

import { parseFen, perft, toFen, legalMoves, moveToSan } from '../src/chess.js';

/**
 * Die sechs Standardstellungen aus dem "Chess Programming Wiki"-Perft.
 *
 * Jede ist fuer einen bestimmten Fall da:
 *   1 Grundstellung, alle Figurarten
 *   2 alle Rochaden, En passant, Aufgaben mit Matt und Ablenkung
 *   3 En passant,inga-Bauern auf der 2. Reihe
 *   4 alle vier Umbauprofile, drei Maeter
 *   5 Schlag mit Schlag, Gabel mit Schlag
 *   6 ruhige Züge, bis hinunter zu Matt
 */
const STELLUNGEN = [
  {
    name: 'Anfangszug',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    werte: [20, 400, 8902, 197281, 4865609],
  },
  {
    name: 'Kiwi-Pete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    werte: [48, 2039, 97862, 4085603],
  },
  {
    name: 'En passant und Bauern auf der zweiten',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    werte: [14, 191, 2812, 43238, 674624],
  },
  {
    name: 'Alle vier Umbauprofile',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    werte: [6, 264, 9467, 422333],
  },
  {
    name: 'Schlag mit Schlag, Gabel mit Schlag',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    werte: [44, 1486, 62379, 2103487],
  },
  {
    name: 'Ruhige Stellung bis hinunter zum Matt',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    werte: [46, 2079, 89890, 3894594],
  },
];

const argumente = process.argv.slice(2);
const tief = Number(argumente[argumente.indexOf('--tief') + 1]) || 0;
const nur = argumente.includes('--nur') ? Number(argumente[argumente.indexOf('--nur') + 1]) : null;

const gruen = '\x1b[32m';
const rot = '\x1b[31m';
const grau = '\x1b[90m';
const fett = '\x1b[1m';
const aus = '\x1b[0m';

let fehler = 0;
let geprueft = 0;
const t0 = Date.now();

for (const [i, stellung] of STELLUNGEN.entries()) {
  if (nur !== null && i + 1 !== nur) continue;
  const hoehe = tief || Math.min(4, stellung.werte.length);
  const pos = parseFen(stellung.fen);
  console.log(`\n${fett}${stellung.name}${aus}  ${grau}${stellung.fen}${aus}`);
  for (let tiefe = 1; tiefe <= hoehe; tiefe++) {
    const ist = perft(pos, tiefe);
    const soll = stellung.werte[tiefe - 1];
    geprueft += 1;
    if (ist === soll) {
      console.log(`  ${gruen}ok  ${aus} Tiefe ${tiefe}: ${ist.toLocaleString('en-US')}`);
    } else {
      fehler += 1;
      console.log(`  ${rot}FEHLER${aus} Tiefe ${tiefe}: ${ist.toLocaleString('en-US')} statt ${soll.toLocaleString('en-US')}`);
    }
  }
  // Nebenbei: FEN muss die Runde ueberstehen. Ein Generator, der die
  // Stellung beim Bauen kaputt macht, faellt hier sofort auf.
  const hin = toFen(pos);
  const wieder = toFen(parseFen(hin));
  const fenOk = hin === stellung.fen;
  geprueft += 1;
  if (!fenOk) {
    fehler += 1;
    console.log(`  ${rot}FEHLER${aus} FEN hin: ${hin}`);
  } else if (wieder !== hin) {
    fehler += 1;
    console.log(`  ${rot}FEHLER${aus} FEN hin und zurück unterscheiden sich`);
  } else {
    console.log(`  ${gruen}ok  ${aus} FEN liest und schreibt sich unverändert zurück`);
  }
}

// Sanity: ein Zugbaum muss bei jeder Stellung mit der Anzahl legaler Züge
// beginnen. Damit faellt auch ein Fehler auf, der sich in jeder Stellung
// gleichmaessig ausgleicht.
if (nur === null) {
  const start = parseFen(STELLUNGEN[0].fen);
  const zuege = legalMoves(start);
  const san = zuege.map((m) => moveToSan(start, m));
  const erwartet = ['a3', 'a4', 'b3', 'b4', 'c3', 'c4', 'd3', 'd4', 'e3', 'e4', 'f3', 'f4', 'g3', 'g4', 'h3', 'h4', 'Na3', 'Nc3', 'Nf3', 'Nh3'];
  geprueft += 1;
  const sortiert = [...san].sort();
  const sollSortiert = [...erwartet].sort();
  if (sortiert.join(' ') === sollSortiert.join(' ')) {
    console.log(`\n${gruen}ok  ${aus} Anfangszüge stimmen in der Notation: ${san.slice(0, 8).join(' ')} …`);
  } else {
    fehler += 1;
    console.log(`\n${rot}FEHLER${aus} Anfangszüge: ${sortiert.join(' ')}`);
  }
}

const sekunden = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
if (fehler) {
  console.log(`${rot}${fehler} von ${geprueft} Prüfungen fehlgeschlagen${aus} (${sekunden}s)`);
  process.exit(1);
}
console.log(`${gruen}${geprueft} Prüfungen grün${aus} (${sekunden}s)`);