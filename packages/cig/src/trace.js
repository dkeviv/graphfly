import { assert } from './types.js';

export function traceFlow({ store, tenantId, repoId, startSymbolUid, depth = 2, edgeTypes = null }) {
  assert(typeof startSymbolUid === 'string' && startSymbolUid.length > 0, 'startSymbolUid required');
  assert(Number.isInteger(depth) && depth >= 0 && depth <= 10, 'depth must be 0..10');
  const allowed = edgeTypes ? new Set(edgeTypes) : null;

  const nodes = new Map();
  const edges = [];

  function addNode(uid) {
    if (nodes.has(uid)) return;
    const n = store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid });
    if (n) nodes.set(uid, n);
  }

  addNode(startSymbolUid);

  let frontier = new Set([startSymbolUid]);
  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const uid of frontier) {
      const outEdges = store.listEdgesByNode({ tenantId, repoId, symbolUid: uid, direction: 'out' });
      for (const e of outEdges) {
        if (allowed && !allowed.has(e.edge_type)) continue;
        edges.push(e);
        addNode(e.target_symbol_uid);
        if (!nodes.has(e.target_symbol_uid)) continue;
        next.add(e.target_symbol_uid);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return { startSymbolUid, depth, nodes: Array.from(nodes.values()), edges };
}

