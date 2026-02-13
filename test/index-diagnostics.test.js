import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { mockIndexRepoToNdjson } from '../workers/indexer/src/mock-indexer.js';

test('ingestNdjson persists index diagnostics records', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = mockIndexRepoToNdjson({ repoRoot: 'fixtures/sample-repo', language: 'js' });
  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  const diags = store.listIndexDiagnostics({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(diags.length >= 1);
  assert.equal(diags[0].mode, 'full');
  assert.ok(Array.isArray(diags[0].reparsed_files));
});

