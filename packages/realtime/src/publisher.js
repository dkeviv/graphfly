export function createRealtimePublisherFromEnv({
  endpoint = process.env.GRAPHFLY_RT_ENDPOINT ?? '',
  token = process.env.GRAPHFLY_RT_TOKEN ?? ''
} = {}) {
  const base = String(endpoint ?? '').trim();
  if (!base) return null;
  const t = String(token ?? '').trim();
  const url = new URL('/internal/rt', base).toString();

  return {
    async publish({ tenantId, repoId, type, payload }) {
      if (!tenantId || !repoId || !type) return;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: t ? `Bearer ${t}` : ''
        },
        body: JSON.stringify({ tenantId, repoId, type, payload: payload ?? null })
      });
      if (!res.ok) throw new Error(`realtime_publish_failed:${res.status}`);
    }
  };
}

