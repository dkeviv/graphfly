import test from 'node:test';
import assert from 'node:assert/strict';
import { PgOrgStore } from '../packages/orgs-pg/src/pg-org-store.js';

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

test('PgOrgStore.ensureOrg inserts then reads org row', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.includes('SELECT id, name') && text.includes('FROM orgs')) {
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Acme',
            slug: 'acme',
            display_name: 'Acme Inc',
            plan: 'pro',
            github_reader_install_id: 1,
            github_docs_install_id: 2,
            docs_repo_full_name: 'acme/docs',
            stripe_customer_id: 'cus_1'
          }
        ]
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgOrgStore({ client });
  const org = await store.ensureOrg({ tenantId: '00000000-0000-0000-0000-000000000001', name: 'Acme' });
  assert.equal(org.plan, 'pro');
  assert.equal(org.docsRepoFullName, 'acme/docs');
});

test('PgOrgStore.upsertOrg updates fields and returns normalized plan', async () => {
  let phase = 0;
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.startsWith('UPDATE orgs')) return { rows: [] };
    if (text.includes('SELECT id, name') && text.includes('FROM orgs')) {
      phase++;
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Acme',
            slug: null,
            display_name: 'Acme',
            plan: phase >= 2 ? 'enterprise' : 'free',
            github_reader_install_id: null,
            github_docs_install_id: null,
            docs_repo_full_name: 'acme/docs',
            stripe_customer_id: null
          }
        ]
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgOrgStore({ client });
  const org = await store.upsertOrg({
    tenantId: '00000000-0000-0000-0000-000000000001',
    patch: { displayName: 'Acme', docsRepoFullName: 'acme/docs', plan: 'enterprise' }
  });
  assert.equal(org.plan, 'enterprise');
  assert.equal(org.displayName, 'Acme');
});

