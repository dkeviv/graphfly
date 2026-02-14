import { InMemoryEntitlementsStore } from '../../entitlements/src/store.js';
import { PgEntitlementsStore } from '../../entitlements-pg/src/pg-entitlements-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgEntitlementsStorePool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async getPlan(tenantId) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgEntitlementsStore({ client });
      return store.getPlan(tenantId);
    });
  }

  async setPlan(tenantId, plan) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgEntitlementsStore({ client });
      return store.setPlan(tenantId, plan);
    });
  }
}

export async function createEntitlementsStoreFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_ENTITLEMENTS_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryEntitlementsStore();

  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgEntitlementsStorePool({ pool });
}

