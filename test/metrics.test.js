import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics } from '../packages/observability/src/metrics.js';

test('metrics renders prometheus counters and latency buckets', () => {
  const m = createMetrics({ service: 't' });
  m.recordHttp({ method: 'GET', path: '/x', status: 200, durationMs: 12 });
  const out = m.renderPrometheus();
  assert.ok(out.includes('http_requests_total{service="t",method="GET",path="/x",status="200"} 1'));
  assert.ok(out.includes('http_request_duration_ms_bucket{service="t",method="GET",path="/x",le="25"} 1'));
});

