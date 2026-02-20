import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { generateFlowDocWithLlm } from '../workers/doc-agent/src/llm-render.js';

test('generateFlowDocWithLlm returns a validated contract-first doc block', async () => {
  const store = new InMemoryGraphStore();
  const tenantId = 't-1';
  const repoId = 'r-1';

  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'A',
      qualified_name: 'api.health',
      name: 'GET /health',
      node_type: 'ApiEndpoint',
      file_path: 'server.js',
      line_start: 10,
      line_end: 10,
      signature: 'GET /health',
      contract: { kind: 'http_route', method: 'GET', path: '/health' }
    }
  });
  store.upsertNode({
    tenantId,
    repoId,
    node: { symbol_uid: 'B', qualified_name: 'server', node_type: 'File', file_path: 'server.js', line_start: 1, line_end: 1 }
  });
  store.upsertEdge({ tenantId, repoId, edge: { source_symbol_uid: 'A', target_symbol_uid: 'B', edge_type: 'ControlFlow' } });

  const { markdown } = await generateFlowDocWithLlm({ store, tenantId, repoId, symbolUid: 'A' });
  assert.ok(markdown.includes('##'));
  assert.ok(markdown.includes('### Flow (Derived)'));
  assert.ok(!markdown.includes('```'));
});
