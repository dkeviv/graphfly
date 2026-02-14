export async function createStripeClient({ apiKey }) {
  const k = String(apiKey ?? '');
  if (!k) throw new Error('stripe_api_key_required');

  let StripeMod;
  try {
    StripeMod = await import('stripe');
  } catch {
    throw new Error('stripe_dependency_missing: install the "stripe" package in production to enable checkout/portal');
  }

  const Stripe = StripeMod.default ?? StripeMod.Stripe ?? StripeMod;
  return new Stripe(k, { apiVersion: '2024-06-20' });
}

export async function createCheckoutSession({
  stripe,
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  metadata = null
}) {
  if (!stripe?.checkout?.sessions?.create) throw new Error('stripe_client_required');
  if (!customerId) throw new Error('customerId required');
  if (!priceId) throw new Error('priceId required');
  if (!successUrl) throw new Error('successUrl required');
  if (!cancelUrl) throw new Error('cancelUrl required');

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: metadata ?? undefined
  });
  return { id: session.id, url: session.url };
}

export async function createCustomerPortalSession({ stripe, customerId, returnUrl }) {
  if (!stripe?.billingPortal?.sessions?.create) throw new Error('stripe_client_required');
  if (!customerId) throw new Error('customerId required');
  if (!returnUrl) throw new Error('returnUrl required');

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl
  });
  return { id: session.id, url: session.url };
}

