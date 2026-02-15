import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../packages/runtime/src/runtime.js';
import { computeGitHubSignature256 } from '../packages/github-webhooks/src/verify.js';

test('runtime: push webhook enqueues index and produces docs PR', async () => {
  const secret = 's';
  const rt = createRuntime({ githubWebhookSecret: secret, docsRepoFullName: 'org/docs' });
  rt.repoRegistry.register({ fullName: 'org/source', tenantId: 't-1', repoId: 'r-1', repoRoot: 'fixtures/sample-repo', docsRepoFullName: 'org/docs' });

  const payload = Buffer.from(
    JSON.stringify({
      ref: 'refs/heads/main',
      after: 'abc123',
      repository: { full_name: 'org/source' },
      commits: [{ added: ['server.js'], modified: ['a.js'], removed: [] }]
    }),
    'utf8'
  );
  const sig = computeGitHubSignature256({ secret, rawBody: payload });
  const res = await rt.githubWebhookHandler({
    headers: { 'x-github-delivery': 'd1', 'x-github-event': 'push', 'x-hub-signature-256': sig },
    rawBody: payload
  });
  assert.equal(res.status, 200);

  await rt.runToIdle();
  const blocks = rt.docsStore.listBlocks({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(blocks.length >= 1);
});
