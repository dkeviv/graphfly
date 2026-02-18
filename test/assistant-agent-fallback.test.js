import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { embedText384 } from '../packages/cig/src/embedding.js';
import { runDocsAssistantQuery, runDocsAssistantDraftDocs } from '../packages/assistant-agent/src/assistant-agent.js';

test('assistant query fallback returns citations and no code fences', async () => {
  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const tenantId = 't';
  const repoId = 'r';

  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'js::x::1',
      qualified_name: 'pkg.fn',
      name: 'fn',
      node_type: 'Function',
      symbol_kind: 'function',
      file_path: 'src/x.ts',
      line_start: 1,
      line_end: 2,
      language: 'typescript',
      visibility: 'public',
      signature: 'fn(a: string): boolean',
      signature_hash: 'h',
      embedding_text: 'pkg.fn fn(a: string): boolean',
      embedding: embedText384('pkg.fn fn(a: string): boolean'),
      first_seen_sha: 'a',
      last_seen_sha: 'a'
    }
  });
  store.upsertFlowEntrypoint({
    tenantId,
    repoId,
    entrypoint: {
      entrypoint_key: 'http:GET:/login',
      entrypoint_type: 'http_route',
      method: 'GET',
      path: '/login',
      symbol_uid: 'js::x::1',
      entrypoint_symbol_uid: 'js::x::1',
      file_path: 'src/x.ts',
      line_start: 1,
      line_end: 1,
      sha: 'a'
    }
  });

  const out = await runDocsAssistantQuery({ store, docStore, tenantId, repoId, question: 'How does login work?' });
  assert.equal(out.ok, true);
  assert.ok(typeof out.answerMarkdown === 'string' && out.answerMarkdown.length > 0);
  assert.equal(out.answerMarkdown.includes('```'), false);
  assert.ok(Array.isArray(out.citations));
  assert.ok(out.citations.some((c) => c.type === 'symbol'));
  assert.ok(out.citations.some((c) => c.type === 'flow'));
});

test('assistant draft fallback produces a docs file + diff and rejects code fences', async () => {
  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const tenantId = 't';
  const repoId = 'r';

  store.upsertNode({
    tenantId,
    repoId,
    node: {
      symbol_uid: 'js::x::1',
      qualified_name: 'pkg.fn',
      name: 'fn',
      node_type: 'Function',
      symbol_kind: 'function',
      file_path: 'src/x.ts',
      line_start: 1,
      line_end: 2,
      language: 'typescript',
      visibility: 'public',
      signature: 'fn(a: string): boolean',
      signature_hash: 'h',
      embedding_text: 'pkg.fn fn(a: string): boolean',
      embedding: embedText384('pkg.fn fn(a: string): boolean'),
      first_seen_sha: 'a',
      last_seen_sha: 'a'
    }
  });

  const out = await runDocsAssistantDraftDocs({ store, docStore, tenantId, repoId, instruction: 'Write onboarding docs for login', docsRepoFullName: 'org/docs' });
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.files) && out.files.length === 1);
  assert.ok(out.files[0].path.endsWith('.md'));
  assert.equal(out.files[0].content.includes('```'), false);
  assert.ok(typeof out.diff === 'string' && out.diff.length > 0);
});

