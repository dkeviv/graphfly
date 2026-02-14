import test from 'node:test';
import assert from 'node:assert/strict';
import { PgBillingStore } from '../packages/billing-pg/src/pg-billing-store.js';

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

test('PgBillingStore.tryInsertStripeEvent inserts into stripe_events with idempotency', async () => {
  let inserted = true;
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO stripe_events')) {
      return { rows: inserted ? [{ id: 'row-1' }] : [] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgBillingStore({ client });
  const a = await store.tryInsertStripeEvent({
    tenantId: '00000000-0000-0000-0000-000000000001',
    stripeEventId: 'evt_1',
    type: 'customer.subscription.updated'
  });
  assert.equal(a.inserted, true);

  inserted = false;
  const b = await store.tryInsertStripeEvent({
    tenantId: '00000000-0000-0000-0000-000000000001',
    stripeEventId: 'evt_1',
    type: 'customer.subscription.updated'
  });
  assert.equal(b.inserted, false);
});

test('PgBillingStore.upsertBillingFromSubscription updates org plan and org_billing snapshot', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.startsWith('UPDATE orgs')) return { rows: [] };
    if (text.includes('INSERT INTO org_billing')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgBillingStore({ client });
  const out = await store.upsertBillingFromSubscription({
    tenantId: '00000000-0000-0000-0000-000000000001',
    subscription: {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      current_period_start: 1700000000,
      current_period_end: 1702592000,
      cancel_at_period_end: false,
      trial_end: null,
      metadata: { plan: 'enterprise' },
      items: { data: [{ price: { id: 'price_1' } }] }
    }
  });
  assert.equal(out.ok, true);
  assert.equal(out.plan, 'enterprise');
});

