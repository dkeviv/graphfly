import test from 'node:test';
import assert from 'node:assert/strict';
import { createJsonRouter } from '../apps/api/src/tiny-router.js';

test('tiny-router matches :params and exposes ctx.params', async () => {
  const router = createJsonRouter();
  router.get('/api/v1/repos/:repoId', async (ctx) => {
    return { status: 200, body: { repoId: ctx.params.repoId } };
  });

  const req = { method: 'GET', url: 'http://localhost/api/v1/repos/abc123', headers: {} };
  const res = await router.handle(req);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { repoId: 'abc123' });
});

