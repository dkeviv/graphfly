import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryOrgInviteStore } from '../packages/org-invites/src/store.js';

const TENANT = '00000000-0000-0000-0000-000000000001';

test('InMemoryOrgInviteStore create/list does not leak token hash', async () => {
  const store = new InMemoryOrgInviteStore();
  const { invite, token } = await store.createInvite({ tenantId: TENANT, email: 'User@Example.com', role: 'admin', ttlDays: 7 });
  assert.ok(invite.id);
  assert.ok(token);

  const list = await store.listInvites({ tenantId: TENANT });
  assert.equal(list.length, 1);
  assert.equal(list[0].email, 'user@example.com');
  assert.equal(list[0].role, 'admin');
  assert.equal(list[0].tokenHash, undefined);
});

test('InMemoryOrgInviteStore accept transitions invite and returns role', async () => {
  const store = new InMemoryOrgInviteStore();
  const { token } = await store.createInvite({ tenantId: TENANT, email: 'x@y.com', role: 'viewer', ttlDays: 7 });
  const out = await store.acceptInvite({ tenantId: TENANT, token, userId: 'gh:1' });
  assert.equal(out.ok, true);
  assert.equal(out.invite.role, 'viewer');
  assert.equal(out.invite.status, 'accepted');
});

