import { InMemoryRepoStore } from '../../repos/src/store.js';
import { PgRepoStore } from '../../repos-pg/src/pg-repo-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgRepoStorePool {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
  }

  async listRepos({ tenantId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgRepoStore({ client });
      return store.listRepos({ tenantId });
    });
  }

  async getRepo({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgRepoStore({ client });
      return store.getRepo({ tenantId, repoId });
    });
  }

  async findRepoByFullName({ fullName }) {
    if (!fullName) throw new Error('fullName is required');
    const pool = this._pool;
    const client = await pool.connect();
    try {
      const store = new PgRepoStore({ client });
      return await store.findRepoByFullName({ fullName });
    } finally {
      client.release();
    }
  }

  async createRepo({ tenantId, fullName, defaultBranch, githubRepoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgRepoStore({ client });
      return store.createRepo({ tenantId, fullName, defaultBranch, githubRepoId });
    });
  }

  async deleteRepo({ tenantId, repoId }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgRepoStore({ client });
      return store.deleteRepo({ tenantId, repoId });
    });
  }
}

export async function createRepoStoreFromEnv() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_REPO_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryRepoStore();
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgRepoStorePool({ pool });
}

