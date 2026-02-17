import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout);
  return p.stdout.trim();
}

test('CLI local-run auto-detects source git root and writes docs to local docs repo', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-cli-'));

  const sourceRepo = path.join(base, 'source');
  fs.mkdirSync(sourceRepo);
  fs.cpSync('fixtures/sample-repo', sourceRepo, { recursive: true });
  git(sourceRepo, ['init']);
  git(sourceRepo, ['add', '-A']);
  git(sourceRepo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);

  const docsRepo = path.join(base, 'docs');
  fs.mkdirSync(docsRepo);
  git(docsRepo, ['init']);
  fs.writeFileSync(path.join(docsRepo, 'README.md'), '# docs\n', 'utf8');
  git(docsRepo, ['add', '-A']);
  git(docsRepo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);

  const p = spawnSync(
    'node',
    [
      path.resolve('apps/cli/src/graphfly.js'),
      'local-run',
      '--docs-repo-path',
      docsRepo,
      '--docs-repo-full-name',
      'org/docs',
      '--source-repo-full-name',
      'local/source'
    ],
    { cwd: sourceRepo, encoding: 'utf8' }
  );
  assert.equal(p.status, 0, p.stderr || p.stdout);

  assert.ok(fs.existsSync(path.join(docsRepo, 'flows/http-get-health.md')));
  const branch = git(docsRepo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.ok(branch.startsWith('docs/update-'));
});

test('CLI local-run rejects docs repo path inside source repo', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-cli-'));

  const sourceRepo = path.join(base, 'source');
  fs.mkdirSync(sourceRepo);
  fs.cpSync('fixtures/sample-repo', sourceRepo, { recursive: true });
  git(sourceRepo, ['init']);
  git(sourceRepo, ['add', '-A']);
  git(sourceRepo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);

  const docsRepoInside = path.join(sourceRepo, 'docs');
  fs.mkdirSync(docsRepoInside);
  git(docsRepoInside, ['init']);
  fs.writeFileSync(path.join(docsRepoInside, 'README.md'), '# docs\n', 'utf8');
  git(docsRepoInside, ['add', '-A']);
  git(docsRepoInside, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init']);

  const p = spawnSync(
    'node',
    [
      path.resolve('apps/cli/src/graphfly.js'),
      'local-run',
      '--docs-repo-path',
      docsRepoInside,
      '--docs-repo-full-name',
      'org/docs',
      '--source-repo-full-name',
      'local/source'
    ],
    { cwd: sourceRepo, encoding: 'utf8' }
  );
  assert.equal(p.status, 2);
  assert.ok((p.stderr || '').includes('docs_repo_must_be_separate_from_source_repo'));
});
