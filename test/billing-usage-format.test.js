import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEntitlementsStore } from '../packages/entitlements/src/store.js';
import { Plans } from '../packages/entitlements/src/limits.js';
import { InMemoryUsageCounters } from '../packages/usage/src/in-memory.js';
import { getBillingUsageSnapshot } from '../apps/api/src/billing-usage.js';

test('getBillingUsageSnapshot returns finite limits and never returns Infinity', async () => {
  const entitlements = new InMemoryEntitlementsStore();
  entitlements.setPlan('t-1', Plans.ENTERPRISE);

  const usage = new InMemoryUsageCounters({ nowMs: () => Date.UTC(2026, 1, 14, 12, 0, 0) });
  usage.consumeIndexJobOrDeny({ tenantId: 't-1', limitPerDay: 999999, amount: 2 });
  usage.consumeDocBlocksOrDeny({ tenantId: 't-1', limitPerMonth: 999999, amount: 5 });

  const res = await getBillingUsageSnapshot({ tenantId: 't-1', entitlementsStore: entitlements, usageCounters: usage });
  assert.equal(res.plan, Plans.ENTERPRISE);
  assert.equal(res.limits.indexJobsPerDay.unlimited, true);
  assert.equal(res.limits.indexJobsPerDay.limit, null);
  assert.equal(res.usage.indexJobsPerDay.limit, null);
  assert.equal(res.usage.indexJobsPerDay.unlimited, true);
});

test('getBillingUsageSnapshot returns remaining for finite limits', async () => {
  const entitlements = new InMemoryEntitlementsStore();
  entitlements.setPlan('t-1', Plans.FREE);

  const usage = new InMemoryUsageCounters({ nowMs: () => Date.UTC(2026, 1, 14, 12, 0, 0) });
  usage.consumeIndexJobOrDeny({ tenantId: 't-1', limitPerDay: 10, amount: 3 });
  usage.consumeDocBlocksOrDeny({ tenantId: 't-1', limitPerMonth: 20, amount: 7 });

  const res = await getBillingUsageSnapshot({ tenantId: 't-1', entitlementsStore: entitlements, usageCounters: usage });
  assert.equal(res.limits.indexJobsPerDay.limit, 10);
  assert.equal(res.usage.indexJobsPerDay.used, 3);
  assert.equal(res.usage.indexJobsPerDay.remaining, 7);
  assert.equal(res.limits.docBlocksPerMonth.limit, 20);
  assert.equal(res.usage.docBlocksPerMonth.used, 7);
  assert.equal(res.usage.docBlocksPerMonth.remaining, 13);
});

