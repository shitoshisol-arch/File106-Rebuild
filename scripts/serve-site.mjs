// Minimal dependency-free static server for the archive site.
//
// The site in site/ is plain HTML, CSS and JS, so `npm run dev` only needs to
// serve bytes. Keeping this in Node means no download on first run and no
// extra dependency in package.json.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd(), 'site');
const PORT = Number(process.env.PORT ?? 4174);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let file = resolve(join(ROOT, relative));

  // Never serve anything outside site/, even after normalisation.
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return null;

  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    if (statSync(file).isFile()) return file;
  } catch {
    return null;
  }
  return null;
}

const server = createServer((request, response) => {
  const file = resolveFile(request.url ?? '/');

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('404 — not found\n');
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`FILE106 archive on http://${HOST}:${PORT}`);
  console.log('Serving site/ — press Ctrl+C to stop.');
});
