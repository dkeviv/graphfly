import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';

function writeTempIndexer({ dir }) {
  const p = path.join(dir, 'indexer.mjs');
  const src = `
    const repoRoot = process.env.GRAPHFLY_REPO_ROOT || process.cwd();
    const sha = process.env.GRAPHFLY_SHA || 'mock';
    // Emit minimal NDJSON records.
    const node = {
      type: 'node',
      data: {
        symbol_uid: 'sym:cli:1',
        node_type: 'Function',
        name: 'cliFn',
        qualified_name: 'cliFn',
        file_path: 'src/cli.js',
        line_start: 1,
        line_end: 1,
        visibility: 'public',
        language: 'js',
        first_seen_sha: sha,
        last_seen_sha: sha,
        metadata: { repoRoot }
      }
    };
    process.stdout.write(JSON.stringify(node) + '\\n');
  `;
  fs.writeFileSync(p, src, 'utf8');
  return p;
}

test('indexer worker uses configured CLI indexer and ingests NDJSON stream', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-indexer-cli-test-'));
  const script = writeTempIndexer({ dir: tmp });

  const prevCmd = process.env.GRAPHFLY_INDEXER_CMD;
  const prevArgs = process.env.GRAPHFLY_INDEXER_ARGS_JSON;
  const prevMode = process.env.GRAPHFLY_INDEXER_MODE;
  try {
    process.env.GRAPHFLY_INDEXER_CMD = 'node';
    process.env.GRAPHFLY_INDEXER_ARGS_JSON = JSON.stringify([script]);
    process.env.GRAPHFLY_INDEXER_MODE = 'cli';

    const store = new InMemoryGraphStore();
    const docQueue = new InMemoryQueue('doc');
    const docStore = new InMemoryDocStore();
    const worker = createIndexerWorker({ store, docQueue, docStore });
    await worker.handle({ payload: { tenantId: 't-1', repoId: 'r-1', repoRoot: tmp, sha: 's1', changedFiles: [], removedFiles: [], docsRepoFullName: 'org/docs' } });

    const nodes = await store.listNodes({ tenantId: 't-1', repoId: 'r-1' });
    assert.ok(nodes.some((n) => n.symbol_uid === 'sym:cli:1'));
  } finally {
    if (prevCmd === undefined) delete process.env.GRAPHFLY_INDEXER_CMD;
    else process.env.GRAPHFLY_INDEXER_CMD = prevCmd;
    if (prevArgs === undefined) delete process.env.GRAPHFLY_INDEXER_ARGS_JSON;
    else process.env.GRAPHFLY_INDEXER_ARGS_JSON = prevArgs;
    if (prevMode === undefined) delete process.env.GRAPHFLY_INDEXER_MODE;
    else process.env.GRAPHFLY_INDEXER_MODE = prevMode;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

