import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertDocsRepoOnlyWrite } from './docs-repo-guard.js';

function runGit(args, cwd) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) {
    const msg = (p.stderr || p.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
  return p.stdout.trim();
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export class LocalDocsWriter {
  constructor({ configuredDocsRepoFullName, docsRepoPath }) {
    if (!configuredDocsRepoFullName) throw new Error('configuredDocsRepoFullName required');
    if (!docsRepoPath) throw new Error('docsRepoPath required');
    this._docsRepo = configuredDocsRepoFullName;
    this._path = docsRepoPath;
  }

  async openPullRequest({ targetRepoFullName, title, body, branchName, files }) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    if (!title || !branchName) throw new Error('missing_title_or_branch');
    if (!Array.isArray(files)) throw new Error('files must be array');

    // Ensure repo exists and is a git repo.
    runGit(['rev-parse', '--is-inside-work-tree'], this._path);

    // Create branch (fail if it already exists).
    const existing = runGit(['branch', '--list', branchName], this._path);
    if (existing) throw new Error('branch_already_exists');
    runGit(['checkout', '-b', branchName], this._path);

    // Write files.
    for (const f of files) {
      if (!f?.path) throw new Error('file.path required');
      const abs = path.join(this._path, f.path);
      if (!abs.startsWith(path.resolve(this._path))) throw new Error('invalid_path');
      ensureDir(path.dirname(abs));
      fs.writeFileSync(abs, String(f.content ?? ''), 'utf8');
    }

    runGit(['add', '-A'], this._path);
    // Allow empty commits? For idempotency, skip if nothing changed.
    const status = runGit(['status', '--porcelain'], this._path);
    if (!status) {
      return { ok: true, targetRepoFullName, title, body: body ?? '', branchName, filesCount: files.length, commit: null, empty: true };
    }
    runGit(['-c', 'user.name=graphfly', '-c', 'user.email=graphfly@local', 'commit', '-m', title], this._path);
    const commit = runGit(['rev-parse', 'HEAD'], this._path);
    return { ok: true, targetRepoFullName, title, body: body ?? '', branchName, filesCount: files.length, commit };
  }
}

