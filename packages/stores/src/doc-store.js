import { InMemoryDocStore } from '../../doc-store/src/in-memory.js';
import { PgDocStore } from '../../doc-store-pg/src/pg-doc-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgDocStorePool {
  constructor({ pool, repoFullName = 'local/unknown' }) {
    this._pool = pool;
    this._repoFullName = repoFullName;
  }

  async upsertBlock(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.upsertBlock(args);
    });
  }

  async listBlocks(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.listBlocks(args);
    });
  }

  async getBlock(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.getBlock(args);
    });
  }

  async setEvidence(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.setEvidence(args);
    });
  }

  async getEvidence(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.getEvidence(args);
    });
  }

  async markBlocksStaleForSymbolUids(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.markBlocksStaleForSymbolUids(args);
    });
  }

  async createPrRun(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.createPrRun(args);
    });
  }

  async updatePrRun(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.updatePrRun(args);
    });
  }

  async listPrRuns(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.listPrRuns(args);
    });
  }

  async getPrRun(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgDocStore({ client, repoFullName: this._repoFullName });
      return store.getPrRun(args);
    });
  }
}

export async function createDocStoreFromEnv({ repoFullName = 'local/unknown' } = {}) {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_DOC_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryDocStore();

  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgDocStorePool({ pool, repoFullName });
}
