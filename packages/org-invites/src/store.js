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

function nowMs() {
  return Date.now();
}

function makeToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export class InMemoryOrgInviteStore {
  constructor() {
    this._invites = new Map(); // inviteId -> invite
    this._byTenantTokenHash = new Map(); // `${tenantId}:${tokenHash}` -> inviteId
  }

  async createInvite({ tenantId, email, role = 'viewer', ttlDays = 7 } = {}) {
    assertUuid(tenantId, 'tenantId');
    const normalizedEmail = normalizeEmail(email);
    const r = normalizeRole(role);
    const token = makeToken();
    const th = tokenHash(token);
    const inviteId = crypto.randomUUID();
    const expiresAt = new Date(nowMs() + Math.max(1, Number(ttlDays) || 7) * 24 * 3600 * 1000).toISOString();
    const invite = {
      id: inviteId,
      tenantId,
      email: normalizedEmail,
      role: r,
      status: 'pending',
      tokenHash: th,
      expiresAt,
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null
    };
    this._invites.set(inviteId, invite);
    this._byTenantTokenHash.set(`${tenantId}:${th}`, inviteId);
    return { invite, token };
  }

  async listInvites({ tenantId, status = null, limit = 200 } = {}) {
    assertUuid(tenantId, 'tenantId');
    const lim = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 200;
    const want = status ? String(status) : null;
    const rows = [];
    for (const inv of this._invites.values()) {
      if (inv.tenantId !== tenantId) continue;
      if (want && inv.status !== want) continue;
      rows.push(inv);
    }
    rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    return rows.slice(0, lim).map((x) => ({ ...x, tokenHash: undefined }));
  }

  async revokeInvite({ tenantId, inviteId } = {}) {
    assertUuid(tenantId, 'tenantId');
    if (!inviteId) throw new Error('inviteId is required');
    const inv = this._invites.get(String(inviteId)) ?? null;
    if (!inv || inv.tenantId !== tenantId) return { ok: true, revoked: false };
    if (inv.status !== 'pending') return { ok: true, revoked: false };
    inv.status = 'revoked';
    inv.revokedAt = new Date().toISOString();
    return { ok: true, revoked: true };
  }

  async acceptInvite({ tenantId, token, userId } = {}) {
    assertUuid(tenantId, 'tenantId');
    if (!token) throw new Error('token is required');
    if (!userId) throw new Error('userId is required');
    const th = tokenHash(token);
    const id = this._byTenantTokenHash.get(`${tenantId}:${th}`) ?? null;
    const inv = id ? this._invites.get(id) ?? null : null;
    if (!inv || inv.tenantId !== tenantId) return { ok: false, error: 'invalid_invite' };
    if (inv.status !== 'pending') return { ok: false, error: 'invite_not_pending' };
    if (inv.expiresAt && Date.parse(inv.expiresAt) < nowMs()) {
      inv.status = 'expired';
      return { ok: false, error: 'invite_expired' };
    }
    inv.status = 'accepted';
    inv.acceptedAt = new Date().toISOString();
    inv.acceptedByUserId = String(userId);
    return { ok: true, invite: { ...inv, tokenHash: undefined } };
  }
}

