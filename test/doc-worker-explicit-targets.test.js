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
    return { ok: true, targetRepoFullName, branchName, filesCount: files.length, files };
  }
}

test('doc worker honors explicit symbolUids targets (coverage dashboard document action)', async () => {
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
      symbol_uid: 'FN1',
      qualified_name: 'src/a.ts::f1',
      name: 'f1',
      node_type: 'Function',
      visibility: 'public',
      file_path: 'src/a.ts',
      line_start: 1,
      line_end: 1,
      signature: 'function f1()',
      contract: { kind: 'function', name: 'f1' }
    }
  });
  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'FN2',
      qualified_name: 'src/b.ts::f2',
      name: 'f2',
      node_type: 'Function',
      visibility: 'public',
      file_path: 'src/b.ts',
      line_start: 1,
      line_end: 1,
      signature: 'function f2()',
      contract: { kind: 'function', name: 'f2' }
    }
  });

  const out = await worker.handle({
    payload: { tenantId, repoId, docsRepoFullName: 'org/docs', sha: 's1', symbolUids: ['FN1'] }
  });
  assert.equal(out.ok, true);
  assert.equal(docsWriter.calls.length, 1);

  const paths = docsWriter.calls[0].files.map((f) => f.path);
  assert.equal(paths.length, 1);
  assert.ok(paths[0].includes('contracts/function/'));
  assert.ok(paths[0].includes('src-a-ts-f1'));
});

