import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutSession, createCustomerPortalSession } from '../packages/stripe-service/src/stripe.js';

test('stripe-service creates checkout + portal sessions via injected client', async () => {
  const calls = [];
  const stripe = {
    checkout: {
      sessions: {
        async create(args) {
          calls.push({ kind: 'checkout', args });
          return { id: 'cs_1', url: 'https://stripe.test/checkout' };
        }
      }
    },
    billingPortal: {
      sessions: {
        async create(args) {
          calls.push({ kind: 'portal', args });
          return { id: 'bps_1', url: 'https://stripe.test/portal' };
        }
      }
    }
  };

  const co = await createCheckoutSession({
    stripe,
    customerId: 'cus_1',
    priceId: 'price_1',
    successUrl: 'https://app/success',
    cancelUrl: 'https://app/cancel',
    metadata: { tenantId: 't-1' }
  });
  const po = await createCustomerPortalSession({ stripe, customerId: 'cus_1', returnUrl: 'https://app/billing' });

  assert.equal(co.url, 'https://stripe.test/checkout');
  assert.equal(po.url, 'https://stripe.test/portal');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, 'checkout');
  assert.equal(calls[1].kind, 'portal');
});

