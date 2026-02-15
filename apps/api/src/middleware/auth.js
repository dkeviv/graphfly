import { verifyJwtHs256 } from '../../../../packages/auth/src/jwt.js';
import { OrgRoles } from '../../../../packages/org-members/src/store.js';

function roleRank(role) {
  switch (role) {
    case OrgRoles.OWNER:
      return 4;
    case OrgRoles.ADMIN:
      return 3;
    case OrgRoles.MEMBER:
      return 2;
    case OrgRoles.VIEWER:
    default:
      return 1;
  }
}

export function requireRole(ctx, minRole) {
  const got = ctx.auth?.role ?? OrgRoles.VIEWER;
  if (roleRank(got) < roleRank(minRole)) {
    return { status: 403, body: { error: 'forbidden', requiredRole: minRole } };
  }
  return null;
}

export function tenantIdFromCtx(ctx, fallback) {
  return ctx.auth?.tenantId ?? ctx.query?.tenantId ?? ctx.body?.tenantId ?? fallback;
}

export function makeAuthMiddleware({
  mode = process.env.GRAPHFLY_AUTH_MODE ?? 'none',
  jwtSecret = process.env.GRAPHFLY_JWT_SECRET ?? '',
  orgMemberStore = null,
  publicPaths = ['/api/v1/integrations/github/oauth/start', '/api/v1/integrations/github/oauth/callback', '/webhooks/github', '/webhooks/stripe']
} = {}) {
  const m = String(mode ?? 'none');
  if (m === 'none') {
    return async (ctx) => {
      // Dev/test mode: behave as an implicit owner of the requested tenant.
      const tenantId = ctx.query?.tenantId ?? ctx.body?.tenantId ?? null;
      ctx.auth = { tenantId, userId: 'dev', role: OrgRoles.OWNER, insecure: true };
      return null;
    };
  }
  if (m !== 'jwt') throw new Error(`unsupported_auth_mode:${m}`);
  if (!jwtSecret) throw new Error('GRAPHFLY_JWT_SECRET is required for jwt auth mode');

  return async (ctx) => {
    if (Array.isArray(publicPaths) && publicPaths.includes(ctx.pathname)) {
      ctx.auth = null;
      return null;
    }
    const auth = ctx.headers?.authorization ?? '';
    const v = String(auth);
    if (!v.toLowerCase().startsWith('bearer ')) {
      return { status: 401, body: { error: 'unauthorized', reason: 'missing_bearer' } };
    }
    const token = v.slice('bearer '.length).trim();
    const out = verifyJwtHs256({ secret: jwtSecret, token });
    if (!out.ok) return { status: 401, body: { error: 'unauthorized', reason: out.reason } };

    const tenantId = out.claims?.tenantId ?? out.claims?.tenant_id ?? null;
    const userId = out.claims?.sub ?? out.claims?.userId ?? null;
    if (!tenantId) return { status: 401, body: { error: 'unauthorized', reason: 'missing_tenant' } };
    if (!userId) return { status: 401, body: { error: 'unauthorized', reason: 'missing_user' } };

    let role = out.claims?.role ?? OrgRoles.VIEWER;
    if (orgMemberStore?.getMember) {
      const m = await Promise.resolve(orgMemberStore.getMember({ tenantId, userId }));
      if (!m) return { status: 401, body: { error: 'unauthorized', reason: 'not_a_member' } };
      role = m.role ?? role;
    }

    ctx.auth = { tenantId, userId, role };
    return null;
  };
}
