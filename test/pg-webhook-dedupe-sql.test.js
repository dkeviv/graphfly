import test from 'node:test';
import assert from 'node:assert/strict';
import { PgWebhookDeliveryDedupe } from '../packages/github-webhooks-pg/src/pg-delivery-dedupe.js';

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

test('PgWebhookDeliveryDedupe.tryInsert is idempotent by provider+delivery_id', async () => {
  let inserted = true;
  const client = makeFakeClient(async (text) => {
    if (text.includes('INSERT INTO webhook_deliveries') && text.includes('ON CONFLICT')) {
      return { rows: inserted ? [{ id: 'row1' }] : [] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const d = new PgWebhookDeliveryDedupe({ client });
  const a = await d.tryInsert({ provider: 'github', deliveryId: 'd1', eventType: 'push', tenantId: null, repoId: null });
  assert.equal(a.inserted, true);
  inserted = false;
  const b = await d.tryInsert({ provider: 'github', deliveryId: 'd1', eventType: 'push', tenantId: null, repoId: null });
  assert.equal(b.inserted, false);
});

