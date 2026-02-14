export const Plans = Object.freeze({
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise'
});

export function limitsForPlan(plan) {
  switch (plan) {
    case Plans.ENTERPRISE:
      return { rpm: 6000, indexJobsPerDay: Infinity, docBlocksPerMonth: Infinity, repos: Infinity };
    case Plans.PRO:
      return { rpm: 1200, indexJobsPerDay: 1000, docBlocksPerMonth: 500, repos: 25 };
    case Plans.FREE:
    default:
      return { rpm: 120, indexJobsPerDay: 10, docBlocksPerMonth: 20, repos: 5 };
  }
}
