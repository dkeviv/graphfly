import { InMemorySecretsStore } from '../../secrets/src/store.js';
import { PgSecretsStore } from '../../secrets-pg/src/pg-secrets-store.js';
import { encryptString, decryptString } from '../../secrets/src/crypto.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgSecretsStorePool {
  constructor({ pool, env = process.env } = {}) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    this._pool = pool;
    this._env = env;
  }

  async setSecret({ tenantId, key, value }) {
    const ciphertext = encryptString({ plaintext: value, env: this._env });
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgSecretsStore({ client });
      return store.setSecret({ tenantId, key, ciphertext });
    });
  }

  async getSecret({ tenantId, key }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgSecretsStore({ client });
      const ciphertext = await store.getSecret({ tenantId, key });
      if (!ciphertext) return null;
      return decryptString({ ciphertext, env: this._env });
    });
  }

  async deleteSecret({ tenantId, key }) {
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const store = new PgSecretsStore({ client });
      return store.deleteSecret({ tenantId, key });
    });
  }
}

export async function createSecretsStoreFromEnv({ env = process.env } = {}) {
  const connectionString = env.DATABASE_URL ?? '';
  const mode = env.GRAPHFLY_SECRETS_STORE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemorySecretsStore({ env });

  const pool = await getPgPoolFromEnv({ connectionString, max: Number(env.PG_POOL_MAX ?? 10) });
  return new PgSecretsStorePool({ pool, env });
}

