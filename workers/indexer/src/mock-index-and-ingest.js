import { spawnSync } from 'node:child_process';
import http from 'node:http';

function httpPostJson({ url, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const repoRoot = process.argv[2] ?? 'fixtures/sample-repo';
const apiUrl = process.env.GRAPHFLY_API_URL ?? 'http://127.0.0.1:8787';

const proc = spawnSync('node', ['workers/indexer/src/mock-indexer.js', repoRoot], { encoding: 'utf8' });
if (proc.status !== 0) {
  // eslint-disable-next-line no-console
  console.error(proc.stderr || `mock indexer failed: ${proc.status}`);
  process.exit(proc.status ?? 1);
}

const ndjson = proc.stdout;
const result = await httpPostJson({ url: `${apiUrl}/ingest/ndjson`, body: { tenantId: 't-1', repoId: 'r-1', ndjson } });
// eslint-disable-next-line no-console
console.log(result.status, result.body);
