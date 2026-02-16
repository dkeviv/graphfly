import { runGraphEnrichmentWithOpenClaw } from './openclaw-graph-run.js';

export function createGraphAgentWorker({ store }) {
  return {
    async handle(job) {
      const { tenantId, repoId, sha = 'mock' } = job.payload ?? {};
      if (!tenantId || !repoId) throw new Error('tenantId and repoId are required');
      await runGraphEnrichmentWithOpenClaw({ store, tenantId, repoId, triggerSha: sha });
      return { ok: true };
    }
  };
}

