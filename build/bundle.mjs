#!/usr/bin/env node
/**
 * Baut docs/ aus src/:
 *   - bündelt src/*.js nach docs/app.js (einzige Abhängigkeit: fflate für gzip)
 *   - kopiert index.html, style.css
 *   - erzeugt ein kleines Favicon
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
  entryPoints: [path.join(src, 'main.js')],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari15', 'firefox100'],
  outfile: path.join(docs, 'app.js'),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
};

function copyStatic() {
  fs.copyFileSync(path.join(src, 'index.html'), path.join(docs, 'index.html'));
  fs.copyFileSync(path.join(src, 'style.css'), path.join(docs, 'style.css'));
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
  console.log('watching src/ …');
} else {
  copyStatic();
  const result = await esbuild.build(options);
  const size = fs.statSync(path.join(docs, 'app.js')).size;
  console.log(`docs/app.js: ${(size / 1024).toFixed(0)} kB${result.errors.length ? ' (FEHLER)' : ''}`);
}
