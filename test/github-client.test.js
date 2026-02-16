import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../packages/github-client/src/client.js';

test('GitHubClient.listUserRepos maps GitHub fields', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/user/repos')) {
      return {
        status: 200,
        async text() {
          return JSON.stringify([{ id: 1, full_name: 'acme/source', default_branch: 'main', clone_url: 'https://x.git', private: true }]);
        }
      };
    }
    return { status: 500, async text() { return JSON.stringify({ message: 'unexpected' }); } };
  };
  const gh = new GitHubClient({ token: 't', fetchImpl, apiBaseUrl: 'https://api.github.com' });
  const repos = await gh.listUserRepos();
  assert.deepEqual(repos, [{ id: 1, fullName: 'acme/source', defaultBranch: 'main', cloneUrl: 'https://x.git', private: true }]);
});

test('GitHubClient.listInstallationRepos maps GitHub fields', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/installation/repositories')) {
      return {
        status: 200,
        async text() {
          return JSON.stringify({
            repositories: [{ id: 2, full_name: 'acme/installed', default_branch: 'trunk', clone_url: 'https://y.git', private: false }]
          });
        }
      };
    }
    return { status: 500, async text() { return JSON.stringify({ message: 'unexpected' }); } };
  };
  const gh = new GitHubClient({ token: 't', fetchImpl, apiBaseUrl: 'https://api.github.com' });
  const repos = await gh.listInstallationRepos();
  assert.deepEqual(repos, [{ id: 2, fullName: 'acme/installed', defaultBranch: 'trunk', cloneUrl: 'https://y.git', private: false }]);
});
