import { mockIndexRepoToNdjson } from './mock-indexer.js';
import { ingestNdjson, ingestNdjsonReadable } from '../../../packages/ndjson/src/ingest.js';
import { materializeFlowGraph } from '../../../packages/cig/src/flow-graph.js';
import { computeImpact } from '../../../packages/cig/src/impact.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { cloneAtSha } from '../../../packages/git/src/clone.js';
import { runIndexerNdjson } from '../../../packages/indexer-cli/src/indexer-cli.js';

export function createIndexerWorker({ store, docQueue, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId, repoRoot, sha = 'mock', changedFiles = [], docsRepoFullName = null } = job.payload ?? {};
      const cloneSource = job.payload?.cloneSource ?? null;
      const cloneAuth = job.payload?.cloneAuth ?? null;
      const removedFiles = job.payload?.removedFiles ?? [];

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
        const mode = String(process.env.GRAPHFLY_INDEXER_MODE ?? 'auto').toLowerCase();
        const mustUseCli = mode === 'cli';
        const mustUseMock = mode === 'mock';
        const prod = String(process.env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod';

        if (mustUseMock) {
          const ndjsonText = mockIndexRepoToNdjson({ repoRoot: effectiveRepoRoot, language: 'js' });
          await ingestNdjson({ tenantId, repoId, ndjsonText, store });
        } else {
          try {
            const { stdout, waitForExitOk } = runIndexerNdjson({
              repoRoot: effectiveRepoRoot,
              sha,
              changedFiles,
              removedFiles
            });
            await ingestNdjsonReadable({ tenantId, repoId, readable: stdout, store });
            await waitForExitOk();
          } catch (e) {
            if (mustUseCli || prod) throw e;
            const ndjsonText = mockIndexRepoToNdjson({ repoRoot: effectiveRepoRoot, language: 'js' });
            await ingestNdjson({ tenantId, repoId, ndjsonText, store });
          }
        }
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
