import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function codedError(code, message, metadata = null) {
  const err = new Error(message ?? code);
  err.code = code;
  if (metadata) err.metadata = metadata;
  return err;
}

function isPathInside({ parent, child }) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function gitHeadSha(repoRoot) {
  const res = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const sha = String(res.stdout ?? '').trim();
  if (!sha || sha.length < 7) return null;
  return sha;
}

export async function enqueueLocalFullIndexOnRepoCreate({
  tenantId,
  repo,
  org,
  indexQueue,
  repoRoot,
  docsRepoFullNameFallback = null,
  docsRepoPath = null
} = {}) {
  if (!tenantId) throw new Error('tenantId is required');
  if (!repo?.id) throw new Error('repo.id is required');
  if (!repo?.fullName) throw new Error('repo.fullName is required');
  if (!indexQueue?.add) throw new Error('indexQueue.add is required');
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new Error('repoRoot is required');

  const configuredDocsRepoFullName = org?.docsRepoFullName ?? docsRepoFullNameFallback ?? null;
  if (!configuredDocsRepoFullName) throw codedError('docs_repo_not_configured', 'docs_repo_not_configured');

  const absRepoRoot = safeRealpath(repoRoot);
  if (!absRepoRoot) throw codedError('local_repo_not_found', 'local_repo_not_found', { repoRoot });

  const st = fs.statSync(absRepoRoot);
  if (!st.isDirectory()) throw codedError('local_repo_not_directory', 'local_repo_not_directory', { repoRoot: absRepoRoot });

  const sha = gitHeadSha(absRepoRoot);
  if (!sha) throw codedError('local_repo_not_git', 'local_repo_not_git', { repoRoot: absRepoRoot });

  // Docs repo must be separate. In local mode, enforce that DOCS_REPO_PATH is not inside the source repo.
  if (docsRepoPath) {
    const absDocs = safeRealpath(docsRepoPath);
    if (absDocs && isPathInside({ parent: absRepoRoot, child: absDocs })) {
      throw codedError('docs_repo_path_collision', 'docs_repo_path_collision', { repoRoot: absRepoRoot, docsRepoPath: absDocs });
    }
  }

  return indexQueue.add('index.run', {
    tenantId,
    repoId: repo.id,
    repoRoot: absRepoRoot,
    sha,
    changedFiles: [],
    removedFiles: [],
    docsRepoFullName: configuredDocsRepoFullName,
    cloneSource: null,
    cloneAuth: null
  });
}

