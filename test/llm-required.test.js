import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { runDocsAssistantQuery } from '../packages/assistant-agent/src/assistant-agent.js';
import { runDocPrWithLlm } from '../workers/doc-agent/src/llm-doc-run.js';
import { runGraphEnrichmentWithLlm } from '../workers/graph-agent/src/llm-graph-run.js';

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

test('prod requires LLM key for assistant query by default', async () => {
  await withEnv(
    {
      GRAPHFLY_MODE: 'prod',
      GRAPHFLY_LLM_REQUIRED: '1',
      OPENROUTER_API_KEY: null
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
        /llm_api_key_required/
      );
    }
  );
});

test('prod requires LLM key for doc agent by default', async () => {
  await withEnv(
    {
      GRAPHFLY_MODE: 'prod',
      GRAPHFLY_LLM_REQUIRED: '1',
      OPENROUTER_API_KEY: null
    },
    async () => {
      const store = new InMemoryGraphStore();
      const docStore = new InMemoryDocStore();
      const docsWriter = { async openPullRequest() { return { ok: true, stub: true }; } };
      await assert.rejects(
        () =>
          runDocPrWithLlm({
            store,
            docStore,
            docsWriter,
            tenantId: 't',
            repoId: 'r',
            docsRepoFullName: 'org/docs',
            triggerSha: 'deadbeef'
          }),
        /llm_api_key_required/
      );
    }
  );
});

test('prod requires LLM key for graph agent by default', async () => {
  await withEnv(
    {
      GRAPHFLY_MODE: 'prod',
      GRAPHFLY_LLM_REQUIRED: '1',
      OPENROUTER_API_KEY: null
    },
    async () => {
      const store = new InMemoryGraphStore();
      await assert.rejects(
        () => runGraphEnrichmentWithLlm({ store, tenantId: 't', repoId: 'r', triggerSha: 'deadbeef' }),
        /llm_api_key_required/
      );
    }
  );
});
