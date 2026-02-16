import crypto from 'node:crypto';

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

function normalizeEmail(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || !s.includes('@')) throw new Error('email must be a valid email address');
  return s;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function clampLimit(limit) {
  const lim = Number.isFinite(limit) ? Math.trunc(limit) : 200;
  return Math.max(1, Math.min(500, lim));
}

export class PgOrgInviteStore {
  constructor({ client } = {}) {
    if (!client || typeof client.query !== 'function') throw new Error('client.query is required');
    this._c = client;
  }

  async createInvite({ tenantId, email, role = 'viewer', ttlDays = 7 } = {}) {
    assertUuid(tenantId, 'tenantId');
    const normalizedEmail = normalizeEmail(email);
    const r = normalizeRole(role);
    const token = crypto.randomBytes(32).toString('base64url');
    const th = tokenHash(token);
    const days = Math.max(1, Number(ttlDays) || 7);

    const res = await this._c.query(
      `INSERT INTO org_invites (tenant_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5::text || ' days')::interval)
       RETURNING id, tenant_id, email, role, status, expires_at, created_at, accepted_at, accepted_by_user_id, revoked_at`,
      [tenantId, normalizedEmail, r, th, String(days)]
    );
    const row = res.rows?.[0] ?? null;
    if (!row) throw new Error('invite_create_failed');
    return {
      invite: {
        id: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        role: normalizeRole(row.role),
        status: String(row.status),
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
        acceptedByUserId: row.accepted_by_user_id,
        revokedAt: row.revoked_at
      },
      token
    };
  }

  async listInvites({ tenantId, status = null, limit = 200 } = {}) {
    assertUuid(tenantId, 'tenantId');
    const lim = clampLimit(limit);
    const params = [tenantId, lim];
    let where = `tenant_id=$1`;
    if (status) {
      params.splice(1, 0, String(status));
      where += ` AND status=$2`;
    }
    const res = await this._c.query(
      `SELECT id, tenant_id, email, role, status, expires_at, created_at, accepted_at, accepted_by_user_id, revoked_at
       FROM org_invites
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return (res.rows ?? []).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      role: normalizeRole(row.role),
      status: String(row.status),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      acceptedByUserId: row.accepted_by_user_id,
      revokedAt: row.revoked_at
    }));
  }

  async revokeInvite({ tenantId, inviteId } = {}) {
    assertUuid(tenantId, 'tenantId');
    if (!inviteId) throw new Error('inviteId is required');
    const res = await this._c.query(
      `UPDATE org_invites
       SET status='revoked', revoked_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status='pending'`,
      [tenantId, String(inviteId)]
    );
    return { ok: true, revoked: (res.rowCount ?? 0) > 0 };
  }

  async acceptInvite({ tenantId, token, userId } = {}) {
    assertUuid(tenantId, 'tenantId');
    if (!token) throw new Error('token is required');
    if (!userId) throw new Error('userId is required');
    const th = tokenHash(token);

    const res = await this._c.query(
      `UPDATE org_invites
       SET status='accepted', accepted_at=now(), accepted_by_user_id=$3
       WHERE tenant_id=$1
         AND token_hash=$2
         AND status='pending'
         AND expires_at > now()
       RETURNING id, tenant_id, email, role, status, expires_at, created_at, accepted_at, accepted_by_user_id, revoked_at`,
      [tenantId, th, String(userId)]
    );
    const row = res.rows?.[0] ?? null;
    if (!row) return { ok: false, error: 'invalid_or_expired_invite' };
    return {
      ok: true,
      invite: {
        id: row.id,
        tenantId: row.tenant_id,
        email: row.email,
        role: normalizeRole(row.role),
        status: String(row.status),
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        acceptedAt: row.accepted_at,
        acceptedByUserId: row.accepted_by_user_id,
        revokedAt: row.revoked_at
      }
    };
  }
}

