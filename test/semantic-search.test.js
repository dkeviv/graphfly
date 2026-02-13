import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { embedText384 } from '../packages/cig/src/embedding.js';
import { semanticSearch } from '../packages/cig/src/search.js';

test('semanticSearch ranks nodes with embeddings', () => {
  const store = new InMemoryGraphStore();
  store.upsertNode({
    tenantId: 't-1',
    repoId: 'r-1',
    node: { symbol_uid: 'n1', qualified_name: 'auth.login', name: 'login', embedding: embedText384('user login') }
  });
  store.upsertNode({
    tenantId: 't-1',
    repoId: 'r-1',
    node: { symbol_uid: 'n2', qualified_name: 'billing.checkout', name: 'checkout', embedding: embedText384('stripe checkout') }
  });

  const results = semanticSearch({ store, tenantId: 't-1', repoId: 'r-1', query: 'checkout', limit: 2 });
  assert.equal(results.length, 2);
  assert.ok(results[0].score >= results[1].score);
});

