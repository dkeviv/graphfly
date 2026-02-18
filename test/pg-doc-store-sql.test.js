import test from 'node:test';
import assert from 'node:assert/strict';
import { PgDocStore } from '../packages/doc-store-pg/src/pg-doc-store.js';
import { hashString } from '../packages/cig/src/types.js';

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

test('PgDocStore.upsertBlock upserts doc_blocks with content_hash', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('INSERT INTO doc_blocks')) return { rows: [{ id: 'b-1', status: 'fresh' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });

  const content = '## X\n\n- Contract: ...\n';
  const b = await ds.upsertBlock({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    docFile: 'flows/x.md',
    blockAnchor: '## X',
    blockType: 'flow',
    content,
    status: 'fresh'
  });
  assert.equal(b.id, 'b-1');

  const insert = client.calls.find((c) => c.text.includes('INSERT INTO doc_blocks'));
  assert.ok(insert);
  assert.equal(insert.params[7], hashString(content));
});

test('PgDocStore.setEvidence clears then bulk-inserts doc_evidence', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.startsWith('DELETE FROM doc_evidence')) return { rows: [] };
    if (text.includes('FROM graph_nodes') && text.includes('symbol_uid = ANY')) {
      return { rows: [{ id: 'n-1', symbol_uid: 'sym:1', qualified_name: 'a.b' }] };
    }
    if (text.includes('INSERT INTO doc_evidence') && text.includes('jsonb_to_recordset')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });

  const res = await ds.setEvidence({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    blockId: 'b-1',
    evidence: [{ symbolUid: 'sym:1', filePath: 'a.js', lineStart: 1, lineEnd: 2, sha: 'abc', evidenceKind: 'flow' }]
  });
  assert.equal(res.ok, true);
  assert.equal(res.count, 1);
  assert.ok(client.calls.some((c) => c.text.includes('INSERT INTO doc_evidence') && c.text.includes('jsonb_to_recordset')));
});

test('PgDocStore.markBlocksStaleForSymbolUids updates doc_blocks via evidence join', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('UPDATE doc_blocks') && text.includes('WITH candidates')) return { rows: [{ id: 'b-1' }, { id: 'b-2' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });

  const count = await ds.markBlocksStaleForSymbolUids({ tenantId: 't-uuid', repoId: 'r-uuid', symbolUids: ['sym:1'] });
  assert.equal(count, 2);
});

test('PgDocStore.listBlocksBySymbolUid queries blocks via evidence join', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('FROM doc_blocks db') && text.includes('JOIN doc_evidence')) {
      return { rows: [{ id: 'b-1', doc_file: 'a.md', block_anchor: '## A' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });

  const blocks = await ds.listBlocksBySymbolUid({ tenantId: 't-uuid', repoId: 'r-uuid', symbolUid: 'sym:1', limit: 10 });
  assert.equal(blocks.length, 1);

  const q = client.calls.find((c) => c.text.includes('FROM doc_blocks db') && c.text.includes('JOIN doc_evidence'));
  assert.ok(q);
  assert.deepEqual(q.params, ['t-uuid', 'r-uuid', 'sym:1', 10]);
});

test('PgDocStore.updatePrRun updates allowed fields', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.startsWith('UPDATE pr_runs')) return { rows: [{ id: 'pr-1', status: 'success', docs_branch: 'b' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });

  const pr = await ds.updatePrRun({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    prRunId: 'pr-1',
    patch: { status: 'success', docsBranch: 'b' }
  });
  assert.equal(pr.id, 'pr-1');
  assert.equal(pr.status, 'success');
});

test('PgDocStore.listPrRuns and getPrRun query pr_runs', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.startsWith('SELECT * FROM pr_runs WHERE tenant_id')) {
      if (text.includes('AND id=$3')) return { rows: [{ id: 'pr-1', status: 'success' }] };
      return { rows: [{ id: 'pr-2', status: 'running' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });

  const list = await ds.listPrRuns({ tenantId: 't-uuid', repoId: 'r-uuid', limit: 5 });
  assert.equal(list.length, 1);
  const run = await ds.getPrRun({ tenantId: 't-uuid', repoId: 'r-uuid', prRunId: 'pr-1' });
  assert.equal(run.id, 'pr-1');
});

test('PgDocStore.listDocFilesByPrRunId queries doc_blocks by last_pr_id', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('SELECT DISTINCT doc_file') && text.includes('last_pr_id=$3')) {
      return { rows: [{ doc_file: 'flows/a.md' }, { doc_file: 'flows/b.md' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const ds = new PgDocStore({ client, repoFullName: 'org/repo' });
  const files = await ds.listDocFilesByPrRunId({ tenantId: 't-uuid', repoId: 'r-uuid', prRunId: 'pr-1' });
  assert.deepEqual(files, ['flows/a.md', 'flows/b.md']);
});
