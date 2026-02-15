function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

export class PgWebhookDeliveryDedupe {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async tryInsert({ provider, deliveryId, eventType = null, tenantId = null, repoId = null }) {
    if (!provider) throw new Error('provider is required');
    if (!deliveryId) throw new Error('deliveryId is required');
    if (tenantId) assertUuid(tenantId, 'tenantId');
    if (repoId) assertUuid(repoId, 'repoId');
    const res = await this._c.query(
      `INSERT INTO webhook_deliveries (provider, delivery_id, event_type, tenant_id, repo_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (provider, delivery_id) DO NOTHING
       RETURNING id`,
      [String(provider), String(deliveryId), eventType ? String(eventType) : null, tenantId, repoId]
    );
    return { inserted: Boolean(res.rows?.[0]?.id) };
  }
}

