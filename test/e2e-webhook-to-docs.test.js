import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';
import { createDocWorker } from '../workers/doc-agent/src/doc-worker.js';
import { GitHubDocsWriter } from '../packages/github-service/src/docs-writer.js';
import { computeGitHubSignature256 } from '../packages/github-webhooks/src/verify.js';
import { DeliveryDedupe } from '../packages/github-webhooks/src/dedupe.js';
import { makeGitHubWebhookHandler } from '../apps/api/src/github-webhook.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';

test('e2e: GitHub push webhook -> index job -> doc PR (docs repo only)', async () => {
  const store = new InMemoryGraphStore();
  const indexQueue = new InMemoryQueue('index');
  const docQueue = new InMemoryQueue('doc');

  const docStore = new InMemoryDocStore();
  const indexer = createIndexerWorker({ store, docQueue, docStore });
  const docsWriter = new GitHubDocsWriter({ configuredDocsRepoFullName: 'org/docs' });
  const docWorker = createDocWorker({ store, docsWriter, docStore });

  const secret = 'whsec_github';
  const dedupe = new DeliveryDedupe();
  const handler = makeGitHubWebhookHandler({
    secret,
    dedupe,
    onPush: async (push) => {
      indexQueue.add('index.run', {
        tenantId: 't-1',
        repoId: 'r-1',
        repoRoot: 'fixtures/sample-repo',
        sha: push.sha,
        changedFiles: push.changedFiles,
        docsRepoFullName: 'org/docs'
      });
    }
  });

  const payload = Buffer.from(
    JSON.stringify({
      ref: 'refs/heads/main',
      after: 'abc123',
      repository: { full_name: 'org/source' },
      commits: [{ added: ['server.js'], modified: [], removed: [] }]
    }),
    'utf8'
  );
  const sig = computeGitHubSignature256({ secret, rawBody: payload });
  const res = await handler({
    headers: { 'x-github-delivery': 'd1', 'x-github-event': 'push', 'x-hub-signature-256': sig },
    rawBody: payload
  });
  assert.equal(res.status, 200);

  for (const job of indexQueue.drain()) await indexer.handle(job);
  const docJobs = docQueue.drain();
  assert.equal(docJobs.length, 1);

  const out = await docWorker.handle({ payload: { ...docJobs[0].payload, docsRepoFullName: 'org/docs' } });
  assert.equal(out.ok, true);
  assert.equal(out.pr.targetRepoFullName, 'org/docs');
  assert.ok(out.pr.filesCount >= 1);

  // Flow graphs should be materialized for entrypoints.
  const fgs = store.listFlowGraphs({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(fgs.length >= 1);
});
