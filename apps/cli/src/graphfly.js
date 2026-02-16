#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createRuntimeFromEnv } from '../../../packages/runtime/src/runtime-from-env.js';
import { computeGitHubSignature256 } from '../../../packages/github-webhooks/src/verify.js';
import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createEmbeddingProviderFromEnv } from '../../../packages/cig/src/embeddings-provider.js';

function runGit(args, cwd) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) {
    const msg = (p.stderr || p.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
  return p.stdout.trim();
}

function usage() {
  return [
    'graphfly local-run --docs-repo-path <path> [options]',
    'graphfly pg-migrate --database-url <postgres-url> [options]',
    'graphfly embeddings-backfill --tenant-id <uuid> --repo-id <uuid> [options]',
    '',
    'Options:',
    '  --docs-repo-path <path>        Required. Local docs git repo path.',
    '  --docs-repo-full-name <name>   Default: org/docs',
    '  --source-repo-root <path>      Default: auto-detect git root from CWD',
    '  --source-repo-full-name <name> Default: local/source',
    '  --tenant-id <uuid>             Default: 00000000-0000-0000-0000-000000000001',
    '  --repo-id <uuid>               Default: 00000000-0000-0000-0000-000000000002',
    '  --database-url <url>           Postgres connection string (pg-migrate)',
    '  --migration-file <path>        Default: migrations/001_init.sql',
    '  --limit <n>                    Default: 500 (embeddings-backfill)',
    '',
    'Example:',
    '  node apps/cli/src/graphfly.js local-run --docs-repo-path ../my-docs-repo',
    '  node apps/cli/src/graphfly.js pg-migrate --database-url postgres://...',
    '  node apps/cli/src/graphfly.js embeddings-backfill --tenant-id ... --repo-id ... --limit 1000'
  ].join('\n');
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith('--')) throw new Error(`missing_value_for_${key}`);
    out[key] = val;
    i++;
  }
  return out;
}

async function localRun(args) {
  const tenantId = args['tenant-id'] ?? '00000000-0000-0000-0000-000000000001';
  const repoId = args['repo-id'] ?? '00000000-0000-0000-0000-000000000002';
  const docsRepoFullName = args['docs-repo-full-name'] ?? 'org/docs';
  const sourceRepoFullName = args['source-repo-full-name'] ?? 'local/source';
  const docsRepoPath = args['docs-repo-path'];
  if (!docsRepoPath) throw new Error('docs-repo-path is required');

  const resolvedDocsRepoPath = path.resolve(process.cwd(), docsRepoPath);
  if (!fs.existsSync(resolvedDocsRepoPath)) throw new Error('docs-repo-path does not exist');

  const sourceRepoRoot =
    args['source-repo-root'] ?? runGit(['rev-parse', '--show-toplevel'], process.cwd());
  const resolvedSourceRepoRoot = path.resolve(process.cwd(), sourceRepoRoot);
  if (!fs.existsSync(resolvedSourceRepoRoot)) throw new Error('source repo root does not exist');

  // Hard guard: docs repo must be separate from source repo (never write to source repo).
  const srcRoot = fs.realpathSync(path.resolve(resolvedSourceRepoRoot));
  const docsRoot = fs.realpathSync(path.resolve(resolvedDocsRepoPath));
  if (docsRoot === srcRoot || docsRoot.startsWith(srcRoot + path.sep)) {
    throw new Error('docs_repo_must_be_separate_from_source_repo');
  }

  const secret = `local-${Date.now()}`;
  const rt = await createRuntimeFromEnv({
    githubWebhookSecret: secret,
    docsRepoFullName,
    docsRepoPath: resolvedDocsRepoPath,
    repoFullName: sourceRepoFullName
  });
  rt.repoRegistry.register({
    fullName: sourceRepoFullName,
    tenantId,
    repoId,
    repoRoot: resolvedSourceRepoRoot,
    docsRepoFullName
  });

  const payload = Buffer.from(
    JSON.stringify({
      ref: 'refs/heads/main',
      after: 'local',
      repository: { full_name: sourceRepoFullName },
      commits: [{ added: [], modified: [], removed: [] }]
    }),
    'utf8'
  );
  const sig = computeGitHubSignature256({ secret, rawBody: payload });
  const delivery = `local-${Date.now()}`;
  const res = await rt.githubWebhookHandler({
    headers: { 'x-github-delivery': delivery, 'x-github-event': 'push', 'x-hub-signature-256': sig },
    rawBody: payload
  });
  if (res.status !== 200) {
    throw new Error(`webhook_failed:${res.status}`);
  }

  await rt.runToIdle();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, tenantId, repoId, sourceRepoRoot: resolvedSourceRepoRoot, docsRepoPath: resolvedDocsRepoPath }, null, 2));
}

async function embeddingsBackfill(args) {
  const tenantId = args['tenant-id'];
  const repoId = args['repo-id'];
  if (!tenantId || !repoId) throw new Error('tenant-id and repo-id are required');
  const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(5000, Math.trunc(Number(args.limit)))) : 500;

  const store = await createGraphStoreFromEnv({ repoFullName: 'cli/backfill' });
  const embed = createEmbeddingProviderFromEnv({ env: process.env });

  const nodes = await store.listNodes({ tenantId, repoId });
  const missing = nodes.filter(
    (n) => (!Array.isArray(n.embedding) || n.embedding.length !== 384) && typeof n.embedding_text === 'string' && n.embedding_text.trim().length > 0
  );
  const toProcess = missing.slice(0, limit);

  let updated = 0;
  for (const n of toProcess) {
    const vec = await embed(n.embedding_text);
    await store.upsertNode({ tenantId, repoId, node: { ...n, embedding: vec } });
    updated++;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, tenantId, repoId, scanned: nodes.length, missing: missing.length, updated }, null, 2));
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];
    if (!cmd) throw new Error('missing_command');
    if (cmd === 'local-run') {
      await localRun(args);
      return;
    }
    if (cmd === 'embeddings-backfill') {
      await embeddingsBackfill(args);
      return;
    }
    if (cmd === 'pg-migrate') {
      const databaseUrl = args['database-url'] ?? process.env.DATABASE_URL ?? '';
      if (!databaseUrl) throw new Error('database-url is required');
      const migrationFile = args['migration-file'] ?? 'migrations/001_init.sql';
      const abs = path.resolve(process.cwd(), migrationFile);
      const sqlText = fs.readFileSync(abs, 'utf8');
      const { createPgClient } = await import('../../../packages/pg-client/src/client.js');
      const { applySqlMigration } = await import('../../../packages/migrations/src/apply.js');
      const client = await createPgClient({ connectionString: databaseUrl });
      try {
        await applySqlMigration({ client, sqlText });
      } finally {
        await client.close();
      }
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ ok: true, applied: migrationFile }, null, 2));
      return;
    }
    throw new Error(`unknown_command:${cmd}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(String(err?.message ?? err));
    // eslint-disable-next-line no-console
    console.error(usage());
    process.exit(2);
  }
}

await main();
