import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('apps/web');
const port = Number(process.env.WEB_PORT ?? 5179);

function contentType(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://localhost');
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  const filePath = path.join(root, p);
  if (!filePath.startsWith(root)) {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('content-type', contentType(filePath));
  res.end(fs.readFileSync(filePath));
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Graphfly web dev server: http://127.0.0.1:${port}`);
});

