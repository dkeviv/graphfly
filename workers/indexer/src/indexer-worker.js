import { mockIndexRepoToNdjson } from './mock-indexer.js';
import { ingestNdjson } from '../../../packages/ndjson/src/ingest.js';
import { materializeFlowGraph } from '../../../packages/cig/src/flow-graph.js';
import { computeImpact } from '../../../packages/cig/src/impact.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { cloneAtSha } from '../../../packages/git/src/clone.js';

export function createIndexerWorker({ store, docQueue, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId, repoRoot, sha = 'mock', changedFiles = [], docsRepoFullName = null } = job.payload ?? {};
      const cloneSource = job.payload?.cloneSource ?? null;
      const cloneAuth = job.payload?.cloneAuth ?? null;

      // Incremental correctness diagnostics: compute re-parse scope from previous graph state.
      if (Array.isArray(changedFiles) && changedFiles.length > 0) {
        const impact = await computeImpact({ store, tenantId, repoId, changedFiles, depth: 2 });
        await store.addIndexDiagnostic({
          tenantId,
          repoId,
          diagnostic: {
            sha,
            mode: 'incremental',
            changed_files: impact.changedFiles,
            impacted_files: impact.impactedFiles,
            reparsed_files: impact.reparsedFiles,
            impacted_symbol_uids: impact.impactedSymbolUids
          }
        });

        if (docStore?.markBlocksStaleForSymbolUids) {
          await Promise.resolve(docStore.markBlocksStaleForSymbolUids({ tenantId, repoId, symbolUids: impact.impactedSymbolUids }));
        }
      }

      let effectiveRepoRoot = repoRoot;
      let clonedDir = null;
      if (typeof cloneSource === 'string' && cloneSource.length > 0) {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphfly-clone-'));
        clonedDir = path.join(base, 'repo');
        fs.mkdirSync(clonedDir, { recursive: true });
        fs.rmSync(clonedDir, { recursive: true, force: true });
        fs.mkdirSync(clonedDir, { recursive: true });
        cloneAtSha({ source: cloneSource, sha, destDir: clonedDir, auth: cloneAuth });
        effectiveRepoRoot = clonedDir;
      }

      try {
        const ndjsonText = mockIndexRepoToNdjson({ repoRoot: effectiveRepoRoot, language: 'js' });
        await ingestNdjson({ tenantId, repoId, ndjsonText, store });
      } finally {
        if (clonedDir) {
          try {
            fs.rmSync(path.dirname(clonedDir), { recursive: true, force: true });
          } catch {
            // best-effort
          }
        }
      }

      // Materialize flow graphs (entrypoints + trace subgraphs) for fast UI rendering.
      for (const ep of await store.listFlowEntrypoints({ tenantId, repoId })) {
        const fg = await materializeFlowGraph({ store, tenantId, repoId, entrypoint: ep, sha, depth: 3 });
        await store.upsertFlowGraph({ tenantId, repoId, flowGraph: fg });
      }

      docQueue.add('doc.generate', { tenantId, repoId, sha, changedFiles, docsRepoFullName });
      return { ok: true };
    }
  };
}
