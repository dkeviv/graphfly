function inc(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function bucketForMs(ms) {
  if (ms <= 10) return 10;
  if (ms <= 25) return 25;
  if (ms <= 50) return 50;
  if (ms <= 100) return 100;
  if (ms <= 250) return 250;
  if (ms <= 500) return 500;
  if (ms <= 1000) return 1000;
  if (ms <= 2500) return 2500;
  if (ms <= 5000) return 5000;
  return 10000;
}

export function createMetrics({ service = 'graphfly' } = {}) {
  const counters = new Map(); // key -> number
  const latencyBuckets = new Map(); // baseLabelsKey -> Map(bucketMs -> count)

  function recordHttp({ method, path, status, durationMs }) {
    const m = String(method ?? 'GET').toUpperCase();
    const p = String(path ?? '/');
    const s = Number(status ?? 0) || 0;
    inc(counters, `http_requests_total{service="${service}",method="${m}",path="${p}",status="${s}"}`);
    const b = bucketForMs(Number(durationMs ?? 0));
    const base = `service="${service}",method="${m}",path="${p}"`;
    const bm = latencyBuckets.get(base) ?? new Map();
    latencyBuckets.set(base, bm);
    inc(bm, b);
  }

  function recordJob({ queue, jobName, outcome }) {
    const q = String(queue ?? 'unknown');
    const j = String(jobName ?? 'unknown');
    const o = String(outcome ?? 'unknown');
    inc(counters, `jobs_total{service="${service}",queue="${q}",job="${j}",outcome="${o}"}`);
  }

  function renderPrometheus() {
    const lines = [];
    for (const [k, v] of counters.entries()) lines.push(`${k} ${v}`);
    for (const [base, buckets] of latencyBuckets.entries()) {
      for (const [b, c] of buckets.entries()) {
        lines.push(`http_request_duration_ms_bucket{${base},le="${b}"} ${c}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  return { recordHttp, recordJob, renderPrometheus };
}
