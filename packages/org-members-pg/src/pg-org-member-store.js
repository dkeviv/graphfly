function assertUuid(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    throw new Error(`${name} must be a UUID string`);
  }
}

function normalizeRole(v) {
  const s = String(v ?? '').toLowerCase();
  if (s === 'viewer' || s === 'member' || s === 'admin' || s === 'owner') return s;
  return 'viewer';
}

export class PgOrgMemberStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async upsertMember({ tenantId, userId, role }) {
    assertUuid(tenantId, 'tenantId');
    if (!userId) throw new Error('userId is required');
    const r = normalizeRole(role);
    await this._c.query(
      `INSERT INTO org_members (tenant_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET role=EXCLUDED.role, updated_at=now()`,
      [tenantId, String(userId), r]
    );
    return this.getMember({ tenantId, userId });
  }

  async getMember({ tenantId, userId }) {
    assertUuid(tenantId, 'tenantId');
    if (!userId) throw new Error('userId is required');
    const res = await this._c.query(
      `SELECT tenant_id, user_id, role
       FROM org_members
       WHERE tenant_id=$1 AND user_id=$2
       LIMIT 1`,
      [tenantId, String(userId)]
    );
    const row = res.rows?.[0] ?? null;
    if (!row) return null;
    return { tenantId: row.tenant_id, userId: row.user_id, role: normalizeRole(row.role) };
  }

  async listMembers({ tenantId }) {
    assertUuid(tenantId, 'tenantId');
    const res = await this._c.query(
      `SELECT tenant_id, user_id, role
       FROM org_members
       WHERE tenant_id=$1
       ORDER BY updated_at DESC`,
      [tenantId]
    );
    return (res.rows ?? []).map((r) => ({ tenantId: r.tenant_id, userId: r.user_id, role: normalizeRole(r.role) }));
  }

  async removeMember({ tenantId, userId }) {
    assertUuid(tenantId, 'tenantId');
    if (!userId) throw new Error('userId is required');
    const res = await this._c.query(`DELETE FROM org_members WHERE tenant_id=$1 AND user_id=$2`, [tenantId, String(userId)]);
    return { ok: true, deleted: (res.rowCount ?? 0) > 0 };
  }
}

