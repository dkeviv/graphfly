import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDocBlockMarkdown } from '../packages/doc-blocks/src/validate.js';

test('validateDocBlockMarkdown rejects code fences', () => {
  const res = validateDocBlockMarkdown('## Title\n\n```js\nconsole.log(1)\n```');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'code_fence_not_allowed');
});

test('validateDocBlockMarkdown rejects ~~~ fences', () => {
  const res = validateDocBlockMarkdown('## Title\n\n~~~\nconsole.log(1)\n~~~');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'code_fence_not_allowed');
});

test('validateDocBlockMarkdown rejects indented code blocks', () => {
  const res = validateDocBlockMarkdown('## Title\n\n    const x = 1;\n    return x;\n');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'indented_code_block_not_allowed');
});

test('validateDocBlockMarkdown rejects code-like multi-line content', () => {
  const res = validateDocBlockMarkdown('## Title\n\nconst x = 1;\nreturn x;\nconst y = 2;\n');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'code_like_content_not_allowed');
});
