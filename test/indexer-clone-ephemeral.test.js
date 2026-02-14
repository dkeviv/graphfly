import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';

function git(cwd, args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout);
  return p.stdout.trim();
}

test('indexer clones repo at sha ephemerally when cloneSource is provided', async () => {
  const tmp = os.tmpdir();
  const before = new Set(fs.readdirSync(tmp).filter((n) => n.startsWith('graphfly-clone-')));

  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-indexer-clone-'));
  const src = path.join(base, 'src');
  fs.mkdirSync(src);

  git(src, ['init']);
  fs.writeFileSync(
    path.join(src, 'server.js'),
    [
      "import express from 'express';",
      'const app = express();',
      "app.get('/health', (_req, res) => res.json({ ok: true }));",
      'export { app };',
      ''
    ].join('\n')
  );
  git(src, ['add', '.']);
  git(src, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c1']);
  const sha1 = git(src, ['rev-parse', 'HEAD']);

  const store = new InMemoryGraphStore();
  const docQueue = new InMemoryQueue('doc');
  const docStore = new InMemoryDocStore();
  const indexer = createIndexerWorker({ store, docQueue, docStore });

  await indexer.handle({
    payload: {
      tenantId: 't-1',
      repoId: 'r-1',
      sha: sha1,
      cloneSource: src,
      changedFiles: []
    }
  });

  // Sanity: indexing ran and emitted at least one flow entrypoint.
  const eps = store.listFlowEntrypoints({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(eps.length >= 1);
  assert.ok(eps.some((e) => e.path === '/health'));

  // Best-effort: ensure we didn't leave a new clone dir behind.
  const after = new Set(fs.readdirSync(tmp).filter((n) => n.startsWith('graphfly-clone-')));
  const added = Array.from(after).filter((n) => !before.has(n));
  assert.deepEqual(added, []);
});
