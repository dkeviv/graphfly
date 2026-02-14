import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { mockIndexRepoToNdjson } from '../workers/indexer/src/mock-indexer.js';
import { traceFlow } from '../packages/cig/src/trace.js';

test('traceFlow returns a focused subgraph from an entrypoint', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = mockIndexRepoToNdjson({ repoRoot: 'fixtures/sample-repo', language: 'js' });
  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  const eps = store.listFlowEntrypoints({ tenantId: 't-1', repoId: 'r-1' });
  const ep = eps.find((e) => e.path === '/health');
  assert.ok(ep);

  const t = await traceFlow({ store, tenantId: 't-1', repoId: 'r-1', startSymbolUid: ep.entrypoint_symbol_uid, depth: 3 });
  const uids = new Set(t.nodes.map((n) => n.symbol_uid));
  // Must include the entrypoint itself and at least the server file it maps to.
  assert.ok(uids.has(ep.entrypoint_symbol_uid));
  assert.ok(Array.from(uids).some((u) => String(u).includes('server.js'.replaceAll('/', '.')) || String(u).includes('server.js')));
});
