import { publicNode } from './public-shapes.js';

export function formatGraphSearchResponse({ mode, query, results, viewMode = 'default' }) {
  return {
    mode,
    query,
    results: (results ?? []).map((r) => ({
      score: r.score,
      node: publicNode(r.node, { mode: viewMode })
    }))
  };
}

