import { runDocPrWithOpenClaw } from './openclaw-doc-run.js';
import { limitsForPlan } from '../../../packages/entitlements/src/limits.js';
import { InMemoryEntitlementsStore } from '../../../packages/entitlements/src/store.js';
import { InMemoryUsageCounters } from '../../../packages/usage/src/in-memory.js';

export function createDocWorker({ store, docsWriter, docStore, entitlementsStore = null, usageCounters = null, realtime = null, lockStore = null }) {
  const entitlements = entitlementsStore ?? new InMemoryEntitlementsStore();
  const usage = usageCounters ?? new InMemoryUsageCounters();

  return {
    async handle(job) {
      const { tenantId, repoId } = job.payload ?? {};
      const docsRepoFullName = job.payload?.docsRepoFullName;
      const triggerSha = job.payload?.sha ?? 'mock';
      const requestedEntrypointKeys = Array.isArray(job.payload?.entrypointKeys) ? job.payload.entrypointKeys : null;
      const requestedSymbolUids = Array.isArray(job.payload?.symbolUids) ? job.payload.symbolUids : null;
      if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) {
        throw new Error('docsRepoFullName is required');
      }
      const lockName = 'docs_generate';
      const ttlMs = Number(process.env.GRAPHFLY_DOC_AGENT_LOCK_TTL_MS ?? 30 * 60 * 1000);
      let lockToken = null;
      if (lockStore?.tryAcquire) {
        const lease = await lockStore.tryAcquire({
          tenantId,
          repoId,
          lockName,
          ttlMs: Number.isFinite(ttlMs) ? Math.trunc(ttlMs) : 30 * 60 * 1000
        });
        if (!lease.acquired) throw new Error('doc_agent_lock_busy');
        lockToken = lease.token;
      }

      let prRun = null;
      try {
        const writer = typeof docsWriter === 'function' ? await docsWriter({ configuredDocsRepoFullName: docsRepoFullName, tenantId }) : docsWriter;
        const entrypoints = await store.listFlowEntrypoints({ tenantId, repoId });
        const docPathByEntrypointKey = new Map(
          entrypoints.map((ep) => [ep.entrypoint_key, `flows/${String(ep.entrypoint_key).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '')}.md`])
        );

        prRun = docStore?.createPrRun?.({ tenantId, repoId, triggerSha, status: 'running' }) ?? null;

        realtime?.publish?.({ tenantId, repoId, type: 'agent:start', payload: { agent: 'doc', sha: triggerSha, prRunId: prRun?.id ?? null } });
        // Explicit request (coverage dashboard / single-target regeneration): honor requested targets.
        if ((requestedEntrypointKeys && requestedEntrypointKeys.length > 0) || (requestedSymbolUids && requestedSymbolUids.length > 0)) {
          const { pr, stats } = await runDocPrWithOpenClaw({
            store,
            docStore,
            docsWriter: writer,
            tenantId,
            repoId,
            docsRepoFullName,
            triggerSha,
            prRunId: prRun?.id ?? null,
            entrypointKeys: requestedEntrypointKeys,
            symbolUids: requestedSymbolUids,
            onEvent: (type, payload) => realtime?.publish?.({ tenantId, repoId, type, payload })
          });

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
                docsPrNumber: pr.prNumber ?? null,
                docsPrUrl: pr.prUrl ?? null,
                blocksUpdated: stats?.blocksUpdated ?? 0,
                blocksCreated: stats?.blocksCreated ?? 0,
                blocksUnchanged: stats?.blocksUnchanged ?? 0,
                completedAt: new Date().toISOString()
              }
            });
          }

          return { ok: true, pr };
        }

        // FR-DOC-04/05: surgical updates (stale blocks) + new-node coverage (undocumented nodes/entrypoints).
        let entrypointKeys = null; // null => all; [] => none
        let symbolUids = null; // null => all; [] => none

        const docTypes = new Set(['Function', 'Class', 'Package', 'Module', 'File', 'Schema']);
        const isDocumentableNode = (n) => {
          const t = String(n?.node_type ?? '');
          if (!docTypes.has(t)) return false;
          if (t === 'Module' || t === 'File' || t === 'Package' || t === 'Schema') return true;
          return n?.visibility === 'public';
        };

        if (docStore?.listBlocks && docStore?.getEvidence) {
          const allBlocks = await docStore.listBlocks({ tenantId, repoId });
          const stale = await docStore.listBlocks({ tenantId, repoId, status: 'stale' });
          const hasAnyBlocks = Array.isArray(allBlocks) && allBlocks.length > 0;

          const flowDocFiles = new Set();
          const documentedSymbolUids = new Set();
          for (const b of allBlocks ?? []) {
            const docFile = b.doc_file ?? b.docFile ?? null;
            const blockType = b.block_type ?? b.blockType ?? null;
            if (blockType === 'flow' && typeof docFile === 'string') flowDocFiles.add(docFile);
            const ev = await docStore.getEvidence({ tenantId, repoId, blockId: b.id ?? b.blockId ?? b.block_id });
            for (const e of ev ?? []) {
              const uid = e?.symbol_uid ?? e?.symbolUid ?? null;
              if (typeof uid === 'string' && uid.length > 0) documentedSymbolUids.add(uid);
            }
          }

          const undocumentedEntrypointKeys = new Set();
          for (const ep of entrypoints) {
            const key = ep.entrypoint_key;
            const docFile = docPathByEntrypointKey.get(key);
            if (docFile && !flowDocFiles.has(docFile)) undocumentedEntrypointKeys.add(key);
          }

          const undocumentedSymbolUids = new Set();
          for (const n of await store.listNodes({ tenantId, repoId })) {
            if (!isDocumentableNode(n)) continue;
            const uid = n?.symbol_uid ?? null;
            if (typeof uid !== 'string' || uid.length === 0) continue;
            if (documentedSymbolUids.has(uid)) continue;
            undocumentedSymbolUids.add(uid);
          }

          if (!hasAnyBlocks) {
            // FR-DOC-01: initial docs after first index.
            entrypointKeys = null;
            symbolUids = null;
          } else {
            const keySet = new Set();
            const symbolSet = new Set();

            // Stale blocks → regenerate only those.
            if (Array.isArray(stale) && stale.length > 0) {
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
            }

            // Always include undocumented targets so incremental pushes don't starve coverage.
            for (const k of undocumentedEntrypointKeys) keySet.add(k);
            for (const uid of undocumentedSymbolUids) symbolSet.add(uid);

            entrypointKeys = Array.from(keySet);
            symbolUids = Array.from(symbolSet);

            // If nothing is stale and coverage is complete, skip the run.
            if ((!Array.isArray(stale) || stale.length === 0) && entrypointKeys.length === 0 && symbolUids.length === 0) {
              if (prRun && docStore?.updatePrRun) {
                await docStore.updatePrRun({
                  tenantId,
                  repoId,
                  prRunId: prRun.id,
                  patch: { status: 'skipped', errorMessage: 'no_stale_or_undocumented_blocks', completedAt: new Date().toISOString() }
                });
              }
              return { ok: true, pr: { ok: true, empty: true, targetRepoFullName: docsRepoFullName, filesCount: 0 } };
            }
          }
        }

        const documentableNodesCount = (await store.listNodes({ tenantId, repoId })).filter(isDocumentableNode).length;
        const fullRun = entrypointKeys === null && symbolUids === null;
        const processedCount = fullRun ? entrypoints.length + documentableNodesCount : (entrypointKeys?.length ?? 0) + (symbolUids?.length ?? 0);
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

        const { pr, stats } = await runDocPrWithOpenClaw({
          store,
          docStore,
          docsWriter: writer,
          tenantId,
          repoId,
          docsRepoFullName,
          triggerSha,
          prRunId: prRun?.id ?? null,
          entrypointKeys,
          symbolUids,
          onEvent: (type, payload) => realtime?.publish?.({ tenantId, repoId, type, payload })
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
              docsPrNumber: pr.prNumber ?? null,
              docsPrUrl: pr.prUrl ?? null,
              blocksUpdated: stats?.blocksUpdated ?? 0,
              blocksCreated: stats?.blocksCreated ?? 0,
              blocksUnchanged: stats?.blocksUnchanged ?? 0,
              completedAt: new Date().toISOString()
            }
          });
        }
        realtime?.publish?.({ tenantId, repoId, type: 'agent:complete', payload: { agent: 'doc', sha: triggerSha, pr } });
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
        realtime?.publish?.({ tenantId, repoId, type: 'agent:error', payload: { agent: 'doc', sha: triggerSha, error: String(err?.message ?? err) } });
        throw err;
      } finally {
        if (lockStore?.release && lockToken) {
          await lockStore.release({ tenantId, repoId, lockName, token: lockToken });
        }
      }
    }
  };
}
