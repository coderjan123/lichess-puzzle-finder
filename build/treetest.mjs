#!/usr/bin/env node
/**
 * Prueft den Zugbaum: Pfade, Zweige, Hochziehen, Anzeige und PGN.
 *
 * Der Baum ist das Herz der Seite - ohne ihn kann man keinen Zug zurueck und
 * keine Partie laden. Geprueft wird deshalb jede Zusage, die die Schnittstelle
 * macht: dass ein Pfad stabil bleibt, dass ein zweimal geklickter Zug nicht
 * doppelt im Baum landet, dass Hochziehen keinen Zug verschluckt, und dass
 * PGN hin und zurueck dieselbe Partie ergibt.
 *
 * Zwei Dinge werden hier bewusst hart geprueft, weil sie still falsch
 * ausgehen koennen und dann nichts mehr auffaellt:
 *
 *   - Die Notation kommt aus chess.js. Ein selbstgebautes "Kg1" fuer Rochade
 *     sieht plausibel aus und faellt erst beim Import fremder Partien auf.
 *   - Eine Klammer im PGN wird zweierlei gelesen: "(1... c5)" nach 1. e4 ist
 *     die Alternative zum Zug DANACH, "(2. Bc4)" nach 2. Nf3 die Alternative
 *     zum Zug DAVOR. Wer das verwechselt, haengt die Nebenspur an die
 *     falsche Stelle - und der Baum sieht danach vollstaendig aus.
 *
 *   node build/treetest.mjs
 */

import {
  neuesBaum,
  startFen,
  wurzelPfad,
  kindPfad,
  pfadVonUcis,
  pfadGleich,
  kinder,
  zugHinzufuegen,
  zugPfad,
  pfadZuUci,
  allePfade,
  hauptlinie,
  istHauptlinie,
  pfadZumVater,
  umwandeln,
  zugfolge,
  fenPfad,
  fenBerechnen,
  zeilen,
  aufklappen,
  aktivSetzen,
  pgnExportieren,
  pgnImportieren,
  pgnKopfSetzen,
} from '../src/tree.js';
import { parseFen, toFen, legalMoves, isCheckmate, isStalemate } from '../src/chess.js';

const gruen = '\x1b[32m';
const rot = '\x1b[31m';
const fett = '\x1b[1m';
const aus = '\x1b[0m';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let fehler = 0;
let geprueft = 0;
const t0 = Date.now();

/** Eine Pruefung: entweder gruen oder rot, mit Text. */
function pruefe(bedingt, text) {
  geprueft += 1;
  if (bedingt) {
    console.log(`  ${gruen}ok  ${aus} ${text}`);
  } else {
    fehler += 1;
    console.log(`  ${rot}FEHLER${aus} ${text}`);
  }
  return !!bedingt;
}

function abschnitt(titel) {
  console.log(`\n${fett}${titel}${aus}`);
}

/** Alle UCI-Zugfolgen des Baums, sortiert - der Massstab fuer Rundlauf und Hochziehen. */
function alleZugfolgen(tree) {
  return allePfade(tree)
    .map((p) => zugfolge(tree, p).join(' '))
    .sort();
}

/** Was die Meldung einer Fehlermeldung sagt, oder null wenn nichts fliegt. */
function fehlertext(funktion) {
  try {
    funktion();
    return null;
  } catch (e) {
    return e.message;
  }
}

/** Der Spieltext eines PGN - die letzte nichtleere Zeile. */
function letzteZeile(text) {
  return text.trimEnd().split('\n').pop();
}

/**
 * Ein Zug samt seiner Nebenwege als Text - so, wie die Seite ihn zeichnen
 * wuerde. Ein Eintrag mit `kinder` traegt sie in Klammern hinter sich, ein
 * Eintrag ohne Hauptlinie ist selbst schon eine Nebenlinie.
 */
function zugAlsText(e, inGruppe) {
  const klammer = !e.istHauptlinie && !inGruppe;
  let raus = `${klammer ? '(' : ''}${e.san}`;
  if (e.kinder) raus += ` (${e.kinder.map((k) => zugAlsText(k, true)).join(' ')})`;
  return raus + (klammer ? ')' : '');
}

/** Die Zuege einer Zeile als Text, inklusive der Nebenwege in Klammern. */
function zeileAlsText(zeile) {
  return zeile.zuege.map((e) => zugAlsText(e, false)).join(' ');
}

// ---------------------------------------------------------------- 1. Hauptlinie

abschnitt('1. Hauptlinie anlegen');
{
  const t = neuesBaum();
  const p1 = zugHinzufuegen(t, wurzelPfad(t), 'e2e4');
  const p2 = zugHinzufuegen(t, p1, 'e7e5');
  const p3 = zugHinzufuegen(t, p2, 'g1f3');
  const haupt = hauptlinie(t);
  const san = haupt.map((z) => z.san);

  pruefe(startFen(t) === START, 'die Wurzel merkt sich die FEN der Grundstellung');
  pruefe(pfadGleich(p3, [0, 0, 0]), 'drei Zuege ergeben einen Pfad aus drei Indizes');
  pruefe(haupt.length === 3, `die Hauptlinie hat 3 Zuege (sind ${haupt.length})`);
  pruefe(san.join(' ') === 'e4 e5 Nf3', `SAN der Hauptlinie: ${san.join(' ')}`);
  pruefe(zugfolge(t, p3).join(' ') === 'e2e4 e7e5 g1f3', 'zugfolge() nennt die drei Zuege der Reihe nach');
  pruefe(
    pfadZuUci(t, p3) === 'g1f3' && pfadZuUci(t, wurzelPfad(t)) === null,
    'pfadZuUci() gibt den letzten Zug, an der Wurzel null',
  );
  pruefe(
    pfadZumVater(t, p3) !== null &&
      pfadGleich(pfadZumVater(t, p3), [0, 0]) &&
      pfadZumVater(t, []) === null,
    'pfadZumVater() steigt eine Stufe, an der Wurzel null',
  );
  pruefe(
    kinder(t, p2).length === 1 && kinder(t, p2)[0].kindIndex === 0 && kinder(t, p3).length === 0,
    'kinder() zeigt die Folge, das Blatt hat keine Kinder',
  );
  pruefe(istHauptlinie(t, p3) && istHauptlinie(t, []), 'die Hauptlinie liegt auf der Hauptlinie');
  pruefe(
    pfadVonUcis(t, ['e2e4', 'e7e5', 'g1f3']).length === 3 && pfadVonUcis(t, ['e2e4', 'd7d5']) === null,
    'pfadVonUcis() findet die vorhandene Folge und verweigert die fremde',
  );
  pruefe(
    fenPfad(t, p3) === 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
    `die FEN des Blattes stimmt (ist ${fenPfad(t, p3)})`,
  );
}

// ---------------------------------------------------------------- 2. Zweig

abschnitt('2. Zweig daneben');
{
  const t = neuesBaum();
  const e4 = zugHinzufuegen(t, [], 'e2e4');
  const e5 = zugHinzufuegen(t, e4, 'e7e5');
  zugHinzufuegen(t, e5, 'g1f3');
  // So, wie die Seite es tun wird: Pfad zum Zug holen, dort anhaengen.
  const c5 = zugHinzufuegen(t, zugPfad(t, pfadVonUcis(t, ['e2e4'])), 'c7c5');

  pruefe(pfadGleich(c5, [0, 1]), `der Zweig c5 haengt an e4 als [0,1] (ist [${c5}])`);
  pruefe(hauptlinie(t).map((z) => z.san).join(' ') === 'e4 e5 Nf3', 'die Hauptlinie bleibt bei 3 Zuegen');
  pruefe(!istHauptlinie(t, c5), 'der Zweig ist Hauptlinie-falsch');
  pruefe(kinder(t, e4).length === 2, 'am Zug e4 stehen zwei Kinder');

  const alle = allePfade(t);
  const iH = alle.findIndex((p) => zugfolge(t, p).join(' ') === 'e2e4 e7e5 g1f3');
  const iZ = alle.findIndex((p) => pfadGleich(p, c5));
  pruefe(
    alle.length === 5 && iH >= 0 && iZ > iH,
    `allePfade() stellt die Hauptlinie vor den Zweig (${alle.length} Pfade)`,
  );
  pruefe(
    kindPfad(t, 'e2e4') !== null && pfadZuUci(t, kindPfad(t, 'e2e4')) === 'e2e4' && kindPfad(t, 'a7a6') === null,
    'kindPfad() findet einen Zug der Wurzel und gibt null fuer unbekannte',
  );
  pruefe(
    kindPfad(t, [0, 1]) !== null && kindPfad(t, [0, 5]) === null,
    'kindPfad() nimmt auch einen Pfad entgegen',
  );
  pruefe(
    pfadGleich(zugPfad(t, 'e2e4'), [0]) && pfadGleich(zugPfad(t, pfadVonUcis(t, ['e2e4'])), [0]),
    'zugPfad() gibt vorhandene Pfade unveraendert zurueck',
  );
  const neuAngelegt = zugPfad(t, 'd2d4');
  pruefe(
    pfadGleich(neuAngelegt, [1]) && pfadZuUci(t, neuAngelegt) === 'd2d4',
    'und legt einen unbekannten Zug an der Wurzel an',
  );
}

// ---------------------------------------------------------------- 3. Kein Duplikat

abschnitt('3. Kein Duplikat');
{
  const t = neuesBaum();
  const a = zugHinzufuegen(t, [], 'e2e4');
  const b = zugHinzufuegen(t, [], 'e2e4');
  pruefe(kinder(t, []).length === 1, `derselbe Zug zweimal ergibt 1 Kind (sind ${kinder(t, []).length})`);
  pruefe(pfadGleich(a, b), 'beide Aufrufe liefern denselben Pfad');

  const d4 = zugHinzufuegen(t, [], 'd2d4');
  pruefe(
    kinder(t, []).length === 2 && pfadGleich(d4, [1]) && kinder(t, [])[1].kindIndex === 1,
    'ein zweiter Zug kommt dahinter und traegt seinen Index',
  );
  const tief = zugHinzufuegen(t, d4, 'd7d5');
  const nochmal = zugHinzufuegen(t, d4, 'd7d5');
  pruefe(
    kinder(t, d4).length === 1 && pfadGleich(tief, nochmal) && pfadGleich(tief, [1, 0]),
    'auch an tieferer Stelle wird nichts doppelt',
  );
  pruefe(
    fehlertext(() => zugHinzufuegen(t, [], 'e2e5')) !== null &&
      fehlertext(() => zugHinzufuegen(t, [], 'x')) !== null,
    'ein unmoglicher oder unlesbarer Zug wird abgewiesen, nicht verschluckt',
  );
}

// ---------------------------------------------------------------- 4. Tiefer Zweig

abschnitt('4. Zwei Ebenen von Zweigen');
{
  const t = neuesBaum();
  const e4 = zugHinzufuegen(t, [], 'e2e4');
  zugHinzufuegen(t, e4, 'd7d5'); // Hauptlinie
  zugHinzufuegen(t, e4, 'e7e5'); // erster Zweig
  const e5 = pfadVonUcis(t, ['e2e4', 'e7e5']);
  zugHinzufuegen(t, e5, 'b1c3'); // eigene Folge des Zweigs
  zugHinzufuegen(t, e5, 'g1f3'); // Zweig im Zweig
  const d5 = pfadVonUcis(t, ['e2e4', 'd7d5']);
  zugHinzufuegen(t, d5, 'g1f3'); // Hauptlinie weiter

  const zl = zeilen(t, null).zeilen;
  const erste = zl[0].zuege;
  const z0 = erste[0]; // e4
  const z1 = erste[1]; // d5
  const e5Eintrag = z0.kinder[0];
  const nc3 = z0.kinder[1];
  const nf3Zweig = e5Eintrag.kinder[0];

  pruefe(zl.length === 2, `die Anzeige hat 2 Zeilen (sind ${zl.length})`);
  pruefe(z0.san === 'e4' && z0.spalte === 1 && z0.zeile === 1, 'e4 steht in Zeile 1 an erster Stelle');
  pruefe(z1.san === 'd5' && z1.istHauptlinie && z1.spalte === 2, 'd5 steht daneben und ist Hauptlinie');
  pruefe(e5Eintrag.san === 'e5' && !e5Eintrag.istHauptlinie, 'e5 haengt als Zweig an e4');
  pruefe(nc3.san === 'Nc3' && nc3.spalte === 2, 'die eigene Folge des Zweigs steht dahinter');
  pruefe(nf3Zweig.san === 'Nf3' && !nf3Zweig.istHauptlinie, 'unter e5 haengt ein zweiter Zweig');
  pruefe(
    nc3.zeile === 2 && nf3Zweig.zeile === 2,
    'beide Zweigzuege tragen die Zeilennummer 2 - so zeigt man sie in Klammern',
  );
  pruefe(zl[1].zuege.length === 1 && zl[1].zuege[0].san === 'Nf3', 'Zeile 2 traegt die Hauptlinie');
  pruefe(
    zeileAlsText(zl[0]) === 'e4 (e5 (Nf3) Nc3) d5',
    `die Zeile liest sich als "e4 (e5 (Nf3) Nc3) d5" (ist "${zeileAlsText(zl[0])}")`,
  );
  pruefe(
    zl[1].nummer === 2 && zl[0].nummer === 1,
    'die Zeilen sind von 1 her durchnummeriert',
  );

  // Ab einem Knoten fangen die Zeilen dort neu an.
  const abKnoten = zeilen(t, e4).zeilen;
  pruefe(
    abKnoten.length === 1 && abKnoten[0].nummer === 1 && zeileAlsText(abKnoten[0]) === 'd5 Nf3',
    `zeilen(tree, pfad) beginnt beim Knoten mit Nummer 1 (ist "${zeileAlsText(abKnoten[0])}")`,
  );
  pruefe(
    fehlertext(() => zeilen(t, [0, 0, 9])) !== null,
    'ein Pfad, den es nicht gibt, wird gemeldet',
  );
}

// ---------------------------------------------------------------- 5. Hochziehen

abschnitt('5. Hochziehen ohne Verlust');
{
  const t = neuesBaum();
  const e4 = zugHinzufuegen(t, [], 'e2e4');
  zugHinzufuegen(t, e4, 'e7e5');
  zugHinzufuegen(t, pfadVonUcis(t, ['e2e4', 'e7e5']), 'g1f3');
  const c5 = zugHinzufuegen(t, e4, 'c7c5');
  const vorher = alleZugfolgen(t);

  const neu = umwandeln(t, c5);
  const nachher = alleZugfolgen(t);

  pruefe(
    hauptlinie(t).map((z) => z.san).join(' ') === 'e4 c5',
    `die Hauptlinie ist jetzt e4 c5 (ist "${hauptlinie(t).map((z) => z.san).join(' ')}")`,
  );
  pruefe(pfadGleich(neu, [0, 0]), `der zurueckgegebene Pfad ist der neue [0,0] (ist [${neu}])`);
  pruefe(
    vorher.length === nachher.length && vorher.every((z) => nachher.includes(z)),
    `kein Zug ist verloren: ${vorher.length} Zugfolgen vorher wie nachher`,
  );
  const alterRest = pfadVonUcis(t, ['e2e4', 'e7e5', 'g1f3']);
  pruefe(
    alterRest !== null && !istHauptlinie(t, alterRest),
    'der alte Rest (e4 e5 Nf3) liegt jetzt als Zweig daneben',
  );
  pruefe(kinder(t, e4).map((k) => k.san).join(' ') === 'c5 e5', 'am gehoetzten Knoten steht c5 vorn');
  pruefe(
    allePfade(t).every((p) => pfadZuUci(t, p) !== undefined),
    'alle Pfade zeigen noch auf existierende Knoten',
  );
  pruefe(
    zeilen(t, null).zeilen[0].zuege[0].kinder[0].san === 'e5',
    'die Anzeige zeigt die alte Hauptlinie jetzt als Zweig',
  );
}

// ---------------------------------------------------------------- 6. Bis zur Wurzel

abschnitt('6. Hochziehen bis zur Wurzel und ohne Zweig');
{
  // Zwei erste Zuege - damit ist ueberhaupt etwas zu holen.
  const t = neuesBaum();
  zugHinzufuegen(t, [], 'e2e4'); // [0]
  zugHinzufuegen(t, [], 'd2d4'); // [1]
  zugHinzufuegen(t, [0], 'e7e5');
  zugHinzufuegen(t, [1], 'd7d5');

  const hoch = umwandeln(t, [1]);
  pruefe(
    pfadGleich(hoch, [0]) && hauptlinie(t).map((z) => z.san).join(' ') === 'd4 d5',
    `Hochziehen bis zur Wurzel: die Hauptlinie ist jetzt d4 d5 (ist "${hauptlinie(t).map((z) => z.san).join(' ')}")`,
  );
  const zurueck = umwandeln(t, pfadVonUcis(t, ['e2e4', 'e7e5']));
  pruefe(
    pfadGleich(zurueck, [0, 0]) && hauptlinie(t).map((z) => z.san).join(' ') === 'e4 e5',
    `und wieder zurueck: e4 e5, zurueckgegeben wird der Pfad [${zurueck}] - derselbe Knoten an neuer Stelle`,
  );
  pruefe(kinder(t, []).map((k) => k.san).join(' ') === 'e4 d4', 'beide ersten Zuege sind noch da');
  pruefe(
    pfadVonUcis(t, ['d2d4', 'd7d5']) !== null && !istHauptlinie(t, pfadVonUcis(t, ['d2d4', 'd7d5'])),
    'und d4 d5 liegt jetzt als Zweig daneben',
  );

  // Ein Pfad, der gar nicht abzweigt: kein Fehler, sondern nichts zu tun.
  const vorher = JSON.stringify(alleZugfolgen(t));
  const flach = umwandeln(t, [0]);
  pruefe(pfadGleich(flach, [0]), 'Hochziehen eines Hauptlinienpfades ist ein No-op');
  const flachTief = umwandeln(t, [0, 0]);
  pruefe(pfadGleich(flachTief, [0, 0]), 'auch zwei Ebenen tiefer bleibt die Hauptlinie, wie sie ist');
  const wurzel = umwandeln(t, []);
  pruefe(pfadGleich(wurzel, []) && wurzel.length === 0, 'Hochziehen der Wurzel ist ein No-op');
  pruefe(
    vorher === JSON.stringify(alleZugfolgen(t)) && hauptlinie(t).map((z) => z.san).join(' ') === 'e4 e5',
    'nach den No-ops ist der Baum unveraendert',
  );
}

// ---------------------------------------------------------------- 7. PGN hin und zurueck

abschnitt('7. PGN hin und zurueck');
{
  const t = neuesBaum();
  const e4 = zugHinzufuegen(t, [], 'e2e4');
  zugHinzufuegen(t, e4, 'e7e5');
  zugHinzufuegen(t, pfadVonUcis(t, ['e2e4', 'e7e5']), 'g1f3');
  const c5 = zugHinzufuegen(t, e4, 'c7c5');
  zugHinzufuegen(t, c5, 'g1f3');
  zugHinzufuegen(t, pfadVonUcis(t, ['e2e4', 'c7c5', 'g1f3']), 'b8c6');
  zugHinzufuegen(t, c5, 'b1c3'); // Zweig im Zweig
  pgnKopfSetzen(t, { White: 'Weiss', Black: 'Schwarz', Event: 'Testpartie', Date: '2026.01.01' });

  const text = pgnExportieren(t);
  const spieltext = letzteZeile(text);
  pruefe(text.includes('(') && text.includes(')'), 'der Text enthaelt Klammern');
  pruefe(
    text.includes('[Event "Testpartie"]') && text.includes('[White "Weiss"]') && text.includes('[Result "*"]'),
    'der Kopf steht drin',
  );
  pruefe(
    spieltext === '1. e4 (1... c5 (2. Nc3) 2. Nf3 Nc6) e5 2. Nf3 *',
    `Spieltext: ${spieltext}`,
  );

  const g = pgnImportieren(text);
  pruefe(g.fehler === null, 'der Import meldet keinen Fehler');
  pruefe(
    JSON.stringify(alleZugfolgen(g.tree)) === JSON.stringify(alleZugfolgen(t)),
    `die Menge aller Zugfolgen ist gleich (${allePfade(g.tree).length} Pfade)`,
  );
  pruefe(
    hauptlinie(g.tree).map((z) => z.san).join(' ') === hauptlinie(t).map((z) => z.san).join(' '),
    'die Hauptlinie ist gleich',
  );
  pruefe(
    g.kopf.White === 'Weiss' && g.kopf.Black === 'Schwarz' && g.kopf.Event === 'Testpartie',
    'der Kopf kommt zurueck',
  );
  // Ein zweiter Durchgang ist nicht buchstabengleich: im PGN steht eine
  // Klammer VOR dem Zug, den sie ersetzt, beim Einlesen kommt der danach an
  // die erste Stelle. Die Zuege muessen dabei gleich bleiben.
  const g2 = pgnImportieren(pgnExportieren(g.tree));
  pruefe(
    JSON.stringify(alleZugfolgen(g2.tree)) === JSON.stringify(alleZugfolgen(g.tree)),
    'ein zweiter Durchgang aendert nichts an der Zugmenge',
  );
  pruefe(
    hauptlinie(g2.tree).map((z) => z.san).join(' ') === hauptlinie(g.tree).map((z) => z.san).join(' '),
    'und nichts an der Hauptlinie',
  );

  // Ohne Zweige.
  const glatt = neuesBaum();
  let p = [];
  for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6']) p = zugHinzufuegen(glatt, p, uci);
  const glattText = pgnExportieren(glatt);
  pruefe(
    letzteZeile(glattText) === '1. e4 e5 2. Nf3 Nc6 *',
    `ohne Zweige steht nur die Hauptlinie da: "${letzteZeile(glattText)}"`,
  );
  pruefe(
    hauptlinie(pgnImportieren(glattText).tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3 Nc6',
    'eine glatte Partie kommt unbeschaedigt zurueck',
  );

  // Zeitangaben in Klammern sind Muell fuer uns, aber kein Grund zu scheitern.
  const mitRest = pgnImportieren('[Result "1-0"]\n\n1. e4 {[%clk 0:05:00]} e5 { [%clk 0:05:01] } 2. Nf3 1-0');
  pruefe(
    hauptlinie(mitRest.tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3',
    'Zeitangaben in Klammern werden uebersprungen',
  );
  pruefe(mitRest.ergebnis === '1-0' && mitRest.kopf.Result === '1-0', 'das Ergebnis 1-0 wird gelesen');

  for (const ergebnis of ['1-0', '0-1', '1/2-1/2', '*']) {
    const e = pgnImportieren(`1. e4 e5 2. Nf3 ${ergebnis}`);
    pruefe(
      e.ergebnis === ergebnis && pgnExportieren(e.tree).endsWith(`${ergebnis}\n`),
      `das Ergebnis ${ergebnis} wird gelesen und wieder geschrieben`,
    );
  }
}

// ---------------------------------------------------------------- 8. Kommentare

abschnitt('8. Kommentare werden uebersprungen');
{
  const g = pgnImportieren('1. e4 { ein Kommentar } e5 ; Zeilenkommentar');
  pruefe(
    hauptlinie(g.tree).map((z) => z.san).join(' ') === 'e4 e5',
    'Zuege neben und hinter Kommentaren werden gelesen',
  );
  const n = pgnImportieren('1. e4 { ein { verschachtelter } Kommentar } e5');
  pruefe(hauptlinie(n.tree).length === 2, 'verschachtelte Klammern storen nicht');

  const voll = pgnImportieren(
    '[Event "K"]\n\n1. d4 { Sie sind am Zug } d5 (1... Nf6 { } ) 2. c4 { [%clk 0:03] }',
  );
  const text = JSON.stringify(voll.tree);
  pruefe(!text.includes('Kommentar') && !text.includes('am Zug'), 'kein Kommentartext steht im Baum');
  pruefe(
    hauptlinie(voll.tree).map((z) => z.san).join(' ') === 'd4 d5 c4',
    'die Hauptlinie bleibt auch mit Kommentaren richtig',
  );
  pruefe(allePfade(voll.tree).length === 5, 'die Nebenlinie auch');
  pruefe(
    !JSON.stringify(pgnExportieren(voll.tree)).includes('am Zug'),
    'und sie landen auch nicht wieder im Export',
  );

  const ende = pgnImportieren('1. e4 e5 ;Kommentar bis zum Textende ohne Zeilenumbruch');
  pruefe(hauptlinie(ende.tree).length === 2, 'ein Kommentar bis zum Ende stört nicht');
  const kurz = pgnImportieren('1. e4 { ungeschlossen und dann Schluss');
  pruefe(hauptlinie(kurz.tree).length === 1, 'ein Kommentar ohne Schlussklammer stört nicht');
}

// ---------------------------------------------------------------- 9. Kaputtes PGN

abschnitt('9. Kaputtes PGN wird abgewiesen');
{
  const faelle = [
    ['this is not pgn', /"this".*kein legaler Zug/],
    ['1. e4 e9', /"e9".*kein legaler Zug/],
    ['[Event', /Kopfzeile/],
    ['[Event "Test", kaputt', /Kopfzeile/],
    ['[Event "Test" Spieltext ohne Klammer', /Kopfzeile/],
    ['1. e4 e5 2. Nf3 (2. Bc4 Nf6', /Klammer/],
    ['1. e4 e5 2. Nf3 2. Nf3', /kein legaler Zug/],
    ['1. e4 e5 2. Bh5', /Bh5.*kein legaler Zug/],
    ['1. e4 ) e5', /ohne/],
    ['( 1. e4', /vor dem ersten Zug/],
    ['[FEN "kaputt"]\n\n1. e4', /FEN/],
    ['[Event "Nur ein Kopf"]', /kein einziger Zug/],
    ['', /leer/],
  ];
  for (const [text, muster] of faelle) {
    const m = fehlertext(() => pgnImportieren(text));
    pruefe(m !== null && muster.test(m), `"${text.split('\n')[0].slice(0, 26)}" -> ${m}`);
  }
  const mitZeile = fehlertext(() => pgnImportieren('[Event "x"]\n\n1. e4 e5 2. Bh5'));
  pruefe(mitZeile !== null && mitZeile.includes('Zeile 3'), `die Meldung nennt die Zeile: ${mitZeile}`);
  // Zugnummern werden nicht geprueft - dafuer gibt es keinen Grund.
  const falschNummeriert = pgnImportieren('1. e4 e5 9. Nf3 47. Nc6');
  pruefe(
    hauptlinie(falschNummeriert.tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3 Nc6',
    'falsche Zugnummern sind kein Fehler - sie werden uebersprungen',
  );

  // Die Klammer richtig aufhaengen - beide Lesarten. Eine Klammer ersetzt
  // den Zug, der danach kommt; geht das nicht, ersetzt sie den davor.
  const gleicheSeite = pgnImportieren('1. e4 e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6');
  pruefe(
    hauptlinie(gleicheSeite.tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3 Nc6' &&
      pfadVonUcis(gleicheSeite.tree, ['e2e4', 'e7e5', 'f1c4', 'g8f6']) !== null,
    '(2. Bc4) nach 2. Nf3 haengt an 2. Nf3 - es ist die Alternative zu 2. Nf3',
  );
  const andereSeite = pgnImportieren('1. e4 e5 2. Nf3 (2... Bc5) 2... Nc6');
  pruefe(
    hauptlinie(andereSeite.tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3 Nc6' &&
      pfadVonUcis(andereSeite.tree, ['e2e4', 'e7e5', 'g1f3', 'f8c5']) !== null,
    '(2... Bc5) nach 2. Nf3 haengt an 2... Nc6 - es ist die Alternative zu 2... Nc6',
  );
  const nachE4 = pgnImportieren('1. e4 (1... c5 2. Nf3 Nc6) e5 2. Nf3');
  pruefe(
    hauptlinie(nachE4.tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3' &&
      pfadVonUcis(nachE4.tree, ['e2e4', 'c7c5', 'g1f3', 'b8c6']) !== null,
    '(1... c5) nach 1. e4 ist die Alternative zu 1... e5',
  );
  const verschachtelt = pgnImportieren('1. e4 (1... c5 (2. Nc3) 2. Nf3 Nc6) e5 2. Nf3');
  pruefe(
    pfadVonUcis(verschachtelt.tree, ['e2e4', 'c7c5', 'b1c3']) !== null &&
      pfadVonUcis(verschachtelt.tree, ['e2e4', 'c7c5', 'g1f3', 'b8c6']) !== null,
    'eine Klammer in der Klammer landet an c5, nicht an e4',
  );
}

// ---------------------------------------------------------------- 10. Notation

abschnitt('10. Die Notation kommt aus chess.js');
{
  const g = pgnImportieren('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7');
  const san = hauptlinie(g.tree).map((z) => z.san);
  const soll = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
  pruefe(san.join(' ') === soll.join(' '), `SAN der Spanischen: ${san.join(' ')}`);
  pruefe(san.includes('O-O') && !san.some((s) => /^[Kk]g1$/.test(s)), 'die Rochade heisst O-O und nicht Kg1');
  pruefe(
    letzteZeile(pgnExportieren(g.tree)) === '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *',
    'der Export schreibt dieselbe Partie',
  );

  const ohneZiffern = pgnImportieren('1. Nf3 d5 2. Ng1 Nf6 3. Nc3');
  pruefe(
    hauptlinie(ohneZiffern.tree).map((z) => z.san).join(' ') === 'Nf3 d5 Ng1 Nf6 Nc3',
    'ohne Datei, weil keine Unterscheidung noetig ist',
  );
  const mitDatei = pgnImportieren('[FEN "4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1"]\n\n1. Nbd2 Kd8 2. Ng1');
  pruefe(
    hauptlinie(mitDatei.tree).map((z) => z.san).join(' ') === 'Nbd2 Kd8 Ng1',
    `zwei Springer, die dasselbe Feld erreichen: die Datei wird genannt (${hauptlinie(mitDatei.tree).map((z) => z.san).join(' ')})`,
  );
  const mitSchlag = pgnImportieren('1. e4 d5 2. exd5 Qxd5');
  pruefe(
    hauptlinie(mitSchlag.tree).map((z) => z.san).join(' ') === 'e4 d5 exd5 Qxd5',
    'Schlaege bekommen ihr x',
  );
  const matt = pgnImportieren('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#');
  pruefe(hauptlinie(matt.tree).map((z) => z.san).pop() === 'Qxf7#', 'das Mattzeichen sitzt am Zug');
  const schach = pgnImportieren('[FEN "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 1 3"]\n\n1. Qxe5+ Be7');
  pruefe(
    hauptlinie(schach.tree).map((z) => z.san).join(' ') === 'Qxe5+ Be7',
    `das Schachzeichen sitzt am Zug (${hauptlinie(schach.tree).map((z) => z.san).join(' ')})`,
  );
  // Umlaute und Ausrufezeichen sind Muell fuer uns, aber kein Fehler.
  const mitZeichen = pgnImportieren('1. e4 e5 2. Nf3!? Nc6?!');
  pruefe(
    hauptlinie(mitZeichen.tree).map((z) => z.san).join(' ') === 'e4 e5 Nf3 Nc6',
    'Ausrufe- und Fragezeichen werden abgeschnitten',
  );
}

// ---------------------------------------------------------------- 11. Matt und Remis

abschnitt('11. Matt und Remis');
{
  // Der Damenmattschluss des Bauern: die Dame zieht von d8 nach h4.
  const vorMatt = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
  const t = neuesBaum(vorMatt);
  const m = zugHinzufuegen(t, [], 'd8h4');
  pruefe(hauptlinie(t)[0].san === 'Qh4#', `der Matzzug heisst Qh4# (ist "${hauptlinie(t)[0].san}")`);
  const ende = fenPfad(t, m);
  pruefe(isCheckmate(parseFen(ende)) && legalMoves(parseFen(ende)).length === 0, 'danach ist die Partie aus');
  const danach = fehlertext(() => zugHinzufuegen(t, m, 'e1f2'));
  pruefe(danach !== null && /nicht moeglich/.test(danach), `ein Zug nach dem Matt wird abgewiesen: ${danach}`);
  pruefe(pgnExportieren(t).includes('1... Qh4# 0-1'), 'das Ergebnis 0-1 steht im PGN');

  // Die Endstellung, die mitgegeben war, ist der Zug DANACH - dort ist
  // schon alles aus. Auch das wird geprueft, samt der Erklaerung, warum
  // dort kein Zug mehr hineingeht.
  const gegebene = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
  const m2 = neuesBaum(gegebene);
  pruefe(ende === gegebene, 'die FEN nach Qh4# ist genau die mitgegebene Endstellung');
  pruefe(
    isCheckmate(parseFen(gegebene)) && legalMoves(parseFen(gegebene)).length === 0,
    'die mitgegebene Stellung ist bereits Matt',
  );
  const d8 = fehlertext(() => zugHinzufuegen(m2, [], 'd8h4'));
  pruefe(d8 !== null && /nicht moeglich/.test(d8), `d8h4 ist dort kein Zug mehr (d8 ist leer): ${d8}`);
  pruefe(
    fehlertext(() => zugPfad(m2, 'd2d4')) !== null,
    'und gar kein Zug ist moeglich - auch nicht ueber zugPfad',
  );

  // Remis: Patt.
  const patt = '7k/5Q2/5K2/8/8/8/8/8 b - - 0 1';
  const p = neuesBaum(patt);
  pruefe(
    legalMoves(parseFen(patt)).length === 0 && isStalemate(parseFen(patt)),
    'die Stellung ist ein Patt',
  );
  pruefe(pgnExportieren(p).includes('1/2-1/2'), 'das Remis steht im PGN');
  pruefe(fenPfad(p, []) === patt, 'die FEN bleibt beim Import unveraendert');

  // Ein Remis aus materieller Sicht beendet die Partie nicht.
  const laufend = neuesBaum('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  zugHinzufuegen(laufend, [], 'e1f2');
  pruefe(pgnExportieren(laufend).trim().endsWith('*'), 'eine weitergehende Partie endet mit *');

  // Und es laesst sich wieder weiterspielen, was der Matt-Zug verbietet.
  const m3 = neuesBaum(vorMatt);
  const weiter = zugHinzufuegen(m3, [], 'd8h4');
  pruefe(weiter.length === 1 && hauptlinie(m3).length === 1, 'vor dem Matzzug geht es noch weiter');
}

// ---------------------------------------------------------------- 12. Sonderzuege

abschnitt('12. Sonderzuege im PGN');
{
  const faelle = [
    ['Rochade kurz', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', '1. O-O O-O-O', ['O-O', 'O-O-O']],
    ['Rochade lang', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', '1. O-O-O O-O', ['O-O-O', 'O-O']],
    ['En passant', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', '1. exd6 Kd7', ['exd6', 'Kd7']],
    ['Umbau zu Springer', '4k3/1P6/5n2/8/8/8/8/4K3 w - - 0 1', '1. b8=N Nd5', ['b8=N', 'Nd5']],
    // Die Dame auf b8 gibt dem schwarzen Koenig sofort Schach - das prueft
    // gleich mit, dass das Pluszeichen sitzt.
    ['Umbau zu Dame', '4k3/1P6/5n2/8/8/8/8/4K3 w - - 0 1', '1. b8=Q+ Kf7', ['b8=Q+', 'Kf7']],
    ['En passant mit Ausholen', '4k3/8/3p4/2p1P3/8/8/8/4K3 w - c6 0 2', '1. exd6', ['exd6']],
    ['Doppelritt', '4k3/8/8/8/8/8/P6P/4K3 w - - 0 1', '1. a4 Kd8 2. h4', ['a4', 'Kd8', 'h4']],
  ];
  for (const [name, fen, text, soll] of faelle) {
    const g = pgnImportieren(`[FEN "${fen}"]\n\n${text} *`);
    const san = hauptlinie(g.tree).map((z) => z.san);
    const raus = pgnExportieren(g.tree);
    const nochmal = pgnImportieren(raus);
    pruefe(san.join(' ') === soll.join(' '), `${name}: ${san.join(' ')}${san.join(' ') === soll.join(' ') ? '' : ` (soll: ${soll.join(' ')})`}`);
    pruefe(
      hauptlinie(nochmal.tree).map((z) => z.san).join(' ') === san.join(' '),
      `${name}: ueber den Export unveraendert`,
    );
    pruefe(fenPfad(nochmal.tree, []) === fen, `${name}: die FEN stimmt nach dem Rundlauf`);
    pruefe(raus.includes('[FEN') && raus.includes('[SetUp "1"]'), `${name}: die FEN steht im Kopf`);
  }

  // Der Fall, den legalMoves nicht kennen kann: ein Bauer schlaegt nach
  // hinten. In chess.js erzeugt der Zuggenerator das nie - in einer Aufgabe
  // kann es trotzdem dastehen.
  const rueckwaerts = '4k3/8/8/1P6/r7/8/8/4K3 w - - 0 1';
  pruefe(
    legalMoves(parseFen(rueckwaerts)).every((m) => m < 0 || !m) ||
      !legalMoves(parseFen(rueckwaerts)).includes(0x1d << 7 | 0x13),
    'legalMoves kennt b5a4 nicht - dafuer gibt es die eigene Loesung',
  );
  const g = pgnImportieren(`[FEN "${rueckwaerts}"]\n\n1. bxa4 Kd7 *`);
  pruefe(
    hauptlinie(g.tree).map((z) => z.san).join(' ') === 'bxa4 Kd7',
    'ein Bauer, der nach hinten schlaegt, laesst sich lesen und schreiben',
  );
  pruefe(
    pfadVonUcis(g.tree, ['b5a4']) !== null && zugfolge(g.tree, [0])[0] === 'b5a4',
    'er steht auch als UCI im Baum',
  );
  pruefe(fenPfad(g.tree, [0]) === '4k3/8/8/8/P7/8/8/4K3 b - - 0 1', 'die Stellung nach dem Sonderschlag stimmt');
  pruefe(
    hauptlinie(pgnImportieren(pgnExportieren(g.tree)).tree).map((z) => z.san).join(' ') === 'bxa4 Kd7',
    'und er ueberlebt den PGN-Rundlauf',
  );
  const t = neuesBaum(rueckwaerts);
  const pfad = zugHinzufuegen(t, [], 'b5a4');
  pruefe(hauptlinie(t)[0].san === 'bxa4' && pfad.length === 1, 'auch im Baum laesst er sich anlegen');
  pruefe(fehlertext(() => zugHinzufuegen(t, [], 'b5b6')) === null, 'der normale Bauerzug daneben geht auch');
}

// ---------------------------------------------------------------- 13. Tiefe

abschnitt('13. Tiefe Grenze');
{
  const t = neuesBaum();
  let pfad = [];
  for (let i = 0; i < 50; i++) {
    for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) pfad = zugHinzufuegen(t, pfad, uci);
  }
  pruefe(pfad.length === 200, `200 Zuege ohne Zusammenbruch (sind ${pfad.length})`);
  pruefe(zugfolge(t, pfad).length === 200, 'zugfolge() nennt alle 200');
  pruefe(hauptlinie(t).length === 200, 'die Hauptlinie ist 200 Zuege lang');
  pruefe(
    istHauptlinie(t, pfad) && pfadZuUci(t, pfad) === 'f6g8' && pfadZumVater(t, pfad).length === 199,
    'Pfad und Vater stimmen am Ende',
  );
  fenBerechnen(t);
  pruefe(fenPfad(t, []) === START && zugfolge(t, pfad)[199] === 'f6g8', 'die FEN-Kette haelt bei 200 Zuegen');
  const zl = zeilen(t, null).zeilen;
  pruefe(
    zl.length === 100 && zl[99].zuege.length === 2 && zl[99].zuege[1].san === 'Ng8',
    `die Anzeige ergibt 100 Zeilen a 2 Zuegen (sind ${zl.length})`,
  );
  const g = pgnImportieren(pgnExportieren(t));
  pruefe(
    hauptlinie(g.tree).length === 200 && hauptlinie(g.tree).every((z) => !/[+#]/.test(z.san)),
    '200 Zuege ueberleben den PGN-Rundlauf',
  );
  pruefe(
    zugfolge(g.tree, pfadVonUcis(g.tree, zugfolge(t, pfad))).join(' ') === zugfolge(t, pfad).join(' '),
    'und kommen in derselben Reihenfolge zurueck',
  );
}

// ---------------------------------------------------------------- Zusatz

abschnitt('Zusatz: Anzeigezustand, FEN-Kette, Kopf');
{
  const t = neuesBaum();
  const e4 = zugHinzufuegen(t, [], 'e2e4');
  zugHinzufuegen(t, e4, 'e7e5');
  zugHinzufuegen(t, e4, 'c7c5');
  const e5 = pfadVonUcis(t, ['e2e4', 'e7e5']);
  zugHinzufuegen(t, e5, 'g1f3');

  aktivSetzen(t, e5);
  const alle = [];
  const sammle = (liste) => {
    for (const e of liste) {
      alle.push(e);
      if (e.kinder) sammle(e.kinder);
    }
  };
  zeilen(t, null).zeilen.forEach((z) => sammle(z.zuege));
  pruefe(
    alle.filter((e) => e.aktiv).map((e) => e.san).join(' ') === 'e4 e5',
    `"aktiv" heisst: der aktuelle Pfad laeuft hier durch - bei e5 also e4 und e5 (sind ${alle.filter((e) => e.aktiv).map((e) => e.san).join(' ')})`,
  );
  pruefe(
    alle.filter((e) => !e.aktiv).map((e) => e.san).join(' ') === 'c5 Nf3',
    'der Zweig c5 und der Zug danach tragen es nicht',
  );
  aktivSetzen(t, e4);
  alle.length = 0;
  zeilen(t, null).zeilen.forEach((z) => sammle(z.zuege));
  pruefe(
    alle.filter((e) => e.aktiv).map((e) => e.san).join(' ') === 'e4',
    'mit aktivem Pfad [0] traegt nur e4 das Zeichen',
  );

  aufklappen(t, e4, false);
  const zu = zeilen(t, null).zeilen;
  pruefe(
    !zu[0].zuege[0].kinder && zu[0].zuege[0].aufgeklappt === false,
    'zugeklappt fehlt die Nebenspur in der Anzeige',
  );
  pruefe(
    zeileAlsText(zeilen(t, e4).zeilen[0]) === 'e5 Nf3',
    'sichtbarAbKnoten zeigt alles unterhalb trotzdem',
  );
  aufklappen(t, e4, true);
  pruefe(zeilen(t, null).zeilen[0].zuege[0].kinder.length === 1, 'und wieder aufgeklappt ist sie da');
  pruefe(
    fehlertext(() => aufklappen(t, [], false)) !== null,
    'ein Knoten ohne Zweig laesst sich nicht zuklappen',
  );

  // Die FEN-Kette unabhaengig nachrechnen: fenBerechnen() laeuft von der
  // Wurzel aus tief zuerst mit makeMove und undoMove.
  const u = neuesBaum();
  let p = [];
  for (const uci of ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7']) {
    p = zugHinzufuegen(u, p, uci);
  }
  fenBerechnen(u);
  pruefe(fenPfad(u, []) === START, 'fenBerechnen() laesst die Wurzel unberuehrt');
  pruefe(
    toFen(parseFen(fenPfad(u, p))).split(' ')[1] === 'w' &&
      legalMoves(parseFen(fenPfad(u, p))).length === 25,
    `die Stellung am Ende ist weiss am Zug mit 25 legalen Zuegen - die Kette stimmt (${fenPfad(u, p)})`,
  );
  pruefe(
    hauptlinie(u).map((z) => z.san).join(' ') === 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7',
    'und die Notation der ganzen Kette',
  );

  pgnKopfSetzen(u, { White: 'Liss', Black: 'Kieslowski', Event: 'Match' });
  const kopf = pgnExportieren(u);
  pruefe(
    kopf.includes('[White "Liss"]') && kopf.includes('[Black "Kieslowski"]') && kopf.includes('[Event "Match"]'),
    'pgnKopfSetzen() merkt sich Namen, und der Export schreibt sie',
  );
  pruefe(startFen(u) === START, 'startFen() bleibt die Grundstellung');
  pruefe(fehlertext(() => pgnKopfSetzen(u, 'kein Objekt')) !== null, 'ein Kopf muss ein Objekt sein');
}

// ---------------------------------------------------------------- Ende

const sekunden = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
if (fehler) {
  console.log(`${rot}${fehler} von ${geprueft} Pruefungen fehlgeschlagen${aus} (${sekunden}s)`);
  process.exit(1);
}
console.log(`${gruen}${geprueft} Pruefungen gruen${aus} (${sekunden}s)`);
console.log(`${gruen}${fett}Alles gruen.${aus}`);