import test from 'node:test';
import assert from 'node:assert/strict';
import { PgRepoStore } from '../packages/repos-pg/src/pg-repo-store.js';

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

test('PgRepoStore.createRepo upserts and then reads repo row', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO repos')) return { rows: [{ id: '00000000-0000-0000-0000-000000000002' }] };
    if (text.includes('FROM repos') && text.includes('WHERE tenant_id=$1 AND id=$2')) {
      return { rows: [{ id: '00000000-0000-0000-0000-000000000002', tenant_id: '00000000-0000-0000-0000-000000000001', full_name: 'acme/source', default_branch: 'main', github_repo_id: 123 }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgRepoStore({ client });
  const repo = await store.createRepo({
    tenantId: '00000000-0000-0000-0000-000000000001',
    fullName: 'acme/source',
    defaultBranch: 'main',
    githubRepoId: 123
  });
  assert.equal(repo.fullName, 'acme/source');
  assert.equal(repo.githubRepoId, 123);
});

test('PgRepoStore.findRepoByFullName throws when ambiguous', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('FROM repos') && text.includes('WHERE full_name=$1')) {
      return { rows: [{ id: '1', tenant_id: 't1', full_name: 'acme/source', default_branch: 'main', github_repo_id: null }, { id: '2', tenant_id: 't2', full_name: 'acme/source', default_branch: 'main', github_repo_id: null }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const store = new PgRepoStore({ client });
  await assert.rejects(() => store.findRepoByFullName({ fullName: 'acme/source' }), /ambiguous_repo_full_name/);
});

