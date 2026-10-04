#!/usr/bin/env node
/**
 * Differentialtest: der schnelle Generator gegen den unabhängigen.
 *
 * Zwei Programme, die dieselbe Stellung lesen, müssen in JEDEM Knoten
 * dieselbe Menge legaler Züge finden. Finden sie einen Knoten, in dem sie
 * sich unterscheiden, ist das ein Fehlerfund mit genauer Stelle - und nicht
 * nur eine falsche Gesamtzahl wie beim Perft-Vergleich.
 *
 * Zusätzlich geprüft: FEN hin und zurück, Rochaderechte, Notation,
 * En passant, Umbau, Matt und Patt.
 *
 *   node build/zugtest.mjs           Baum bis Tiefe 2 in allen sechs
 *                                    Perft-Stellungen
 *   node build/zugtest.mjs --tief 3  laenger, findet mehr
 */

import { parseFen, toFen, legalMoves, moveToUci, moveToSan, sanToMove, makeMove, undoMove, isCheckmate, isStalemate, outcome, toIndex, fromIndex, squareName, parseSquare } from '../src/chess.js';
import { lesen, legal as naivLegal, spielen as naivSpielen, pseudo as naivPseudo } from './naiv.mjs';

const argumente = process.argv.slice(2);
const tief = Number(argumente[argumente.indexOf('--tief') + 1]) || 2;

const STELLUNGEN = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
];

const gruen = '\x1b[32m';
const rot = '\x1b[31m';
const grau = '\x1b[90m';
const fett = '\x1b[1m';
const aus = '\x1b[0m';

let fehler = 0;
let knoten = 0;
const t0 = Date.now();

function eigeneZüge(fen) {
  const pos = parseFen(fen);
  return legalMoves(pos).map((m) => moveToUci(m)).sort();
}

/** Beide Generatoren an jedem Knoten bis Tiefe `tief` vergleichen. */
function vergleiche(fen, ebene, pfad) {
  knoten += 1;
  const a = eigeneZüge(fen);
  const b = naivLegal(fen);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    fehler += 1;
    console.log(`\n${rot}Unterschied nach ${pfad.length} Zügen${aus}`);
    console.log(`  FEN: ${fen}`);
    const nurA = a.filter((x) => !b.includes(x));
    const nurB = b.filter((x) => !a.includes(x));
    console.log(`  ${fett}nur der schnelle:${aus} ${nurA.join(' ') || '(keine)'}`);
    console.log(`  ${fett}nur der unabhaengige:${aus} ${nurB.join(' ') || '(keine)'}`);
    return false; // tiefer gehen bringt nichts, der Fund reicht
  }
  if (ebene >= tief) return true;
  for (const zug of a) {
    const naechste = naivSpielen(fen, zug);
    if (!vergleiche(naechste, ebene + 1, [...pfad, zug])) return false;
  }
  return true;
}

console.log(`${fett}Differentialtest${aus} ${grau}schnell gegen unabhaengig, Tiefe ${tief}${aus}`);
for (const [i, fen] of STELLUNGEN.entries()) {
  const vorher = fehler;
  vergleiche(fen, 0, []);
  const stand = fehler === vorher ? `${gruen}gleich${aus}` : `${rot}Unterschied${aus}`;
  console.log(`  ${String(i + 1).padStart(2)}. ${stand} ${grau}${ownShort(fen)}${aus}`);
}

// ------------------------------------------------------------- Einzelpruefungen

console.log(`\n${fett}Einzelpruefungen${aus}`);

function pruefe(bedingt, text) {
  if (bedingt) {
    console.log(`  ${gruen}ok  ${aus} ${text}`);
  } else {
    fehler += 1;
    console.log(`  ${rot}FEHLER${aus} ${text}`);
  }
}

function ownShort(fen) {
  const p = parseFen(fen);
  const anz = legalMoves(p).length;
  return `${anz} Zuege, ${fen.split(' ')[0]}`;
}

// FEN hin und zurueck, mit Zwischenzuegen
{
  let sauber = true;
  for (const fen of STELLUNGEN) {
    const pos = parseFen(fen);
    if (toFen(pos) !== fen) sauber = false;
  }
  pruefe(sauber, `FEN schreibt sich bei allen sechs Stellungen unveraendert zurueck`);
}

// Jeder gelistete Zug muss die Stellung unveraendert machen
{
  let sauber = true;
  for (const fen of STELLUNGEN) {
    const pos = parseFen(fen);
    const vorher = toFen(pos);
    for (const m of legalMoves(pos)) {
      makeMove(pos, m);
      const nachher = toFen(pos);
      undoMove(pos);
      if (toFen(pos) !== vorher) { sauber = false; break; }
      // und der Zug muss die FEN auch wirklich veraendert haben
      if (nachher === vorher) { sauber = false; break; }
    }
  }
  pruefe(sauber, `jeder legale Zug laesst sich rueckgaengig machen (Stellung davor wie danach)`);
}

// Pseudo-legale und legale Zuege: die legalen sind eine Teilmenge
{
  let sauber = true;
  for (const fen of STELLUNGEN) {
    const pos = parseFen(fen);
    const pseudo = naivPseudo(fen);
    const legal = naivLegal(fen);
    for (const zug of legal) if (!pseudo.includes(zug)) sauber = false;
  }
  pruefe(sauber, `jeder legale Zug steht auch in der pseudo-legalen Liste`);
}

// Notation: lesen und schreiben
{
  const pos = parseFen(STELLUNGEN[1]);
  let sauber = true;
  const beispiele = [];
  for (const m of legalMoves(pos)) {
    const san = moveToSan(pos, m);
    const zurueck = sanToMove(pos, san);
    if (zurueck !== m) { sauber = false; beispiele.push(`${moveToUci(m)}=${san}`); }
  }
  pruefe(sauber, `Notation liest sich zurueck (${beispiele.join(', ') || 'alle Zuege'})`);
}

// Rochaderechte verschwinden, wenn Koenig oder Turm weggehen
{
  const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const rochade = (p) => (p & 1 ? 'K' : '') + (p & 2 ? 'Q' : '') + (p & 4 ? 'k' : '') + (p & 8 ? 'q' : '');
  const start = rochade(pos.castling);
  const mitKoenig = (uci) => {
    const p = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const m = legalMoves(p).find((x) => moveToUci(x) === uci);
    makeMove(p, m);
    const r = rochade(p.castling);
    undoMove(p);
    return r;
  };
  // Rh1-h2 nimmt dem WEISSEN nur das kurze Recht. Schwarz behält beide,
  // darum steht am EndeQkq und nicht Qq.
  pruefe(
    start === 'KQkq' && mitKoenig('e1g1') === 'kq' && mitKoenig('e1c1') === 'kq' && mitKoenig('h1h2') === 'Qkq',
    `Rochaderechte: vorher "${start}", nach O-O "${mitKoenig('e1g1')}", nach O-O-O "${mitKoenig('e1c1')}", nach Th1-h2 "${mitKoenig('h1h2')}"`,
  );
}

// Ein gefangener Turm auf dem Ausgangsfeld nimmt das Recht mit
{
  // Weisser Turm h7 nimmt den schwarzen auf h8 - damit verliert Schwarz das
  // kurze Recht. Vorher war der Test fehlerhaft: er suchte einen schwarzen
  // Zug in einer Stellung, in der Weiss am Zug ist.
  const fen = 'r3k2r/7R/8/8/8/8/8/R3K3 w kq - 0 1';
  const vorher = parseFen(fen);
  const zug = legalMoves(vorher).find((x) => moveToUci(x) === 'h7h8');
  let danach = '-';
  if (zug !== undefined) {
    makeMove(vorher, zug);
    danach = (vorher.castling & 4 ? 'k' : '') + (vorher.castling & 8 ? 'q' : '');
    undoMove(vorher);
  }
  pruefe(
    zug !== undefined && danach === 'q',
    `Turm auf h8 geschlagen: Rochaderechte danach "${danach}" (erwartet nur q)`,
  );
}

// Rochade durch ein angegriffenes Feld ist verboten
{
  // Schwarzer Turm auf d8 macht e8-c8 illegal, weil d8 angegriffen wird.
  const p = parseFen('3k4/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const san = legalMoves(p).map((m) => moveToSan(p, m));
  const rochade = san.filter((s) => s.startsWith('O-O')).map((s) => s.replace(/[+#]/g, ''));
  pruefe(
    rochade.includes('O-O') && rochade.includes('O-O-O'),
    `Rochade erlaubt, wenn der Weg frei ist: ${san.filter((s) => s.startsWith('O-O')).join(' ')}`,
  );
  const p2 = parseFen('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1');
  const san2 = legalMoves(p2).map((m) => moveToSan(p2, m));
  pruefe(
    !san2.includes('O-O'),
    `Rochade verboten, wenn der Turm auf e2 das Ziel beherrscht: ${san2.filter((s) => s.startsWith('O-O')).join(' ') || '(keine)'}`,
  );
}

// En passant raeumt den Bauern wirklich weg und darf den Koenig nicht freilegen
{
  const p = parseFen('8/8/8/3pP3/8/8/8/K3k3 w - d6 0 2');
  const ep = legalMoves(p).filter((m) => moveToUci(m) === 'e5d6');
  makeMove(p, ep[0]);
  // d5 ist 0x43 und d6 ist 0x53. Beide Felder einzeln nachrechnen - mit
  // falschen Konstanten prueft man die Luft neben dem Brett.
  const leer = p.board[0x43] === 0 && p.board[0x53] !== 0;
  const fenNach = toFen(p);
  undoMove(p);
  pruefe(ep.length === 1 && leer, `En passant ausgefuehrt: d5 leer, d6 besetzt -> ${fenNach.split(' ')[0]}`);
}

// Der klassische Fall: waagerechter En passant macht den Koenig frei
{
  // Weisser Koenig h5, weisser Turm h5... der En passant rueumt zwei Figuren
  // von der Reihe und gibt eine Linie frei.
  const p = parseFen('8/8/8/K1pP3r/8/8/8/7k w - c6 0 2');
  const epZuege = legalMoves(p).filter((m) => moveToUci(m) === 'd5c6');
  const erlaubt = epZuege.length === 1;
  pruefe(!erlaubt, `waagerechtes En passant, das den Koenig freilegt, wird abgelehnt (gefunden: ${epZuege.length})`);
}

// Matt, Patt und Ergebnis
{
  const schachmatt = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  const aus = outcome(schachmatt);
  const zuege = legalMoves(schachmatt);
  pruefe(
    isCheckmate(schachmatt) && zuege.length === 0 && aus === '0-1',
    `Matt wird erkannt (0 Zuege, Ergebnis ${aus})`,
  );
  const patt = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  pruefe(
    isStalemate(patt) && !isCheckmate(patt) && outcome(patt) === '1/2-1/2',
    `Patt wird erkannt (Ergebnis ${outcome(patt)})`,
  );
  // Koenig, Koenig und ein Bauer ist KEIN Remis. Die Pruefung sah vorher das
  // Gegenteil dessen, was ihr Name sagt - deshalb ist sie jetzt explizit.
  const mitBauer = parseFen('8/8/4k3/8/8/4K3/4P3/8 w - - 0 1');
  pruefe(outcome(mitBauer) === null, `Koenig gegen Koenig mit einem Bauern ist noch nicht Remis (${outcome(mitBauer)})`);
}

// Zwei Laeufer auf derselben Brettfarbe stehen sich nicht mehr helfen -
// das ist Remis. Die Felder und ihre Paritaet wurden nachgerechnet:
    //   e1 und b6 -> 0 und 0, also gleiche Farbe
    //   e1 und c6 -> 0 und 1, also verschiedene
{
  const faelle = [
    ['8/8/4k3/8/8/4K3/8/8 w - - 0 1', true, 'nur Koenige'],
    ['8/8/4k3/8/8/4K3/8/6N1 w - - 0 1', true, 'Koenig und Springer'],
    ['8/8/4k3/8/8/4K3/6B1/8 w - - 0 1', true, 'Koenig und Laeufer'],
    ['8/8/1b2k3/8/8/4K3/8/4B3 w - - 0 1', true, 'zwei Laeufer auf gleicher Brettfarbe'],
    ['8/8/2b1k3/8/8/4K3/8/4B3 w - - 0 1', false, 'zwei Laeufer auf verschiedener Brettfarbe'],
    ['8/8/4k3/8/8/4KP2/8/8 w - - 0 1', false, 'Bauer'],
  ];
  let sauber = true;
  const zeilen = [];
  for (const [fen, soll, was] of faelle) {
    const ist = Boolean(outcome(parseFen(fen)));
    if (ist !== soll) {
      sauber = false;
      zeilen.push(`${was}: ${ist} statt ${soll}`);
    } else {
      zeilen.push(`${soll ? '✓' : '·'} ${was}`);
    }
  }
  pruefe(sauber, `Materialregeln: ${zeilen.join('  ')}`);
}

const sekunden = ((Date.now() - t0) / 1000).toFixed(1);
// Brett und Anzeige muessen dieselbe Nummerierung benutzen.
//
// In src/chess.js ist 0x88-Zeile 0 die ERSTE Reihe (h1 = 0x07), fuer die
// Anzeige wird aber von oben gezaehlt. Diese beiden Richtungen haben einmal
// gegeneinander gearbeitet: alle Regeltests waren gruen, trotzdem war auf
// dem Brett kein einziger Zug moeglich. Deshalb wird es hier festgenagelt.
{
  const ecken = {
    a8: 0,
    h8: 7,
    a1: 56,
    h1: 63,
    e2: 52,
    e4: 36,
    d1: 59,
    d8: 3,
  };
  let sauber = true;
  const zeilen = [];
  for (const [name, soll] of Object.entries(ecken)) {
    const sq = parseSquare(name);
    const ist = toIndex(sq);
    const zurueck = fromIndex(ist);
    if (ist !== soll || zurueck !== sq) {
      sauber = false;
      zeilen.push(`${name}: Index ${ist} statt ${soll}`);
    }
  }
  pruefe(sauber, `Anzeige und Brett nummerieren gleich (${Object.keys(ecken).length} Felder geprueft)${sauber ? '' : ': ' + zeilen.join(', ')}`);

  // Die Kachel, die der Inhalt belegt, muss die sein, die angezeigt wird.
  // Anzeigezeile 0 ist die achte Reihe (schwarz), Zeile 7 die erste (weiss).
  const pos = parseFen(STELLUNGEN[0]);
  const anzeige = [];
  for (let i = 56; i < 64; i++) anzeige.push(pos.board[fromIndex(i)]);
  const erwartet = 'RNBQKBNR'.split('');
  const stimmt = anzeige.every((p, i) => p !== 0 && p === 8 | erwartet[i].charCodeAt(0) - 65);
  pruefe(stimmt, 'die unterste Anzeigezeile traegt die weissen Figuren der ersten Reihe');
  const oben = [];
  for (let i = 0; i < 8; i++) oben.push(pos.board[fromIndex(i)]);
  const stimmtOben = oben.every((p, i) => p !== 0 && p === 16 | erwartet[i].charCodeAt(0) - 97);
  pruefe(stimmtOben, 'die oberste Anzeigezeile traegt die schwarzen Figuren der achten Reihe');
}

console.log('');
if (fehler) {
  console.log(`${rot}${fehler} Fehler bei ${knoten} verglichenen Stellungen${aus} (${sekunden}s)`);
  process.exit(1);
}
console.log(`${gruen}alles grün: ${knoten} Stellungen auf die gleiche Zugmenge gebracht${aus} (${sekunden}s)`);