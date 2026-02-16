function clampInt(v, { min, max, fallback }) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableHttpStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function validateEmbedding(vec) {
  if (!Array.isArray(vec) || vec.length !== 384) return { ok: false, reason: 'embedding_not_384' };
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) return { ok: false, reason: 'embedding_non_finite' };
  }
  return { ok: true };
}

export function createEmbeddingProviderFromEnv({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const mode = String(env.GRAPHFLY_EMBEDDINGS_MODE ?? 'deterministic').toLowerCase();
  const prod = String(env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod';
  const required = String(env.GRAPHFLY_EMBEDDINGS_REQUIRED ?? '').trim() === '1';

  if (mode === 'deterministic') {
    if (prod && required) {
      const err = new Error('embeddings_not_configured: set GRAPHFLY_EMBEDDINGS_MODE=http (or disable GRAPHFLY_EMBEDDINGS_REQUIRED)');
      err.code = 'embeddings_not_configured';
      throw err;
    }
    // Lazy import to avoid cycles.
    return async function embedDeterministic(text) {
      const { embedText384 } = await import('./embedding.js');
      return embedText384(text);
    };
  }

  if (mode === 'http') {
    const baseUrl = String(env.GRAPHFLY_EMBEDDINGS_HTTP_URL ?? '').trim();
    const token = String(env.GRAPHFLY_EMBEDDINGS_HTTP_TOKEN ?? '').trim();
    if (!baseUrl) {
      const err = new Error('embeddings_http_missing_url: set GRAPHFLY_EMBEDDINGS_HTTP_URL');
      err.code = 'embeddings_not_configured';
      throw err;
    }

    const maxAttempts = clampInt(env.GRAPHFLY_EMBEDDINGS_HTTP_MAX_ATTEMPTS ?? 4, { min: 1, max: 10, fallback: 4 });
    const baseDelayMs = clampInt(env.GRAPHFLY_EMBEDDINGS_HTTP_RETRY_BASE_MS ?? 250, { min: 50, max: 20_000, fallback: 250 });
    const maxDelayMs = clampInt(env.GRAPHFLY_EMBEDDINGS_HTTP_RETRY_MAX_MS ?? 5_000, { min: 100, max: 120_000, fallback: 5_000 });
    const timeoutMs = clampInt(env.GRAPHFLY_EMBEDDINGS_HTTP_TIMEOUT_MS ?? 15_000, { min: 1_000, max: 120_000, fallback: 15_000 });

    return async function embedHttp(text) {
      const input = String(text ?? '').slice(0, 20_000);
      let attempt = 0;
      for (;;) {
        attempt++;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(baseUrl, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json; charset=utf-8',
              ...(token ? { authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ input, dims: 384 }),
            signal: controller.signal
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            const msg = data?.error ?? data?.message ?? `HTTP ${res.status}`;
            const err = new Error(`embeddings_http_error: ${msg}`);
            err.status = res.status;
            if (attempt < maxAttempts && isRetryableHttpStatus(res.status)) {
              const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
              await sleep(backoff);
              continue;
            }
            throw err;
          }

          const vec = data?.embedding ?? data?.data?.[0]?.embedding ?? null;
          const v = validateEmbedding(vec);
          if (!v.ok) throw new Error(`embeddings_http_bad_response: ${v.reason}`);
          return vec;
        } catch (e) {
          const retryable = e?.name === 'AbortError' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET';
          if (attempt < maxAttempts && retryable) {
            const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
            await sleep(backoff);
            continue;
          }
          throw e;
        } finally {
          clearTimeout(t);
        }
      }
    };
  }

  const err = new Error(`embeddings_mode_unknown: ${mode}`);
  err.code = 'embeddings_mode_unknown';
  throw err;
}
