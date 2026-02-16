import crypto from 'node:crypto';

export class PgLockStore {
  constructor({ client }) {
    this._c = client;
  }

  async tryAcquire({ tenantId, repoId, lockName, ttlMs = 10 * 60 * 1000 }) {
    const token = crypto.randomUUID();
    const ttlSec = Math.max(1, Math.trunc(ttlMs / 1000));

    const res = await this._c.query(
      `INSERT INTO agent_locks (tenant_id, repo_id, lock_name, lock_token, locked_at, lock_expires_at)
       VALUES ($1, $2, $3, $4, now(), now() + ($5 * interval '1 second'))
       ON CONFLICT (tenant_id, repo_id, lock_name) DO UPDATE SET
         lock_token=EXCLUDED.lock_token,
         locked_at=now(),
         lock_expires_at=EXCLUDED.lock_expires_at
       WHERE agent_locks.lock_expires_at < now()
       RETURNING lock_token, lock_expires_at`,
      [tenantId, repoId, lockName, token, ttlSec]
    );

    if (res.rowCount === 0) return { acquired: false };
    return { acquired: true, token: res.rows[0].lock_token, expiresAt: res.rows[0].lock_expires_at };
  }

  async release({ tenantId, repoId, lockName, token }) {
    const res = await this._c.query(
      `DELETE FROM agent_locks
       WHERE tenant_id=$1 AND repo_id=$2 AND lock_name=$3 AND lock_token=$4`,
      [tenantId, repoId, lockName, token]
    );
    return { released: res.rowCount > 0 };
  }
}

