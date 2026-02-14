function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

function toSeconds(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toStripeStatus(v) {
  const s = String(v ?? '');
  if (
    s === 'incomplete' ||
    s === 'incomplete_expired' ||
    s === 'trialing' ||
    s === 'active' ||
    s === 'past_due' ||
    s === 'canceled' ||
    s === 'unpaid' ||
    s === 'paused'
  )
    return s;
  return null;
}

function planFromSubscription({ subscription, defaultPlan = 'pro' }) {
  const status = String(subscription?.status ?? '');
  const active = status === 'active' || status === 'trialing';
  if (!active) return 'free';

  const md = subscription?.metadata ?? {};
  const p = String(md.plan ?? md.Plan ?? '').toLowerCase();
  if (p === 'pro' || p === 'enterprise') return p;
  return defaultPlan;
}

function firstPriceId(subscription) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[0]?.price?.id ?? null;
}

export class PgBillingStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async ensureOrgExists({ tenantId, name = 'unknown' }) {
    assertUuid(tenantId, 'tenantId');
    await this._c.query(`INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [tenantId, name]);
  }

  async tryInsertStripeEvent({ tenantId, stripeEventId, type }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof stripeEventId !== 'string' || stripeEventId.length === 0) throw new Error('stripeEventId is required');
    if (typeof type !== 'string' || type.length === 0) throw new Error('type is required');

    await this.ensureOrgExists({ tenantId });
    const res = await this._c.query(
      `INSERT INTO stripe_events (org_id, stripe_event_id, type)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING
       RETURNING id`,
      [tenantId, stripeEventId, type]
    );
    const inserted = Boolean(res.rows?.[0]?.id);
    return { ok: true, inserted };
  }

  async markStripeEventProcessed({ tenantId, stripeEventId, errorMessage = null }) {
    assertUuid(tenantId, 'tenantId');
    if (typeof stripeEventId !== 'string' || stripeEventId.length === 0) throw new Error('stripeEventId is required');
    await this._c.query(
      `UPDATE stripe_events
       SET processed_at=now(), error_message=$3
       WHERE org_id=$1 AND stripe_event_id=$2`,
      [tenantId, stripeEventId, errorMessage ? String(errorMessage) : null]
    );
    return { ok: true };
  }

  async upsertBillingFromSubscription({ tenantId, subscription }) {
    assertUuid(tenantId, 'tenantId');
    if (!subscription || typeof subscription !== 'object') throw new Error('subscription is required');

    const customerId = subscription.customer ?? null;
    const subscriptionId = subscription.id ?? null;
    const status = toStripeStatus(subscription.status);
    const priceId = firstPriceId(subscription);
    const currentPeriodStart = toSeconds(subscription.current_period_start);
    const currentPeriodEnd = toSeconds(subscription.current_period_end);
    const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
    const trialEnd = toSeconds(subscription.trial_end);
    const plan = planFromSubscription({ subscription, defaultPlan: 'pro' });

    await this.ensureOrgExists({ tenantId });

    await this._c.query(
      `UPDATE orgs
       SET stripe_customer_id=COALESCE(stripe_customer_id, $2),
           plan=$3,
           updated_at=now()
       WHERE id=$1`,
      [tenantId, customerId, plan]
    );

    await this._c.query(
      `INSERT INTO org_billing (
         org_id,
         stripe_customer_id,
         stripe_subscription_id,
         stripe_price_id,
         status,
         current_period_start,
         current_period_end,
         cancel_at_period_end,
         trial_end
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6) END,
         CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7) END,
         $8,
         CASE WHEN $9::bigint IS NULL THEN NULL ELSE to_timestamp($9) END
       )
       ON CONFLICT (org_id)
       DO UPDATE SET
         stripe_customer_id=EXCLUDED.stripe_customer_id,
         stripe_subscription_id=EXCLUDED.stripe_subscription_id,
         stripe_price_id=EXCLUDED.stripe_price_id,
         status=EXCLUDED.status,
         current_period_start=EXCLUDED.current_period_start,
         current_period_end=EXCLUDED.current_period_end,
         cancel_at_period_end=EXCLUDED.cancel_at_period_end,
         trial_end=EXCLUDED.trial_end,
         updated_at=now()`,
      [
        tenantId,
        customerId,
        subscriptionId,
        priceId,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd,
        trialEnd
      ]
    );

    return { ok: true, plan };
  }
}

