/**
 * App: Theme-Auswahl, Suche, Ergebnisliste.
 *
 * Der komplette Index liegt statisch in docs/data/ und wird nur in den
 * benötigten Teilen geladen (siehe reader.js). Gespielt wird auf lichess.org -
 * die Seite selbst enthält kein Brett, keine Logik und braucht zur Laufzeit
 * keine API, kein Konto und kein Internet.
 */

import { GROUPS, label, groupOf } from './themes.js';
import { loadManifest, runQuery, estimateBytes, isImpossiblePair, estimateAll, estimateRaw, decodeSolv } from './reader.js';

const $ = (id) => document.getElementById(id);
const STORE = 'lpf.lastSearch.v1';
const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const el = {
  back: $('backBtn'),
  title: $('viewTitle'),
  topMeta: $('topMeta'),
  status: $('statusCard'),
  statusText: $('statusText'),
  resume: $('resumeCard'),
  resumeTitle: $('resumeTitle'),
  resumeInfo: $('resumeInfo'),
  resumeBtn: $('resumeBtn'),
  resumeDrop: $('resumeDrop'),
  form: $('searchForm'),
  themeSearch: $('themeSearch'),
  themeList: $('themeList'),
  themeCount: $('themeCount'),
  clearThemes: $('clearThemes'),
  selInfo: $('selInfo'),
  modeCard: $('modeCard'),
  modeSeg: $('modeSeg'),
  modeHint: $('modeHint'),
  orderSeg: $('orderSeg'),
  solvSeg: $('solvSeg'),
  solvNote: $('solvNote'),
  rangeBox: $('rangeBox'),
  minRating: $('minRating'),
  maxRating: $('maxRating'),
  rangePresets: $('rangePresets'),
  count: $('count'),
  countPresets: $('countPresets'),
  estimate: $('estimate'),
  searchBtn: $('searchBtn'),
  resultInfo: $('resultInfo'),
  resultList: $('resultList'),
  playFirst: $('playFirst'),
  copyIds: $('copyIds'),
  copyLink: $('copyLink'),
  copyUnticked: $('copyUnticked'),
  tickedBar: $('tickedBar'),
  tickedCount: $('tickedCount'),
  hideTicked: $('hideTicked'),
  clearTicked: $('clearTicked'),
  snapshotNote: $('snapshotNote'),
  loading: $('loading'),
  loadingText: $('loadingText'),
  loadBar: $('loadBar'),
  loadCancel: $('loadCancel'),
  toast: $('toast'),
};

const state = {
  manifest: null,
  themes: [], // [{id, label, group, count}]
  selected: new Set(),
  mode: 'OR',
  order: 'hardest',
  minSolv: 0,
  results: [],
  abort: null,
  hideTicked: false,
};

// -------------------------------------------------- Router und Suchzustand

const views = { home: $('viewHome'), results: $('viewResults') };
let current = 'home';

function setView(name) {
  current = name;
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  el.back.hidden = name === 'home';
  el.title.textContent = name === 'home' ? 'Lichess Puzzle Finder' : 'Results';
  window.scrollTo(0, 0);
}

/**
 * Zeigt eine Ansicht und schreibt den Zustand in die Adresse.
 *
 * push=false ersetzt nur den aktuellen Eintrag. Sonst erzeugt jedes Tippen in
 * einem Zahlenfeld einen Zurück-Schritt, und der Knopf wird unbrauchbar.
 */
function show(name, { push = true } = {}) {
  setView(name);
  writeUrl(push);
}

el.back.onclick = () => history.back();

window.addEventListener('popstate', () => {
  const parsed = readUrl();
  // Reihenfolge ist wichtig: erst die Ansicht setzen, dann den Zustand. Wird
  // umgekehrt, schreibt applyQuery -> update -> writeUrl die Adresse mit dem
  // alten view und der Verlaufseintrag zeigt plötzlich etwas anderes an, als
  // was gerade angezeigt wird.
  setView(parsed.view);
  if (parsed.query) applyQuery(parsed.query);
});

/**
 * Der ganze Zustand steht in der Adresse:
 *
 *   #/results?t=mateIn3,attraction&m=AND&o=hardest&n=100&r=1800-2200
 *
 * Damit lässt sich eine Liste bookmarken und weitergeben, und der Zurück-Knopf
 * liefert die Auswahl wieder statt nur die Ansicht. Alles im Hash, damit kein
 * Server etwas auswerten muss - auch nicht in einem Unterordner.
 */
function queryToHash(query) {
  // Bewusst von Hand gebaut: URLSearchParams schreibt das Komma als %2C und die
  // Adresse wird unlesbar. Ein Komma ist in einer Query ausdruecklich erlaubt.
  const parts = [`t=${query.themes.map(encodeURIComponent).join(',')}`];
  if (query.themes.length > 1) parts.push(`m=${query.mode}`);
  parts.push(`o=${query.order}`);
  parts.push(`n=${query.count}`);
  if (query.minSolv) parts.push(`v=${query.minSolv}`);
  if (query.order === 'range') parts.push(`r=${query.min}-${query.max}`);
  return parts.join('&');
}

/**
 * Liest die Adresse und prüft jeden Wert. Unbekanntes wird verworfen, nicht
 * geraten: ein Link von Hand, aus einer alten Version oder von einem Theme, das
 * es nicht mehr gibt, darf die Seite nicht zerschießen.
 */
function readUrl() {
  const raw = location.hash.replace(/^#\/?/, '');
  const cut = raw.indexOf('?');
  const view = (cut === -1 ? raw : raw.slice(0, cut)) === 'results' ? 'results' : 'home';
  const p = new URLSearchParams(cut === -1 ? '' : raw.slice(cut + 1));

  const themes = [];
  for (const id of (p.get('t') || '').split(',')) {
    const theme = id.trim();
    if (theme && state.manifest?.themes[theme] && !themes.includes(theme)) themes.push(theme);
  }
  if (!themes.length) return { view: 'home', query: null };

  const order = ['hardest', 'easiest', 'range', 'solved'].includes(p.get('o')) ? p.get('o') : 'hardest';
  let min = 0;
  let max = 9999;
  if (order === 'range') {
    const m = /^(\d{1,4})-(\d{1,4})$/.exec(p.get('r') || '');
    if (m) {
      min = clampInt(m[1], 0, 4000, 0);
      max = clampInt(m[2], 0, 4000, 9999);
      if (min > max) [min, max] = [max, min];
    }
  }
  return {
    view,
    query: {
      themes,
      mode: p.get('m') === 'AND' ? 'AND' : 'OR',
      order,
      min,
      max,
      count: clampInt(p.get('n'), 1, 5000, 100),
      // Nur Werte aus der Liste der Schwellen-Knoepfe zulassen, sonst nimmt die
      // Seite eine Zahl an, die sie gar nicht anzeigen kann.
      minSolv: [0, 100, 1000, 10000, 100000].includes(Number(p.get('v'))) ? Number(p.get('v')) : 0,
    },
  };
}

/** Schreibt Ansicht und Zustand in die Adresse. */
function writeUrl(push) {
  const query = buildQuery();
  const params = query.themes.length ? '?' + queryToHash(query) : '';
  const hash = `#/${current}${params}`;
  const entry = { view: current };
  if (push) history.pushState(entry, '', hash);
  else history.replaceState(entry, '', hash);
}

/** Setzt Auswahl und Formular auf einen Zustand aus der Adresse. */
function applyQuery(query) {
  state.selected = new Set(query.themes);
  state.mode = query.themes.length > 1 ? query.mode : 'OR';
  state.order = query.order;
  el.count.value = String(query.count);
  el.minRating.value = String(query.min);
  el.maxRating.value = String(query.max);
  state.minSolv = query.minSolv || 0;
  setMinSolv(state.minSolv);
  setSegment(el.modeSeg, state.mode);
  setSegment(el.orderSeg, state.order);
  el.rangeBox.hidden = state.order !== 'range';
  renderThemes();
  update();
}

// ---------------------------------------------------------------- Toast

let toastTimer = 0;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
}

// ---------------------------------------------------------------- Start

/**
 * Der Service Worker legt index.html in den Browser-Cache, damit der zweite
 * Aufruf ohne Netz kommt. Fehler (z. B. bei file://) sind harmlos.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch {
    /* ignorieren */
  }
}

init().catch((err) => {
  el.statusText.textContent = 'Error: ' + err.message;
  el.status.hidden = false;
  console.error(err);
});

async function init() {
  registerServiceWorker();
  const manifest = await loadManifest();
  state.manifest = manifest;
  el.status.hidden = true;

  state.themes = Object.entries(manifest.themes)
    .map(([id, info]) => ({ id, label: label(id), group: groupOf(id), count: info.n }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));

  el.topMeta.textContent = `${compact.format(manifest.puzzles)} Puzzles · ${Object.keys(manifest.themes).length} Themes`;
  el.solvNote.textContent = 'from the lichess database';
  renderThemes();
  buildPresets();

  // Zustand aus der Adresse übernehmen. Ein geteilter Link auf die Ergebnisliste
  // soll die Liste zeigen, ohne dass noch einmal geklickt werden muss.
  const parsed = readUrl();
  if (parsed.query) {
    applyQuery(parsed.query);
  } else {
    offerLastSearch();
    update();
  }
  if (parsed.view === 'results' && parsed.query) search({ push: false });
}

// ------------------------------------------------------ Theme-Auswahl

function renderThemes(filter = '') {
  // "mate in", "Matt in 2" und "mateIn2" sollen dasselbe finden.
  const needle = norm(filter);
  const frag = document.createDocumentFragment();
  let shown = 0;

  for (const group of GROUPS) {
    const inGroup = state.themes.filter(
      (t) => t.group === group.id && (!needle || norm(t.label).includes(needle) || norm(t.id).includes(needle)),
    );
    if (!inGroup.length) continue;

    const head = document.createElement('div');
    head.className = 'group-head';
    head.textContent = group.label;
    frag.append(head);

    for (const theme of inGroup) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.selected.has(theme.id) ? ' on' : '');
      b.dataset.theme = theme.id;
      b.setAttribute('aria-pressed', state.selected.has(theme.id) ? 'true' : 'false');
      const name = document.createElement('span');
      name.textContent = theme.label;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = compact.format(theme.count);
      b.append(name, n);
      b.onclick = () => {
        if (state.selected.has(theme.id)) state.selected.delete(theme.id);
        else state.selected.add(theme.id);
        renderThemes(el.themeSearch.value);
        update();
      };
      frag.append(b);
      shown++;
    }
  }

  if (!shown) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nothing found.';
    frag.append(p);
  }

  el.themeList.replaceChildren(frag);
}

el.themeSearch.addEventListener('input', () => renderThemes(el.themeSearch.value));
el.clearThemes.onclick = () => {
  state.selected.clear();
  renderThemes(el.themeSearch.value);
  update();
};

function segmented(node, key, onPick) {
  node.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      setSegment(node, b.dataset.v);
      state[key] = b.dataset.v;
      onPick?.();
      update();
    };
  });
}

/** Markiert den passenden Knopf - auch wenn der Zustand aus der Adresse kam. */
function setSegment(node, value) {
  node.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === value));
}

segmented(el.modeSeg, 'mode', updateModeCard);
segmented(el.orderSeg, 'order', () => {
  el.rangeBox.hidden = state.order !== 'range';
});

/** Schwelle "mindestens so oft gespielt". */
function setMinSolv(n) {
  state.minSolv = n;
  el.solvSeg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.s) === n);
  });
  update();
}

el.solvSeg.querySelectorAll('button').forEach((b) => {
  b.onclick = () => setMinSolv(Number(b.dataset.s));
});

function buildPresets() {
  const ranges = [
    [0, 800],
    [800, 1200],
    [1200, 1600],
    [1600, 2000],
    [2000, 9999],
  ];
  el.rangePresets.replaceChildren(
    ...ranges.map(([a, b]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b > 9000 ? `${a}+` : `${a}–${b}`;
      btn.onclick = () => {
        el.minRating.value = a;
        el.maxRating.value = b > 9000 ? 4000 : b;
        update();
      };
      return btn;
    }),
  );

  el.countPresets.replaceChildren(
    ...[25, 50, 100, 250, 500].map((n) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(n);
      btn.onclick = () => {
        el.count.value = n;
        update();
      };
      return btn;
    }),
  );
}

for (const node of [el.minRating, el.maxRating, el.count]) {
  node.addEventListener('change', update);
  node.addEventListener('input', update);
}
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search();
});

function updateModeCard() {
  const many = state.selected.size > 1;
  el.modeCard.hidden = !many;
  if (!many) return;

  if (state.mode === 'OR') {
    el.modeHint.textContent =
      'A puzzle counts if it has at least one of the selected themes.';
    return;
  }
  el.modeHint.textContent = 'A puzzle counts only if it has all of the selected themes.';
  el.modeHint.append(' ' + impossibleHint());
}

/**
 * 532 von 2628 Theme-Paaren kommen in der Datenbank nie gemeinsam vor. Solche
 * Kombinationen liefern immer 0 Treffer - das steht schon im Manifest und muss
 * nicht erst durch Datenladen herausgefunden werden.
 */
function impossibleHint() {
  const pair = impossiblePair();
  if (!pair) return '';
  return `Note: ${label(pair[0])} and ${label(pair[1])} never occur together in the 6.1 million puzzles - an AND search finds nothing. OR works.`;
}

/** Das erste ausgewählte Paar, das nie gemeinsam vorkommt (oder null). */
function impossiblePair() {
  const list = [...state.selected];
  if (list.length < 2 || !state.manifest) return null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (isImpossiblePair(state.manifest, list[i], list[j])) return [list[i], list[j]];
    }
  }
  return null;
}

function update() {
  const count = state.selected.size;
  el.themeCount.textContent = count ? `${count} selected` : 'nothing selected';
  el.selInfo.textContent = count ? '' : 'Pick at least one theme';
  updateModeCard();

  const query = buildQuery();
  el.searchBtn.disabled = !(count > 0 && query.count > 0 && query.min <= query.max);

  if (state.order === 'range' && query.min > query.max) {
    el.estimate.textContent = 'Min must not be greater than max';
  } else if (count && state.manifest) {
    if (query.mode === 'AND' && impossiblePair()) {
      el.estimate.textContent = 'This AND combination does not exist in the data - 0 results';
      el.estimate.classList.add('warn');
      return;
    }
    el.estimate.classList.remove('warn');
    if (query.order === 'solved') {
      el.estimate.textContent =
        `"Most solved" reads all buckets of the selected themes - ` +
        `about ${fmtBytes(estimateAll(state.manifest, query))}.` +
        (state.minSolv ? ' The "times solved" filter applies while reading.' : '');
    } else if (query.mode === 'AND' && count > 1) {
      // UND liest von oben her und hört auf, sobald genug Treffer da sind.
      // Wie viel das wirklich wird, hängt von der Kombination ab - deshalb
      // die Obergrenze nennen statt eine Zahl zu behaupten, die nicht stimmt.
      const max = estimateAll(state.manifest, query);
      const min = estimateBytes(state.manifest, query);
      el.estimate.textContent =
        `AND stops at ${query.count} results: at least ${fmtBytes(min)}, at most ${fmtBytes(max)}` +
        (state.minSolv ? ` · solved ${state.minSolv.toLocaleString('en-US')}+` : '');
    } else {
      el.estimate.textContent =
        `Data for this search: about ${fmtBytes(estimateAll(state.manifest, query))}` +
        (state.minSolv ? ` · solved ${state.minSolv.toLocaleString('en-US')}+` : '');
    }
  } else {
    el.estimate.textContent = '';
  }

  // Jede Änderung sofort in der Adresse festhalten. replaceState statt
  // pushState: die Auswahl ist kein Schritt in der Historie, nur die Suche.
  writeUrl(false);
}

/**
 * Spielzahl in Kurzform. Der Index speichert sie logarithmisch in einem Byte,
 * der Fehler betraegt hoechstens 4,4 Prozent - deshalb das "~" und keine
 * vierstellige Genauigkeit, die nicht da ist.
 */
// Zwei signifikante Stellen, nicht vier: der Index speichert die Spielzahl
// logarithmisch in einem Byte. Mehr Nachkommastellen wuerden Genauigkeit
// vortaeuschen, die nicht da ist - und vier gleiche Werte in Folge (223.4K)
// sehen nach einem Fehler aus statt nach einer Naeherung.
const solvFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumSignificantDigits: 2,
});
function fmtSolv(code) {
  const n = decodeSolv(code);
  if (n <= 0) return '–';
  return '~' + (n < 1000 ? String(n) : solvFmt.format(n));
}

function fmtBytes(n) {
  if (n < 1024) return n + ' Bytes';
  if (n < 1048576) return Math.round(n / 1024) + ' kB';
  return (n / 1048576).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' MB';
}

/** Für die Themesuche: nur Buchstaben und Zahlen, kleingeschrieben. */
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildQuery() {
  let min = 0;
  let max = 9999;
  if (state.order === 'range') {
    min = clampInt(el.minRating.value, 0, 4000, 0);
    max = clampInt(el.maxRating.value, 0, 9999, 9999);
  }
  return {
    themes: [...state.selected],
    mode: state.selected.size > 1 ? state.mode : 'OR',
    order: state.order,
    min,
    max,
    count: clampInt(el.count.value, 1, 5000, 100),
    minSolv: state.minSolv,
  };
}

function clampInt(value, lo, hi, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

// ---------------------------------------------------------------- Suche

/**
 * Wie viele Bytes wirklich über die Leitung gingen.
 *
 * Der Zähler in der Datenschicht zählt die entpackten Bytes - die sind gut vier
 * Mal so groß und würden die Ladezeit schönrechnen. Die Resource-Timing-API
 * kennt die echte Übertragungsgröße je Anfrage (inklusive Cache-Treffer, die 0
 * zählen), deshalb wird für die Anzeige sie verwendet.
 */
let transferMark = 0;

function markTransfers() {
  performance.clearResourceTimings();
  transferMark = performance.now();
}

function sumTransfers() {
  let sum = 0;
  for (const e of performance.getEntriesByType('resource')) {
    if (e.startTime < transferMark) continue;
    if (!e.name.includes('/data/')) continue;
    sum += e.transferSize || e.encodedBodySize || 0;
  }
  return sum;
}

el.searchBtn.onclick = search;

/** @param push  false beim Aufruf aus einer geteilten Adresse: da darf die
 *  Suche keinen zusätzlichen Historieneintrag anlegen. */
async function search({ push = true } = {}) {
  const query = buildQuery();
  if (!query.themes.length) return;

  const controller = new AbortController();
  el.loading.hidden = false;
  el.loadBar.style.width = '0%';
  el.loadingText.textContent = 'Loading data …';
  el.loadCancel.onclick = () => controller.abort();

  const t0 = performance.now();
  markTransfers();
  try {
    const { items, bytes, wire, cancelled, impossible } = await runQuery(state.manifest, query, {
      signal: controller.signal,
      onBytes: (b) => {
        const target = Math.max(estimateRaw(state.manifest, query), 1);
        el.loadBar.style.width = `${Math.min(100, (b / target) * 100)}%`;
        el.loadingText.textContent = `${fmtBytes(b)} decompressed …`;
      },
    });

    if (cancelled) {
      toast('Search cancelled');
      return;
    }

    if (impossible) {
      el.loading.hidden = true;
      const pair = impossiblePair();
      toast(
        pair
          ? `${label(pair[0])} and ${label(pair[1])} never occur together - 0 results`
          : 'This AND combination returns 0 results',
      );
      return;
    }

    el.loadingText.textContent = 'Building the list …';
    state.results = items;
    saveLastSearch(query, items);
    renderResults();
    show('results', { push });
    const ms = Math.round(performance.now() - t0);
    // sumTransfers() ist exakt, aber nicht überall verfügbar (z. B. wenn die
    // Zeitmessung des Browsers keine Größen kennt) - dann content-length.
    const over = sumTransfers() || wire;
    toast(
      `${items.length} puzzles in ${ms} ms · ${fmtBytes(over)} transferred` +
        (bytes > over * 2 ? ` (${fmtBytes(bytes)} decompressed)` : ''),
    );
  } catch (err) {
    console.error(err);
    toast('Search failed: ' + err.message);
  } finally {
    el.loading.hidden = true;
  }
}

// ------------------------------------------------------------- Ergebnis

const puzzleUrl = (id) => `https://lichess.org/training/${id}`;

function describeQuery(query) {
  const names = query.themes.map((t) => label(t)).join(query.mode === 'AND' ? ' ∩ ' : ' ∪ ');
  const order =
    query.order === 'hardest'
      ? 'hardest first'
      : query.order === 'easiest'
        ? 'easiest first'
        : query.order === 'solved'
          ? 'most solved first'
          : `Rating ${query.min}–${query.max}`;
  const filter = query.minSolv ? `, solved ${query.minSolv.toLocaleString('en-US')}+` : '';
  return { names, order: order + filter };
}

function renderResults() {
  const query = lastQuery;
  const items = state.results;
  const { names, order } = describeQuery(query);
  const avg = items.length ? Math.round(items.reduce((s, x) => s + x.rating, 0) / items.length) : 0;

  el.resultInfo.innerHTML = items.length
    ? `<b>${nf.format(items.length)}</b> puzzles · ${order}<br><span class="muted">${escapeHtml(names)}</span>` +
      (items.length > 20 ? `<br><span class="muted">Average rating ${avg}</span>` : '')
    : '<b>No results.</b><br><span class="muted">Widen the rating range or the theme combination.</span>';

  el.snapshotNote.textContent = `Ratings are from the database snapshot of ${state.manifest.generated}; lichess re-rates puzzles continuously.`;

  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const li = document.createElement('li');
    if (ticked.has(item.id)) li.classList.add('done');
    // Abhaken als eigener Knopf: die Zeile selbst ist der Link zu lichess und
    // soll nicht beim Abhaken verschluckt werden.
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'tick';
    tick.setAttribute('aria-pressed', ticked.has(item.id) ? 'true' : 'false');
    tick.setAttribute('aria-label', `Mark puzzle ${item.id} as done`);
    tick.textContent = ticked.has(item.id) ? '✓' : '';
    tick.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTicked(item.id);
      renderResults();
    };

    const a = document.createElement('a');
    a.className = 'item';
    a.href = puzzleUrl(item.id);
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML =
      `<span class="pos">${i + 1}</span>` +
      `<span class="rating">${item.rating}</span>` +
      `<span class="id">${item.id}</span>` +
      `<span class="solv" title="Times solved in the lichess database. The value is ` +
        `approximate: the index stores it logarithmically in one byte.">${fmtSolv(item.solv || 0)}</span>`;
    a.setAttribute('aria-label', `Open puzzle ${item.id} with rating ${item.rating} on lichess`);
    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.textContent = '↗';
    li.append(tick, a, flag);
    if (!(state.hideTicked && ticked.has(item.id))) frag.append(li);
  });
  el.resultList.replaceChildren(frag);

  // Abhak-Leiste
  const anzahl = tickedInResults();
  el.tickedBar.hidden = items.length === 0;
  el.tickedCount.textContent = anzahl
    ? `${anzahl} of ${items.length} ticked as done`
    : `${items.length} puzzles · tick them off as you play`;

  el.copyUnticked.disabled = items.length === 0 || tickedInResults() === 0;
  el.playFirst.disabled = items.length === 0;
  el.playFirst.textContent = `▶ Open on lichess (${items.length})`;
  el.copyIds.disabled = items.length === 0;
}

el.playFirst.onclick = () => state.results.length && window.open(puzzleUrl(state.results[0].id), '_blank', 'noopener');

/** Kopiert in die Zwischenablage, mit Rückfall für Browser ohne API. */
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(message);
}

el.copyIds.onclick = () =>
  copyText(
    state.results.map((x) => x.id).join('\n'),
    `Copied ${state.results.length} IDs`,
  );

el.copyLink.onclick = () => copyText(location.href, 'Link copied');

// ------------------------------------------------- Puzzles abhaken

/**
 * Welche Puzzles sind erledigt? Ein Satz von Puzzle-IDs im localStorage -
 * global, nicht pro Liste: wenn ein Puzzle einmal gelöst ist, ist es das auch
 * in einer anderen Liste. Gekappt, damit der Speicher nicht unbegrenzt wächst.
 */
const TICKED = 'lpf.ticked.v1';
const TICKED_MAX = 5000;
let ticked = loadTicked();

function loadTicked() {
  try {
    const raw = JSON.parse(localStorage.getItem(TICKED) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveTicked() {
  try {
    const list = [...ticked];
    localStorage.setItem(TICKED, JSON.stringify(list.slice(-TICKED_MAX)));
  } catch {
    /* egal - das Abhaken funktioniert auch ohne Speicherzugriff */
  }
}

function toggleTicked(id) {
  if (ticked.has(id)) ticked.delete(id);
  else ticked.add(id);
  saveTicked();
}

/** Anzahl der abgehakten Puzzles in der aktuellen Liste. */
function tickedInResults() {
  return state.results.reduce((n, item) => n + (ticked.has(item.id) ? 1 : 0), 0);
}

el.hideTicked.onclick = () => {
  state.hideTicked = !state.hideTicked;
  el.hideTicked.classList.toggle('on', state.hideTicked);
  el.hideTicked.textContent = state.hideTicked ? 'Show all' : 'Hide ticked';
  renderResults();
};

el.clearTicked.onclick = () => {
  ticked.clear();
  saveTicked();
  renderResults();
};

el.copyUnticked.onclick = () => {
  const offen = state.results.filter((x) => !ticked.has(x.id));
  copyText(
    offen.map((x) => x.id).join('\n'),
    `Copied ${offen.length} unsolved IDs`,
  );
};

// ------------------------------------------------- Letzte Suche merken

let lastQuery = { themes: [], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 100 };

function saveLastSearch(query, items) {
  lastQuery = query;
  try {
    localStorage.setItem(STORE, JSON.stringify({ query, items: items.slice(0, 500), at: Date.now() }));
  } catch {
    /* egal - die Suche läuft auch ohne Speicherzugriff */
  }
}

function offerLastSearch() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return;
  }
  if (!data?.items?.length) return;

  const { names, order } = describeQuery(data.query);
  el.resume.hidden = false;
  el.resumeTitle.textContent = `Last search: ${nf.format(data.items.length)} puzzles`;
  el.resumeInfo.textContent = `${names} · ${order}`;
  el.resumeBtn.textContent = 'Open list';
  el.resumeBtn.onclick = () => {
    state.results = data.items;
    lastQuery = data.query;
    el.resume.hidden = true;
    renderResults();
    show('results');
  };
  el.resumeDrop.onclick = () => {
    localStorage.removeItem(STORE);
    el.resume.hidden = true;
  };
}

// -------------------------------------------------------------- Helfer

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
