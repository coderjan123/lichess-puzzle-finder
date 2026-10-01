/**
 * App: Theme-Auswahl, Suche, Ergebnisliste.
 *
 * Der komplette Index liegt statisch in docs/data/ und wird nur in den
 * benötigten Teilen geladen (siehe reader.js). Gespielt wird auf lichess.org -
 * die Seite selbst enthält kein Brett, keine Logik und braucht zur Laufzeit
 * keine API, kein Konto und kein Internet.
 */

import { GROUPS, label, groupOf } from './themes.js';
import { loadManifest, runQuery, estimateBytes, isImpossiblePair, estimateAll, estimateRaw } from './reader.js';

const $ = (id) => document.getElementById(id);
const STORE = 'lpf.lastSearch.v1';
const nf = new Intl.NumberFormat('de-DE');
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });

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
  results: [],
  abort: null,
};

// ---------------------------------------------------------------- Router

const views = { home: $('viewHome'), results: $('viewResults') };
let current = 'home';

function show(name, push = true) {
  current = name;
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  el.back.hidden = name === 'home';
  el.title.textContent = name === 'home' ? 'Lichess Puzzle Finder' : 'Ergebnis';
  if (push) history.pushState({ view: name }, '', '#' + name);
  window.scrollTo(0, 0);
}

el.back.onclick = () => history.back();
window.addEventListener('popstate', (e) => {
  const name = e.state?.view || 'home';
  if (name === current) return;
  current = name;
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
  el.back.hidden = name === 'home';
  el.title.textContent = name === 'home' ? 'Lichess Puzzle Finder' : 'Ergebnis';
});

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
  el.statusText.textContent = 'Fehler: ' + err.message;
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
  renderThemes();
  buildPresets();
  offerLastSearch();
  update();
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
    p.textContent = 'Nichts gefunden.';
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
      node.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      state[key] = b.dataset.v;
      onPick?.();
      update();
    };
  });
}

segmented(el.modeSeg, 'mode', updateModeCard);
segmented(el.orderSeg, 'order', () => {
  el.rangeBox.hidden = state.order !== 'range';
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
      'Ein Puzzle zählt, wenn es mindestens eines der gewählten Themes hat.';
    return;
  }
  el.modeHint.textContent = 'Ein Puzzle zählt nur, wenn es alle gewählten Themes hat.';
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
  return `Achtung: ${label(pair[0])} und ${label(pair[1])} kommen in den 6,1 Mio. Puzzles nie gleichzeitig vor – eine UND-Suche liefert dort nichts. Mit ODER geht es.`;
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
  el.themeCount.textContent = count ? `${count} gewählt` : 'keine Auswahl';
  el.selInfo.textContent = count ? '' : 'Mindestens ein Theme wählen';
  updateModeCard();

  const query = buildQuery();
  el.searchBtn.disabled = !(count > 0 && query.count > 0 && query.min <= query.max);

  if (state.order === 'range' && query.min > query.max) {
    el.estimate.textContent = 'Min darf nicht größer als Max sein';
  } else if (count && state.manifest) {
    if (query.mode === 'AND' && impossiblePair()) {
      el.estimate.textContent = 'Diese UND-Kombination gibt es in den Daten nicht – 0 Treffer';
      el.estimate.classList.add('warn');
      return;
    }
    el.estimate.classList.remove('warn');
    if (query.mode === 'AND' && count > 1) {
      // UND liest von oben her und hört auf, sobald genug Treffer da sind.
      // Wie viel das wirklich wird, hängt von der Kombination ab - deshalb
      // die Obergrenze nennen statt eine Zahl zu behaupten, die nicht stimmt.
      const max = estimateAll(state.manifest, query);
      const min = estimateBytes(state.manifest, query);
      el.estimate.textContent =
        `UND liest beide Themes von oben her und stoppt bei ${query.count} Treffern: ` +
        `mindestens ${fmtBytes(min)}, höchstens ${fmtBytes(max)}.`;
    } else {
      el.estimate.textContent = `Daten für diese Suche: rund ${fmtBytes(estimateAll(state.manifest, query))}`;
    }
  } else {
    el.estimate.textContent = '';
  }
}

function fmtBytes(n) {
  if (n < 1024) return n + ' Bytes';
  if (n < 1048576) return Math.round(n / 1024) + ' kB';
  return (n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
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

async function search() {
  const query = buildQuery();
  if (!query.themes.length) return;

  const controller = new AbortController();
  el.loading.hidden = false;
  el.loadBar.style.width = '0%';
  el.loadingText.textContent = 'Daten werden geladen …';
  el.loadCancel.onclick = () => controller.abort();

  const t0 = performance.now();
  markTransfers();
  try {
    const { items, bytes, wire, cancelled, impossible } = await runQuery(state.manifest, query, {
      signal: controller.signal,
      onBytes: (b) => {
        const target = Math.max(estimateRaw(state.manifest, query), 1);
        el.loadBar.style.width = `${Math.min(100, (b / target) * 100)}%`;
        el.loadingText.textContent = `${fmtBytes(b)} entpackt …`;
      },
    });

    if (cancelled) {
      toast('Suche abgebrochen');
      return;
    }

    if (impossible) {
      el.loading.hidden = true;
      const pair = impossiblePair();
      toast(
        pair
          ? `${label(pair[0])} und ${label(pair[1])} kommen nie gemeinsam vor – 0 Treffer`
          : 'Diese UND-Kombination liefert 0 Treffer',
      );
      return;
    }

    el.loadingText.textContent = 'Ergebnis wird aufgebaut …';
    state.results = items;
    saveLastSearch(query, items);
    renderResults();
    show('results');
    const ms = Math.round(performance.now() - t0);
    // sumTransfers() ist exakt, aber nicht überall verfügbar (z. B. wenn die
    // Zeitmessung des Browsers keine Größen kennt) - dann content-length.
    const over = sumTransfers() || wire;
    toast(
      `${items.length} Puzzles in ${ms} ms · ${fmtBytes(over)} übertragen` +
        (bytes > over * 2 ? ` (${fmtBytes(bytes)} entpackt)` : ''),
    );
  } catch (err) {
    console.error(err);
    toast('Fehler bei der Suche: ' + err.message);
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
      ? 'schwerste zuerst'
      : query.order === 'easiest'
        ? 'einfachste zuerst'
        : `Rating ${query.min}–${query.max}`;
  return { names, order };
}

function renderResults() {
  const query = lastQuery;
  const items = state.results;
  const { names, order } = describeQuery(query);
  const avg = items.length ? Math.round(items.reduce((s, x) => s + x.rating, 0) / items.length) : 0;

  el.resultInfo.innerHTML = items.length
    ? `<b>${nf.format(items.length)}</b> Puzzles · ${order}<br><span class="muted">${escapeHtml(names)}</span>` +
      (items.length > 20 ? `<br><span class="muted">Ø Rating ${avg}</span>` : '')
    : '<b>Keine Treffer.</b><br><span class="muted">Ratingfenster oder Theme-Kombination erweitern.</span>';

  el.snapshotNote.textContent = `Ratings laut Datenbank-Stand ${state.manifest.generated}; lichess berechnet sie laufend neu.`;

  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'item';
    a.href = puzzleUrl(item.id);
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML =
      `<span class="pos">${i + 1}</span>` +
      `<span class="rating">${item.rating}</span>` +
      `<span class="id">${item.id}</span>`;
    a.setAttribute('aria-label', `Puzzle ${item.id} mit Rating ${item.rating} auf lichess öffnen`);
    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.textContent = '↗';
    li.append(a, flag);
    frag.append(li);
  });
  el.resultList.replaceChildren(frag);

  el.playFirst.disabled = items.length === 0;
  el.playFirst.textContent = `▶ Auf lichess öffnen (${items.length})`;
  el.copyIds.disabled = items.length === 0;
}

el.playFirst.onclick = () => state.results.length && window.open(puzzleUrl(state.results[0].id), '_blank', 'noopener');

el.copyIds.onclick = async () => {
  const text = state.results.map((x) => x.id).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(`${state.results.length} IDs kopiert`);
  } catch {
    // Fallback für Browser ohne Clipboard-API
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(`${state.results.length} IDs kopiert`);
  }
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
  el.resumeTitle.textContent = `Letzte Suche: ${nf.format(data.items.length)} Puzzles`;
  el.resumeInfo.textContent = `${names} · ${order}`;
  el.resumeBtn.textContent = 'Liste öffnen';
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
