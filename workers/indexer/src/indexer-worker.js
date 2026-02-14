import { mockIndexRepoToNdjson } from './mock-indexer.js';
import { ingestNdjson } from '../../../packages/ndjson/src/ingest.js';
import { materializeFlowGraph } from '../../../packages/cig/src/flow-graph.js';
import { computeImpact } from '../../../packages/cig/src/impact.js';

export function createIndexerWorker({ store, docQueue, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId, repoRoot, sha = 'mock', changedFiles = [], docsRepoFullName = null } = job.payload ?? {};

      // Incremental correctness diagnostics: compute re-parse scope from previous graph state.
      if (Array.isArray(changedFiles) && changedFiles.length > 0) {
        const impact = await computeImpact({ store, tenantId, repoId, changedFiles, depth: 2 });
        store.addIndexDiagnostic({
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

        docStore?.markBlocksStaleForSymbolUids?.({ tenantId, repoId, symbolUids: impact.impactedSymbolUids });
      }

      const ndjsonText = mockIndexRepoToNdjson({ repoRoot, language: 'js' });
      await ingestNdjson({ tenantId, repoId, ndjsonText, store });

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
