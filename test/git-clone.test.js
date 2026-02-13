import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloneAtSha } from '../packages/git/src/clone.js';

function git(cwd, args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(p.stderr || p.stdout);
  return p.stdout.trim();
}

test('cloneAtSha clones a repo at a specific sha (local)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-git-'));
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src);

  git(src, ['init']);
  fs.writeFileSync(path.join(src, 'a.txt'), 'one\n');
  git(src, ['add', '.']);
  git(src, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c1']);
  const sha1 = git(src, ['rev-parse', 'HEAD']);

  fs.writeFileSync(path.join(src, 'a.txt'), 'two\n');
  git(src, ['add', '.']);
  git(src, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'c2']);

  fs.mkdirSync(dst);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst);

  cloneAtSha({ source: src, sha: sha1, destDir: dst });
  const txt = fs.readFileSync(path.join(dst, 'a.txt'), 'utf8');
  assert.equal(txt, 'one\n');
});

