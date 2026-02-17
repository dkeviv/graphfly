import crypto from 'node:crypto';

function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

function normalizeStatus(v) {
  const s = String(v ?? '').toLowerCase();
  if (s === 'queued' || s === 'active' || s === 'succeeded' || s === 'failed' || s === 'dead') return s;
  return 'queued';
}

export class PgQueue {
  constructor({ client, queueName } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    if (!queueName) throw new Error('queueName is required');
    this._c = client;
    this._q = String(queueName);
  }

  _clampLockMs(lockMs) {
    return Number.isFinite(lockMs) ? Math.max(5000, Math.min(10 * 60 * 1000, Math.trunc(lockMs))) : 60000;
  }

  async add(jobName, payload, { runAt = null, maxAttempts = 5 } = {}) {
    const tenantId = payload?.tenantId ?? payload?.tenant_id ?? null;
    assertUuid(tenantId, 'payload.tenantId');
    const repoId = payload?.repoId ?? payload?.repo_id ?? null;
    if (repoId != null) assertUuid(String(repoId), 'payload.repoId');
    const ma = Number.isFinite(maxAttempts) ? Math.max(1, Math.min(50, Math.trunc(maxAttempts))) : 5;
    const res = await this._c.query(
      `INSERT INTO jobs (tenant_id, repo_id, queue_name, job_name, payload, status, run_at, max_attempts)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', COALESCE($6::timestamptz, now()), $7)
       RETURNING id`,
      [tenantId, repoId, this._q, String(jobName), JSON.stringify(payload ?? {}), runAt, ma]
    );
    return { id: res.rows?.[0]?.id ?? null, name: String(jobName), payload };
  }

  async lease({ tenantId, limit = 1, lockMs = 60000 } = {}) {
    assertUuid(tenantId, 'tenantId');
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 1;
    const lm = this._clampLockMs(lockMs);
    const lockToken = crypto.randomUUID();
    const res = await this._c.query(
      `WITH expired_dead AS (
         UPDATE jobs
         SET status='dead',
             locked_at=NULL,
             lock_expires_at=NULL,
             lock_token=NULL,
             updated_at=now(),
             last_error=COALESCE(last_error, 'lock_expired_active')
         WHERE tenant_id=$1
           AND queue_name=$2
           AND status='active'
           AND (lock_expires_at IS NULL OR lock_expires_at <= now())
           AND attempts >= max_attempts
         RETURNING id
       ),
       picked AS (
         SELECT id
         FROM jobs
         WHERE tenant_id=$1
           AND queue_name=$2
           AND attempts < max_attempts
           AND (
             (status='queued' AND run_at <= now())
             OR (status='active' AND (lock_expires_at IS NULL OR lock_expires_at <= now()))
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $3
       )
       UPDATE jobs j
       SET status='active',
           locked_at=now(),
           lock_expires_at=now() + ($4::int * interval '1 millisecond'),
           lock_token=$5,
           attempts=attempts + 1,
           updated_at=now()
       FROM picked
       WHERE j.id = picked.id
       RETURNING j.id, j.job_name, j.payload`,
      [tenantId, this._q, n, lm, lockToken]
    );
    const rows = res.rows ?? [];
    return rows.map((r) => ({ id: r.id, name: r.job_name, payload: r.payload, lockToken }));
  }

  // Global leasing across tenants.
  // Requires the DB role to have BYPASSRLS (or equivalent) so the jobs table can be read without tenant scoping.
  // The worker is expected to set tenant context per job when calling stores (withTenantClient).
  async leaseAny({ limit = 1, lockMs = 60000 } = {}) {
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 1;
    const lm = this._clampLockMs(lockMs);
    const lockToken = crypto.randomUUID();
    const res = await this._c.query(
      `WITH expired_dead AS (
         UPDATE jobs
         SET status='dead',
             locked_at=NULL,
             lock_expires_at=NULL,
             lock_token=NULL,
             updated_at=now(),
             last_error=COALESCE(last_error, 'lock_expired_active')
         WHERE queue_name=$1
           AND status='active'
           AND (lock_expires_at IS NULL OR lock_expires_at <= now())
           AND attempts >= max_attempts
         RETURNING id
       ),
       picked AS (
         SELECT id
         FROM jobs
         WHERE queue_name=$1
           AND attempts < max_attempts
           AND (
             (status='queued' AND run_at <= now())
             OR (status='active' AND (lock_expires_at IS NULL OR lock_expires_at <= now()))
           )
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE jobs j
       SET status='active',
           locked_at=now(),
           lock_expires_at=now() + ($3::int * interval '1 millisecond'),
           lock_token=$4,
           attempts=attempts + 1,
           updated_at=now()
       FROM picked
       WHERE j.id = picked.id
       RETURNING j.id, j.tenant_id, j.job_name, j.payload`,
      [this._q, n, lm, lockToken]
    );
    const rows = res.rows ?? [];
    return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, name: r.job_name, payload: r.payload, lockToken }));
  }

  async renew({ tenantId, jobId, lockToken, lockMs = 60000 } = {}) {
    assertUuid(tenantId, 'tenantId');
    assertUuid(jobId, 'jobId');
    const lm = this._clampLockMs(lockMs);
    const res = await this._c.query(
      `UPDATE jobs
       SET locked_at=now(),
           lock_expires_at=now() + ($4::int * interval '1 millisecond'),
           updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND lock_token=$3 AND status='active'`,
      [tenantId, jobId, String(lockToken ?? ''), lm]
    );
    return { ok: true, updated: (res.rowCount ?? 0) > 0 };
  }

  async complete({ tenantId, jobId, lockToken } = {}) {
    assertUuid(tenantId, 'tenantId');
    assertUuid(jobId, 'jobId');
    const res = await this._c.query(
      `UPDATE jobs
       SET status='succeeded', completed_at=now(), updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND lock_token=$3 AND status='active'`,
      [tenantId, jobId, String(lockToken ?? '')]
    );
    return { ok: true, updated: (res.rowCount ?? 0) > 0 };
  }

  async fail({ tenantId, jobId, lockToken, errorMessage = 'unknown', backoffSec = 30 } = {}) {
    assertUuid(tenantId, 'tenantId');
    assertUuid(jobId, 'jobId');
    const bo = Number.isFinite(backoffSec) ? Math.max(0, Math.min(24 * 3600, Math.trunc(backoffSec))) : 30;
    const msg = String(errorMessage ?? 'unknown');
    const res = await this._c.query(
      `UPDATE jobs
       SET
         last_error=$4,
         status=CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         run_at=CASE WHEN attempts >= max_attempts THEN run_at ELSE now() + ($5::int * interval '1 second') END,
         locked_at=NULL,
         lock_expires_at=NULL,
         lock_token=NULL,
         updated_at=now()
       WHERE tenant_id=$1 AND id=$2 AND lock_token=$3 AND status='active'`,
      [tenantId, jobId, String(lockToken ?? ''), msg, bo]
    );
    return { ok: true, updated: (res.rowCount ?? 0) > 0 };
  }

  async getJob({ tenantId, jobId } = {}) {
    assertUuid(tenantId, 'tenantId');
    assertUuid(jobId, 'jobId');
    const res = await this._c.query(
      `SELECT id, queue_name, job_name, status, attempts, max_attempts, run_at, locked_at, lock_expires_at, completed_at, last_error, created_at, updated_at
       FROM jobs
       WHERE tenant_id=$1 AND id=$2
       LIMIT 1`,
      [tenantId, jobId]
    );
    const r = res.rows?.[0] ?? null;
    if (!r) return null;
    return {
      id: r.id,
      queueName: r.queue_name,
      jobName: r.job_name,
      status: normalizeStatus(r.status),
      attempts: Number(r.attempts ?? 0),
      maxAttempts: Number(r.max_attempts ?? 0),
      runAt: r.run_at,
      lockedAt: r.locked_at,
      lockExpiresAt: r.lock_expires_at,
      completedAt: r.completed_at,
      lastError: r.last_error ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }

  async listJobs({ tenantId, status = null, limit = 50 } = {}) {
    assertUuid(tenantId, 'tenantId');
    const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
    const st = status != null ? normalizeStatus(status) : null;
    const res = await this._c.query(
      `SELECT id, queue_name, job_name, status, attempts, max_attempts, run_at, locked_at, lock_expires_at, completed_at, last_error, created_at, updated_at
       FROM jobs
       WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2)
       ORDER BY created_at DESC
       LIMIT $3`,
      [tenantId, st, n]
    );
    return (res.rows ?? []).map((r) => ({
      id: r.id,
      queueName: r.queue_name,
      jobName: r.job_name,
      status: normalizeStatus(r.status),
      attempts: Number(r.attempts ?? 0),
      maxAttempts: Number(r.max_attempts ?? 0),
      runAt: r.run_at,
      completedAt: r.completed_at,
      lastError: r.last_error ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
}
