#!/usr/bin/env node
/**
 * Prüft die Deutung der Eröffnungsdatenbank, den Zwischenspeicher-Schlüssel,
 * das Verhalten ohne Anmeldung und den PKCE-Fluss.
 *
 * Geprüft wird NICHT "geht die Anfrage raus", sondern ob das, was reinkommt,
 * richtig gedeutet wird. Die Antworten stammen aus der OpenAPI-Datei des
 * Projekts (doc/specs/schemas/OpeningExplorer*.yaml und die Beispiele
 * doc/specs/examples/openingExplorer-*.json.yaml) und aus Formen, die dort
 * nicht stehen, aber in der Praxis vorkommen.
 *
 *   node build/explorertest.mjs
 *   node build/explorertest.mjs --live   ein einziger Versuch gegen den echten
 *                                       Endpunkt, nur um den 401 zu bestätigen
 */

import {
  QUELLEN,
  SPEICHER,
  ExplorerFehler,
  parserAntwort,
  normiereFen,
  cacheSchluessel,
  istAngemeldet,
  tokenStatus,
  abmelden,
  anmelden,
  abfrage,
  abfrageUebertragbar,
  abbrechen,
  anmeldenFortsetzen,
  baueAbfrageUrl,
  baueAutorisierungsUrl,
  codeChallenge,
  zwischenspeichern,
  ausZwischenspeicher,
} from '../src/explorer.js';

const gruen = '\x1b[32m';
const rot = '\x1b[31m';
const grau = '\x1b[90m';
const fett = '\x1b[1m';
const aus = '\x1b[0m';

let fehler = 0;
let pruefungen = 0;
const t0Start = Date.now();

function pruefe(bedingung, text, detail) {
  pruefungen += 1;
  if (bedingung) return true;
  fehler += 1;
  console.log(`  ${rot}fehlt${aus} ${text}${detail ? `\n         ${grau}${detail}${aus}` : ''}`);
  return false;
}

function gleich(ist, soll, text) {
  return pruefe(ist === soll, text, `ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`);
}

function abschnitt(titel) {
  console.log(`\n${fett}${titel}${aus}`);
}

/** Ein localStorage, wie ihn der Browser liefert - damit lässt sich die Ablage prüfen. */
function kasten() {
  const inhalt = new Map();
  return {
    getItem: (k) => (inhalt.has(k) ? inhalt.get(k) : null),
    setItem: (k, v) => inhalt.set(k, String(v)),
    removeItem: (k) => inhalt.delete(k),
    key: (i) => [...inhalt.keys()][i] ?? null,
    get length() {
      return inhalt.size;
    },
  };
}

/**
 * node hat kein window. Für die Ablageprüfungen wird eines gestellt - und
 * wieder abgebaut, auch wenn der Aufruf asynchron ist. Sonst fiele das
 * fensterlose node während eines wartenden Aufrufs schon wieder weg.
 */
async function mitFenster(fn) {
  const vorher = globalThis.window;
  const speicher = kasten();
  globalThis.window = {
    localStorage: speicher,
    location: { origin: 'https://beispiel.test', hostname: 'beispiel.test', pathname: '/src/explorer-test.html', search: '' },
    history: { replaceState: () => {} },
  };
  try {
    return await fn(speicher);
  } finally {
    if (vorher === undefined) delete globalThis.window;
    else globalThis.window = vorher;
  }
}

const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---------------------------------------------------------------------------
abschnitt('1. parserAntwort: vollständige und unvollständige Antworten');

// Aus doc/specs/examples/openingExplorer-lichess.json.yaml, gekürzt auf die
// Felder, die der Parser liest.
const VOLL_LICHESS = JSON.stringify({
  white: 5061745,
  draws: 492487,
  black: 4458129,
  moves: [
    { uci: 'c6d5', san: 'cxd5', averageRating: 1806, white: 4517660, draws: 450366, black: 4016728, game: null, opening: null },
    {
      uci: 'g8f6',
      san: 'Nf6',
      averageRating: 1973,
      white: 195502,
      draws: 17425,
      black: 184987,
      game: null,
      opening: { eco: 'D06', name: "Queen's Gambit Declined: Marshall Defense, Tan Gambit" },
    },
  ],
  topGames: [
    {
      uci: 'e7e6',
      id: 'aAbqI4ey',
      winner: 'white',
      speed: 'blitz',
      white: { name: 'Bobby Fischer', rating: 2713 },
      black: { name: 'Wolfgang Uhlmann', rating: 2590 },
      year: 1961,
      month: '1961-10',
    },
  ],
  opening: { eco: 'D06', name: "Queen's Gambit Declined: Marshall Defense" },
});

// Aus doc/specs/schemas/OpeningExplorerPlayer.yaml: andere Feldnamen.
const VOLL_SPIELER = JSON.stringify({
  opening: { eco: 'B00', name: "King's Pawn" },
  queuePosition: 3,
  white: 10,
  draws: 1,
  black: 22,
  moves: [
    {
      uci: 'e7e5',
      san: 'e5',
      white: 6,
      draws: 1,
      black: 9,
      averageOpponentRating: 1500,
      performance: 1520,
      game: {
        id: 'uPdCG6Ts',
        winner: 'black',
        speed: 'correspondence',
        mode: 'casual',
        white: { name: 'foo', rating: 1500 },
        black: { name: null, rating: null },
        year: 2015,
        month: '2015-09',
      },
      opening: null,
    },
  ],
  recentGames: [
    { uci: 'e7e5', id: 'uPdCG6Ts', winner: 'black', speed: 'correspondence', mode: 'casual', white: { name: 'foo', rating: 1500 }, black: { name: null, rating: null }, year: 2015, month: '2015-09' },
  ],
});

{
  const e = parserAntwort(VOLL_LICHESS);
  gleich(e.gueltig, true, 'Lichess-Antwort wird als gültig erkannt');
  gleich(e.gesamt.weiss, 5061745, 'gesamt.weiss');
  gleich(e.gesamt.remis, 492487, 'gesamt.remis');
  gleich(e.gesamt.schwarz, 4458129, 'gesamt.schwarz');
  gleich(e.gesamt.spiele, 5061745 + 492487 + 4458129, 'gesamt.spiele wird aus den dreien gerechnet');
  gleich(e.opening?.eco, 'D06', 'opening.eco');
  gleich(e.opening?.name, "Queen's Gambit Declined: Marshall Defense", 'opening.name');
  gleich(e.zuege.length, 2, 'zwei Züge');
  gleich(e.zuege[0].uci, 'c6d5', 'zug0.uci');
  gleich(e.zuege[0].san, 'cxd5', 'zug0.san');
  gleich(e.zuege[0].weiss, 4517660, 'zug0.weiss');
  gleich(e.zuege[0].remis, 450366, 'zug0.remis');
  gleich(e.zuege[0].schwarz, 4016728, 'zug0.schwarz');
  gleich(e.zuege[0].spiele, 4517660 + 450366 + 4016728, 'zug0.spiele');
  gleich(e.zuege[0].mittlereWertung, 1806, 'averageRating wird als mittlereWertung gelesen');
  gleich(e.zuege[0].opening, null, 'Zug ohne opening ist null');
  gleich(e.zuege[1].opening?.name.includes('Marshall'), true, 'Zug mit opening wird gelesen');
  gleich(e.topSpiele.length, 1, 'topSpiele');
  gleich(e.topSpiele[0].uci, 'e7e6', 'topSpiel.uci');
  gleich(e.topSpiele[0].id, 'aAbqI4ey', 'topSpiel.id');
  gleich(e.topSpiele[0].gewinner, 'white', 'topSpiel.gewinner');
  gleich(e.topSpiele[0].weiss.name, 'Bobby Fischer', 'topSpiel.weiss.name');
  gleich(e.topSpiele[0].weiss.rating, 2713, 'topSpiel.weiss.rating');
  gleich(e.topSpiele[0].schwarz.rating, 2590, 'topSpiel.schwarz.rating');
  gleich(e.topSpiele[0].jahr, 1961, 'topSpiel.jahr');
  gleich(e.topSpiele[0].monat, '1961-10', 'topSpiel.monat');
  gleich(e.verlauf.length, 0, 'kein Verlauf, wenn history fehlt');
  gleich(e.wartende, null, 'queuePosition fehlt -> null');
  gleich(Array.isArray(e.unbekannt), true, 'unbekannt ist eine Liste');
}

{
  const e = parserAntwort(VOLL_SPIELER);
  gleich(e.gueltig, true, 'Spieler-Antwort wird als gültig erkannt');
  gleich(e.wartende, 3, 'queuePosition');
  gleich(e.zuege[0].mittlereWertung, 1500, 'averageOpponentRating wird gelesen');
  gleich(e.zuege[0].leistung, 1520, 'performance wird gelesen');
  gleich(e.zuege[0].partien.length, 1, 'game wird als Partie gelesen');
  gleich(e.zuege[0].partien[0].id, 'uPdCG6Ts', 'Partie.id');
  gleich(e.zuege[0].partien[0].modus, 'casual', 'Partie.modus');
  gleich(e.zuege[0].partien[0].schwarz.name, null, 'Namen null bleibt null');
  gleich(e.zuege[0].partien[0].schwarz.rating, null, 'Wertung null bleibt null');
  gleich(e.letzteSpiele.length, 1, 'recentGames');
  gleich(e.letzteSpiele[0].tempo, 'correspondence', 'recentGames.tempo');
  gleich(e.opening?.eco, 'B00', 'opening.eco der Spielerantwort');
  gleich(e.gesamt.spiele, 33, 'gesamt.spiele der Spielerantwort');
}

const OHNE_MOVES = JSON.stringify({ white: 5, draws: 0, black: 7, opening: null, topGames: [] });
const LEERE_MOVES = JSON.stringify({ white: 0, draws: 0, black: 0, moves: [], topGames: [] });
const MIT_VERLAUF = JSON.stringify({
  white: 1,
  draws: 2,
  black: 3,
  moves: [],
  topGames: [],
  history: [
    { month: '2024-01', white: 4, draws: 5, black: 6 },
    { month: '2024-02', white: 7, draws: 8, black: 9 },
  ],
});
const MIT_ZUSATZFELDERN = JSON.stringify({
  white: 1,
  draws: 0,
  black: 0,
  moves: [{ uci: 'a2a3', san: 'a3', white: 1, draws: 0, black: 0, averageRating: 1500, someNewField: 'egal' }],
  topGames: [],
  futureField: { a: 1 },
  anotherOne: [1, 2, 3],
});
const OHNE_ZAHLEN = JSON.stringify({ opening: { eco: 'A00', name: 'Unbenannt' }, moves: [{ uci: 'b2b3', san: 'b3' }] });
const HALBE_ZAHLEN = JSON.stringify({ white: '12', draws: null, black: undefined, moves: [{ uci: 'c2c3', san: 'c3', white: '5', averageRating: '' }] });
const GAMES_PLURAL = JSON.stringify({
  white: 1,
  draws: 0,
  black: 0,
  moves: [{ uci: 'd2d4', san: 'd4', white: 1, draws: 0, black: 0, games: [{ id: 'aaa', winner: 'black', white: { name: 'x', rating: 1 }, black: {}, year: 2024 }] }],
  topGames: [],
});
const GAMES_MISCH = JSON.stringify({
  white: 1,
  moves: [{ uci: 'e2e4', san: 'e4', white: 1, draws: 0, black: 0, game: null, games: [{ id: 'bbb', winner: 'draw' }] }],
});
const QUEUE_NULL = JSON.stringify({ queuePosition: 0, white: 1, draws: 0, black: 0, moves: [] });
const WINNUNG_UNDECHI = JSON.stringify({ topGames: [{ id: 'ccc', winner: 'unbekannt', year: 1999 }], moves: [] });
const TOPGAMES_NICHT_ARRAY = JSON.stringify({ topGames: 'nein', white: 1, moves: [{ uci: 'f2f3', san: 'f3', white: 1 }] });
const NDJSON = '{"white":1,"draws":0,"black":0,"moves":[{"uci":"g2g3","san":"g3","white":1}]}\n{"white":3,"draws":1,"black":2,"moves":[{"uci":"h2h3","san":"h3","white":3}]}\n';

{
  const a = parserAntwort(OHNE_MOVES);
  gleich(a.gueltig, true, 'ohne moves gültig');
  gleich(a.zuege.length, 0, 'ohne moves: leere Zugliste');
  gleich(a.gesamt.weiss, 5, 'ohne moves: Zahlen trotzdem gelesen');

  const b = parserAntwort(LEERE_MOVES);
  gleich(b.zuege.length, 0, 'moves: [] ergibt leere Zugliste');
  gleich(b.gesamt.spiele, 0, 'moves: [] ergibt spiele 0');

  const c = parserAntwort(MIT_VERLAUF);
  gleich(c.verlauf.length, 2, 'history wird gelesen');
  gleich(c.verlauf[0].monat, '2024-01', 'verlauf[0].monat');
  gleich(c.verlauf[1].schwarz, 9, 'verlauf[1].schwarz');

  const d = parserAntwort(MIT_ZUSATZFELDERN);
  gleich(d.zuege.length, 1, 'Zusatzfelder stören nicht');
  gleich(d.zuege[0].mittlereWertung, 1500, 'Zug mit Zusatzfeld: Wertung trotzdem gelesen');
  gleich(d.unbekannt.includes('futureField'), true, 'unbekanntes Top-Feld wird gemeldet');
  gleich(d.unbekannt.includes('anotherOne'), true, 'zweites unbekanntes Top-Feld wird gemeldet');
  gleich(d.unbekannt.includes('white'), false, 'bekanntes Feld wird nicht als unbekannt gemeldet');

  const f = parserAntwort(OHNE_ZAHLEN);
  gleich(f.gesamt.weiss, null, 'fehlende Zahl ist null');
  gleich(f.gesamt.spiele, null, 'ohne alle drei Zahlen kein Spielstand');
  gleich(f.zuege[0].weiss, null, 'Zug ohne Zahlen: null');
  gleich(f.zuege[0].spiele, null, 'Zug ohne alle drei: spiele null');
  gleich(f.zuege[0].anteil, null, 'ohne Grundgesamtheit kein Anteil');
  gleich(f.opening?.eco, 'A00', 'opening wird auch ohne Zahlen gelesen');

  const g = parserAntwort(HALBE_ZAHLEN);
  gleich(g.gesamt.weiss, 12, 'Zahl als Text wird umgerechnet');
  gleich(g.gesamt.remis, null, 'null bleibt null');
  gleich(g.gesamt.schwarz, null, 'fehlendes Feld bleibt null');
  gleich(g.gesamt.spiele, null, 'eine einzige Zahl ergibt keine Summe');
  gleich(g.zuege[0].weiss, 5, 'Zug: Zahl als Text');
  gleich(g.zuege[0].mittlereWertung, null, 'leerer Text ist keine Wertung');

  const h = parserAntwort(GAMES_PLURAL);
  gleich(h.zuege[0].partien.length, 1, 'games (plural) wird gelesen');
  gleich(h.zuege[0].partien[0].id, 'aaa', 'Partie aus games gelesen');
  gleich(h.zuege[0].partien[0].gewinner, 'black', 'gewinner aus games');
  gleich(h.zuege[0].partien[0].schwarz.name, null, 'fehlende Gegenseite bleibt null');

  const i = parserAntwort(GAMES_MISCH);
  gleich(i.zuege[0].partien.length, 1, 'game:null und games:[…] zusammen: games gewinnt');
  gleich(i.zuege[0].partien[0].id, 'bbb', 'richtige Partie bei game:null');

  const j = parserAntwort(QUEUE_NULL);
  gleich(j.wartende, 0, 'queuePosition 0 ist 0 und nicht null');

  const k = parserAntwort(WINNUNG_UNDECHI);
  gleich(k.topSpiele[0].gewinner, null, 'unbekannter Sieger wird verworfen');
  gleich(k.topSpiele[0].jahr, 1999, 'der Rest der Partie bleibt');

  const l = parserAntwort(TOPGAMES_NICHT_ARRAY);
  gleich(l.topSpiele.length, 0, 'topGames als Text ergibt leere Liste');
  gleich(l.zuege.length, 1, 'moves wird trotzdem gelesen');

  const m = parserAntwort(NDJSON);
  gleich(m.gueltig, true, 'NDJSON-Text wird gedeutet');
  gleich(m.gesamt.weiss, 3, 'vom letzten NDJSON-Satz');
  gleich(m.zuege[0].uci, 'h2h3', 'Zug aus dem letzten NDJSON-Satz');
}

// ---------------------------------------------------------------------------
abschnitt('2. parserAntwort: kaputte Eingaben wirfen nie');

const KAPUTT = [
  ['null', null],
  ['undefined', undefined],
  ['leeres Array', []],
  ['Array mit Objekten', [{ moves: [] }]],
  ['Text', 'text'],
  ['leeres Objekt', {}],
  ['moves als Text', { moves: 'x' }],
  ['moves als Zahl', { moves: 42 }],
  ['moves als Objekt', { moves: { uci: 'a2a3' } }],
  ['alles als Text', { white: 'viele', draws: [], black: {}, moves: [null, 3, 'x'] }],
  ['NaN und Infinity', { white: NaN, draws: Infinity, black: -Infinity, moves: [{ uci: 'a2a3', white: NaN }] }],
  ['Zahl statt Objekt', 42],
  ['true', true],
  ['verschachtelte Tiefe', { moves: [{ moves: [{ moves: null }] }] }],
  ['sehr langer Schlüssel', { ['x'.repeat(500)]: 1, white: 1 }],
];

for (const [name, eingabe] of KAPUTT) {
  let e = null;
  let geworfen = null;
  try {
    e = parserAntwort(eingabe);
  } catch (err) {
    geworfen = err;
  }
  const sauber = geworfen === null && e !== null && typeof e === 'object' && Array.isArray(e.zuege) && Array.isArray(e.topSpiele) && e.gesamt !== undefined && typeof e.gesamt === 'object';
  pruefe(sauber, `kaputt: ${name} ergibt Brauchbares statt eines Fehlers`, geworfen ? `warf ${geworfen.message}` : JSON.stringify(e));
}

// parserAntwort muss auch Zyklen und Getter fangen, die sich werfen.
{
  let e;
  let geworfen = null;
  try {
    e = parserAntwort({
      get moves() {
        throw new Error('böser Getter');
      },
    });
  } catch (err) {
    geworfen = err;
  }
  gleich(geworfen, null, 'ein Getter, der wirft, wird abgefangen');
}

// ---------------------------------------------------------------------------
abschnitt('3. Cache-Schlüssel: Zähler dürfen nicht stören');

{
  const kurz = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const spät = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 4 12';
  gleich(normiereFen(kurz), normiereFen(spät), 'beide FEN normalisieren gleich');
  gleich(normiereFen(kurz), 'rnbqkbnr/pppppppp/8/8/8/8/pppppppp/rnbqkbnr w kqkq -', 'nur die ersten vier Felder bleiben');

  const a = cacheSchluessel(kurz, 'elite', []);
  const b = cacheSchluessel(spät, 'elite', []);
  gleich(a, b, 'Halbzug- und Vollzugszähler ändern den Schlüssel nicht');

  // Und derselbe Aufruf trifft den eingetragenen Wert wirklich.
  await mitFenster((speicher) => {
    zwischenspeichern(a, { probenummer: 1 });
    gleich(ausZwischenspeicher(cacheSchluessel(spät, 'elite', []), 60_000)?.probenummer, 1, 'der Treffer kommt über die aufgerundete FEN zustande');
    gleich(ausZwischenspeicher(cacheSchluessel(kurz, 'elite', []), 60_000)?.probenummer, 1, 'und über die vollständige FEN');
    pruefe(speicher.length >= 1, 'der Zwischenspeicher liegt im localStorage');
  });

  const mitQuelle = cacheSchluessel(kurz, 'lichess', []);
  pruefe(a !== mitQuelle, 'andere Quelle ergibt einen anderen Schlüssel', `beide ${a}`);
  const mitZuegen = cacheSchluessel(kurz, 'elite', ['d2d4', 'd7d5']);
  pruefe(a !== mitZuegen, 'andere Zugfolge ergibt einen anderen Schlüssel');
  const mitAnzahl = cacheSchluessel(kurz, 'elite', [], 4);
  pruefe(a !== mitAnzahl, 'andere Zugzahl ergibt einen anderen Schlüssel');

  // Zugfolge als Text oder als Liste: beides derselbe Schlüssel.
  gleich(cacheSchluessel(kurz, 'elite', 'd2d4,d7d5'), mitZuegen, 'Zugfolge als Komma-Text wie als Liste');
  gleich(cacheSchluessel(kurz, 'elite', ['d2d4', ' D7D5 ']), mitZuegen, 'Züge werden kleingeschrieben und getrimmt');

  // Ablauf und Alter.
  await mitFenster(() => {
    zwischenspeichern('frisch', { v: 1 });
    zwischenspeichern('mitBis', { v: 2 }, Date.now() - 1);
    gleich(ausZwischenspeicher('frisch', 60_000)?.v, 1, 'frischer Eintrag kommt zurück');
    gleich(ausZwischenspeicher('fehlt', 60_000), null, 'fehlender Schlüssel ist null');
    gleich(ausZwischenspeicher('mitBis'), null, 'abgelaufener Eintrag ist null');
    // Ein zu alter Eintrag wird entfernt - danach ist er wirklich weg.
    zwischenspeichern('alt', { v: 3 }, Date.now() + 60_000);
    gleich(ausZwischenspeicher('alt', -1), null, 'zu alter Eintrag ist null');
    gleich(ausZwischenspeicher('alt', 60_000), null, 'und bleibt weg, statt beim nächsten Mal zu treffen');
    zwischenspeichern('alt', { v: 3 }, Date.now() + 60_000);
    gleich(ausZwischenspeicher('alt', 60_000)?.v, 3, 'frisch geschrieben und innerhalb des Alters kommt er zurück');
    // kaputter Eintrag
    globalThis.window.localStorage.setItem(SPEICHER.cache + 'kaputt', '{{{kein json');
    gleich(ausZwischenspeicher('kaputt', 60_000), null, 'kaputter Eintrag ist null statt Fehler');
  });
}

// ---------------------------------------------------------------------------
abschnitt('4. Ohne Anmeldung: sofort ein Fehler, kein Warten');

{
  const vorher = globalThis.window;
  delete globalThis.window;
  const t0 = Date.now();
  let geworfen = null;
  try {
    await abfrage(FEN, { quelle: 'elite' });
  } catch (err) {
    geworfen = err;
  }
  const dauer = Date.now() - t0;
  gleich(geworfen instanceof ExplorerFehler, true, 'in node wird ein ExplorerFehler geworfen');
  gleich(geworfen?.code, 'nichtAngemeldet', 'Fehlercode ist nichtAngemeldet');
  gleich(geworfen?.message, 'Nicht angemeldet - bitte einloggen.', 'deutsche Meldung steht drin');
  pruefe(dauer < 200, `der Fehler kommt sofort (${dauer} ms)`, 'darf nicht warten');
  gleich(istAngemeldet(), false, 'istAngemeldet ist false ohne Fenster');
  gleich(tokenStatus().angemeldet, false, 'tokenStatus meldet abgemeldet');
  gleich(tokenStatus().laeuftAbAm, null, 'tokenStatus ohne Token: null');
  if (vorher !== undefined) globalThis.window = vorher;

  // Auch mit Fenster, aber ohne Token.
  await mitFenster(async () => {});
  await mitFenster(async () => {
    gleich(istAngemeldet(), false, 'mit Fenster, aber ohne Token: false');
    let e2 = null;
    try {
      await abfrage(FEN, { quelle: 'elite' });
    } catch (err) {
      e2 = err;
    }
    gleich(e2?.code, 'nichtAngemeldet', 'ohne Token im localStorage derselbe Fehler');
  });

  // Unbekannte Quelle und anmelden() in node.
  let e3 = null;
  try {
    await abfrage(FEN, { quelle: 'gibtsnicht' });
  } catch (err) {
    e3 = err;
  }
  gleich(e3?.code, 'unbekannteQuelle', 'unbekannte Quelle wird benannt');

  // Ohne Fenster darf die Anmeldung nicht werfen, sondern klar sagen, woran es liegt.
  delete globalThis.window;
  let e4 = null;
  try {
    await anmelden({ fenster: false });
  } catch (err) {
    e4 = err;
  }
  gleich(e4 instanceof ExplorerFehler, true, 'anmelden ohne Fenster wirft einen ExplorerFehler, nicht irgendeinen');
  gleich(e4?.code, 'keinFenster', 'anmelden ohne Fenster meldet "keinFenster"');

  let e5 = null;
  try {
    await abmelden();
  } catch (err) {
    e5 = err;
  }
  gleich(e5, null, 'abmelden wirft in node nicht');
}

// ---------------------------------------------------------------------------
abschnitt('5. PKCE: Autorisierungs-URL ohne Fenster baubar');

{
  // Testvektor aus RFC 7636 Anhang B - dort steht der Sollwert unabhängig von
// Lichess. Der Doku-Wert für code_verifier ist nur ein Beispiel, kein Sollwert.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = await codeChallenge(verifier);
  gleich(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'BASE64URL(SHA256(verifier)) stimmt mit RFC 7636 Anhang B überein');
  pruefe(!challenge.includes('='), 'base64url ohne Füllzeichen', challenge);
  pruefe(!challenge.includes('+') && !challenge.includes('/'), 'base64url mit - und _ statt + und /', challenge);

  // Die Funktion ist absichtlich frei von window - hier ist keines da.
  const url = baueAutorisierungsUrl({
    clientId: 'beispiel.test',
    weiterleitung: 'https://beispiel.test/src/explorer-test.html',
    challenge,
    zustand: 'ZUSTAND-123',
    scope: ['email:read'],
  });
  const u = new URL(url);
  gleich(u.origin + u.pathname, 'https://lichess.org/oauth', 'Autorisierungsweg laut Doku');
  gleich(u.searchParams.get('response_type'), 'code', 'response_type=code');
  gleich(u.searchParams.get('client_id'), 'beispiel.test', 'client_id');
  gleich(u.searchParams.get('redirect_uri'), 'https://beispiel.test/src/explorer-test.html', 'redirect_uri');
  gleich(u.searchParams.get('code_challenge_method'), 'S256', 'code_challenge_method=S256');
  gleich(u.searchParams.get('code_challenge'), challenge, 'code_challenge steht drin');
  gleich(u.searchParams.get('state'), 'ZUSTAND-123', 'state steht drin');
  gleich(u.searchParams.get('scope'), 'email:read', 'scope steht drin');
  pruefe(!url.includes('client_secret'), 'kein client_secret in der URL', url);
  pruefe(!/[?&]client_secret=/.test(url), 'kein client_secret als Parameter', url);

  // Was fehlt, wird mit klarer Meldung abgewiesen.
  const fehlend = [
    [{ weiterleitung: 'https://x.test/', challenge, zustand: 's' }, 'keineClientId'],
    [{ clientId: 'x', challenge, zustand: 's' }, 'keineWeiterleitung'],
    [{ clientId: 'x', weiterleitung: 'https://x.test/', zustand: 's' }, 'keinChallenge'],
  ];
  for (const [params, code] of fehlend) {
    let e = null;
    try {
      baueAutorisierungsUrl(params);
    } catch (err) {
      e = err;
    }
    gleich(e?.code, code, `fehlende Angabe wird als ${code} gemeldet`);
  }

  // Ein Fenster ändert an der URL nichts - der Aufrufer gibt sie vor.
  await mitFenster(() => {
    const mitFensterUrl = baueAutorisierungsUrl({ clientId: 'beispiel.test', weiterleitung: 'https://beispiel.test/x.html', challenge, zustand: 'z' });
    gleich(new URL(mitFensterUrl).searchParams.get('redirect_uri'), 'https://beispiel.test/x.html', 'redirect_uri kommt vom Aufrufer, nicht aus window.location');
  });
}

// ---------------------------------------------------------------------------
abschnitt('6. Token-Ablauf');

// Ein Token mit Zeitstempel in der Ablage legen - ohne den echten Fluss,
// denn der braucht ein Fenster, einen Browser und ein Konto.
function tokenLegen(speicher, { laeuftAbAm, nutzername }) {
  speicher.setItem(SPEICHER.token, JSON.stringify({ token: 'NUR-FUER-DEN-TEST', laeuftAbAm, nutzername }));
}

{
  const lang = Date.now() + 3_600_000;
  await mitFenster((speicher) => {
    tokenLegen(speicher, { laeuftAbAm: lang, nutzername: 'tester' });
    gleich(istAngemeldet(), true, 'gültiges Token zählt als angemeldet');
    const s = tokenStatus();
    gleich(s.angemeldet, true, 'tokenStatus: angemeldet');
    gleich(s.laeuftAbAm, lang, 'tokenStatus: Ablaufzeit durchgereicht');
    gleich(s.nutzername, 'tester', 'tokenStatus: Nutzername durchgereicht');
    abmelden();
    gleich(istAngemeldet(), false, 'nach abmelden ist es wieder angemeldet-falsch');
    gleich(speicher.getItem(SPEICHER.token), null, 'das Token liegt nicht mehr im localStorage');
  });

  // Abgelaufen.
  await mitFenster((speicher) => {
    tokenLegen(speicher, { laeuftAbAm: Date.now() - 1 });
    gleich(istAngemeldet(), false, 'abgelaufenes Token: istAngemeldet ist false');
    const s = tokenStatus();
    gleich(s.angemeldet, false, 'abgelaufenes Token: tokenStatus.angemeldet ist false');
    gleich(s.laeuftAbAm, null, 'abgelaufenes Token: laeuftAbAm ist null');
    gleich(speicher.getItem(SPEICHER.token), null, 'abgelaufenes Token wird aus der Ablage geräumt');
  });

  await mitFenster((speicher) => {
    tokenLegen(speicher, { laeuftAbAm: Date.now() - 3_600_000 });
    gleich(istAngemeldet(), false, 'lange abgelaufenes Token: false');
  });

  await mitFenster((speicher) => {
    tokenLegen(speicher, { laeuftAbAm: Date.now() });
    gleich(istAngemeldet(), false, 'exakt abgelaufen: false');
  });

  // Kaputte Ablage.
  await mitFenster((speicher) => {
    speicher.setItem(SPEICHER.token, 'kein json');
    gleich(istAngemeldet(), false, 'kaputter Eintrag: false');
    speicher.setItem(SPEICHER.token, JSON.stringify({ laeuftAbAm: Date.now() + 1000 }));
    gleich(istAngemeldet(), false, 'Eintrag ohne token: false');
    speicher.setItem(SPEICHER.token, JSON.stringify({ token: 'x', laeuftAbAm: 'bald' }));
    gleich(istAngemeldet(), false, 'Ablaufzeit als Text: false');
    speicher.setItem(SPEICHER.token, JSON.stringify({ token: '', laeuftAbAm: Date.now() + 1000 }));
    gleich(istAngemeldet(), false, 'leeres Token: false');
  });

  // localStorage, das gar nicht geht (privates Fenster, volle Quota).
  const vorher = globalThis.window;
  globalThis.window = {
    get localStorage() {
      throw new Error('SecurityError');
    },
  };
  let e = null;
  try {
    gleich(istAngemeldet(), false, 'localStorage, das wirft: istAngemeldet ist false');
    gleich(ausZwischenspeicher('egal', 1000), null, 'localStorage, das wirft: ausZwischenspeicher ist null');
    gleich(zwischenspeichern('egal', 1), false, 'localStorage, das wirft: schreiben meldet false');
  } catch (err) {
    e = err;
  }
  gleich(e, null, 'localStorage, das wirft, führt zu keinem Fehler');
  globalThis.window = vorher;

  // Der Rückweg des Anmeldeflusses: die Seite wird mit ?code=… aufgerufen.
  await mitFenster(async () => {
    let e6 = null;
    try {
      await anmeldenFortsetzen({ suche: new URLSearchParams('code=abc&state=falsch') });
    } catch (err) {
      e6 = err;
    }
    gleich(e6?.code, 'keinFluss', 'ohne angefangenen Fluss: keinFluss');

    anmeldenFortsetzen({ suche: new URLSearchParams('') }).then(
      () => {},
      () => {},
    );
  });
  // Ein angefangener Fluss gehört in die Ablage - den legt anmelden() an.
  // Ohne Fenster geht das nicht, deshalb hier von Hand, wie es anmelden() tut.
  await mitFenster(async (speicher) => {
    speicher.setItem(SPEICHER.offen, JSON.stringify({ verifier: 'v', zustand: 'Richtig', weiterleitung: 'https://x.test/', clientId: 'x' }));
    let e7 = null;
    try {
      await anmeldenFortsetzen({ suche: new URLSearchParams('code=abc&state=Falsch') });
    } catch (err) {
      e7 = err;
    }
    gleich(e7?.code, 'falschesState', 'abweichendes state wird verworfen');
    gleich(speicher.getItem(SPEICHER.offen), null, 'und der Fluss wird aufgeräumt');

    speicher.setItem(SPEICHER.offen, JSON.stringify({ verifier: 'v', zustand: 'Richtig', weiterleitung: 'https://x.test/', clientId: 'x' }));
    let e8 = null;
    try {
      await anmeldenFortsetzen({ suche: new URLSearchParams('error=access_denied&state=Richtig') });
    } catch (err) {
      e8 = err;
    }
    gleich(e8?.code, 'abgelehnt', 'ein abgelehnter Anmeldefluss wird benannt');
    gleich(e8?.message.includes('access_denied'), true, 'die Fehlerangabe von lichess steht in der Meldung');

    speicher.setItem(SPEICHER.offen, JSON.stringify({ verifier: 'v', zustand: 'Richtig', weiterleitung: 'https://x.test/', clientId: 'x' }));
    const ohneCode = await anmeldenFortsetzen({ suche: new URLSearchParams('') });
    gleich(ohneCode.angemeldet, false, 'ohne Code passiert nichts');
  });
}

// ---------------------------------------------------------------------------
abschnitt('7. Quellen und URLs');

{
  gleich(QUELLEN.length, 6, 'sechs Reiter');
  const ids = QUELLEN.map((q) => q.id);
  gleich(ids.join(','), 'elite,corr,neujahr,tt,lichess,spieler', 'Reihenfolge wie auf den Screenshots');
  for (const q of QUELLEN) {
    pruefe(typeof q.weg === 'string' && q.weg.startsWith('/'), `${q.name}: echter Weg`, JSON.stringify(q));
  }
  const wege = [...new Set(QUELLEN.map((q) => q.weg))].sort();
  gleich(wege.join(','), '/lichess,/masters,/player', 'die Reiter liegen auf genau den drei dokumentierten Wegen');
  gleich(QUELLEN[0].weg, '/masters', 'Elite ist /masters');
  gleich(QUELLEN[1].filter.speeds, 'correspondence', 'CORR ist ein Tempo-Filter auf /lichess');
  gleich(QUELLEN[3].filter.ratings, '2200,2500', 'TT ist ein Rating-Filter auf /lichess');
  for (const q of QUELLEN) {
    if (q.weg === '/lichess') continue;
    const korrekt = q.id === 'elite' || q.id === 'spieler';
    pruefe(korrekt, `${q.name} liegt auf einem echten Endpunkt der Doku`);
  }

  // Die gebaute URL: kein Token darin, aber alle Doku-Parameter.
  const uMasters = new URL(baueAbfrageUrl('elite', FEN, [], 12, {}));
  gleich(uMasters.origin + uMasters.pathname, 'https://explorer.lichess.org/masters', 'Elite fragt /masters');
  gleich(uMasters.searchParams.get('source'), 'analysis', 'source=analysis');
  gleich(uMasters.searchParams.get('fen'), normiereFen(FEN), 'die FEN kommt ohne Zähler');
  gleich(uMasters.searchParams.get('moves'), '12', 'moves ist die Zugzahl');
  gleich(uMasters.searchParams.get('play'), '', 'ohne Züge ist play leer');
  gleich(uMasters.searchParams.get('topGames'), '0', 'Spiele werden nicht mitgeholt, wenn niemand sie will');

  const uCorr = new URL(baueAbfrageUrl('corr', FEN, ['d2d4', 'd7d5'], 5, {}));
  gleich(uCorr.pathname, '/lichess', 'CORR fragt /lichess');
  gleich(uCorr.searchParams.get('speeds'), 'correspondence', 'CORR filtert auf Korrespondenz');
  gleich(uCorr.searchParams.get('play'), 'd2d4,d7d5', 'die Zugfolge steht als Komma-Liste');
  gleich(uCorr.searchParams.get('moves'), '5', 'gewünschte Zugzahl wird übernommen');

  gleich(new URL(baueAbfrageUrl('neujahr', FEN, [], 12, {})).searchParams.get('since'), '2024-01', '2024+ filtert auf den Zeitraum');
  gleich(new URL(baueAbfrageUrl('tt', FEN, [], 12, {})).searchParams.get('ratings'), '2200,2500', 'TT filtert auf Ratinggruppen');

  // Überschreiben geht.
  const uEigen = new URL(baueAbfrageUrl('corr', FEN, [], 12, { speeds: 'blitz', parameter: { history: 'true' } }));
  gleich(uEigen.searchParams.get('speeds'), 'blitz', 'der Aufrufer überschreibt den Reiter-Filter');
  gleich(uEigen.searchParams.get('history'), 'true', 'zusätzliche Doku-Parameter gehen durch');

  // /player braucht Pflichtangaben.
  let eSpieler = null;
  try {
    baueAbfrageUrl('spieler', FEN, [], 12, {});
  } catch (err) {
    eSpieler = err;
  }
  gleich(eSpieler?.code, 'keinSpieler', '/player ohne Namen wird abgewiesen');
  const uSpieler = new URL(baueAbfrageUrl('spieler', FEN, [], 12, { spieler: 'revoof', farbe: 'black' }));
  gleich(uSpieler.pathname, '/player', 'Spielerdatenbank fragt /player');
  gleich(uSpieler.searchParams.get('player'), 'revoof', 'player steht drin');
  gleich(uSpieler.searchParams.get('color'), 'black', 'color steht drin');
  gleich(new URL(baueAbfrageUrl('spieler', FEN, [], 12, { spieler: 'x' })).searchParams.get('color'), 'white', 'ohne Farbe gilt weiss');

  // Und in keiner dieser URLs steht ein Token - die kommen vorher gar nicht vor.
  for (const id of QUELLEN.map((q) => q.id)) {
    const text = baueAbfrageUrl(id, FEN, [], 12, { spieler: 'x' });
    pruefe(!/token|Bearer|access_token/i.test(text), `${id}: kein Token in der URL`, text);
    pruefe(!text.includes('client_secret'), `${id}: kein client_secret in der URL`);
  }
}

// ---------------------------------------------------------------------------
abschnitt('8. Ohne Anmeldung über mehrere Quellen');

{
  delete globalThis.window;
  let e = null;
  try {
    await abfrageUebertragbar(FEN, { quellen: ['elite', 'lichess'] });
  } catch (err) {
    e = err;
  }
  // Ohne Fenster: abfrageUebertragbar sammelt die Fehler je Quelle ein.
  gleich(e, null, 'abfrageUebertragbar wirft nicht, sondern sammelt');
  await mitFenster(async () => {
    const r = await abfrageUebertragbar(FEN, { quellen: ['elite', 'lichess'] });
    gleich(r.fehler.elite, 'nichtAngemeldet', 'Fehler je Quelle wird benannt');
    gleich(r.fehler.lichess, 'nichtAngemeldet', 'auch für die zweite Quelle');
    gleich(Object.keys(r.treffer).length, 0, 'ohne Anmeldung kein Treffer');
    gleich(r.fen, normiereFen(FEN), 'die FEN wird normalisiert zurückgegeben');
  });
  gleich(gleich(abbrechen(), 0), true, 'abbrechen() wirft nicht und meldet 0 bei nichts laufendem');
}

// ---------------------------------------------------------------------------
abschnitt('9. Wiederholen, 401 und Abbruch - mit gestelltem fetch, ohne Netz');

// Ab hier wird das Netz gestellt. Es geht nicht um das Netz, sondern darum,
// dass bei 429 hoechstens dreimal und bei 401 genau einmal etwas passiert.
async function mitNetz(fetchImpl, fn) {
  const vorher = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = vorher;
  }
}

const jsonAntwort = (daten, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(daten),
});

await mitFenster(async (speicher) => {
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000, nutzername: 'tester' });

  // 401: Token weg, genau ein Fehler, kein zweiter Versuch.
  let aufrufe = 0;
  await mitNetz(
    async () => {
      aufrufe += 1;
      return { ok: false, status: 401, headers: { get: () => null }, text: async () => '<html>401</html>' };
    },
    async () => {
      let e = null;
      try {
        await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1, wartezeitMs: 1 });
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'abgelaufen', '401 meldet "abgelaufen"');
      gleich(e?.message, 'Nicht angemeldet - bitte erneut einloggen.', '401 nennt die Anmeldung');
      gleich(aufrufe, 1, '401 wird nicht wiederholt');
      gleich(istAngemeldet(), false, 'nach 401 ist das Token aus der Ablage');
      gleich(e instanceof ExplorerFehler, true, '401 liefert genau einen ExplorerFehler');
    },
  );

  // 429: hoechstens drei Versuche, dann ein Fehler. (Nach dem 401 oben ist das
  // Token weg - die Anmeldung wird hier wieder hergestellt.)
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  aufrufe = 0;
  await mitNetz(
    async () => {
      aufrufe += 1;
      return { ok: false, status: 429, headers: { get: () => null }, text: async () => '' };
    },
    async () => {
      let e = null;
      try {
        await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1, wartezeitMs: 1, zeitlimitMs: 5000 });
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'zuViele', '429 meldet "zuViele"');
      gleich(aufrufe, 3, '429 wird dreimal versucht, mehr nicht');
    },
  );

  // 429, das beim zweiten Mal klappt.
  aufrufe = 0;
  await mitNetz(
    async () => {
      aufrufe += 1;
      if (aufrufe < 3) return { ok: false, status: 429, headers: { get: () => null }, text: async () => '' };
      return jsonAntwort({ white: 4, draws: 1, black: 2, moves: [{ uci: 'd2d4', san: 'd4', white: 4, draws: 1, black: 2 }] });
    },
    async () => {
      tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
      const e = await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1, wartezeitMs: 1 });
      gleich(aufrufe, 3, 'zwei 429, dann Erfolg');
      gleich(e.gesamt.weiss, 4, 'die Antwort nach den 429 wird gedeutet');
      gleich(e.quelle, 'elite', 'die Quelle steht im Ergebnis');
    },
  );

  // 500: serverfehler zaehlt als Versuch.
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  aufrufe = 0;
  await mitNetz(
    async () => {
      aufrufe += 1;
      return { ok: false, status: 500, headers: { get: () => null }, text: async () => '' };
    },
    async () => {
      let e = null;
      try {
        await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1, wartezeitMs: 1 });
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'server', '500 meldet "server"');
      gleich(aufrufe, 3, '500 wird dreimal versucht');
    },
  );

  // Zeitueberschreitung: zaehlt auch als Versuch, dreimal gedeckelt.
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  aufrufe = 0;
  await mitNetz(
    async (_url, init) => {
      aufrufe += 1;
      const e = new Error('abgebrochen');
      e.name = 'AbortError';
      return await new Promise((_, ablehnen) => {
        init.signal.addEventListener('abort', () => ablehnen(e), { once: true });
      });
    },
    async () => {
      let e = null;
      try {
        await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1, wartezeitMs: 1, zeitlimitMs: 20 });
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'zeitueberschreitung', 'eine hängende Antwort wird als Zeitüberschreitung gemeldet');
      gleich(aufrufe, 3, 'und höchstens dreimal versucht');
    },
  );

  // HTML statt JSON: das ist der 401 im nginx-Kostüm, kein brauchbarer Inhalt.
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  await mitNetz(
    async () => ({ ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => '<html><body>401</body></html>' }),
    async () => {
      let e = null;
      try {
        await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1 });
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'keinJson', 'eine HTML-Antwort wird als Fehler gemeldet, nicht als Ergebnis');
    },
  );

  // kaputtes JSON
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  await mitNetz(
    async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{kein json' }),
    async () => {
      let e = null;
      try {
        await abfrage(FEN, { quelle: 'elite', maxAlterMs: -1 });
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'keinJson', 'kaputtes JSON wird gemeldet');
    },
  );

  // Ein gültiges NDJSON als Text - der /player-Weg liefert genau das.
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  await mitNetz(
    async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/x-ndjson' },
      text: async () => '{"white":1,"draws":0,"black":0,"moves":[{"uci":"e2e4","san":"e4","white":1}]}\n{"white":7,"draws":1,"black":3,"moves":[{"uci":"e2e4","san":"e4","white":7}]}',
    }),
    async () => {
      const e = await abfrage(FEN, { quelle: 'spieler', spieler: 'revoof', farbe: 'white', maxAlterMs: -1 });
      gleich(e.gesamt.weiss, 7, 'aus NDJSON wird der letzte, vollständigste Satz gelesen');
      gleich(e.quelle, 'spieler', 'Quelle Spielerdatenbank');
    },
  );

  // Der Zwischenspeicher: der zweite Aufruf darf nicht mehr raus.
  let netzrufe = 0;
  tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
  await mitNetz(
    async () => {
      netzrufe += 1;
      return jsonAntwort({ white: 3, draws: 0, black: 1, moves: [] });
    },
    async () => {
      const erste = await abfrage(FEN, { quelle: 'tt', zuege: [], anzahl: 7 });
      gleich(netzrufe, 1, 'der erste Aufruf geht raus');
      gleich(erste.ausCache, false, 'und kommt nicht aus dem Zwischenspeicher');
      const zweite = await abfrage(FEN, { quelle: 'tt', zuege: [], anzahl: 7 });
      gleich(netzrufe, 1, 'der zweite Aufruf trifft den Zwischenspeicher');
      gleich(zweite.ausCache, true, 'und wird als Treffer gemeldet');
      gleich(zweite.gesamt.weiss, 3, 'mit demselben Inhalt');
    },
  );

  // abbrechen() bricht eine hängende Abfrage ab.
  const hänger = new Promise((_, ablehnen) => {
    const e = new Error('abgebrochen');
    e.name = 'AbortError';
    return ablehnen(e);
  });
  await mitNetz(
    async (_url, init) => {
      hänger.catch(() => {});
      return await new Promise((_, ablehnen) => {
        init.signal.addEventListener('abort', () => ablehnen(new Error('abgebrochen')), { once: true });
      });
    },
    async () => {
      tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
      const lauf = abfrage(FEN, { quelle: 'lichess', maxAlterMs: -1, zeitlimitMs: 60_000 });
      lauf.catch(() => {});
      await new Promise((r) => setTimeout(r, 10));
      gleich(abbrechen(), 1, 'abbrechen() meldet die Zahl der laufenden Abfragen');
      let e = null;
      try {
        await lauf;
      } catch (err) {
        e = err;
      }
      gleich(e?.code, 'abgebrochen', 'die abgebrochene Abfrage meldet "abgebrochen"');
      gleich(abbrechen(), 0, 'danach ist nichts mehr laufend');
    },
  );

  // Mehrere Quellen: eine darf ausfallen, die anderen nicht.
  await mitNetz(
    async (url) => {
      if (url.includes('/player')) return { ok: false, status: 401, headers: { get: () => null }, text: async () => '' };
      return jsonAntwort({ white: 1, draws: 1, black: 1, moves: [] });
    },
    async () => {
      tokenLegen(speicher, { laeuftAbAm: Date.now() + 3_600_000 });
      const r = await abfrageUebertragbar(FEN, {
        quellen: ['elite', 'lichess', 'spieler'],
        spieler: 'revoof',
        farbe: 'white',
        maxAlterMs: -1,
        wartezeitMs: 1,
      });
      gleich(Object.keys(r.treffer).sort().join(','), 'elite,lichess', 'die zwei Quellen ohne 401 liefern ein Ergebnis');
      gleich(r.fehler.spieler, 'abgelaufen', 'die dritte meldet ihren Fehler, ohne die anderen zu kippen');
      gleich(r.quellen.length, 3, 'alle drei wurden versucht');
    },
  );
});

// ---------------------------------------------------------------------------
abschnitt('10. Nur ein freiwilliger Versuch gegen den echten Endpunkt');

const live = process.argv.includes('--live');
if (!live) {
  console.log(`  ${grau}übersprungen (--live für einen Versuch)${aus}`);
} else {
  // Ziel ist genau eine Sache: kommt der 401 wirklich als 401 und nicht als
  // HTML-Fehlerseite? Kein Token, kein Konto, keine Wiederholung.
  const url = 'https://explorer.lichess.org/masters?source=analysis&variant=standard&fen=' + encodeURIComponent(FEN) + '&play=&moves=12&topGames=0&recentGames=0';
  try {
    const antwort = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
    const typ = antwort.headers.get('content-type');
    const text = await antwort.text();
    console.log(`  gemessen: ${antwort.status} ${antwort.statusText} - ${text.length} Bytes, ${typ}`);
    gleich(antwort.status, 401, 'anonym kommt 401');
    pruefe(/text\/html/.test(typ || ''), 'die 401-Antwort ist HTML (nginx), kein JSON', String(typ));
    console.log(`  ${grau}Antwortanfang: ${text.slice(0, 120).replace(/\n/g, ' ')}${aus}`);
  } catch (err) {
    console.log(`  ${rot}Live-Versuch fehlgeschlagen: ${err.message}${aus}`);
    fehler += 1;
  }
  pruefungen += 1;
}

// ---------------------------------------------------------------------------
const sekunden = ((Date.now() - t0Start) / 1000).toFixed(1);
console.log('');
if (fehler) {
  console.log(`${rot}${fehler} Fehler bei ${pruefungen} Prüfungen${aus} (${sekunden}s)`);
  process.exit(1);
}
console.log(`${gruen}alles grün: ${pruefungen} Prüfungen${aus} (${sekunden}s)`);