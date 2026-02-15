import { PgWebhookDeliveryDedupe } from '../../github-webhooks-pg/src/pg-delivery-dedupe.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgWebhookDeliveryDedupePool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async tryInsert({ provider, deliveryId, eventType = null, tenantId = null, repoId = null }) {
    // When tenantId is null (pre-routing), we can't set app.tenant_id; use raw client.
    if (!tenantId) {
      const client = await this._pool.connect();
      try {
        const store = new PgWebhookDeliveryDedupe({ client });
        return await store.tryInsert({ provider, deliveryId, eventType, tenantId, repoId });
      } finally {
        client.release();
      }
    }
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgWebhookDeliveryDedupe({ client });
      return store.tryInsert({ provider, deliveryId, eventType, tenantId, repoId });
    });
  }
}

export async function createWebhookDeliveryDedupeFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_WEBHOOK_DEDUPE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return null;
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgWebhookDeliveryDedupePool({ pool });
}

