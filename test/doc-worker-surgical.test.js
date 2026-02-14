import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { createDocWorker } from '../workers/doc-agent/src/doc-worker.js';

class CapturingDocsWriter {
  constructor() {
    this.calls = [];
  }

  async openPullRequest({ targetRepoFullName, title, body, branchName, files }) {
    this.calls.push({ targetRepoFullName, title, body, branchName, files });
    return { ok: true, targetRepoFullName, title, body, branchName, filesCount: files.length, files };
  }
}

test('doc worker regenerates only stale flow blocks (surgical)', async () => {
  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const docsWriter = new CapturingDocsWriter();
  const worker = createDocWorker({ store, docsWriter, docStore });

  const tenantId = 't-1';
  const repoId = 'r-1';

  // Two entrypoints A and B.
  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'A',
      qualified_name: 'http.GET./health',
      name: 'GET /health',
      node_type: 'ApiEndpoint',
      file_path: 'server.js',
      line_start: 1,
      line_end: 1,
      signature: 'GET /health',
      contract: { kind: 'http_route', method: 'GET', path: '/health' }
    }
  });
  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'B',
      qualified_name: 'http.GET./ready',
      name: 'GET /ready',
      node_type: 'ApiEndpoint',
      file_path: 'server.js',
      line_start: 2,
      line_end: 2,
      signature: 'GET /ready',
      contract: { kind: 'http_route', method: 'GET', path: '/ready' }
    }
  });

  store.upsertFlowEntrypoint({
    tenantId,
    repoId,
    entrypoint: { entrypoint_key: 'http:GET:/health', entrypoint_type: 'http_route', method: 'GET', path: '/health', symbol_uid: 'A', entrypoint_symbol_uid: 'A' }
  });
  store.upsertFlowEntrypoint({
    tenantId,
    repoId,
    entrypoint: { entrypoint_key: 'http:GET:/ready', entrypoint_type: 'http_route', method: 'GET', path: '/ready', symbol_uid: 'B', entrypoint_symbol_uid: 'B' }
  });

  // Two blocks exist; only one is stale.
  const b1 = docStore.upsertBlock({
    tenantId,
    repoId,
    docFile: 'flows/http-get-health.md',
    blockAnchor: '## http.GET./health',
    blockType: 'flow',
    content: '## http.GET./health\n',
    status: 'stale'
  });
  docStore.setEvidence({ tenantId, repoId, blockId: b1.id, evidence: [{ symbolUid: 'A' }] });

  const b2 = docStore.upsertBlock({
    tenantId,
    repoId,
    docFile: 'flows/http-get-ready.md',
    blockAnchor: '## http.GET./ready',
    blockType: 'flow',
    content: '## http.GET./ready\n',
    status: 'fresh'
  });
  docStore.setEvidence({ tenantId, repoId, blockId: b2.id, evidence: [{ symbolUid: 'B' }] });

  const out = await worker.handle({ payload: { tenantId, repoId, docsRepoFullName: 'org/docs', sha: 's1' } });
  assert.equal(out.ok, true);
  assert.equal(docsWriter.calls.length, 1);
  assert.equal(docsWriter.calls[0].files.length, 1);
  assert.equal(docsWriter.calls[0].files[0].path, 'flows/http-get-health.md');
});

