import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createQueueFromEnv } from '../../../packages/stores/src/queue.js';
import { createGraphAgentWorker } from './graph-agent-worker.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const tenantId = process.env.TENANT_ID ?? '';
  if (!tenantId) throw new Error('TENANT_ID is required');

  const store = await createGraphStoreFromEnv({ repoFullName: 'worker' });
  const graphQueue = await createQueueFromEnv({ queueName: 'graph' });
  if (typeof graphQueue.lease !== 'function') {
    throw new Error('queue_mode_not_supported: set GRAPHFLY_QUEUE_MODE=pg and DATABASE_URL to enable durable workers');
  }

  const worker = createGraphAgentWorker({ store });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const leased = await graphQueue.lease({ tenantId, limit: 1, lockMs: 10 * 60 * 1000 });
    const job = Array.isArray(leased) ? leased[0] : null;
    if (!job) {
      await sleep(750);
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

