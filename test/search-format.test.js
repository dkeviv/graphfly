import test from 'node:test';
import assert from 'node:assert/strict';
import { formatGraphSearchResponse } from '../apps/api/src/search-format.js';

test('formatGraphSearchResponse strips docstring in support_safe viewMode', () => {
  const node = {
    symbol_uid: 's1',
    qualified_name: 'q',
    name: 'n',
    node_type: 'Function',
    file_path: 'src/a.ts',
    line_start: 1,
    line_end: 2,
    docstring: "token='abcd1234efgh'"
  };

  const safe = formatGraphSearchResponse({ mode: 'text', query: 'n', results: [{ score: 1, node }], viewMode: 'support_safe' });
  assert.equal(safe.results.length, 1);
  assert.ok(!('docstring' in safe.results[0].node));

  const def = formatGraphSearchResponse({ mode: 'text', query: 'n', results: [{ score: 1, node }], viewMode: 'default' });
  assert.equal(def.results.length, 1);
  assert.equal(typeof def.results[0].node.docstring, 'string');
});

