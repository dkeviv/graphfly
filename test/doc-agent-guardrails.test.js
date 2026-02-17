import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { InMemoryLockStore } from '../packages/lock-store/src/in-memory.js';
import { createDocWorker } from '../workers/doc-agent/src/doc-worker.js';
import { InMemoryEntitlementsStore } from '../packages/entitlements/src/store.js';
import { InMemoryUsageCounters } from '../packages/usage/src/in-memory.js';
import { runDocPrWithOpenClaw } from '../workers/doc-agent/src/openclaw-doc-run.js';

class CapturingDocsWriter {
  constructor() {
    this.calls = [];
  }

  async openPullRequest({ targetRepoFullName, title, body, branchName, files }) {
    this.calls.push({ targetRepoFullName, title, body, branchName, files });
    return { ok: true, targetRepoFullName, title, body, branchName, filesCount: files.length, files };
  }
}

test('doc worker serializes doc runs with a lock store', async () => {
  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const docsWriter = new CapturingDocsWriter();
  const lockStore = new InMemoryLockStore();
  const worker = createDocWorker({
    store,
    docsWriter,
    docStore,
    entitlementsStore: new InMemoryEntitlementsStore(),
    usageCounters: new InMemoryUsageCounters(),
    lockStore
  });

  const tenantId = 't-1';
  const repoId = 'r-1';

  const lease = await lockStore.tryAcquire({ tenantId, repoId, lockName: 'docs_generate', ttlMs: 60_000 });
  assert.equal(lease.acquired, true);

  await assert.rejects(
    worker.handle({ payload: { tenantId, repoId, docsRepoFullName: 'org/docs', sha: 's1' } }),
    (e) => String(e?.message ?? e).includes('doc_agent_lock_busy')
  );
  assert.equal(docsWriter.calls.length, 0);
  assert.deepEqual(docStore.listPrRuns({ tenantId, repoId }), []);

  await lockStore.release({ tenantId, repoId, lockName: 'docs_generate', token: lease.token });
});

test('doc agent enforces tool-call budget', async () => {
  const prev = process.env.GRAPHFLY_DOC_AGENT_MAX_TOOL_CALLS;
  try {
    // Budget is clamped (min=20). Force enough entrypoints to exceed it.
    process.env.GRAPHFLY_DOC_AGENT_MAX_TOOL_CALLS = '20';

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
    for (let i = 0; i < 10; i++) {
      const uid = `EP_${i}`;
      store.upsertNode({
        tenantId,
        repoId,
        node: {
          symbol_uid: uid,
          qualified_name: `http.GET./health/${i}`,
          name: `GET /health/${i}`,
          node_type: 'ApiEndpoint',
          visibility: 'public',
          file_path: 'server.js',
          line_start: 1,
          line_end: 1,
          signature: `GET /health/${i}`,
          contract: { kind: 'http_route', method: 'GET', path: `/health/${i}` }
        }
      });
      store.upsertFlowEntrypoint({
        tenantId,
        repoId,
        entrypoint: {
          entrypoint_key: `http:GET:/health/${i}`,
          entrypoint_type: 'http_route',
          method: 'GET',
          path: `/health/${i}`,
          symbol_uid: uid,
          entrypoint_symbol_uid: uid
        }
      });
    }

    await assert.rejects(
      worker.handle({ payload: { tenantId, repoId, docsRepoFullName: 'org/docs', sha: 's1' } }),
      (e) => String(e?.message ?? e).includes('doc_agent_tool_budget_exceeded')
    );
  } finally {
    if (prev === undefined) delete process.env.GRAPHFLY_DOC_AGENT_MAX_TOOL_CALLS;
    else process.env.GRAPHFLY_DOC_AGENT_MAX_TOOL_CALLS = prev;
  }
});

test('doc agent retries gateway 5xx in remote mode (agent-loop retry)', async () => {
  const prevBase = process.env.GRAPHFLY_DOC_AGENT_RETRY_BASE_MS;
  const prevMax = process.env.GRAPHFLY_DOC_AGENT_RETRY_MAX_MS;
  const prevAttempts = process.env.GRAPHFLY_DOC_AGENT_HTTP_MAX_ATTEMPTS;
  try {
    process.env.GRAPHFLY_DOC_AGENT_RETRY_BASE_MS = '1';
    process.env.GRAPHFLY_DOC_AGENT_RETRY_MAX_MS = '1';
    process.env.GRAPHFLY_DOC_AGENT_HTTP_MAX_ATTEMPTS = '2';

    const store = new InMemoryGraphStore();
    const docStore = new InMemoryDocStore();
    const docsWriter = new CapturingDocsWriter();
    const tenantId = 't-1';
    const repoId = 'r-1';

    let callCount = 0;
    const requestJson = async ({ url, method, headers, body }) => {
      callCount++;
      if (callCount === 1) {
        return { status: 500, text: 'oops', json: { error: { message: 'boom' } } };
      }
      if (callCount === 2) {
        return {
          status: 200,
          text: '',
          json: {
            id: 'resp_1',
            output: [
              {
                type: 'function_call',
                name: 'github_create_pr',
                call_id: 'call_pr',
                arguments: JSON.stringify({
                  targetRepoFullName: 'org/docs',
                  title: 't',
                  body: 'b',
                  branchName: 'docs/update-test',
                  files: []
                })
              }
            ]
          }
        };
      }
      assert.ok(Array.isArray(body?.input));
      return { status: 200, text: '', json: { id: 'resp_2', output_text: 'done' } };
    };

    const { pr } = await runDocPrWithOpenClaw({
      store,
      docStore,
      docsWriter,
      tenantId,
      repoId,
      docsRepoFullName: 'org/docs',
      triggerSha: 's1',
      openclaw: { useRemote: true, requestJson, gatewayUrl: 'http://fake-gateway.local', token: '', agentId: 'doc-agent', model: 'openclaw' }
    });

    assert.equal(pr.ok, true);
    assert.equal(pr.empty, true);
    assert.equal(callCount, 3);
  } finally {
    if (prevBase === undefined) delete process.env.GRAPHFLY_DOC_AGENT_RETRY_BASE_MS;
    else process.env.GRAPHFLY_DOC_AGENT_RETRY_BASE_MS = prevBase;
    if (prevMax === undefined) delete process.env.GRAPHFLY_DOC_AGENT_RETRY_MAX_MS;
    else process.env.GRAPHFLY_DOC_AGENT_RETRY_MAX_MS = prevMax;
    if (prevAttempts === undefined) delete process.env.GRAPHFLY_DOC_AGENT_HTTP_MAX_ATTEMPTS;
    else process.env.GRAPHFLY_DOC_AGENT_HTTP_MAX_ATTEMPTS = prevAttempts;
  }
});
