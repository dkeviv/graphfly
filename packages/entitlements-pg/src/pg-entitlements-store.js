import { Plans } from '../../entitlements/src/limits.js';

function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

function normalizePlan(plan) {
  const p = String(plan ?? '').toLowerCase();
  if (p === Plans.PRO) return Plans.PRO;
  if (p === Plans.ENTERPRISE) return Plans.ENTERPRISE;
  return Plans.FREE;
}

export class PgEntitlementsStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async ensureOrgExists({ tenantId, name = 'unknown' }) {
    assertUuid(tenantId, 'tenantId');
    await this._c.query(`INSERT INTO orgs (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [tenantId, name]);
  }

  async getPlan(tenantId) {
    assertUuid(tenantId, 'tenantId');
    const res = await this._c.query('SELECT plan FROM orgs WHERE id=$1 LIMIT 1', [tenantId]);
    return normalizePlan(res.rows?.[0]?.plan ?? Plans.FREE);
  }

  async setPlan(tenantId, plan) {
    assertUuid(tenantId, 'tenantId');
    const p = normalizePlan(plan);
    await this.ensureOrgExists({ tenantId });
    await this._c.query('UPDATE orgs SET plan=$2, updated_at=now() WHERE id=$1', [tenantId, p]);
    return { ok: true, plan: p };
  }
}

