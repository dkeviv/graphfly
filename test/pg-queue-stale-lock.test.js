import test from 'node:test';
import assert from 'node:assert/strict';
import { PgQueue } from '../packages/queue-pg/src/pg-queue.js';

test('PgQueue.lease includes expired-active jobs (stale lock recovery)', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return {
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            job_name: 'doc.generate',
            payload: { tenantId: '22222222-2222-2222-2222-222222222222' }
          }
        ]
      };
    }
  };

  const q = new PgQueue({ client, queueName: 'doc' });
  const leased = await q.lease({ tenantId: '22222222-2222-2222-2222-222222222222', limit: 1, lockMs: 60000 });
  assert.equal(leased.length, 1);
  assert.ok(leased[0].lockToken);

  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes("status='active'"), 'lease must consider active jobs');
  assert.ok(queries[0].sql.includes('lock_expires_at'), 'lease must use lock_expires_at');
  assert.ok(queries[0].sql.includes('attempts < max_attempts'), 'lease must respect max_attempts');
});

test('PgQueue.renew extends lock TTL for active jobs', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return { rowCount: 1, rows: [] };
    }
  };

  const q = new PgQueue({ client, queueName: 'doc' });
  const res = await q.renew({
    tenantId: '22222222-2222-2222-2222-222222222222',
    jobId: '11111111-1111-1111-1111-111111111111',
    lockToken: '33333333-3333-3333-3333-333333333333',
    lockMs: 60000
  });
  assert.equal(res.ok, true);
  assert.equal(res.updated, true);

  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes('lock_expires_at'), 'renew must update lock_expires_at');
  assert.deepEqual(queries[0].params, [
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    60000
  ]);
});

