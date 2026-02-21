import { TokenBucketLimiter } from '../../../../packages/ratelimit/src/token-bucket.js';
import { limitsForPlan } from '../../../../packages/entitlements/src/limits.js';

export function makeRateLimitMiddleware({ entitlementsStore, limiter = null } = {}) {
  const bucket = limiter ?? new TokenBucketLimiter({ capacity: 120, refillPerSecond: 2 });

  return async (ctx) => {
    const tenantId = ctx.auth?.tenantId ?? ctx.query?.tenantId ?? ctx.body?.tenantId ?? '00000000-0000-0000-0000-000000000001';
    const plan = await Promise.resolve(entitlementsStore?.getPlan?.(tenantId) ?? 'free').catch(() => 'free');
    const { rpm } = limitsForPlan(plan);

    // Convert rpm to refill/sec while keeping a small burst capacity.
    bucket.configure({ capacity: Math.max(10, Math.ceil(rpm / 60)), refillPerSecond: Math.max(1, rpm / 60) });

    const key = `${tenantId}::${ctx.method}::${ctx.pathname}`;
    const res = bucket.consume(key, 1);
    if (!res.ok) {
      return {
        status: 429,
        body: { error: 'rate_limited', retryAfterSec: res.retryAfterSec }
      };
    }
    return null;
  };
}
