import { assert } from './types.js';

export function neighborhood({
  store,
  tenantId,
  repoId,
  symbolUid,
  direction = 'both',
  edgeTypes = null,
  limitEdges = 200
}) {
  assert(typeof symbolUid === 'string' && symbolUid.length > 0, 'symbolUid required');
  const allowed = edgeTypes ? new Set(edgeTypes) : null;
  const edges = store
    .listEdgesByNode({ tenantId, repoId, symbolUid, direction })
    .filter((e) => (allowed ? allowed.has(e.edge_type) : true))
    .slice(0, limitEdges);

  const nodesByUid = new Map();
  const addNode = (uid) => {
    if (nodesByUid.has(uid)) return;
    const n = store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid });
    if (n) nodesByUid.set(uid, n);
  };

  addNode(symbolUid);
  for (const e of edges) {
    addNode(e.source_symbol_uid);
    addNode(e.target_symbol_uid);
  }

  const edgeOccurrenceCounts = edges.map((e) => {
    const occ = store.listEdgeOccurrencesForEdge({
      tenantId,
      repoId,
      sourceSymbolUid: e.source_symbol_uid,
      edgeType: e.edge_type,
      targetSymbolUid: e.target_symbol_uid
    });
    return {
      sourceSymbolUid: e.source_symbol_uid,
      edgeType: e.edge_type,
      targetSymbolUid: e.target_symbol_uid,
      occurrences: occ.length
    };
  });

  return { nodes: Array.from(nodesByUid.values()), edges, edgeOccurrenceCounts };
}

