/**
 * Lightweight embeddings proxy.
 *
 * Graphfly's HTTP embeddings client POSTs:
 *   { input: string, dims: 384 }
 * and expects back:
 *   { embedding: number[384] }
 *
 * This proxy translates that to the OpenAI embeddings API format:
 *   POST https://api.openai.com/v1/embeddings
 *   { model, input, dimensions: 384 }
 * and normalises the response back to { embedding: [...] }.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... EMBEDDINGS_MODEL=text-embedding-3-small node apps/api/src/embeddings-proxy.js
 *   # Listens on http://127.0.0.1:8790 by default.
 *
 * Then set in .env:
 *   GRAPHFLY_EMBEDDINGS_MODE=http
 *   GRAPHFLY_EMBEDDINGS_HTTP_URL=http://127.0.0.1:8790/embed
 *   GRAPHFLY_EMBEDDINGS_HTTP_TOKEN=   (leave blank; proxy uses OPENAI_API_KEY directly)
 *
 * Compatible with any OpenAI-compatible endpoint (e.g. Azure, local Ollama, etc.)
 * by setting EMBEDDINGS_BASE_URL.
 */

import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.EMBEDDINGS_PROXY_PORT ?? 8790);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
const MODEL = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small';
const BASE_URL = process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1/embeddings';
const DIMS = 384;

if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is required');
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const req = lib.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          ...headers,
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => {
          const text = Buffer.concat(parts).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* ignore */ }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: MODEL, dims: DIMS }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/embed') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid_json' }));
    return;
  }

  const input = String(body?.input ?? '').slice(0, 20_000);
  if (!input) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'input_required' }));
    return;
  }

  try {
    const { status, json } = await postJson(
      BASE_URL,
      { authorization: `Bearer ${OPENAI_API_KEY}`, accept: 'application/json' },
      { model: MODEL, input, dimensions: DIMS }
    );

    if (status < 200 || status >= 300) {
      const msg = json?.error?.message ?? `upstream HTTP ${status}`;
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
      return;
    }

    // OpenAI returns: { data: [{ embedding: [...] }] }
    const embedding = json?.data?.[0]?.embedding ?? json?.embedding ?? null;
    if (!Array.isArray(embedding) || embedding.length !== DIMS) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `upstream returned ${embedding?.length ?? 0} dims, expected ${DIMS}` }));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ embedding }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e?.message ?? e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Embeddings proxy listening on http://127.0.0.1:${PORT}/embed`);
  console.log(`  model: ${MODEL}`);
  console.log(`  dims:  ${DIMS}`);
  console.log(`  upstream: ${BASE_URL}`);
});
