import { InMemoryAssistantStore } from '../../assistant-store/src/in-memory.js';
import { PgAssistantStore } from '../../assistant-store-pg/src/pg-assistant-store.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgAssistantStorePool {
  constructor({ pool, repoFullName = 'local/unknown' }) {
    this._pool = pool;
    this._repoFullName = repoFullName;
  }

  async createDraft(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.createDraft(args);
    });
  }

  async getDraft(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.getDraft(args);
    });
  }

  async listDrafts(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.listDrafts(args);
    });
  }

  async updateDraft(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.updateDraft(args);
    });
  }

  async createThread(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.createThread(args);
    });
  }

  async listThreads(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.listThreads(args);
    });
  }

  async getThread(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.getThread(args);
    });
  }

  async addMessage(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.addMessage(args);
    });
  }

  async listMessages(args) {
    const { tenantId } = args ?? {};
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgAssistantStore({ client, repoFullName: this._repoFullName });
      return store.listMessages(args);
    });
  }
}

export async function createAssistantStoreFromEnv({ repoFullName = 'local/unknown' } = {}) {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_ASSISTANT_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryAssistantStore();
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgAssistantStorePool({ pool, repoFullName });
}
