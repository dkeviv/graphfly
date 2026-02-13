import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDocsRepoOnlyWrite } from '../packages/github-service/src/docs-repo-guard.js';
import { GitHubDocsWriter } from '../packages/github-service/src/docs-writer.js';

test('assertDocsRepoOnlyWrite blocks writes outside configured docs repo', () => {
  assert.throws(
    () => assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: 'org/docs', targetRepoFullName: 'org/source' }),
    /write_denied_target_not_docs_repo/
  );
});

test('GitHubDocsWriter openPullRequest allows writes to configured docs repo only', async () => {
  const w = new GitHubDocsWriter({ configuredDocsRepoFullName: 'org/docs' });
  const ok = await w.openPullRequest({
    targetRepoFullName: 'org/docs',
    title: 'Update docs',
    branchName: 'graphfly/update',
    files: [{ path: 'README.md', content: '# hi' }]
  });
  assert.equal(ok.ok, true);
  await assert.rejects(
    () =>
      w.openPullRequest({
        targetRepoFullName: 'org/source',
        title: 'Bad',
        branchName: 'x',
        files: []
      }),
    /write_denied_target_not_docs_repo/
  );
});

