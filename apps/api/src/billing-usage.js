import { limitsForPlan } from '../../../packages/entitlements/src/limits.js';

function toFiniteOrNull(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

export function formatLimit(limit) {
  const v = toFiniteOrNull(limit);
  return { limit: v, unlimited: v === null };
}

export function formatMeter({ used, limit, periodStart, periodEnd }) {
  const usedNum = Number(used) || 0;
  const { limit: lim, unlimited } = formatLimit(limit);
  const remaining = lim === null ? null : Math.max(0, lim - usedNum);
  return { used: usedNum, limit: lim, unlimited, remaining, periodStart, periodEnd };
}

export async function getBillingUsageSnapshot({ tenantId, entitlementsStore, usageCounters }) {
  if (!tenantId) throw new Error('tenantId is required');
  if (!entitlementsStore || typeof entitlementsStore.getPlan !== 'function') throw new Error('entitlementsStore.getPlan is required');
  if (!usageCounters || typeof usageCounters.getIndexJobsToday !== 'function') throw new Error('usageCounters.getIndexJobsToday is required');
  if (!usageCounters || typeof usageCounters.getDocBlocksThisMonth !== 'function') throw new Error('usageCounters.getDocBlocksThisMonth is required');

  const plan = await Promise.resolve(entitlementsStore.getPlan(tenantId));
  const limits = limitsForPlan(plan);
  const indexJobs = await Promise.resolve(usageCounters.getIndexJobsToday({ tenantId }));
  const docBlocks = await Promise.resolve(usageCounters.getDocBlocksThisMonth({ tenantId }));

  return {
    tenantId,
    plan,
    periodStart: docBlocks.periodStart,
    periodEnd: docBlocks.periodEnd,
    limits: {
      rpm: formatLimit(limits.rpm),
      repos: formatLimit(limits.repos),
      indexJobsPerDay: formatLimit(limits.indexJobsPerDay),
      docBlocksPerMonth: formatLimit(limits.docBlocksPerMonth)
    },
    usage: {
      indexJobsPerDay: formatMeter({ ...indexJobs, limit: limits.indexJobsPerDay }),
      docBlocksPerMonth: formatMeter({ ...docBlocks, limit: limits.docBlocksPerMonth })
    }
  };
}

