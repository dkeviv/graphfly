import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';
import { createGraphAgentWorker } from '../workers/graph-agent/src/graph-agent-worker.js';

function write(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

test('graph agent produces flow_summary annotations for flow entrypoints', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-graph-agent-test-'));
  try {
    write(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', dependencies: { express: '^4.0.0' } }, null, 2));
    write(
      path.join(tmp, 'src', 'server.ts'),
      [
        "import express from 'express';",
        "import { greet } from './util';",
        'const app = express();',
        "app.get('/health', (req, res) => res.json({ ok: true, msg: greet('world') }));",
        'export { app };'
      ].join('\n')
    );
    write(path.join(tmp, 'src', 'util.ts'), ["export function greet(name: string) { return `hi:${name}`; }"].join('\n'));

    const store = new InMemoryGraphStore();
    const docQueue = new InMemoryQueue('doc');
    const graphQueue = new InMemoryQueue('graph');
    const docStore = new InMemoryDocStore();
    const indexer = createIndexerWorker({ store, docQueue, docStore, graphQueue });

    await indexer.handle({
      payload: { tenantId: 't-1', repoId: 'r-1', repoRoot: tmp, sha: 's1', changedFiles: [], removedFiles: [], docsRepoFullName: 'org/docs' }
    });

    const graphJob = graphQueue.drain()[0];
    assert.ok(graphJob, 'expected graph.enrich job to be enqueued');

    const agent = createGraphAgentWorker({ store });
    await agent.handle({ payload: graphJob.payload });

    const annotations = await store.listGraphAnnotations({ tenantId: 't-1', repoId: 'r-1' });
    assert.ok(annotations.some((a) => a.annotation_type === 'flow_summary'), 'expected at least one flow_summary annotation');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
});

