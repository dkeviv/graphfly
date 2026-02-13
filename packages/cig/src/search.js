import { embedText384, cosineSimilarity } from './embedding.js';

export function textSearch({ store, tenantId, repoId, query, limit = 10 }) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return [];
  const nodes = store.listNodes({ tenantId, repoId });
  const scored = nodes
    .map((n) => {
      const hay = `${n.qualified_name ?? ''} ${n.name ?? ''}`.toLowerCase();
      const score = hay.includes(q) ? 1 : 0;
      return { node: n, score };
    })
    .filter((x) => x.score > 0)
    .slice(0, limit);
  return scored.map((x) => ({ node: x.node, score: x.score }));
}

export function semanticSearch({ store, tenantId, repoId, query, limit = 10 }) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const qVec = embedText384(q);
  const nodes = store.listNodes({ tenantId, repoId }).filter((n) => Array.isArray(n.embedding) && n.embedding.length === 384);
  const scored = nodes
    .map((n) => ({ node: n, score: cosineSimilarity(qVec, n.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

