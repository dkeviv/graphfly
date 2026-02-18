import { InMemoryQueue } from '../../queue/src/in-memory.js';
import { PgQueue } from '../../queue-pg/src/pg-queue.js';
import { withTenantClient } from '../../pg-client/src/tenant.js';
import { getPgPoolFromEnv } from './pg-pool.js';

export class PgQueuePool {
  constructor({ pool, queueName }) {
    if (!pool || typeof pool.connect !== 'function') throw new Error('pool.connect is required');
    if (!queueName) throw new Error('queueName is required');
    this._pool = pool;
    this._name = String(queueName);
  }

  async add(jobName, payload, opts) {
    const tenantId = payload?.tenantId ?? payload?.tenant_id ?? null;
    if (!tenantId) throw new Error('payload.tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.add(jobName, payload, opts);
    });
  }

  async lease({ tenantId, limit = 1, lockMs = 60000 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.lease({ tenantId, limit, lockMs });
    });
  }

  // Lease across all tenants. Intended for multi-tenant SaaS workers.
  // Requires DATABASE_URL (or worker DB URL) to use a role with BYPASSRLS so the jobs table can be scanned.
  async leaseAny({ limit = 1, lockMs = 60000 } = {}) {
    const client = await this._pool.connect();
    try {
      const q = new PgQueue({ client, queueName: this._name });
      return q.leaseAny({ limit, lockMs });
    } finally {
      try {
        client.release();
      } catch {}
    }
  }

  async complete({ tenantId, jobId, lockToken } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.complete({ tenantId, jobId, lockToken });
    });
  }

  async renew({ tenantId, jobId, lockToken, lockMs = 60000 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.renew({ tenantId, jobId, lockToken, lockMs });
    });
  }

  async fail({ tenantId, jobId, lockToken, errorMessage, backoffSec } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.fail({ tenantId, jobId, lockToken, errorMessage, backoffSec });
    });
  }

  async cancel({ tenantId, jobId, reason } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.cancel({ tenantId, jobId, reason });
    });
  }

  async retry({ tenantId, jobId, resetAttempts = true } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.retry({ tenantId, jobId, resetAttempts });
    });
  }

  async getJob({ tenantId, jobId } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.getJob({ tenantId, jobId });
    });
  }

  async listJobs({ tenantId, status = null, limit = 50 } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    return withTenantClient({ pool: this._pool, tenantId }, async (client) => {
      const q = new PgQueue({ client, queueName: this._name });
      return q.listJobs({ tenantId, status, limit });
    });
  }
}

export async function createQueueFromEnv({ queueName }) {
  const connectionString = process.env.DATABASE_URL ?? '';
  const mode = process.env.GRAPHFLY_QUEUE_MODE ?? (connectionString ? 'pg' : 'memory');
  if (!connectionString || mode !== 'pg') return new InMemoryQueue(String(queueName ?? 'queue'));
  const pool = await getPgPoolFromEnv({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10) });
  return new PgQueuePool({ pool, queueName });
}
