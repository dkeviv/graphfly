import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { computeImpact } from '../packages/cig/src/impact.js';

test('computeImpact expands impacted set via graph edges', async () => {
  const store = new InMemoryGraphStore();
  const t = 't-1';
  const r = 'r-1';
  store.upsertNode({ tenantId: t, repoId: r, node: { symbol_uid: 'A', node_type: 'File', file_path: 'a.js', line_start: 1, line_end: 1 } });
  store.upsertNode({ tenantId: t, repoId: r, node: { symbol_uid: 'B', node_type: 'File', file_path: 'b.js', line_start: 1, line_end: 1 } });
  store.upsertEdge({ tenantId: t, repoId: r, edge: { source_symbol_uid: 'A', target_symbol_uid: 'B', edge_type: 'Calls' } });

  const out = await computeImpact({ store, tenantId: t, repoId: r, changedFiles: ['b.js'], depth: 1 });
  assert.deepEqual(new Set(out.changedSymbolUids), new Set(['B']));
  // Direction=both: changed node plus neighbor.
  assert.ok(out.impactedSymbolUids.includes('A'));
  assert.ok(out.impactedSymbolUids.includes('B'));
});
