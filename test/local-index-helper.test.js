import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { enqueueLocalFullIndexOnRepoCreate } from '../apps/api/src/lib/local-index.js';

function runGit(cwd, args) {
  const res = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (res.status !== 0) {
    const err = new Error(`git_failed:${args.join(' ')}`);
    err.stdout = res.stdout;
    err.stderr = res.stderr;
    throw err;
  }
  return String(res.stdout ?? '').trim();
}

test('enqueueLocalFullIndexOnRepoCreate enqueues index.run using local repoRoot HEAD sha', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-local-repo-'));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });

  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hi\n');
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'init']);
  const sha = runGit(repoRoot, ['rev-parse', 'HEAD']);

  const calls = [];
  const indexQueue = {
    async add(name, payload) {
      calls.push({ name, payload });
      return { id: 'job:1', name, payload };
    }
  };

  const job = await enqueueLocalFullIndexOnRepoCreate({
    tenantId: 't1',
    repo: { id: 'r1', fullName: 'local/repo' },
    org: { docsRepoFullName: 'acme/docs' },
    indexQueue,
    repoRoot
  });

  assert.equal(job.name, 'index.run');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.cloneSource, null);
  assert.equal(calls[0].payload.sha, sha);
  assert.equal(calls[0].payload.docsRepoFullName, 'acme/docs');
  assert.ok(String(calls[0].payload.repoRoot).length > 0);
});

test('enqueueLocalFullIndexOnRepoCreate errors when docs repo is missing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-local-repo-'));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hi\n');
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'init']);

  await assert.rejects(
    () =>
      enqueueLocalFullIndexOnRepoCreate({
        tenantId: 't1',
        repo: { id: 'r1', fullName: 'local/repo' },
        org: {},
        indexQueue: { add: async () => ({ id: 'job:1' }) },
        repoRoot
      }),
    (e) => String(e?.code ?? e?.message) === 'docs_repo_not_configured'
  );
});

test('enqueueLocalFullIndexOnRepoCreate errors when repoRoot is not a git repo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-local-repo-'));
  const repoRoot = path.join(tmp, 'not-a-git-repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hi\n');
  await assert.rejects(
    () =>
      enqueueLocalFullIndexOnRepoCreate({
        tenantId: 't1',
        repo: { id: 'r1', fullName: 'local/repo' },
        org: { docsRepoFullName: 'acme/docs' },
        indexQueue: { add: async () => ({ id: 'job:1' }) },
        repoRoot
      }),
    (e) => String(e?.code ?? e?.message) === 'local_repo_not_git'
  );
});

