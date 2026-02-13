import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('web app uses CSS and avoids inline styling', () => {
  const html = fs.readFileSync('apps/web/index.html', 'utf8');
  assert.ok(html.includes('rel="stylesheet"'));
  assert.equal(/\sstyle=/.test(html), false);
});

