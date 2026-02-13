import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { mockIndexRepoToNdjson } from '../workers/indexer/src/mock-indexer.js';

test('e2e: mock indexer -> ndjson ingest -> query nodes/edges', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = mockIndexRepoToNdjson({ repoRoot: 'fixtures/sample-repo', language: 'js' });
  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  const nodes = store.listNodes({ tenantId: 't-1', repoId: 'r-1' });
  const edges = store.listEdges({ tenantId: 't-1', repoId: 'r-1' });
  const occ = store.listEdgeOccurrences({ tenantId: 't-1', repoId: 'r-1' });

  assert.ok(nodes.length >= 2);
  assert.ok(edges.length >= 1);
  assert.ok(occ.length >= 1);
});

