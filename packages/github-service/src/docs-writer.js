import { assertDocsRepoOnlyWrite } from './docs-repo-guard.js';

export class GitHubDocsWriter {
  constructor({ configuredDocsRepoFullName }) {
    this._docsRepo = configuredDocsRepoFullName;
  }

  async openPullRequest({ targetRepoFullName, title, body, branchName, files }) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    if (!title || !branchName) throw new Error('missing_title_or_branch');
    if (!Array.isArray(files)) throw new Error('files must be array');

    // Network calls intentionally not implemented in this repo.
    // In production this uses GitHub Docs App installation token scoped to the docs repo.
    return {
      ok: true,
      targetRepoFullName,
      title,
      body: body ?? '',
      branchName,
      filesCount: files.length
    };
  }
}

