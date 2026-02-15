import test from 'node:test';
import assert from 'node:assert/strict';
import { createJwtHs256, verifyJwtHs256 } from '../packages/auth/src/jwt.js';

test('JWT HS256 roundtrip verifies and returns claims', () => {
  const token = createJwtHs256({ secret: 's', claims: { tenantId: 't-1', role: 'admin' }, nowSec: 1000, ttlSec: 3600 });
  const out = verifyJwtHs256({ secret: 's', token, nowSec: 1001 });
  assert.equal(out.ok, true);
  assert.equal(out.claims.tenantId, 't-1');
  assert.equal(out.claims.role, 'admin');
});

test('JWT HS256 rejects bad signature', () => {
  const token = createJwtHs256({ secret: 's', claims: { tenantId: 't-1' }, nowSec: 1000, ttlSec: 3600 });
  const out = verifyJwtHs256({ secret: 'x', token, nowSec: 1001 });
  assert.deepEqual(out, { ok: false, reason: 'bad_signature' });
});

