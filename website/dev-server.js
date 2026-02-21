import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname);
const port = Number(process.env.WEBSITE_PORT ?? 5180);

function contentType(filePath) {
  if (filePath.endsWith('.css'))  return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js'))   return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.svg'))  return 'image/svg+xml';
  if (filePath.endsWith('.ico'))  return 'image/x-icon';
  if (filePath.endsWith('.png'))  return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const filePath = path.join(root, p);

  // Security: must stay within root
  if (!filePath.startsWith(root)) {
    res.statusCode = 400; res.end('bad request'); return;
  }

  // Resolve directories to index.html
  let resolved = filePath;
  if (!fs.existsSync(resolved)) {
    res.statusCode = 404; res.end('not found'); return;
  }
  if (fs.statSync(resolved).isDirectory()) {
    resolved = path.join(resolved, 'index.html');
    if (!fs.existsSync(resolved)) {
      res.statusCode = 404; res.end('not found'); return;
    }
  }

  res.statusCode = 200;
  res.setHeader('content-type', contentType(resolved));
  res.end(fs.readFileSync(resolved));
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Graphfly website dev server: http://127.0.0.1:${port}`);
});
