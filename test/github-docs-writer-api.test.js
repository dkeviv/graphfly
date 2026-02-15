import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubDocsWriter } from '../packages/github-service/src/docs-writer.js';

test('GitHubDocsWriter uses GitHub REST when token is configured', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ?? null });

    const u = String(url);
    if (u.endsWith('/repos/acme/docs')) {
      return { status: 200, async text() { return JSON.stringify({ default_branch: 'main' }); } };
    }
    if (u.includes('/git/ref/heads/main')) {
      return { status: 200, async text() { return JSON.stringify({ object: { sha: 'base_sha' } }); } };
    }
    if (u.endsWith('/git/refs') && init.method === 'POST') {
      return { status: 201, async text() { return JSON.stringify({ ok: true }); } };
    }
    if (u.includes('/contents/flows/login.md?ref=docs%2Fupdate') && init.method === 'GET') {
      return { status: 404, async text() { return JSON.stringify({ message: 'Not Found' }); } };
    }
    if (u.endsWith('/contents/flows/login.md') && init.method === 'PUT') {
      return { status: 201, async text() { return JSON.stringify({ content: { sha: 'c1' } }); } };
    }
    if (u.endsWith('/pulls') && init.method === 'POST') {
      return { status: 201, async text() { return JSON.stringify({ number: 7, html_url: 'https://github.com/acme/docs/pull/7' }); } };
    }
    return { status: 500, async text() { return JSON.stringify({ message: `unexpected ${u}` }); } };
  };

  const writer = new GitHubDocsWriter({
    configuredDocsRepoFullName: 'acme/docs',
    token: 't',
    fetchImpl,
    apiBaseUrl: 'https://api.github.com'
  });

  const res = await writer.openPullRequest({
    targetRepoFullName: 'acme/docs',
    title: 'Update docs',
    body: 'b',
    branchName: 'docs/update',
    files: [{ path: 'flows/login.md', content: '# Login' }]
  });

  assert.equal(res.ok, true);
  assert.equal(res.prNumber, 7);
  assert.equal(res.filesCount, 1);
  assert.ok(calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls')));
});
