import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createDocStoreFromEnv } from '../../../packages/stores/src/doc-store.js';
import { createQueueFromEnv } from '../../../packages/stores/src/queue.js';
import { createOrgStoreFromEnv } from '../../../packages/stores/src/org-store.js';
import { createEntitlementsStoreFromEnv } from '../../../packages/stores/src/entitlements-store.js';
import { createUsageCountersFromEnv } from '../../../packages/stores/src/usage-counters.js';
import { createDocWorker } from './doc-worker.js';
import { GitHubDocsWriter } from '../../../packages/github-service/src/docs-writer.js';
import { LocalDocsWriter } from '../../../packages/github-service/src/local-docs-writer.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function privateKeyPemFromEnv() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
  if (!raw) return null;
  return raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
}

async function main() {
  const tenantId = process.env.TENANT_ID ?? '';
  if (!tenantId) throw new Error('TENANT_ID is required');

  const store = await createGraphStoreFromEnv({ repoFullName: 'worker' });
  const docStore = await createDocStoreFromEnv({ repoFullName: 'worker' });
  const docQueue = await createQueueFromEnv({ queueName: 'doc' });
  if (typeof docQueue.lease !== 'function') {
    throw new Error('queue_mode_not_supported: set GRAPHFLY_QUEUE_MODE=pg and DATABASE_URL to enable durable workers');
  }

  const orgs = await createOrgStoreFromEnv();
  const entitlements = await createEntitlementsStoreFromEnv();
  const usageCounters = await createUsageCountersFromEnv();

  const docsRepoPath = process.env.DOCS_REPO_PATH ?? null;
  const appId = process.env.GITHUB_APP_ID ?? '';
  const privateKeyPem = privateKeyPemFromEnv();

  const docsWriterFactory = async ({ configuredDocsRepoFullName }) => {
    const org = await Promise.resolve(orgs.getOrg?.({ tenantId }));
    const docsInstallId = org?.githubDocsInstallId ?? null;
    return docsRepoPath
      ? new LocalDocsWriter({ configuredDocsRepoFullName, docsRepoPath })
      : new GitHubDocsWriter({
          configuredDocsRepoFullName,
          appId: appId || null,
          privateKeyPem,
          installationId: docsInstallId
        });
  };

  const worker = createDocWorker({ store, docsWriter: docsWriterFactory, docStore, entitlementsStore: entitlements, usageCounters });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const leased = await docQueue.lease({ tenantId, limit: 1, lockMs: 10 * 60 * 1000 });
    const job = Array.isArray(leased) ? leased[0] : null;
    if (!job) {
      await sleep(750);
      continue;
    }
    try {
      await worker.handle({ id: job.id, payload: job.payload });
      await docQueue.complete({ tenantId, jobId: job.id, lockToken: job.lockToken });
    } catch (err) {
      await docQueue.fail({
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

