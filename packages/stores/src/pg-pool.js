import { createPgPool } from '../../pg-client/src/pool.js';

const poolsByKey = new Map();

export async function getPgPoolFromEnv({ connectionString = process.env.DATABASE_URL ?? '', max = 10 } = {}) {
  const cs = String(connectionString ?? '');
  if (!cs) return null;
  const m = Number.isFinite(max) ? Math.max(1, Math.trunc(max)) : 10;
  const key = `${cs}::${m}`;
  const existing = poolsByKey.get(key);
  if (existing) return existing;
  const pool = await createPgPool({ connectionString: cs, max: m });
  poolsByKey.set(key, pool);
  return pool;
}

