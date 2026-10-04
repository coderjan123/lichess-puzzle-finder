/**
 * Schachregeln: Stellung, legale Züge,algebraische Notation.
 *
 * Bewusst ohne Engine und ohne Eröffnungsdatenbank. Das ist ein reiner
 * Zuggenerator: er weiß, was legal ist, und sonst nichts. Kein Zugbewertung,
 * keine Suche, keine Nachschlagewerke.
 *
 * Brett als 0x88: jedes Quadrat ist eine Zahl, die bei einem Sprung über den
 * Brettrand ihre eigenen Flags mitnimmt. Ein Sprung, der aus dem Brett fällt,
 * ergibt eine Zahl mit gesetztem Bit 0x88 - das genügt als "unerreichbar".
 *
 *   a8=0x77  h1=0x07      Bit 3 (0x08) = Farbe: 8 = weiss, 16 = schwarz
 *   0x00 = leer
 *
 * Züge sind eine Zahl, kein Objekt. Perft zählt bei Tiefe 5 ueber vier
 * Millionen Stellungen - mit Objekten waere das nur unnoetig langsam.
 *
 *   from | to<<7 | promoting<<14 | flag<<17
 *
 *   promoting: 0 = keiner, sonst 2..5 (Springer, Laeufer, Turm, Dame)
 *   flag:      0 normal, 1 Doppelritt, 2 En passant, 3 Rochade kurz,
 *              4 Rochade lang
 *
 * Die Genauigkeit wird nicht behauptet, sondern in build/perft.mjs gemessen:
 * sechs bekannte Stellungen mit publicierten Zugbaumzahlen bis Tiefe 4-5.
 */

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WHITE = 8;
export const BLACK = 16;

export const COLOR_MASK = 24;
export const TYPE_MASK = 7;

/** Farbe wechseln. */
export const other = (c) => c ^ 24;

/** ist p von der Farbe c? */
export const isColor = (p, c) => p !== 0 && (p & COLOR_MASK) === c;

/** Figurentyp von p, unabhaengig von der Farbe. */
export const typeOf = (p) => p & TYPE_MASK;

// Rochade-Bits im Bitfeld der Stellung.
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// Zugsflags.
export const FLAG_NORMAL = 0;
export const FLAG_DOUBLE = 1;
export const FLAG_EP = 2;
export const FLAG_CASTLE_K = 3;
export const FLAG_CASTLE_Q = 4;

const A1 = 0x00;
const E1 = 0x04;
const H1 = 0x07;
const A8 = 0x70;
const E8 = 0x74;
const H8 = 0x77;

const FILE_CHARS = 'abcdefgh';
const RANK_CHARS = '12345678';

const KNIGHT_DELTAS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_DELTAS = [17, 16, 15, 1, -17, -16, -15, -1];
const BISHOP_DELTAS = [17, 15, -17, -15];
const ROOK_DELTAS = [16, 1, -16, -1];

/** Sprung von a1 nach a2 usw. */
function sq(file, rank) {
  return rank * 16 + file;
}

/**
 * 0x88 -> 0..63 fuer die Anzeige, Zeile 0 ist die oberste (die 8. Reihe).
 *
 * ACHTUNG: in dieser Datei ist 0x88-Zeile 0 die ERSTE Reihe - h1 ist 0x07.
 * Fuer die Anzeige ist die Zeile von oben gezaehlt, also 7 minus Zeile.
 * Beide Richtungen haben schon einmal das Gegenteil angenommen, und dann
 * hat die Anzeige ein voellig anderes Brett gezeigt als die Regeln
 * gerechnet haben - ohne dass ein einziger Regeltest rot wurde.
 */
export function toIndex(s) {
  return ((7 - ((s >> 4) & 7)) << 3) | (s & 7);
}

/** 0..63 (Zeile von oben) -> 0x88. */
export function fromIndex(i) {
  return ((7 - (i >> 3)) << 4) | (i & 7);
}

/** 0x88 -> "e4" */
export function squareName(s) {
  return FILE_CHARS[s & 7] + RANK_CHARS[s >> 4];
}

/** "e4" -> 0x88, oder -1 wenn unbrauchbar. */
export function parseSquare(name) {
  if (typeof name !== 'string' || name.length < 2) return -1;
  const f = FILE_CHARS.indexOf(name[0]);
  const r = RANK_CHARS.indexOf(name[1]);
  if (f < 0 || r < 0) return -1;
  return sq(f, r);
}

/** Anfangszug kodieren. */
export const encodeMove = (from, to, promo = 0, flag = FLAG_NORMAL) =>
  from | (to << 7) | (promo << 14) | (flag << 17);

export const moveFrom = (m) => m & 0x7f;
export const moveTo = (m) => (m >> 7) & 0x7f;
export const movePromo = (m) => (m >> 14) & 7;
export const moveFlag = (m) => (m >> 17) & 7;

/** Menschenlesbare Form eines Zuges, ohne Kontext: "e2e4", "e7e8q". */
export function moveToUci(m) {
  const promo = movePromo(m);
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (promo ? ' pnbrqk'[promo] : '');
}

// ------------------------------------------------------------------ Stellung

/**
 * Eine Stellung.
 *
 * Felder direkt anschreiben ist schneller als Getter; die Funktionen unten
 * kapseln sie. `undo` haelt den Rueckbau-Eintrag des letzten Zuges.
 */
export function makePosition() {
  return {
    board: new Uint8Array(128),
    turn: WHITE,
    castling: 0,
    ep: -1,
    half: 0,
    full: 1,
    /** Königsquadrat je Farbe, für die Schachprüfung nach dem Zug. */
    king: [-1, -1],
    undo: [],
  };
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * FEN lesen. Wirft bei kaputtem Text - eine halb gelesene Stellung waere
 * schlimmer als ein Fehler.
 */
export function parseFen(fen) {
  const pos = makePosition();
  setFen(pos, fen ?? START_FEN);
  return pos;
}

export function setFen(pos, fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 4) throw new Error(`FEN zu kurz: "${fen}"`);

  pos.board.fill(0);
  let file = 0;
  let rank = 7;
  for (const ch of parts[0]) {
    if (ch === '/') {
      if (file !== 8) throw new Error(`FEN: Reihe ${8 - rank} hat ${file} Felder`);
      file = 0;
      rank -= 1;
      if (rank < 0) throw new Error('FEN: zu viele Reihen');
      continue;
    }
    const n = ch.charCodeAt(0) - 48;
    if (n >= 1 && n <= 8) {
      file += n;
      if (file > 8) throw new Error('FEN: Reihe zu breit');
      continue;
    }
    const lower = ch.toLowerCase();
    let type = 0;
    if (lower === 'p') type = PAWN;
    else if (lower === 'n') type = KNIGHT;
    else if (lower === 'b') type = BISHOP;
    else if (lower === 'r') type = ROOK;
    else if (lower === 'q') type = QUEEN;
    else if (lower === 'k') type = KING;
    else throw new Error(`FEN: unbekanntes Zeichen "${ch}"`);
    if (file > 7) throw new Error('FEN: Reihe zu breit');
    // GROSS = weiss, klein = schwarz.
    const color = ch === lower ? BLACK : WHITE;
    const s = sq(file, rank);
    pos.board[s] = color | type;
    if (type === KING) pos.king[color === WHITE ? 0 : 1] = s;
    file += 1;
  }
  if (rank !== 0 || file !== 8) throw new Error('FEN: nicht acht Reihen');

  pos.turn = parts[1] === 'b' ? BLACK : parts[1] === 'w' ? WHITE : badTurn(parts[1]);

  pos.castling = 0;
  for (const ch of parts[2] || '') {
    if (ch === 'K') pos.castling |= CASTLE_WK;
    else if (ch === 'Q') pos.castling |= CASTLE_WQ;
    else if (ch === 'k') pos.castling |= CASTLE_BK;
    else if (ch === 'q') pos.castling |= CASTLE_BQ;
    else if (ch !== '-') throw new Error(`FEN: Rochade "${ch}" unbekannt`);
  }

  pos.ep = parts[3] && parts[3] !== '-' ? parseSquare(parts[3]) : -1;
  pos.half = Number.parseInt(parts[4] ?? '0', 10) || 0;
  pos.full = Number.parseInt(parts[5] ?? '1', 10) || 1;
  pos.undo.length = 0;

  for (const c of [WHITE, BLACK]) {
    if (pos.king[c === WHITE ? 0 : 1] < 0) throw new Error('FEN: kein König');
  }
  return pos;
}

function badTurn(v) {
  throw new Error(`FEN: Zugberechtigung "${v}" unbekannt`);
}

export function toFen(pos) {
  let out = '';
  for (let rank = 7; rank >= 0; rank--) {
    let leer = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[sq(file, rank)];
      if (p === 0) {
        leer += 1;
        continue;
      }
      if (leer) {
        out += leer;
        leer = 0;
      }
      const ch = ' pnbrqk'[typeOf(p)];
      // GROSS = weiss (Bit 8), klein = schwarz (Bit 16).
      out += p & BLACK ? ch : ch.toUpperCase();
    }
    if (leer) out += leer;
    if (rank) out += '/';
  }
  let rochade = '';
  if (pos.castling & CASTLE_WK) rochade += 'K';
  if (pos.castling & CASTLE_WQ) rochade += 'Q';
  if (pos.castling & CASTLE_BK) rochade += 'k';
  if (pos.castling & CASTLE_BQ) rochade += 'q';
  return [
    out,
    pos.turn === WHITE ? 'w' : 'b',
    rochade || '-',
    pos.ep >= 0 ? squareName(pos.ep) : '-',
    pos.half,
    pos.full,
  ].join(' ');
}

/** Alle Figuren einer Farbe als [quadrat, typ]-Liste. */
export function piecesOf(pos, color) {
  const out = [];
  for (let s = 0; s < 128; s++) {
    if ((s & 0x88) === 0 && pos.board[s] !== 0 && (pos.board[s] & COLOR_MASK) === color) {
      out.push(s);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Zugbau

/**
 * Pseudo-legale Züge in `out` schreiben, Anzahl zurückgeben.
 *
 * "Pseudo-legal" heisst: der Zug hält die eigene Formregeln ein, koennte aber
 * den eigenen König im Schach lassen. Genau das entscheidet make/undo, weil
 * dort geprüft wird, ob der König danach angegriffen wird.
 */
function generatePseudo(pos, out, capturesOnly) {
  const b = pos.board;
  const us = pos.turn;
  const them = other(us);
  let n = 0;

  for (let s = 0; s < 128; s++) {
    if (s & 0x88) {
      s += 7;
      continue;
    }
    const p = b[s];
    if (p === 0 || (p & COLOR_MASK) !== us) continue;
    const type = typeOf(p);

    if (type === PAWN) {
      const up = us === WHITE ? 16 : -16;
      const startRank = us === WHITE ? 1 : 6;
      const lastRank = us === WHITE ? 7 : 0;
      const to = s + up;

      // Vorwaerts, nur wenn frei.
      if ((to & 0x88) === 0 && b[to] === 0) {
        if (capturesOnly) {
          // Der Stichschlagtest unten deckt En passant ab.
        } else if (to >> 4 === lastRank) {
          for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
            out[n++] = encodeMove(s, to, promo);
          }
        } else {
          out[n++] = encodeMove(s, to);
          if ((s >> 4) === startRank && b[s + up + up] === 0) {
            out[n++] = encodeMove(s, s + up + up, 0, FLAG_DOUBLE);
          }
        }
      }
      // Schlaege: nach vorn diagonal.
      for (const side of [us === WHITE ? 15 : -15, us === WHITE ? 17 : -17]) {
        const t = s + side;
        if (t & 0x88) continue;
        const ziel = b[t];
        if (ziel !== 0 && (ziel & COLOR_MASK) === them) {
          if (t >> 4 === lastRank) {
            for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
              out[n++] = encodeMove(s, t, promo);
            }
          } else {
            out[n++] = encodeMove(s, t);
          }
        } else if (t === pos.ep && ziel === 0) {
          // En passant: der Bauer steht neben dem Zielfeld auf der 5. Reihe.
          out[n++] = encodeMove(s, t, 0, FLAG_EP);
        }
      }
      continue;
    }

    if (type === KNIGHT || type === KING) {
      const deltas = type === KNIGHT ? KNIGHT_DELTAS : KING_DELTAS;
      for (const d of deltas) {
        const t = s + d;
        if (t & 0x88) continue;
        const ziel = b[t];
        if (ziel === 0) {
          if (!capturesOnly) out[n++] = encodeMove(s, t);
        } else if ((ziel & COLOR_MASK) === them) {
          out[n++] = encodeMove(s, t);
        }
      }
      // castleMoves gibt die neue Anzahl zurueck - nicht addieren, sonst
      // springt n in die Mitte und die Luecken bleiben als Nullzuege stehen.
      if (type === KING) n = castleMoves(pos, s, out, n, capturesOnly);
      continue;
    }

    const deltas = type === BISHOP ? BISHOP_DELTAS : type === ROOK ? ROOK_DELTAS : KING_DELTAS;
    for (const d of deltas) {
      let t = s + d;
      while ((t & 0x88) === 0) {
        const ziel = b[t];
        if (ziel === 0) {
          if (!capturesOnly) out[n++] = encodeMove(s, t);
        } else {
          if ((ziel & COLOR_MASK) === them) out[n++] = encodeMove(s, t);
          break;
        }
        t += d;
      }
    }
  }
  return n;
}

/**
 * Rochade. Kurz und lang getrennt, damit jede Seite eigenstaendig geprueft
 * werden kann. Wichtig sind drei Bedingungen, und leicht wird die dritte
 * vergessen: der Koenig darf auf dem Weg und auf dem Ziel NICHT im Schuss
 * stehen. Nur "danach nicht im Schuss" zu pruefen laesst eine Rochade durch
 * ein angegriffenes Feld zu - perft faellt genau da drueber.
 */
function castleMoves(pos, s, out, n, capturesOnly) {
  if (capturesOnly) return n;
  const b = pos.board;
  const us = pos.turn;
  const them = other(us);
  if (s !== (us === WHITE ? E1 : E8)) return n;

  if (pos.castling & (us === WHITE ? CASTLE_WK : CASTLE_BK)) {
    // Leer: der Turm und die beiden Felder dazwischen.
    if (b[s + 1] === 0 && b[s + 2] === 0 && b[s + 3] === (ROOK | us)) {
      if (!isAttacked(pos, s, them) && !isAttacked(pos, s + 1, them) && !isAttacked(pos, s + 2, them)) {
        out[n++] = encodeMove(s, s + 2, 0, FLAG_CASTLE_K);
      }
    }
  }
  if (pos.castling & (us === WHITE ? CASTLE_WQ : CASTLE_BQ)) {
    if (b[s - 1] === 0 && b[s - 2] === 0 && b[s - 3] === 0 && b[s - 4] === (ROOK | us)) {
      if (!isAttacked(pos, s, them) && !isAttacked(pos, s - 1, them) && !isAttacked(pos, s - 2, them)) {
        out[n++] = encodeMove(s, s - 2, 0, FLAG_CASTLE_Q);
      }
    }
  }
  return n;
}

// Puffer fuer die Zugsliste. 256 reicht mit Reserve (Maximum liegt bei 218).
const pseudoBuf = new Int32Array(256);
const legalBuf = new Int32Array(256);

/**
 * Legale Züge der Stellung, als Array von Zahlen.
 *
 * Ablauf: pseudo-legal bauen, jeden Zug machen, pruefen ob der eigene König
 * danach im Schach steht, und den Zug zuruecknehmen. Das ist der uebliche
 * Weg und der einfachste, der sich beweisen laesst - perft zaehlt mit.
 */
export function legalMoves(pos) {
  let n = generatePseudo(pos, pseudoBuf, false);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const m = pseudoBuf[i];
    makeMove(pos, m);
    if (!isAttacked(pos, pos.king[pos.turn === WHITE ? 1 : 0], pos.turn)) {
      legalBuf[k++] = m;
    }
    undoMove(pos);
  }
  return Array.prototype.slice.call(legalBuf, 0, k);
}

/**
 * Wie legalMoves, schreibt aber in ein beliebiges Array und gibt die Anzahl
 * zurueck. Perft braucht das ohne Schnitt - dort sind es Millionen Knoten.
 */
export function legalMovesInto(pos, out) {
  const n = generatePseudo(pos, pseudoBuf, false);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const m = pseudoBuf[i];
    makeMove(pos, m);
    if (!isAttacked(pos, pos.king[pos.turn === WHITE ? 1 : 0], pos.turn)) {
      out[k++] = m;
    }
    undoMove(pos);
  }
  return k;
}

/** Nur die Schlaege der Figur auf s - fuer die Anzeige der moeglichen Zuege. */
export function capturesFrom(pos, s) {
  const saves = [pos.turn, pos.ep, pos.castling];
  pos.turn = pos.board[s] & COLOR_MASK;
  pos.ep = -1;
  pos.castling = 0;
  let n = generatePseudo(pos, pseudoBuf, true);
  const out = [];
  for (let i = 0; i < n; i++) out.push(pseudoBuf[i]);
  pos.turn = saves[0];
  pos.ep = saves[1];
  pos.castling = saves[2];
  return out;
}

/**
 * Steht das Quadrat s im Schuss der Farbe by?
 *
 * Der Koenig selbst wird wie ein normaler Springer/Dame behandelt - so muss
 * die Funktion sich nicht selbst ausschliessen, wenn sie den Koenig sucht.
 */
export function isAttacked(pos, s, by) {
  const b = pos.board;

  // Springer
  for (const d of KNIGHT_DELTAS) {
    const t = s + d;
    if (t & 0x88) continue;
    if (b[t] === (KNIGHT | by)) return true;
  }
  // Koenig
  for (const d of KING_DELTAS) {
    const t = s + d;
    if (t & 0x88) continue;
    if (b[t] === (KING | by)) return true;
  }
  // Dame und Laeufer
  for (const d of BISHOP_DELTAS) {
    let t = s + d;
    while ((t & 0x88) === 0) {
      const p = b[t];
      if (p !== 0) {
        if (p === (QUEEN | by) || p === (BISHOP | by)) return true;
        break;
      }
      t += d;
    }
  }
  // Dame und Turm
  for (const d of ROOK_DELTAS) {
    let t = s + d;
    while ((t & 0x88) === 0) {
      const p = b[t];
      if (p !== 0) {
        if (p === (QUEEN | by) || p === (ROOK | by)) return true;
        break;
      }
      t += d;
    }
  }
  // Bauer: er schlaegt nach vorn, die Richtung haengt an der Farbe.
  const pawn = PAWN | by;
  const down = by === WHITE ? -16 : 16;
  for (const side of [down - 1, down + 1]) {
    const t = s + side;
    if (t & 0x88) continue;
    if (b[t] === pawn) return true;
  }
  return false;
}

// ------------------------------------------------------------------ Zug ausfuehren

/**
 * Zug machen. Der Rueckbau-Eintrag wandert auf pos.undo, damit undoMove
 * exakt zurueckstellt. Nach makeMove ist pos.turn die Gegnerfarbe.
 */
export function makeMove(pos, m) {
  const b = pos.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const promo = movePromo(m);
  const flag = moveFlag(m);
  const piece = b[from];
  const us = pos.turn;

  let captured = 0;
  let capSq = to;
  if (flag === FLAG_EP) {
    capSq = us === WHITE ? to - 16 : to + 16;
    captured = b[capSq];
    b[capSq] = 0;
  } else if (b[to] !== 0) {
    captured = b[to];
  }

  pos.undo.push({
    move: m,
    captured,
    capSq,
    castling: pos.castling,
    ep: pos.ep,
    half: pos.half,
    full: pos.full,
    king: us === WHITE ? pos.king[0] : pos.king[1],
  });

  b[to] = promo ? promo | us : piece;
  b[from] = 0;
  if (typeOf(piece) === KING) pos.king[us === WHITE ? 0 : 1] = to;

  // Bei der Rochade wandert der Turm mit. Achtung 0x88: der Schritt von h1
  // nach f1 ist MINUS zwei, nicht plus eins - h1 ist das letzte Feld einer
  // Reihe, h1+1 liegt schon ausserhalb des Bretts. Genau das war der Fehler,
  // den erst der Vergleich der Stellung nach dem Zug aufgedeckt hat.
  if (flag === FLAG_CASTLE_K) {
    const turm = us === WHITE ? H1 : H8;
    b[turm - 2] = b[turm];
    b[turm] = 0;
  } else if (flag === FLAG_CASTLE_Q) {
    const turm = us === WHITE ? A1 : A8;
    b[turm + 3] = b[turm];
    b[turm] = 0;
  }

  // Rochaderechte: weg, sobald Koenig oder Turm von ihrem Feld weggehen.
  // Ein Koenig nimmt beide Rechte seiner Seite mit.
  if (us === WHITE) {
    if (from === E1) pos.castling &= ~(CASTLE_WK | CASTLE_WQ);
    if (from === H1) pos.castling &= ~CASTLE_WK;
    if (from === A1) pos.castling &= ~CASTLE_WQ;
  } else {
    if (from === E8) pos.castling &= ~(CASTLE_BK | CASTLE_BQ);
    if (from === H8) pos.castling &= ~CASTLE_BK;
    if (from === A8) pos.castling &= ~CASTLE_BQ;
  }
  // Und weg, wenn auf dem Turmfeld etwas gefangen wird.
  if (captured !== 0) {
    if (capSq === H8) pos.castling &= ~CASTLE_BK;
    if (capSq === A8) pos.castling &= ~CASTLE_BQ;
    if (capSq === H1) pos.castling &= ~CASTLE_WK;
    if (capSq === A1) pos.castling &= ~CASTLE_WQ;
  }

  pos.ep = flag === FLAG_DOUBLE ? (us === WHITE ? from + 16 : from - 16) : -1;
  pos.half = typeOf(piece) === PAWN || captured !== 0 ? 0 : pos.half + 1;
  if (us === BLACK) pos.full += 1;
  pos.turn = other(us);
  return true;
}

export function undoMove(pos) {
  const e = pos.undo.pop();
  if (!e) throw new Error('undoMove ohne passenden Zug');
  const b = pos.board;
  const from = moveFrom(e.move);
  const to = moveTo(e.move);
  const promo = movePromo(e.move);
  const flag = moveFlag(e.move);
  const us = other(pos.turn);

  b[from] = promo ? PAWN | us : b[to];
  b[to] = 0;
  if (flag === FLAG_EP) b[e.capSq] = e.captured;
  else if (e.captured) b[e.capSq] = e.captured;
  if (flag === FLAG_CASTLE_K) {
    const turm = us === WHITE ? H1 : H8;
    b[turm] = ROOK | us;
    b[turm - 2] = 0;
  } else if (flag === FLAG_CASTLE_Q) {
    const turm = us === WHITE ? A1 : A8;
    b[turm] = ROOK | us;
    b[turm + 3] = 0;
  }

  if (typeOf(b[from]) === KING) pos.king[us === WHITE ? 0 : 1] = from;
  pos.castling = e.castling;
  pos.ep = e.ep;
  pos.half = e.half;
  pos.full = e.full;
  pos.turn = us;
  return e;
}

// ------------------------------------------------------------------ Lage

/**
 * Steht der König der Partei am Zug im Schach?
 *
 * Der Angreifer ist die Gegenpartei - also NICHT pos.turn. Sonst prüft man,
 * ob die eigene Seite sich selbst angreift und hängt an jeden Zug ein "+".
 * Genau das ist passiert, bis dieser Test hier stand.
 */
export function isCheck(pos) {
  return isAttacked(pos, pos.king[pos.turn === WHITE ? 0 : 1], other(pos.turn));
}

export function isCheckmate(pos) {
  if (!isCheck(pos)) return false;
  return legalMoves(pos).length === 0;
}

export function isStalemate(pos) {
  if (isCheck(pos)) return false;
  return legalMoves(pos).length === 0;
}

/**
 * Unentschieden aus materieller Sicht: nur Koenige, oder Koenig gegen
 * Koenig und ein einzelner Springer oder Laeufer, oder Koenig gegen zwei
 * Laeufer, die beide auf derselben Brettfarbe stehen.
 *
 * Bewusst zurueckhaltend: was man nicht sicher weiss, wird nicht behauptet.
 */
export function isInsufficientMaterial(pos) {
  const minor = [];
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) {
      s += 7;
      continue;
    }
    const p = pos.board[s];
    if (p === 0) continue;
    const t = typeOf(p);
    if (t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minor.push({ sq: s, type: t });
  }
  if (minor.length === 0) return true;
  if (minor.length === 1) return true; // K+B oder K+S gegen K
  if (minor.length === 2 && minor.every((m) => m.type === BISHOP)) {
    // gleiche Brettfarbe: (file + reihe) gerade oder ungerade
    const parity = (m) => ((m.sq & 7) + (m.sq >> 4)) & 1;
    return parity(minor[0]) === parity(minor[1]);
  }
  return false;
}

/** Das Ergebnis in einem Wort, oder null wenn die Partie weiterlaeuft. */
export function outcome(pos) {
  const moves = legalMoves(pos);
  if (moves.length === 0) {
    return isCheck(pos) ? (pos.turn === WHITE ? '0-1' : '1-0') : '1/2-1/2';
  }
  if (isInsufficientMaterial(pos)) return '1/2-1/2';
  if (pos.half >= 100) return '1/2-1/2';
  return null;
}

// ------------------------------------------------------------------ Notation

const FILES = 'abcdefgh';

/**
 * Algebraische Notation fuer einen legalen Zug, aus der Sicht von davor.
 *
 * Rueckgabe {san, move}: san ohne "x" und ohne "#"? Nein - mit. Die
 * Endstellung wird mitgeprueft, weil "Sg7#" sonst wie "Sg7" aussieht.
 */
export function moveToSan(pos, m) {
  const from = moveFrom(m);
  const to = moveTo(m);
  const promo = movePromo(m);
  const flag = moveFlag(m);
  const piece = pos.board[from];
  const type = typeOf(piece);

  let san;
  if (flag === FLAG_CASTLE_K) san = 'O-O';
  else if (flag === FLAG_CASTLE_Q) san = 'O-O-O';
  else if (type === PAWN) {
    const schlag = pos.board[to] !== 0 || flag === FLAG_EP;
    san = (schlag ? FILES[from & 7] + 'x' : '') + squareName(to);
    if (promo) san += '=' + ' PNBRQK'[promo];
  } else {
    // Unterscheidung: gleiche Figur auf gleiches Zielfeld? Dann Datei oder
    // Reihe davor nennen - bei zwei Springern auf der selben Reihe die Datei.
    const gleichen = legalMoves(pos).filter(
      (o) =>
        o !== m &&
        moveTo(o) === to &&
        typeOf(pos.board[moveFrom(o)]) === type,
    );
    let trenn = '';
    if (gleichen.length) {
      const gleicheDatei = gleichen.every((o) => (moveFrom(o) & 7) === (from & 7));
      const gleicheReihe = gleichen.every((o) => (moveFrom(o) >> 4) === (from >> 4));
      if (!gleicheDatei) trenn = FILES[from & 7];
      else if (!gleicheReihe) trenn = RANK_CHARS[from >> 4];
      else trenn = squareName(from);
    }
    san =
      ' PNBRQK'[type] + trenn + (pos.board[to] !== 0 ? 'x' : '') + squareName(to);
  }

  makeMove(pos, m);
  if (isCheck(pos)) san += isCheckmate(pos) ? '#' : '+';
  undoMove(pos);
  return san;
}

/** SAN lesen. Liebt -1, wenn der Text kein legaler Zug der Stellung ist. */
export function sanToMove(pos, san) {
  const sauber = String(san).replace(/[+#!?]/g, '').replace(/0/g, 'O').trim();
  for (const m of legalMoves(pos)) {
    if (moveToSan(pos, m).replace(/[+#]/g, '').replace(/0/g, 'O') === sauber) return m;
  }
  return -1;
}

// ------------------------------------------------------------------ perft

// Pro Suchebene ein eigener Puffer. Bei vier Millionen Knoten ist ein
// Array je Knoten der Unterschied zwischen Sekunden und Minuten.
const perftBuf = [];
for (let i = 0; i < 10; i++) perftBuf.push(new Int32Array(256));

function perftFrom(pos, depth, level) {
  if (depth === 0) return 1;
  const out = perftBuf[level];
  const n = legalMovesInto(pos, out);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    makeMove(pos, out[i]);
    sum += perftFrom(pos, depth - 1, level + 1);
    undoMove(pos);
  }
  return sum;
}

/** Anzahl aller Zugbäume bis Tiefe depth - die Prüfzahl des Generators. */
export function perft(pos, depth) {
  return perftFrom(pos, depth, 0);
}

/** Züge einer Stellung als Liste zum Anzeigen. */
export function moveList(pos) {
  return legalMoves(pos).map((m) => ({ move: m, san: moveToSan(pos, m), uci: moveToUci(m) }));
}

export const startFen = () => START_FEN;