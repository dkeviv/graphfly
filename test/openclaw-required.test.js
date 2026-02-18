import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { runDocsAssistantQuery } from '../packages/assistant-agent/src/assistant-agent.js';
import { runDocPrWithOpenClaw } from '../workers/doc-agent/src/openclaw-doc-run.js';
import { runGraphEnrichmentWithOpenClaw } from '../workers/graph-agent/src/openclaw-graph-run.js';

function withEnv(patch, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test('prod requires OpenClaw remote for assistant query', async () => {
  await withEnv(
    {
      GRAPHFLY_MODE: 'prod',
      GRAPHFLY_OPENCLAW_REQUIRED: '1',
      OPENCLAW_GATEWAY_URL: null,
      OPENCLAW_GATEWAY_TOKEN: null,
      OPENCLAW_TOKEN: null,
      OPENCLAW_USE_REMOTE: null
    },
    async () => {
      const store = new InMemoryGraphStore();
      const docStore = new InMemoryDocStore();
      await assert.rejects(
        () =>
          runDocsAssistantQuery({
            store,
            docStore,
            tenantId: 't',
            repoId: 'r',
            question: 'How does login work?'
          }),
        /openclaw_remote_required/
      );
    }
  );
});

test('prod requires OpenClaw remote for doc agent', async () => {
  await withEnv(
    {
      GRAPHFLY_MODE: 'prod',
      GRAPHFLY_OPENCLAW_REQUIRED: '1',
      OPENCLAW_GATEWAY_URL: null,
      OPENCLAW_GATEWAY_TOKEN: null,
      OPENCLAW_TOKEN: null,
      OPENCLAW_USE_REMOTE: null
    },
    async () => {
      const store = new InMemoryGraphStore();
      const docStore = new InMemoryDocStore();
      const docsWriter = { async openPullRequest() { return { ok: true, stub: true }; } };
      await assert.rejects(
        () =>
          runDocPrWithOpenClaw({
            store,
            docStore,
            docsWriter,
            tenantId: 't',
            repoId: 'r',
            docsRepoFullName: 'org/docs',
            triggerSha: 'deadbeef'
          }),
        /openclaw_remote_required/
      );
    }
  );
});

test('prod requires OpenClaw remote for graph agent', async () => {
  await withEnv(
    {
      GRAPHFLY_MODE: 'prod',
      GRAPHFLY_OPENCLAW_REQUIRED: '1',
      OPENCLAW_GATEWAY_URL: null,
      OPENCLAW_GATEWAY_TOKEN: null,
      OPENCLAW_TOKEN: null
    },
    async () => {
      const store = new InMemoryGraphStore();
      await assert.rejects(
        () => runGraphEnrichmentWithOpenClaw({ store, tenantId: 't', repoId: 'r', triggerSha: 'deadbeef' }),
        /openclaw_remote_required/
      );
    }
  );
});

