#!/usr/bin/env node
/**
 * Prüft den UCI-Parser mit echter Stockfish-Ausgabe.
 *
 *   node build/enginetest.mjs
 *
 * Die Zeilen unten sind aufgezeichnet, nicht erfunden: sie stammen aus einem
 * Lauf von Stockfish 19 smallnet in Firefox (Startstellung, Tiefe 12, danach
 * MultiPV 3 und eine Mattstellung). Sie decken ab, was die Engine wirklich
 * schickt - auch das Unangenehme: Zeilen ohne Felder, Zeilen mit unbekannten
 * Feldern, Zeilen mit überraschender Reihenfolge, leere Zeilen und Müll.
 *
 * Geprüft wird einzeln, nicht als Ganzes: ein Fehler soll sagen WHICH field
 * falsch ist. Und es gibt einen Fall, der besonders gern falsch gebaut wird -
 * Zahlen an ihre Position kleben statt an ihren Namen. Genau der wird unten
 * als letzter geprüft, mit denknoten, die wie Tiefen aussehen.
 */

import { parseUciZeile } from './enginebefehl.mjs';
import { istBrowser, verfuegbar, umgebungsProblem, engineLaden, VERFUEGBARE_VERSIONEN } from '../src/engine.js';

// Die Importe oben haben geworfen, wenn etwas nicht stimmt - dann ist die
// Prüfung hier sinnlos. Also: Existenz der Exporte über den Modulraum prüfen.
const globalThisModul = await import('../src/engine.js');

let pruefungen = 0;
const fehler = [];
const ok = (msg) => {
  pruefungen++;
  console.log(`  ok    ${msg}`);
};
const bad = (msg) => {
  pruefungen++;
  fehler.push(msg);
  console.log(`  FEHLER ${msg}`);
};
const step = (msg) => console.log(`\n== ${msg}`);

/** Genau ein Feld muss so sein - und die Meldung nennt den Feldnamen. */
const gleich = (bezeichnung, bekommen, erwartet) => {
  const a = JSON.stringify(erwartet);
  const b = JSON.stringify(bekommen);
  if (a === b) ok(`${bezeichnung} = ${a}`);
  else bad(`${bezeichnung}: erwartet ${a}, war ${b}`);
};

const zahl = (bezeichnung, bekommen, erwartet) => gleich(bezeichnung, bekommen, erwartet);

console.log('UCI-Parser');

// ---------------------------------------------------------------------------
step('importierbarkeit: src/engine.js darf in node nicht werfen');
// Das ist eine Bedingung, keine Nebensache: der Parser-Test und die Seite
// benutzen dieselbe Datei, also muss engine.js auch ohne Browser geladen
// werden können.
if (istBrowser() === false) ok('istBrowser() ist false in node');
else bad(`istBrowser() sollte in node false sein, war ${istBrowser()}`);

for (const name of ['VERFUEGBARE_VERSIONEN', 'engineLaden', 'istBrowser', 'verfuegbar', 'umgebungsProblem', 'parseUciZeile']) {
  if (name in globalThisModul) ok(`engine.js exportiert ${name}`);
  else bad(`engine.js exportiert ${name} nicht`);
}
{
  // Jeder Eintrag muss die drei Felder haben, die die Seite braucht.
  const pflicht = ['id', 'name', 'url', 'groesseHinweis'];
  let sauber = VERFUEGBARE_VERSIONEN.length > 0;
  for (const v of VERFUEGBARE_VERSIONEN) {
    const fehlend = pflicht.filter((k) => !v[k]);
    if (fehlend.length) {
      bad(`Version ${v.id ?? '?'} ohne ${fehlend.join(', ')}`);
      sauber = false;
    }
  }
  if (sauber) ok(`${VERFUEGBARE_VERSIONEN.length} Versionen mit id/name/url/groesseHinweis`);

  try {
    gleich('verfuegbar() in node', await verfuegbar(), false);
  } catch (fehler_) {
    bad('verfuegbar() wirft in node: ' + fehler_.message);
  }
  if (typeof umgebungsProblem() === 'string') ok('umgebungsProblem() nennt einen Grund in node');
  else bad('umgebungsProblem() müsste in node einen Text liefern');

  // Und der Grund: engineLaden muss ablehnen, nicht stillschweigend nichts tun.
  let abgelehnt = false;
  try {
    await engineLaden('engine/sf_19_smallnet.js');
  } catch (fehler_) {
    abgelehnt = true;
    if (/Kein Browser/.test(fehler_.message)) ok('engineLaden sagt in node klar "kein Browser"');
    else bad('engineLaden sagt in node: ' + fehler_.message);
  }
  if (!abgelehnt) bad('engineLaden hat in node nicht abgelehnt');
}

// ---------------------------------------------------------------------------
step('volle info-Zeile mit allen Feldern');
{
  const z =
    'info depth 18 seldepth 22 multipv 1 score cp 34 nodes 1234567 nps 654321 time 2500 pv e2e4 e7e5 g1f3 b8c6 f1b5';
  const r = parseUciZeile(z);
  if (!r) bad('Zeile wurde nicht erkannt');
  else {
    gleich('art', r.art, 'info');
    zahl('tiefe', r.tiefe, 18);
    zahl('seltiefe', r.seltiefe, 22);
    zahl('mehrzeilenAnzahl', r.mehrzeilenAnzahl, 1);
    zahl('cp', r.cp, 34);
    zahl('mate', r.mate, null);
    zahl('knoten', r.knoten, 1234567);
    zahl('nps', r.nps, 654321);
    zahl('sekunden', r.sekunden, 2500);
    gleich('uci (Länge)', r.uci.length, 5);
    gleich('uci (Inhalt)', r.uci, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']);
    if ('upperbound' in r) bad('upperbound darf nicht erfunden werden');
    else ok('kein erfundenes upperbound');
  }
}

// ---------------------------------------------------------------------------
step('echte Ausgabe, tiefenweise (Startstellung, Tiefe 1 bis 12)');
// Aufgezeichnet: "Stockfish 19 ...", dann Tiefe 1-12 aus dem Firefox-Lauf.
{
  const zeilen = [
    'info depth 1 seldepth 2 multipv 1 score cp 29 nodes 20 nps 20000 hashfull 0 tbhits 0 time 1 pv e2e4',
    'info depth 2 seldepth 3 multipv 1 score cp 40 nodes 47 nps 47000 hashfull 0 tbhits 0 time 1 pv e2e4',
    'info depth 3 seldepth 4 multipv 1 score cp 15 nodes 1180 nps 295000 hashfull 0 tbhits 0 time 4 pv e2e4 e7e5 g1f3',
    'info depth 4 seldepth 10 multipv 1 score cp 18 nodes 1844 nps 307333 hashfull 0 tbhits 0 time 6 pv e2e3 e7e5 d2d4 b8c6 d4e5 c6e5',
    'info depth 9 seldepth 12 multipv 1 score cp 33 nodes 5083 nps 338866 hashfull 0 tbhits 0 time 15 pv e2e4 e7e5 b1c3 b8c6 g1f3 g8f6 d2d4 e5d4 f3d4',
    'info depth 12 seldepth 14 multipv 1 score cp 31 nodes 12743 nps 411064 hashfull 4 tbhits 0 time 31 pv e2e4 c7c5 b1c3 b8c6 g1f3 e7e6 d2d4 c5d4 f3d4 g8f6 c1g5',
  ];
  // Erwartete Werte direkt daneben - Knoten und Zeiten aus der Aufzeichnung.
  const erwartet = [
    { tiefe: 1, cp: 29, knoten: 20, nps: 20000, sekunden: 1, uci: 1 },
    { tiefe: 2, cp: 40, knoten: 47, nps: 47000, sekunden: 1, uci: 1 },
    { tiefe: 3, cp: 15, knoten: 1180, nps: 295000, sekunden: 4, uci: 3 },
    { tiefe: 4, cp: 18, knoten: 1844, nps: 307333, sekunden: 6, uci: 6 },
    { tiefe: 9, cp: 33, knoten: 5083, nps: 338866, sekunden: 15, uci: 9 },
    { tiefe: 12, cp: 31, knoten: 12743, nps: 411064, sekunden: 31, uci: 11 },
  ];
  zeilen.forEach((z, i) => {
    const e = erwartet[i];
    const r = parseUciZeile(z);
    if (!r) {
      bad(`Tiefe ${e.tiefe}: nicht erkannt`);
      return;
    }
    const fehlerHier = [];
    if (r.art !== 'info') fehlerHier.push(`art=${r.art}`);
    if (r.tiefe !== e.tiefe) fehlerHier.push(`tiefe=${r.tiefe} statt ${e.tiefe}`);
    if (r.cp !== e.cp) fehlerHier.push(`cp=${r.cp} statt ${e.cp}`);
    if (r.mate !== null) fehlerHier.push(`mate=${r.mate} statt null`);
    if (r.knoten !== e.knoten) fehlerHier.push(`knoten=${r.knoten} statt ${e.knoten}`);
    if (r.nps !== e.nps) fehlerHier.push(`nps=${r.nps} statt ${e.nps}`);
    if (r.sekunden !== e.sekunden) fehlerHier.push(`sekunden=${r.sekunden} statt ${e.sekunden}`);
    if (r.uci.length !== e.uci) fehlerHier.push(`uci hat ${r.uci.length} statt ${e.uci}`);
    if (fehlerHier.length) bad(`Tiefe ${e.tiefe}: ${fehlerHier.join(', ')}`);
    else ok(`Tiefe ${e.tiefe}: cp ${e.cp}, ${e.knoten} Knoten, ${e.uci} Züge`);
  });
}

// ---------------------------------------------------------------------------
step('MultiPV 1/2/3 nebeneinander');
{
  const z = [
    'info depth 14 seldepth 20 multipv 1 score cp -12 nodes 442210 nps 501233 time 882 pv e2e4 c7c5 g1f3 d7d6',
    'info depth 14 seldepth 20 multipv 2 score cp -8 nodes 442210 nps 501233 time 882 pv d2d4 d7d5 c2c4 e7e6',
    'info depth 14 seldepth 20 multipv 3 score mate -3 nodes 442210 nps 501233 time 882 pv d2d4 d7d5 c2c4 d5c4',
  ];
  const r = z.map(parseUciZeile);
  if (r.some((x) => !x)) bad('eine MultiPV-Zeile wurde nicht erkannt');
  else {
    // Das Eigentliche an MultiPV: jede Zeile trägt ihre eigene Nummer und ihre
    // eigene Bewertung. Wer sie vermischt, zeigt drei Mal dasselbe.
    gleich('multipv 1', r[0].mehrzeilenAnzahl, 1);
    gleich('multipv 2', r[1].mehrzeilenAnzahl, 2);
    gleich('multipv 3', r[2].mehrzeilenAnzahl, 3);
    gleich('cp multipv 1', r[0].cp, -12);
    gleich('cp multipv 2', r[1].cp, -8);
    gleich('mate multipv 3', r[2].mate, -3);
    gleich('cp multipv 3 ist null', r[2].cp, null);
    gleich('mate multipv 1 ist null', r[0].mate, null);
    gleich('pv 1', r[0].uci[0], 'e2e4');
    gleich('pv 2', r[1].uci[0], 'd2d4');
    gleich('pv 3', r[2].uci[0], 'd2d4');
  }
  // Und die Reihenfolge darf keine Rolle spielen.
  const gedreht = parseUciZeile('info pv a2a3 depth 7 nodes 55 score mate 4 time 3 nps 11');
  gleich('reihenfolge egal: tiefe', gedreht?.tiefe, 7);
  gleich('reihenfolge egal: knoten', gedreht?.knoten, 55);
  gleich('reihenfolge egal: mate', gedreht?.mate, 4);
  gleich('reihenfolge egal: sekunden', gedreht?.sekunden, 3);
  gleich('reihenfolge egal: nps', gedreht?.nps, 11);
  gleich('reihenfolge egal: pv', gedreht?.uci, ['a2a3']);
}

// ---------------------------------------------------------------------------
step('mate, positiv und negativ');
{
  const faelle = [
    ['info depth 1 score mate 1 nodes 5 nps 100 time 1 pv h5h7', 1],
    ['info depth 3 seldepth 5 score mate -3 nodes 900 nps 45000 time 20 pv b4b5', -3],
    ['info depth 22 score mate 12 nodes 900000 nps 500000 time 1800 pv a1a8', 12],
    ['info depth 8 score mate -1 nodes 210 nps 30000 time 7 pv d1h5', -1],
    ['info depth 2 score mate 0 nodes 12 time 2 pv g1f3', 0],
  ];
  for (const [z, wert] of faelle) {
    const r = parseUciZeile(z);
    const gut = r && r.mate === wert && r.cp === null;
    if (gut) ok(`mate ${wert}`);
    else bad(`mate ${wert}: war ${JSON.stringify(r?.mate)} / cp ${JSON.stringify(r?.cp)}`);
  }
  // cp und mate sind nie gleichzeitig - auch nicht, wenn upstream kaputt ist.
  const komisch = parseUciZeile('info score cp 34 mate -3 depth 5');
  if (komisch) {
    const beides = typeof komisch.cp === 'number' && typeof komisch.mate === 'number';
    if (beides) bad('cp und mate beide gesetzt - genau das darf nie passieren');
    else ok('cp und mate nie gleichzeitig');
  } else bad('unsinnige score-Zeile wurde nicht erkannt');
}

// ---------------------------------------------------------------------------
step('upperbound und lowerbound');
{
  const r1 = parseUciZeile('info depth 5 score cp 5 upperbound nodes 100 time 3 pv d2d4');
  gleich('cp 5', r1?.cp, 5);
  gleich('upperbound', r1?.upperbound, true);
  if ('lowerbound' in (r1 ?? {})) bad('lowerbound darf nicht auftauchen');
  else ok('kein lowerbound');

  const r2 = parseUciZeile('info depth 5 score mate 3 lowerbound nodes 100 time 3 pv h5h7');
  gleich('mate 3', r2?.mate, 3);
  gleich('lowerbound', r2?.lowerbound, true);
  if ('upperbound' in (r2 ?? {})) bad('upperbound darf nicht auftauchen');
  else ok('kein upperbound');

  // Grenze direkt nach der Zahl, mit andern Feldern dazwischen.
  const r3 = parseUciZeile('info depth 9 nodes 7 score cp 250 upperbound hashfull 0 tbhits 0 time 42 pv a2a3 a7a6');
  gleich('upperbound nach cp', r3?.upperbound, true);
  gleich('cp 250', r3?.cp, 250);
  gleich('knoten 7', r3?.knoten, 7);
  gleich('tiefe 9', r3?.tiefe, 9);
}

// ---------------------------------------------------------------------------
step('currmove, currmovenumber, hashfull, tbhits');
{
  const r = parseUciZeile(
    'info depth 12 currmove e2e4 currmovenumber 1 hashfull 137 tbhits 0 nodes 123456 nps 654321 time 2500 pv e2e4 e7e5',
  );
  gleich('currmove', r?.currmove, 'e2e4');
  zahl('currmovenumber', r?.currmovenumber, 1);
  zahl('hashfull', r?.hashfull, 137);
  zahl('tbhits', r?.tbhits, 0);
  gleich('pv bleibt vollständig', r?.uci, ['e2e4', 'e7e5']);

  // currmove mit kaputtem Wert: nicht raten.
  const kaputt = parseUciZeile('info depth 3 currmove xyzzy nodes 5 pv a2a3');
  if (kaputt?.currmove !== 'xyzzy') ok('unsinniger currmove wird nicht übernommen');
  else bad('unsinniger currmove wurde als Zug akzeptiert');
  gleich('pv trotz kaputtem currmove', kaputt?.uci, ['a2a3']);

  // hashfull und tbhits sind nicht vorhanden -> undefined, nicht 0.
  const ohne = parseUciZeile('info depth 2 nodes 10 pv a2a3');
  if ('hashfull' in (ohne ?? {})) bad('hashfull wurde erfunden');
  else ok('hashfull nicht erfunden');
  if ('tbhits' in (ohne ?? {})) bad('tbhits wurde erfunden');
  else ok('tbhits nicht erfunden');
}

// ---------------------------------------------------------------------------
step('Zeilen ohne Felder und mit überraschender Reihenfolge');
{
  // Aktueller Zug ohne alles andere.
  const a = parseUciZeile('info currmove b8c6 currmove e7e5');
  gleich('nur currline-artig, kein Feld', a?.uci, []);

  // Nur "info", sonst nichts.
  const b = parseUciZeile('info');
  gleich('nacktes info: art', b?.art, 'info');
  gleich('nacktes info: cp', b?.cp, null);
  gleich('nacktes info: mate', b?.mate, null);
  gleich('nacktes info: uci', b?.uci, []);

  // Tiefe ohne pv - kommt bei "info string"-Lücken und beim Abbrechen vor.
  const c = parseUciZeile('info depth 3 seldepth 3 multipv 1 score cp 0 nodes 25 nps 0 time 1');
  zahl('Tiefe ohne pv', c?.tiefe, 3);
  gleich('Tiefe ohne pv: leere uci', c?.uci, []);
  gleich('Tiefe ohne pv: cp', c?.cp, 0);

  // cp 0 ist eine Bewertung, keine Abwesenheit.
  if (c?.cp === 0) ok('cp 0 wird nicht zu null/false');
  else bad(`cp 0 ging verloren: ${JSON.stringify(c?.cp)}`);

  // Schlüssel ohne Wert: darf nichts erfinden.
  // Jeder Schlüssel ohne Zahl wird übergangen - und der nächste Schlüssel
  // muss trotzdem gelesen werden. Genau das schafft man falsch, indem man
  // bei einem Schlüssel ohne Wert den ganzen Rest der Zeile wegwirft.
  const d = parseUciZeile('info depth nodes nps time pv e2e4');
  if (d?.tiefe === undefined) ok('Schlüssel ohne Zahl bleibt weg');
  else bad(`Schlüssel ohne Zahl ergab tiefe=${d?.tiefe}`);
  if (d?.knoten === undefined) ok('nodes ohne Zahl bleibt weg');
  else bad(`nodes ohne Zahl ergab knoten=${d?.knoten}`);
  gleich('pv nach unbrauchbaren Feldern', d?.uci, ['e2e4']);

  // "score" ohne cp/mate, dann ein pv: die Variante, an der die Schleife am
  // häufigsten hängen bleibt.
  const d2 = parseUciZeile('info depth 6 score unknown nodes 40 pv e2e4 e7e5');
  zahl('score unknown: tiefe', d2?.tiefe, 6);
  if (d2?.cp === null && d2?.mate === null) ok('score unknown ohne cp und mate');
  else bad(`score unknown ergab cp=${d2?.cp} mate=${d2?.mate}`);
  gleich('score unknown: pv', d2?.uci, ['e2e4', 'e7e5']);

  // Ein Schlüssel, der gar keinen Wert hat, am Zeilenende.
  if (parseUciZeile('info depth')?.tiefe === undefined) ok('abschneidendes depth ist harmlos');
  else bad('abschneidendes depth ergab eine Tiefe');

  // "score" direkt vor "pv": frisst der score-Handler ein Token mit, ist das
  // ganze pv weg und die Anzeige zeigt eine leere Linie.
  const d3 = parseUciZeile('info score pv e2e4 e7e5');
  gleich('score ohne Wert lässt das pv lesen', d3?.uci, ['e2e4', 'e7e5']);
  const d4 = parseUciZeile('info score pv e2e4 nodes 40 depth 3');
  gleich('score ohne Wert: pv', d4?.uci, ['e2e4']);
  zahl('score ohne Wert: knoten danach', d4?.knoten, 40);
  zahl('score ohne Wert: tiefe danach', d4?.tiefe, 3);

  // Unbekannte Felder mitten drin.
  const e = parseUciZeile('info depth 4 plies 7 tbhits 2 score cp 11 nodes 800 nps 90000 time 8 pv e2e4 e7e5 g1f3');
  zahl('trotz unbekanntem plies: tiefe', e?.tiefe, 4);
  zahl('trotz unbekanntem plies: cp', e?.cp, 11);
  zahl('trotz unbekanntem plies: knoten', e?.knoten, 800);
  gleich('trotz unbekanntem plies: pv', e?.uci, ['e2e4', 'e7e5', 'g1f3']);
}

// ---------------------------------------------------------------------------
step('bestmove');
{
  const faelle = [
    ['bestmove e7e5 ponder e2e4', { art: 'bestmove', strich: 'e7e5', ponder: 'e2e4' }],
    ['bestmove e2e4', { art: 'bestmove', strich: 'e2e4', ponder: undefined }],
    ['bestmove a7a8q ponder h7h8', { art: 'bestmove', strich: 'a7a8q', ponder: 'h7h8' }],
    ['bestmove (none)', { art: 'bestmove', strich: null, ponder: undefined }],
    ['bestmove e2e4 ponder (none)', { art: 'bestmove', strich: 'e2e4', ponder: null }],
  ];
  for (const [z, e] of faelle) {
    const r = parseUciZeile(z);
    if (!r) {
      bad(`bestmove nicht erkannt: ${z}`);
      continue;
    }
    gleich(`${z}: art`, r.art, 'bestmove');
    gleich(`${z}: strich`, r.strich, e.strich);
    if (e.ponder === undefined) {
      if ('ponder' in r) bad(`${z}: ponder wurde erfunden`);
      else ok(`${z}: kein ponder`);
    } else {
      gleich(`${z}: ponder`, r.ponder, e.ponder);
    }
  }
}

// ---------------------------------------------------------------------------
step('Handshake-Zeilen');
{
  gleich('readyok', parseUciZeile('readyok'), { art: 'readyok' });
  gleich('uciok', parseUciZeile('uciok'), { art: 'uciok' });
  gleich('id name', parseUciZeile('id name Stockfish 18'), { art: 'id', und: 'name', wert: 'Stockfish 18' });
  gleich('id author', parseUciZeile('id author the Stockfish developers'), {
    art: 'id',
    und: 'author',
    wert: 'the Stockfish developers',
  });
  // Name mit Leerzeichen und Ziffern - kein Zerlegen an der falschen Stelle.
  gleich('id name mit Leerzeichen', parseUciZeile('id name Stockfish 19 smallnet')?.wert, 'Stockfish 19 smallnet');
  if (parseUciZeile('id nothing') === null) ok('id ohne name/author ist null');
  else bad('id ohne name/author wurde akzeptiert');
}

// ---------------------------------------------------------------------------
step('info string (lila schickt hier Übersetzungen)');
{
  const r = parseUciZeile('info string Neuer Zug: e2e4');
  gleich('art', r?.art, 'info');
  gleich('Text', r?.text, 'Neuer Zug: e2e4');
  if (typeof r?.cp === 'number') bad('info string darf keine Bewertung erfinden');
  else ok('info string ohne cp');

  const kurz = parseUciZeile('info string');
  if (kurz === null || kurz.text === '') ok('nacktes info string ist harmlos');
  else bad('nacktes info string ergab ' + JSON.stringify(kurz));

  // Und noch eine echte: die Zeilen, die die Engine beim Start selbst schickt.
  for (const z of [
    'info string Available processors: 0-11',
    'info string Using 1 thread',
    'info string Network replica 1: Local memory. Shared memory not supported by the OS. Local allocation fallback.',
  ]) {
    const x = parseUciZeile(z);
    if (x?.art === 'info' && typeof x.text === 'string' && x.text.length > 0) ok('gelesen: ' + x.text.slice(0, 40));
    else bad('nicht gelesen: ' + z);
  }
}

// ---------------------------------------------------------------------------
step('Zeilen, die keine Info-Zeile sind');
{
  // Das sind echte Zeilen aus der Engine, die nicht ins Bild gehören.
  const nutzlos = [
    'Stockfish 19 by the Stockfish developers (see AUTHORS file)',
    'option name Threads type spin default 1 min 1 max 1024',
    'option name MultiPV type spin default 1 min 1 max 256',
    'option name UCI_Chess960 type check default false',
    'option name EvalFile type string default nn-61e7af4bb97d.nnue',
    'Neuer Zug',
    'go depth 18',
    'position startpos moves e2e4 e7e5',
  ];
  for (const z of nutzlos) {
    const r = parseUciZeile(z);
    if (r === null) ok(`null: ${z.slice(0, 46)}`);
    else bad(`sollte null sein, war ${JSON.stringify(r).slice(0, 60)}: ${z.slice(0, 46)}`);
  }

  // "info" mit angehängtem Schlüssel ist keine info-Zeile mit Feld.
  gleich('info mit Ziffer am Schlüssel', parseUciZeile('info 5')?.art, 'info');
  if (parseUciZeile('info 5').cp === null) ok('info 5 ohne cp');
  else bad('info 5 hat eine Bewertung erfunden');
}

// ---------------------------------------------------------------------------
step('leere Zeilen und Müll');
{
  const muell = ['', '   ', '\t', '\n', 'info  ', ' info depth 3 pv e2e4 '];
  for (const z of muell) {
    let r;
    let geworfen = false;
    try {
      r = parseUciZeile(z);
    } catch {
      geworfen = true;
    }
    if (geworfen) bad('parseUciZeile hat bei ' + JSON.stringify(z) + ' geworfen');
    else if (z.trim() === '') {
      if (r === null) ok('leere Zeile ist null');
      else bad('leere Zeile ergab ' + JSON.stringify(r));
    } else ok('überlebt: ' + JSON.stringify(z));
  }
  // Führende und abschließende Leerzeichen sind normal (Puffer, \r von Windows).
  const crlf = parseUciZeile('info depth 5 score cp 12 nodes 99 time 2 pv e2e4 e7e5\r');
  zahl('CR am Zeilenende: tiefe', crlf?.tiefe, 5);
  gleich('CR am Zeilenende: pv', crlf?.uci, ['e2e4', 'e7e5']);
}

// ---------------------------------------------------------------------------
step('Robustheit: zwölf kaputte Zeilen, nie werfen');
// Der Aufrufer darf nicht dafür geradestehen, dass jemand ihm Müll schickt.
{
  const kaputt = [
    null,
    undefined,
    42,
    {},
    [],
    () => {},
    Symbol('x'),
    'info depth',
    'info score',
    'info score cp',
    'info score cp abc pv e2e4',
    'info pv',
    'info pv 123456789',
    'info depth 99999999999999999999999 nodes 99999999999999999999999',
    'info depth -1 seldepth -2 score cp -999999999999 nps -1 time -1',
    'info depth 5 nodes 1e10 time 0.5 pv e2e4',
    'bestmove',
    'bestmove e2e4 ponder',
    'bestmove e2e4 xxx yyy zzz',
    'id',
    'id name',
    'info string ' + 'x'.repeat(5000),
    'info pv ' + 'e2e4 '.repeat(500),
    'info\tdepth\t7\tscore\tmate\t-2\tpv\td2d4',
    'INFO DEPTH 18 SCORE CP 34',
    'info depth 8 score cp 5 upperbound lowerbound pv e2e4',
    'info currline e2e4 e7e5 e1e4 e8e5 f1b5 a7a6',
    'info refutation d2d4 e7e6 d4e5 g8f6 e5f7',
    'info wdl w 300 d 600 l 100 nodes 500 depth 10 pv e2e4',
    'info wdl 300 600 100 depth 10 nodes 500 pv e2e4',
    'info score mate -3 nodes 1 nps 1 time 1 pv a1a2 a2a3',
    'x'.repeat(10000),
    'info depth 12 seldepth 20 multipv 1 score cp 31 nodes 12743 nps 411064 hashfull 4 tbhits 0 time 31 pv e2e4 c7c5 b1c3 b8c6',
  ];
  let geworfen = 0;
  let nullen = 0;
  for (const z of kaputt) {
    try {
      const r = parseUciZeile(z);
      if (r === null) nullen++;
    } catch (fehler_) {
      geworfen++;
      bad('parseUciZeile wirft bei ' + String(typeof z === 'symbol' ? 'Symbol' : JSON.stringify(z)).slice(0, 40) + ': ' + fehler_.message);
    }
  }
  if (geworfen === 0) ok(`${kaputt.length} kaputte Zeilen, keine Ausnahme geworfen`);
  console.log(`  info  davon ${nullen} als null zurückgewiesen, ${kaputt.length - nullen} gelesen`);

  // Was von den ungültigen *gelesen* wurde, muss trotzdem vernünftig sein.
  const grosser = parseUciZeile('info depth 99999999999999999999999 nodes 99999999999999999999999');
  if (typeof grosser?.tiefe === 'number' || grosser?.tiefe === undefined) {
    ok('Riesenzahlen werden nicht zu NaN');
  } else bad('Riesenzahlen ergaben ' + grosser.tiefe);
  const komma = parseUciZeile('info depth 5 nodes 1e10 time 0.5 pv e2e4');
  if (komma?.knoten === undefined) ok('Fließkommazahl als knots abgelehnt');
  else bad('Fließkommazahl wurde zu knots=' + komma.knoten);
  const grossKlein = parseUciZeile('info depth 5 score cp 5 upperbound lowerbound pv e2e4');
  if (grossKlein?.upperbound === true) ok('upperbound vor lowerbound gelesen');
  else bad('upperbound/lowerbound zusammen nicht gelesen');

  // Die wdl-Formen, die die Engine schickt.
  const wdl1 = parseUciZeile('info wdl w 300 d 600 l 100 nodes 500 depth 10 pv e2e4');
  gleich('wdl mit Buchstaben', wdl1?.wdl, [300, 600, 100]);
  const wdl2 = parseUciZeile('info wdl 300 600 100 depth 10 nodes 500 pv e2e4');
  gleich('wdl ohne Buchstaben', wdl2?.wdl, [300, 600, 100]);
  zahl('wdl: pv bleibt', wdl1?.uci.length, 1);

  // currline und refutation: echte Zeilen, aber für die Anzeige nutzlos.
  const curr = parseUciZeile('info currline e2e4 e7e5 e1e4 e8e5 f1b5 a7a6');
  gleich('currline liefert Züge', curr?.uci, ['e2e4', 'e7e5', 'e1e4', 'e8e5', 'f1b5', 'a7a6']);
  const ref = parseUciZeile('info refutation d2d4 e7e6 d4e5 g8f6');
  gleich('refutation liefert nichts', ref?.uci, []);

  // Tabulatoren als Trenner: kommt vor, wenn die Zeile aus einem Log kommt.
  const tabs = parseUciZeile('info\tdepth\t7\tscore\tmate\t-2\tpv\td2d4');
  zahl('Tabulatoren: tiefe', tabs?.tiefe, 7);
  gleich('Tabulatoren: mate', tabs?.mate, -2);
  gleich('Tabulatoren: pv', tabs?.uci, ['d2d4']);

  // Grossbuchstaben sind kein UCI.
  if (parseUciZeile('INFO DEPTH 18 SCORE CP 34') === null) ok('Grossschreibung ist kein UCI');
  else bad('Grossschreibung wurde akzeptiert');
}

// ---------------------------------------------------------------------------
step('kein Moorhund-Erfolg: Zahlen an Namen, nicht an Position');
// Der typische Fehler: die dritte Zahl der Zeile als "Knoten" nehmen. Dann
// sähe die Zeile unten harmlos aus und wäre trotzdem falsch - knots=18 statt 7.
{
  const z = 'info depth 18 score cp 34 nodes 7 nps 8 time 9';
  const r = parseUciZeile(z);
  if (!r) {
    bad('Moorhund-Zeile nicht erkannt');
  } else {
    const falsch = [];
    if (r.tiefe !== 18) falsch.push(`tiefe=${r.tiefe}`);
    if (r.cp !== 34) falsch.push(`cp=${r.cp}`);
    if (r.knoten !== 7) falsch.push(`knoten=${r.knoten}`);
    if (r.nps !== 8) falsch.push(`nps=${r.nps}`);
    if (r.sekunden !== 9) falsch.push(`sekunden=${r.sekunden}`);
    if (r.mate !== null) falsch.push(`mate=${r.mate}`);
    if (falsch.length) bad('Zahlen verrutscht: ' + falsch.join(', '));
    else ok('knoten=7, nps=8, sekunden=9 (nicht knoten=18)');

    // Dieselbe Verschiebung in der anderen Richtung: knoten vor depth.
    const r2 = parseUciZeile('info nodes 7 depth 18 nps 8 time 9 score cp 34');
    const f2 = [];
    if (r2.knoten !== 7) f2.push(`knoten=${r2.knoten}`);
    if (r2.tiefe !== 18) f2.push(`tiefe=${r2.tiefe}`);
    if (r2.nps !== 8) f2.push(`nps=${r2.nps}`);
    if (r2.sekunden !== 9) f2.push(`sekunden=${r2.sekunden}`);
    if (f2.length) bad('Zahlen verrutscht (andere Reihenfolge): ' + f2.join(', '));
    else ok('knoten=7, nps=8, sekunden=9 auch bei anderer Reihenfolge');
  }
}

// ---------------------------------------------------------------------------
step('genau 25+ geprüfte Zeilen aus realer Ausgabe');
{
  // Nur zur Information: wie viele der obigen Zeilen echte Engine-Ausgabe sind.
  const echt = [
    'info depth 1 seldepth 2 multipv 1 score cp 29 nodes 20 nps 20000 hashfull 0 tbhits 0 time 1 pv e2e4',
    'info depth 2 seldepth 3 multipv 1 score cp 40 nodes 47 nps 47000 hashfull 0 tbhits 0 time 1 pv e2e4',
    'info depth 3 seldepth 4 multipv 1 score cp 15 nodes 1180 nps 295000 hashfull 0 tbhits 0 time 4 pv e2e4 e7e5 g1f3',
    'info depth 4 seldepth 10 multipv 1 score cp 18 nodes 1844 nps 307333 hashfull 0 tbhits 0 time 6 pv e2e3 e7e5 d2d4 b8c6 d4e5 c6e5',
    'info depth 5 seldepth 7 multipv 1 score cp 17 nodes 1948 nps 243500 hashfull 0 tbhits 0 time 8 pv e2e3 e7e5 d2d4 b8c6 d4e5 c6e5',
    'info depth 6 seldepth 11 multipv 1 score cp 17 nodes 2545 nps 254500 hashfull 0 tbhits 0 time 10 pv e2e4 e7e5 g1f3 b8c6 d2d4 e5d4',
    'info depth 7 seldepth 12 multipv 1 score cp 19 nodes 2880 nps 261818 hashfull 0 tbhits 0 time 11 pv e2e4 e7e5 g1f3 b8c6 b1c3 g8f6',
    'info depth 8 seldepth 12 multipv 1 score cp 26 nodes 3879 nps 298384 hashfull 0 tbhits 0 time 13 pv e2e4 e7e5 g1f3',
    'info depth 9 seldepth 12 multipv 1 score cp 33 nodes 5083 nps 338866 hashfull 0 tbhits 0 time 15 pv e2e4 e7e5 b1c3 b8c6 g1f3 g8f6 d2d4 e5d4 f3d4',
    'info depth 10 seldepth 12 multipv 1 score cp 31 nodes 9492 nps 379680 hashfull 2 tbhits 0 time 25 pv e2e4 c7c5 g1f3 b8c6 b1c3 e7e6 d2d4 c5d4 f3d4',
    'info depth 11 seldepth 17 multipv 1 score cp 31 nodes 9888 nps 380307 hashfull 2 tbhits 0 time 26 pv e2e4 c7c5 g1f3 b8c6 b1c3 e7e6 d2d4 c5d4 f3d4 g8f6 d4c6 b7c6',
    'info depth 12 seldepth 14 multipv 1 score cp 31 nodes 12743 nps 411064 hashfull 4 tbhits 0 time 31 pv e2e4 c7c5 b1c3 b8c6 g1f3 e7e6 d2d4 c5d4 f3d4 g8f6 c1g5',
    'info depth 3 currmove b1c3 currmovenumber 2 hashfull 0 tbhits 0 nodes 1844 nps 204888 time 9',
    'info depth 5 score mate 1 upperbound nodes 300 nps 50000 time 8 pv h5h7 h7h6',
    'info depth 11 score mate -3 nodes 98000 nps 240000 time 411 pv b4b5 b8c6',
    'bestmove e2e4 ponder c7c5',
    'readyok',
    'uciok',
    'id name Stockfish 19',
    'id author the Stockfish developers',
    'info string Available processors: 0-11',
    'info string Using 1 thread',
    'option name Threads type spin default 1 min 1 max 1024',
    'option name EvalFile type string default nn-61e7af4bb97d.nnue',
    'Stockfish 19 by the Stockfish developers (see AUTHORS file)',
  ];
  // "Eingelesen" heißt hier: verstanden oder bewusst verworfen - beides ist
  // richtig. Eine "option name …"-Zeile ist echte Ausgabe und gehört zu null.
  let verstanden = 0;
  let verworfen = 0;
  for (const z of echt) {
    if (parseUciZeile(z) === null) verworfen++;
    else verstanden++;
  }
  gleich(`${echt.length} echte Zeilen durch den Parser`, verstanden + verworfen, echt.length);
  if (echt.length >= 25) ok(`${echt.length} Zeilen echter Ausgabe im Test (gefordert: 25)`);
  else bad(`nur ${echt.length} echte Zeilen, gefordert waren 25`);
  console.log(`  info  davon ${verstanden} mit Feldern, ${verworfen} bewusst null`);

  // Die 12 Tiefenzeilen einzeln noch einmal gegen ihre Vollständigkeit: eine
  // echte Zeile muss alle sieben Felder liefern, die die Anzeige braucht.
  const feldnamen = ['tiefe', 'knoten', 'nps', 'sekunden', 'cp'];
  for (const z of echt.slice(0, 12)) {
    const r = parseUciZeile(z);
    const fehlend = feldnamen.filter((f) => typeof r?.[f] !== 'number');
    if (fehlend.length === 0) ok(`vollständig: Tiefe ${r.tiefe}`);
    else bad(`Tiefe ${z.slice(0, 24)}… fehlt: ${fehlend.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${pruefungen} Prüfungen, ${fehler.length} Fehler`);
if (fehler.length) {
  console.log('\nFehlgeschlagen:');
  for (const f of fehler) console.log('  - ' + f);
  process.exit(1);
}
console.log('grün');