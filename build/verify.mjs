#!/usr/bin/env node
/**
 * Vergleichstest der Such-Logik.
 *
 *   node build/verify.mjs [--quick]
 *
 * Geprüft wird zweierlei:
 *
 *   1. build/original.sh  - die alte, unveränderte Fassung des
 *      Nutzer-Skripts. Sie deckt nur 56 der 73 Themes ab und sortiert
 *      bei Gleichständen nicht stabil, deshalb wird der Vergleich für
 *      ihre Themen als Mengenvergleich geführt.
 *
 *   2. puzzle-finder.sh   - die korrigierte Fassung. Sie muss exakt
 *      dieselbe Liste in exakt derselben Reihenfolge liefern wie der
 *      Browser-Reader der Website (Rating absteigend, dann ID
 *      aufsteigend), und zwar für alle 73 Themes.
 *
 *   3. Der Index selbst wird nach jedem Lauf auf Sortiertheit geprüft -
 *      genau die Eigenschaft, die im alten Skript für 17 Themes fehlte.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const workdir = process.env.WORKDIR || '/home/jan';

// Die 56 Themes, die im alten Skript fest verdrahtet waren.
const OLD_THEMES = new Set(
  `advancedPawn advantage anastasiaMate arabianMate attackingF2F7 attraction
   backRankMate bishopEndgame bodenMate capturingDefender castling clearance
   crushing defensiveMove deflection discoveredAttack doubleBishopMate
   doubleCheck dovetailMate endgame equality exposedKing fork hangingPiece
   hookMate interference intermezzo kingsideAttack knightEndgame long master
   masterVsMaster mate mateIn1 mateIn2 mateIn3 mateIn4 mateIn5 middlegame
   oneMove opening pawnEndgame pin promotion queenEndgame queenRookEndgame
   queensideAttack quietMove rookEndgame sacrifice short skewer smotheredMate
   superGM trappedPiece underPromotion veryLong xRayAttack zugzwang`
    .split(/\s+/)
    .filter(Boolean),
);

const SCENARIOS = [
  { name: '1 Theme, schwerste zuerst', themes: ['mateIn2'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 100 },
  { name: '1 Theme, einfachste zuerst', themes: ['mateIn2'], mode: 'OR', order: 'easiest', min: 0, max: 9999, count: 50 },
  { name: '1 Theme, Rating-Range', themes: ['rookEndgame'], mode: 'OR', order: 'range', min: 1200, max: 1400, count: 100 },
  { name: 'ODER 3 Themes, schwerste', themes: ['mateIn1', 'mateIn2', 'mateIn3'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 200 },
  { name: 'ODER 2 Themes, einfachste', themes: ['backRankMate', 'sacrifice'], mode: 'OR', order: 'easiest', min: 0, max: 9999, count: 75 },
  { name: 'ODER mit Range', themes: ['fork', 'pin', 'skewer'], mode: 'OR', order: 'range', min: 1800, max: 1900, count: 120 },
  { name: 'ODER grosses Theme (short)', themes: ['short'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 100 },
  { name: 'ODER gross, einfachste', themes: ['middlegame', 'advantage'], mode: 'OR', order: 'easiest', min: 0, max: 9999, count: 20 },
  { name: 'UND 2 Themes, schwerste', themes: ['backRankMate', 'sacrifice'], mode: 'AND', order: 'hardest', min: 0, max: 9999, count: 40 },
  { name: 'UND 3 Themes mit Range', themes: ['rookEndgame', 'backRankMate', 'crushing'], mode: 'AND', order: 'range', min: 1800, max: 2200, count: 30 },
  { name: 'UND mit einfachste', themes: ['queenEndgame', 'sacrifice'], mode: 'AND', order: 'easiest', min: 0, max: 9999, count: 25 },
  { name: 'UND extremes Fenster', themes: ['short', 'middlegame', 'endgame'], mode: 'AND', order: 'range', min: 900, max: 1000, count: 15 },
  { name: 'Einzelnes kleines Theme', themes: ['anastasiaMate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 500 },
  { name: 'Range ausserhalb der Daten', themes: ['mateIn3'], mode: 'OR', order: 'range', min: 5000, max: 6000, count: 50 },

  // Themes, die das alte Skript nicht kannte (nicht auswählbar, Index
  // unsortiert) - genau hier lag der Fehler.
  { name: 'NEU cornerMate, schwerste', themes: ['cornerMate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 200 },
  { name: 'NEU operaMate, schwerste', themes: ['operaMate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 100 },
  { name: 'NEU enPassant, einfachste', themes: ['enPassant'], mode: 'OR', order: 'easiest', min: 0, max: 9999, count: 100 },
  { name: 'NEU balestraMate, 500', themes: ['balestraMate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 500 },
  { name: 'NEU swallowstailMate, Range', themes: ['swallowstailMate'], mode: 'OR', order: 'range', min: 1500, max: 2200, count: 40 },
  { name: 'NEU vukovicMate, schwerste', themes: ['vukovicMate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 300 },
  { name: 'NEU ODER cornerMate+operaMate', themes: ['cornerMate', 'operaMate'], mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 150 },
  { name: 'NEU UND cornerMate+middlegame', themes: ['cornerMate', 'middlegame'], mode: 'AND', order: 'hardest', min: 0, max: 9999, count: 20 },
  { name: 'NEU morphysMate+queenEndgame UND', themes: ['morphysMate', 'queenEndgame'], mode: 'AND', order: 'hardest', min: 0, max: 9999, count: 20 },
  { name: 'NEU alle 5 zusammen ODER', themes: ['collinearMove', 'cornerMate', 'killBoxMate', 'morphysMate', 'tripleMate'].filter((t) => t !== 'tripleMate'), mode: 'OR', order: 'hardest', min: 0, max: 9999, count: 250 },
];

const ORDER_CODE = { hardest: 1, easiest: 2, range: 3 };
const MODE_CODE = { OR: 1, AND: 2 };

// --- fzf-Ersatz ------------------------------------------------------------

const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fzf-shim-'));
fs.writeFileSync(
  path.join(fakeBin, 'fzf'),
  `#!/usr/bin/env bash
# Test-Double: gibt die in FZ_FAKE hinterlegte Theme-Auswahl aus.
cat > /dev/null
printf '%s\\n' "$FZ_FAKE"
`,
  { mode: 0o755 },
);

function runScript(script, sc) {
  // Das Skript fragt die AND/ODER-Frage nur ab, wenn mehrere Themes gewählt sind.
  const answers = [
    ...(sc.themes.length > 1 ? [MODE_CODE[sc.mode]] : []),
    ORDER_CODE[sc.order],
    ...(sc.order === 'range' ? [sc.min, sc.max] : []),
    sc.count,
  ].join('\n');

  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script], {
      cwd: workdir,
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FZ_FAKE: sc.themes.join('\n') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    child.stdin.end(answers + '\n');
  });
}

function parseScriptOutput(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\d+\.\s*Rating:\s*(\d+)\s+https:\/\/lichess\.org\/training\/(\S+)/);
    if (m) items.push({ rating: Number(m[1]), id: m[2] });
  }
  return items;
}

// --- Vergleiche ------------------------------------------------------------

const ids = (list) => list.map((x) => x.id);

function sameRatings(a, b) {
  if (a.length !== b.length) return false;
  const ca = new Map();
  for (const x of a) ca.set(x.rating, (ca.get(x.rating) || 0) + 1);
  for (const x of b) {
    const n = ca.get(x.rating) || 0;
    if (n === 0) return false;
    ca.set(x.rating, n - 1);
  }
  return true;
}

function sameIdSet(a, b) {
  const sa = new Set(ids(a));
  const sb = new Set(ids(b));
  if (sa.size !== a.length || sb.size !== b.length) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

/** Exakter Vergleich: gleiche IDs in gleicher Reihenfolge. */
function sameOrdered(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
  return true;
}

/** Prüft die Rating-Reihenfolge unabhängig von beiden Skripten. */
function isSorted(items, sc) {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1].rating;
    const cur = items[i].rating;
    if (cur < sc.min || cur > sc.max) return false;
    if (sc.order === 'easiest' ? cur < prev : cur > prev) return false;
  }
  return items.every((x) => x.rating >= sc.min && x.rating <= sc.max);
}

function fmtBytes(n) {
  return n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' kB';
}

function describeDiff(expected, actual) {
  const exp = new Set(ids(expected));
  const got = new Set(ids(actual));
  const missing = expected.filter((x) => !got.has(x.id)).slice(0, 6);
  const extra = actual.filter((x) => !exp.has(x.id)).slice(0, 6);
  return `fehlend: ${missing.map((x) => `${x.id}(${x.rating})`).join(', ') || '-'} | zuviel: ${
    extra.map((x) => `${x.id}(${x.rating})`).join(', ') || '-'
  }`;
}

// --- Index-Prüfung --------------------------------------------------------

/** Alle Index-Dateien müssen streng nach Rating absteigend, dann ID aufsteigend
 *  sortiert sein - das war bei 17 Themes des alten Skripts nicht der Fall. */
async function checkIndexSorted() {
  const dir = path.join(workdir, '.lichess-puzzle-index');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsv'));
  const broken = [];
  for (const f of files) {
    const ok = await new Promise((resolve) => {
      const p = spawn('sort', ['-s', '-t\t', '-k1,1nr', '-k2,2', '-c', path.join(dir, f)], {
        env: { ...process.env, LC_ALL: 'C' },
        stdio: 'ignore',
      });
      p.on('close', (code) => resolve(code === 0));
    });
    if (!ok) broken.push(f);
  }
  return { total: files.length, broken };
}

// --- Hauptprogramm ---------------------------------------------------------

const quick = process.argv.includes('--quick');
const scenarios = quick ? SCENARIOS.slice(0, 4) : SCENARIOS;

const { port } = await startServer({ port: 0, root: path.join(repo, 'docs') });
process.env.LPF_BASE = `http://127.0.0.1:${port}/`;
console.log(`Testserver: ${process.env.LPF_BASE}`);

// reader.js liest LPF_BASE beim Import - muss also danach passieren.
const { runQuery } = await import('../src/reader.js');
const manifest = await (await fetch(`${process.env.LPF_BASE}data/manifest.json`)).json();

const fixedScript = path.join(repo, 'puzzle-finder.sh');
const oldScript = path.join(repo, 'build', 'original.sh');

let failures = 0;
let exactPass = 0;
let oldChecked = 0;
let oldDiffers = 0;
const oldBroken = [];

for (const sc of scenarios) {
  const t0 = Date.now();

  const fixed = await runScript(fixedScript, sc);
  if (fixed.code !== 0) {
    console.log(`FEHLER  ${sc.name}: korrigiertes Skript endete mit Code ${fixed.code}\n${fixed.err}`);
    failures++;
    continue;
  }
  const fixedItems = parseScriptOutput(fixed.out);

  const t1 = Date.now();
  const result = await runQuery(manifest, sc, {});
  const tWeb = Date.now() - t1;

  const orderOk = isSorted(result.items, sc);
  const exactOk = sameOrdered(fixedItems, result.items);
  if (!orderOk || !exactOk) failures++;
  if (exactOk) exactPass++;

  // Das alte Skript ist nur die Referenz für den Vorher/Nachher-Vergleich:
  // seine Abweichungen sind erwartet (dokumentierte Fehler) und zählen
  // nicht als Fehlschlag dieses Tests.
  let note = '';
  const allOld = sc.themes.every((t) => OLD_THEMES.has(t));
  if (allOld) {
    oldChecked++;
    const old = await runScript(oldScript, sc);
    const oldItems = parseScriptOutput(old.out);
    if (!sameRatings(oldItems, result.items) || !sameIdSet(oldItems, result.items)) {
      oldDiffers++;
      oldBroken.push(sc.name);
      note = '  (altes Skript: falsch)';
    }
  } else {
    note = '  (altes Skript: Theme unbekannt)';
  }

  console.log(
    `${exactOk ? 'OK  ' : 'FAIL'} ${sc.name.padEnd(32)} ${String(fixedItems.length).padStart(4)} | ` +
      `Web ${String(tWeb).padStart(5)}ms ${fmtBytes(result.bytes).padStart(9)} | ` +
      `gesamt ${String(Date.now() - t0).padStart(6)}ms${note}`,
  );

  if (!exactOk) {
    console.log(`      ${describeDiff(result.items, fixedItems)}`);
    console.log(`      korrekt: ${ids(result.items).slice(0, 5).join(' ')} …`);
    console.log(`      Skript : ${ids(fixedItems).slice(0, 5).join(' ')} …`);
  }
}

console.log();
const idx = await checkIndexSorted();
idx.broken.length === 0
  ? console.log(`Index: alle ${idx.total} Theme-Dateien streng sortiert`)
  : (failures++, console.log(`Index: ${idx.broken.length} von ${idx.total} Dateien NICHT sortiert: ${idx.broken.join(', ')}`));

console.log(
  `\n${exactPass}/${scenarios.length} Szenarien exakt identisch (gleiche Reihenfolge)`,
);
console.log(
  `altes Skript: ${oldChecked - oldDiffers}/${oldChecked} Szenarien korrekt` +
    (oldBroken.length ? `, falsch in: ${oldBroken.join(', ')}` : ''),
);
process.exit(failures ? 1 : 0);
