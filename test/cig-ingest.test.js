import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { blastRadius } from '../packages/cig/src/query.js';

test('ingestNdjson upserts nodes/edges/occurrences and dedupes edges', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = [
    JSON.stringify({ type: 'node', data: { symbol_uid: 'js::a::1', qualified_name: 'a', node_type: 'File', file_path: 'a.js', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'node', data: { symbol_uid: 'js::b::1', qualified_name: 'b', node_type: 'File', file_path: 'b.js', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'edge', data: { source_symbol_uid: 'js::a::1', target_symbol_uid: 'js::b::1', edge_type: 'Imports' } }),
    JSON.stringify({ type: 'edge', data: { source_symbol_uid: 'js::a::1', target_symbol_uid: 'js::b::1', edge_type: 'Imports', metadata: { note: 'latest wins' } } }),
    JSON.stringify({ type: 'edge_occurrence', data: { source_symbol_uid: 'js::a::1', target_symbol_uid: 'js::b::1', edge_type: 'Imports', file_path: 'a.js', line_start: 1, line_end: 1, occurrence_kind: 'import' } })
  ].join('\n');

  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  assert.equal(store.listNodes({ tenantId: 't-1', repoId: 'r-1' }).length, 2);
  assert.equal(store.listEdges({ tenantId: 't-1', repoId: 'r-1' }).length, 1);
  assert.equal(store.listEdges({ tenantId: 't-1', repoId: 'r-1' })[0].metadata.note, 'latest wins');
  assert.equal(store.listEdgeOccurrences({ tenantId: 't-1', repoId: 'r-1' }).length, 1);
});

test('blastRadius traverses deduped edges', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = [
    JSON.stringify({ type: 'node', data: { symbol_uid: 'js::a::1', qualified_name: 'a', node_type: 'File', file_path: 'a.js', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'node', data: { symbol_uid: 'js::b::1', qualified_name: 'b', node_type: 'File', file_path: 'b.js', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'node', data: { symbol_uid: 'js::c::1', qualified_name: 'c', node_type: 'File', file_path: 'c.js', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'edge', data: { source_symbol_uid: 'js::a::1', target_symbol_uid: 'js::b::1', edge_type: 'Imports' } }),
    JSON.stringify({ type: 'edge', data: { source_symbol_uid: 'js::b::1', target_symbol_uid: 'js::c::1', edge_type: 'Imports' } })
  ].join('\n');

  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  const uids = blastRadius({ store, tenantId: 't-1', repoId: 'r-1', symbolUid: 'js::a::1', depth: 2, direction: 'out' });
  assert.deepEqual(new Set(uids), new Set(['js::a::1', 'js::b::1', 'js::c::1']));
});

test('ingestNdjson tolerates unknown record types', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = [
    JSON.stringify({ type: 'node', data: { symbol_uid: 'js::a::1', qualified_name: 'a', node_type: 'File', file_path: 'a.js', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'some_future_record', data: { hello: 'world' } })
  ].join('\n');

  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });
  assert.equal(store.listNodes({ tenantId: 't-1', repoId: 'r-1' }).length, 1);
});

test('ingestNdjson rejects invalid node records', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = [JSON.stringify({ type: 'node', data: { node_type: 'File' } })].join('\n');
  await assert.rejects(() => ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store }), /invalid_node/);
});
