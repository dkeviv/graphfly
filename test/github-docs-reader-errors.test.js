import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubDocsReader } from '../packages/github-service/src/docs-reader.js';

function makeFetch({ status }) {
  return async () => ({
    status,
    async text() {
      return JSON.stringify({ message: status === 404 ? 'Not Found' : 'Forbidden' });
    }
  });
}

test('GitHubDocsReader maps 404/403 into ok:false errors', async () => {
  const r404 = new GitHubDocsReader({
    configuredDocsRepoFullName: 'org/docs',
    token: 't',
    fetchImpl: makeFetch({ status: 404 })
  });

  const outList404 = await r404.listDir({ targetRepoFullName: 'org/docs', dirPath: '', ref: 'main' });
  assert.equal(outList404.ok, false);
  assert.equal(outList404.error, 'not_found');

  const outRead404 = await r404.readFile({ targetRepoFullName: 'org/docs', filePath: 'README.md', ref: 'main' });
  assert.equal(outRead404.ok, false);
  assert.equal(outRead404.error, 'not_found');

  const r403 = new GitHubDocsReader({
    configuredDocsRepoFullName: 'org/docs',
    token: 't',
    fetchImpl: makeFetch({ status: 403 })
  });

  const outList403 = await r403.listDir({ targetRepoFullName: 'org/docs', dirPath: '', ref: 'main' });
  assert.equal(outList403.ok, false);
  assert.equal(outList403.error, 'forbidden');
});

