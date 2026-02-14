import test from 'node:test';
import assert from 'node:assert/strict';
import { PgUsageCounters } from '../packages/usage-pg/src/pg-usage-counters.js';

function makeFakeClient(respond) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params: Array.isArray(params) ? params : [] });
      return respond(String(text), params ?? []);
    }
  };
}

test('PgUsageCounters.consumeIndexJobOrDeny increments usage_counters in a transaction', async () => {
  const client = makeFakeClient(async (text) => {
    if (text === 'BEGIN') return { rows: [] };
    if (text.includes('SELECT value') && text.includes('FROM usage_counters') && text.includes('FOR UPDATE')) return { rows: [{ value: 0 }] };
    if (text.includes('INSERT INTO usage_counters') && text.includes('ON CONFLICT') && text.includes('RETURNING value')) return { rows: [{ value: 1 }] };
    if (text === 'COMMIT') return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const usage = new PgUsageCounters({ client, nowMs: () => Date.UTC(2026, 1, 14, 12, 0, 0) });
  const res = await usage.consumeIndexJobOrDeny({
    tenantId: '00000000-0000-0000-0000-000000000001',
    limitPerDay: 10,
    amount: 1
  });
  assert.equal(res.ok, true);
  assert.equal(res.used, 1);

  const seq = client.calls.map((c) => c.text);
  assert.deepEqual(seq, ['BEGIN', seq[1], seq[2], 'COMMIT']);
  assert.ok(seq[1].includes('FOR UPDATE'));
  assert.ok(seq[2].includes('INSERT INTO usage_counters'));
});

test('PgUsageCounters.consumeOrDeny rolls back when limit exceeded', async () => {
  const client = makeFakeClient(async (text) => {
    if (text === 'BEGIN') return { rows: [] };
    if (text.includes('SELECT value') && text.includes('FOR UPDATE')) return { rows: [{ value: 10 }] };
    if (text === 'ROLLBACK') return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const usage = new PgUsageCounters({ client, nowMs: () => Date.UTC(2026, 1, 14, 12, 0, 0) });
  const res = await usage.consumeOrDeny({
    tenantId: '00000000-0000-0000-0000-000000000001',
    key: 'index_jobs_daily',
    periodStart: '2026-02-14',
    periodEnd: '2026-02-14',
    amount: 1,
    limit: 10
  });
  assert.equal(res.ok, false);
  assert.equal(res.used, 10);
});

test('PgUsageCounters.getIndexJobsToday reads usage_counters without locking', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('SELECT value') && text.includes('FROM usage_counters') && !text.includes('FOR UPDATE')) {
      return { rows: [{ value: 3 }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const usage = new PgUsageCounters({ client, nowMs: () => Date.UTC(2026, 1, 14, 12, 0, 0) });
  const res = await usage.getIndexJobsToday({ tenantId: '00000000-0000-0000-0000-000000000001' });
  assert.deepEqual(res, { used: 3, periodStart: '2026-02-14', periodEnd: '2026-02-14' });
});

test('PgUsageCounters.getDocBlocksThisMonth reads usage_counters for the month window', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('SELECT value') && text.includes('FROM usage_counters') && !text.includes('FOR UPDATE')) {
      return { rows: [{ value: 12 }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const usage = new PgUsageCounters({ client, nowMs: () => Date.UTC(2026, 1, 14, 12, 0, 0) });
  const res = await usage.getDocBlocksThisMonth({ tenantId: '00000000-0000-0000-0000-000000000001' });
  assert.deepEqual(res, { used: 12, periodStart: '2026-02-01', periodEnd: '2026-02-28' });
});
