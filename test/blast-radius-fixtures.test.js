import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { blastRadius } from '../packages/cig/src/query.js';

function buildStore() {
  const store = new InMemoryGraphStore();
  const t = 't-1';
  const r = 'r-1';
  for (const uid of ['A', 'B', 'C', 'D']) {
    store.upsertNode({ tenantId: t, repoId: r, node: { symbol_uid: uid, qualified_name: uid, node_type: 'X', file_path: `${uid}.txt`, line_start: 1, line_end: 1 } });
  }
  store.upsertEdge({ tenantId: t, repoId: r, edge: { source_symbol_uid: 'A', target_symbol_uid: 'B', edge_type: 'Calls' } });
  store.upsertEdge({ tenantId: t, repoId: r, edge: { source_symbol_uid: 'B', target_symbol_uid: 'C', edge_type: 'Calls' } });
  store.upsertEdge({ tenantId: t, repoId: r, edge: { source_symbol_uid: 'C', target_symbol_uid: 'D', edge_type: 'Calls' } });
  return { store, tenantId: t, repoId: r };
}

test('blastRadius out depth=1', async () => {
  const { store, tenantId, repoId } = buildStore();
  const uids = await blastRadius({ store, tenantId, repoId, symbolUid: 'A', depth: 1, direction: 'out' });
  assert.deepEqual(new Set(uids), new Set(['A', 'B']));
});

test('blastRadius out depth=2', async () => {
  const { store, tenantId, repoId } = buildStore();
  const uids = await blastRadius({ store, tenantId, repoId, symbolUid: 'A', depth: 2, direction: 'out' });
  assert.deepEqual(new Set(uids), new Set(['A', 'B', 'C']));
});

test('blastRadius in depth=2', async () => {
  const { store, tenantId, repoId } = buildStore();
  const uids = await blastRadius({ store, tenantId, repoId, symbolUid: 'D', depth: 2, direction: 'in' });
  assert.deepEqual(new Set(uids), new Set(['D', 'C', 'B']));
});
