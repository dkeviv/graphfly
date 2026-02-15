import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAuthMiddleware } from '../apps/api/src/middleware/auth.js';
import { createJwtHs256 } from '../packages/auth/src/jwt.js';

test('jwt auth middleware rejects missing bearer', async () => {
  const mw = makeAuthMiddleware({ mode: 'jwt', jwtSecret: 's', orgMemberStore: { getMember: async () => ({ role: 'viewer' }) } });
  const out = await mw({ pathname: '/api/v1/repos', headers: {}, query: {}, body: {} });
  assert.deepEqual(out, { status: 401, body: { error: 'unauthorized', reason: 'missing_bearer' } });
});

test('jwt auth middleware loads role from membership store', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const token = createJwtHs256({ secret: 's', claims: { tenantId: 't-1', sub: 'gh:1', role: 'viewer' }, nowSec, ttlSec: 3600 });
  const mw = makeAuthMiddleware({
    mode: 'jwt',
    jwtSecret: 's',
    orgMemberStore: { getMember: async () => ({ role: 'owner' }) }
  });
  const ctx = { pathname: '/api/v1/repos', headers: { authorization: `Bearer ${token}` }, query: {}, body: {} };
  const out = await mw(ctx);
  assert.equal(out, null);
  assert.equal(ctx.auth.tenantId, 't-1');
  assert.equal(ctx.auth.userId, 'gh:1');
  assert.equal(ctx.auth.role, 'owner');
});

test('jwt auth middleware allows configured public path without bearer', async () => {
  const mw = makeAuthMiddleware({ mode: 'jwt', jwtSecret: 's', publicPaths: ['/api/v1/integrations/github/oauth/start'] });
  const ctx = { pathname: '/api/v1/integrations/github/oauth/start', headers: {}, query: {}, body: {} };
  const out = await mw(ctx);
  assert.equal(out, null);
  assert.equal(ctx.auth, null);
});
