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

test('GitHubClient.listBranches maps branch names', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/repos/acme/source/branches')) {
      return {
        status: 200,
        async text() {
          return JSON.stringify([
            { name: 'main', protected: true, commit: { sha: 'a' } },
            { name: 'dev', protected: false, commit: { sha: 'b' } }
          ]);
        }
      };
    }
    return { status: 500, async text() { return JSON.stringify({ message: 'unexpected' }); } };
  };
  const gh = new GitHubClient({ token: 't', fetchImpl, apiBaseUrl: 'https://api.github.com' });
  const branches = await gh.listBranches({ fullName: 'acme/source' });
  assert.deepEqual(branches, [
    { name: 'main', sha: 'a', protected: true },
    { name: 'dev', sha: 'b', protected: false }
  ]);
});

test('GitHubClient.createUserRepo posts and maps fields', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/user/repos')) {
      assert.equal(init.method, 'POST');
      return {
        status: 201,
        async text() {
          return JSON.stringify({ id: 3, full_name: 'me/docs', default_branch: 'main', clone_url: 'https://z.git', private: true });
        }
      };
    }
    return { status: 500, async text() { return JSON.stringify({ message: 'unexpected' }); } };
  };
  const gh = new GitHubClient({ token: 't', fetchImpl, apiBaseUrl: 'https://api.github.com' });
  const out = await gh.createUserRepo({ name: 'docs', private: true, autoInit: true });
  assert.deepEqual(out, { id: 3, fullName: 'me/docs', defaultBranch: 'main', cloneUrl: 'https://z.git', private: true });
});

test('GitHubClient.createOrgRepo posts and maps fields', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).includes('/orgs/acme/repos')) {
      assert.equal(init.method, 'POST');
      return {
        status: 201,
        async text() {
          return JSON.stringify({ id: 4, full_name: 'acme/docs', default_branch: 'main', clone_url: 'https://o.git', private: false });
        }
      };
    }
    return { status: 500, async text() { return JSON.stringify({ message: 'unexpected' }); } };
  };
  const gh = new GitHubClient({ token: 't', fetchImpl, apiBaseUrl: 'https://api.github.com' });
  const out = await gh.createOrgRepo({ org: 'acme', name: 'docs', private: false });
  assert.deepEqual(out, { id: 4, fullName: 'acme/docs', defaultBranch: 'main', cloneUrl: 'https://o.git', private: false });
});
