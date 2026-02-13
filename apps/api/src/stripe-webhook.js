import { verifyStripeWebhook } from '../../../packages/stripe-webhooks/src/verify.js';

export function makeStripeWebhookHandler({ signingSecret, dedupe, onEvent, nowSeconds }) {
  return async ({ headers, rawBody }) => {
    const sig = headers['stripe-signature'];
    const verified = verifyStripeWebhook({ signingSecret, rawBody, stripeSignatureHeader: sig, nowSeconds });
    if (!verified.ok) return { status: 401, body: { error: 'invalid_signature', reason: verified.reason } };

    let event = null;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { status: 400, body: { error: 'invalid_json' } };
    }

    const eventId = event?.id;
    if (typeof eventId !== 'string' || eventId.length === 0) return { status: 400, body: { error: 'missing_event_id' } };

    if (dedupe.has(eventId)) return { status: 200, body: { ok: true, deduped: true } };
    dedupe.add(eventId);

    await onEvent(event);
    return { status: 200, body: { ok: true } };
  };
}
