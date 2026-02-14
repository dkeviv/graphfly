import { InMemoryUsageCounters } from '../../usage/src/in-memory.js';
import { PgUsageCounters } from '../../usage-pg/src/pg-usage-counters.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgUsageCountersPool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async consumeIndexJobOrDeny(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgUsageCounters({ client });
      return store.consumeIndexJobOrDeny(args);
    });
  }

  async consumeDocBlocksOrDeny(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgUsageCounters({ client });
      return store.consumeDocBlocksOrDeny(args);
    });
  }

  async getIndexJobsToday(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgUsageCounters({ client });
      return store.getIndexJobsToday(args);
    });
  }

  async getDocBlocksThisMonth(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgUsageCounters({ client });
      return store.getDocBlocksThisMonth(args);
    });
  }
}

export async function createUsageCountersFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_USAGE_COUNTERS ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryUsageCounters();

  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgUsageCountersPool({ pool });
}
