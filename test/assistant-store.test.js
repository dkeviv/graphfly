import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAssistantStore } from '../packages/assistant-store/src/in-memory.js';

test('InMemoryAssistantStore creates/gets/updates drafts', async () => {
  const st = new InMemoryAssistantStore();
  const tenantId = 't-1';
  const repoId = 'r-1';

  const created = await st.createDraft({
    tenantId,
    repoId,
    draftType: 'docs_edit',
    prompt: 'Update docs',
    citations: [{ type: 'symbol', symbolUid: 'x' }],
    files: [{ path: 'assistant/x.md', content: '## X\n' }]
  });

  assert.ok(created.id);
  assert.equal(created.status, 'draft');
  const got = await st.getDraft({ tenantId, repoId, draftId: created.id });
  assert.equal(got.id, created.id);

  const updated = await st.updateDraft({ tenantId, repoId, draftId: created.id, patch: { status: 'applied', pr: { prUrl: 'u' } } });
  assert.equal(updated.status, 'applied');

  const list = await st.listDrafts({ tenantId, repoId, limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
});

test('InMemoryAssistantStore creates threads and stores messages', async () => {
  const st = new InMemoryAssistantStore();
  const tenantId = 't-1';
  const repoId = 'r-1';

  const thread = await st.createThread({ tenantId, repoId, title: 'Login flow', mode: 'support_safe' });
  assert.ok(thread.id);
  assert.equal(thread.title, 'Login flow');

  const msg1 = await st.addMessage({ tenantId, repoId, threadId: thread.id, role: 'user', content: 'How does login work?' });
  assert.ok(msg1.id);

  const msg2 = await st.addMessage({ tenantId, repoId, threadId: thread.id, role: 'assistant', content: 'It uses OAuth.' });
  assert.ok(msg2.id);

  const threads = await st.listThreads({ tenantId, repoId, limit: 10 });
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, thread.id);

  const messages = await st.listMessages({ tenantId, repoId, threadId: thread.id, limit: 10 });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
});
