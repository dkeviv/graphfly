import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';

function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

test('builtin indexer indexes JS/TS + Python + package.json deps (auto mode fallback)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-indexer-builtin-test-'));
  try {
    write(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { lodash: '^4.17.0' } }, null, 2)
    );
    write(
      path.join(tmp, 'src', 'mod.ts'),
      [
        "import _ from 'lodash';",
        '',
        '/**',
        " * Says hello.",
        " * @param {'formal'|'casual'} style - greeting style",
        ' */',
        "export function hello(style) { return style === 'formal' ? 'Hello' : 'Hi'; }",
        '',
        "app.get('/health', () => 'ok');"
      ].join('\n')
    );
    write(
      path.join(tmp, 'src', 'app.py'),
      [
        'from fastapi import FastAPI',
        'app = FastAPI()',
        '',
        "@app.get('/ping')",
        'def ping():',
        "    return {'ok': True}",
        '',
        'class Greeter:',
        '    pass'
      ].join('\n')
    );

    const prevCmd = process.env.GRAPHFLY_INDEXER_CMD;
    const prevMode = process.env.GRAPHFLY_INDEXER_MODE;
    try {
      delete process.env.GRAPHFLY_INDEXER_CMD;
      delete process.env.GRAPHFLY_INDEXER_ARGS_JSON;
      process.env.GRAPHFLY_INDEXER_MODE = 'auto';

      const store = new InMemoryGraphStore();
      const docQueue = new InMemoryQueue('doc');
      const docStore = new InMemoryDocStore();
      const worker = createIndexerWorker({ store, docQueue, docStore });
      await worker.handle({
        payload: { tenantId: 't-1', repoId: 'r-1', repoRoot: tmp, sha: 's1', changedFiles: [], removedFiles: [], docsRepoFullName: 'org/docs' }
      });

      const nodes = await store.listNodes({ tenantId: 't-1', repoId: 'r-1' });
      const edges = await store.listEdges({ tenantId: 't-1', repoId: 'r-1' });

      assert.ok(nodes.some((n) => n.node_type === 'Manifest' && n.file_path === 'package.json'));
      assert.ok(nodes.some((n) => n.node_type === 'Package' && n.qualified_name === 'npm:lodash'));
      assert.ok(nodes.some((n) => n.node_type === 'ApiEndpoint' && n.signature === 'GET /health'));
      assert.ok(nodes.some((n) => n.node_type === 'ApiEndpoint' && n.signature === 'GET /ping'));
      assert.ok(nodes.some((n) => n.node_type === 'Function' && n.name === 'hello' && n.file_path === 'src/mod.ts'));
      assert.ok(nodes.some((n) => n.node_type === 'Class' && n.name === 'Greeter' && n.file_path === 'src/app.py'));

      assert.ok(edges.some((e) => e.edge_type === 'UsesPackage'));
    } finally {
      if (prevCmd === undefined) delete process.env.GRAPHFLY_INDEXER_CMD;
      else process.env.GRAPHFLY_INDEXER_CMD = prevCmd;
      if (prevMode === undefined) delete process.env.GRAPHFLY_INDEXER_MODE;
      else process.env.GRAPHFLY_INDEXER_MODE = prevMode;
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});

