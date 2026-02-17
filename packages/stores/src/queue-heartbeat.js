function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

export function startQueueHeartbeat({
  queue,
  tenantId,
  jobId,
  lockToken,
  lockMs = 60000,
  intervalMs = null,
  onLostLock = null,
  onError = null
} = {}) {
  const canRenew = queue && typeof queue.renew === 'function';
  if (!canRenew) return { stop: async () => {} };

  const effectiveLockMs = clampInt(lockMs, { min: 5000, max: 10 * 60 * 1000, fallback: 60000 });
  const tickMs =
    intervalMs == null
      ? clampInt(Math.floor(effectiveLockMs / 3), { min: 5000, max: 60000, fallback: 20000 })
      : clampInt(intervalMs, { min: 1000, max: 5 * 60 * 1000, fallback: 20000 });

  let stopped = false;
  let inFlight = false;

  const timer = setInterval(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const res = await queue.renew({ tenantId, jobId, lockToken, lockMs: effectiveLockMs });
      if (res?.updated === false && typeof onLostLock === 'function') onLostLock(res);
    } catch (e) {
      if (typeof onError === 'function') onError(e);
    } finally {
      inFlight = false;
    }
  }, tickMs);

  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
    }
  };
}

