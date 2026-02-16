import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestNdjson } from '../packages/ndjson/src/ingest.js';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';

test('ndjson ingest sanitizes code-like text fields (no code bodies persisted)', async () => {
  const store = new InMemoryGraphStore();
  const ndjsonText = [
    JSON.stringify({
      type: 'node',
      data: {
        symbol_uid: 'u1',
        node_type: 'Function',
        name: 'x',
        signature: 'function x()',
        docstring: '```js\nconsole.log(1)\n```',
        first_seen_sha: 's',
        last_seen_sha: 's'
      }
    }),
    JSON.stringify({
      type: 'node',
      data: {
        symbol_uid: 'u2',
        node_type: 'Function',
        name: 'y',
        signature: 'function y()',
        docstring: 'Line one\nLine two\nLine three',
        first_seen_sha: 's',
        last_seen_sha: 's'
      }
    }),
    JSON.stringify({
      type: 'node',
      data: {
        symbol_uid: 'u3',
        node_type: 'Function',
        name: 'z',
        signature: 'function z()',
        docstring:
          'export function doThing(x){ if(x){ return x+1; } else { return 0; } } // long single-line code-like payload',
        first_seen_sha: 's',
        last_seen_sha: 's'
      }
    })
  ].join('\n');

  await ingestNdjson({ tenantId: 't1', repoId: 'r1', ndjsonText, store });
  const n1 = store.getNodeBySymbolUid({ tenantId: 't1', repoId: 'r1', symbolUid: 'u1' });
  const n2 = store.getNodeBySymbolUid({ tenantId: 't1', repoId: 'r1', symbolUid: 'u2' });
  const n3 = store.getNodeBySymbolUid({ tenantId: 't1', repoId: 'r1', symbolUid: 'u3' });

  assert.equal(n1.docstring, '[REDACTED_CODE_LIKE]');
  assert.equal(n2.docstring, 'Line one');
  assert.equal(n3.docstring, '[REDACTED_CODE_LIKE]');
});
