/**
 * Datenschicht: liest den Theme-Index aus docs/data/ und beantwortet Suchen
 * komplett im Browser.
 *
 * Der Index liegt als "Rating<TAB>PuzzleId" in nach Rating sortierten, gzip-
 * komprimierten Buckets vor (100 Ratingpunkte pro Datei). Zwei Eigenschaften
 * machen eine Suche schnell:
 *
 *   1. Gelesen wird gestreamt und abgebrochen, sobald genug Treffer da sind.
 *      "100 schwerste aus mateIn3" liest 1-2 kleine Dateien statt 800 kB.
 *   2. Alle erwarteten Buckets werden gleichzeitig angefordert. Auf einer
 *      Leitung mit hoher Wartezeit kosten 14 Anfragen nacheinander 14mal die
 *      Wartezeit - nebeneinander nur einmal. Das war der Unterschied zwischen
 *      5,4 und unter 2 Sekunden.
 *
 * Sortierregel überall: Rating absteigend, bei Gleichstand Puzzle-ID
 * aufsteigend. "Einfachste zuerst" dreht nur das Rating. Skript und Website
 * nutzen dieselbe Regel und liefern damit exakt dieselbe Liste.
 */

import { Gunzip } from 'fflate';

// Basis-URL des Datenverzeichnisses. Im Browser relativ zur Seite (funktioniert
// auch in einem GitHub-Pages-Unterordner), im Test über LPF_BASE gesetzt.
const DATA_BASE =
  typeof document !== 'undefined'
    ? new URL('data/', document.baseURI).href
    : (globalThis.process?.env?.LPF_BASE || 'http://127.0.0.1:8123/') + 'data/';

// Gepackter Wert: rating * 2^30 + idNum. Sortierbar als Zahl, exakt in float64.
const SHIFT = 1073741824;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DECODE = Object.create(null);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET[i]] = i;

export function idToNum(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = n * 62 + DECODE[id[i]];
  return n;
}

export function numToId(n) {
  let out = '';
  for (let i = 0; i < 5; i++) {
    out = ALPHABET[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

let manifestPromise = null;

/**
 * Das Manifest steckt in der ausgelieferten Seite direkt in der HTML
 * (window.__LICHESS_MANIFEST__) - dafür geht kein Request raus. Im Test und
 * beim Debuggen wird es geholt.
 */
export function loadManifest() {
  const inline = globalThis.__LICHESS_MANIFEST__;
  if (inline) return Promise.resolve(inline);
  if (!manifestPromise) {
    manifestPromise = fetch(DATA_BASE + 'manifest.json', { cache: 'force-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        manifestPromise = null;
        throw err;
      });
  }
  return manifestPromise;
}

/** Liegt dieses Theme-Paar in der Bitmatrix "nie gemeinsam"? */
export function isImpossiblePair(manifest, a, b) {
  const bits = manifest.neverBits;
  if (!bits) return false;
  const names = Object.keys(manifest.themes);
  const ia = names.indexOf(a);
  const ib = names.indexOf(b);
  if (ia < 0 || ib < 0) return false;
  const lo = ia < ib ? ia : ib;
  const hi = ia < ib ? ib : ia;
  const pos = lo * names.length + hi;
  const six = b64bits(bits.charCodeAt((pos / 6) | 0));
  return ((six >> (5 - (pos % 6))) & 1) === 1;
}

/**
 * base64-Zeichen -> 6 Bit.
 * A-Z (65-90) -> 0-25, a-z (97-122) -> 26-51, 0-9 (48-57) -> 52-61,
 * '+' -> 62, '/' -> 63.
 */
function b64bits(code) {
  if (code >= 97) return code - 71;
  if (code >= 65) return code - 65;
  if (code >= 48) return code + 4;
  return code === 43 ? 62 : 63;
}

function bucketFile(theme, start) {
  return `${theme}_${start}.tsv.gz`;
}

/** Buckets eines Themes, die das Ratingfenster [min,max] schneiden (aufsteigend). */
export function bucketsIn(manifest, theme, min, max) {
  const info = manifest.themes[theme];
  if (!info) return [];
  const per = manifest.bytesPerEntry || 4.4;
  const out = [];
  for (const [start, count] of info.b) {
    if (start + manifest.bucketSize - 1 < min || start > max) continue;
    out.push({ start, count, size: Math.round(count * per), file: bucketFile(theme, start) });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// ------------------------------------------------------------- Größenabschätzung

/**
 * Obergrenze: Bytes aller Buckets der gewählten Themes im Ratingfenster.
 * Bei einer ODER-Suche ist das zugleich die echte Größe.
 */
export function estimateAll(manifest, query) {
  let bytes = 0;
  for (const theme of query.themes) {
    for (const b of bucketsIn(manifest, theme, query.min, query.max)) bytes += b.size;
  }
  return bytes;
}

/**
 * Ratingfenster, in denen eine UND-Suche ihre Treffer suchen muss.
 *
 * Ein gemeinsames Puzzle steht in beiden Themes. Sind von einem Theme erst E
 * Einträge gelesen, kann es höchstens E Treffer geben. Die Suche muss also
 * mindestens so weit nach unten laufen, bis das Theme mit den wenigsten
 * Einträgen `count` erreicht hat. Für "100 schwerste aus mateIn3 ∩ attraction"
 * sind das die Fenster 2800 bis 2400.
 */
function andWindows(manifest, query) {
  const desc = query.order !== 'easiest';
  const lists = query.themes.map((t) => bucketsIn(manifest, t, query.min, query.max));
  const starts = [...new Set(lists.flat().map((b) => b.start))];
  if (desc) starts.reverse();
  const read = new Array(lists.length).fill(0);
  const out = [];
  for (const start of starts) {
    let any = false;
    for (let i = 0; i < lists.length; i++) {
      const bucket = lists[i].find((b) => b.start === start);
      if (bucket) {
        read[i] += bucket.count;
        any = true;
      }
    }
    if (any) out.push(start);
    if (Math.min(...read) >= query.count) break;
  }
  return out;
}

/**
 * Untergrenze für eine UND-Suche: so viele Bytes müssen mindestens gelesen
 * werden, damit `count` gemeinsame Puzzles gefunden werden können.
 *
 * Die wirkliche Größe liegt darüber, weil Themes häufiger gemeinsam auftreten
 * als die Einträge es vermuten lassen (27 kB Untergrenze, 80 kB in der Praxis
 * für "100 schwerste aus mateIn3 ∩ attraction"). Das UI nennt deshalb die
 * Obergrenze und behandelt die Untergrenze als "mindestens".
 */
export function estimateBytes(manifest, query) {
  if (query.mode !== 'AND' || query.themes.length < 2) return estimateAll(manifest, query);
  const wanted = new Set(andWindows(manifest, query));
  let bytes = 0;
  for (const theme of query.themes) {
    for (const b of bucketsIn(manifest, theme, query.min, query.max)) {
      if (wanted.has(b.start)) bytes += b.size;
    }
  }
  return bytes;
}

/** Bytes je Eintrag entpackt - nur für die Breite des Ladebalkens. */
const RAW_PER_ENTRY = 19.5;

export function estimateRaw(manifest, query) {
  const entries = estimateBytes(manifest, query) / (manifest.bytesPerEntry || 4.4);
  return Math.round(entries * RAW_PER_ENTRY);
}

/**
 * Dateien, die eine Suche voraussichtlich braucht.
 *
 * Bei UND sind das die Buckets der geplanten Ratingfenster, bei ODER die
 * obersten Buckets jedes Themes. Sie werden alle gleichzeitig angefordert, damit
 * ihre Wartezeiten überlappen.
 *
 * Das Budget begrenzt den Vorgriff auf rund 400 kB: genug, um die Wartezeit zu
 * überlappen, aber nicht genug, um eine grössere Datei für ein Ergebnis
 * herunterzuladen, das nach dem zehnten Treffer sowieso verworfen wird. Wird es
 * überschritten, lädt die Suche die restlichen Dateien nach Bedarf - nur eben
 * mit Wartezeit statt daneben.
 */
function planFiles(manifest, query, budget = 400_000) {
  const desc = query.order !== 'easiest';
  const files = [];
  let bytes = 0;
  const add = (file, size) => {
    if (bytes > budget) return false;
    bytes += size;
    files.push(file);
    return true;
  };

  if (query.mode === 'AND' && query.themes.length > 1) {
    const wanted = new Set(andWindows(manifest, query));
    for (const theme of query.themes) {
      const list = bucketsIn(manifest, theme, query.min, query.max);
      if (desc) list.reverse();
      for (const b of list) if (wanted.has(b.start)) add(b.file, b.size);
    }
  } else {
    for (const theme of query.themes) {
      const list = bucketsIn(manifest, theme, query.min, query.max);
      if (desc) list.reverse();
      for (const b of list.slice(0, 3)) add(b.file, b.size);
    }
  }
  return files;
}

// ------------------------------------------------------------------ Vorladen

/**
 * Ein Abruf je Datei, egal ob vorab geladen oder erst jetzt gebraucht.
 * Werden die Antworten gleichzeitig angefordert, laufen alle Downloads parallel.
 */
function getResponse(ctx, file) {
  let pending = ctx.preloads.get(file);
  if (!pending) {
    pending = fetch(DATA_BASE + file, { signal: ctx.signal });
    ctx.preloads.set(file, pending);
  }
  return pending.then((res) => {
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    ctx.used.add(file);
    return res;
  });
}

/** Vorab anfordern, ohne zu warten. Fehler tauchen dann beim Lesen auf. */
function preload(ctx, files) {
  for (const file of files) {
    if (ctx.preloads.has(file)) continue;
    getResponse(ctx, file).catch(() => {});
  }
}

/**
 * Beendet Vorabloads, die gerade nicht gebraucht werden.
 *
 * Ein vorab geladener Strom blockiert die Verbindung des Browsers, auch wenn
 * niemand mehr ihn liest - bei parallelen Anfragen ist das ausgerechnet die
 * Verbindung, die als Nächstes gebraucht wird. Deshalb wird nach jedem Treffer
 * aufgeräumt: offen bleiben nur die Buckets, die der Merge gerade liest, und
 * die, die er als Nächstes liest.
 */
function trimPreloads(ctx, slots) {
  const keep = new Set();
  for (const sl of slots) {
    if (sl.file) keep.add(sl.file);
    if (sl.next) keep.add(sl.next);
  }
  for (const [file, pending] of ctx.preloads) {
    if (keep.has(file) || ctx.used.has(file) || ctx.plan.has(file)) continue;
    ctx.preloads.delete(file);
    pending.then((res) => res.body?.cancel()).catch(() => {});
  }
}

/** Nicht benötigte Vorabloads freigeben, damit sie keinen Speicher belegen. */
function dropUnused(ctx) {
  for (const [file, pending] of ctx.preloads) {
    if (ctx.used.has(file)) continue;
    pending.then((res) => res.body?.cancel()).catch(() => {});
  }
}

// ------------------------------------------------------------------ Fortschritt

/** Zählt die entpackten Bytes - damit bewegt sich der Balken weich. */
function makeProgress() {
  let raw = 0;
  return {
    raw: 0,
    note(n) {
      raw += n;
      this.raw = raw;
    },
  };
}

// ------------------------------------------------------------------ Entpacken

const NATIVE_GZIP = typeof DecompressionStream === 'function';
const EMPTY = new Uint8Array(0);

/**
 * Liefert den entpackten Response-Strom als Textstücke.
 *
 * Modern übernimmt DecompressionStream (native, schnell). Für ältere Browser
 * entpackt fflate - derselbe Code-Pfad wie vorher, nur der Auslöser.
 */
async function* decompressedText(res, onChunk) {
  if (NATIVE_GZIP) {
    const reader = res.body.pipeThrough(new DecompressionStream('gzip')).getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(value.byteLength);
        const text = decoder.decode(value, { stream: true });
        if (text) yield text;
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      reader.cancel().catch(() => {});
    }
    return;
  }

  // Rückfallweg für Browser ohne DecompressionStream.
  const decoder = new TextDecoder();
  const queue = [];
  let wait = null;
  let done = false;
  const wake = () => {
    if (wait) {
      const w = wait;
      wait = null;
      w();
    }
  };
  const pushRaw = Gunzip.prototype.push;
  const gunzip = new Gunzip((chunk, final) => {
    const text = decoder.decode(chunk, { stream: true });
    if (text) queue.push(text);
    if (final) {
      const tail = decoder.decode();
      if (tail) queue.push(tail);
      done = true;
    }
    wake();
  });
  const raw = res.body.getReader();
  try {
    for (;;) {
      if (queue.length === 0 && !done) {
        await new Promise((resolve) => {
          wait = resolve;
        });
        continue;
      }
      while (queue.length) yield queue.shift();
      if (done) return;
      const step = await raw.read();
      if (step.done) {
        pushRaw.call(gunzip, EMPTY, true);
        continue;
      }
      onChunk(step.value.byteLength);
      pushRaw.call(gunzip, step.value, false);
    }
  } finally {
    raw.cancel().catch(() => {});
  }
}

// ------------------------------------------------------------------ Datei lesen

/**
 * Eine Bucket-Datei: "rating<TAB>id"-Zeilen, im File Rating absteigend.
 *
 * reverse=true liefert aufsteigend; dafür wird die Datei komplett gelesen und
 * sortiert, was nur die niedrigsten Buckets betrifft (die sind klein).
 *
 * Der Strom endet vorzeitig, sobald der Aufrufer genug hat - der laufende
 * Download wird dann sofort abgebrochen.
 */
async function* bucketStream(bucket, opts, ctx) {
  const { min, max, progress } = opts;
  // "Einfachste zuerst" verlangt aufsteigende Reihenfolge. Die Datei liegt
  // aber absteigend vor, dann wird sie komplett gelesen und sortiert - das
  // betrifft nur die niedrigen Buckets, die sind klein.
  const reverse = !opts.desc;
  if (ctx.signal.aborted) return;

  let res;
  try {
    res = await getResponse(ctx, bucket.file);
  } catch (err) {
    if (ctx.signal.aborted) return;
    throw err;
  }

  const buffered = reverse ? [] : null;
  let rest = '';
  let complete = false;

  try {
    outer: for await (const text of decompressedText(res, (n) => progress?.note(n))) {
      rest += text;
      let from = 0;
      for (;;) {
        const idx = rest.indexOf('\n', from);
        if (idx === -1) break;
        const line = rest.slice(from, idx);
        from = idx + 1;
        if (!line) continue;
        const tab = line.indexOf('\t');
        const rating = +line.slice(0, tab);
        // Das File ist absteigend sortiert: alles danach ist noch kleiner.
        if (rating < min) break outer;
        if (rating > max) continue;
        const value = rating * SHIFT + idToNum(line.slice(tab + 1));
        if (buffered) buffered.push(value);
        else yield value;
      }
      rest = rest.slice(from);
    }
    complete = true;
  } finally {
    // Der Aufrufer hat genug: laufende Downloads sofort abbrechen.
    res.body?.cancel().catch(() => {});
    if (complete) ctx.wire += Number(res.headers.get('content-length') || 0);
  }

  if (buffered) {
    // Aufsteigend ausgeben: Rating aufsteigend, bei Gleichstand ID aufsteigend.
    buffered.sort(comparePacked);
    for (const value of buffered) yield value;
  }
}

/** Aufsteigende Reihenfolge fuer gepackte Werte. */
function comparePacked(x, y) {
  const rx = Math.floor(x / SHIFT);
  const ry = Math.floor(y / SHIFT);
  return rx !== ry ? rx - ry : x % SHIFT - (y % SHIFT);
}

/**
 * Ein Theme als lazy Strom über seine Buckets.
 *
 * Buckets sind rating-disjunkt, deshalb entspricht "Buckets in Rating-Reihenfolge
 * aneinander hängen" exakt einer Sortierung über die ganze Datei - es werden
 * aber nur die Dateien angefasst, die wirklich gebraucht werden. Die folgenden
 * Buckets werden schon vorab angefordert, während der aktuelle noch gelesen
 * wird: so überlappen die Wartezeiten.
 */
async function* themeStream(manifest, theme, opts, ctx, slot) {
  const buckets = bucketsIn(manifest, theme, opts.min, opts.max);
  if (opts.desc) buckets.reverse();
  for (let i = 0; i < buckets.length; i++) {
    slot.file = buckets[i].file;
    // Den nächsten Bucket vorladen, während der aktuelle gelesen wird. So
    // überlappen die Wartezeiten, ohne mehr zu übertragen als nötig.
    slot.next = buckets[i + 1] ? buckets[i + 1].file : null;
    if (slot.next) preload(ctx, [slot.next]);
    yield* bucketStream(buckets[i], opts, ctx);
  }
  slot.file = null;
  slot.next = null;
}

// ------------------------------------------------------------------ Vergleiche

/**
 * "Schwerste zuerst": größerer Wert zuerst, bei gleichem Rating die kleinere
 * Puzzle-ID. "Einfachste zuerst": kleinerer Wert zuerst, Gleichstand wie oben.
 */
function isBetter(a, b, desc) {
  const ra = Math.floor(a / SHIFT);
  const rb = Math.floor(b / SHIFT);
  if (ra !== rb) return desc ? ra > rb : ra < rb;
  return a % SHIFT < b % SHIFT;
}

// ------------------------------------------------------------------ Suchen

/** ODER-Suche: Streams aller Themes zusammenführen, Duplikate überspringen. */
async function* mergeAny(manifest, query, progress, ctx) {
  const desc = query.order !== 'easiest';
  const slots = query.themes.map(() => ({ file: null, next: null }));
  const streams = query.themes.map((theme, i) =>
    themeStream(manifest, theme, { min: query.min, max: query.max, desc, progress }, ctx, slots[i]),
  );
  const heads = new Array(streams.length).fill(undefined);
  const seen = new Set();
  let found = 0;

  try {
    for (;;) {
      let best = -1;
      for (let i = 0; i < streams.length; i++) {
        if (heads[i] === undefined) {
          const step = await streams[i].next();
          heads[i] = step.done ? null : step.value;
        }
        if (heads[i] === null) continue;
        if (best === -1 || isBetter(heads[i], heads[best], desc)) best = i;
      }
      if (best === -1) return;
      const value = heads[best];
      const step = await streams[best].next();
      heads[best] = step.done ? null : step.value;
      if (seen.has(value)) continue;
      seen.add(value);
      yield { id: numToId(value % SHIFT), rating: Math.floor(value / SHIFT) };
      if (++found >= query.count) return;
      // Nur die gerade gelesenen Buckets offen halten: alles andere abbrechen,
      // damit die Verbindungen für die nächsten Treffer frei sind.
      trimPreloads(ctx, slots);
    }
  } finally {
    for (const s of streams) s.return?.();
  }
}

/**
 * UND-Suche: Schnittmenge aller Themes als Sortier-Misch-Operation.
 *
 * Jeder Strom liefert seine Puzzles in der gewünschten Reihenfolge. Liegen alle
 * Köpfe auf demselben Puzzle, gehört es zu allen Themes. Sonst wird der
 * "kleinste" Kopf verworfen - kein anderer Strom kann ihn noch erreichen, weil
 * alle Ströme sortiert laufen.
 *
 * Weil nur bis zum count-ten Treffer gelesen wird, bleiben die Downloads winzig
 * und der Speicherbedarf konstant.
 */
async function* mergeAll(manifest, query, progress, ctx) {
  const { themes, count, min, max } = query;
  const desc = query.order !== 'easiest';
  const slots = themes.map(() => ({ file: null, next: null }));
  const streams = themes.map((theme, i) =>
    themeStream(manifest, theme, { min, max, desc, progress }, ctx, slots[i]),
  );
  const heads = new Array(streams.length).fill(undefined);
  let found = 0;

  const advance = async (i) => {
    const step = await streams[i].next();
    if (step.done) return false; // Strom zu Ende -> Schnittmenge zu Ende
    heads[i] = step.value;
    return true;
  };

  try {
    for (;;) {
      for (let i = 0; i < streams.length; i++) {
        if (heads[i] === undefined && !(await advance(i))) return;
      }

      if (heads.every((h) => h === heads[0])) {
        yield { id: numToId(heads[0] % SHIFT), rating: Math.floor(heads[0] / SHIFT) };
        if (++found >= count) return;
        // Nur die gerade gelesenen Buckets offen halten: alles andere abbrechen,
        // damit die Verbindungen für die nächsten Treffer frei sind.
        trimPreloads(ctx, slots);
        for (let i = 0; i < streams.length; i++) if (!(await advance(i))) return;
        continue;
      }

      let small = 0;
      for (let i = 1; i < streams.length; i++) {
        if (isBetter(heads[i], heads[small], desc)) small = i;
      }
      if (!(await advance(small))) return;
    }
  } finally {
    for (const s of streams) s.return?.();
  }
}

/**
 * Führt eine Suche aus.
 * @param hooks.onBytes  Fortschritts-Callback (entpackte Bytes)
 * @param hooks.signal   AbortSignal zum Abbrechen
 * @returns {items, bytes, wire, cancelled, impossible}
 *   bytes = entpackte Bytes (fuer den Ladebalken)
 *   wire  = uebertragene Bytes laut content-length der fertig gelesenen Dateien
 */
export async function runQuery(manifest, query, hooks = {}) {
  // Kann das überhaupt Treffer liefern? 532 von 2628 Theme-Paaren kommen in der
  // Datenbank nie gemeinsam vor - das wird beantwortet, ohne Daten zu laden.
  if (query.mode === 'AND' && query.themes.length > 1) {
    for (let i = 0; i < query.themes.length; i++) {
      for (let j = i + 1; j < query.themes.length; j++) {
        if (isImpossiblePair(manifest, query.themes[i], query.themes[j])) {
          return { items: [], bytes: 0, cancelled: false, impossible: true };
        }
      }
    }
  }

  const outer = hooks.signal;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort);
  }

  const plan = planFiles(manifest, query);
  const ctx = {
    signal: controller.signal,
    preloads: new Map(),
    used: new Set(),
    plan: new Set(plan),
    wire: 0,
  };
  const progress = makeProgress();
  const and = query.themes.length > 1 && query.mode === 'AND';
  const stream = and
    ? mergeAll(manifest, query, progress, ctx)
    : mergeAny(manifest, query, progress, ctx);

  // Alle erwarteten Buckets gleichzeitig anfordern.
  preload(ctx, plan);

  const items = [];
  const ticker = setInterval(() => hooks.onBytes?.(progress.raw), 120);
  try {
    for await (const item of stream) items.push(item);
  } catch (err) {
    if (!outer?.aborted) throw err;
  } finally {
    clearInterval(ticker);
    controller.abort();
    if (outer) outer.removeEventListener('abort', onAbort);
    dropUnused(ctx);
  }
  hooks.onBytes?.(progress.raw);
  return {
    items,
    bytes: progress.raw,
    wire: ctx.wire,
    cancelled: !!outer?.aborted,
    impossible: false,
  };
}
