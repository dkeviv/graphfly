import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocBlockMarkdown } from '../packages/doc-blocks/src/validate.js';

test('validateDocBlockMarkdown rejects code fences', () => {
  const res = validateDocBlockMarkdown('## Title\n\n```js\nconsole.log(1)\n```');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'code_fence_not_allowed');
});

