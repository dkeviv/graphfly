export const Plans = Object.freeze({
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise'
});

export function limitsForPlan(plan) {
  switch (plan) {
    case Plans.ENTERPRISE:
      return { rpm: 6000 };
    case Plans.PRO:
      return { rpm: 1200 };
    case Plans.FREE:
    default:
      return { rpm: 120 };
  }
}

