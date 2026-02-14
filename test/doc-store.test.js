import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryDocStore } from '../packages/doc-store/src/in-memory.js';

test('InMemoryDocStore upserts blocks and marks stale via evidence', () => {
  const ds = new InMemoryDocStore();
  const b = ds.upsertBlock({
    tenantId: 't-1',
    repoId: 'r-1',
    docFile: 'flows/x.md',
    blockAnchor: '## X',
    blockType: 'flow',
    content: '## X\n\n- Evidence: `a.js:1`\n'
  });
  ds.setEvidence({ tenantId: 't-1', repoId: 'r-1', blockId: b.id, evidence: [{ symbolUid: 's1' }] });
  const changed = ds.markBlocksStaleForSymbolUids({ tenantId: 't-1', repoId: 'r-1', symbolUids: ['s1'] });
  assert.equal(changed, 1);
  assert.equal(ds.getBlock({ tenantId: 't-1', repoId: 'r-1', blockId: b.id }).status, 'stale');
});

test('InMemoryDocStore creates and lists PR runs', () => {
  const ds = new InMemoryDocStore();
  const pr1 = ds.createPrRun({ tenantId: 't-1', repoId: 'r-1', triggerSha: 's1', status: 'running' });
  ds.updatePrRun({ tenantId: 't-1', repoId: 'r-1', prRunId: pr1.id, patch: { status: 'success' } });
  const runs = ds.listPrRuns({ tenantId: 't-1', repoId: 'r-1' });
  assert.ok(Array.isArray(runs));
  assert.equal(runs.length, 1);
  assert.equal(ds.getPrRun({ tenantId: 't-1', repoId: 'r-1', prRunId: pr1.id }).status, 'success');
});
