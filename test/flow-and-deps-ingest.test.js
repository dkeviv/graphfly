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
  const root = manifests.find((m) => m.file_path === 'package.json') ?? manifests[0];
  assert.ok(root?.parsed?.dependencies?.express, 'expected parsed manifest summary to include dependencies');

  const declared = store.listDeclaredDependencies({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(declared.some((d) => d.package_key === 'npm:express'));

  const observed = store.listObservedDependencies({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(observed.some((o) => o.package_key === 'npm:express'));

  const mismatches = store.listDependencyMismatches({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(mismatches.some((m) => m.package_key === 'npm:vitest' && m.mismatch_type === 'declared_not_observed'));
  assert.ok(mismatches.some((m) => m.package_key === 'npm:express' && m.mismatch_type === 'version_conflict'));

  const nodes = store.listNodes({ tenantId: 't-1', repoId: 'r-1' });
  const greet = nodes.find((n) => n.node_type === 'Function' && n.name === 'greet');
  assert.ok(greet, 'expected exported function greet to be indexed');
  assert.equal(greet.visibility, 'public');
  assert.equal(greet.contract?.kind, 'function');
  assert.ok(Array.isArray(greet.allowable_values?.tone), 'expected allowable_values.tone to be extracted');
  assert.ok(greet.allowable_values.tone.includes('formal'));
  assert.equal(greet.constraints?.retries?.min, 0);
  assert.equal(greet.constraints?.retries?.max, 5);
});
