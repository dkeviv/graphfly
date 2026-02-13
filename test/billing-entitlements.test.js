import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEntitlementsStore } from '../packages/entitlements/src/store.js';
import { Plans } from '../packages/entitlements/src/limits.js';
import { applyStripeEventToEntitlements } from '../packages/billing/src/apply-stripe-event.js';

test('applyStripeEventToEntitlements sets PRO when subscription is active', () => {
  const ent = new InMemoryEntitlementsStore();
  applyStripeEventToEntitlements({
    tenantId: 't-1',
    entitlementsStore: ent,
    event: { id: 'evt_1', type: 'customer.subscription.updated', data: { object: { status: 'active' } } }
  });
  assert.equal(ent.getPlan('t-1'), Plans.PRO);
});

