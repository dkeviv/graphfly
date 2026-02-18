import crypto from 'node:crypto';

function nowMs() {
  return Date.now();
}

export class InMemoryLockStore {
  constructor() {
    this._locks = new Map(); // key -> { token, expiresAtMs }
  }

  async tryAcquire({ tenantId, repoId, lockName, ttlMs = 10 * 60 * 1000 }) {
    const k = `${tenantId}::${repoId}::${lockName}`;
    const cur = this._locks.get(k);
    const t = nowMs();
    if (cur && cur.expiresAtMs > t) return { acquired: false };
    const token = crypto.randomUUID();
    this._locks.set(k, { token, expiresAtMs: t + ttlMs });
    return { acquired: true, token, expiresAtMs: t + ttlMs };
  }

  async release({ tenantId, repoId, lockName, token }) {
    const k = `${tenantId}::${repoId}::${lockName}`;
    const cur = this._locks.get(k);
    if (!cur) return { released: false };
    if (cur.token !== token) return { released: false };
    this._locks.delete(k);
    return { released: true };
  }

  async renew({ tenantId, repoId, lockName, token, ttlMs = 10 * 60 * 1000 }) {
    const k = `${tenantId}::${repoId}::${lockName}`;
    const cur = this._locks.get(k);
    const t = nowMs();
    if (!cur) return { ok: true, updated: false };
    if (cur.token !== token) return { ok: true, updated: false };
    if (cur.expiresAtMs <= t) return { ok: true, updated: false };
    cur.expiresAtMs = t + ttlMs;
    return { ok: true, updated: true, expiresAtMs: cur.expiresAtMs };
  }
}
