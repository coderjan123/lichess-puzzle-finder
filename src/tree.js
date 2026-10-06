/**
 * Zugbaum: eine Hauptlinie und Nebenzweige darum herum, mit PGN rein und
 * raus. Ohne Fremdbibliothek - die Schachregeln kommen aus ./chess.js, und
 * die Notation auch. Hier steht keine eigene Zuglogik, nur Baum und Text.
 *
 * Datenmodell
 * -----------
 * Ein Knoten ist { uci, san, fen, kinder: [...] }. `fen` ist die Stellung
 * NACH diesem Zug; die Wurzel kennt keine Zuege, nur ihre Stellung - die
 * merkt sich der Baum an der Wurzel selbst.
 *
 * Ein Pfad ist ein Array von Kind-Indizes: [] ist die Wurzel, [0] der erste
 * Zug, [0,1] der zweite Zug auf einer Nebenspur. Kind 0 ist IMMER die
 * Hauptlinie, deshalb ist "sofort nach dem ersten Knoten abgewichen" ein
 * Zweig, und deshalb ist die Hauptlinie einfach der Pfad aus lauter Nullen -
 * ohne eine Buchfuehrung, die auseinanderlaufen koennte.
 *
 * Der Preis dafuer: `umwandeln` (Hochziehen) schiebt einen Knoten an die
 * erste Stelle seiner Geschwister. Die Hauptlinie ist danach wieder die, und
 * kein Zug ist verloren - nur die Indizes unterhalb dieses Punktes haben sich
 * verschoben. Deshalb gibt umwandeln() den NEUEN Pfad zurueck, und wer einen
 * gemerkten Pfad mitfuehrt, muss ihn danach neu holen.
 *
 * PGN
 * ---
 * Beim Einlesen werden Kommentare ({...} und ;...) sowie Kennzeichen ($1)
 * uebersprungen, ohne zu meckern: die Seite soll keine Kommentare haben,
 * fremde Partien aber schon. Wegwerfen ist harmlos, Scheitern nicht.
 * Was nicht lesbar ist, wirft mit einer Meldung, die den konkreten Fehler
 * nennt - Zeilennummer, Zugtext und die Stellung, in der er nicht ging.
 */

import {
  startFen as standardFen,
  parseFen,
  toFen,
  legalMoves,
  makeMove,
  undoMove,
  moveToUci,
  moveToSan,
  sanToMove,
  parseSquare,
  squareName,
  encodeMove,
  typeOf,
  isColor,
  PAWN,
  WHITE,
  isCheckmate,
  isStalemate,
  outcome,
} from './chess.js';

const PROMO = { n: 2, b: 3, r: 4, q: 5 };

// ------------------------------------------------------------------ Pfade

function pruefePfad(pfad) {
  if (!Array.isArray(pfad)) {
    throw new Error(`Pfad muss ein Array von Kind-Indizes sein, ist aber ${pfad === null ? 'null' : typeof pfad}`);
  }
  for (const i of pfad) {
    if (!Number.isInteger(i) || i < 0) {
      throw new Error(`Pfad [${pfad.join(',')}] enthaelt kein Kind-Index`);
    }
  }
  return pfad;
}

/** Knoten zu einem Pfad. Wirft, wenn es den Pfad nicht gibt. */
function knoten(tree, pfad) {
  pruefePfad(pfad);
  let k = tree.wurzel;
  for (let i = 0; i < pfad.length; i++) {
    const kind = k.kinder[pfad[i]];
    if (!kind) {
      throw new Error(
        `Pfad [${pfad.join(',')}] gibt es nicht: an Stelle ${i} hat der Knoten nur ${k.kinder.length} Kinder`,
      );
    }
    k = kind;
  }
  return k;
}

/**
 * Wie knoten(), aber null statt Fehler - fuer Suchen, die nichts melden.
 * Prueft selbst, ohne try/catch: das ist der einzige Weg, bei dem kein
 * Ausruf eine fremde Fehlermeldung verschluckt.
 */
function sucheKnoten(tree, pfad) {
  if (!Array.isArray(pfad)) return null;
  let k = tree.wurzel;
  for (const i of pfad) {
    if (!Number.isInteger(i) || i < 0) return null;
    k = k.kinder[i];
    if (!k) return null;
  }
  return k;
}

const pfadText = (pfad) => `[${pfad.join(',')}]`;

/** Sind zwei Pfade gleich? */
export function pfadGleich(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Ist `kurz` ein Anfang von `lang`? Damit laesst sich "der aktuelle Pfad
 *  laeuft an diesem Zug vorbei" ohne Schleife schreiben. */
export function pfadIstAnfang(kurz, lang) {
  if (kurz.length > lang.length) return false;
  for (let i = 0; i < kurz.length; i++) if (kurz[i] !== lang[i]) return false;
  return true;
}

// ------------------------------------------------------------------ Zug loesen

/**
 * UCI zu einer Zugzahl, oder -1.
 *
 * legalMoves zuerst, damit Rochade, En passant und Umbau ihr Flag bekommen -
 * davon haengt ab, was makeMove anstellt. legalMoves schreibt in einen
 * gemeinsamen Modulpuffer; das Ergebnis ist deshalb ein frisches Array, das
 * sofort ausgewertet wird und nicht zwischen zwei Aufrufen liegen darf.
 */
function zugZahl(pos, uci) {
  for (const m of legalMoves(pos)) {
    if (moveToUci(m) === uci) return m;
  }
  return sonderZugZahl(pos, uci);
}

/**
 * Der eine Fall, den legalMoves nicht liefern kann: ein Bauer schlaegt nach
 * hinten.
 *
 * In einer normalen Partie kommt das nicht vor, in einer Aufgabe schon. Und
 * makeMove sowie moveToSan rechnen damit genauso wie mit jedem anderen Zug -
 * nur der Zuggenerator in chess.js erzeugt es nicht, weil ein Bauer in
 * Schach immer nach vorn schiesst. Der Zug wird deshalb aus den Koordinaten
 * gebaut und nicht ueber die Regeln entschieden: es muss ein eigener Bauer
 * sein, auf ein diagonal benachbartes Feld mit einem gegnerischen Stueck.
 * Alles andere bleibt legalMoves vorbehalten.
 */
function sonderZugZahl(pos, uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return -1;
  const von = parseSquare(uci.slice(0, 2));
  const nach = parseSquare(uci.slice(2, 4));
  if (von < 0 || nach < 0) return -1;
  if (!isColor(pos.board[von], pos.turn) || typeOf(pos.board[von]) !== PAWN) return -1;
  if (!isColor(pos.board[nach], pos.turn === WHITE ? 16 : WHITE)) return -1;
  // diagonal, aber in keine feste Richtung
  if (Math.abs((nach & 7) - (von & 7)) !== 1 || (nach >> 4) === (von >> 4)) return -1;
  const promo = uci.length === 5 ? PROMO[uci[4]] : 0;
  return encodeMove(von, nach, promo);
}

/** Meldet eine kaputte UCI-Angabe, statt still nichts zu tun. */
function pruefeUci(uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) {
    throw new Error(`Zugangabe "${uci}" ist keine UCI (erwartet wird z.B. "e2e4" oder "a7a8q")`);
  }
  return uci;
}

// ------------------------------------------------------------------ Baum

/**
 * Neuer Baum mit einer Wurzel.
 *
 * startFen darf eine beliebige Stellung sein - eine Aufgabe beginnt selten in
 * der Grundstellung. Die FEN wird sofort gelesen, damit ein Tippfehler hier
 * auffaellt und nicht drei Zuege spaeter.
 */
export function neuesBaum(startFen = standardFen()) {
  parseFen(startFen); // eine kaputte FEN soll hier scheitern, nicht spaeter
  return {
    wurzel: { fen: startFen, uci: null, san: null, kinder: [], auf: {} },
    kopf: {
      Event: '?',
      Site: '?',
      Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      Round: '?',
      White: '?',
      Black: '?',
      Result: '*',
    },
    aktiv: [],
  };
}

/** FEN der Wurzel. */
export function startFen(tree) {
  return tree.wurzel.fen;
}

/** Der leere Pfad - die Wurzel. */
export function wurzelPfad() {
  return [];
}

/** Der Knoten an diesem Pfad, oder null wenn es ihn nicht gibt. */
export function knotenAn(tree, pfad) {
  return sucheKnoten(tree, pfad);
}

/**
 * Pfad des Kindes der Wurzel mit diesem UCI, sonst null.
 *
 * Statt eines UCI wird auch ein Pfad angenommen - dann ist er selbst die
 * Antwort, sofern es ihn gibt. Das spart das doppelte Nachschlagen, wenn man
 * schon einen Pfad in der Hand hat und nur noch eine Linie anhaengen will.
 */
export function kindPfad(tree, uci) {
  if (Array.isArray(uci)) {
    const k = sucheKnoten(tree, uci);
    return k ? uci.slice() : null;
  }
  const i = tree.wurzel.kinder.findIndex((k) => k.uci === uci);
  return i < 0 ? null : [i];
}

/**
 * Pfad fuer eine ganze Zugfolge ab der Wurzel, oder null wenn ein Zug nicht
 * im Baum liegt. Eine leere Liste ergibt den Wurzelpfad.
 */
export function pfadVonUcis(tree, uciListe) {
  if (!Array.isArray(uciListe)) {
    throw new Error(`Zugfolge muss ein Array sein, ist aber ${uciListe === null ? 'null' : typeof uciListe}`);
  }
  let pfad = [];
  for (const uci of uciListe) {
    const k = knotenAn(tree, pfad);
    const i = k ? k.kinder.findIndex((kind) => kind.uci === uci) : -1;
    if (i < 0) return null;
    pfad = [...pfad, i];
  }
  return pfad;
}

/** Die Kinder eines Pfades, mit Pfad und Index. */
export function kinder(tree, pfad) {
  const k = knoten(tree, pfad);
  return k.kinder.map((kind, kindIndex) => ({
    uci: kind.uci,
    san: kind.san,
    pfad: [...pfad, kindIndex],
    kindIndex,
  }));
}

/**
 * Einen Zug an einen Pfad haengen und den neuen Pfad zurueckgeben.
 *
 * Existiert der Zug dort schon, kommt kein zweiter dazu: derselbe Zug an
 * derselben Stelle ist derselbe Pfad, und ein Doppeleintrag wuerde jeden
 * Abgleich mit der Anzeige unmoeglich machen.
 *
 * Wirft, wenn der Zug in der Stellung nicht moeglich ist. Ein still
 * ignorierter Zug waere ein Loch, das spaeter niemand mehr findet.
 */
export function zugHinzufuegen(tree, pfad, uci) {
  const eltern = knoten(tree, pfad);
  pruefeUci(uci);
  const da = eltern.kinder.findIndex((k) => k.uci === uci);
  if (da >= 0) return [...pfad, da];

  const pos = parseFen(eltern.fen);
  const m = zugZahl(pos, uci);
  if (m < 0) {
    throw new Error(`Zug "${uci}" ist in der Stellung ${eltern.fen} nicht moeglich`);
  }
  const san = moveToSan(pos, m);
  makeMove(pos, m);
  const fen = toFen(pos);
  undoMove(pos);
  eltern.kinder.push({ uci, san, fen, kinder: [], auf: {} });
  return [...pfad, eltern.kinder.length - 1];
}

/**
 * Pfad des Kindes der Wurzel mit diesem UCI - und legt ihn an, wenn es ihn
 * noch nicht gibt. Die Variante von zugHinzufuegen() fuer Stellen, an denen
 * ein Zug garantiert nuetzlich ist: ein Klick auf eine Figur.
 */
export function zugPfad(tree, uci) {
  const da = kindPfad(tree, uci);
  return da === null ? zugHinzufuegen(tree, [], uci) : da;
}

/** Der UCI des letzten Zuges eines Pfades, an der Wurzel null. */
export function pfadZuUci(tree, pfad) {
  if (!pfad || pfad.length === 0) return null;
  return knoten(tree, pfad).uci;
}

/**
 * Alle Pfade, die Hauptlinie zuerst.
 *
 * Eine Tiefensuche, bei der Kind 0 zuerst kommt. Deshalb steht die Hauptlinie
 * vorn und die Nebenzweige danach, in der Reihenfolge des Baumes - ohne das
 * waere die Ausgabe fuer eine Anzeige unbrauchbar. Die Wurzel [] ist auch
 * dabei; sie ist ein Pfad wie jeder andere.
 */
export function allePfade(tree) {
  const raus = [];
  const ab = (pfad) => {
    raus.push(pfad);
    const k = knoten(tree, pfad);
    for (let i = 0; i < k.kinder.length; i++) ab([...pfad, i]);
  };
  ab([]);
  return raus;
}

/** Die Hauptlinie als Liste von Zuegen. */
export function hauptlinie(tree) {
  const raus = [];
  let pfad = [];
  for (;;) {
    const k = knoten(tree, pfad);
    if (!k.kinder.length) return raus;
    pfad = [...pfad, 0];
    raus.push({ uci: k.kinder[0].uci, san: k.kinder[0].san, pfad });
  }
}

/** Liegt der Pfad auf der Hauptlinie? */
export function istHauptlinie(tree, pfad) {
  pruefePfad(pfad);
  return pfad.every((i) => i === 0);
}

/** Der Pfad ohne den letzten Zug. An der Wurzel null. */
export function pfadZumVater(tree, pfad) {
  pruefePfad(pfad);
  return pfad.length === 0 ? null : pfad.slice(0, -1);
}

/**
 * Hochziehen: die Linie an diesem Pfad wird Hauptlinie, ihre bisherigen
 * Nachfolger werden Zweig. Gibt den neuen Pfad zurueck.
 *
 * Weil die Hauptlinie "immer Kind 0" ist, genuegt es, an der ERSTEN Stelle
 * zu schieben, an der der Pfad von der Hauptlinie abweicht - alles darunter
 * ist dann schon Hauptlinie, weil der Pfad unterwegs selbst nur Nullen hat.
 * Ein Pfad, der nirgends abweicht, bleibt unveraendert: das ist kein Fehler,
 * sondern die Antwort "da ist nichts zu holen".
 *
 * Der Knoten wird eingeschoben, nicht bloss mit dem ersten vertauscht, damit
 * die Reihenfolge der uebrigen Zweige erhalten bleibt.
 *
 * ACHTUNG fuer den Aufrufer: es geht kein Zug verloren, es verschiebt sich
 * nur die Nummer. Pfade, die an dieser Stelle oder darunter abzweigten,
 * tragen danach andere Indizes. Der zurueckgegebene Pfad zeigt wieder auf
 * denselben Knoten, nur an seiner neuen Stelle - wer einen gemerkten Pfad
 * mitfuehrt, muss ihn danach neu holen.
 */
export function umwandeln(tree, pfad) {
  pruefePfad(pfad);
  if (pfad.length === 0) return [];
  knoten(tree, pfad);
  const abweichung = pfad.findIndex((i) => i !== 0);
  if (abweichung < 0) return [...pfad];
  const vater = knoten(tree, pfad.slice(0, abweichung));
  vater.kinder.unshift(...vater.kinder.splice(pfad[abweichung], 1));
  return [...pfad.slice(0, abweichung), 0, ...pfad.slice(abweichung + 1)];
}

/** Die UCI-Zugfolge von der Wurzel bis zu diesem Pfad. */
export function zugfolge(tree, pfad) {
  pruefePfad(pfad);
  const raus = [];
  for (let i = 1; i <= pfad.length; i++) raus.push(knoten(tree, pfad.slice(0, i)).uci);
  return raus;
}

/** Die FEN, die zu diesem Pfad gehoert. */
export function fenPfad(tree, pfad) {
  return knoten(tree, pfad).fen;
}

// ------------------------------------------------------------------ Auf- und Zuklappen

/**
 * Steht zu einem Pfad etwas im Baum, gilt er als aufgeklappt.
 *
 * Voreinstellung ist "auf": eine Nebenspur, die gerade angelegt wurde, soll
 * auch zu sehen sein. Wer sie zuklappt, schreibt hier "zu".
 */
function istAuf(tree, pfad) {
  const auf = knoten(tree, pfad).auf;
  const schluessel = pfad.join(',');
  if (Object.prototype.hasOwnProperty.call(auf, schluessel)) return auf[schluessel];
  return true;
}

function merkeAuf(tree, pfad, wert) {
  knoten(tree, pfad).auf[pfad.join(',')] = !!wert;
}

/** Einen Pfad auf- oder zuklappen. Gibt den neuen Zustand zurueck. */
export function aufklappen(tree, pfad, wert = true) {
  pruefePfad(pfad);
  if (knoten(tree, pfad).kinder.length < 2) {
    throw new Error(`${pfadText(pfad)} hat keinen Zweig zum Auf- oder Zuklappen`);
  }
  merkeAuf(tree, pfad, wert);
  return !!wert;
}

/**
 * Alle FENs im Baum von der Wurzel aus neu berechnen: tief zuerst, mit
 * makeMove hin und undoMove zurueck.
 *
 * Beim Anlegen wird die FEN eines Knoten aus der FEN seines Vaters berechnet
 * - das ist billig und richtig, weil die Kette an der Wurzel beginnt. Diese
 * Funktion rechnet alles neu und ist damit die Gegenprobe: bricht hier
 * etwas, stimmt die Kette nicht mehr.
 */
export function fenBerechnen(tree) {
  const ab = (k) => {
    const pos = parseFen(k.fen);
    for (const kind of k.kinder) {
      const m = zugZahl(pos, kind.uci);
      if (m < 0) throw new Error(`Zug "${kind.uci}" passt nicht zur FEN ${k.fen}`);
      // Notation VOR dem Zug: moveToSan sieht die Stellung von davor an.
      kind.san = moveToSan(pos, m);
      makeMove(pos, m);
      kind.fen = toFen(pos);
      undoMove(pos);
      ab(kind);
    }
  };
  ab(tree.wurzel);
  return tree;
}

// ------------------------------------------------------------------ Anzeige

/**
 * Die Zugsliste fuer die Anzeige, im Stil von lichess.
 *
 * sichtbarAbKnoten ist ein Pfad oder null:
 *   null  die ganze Partie ab der Wurzel, aufgeklappt wie im Baum vermerkt;
 *   Pfad  alles ab diesem Knoten, einerlei wie der Zweig im Baum steht. Das
 *         braucht eine Seite, die eine Nebenspur anzeigt, ohne jeden Zweig
 *         einzeln aufklappen zu muessen.
 *
 * Zeile und Spalte sind 1-basiert. Die Zeilennummer ist die, die vorn
 * gedruckt wird: eine Nebenspur traegt die Nummer, an der sie abzweigt
 * ("2..."), nicht ihre eigene. Welche Seite am Zug ist, steht nicht im
 * Eintrag - sie folgt aus der Zeilennummer und der Seite an der Wurzel
 * (fen.split(' ')[1]), und die Anzeige weiss sie ohnehin vom Brett.
 *
 * `kinder` steht nur an einem Zug, an dem es eine Nebenspur gibt UND sie
 * aufgeklappt ist. Die Eintraege darin sind die ganze Nebenspur in der
 * Reihenfolge, in der sie gespelt werden kann; jeder davon kann wieder
 * `kinder` haben, wenn dort noch eine Spur abzweigt. Fuer die Ausgabe:
 *
 *   Zug mit kinder    ->  "N. san (kind0 kind1 …)"      (Hauptlinie)
 *   Zug ohne kinder   ->  "N. san"
 *   Eintrag in kinder ->  Teil einer Klammer; seine eigenen kinder sind
 *                         eine eigene, eingerueckte Klammer darin.
 *
 * Eine Klammer endet, wo der naechste Eintrag nicht die Fortsetzung des
 * vorigen ist - sein Pfad waechst nicht um genau eine Null. Das ist der Fall,
 * wenn an einem Zug zwei Nebenspuren haengen.
 */
export function zeilen(tree, sichtbarAbKnoten = null) {
  const ab = sichtbarAbKnoten === null ? [] : pruefePfad(sichtbarAbKnoten);
  knoten(tree, ab); // muss es geben
  const aktiv = tree.aktiv || [];
  // Alles ab sichtbarAbKnoten ist auf, ohne Ausnahme.
  const erzwungen = sichtbarAbKnoten !== null;
  const offen = (pfad) => erzwungen || istAuf(tree, pfad);

  const zeilenListe = [];
  const zeileFuer = (nummer) => {
    while (zeilenListe.length < nummer) zeilenListe.push({ nummer: zeilenListe.length + 1, zuege: [] });
    return zeilenListe[nummer - 1];
  };

  /** Ein Zug als Eintrag. `ziel` ist die Liste, in die er gehoert. */
  const eintrag = (pfad, halbzug, haupt, ziel) => {
    const k = knoten(tree, pfad);
    const nummer = Math.ceil(halbzug / 2);
    const e = {
      uci: k.uci,
      san: k.san,
      pfad: [...pfad],
      istHauptlinie: haupt,
      zeile: nummer,
      spalte: ziel.length + 1,
      aktiv: pfadIstAnfang(pfad, aktiv),
      aufgeklappt: false,
    };
    if (k.kinder.length > 1 && offen(pfad)) {
      e.aufgeklappt = true;
      e.kinder = spur([...pfad, 1], halbzug + 1, [], false);
    }
    ziel.push(e);
    return e;
  };

  /**
   * Eine Nebenlinie: der Zug am Ende von `pfad`, danach bis zum Blatt immer
   * Kind 0, und an jedem davon wieder die eigenen Nebenspuren.
   */
  function spur(pfad, halbzug, ziel, haupt) {
    let p = pfad;
    let h = halbzug;
    for (;;) {
      eintrag(p, h, haupt, ziel);
      const k = knoten(tree, p);
      if (!k.kinder.length) return ziel;
      p = [...p, 0];
      h += 1;
    }
  }

  // Die Hauptlinie, Halbzug fuer Halbzug. Jeder Zug kommt in seine Zeile.
  let pfad = [...ab, 0];
  let halbzug = 1;
  for (;;) {
    const k = knoten(tree, pfad);
    eintrag(pfad, halbzug, true, zeileFuer(Math.ceil(halbzug / 2)).zuege);
    if (!k.kinder.length) break;
    pfad = [...pfad, 0];
    halbzug += 1;
  }

  return { zeilen: zeilenListe };
}

/** Den aktuellen Pfad merken - er bekommt in zeilen() das `aktiv`. */
export function aktivSetzen(tree, pfad) {
  knoten(tree, pfad);
  tree.aktiv = [...pfad];
  return tree.aktiv;
}

// ------------------------------------------------------------------ PGN raus

const KOPF_PFLICHT = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
const ERGEBNISSE = ['1-0', '0-1', '1/2-1/2', '*'];

/** Anfuehrungszeichen und Zeilenumbrueche aus einem Kopf-Wert. */
function kopfWert(wert) {
  return String(wert).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');
}

/**
 * Das Ergebnis der Hauptlinie: '*', wenn die Partie weitergeht, sonst was
 * chess.js zur Endstellung sagt. Ein Remis aus materieller Sicht zaehlt hier
 * NICHT als Partieende - das Spiel laeuft weiter, es ist nur nicht mehr zu
 * gewinnen.
 */
function endeErgebnis(tree) {
  const haupt = hauptlinie(tree);
  const pfad = haupt.length ? haupt[haupt.length - 1].pfad : [];
  const pos = parseFen(knoten(tree, pfad).fen);
  if (legalMoves(pos).length > 0) return '*';
  if (isStalemate(pos)) return '1/2-1/2';
  if (isCheckmate(pos)) return outcome(pos) || '*';
  return '*';
}

/** Zeilenumbruch bei 80 Spalten, wie es das PGN verlangt. */
function umbruch(text, spalten = 80) {
  const raus = [];
  let zeile = '';
  for (const wort of text.split(' ')) {
    if (!wort) continue;
    if (!zeile) zeile = wort;
    else if (zeile.length + 1 + wort.length <= spalten) zeile += ' ' + wort;
    else {
      raus.push(zeile);
      zeile = wort;
    }
  }
  if (zeile) raus.push(zeile);
  return raus.join('\n');
}

/** Spieltext einer Partie mit Nebenwegen, als Wortliste. */
function spieltext(tree) {
  const worte = [];
  const schwarz = knoten(tree, []).fen.split(' ')[1] === 'b';
  // Wessen Reihe ist es beim n-ten Halbzug? Von der Wurzel aus wechselt sie.
  const istSchwarz = (halbzug) => (schwarz ? halbzug % 2 === 1 : halbzug % 2 === 0);

  /** `pfad` ist der Pfad des ersten Zuges der Linie. */
  const linie = (pfad, halbzug, anfang) => {
    let p = pfad;
    let h = halbzug;
    let eroeffnet = anfang;
    for (;;) {
      const k = knoten(tree, p);
      const nummer = Math.ceil(h / 2);
      // Vor einem weissen Zug steht immer seine Zahl, vor einem schwarzen
      // nur, wenn er einen Anfang eroeffnet - so macht es das PGN.
      if (!istSchwarz(h)) worte.push(`${nummer}.`);
      else if (eroeffnet) worte.push(`${nummer}...`);
      worte.push(k.san);
      for (let i = 1; i < k.kinder.length; i++) {
        worte.push('(');
        linie([...p, i], h + 1, true);
        worte.push(')');
      }
      if (!k.kinder.length) return;
      p = [...p, 0];
      h += 1;
      eroeffnet = false;
    }
  };

  if (knoten(tree, []).kinder.length) linie([0], 1, true);
  return worte;
}

/**
 * Vollstaendiges PGN mit Kopf. kopf ueberschreibt den Kopf am Baum.
 *
 * Reihenfolge der Kopfzeilen wie ueblich: die sieben Pflicht-Tags, dann die
 * eigenen Angaben, und ganz hinten [SetUp]/[FEN], falls nicht in der
 * Grundstellung gespielt wurde.
 */
export function pgnExportieren(tree, kopf = {}) {
  const meta = { ...(tree.kopf || {}), ...(kopf || {}) };
  // "*" heisst "unbekannt" - dann wird gerechnet. Sonst wuerde eine
  // beendete Partie als laufende abgespeichert, nur weil der Baum kein
  // Ergebnis kennt.
  const ergebnis = meta.Result && meta.Result !== '*' && ERGEBNISSE.includes(meta.Result) ? meta.Result : endeErgebnis(tree);
  meta.Result = ergebnis;

  const zeilenKopf = [];
  for (const name of KOPF_PFLICHT) zeilenKopf.push(`[${name} "${kopfWert(meta[name] ?? '?')}"]`);
  for (const [name, wert] of Object.entries(meta)) {
    if (KOPF_PFLICHT.includes(name) || name === 'FEN' || name === 'SetUp') continue;
    zeilenKopf.push(`[${name} "${kopfWert(wert)}"]`);
  }
  if (startFen(tree) !== standardFen()) {
    zeilenKopf.push('[SetUp "1"]');
    zeilenKopf.push(`[FEN "${startFen(tree)}"]`);
  }

  const worte = spieltext(tree);
  worte.push(ergebnis);
  // Kein Leerzeichen direkt hinter "(" und vor ")" - so schreibt es jede
  // Partie, und so liest man den Text schneller.
  const text = worte.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')');
  return `${[...zeilenKopf, '', umbruch(text)].join('\n')}\n`;
}

/** Metadaten am Baum speichern (der vorhandene Kopf bleibt, neu gewinnt). */
export function pgnKopfSetzen(tree, kopf) {
  if (!kopf || typeof kopf !== 'object') {
    throw new Error(`Kopf muss ein Objekt sein, ist aber ${kopf === null ? 'null' : typeof kopf}`);
  }
  for (const [name, wert] of Object.entries(kopf)) {
    if (typeof name !== 'string' || !name) throw new Error(`Kopfzeile ohne Namen: ${JSON.stringify(name)}`);
    if (wert === undefined || wert === null) continue;
    tree.kopf[name] = String(wert);
  }
  return tree.kopf;
}

// ------------------------------------------------------------------ PGN rein

/** Kommentare aus einer Zeile: {...} (auch verschachtelt) und ; bis zum Ende. */
function ohneKommentare(zeile) {
  let raus = '';
  let tiefe = 0;
  for (let i = 0; i < zeile.length; i++) {
    const ch = zeile[i];
    if (tiefe) {
      if (ch === '{') tiefe += 1;
      else if (ch === '}') tiefe -= 1;
      else if (ch === '\n') tiefe = 0; // ungeschlossener Kommentar endet mit der Zeile
      continue;
    }
    if (ch === '{') {
      tiefe = 1;
      continue;
    }
    if (ch === ';') break;
    raus += ch;
  }
  return raus;
}

/** Kopf und Spieltext trennen. Liefert auch die erste Zeile des Spieltexts. */
function kopfTrennen(text) {
  const zeilen = text.replace(/\r\n?/g, '\n').split('\n');
  const kopf = {};
  let i = 0;
  for (; i < zeilen.length; i++) {
    const roh = zeilen[i];
    if (roh.startsWith('%')) continue; // Escape-Zeile laut PGN
    const zeile = ohneKommentare(roh).trim();
    if (!zeile) continue;
    if (!zeile.startsWith('[')) break;
    const m = zeile.match(/^\[([A-Za-z0-9_+#=:-]+)\s+(?:"((?:[^"\\]|\\.)*)"|([^\s\]]*))\s*\]$/);
    if (!m) {
      throw new Error(`PGN Zeile ${i + 1}: "${zeile.slice(0, 40)}" ist keine Kopfzeile (erwartet wird [Name "Wert"])`);
    }
    kopf[m[1]] = m[2] !== undefined ? m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : m[3];
  }
  return { kopf, spieltext: zeilen.slice(i).join('\n'), startZeile: i + 1 };
}

/**
 * Spieltext in Worte zerlegen. Kommentare, Kennzeichen und Escape-Zeilen
 * fallen weg - ohne zu melden. Jedes Wort weiss seine Zeilennummer, damit
 * eine Fehlermeldung sagen kann, wo es kaputtging.
 */
function zerlegen(text, startZeile) {
  const raus = [];
  let zeile = startZeile;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') {
      zeile += 1;
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '{') {
      let tiefe = 1;
      i += 1;
      while (i < text.length && tiefe > 0) {
        if (text[i] === '{') tiefe += 1;
        else if (text[i] === '}') tiefe -= 1;
        else if (text[i] === '\n') zeile += 1;
        i += 1;
      }
      continue;
    }
    if (ch === ';') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '%' && (i === 0 || text[i - 1] === '\n')) {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      raus.push({ wort: ch, zeile });
      i += 1;
      continue;
    }
    let wort = '';
    while (i < text.length && !' \t\r\n{};()'.includes(text[i])) {
      wort += text[i];
      i += 1;
    }
    raus.push({ wort, zeile });
  }
  return raus;
}

/** Ziffern, Punkte und Kennzeichen von einem Zugwort abschneiden. */
function zugText(wort) {
  return wort
    .replace(/^\$\d+/, '') // Kennzeichen wie $14
    .replace(/^\d+\.*/, '') // "1."  "1..."  "12.Nf3"
    .replace(/[!?]+$/, ''); // Ausrufe- und Fragezeichen
}

/**
 * SAN zu UCI, oder null wenn der Zug in der Stellung nicht geht.
 *
 * sanToMove zuerst; danach der eine Sonderfall, den er nicht findet: ein
 * Bauer, der nach hinten schlaegt ("bxa3"). Fuer ihn nennt die Notation
 * Datei und Zielfeld, mehr braucht es nicht.
 */
function uciAusSan(pos, san) {
  const m = sanToMove(pos, san);
  if (m >= 0) return moveToUci(m);
  const s = san.replace(/[+#!?]/g, '').replace(/0/g, 'O').trim();
  const t = s.match(/^([KQRBN]?)([a-h]?)(\d?)x?([a-h][1-8])(?:=([NBRQ]))?$/);
  if (!t || t[1] !== '') return null; // nur Bauernzuege kommen hier infrage
  const nach = parseSquare(t[4]);
  if (nach < 0) return null;
  const datei = t[2] === '' ? -1 : t[2].charCodeAt(0) - 97;
  const reihe = t[3] === '' ? -1 : Number(t[3]) - 1;
  for (let s2 = 0; s2 < 128; s2++) {
    if (s2 & 0x88) {
      s2 += 7;
      continue;
    }
    if (datei >= 0 && (s2 & 7) !== datei) continue;
    if (reihe >= 0 && (s2 >> 4) !== reihe) continue;
    const uci = squareName(s2) + squareName(nach) + (t[5] ? t[5].toLowerCase() : '');
    const z = sonderZugZahl(pos, uci);
    if (z >= 0) return moveToUci(z);
  }
  return null;
}

/**
 * PGN einlesen: { tree, kopf, ergebnis, fehler }.
 *
 * Wirft bei unlesbarem Text - die Meldung nennt Zeile und Zug. Kommentare
 * gehen verloren, und das ist Absicht: die Seite fuehrt keine.
 */
export function pgnImportieren(text) {
  if (typeof text !== 'string') {
    throw new Error(`PGN: die Eingabe ist ${text === undefined || text === null ? 'leer' : `kein Text (${typeof text})`}`);
  }
  if (!text.trim()) throw new Error('PGN: die Eingabe ist leer - kein Text, nur Leerraum');
  const { kopf, spieltext: roh, startZeile } = kopfTrennen(text.replace(/^\uFEFF/, ''));

  let wurzelFen = standardFen();
  if (kopf.FEN) {
    try {
      wurzelFen = toFen(parseFen(kopf.FEN));
    } catch (e) {
      throw new Error(`PGN: FEN im Kopf ist kaputt (${kopf.FEN}): ${e.message}`);
    }
  }
  const tree = neuesBaum(wurzelFen);
  pgnKopfSetzen(tree, kopf);
  if (kopf.FEN) pgnKopfSetzen(tree, { FEN: wurzelFen, SetUp: '1' });

  const worte = zerlegen(roh, startZeile);
  let basis = []; // Pfad, von dem der naechste Zug gespielt wird
  let letzter = []; // Pfad des zuletzt gelesenen Zuges
  const stapel = [];
  const hauptUcis = [];
  let ergebnis = null;

  /**
   * Ein Zug an einer Stelle, von der er moeglicherweise zwei moeglich sind.
   *
   * Eine Klammer ist die Alternative zu dem Zug, vor dem sie steht - danach
   * beginnt sie beim VATER dieses Zuges. Nur schreibt das nicht jeder so:
   * eine Nebenlinie, die mit einem schwarzen Zug anfängt, ersetzt den Zug
   * DANACH, denn "1. e4 (1... c5 2. Nf3) e5" ist die uebliche Form. Deshalb
   * bekommt die Klammer zwei Kandidaten, und welcher es ist, entscheidet der
   * erste Zug darin: der oberste, in dem er moeglich ist.
   */
  const setzeZug = (san, zeile) => {
    const offen = stapel.length ? stapel[stapel.length - 1] : null;
    const kandidaten = offen && !offen.gewaehlt ? offen.kandidaten : [basis];
    let pos = null;
    for (const kandidat of kandidaten) {
      const p = parseFen(knoten(tree, kandidat).fen);
      if (pos === null) pos = p;
      const uci = uciAusSan(p, san);
      if (uci === null) continue;
      if (offen) offen.gewaehlt = true;
      basis = zugHinzufuegen(tree, kandidat, uci);
      letzter = basis;
      // Was ausserhalb jeder Klammer gelesen wurde, ist die Hauptlinie.
      if (stapel.length === 0) hauptUcis.push(uci);
      return;
    }
    throw new Error(`PGN Zeile ${zeile}: "${san}" ist in der Stellung ${toFen(pos)} kein legaler Zug`);
  };

  for (const { wort, zeile } of worte) {
    if (wort === '(') {
      if (!letzter.length) {
        throw new Error(`PGN Zeile ${zeile}: "(" steht vor dem ersten Zug - eine Klammer gehoert hinter einen Zug`);
      }
      // Oben zuerst: die Alternative zum Zug davor. Darunter: die Alternative
      // zum Zug danach.
      const stapelEintrag = { kandidaten: [letzter.slice(0, -1), letzter.slice()], gewaehlt: false };
      stapel.push(stapelEintrag);
      basis = stapelEintrag.kandidaten[0];
      continue;
    }
    if (wort === ')') {
      if (!stapel.length) throw new Error(`PGN Zeile ${zeile}: ")" ohne "(" davor`);
      basis = stapel.pop().kandidaten[1].slice();
      letzter = basis.slice();
      continue;
    }
    if (ERGEBNISSE.includes(wort)) {
      ergebnis = wort;
      continue;
    }
    const san = zugText(wort);
    if (!san) continue; // reine Zugnummer
    setzeZug(san, zeile);
  }

  if (stapel.length) {
    throw new Error(`PGN: ${stapel.length} Klammer${stapel.length > 1 ? 'n' : ''} ohne ")" - der Spieltext ist abgebrochen`);
  }
  if (!hauptlinie(tree).length) {
    throw new Error('PGN: kein einziger Zug gefunden - steht nur ein Kopf da?');
  }
  // Die Hauptlinie ist "immer Kind 0". Beim Einlesen kann sie nicht Kind 0
  // sein, weil eine Nebenlinie schon vorher dort sass - sie wird jetzt
  // nach vorn geschoben, Zug fuer Zug. Danach stimmt der Baum wieder.
  let pfad = pfadVonUcis(tree, hauptUcis);
  while (pfad && pfad.some((i) => i !== 0)) {
    const alt = pfad;
    pfad = umwandeln(tree, alt);
    if (pfadGleich(pfad, alt)) break; // Schutz gegen eine Endlosschleife
  }
  pgnKopfSetzen(tree, { Result: ergebnis || endeErgebnis(tree) });
  return { tree, kopf: tree.kopf, ergebnis: ergebnis || endeErgebnis(tree), fehler: null };
}
