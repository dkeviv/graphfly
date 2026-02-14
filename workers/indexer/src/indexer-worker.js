import { mockIndexRepoToNdjson } from './mock-indexer.js';
import { ingestNdjson } from '../../../packages/ndjson/src/ingest.js';
import { materializeFlowGraph } from '../../../packages/cig/src/flow-graph.js';

export function createIndexerWorker({ store, docQueue, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId, repoRoot, sha = 'mock', changedFiles = [] } = job.payload ?? {};
      const ndjsonText = mockIndexRepoToNdjson({ repoRoot, language: 'js' });
      await ingestNdjson({ tenantId, repoId, ndjsonText, store });

      // Materialize flow graphs (entrypoints + trace subgraphs) for fast UI rendering.
      for (const ep of store.listFlowEntrypoints({ tenantId, repoId })) {
        const fg = materializeFlowGraph({ store, tenantId, repoId, entrypoint: ep, sha, depth: 3 });
        store.upsertFlowGraph({ tenantId, repoId, flowGraph: fg });
      }

      // Mark doc blocks stale based on changed files + impacted nodes (if a doc store exists).
      if (docStore?.markBlocksStaleForSymbolUids) {
        const changedSymbolUids = store
          .listNodes({ tenantId, repoId })
          .filter((n) => n.file_path && changedFiles.includes(n.file_path))
          .map((n) => n.symbol_uid);
        docStore.markBlocksStaleForSymbolUids({ tenantId, repoId, symbolUids: changedSymbolUids });
      }
      docQueue.add('doc.generate', { tenantId, repoId, sha, changedFiles });
      return { ok: true };
    }
  };
}
