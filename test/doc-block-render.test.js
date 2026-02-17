import test from 'node:test';
import assert from 'node:assert/strict';
import { renderContractDocBlock } from '../workers/doc-agent/src/doc-block-render.js';
import { validateDocBlockMarkdown } from '../packages/doc-blocks/src/validate.js';

test('renderContractDocBlock is contract-first and does not emit code fences', () => {
  const md = renderContractDocBlock({
    symbolUid: 'js::pkg.mod.fn::abcd',
    qualifiedName: 'pkg.mod.fn',
    signature: 'fn(email: string) -> boolean',
    contract: { kind: 'function', params: [{ name: 'email', type: 'string' }] },
    constraints: { email: { format: 'email' } },
    allowableValues: { mode: ['fast', 'safe'] },
    location: { filePath: 'src/mod.js', lineStart: 12, lineEnd: 20 }
  });

  assert.ok(md.includes('## pkg.mod.fn'));
  assert.ok(md.includes('**Symbol UID:**'));
  assert.ok(md.includes('**Signature:**'));
  assert.ok(md.includes('Evidence: `src/mod.js:12-20`'));
  assert.equal(md.includes('```'), false);
  assert.deepEqual(validateDocBlockMarkdown(md), { ok: true });
});
