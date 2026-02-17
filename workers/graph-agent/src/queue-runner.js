import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createQueueFromEnv } from '../../../packages/stores/src/queue.js';
import { createLockStoreFromEnv } from '../../../packages/stores/src/lock-store.js';
import { createGraphAgentWorker } from './graph-agent-worker.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const configuredTenantId = process.env.TENANT_ID ?? null;

  const store = await createGraphStoreFromEnv({ repoFullName: 'worker' });
  const lockStore = await createLockStoreFromEnv();
  const graphQueue = await createQueueFromEnv({ queueName: 'graph' });
  if (typeof graphQueue.lease !== 'function') {
    throw new Error('queue_mode_not_supported: set GRAPHFLY_QUEUE_MODE=pg and DATABASE_URL to enable durable workers');
  }
  if (!configuredTenantId && typeof graphQueue.leaseAny !== 'function') {
    throw new Error('queue_global_lease_not_supported: update queue implementation or set TENANT_ID');
  }

  const worker = createGraphAgentWorker({ store, lockStore });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const leased = configuredTenantId
      ? await graphQueue.lease({ tenantId: configuredTenantId, limit: 1, lockMs: 10 * 60 * 1000 })
      : await graphQueue.leaseAny({ limit: 1, lockMs: 10 * 60 * 1000 });
    const job = Array.isArray(leased) ? leased[0] : null;
    if (!job) {
      await sleep(750);
      continue;
    }
    const tenantId = job.tenantId ?? job.payload?.tenantId ?? job.payload?.tenant_id ?? null;
    if (!tenantId) {
      await sleep(250);
      continue;
    }
    try {
      await worker.handle({ id: job.id, payload: job.payload });
      await graphQueue.complete({ tenantId, jobId: job.id, lockToken: job.lockToken });
    } catch (err) {
      await graphQueue.fail({
        tenantId,
        jobId: job.id,
        lockToken: job.lockToken,
        errorMessage: String(err?.message ?? err),
        backoffSec: 60
      });
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
