import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGitHubSignature256, verifyGitHubSignature256 } from '../packages/github-webhooks/src/verify.js';
import { DeliveryDedupe } from '../packages/github-webhooks/src/dedupe.js';
import { makeGitHubWebhookHandler } from '../apps/api/src/github-webhook.js';

test('verifyGitHubSignature256 validates sha256 signature', () => {
  const secret = 's3cr3t';
  const rawBody = Buffer.from('{"ok":true}', 'utf8');
  const sig = computeGitHubSignature256({ secret, rawBody });
  assert.deepEqual(verifyGitHubSignature256({ secret, rawBody, signature256: sig }), { ok: true });
  assert.equal(verifyGitHubSignature256({ secret, rawBody, signature256: 'sha256=badsig' }).ok, false);
});

test('GitHub webhook handler dedupes by delivery id and rejects bad signatures', async () => {
  const secret = 's3cr3t';
  const dedupe = new DeliveryDedupe();
  const pushes = [];
  const handler = makeGitHubWebhookHandler({
    secret,
    dedupe,
    onPush: async (p) => pushes.push(p)
  });

  const payload = Buffer.from(
    JSON.stringify({
      ref: 'refs/heads/main',
      after: 'abc123',
      repository: { id: 123, full_name: 'org/repo' },
      commits: [{ added: ['a.js'], modified: ['b.js'], removed: ['c.js'] }]
    }),
    'utf8'
  );

  const bad = await handler({
    headers: { 'x-github-delivery': 'd1', 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=badsig' },
    rawBody: payload
  });
  assert.equal(bad.status, 401);
  assert.equal(pushes.length, 0);

  const sig = computeGitHubSignature256({ secret, rawBody: payload });
  const ok = await handler({
    headers: { 'x-github-delivery': 'd1', 'x-github-event': 'push', 'x-hub-signature-256': sig },
    rawBody: payload
  });
  assert.equal(ok.status, 200);
  assert.equal(pushes.length, 1);

  const dup = await handler({
    headers: { 'x-github-delivery': 'd1', 'x-github-event': 'push', 'x-hub-signature-256': sig },
    rawBody: payload
  });
  assert.equal(dup.status, 202);
  assert.equal(pushes.length, 1);
});
