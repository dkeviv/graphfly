import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckoutUrl, createPortalUrl } from '../apps/api/src/billing-sessions.js';

test('createCheckoutUrl prefers org stripeCustomerId over env', async () => {
  const orgStore = {
    async getOrg() {
      return { stripeCustomerId: 'cus_from_org' };
    }
  };
  const calls = [];
  const stripeService = {
    async createStripeClient({ apiKey }) {
      calls.push({ fn: 'createStripeClient', apiKey });
      return { key: apiKey };
    },
    async createCheckoutSession({ customerId, priceId, metadata }) {
      calls.push({ fn: 'createCheckoutSession', customerId, priceId, metadata });
      return { url: 'https://stripe.test/checkout' };
    },
    async createCustomerPortalSession() {
      throw new Error('not used');
    }
  };

  const out = await createCheckoutUrl({
    tenantId: 't-1',
    plan: 'enterprise',
    orgStore,
    stripeService,
    env: {
      STRIPE_SECRET_KEY: 'sk',
      STRIPE_CUSTOMER_ID: 'cus_from_env',
      STRIPE_ENTERPRISE_PRICE_ID: 'price_enterprise',
      STRIPE_PRO_PRICE_ID: 'price_pro',
      STRIPE_SUCCESS_URL: 'http://s',
      STRIPE_CANCEL_URL: 'http://c'
    }
  });
  assert.deepEqual(out, { url: 'https://stripe.test/checkout' });
  assert.ok(calls.some((c) => c.fn === 'createCheckoutSession' && c.customerId === 'cus_from_org' && c.priceId === 'price_enterprise'));
});

test('createPortalUrl throws stripe_not_configured when customerId missing', async () => {
  const stripeService = {
    async createStripeClient() {
      throw new Error('not used');
    },
    async createCheckoutSession() {
      throw new Error('not used');
    },
    async createCustomerPortalSession() {
      throw new Error('not used');
    }
  };
  await assert.rejects(
    () =>
      createPortalUrl({
        tenantId: 't-1',
        orgStore: { async getOrg() { return { stripeCustomerId: null }; } },
        stripeService,
        env: { STRIPE_SECRET_KEY: 'sk', STRIPE_CUSTOMER_ID: '' }
      }),
    (err) => err?.code === 'stripe_not_configured' && err?.missing?.customerId === true
  );
});

