import test from 'node:test';
import assert from 'node:assert/strict';
import { PgAssistantStore } from '../packages/assistant-store-pg/src/pg-assistant-store.js';

function makeFakeClient(respond) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: String(text), params: Array.isArray(params) ? params : [] });
      return respond(String(text), params ?? []);
    }
  };
}

test('PgAssistantStore.createDraft inserts assistant_drafts with jsonb files/citations', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('INSERT INTO assistant_drafts')) return { rows: [{ id: 'd-1', status: 'draft' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const st = new PgAssistantStore({ client, repoFullName: 'org/repo' });

  const draft = await st.createDraft({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    draftType: 'docs_edit',
    prompt: 'p',
    citations: [{ type: 'symbol', symbolUid: 'x' }],
    files: [{ path: 'assistant/x.md', content: '## X\n' }]
  });
  assert.equal(draft.id, 'd-1');

  const ins = client.calls.find((c) => c.text.includes('INSERT INTO assistant_drafts'));
  assert.ok(ins);
  assert.equal(ins.params[7], JSON.stringify([{ type: 'symbol', symbolUid: 'x' }]));
  assert.equal(ins.params[8], JSON.stringify([{ path: 'assistant/x.md', content: '## X\n' }]));
});

test('PgAssistantStore.updateDraft updates allowed fields', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.startsWith('UPDATE assistant_drafts')) return { rows: [{ id: 'd-1', status: 'applied', pr_url: 'u' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const st = new PgAssistantStore({ client, repoFullName: 'org/repo' });

  const out = await st.updateDraft({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    draftId: 'd-1',
    patch: { status: 'applied', prUrl: 'u' }
  });
  assert.equal(out.id, 'd-1');
});

test('PgAssistantStore thread methods insert threads and messages', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('INSERT INTO assistant_threads')) return { rows: [{ id: 'th-1', title: 'T', mode: 'support_safe' }] };
    if (text.includes('INSERT INTO assistant_messages')) return { rows: [{ id: 'm-1', role: 'user' }] };
    if (text.includes('UPDATE assistant_threads')) return { rows: [] };
    if (text.includes('SELECT * FROM assistant_threads')) return { rows: [{ id: 'th-1', title: 'T' }] };
    if (text.includes('SELECT * FROM assistant_messages')) return { rows: [{ id: 'm-1', role: 'user' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const st = new PgAssistantStore({ client, repoFullName: 'org/repo' });

  const thread = await st.createThread({ tenantId: 't-uuid', repoId: 'r-uuid', title: 'T', mode: 'support_safe' });
  assert.equal(thread.id, 'th-1');

  const msg = await st.addMessage({ tenantId: 't-uuid', repoId: 'r-uuid', threadId: 'th-1', role: 'user', content: 'Q' });
  assert.equal(msg.id, 'm-1');

  const got = await st.getThread({ tenantId: 't-uuid', repoId: 'r-uuid', threadId: 'th-1' });
  assert.equal(got.id, 'th-1');

  const msgs = await st.listMessages({ tenantId: 't-uuid', repoId: 'r-uuid', threadId: 'th-1', limit: 10 });
  assert.equal(msgs.length, 1);

  const insMsg = client.calls.find((c) => c.text.includes('INSERT INTO assistant_messages'));
  assert.ok(insMsg);
  assert.equal(insMsg.params[5], JSON.stringify([]));
});
