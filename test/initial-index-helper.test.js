import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueInitialFullIndexOnRepoCreate } from '../apps/api/src/lib/initial-index.js';

test('enqueueInitialFullIndexOnRepoCreate enqueues index.run with Reader App token and HEAD sha', async () => {
  const calls = [];
  const indexQueue = {
    async add(name, payload) {
      calls.push({ name, payload });
      return { id: 'job:1', name, payload };
    }
  };

  class FakeGitHubClient {
    constructor({ token, apiBaseUrl }) {
      this._token = token;
      this._base = apiBaseUrl;
    }
    async getRepo({ fullName }) {
      assert.equal(this._token, 'rtok');
      assert.equal(this._base, 'https://example-ghe.local/api/v3');
      assert.equal(fullName, 'acme/widgets');
      return { id: 1, fullName, defaultBranch: 'main', cloneUrl: 'https://github.com/acme/widgets.git' };
    }
    async getBranchHeadSha({ fullName, branch }) {
      assert.equal(fullName, 'acme/widgets');
      assert.equal(branch, 'main');
      return 'deadbeef';
    }
  }

  const job = await enqueueInitialFullIndexOnRepoCreate({
    tenantId: 't1',
    repo: { id: 'r1', fullName: 'acme/widgets', defaultBranch: 'main' },
    org: { githubReaderInstallId: 123, docsRepoFullName: 'docs-org/docs' },
    indexQueue,
    branch: 'main',
    resolveGitHubReaderToken: async () => 'rtok',
    githubApiBaseUrl: () => 'https://example-ghe.local/api/v3',
    GitHubClientImpl: FakeGitHubClient
  });

  assert.equal(job.id, 'job:1');
  assert.equal(job.name, 'index.run');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'index.run');
  assert.equal(calls[0].payload.sha, 'deadbeef');
  assert.equal(calls[0].payload.cloneAuth.password, 'rtok');
  assert.equal(calls[0].payload.docsRepoFullName, 'docs-org/docs');
});

test('enqueueInitialFullIndexOnRepoCreate errors when docs repo is missing', async () => {
  await assert.rejects(
    () =>
      enqueueInitialFullIndexOnRepoCreate({
        tenantId: 't1',
        repo: { id: 'r1', fullName: 'acme/widgets' },
        org: { githubReaderInstallId: 123 },
        indexQueue: { add: async () => ({ id: 'job:1' }) },
        resolveGitHubReaderToken: async () => 'rtok'
      }),
    (e) => String(e?.code ?? e?.message) === 'docs_repo_not_configured'
  );
});
