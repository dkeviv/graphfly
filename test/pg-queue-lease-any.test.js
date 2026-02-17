import test from 'node:test';
import assert from 'node:assert/strict';
import { PgQueue } from '../packages/queue-pg/src/pg-queue.js';

test('PgQueue.leaseAny picks jobs without tenant filter and returns tenantId', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return {
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            tenant_id: '22222222-2222-2222-2222-222222222222',
            job_name: 'index.run',
            payload: { tenantId: '22222222-2222-2222-2222-222222222222', repoId: '33333333-3333-3333-3333-333333333333' }
          }
        ]
      };
    }
  };

  const q = new PgQueue({ client, queueName: 'index' });
  const leased = await q.leaseAny({ limit: 1, lockMs: 60000 });
  assert.equal(leased.length, 1);
  assert.equal(leased[0].tenantId, '22222222-2222-2222-2222-222222222222');
  assert.equal(leased[0].name, 'index.run');
  assert.ok(leased[0].lockToken);

  assert.equal(queries.length, 1);
  assert.ok(!queries[0].sql.includes('tenant_id=$1'), 'leaseAny must not include tenant filter');
  assert.ok(queries[0].sql.includes('FROM jobs'), 'leaseAny query must read jobs');
});

