import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalDocsReader } from '../packages/github-service/src/local-docs-reader.js';

test('LocalDocsReader returns ok:false for missing file/dir (no throw)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-local-docs-reader-'));
  fs.mkdirSync(path.join(tmp, 'guides'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'guides', 'intro.md'), '# Intro\n', 'utf8');

  const r = new LocalDocsReader({ configuredDocsRepoFullName: 'org/docs', docsRepoPath: tmp });

  const listOk = await r.listDir({ targetRepoFullName: 'org/docs', dirPath: 'guides' });
  assert.equal(listOk.ok, true);
  assert.ok(Array.isArray(listOk.entries));
  assert.ok(listOk.entries.some((e) => e.path === 'guides/intro.md'));

  const readOk = await r.readFile({ targetRepoFullName: 'org/docs', filePath: 'guides/intro.md' });
  assert.equal(readOk.ok, true);
  assert.equal(readOk.content, '# Intro\n');

  const missingFile = await r.readFile({ targetRepoFullName: 'org/docs', filePath: 'guides/missing.md' });
  assert.equal(missingFile.ok, false);
  assert.equal(missingFile.error, 'not_found');

  const missingDir = await r.listDir({ targetRepoFullName: 'org/docs', dirPath: 'nope' });
  assert.equal(missingDir.ok, false);
  assert.equal(missingDir.error, 'not_found');

  const invalidPath = await r.readFile({ targetRepoFullName: 'org/docs', filePath: '../secrets.md' });
  assert.equal(invalidPath.ok, false);
  assert.equal(invalidPath.error, 'invalid_path');
});

