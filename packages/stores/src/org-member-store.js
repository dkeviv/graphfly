import { InMemoryOrgMemberStore } from '../../org-members/src/store.js';
import { PgOrgMemberStore } from '../../org-members-pg/src/pg-org-member-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgOrgMemberStorePool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async upsertMember({ tenantId, userId, role }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgMemberStore({ client });
      return store.upsertMember({ tenantId, userId, role });
    });
  }

  async getMember({ tenantId, userId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgMemberStore({ client });
      return store.getMember({ tenantId, userId });
    });
  }

  async listMembers({ tenantId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgMemberStore({ client });
      return store.listMembers({ tenantId });
    });
  }

  async removeMember({ tenantId, userId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgOrgMemberStore({ client });
      return store.removeMember({ tenantId, userId });
    });
  }
}

export async function createOrgMemberStoreFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_ORG_MEMBER_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryOrgMemberStore();
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgOrgMemberStorePool({ pool });
}

