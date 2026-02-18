import fs from 'node:fs';
import path from 'node:path';
import { assertDocsRepoOnlyWrite } from './docs-repo-guard.js';

function safeJoin(root, rel) {
  const abs = path.resolve(root, String(rel ?? '').replaceAll('\\', '/'));
  const rr = path.resolve(root);
  if (abs === rr || abs.startsWith(rr + path.sep)) return abs;
  throw new Error('invalid_path');
}

export class LocalDocsReader {
  constructor({ configuredDocsRepoFullName, docsRepoPath }) {
    if (!configuredDocsRepoFullName) throw new Error('configuredDocsRepoFullName required');
    if (!docsRepoPath) throw new Error('docsRepoPath required');
    this._docsRepo = configuredDocsRepoFullName;
    this._path = docsRepoPath;
  }

  async getDefaultBranch({ targetRepoFullName }) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    return 'main';
  }

  async listDir({ targetRepoFullName, dirPath = '', maxEntries = 200 } = {}) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    let abs = null;
    try {
      abs = safeJoin(this._path, dirPath || '.');
    } catch {
      return { ok: false, error: 'invalid_path', entries: [] };
    }

    let dirents = null;
    try {
      dirents = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      if (e?.code === 'ENOENT') return { ok: false, error: 'not_found', entries: [] };
      if (e?.code === 'ENOTDIR') return { ok: false, error: 'not_a_directory', entries: [] };
      return { ok: false, error: 'io_error', entries: [] };
    }

    const entries = [];
    for (const d of dirents.slice(0, maxEntries)) {
      const rel = path.relative(this._path, path.join(abs, d.name)).split(path.sep).join('/');
      let size = null;
      if (d.isFile()) {
        try {
          size = fs.statSync(path.join(abs, d.name)).size;
        } catch {
          size = null;
        }
      }
      entries.push({
        path: rel,
        name: d.name,
        type: d.isDirectory() ? 'dir' : 'file',
        size,
        sha: null
      });
    }
    return { ok: true, entries };
  }

  async readFile({ targetRepoFullName, filePath, maxBytes = 250_000 } = {}) {
    assertDocsRepoOnlyWrite({ configuredDocsRepoFullName: this._docsRepo, targetRepoFullName });
    if (!filePath) return { ok: false, error: 'path_required', content: null, sha: null };
    let abs = null;
    try {
      abs = safeJoin(this._path, filePath);
    } catch {
      return { ok: false, error: 'invalid_path', content: null, sha: null };
    }

    let st = null;
    try {
      st = fs.statSync(abs);
    } catch (e) {
      if (e?.code === 'ENOENT') return { ok: false, error: 'not_found', content: null, sha: null };
      return { ok: false, error: 'io_error', content: null, sha: null };
    }

    if (!st.isFile()) return { ok: false, error: 'not_a_file', content: null, sha: null };
    if (st.size > maxBytes) return { ok: false, error: 'file_too_large', content: null, sha: null };

    try {
      const content = fs.readFileSync(abs, 'utf8');
      return { ok: true, content, sha: null, path: String(filePath).replaceAll('\\', '/') };
    } catch {
      return { ok: false, error: 'io_error', content: null, sha: null };
    }
  }
}
