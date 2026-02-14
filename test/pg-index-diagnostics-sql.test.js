import test from 'node:test';
import assert from 'node:assert/strict';
import { PgGraphStore } from '../packages/cig-pg/src/pg-store.js';

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

test('PgGraphStore.addIndexDiagnostic upserts into index_diagnostics and listIndexDiagnostics reads back', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('INSERT INTO repos')) return { rows: [] };
    if (text.includes('INSERT INTO index_diagnostics')) return { rows: [] };
    if (text.includes('SELECT diagnostic') && text.includes('FROM index_diagnostics')) {
      return { rows: [{ diagnostic: { sha: 's1', mode: 'incremental', changed_files: ['a.js'] } }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgGraphStore({ client });

  await store.addIndexDiagnostic({
    tenantId: 't-uuid',
    repoId: 'r-uuid',
    diagnostic: { sha: 's1', mode: 'incremental', changed_files: ['a.js'] }
  });

  const diags = await store.listIndexDiagnostics({ tenantId: 't-uuid', repoId: 'r-uuid', limit: 10 });
  assert.equal(diags.length, 1);
  assert.equal(diags[0].sha, 's1');
});

