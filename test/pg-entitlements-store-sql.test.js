import test from 'node:test';
import assert from 'node:assert/strict';
import { PgEntitlementsStore } from '../packages/entitlements-pg/src/pg-entitlements-store.js';
import { Plans } from '../packages/entitlements/src/limits.js';

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

test('PgEntitlementsStore.getPlan reads orgs.plan and defaults to FREE', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('SELECT plan FROM orgs')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgEntitlementsStore({ client });
  const plan = await store.getPlan('00000000-0000-0000-0000-000000000001');
  assert.equal(plan, Plans.FREE);
});

test('PgEntitlementsStore.setPlan upserts org row then updates plan', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO orgs')) return { rows: [] };
    if (text.startsWith('UPDATE orgs SET plan=')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgEntitlementsStore({ client });
  const res = await store.setPlan('00000000-0000-0000-0000-000000000001', 'pro');
  assert.equal(res.ok, true);
  assert.equal(res.plan, Plans.PRO);
});

