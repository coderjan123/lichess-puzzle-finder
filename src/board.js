/**
 * Analysebrett: Brett, Ziehen, Zugsliste, Rückgängig, Zeichnen.
 *
 * Die Regeln kommen aus src/chess.js - dort steht der Zuggenerator, der
 * gegen die publicierten Perft-Zahlen, gegen einen zweiten unabhängigen
 * Generator und gegen python-chess geprüft ist. Hier ist nur die Oberfläche.
 *
 * Bedienung mit einer Hand: jedes Feld ist mindestens 46 px groß. Ein Zug
 * geht auf zwei Arten - Figur antippen, dann Zielfeld antippen, oder direkt
 * ziehen. Beides läuft über DIESEN einen Weg (pointerdown/pointermove/
 * pointerup), nicht über pointerdown UND click: sonst löst ein Tippen beide
 * aus, und ein Ziehen kommt nie an, weil "click" nur ausgelöst wird, wenn
 * Maus und Zeiger auf demselben Element stehen bleiben.
 */

import { VERFUEGBARE_VERSIONEN, engineLaden, umgebungsProblem } from './engine.js';
import {
  QUELLEN,
  ExplorerFehler,
  abbrechen as abfrageAbbrechen,
  abmelden,
  abfrage,
  anmelden,
  anmeldenFortsetzen,
  istAngemeldet,
  tokenStatus,
  normiereFen,
} from './explorer.js';
import {
  parseFen,
  toFen,
  legalMoves,
  moveFrom,
  moveTo,
  movePromo,
  moveToSan,
  moveToUci,
  makeMove,
  undoMove,
  isCheck,
  outcome,
  startFen,
  typeOf,
  WHITE,
  BLACK,
  QUEEN,
  ROOK,
  BISHOP,
  KNIGHT,
  squareName,
  parseSquare,
  fromIndex,
  toIndex,
} from './chess.js';

const $ = (id) => document.getElementById(id);

const el = {
  brett: $('brett'),
  promo: $('promo'),
  promoStuecke: $('promoStuecke'),
  zuege: $('zuege'),
  fen: $('fen'),
  bescheid: $('bescheid'),
  engine: $('engine'),
  explorerZeilen: $('explorerZeilen'),
  explorerHinweis: $('explorerHinweis'),
  explorerSumme: $('explorerSumme'),
  summeZahl: $('summeZahl'),
  explorerSpiele: $('explorerSpiele'),
  btnFENSetzen: $('btnFENSetzen'),
  btnLeer: $('btnLeer'),
  btnFENKopieren: $('btnFENKopieren'),
  btnPGNKopieren: $('btnPGNKopieren'),
  btnPGNImport: $('btnPGNImport'),
  btnStart: $('btnStart'),
  btnZurueck: $('btnZurueck'),
  btnWeiter: $('btnWeiter'),
  btnEnde: $('btnEnde'),
  btnDrehen: $('btnDrehen'),
  btnSpeichern: $('btnSpeichern'),
  engineSchalter: $('engineSchalter'),
  engineName: $('engineName'),
  dialog: $('dialog'),
  dialogKoerper: $('dialogKoerper'),
  dialogFertig: $('dialogFertig'),
  dialogZu: $('dialogZu'),
  hilfe: $('hilfe'),
  hilfeListe: $('hilfeListe'),
  hilfeZu: $('hilfeZu'),
  btnEinstellungen: $('btnEinstellungen'),
  setVersion: $('setVersion'),
  setTiefe: $('setTiefe'),
  setZeilen: $('setZeilen'),
  setThreads: $('setThreads'),
  setZeit: $('setZeit'),
  setBoard: $('setBoard'),
  setFiguren: $('setFiguren'),
  setKoordinaten: $('setKoordinaten'),
  setSeite: $('setSeite'),
  explorerAnmelden: $('explorerAnmelden'),
  explorerAbmelden: $('explorerAbmelden'),
  explorerSummeZeile: $('explorerSumme'),
  sortieren: $('btnSortieren'),
};

/**
 * Engine: an, aus, und was gerade gerechnet wird.
 *
 * Die Dateien (1,8 MB) werden erst beim Einschalten geladen - die Seite selbst
 * bleibt 52 kB. Die Engine meldet ueber `aufInfo` jede Zeile, waehrend sie
 * rechnet; gesammelt wird hier nur, was gerade der letzte Stand ist.
 */
const E = {
  an: false,
  laeuft: false,
  objekt: null,
  ladeFehler: null,
  tiefe: 20,
  maxZeitMs: 8000,
  mehrzeilen: 3,
  threads: 1,
  letzteLinien: [],
  info: { tiefe: 0, knoten: 0, nps: 0, sekunden: 0 },
  besterZug: null,
  rechnet: false,
  seitenThema: 'dark',
  /** Quelle der Eröffnungsdatenbank, gerade gewaehlt. */
  quelle: 'lichess',
  /** Letzte Antwort, damit die Zeilen nicht flackern. */
  explorerLetzte: null,
  explorerLaeuft: false,
};

const BUCHSTABE = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const LANG = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
const UMBAU = [
  [QUEEN, 'queen'],
  [ROOK, 'rook'],
  [BISHOP, 'bishop'],
  [KNIGHT, 'knight'],
];

const SVGNS = 'http://www.w3.org/2000/svg';

/**
 * Eine Figur als eigenes `<svg>` mit `<use>` darin.
 *
 * Wichtig, und nicht selbstverständlich: ein `<use>` **muss** in einem
 * `<svg>` stehen. Ohne das umgebende Element gibt es keinen Bezugsrahmen,
 * 100 % Breite und Höhe lösen sich nirgendwo auf - und der Browser malt
 * gar nichts. Der erste Wurf hatte ein nacktes `<use>` in einem `<span>`:
 * das Brett blieb leer, und alle Tests waren grün, weil sie nur gezählt
 * haben, ob ein Element mit passendem `href` da ist. Deshalb prüft
 * `bretttest.mjs` jetzt Pixel, nicht Elemente.
 */
function figurElement(id) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 45 45');
  const nutzlast = document.createElementNS(SVGNS, 'use');
  nutzlast.setAttribute('href', `#${id}`);
  svg.append(nutzlast);
  return svg;
}

/** Nur das `href` erneuern, wenn sich die Figur aendert. */
function setzeFigur(svg, id) {
  const nutzlast = svg.firstChild;
  if (nutzlast.getAttribute('href') !== `#${id}`) nutzlast.setAttribute('href', `#${id}`);
}

/** Alles, was die Seite weiss. An einer Stelle, damit nichts fehlt. */
const S = {
  pos: null,
  /** Gespielte Züge als {move, san, uci}. */
  verlauf: [],
  /** Wie viele Züge gerade angezeigt sind. */
  cursor: 0,
  /** Angeklicktes Feld (0x88) oder -1. */
  gewaehlt: -1,
  /** Legale Züge, die zu gewaehlt passen. */
  ziele: [],
  /** Letzter angezeigter Zug, für die Hervorhebung. */
  letzter: null,
  gedreht: false,
  /** Umschlag: {move} - der Zug ist noch nicht entschieden. */
  offen: null,
  /** Zeiger: {von, x, y, startX, startY, zieht, startZiel}. */
  griff: null,
  /** Gezeichnete Pfeile und Kreise. */
  zeichen: [],
  /** Nächste Farbe für ein neues Zeichen. */
  farbeIndex: 0,
};

const FARBEN = ['#35a62a', '#4c8fd5', '#d54c3c', '#c9a227'];

const felder = [];

// ------------------------------------------------------------------ Brett

function baueBrett() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 64; i++) {
    const f = document.createElement('button');
    f.type = 'button';
    f.className = 'feld';
    f.dataset.i = String(i);
    f.setAttribute('role', 'gridcell');
    const kR = document.createElement('span');
    kR.className = 'koordinate reihe';
    const kS = document.createElement('span');
    kS.className = 'koordinate spalte';
    f.append(kR, kS);
    frag.append(f);
    felder.push(f);
  }
  const ebene = document.createElement('div');
  ebene.className = 'zeichen';
  ebene.id = 'zeichenEbene';
  frag.append(ebene);
  el.brett.replaceChildren(frag);
}

/** Index 0 ist die linke obere Ecke in der gezeigten Lage. */
const anzeigeIndex = (i) => (S.gedreht ? 63 - i : i);

function zeichne() {
  const pos = S.pos;
  // king[0] ist der weise, king[1] der schwarze Koenig (siehe chess.js, setFen
  // und makeMove). Wer hier spiegelt, faerbt bei Schach fuer Weiss den
  // schwarzen Koenig rot - das ist genau der Fehler, der zwei Tage unentdeckt
  // blieb, weil die Regeltests diese Funktion nie benutzen.
  const koenig = isCheck(pos) ? (pos.turn === WHITE ? pos.king[0] : pos.king[1]) : -1;
  const schachAnzeige = koenig >= 0 ? anzeigeIndex(toIndex(koenig)) : -1;
  const ziele = new Set(S.ziele.map((m) => anzeigeIndex(toIndex(moveTo(m)))));
  const letzterVon = S.letzter ? anzeigeIndex(toIndex(moveFrom(S.letzter))) : -1;
  const letzterNach = S.letzter ? anzeigeIndex(toIndex(moveTo(S.letzter))) : -1;
  const gewaehltAnzeige = S.gewaehlt >= 0 ? anzeigeIndex(toIndex(S.gewaehlt)) : -1;
  const koordinaten = document.getElementById('setKoordinaten');

  // i ist der Brettindex (Zeile 0 = die 8. Reihe), d der Anzeigeindex
  // (Zeile 0 = oben). Beide werden gebraucht, und sie sind nicht dasselbe,
  // sobald das Brett gedreht ist.
  for (let i = 0; i < 64; i++) {
    const d = anzeigeIndex(i);
    const feld = felder[d];
    const sq = fromIndex(i);
    const stueck = pos.board[sq];
    const hell = ((d >> 3) + (d & 7)) % 2 === 0;

    feld.className = `feld ${hell ? 'hell' : 'dunkel'}`;
    if (d === letzterVon || d === letzterNach) feld.classList.add('hervor');
    if (d === gewaehltAnzeige) feld.classList.add('gewaehlt');
    if (d === schachAnzeige) feld.classList.add('schach');

    // Figur
    let halter = feld.querySelector('.figur');
    if (!stueck) {
      if (halter) halter.remove();
    } else {
      if (!halter) {
        halter = document.createElement('span');
        halter.className = 'figur';
        halter.append(figurElement('wP'));
        feld.prepend(halter);
      }
      const id = `${stueck & BLACK ? 'b' : 'w'}${BUCHSTABE[typeOf(stueck)]}`;
      setzeFigur(halter.firstChild, id);
      halter.classList.toggle('zieht', Boolean(S.griff?.zieht && S.griff.von === sq));
    }

    // Möglicher Zug: Punkt ins leere Feld, Ring um ein besetztes.
    // Der Ring gehoert NUR auf ein Feld, auf dem wirklich etwas steht -
    // sonst sieht jeder leere Zielpunkt aus wie ein Schlagfeld.
    let hinweis = feld.querySelector('.hinweis');
    if (ziele.has(d)) {
      if (!hinweis) {
        hinweis = document.createElement('span');
        hinweis.className = 'hinweis';
        feld.append(hinweis);
      }
      feld.classList.toggle('besetzt', Boolean(stueck));
    } else if (hinweis) {
      hinweis.remove();
      feld.classList.remove('besetzt');
    }

    // Koordinaten wie bei lichess nur in den Ecken. Nach der Klasse fragen,
    // nicht nach der Position: die Figur wird per prepend eingefuegt und
    // verschiebt sonst alles um eine Stelle.
    const dReihe = d >> 3;
    const dSpalte = d & 7;
    const kR = feld.querySelector('.koordinate.reihe');
    const kS = feld.querySelector('.koordinate.spalte');
    const zeige = !koordinaten || koordinaten.checked;
    if (zeige && (dReihe === 7 || dReihe === 0) && (dSpalte === 0 || dSpalte === 7)) {
      // Die Beschriftung gehoert zu dem Quadrat, das hier liegt - also zu i,
      // dem Brettindex. Spiegeln muss man hier nichts: das Drehen ist
      // schon ueber d erledigt.
      kR.textContent = String.fromCharCode(97 + (i & 7));
      kS.textContent = String(8 - (i >> 3));
      kR.hidden = false;
      kS.hidden = false;
    } else {
      kR.hidden = true;
      kS.hidden = true;
    }

    feld.setAttribute(
      'aria-label',
      stueck
        ? `${stueck & BLACK ? 'black' : 'white'} ${LANG[BUCHSTABE[typeOf(stueck)]]} on ${squareName(sq)}`
        : squareName(sq),
    );
  }

  zeichenZeichnen();
  zugliste();
  el.btnZurueck.disabled = S.cursor === 0;
  el.btnStart.disabled = S.cursor === 0;
  el.btnWeiter.disabled = S.cursor >= S.verlauf.length;
  el.btnEnde.disabled = S.cursor >= S.verlauf.length;
}

// ------------------------------------------------------------------ Stellung

function lade(fen, { verlauf = null, cursor = null, meldung = null } = {}) {
  try {
    S.pos = parseFen(fen);
  } catch (err) {
    sag(`${err.message}. The position was not changed.`, 'fehler');
    return false;
  }
  S.gewaehlt = -1;
  S.ziele = [];
  S.offen = null;
  S.griff = null;
  if (verlauf) {
    S.verlauf = verlauf;
    S.cursor = cursor ?? verlauf.length;
    S.letzter = S.cursor > 0 ? S.verlauf[S.cursor - 1].move : null;
  } else {
    S.verlauf = [];
    S.cursor = 0;
    S.letzter = null;
  }
  el.fen.value = toFen(S.pos);
  zeichne();
  engineRechnen();
  if (meldung) sag(meldung, 'ok');
  // Eine eingetippte Endstellung sagt von selbst, dass sie zu Ende ist -
  // sonst steht da "Position geladen" und man sucht den Matt vergeblich.
  const ergebnis = outcome(S.pos);
  if (ergebnis) {
    sag(
      ergebnis === '1/2-1/2' ? 'Draw.' : ergebnis === '1-0' ? 'White wins.' : 'Black wins.',
      ergebnis === '1/2-1/2' ? null : 'ok',
    );
  }
  return true;
}

function spiele(move) {
  const san = moveToSan(S.pos, move);
  makeMove(S.pos, move);
  S.verlauf = S.verlauf.slice(0, S.cursor);
  S.verlauf.push({ move, san, uci: moveToUci(move) });
  S.cursor = S.verlauf.length;
  S.letzter = move;
  S.gewaehlt = -1;
  S.ziele = [];
  el.fen.value = toFen(S.pos);
  zeichne();
  adresseSchreiben();
  engineRechnen();
  explorerFragen();
  const ergebnis = outcome(S.pos);
  if (ergebnis) {
    sag(
      ergebnis === '1/2-1/2' ? 'Draw.' : ergebnis === '1-0' ? 'White wins.' : 'Black wins.',
      ergebnis === '1/2-1/2' ? null : 'ok',
    );
  }
}

/**
 * "Undo" nimmt den letzten Zug wirklich weg - im Gegensatz zum Springen in
 * der Liste. Wer danach einen anderen Zug spielt, beginnt dort neu.
 */
function zurueck() {
  if (S.cursor === 0) return;
  S.verlauf.pop();
  undoMove(S.pos);
  S.cursor = S.verlauf.length;
  S.letzter = S.cursor > 0 ? S.verlauf[S.cursor - 1].move : null;
  S.gewaehlt = -1;
  S.ziele = [];
  el.fen.value = toFen(S.pos);
  zeichne();
  adresseSchreiben();
  engineRechnen();
  explorerFragen();
}

/**
 * Direkt an eine Stelle im Verlauf springen, vorwärts wie rückwärts.
 *
 * Wichtig: dabei wird NICHTS gelöscht. Nur "Undo" und "New game" kürzen die
 * Partie. Wer sich nur zurückschauen will, muss sie hinterher wieder
 * vorwärts gehen können - und genau daran ist vorher die Zugsliste
 * verschwunden.
 */
function geheZu(cursor) {
  if (cursor < 0 || cursor > S.verlauf.length) return;
  while (S.cursor > cursor) {
    undoMove(S.pos);
    S.cursor -= 1;
  }
  while (S.cursor < cursor) {
    makeMove(S.pos, S.verlauf[S.cursor].move);
    S.cursor += 1;
  }
  S.letzter = cursor > 0 ? S.verlauf[cursor - 1].move : null;
  S.gewaehlt = -1;
  S.ziele = [];
  el.fen.value = toFen(S.pos);
  zeichne();
  adresseSchreiben();
  engineRechnen();
  explorerFragen();
}

// ------------------------------------------------------------------ Ziehen und Tippen

/** Square under the pointer, or -1. Uses elementFromPoint so it works even
 *  when the finger is on a piece that is half over the edge. */
function feldUnter(x, y) {
  const treffer = document.elementFromPoint(x, y);
  const feld = treffer?.closest?.('.feld');
  return feld ? Number(feld.dataset.i) : -1;
}

el.brett.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || S.offen) return;
  const i = feldUnter(e.clientX, e.clientY);
  if (i < 0) return;
  const sq = fromIndex(i);
  const eigene = S.pos.board[sq] !== 0 && (S.pos.board[sq] & 24) === S.pos.turn;

  // Second tap on a target: finish the move right here.
  if (!eigene && S.gewaehlt >= 0) {
    const treffer = zugNach(S.gewaehlt, sq);
    if (treffer !== undefined) {
      e.preventDefault();
      fertig(treffer);
      return;
    }
  }
  if (!eigene) {
    // Empty or enemy square without a selection: forget the selection.
    if (S.gewaehlt >= 0) waehle(-1);
    return;
  }
  e.preventDefault();
  S.griff = {
    von: sq,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    zieht: false,
    startZiel: i,
  };
  waehle(sq);
  // Das Anhängen des Zeigers ist eine Bequemlichkeit, kein muss. Wenn der
  // Zeiger nicht aktiv ist (oder es der Test ist), wirft es - und dann darf
  // der Zug nicht hängen bleiben.
  try {
    el.brett.setPointerCapture?.(e.pointerId);
  } catch {
    /* egal */
  }
});

el.brett.addEventListener('pointermove', (e) => {
  const g = S.griff;
  if (!g) return;
  g.x = e.clientX;
  g.y = e.clientY;
  if (!g.zieht && Math.hypot(g.x - g.startX, g.y - g.startY) > 8) {
    g.zieht = true;
    ghostAnlegen();
  }
  if (g.zieht) {
    const geist = document.getElementById('geist');
    if (geist) {
      geist.style.left = `${g.x}px`;
      geist.style.top = `${g.y}px`;
    }
  }
});

el.brett.addEventListener('pointerup', (e) => {
  const g = S.griff;
  S.griff = null;
  document.getElementById('geist')?.remove();
  if (!g) return;
  if (!g.zieht) {
    // A tap on the piece itself: keep the selection, that is what the user
    // wants when they tap a piece and then a target.
    return;
  }
  const i = feldUnter(g.x, g.y);
  if (i < 0 || i === g.startZiel) return;
  const treffer = zugNach(g.von, fromIndex(i));
  if (treffer !== undefined) {
    e.preventDefault();
    fertig(treffer);
  } else {
    zeichne();
  }
});

el.brett.addEventListener('pointercancel', () => {
  S.griff = null;
  document.getElementById('geist')?.remove();
  zeichne();
});

function waehle(sq) {
  S.gewaehlt = sq;
  S.ziele = sq < 0 ? [] : legalMoves(S.pos).filter((m) => moveFrom(m) === sq);
  zeichne();
}

/** The legal move from `von` to `nach`, or undefined. Promotions are
 *  returned without the piece - the choice is asked for afterwards. */
function zugNach(von, nach) {
  return S.ziele.find((m) => moveFrom(m) === von && moveTo(m) === nach);
}

function fertig(ohneUmbau) {
  if (movePromo(ohneUmbau) !== 0) {
    S.offen = { move: ohneUmbau };
    zeigeUmbau();
    return;
  }
  spiele(ohneUmbau);
}

// ------------------------------------------------------------------ Geist beim Ziehen

function ghostAnlegen() {
  const sq = S.griff.von;
  const stueck = S.pos.board[sq];
  if (!stueck) return;
  document.getElementById('geist')?.remove();
  const g = document.createElement('div');
  g.id = 'geist';
  g.className = 'geist';
  // Genau ein Feld, in Pixeln. "11 %" war eine Faustregel gegenueber dem
  // Fenster und wurde auf dem Handy fast doppelt so gross wie das Feld.
  const feld = el.brett.getBoundingClientRect().width / 8;
  if (feld > 0) g.style.width = `${feld}px`;
  g.append(figurElement(`${stueck & BLACK ? 'b' : 'w'}${BUCHSTABE[typeOf(stueck)]}`));
  document.body.append(g);
}

// ------------------------------------------------------------------ Umbau

function zeigeUmbau() {
  const move = S.offen.move;
  const farbe = (S.pos.board[moveFrom(move)] & BLACK) ? 'b' : 'w';
  el.promoStuecke.replaceChildren();
  for (const [typ, name] of UMBAU) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Promote to ${name}`);
    b.append(figurElement(`${farbe}${BUCHSTABE[typ]}`));
    b.addEventListener('click', () => umbau(typ));
    el.promoStuecke.append(b);
  }
  el.promo.hidden = false;
  el.promoStuecke.firstElementChild?.focus();
}

function umbau(typ) {
  const roh = S.offen.move;
  el.promo.hidden = true;
  S.offen = null;
  spiele((roh & ~(7 << 14)) | (typ << 14));
}

el.promo.addEventListener('click', (e) => {
  if (e.target === el.promo) umbauAbbrechen();
});

function umbauAbbrechen() {
  el.promo.hidden = true;
  S.offen = null;
  waehle(-1);
}

el.promo.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') umbauAbbrechen();
});

// ------------------------------------------------------------------ Zugsliste

function zugliste() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < S.verlauf.length; i += 2) {
    const zeile = document.createElement('div');
    zeile.className = 'zug-zeile';
    const nr = document.createElement('div');
    nr.className = 'zug-nummer';
    nr.textContent = `${i / 2 + 1}.`;
    zeile.append(nr);
    const knoepfe = document.createElement('div');
    knoepfe.className = 'zug-knoepfe';
    for (const j of [i, i + 1]) {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'zug-knopf';
      if (j < S.verlauf.length) {
        knopf.textContent = S.verlauf[j].san;
        if (S.cursor === j + 1) knopf.classList.add('an');
        knopf.addEventListener('click', () => geheZu(j + 1));
      } else {
        knopf.disabled = true;
      }
      knoepfe.append(knopf);
    }
    zeile.append(knoepfe);
    frag.append(zeile);
  }
  if (S.verlauf.length === 0) {
    const zeile = document.createElement('div');
    zeile.className = 'zug-zeile';
    const nr = document.createElement('div');
    nr.className = 'zug-nummer';
    nr.textContent = '';
    const knoepfe = document.createElement('div');
    knoepfe.className = 'zug-knoepfe';
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'zug-knopf';
    knopf.textContent = 'No moves yet';
    knopf.disabled = true;
    knoepfe.append(knopf);
    zeile.append(nr, knoepfe);
    frag.append(zeile);
  }
  el.zuege.replaceChildren(frag);
}

function sag(text, art) {
  el.bescheid.textContent = text || '';
  el.bescheid.className = art ? `brett-bescheid ${art}` : 'brett-bescheid';
}

/**
 * Die Stellung steht in der Adresse, wie bei lichess im Editor (?fen=...).
 * Kein eigener "Link kopieren"-Knopf: die Adresse ist ohnehin sichtbar, und
 * ein Link, den man nicht teilen kann, ist keiner. Beim Start wird sie
 * gelesen - darum muss `ersetzen` erst beim ersten Zug aufgerufen werden,
 * sonst überschreibt die Seite sofort ihren eigenen Parameter.
 */
function adresseSchreiben() {
  const url = new URL(location.href);
  url.searchParams.set('fen', toFen(S.pos));
  history.replaceState(null, '', url);
}

/** Aus der Adresse lesen: ?fen=… und #fen als Rückfall. */
function adresseLesen() {
  const ausParameter = new URL(location.href).searchParams.get('fen');
  if (ausParameter && ausParameter.includes('/')) return ausParameter;
  const ausHash = decodeURIComponent(location.hash.replace(/^#/, ''));
  return ausHash.includes('/') ? ausHash : null;
}

// ------------------------------------------------------------------ Zeichnen

/** Feldmitte in Pixeln, bezogen auf die Brett-Ebene. */
function feldMitte(sq) {
  const d = anzeigeIndex(toIndex(sq));
  const brett = el.brett.getBoundingClientRect();
  const feld = brett.width / 8;
  return {
    x: (d % 8) * feld + feld / 2,
    y: Math.floor(d / 8) * feld + feld / 2,
    feld,
  };
}

function zeichenZeichnen() {
  const ebene = document.getElementById('zeichenEbene');
  if (!ebene) return;
  ebene.replaceChildren();
  if (S.zeichen.length === 0) return;
  const svg = document.createElementNS(SVGNS, 'svg');
  for (const z of S.zeichen) {
    const a = feldMitte(z.von);
    const b = feldMitte(z.nach);
    if (z.art === 'kreis') {
      const k = document.createElementNS(SVGNS, 'circle');
      k.setAttribute('cx', b.x);
      k.setAttribute('cy', b.y);
      k.setAttribute('r', a.feld * 0.46);
      k.setAttribute('fill', 'none');
      k.setAttribute('stroke', z.farbe);
      k.setAttribute('stroke-width', String(Math.max(3, a.feld * 0.06)));
      svg.append(k);
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const laenge = Math.hypot(dx, dy) || 1;
    const kuerzer = a.feld * 0.28;
    const spitze = { x: b.x - (dx / laenge) * kuerzer, y: b.y - (dy / laenge) * kuerzer };
    const p = document.createElementNS(SVGNS, 'line');
    p.setAttribute('x1', String(a.x));
    p.setAttribute('y1', String(a.y));
    p.setAttribute('x2', String(spitze.x));
    p.setAttribute('y2', String(spitze.y));
    p.setAttribute('stroke', z.farbe);
    p.setAttribute('stroke-width', String(Math.max(3, a.feld * 0.075)));
    p.setAttribute('stroke-linecap', 'round');
    const s = document.createElementNS(SVGNS, 'polygon');
    const breite = a.feld * 0.16;
    const senkrecht = { x: (-dy / laenge) * breite, y: (dx / laenge) * breite };
    s.setAttribute(
      'points',
      [
        `${b.x},${b.y}`,
        `${spitze.x + senkrecht.x},${spitze.y + senkrecht.y}`,
        `${spitze.x - senkrecht.x},${spitze.y - senkrecht.y}`,
      ].join(' '),
    );
    s.setAttribute('fill', z.farbe);
    svg.append(p, s);
  }
  ebene.append(svg);
}

/** Rechtsklick-Werkzeug: zeichnet einen Pfeil oder Kreis. */
function zeichnenStarten(x, y) {
  const i = feldUnter(x, y);
  if (i < 0) return;
  const sq = fromIndex(i);
  const von = S.zeichenUrsprung;
  if (von === null || von === undefined || von === sq) {
    S.zeichenUrsprung = sq;
    return;
  }
  const gleicheReihe = Math.abs(von - sq) === 16 || Math.abs(von - sq) === 1;
  const art = Math.abs(toIndex(von) - toIndex(sq)) === 0 ? 'kreis' : gleicheReihe ? 'pfeil' : 'kreis';
  S.zeichen.push({ art, von, nach: sq, farbe: FARBEN[S.farbeIndex % FARBEN.length] });
  S.farbeIndex += 1;
  S.zeichenUrsprung = null;
  zeichenZeichnen();
  sag('Right click draws arrows and circles.', null);
}

el.brett.addEventListener('contextmenu', (e) => e.preventDefault());
el.brett.addEventListener('mousedown', (e) => {
  if (e.button !== 2) return;
  e.preventDefault();
  zeichnenStarten(e.clientX, e.clientY);
});

// ------------------------------------------------------------------ Datenbank

/**
 * Eröffnungsdatenbank.
 *
 * Zwei Dinge, die man wissen muss:
 *
 * 1. Die Endpunkte von lichess geben anonym **401**. Es braucht eine
 *    Anmeldung; das Token liegt nur auf diesem Gerät, es gibt kein
 *    Client-Geheimnis und keinen Server. Ohne Anmeldung sagt die Seite das
 *    auch genau so, statt eine leere Tabelle zu zeigen.
 *
 * 2. "Elite" ist die Masters-Datenbank, "CORR", "2024+" und "TT" sind
 *    Filter auf dieselbe Abfrage. Es sind also fuenf Reiter, aber nur zwei
 *    verschiedene Wege - genau so baut es lila.
 */
const X = {
  reihenfolge: null,
  sortierung: 'games',
  spielerZug: false,
};

function explorerAnmeldeZeile(text) {
  const p = document.createElement('p');
  p.className = 'hinweis';
  p.textContent = text;
  el.explorerZeilen.replaceChildren(p);
  el.explorerSumme.hidden = true;
}

/**
 * Anmeldung bei lichess.
 *
 * Gemessen am 06.10.2026, deshalb ohne geratenes scope:
 *
 *   scope=opening_explorer       -> 400 Bad authorization request
 *   scope=opening_explorer:read  -> 400
 *   scope=user:read              -> 400
 *   scope=puzzle:read            -> 303 (weiter zur Anmeldeseite)
 *   scope=email:read             -> 303
 *   **ohne** scope               -> 303
 *
 * Es gibt also kein "opening_explorer"-Recht. Die Datenbank verlangt nur ein
 * gültiges Token eines angemeldeten Kontos, deshalb wird ohne scope
 * gebeten - das ist die einzige Variante, die lichess annimmt.
 */
async function explorerAnmelden() {
  try {
    await anmelden({ scope: 'email:read' });
  } catch (fehler) {
    sag(`Anmeldung nicht möglich: ${fehler.message}`, 'fehler');
  }
}

function explorerAbmelden() {
  abmelden();
  explorerAnmeldeZeile('Abgemeldet.');
  sag('Abgemeldet.', null);
}

/** Nach jeder Stellungsänderung nachfragen - aber nur, wenn eingeloggt. */
async function explorerFragen() {
  if (!istAngemeldet()) {
    explorerAnmeldeZeile('Log in, um die Eröffnungsdatenbank zu sehen.');
    return;
  }
  abfrageAbbrechen();
  S.explorerLaeuft = true;
  const fen = toFen(S.pos);
  const zuege = S.verlauf.slice(0, S.cursor).map((z) => z.uci);
  const quelle = QUELLEN.find((q) => q.id === S.quelle) ?? QUELLEN[0];
  el.explorerZeilen.replaceChildren(Object.assign(document.createElement('p'), {
    className: 'hinweis',
    textContent: 'frage …',
  }));
  try {
    const antwort = await abfrage(fen, { quelle: quelle.id, zuege, anzahl: 12 });
    if (S.explorerLaeuft === false) return;
    S.explorerLetzte = antwort;
    explorerZeichnen(antwort);
  } catch (fehler) {
    const text =
      fehler instanceof ExplorerFehler && fehler.code === 'nichtAngemeldet'
        ? 'Die Anmeldung ist abgelaufen. Bitte erneut einloggen.'
        : `Datenbank nicht erreichbar: ${fehler.message}`;
    explorerAnmeldeZeile(text);
    if (fehler instanceof ExplorerFehler && fehler.code === 'nichtAngemeldet') {
      explorerAnmeldeStand();
    }
  } finally {
    S.explorerLaeuft = false;
  }
}

function explorerAnmeldeStand() {
  el.explorerAnmelden.hidden = false;
  el.explorerAbmelden.hidden = true;
}

function explorerAbmeldeStand() {
  el.explorerAnmelden.hidden = true;
  el.explorerAbmelden.hidden = false;
}

/** Sieg/Unentschieden/Nieder als Balken, wie auf den Screenshots. */
function wdlBalken(zeile) {
  const gewonnen = zeile.weiss ?? 0;
  const verloren = zeile.schwarz ?? 0;
  const unentschieden = zeile.remp ?? 0;
  const summe = gewonnen + verloren + unentschieden;
  const huelle = document.createElement('div');
  huelle.className = 'balken';
  if (summe > 0) {
    const weiss = document.createElement('span');
    weiss.className = 'gewonnen';
    weiss.style.width = `${(gewonnen / summe) * 100}%`;
    const haette = document.createElement('span');
    haette.className = 'grenze';
    haette.style.left = '50%';
    const schwarz = document.createElement('span');
    schwarz.className = 'verloren';
    schwarz.style.width = `${(verloren / summe) * 100}%`;
    const text = document.createElement('span');
    text.className = 'balken-text';
    text.innerHTML = `<span>${Math.round((gewonnen / summe) * 100)}%</span><span>${Math.round((verloren / summe) * 100)}%</span>`;
    huelle.append(weiss, schwarz, haette);
    huelle.title = `Weiß ${gewonnen} · Remis ${unentschieden} · Schwarz ${verloren}`;
  } else {
    huelle.style.background = 'transparent';
  }
  return huelle;
}

function explorerZeichnen(antwort) {
  const frag = document.createDocumentFragment();
  const reihen = antwort.zuege ?? [];
  if (reihen.length === 0) {
    explorerAnmeldeZeile('Keine Züge aus der Datenbank für diese Stellung.');
    return;
  }
  for (const zeile of reihen) {
    const tr = document.createElement('div');
    tr.className = 'explorer-zeile';
    tr.tabIndex = 0;

    const zug = document.createElement('span');
    zug.className = 'zug';
    zug.textContent = zeile.san ?? zeile.uci;

    const bewertung = document.createElement('span');
    bewertung.className = 'bewertung';
    const zahl = typeof zeile.bewertung === 'number' ? (zeile.bewertung / 100).toFixed(2) : null;
    bewertung.textContent = zahl === null ? '' : `${zahl > 0 ? '+' : ''}${zahl}`;
    if (zahl !== null && zahl.startsWith('-')) bewertung.classList.add('negativ');

    const spieleZahl = document.createElement('span');
    spieleZahl.className = 'spiele-zahl';
    spieleZahl.textContent = zeile.spiele ? zeile.spiele.toLocaleString('de-DE') : '';

    const anteil = document.createElement('span');
    anteil.className = 'anteil';
    anteil.textContent = zeile.teil ? `${Math.round(zeile.teil * 100)}%` : '';

    const zweiterAnteil = document.createElement('span');
    zweiterAnteil.className = 'anteil';
    zweiterAnteil.textContent = zeile.teil2 ? `${Math.round(zeile.teil2 * 100)}%` : '';

    tr.append(zug, bewertung, spieleZahl, anteil, zweiterAnteil, wdlBalken(zeile));

    // Klick auf eine Zeile spielt den Zug - das ist der Sinn der Tabelle.
    const spielen = () => {
      const treffer = legalMoves(S.pos).find((m) => moveToUci(m) === zeile.uci);
      if (treffer === undefined) {
        sag(`${zeile.san ?? zeile.uci} ist hier nicht möglich.`, 'fehler');
        return;
      }
      fertig(treffer);
    };
    tr.addEventListener('click', spielen);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        spielen();
      }
    });
    frag.append(tr);
  }
  el.explorerZeilen.replaceChildren(frag);

  // Sigma-Zeile
  if (typeof antwort.weissGesamt === 'number' || typeof antwort.schwarzGesamt === 'number') {
    el.explorerSumme.hidden = false;
    $('summeWeiss').textContent = anteilProzent(antwort.weissGesamt, antwort.weissGesamt, antwort.rempGesamt, antwort.schwarzGesamt);
    $('summeSpiele').textContent = (antwort.spieleGesamt ?? 0).toLocaleString('de-DE');
    $('summeZahl').textContent = (antwort.spieleGesamt ?? 0).toLocaleString('de-DE');
  } else {
    el.explorerSumme.hidden = true;
  }

  // Top-Spiele
  const spiele = antwort.topSpiele ?? [];
  if (spiele.length === 0) {
    $('explorerSpiele').replaceChildren();
    return;
  }
  const spielFrag = document.createDocumentFragment();
  for (const spiel of spiele) {
    const zeile = document.createElement('div');
    zeile.className = 'spiel-zeile';
    const name = document.createElement('a');
    name.href = spiel.url ?? `https://lichess.org/${spiel.weiss ?? ''}${spiel.schwarz ? `_vs_${spiel.schwarz}` : ''}`;
    name.target = '_blank';
    name.rel = 'noopener';
    name.textContent = `${spiel.weiss ?? '?'}${spiel.weissRating ? ` (${spiel.weissRating})` : ''} – ${spiel.schwarz ?? '?'}${spiel.schwarzRating ? ` (${spiel.schwarzRating})` : ''}`;
    const ergebnis = document.createElement('span');
    ergebnis.className = 'ergebnis';
    ergebnis.textContent = spiel.ergebnis ?? '';
    const jahr = document.createElement('span');
    jahr.className = 'ergebnis';
    jahr.textContent = spiel.datum ? String(spiel.datum).slice(0, 4) : '';
    zeile.append(name, ergebnis, jahr);
    spielFrag.append(zeile);
  }
  $('explorerSpiele').replaceChildren(spielFrag);
}

function anteilProzent(weiss, schwarz, remp, schwarzZahl) {
  const summe = weiss + schwarz + (remp ?? 0);
  if (!summe) return '';
  return `${Math.round((weiss / summe) * 100)}% / ${Math.round((schwarzZahl / summe) * 100)}%`;
}

el.explorerAnmelden.addEventListener('click', explorerAnmelden);
el.explorerAbmelden.addEventListener('click', explorerAbmelden);

for (const knopf of document.querySelectorAll('.reiter-knopf')) {
  knopf.addEventListener('click', () => {
    for (const kind of document.querySelectorAll('.reiter-knopf')) kind.classList.remove('aktiv');
    knopf.classList.add('aktiv');
    S.quelle = knopf.dataset.quelle;
    explorerFragen();
  });
}

el.sortieren.addEventListener('click', () => {
  X.sortierung = X.sortierung === 'games' ? 'teil' : 'games';
  if (S.explorerLetzte) explorerZeichnen(S.explorerLetzte);
});

// ------------------------------------------------------------------ Engine

/**
 * Stockfish meldet die Bewertung aus Sicht der Partei am Zug. Auf der Seite
 * steht aber immer die Sicht von Weiss - sonst zeigt die Seite nach
 * 1. e4 e5 2. Nf3 "schwarz +0.23", weil Schwarz am Zug ist. Bei Matt gilt
 * dasselbe: "mate 3" heisst "in drei Zügen matt" fuer die Partei am Zug.
 */
function ausSichtVonWeiss(cp, mate) {
  if (S.pos.turn !== BLACK) return { cp, mate };
  return {
    cp: typeof cp === 'number' ? -cp : cp,
    mate: typeof mate === 'number' ? -mate : mate,
  };
}

/** Wie eine Bewertung bei lichess aussieht: +1.35, M5, -0.02 */
function bewertungAnzeigen(cp, mate) {
  if (typeof mate === 'number') return `M${mate > 0 ? '+' : ''}${mate}`;
  if (typeof cp === 'number') return `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
  return '–';
}

function engineZeichnen() {
  if (!E.an) {
    el.engine.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  if (E.ladeFehler) {
    const p = document.createElement('p');
    p.className = 'engine-wartet';
    p.textContent = E.ladeFehler;
    frag.append(p);
    el.engine.replaceChildren(frag);
    return;
  }
  if (!E.objekt) {
    const p = document.createElement('p');
    p.className = 'engine-wartet';
    p.textContent = 'Lade Engine … (1,7 MB, nur jetzt)';
    frag.append(p);
    el.engine.replaceChildren(frag);
    return;
  }
  if (E.letzteLinien.length === 0) {
    const p = document.createElement('p');
    p.className = 'engine-wartet';
    p.textContent = E.info.tiefe ? `rechnet … Tiefe ${E.info.tiefe}` : 'bereit – spiele einen Zug';
    frag.append(p);
  } else if (E.rechnet) {
    const p = document.createElement('p');
    p.className = 'engine-wartet';
    p.textContent = 'rechnet …';
    frag.append(p);
  }
  // Der kuenstliche "bester Zug"-Eintrag ohne pv entfaellt, sobald es eine
  // echte pv-Zeile gibt - sonst steht der beste Zug zweimal da.
  const mitPv = E.letzteLinien.filter((l) => l.pgn);
  (mitPv.length > 0 ? mitPv : E.letzteLinien).forEach((linie, i) => {
    const zeile = document.createElement('div');
    zeile.className = i === 0 ? 'engine-zeile beste' : 'engine-zeile';
    const wert = document.createElement('span');
    wert.className = 'engine-wert';
    const sicht = ausSichtVonWeiss(linie.cp, linie.mate);
    wert.textContent = bewertungAnzeigen(sicht.cp, sicht.mate);
    const zug = document.createElement('span');
    zug.className = 'engine-zug';
    zug.textContent = linie.pgn || (i === 0 && linie.uci ? linie.uci : '');
    zeile.append(wert, zug);
    frag.append(zeile);
  });
  if (E.info.tiefe) {
    const info = document.createElement('div');
    info.className = 'engine-info';
    info.textContent = `Tiefe ${E.info.tiefe} · ${Math.round(E.info.knoten / 1000)}k Knoten · ${Math.round(E.info.nps / 1000)}k nps · ${(E.info.sekunden / 1000).toFixed(1)}s`;
    frag.append(info);
  }
  el.engine.replaceChildren(frag);
}

/** Die Engine mit der aktuellen Stellung füttern und rechnen lassen. */
function engineRechnen() {
  if (!E.an || !E.objekt) return;
  // Die alten Zeilen bleiben stehen, bis neue kommen. Sie zu loeschen macht
  // die Leiste bei jedem Zug kurz leer - man sieht dann nichts, waehrend die
  // Engine ihre rund zwei Sekunden fuer Stopp und Handshake braucht.
  E.rechnet = true;
  E.besterZug = null;
  E.objekt.analysieren({
    fen: toFen(S.pos),
    tiefe: E.tiefe,
    maxZeitMs: E.maxZeitMs,
    mehrzeilen: E.mehrzeilen,
    threads: E.threads,
  });
  E.laeuft = true;
  engineZeichnen();
}

async function engineAnAus() {
  if (E.an) {
    E.an = false;
    try {
      E.objekt?.stoppen();
    } catch {
      /* egal */
    }
    el.engineSchalter.setAttribute('aria-checked', 'false');
    el.engineName.textContent = 'Engine off';
    engineZeichnen();
    return;
  }
  const problem = umgebungsProblem();
  if (problem) {
    E.ladeFehler = problem;
    engineZeichnen();
    return;
  }
  E.an = true;
  E.ladeFehler = null;
  el.engineSchalter.setAttribute('aria-checked', 'true');
  el.engineName.textContent = 'loading …';
  engineZeichnen();
  try {
    E.objekt = await engineLaden(VERFUEGBARE_VERSIONEN[0], {
      anzeigen: (text) => sag(text, null),
    });
    sag('Engine bereit. Leertaste spielt den besten Zug.', 'ok');
    E.objekt.aufInfo((info) => {
      E.letzteLinien = info.mehrzeilen ?? [];
      E.info = {
        tiefe: info.tiefe ?? 0,
        knoten: info.knoten ?? 0,
        nps: info.nps ?? 0,
        sekunden: info.sekunden ?? 0,
      };
      E.besterZug = info.besterZug ?? null;
      E.rechnet = false;
      engineZeichnen();
      if (E.besterZug) enginePfeilSetzen();
    });
    E.objekt.aufFehler((text) => {
      E.ladeFehler = text;
      engineZeichnen();
    });
    el.engineName.textContent = VERFUEGBARE_VERSIONEN[0].name.replace(' · lite', '');
    engineRechnen();
  } catch (fehler) {
    E.an = false;
    el.engineSchalter.setAttribute('aria-checked', 'false');
    E.ladeFehler = fehler instanceof Error ? fehler.message : String(fehler);
    el.engineName.textContent = 'Engine off';
    engineZeichnen();
  }
}

/** Der beste Zug als grüner Pfeil auf dem Brett - wie auf den Screenshots. */
function enginePfeilSetzen() {
  const uci = E.besterZug;
  if (typeof uci !== 'string' || uci.length < 4) return;
  const von = parseSquare(uci.slice(0, 2));
  const nach = parseSquare(uci.slice(2, 4));
  if (von < 0 || nach < 0) return;
  S.zeichen = S.zeichen.filter((z) => !z.engine);
  S.zeichen.push({ art: 'pfeil', von, nach, farbe: '#35a62a', engine: true });
  zeichenZeichnen();
}

el.engineSchalter.addEventListener('click', engineAnAus);

// Der Haken aendert nur eine Checkbox - ohne Neuzeichnen merkt das Brett
// davon nichts, und die Beschriftung bleibt einfach stehen.
el.setKoordinaten.addEventListener('change', () => zeichne());

// ------------------------------------------------------------------ Einstellungen

/** Knopfreihe aus Werten, wie im Dialog auf den Screenshots. */
function knopfReihe(container, werte, gewaehlt, anzeigen) {
  container.replaceChildren();
  for (const wert of werte) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(wert);
    b.className = wert === gewaehlt ? 'an' : '';
    b.addEventListener('click', () => {
      for (const kind of container.children) kind.classList.remove('an');
      b.classList.add('an');
      anzeigen(wert);
    });
    container.append(b);
  }
}

/** Die drei Seitenthes wie im Einstellungsfenster auf den Screenshots. */
const SEITEN_THEMEN = {
  dark: { name: 'Default', farben: { '--seite': '#000000', '--panel': '#262421', '--panel-2': '#302e2c', '--schrift': '#bababa' } },
  fire: { name: 'Fire', farben: { '--seite': '#16100e', '--panel': '#2a1d18', '--panel-2': '#382720', '--schrift': '#e6d2c4' } },
  emerald: { name: 'Emerald', farben: { '--seite': '#0b1410', '--panel': '#152320', '--panel-2': '#1d312b', '--schrift': '#cfe3d8' } },
};

function seitenThemaSetzen(id) {
  const thema = SEITEN_THEMEN[id];
  if (!thema) return;
  S.seitenThema = id;
  // Die Markierung sitzt an den Knoepfen des Dialogs - ohne das zeigte kein
  // Knopf an, welches Thema gewaehlt ist.
  for (const knopf of el.setSeite?.children ?? []) {
    knopf.classList.toggle('an', knopf.textContent === thema.name);
  }
  for (const [name, wert] of Object.entries(thema.farben)) {
    document.documentElement.style.setProperty(name, wert);
  }
  localStorage.setItem('lp-brett-thema', id);
}

const THEMEN = [
  { name: 'brown', hell: '#f0d9b5', dunkel: '#b58863' },
  { name: 'green', hell: '#eeeed2', dunkel: '#779556' },
  { name: 'blue', hell: '#dde8f5', dunkel: '#7399b5' },
  { name: 'purple', hell: '#e7dff0', dunkel: '#9a7fb8' },
  { name: 'grey', hell: '#e9e9e9', dunkel: '#9c9c9c' },
  { name: 'wood', hell: '#f1ddc0', dunkel: '#c88a52' },
  { name: 'ocean', hell: '#d7e9e8', dunkel: '#5f8f8b' },
  { name: 'dark', hell: '#c9c9c9', dunkel: '#5a5a5a' },
];

function einstellungenFuellen() {
  el.setVersion.replaceChildren();
  for (const v of VERFUEGBARE_VERSIONEN) {
    const o = document.createElement('option');
    o.value = v.id;
    // v.name enthaelt die Groesse bereits - sie hier noch einmal
    // anzusetzen ergab "(1,7 MB) (1,7 MB)".
    o.textContent = v.name;
    el.setVersion.append(o);
  }
  knopfReihe(el.setTiefe, [20, 30, 40], E.tiefe, (v) => {
    E.tiefe = v;
    engineRechnen();
  });
  knopfReihe(el.setZeilen, [1, 2, 3, 4, 5], E.mehrzeilen, (v) => {
    E.mehrzeilen = v;
    engineRechnen();
  });
  knopfReihe(el.setThreads, [1, 2, 4, 8], E.threads, (v) => {
    E.threads = v;
    engineRechnen();
  });
  knopfReihe(el.setZeit, [5000, 8000, 30000, 0], E.maxZeitMs, (v) => {
    E.maxZeitMs = v;
    engineRechnen();
  });
  el.setBoard.replaceChildren();
  for (const thema of THEMEN) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `feld-farbe${thema.name === 'brown' ? ' an' : ''}`;
    b.title = thema.name;
    b.setAttribute('aria-label', thema.name);
    b.style.background = `linear-gradient(135deg, ${thema.hell} 50%, ${thema.dunkel} 50%)`;
    b.addEventListener('click', () => {
      for (const kind of el.setBoard.children) kind.classList.remove('an');
      b.classList.add('an');
      document.documentElement.style.setProperty('--hell', thema.hell);
      document.documentElement.style.setProperty('--dunkel', thema.dunkel);
    });
    el.setBoard.append(b);
  }
  // Figurensaetze: installiert ist derzeit nur Cburnett. Die anderen beiden
  // Knöpfe sind deaktiviert und sagen, warum - ein Knopf, der aussieht wie
  // ein Schalter und nichts tut, ist das Schlimmste an einer Oberflaeche.
  el.setFiguren.replaceChildren();
  for (const [id, name, da] of [
    ['classic', 'Classic', true],
    ['maestro', 'Maestro', false],
    ['retro', 'Retro', false],
  ]) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.textContent = name;
    knopf.className = da ? 'an' : '';
    if (!da) {
      knopf.disabled = true;
      knopf.title = 'Dieser Figurensatz ist noch nicht installiert.';
    } else {
      knopf.addEventListener('click', () => {
        for (const kind of el.setFiguren.children) kind.classList.remove('an');
        knopf.classList.add('an');
      });
    }
    el.setFiguren.append(knopf);
  }
  el.setSeite.replaceChildren();
  for (const [id, thema] of Object.entries(SEITEN_THEMEN)) {
    const b = document.createElement('button');
    b.type = 'button';
    // `name` waere hier das ganze Objekt gewesen - im Dialog stand
    // "[object Object]".
    b.textContent = thema.name;
    b.className = id === S.seitenThema ? 'an' : '';
    b.addEventListener('click', () => seitenThemaSetzen(id));
    el.setSeite.append(b);
  }
}

function dialogOeffnen() {
  einstellungenFuellen();
  el.dialog.hidden = false;
  el.dialogFertig.focus();
}

function dialogSchliessen() {
  el.dialog.hidden = true;
}

el.btnEinstellungen.addEventListener('click', dialogOeffnen);
el.dialogFertig.addEventListener('click', dialogSchliessen);
el.dialogZu.addEventListener('click', dialogSchliessen);
el.dialog.addEventListener('click', (e) => {
  if (e.target === el.dialog) dialogSchliessen();
});

/** Der Hilfe-Dialog: alle Tasten, wie bei lichess mit "?". */
const TASTEN = [
  ['← / →', 'Zug zurück / vor'],
  ['j / k', 'Zug zurück / vor'],
  ['↑ / ↓', 'Anfang / Ende'],
  ['0 / $', 'Anfang / Ende'],
  ['shift+← / →', 'in die Variante / zurück'],
  ['space', 'besten Engine-Zug spielen'],
  ['f', 'Brett drehen'],
  ['x', 'Drohung zeigen'],
  ['l', 'Bewertung ein / aus'],
  ['a', 'Besten-Zug-Pfeile'],
  ['?', 'diese Hilfe'],
];

function hilfeFuellen() {
  const frag = document.createDocumentFragment();
  for (const [taste, was] of TASTEN) {
    const zeile = document.createElement('div');
    const k = document.createElement('kbd');
    k.textContent = taste;
    const t = document.createElement('span');
    t.textContent = was;
    zeile.append(k, t);
    frag.append(zeile);
  }
  el.hilfeListe.replaceChildren(frag);
}

el.hilfeZu.addEventListener('click', () => {
  el.hilfe.hidden = true;
});
el.hilfe.addEventListener('click', (e) => {
  if (e.target === el.hilfe) el.hilfe.hidden = true;
});

// ------------------------------------------------------------------ Knöpfe

el.btnFENSetzen.addEventListener('click', () => lade(el.fen.value.trim()));
el.btnLeer.addEventListener('click', () => lade(startFen(), { meldung: 'Board reset.' }));
el.btnDrehen.addEventListener('click', () => {
  S.gedreht = !S.gedreht;
  zeichne();
});
el.btnStart.addEventListener('click', () => geheZu(0));
el.btnZurueck.addEventListener('click', zurueck);
el.btnWeiter.addEventListener('click', () => geheZu(S.cursor + 1));
el.btnEnde.addEventListener('click', () => geheZu(S.verlauf.length));

async function insZwischenablage(text, was) {
  try {
    await navigator.clipboard.writeText(text);
    sag(`${was} copied.`, 'ok');
  } catch {
    sag(`Could not copy - ${was} is in the address bar.`, null);
  }
}

el.btnFENKopieren.addEventListener('click', () => insZwischenablage(toFen(S.pos), 'FEN'));
el.btnPGNKopieren.addEventListener('click', () =>
  insZwischenablage(
    `1. ${S.verlauf.map((z) => z.san).join(' ')} ${outcome(S.pos) ?? '*'}`,
    'PGN',
  ),
);
el.btnSpeichern.addEventListener('click', () => el.btnPGNKopieren.click());
el.btnPGNImport.addEventListener('click', () => {
  sag('Paste a PGN into the FEN field, then press "Insert FEN".', null);
});

// ------------------------------------------------------------------ Tastatur

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || S.offen) return;
  if (e.key === 'ArrowLeft') geheZu(S.cursor - 1);
  else if (e.key === 'ArrowRight') geheZu(S.cursor + 1);
  else if (e.key === 'ArrowUp') geheZu(0);
  else if (e.key === 'ArrowDown') geheZu(S.verlauf.length);
  else if (e.key === 'f') el.btnDrehen.click();
  // Besten Engine-Zug spielen - der Grund, warum die Engine ueberhaupt da ist
  else if (e.key === ' ' && E.an && E.besterZug) {
    e.preventDefault();
    const uci = E.besterZug;
    const treffer = zugNach(parseSquare(uci.slice(0, 2)), parseSquare(uci.slice(2, 4)));
    if (treffer !== undefined) fertig(treffer);
    else sag('Der beste Zug ist in dieser Stellung nicht möglich.', null);
  } else if (e.key === '?') {
    hilfeFuellen();
    el.hilfe.hidden = !el.hilfe.hidden;
  }
});

// ------------------------------------------------------------------ Start

// Das gewaehlte Seitenthema merken - wie bei lichess bleibt es beim
// naechsten Aufruf stehen.
try {
  const gemerkt = localStorage.getItem('lp-brett-thema');
  if (gemerkt && SEITEN_THEMEN[gemerkt]) {
    seitenThemaSetzen(gemerkt);
    S.seitenThema = gemerkt;
  }
} catch {
  /* localStorage kann blockiert sein - dann bleibt es beim Standard */
}

baueBrett();
hilfeFuellen();
einstellungenFuellen();
lade(adresseLesen() ?? startFen());

// Anmeldung: nach dem Rueckkehr von lichess steht ?code=...&state=... in der
// Adresse. Das wird hier erledigt - vorher waere die Seite in einem Zustand,
// in dem sie selbst nicht weiss, ob sie angemeldet ist.
(async () => {
  try {
    const params = new URLSearchParams(location.search);
    if (params.has('code') || params.has('error')) {
      const ergebnis = await anmeldenFortsetzen();
      sag(ergebnis?.nutzername ? `Angemeldet als ${ergebnis.nutzername}.` : 'Angemeldet.', 'ok');
    }
  } catch (fehler) {
    sag(`Anmeldung fehlgeschlagen: ${fehler.message}`, 'fehler');
  }
  if (istAngemeldet()) {
    explorerAbmeldeStand();
    const st = tokenStatus();
    if (st?.nutzername) sag(`Angemeldet als ${st.nutzername}.`, 'ok');
  } else {
    explorerAnmeldeZeile('Log in, um die Eröffnungsdatenbank zu sehen.');
  }
  explorerFragen();
})();