function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

export function startLockHeartbeat({
  lockStore,
  tenantId,
  repoId,
  lockName,
  token,
  ttlMs = 10 * 60 * 1000,
  intervalMs = null,
  onLostLock = null,
  onError = null
} = {}) {
  const canRenew = lockStore && typeof lockStore.renew === 'function';
  if (!canRenew) return { stop: async () => {} };

  const effectiveTtlMs = clampInt(ttlMs, { min: 5000, max: 24 * 60 * 60 * 1000, fallback: 10 * 60 * 1000 });
  const tickMs =
    intervalMs == null
      ? clampInt(Math.floor(effectiveTtlMs / 3), { min: 1000, max: 60_000, fallback: 20_000 })
      : clampInt(intervalMs, { min: 1000, max: 5 * 60 * 1000, fallback: 20_000 });

  let stopped = false;
  let inFlight = false;

  const timer = setInterval(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const res = await lockStore.renew({ tenantId, repoId, lockName, token, ttlMs: effectiveTtlMs });
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

