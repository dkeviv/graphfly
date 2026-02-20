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

  // GitHub OAuth: used for user sign-in + OAuth-first onboarding (FR-GH-01 Mode 1).
  req(env, 'GITHUB_OAUTH_CLIENT_ID');
  req(env, 'GITHUB_OAUTH_CLIENT_SECRET');
  req(env, 'GITHUB_OAUTH_REDIRECT_URI');

  // Webhooks: required for automatic incremental indexing. In OAuth mode this is manually configured by the user.
  req(env, 'GITHUB_WEBHOOK_SECRET');

  // GitHub Apps (optional enterprise mode / least-privilege): require both if either is set.
  const appsMode = Boolean(env.GITHUB_APP_ID || env.GITHUB_APP_PRIVATE_KEY);
  if (appsMode) {
    req(env, 'GITHUB_APP_ID');
    req(env, 'GITHUB_APP_PRIVATE_KEY');
  }

  const llmReqRaw = String(env.GRAPHFLY_LLM_REQUIRED ?? '1').trim().toLowerCase();
  const llmRequired = !(llmReqRaw === '0' || llmReqRaw === 'false');
  if (llmRequired) req(env, 'OPENROUTER_API_KEY');
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
