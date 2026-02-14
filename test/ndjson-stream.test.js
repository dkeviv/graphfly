import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjsonReadable } from '../packages/ndjson/src/ingest.js';

test('ingestNdjsonReadable ingests NDJSON from a stream', async () => {
  const store = new InMemoryGraphStore();
  const lines = [
    JSON.stringify({ type: 'node', data: { symbol_uid: 'n1', node_type: 'File', file_path: 'a', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'node', data: { symbol_uid: 'n2', node_type: 'File', file_path: 'b', line_start: 1, line_end: 1 } }),
    JSON.stringify({ type: 'edge', data: { source_symbol_uid: 'n1', target_symbol_uid: 'n2', edge_type: 'Imports' } })
  ];
  const readable = Readable.from(lines.join('\n') + '\n');
  await ingestNdjsonReadable({ tenantId: 't-1', repoId: 'r-1', readable, store });
  assert.equal(store.listNodes({ tenantId: 't-1', repoId: 'r-1' }).length, 2);
  assert.equal(store.listEdges({ tenantId: 't-1', repoId: 'r-1' }).length, 1);
});

