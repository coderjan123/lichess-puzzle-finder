/**
 * Datenschicht.
 *
 * Der Index liegt als "Rating<TAB>PuzzleId" in nach Rating sortierten, gzip-
 * komprimierten Buckets (100 Ratingpunkte pro Datei) vor. Gelesen wird
 * gestreamt: für "schwerste zuerst" werden nur die ersten Kilobyte der
 * obersten Bucket-Datei eines Themes benötigt, der Rest wird nie geladen.
 *
 * Sortiert wird clientseitig, es gibt keinen Server und keine API.
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

/**
 * Sortierregel der ganzen Anwendung: Rating absteigend, bei Gleichstand
 * Puzzle-ID aufsteigend. Für "einfachste zuerst" dreht sich nur das Rating,
 * die ID-Reihenfolge bleibt aufsteigend. Skript und Website nutzen dieselbe
 * Regel, liefern also exakt dieselbe Liste.
 */
function compareItems(a, b, desc) {
  if (a.rating !== b.rating) return desc ? b.rating - a.rating : a.rating - b.rating;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Vergleich zweier gepackter Werte nach derselben Regel (Merge im Strom). */
function isBetter(a, b, desc) {
  const ra = Math.floor(a / SHIFT);
  const rb = Math.floor(b / SHIFT);
  if (ra !== rb) return desc ? ra > rb : ra < rb;
  return (a % SHIFT) < (b % SHIFT);
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

export function loadManifest() {
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

function bucketFile(theme, start) {
  return `${theme}_${start}.tsv.gz`;
}

/** Buckets eines Themes, die das Ratingfenster [min,max] schneiden (aufsteigend). */
export function bucketsIn(manifest, theme, min, max) {
  const info = manifest.themes[theme];
  if (!info) return [];
  const out = [];
  for (const [start, count, size] of info.b) {
    if (start + manifest.bucketSize - 1 < min || start > max) continue;
    out.push({ start, count, size, file: bucketFile(theme, start) });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Bytes, die eine Suche ungefaehr laden muss - nur für die Anzeige im UI. */
export function estimateBytes(manifest, query) {
  let bytes = 0;
  for (const theme of query.themes) {
    for (const b of bucketsIn(manifest, theme, query.min, query.max)) bytes += b.size;
  }
  return bytes;
}

/** Fortschrittszaehler: summiert die pro Datei geladenen Bytes. */
export function makeProgress() {
  const perFile = new Map();
  return {
    bytes: 0,
    perFile,
    note(file, loaded) {
      perFile.set(file, loaded);
      let sum = 0;
      for (const v of perFile.values()) sum += v;
      this.bytes = sum;
    },
  };
}

/**
 * Eine Bucket-Datei: "rating<TAB>id"-Zeilen, im File Rating absteigend.
 *
 * reverse=true liefert aufsteigend; dafür wird die Datei komplett gelesen,
 * was nur die niedrigsten Buckets betrifft (die sind klein).
 *
 * Endet der Strom vorzeitig - der Aufrufer hat genug -, wird im finally-Block
 * der laufende Download sofort abgebrochen.
 */
async function* bucketStream(bucket, { min, max, reverse, progress, signal }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) return;
    signal.addEventListener('abort', onAbort);
  }

  try {
    const res = await fetch(DATA_BASE + bucket.file, { signal: controller.signal });
    if (!res.ok) throw new Error(`${bucket.file}: HTTP ${res.status}`);

    const decoder = new TextDecoder();
    const queue = [];
    let error = null;
    let finished = false;
    let wake = null;
    const notify = () => {
      if (wake) {
        const w = wake;
        wake = null;
        w();
      }
    };

    // fflate ist push-basiert, der Generator pull-basiert -> kleine Queue.
    const pushRaw = Gunzip.prototype.push;
    const gunzip = new Gunzip((chunk, final) => {
      const text = decoder.decode(chunk, { stream: true });
      if (text) queue.push(text);
      if (final) {
        const tail = decoder.decode();
        if (tail) queue.push(tail);
        finished = true;
      }
      notify();
      return true;
    });
    gunzip.push = (chunk, final) => {
      if (error) return;
      try {
        pushRaw.call(gunzip, chunk, final);
      } catch (e) {
        error = e;
        finished = true;
        notify();
      }
    };

    const reader = res.body.getReader();
    const buffered = reverse ? [] : null;
    let rest = '';
    let eof = false;
    let loaded = 0;

    for (;;) {
      if (queue.length === 0 && !finished) {
        if (eof) {
          finished = true;
        } else {
          const { done, value } = await reader.read();
          if (done) {
            eof = true;
            gunzip.push(new Uint8Array(0), true);
          } else {
            loaded += value.byteLength;
            progress?.note(bucket.file, loaded);
            gunzip.push(value, false);
          }
        }
      }

      while (queue.length > 0) {
        const text = queue.shift();
        rest += text;
        let from = 0;
        let stop = false;
        for (;;) {
          const idx = rest.indexOf('\n', from);
          if (idx === -1) break;
          const line = rest.slice(from, idx);
          from = idx + 1;
          if (!line) continue;
          const tab = line.indexOf('\t');
          const rating = +line.slice(0, tab);
          // Das File ist absteigend sortiert: alles danach ist noch kleiner.
          if (rating < min) {
            stop = true;
            break;
          }
          if (rating > max) continue;
          const value = rating * SHIFT + idToNum(line.slice(tab + 1));
          if (buffered) buffered.push(value);
          else yield value;
        }
        rest = rest.slice(from);
        if (stop) {
          finished = true;
          break;
        }
      }

      if (finished) {
        if (error) throw error;
        break;
      }
    }

    if (buffered) {
      // Aufsteigend ausgeben: Rating aufsteigend, bei Gleichstand ID
      // aufsteigend - dieselbe Regel wie überall sonst.
      buffered.sort((x, y) => {
        const rx = Math.floor(x / SHIFT);
        const ry = Math.floor(y / SHIFT);
        return rx !== ry ? rx - ry : (x % SHIFT) - (y % SHIFT);
      });
      for (const value of buffered) yield value;
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

/**
 * Ein Theme als lazy Strom über seine Buckets.
 *
 * Buckets sind rating-disjunkt, deshalb entspricht "Buckets in Rating-Reihenfolge
 * aneinander hängen" exakt einer Sortierung über die ganze Datei - aber es
 * werden nur die Dateien angefasst, die wirklich gebraucht werden.
 */
async function* themeStream(manifest, theme, { min, max, desc, progress, signal }) {
  const buckets = bucketsIn(manifest, theme, min, max);
  if (desc) buckets.reverse();
  for (const bucket of buckets) {
    yield* bucketStream(bucket, { min, max, reverse: !desc, progress, signal });
  }
}

/** ODER-Suche: Streams aller Themes zusammenführen, Duplikate überspringen. */
async function* mergeAny(manifest, query, progress, signal) {
  const desc = query.order !== 'easiest';
  const streams = query.themes.map((theme) =>
    themeStream(manifest, theme, {
      min: query.min,
      max: query.max,
      desc,
      progress,
      signal,
    }),
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
        // Merge in der gewünschten Reihenfolge: schwerste zuerst nimmt den
        // höchsten, einfachste zuerst den niedrigsten Kopf; bei gleichem
        // Rating entscheidet die Puzzle-ID (aufsteigend).
        if (best === -1 || isBetter(heads[i], heads[best], desc)) best = i;
      }
      if (best === -1) return;
      const value = heads[best];      const step = await streams[best].next();
      heads[best] = step.done ? null : step.value;
      if (seen.has(value)) continue;
      seen.add(value);
      yield { id: numToId(value % SHIFT), rating: Math.floor(value / SHIFT) };
      if (++found >= query.count) return;
    }
  } finally {
    for (const s of streams) s.return?.();
  }
}

/**
 * UND-Suche: Schnittmenge aller Themes.
 *
 * Das kleinste Theme wird vollständig geladen und nach Puzzle-ID sortiert
 * (danach binäre Suche). Jedes weitere Theme wird nur gestreamt und dagegen
 * geprüft; Treffer werden pro Index als Bitmaske vermerkt. Dadurch bleibt der
 * Speicherbedarf auch bei Millionen Puzzles klein.
 */
async function* mergeAll(manifest, query, progress, signal) {
  const { themes, count, min, max } = query;
  const desc = query.order !== 'easiest';

  let base = themes[0];
  for (const t of themes) {
    if ((manifest.themes[t]?.n ?? Infinity) < (manifest.themes[base]?.n ?? Infinity)) base = t;
  }
  const others = themes.filter((t) => t !== base);
  if (others.length > 31) throw new Error('Maximal 32 Themes bei UND-Suche');

  const ids = [];
  const ratings = [];
  for await (const value of themeStream(manifest, base, {
    min,
    max,
    desc: false,
    progress,
    signal,
  })) {
    ids.push(value % SHIFT);
    ratings.push(Math.floor(value / SHIFT));
  }

  const n = ids.length;

  if (others.length === 0) {
    const all = ids.map((id, i) => ({ id: numToId(id), rating: ratings[i] }));
    all.sort((a, b) => compareItems(a, b, desc));
    for (const item of all.slice(0, count)) yield item;
    return;
  }

  // flat = Puzzle-IDs aufsteigend, sorted[k] = zugehöriger Index in ids.
  // Damit lässt sich eine ID per binärer Suche in flat finden und über
  // sorted[pos] auf ihren Platz in ids zurückrechnen.
  const sorted = new Array(n);
  for (let i = 0; i < n; i++) sorted[i] = i;
  sorted.sort((a, b) => ids[a] - ids[b]);
  const flat = new Uint32Array(n);
  for (let k = 0; k < n; k++) flat[k] = ids[sorted[k]];

  // hits ist nach Index in ids indiziert, Bit k = "Theme k enthält es".
  const hits = new Uint32Array(n);
  for (let k = 0; k < others.length; k++) {
    const bit = 1 << k;
    for await (const value of themeStream(manifest, others[k], {
      min,
      max,
      desc: false,
      progress,
      signal,
    })) {
      const pos = binarySearch(flat, value % SHIFT);
      if (pos !== -1) hits[sorted[pos]] |= bit;
    }
  }

  const full = (1 << others.length) - 1;
  const found = [];
  for (let i = 0; i < n; i++) {
    if (hits[i] === full) found.push({ id: numToId(ids[i]), rating: ratings[i] });
  }
  found.sort((a, b) => compareItems(a, b, desc));
  for (const item of found.slice(0, count)) yield item;
}

function binarySearch(arr, value) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = arr[mid];
    if (v === value) return mid;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/**
 * Führt eine Suche aus.
 * @param hooks.onBytes  Fortschritts-Callback
 * @param hooks.signal   AbortSignal zum Abbrechen
 * @returns {items, bytes, cancelled}
 */
export async function runQuery(manifest, query, hooks = {}) {
  const progress = makeProgress();
  const signal = hooks.signal;
  const and = query.themes.length > 1 && query.mode === 'AND';
  const stream = and
    ? mergeAll(manifest, query, progress, signal)
    : mergeAny(manifest, query, progress, signal);

  const items = [];
  const ticker = setInterval(() => hooks.onBytes?.(progress.bytes), 120);
  try {
    for await (const item of stream) items.push(item);
  } catch (err) {
    if (!signal?.aborted) throw err;
  } finally {
    clearInterval(ticker);
  }
  hooks.onBytes?.(progress.bytes);
  return { items, bytes: progress.bytes, cancelled: !!signal?.aborted };
}
