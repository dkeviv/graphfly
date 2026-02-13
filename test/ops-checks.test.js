import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOperationsDoc } from '../packages/ops-checks/src/runbook.js';

test('operations doc contains required sections', () => {
  const res = checkOperationsDoc({ filePath: 'docs/06_OPERATIONS.md' });
  assert.equal(res.ok, true, `missing: ${res.missing.join(', ')}`);
});

