import http from 'node:http';
import https from 'node:https';

function compactHeaders(headers) {
  const h = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined || v === null) continue;
    h[k] = String(v);
  }
  return h;
}

export function httpRequestJson({ url, method = 'GET', headers = null, body = null, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: compactHeaders(headers ?? {})
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            // ignore
          }
          resolve({ status: res.statusCode ?? 0, json, text });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(Number.isFinite(timeoutMs) ? Math.max(1000, Math.trunc(timeoutMs)) : 30_000, () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {}
    });
    if (body != null) req.end(JSON.stringify(body));
    else req.end();
  });
}

