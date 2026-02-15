export const OrgRoles = Object.freeze({
  VIEWER: 'viewer',
  MEMBER: 'member',
  ADMIN: 'admin',
  OWNER: 'owner'
});

function normalizeRole(v) {
  const s = String(v ?? '').toLowerCase();
  if (s === 'viewer' || s === 'member' || s === 'admin' || s === 'owner') return s;
  return OrgRoles.VIEWER;
}

export class InMemoryOrgMemberStore {
  constructor() {
    this._byTenantUser = new Map(); // `${tenantId}::${userId}` -> { tenantId, userId, role }
  }

  _k({ tenantId, userId }) {
    return `${String(tenantId)}::${String(userId)}`;
  }

  async upsertMember({ tenantId, userId, role }) {
    if (!tenantId || !userId) throw new Error('tenantId and userId are required');
    const row = { tenantId, userId: String(userId), role: normalizeRole(role) };
    this._byTenantUser.set(this._k(row), row);
    return row;
  }

  async getMember({ tenantId, userId }) {
    if (!tenantId || !userId) throw new Error('tenantId and userId are required');
    return this._byTenantUser.get(this._k({ tenantId, userId })) ?? null;
  }

  async listMembers({ tenantId }) {
    if (!tenantId) throw new Error('tenantId is required');
    return Array.from(this._byTenantUser.values()).filter((m) => m.tenantId === tenantId);
  }

  async removeMember({ tenantId, userId }) {
    if (!tenantId || !userId) throw new Error('tenantId and userId are required');
    const ok = this._byTenantUser.delete(this._k({ tenantId, userId }));
    return { ok: true, deleted: ok };
  }
}

