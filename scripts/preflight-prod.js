import { createAstEngineFromEnv } from '../packages/indexer-engine/src/ast/engine.js';
import { createEmbeddingProviderFromEnv } from '../packages/cig/src/embeddings-provider.js';

function req(env, key) {
  const v = env[key];
  if (!v) throw new Error(`missing_env:${key}`);
  return v;
}

function assertProdEnv(env) {
  if (String(env.GRAPHFLY_MODE ?? '').toLowerCase() !== 'prod') throw new Error('preflight_requires_GRAPHFLY_MODE=prod');

  req(env, 'DATABASE_URL');
  req(env, 'GRAPHFLY_SECRET_KEY');
  req(env, 'GRAPHFLY_JWT_SECRET');
  if (String(env.GRAPHFLY_AUTH_MODE ?? '') !== 'jwt') throw new Error('missing_env:GRAPHFLY_AUTH_MODE=jwt');
  if (String(env.GRAPHFLY_QUEUE_MODE ?? '') !== 'pg') throw new Error('missing_env:GRAPHFLY_QUEUE_MODE=pg');

  // GitHub: required for indexing and docs PRs in the cloud.
  req(env, 'GITHUB_APP_ID');
  req(env, 'GITHUB_APP_PRIVATE_KEY');
  req(env, 'GITHUB_WEBHOOK_SECRET');

  const openclawReqRaw = String(env.GRAPHFLY_OPENCLAW_REQUIRED ?? '1').trim().toLowerCase();
  const openclawRequired = !(openclawReqRaw === '0' || openclawReqRaw === 'false');
  if (openclawRequired) {
    req(env, 'OPENCLAW_GATEWAY_URL');
    if (!env.OPENCLAW_GATEWAY_TOKEN && !env.OPENCLAW_TOKEN) throw new Error('missing_env:OPENCLAW_GATEWAY_TOKEN (or OPENCLAW_TOKEN)');
    const envRemote = String(env.OPENCLAW_USE_REMOTE ?? '').trim().toLowerCase();
    if (envRemote === '0' || envRemote === 'false') throw new Error('missing_env:OPENCLAW_USE_REMOTE must not disable remote in prod');
  }
}

async function main() {
  const env = process.env;
  assertProdEnv(env);

  // Embeddings: enforce if required.
  try {
    createEmbeddingProviderFromEnv({ env });
  } catch (e) {
    throw new Error(`embeddings_preflight_failed: ${String(e?.message ?? e)}`);
  }

  // AST engine: ensure the prod-default engine can be constructed.
  try {
    const engine = createAstEngineFromEnv({ env, repoRoot: process.cwd(), sourceFileExists: () => false });
    if (!engine) throw new Error('ast_engine_disabled');
  } catch (e) {
    throw new Error(`ast_preflight_failed: ${String(e?.message ?? e)}`);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true }, null, 2));
}

await main();
