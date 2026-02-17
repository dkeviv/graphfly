import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRuntime } from '../packages/runtime/src/runtime.js';
import { computeGitHubSignature256 } from '../packages/github-webhooks/src/verify.js';

function git(cwd, args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout);
  return p.stdout.trim();
}

test('runtime: local docs repo path writes flow docs on a new branch', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-rt-docs-'));
  const docsRepoPath = path.join(base, 'docs-repo');
  fs.mkdirSync(docsRepoPath);
  git(docsRepoPath, ['init']);
  fs.writeFileSync(path.join(docsRepoPath, 'README.md'), '# docs\n', 'utf8');
  git(docsRepoPath, ['add', '.']);
  git(docsRepoPath, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);

  const secret = 's';
  const rt = createRuntime({ githubWebhookSecret: secret, docsRepoFullName: 'org/docs', docsRepoPath });
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

  const branch = git(docsRepoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.ok(branch.startsWith('docs/update-'));
  assert.ok(fs.existsSync(path.join(docsRepoPath, 'flows/http-get-health.md')));
});
