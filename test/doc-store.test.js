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

test('InMemoryDocStore can list doc files for a PR run via lastPrId', () => {
  const ds = new InMemoryDocStore();
  const pr = ds.createPrRun({ tenantId: 't-1', repoId: 'r-1', triggerSha: 's1', status: 'running' });

  ds.upsertBlock({
    tenantId: 't-1',
    repoId: 'r-1',
    docFile: 'flows/a.md',
    blockAnchor: '## A',
    blockType: 'flow',
    content: '## A\n\n- x\n',
    lastPrId: pr.id
  });
  ds.upsertBlock({
    tenantId: 't-1',
    repoId: 'r-1',
    docFile: 'flows/b.md',
    blockAnchor: '## B',
    blockType: 'flow',
    content: '## B\n\n- y\n',
    lastPrId: pr.id
  });
  // Different run, should be excluded.
  ds.upsertBlock({
    tenantId: 't-1',
    repoId: 'r-1',
    docFile: 'flows/c.md',
    blockAnchor: '## C',
    blockType: 'flow',
    content: '## C\n\n- z\n',
    lastPrId: 'other'
  });

  assert.deepEqual(ds.listDocFilesByPrRunId({ tenantId: 't-1', repoId: 'r-1', prRunId: pr.id }), ['flows/a.md', 'flows/b.md']);
});

test('InMemoryDocStore can list blocks by evidence symbolUid', () => {
  const ds = new InMemoryDocStore();
  const b1 = ds.upsertBlock({ tenantId: 't-1', repoId: 'r-1', docFile: 'a.md', blockAnchor: '## A', blockType: 'flow', content: '## A\n' });
  const b2 = ds.upsertBlock({ tenantId: 't-1', repoId: 'r-1', docFile: 'b.md', blockAnchor: '## B', blockType: 'flow', content: '## B\n' });
  const b3 = ds.upsertBlock({ tenantId: 't-1', repoId: 'r-1', docFile: 'b.md', blockAnchor: '## C', blockType: 'flow', content: '## C\n' });

  ds.setEvidence({ tenantId: 't-1', repoId: 'r-1', blockId: b1.id, evidence: [{ symbolUid: 's1' }] });
  ds.setEvidence({ tenantId: 't-1', repoId: 'r-1', blockId: b2.id, evidence: [{ symbolUid: 's2' }] });
  ds.setEvidence({ tenantId: 't-1', repoId: 'r-1', blockId: b3.id, evidence: [{ symbolUid: 's1' }, { symbolUid: 's2' }] });

  const blocks = ds.listBlocksBySymbolUid({ tenantId: 't-1', repoId: 'r-1', symbolUid: 's1' });
  assert.equal(blocks.length, 2);
  assert.deepEqual(
    blocks.map((b) => `${b.docFile}:${b.blockAnchor}`),
    ['a.md:## A', 'b.md:## C']
  );
});
