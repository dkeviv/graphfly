import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { InMemoryGraphStore } from '../packages/cig/src/store.js';
import { ingestNdjsonReadable } from '../packages/ndjson/src/ingest.js';
import { runBuiltinIndexerNdjson } from '../packages/indexer-engine/src/indexer.js';

test('builtin indexer emits diagnostic and falls back when AST engine requested but unavailable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-ast-unavailable-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), "export function a() { return 1 }", 'utf8');

    const prev = process.env.GRAPHFLY_AST_ENGINE;
    try {
      process.env.GRAPHFLY_AST_ENGINE = 'tree-sitter';
      const { stdout, waitForExitOk } = runBuiltinIndexerNdjson({ repoRoot: tmp, sha: 's1' });
      const store = new InMemoryGraphStore();
      await ingestNdjsonReadable({ tenantId: 't-1', repoId: 'r-1', readable: stdout, store });
      await waitForExitOk();
      const diags = await store.listIndexDiagnostics({ tenantId: 't-1', repoId: 'r-1' });
      assert.ok(diags.some((d) => d.phase === 'ast_engine' && String(d.error).includes('ast_engine_unavailable')));
    } finally {
      if (prev === undefined) delete process.env.GRAPHFLY_AST_ENGINE;
      else process.env.GRAPHFLY_AST_ENGINE = prev;
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

