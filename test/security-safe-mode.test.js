import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNodeForMode } from '../packages/security/src/safe-mode.js';

test('sanitizeNodeForMode strips sensitive fields and shapes output', () => {
  const node = {
    symbol_uid: 's1',
    qualified_name: 'q',
    name: 'n',
    node_type: 'Function',
    language: 'ts',
    file_path: 'src/a.ts',
    line_start: 1,
    line_end: 2,
    signature: 'fn()',
    signature_hash: 'h',
    contract: { kind: 'function' },
    constraints: { a: { min: 1 } },
    allowable_values: { a: [1, 2] },
    docstring: "token='abcd1234efgh'"
  };

  const safe = sanitizeNodeForMode(node, 'support_safe');
  assert.equal(safe.symbolUid, 's1');
  assert.ok(!('docstring' in safe));
  assert.deepEqual(safe.location, { filePath: 'src/a.ts', lineStart: 1, lineEnd: 2 });
});

