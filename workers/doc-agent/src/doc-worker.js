import { runDocPrWithOpenClaw } from './openclaw-doc-run.js';

export function createDocWorker({ store, docsWriter, docStore }) {
  return {
    async handle(job) {
      const { tenantId, repoId } = job.payload ?? {};
      const docsRepoFullName = job.payload?.docsRepoFullName;
      const triggerSha = job.payload?.sha ?? 'mock';
      if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) {
        throw new Error('docsRepoFullName is required');
      }
      const entrypoints = await store.listFlowEntrypoints({ tenantId, repoId });

      const prRun = docStore?.createPrRun?.({ tenantId, repoId, triggerSha, status: 'running' }) ?? null;

      try {
        const { pr } = await runDocPrWithOpenClaw({
          store,
          docStore,
          docsWriter,
          tenantId,
          repoId,
          docsRepoFullName,
          triggerSha,
          prRunId: prRun?.id ?? null
        });

        if (prRun && docStore?.updatePrRun) {
          await docStore.updatePrRun({
            tenantId,
            repoId,
            prRunId: prRun.id,
            patch: {
              status: pr?.empty ? 'skipped' : 'success',
              docsBranch: pr.branchName ?? null,
              blocksUpdated: entrypoints.length,
              blocksCreated: entrypoints.length,
              blocksUnchanged: 0,
              completedAt: new Date().toISOString()
            }
          });
        }
        return { ok: true, pr };
      } catch (err) {
        if (prRun && docStore?.updatePrRun) {
          await docStore.updatePrRun({
            tenantId,
            repoId,
            prRunId: prRun.id,
            patch: {
              status: 'failure',
              errorMessage: String(err?.message ?? err),
              completedAt: new Date().toISOString()
            }
          });
        }
        throw err;
      }
    }
  };
}
