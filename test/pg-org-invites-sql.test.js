import test from 'node:test';
import assert from 'node:assert/strict';
import { PgOrgInviteStore } from '../packages/org-invites-pg/src/pg-org-invite-store.js';

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

test('PgOrgInviteStore.createInvite inserts invite and returns token+invite', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('INSERT INTO org_invites')) {
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000009',
            tenant_id: '00000000-0000-0000-0000-000000000001',
            email: 'user@example.com',
            role: 'admin',
            status: 'pending',
            expires_at: '2026-02-20T00:00:00Z',
            created_at: '2026-02-16T00:00:00Z',
            accepted_at: null,
            accepted_by_user_id: null,
            revoked_at: null
          }
        ]
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgOrgInviteStore({ client });
  const out = await store.createInvite({ tenantId: '00000000-0000-0000-0000-000000000001', email: 'USER@EXAMPLE.COM', role: 'admin', ttlDays: 7 });
  assert.ok(out.token);
  assert.equal(out.invite.email, 'user@example.com');
  assert.equal(out.invite.role, 'admin');
});

test('PgOrgInviteStore.acceptInvite returns invalid when no rows updated', async () => {
  const client = makeFakeClient(async (text) => {
    if (text.startsWith('UPDATE org_invites')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  const store = new PgOrgInviteStore({ client });
  const out = await store.acceptInvite({ tenantId: '00000000-0000-0000-0000-000000000001', token: 't', userId: 'gh:1' });
  assert.equal(out.ok, false);
});

