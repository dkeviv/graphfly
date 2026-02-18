import test from 'node:test';
import assert from 'node:assert/strict';
import { PgQueue } from '../packages/queue-pg/src/pg-queue.js';

test('PgQueue.cancel marks queued/active jobs dead', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    }
  };

  const q = new PgQueue({ client, queueName: 'index' });
  const res = await q.cancel({
    tenantId: '22222222-2222-2222-2222-222222222222',
    jobId: '11111111-1111-1111-1111-111111111111',
    reason: 'canceled_by_admin'
  });
  assert.equal(res.ok, true);
  assert.equal(res.updated, true);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes("status='dead'"));
  assert.ok(queries[0].sql.includes('completed_at=now()'));
  assert.deepEqual(queries[0].params, [
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'index',
    'canceled_by_admin'
  ]);
});

test('PgQueue.retry re-queues dead jobs and can reset attempts', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    }
  };

  const q = new PgQueue({ client, queueName: 'doc' });
  const res = await q.retry({
    tenantId: '22222222-2222-2222-2222-222222222222',
    jobId: '11111111-1111-1111-1111-111111111111',
    resetAttempts: true
  });
  assert.equal(res.ok, true);
  assert.equal(res.updated, true);
  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes("status='queued'"));
  assert.ok(queries[0].sql.includes('attempts=CASE WHEN $4 THEN 0 ELSE attempts END'));
  assert.deepEqual(queries[0].params, [
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'doc',
    true
  ]);
});

