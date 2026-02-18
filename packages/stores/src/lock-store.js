import { InMemoryLockStore } from '../../lock-store/src/in-memory.js';
import { PgLockStore } from '../../lock-store-pg/src/pg-lock-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgLockStorePool {
  constructor({ pool }) {
    this._pool = pool;
  }

  async tryAcquire({ tenantId, repoId, lockName, ttlMs }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgLockStore({ client });
      return store.tryAcquire({ tenantId, repoId, lockName, ttlMs });
    });
  }

  async release({ tenantId, repoId, lockName, token }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgLockStore({ client });
      return store.release({ tenantId, repoId, lockName, token });
    });
  }

  async renew({ tenantId, repoId, lockName, token, ttlMs }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgLockStore({ client });
      return store.renew({ tenantId, repoId, lockName, token, ttlMs });
    });
  }
}

export async function createLockStoreFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_LOCK_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryLockStore();

  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgLockStorePool({ pool });
}
