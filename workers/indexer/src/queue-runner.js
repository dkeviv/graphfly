import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createDocStoreFromEnv } from '../../../packages/stores/src/doc-store.js';
import { createQueueFromEnv } from '../../../packages/stores/src/queue.js';
import { createIndexerWorker } from './indexer-worker.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const tenantId = process.env.TENANT_ID ?? '';
  if (!tenantId) throw new Error('TENANT_ID is required');

  const store = await createGraphStoreFromEnv({ repoFullName: 'worker' });
  const docStore = await createDocStoreFromEnv({ repoFullName: 'worker' });
  const indexQueue = await createQueueFromEnv({ queueName: 'index' });
  const docQueue = await createQueueFromEnv({ queueName: 'doc' });

  if (typeof indexQueue.lease !== 'function') {
    throw new Error('queue_mode_not_supported: set GRAPHFLY_QUEUE_MODE=pg and DATABASE_URL to enable durable workers');
  }

  const worker = createIndexerWorker({ store, docQueue, docStore });

  // Phase-1: single-tenant worker loop (RLS enforced via app.tenant_id).
  // Run one job at a time; retries handled by queue.fail().
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const leased = await indexQueue.lease({ tenantId, limit: 1, lockMs: 5 * 60 * 1000 });
    const job = Array.isArray(leased) ? leased[0] : null;
    if (!job) {
      await sleep(750);
      continue;
    }
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
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

