import test from 'node:test';
import assert from 'node:assert/strict';
import { PgSecretsStore } from '../packages/secrets-pg/src/pg-secrets-store.js';

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

test('PgSecretsStore.setSecret upserts by org_id+key', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('INSERT INTO org_secrets') && text.includes('ON CONFLICT')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgSecretsStore({ client });
  const out = await store.setSecret({ tenantId: '00000000-0000-0000-0000-000000000001', key: 'github.token', ciphertext: 'v1.x' });
  assert.deepEqual(out, { ok: true });
});

test('PgSecretsStore.getSecret reads ciphertext', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.includes('SELECT ciphertext') && text.includes('FROM org_secrets')) return { rows: [{ ciphertext: 'v1.ct' }] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgSecretsStore({ client });
  const ct = await store.getSecret({ tenantId: '00000000-0000-0000-0000-000000000001', key: 'k' });
  assert.equal(ct, 'v1.ct');
});

