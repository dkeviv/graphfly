import { GitHubClient } from '../../../../packages/github-client/src/client.js';

export async function enqueueInitialFullIndexOnRepoCreate({
  tenantId,
  repo,
  org,
  indexQueue,
  branch = null,
  docsRepoFullName = null,
  docsRepoFullNameFallback = null,
  resolveGitHubReaderToken,
  githubApiBaseUrl,
  GitHubClientImpl = GitHubClient
} = {}) {
  if (!tenantId) throw new Error('tenantId is required');
  if (!repo?.id) throw new Error('repo.id is required');
  if (!repo?.fullName) throw new Error('repo.fullName is required');
  if (!indexQueue?.add) throw new Error('indexQueue.add is required');
  if (typeof resolveGitHubReaderToken !== 'function') throw new Error('resolveGitHubReaderToken is required');

  const configuredDocsRepoFullName = docsRepoFullName ?? repo?.docsRepoFullName ?? org?.docsRepoFullName ?? docsRepoFullNameFallback ?? null;
  if (!configuredDocsRepoFullName) {
    const err = new Error('docs_repo_not_configured');
    err.code = 'docs_repo_not_configured';
    throw err;
  }

  let readerToken = null;
  try {
    readerToken = await resolveGitHubReaderToken({ tenantId, org });
  } catch (e) {
    const err = new Error('github_auth_not_configured');
    err.code = 'github_auth_not_configured';
    err.cause = e;
    throw err;
  }
  if (!readerToken) {
    const err = new Error('github_auth_not_configured');
    err.code = 'github_auth_not_configured';
    throw err;
  }

  const gh = new GitHubClientImpl({ token: readerToken, apiBaseUrl: githubApiBaseUrl?.() ?? 'https://api.github.com' });
  const info = await gh.getRepo({ fullName: repo.fullName });
  const effectiveBranch = branch ?? repo?.trackedBranch ?? info.defaultBranch ?? repo.defaultBranch ?? 'main';
  const sha = await gh.getBranchHeadSha({ fullName: repo.fullName, branch: effectiveBranch });
  if (!sha) {
    const err = new Error('github_head_sha_unavailable');
    err.code = 'github_head_sha_unavailable';
    err.metadata = { fullName: repo.fullName, branch: effectiveBranch };
    throw err;
  }

  return indexQueue.add('index.run', {
    tenantId,
    repoId: repo.id,
    repoRoot: process.env.SOURCE_REPO_ROOT ?? 'fixtures/sample-repo',
    sha,
    changedFiles: [],
    removedFiles: [],
    llmModel: org?.llmModel ?? null,
    docsRepoFullName: configuredDocsRepoFullName,
    cloneSource: info.cloneUrl ?? null,
    // IMPORTANT: do not persist auth tokens in durable queue payloads (docs/05_SECURITY.md).
  });
}
