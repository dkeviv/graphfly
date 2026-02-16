import { runDocPrWithOpenClaw } from './openclaw-doc-run.js';
import { limitsForPlan } from '../../../packages/entitlements/src/limits.js';
import { InMemoryEntitlementsStore } from '../../../packages/entitlements/src/store.js';
import { InMemoryUsageCounters } from '../../../packages/usage/src/in-memory.js';

export function createDocWorker({ store, docsWriter, docStore, entitlementsStore = null, usageCounters = null }) {
  const entitlements = entitlementsStore ?? new InMemoryEntitlementsStore();
  const usage = usageCounters ?? new InMemoryUsageCounters();

  return {
    async handle(job) {
      const { tenantId, repoId } = job.payload ?? {};
      const docsRepoFullName = job.payload?.docsRepoFullName;
      const triggerSha = job.payload?.sha ?? 'mock';
      if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) {
        throw new Error('docsRepoFullName is required');
      }
      const writer = typeof docsWriter === 'function' ? await docsWriter({ configuredDocsRepoFullName: docsRepoFullName, tenantId }) : docsWriter;
      const entrypoints = await store.listFlowEntrypoints({ tenantId, repoId });
      const docPathByEntrypointKey = new Map(
        entrypoints.map((ep) => [ep.entrypoint_key, `flows/${String(ep.entrypoint_key).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '')}.md`])
      );

      const prRun = docStore?.createPrRun?.({ tenantId, repoId, triggerSha, status: 'running' }) ?? null;

      try {
        // Surgical regeneration: if there are stale blocks, only regenerate those.
        let entrypointKeys = null; // null => all; [] => none
        let symbolUids = null; // null => all; [] => none
        if (docStore?.listBlocks && docStore?.getEvidence) {
          const stale = await docStore.listBlocks({ tenantId, repoId, status: 'stale' });
          if (Array.isArray(stale) && stale.length > 0) {
            const keySet = new Set();
            const symbolSet = new Set();
            const byDocFile = new Map(entrypoints.map((ep) => [docPathByEntrypointKey.get(ep.entrypoint_key), ep.entrypoint_key]));
            for (const b of stale) {
              const docFile = b.doc_file ?? b.docFile;
              const k = byDocFile.get(docFile);
              if (k) {
                keySet.add(k);
              } else if (docFile) {
                const ev = await docStore.getEvidence({ tenantId, repoId, blockId: b.id });
                const first = Array.isArray(ev) ? ev[0] : null;
                const uid = first?.symbol_uid ?? first?.symbolUid ?? null;
                if (typeof uid === 'string' && uid.length > 0) symbolSet.add(uid);
              }
            }
            entrypointKeys = Array.from(keySet);
            symbolUids = Array.from(symbolSet);
          }
        }

        const docTypes = new Set(['ApiEndpoint', 'Function', 'Class', 'Package', 'Module', 'File']);
        const publicNodesCount = (await store.listNodes({ tenantId, repoId })).filter(
          (n) => n?.visibility === 'public' && docTypes.has(String(n?.node_type ?? ''))
        ).length;

        const processedCount =
          entrypointKeys !== null || symbolUids !== null
            ? (entrypointKeys?.length ?? 0) + (symbolUids?.length ?? 0)
            : entrypoints.length + publicNodesCount;
        const plan = await Promise.resolve(entitlements.getPlan(tenantId));
        const limits = limitsForPlan(plan);
        const allow = await usage.consumeDocBlocksOrDeny({ tenantId, limitPerMonth: limits.docBlocksPerMonth, amount: processedCount });
        if (!allow.ok) {
          if (prRun && docStore?.updatePrRun) {
            await docStore.updatePrRun({
              tenantId,
              repoId,
              prRunId: prRun.id,
              patch: { status: 'skipped', errorMessage: 'doc_blocks_monthly_limit_exceeded', completedAt: new Date().toISOString() }
            });
          }
          return { ok: true, pr: { ok: true, empty: true, targetRepoFullName: docsRepoFullName, filesCount: 0 } };
        }

        const { pr } = await runDocPrWithOpenClaw({
          store,
          docStore,
          docsWriter: writer,
          tenantId,
          repoId,
          docsRepoFullName,
          triggerSha,
          prRunId: prRun?.id ?? null,
          entrypointKeys,
          symbolUids
        });

        // Drift/ops fence: if the docs writer is running in stub mode, we did not actually sync docs to GitHub.
        // In production we want this to be fail-fast; in dev we warn loudly.
        const requireCloudSync = process.env.GRAPHFLY_CLOUD_SYNC_REQUIRED === '1' || process.env.GRAPHFLY_MODE === 'prod';
        if (pr?.stub) {
          const msg =
            'docs_cloud_sync_disabled: docs PR was stubbed (no docs write credentials). Configure the Docs App installation/token or run in local mode intentionally.';
          if (requireCloudSync) throw new Error(msg);
          // eslint-disable-next-line no-console
          console.warn(`WARN: ${msg}`);
        }

        if (prRun && docStore?.updatePrRun) {
          await docStore.updatePrRun({
            tenantId,
            repoId,
            prRunId: prRun.id,
            patch: {
              status: pr?.empty ? 'skipped' : 'success',
              docsBranch: pr.branchName ?? null,
              blocksUpdated: processedCount,
              blocksCreated: processedCount,
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
