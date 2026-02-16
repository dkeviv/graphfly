import { InMemoryOrgInviteStore } from '../../org-invites/src/store.js';
import { PgOrgInviteStore } from '../../org-invites-pg/src/pg-org-invite-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgOrgInviteStorePool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async createInvite({ tenantId, email, role, ttlDays }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgInviteStore({ client });
      return store.createInvite({ tenantId, email, role, ttlDays });
    });
  }

  async listInvites({ tenantId, status = null, limit = 200 }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgInviteStore({ client });
      return store.listInvites({ tenantId, status, limit });
    });
  }

  async revokeInvite({ tenantId, inviteId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgInviteStore({ client });
      return store.revokeInvite({ tenantId, inviteId });
    });
  }

  async acceptInvite({ tenantId, token, userId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgInviteStore({ client });
      return store.acceptInvite({ tenantId, token, userId });
    });
  }
}

export async function createOrgInviteStoreFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_ORG_INVITE_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryOrgInviteStore();
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgOrgInviteStorePool({ pool });
}

