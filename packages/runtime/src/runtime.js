import { InMemoryQueue } from '../../queue/src/in-memory.js';
import { InMemoryGraphStore } from '../../cig/src/store.js';
import { InMemoryDocStore } from '../../doc-store/src/in-memory.js';
import { DeliveryDedupe } from '../../github-webhooks/src/dedupe.js';
import { makeGitHubWebhookHandler } from '../../../apps/api/src/github-webhook.js';
import { createIndexerWorker } from '../../../workers/indexer/src/indexer-worker.js';
import { createDocWorker } from '../../../workers/doc-agent/src/doc-worker.js';
import { GitHubDocsWriter } from '../../github-service/src/docs-writer.js';
import { LocalDocsWriter } from '../../github-service/src/local-docs-writer.js';
import { InMemoryRepoRegistry } from './repo-registry.js';
import { InMemoryEntitlementsStore } from '../../entitlements/src/store.js';
import { InMemoryUsageCounters } from '../../usage/src/in-memory.js';

export function createRuntime({
  githubWebhookSecret,
  docsRepoFullName = 'org/docs',
  docsRepoPath = null,
  store = null,
  docStore = null,
  indexQueue = null,
  docQueue = null,
  docsWriter = null,
  repoRegistry = null,
  entitlementsStore = null,
  usageCounters = null
} = {}) {
  const graphStore = store ?? new InMemoryGraphStore();
  const docsStore = docStore ?? new InMemoryDocStore();
  const iq = indexQueue ?? new InMemoryQueue('index');
  const dq = docQueue ?? new InMemoryQueue('doc');
  const registry = repoRegistry ?? new InMemoryRepoRegistry();
  const entitlements = entitlementsStore ?? new InMemoryEntitlementsStore();
  const usage = usageCounters ?? new InMemoryUsageCounters();
  const writer =
    docsWriter ??
    (docsRepoPath
      ? new LocalDocsWriter({ configuredDocsRepoFullName: docsRepoFullName, docsRepoPath })
      : new GitHubDocsWriter({ configuredDocsRepoFullName: docsRepoFullName }));

  const indexer = createIndexerWorker({ store: graphStore, docQueue: dq, docStore: docsStore });
  const docWorker = createDocWorker({
    store: graphStore,
    docsWriter: writer,
    docStore: docsStore,
    entitlementsStore: entitlements,
    usageCounters: usage
  });

  const githubDedupe = new DeliveryDedupe();

  const githubWebhookHandler = makeGitHubWebhookHandler({
    secret: githubWebhookSecret ?? '',
    dedupe: githubDedupe,
    onPush: async (push) => {
      const reg = registry.get(push.fullName);
      if (!reg) return;
      iq.add('index.run', {
        tenantId: reg.tenantId,
        repoId: reg.repoId,
        repoRoot: reg.repoRoot ?? 'fixtures/sample-repo',
        sha: push.sha,
        changedFiles: push.changedFiles,
        removedFiles: push.removedFiles,
        docsRepoFullName: reg.docsRepoFullName ?? docsRepoFullName
      });
    }
  });

  async function runToIdle() {
    for (const job of iq.drain()) await indexer.handle(job);
    for (const job of dq.drain()) await docWorker.handle({ payload: job.payload });
  }

  return {
    graphStore,
    docsStore,
    indexQueue: iq,
    docQueue: dq,
    repoRegistry: registry,
    githubWebhookHandler,
    runToIdle
  };
}
