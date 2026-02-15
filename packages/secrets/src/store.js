import { encryptString, decryptString } from './crypto.js';

export class InMemorySecretsStore {
  constructor({ env = process.env } = {}) {
    // Dev-friendly: use a deterministic in-memory key if none configured.
    // Prod should set GRAPHFLY_SECRET_KEY explicitly.
    const hasKey = Boolean(env.GRAPHFLY_SECRET_KEYS || env.GRAPHFLY_SECRET_KEY);
    this._env = hasKey ? env : { ...env, GRAPHFLY_SECRET_KEYS: `dev:${Buffer.alloc(32, 1).toString('base64')}` };
    this._byOrg = new Map(); // orgId -> Map(key -> ciphertext)
  }

  _m(orgId) {
    const k = String(orgId ?? '');
    const existing = this._byOrg.get(k);
    if (existing) return existing;
    const m = new Map();
    this._byOrg.set(k, m);
    return m;
  }

  async setSecret({ tenantId, key, value }) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!key) throw new Error('key is required');
    const ct = encryptString({ plaintext: value, env: this._env });
    this._m(tenantId).set(String(key), ct);
    return { ok: true };
  }

  async getSecret({ tenantId, key }) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!key) throw new Error('key is required');
    const ct = this._m(tenantId).get(String(key)) ?? null;
    if (!ct) return null;
    return decryptString({ ciphertext: ct, env: this._env });
  }

  async deleteSecret({ tenantId, key }) {
    if (!tenantId) throw new Error('tenantId is required');
    if (!key) throw new Error('key is required');
    this._m(tenantId).delete(String(key));
    return { ok: true };
  }
}
