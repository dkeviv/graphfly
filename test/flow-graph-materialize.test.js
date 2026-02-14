import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { mockIndexRepoToNdjson } from '../workers/indexer/src/mock-indexer.js';
import { materializeFlowGraph } from '../packages/cig/src/flow-graph.js';

test('materializeFlowGraph produces a stable key and stores node/edge lists', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = mockIndexRepoToNdjson({ repoRoot: 'fixtures/sample-repo', language: 'js' });
  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  const ep = store.listFlowEntrypoints({ tenantId: 't-1', repoId: 'r-1' }).find((e) => e.path === '/health');
  assert.ok(ep);
  const fg = await materializeFlowGraph({ store, tenantId: 't-1', repoId: 'r-1', entrypoint: ep, sha: 'abc', depth: 2 });
  assert.ok(fg.flow_graph_key.includes('abc'));
  assert.ok(Array.isArray(fg.node_uids));
  assert.ok(Array.isArray(fg.edge_keys));
});
