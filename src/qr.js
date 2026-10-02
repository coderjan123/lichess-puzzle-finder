/**
 * QR-Code-Encoder - bewusst klein.
 *
 * Anlass: die Ergebnisliste soll als QR-teilbar sein, ohne dass dafür ein
 * Dienst im Internet angefragt wird. Die Seite kommt ohne fremde Skripte aus
 * und funktioniert offline - das gilt auch hier. Und jeder Aufruf des Codes
 * ist ein Kontakt nach draußen, den es sonst nicht gäbe.
 *
 * Umfang: Byte-Modus (URLs sind ASCII), Fehlerkorrekturstufe M, Version 1 bis
 * 10. Das fasst 216 Zeichen - eine geteilte Adresse dieses Projekts liegt bei
 * rund 150. Längere Texte ergeben null, und der Aufrufer weist das ab, statt
 * einen unlesbaren Code zu erzeugen.
 *
 * Geprüft wird das Ergebnis nicht mit einem zweiten Encoder, sondern mit einem
 * echten Decoder (jsQR, nur in build/): was der Decoder zurückgibt, muss der
 * eingegebene Text sein. Siehe build/qrtest.mjs.
 */

// ---------------------------------------------------------------- GF(256)
// Fehlerkorrektur rechnet in GF(256) mit dem Generatorpolynom 0x11D.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generatorpolynom Grad `degree`. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gmul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Fehlerkorrekturcodeworte für einen Block Daten. */
function eccFor(data, degree) {
  const gen = generator(degree);
  const res = new Uint8Array(data.length + degree);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], factor);
  }
  return res.subarray(data.length);
}

// ---------------------------------------------------------------- Parameter
// Fehlerkorrekturstufe M, Version 1 bis 10.
//   daten  = Datencodeworte insgesamt
//   bloecke = [Anzahl, Datenworte je Block] - hoechstens zwei Gruppen
//   ecc    = Fehlerkorrekturworte je Block

const SPEC = {
  1: { daten: 16, bloecke: [[1, 16]], ecc: 10 },
  2: { daten: 28, bloecke: [[1, 28]], ecc: 16 },
  3: { daten: 44, bloecke: [[1, 44]], ecc: 26 },
  4: { daten: 64, bloecke: [[2, 32]], ecc: 18 },
  5: { daten: 86, bloecke: [[2, 43]], ecc: 24 },
  6: { daten: 108, bloecke: [[4, 27]], ecc: 16 },
  7: { daten: 124, bloecke: [[4, 31]], ecc: 18 },
  8: { daten: 154, bloecke: [[2, 38], [2, 39]], ecc: 22 },
  9: { daten: 182, bloecke: [[3, 36], [2, 37]], ecc: 22 },
  10: { daten: 216, bloecke: [[4, 43], [1, 44]], ecc: 26 },
};

/** Mittelpunkte der Ausrichtungsmuster je Version. */
const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const ECC_BITS = 0b00; // M

// ---------------------------------------------------------------- Codeworte

/** Wandelt Text in die fertige Kette aus Codeworten (inkl. Fehlerkorrektur). */
function codewords(bytes, version) {
  const spec = SPEC[version];
  const bits = [];

  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // Byte-Modus
  push(bytes.length, version < 10 ? 8 : 16); // Laenge in Zeichen
  for (const b of bytes) push(b, 8);

  // Restbits, dann auf volle Bytes fuellen
  const total = spec.daten * 8;
  for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const daten = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    daten.push(v);
  }
  // Fuellbytes abwechselnd 0xEC und 0x11
  for (let pad = 0xec; daten.length < spec.daten; pad ^= 0xec ^ 0x11) daten.push(pad);

  // In Bloecke aufteilen, Fehlerkorrektur anhängen
  const bloecke = [];
  let pos = 0;
  for (const [anzahl, groesse] of spec.bloecke) {
    for (let i = 0; i < anzahl; i++) {
      const block = daten.slice(pos, pos + groesse);
      pos += groesse;
      bloecke.push({ daten: block, ecc: eccFor(block, spec.ecc) });
    }
  }

  // Verschränken: erst alle Datenanteile, dann alle Fehlerkorrekturanteile
  const out = [];
  const maxDaten = Math.max(...bloecke.map((b) => b.daten.length));
  for (let i = 0; i < maxDaten; i++) {
    for (const b of bloecke) if (i < b.daten.length) out.push(b.daten[i]);
  }
  for (let i = 0; i < spec.ecc; i++) {
    for (const b of bloecke) out.push(b.ecc[i]);
  }
  return out;
}

// ---------------------------------------------------------------- Matrix

function leereMatrix(version) {
  const size = 17 + 4 * version;
  return {
    size,
    felder: new Uint8Array(size * size),
    fest: new Uint8Array(size * size),
    setze(x, y, dunkel, reserviert = true) {
      this.felder[y * this.size + x] = dunkel ? 1 : 0;
      if (reserviert) this.fest[y * this.size + x] = 1;
    },
  };
}

function zeichneFinder(m, x0, y0) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x < 0 || y < 0 || x >= m.size || y >= m.size) continue;
      const innen = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const ring = innen && (dx === 0 || dx === 6 || dy === 0 || dy === 6);
      const kern = innen && dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      m.setze(x, y, innen && (ring || kern));
    }
  }
}

function zeichneMuster(m) {
  const n = m.size;

  // Finder oben links, oben rechts, unten links + Trennstreifen
  zeichneFinder(m, 0, 0);
  zeichneFinder(m, n - 7, 0);
  zeichneFinder(m, 0, n - 7);

  // Zeitmuster
  for (let i = 8; i < n - 8; i++) {
    m.setze(i, 6, i % 2 === 0);
    m.setze(6, i, i % 2 === 0);
  }

  // Ausrichtungsmuster
  const zentren = ALIGN[versionFuerGroesse(n)];
  for (const cy of zentren) {
    for (const cx of zentren) {
      // Die drei, die auf einen Finder liegen, entfallen
      const amFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= n - 9) || (cx >= n - 9 && cy <= 8);
      if (amFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const rand = Math.max(Math.abs(dx), Math.abs(dy));
          m.setze(cx + dx, cy + dy, rand !== 1);
        }
      }
    }
  }

  // Formatbereiche reservieren
  for (let i = 0; i <= 8; i++) {
    m.setze(i, 8, false);
    m.setze(8, i, false);
  }
  for (let i = 0; i < 8; i++) {
    m.setze(n - 1 - i, 8, false);
    m.setze(8, n - 1 - i, false);
  }
  m.setze(8, n - 8, true); // das dunkle Modul

  // Versionsinformation ab Version 7 (18 Bit: 6 Datenbit plus BCH-Rest)
  const v = versionFuerGroesse(n);
  if (v >= 7) {
    const bits = versionsBits(v);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      m.setze(Math.floor(i / 3), n - 11 + (i % 3), bit);
      m.setze(n - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }
}

function versionFuerGroesse(size) {
  return (size - 17) / 4;
}

/** 18 Bit fuer die Versionsinformation, BCH mit 0x1F25. */
function versionsBits(version) {
  let rest = version;
  for (let i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
  return (version << 12) | rest;
}

/** Setzt die Datenbits im Zickzack von rechts unten. */
function setzeDaten(m, bytes) {
  const n = m.size;
  const bits = [];
  for (const w of bytes) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);

  let index = 0;
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5; // die Spalte mit dem Zeitmuster aussparen
    for (let vertikal = 0; vertikal < n; vertikal++) {
      // Klammern Pflicht: "===" bindet stärker als "&", ohne Klammern ergibt
      // der Ausdruck immer 0 und der Zickzack läuft in die falsche Richtung.
      const nachOben = ((rechts + 1) & 2) === 0;
      const y = nachOben ? n - 1 - vertikal : vertikal;
      for (let j = 0; j < 2; j++) {
        const x = rechts - j;
        if (m.fest[y * n + x]) continue;
        m.felder[y * n + x] = index < bits.length ? bits[index] : 0;
        index++;
      }
    }
  }
}

/** Die acht Masken; true heisst "drehen". */
const MASKEN = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function wendeMaske(m, maske) {
  const n = m.size;
  const fn = MASKEN[maske];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (m.fest[y * n + x]) continue;
      if (fn(x, y)) m.felder[y * n + x] ^= 1;
    }
  }
}

/** Strafpunkte nach der Vorschrift - davon haengt die Maskenwahl ab. */
function straf(m) {
  const n = m.size;
  const f = m.felder;
  let summe = 0;

  // Regel 1: fuenf gleiche Module in einer Reihe
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = f[y * n + x];
      if (x + 4 < n && [1, 2, 3, 4].every((k) => f[y * n + x + k] === v)) summe += 3;
      if (y + 4 < n && [1, 2, 3, 4].every((k) => f[(y + k) * n + x] === v)) summe += 3;
    }
  }

  // Regel 2: 2x2 Bloecke gleicher Farbe
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const v = f[y * n + x];
      if (f[y * n + x + 1] === v && f[(y + 1) * n + x] === v && f[(y + 1) * n + x + 1] === v) summe += 3;
    }
  }

  // Regel 3: Muster 1:1:3:1:1 mit hellen Randmodulen
  const muster = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const musterUmgekehrt = muster.slice().reverse();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x + 10 < n; x++) {
      let trifft = true;
      let trifft2 = true;
      for (let k = 0; k < 11; k++) {
        const v = f[y * n + x + k];
        if (v !== muster[k]) trifft = false;
        if (v !== musterUmgekehrt[k]) trifft2 = false;
      }
      if (trifft) summe += 40;
      if (trifft2) summe += 40;
    }
  }

  // Regel 4: Anteil der dunklen Module
  let dunkel = 0;
  for (let i = 0; i < f.length; i++) dunkel += f[i];
  const anteil = (dunkel * 100) / f.length;
  summe += Math.floor(Math.abs(anteil - 50) / 5) * 10;

  return summe;
}

function formatBits(maske) {
  const daten = (ECC_BITS << 3) | maske;
  let rest = daten;
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  return ((daten << 10) | rest) ^ 0x5412;
}

/** Schreibt die Formatinformation an beide Stellen plus das dunkle Modul. */
function setzeFormat(m, maske) {
  const n = m.size;
  const bits = formatBits(maske);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    // Um den oberen linken Finder
    if (i < 6) m.setze(8, i, bit, false);
    else if (i < 8) m.setze(8, i + 1, bit, false);
    else if (i === 8) m.setze(7, 8, bit, false);
    else m.setze(14 - i, 8, bit, false);
    // Gespiegelt
    if (i < 8) m.setze(n - 1 - i, 8, bit, false);
    else m.setze(8, n - 15 + i, bit, false);
  }
  m.setze(8, n - 8, true, false);
}

/**
 * Erzeugt die Matrix für einen Text.
 * @returns {{size:number, felder:Uint8Array, version:number}|null} null, wenn der
 *          Text zu lang ist.
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const spec = SPEC[v];
    const laengeBits = v < 10 ? 8 : 16;
    if (4 + laengeBits + bytes.length * 8 <= spec.daten * 8) {
      version = v;
      break;
    }
  }
  if (!version) return null;

  const worte = codewords(bytes, version);
  const basis = leereMatrix(version);
  zeichneMuster(basis);
  setzeDaten(basis, worte);

  // Jede Maske auf einer Kopiere bewerten und die beste uebernehmen - die
  // Maske muss auch wirklich im Ergebnis stehen, sonst ist der Code nicht
  // lesbar (genau dieser Fehler war zuerst drin).
  let besteFelder = null;
  let besteMaske = 0;
  let besteStraf = Infinity;
  for (let maske = 0; maske < 8; maske++) {
    const felder = basis.felder.slice();
    const probe = { size: basis.size, felder, fest: basis.fest };
    wendeMaske(probe, maske);
    const s = straf(probe);
    if (s < besteStraf) {
      besteStraf = s;
      besteFelder = felder;
      besteMaske = maske;
    }
  }

  // Die Basis weiterverwenden (sie hat die setze-Methode) und nur die
  // maskierten Felder uebernehmen.
  basis.felder = besteFelder;
  setzeFormat(basis, besteMaske);
  return { size: basis.size, felder: basis.felder, version, maske: besteMaske };
}

/**
 * QR als SVG-Pfad. Ein einziger Pfad statt tausender <rect> - das bleibt auch
 * bei einem 57x57-Code klein und schoen skaliert.
 */
export function qrSvg(text, { rand = 4, dunkel = '#161512', hell = '#ffffff' } = {}) {
  const m = qrMatrix(text);
  if (!m) return null;
  let d = '';
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (m.felder[y * m.size + x]) d += `M${x + rand} ${y + rand}h1v1h-1z`;
    }
  }
  const kanten = m.size + rand * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${kanten} ${kanten}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR-Code der aktuellen Adresse">` +
    `<rect width="${kanten}" height="${kanten}" fill="${hell}"/>` +
    `<path d="${d}" fill="${dunkel}"/></svg>`
  );
}
