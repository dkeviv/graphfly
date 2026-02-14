import test from 'node:test';
import assert from 'node:assert/strict';
import { PgGraphStore } from '../packages/cig-pg/src/pg-store.js';

function makeFakeClient(respond) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params: Array.isArray(params) ? params : [] });
      return respond(String(text), params ?? []);
    }
  };
}

test('PgGraphStore.ingestRecords accepts flow_graph records (forward-compatible)', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };

    if (text.includes('INSERT INTO flow_graphs')) return { rows: [{ id: 'fg-1' }] };
    if (text.startsWith('DELETE FROM flow_graph_nodes')) return { rows: [] };
    if (text.startsWith('DELETE FROM flow_graph_edges')) return { rows: [] };
    if (text.startsWith('SELECT id FROM graph_nodes')) return { rows: [{ id: 'n-1' }] };
    if (text.includes('FROM graph_edges e') && text.includes('LIMIT 1')) return { rows: [{ id: 'e-1' }] };
    if (text.includes('INSERT INTO flow_graph_nodes')) return { rows: [] };
    if (text.includes('INSERT INTO flow_graph_edges')) return { rows: [] };

    // Bulk upserts may or may not occur depending on payload; tolerate.
    if (text.includes('jsonb_to_recordset') && text.includes('INSERT INTO graph_nodes')) return { rows: [] };
    if (text.includes('jsonb_to_recordset') && text.includes('INSERT INTO graph_edges')) return { rows: [] };
    if (text.includes('jsonb_to_recordset') && text.includes('INSERT INTO graph_edge_occurrences')) return { rows: [] };
    if (text.includes('jsonb_to_recordset') && text.includes('INSERT INTO flow_entrypoints')) return { rows: [] };

    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgGraphStore({ client });
  await store.ingestRecords({
    tenantId: '00000000-0000-0000-0000-000000000001',
    repoId: '00000000-0000-0000-0000-000000000002',
    records: [
      {
        type: 'flow_graph',
        data: {
          entrypoint_key: 'http:GET:/health',
          start_symbol_uid: 's',
          sha: 'abc',
          depth: 2,
          node_uids: ['s'],
          edge_keys: ['s::Calls::t']
        }
      }
    ]
  });

  assert.ok(client.calls.some((c) => c.text.includes('INSERT INTO flow_graphs')));
});

