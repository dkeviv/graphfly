#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createRuntime } from '../../../packages/runtime/src/runtime.js';
import { computeGitHubSignature256 } from '../../../packages/github-webhooks/src/verify.js';

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
    '',
    'Options:',
    '  --docs-repo-path <path>        Required. Local docs git repo path.',
    '  --docs-repo-full-name <name>   Default: org/docs',
    '  --source-repo-root <path>      Default: auto-detect git root from CWD',
    '  --source-repo-full-name <name> Default: local/source',
    '  --tenant-id <id>               Default: t-1',
    '  --repo-id <id>                 Default: r-1',
    '',
    'Example:',
    '  node apps/cli/src/graphfly.js local-run --docs-repo-path ../my-docs-repo'
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
  const tenantId = args['tenant-id'] ?? 't-1';
  const repoId = args['repo-id'] ?? 'r-1';
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

  const secret = `local-${Date.now()}`;
  const rt = createRuntime({ githubWebhookSecret: secret, docsRepoFullName, docsRepoPath: resolvedDocsRepoPath });
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

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const cmd = args._[0];
    if (!cmd) throw new Error('missing_command');
    if (cmd !== 'local-run') throw new Error(`unknown_command:${cmd}`);
    await localRun(args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(String(err?.message ?? err));
    // eslint-disable-next-line no-console
    console.error(usage());
    process.exit(2);
  }
}

await main();

