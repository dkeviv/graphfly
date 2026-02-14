import test from 'node:test';
import assert from 'node:assert/strict';
import { PgGraphStore } from '../packages/cig-pg/src/pg-store.js';

function makeFakeClient() {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params: Array.isArray(params) ? params : [] });
      return { rows: [] };
    }
  };
}

test('PgGraphStore.ingestRecords uses bulk jsonb_to_recordset upserts', async () => {
  const client = makeFakeClient();
  const store = new PgGraphStore({ client });

  await store.ingestRecords({
    tenantId: '00000000-0000-0000-0000-000000000001',
    repoId: '00000000-0000-0000-0000-000000000002',
    records: [
      { type: 'node', data: { symbol_uid: 'A', node_type: 'File', qualified_name: 'a', file_path: 'a.js', line_start: 1, line_end: 1 } },
      { type: 'node', data: { symbol_uid: 'B', node_type: 'File', qualified_name: 'b', file_path: 'b.js', line_start: 1, line_end: 1 } },
      { type: 'edge', data: { source_symbol_uid: 'A', target_symbol_uid: 'B', edge_type: 'Imports' } },
      { type: 'edge_occurrence', data: { source_symbol_uid: 'A', target_symbol_uid: 'B', edge_type: 'Imports', file_path: 'a.js', line_start: 2, line_end: 2, occurrence_kind: 'import', sha: 'abc' } },
      { type: 'flow_entrypoint', data: { entrypoint_key: 'http:GET:/health', entrypoint_type: 'http_route', symbol_uid: 'A', file_path: 'a.js', line_start: 1, line_end: 1 } }
    ]
  });

  const bulkQueries = client.calls.filter((c) => c.text.includes('jsonb_to_recordset'));
  assert.ok(bulkQueries.length >= 3);
  assert.ok(bulkQueries.some((q) => q.text.includes('INSERT INTO graph_nodes')));
  assert.ok(bulkQueries.some((q) => q.text.includes('INSERT INTO graph_edges')));
  assert.ok(bulkQueries.some((q) => q.text.includes('INSERT INTO graph_edge_occurrences')));
});
