import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryUsageCounters } from '../packages/usage/src/in-memory.js';

test('InMemoryUsageCounters enforces daily and monthly limits', () => {
  let now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const usage = new InMemoryUsageCounters({ nowMs: () => now });

  const a = usage.consumeIndexJobOrDeny({ tenantId: 't-1', limitPerDay: 1, amount: 1 });
  const b = usage.consumeIndexJobOrDeny({ tenantId: 't-1', limitPerDay: 1, amount: 1 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);

  const c = usage.consumeDocBlocksOrDeny({ tenantId: 't-1', limitPerMonth: 2, amount: 2 });
  const d = usage.consumeDocBlocksOrDeny({ tenantId: 't-1', limitPerMonth: 2, amount: 1 });
  assert.equal(c.ok, true);
  assert.equal(d.ok, false);

  // Advance month resets window.
  now = Date.UTC(2026, 1, 1, 0, 0, 0);
  const e = usage.consumeDocBlocksOrDeny({ tenantId: 't-1', limitPerMonth: 2, amount: 1 });
  assert.equal(e.ok, true);
});

test('InMemoryUsageCounters reports current usage windows', () => {
  let now = Date.UTC(2026, 1, 14, 12, 0, 0);
  const usage = new InMemoryUsageCounters({ nowMs: () => now });
  usage.consumeIndexJobOrDeny({ tenantId: 't-1', limitPerDay: 100, amount: 4 });
  usage.consumeDocBlocksOrDeny({ tenantId: 't-1', limitPerMonth: 1000, amount: 9 });

  assert.deepEqual(usage.getIndexJobsToday({ tenantId: 't-1' }), { used: 4, periodStart: '2026-02-14', periodEnd: '2026-02-14' });
  assert.deepEqual(usage.getDocBlocksThisMonth({ tenantId: 't-1' }), { used: 9, periodStart: '2026-02-01', periodEnd: '2026-02-28' });

  now = Date.UTC(2026, 2, 1, 0, 0, 0);
  assert.deepEqual(usage.getDocBlocksThisMonth({ tenantId: 't-1' }), { used: 0, periodStart: '2026-03-01', periodEnd: '2026-03-31' });
});
