import { InMemoryOrgStore } from '../../orgs/src/store.js';
import { PgOrgStore } from '../../orgs-pg/src/pg-org-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgOrgStorePool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async getOrg({ tenantId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgStore({ client });
      return store.getOrg({ tenantId });
    });
  }

  async ensureOrg({ tenantId, name }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgStore({ client });
      return store.ensureOrg({ tenantId, name });
    });
  }

  async upsertOrg({ tenantId, patch }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgStore({ client });
      return store.upsertOrg({ tenantId, patch });
    });
  }
}

export async function createOrgStoreFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_ORG_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryOrgStore();
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgOrgStorePool({ pool });
}

