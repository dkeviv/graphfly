import { sanitizeNodeForMode } from '../../../packages/security/src/safe-mode.js';

export function publicNode(node, { mode = 'default' } = {}) {
  return sanitizeNodeForMode(node, mode);
}

export function publicEdge(edge) {
  return {
    sourceSymbolUid: edge.source_symbol_uid,
    targetSymbolUid: edge.target_symbol_uid,
    edgeType: edge.edge_type,
    metadata: edge.metadata ?? null
  };
}

