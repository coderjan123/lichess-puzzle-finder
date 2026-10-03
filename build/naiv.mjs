/**
 * Absichtlich zweiter, unabhängiger Zuggenerator - nur fuer die Tests.
 *
 * Hier steht dasselbe Spiel in einer anderen Form: Brett als 64 Felder in
 * Zeilen von a8 nach h1, Laufzuege mit echter Randpruefung statt 0x88,
 * Zuege als Text statt als Zahl. Bewusst langsam und bewusst dumm.
 *
 * Der Sinn: Perft vergleicht mit publicierten Zahlen und beweist, dass
 * Gesamtzahlen stimmen. Zwei unabhaengige Programme, die sich bei jedem
 * Knoten auf die exakt gleiche Zugmenge einigen, beweisen mehr - und sie
 * sagen sofort, WELCHER Zug fehlt.
 *
 * Nur fuer build/zugtest.mjs. Nie Teil der Website.
 */

const ZEILE = ['8', '7', '6', '5', '4', '3', '2', '1'];

const RICHTUNGEN = {
  b: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  r: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  k: [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]],
};

// Die Dame hat beide Wege - das steht hier ausdruecklich hin, damit es
// nicht von einer zufaelligen Property-Reihenfolge abhaengt.
RICHTUNGEN.q = [...RICHTUNGEN.b, ...RICHTUNGEN.r];

const SPRINGER = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

// Zeile 0 ist a8. Weiss rueckt damit nach oben, also in kleinere Zeilen.
const ZACHL = { w: -1, b: 1 };
// Zeilen, auf denen die Bauern einer Farbe stehen (Zeile 0 = a8).
const START_ZEILE = { w: 6, b: 1 };
// Zeile, auf der ein Bauer zur Dame wird. Auch das ist eine Zeile, kein Rang.
const UMBAU_ZEILE = { w: 0, b: 7 };


export function lesen(fen) {
  const teile = fen.trim().split(/\s+/);
  const felder = new Array(64).fill(null);
  const [brett, zug, rochade, ep, halb, voll] = teile;
  let reihe = 0;
  let spalte = 0;
  for (const z of brett) {
    if (z === '/') {
      reihe += 1;
      spalte = 0;
      continue;
    }
    if (z >= '1' && z <= '8') {
      spalte += Number(z);
      continue;
    }
    felder[reihe * 8 + spalte] = z;
    spalte += 1;
  }
  const r = rochade === '-' ? '' : rochade;
  return {
    felder,
    zug,
    rochade: {
      K: r.includes('K'),
      Q: r.includes('Q'),
      k: r.includes('k'),
      q: r.includes('q'),
    },
    // Auch hier ist der Rang aus dem Text keine Zeile: Zeile 0 ist a8.
    ep: ep === '-' ? null : [8 - Number(ep[1]), ep.charCodeAt(0) - 97],
    halb: Number(halb || 0),
    voll: Number(voll || 1),
  };
}

function koenig(f, farbe) {
  const ziel = farbe === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (f[i] === ziel) return i;
  return -1;
}

/** Farbe einer Figur: GROSS = weiss, klein = schwarz. */
const farbeVon = (p) => (p === p.toUpperCase() ? 'w' : 'b');

const istGegner = (f, i, farbe) => f[i] !== null && farbeVon(f[i]) !== farbe;

/** Steht das Feld [r,s] von `von` aus gesehen unter dem Angriff von `farbe`? */
export function angegriffen(f, r, s, farbe) {
  // Springer
  for (const [dr, ds] of SPRINGER) {
    const nr = r + dr;
    const ns = s + ds;
    if (!drinnen(nr, ns)) continue;
    const p = f[nr * 8 + ns];
    if (p === (farbe === 'w' ? 'N' : 'n')) return true;
  }
  // Koenig
  for (const [dr, ds] of RICHTUNGEN.k) {
    const nr = r + dr;
    const ns = s + ds;
    if (!drinnen(nr, ns)) continue;
    const p = f[nr * 8 + ns];
    if (p === (farbe === 'w' ? 'K' : 'k')) return true;
  }
  // Laeufer und Dame
  for (const [dr, ds] of RICHTUNGEN.b) {
    let nr = r + dr;
    let ns = s + ds;
    while (drinnen(nr, ns)) {
      const p = f[nr * 8 + ns];
      if (p !== null) {
        if (p === (farbe === 'w' ? 'B' : 'b') || p === (farbe === 'w' ? 'Q' : 'q')) return true;
        break;
      }
      nr += dr;
      ns += ds;
    }
  }
  // Turm und Dame
  for (const [dr, ds] of RICHTUNGEN.r) {
    let nr = r + dr;
    let ns = s + ds;
    while (drinnen(nr, ns)) {
      const p = f[nr * 8 + ns];
      if (p !== null) {
        if (p === (farbe === 'w' ? 'R' : 'r') || p === (farbe === 'w' ? 'Q' : 'q')) return true;
        break;
      }
      nr += dr;
      ns += ds;
    }
  }
  // Ein Bauer schlaegt nach vorn. Aus Sicht des Zielfelds liegt der
  // angreifende Bauer fuer Weiss eine Zeile tiefer (weisse Bauern stehen
  // unten) und fuer Schwarz eine Zeile hoeher.
  const richtung = farbe === 'w' ? 1 : -1;
  for (const ds of [-1, 1]) {
    const nr = r + richtung;
    const ns = s + ds;
    if (!drinnen(nr, ns)) continue;
    const p = f[nr * 8 + ns];
    if (p === (farbe === 'w' ? 'P' : 'p')) return true;
  }
  return false;
}

const drinnen = (r, s) => r >= 0 && r < 8 && s >= 0 && s < 8;

const feld = (r, s) => String.fromCharCode(97 + s) + ZEILE[r];

/** Pseudo-legale Zuege als Text, z. B. "e2e4", "e7e8q", "e1g1". */
export function pseudo(fen) {
  const s = lesen(fen);
  const f = s.felder;
  const farbe = s.zug;
  const zr = ZACHL[farbe];
  const out = [];
  // Umbau- und Startzeile sind Zeilen (Zeile 0 = a8), keine Ränge.
  const letzte = UMBAU_ZEILE[farbe];

  for (let i = 0; i < 64; i++) {
    const p = f[i];
    if (p === null) continue;
    // Nur die eigene Farbe bekommt Zuege erzeugt. GROSS heisst weiss.
    if (farbeVon(p) !== farbe) continue;
    const art = p.toLowerCase();
    const r = Math.floor(i / 8);
    const sp = i % 8;

    if (art === 'p') {
      const vor = r + zr;
      if (drinnen(vor, sp) && f[vor * 8 + sp] === null) {
        if (vor === letzte) {
          for (const q of ['q', 'r', 'b', 'n']) out.push(`${feld(r, sp)}${feld(vor, sp)}${q}`);
        } else {
          out.push(`${feld(r, sp)}${feld(vor, sp)}`);
          if (r === START_ZEILE[farbe] && f[(vor + zr) * 8 + sp] === null) {
            out.push(`${feld(r, sp)}${feld(vor + zr, sp)}`);
          }
        }
      }
      for (const ds of [-1, 1]) {
        const nr = r + zr;
        const ns = sp + ds;
        if (!drinnen(nr, ns)) continue;
        const ziel = f[nr * 8 + ns];
        if (ziel !== null && istGegner(f, nr * 8 + ns, farbe)) {
          if (nr === letzte) {
            for (const q of ['q', 'r', 'b', 'n']) out.push(`${feld(r, sp)}${feld(nr, ns)}${q}`);
          } else {
            out.push(`${feld(r, sp)}${feld(nr, ns)}`);
          }
        } else if (ziel === null && s.ep && s.ep[0] === nr && s.ep[1] === ns) {
          out.push(`${feld(r, sp)}${feld(nr, ns)}`);
        }
      }
      continue;
    }

    if (art === 'n') {
      for (const [dr, ds] of SPRINGER) {
        const nr = r + dr;
        const ns = sp + ds;
        if (!drinnen(nr, ns)) continue;
        if (f[nr * 8 + ns] === null || istGegner(f, nr * 8 + ns, farbe)) {
          out.push(`${feld(r, sp)}${feld(nr, ns)}`);
        }
      }
      continue;
    }

    if (art === 'k') {
      for (const [dr, ds] of RICHTUNGEN.k) {
        const nr = r + dr;
        const ns = sp + ds;
        if (!drinnen(nr, ns)) continue;
        if (f[nr * 8 + ns] === null || istGegner(f, nr * 8 + ns, farbe)) {
          out.push(`${feld(r, sp)}${feld(nr, ns)}`);
        }
      }
      // Rochade. Achtung: Zeile 7 ist die ERSTE Reihe (weiss), Zeile 0 die
      // achte. Wer hier die Zeilen vertauscht, bekommt nie eine Rochade und
      // merkt es erst, wenn beide Programme uneinig sind.
      const kZeile = farbe === 'w' ? 7 : 0;
      if (r === kZeile && sp === 4) {
        const turm = farbe === 'w' ? 'R' : 'r';
        const gegner = farbe === 'w' ? 'b' : 'w';
        const basis = kZeile * 8;
        if (
          s.rochade[farbe === 'w' ? 'K' : 'k'] &&
          f[basis + 7] === turm &&
          f[basis + 5] === null && f[basis + 6] === null &&
          !angegriffen(f, kZeile, 4, gegner) &&
          !angegriffen(f, kZeile, 5, gegner) &&
          !angegriffen(f, kZeile, 6, gegner)
        ) {
          out.push(feld(kZeile, 4) + feld(kZeile, 6));
        }
        if (
          s.rochade[farbe === 'w' ? 'Q' : 'q'] &&
          f[basis + 0] === turm &&
          f[basis + 3] === null && f[basis + 2] === null && f[basis + 1] === null &&
          !angegriffen(f, kZeile, 4, gegner) &&
          !angegriffen(f, kZeile, 3, gegner) &&
          !angegriffen(f, kZeile, 2, gegner)
        ) {
          out.push(feld(kZeile, 4) + feld(kZeile, 2));
        }
      }
      continue;
    }

    for (const [dr, ds] of RICHTUNGEN[art]) {
      let nr = r + dr;
      let ns = sp + ds;
      while (drinnen(nr, ns)) {
        const ziel = f[nr * 8 + ns];
        if (ziel === null) {
          out.push(`${feld(r, sp)}${feld(nr, ns)}`);
        } else {
          if (istGegner(f, nr * 8 + ns, farbe)) out.push(`${feld(r, sp)}${feld(nr, ns)}`);
          break;
        }
        nr += dr;
        ns += ds;
      }
    }
  }
  return out;
}

/** Ein Textzug auf einer FEN, Ergebnis wieder als FEN. */
export function spielen(fen, zug) {
  const s = lesen(fen);
  const f = s.felder.slice();
  const farbe = s.zug;
  // "e1d2" -> Zeile/Spalte. Der Rang aus dem Text muss erst in eine Zeile
  // umgedreht werden, denn Zeile 0 ist a8. Sonst landet jeder Zug auf dem
  // spiegelverkehrten Quadrat.
  const von = [8 - Number(zug[1]), zug.charCodeAt(0) - 97];
  const nach = [8 - Number(zug[3]), zug.charCodeAt(2) - 97];
  const ziel = zug[4] || null;
  const vi = von[0] * 8 + von[1];
  const ni = nach[0] * 8 + nach[1];
  const bewegt = f[vi];
  let halb = s.halb;
  const r = vi >> 3;
  const sp = vi % 8;

  // Rochade
  if (movedKing(moved0(bewegt), vi, ni)) {
    if (ni > vi) {
      f[vi + 3] = f[vi + 1];
      f[vi + 1] = null;
    } else {
      f[vi - 4] = f[vi - 1];
      f[vi - 1] = null;
    }
  }
  // En passant
  if (moved0(bewegt) === 'p' && Math.abs(ni - vi) !== 8 && f[ni] === null) {
    // Der geraeumte Bauer steht bei Weiss eine Zeile tiefer als das Zielfeld.
    f[farbe === 'w' ? ni + 8 : ni - 8] = null;
    halb = 0;
  }

  f[ni] = ziel ? (farbe === 'w' ? ziel.toUpperCase() : ziel) : bewegt;
  f[vi] = null;

  // Rochaderechte
  const nr = { ...s.rochade };
  if (vi === 4 && r === 0) { nr.K = false; nr.Q = false; }
  if (vi === 60 && r === 7) { nr.k = false; nr.q = false; }
  if (vi === 7 && r === 0) nr.K = false;
  if (vi === 0 && r === 0) nr.Q = false;
  if (vi === 63 && r === 7) nr.k = false;
  if (vi === 56 && r === 7) nr.q = false;
  if (ni === 63) nr.k = false;
  if (ni === 56) nr.q = false;
  if (ni === 7) nr.K = false;
  if (ni === 0) nr.Q = false;

  const doppelt = moved0(bewegt) === 'p' && Math.abs(nach[0] - r) === 2;
  const epFeld = doppelt
    ? [r + ZACHL[farbe], sp]
    : null;
  if (moved0(bewegt) !== 'p' && f[ni] === bewegt) halb += 1;

  const schreiben = [];
  // FEN beginnt auf der 8. Reihe, und Zeile 0 ist a8: also von vorn nach
  // hinten schreiben. Von hinten nach vorn waere das Brett auf dem Kopf -
  // und dann prueft jede Schachabfrage die falsche Stellung.
  for (let rr = 0; rr < 8; rr++) {
    let leer = 0;
    let zeile = '';
    for (let ss = 0; ss < 8; ss++) {
      const p = f[rr * 8 + ss];
      if (p === null) { leer += 1; continue; }
      if (leer) { zeile += leer; leer = 0; }
      zeile += p;
    }
    if (leer) zeile += leer;
    schreiben.push(zeile);
  }
  const rc = [nr.K && 'K', nr.Q && 'Q', nr.k && 'k', nr.q && 'q'].filter(Boolean).join('') || '-';
  return [
    schreiben.join('/'),
    farbe === 'w' ? 'b' : 'w',
    rc,
    epFeld ? feld(epFeld[0], epFeld[1]) : '-',
    halb,
    farbe === 'w' ? s.voll : s.voll + 1,
  ].join(' ');
}

const moved0 = (p) => (p === null ? null : p.toLowerCase());
const movedKing = (art, von, nach) => art === 'k' && Math.abs(nach - von) === 2;

/** Legale Zuege als Text, mit Schachpruefung nach dem Zug. */
export function legal(fen) {
  const wir = lesen(fen).zug;        // die Farbe, die gerade zieht
  const gegner = wir === 'w' ? 'b' : 'w';
  const out = [];
  for (const zug of pseudo(fen)) {
    const s = lesen(spielen(fen, zug));
    // Nach dem Zug ist der Gegner am Zug - geprueft wird aber der Koenig
    // der ziehbaren Farbe. Sonst prueft man die Schachlage des Gegners und
    // laesst jede illegale Antwort auf eine Drohung zu.
    const [r, sp] = kingPos(s.felder, wir);
    if (r < 0) continue;
    if (!angegriffen(s.felder, r, sp, gegner)) out.push(zug);
  }
  return out.sort();
}

function kingPos(f, farbe) {
  const ziel = farbe === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (f[i] === ziel) return [Math.floor(i / 8), i % 8];
  return [-1, -1];
}