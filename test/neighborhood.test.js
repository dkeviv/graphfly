import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { neighborhood } from '../packages/cig/src/neighborhood.js';

test('neighborhood returns focused nodes/edges and occurrence counts', () => {
  const store = new InMemoryGraphStore();
  const t = 't-1';
  const r = 'r-1';
  store.upsertNode({ tenantId: t, repoId: r, node: { symbol_uid: 'A', node_type: 'X', file_path: 'a', line_start: 1, line_end: 1 } });
  store.upsertNode({ tenantId: t, repoId: r, node: { symbol_uid: 'B', node_type: 'X', file_path: 'b', line_start: 1, line_end: 1 } });
  store.upsertEdge({ tenantId: t, repoId: r, edge: { source_symbol_uid: 'A', target_symbol_uid: 'B', edge_type: 'Calls' } });
  store.addEdgeOccurrence({
    tenantId: t,
    repoId: r,
    occurrence: {
      source_symbol_uid: 'A',
      target_symbol_uid: 'B',
      edge_type: 'Calls',
      file_path: 'a',
      line_start: 3,
      line_end: 3,
      occurrence_kind: 'call'
    }
  });

  const out = neighborhood({ store, tenantId: t, repoId: r, symbolUid: 'A', direction: 'out' });
  assert.equal(out.edges.length, 1);
  assert.equal(out.nodes.length, 2);
  assert.equal(out.edgeOccurrenceCounts[0].occurrences, 1);
});

