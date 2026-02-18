import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createJsonRouter } from '../apps/api/src/tiny-router.js';
import { registerAssistantRoutes } from '../apps/api/src/routes/assistant.js';
import { requireRole, tenantIdFromCtx } from '../apps/api/src/middleware/auth.js';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';
import { InMemoryAssistantStore } from '../packages/assistant-store/src/in-memory.js';
import { LocalDocsWriter } from '../packages/github-service/src/local-docs-writer.js';
import { LocalDocsReader } from '../packages/github-service/src/local-docs-reader.js';

function runGit(args, cwd) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) throw new Error((p.stderr || p.stdout || '').trim());
  return p.stdout.trim();
}

function makeReq({ method, url, body, headers = {} }) {
  const chunks = body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [];
  const r = Readable.from(chunks);
  r.method = method;
  r.url = url;
  r.headers = headers;
  return r;
}

test('assistant routes: draft then confirm opens local docs commit', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-docs-'));
  runGit(['init'], tmp);
  fs.writeFileSync(path.join(tmp, 'README.md'), '# Docs\n', 'utf8');
  runGit(['add', '-A'], tmp);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init'], tmp);

  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const assistantStore = new InMemoryAssistantStore();
  const orgStore = { async getOrg() { return { docsRepoFullName: 'org/docs' }; } };
  const docsWriterFactory = async ({ configuredDocsRepoFullName }) => new LocalDocsWriter({ configuredDocsRepoFullName, docsRepoPath: tmp });
  const docsReaderFactory = async ({ configuredDocsRepoFullName }) => new LocalDocsReader({ configuredDocsRepoFullName, docsRepoPath: tmp });
  const lockStore = null;
  const realtime = null;

  const router = createJsonRouter();
  router.use(async (ctx) => {
    ctx.auth = { tenantId: 't', userId: 'u', role: 'admin' };
    return null;
  });

  registerAssistantRoutes({
    router,
    store,
    docStore,
    assistantStore,
    orgStore,
    docsRepoFullNameFallback: 'org/docs',
    docsWriterFactory,
    docsReaderFactory,
    lockStore,
    realtime,
    auditEvent: async () => {},
    requireRole,
    tenantIdFromCtx,
    DEFAULT_TENANT_ID: 't',
    DEFAULT_REPO_ID: 'r'
  });

  const draftRes = await router.handle(
    makeReq({
      method: 'POST',
      url: '/assistant/docs/draft',
      body: { tenantId: 't', repoId: 'r', instruction: 'Write a short overview of login' }
    })
  );
  assert.equal(draftRes.status, 200);
  assert.ok(draftRes.body.draftId);

  const confirmRes = await router.handle(
    makeReq({
      method: 'POST',
      url: '/assistant/docs/confirm',
      body: { tenantId: 't', repoId: 'r', draftId: draftRes.body.draftId }
    })
  );
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.body.ok, true);

  const applied = await assistantStore.getDraft({ tenantId: 't', repoId: 'r', draftId: draftRes.body.draftId });
  assert.equal(applied.status, 'applied');

  const status = runGit(['status', '--porcelain'], tmp);
  assert.equal(status, '');
});

test('assistant routes: threads persist messages on query', async () => {
  const store = new InMemoryGraphStore();
  const docStore = new InMemoryDocStore();
  const assistantStore = new InMemoryAssistantStore();
  const orgStore = { async getOrg() { return { docsRepoFullName: 'org/docs' }; } };
  const docsWriterFactory = async ({ configuredDocsRepoFullName }) => new LocalDocsWriter({ configuredDocsRepoFullName, docsRepoPath: process.cwd() });
  const docsReaderFactory = async ({ configuredDocsRepoFullName }) => new LocalDocsReader({ configuredDocsRepoFullName, docsRepoPath: process.cwd() });
  const lockStore = null;
  const realtime = null;

  const router = createJsonRouter();
  router.use(async (ctx) => {
    ctx.auth = { tenantId: 't', userId: 'u', role: 'admin' };
    return null;
  });

  registerAssistantRoutes({
    router,
    store,
    docStore,
    assistantStore,
    orgStore,
    docsRepoFullNameFallback: 'org/docs',
    docsWriterFactory,
    docsReaderFactory,
    lockStore,
    realtime,
    auditEvent: async () => {},
    requireRole,
    tenantIdFromCtx,
    DEFAULT_TENANT_ID: 't',
    DEFAULT_REPO_ID: 'r'
  });

  const thRes = await router.handle(
    makeReq({
      method: 'POST',
      url: '/assistant/threads',
      body: { tenantId: 't', repoId: 'r', title: 'Thread' }
    })
  );
  assert.equal(thRes.status, 200);
  const threadId = thRes.body.thread.id;
  assert.ok(threadId);

  const qRes = await router.handle(
    makeReq({
      method: 'POST',
      url: '/assistant/query',
      body: { tenantId: 't', repoId: 'r', threadId, question: 'How does login work?' }
    })
  );
  assert.equal(qRes.status, 200);

  const threadRes = await router.handle(
    makeReq({
      method: 'GET',
      url: `/assistant/thread?tenantId=t&repoId=r&threadId=${encodeURIComponent(threadId)}&limit=50`
    })
  );
  assert.equal(threadRes.status, 200);
  assert.equal(threadRes.body.messages.length, 2);
  assert.equal(threadRes.body.messages[0].role, 'user');
  assert.equal(threadRes.body.messages[1].role, 'assistant');
});
