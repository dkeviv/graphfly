import { mockIndexRepoToNdjson } from './mock-indexer.js';
import { ingestNdjson, ingestNdjsonReadable } from '../../../packages/ndjson/src/ingest.js';
import { materializeFlowGraph } from '../../../packages/cig/src/flow-graph.js';
import { computeImpact } from '../../../packages/cig/src/impact.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { cloneAtSha } from '../../../packages/git/src/clone.js';
import { runIndexerNdjson } from '../../../packages/indexer-cli/src/indexer-cli.js';
import { runBuiltinIndexerNdjson } from '../../../packages/indexer-engine/src/indexer.js';
import { recomputeDependencyMismatches } from '../../../packages/stores/src/graph-store.js';

export function createIndexerWorker({ store, docQueue, docStore, graphQueue = null, realtime = null }) {
  return {
    async handle(job) {
      const { tenantId, repoId, repoRoot, sha = 'mock', changedFiles = [], docsRepoFullName = null } = job.payload ?? {};
      const cloneSource = job.payload?.cloneSource ?? null;
      const cloneAuth = job.payload?.cloneAuth ?? null;
      const removedFiles = job.payload?.removedFiles ?? [];
      let reparsedFiles = Array.isArray(changedFiles) ? changedFiles : [];
      const modeLabel = Array.isArray(changedFiles) && changedFiles.length > 0 ? 'incremental' : 'full';

      realtime?.publish?.({ tenantId, repoId, type: 'index:start', payload: { sha, mode: modeLabel } });

      // Removed files must prune graph state (delete file-scoped nodes/edges/occurrences).
      if (Array.isArray(removedFiles) && removedFiles.length > 0 && typeof store.deleteGraphForFilePaths === 'function') {
        await Promise.resolve(store.deleteGraphForFilePaths({ tenantId, repoId, filePaths: removedFiles }));
      }

      // Incremental correctness diagnostics: compute re-parse scope from previous graph state.
      if (Array.isArray(changedFiles) && changedFiles.length > 0) {
        const impact = await computeImpact({ store, tenantId, repoId, changedFiles, removedFiles, depth: 2 });
        reparsedFiles = impact.reparsedFiles;
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
        const mustUseBuiltin = mode === 'builtin';
        const mustUseMock = mode === 'mock';
        const prod = String(process.env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod';

        let nodesCount = 0;
        let edgesCount = 0;
        let occCount = 0;
        let lastEmit = 0;
        let currentFile = null;
        let fileIndex = null;
        let fileTotal = null;

        const onRecord = (record) => {
          const t = record?.type;
          if (t === 'node') nodesCount++;
          if (t === 'edge') edgesCount++;
          if (t === 'edge_occurrence') occCount++;
          if (t === 'index_progress') {
            currentFile = record?.data?.file_path ?? currentFile;
            fileIndex = record?.data?.file_index ?? fileIndex;
            fileTotal = record?.data?.file_total ?? fileTotal;
          }
          const now = Date.now();
          if (now - lastEmit < 120) return;
          lastEmit = now;
          const pct = fileTotal && fileIndex ? Math.round((Number(fileIndex) / Number(fileTotal)) * 100) : null;
          realtime?.publish?.({
            tenantId,
            repoId,
            type: 'index:progress',
            payload: { sha, mode: modeLabel, pct, filePath: currentFile, fileIndex, fileTotal, nodes: nodesCount, edges: edgesCount, occurrences: occCount }
          });
        };

        if (mustUseMock) {
          const ndjsonText = mockIndexRepoToNdjson({ repoRoot: effectiveRepoRoot, language: 'js' });
          await ingestNdjson({ tenantId, repoId, ndjsonText, store, onRecord });
        } else if (mustUseBuiltin) {
          const { stdout, waitForExitOk } = runBuiltinIndexerNdjson({
            repoRoot: effectiveRepoRoot,
            sha,
            changedFiles: reparsedFiles,
            removedFiles
          });
          await ingestNdjsonReadable({ tenantId, repoId, readable: stdout, store, onRecord });
          await waitForExitOk();
        } else {
          try {
            const { stdout, waitForExitOk } = runIndexerNdjson({
              repoRoot: effectiveRepoRoot,
              sha,
              changedFiles: reparsedFiles,
              removedFiles
            });
            await ingestNdjsonReadable({ tenantId, repoId, readable: stdout, store, onRecord });
            await waitForExitOk();
          } catch (e) {
            if (mustUseCli) throw e;
            // In prod, fall back to builtin rather than a mock parser.
            if (prod) {
              const { stdout, waitForExitOk } = runBuiltinIndexerNdjson({
                repoRoot: effectiveRepoRoot,
                sha,
                changedFiles: reparsedFiles,
                removedFiles
              });
              await ingestNdjsonReadable({ tenantId, repoId, readable: stdout, store, onRecord });
              await waitForExitOk();
            } else {
              const { stdout, waitForExitOk } = runBuiltinIndexerNdjson({
                repoRoot: effectiveRepoRoot,
                sha,
                changedFiles: reparsedFiles,
                removedFiles
              });
              await ingestNdjsonReadable({ tenantId, repoId, readable: stdout, store, onRecord });
              await waitForExitOk();
            }
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

      // Dependency mismatches must be recomputed from the persisted declared/observed tables
      // to remain correct under incremental indexing (manifests/code can change independently).
      try {
        await recomputeDependencyMismatches({ store, tenantId, repoId, sha });
      } catch {
        // Best-effort; mismatch computation should not fail the index job.
      }

      // Materialize flow graphs (entrypoints + trace subgraphs) for fast UI rendering.
      for (const ep of await store.listFlowEntrypoints({ tenantId, repoId })) {
        const fg = await materializeFlowGraph({ store, tenantId, repoId, entrypoint: ep, sha, depth: 3 });
        await store.upsertFlowGraph({ tenantId, repoId, flowGraph: fg });
      }

      if (graphQueue?.add) {
        graphQueue.add('graph.enrich', { tenantId, repoId, sha, changedFiles });
      }
      docQueue.add('doc.generate', { tenantId, repoId, sha, changedFiles, docsRepoFullName });
      try {
        const nodes = await store.listNodes({ tenantId, repoId });
        const edges = await store.listEdges({ tenantId, repoId });
        realtime?.publish?.({ tenantId, repoId, type: 'index:complete', payload: { sha, mode: modeLabel, nodes: nodes.length, edges: edges.length } });
      } catch {
        realtime?.publish?.({ tenantId, repoId, type: 'index:complete', payload: { sha, mode: modeLabel } });
      }
      return { ok: true };
    }
  };
}
