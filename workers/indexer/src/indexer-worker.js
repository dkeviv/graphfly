import { mockIndexRepoToNdjson } from './mock-indexer.js';
import { ingestNdjson } from '../../../packages/ndjson/src/ingest.js';

export function createIndexerWorker({ store, docQueue }) {
  return {
    async handle(job) {
      const { tenantId, repoId, repoRoot, sha = 'mock', changedFiles = [] } = job.payload ?? {};
      const ndjsonText = mockIndexRepoToNdjson({ repoRoot, language: 'js' });
      await ingestNdjson({ tenantId, repoId, ndjsonText, store });
      docQueue.add('doc.generate', { tenantId, repoId, sha, changedFiles });
      return { ok: true };
    }
  };
}

