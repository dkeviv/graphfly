import { assert } from './types.js';

export async function blastRadius({ store, tenantId, repoId, symbolUid, depth = 1, direction = 'both' }) {
  assert(typeof symbolUid === 'string' && symbolUid.length > 0, 'symbolUid required');
  assert(Number.isInteger(depth) && depth >= 0 && depth <= 5, 'depth must be 0..5');

  const visited = new Set([symbolUid]);
  let frontier = new Set([symbolUid]);

  for (let d = 0; d < depth; d++) {
    const next = new Set();
    for (const current of frontier) {
      const edges = await store.listEdgesByNode({ tenantId, repoId, symbolUid: current, direction });
      for (const e of edges) {
        if (direction === 'out' || direction === 'both') {
          if (e.source_symbol_uid === current && !visited.has(e.target_symbol_uid)) next.add(e.target_symbol_uid);
        }
        if (direction === 'in' || direction === 'both') {
          if (e.target_symbol_uid === current && !visited.has(e.source_symbol_uid)) next.add(e.source_symbol_uid);
        }
      }
    }
    for (const n of next) visited.add(n);
    frontier = next;
    if (frontier.size === 0) break;
  }

  return Array.from(visited);
}
