#!/usr/bin/env node
/**
 * Baut docs/ aus src/:
 *   - bündelt src/*.js (einzige Abhängigkeit: fflate als gzip-Rückfall)
 *   - bettet CSS, JS und den Index in EINEN HTML-File
 *   - kopiert den Service Worker und erzeugt ein Favicon
 *
 * Warum alles in eine Datei: auf einem alten Handy im schlechten WLAN zählt jeder
 * zusätzliche Request eine Wartezeit (typisch 200-500 ms). Aus fünf Requests
 * (HTML, CSS, manifest.json, app.js, favicon) wird so einer.
 *
 *   node build/bundle.mjs [--watch]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const src = path.join(root, 'src');
const docs = path.join(root, 'docs');
const watch = process.argv.includes('--watch');

fs.mkdirSync(docs, { recursive: true });

const options = {
  entryPoints: { puzzle: path.join(src, 'main.js'), brett: path.join(src, 'board.js') },
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari15', 'firefox100'],
  outdir: path.join(docs, '_app'),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'warning',
};

/** Verhindert, dass ein </script> im eingebetteten Code den HTML-Tag schließt. */
const safe = (code) => code.replace(/<\/script/gi, '<\\/script');

/** Manifest als globale Konstante in die Seite einbetten. */
function manifestScript() {
  const file = path.join(docs, 'data', 'manifest.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} fehlt. Erst bauen: python3 build/build_index.py ~/lichess_db_puzzle.csv docs/data`,
    );
  }
  const json = fs.readFileSync(file, 'utf8');
  // 25 kB JSON als Skript: der Server komprimiert die HTML ohnehin.
  return `<script>window.__LICHESS_MANIFEST__=${safe(json)};</script>`;
}

/**
 * Die zwoelf Figuren als EIN Sprite in die Seite legen.
 *
 * Warum inline und nicht als Datei: ein Request je Figurart waere auf einem
 * alten Handy im schlechten WLAN der Unterschied zwischen einer Seite, die
 * sofort da ist, und einer, die zappelt. Als <symbol> mit <use> kostet jede
 * Figur danach gar nichts mehr.
 *
 * Quelle: Cburnett-Satz, CC BY-SA 3.0, Colin Burnett. Die Namensangabe steht
 * in der Fusszeile der Seite.
 */
function spriteScript() {
  const ordner = path.join(src, 'piece');
  const namen = fs.readdirSync(ordner).filter((f) => f.endsWith('.svg')).sort();
  if (namen.length !== 12) {
    throw new Error(`src/piece: ${namen.length} Figuren gefunden, 12 erwartet`);
  }
  let raus = '';
  for (const datei of namen) {
    const id = path.basename(datei, '.svg');
    const inhalt = fs.readFileSync(path.join(ordner, datei), 'utf8');
    const innen = inhalt
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '');
    raus += `<symbol id="${id}" viewBox="0 0 45 45">${innen}</symbol>`;
  }
  return raus;
}

function writeIndex(js) {
  const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');

  const linkTag = '<link rel="stylesheet" href="style.css" />';
  const scriptTag = '<script src="app.js" type="module"></script>';
  if (!html.includes(linkTag) || !html.includes(scriptTag)) {
    throw new Error(
      'index.html: erwartete Marken fehlen.\n' +
        `  muss enthalten sein: ${linkTag}\n  und: ${scriptTag}`,
    );
  }

  let out = html.replace(linkTag, `<style>\n${css}\n</style>`);
  out = out.replace(
    scriptTag,
    `${manifestScript()}\n    <script type="module">\n${safe(js)}\n</script>`,
  );
  fs.writeFileSync(path.join(docs, 'index.html'), out);
  return out.length;
}

/**
 * Die Brettseite. Gleiches Prinzip wie die Hauptseite: eine Datei, kein
 * Manifest, keine Requests ausser dem Favicon.
 */
function writeBoard(js) {
  const html = fs.readFileSync(path.join(src, 'board.html'), 'utf8');
  const css = fs.readFileSync(path.join(src, 'board.css'), 'utf8');
  const linkTag = '<link rel="stylesheet" href="board.css" />';
  const scriptTag = '<script src="board.js" type="module"></script>';
  const spriteMarke = '<!--PIECES-->';
  for (const marke of [linkTag, scriptTag, spriteMarke]) {
    if (!html.includes(marke)) throw new Error(`board.html: Marke fehlt - ${marke}`);
  }
  let out = html.replace(linkTag, `<style>\n${css}\n</style>`);
  out = out.replace(spriteMarke, spriteScript());
  out = out.replace(scriptTag, `<script type="module">\n${safe(js)}\n</script>`);
  fs.writeFileSync(path.join(docs, 'board.html'), out);
  return out.length;
}

function copyStatic() {
  // Nur im Watch-Modus wird auf externe Dateien verwiesen (dann muss style.css
  // neben index.html liegen). Im normalen Build steckt alles in der HTML.
  if (watch) fs.copyFileSync(path.join(src, 'style.css'), path.join(docs, 'style.css'));
  fs.copyFileSync(path.join(src, 'sw.js'), path.join(docs, 'sw.js'));
  // Schachbrett-Favicon ohne externe Dateien.
  const dark = (c) => `<rect x="${c * 12}" width="12" height="12" fill="#2a2823"/>`;
  const light = (c) => `<rect x="${c * 12}" width="12" height="12" fill="#f0f0f0"/>`;
  let squares = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 0) continue;
      const fn = row % 2 === 0 ? light : dark;
      squares += fn(col) + `<rect y="${row * 12}" width="12" height="12" fill="#7b6c5c"/>`;
    }
  }
  fs.writeFileSync(
    path.join(docs, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${squares}` +
      `<text x="48" y="68" font-size="62" text-anchor="middle" fill="#629924">♞</text></svg>\n`,
  );
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  console.log('watching src/ … (kein Inlining, Index mit externen Dateien)');
} else {
  copyStatic();
  const result = await esbuild.build(options);
  if (result.errors.length) {
    console.error(`${result.errors.length} Fehler beim Bündeln`);
    process.exit(1);
  }
  const js = fs.readFileSync(path.join(docs, '_app', 'puzzle.js'), 'utf8');
  const jsSize = Buffer.byteLength(js);
  const indexSize = writeIndex(js);
  const brettJs = fs.readFileSync(path.join(docs, '_app', 'brett.js'), 'utf8');
  const brettSize = writeBoard(brettJs);
  // Alles steckt jetzt in den HTML-Dateien; weg damit, damit klar ist, was
  // tatsaechlich ausgeliefert wird.
  fs.rmSync(path.join(docs, '_app'), { recursive: true, force: true });
  fs.rmSync(path.join(docs, 'app.js'), { force: true });
  fs.rmSync(path.join(docs, 'style.css'), { force: true });
  fs.rmSync(path.join(docs, 'board.js'), { force: true });
  fs.rmSync(path.join(docs, 'board.css'), { force: true });

  // Die Engine-Dateien gehoeren nicht gebuendelt in die HTML, sondern liegen
  // als Dateien daneben: 1,8 MB gehoeren nicht in eine Seite, die sonst
  // 50 kB gross ist. Sie werden deshalb beim Bauen nur kopiert, und die
  // Seite laedt sie erst, wenn der Schalter auf "an" steht.
  const engineOrdner = path.join(src, 'engine');
  if (fs.existsSync(engineOrdner)) {
    const ziel = path.join(docs, 'engine');
    fs.mkdirSync(ziel, { recursive: true });
    let bytes = 0;
    for (const datei of fs.readdirSync(engineOrdner)) {
      fs.copyFileSync(path.join(engineOrdner, datei), path.join(ziel, datei));
      bytes += fs.statSync(path.join(ziel, datei)).size;
    }
    console.log(`docs/engine/: ${fs.readdirSync(ziel).length} Dateien, ${(bytes / 1048576).toFixed(1)} MB (nur bei Bedarf)`);
  }

  const manifestSize = fs.statSync(path.join(docs, 'data', 'manifest.json')).size;
  console.log(`docs/index.html: ${(indexSize / 1024).toFixed(0)} kB (JS ${(jsSize / 1024).toFixed(0)} kB, Manifest ${(manifestSize / 1024).toFixed(0)} kB)`);
  console.log(`docs/board.html: ${(brettSize / 1024).toFixed(0)} kB (JS ${(Buffer.byteLength(brettJs) / 1024).toFixed(0)} kB, Figuren inline)`);
  console.log('docs/sw.js, docs/icon.svg, docs/data/ bereit');
}
