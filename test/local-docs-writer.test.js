import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalDocsWriter } from '../packages/github-service/src/local-docs-writer.js';

function git(cwd, args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout);
  return p.stdout.trim();
}

test('LocalDocsWriter writes docs to docs repo only and commits on a new branch', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-docs-'));
  const docs = path.join(base, 'docs-repo');
  fs.mkdirSync(docs);
  git(docs, ['init']);
  fs.writeFileSync(path.join(docs, 'README.md'), '# docs\n', 'utf8');
  git(docs, ['add', '.']);
  git(docs, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);

  const w = new LocalDocsWriter({ configuredDocsRepoFullName: 'org/docs', docsRepoPath: docs });
  const res = await w.openPullRequest({
    targetRepoFullName: 'org/docs',
    title: 'Update flows',
    body: 'test',
    branchName: 'graphfly/test-branch',
    files: [{ path: 'flows/health.md', content: '## health\n' }]
  });

  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(path.join(docs, 'flows/health.md')));
  assert.equal(git(docs, ['rev-parse', '--abbrev-ref', 'HEAD']), 'graphfly/test-branch');
  assert.ok(res.commit);
});

