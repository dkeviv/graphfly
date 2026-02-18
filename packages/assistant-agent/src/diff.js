import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function safeLabel(label) {
  const s = String(label ?? '').replaceAll('\n', ' ').trim();
  if (!s) return 'file';
  return s.slice(0, 200);
}

function runGit(args, cwd) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: p.status, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
}

export function unifiedDiffText({ beforeText, afterText, fileLabel = 'file.md' } = {}) {
  const before = String(beforeText ?? '');
  const after = String(afterText ?? '');
  if (before === after) return '';

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-diff-'));
  try {
    const aPath = path.join(dir, 'a');
    const bPath = path.join(dir, 'b');
    fs.writeFileSync(aPath, before, 'utf8');
    fs.writeFileSync(bPath, after, 'utf8');

    const res = runGit(['diff', '--no-index', '--', 'a', 'b'], dir);
    // git diff returns:
    // - 0 when no diff
    // - 1 when diff exists
    // - 2+ on error
    if (res.status === 0) return '';
    if (res.status !== 1) return `diff_error: ${(res.stderr || res.stdout || '').trim()}`;

    const label = safeLabel(fileLabel);
    return res.stdout
      .replaceAll('diff --git a/a b/b', `diff --git a/${label} b/${label}`)
      .replaceAll('--- a/a', `--- a/${label}`)
      .replaceAll('+++ b/b', `+++ b/${label}`)
      .trimEnd();
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

