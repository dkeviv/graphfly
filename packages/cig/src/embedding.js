import { hashString } from './types.js';

function seededFloat(seedStr, index) {
  // Deterministic pseudo-random in [-1, 1] from string seed.
  const h = hashString(`${seedStr}:${index}`);
  const n = Number.parseInt(h, 16) / 0xffffffff;
  return n * 2 - 1;
}

export function embedText384(text) {
  const seed = String(text ?? '').slice(0, 10_000);
  const vec = new Array(384);
  for (let i = 0; i < 384; i++) vec[i] = seededFloat(seed, i);
  return vec;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

