import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { mockIndexRepoToNdjson } from '../workers/indexer/src/mock-indexer.js';

test('mock indexer emits flow entrypoints, declared/observed deps, and mismatches', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = mockIndexRepoToNdjson({ repoRoot: 'fixtures/sample-repo', language: 'js' });
  await ingestNdjson({ tenantId: 't-1', repoId: 'r-1', ndjsonText, store });

  const entrypoints = store.listFlowEntrypoints({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(entrypoints.some((e) => e.entrypoint_type === 'http_route' && e.path === '/health'));

  const manifests = store.listDependencyManifests({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(manifests.some((m) => m.manifest_type === 'package.json'));

  const declared = store.listDeclaredDependencies({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(declared.some((d) => d.package_key === 'npm:express'));

  const observed = store.listObservedDependencies({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(observed.some((o) => o.package_key === 'npm:express'));

  const mismatches = store.listDependencyMismatches({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(mismatches.some((m) => m.package_key === 'npm:vitest' && m.mismatch_type === 'declared_not_observed'));
  assert.ok(mismatches.some((m) => m.package_key === 'npm:express' && m.mismatch_type === 'version_conflict'));
});
