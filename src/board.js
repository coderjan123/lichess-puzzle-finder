/**
 * Analysis board: Brett, Ziehen, Zugsliste, Rückgängig.
 *
 * Die Regeln kommen aus src/chess.js - dort steht der Zuggenerator, der
 * gegen die publicierten Perft-Zahlen und gegen python-chess geprüft ist.
 * Hier ist nur die Oberfläche: was angezeigt wird und was eine Berührung
 * bedeutet.
 *
 * Bedienung mit einer Hand: jedes Feld ist mindestens 46 px groß. Ein Zug
 * geht auf zwei Arten - Figur antippen, dann Zielfeld antippen, oder direkt
 * ziehen. Beides läuft über DIESEN einen Weg (pointerdown/pointermove/
 * pointerup), nicht über pointerdown UND click: sonst löst ein Tippen beide
 * aus, und ein Ziehen kommt nie an, weil "click" nur ausgelöst wird, wenn
 * Maus und Zeiger auf demselben Element stehen bleiben.
 */

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
  fromIndex,
  toIndex,
} from './chess.js';

const $ = (id) => document.getElementById(id);

const el = {
  board: $('board'),
  promo: $('promo'),
  promoStuecke: $('promoStuecke'),
  zuege: $('zuege'),
  stand: $('stand'),
  turnTag: $('turnTag'),
  fen: $('fen'),
  hinweis: $('hinweis'),
  btnZurueck: $('btnZurueck'),
  btnNeu: $('btnNeu'),
  btnDrehen: $('btnDrehen'),
  btnSetzen: $('btnSetzen'),
  btnTeilen: $('btnTeilen'),
  btnStart: $('btnStart'),
  btnPrev: $('btnPrev'),
  btnNext: $('btnNext'),
  btnEnd: $('btnEnd'),
};

const BUCHSTABE = { 1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
const LANG = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
const UMBAU = [
  [QUEEN, 'queen'],
  [ROOK, 'rook'],
  [BISHOP, 'bishop'],
  [KNIGHT, 'knight'],
];

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
  /** Umschlag: {von, nach, roh} - der Zug ist noch nicht entschieden. */
  offen: null,
  /** Zeiger: {von, x, y, startX, startY, zieht, startZiel}. */
  griff: null,
};

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
  el.board.replaceChildren(frag);
}

/** Index 0 ist die linke obere Ecke in der gezeigten Lage. */
const anzeigeIndex = (i) => (S.gedreht ? 63 - i : i);

function zeichne() {
  const pos = S.pos;
  const koenig = isCheck(pos) ? (pos.turn === WHITE ? pos.king[1] : pos.king[0]) : -1;
  const schachAnzeige = koenig >= 0 ? anzeigeIndex(toIndex(koenig)) : -1;
  const ziele = new Set(S.ziele.map((m) => anzeigeIndex(toIndex(moveTo(m)))));
  const letzterVon = S.letzter ? anzeigeIndex(toIndex(moveFrom(S.letzter))) : -1;
  const letzterNach = S.letzter ? anzeigeIndex(toIndex(moveTo(S.letzter))) : -1;
  const gewaehltAnzeige = S.gewaehlt >= 0 ? anzeigeIndex(toIndex(S.gewaehlt)) : -1;

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
        halter.append(document.createElement('use'));
        feld.prepend(halter);
      }
      const nutzlast = halter.firstChild;
      const id = `${stueck & BLACK ? 'b' : 'w'}${BUCHSTABE[typeOf(stueck)]}`;
      if (nutzlast.getAttribute('href') !== `#${id}`) nutzlast.setAttribute('href', `#${id}`);
      halter.classList.toggle('zieht', Boolean(S.griff?.zieht && S.griff.von === sq));
    }

    // Moeglicher Zug: Punkt ins leere Feld, Ring um ein besetztes.
    // Der Ring gehoert NUR auf ein Feld, auf dem wirklich etwas steht - sonst
    // sieht jeder leere Zielpunkt aus wie ein Schlagfeld.
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

    // Koordinaten wie bei lichess nur in den Ecken.
    // Nach der Klasse fragen, nicht nach der Position: die Figur wird per
    // prepend eingefuegt und verschiebt sonst alles um eine Stelle.
    const dReihe = d >> 3;
    const dSpalte = d & 7;
    const kR = feld.querySelector('.koordinate.reihe');
    const kS = feld.querySelector('.koordinate.spalte');
    if ((dReihe === 7 || dReihe === 0) && (dSpalte === 0 || dSpalte === 7)) {
      // Die Beschriftung gehoert zu dem Quadrat, das hier liegt - also zu i,
      // dem Brettindex. Spiegeln muss man hier nichts: das Drehen ist
      // schon ueber d erledigt. Ein zusaetzliches Spiegeln hat die Ecken
      // vertauscht, oben links stand nach dem Drehen wieder "a8".
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

  zugliste();
  el.turnTag.textContent = pos.turn === WHITE ? '♙' : '♟';
  el.turnTag.className = pos.turn === WHITE ? 'turn' : 'turn schwarz';
  el.turnTag.title = pos.turn === WHITE ? 'White to move' : 'Black to move';
  el.stand.textContent = `${S.cursor}/${S.verlauf.length}`;
  el.btnZurueck.disabled = S.cursor === 0;
  el.btnPrev.disabled = S.cursor === 0;
  el.btnStart.disabled = S.cursor === 0;
  el.btnNext.disabled = S.cursor >= S.verlauf.length;
  el.btnEnd.disabled = S.cursor >= S.verlauf.length;
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
  if (meldung) sag(meldung, 'ok');
  // Eine eingetippte Endstellung sagt von selbst, dass sie zu Ende ist -
  // sonst steht da "Position geladen" und man sucht den Matt vergeblich.
  const ergebnis = outcome(S.pos);
  if (ergebnis) {
    sag(
      ergebnis === '1/2-1/2'
        ? 'Draw.'
        : ergebnis === '1-0'
          ? 'White wins.'
          : 'Black wins.',
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
}

// ------------------------------------------------------------------ Ziehen und Tippen

/** Square under the pointer, or -1. Uses elementFromPoint so it works even
 *  when the finger is on a piece that is half over the edge. */
function feldUnter(x, y) {
  const treffer = document.elementFromPoint(x, y);
  const feld = treffer?.closest?.('.feld');
  return feld ? Number(feld.dataset.i) : -1;
}

el.board.addEventListener('pointerdown', (e) => {
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
    el.board.setPointerCapture?.(e.pointerId);
  } catch {
    /* egal */
  }
});

el.board.addEventListener('pointermove', (e) => {
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

el.board.addEventListener('pointerup', (e) => {
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

el.board.addEventListener('pointercancel', () => {
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
  const u = document.createElement('use');
  u.setAttribute('href', `#${stueck & BLACK ? 'b' : 'w'}${BUCHSTABE[typeOf(stueck)]}`);
  g.append(u);
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
    b.dataset.typ = String(typ);
    const u = document.createElement('use');
    u.setAttribute('href', `#${farbe}${BUCHSTABE[typ]}`);
    b.append(u);
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
  if (S.verlauf.length === 0) {
    const li = document.createElement('li');
    li.className = 'nummer';
    li.append(document.createElement('span'));
    const a = document.createElement('span');
    a.className = 'leer';
    a.textContent = 'No moves yet';
    const b = document.createElement('span');
    frag.append(li, a, b);
    el.zuege.replaceChildren(frag);
    return;
  }
  for (let i = 0; i < S.verlauf.length; i += 2) {
    const nr = document.createElement('li');
    nr.className = 'nummer';
    nr.textContent = `${i / 2 + 1}.`;
    frag.append(nr);
    for (const j of [i, i + 1]) {
      const knopf = document.createElement('button');
      knopf.type = 'button';
      if (j < S.verlauf.length) {
        knopf.textContent = S.verlauf[j].san;
        if (S.cursor === j + 1) knopf.classList.add('an');
        knopf.addEventListener('click', () => geheZu(j + 1));
      } else {
        knopf.disabled = true;
      }
      frag.append(knopf);
    }
  }
  el.zuege.replaceChildren(frag);
}

function sag(text, art) {
  el.hinweis.textContent = text || '';
  el.hinweis.className = art ? art : 'hinweis';
}

// ------------------------------------------------------------------ Knöpfe

el.btnZurueck.addEventListener('click', zurueck);
el.btnNeu.addEventListener('click', () => lade(startFen(), { meldung: 'New game.' }));
el.btnDrehen.addEventListener('click', () => {
  S.gedreht = !S.gedreht;
  zeichne();
});
el.btnStart.addEventListener('click', () => geheZu(0));
el.btnPrev.addEventListener('click', () => geheZu(S.cursor - 1));
el.btnNext.addEventListener('click', () => geheZu(S.cursor + 1));
el.btnEnd.addEventListener('click', () => geheZu(S.verlauf.length));

el.btnSetzen.addEventListener('click', () => lade(el.fen.value.trim(), { meldung: 'Position loaded.' }));

el.btnTeilen.addEventListener('click', async () => {
  history.replaceState(null, '', `${location.pathname}#${encodeURIComponent(toFen(S.pos))}`);
  try {
    await navigator.clipboard.writeText(location.href);
    sag('Address copied.', 'ok');
  } catch {
    sag('The address is in the bar - copy it there.', null);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || S.offen) return;
  if (e.key === 'ArrowLeft') geheZu(S.cursor - 1);
  else if (e.key === 'ArrowRight') geheZu(S.cursor + 1);
  else if (e.key === 'f') el.btnDrehen.click();
  else if (e.key === 'n') el.btnNeu.click();
});

// ------------------------------------------------------------------ Start

baueBrett();
const ausHash = decodeURIComponent(location.hash.replace(/^#/, ''));
lade(ausHash.includes('/') ? ausHash : startFen());