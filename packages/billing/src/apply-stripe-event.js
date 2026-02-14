import { Plans } from '../../entitlements/src/limits.js';

function isActiveSubscription(event) {
  const obj = event?.data?.object;
  if (!obj || typeof obj !== 'object') return false;
  const status = obj.status;
  return status === 'active' || status === 'trialing';
}

export async function applyStripeEventToEntitlements({ event, tenantId, entitlementsStore }) {
  if (!event || typeof event !== 'object') throw new Error('event required');
  if (!tenantId) throw new Error('tenantId required');
  if (!entitlementsStore?.setPlan) throw new Error('entitlementsStore required');

  // Minimal plan mapping for V1:
  // - active/trialing subscription => PRO
  // - else => FREE
  if (event.type?.startsWith('customer.subscription.')) {
    await Promise.resolve(entitlementsStore.setPlan(tenantId, isActiveSubscription(event) ? Plans.PRO : Plans.FREE));
  }
  return { ok: true };
}
