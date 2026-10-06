#!/usr/bin/env node
// Minimaler statischer Server für docs/ - bildet GitHub Pages nach
// (inkl. on-the-fly gzip für Textdateien), damit lokal getestet werden kann,
// was später auf GitHub Pages läuft.
//
//   node build/serve.mjs [port] [verzeichnis]

import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.gz': 'application/gzip',
  // Die Engine braucht .wasm mit genau diesem Typ. Ohne ihn bricht der
  // Worker ab ("Response has unsupported MIME type"), weil das
  // Streaming-Compilieren nicht greift - GitHub Pages liefert .wasm richtig,
  // der Testserver eben nicht, und die Seite sah deshalb kaputt aus, obwohl
  // sie auf dem Server laufen wuerde.
  '.wasm': 'application/wasm',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg']);

export function startServer({ port = 0, root = process.cwd(), host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

    if (!file.startsWith(root)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
      return;
    }

    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + rel);
        return;
      }
      const ext = path.extname(file);
      const headers = {
        'content-type': TYPES[ext] || 'application/octet-stream',
        'cache-control': 'no-cache',
      };
      if (String(req.headers['accept-encoding'] || '').includes('gzip') && COMPRESSIBLE.has(ext) && buf.length > 512) {
        const gz = gzipSync(buf, { level: 6 });
        headers['content-encoding'] = 'gzip';
        headers['content-length'] = gz.length;
        res.writeHead(200, headers).end(gz);
      } else {
        headers['content-length'] = buf.length;
        res.writeHead(200, headers).end(buf);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port, root }));
  });
}

// LAN-Adresse herausfinden, damit dasselbe Skript auch vom Handy erreichbar ist.
function lanAddress() {
  const nets = require('node:os').networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

const require = createRequire(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const hostIdx = args.indexOf('--host');
  const host = hostIdx !== -1 ? args[hostIdx + 1] : '127.0.0.1';
  const positional = args.filter((a, i) => !a.startsWith('--') && i !== hostIdx + 1);
  const port = Number(positional[0] || 8123);
  const root = path.resolve(positional[1] || path.join(here, '..', 'docs'));
  const { port: actual } = await startServer({ port, root, host });
  const lan = lanAddress();
  console.log(`serving ${root}`);
  console.log(`  lokal : http://127.0.0.1:${actual}/`);
  if (lan) console.log(`  handy : http://${lan}:${actual}/  (Handy im selben WLAN)`);
}
