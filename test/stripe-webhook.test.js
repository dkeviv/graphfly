import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStripeSignatureV1, verifyStripeWebhook } from '../packages/stripe-webhooks/src/verify.js';
import { StripeEventDedupe } from '../packages/stripe-webhooks/src/dedupe.js';
import { makeStripeWebhookHandler } from '../apps/api/src/stripe-webhook.js';

test('verifyStripeWebhook validates Stripe-Signature v1', () => {
  const secret = 'whsec_test';
  const rawBody = Buffer.from('{"id":"evt_1"}', 'utf8');
  const t = 1700000000;
  const v1 = computeStripeSignatureV1({ signingSecret: secret, timestamp: t, rawBody });
  const header = `t=${t},v1=${v1}`;
  const res = verifyStripeWebhook({ signingSecret: secret, rawBody, stripeSignatureHeader: header, nowSeconds: () => t });
  assert.equal(res.ok, true);
});

test('Stripe webhook handler dedupes by event id', async () => {
  const secret = 'whsec_test';
  const dedupe = new StripeEventDedupe();
  const events = [];
  const t = 1700000000;
  const handler = makeStripeWebhookHandler({
    signingSecret: secret,
    dedupe,
    onEvent: async (e) => events.push(e.id),
    nowSeconds: () => t
  });

  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' }), 'utf8');
  const v1 = computeStripeSignatureV1({ signingSecret: secret, timestamp: t, rawBody: body });
  const header = `t=${t},v1=${v1}`;

  const a = await handler({ headers: { 'stripe-signature': header }, rawBody: body });
  const b = await handler({ headers: { 'stripe-signature': header }, rawBody: body });
  assert.equal(a.status, 200);
  assert.equal(b.body.deduped, true);
  assert.deepEqual(events, ['evt_1']);
});
