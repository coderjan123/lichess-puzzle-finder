// Simuliert GitHub Pages: Die Seite liegt in einem Unterordner /repo/.
// So wird geprüft, ob alle Pfade relativ funktionieren.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { startServer } from './serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.join(here, '..', 'docs');
const fake = fs.mkdtempSync('/tmp/opencode/pages-');
fs.symlinkSync(docs, path.join(fake, 'repo'));

const { port } = await startServer({ port: 0, root: fake });
const BASE = `http://127.0.0.1:${port}/repo/`;
const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let bad = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok   ' : 'FEHLER'} ${msg}`);
  if (!cond) bad++;
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.chip', { timeout: 30000 });
check((await page.locator('.chip').count()) === 73, 'Startseite lädt 73 Themes aus /repo/');

await page.click('.chip[data-theme="mateIn2"]');
await page.fill('#count', '10');
await page.click('#searchBtn');
await page.waitForSelector('#viewResults:not([hidden])', { timeout: 60000 });
await page.waitForFunction(() => document.getElementById('loading').hidden, null, { timeout: 60000 });
const ids = await page.$$eval('#resultList li', (n) => n.map((x) => x.querySelector('.id').textContent));
check(ids.length === 10 && ids[0] === '8ENVm', `Suche funktioniert im Unterordner (${ids[0]} …)`);

const href = await page.getAttribute('#resultList li:first-child a', 'href');
check(href === 'https://lichess.org/training/8ENVm', `Link korrekt: ${href}`);
check(errors.length === 0, `keine Konsolenfehler${errors.length ? ': ' + errors[0] : ''}`);

await page.screenshot({ path: '/tmp/opencode/shots/10-github-pages-pfad.png', fullPage: true });
await browser.close();
fs.rmSync(fake, { recursive: true, force: true });
console.log(bad ? `\n${bad} PROBLEME` : '\nGitHub-Pages-Pfad funktioniert.');
process.exit(bad ? 1 : 0);
