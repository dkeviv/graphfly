import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { InMemoryQueue } from '../packages/queue/src/in-memory.js';
import { createIndexerWorker } from '../workers/indexer/src/indexer-worker.js';

test('indexer worker awaits async docStore.markBlocksStaleForSymbolUids', async () => {
  const store = new InMemoryGraphStore();
  const docQueue = new InMemoryQueue('doc');

  const tenantId = 't-1';
  const repoId = 'r-1';
  store.upsertNode({
    tenantId,
    repoId,
    node: { symbol_uid: 'N1', node_type: 'File', qualified_name: 'a', file_path: 'a.js', line_start: 1, line_end: 1 }
  });

  let finished = false;
  const docStore = {
    async markBlocksStaleForSymbolUids() {
      await Promise.resolve();
      finished = true;
      return 1;
    }
  };

  const worker = createIndexerWorker({ store, docQueue, docStore });
  await worker.handle({ payload: { tenantId, repoId, repoRoot: 'fixtures/sample-repo', sha: 's1', changedFiles: ['a.js'] } });
  assert.equal(finished, true);
});

