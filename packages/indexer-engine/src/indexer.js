import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { indexRepoRecords } from './pipeline/index-repo.js';

function toPosix(p) {
  return String(p ?? '').replaceAll(path.sep, '/');
}

function normalizeFileList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    const s = String(x ?? '').trim();
    if (!s) continue;
    out.push(toPosix(s));
  }
  return out;
}

export function runBuiltinIndexerNdjson({ repoRoot, sha = 'mock', changedFiles = [], removedFiles = [], languageHint = null } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const absRoot = path.resolve(String(repoRoot));
  if (!fs.existsSync(absRoot)) throw new Error('repoRoot not found');

  const changed = normalizeFileList(changedFiles) ?? [];
  const removed = normalizeFileList(removedFiles) ?? [];

  async function* gen() {
    for await (const record of indexRepoRecords({
      repoRoot: absRoot,
      sha,
      changedFiles: changed,
      removedFiles: removed,
      languageHint
    })) {
      yield `${JSON.stringify(record)}\n`;
    }
  }

  const readable = Readable.from(gen());
  const waitForExitOk = async () => ({ ok: true });
  return { stdout: readable, waitForExitOk };
}

