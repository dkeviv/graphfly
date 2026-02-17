import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';

test('deleteGraphForFilePaths removes nodes/edges/occurrences and related records', async () => {
  const store = new InMemoryGraphStore();
  const tenantId = 't1';
  const repoId = 'r1';

  store.upsertNode({
    tenantId,
    repoId,
    node: { symbol_uid: 'file:a', node_type: 'File', file_path: 'a.py', first_seen_sha: 's', last_seen_sha: 's' }
  });
  store.upsertNode({
    tenantId,
    repoId,
    node: { symbol_uid: 'fn:a', node_type: 'Function', file_path: 'a.py', first_seen_sha: 's', last_seen_sha: 's' }
  });
  store.upsertNode({
    tenantId,
    repoId,
    node: { symbol_uid: 'fn:b', node_type: 'Function', file_path: 'b.py', first_seen_sha: 's', last_seen_sha: 's' }
  });

  store.upsertEdge({
    tenantId,
    repoId,
    edge: { source_symbol_uid: 'fn:b', target_symbol_uid: 'fn:a', edge_type: 'Calls', first_seen_sha: 's', last_seen_sha: 's' }
  });
  store.addEdgeOccurrence({
    tenantId,
    repoId,
    occurrence: {
      source_symbol_uid: 'fn:b',
      target_symbol_uid: 'fn:a',
      edge_type: 'Calls',
      file_path: 'b.py',
      line_start: 10,
      line_end: 10,
      occurrence_kind: 'call',
      sha: 's'
    }
  });

  store.upsertFlowEntrypoint({
    tenantId,
    repoId,
    entrypoint: { entrypoint_key: 'http:GET:/x', entrypoint_type: 'http_route', file_path: 'a.py', line_start: 1, line_end: 1, sha: 's' }
  });

  store.addDependencyManifest({
    tenantId,
    repoId,
    manifest: { manifest_type: 'pyproject.toml', file_path: 'a.py', sha: 's', parsed: {} }
  });
  store.addDeclaredDependency({
    tenantId,
    repoId,
    declared: { manifest_key: 'a.py::s', package_key: 'pypi:requests', scope: 'prod', version_range: '^1', sha: 's' }
  });

  store.addUnresolvedImport({
    tenantId,
    repoId,
    unresolvedImport: { file_path: 'a.py', line: 3, spec: './x', kind: 'internal_unresolved', sha: 's' }
  });

  const out = store.deleteGraphForFilePaths({ tenantId, repoId, filePaths: ['a.py'] });
  assert.equal(out.ok, true);

  const nodes = store.listNodes({ tenantId, repoId });
  assert.equal(nodes.some((n) => n.symbol_uid === 'fn:a'), false);
  assert.equal(nodes.some((n) => n.symbol_uid === 'file:a'), false);
  assert.equal(nodes.some((n) => n.symbol_uid === 'fn:b'), true);

  const edges = store.listEdges({ tenantId, repoId });
  assert.equal(edges.length, 0);

  const occ = store.listEdgeOccurrences({ tenantId, repoId });
  assert.equal(occ.length, 0);

  const eps = store.listFlowEntrypoints({ tenantId, repoId });
  assert.equal(eps.length, 0);

  const unresolved = store.listUnresolvedImports({ tenantId, repoId });
  assert.equal(unresolved.length, 0);
});

