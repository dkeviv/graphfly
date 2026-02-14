import { assert } from './types.js';
import { traceFlow } from './trace.js';

export function makeFlowGraphKey({ entrypointKey, sha, depth }) {
  assert(typeof entrypointKey === 'string' && entrypointKey.length > 0, 'entrypointKey required');
  assert(typeof sha === 'string' && sha.length > 0, 'sha required');
  assert(Number.isInteger(depth) && depth >= 0 && depth <= 10, 'depth must be 0..10');
  return `${entrypointKey}::${sha}::${depth}`;
}

export function materializeFlowGraph({ store, tenantId, repoId, entrypoint, sha, depth = 3 }) {
  const entrypointKey = entrypoint.entrypoint_key;
  const startSymbolUid = entrypoint.entrypoint_symbol_uid ?? entrypoint.symbol_uid;
  const trace = traceFlow({ store, tenantId, repoId, startSymbolUid, depth });

  const flowGraphKey = makeFlowGraphKey({ entrypointKey, sha, depth });
  const nodeUids = trace.nodes.map((n) => n.symbol_uid);
  const edgeKeys = trace.edges.map((e) => `${e.source_symbol_uid}::${e.edge_type}::${e.target_symbol_uid}`);

  return {
    flow_graph_key: flowGraphKey,
    entrypoint_key: entrypointKey,
    start_symbol_uid: startSymbolUid,
    sha,
    depth,
    node_uids: nodeUids,
    edge_keys: edgeKeys
  };
}

