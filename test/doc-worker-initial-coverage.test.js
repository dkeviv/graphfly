import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { createDocWorker } from '../workers/doc-agent/src/doc-worker.js';
import { InMemoryEntitlementsStore } from '../packages/entitlements/src/store.js';
import { InMemoryUsageCounters } from '../packages/usage/src/in-memory.js';

class CapturingDocsWriter {
  constructor() {
    this.calls = [];
  }

  async openPullRequest({ targetRepoFullName, title, body, branchName, files }) {
    this.calls.push({ targetRepoFullName, title, body, branchName, files });
    return { ok: true, targetRepoFullName, title, body, branchName, filesCount: files.length, files };
  }
}

test('doc worker initial run generates flow + contract docs (no code bodies)', async () => {
  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const docsWriter = new CapturingDocsWriter();
  const worker = createDocWorker({
    store,
    docsWriter,
    docStore,
    entitlementsStore: new InMemoryEntitlementsStore(),
    usageCounters: new InMemoryUsageCounters()
  });

  const tenantId = 't-1';
  const repoId = 'r-1';

  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'EP',
      qualified_name: 'http.GET./health',
      name: 'GET /health',
      node_type: 'ApiEndpoint',
      visibility: 'public',
      file_path: 'server.js',
      line_start: 1,
      line_end: 1,
      signature: 'GET /health',
      contract: { kind: 'http_route', method: 'GET', path: '/health' }
    }
  });
  store.upsertFlowEntrypoint({
    tenantId,
    repoId,
    entrypoint: { entrypoint_key: 'http:GET:/health', entrypoint_type: 'http_route', method: 'GET', path: '/health', symbol_uid: 'EP', entrypoint_symbol_uid: 'EP' }
  });

  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'FN',
      qualified_name: 'a.js::greet',
      name: 'greet',
      node_type: 'Function',
      visibility: 'public',
      file_path: 'a.js',
      line_start: 10,
      line_end: 20,
      signature: 'function greet(name, tone, retries)',
      contract: { kind: 'function', name: 'greet' }
    }
  });

  const out = await worker.handle({ payload: { tenantId, repoId, docsRepoFullName: 'org/docs', sha: 's1' } });
  assert.equal(out.ok, true);
  assert.equal(docsWriter.calls.length, 1);

  const paths = docsWriter.calls[0].files.map((f) => f.path);
  assert.ok(paths.some((p) => p.startsWith('flows/')));
  assert.ok(paths.some((p) => p.startsWith('contracts/')));
});

