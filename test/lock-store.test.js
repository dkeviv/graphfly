import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLockStore } from '../packages/lock-store/src/in-memory.js';

test('InMemoryLockStore enforces single holder until expiry', async () => {
  const ls = new InMemoryLockStore();
  const a = await ls.tryAcquire({ tenantId: 't', repoId: 'r', lockName: 'x', ttlMs: 50 });
  assert.equal(a.acquired, true);
  const b = await ls.tryAcquire({ tenantId: 't', repoId: 'r', lockName: 'x', ttlMs: 50 });
  assert.equal(b.acquired, false);
  await new Promise((r) => setTimeout(r, 60));
  const c = await ls.tryAcquire({ tenantId: 't', repoId: 'r', lockName: 'x', ttlMs: 50 });
  assert.equal(c.acquired, true);
});

