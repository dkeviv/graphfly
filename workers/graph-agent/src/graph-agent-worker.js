import { runGraphEnrichmentWithOpenClaw } from './openclaw-graph-run.js';
import { startLockHeartbeat } from '../../../packages/stores/src/lock-heartbeat.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyRetry(err) {
  const msg = String(err?.message ?? err);
  if (msg.includes('graph_agent_tool_budget_exceeded')) return { retryable: false, reason: 'budget' };
  if (msg.includes('graph_annotation_invalid')) return { retryable: false, reason: 'invalid_annotation' };
  if (msg.includes('invalid_tool_arguments')) return { retryable: false, reason: 'tool_args' };
  if (msg.includes('OpenClaw /v1/responses failed')) return { retryable: true, reason: 'gateway_http' };
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) return { retryable: true, reason: 'network' };
  return { retryable: false, reason: 'unknown' };
}

export function createGraphAgentWorker({ store, lockStore = null }) {
  return {
    async handle(job) {
      const { tenantId, repoId, sha = 'mock' } = job.payload ?? {};
      if (!tenantId || !repoId) throw new Error('tenantId and repoId are required');
      const lockName = 'graph_enrich';
      const ttlMs = Number(process.env.GRAPHFLY_GRAPH_AGENT_LOCK_TTL_MS ?? 10 * 60 * 1000);
      let lockToken = null;
      let lockHb = null;
      if (lockStore?.tryAcquire) {
        const lease = await lockStore.tryAcquire({ tenantId, repoId, lockName, ttlMs: Number.isFinite(ttlMs) ? Math.trunc(ttlMs) : 10 * 60 * 1000 });
        if (!lease.acquired) return { ok: true, skipped: true, reason: 'lock_busy' };
        lockToken = lease.token;
        lockHb = startLockHeartbeat({
          lockStore,
          tenantId,
          repoId,
          lockName,
          token: lockToken,
          ttlMs: Number.isFinite(ttlMs) ? Math.trunc(ttlMs) : 10 * 60 * 1000,
          onLostLock: () => console.warn(`WARN: lost graph lock for tenant=${tenantId} repo=${repoId}`),
          onError: (e) => console.warn(`WARN: graph lock heartbeat failed: ${String(e?.message ?? e)}`)
        });
      }

      const maxAttempts = Number(process.env.GRAPHFLY_GRAPH_AGENT_MAX_ATTEMPTS ?? 3);
      const baseBackoffMs = Number(process.env.GRAPHFLY_GRAPH_AGENT_RETRY_BASE_MS ?? 500);

      try {
        for (let attempt = 1; attempt <= (Number.isFinite(maxAttempts) ? Math.trunc(maxAttempts) : 3); attempt++) {
          try {
            await runGraphEnrichmentWithOpenClaw({ store, tenantId, repoId, triggerSha: sha });
            break;
          } catch (err) {
            const cls = classifyRetry(err);
            if (!cls.retryable || attempt === maxAttempts) throw err;
            const backoff = Math.min(30_000, baseBackoffMs * 2 ** (attempt - 1));
            await sleep(backoff);
          }
        }
      } finally {
        try {
          await lockHb?.stop?.();
        } catch {}
        if (lockStore?.release && lockToken) {
          await lockStore.release({ tenantId, repoId, lockName, token: lockToken });
        }
      }
      return { ok: true };
    }
  };
}
