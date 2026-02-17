import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createDocStoreFromEnv } from '../../../packages/stores/src/doc-store.js';
import { createQueueFromEnv } from '../../../packages/stores/src/queue.js';
import { startQueueHeartbeat } from '../../../packages/stores/src/queue-heartbeat.js';
import { createIndexerWorker } from './indexer-worker.js';
import { createRealtimePublisherFromEnv } from '../../../packages/realtime/src/publisher.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const configuredTenantId = process.env.TENANT_ID ?? null;

  const store = await createGraphStoreFromEnv({ repoFullName: 'worker' });
  const docStore = await createDocStoreFromEnv({ repoFullName: 'worker' });
  const indexQueue = await createQueueFromEnv({ queueName: 'index' });
  const docQueue = await createQueueFromEnv({ queueName: 'doc' });
  const graphQueue = await createQueueFromEnv({ queueName: 'graph' });
  const realtime = createRealtimePublisherFromEnv() ?? null;

  const canLease = typeof indexQueue.lease === 'function';
  const canLeaseAny = typeof indexQueue.leaseAny === 'function';
  if (!canLease) {
    throw new Error('queue_mode_not_supported: set GRAPHFLY_QUEUE_MODE=pg and DATABASE_URL to enable durable workers');
  }
  if (!configuredTenantId && !canLeaseAny) {
    throw new Error('queue_global_lease_not_supported: update queue implementation or set TENANT_ID');
  }

  const worker = createIndexerWorker({ store, docQueue, docStore, graphQueue, realtime });
  const lockMs = 5 * 60 * 1000;

  // Phase-1: single concurrency. Supports:
  // - single-tenant mode: set TENANT_ID (strict RLS lane)
  // - multi-tenant mode: unset TENANT_ID and run with a DB role that can lease jobs across tenants (BYPASSRLS).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const leased = configuredTenantId
      ? await indexQueue.lease({ tenantId: configuredTenantId, limit: 1, lockMs })
      : await indexQueue.leaseAny({ limit: 1, lockMs });
    const job = Array.isArray(leased) ? leased[0] : null;
    if (!job) {
      await sleep(750);
      continue;
    }
    const tenantId = job.tenantId ?? job.payload?.tenantId ?? job.payload?.tenant_id ?? null;
    if (!tenantId) {
      // Cannot safely process without tenant context.
      await sleep(250);
      continue;
    }
    const hb = startQueueHeartbeat({
      queue: indexQueue,
      tenantId,
      jobId: job.id,
      lockToken: job.lockToken,
      lockMs,
      onLostLock: () => console.warn(`WARN: lost queue lock for index job ${job.id}`),
      onError: (e) => console.warn(`WARN: queue heartbeat failed for index job ${job.id}: ${String(e?.message ?? e)}`)
    });
    try {
      await worker.handle({ id: job.id, payload: job.payload });
      await indexQueue.complete({ tenantId, jobId: job.id, lockToken: job.lockToken });
    } catch (err) {
      await indexQueue.fail({
        tenantId,
        jobId: job.id,
        lockToken: job.lockToken,
        errorMessage: String(err?.message ?? err),
        backoffSec: 30
      });
    } finally {
      await hb.stop();
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
