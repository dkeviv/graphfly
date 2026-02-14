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

test('PgGraphStore.upsertNode writes graph_nodes with embedding literal', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('INSERT INTO graph_nodes')) return { rows: [{ id: 'n-1' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgGraphStore({ client });

  const id = await store.upsertNode({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    node: {
      symbol_uid: 'sym:1',
      node_type: 'Function',
      qualified_name: 'a.b.c',
      embedding: Array.from({ length: 384 }, () => 0)
    }
  });

  assert.equal(id, 'n-1');
  assert.ok(client.calls[0].text.includes('INSERT INTO graph_nodes'));
  const embeddingParam = client.calls[0].params[23];
  assert.equal(typeof embeddingParam, 'string');
  assert.ok(embeddingParam.startsWith('[') && embeddingParam.endsWith(']'));
});

test('PgGraphStore.upsertEdge resolves node ids then upserts graph_edges', async () => {
  const client = makeFakeClient(async (text, params) => {
    if (text.startsWith('SELECT id FROM graph_nodes')) {
      const symbolUid = params[2];
      return { rows: [{ id: symbolUid === 's' ? 'ns' : 'nt' }] };
    }
    if (text.includes('INSERT INTO graph_edges')) return { rows: [{ id: 'e-1' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgGraphStore({ client });

  const id = await store.upsertEdge({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    edge: { source_symbol_uid: 's', target_symbol_uid: 't', edge_type: 'Calls', metadata: { a: 1 } }
  });

  assert.equal(id, 'e-1');
  const insert = client.calls.find((c) => c.text.includes('INSERT INTO graph_edges'));
  assert.ok(insert);
  assert.deepEqual(insert.params.slice(0, 5), ['t-uuid', 'r-uuid', 'ns', 'nt', 'Calls']);
});

test('PgGraphStore.addEdgeOccurrence upserts edge if missing then writes occurrence', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('FROM graph_edges e') && text.includes('LIMIT 1')) return { rows: [] };
    if (text.startsWith('SELECT id FROM graph_nodes')) return { rows: [{ id: 'n-x' }] };
    if (text.includes('INSERT INTO graph_edges')) return { rows: [{ id: 'e-x' }] };
    if (text.includes('INSERT INTO graph_edge_occurrences')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgGraphStore({ client });

  await store.addEdgeOccurrence({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    occurrence: {
      source_symbol_uid: 's',
      target_symbol_uid: 't',
      edge_type: 'Imports',
      file_path: 'a.js',
      line_start: 1,
      line_end: 1,
      occurrence_kind: 'import',
      sha: 'abc'
    }
  });

  assert.ok(client.calls.some((c) => c.text.includes('INSERT INTO graph_edge_occurrences')));
});

test('PgGraphStore.upsertFlowGraph uses a transaction and clears prior associations', async () => {
  const client = makeFakeClient(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('INSERT INTO flow_graphs')) return { rows: [{ id: 'fg-1' }] };
    if (text.startsWith('DELETE FROM flow_graph_nodes')) return { rows: [] };
    if (text.startsWith('DELETE FROM flow_graph_edges')) return { rows: [] };
    if (text.startsWith('SELECT id FROM graph_nodes')) return { rows: [{ id: 'n-1' }] };
    if (text.includes('FROM graph_edges e') && text.includes('LIMIT 1')) return { rows: [{ id: 'e-1' }] };
    if (text.includes('INSERT INTO flow_graph_nodes')) return { rows: [] };
    if (text.includes('INSERT INTO flow_graph_edges')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgGraphStore({ client });

  const res = await store.upsertFlowGraph({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    flowGraph: {
      entrypoint_key: 'http:GET:/health',
      start_symbol_uid: 's',
      sha: 'abc',
      depth: 3,
      node_uids: ['s'],
      edge_keys: ['s::Calls::t']
    }
  });

  assert.equal(res.ok, true);
  assert.ok(client.calls.some((c) => c.text === 'BEGIN'));
  assert.ok(client.calls.some((c) => c.text === 'COMMIT'));
});

test('PgGraphStore.semanticSearch orders by pgvector distance', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('FROM graph_nodes') && text.includes('ORDER BY embedding <=>')) {
      return { rows: [{ symbol_uid: 'n1', node_type: 'File', score: 0.9 }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgGraphStore({ client });

  const results = await store.semanticSearch({ tenantId: 't-uuid', repoId: 'r-uuid', query: 'login', limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].node.symbol_uid, 'n1');
});
