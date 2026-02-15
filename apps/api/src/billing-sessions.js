function pickPriceId({ plan, env }) {
  const p = String(plan ?? 'pro').toLowerCase();
  if (p === 'enterprise') return env.STRIPE_ENTERPRISE_PRICE_ID ?? '';
  return env.STRIPE_PRO_PRICE_ID ?? '';
}

async function resolveCustomerId({ tenantId, orgStore, env }) {
  if (orgStore?.getOrg) {
    const org = await Promise.resolve(orgStore.getOrg({ tenantId }));
    const fromOrg = org?.stripeCustomerId ?? null;
    if (typeof fromOrg === 'string' && fromOrg.length > 0) return fromOrg;
  }
  const fromEnv = env.STRIPE_CUSTOMER_ID ?? '';
  return fromEnv || null;
}

async function ensureCustomerId({ tenantId, orgStore, stripeService, stripe, env }) {
  const existing = await resolveCustomerId({ tenantId, orgStore, env });
  if (existing) return existing;
  if (!orgStore?.upsertOrg) {
    const err = new Error('stripe_not_configured');
    err.code = 'stripe_not_configured';
    err.missing = { customerId: true };
    throw err;
  }
  const org = (await Promise.resolve(orgStore.getOrg?.({ tenantId }))) ?? {};
  const created = await stripeService.createCustomer({
    stripe,
    name: org.displayName ?? org.name ?? null,
    metadata: { tenantId }
  });
  await orgStore.upsertOrg({ tenantId, patch: { stripeCustomerId: created.id } });
  return created.id;
}

export async function createCheckoutUrl({
  tenantId,
  plan,
  orgStore,
  stripeService,
  env = process.env
}) {
  if (!tenantId) throw new Error('tenantId is required');
  const apiKey = env.STRIPE_SECRET_KEY ?? '';
  const priceId = pickPriceId({ plan, env });
  const successUrl = env.STRIPE_SUCCESS_URL ?? 'http://localhost/success';
  const cancelUrl = env.STRIPE_CANCEL_URL ?? 'http://localhost/cancel';

  if (!apiKey || !priceId) {
    const err = new Error('stripe_not_configured');
    err.code = 'stripe_not_configured';
    err.missing = { apiKey: !apiKey, priceId: !priceId };
    throw err;
  }

  const stripe = await stripeService.createStripeClient({ apiKey });
  const customerId = await ensureCustomerId({ tenantId, orgStore, stripeService, stripe, env });
  const session = await stripeService.createCheckoutSession({
    stripe,
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    metadata: { tenantId, plan: String(plan ?? 'pro') }
  });
  return { url: session.url };
}

export async function createPortalUrl({ tenantId, orgStore, stripeService, env = process.env }) {
  if (!tenantId) throw new Error('tenantId is required');
  const apiKey = env.STRIPE_SECRET_KEY ?? '';
  const returnUrl = env.STRIPE_RETURN_URL ?? 'http://localhost/billing';
  if (!apiKey) {
    const err = new Error('stripe_not_configured');
    err.code = 'stripe_not_configured';
    err.missing = { apiKey: !apiKey };
    throw err;
  }
  const stripe = await stripeService.createStripeClient({ apiKey });
  const customerId = await ensureCustomerId({ tenantId, orgStore, stripeService, stripe, env });
  const session = await stripeService.createCustomerPortalSession({ stripe, customerId, returnUrl });
  return { url: session.url };
}
