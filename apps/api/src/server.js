import http from 'node:http';
import crypto from 'node:crypto';
import { createGraphStoreFromEnv } from '../../../packages/stores/src/graph-store.js';
import { createDocStoreFromEnv } from '../../../packages/stores/src/doc-store.js';
import { ingestNdjson } from '../../../packages/ndjson/src/ingest.js';
import { blastRadius } from '../../../packages/cig/src/query.js';
import { semanticSearch, textSearch } from '../../../packages/cig/src/search.js';
import { createJsonRouter } from './tiny-router.js';
import { DeliveryDedupe } from '../../../packages/github-webhooks/src/dedupe.js';
import { makeGitHubWebhookHandler } from './github-webhook.js';
import { publicNode, publicEdge } from './public-shapes.js';
import { createEntitlementsStoreFromEnv } from '../../../packages/stores/src/entitlements-store.js';
import { makeRateLimitMiddleware } from './middleware/rate-limit.js';
import { makeAuthMiddleware, requireRole, tenantIdFromCtx } from './middleware/auth.js';
import { createJwtHs256, verifyJwtHs256 } from '../../../packages/auth/src/jwt.js';
import { limitsForPlan } from '../../../packages/entitlements/src/limits.js';
import { StripeEventDedupe } from '../../../packages/stripe-webhooks/src/dedupe.js';
import { makeStripeWebhookHandler } from './stripe-webhook.js';
import { applyStripeEventToEntitlements } from '../../../packages/billing/src/apply-stripe-event.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';
import { neighborhood } from '../../../packages/cig/src/neighborhood.js';
import { createQueueFromEnv } from '../../../packages/stores/src/queue.js';
import { createIndexerWorker } from '../../../workers/indexer/src/indexer-worker.js';
import { createDocWorker } from '../../../workers/doc-agent/src/doc-worker.js';
import { OrgRoles } from '../../../packages/org-members/src/store.js';
import { GitHubDocsWriter } from '../../../packages/github-service/src/docs-writer.js';
import { LocalDocsWriter } from '../../../packages/github-service/src/local-docs-writer.js';
import { createStripeClient, createCheckoutSession, createCustomerPortalSession, createCustomer } from '../../../packages/stripe-service/src/stripe.js';
import { createUsageCountersFromEnv } from '../../../packages/stores/src/usage-counters.js';
import { getPgPoolFromEnv } from '../../../packages/stores/src/pg-pool.js';
import { withTenantClient } from '../../../packages/pg-client/src/tenant.js';
import { PgBillingStore } from '../../../packages/billing-pg/src/pg-billing-store.js';
import { formatGraphSearchResponse } from './search-format.js';
import { getBillingUsageSnapshot } from './billing-usage.js';
import { createOrgStoreFromEnv } from '../../../packages/stores/src/org-store.js';
import { createRepoStoreFromEnv } from '../../../packages/stores/src/repo-store.js';
import { createCheckoutUrl, createPortalUrl } from './billing-sessions.js';
import { createInstallationToken } from '../../../packages/github-app-auth/src/app-auth.js';
import { createSecretsStoreFromEnv } from '../../../packages/stores/src/secrets-store.js';
import { GitHubClient } from '../../../packages/github-client/src/client.js';
import { enqueueInitialFullIndexOnRepoCreate } from './lib/initial-index.js';
import { enqueueLocalFullIndexOnRepoCreate } from './lib/local-index.js';
import { InMemoryOAuthStateStore, buildGitHubAuthorizeUrl, exchangeCodeForToken } from '../../../packages/github-oauth/src/oauth.js';
import { createWebhookDeliveryDedupeFromEnv } from '../../../packages/stores/src/webhook-delivery-dedupe.js';
import { createOrgMemberStoreFromEnv } from '../../../packages/stores/src/org-member-store.js';
import { createOrgInviteStoreFromEnv } from '../../../packages/stores/src/org-invite-store.js';
import { createLogger, createMetrics } from '../../../packages/observability/src/index.js';
import { encryptString, decryptString, getSecretKeyringInfo } from '../../../packages/secrets/src/crypto.js';
import { createLockStoreFromEnv } from '../../../packages/stores/src/lock-store.js';
import { InMemoryRealtimeHub } from '../../../packages/realtime/src/hub.js';
import { acceptWebSocketUpgrade, createWsConnection } from './ws.js';

const DEFAULT_TENANT_ID = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
const DEFAULT_REPO_ID = process.env.REPO_ID ?? '00000000-0000-0000-0000-000000000002';

function assertProdConfig(env = process.env) {
  const mode = String(env.GRAPHFLY_MODE ?? 'dev').toLowerCase();
  if (mode !== 'prod') return;
  const missing = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.GRAPHFLY_SECRET_KEY) missing.push('GRAPHFLY_SECRET_KEY');
  if (!env.GRAPHFLY_JWT_SECRET) missing.push('GRAPHFLY_JWT_SECRET');
  if (String(env.GRAPHFLY_AUTH_MODE ?? '') !== 'jwt') missing.push('GRAPHFLY_AUTH_MODE=jwt');
  if (String(env.GRAPHFLY_QUEUE_MODE ?? '') !== 'pg') missing.push('GRAPHFLY_QUEUE_MODE=pg');
  if (!env.GITHUB_APP_ID) missing.push('GITHUB_APP_ID');
  if (!env.GITHUB_APP_PRIVATE_KEY) missing.push('GITHUB_APP_PRIVATE_KEY');
  if (!env.GITHUB_WEBHOOK_SECRET) missing.push('GITHUB_WEBHOOK_SECRET');
  const indexerMode = String(env.GRAPHFLY_INDEXER_MODE ?? 'auto').toLowerCase();
  if (indexerMode === 'mock') missing.push('GRAPHFLY_INDEXER_MODE!=mock');
  const astEngine = String(env.GRAPHFLY_AST_ENGINE ?? '').toLowerCase();
  if (astEngine === 'none' || astEngine === 'off') missing.push('GRAPHFLY_AST_ENGINE!=off');
  if (String(env.GRAPHFLY_ALLOW_LOCAL_REPO_ROOT ?? '').trim() === '1') missing.push('GRAPHFLY_ALLOW_LOCAL_REPO_ROOT must not be enabled in prod');
  const forcedPgStores = [
    'GRAPHFLY_GRAPH_STORE',
    'GRAPHFLY_DOC_STORE',
    'GRAPHFLY_REPO_STORE',
    'GRAPHFLY_ORG_STORE',
    'GRAPHFLY_SECRETS_STORE',
    'GRAPHFLY_ENTITLEMENTS_STORE',
    'GRAPHFLY_USAGE_COUNTERS',
    'GRAPHFLY_ORG_MEMBER_STORE'
  ];
  for (const k of forcedPgStores) {
    if (k in env && String(env[k] ?? '').toLowerCase() !== 'pg') missing.push(`${k}=pg`);
  }
  if (missing.length) {
    throw new Error(`prod_config_missing_or_invalid: ${missing.join(',')}`);
  }
}

assertProdConfig();

const log = createLogger({ service: 'graphfly-api' });
const metrics = createMetrics({ service: 'graphfly-api' });

const repoFullName = process.env.SOURCE_REPO_FULL_NAME ?? 'local/source';
const store = await createGraphStoreFromEnv({ repoFullName });
const docStore = await createDocStoreFromEnv({ repoFullName });
const githubDedupe = new DeliveryDedupe();
const githubSecret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
const entitlements = await createEntitlementsStoreFromEnv();
const usage = await createUsageCountersFromEnv();
const stripeDedupe = new StripeEventDedupe();
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const billingPool = await getPgPoolFromEnv({ connectionString: process.env.DATABASE_URL ?? '', max: Number(process.env.PG_POOL_MAX ?? 10) });
const orgs = await createOrgStoreFromEnv();
const orgMembers = await createOrgMemberStoreFromEnv();
const orgInvites = await createOrgInviteStoreFromEnv();
const repos = await createRepoStoreFromEnv();
const secrets = await createSecretsStoreFromEnv();
const oauthStates = new InMemoryOAuthStateStore();
const realtimeHub = new InMemoryRealtimeHub();
const realtime = { publish: (evt) => realtimeHub.publish(evt) };
const webhookDedupe = await createWebhookDeliveryDedupeFromEnv();
const githubApiBaseUrl = () => String(process.env.GITHUB_API_BASE_URL ?? 'https://api.github.com');

function tenantIdFromStripeEvent(event) {
  const md = event?.data?.object?.metadata;
  const v = md?.tenantId ?? md?.tenant_id ?? md?.orgId ?? md?.org_id;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function auditEvent({ tenantId, actorUserId, action, targetType = null, targetId = null, metadata = null } = {}) {
  if (!billingPool) return;
  if (!tenantId || !action) return;
  try {
    await withTenantClient({ pool: billingPool, tenantId }, async (client) => {
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          tenantId,
          actorUserId ? String(actorUserId) : null,
          String(action),
          targetType ? String(targetType) : null,
          targetId ? String(targetId) : null,
          metadata ? JSON.stringify(metadata) : null
        ]
      );
    });
  } catch {
    // best-effort: audit logging must not break primary flows
  }
}

function privateKeyPemFromEnv() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY ?? '';
  if (!raw) return null;
  return raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
}

async function resolveGitHubReaderToken({ tenantId, org }) {
  const token = process.env.GITHUB_READER_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (token) return token;

  const appId = process.env.GITHUB_APP_ID ?? '';
  const installationId = org?.githubReaderInstallId ?? process.env.GITHUB_READER_INSTALLATION_ID ?? '';
  const privateKeyPem = privateKeyPemFromEnv();
  if (!appId || !installationId || !privateKeyPem) return null;

  const out = await createInstallationToken({ appId, privateKeyPem, installationId });
  return out.token ?? null;
}

async function resolveGitHubDocsToken({ tenantId, org }) {
  const token = process.env.GITHUB_DOCS_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (token) return token;

  const appId = process.env.GITHUB_APP_ID ?? '';
  const installationId = org?.githubDocsInstallId ?? process.env.GITHUB_DOCS_INSTALLATION_ID ?? '';
  const privateKeyPem = privateKeyPemFromEnv();
  if (!appId || !installationId || !privateKeyPem) return null;

  const out = await createInstallationToken({ appId, privateKeyPem, installationId });
  return out.token ?? null;
}

async function gitCloneAuthForOrg({ tenantId, org }) {
  const token = await resolveGitHubReaderToken({ tenantId, org });
  if (!token) return null;
  return { username: 'x-access-token', password: token };
}

// Queue: in-memory for dev/tests; Postgres-backed when configured (durable).
const indexQueue = await createQueueFromEnv({ queueName: 'index' });
const docQueue = await createQueueFromEnv({ queueName: 'doc' });
const graphQueue = await createQueueFromEnv({ queueName: 'graph' });
const lockStore = await createLockStoreFromEnv();
const docsRepoFullName = process.env.DOCS_REPO_FULL_NAME ?? 'org/docs';
const docsRepoPath = process.env.DOCS_REPO_PATH ?? null;
const docsWriterFactory = async ({ tenantId, configuredDocsRepoFullName }) => {
  const org = tenantId ? await Promise.resolve(orgs.getOrg?.({ tenantId })) : null;
  const docsInstallId = org?.githubDocsInstallId ?? null;
  const appId = process.env.GITHUB_APP_ID ?? '';
  const privateKeyPem = privateKeyPemFromEnv();
  return docsRepoPath
    ? new LocalDocsWriter({ configuredDocsRepoFullName, docsRepoPath })
    : new GitHubDocsWriter({
        configuredDocsRepoFullName,
        appId: appId || null,
        privateKeyPem,
        installationId: docsInstallId
      });
};
const indexerWorker = createIndexerWorker({ store, docQueue, docStore, graphQueue, realtime });
const docWorker = createDocWorker({ store, docsWriter: docsWriterFactory, docStore, entitlementsStore: entitlements, usageCounters: usage, realtime });

async function maybeDrainOnce() {
  if (typeof indexQueue?.drain !== 'function' || typeof docQueue?.drain !== 'function' || typeof graphQueue?.drain !== 'function') return;
  for (const j of indexQueue.drain()) await indexerWorker.handle(j);
  // Graph enrichment runs after indexing; it uses the same graph store and is safe to run in-process for dev/tests.
  // Avoids the need for a separate worker in local mode.
  for (const j of graphQueue.drain()) {
    // Lazy import to keep API server startup light.
    const { createGraphAgentWorker } = await import('../../../workers/graph-agent/src/graph-agent-worker.js');
    const graphWorker = createGraphAgentWorker({ store, lockStore });
    await graphWorker.handle({ payload: j.payload });
  }
  for (const j of docQueue.drain()) await docWorker.handle({ payload: j.payload });
}

const handleGitHubWebhook = makeGitHubWebhookHandler({
  secret: githubSecret,
  dedupe: githubDedupe,
  onPush: async (push) => {
    let tenantId = DEFAULT_TENANT_ID;
    let repoId = DEFAULT_REPO_ID;
    try {
      const found = push.githubRepoId
        ? await Promise.resolve(repos.findRepoByGitHubRepoId?.({ githubRepoId: push.githubRepoId }))
        : await Promise.resolve(repos.findRepoByFullName?.({ fullName: push.fullName }));
      if (found?.tenantId && found?.id) {
        tenantId = found.tenantId;
        repoId = found.id;
      }
    } catch {
      // If ambiguous or store not configured, fall back to defaults.
    }

    const plan = await Promise.resolve(entitlements.getPlan(tenantId));
    const limits = limitsForPlan(plan);
    const ok = await usage.consumeIndexJobOrDeny({ tenantId, limitPerDay: limits.indexJobsPerDay, amount: 1 });
    if (!ok.ok) {
      // For webhook-triggered runs, skip quietly (GitHub will retry on non-2xx).
      return;
    }

    const org = await Promise.resolve(orgs.getOrg?.({ tenantId }));
    const orgDocsRepo = org?.docsRepoFullName ?? null;
    const effectiveDocsRepoFullName = orgDocsRepo ?? docsRepoFullName;

    const cloneAuth = await gitCloneAuthForOrg({ tenantId, org });
    const cloneSource = typeof push.cloneUrl === 'string' && push.cloneUrl.length > 0 ? push.cloneUrl : null;

    if (webhookDedupe) {
      const ins = await webhookDedupe.tryInsert({
        provider: 'github',
        deliveryId: push.deliveryId,
        eventType: 'push',
        tenantId,
        repoId
      });
      if (!ins.inserted) return;
    }

    // Spec: push webhook triggers incremental index which triggers docs update.
    indexQueue.add('index.run', {
      tenantId,
      repoId,
      repoRoot: process.env.SOURCE_REPO_ROOT ?? 'fixtures/sample-repo',
      sha: push.sha,
      changedFiles: push.changedFiles,
      removedFiles: push.removedFiles,
      docsRepoFullName: effectiveDocsRepoFullName,
      cloneSource,
      cloneAuth
    });
    await maybeDrainOnce();
  }
});

const router = createJsonRouter();
router.use(makeAuthMiddleware({ orgMemberStore: orgMembers }));
router.use(makeRateLimitMiddleware({ entitlementsStore: entitlements }));

const handleStripeWebhook = makeStripeWebhookHandler({
  signingSecret: stripeSecret,
  dedupe: stripeDedupe,
  onEvent: async (event) => {
    const tenantId = tenantIdFromStripeEvent(event);
    if (tenantId && billingPool) {
      await withTenantClient({ pool: billingPool, tenantId }, async (client) => {
        const billing = new PgBillingStore({ client });
        const inserted = await billing.tryInsertStripeEvent({
          tenantId,
          stripeEventId: event.id,
          type: String(event.type ?? 'unknown')
        });
        if (!inserted.inserted) return;

        try {
          if (String(event.type ?? '').startsWith('customer.subscription.')) {
            await billing.upsertBillingFromSubscription({ tenantId, subscription: event.data?.object });
            await applyStripeEventToEntitlements({ event, tenantId, entitlementsStore: entitlements });
          }
          await billing.markStripeEventProcessed({ tenantId, stripeEventId: event.id, errorMessage: null });
        } catch (err) {
          await billing.markStripeEventProcessed({ tenantId, stripeEventId: event.id, errorMessage: String(err?.message ?? err) });
          throw err;
        }
      });
      return;
    }

    if (tenantId) {
      await applyStripeEventToEntitlements({ event, tenantId, entitlementsStore: entitlements });
    }
  }
});

router.post('/webhooks/stripe', async ({ headers, rawBody }) => {
  return handleStripeWebhook({ headers, rawBody });
});

router.post('/internal/rt', async (req) => {
  const shared = String(process.env.GRAPHFLY_RT_TOKEN ?? '');
  if (!shared) return { status: 501, body: { error: 'realtime_not_configured' } };
  const auth = String(req.headers?.authorization ?? '');
  if (!auth.toLowerCase().startsWith('bearer ') || auth.slice('bearer '.length).trim() !== shared) {
    return { status: 401, body: { error: 'unauthorized' } };
  }
  const tenantId = req.body?.tenantId ?? null;
  const repoId = req.body?.repoId ?? null;
  const type = req.body?.type ?? null;
  if (typeof tenantId !== 'string' || typeof repoId !== 'string' || typeof type !== 'string') {
    return { status: 400, body: { error: 'bad_request' } };
  }
  realtimeHub.publish({ tenantId, repoId, type, payload: req.body?.payload ?? null });
  return { status: 200, body: { ok: true } };
});

router.post('/api/v1/integrations/github/connect', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const token = req.body?.token ?? '';
  if (typeof token !== 'string' || token.length < 10) return { status: 400, body: { error: 'token is required' } };
  // Store encrypted; never return it.
  await secrets.setSecret({ tenantId, key: 'github.user_token', value: token });
  await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'github.connect_user_token', targetType: 'org', targetId: tenantId });
  return { status: 200, body: { ok: true } };
});

router.get('/api/v1/integrations/github/oauth/start', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI ?? '';
  if (!clientId || !redirectUri) return { status: 501, body: { error: 'oauth_not_configured' } };
  const state = oauthStates.issue({ tenantId });
  const authorizeUrl = buildGitHubAuthorizeUrl({ clientId, state, redirectUri, scope: 'repo read:user' });
  return { status: 200, body: { authorizeUrl, state } };
});

router.get('/api/v1/github/reader-app-url', async () => {
  const url = process.env.GITHUB_READER_APP_INSTALL_URL ?? '';
  if (url) return { status: 200, body: { installUrl: url } };
  const slug = process.env.GITHUB_READER_APP_SLUG ?? '';
  if (!slug) return { status: 501, body: { error: 'reader_app_not_configured' } };
  return { status: 200, body: { installUrl: `https://github.com/apps/${slug}/installations/new` } };
});

router.get('/api/v1/github/docs-app-url', async () => {
  const url = process.env.GITHUB_DOCS_APP_INSTALL_URL ?? '';
  if (url) return { status: 200, body: { installUrl: url } };
  const slug = process.env.GITHUB_DOCS_APP_SLUG ?? '';
  if (!slug) return { status: 501, body: { error: 'docs_app_not_configured' } };
  return { status: 200, body: { installUrl: `https://github.com/apps/${slug}/installations/new` } };
});

router.get('/api/v1/github/reader/callback', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const installationId = req.query.installation_id ?? req.query.installationId;
  if (!installationId) return { status: 400, body: { error: 'installation_id is required' } };
  const n = Number(installationId);
  if (!Number.isFinite(n)) return { status: 400, body: { error: 'installation_id must be a number' } };
  await orgs.upsertOrg({ tenantId, patch: { githubReaderInstallId: Math.trunc(n) } });
  await auditEvent({
    tenantId,
    actorUserId: req.auth?.userId ?? null,
    action: 'github.reader_app_installed',
    targetType: 'org',
    targetId: tenantId,
    metadata: { installationId: Math.trunc(n) }
  });
  return { status: 200, body: { ok: true, githubReaderInstallId: Math.trunc(n) } };
});

router.get('/api/v1/github/docs/callback', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const installationId = req.query.installation_id ?? req.query.installationId;
  if (!installationId) return { status: 400, body: { error: 'installation_id is required' } };
  const n = Number(installationId);
  if (!Number.isFinite(n)) return { status: 400, body: { error: 'installation_id must be a number' } };
  await orgs.upsertOrg({ tenantId, patch: { githubDocsInstallId: Math.trunc(n) } });
  await auditEvent({
    tenantId,
    actorUserId: req.auth?.userId ?? null,
    action: 'github.docs_app_installed',
    targetType: 'org',
    targetId: tenantId,
    metadata: { installationId: Math.trunc(n) }
  });
  return { status: 200, body: { ok: true, githubDocsInstallId: Math.trunc(n) } };
});

router.post('/api/v1/integrations/github/oauth/callback', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const code = req.body?.code ?? '';
  const state = req.body?.state ?? '';
  if (!oauthStates.consume({ tenantId, state })) return { status: 400, body: { error: 'invalid_state' } };

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '';
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI ?? '';
  if (!clientId || !clientSecret || !redirectUri) return { status: 501, body: { error: 'oauth_not_configured' } };

  const out = await exchangeCodeForToken({ clientId, clientSecret, code, redirectUri });
  await secrets.setSecret({ tenantId, key: 'github.user_token', value: out.token });

  // Production onboarding: bind the OAuth identity to an org member and return a session token (JWT).
  const authMode = String(process.env.GRAPHFLY_AUTH_MODE ?? 'none');
  if (authMode !== 'jwt') return { status: 200, body: { ok: true } };

  const jwtSecret = process.env.GRAPHFLY_JWT_SECRET ?? '';
  if (!jwtSecret) return { status: 500, body: { error: 'server_misconfigured', missing: ['GRAPHFLY_JWT_SECRET'] } };

  const gh = new GitHubClient({ token: out.token, apiBaseUrl: githubApiBaseUrl() });
  const user = await gh.getCurrentUser();
  const userId = user?.id != null ? `gh:${String(user.id)}` : null;
  if (!userId) return { status: 500, body: { error: 'oauth_user_lookup_failed' } };

  await orgs.ensureOrg?.({ tenantId, name: 'default' });
  await orgMembers.upsertMember({ tenantId, userId, role: 'owner' });

  const authToken = createJwtHs256({ secret: jwtSecret, claims: { tenantId, sub: userId }, ttlSec: 7 * 24 * 3600 });
  await auditEvent({ tenantId, actorUserId: userId, action: 'auth.oauth_login', targetType: 'org', targetId: tenantId, metadata: { provider: 'github' } });
  return { status: 200, body: { ok: true, authToken, tenantId, user: { id: userId, login: user?.login ?? null } } };
});

router.get('/api/v1/integrations/github/repos', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const org = (await orgs.getOrg?.({ tenantId })) ?? null;

  // Prefer GitHub Reader App installation token for production-safe repo discovery.
  // Fallback to a stored user token for dev workflows only.
  try {
    const token = await resolveGitHubReaderToken({ tenantId, org });
    if (token && org?.githubReaderInstallId) {
      const gh = new GitHubClient({ token, apiBaseUrl: githubApiBaseUrl() });
      const list = await gh.listInstallationRepos();
      return { status: 200, body: { repos: list, source: 'reader_app' } };
    }
  } catch {
    // fall through to user-token listing
  }

  const userToken = (await secrets.getSecret({ tenantId, key: 'github.user_token' })) ?? null;
  if (!userToken) return { status: 401, body: { error: 'github_not_connected' } };
  const gh = new GitHubClient({ token: userToken, apiBaseUrl: githubApiBaseUrl() });
  const list = await gh.listUserRepos();
  return { status: 200, body: { repos: list, source: 'user_token' } };
});

router.get('/api/v1/orgs/current', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const org = (await orgs.getOrg?.({ tenantId })) ?? (await orgs.ensureOrg?.({ tenantId, name: 'default' }));
  const plan = await Promise.resolve(entitlements.getPlan(tenantId));
  return {
    status: 200,
    body: {
      id: org?.id ?? tenantId,
      slug: org?.slug ?? null,
      displayName: org?.displayName ?? null,
      plan,
      githubReaderInstallId: org?.githubReaderInstallId ?? null,
      githubDocsInstallId: org?.githubDocsInstallId ?? null,
      docsRepoFullName: org?.docsRepoFullName ?? null
    }
  };
});

router.get('/api/v1/orgs/members', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const members = await orgMembers.listMembers({ tenantId });
  return { status: 200, body: { members } };
});

router.post('/api/v1/orgs/members', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'owner');
  if (forbid) return forbid;
  const userId = req.body?.userId ?? req.body?.user_id;
  const role = req.body?.role ?? 'viewer';
  if (typeof userId !== 'string' || userId.length === 0) return { status: 400, body: { error: 'userId is required' } };
  const member = await orgMembers.upsertMember({ tenantId, userId, role });
  await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'org.member_upsert', targetType: 'member', targetId: userId, metadata: { role: member.role } });
  return { status: 200, body: { member } };
});

router.delete('/api/v1/orgs/members/:userId', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'owner');
  if (forbid) return forbid;
  const userId = req.params.userId;
  const out = await orgMembers.removeMember({ tenantId, userId });
  if (out?.deleted) {
    await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'org.member_remove', targetType: 'member', targetId: userId });
  }
  return { status: 200, body: out };
});

router.get('/api/v1/orgs/invites', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const status = req.query.status ?? null;
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  const invites = await orgInvites.listInvites({ tenantId, status, limit });
  return { status: 200, body: { invites } };
});

router.post('/api/v1/orgs/invites', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const email = req.body?.email ?? null;
  const role = req.body?.role ?? 'viewer';
  const ttlDays = req.body?.ttlDays ?? 7;
  const out = await orgInvites.createInvite({ tenantId, email, role, ttlDays });
  const base = String(process.env.GRAPHFLY_WEB_URL ?? '').trim();
  const acceptPath = `/#/accept?tenantId=${encodeURIComponent(tenantId)}&token=${encodeURIComponent(out.token)}`;
  const acceptUrl = base ? `${base.replace(/\\/$/, '')}${acceptPath}` : acceptPath;
  await auditEvent({
    tenantId,
    actorUserId: req.auth?.userId ?? null,
    action: 'org.invite_create',
    targetType: 'invite',
    targetId: out.invite?.id ?? null,
    metadata: { email: out.invite?.email ?? null, role: out.invite?.role ?? null }
  });
  return { status: 200, body: { invite: out.invite, acceptUrl } };
});

router.delete('/api/v1/orgs/invites/:inviteId', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const inviteId = req.params.inviteId;
  const out = await orgInvites.revokeInvite({ tenantId, inviteId });
  if (out?.revoked) {
    await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'org.invite_revoke', targetType: 'invite', targetId: inviteId });
  }
  return { status: 200, body: out };
});

router.post('/api/v1/orgs/invites/accept', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const userId = req.auth?.userId ?? null;
  if (!userId) return { status: 401, body: { error: 'unauthorized' } };
  const token = req.body?.token ?? null;
  const accepted = await orgInvites.acceptInvite({ tenantId, token, userId });
  if (!accepted.ok) return { status: 400, body: accepted };
  const role = accepted.invite?.role ?? 'viewer';
  const member = await orgMembers.upsertMember({ tenantId, userId, role });
  await auditEvent({
    tenantId,
    actorUserId: userId,
    action: 'org.invite_accept',
    targetType: 'invite',
    targetId: accepted.invite?.id ?? null,
    metadata: { role: member?.role ?? role }
  });
  return { status: 200, body: { ok: true, invite: accepted.invite, member } };
});

router.put('/api/v1/orgs/current', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const docsRepoFullName = req.body?.docsRepoFullName;
  if (docsRepoFullName) {
    const list = await repos.listRepos({ tenantId });
    const collision = (list ?? []).some((r) => String(r?.fullName ?? '') === String(docsRepoFullName));
    if (collision) return { status: 400, body: { error: 'docs_repo_must_be_separate' } };
  }
  const patch = { displayName: req.body?.displayName, docsRepoFullName };
  const org = await orgs.upsertOrg({ tenantId, patch });
  await auditEvent({
    tenantId,
    actorUserId: req.auth?.userId ?? null,
    action: 'org.update',
    targetType: 'org',
    targetId: tenantId,
    metadata: { docsRepoFullName: org?.docsRepoFullName ?? null }
  });
  const plan = await Promise.resolve(entitlements.getPlan(tenantId));
  return {
    status: 200,
    body: {
      id: org?.id ?? tenantId,
      slug: org?.slug ?? null,
      displayName: org?.displayName ?? null,
      plan,
      githubReaderInstallId: org?.githubReaderInstallId ?? null,
      githubDocsInstallId: org?.githubDocsInstallId ?? null,
      docsRepoFullName: org?.docsRepoFullName ?? null
    }
  };
});

router.post('/api/v1/orgs/docs-repo/verify', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const org = await Promise.resolve(orgs.getOrg?.({ tenantId }));
  const docsRepoFullName = req.body?.docsRepoFullName ?? org?.docsRepoFullName ?? null;
  if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) {
    return { status: 400, body: { error: 'docsRepoFullName is required' } };
  }
  const token = await resolveGitHubDocsToken({ tenantId, org });
  if (!token) return { status: 501, body: { error: 'docs_auth_not_configured' } };
  const gh = new GitHubClient({ token, apiBaseUrl: githubApiBaseUrl() });
  try {
    const info = await gh.getRepo({ fullName: docsRepoFullName });
    await auditEvent({
      tenantId,
      actorUserId: req.auth?.userId ?? null,
      action: 'docs_repo.verify',
      targetType: 'repo',
      targetId: docsRepoFullName
    });
    return { status: 200, body: { ok: true, repo: info } };
  } catch (e) {
    return { status: 400, body: { error: 'docs_repo_verify_failed', message: String(e?.message ?? e) } };
  }
});

router.get('/api/v1/repos', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const out = await repos.listRepos({ tenantId });
  return { status: 200, body: { repos: out } };
});

router.post('/api/v1/repos', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const fullName = req.body?.fullName ?? req.body?.full_name;
  const githubRepoId = req.body?.githubRepoId ?? req.body?.github_repo_id ?? null;
  const defaultBranch = req.body?.defaultBranch ?? req.body?.default_branch ?? 'main';
  const repoRoot = req.body?.repoRoot ?? req.body?.repo_root ?? null;
  if (typeof fullName !== 'string' || fullName.length === 0) return { status: 400, body: { error: 'fullName is required' } };

  const prod = String(process.env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod';
  const allowLocal = String(process.env.GRAPHFLY_ALLOW_LOCAL_REPO_ROOT ?? '').trim() === '1';
  if (typeof repoRoot === 'string' && repoRoot.trim().length > 0) {
    if (prod) return { status: 400, body: { error: 'repoRoot_not_allowed_in_prod' } };
    if (!allowLocal) return { status: 400, body: { error: 'local_repo_root_disabled' } };
  }

  const repo = await repos.createRepo({ tenantId, fullName, defaultBranch, githubRepoId });
  await auditEvent({
    tenantId,
    actorUserId: req.auth?.userId ?? null,
    action: 'repo.create',
    targetType: 'repo',
    targetId: repo?.id ?? null,
    metadata: { fullName, githubRepoId }
  });
  // FR-CIG-01: Full index on connection (initial project creation).
  // Production path: use the GitHub Reader App installation token (read-only).
  const org = await Promise.resolve(orgs.getOrg?.({ tenantId }));
  let indexJob = null;
  try {
    if (!prod && allowLocal && typeof repoRoot === 'string' && repoRoot.trim().length > 0) {
      indexJob = await enqueueLocalFullIndexOnRepoCreate({
        tenantId,
        repo,
        org,
        indexQueue,
        repoRoot: repoRoot.trim(),
        docsRepoFullNameFallback: docsRepoFullName,
        docsRepoPath
      });
    } else {
      indexJob = await enqueueInitialFullIndexOnRepoCreate({
        tenantId,
        repo,
        org,
        indexQueue,
        defaultBranch,
        docsRepoFullNameFallback: docsRepoFullName,
        resolveGitHubReaderToken,
        githubApiBaseUrl
      });
    }
    await maybeDrainOnce();
  } catch (e) {
    const code = String(e?.code ?? '');
    if (code === 'docs_repo_not_configured' || code === 'github_reader_app_not_configured') {
      try {
        await repos.deleteRepo({ tenantId, repoId: repo.id });
      } catch {}
      return { status: 400, body: { error: code } };
    }
    if (code.startsWith('local_repo_') || code === 'docs_repo_path_collision') {
      try {
        await repos.deleteRepo({ tenantId, repoId: repo.id });
      } catch {}
      return { status: 400, body: { error: code, ...(e?.metadata ?? null) } };
    }
    if (code === 'github_head_sha_unavailable') {
      try {
        await repos.deleteRepo({ tenantId, repoId: repo.id });
      } catch {}
      return { status: 502, body: { error: code, ...(e?.metadata ?? null) } };
    }
    throw e;
  }

  return { status: 200, body: { repo, indexJob } };
});

router.delete('/api/v1/repos/:repoId', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const repoId = req.params.repoId;
  const out = await repos.deleteRepo({ tenantId, repoId });
  if (out?.deleted) {
    await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'repo.delete', targetType: 'repo', targetId: repoId });
  }
  return { status: 200, body: out };
});

router.get('/api/v1/jobs', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const status = req.query.status ?? null;
  const limit = Number(req.query.limit ?? 50);
  const indexJobs = typeof indexQueue?.listJobs === 'function' ? await indexQueue.listJobs({ tenantId, status, limit }) : [];
  const docJobs = typeof docQueue?.listJobs === 'function' ? await docQueue.listJobs({ tenantId, status, limit }) : [];
  return { status: 200, body: { indexJobs, docJobs } };
});

router.get('/api/v1/jobs/:queue/:jobId', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  const q = req.params.queue;
  const jobId = req.params.jobId;
  const queue = q === 'index' ? indexQueue : q === 'doc' ? docQueue : null;
  if (!queue || typeof queue?.getJob !== 'function') return { status: 404, body: { error: 'not_found' } };
  const job = await queue.getJob({ tenantId, jobId });
  if (!job) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { job } };
});

router.get('/api/v1/audit', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;
  if (!billingPool) return { status: 501, body: { error: 'audit_not_available_without_database' } };
  const limit = Number(req.query.limit ?? 50);
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;
  const rows = await withTenantClient({ pool: billingPool, tenantId }, async (client) => {
    const res = await client.query(
      `SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
       FROM audit_log
       WHERE tenant_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, n]
    );
    return res.rows ?? [];
  });
  return { status: 200, body: { events: rows } };
});

router.get('/api/v1/admin/overview', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'admin');
  if (forbid) return forbid;

  const org = (await orgs.getOrg?.({ tenantId })) ?? (await orgs.ensureOrg?.({ tenantId, name: 'default' }));
  const reposCount = (await repos.listRepos({ tenantId }))?.length ?? 0;
  const secretsInfo = getSecretKeyringInfo({ env: process.env });
  const queueMode = String(process.env.GRAPHFLY_QUEUE_MODE ?? (process.env.DATABASE_URL ? 'pg' : 'memory'));
  const indexerMode = String(process.env.GRAPHFLY_INDEXER_MODE ?? 'auto');
  const hasIndexerCmd = Boolean(String(process.env.GRAPHFLY_INDEXER_CMD ?? '').trim());
  const metricsToken = String(process.env.GRAPHFLY_METRICS_TOKEN ?? '');
  const metricsPublic = String(process.env.GRAPHFLY_METRICS_PUBLIC ?? '') === '1';

  return {
    status: 200,
    body: {
      tenantId,
      org,
      reposCount,
      queue: { mode: queueMode },
      indexer: { mode: indexerMode, configured: hasIndexerCmd },
      secrets: secretsInfo,
      observability: {
        metricsEnabled: true,
        metricsAuth: metricsPublic ? 'public' : metricsToken ? 'token' : 'disabled'
      },
      database: { configured: Boolean(process.env.DATABASE_URL) }
    }
  };
});

router.post('/api/v1/admin/secrets/rewrap', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'owner');
  if (forbid) return forbid;
  if (!billingPool) return { status: 501, body: { error: 'database_required' } };

  const out = await withTenantClient({ pool: billingPool, tenantId }, async (client) => {
    await client.query('BEGIN');
    try {
      const res = await client.query(`SELECT key, ciphertext FROM org_secrets WHERE org_id=$1`, [tenantId]);
      const rows = res.rows ?? [];
      let updated = 0;
      for (const r of rows) {
        const key = String(r.key ?? '');
        const ciphertext = String(r.ciphertext ?? '');
        if (!key || !ciphertext) continue;
        const plaintext = decryptString({ ciphertext, env: process.env });
        const next = encryptString({ plaintext, env: process.env });
        if (next !== ciphertext) {
          await client.query(`UPDATE org_secrets SET ciphertext=$3, updated_at=now() WHERE org_id=$1 AND key=$2`, [tenantId, key, next]);
          updated++;
        }
      }
      await client.query('COMMIT');
      return { ok: true, scanned: rows.length, updated };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });

  await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'secrets.rewrap', targetType: 'org', targetId: tenantId, metadata: { scanned: out.scanned, updated: out.updated } });
  return { status: 200, body: out };
});

async function billingSummaryHandler(req) {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const plan = await Promise.resolve(entitlements.getPlan(tenantId));
  if (!billingPool) return { status: 200, body: { tenantId, plan, status: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: null } };

  const summary = await withTenantClient({ pool: billingPool, tenantId }, async (client) => {
    const billing = new PgBillingStore({ client });
    return billing.getBillingSummary({ tenantId });
  });

  return {
    status: 200,
    body: {
      tenantId,
      plan,
      status: summary.status,
      currentPeriodStart: summary.currentPeriodStart,
      currentPeriodEnd: summary.currentPeriodEnd,
      cancelAtPeriodEnd: summary.cancelAtPeriodEnd
    }
  };
}

router.get('/billing/summary', billingSummaryHandler);
router.get('/api/v1/billing/summary', billingSummaryHandler);

async function billingUsageHandler(req) {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const snapshot = await getBillingUsageSnapshot({ tenantId, entitlementsStore: entitlements, usageCounters: usage });
  return { status: 200, body: snapshot };
}

router.get('/billing/usage', billingUsageHandler);
router.get('/api/v1/billing/usage', billingUsageHandler);

async function billingCheckoutHandler(req) {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'owner');
  if (forbid) return forbid;
  const plan = req.body?.plan ?? 'pro';
  try {
    const out = await createCheckoutUrl({
      tenantId,
      plan,
      orgStore: orgs,
      stripeService: { createStripeClient, createCheckoutSession, createCustomerPortalSession, createCustomer }
    });
    await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'billing.checkout_session', targetType: 'org', targetId: tenantId, metadata: { plan } });
    return { status: 200, body: out };
  } catch (e) {
    if (e?.code === 'stripe_not_configured') {
      return { status: 501, body: { error: 'stripe_not_configured', tenantId, missing: e.missing } };
    }
    throw e;
  }
}

router.post('/billing/checkout', billingCheckoutHandler);
router.post('/api/v1/billing/checkout', billingCheckoutHandler);

async function billingPortalHandler(req) {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, 'owner');
  if (forbid) return forbid;
  try {
    const out = await createPortalUrl({
      tenantId,
      orgStore: orgs,
      stripeService: { createStripeClient, createCheckoutSession, createCustomerPortalSession, createCustomer }
    });
    await auditEvent({ tenantId, actorUserId: req.auth?.userId ?? null, action: 'billing.portal_session', targetType: 'org', targetId: tenantId });
    return { status: 200, body: out };
  } catch (e) {
    if (e?.code === 'stripe_not_configured') {
      return { status: 501, body: { error: 'stripe_not_configured', tenantId, missing: e.missing } };
    }
    throw e;
  }
}

router.post('/billing/portal', billingPortalHandler);
router.post('/api/v1/billing/portal', billingPortalHandler);

router.post('/webhooks/github', async ({ headers, rawBody }) => {
  return handleGitHubWebhook({ headers, rawBody });
});

router.post('/ingest/ndjson', async (req) => {
  const { tenantId = DEFAULT_TENANT_ID, repoId = DEFAULT_REPO_ID, ndjson } = req.body ?? {};
  if (typeof ndjson !== 'string' || ndjson.length === 0) {
    return { status: 400, body: { error: 'ndjson must be a non-empty string' } };
  }
  await ingestNdjson({ tenantId, repoId, ndjsonText: ndjson, store });
  return { status: 200, body: { ok: true } };
});

router.get('/graph/nodes', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const mode = req.query.mode ?? 'default';
  const nodes = (await store.listNodes({ tenantId, repoId })).map((n) => publicNode(n, { mode }));
  return { status: 200, body: { nodes } };
});

router.get('/graph/edges', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { edges: (await store.listEdges({ tenantId, repoId })).map(publicEdge) } };
});

router.get('/graph/neighborhood', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const symbolUid = req.query.symbolUid;
  const direction = req.query.direction ?? 'both';
  const limitEdges = Number(req.query.limitEdges ?? 200);
  const mode = req.query.mode ?? 'default';
  if (typeof symbolUid !== 'string' || symbolUid.length === 0) return { status: 400, body: { error: 'symbolUid is required' } };

  const out = await neighborhood({
    store,
    tenantId,
    repoId,
    symbolUid,
    direction,
    limitEdges: Number.isFinite(limitEdges) ? Math.trunc(limitEdges) : 200
  });
  return {
    status: 200,
    body: {
      nodes: out.nodes.map((n) => publicNode(n, { mode })),
      edges: out.edges.map(publicEdge),
      edgeOccurrenceCounts: out.edgeOccurrenceCounts
    }
  };
});

router.get('/graph/search', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const q = req.query.q ?? '';
  const mode = req.query.mode ?? 'text'; // text|semantic
  const viewMode = req.query.viewMode ?? 'default'; // default|support_safe
  const limit = Number(req.query.limit ?? 10);
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;

  const results =
    mode === 'semantic'
      ? await semanticSearch({ store, tenantId, repoId, query: q, limit: n })
      : await textSearch({ store, tenantId, repoId, query: q, limit: n });

  return {
    status: 200,
    body: formatGraphSearchResponse({ mode, query: q, results, viewMode })
  };
});

router.get('/graph/blast-radius', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const symbolUid = req.query.symbolUid;
  const depth = Number(req.query.depth ?? 1);
  const direction = req.query.direction ?? 'both';
  const mode = req.query.mode ?? 'default';
  if (typeof symbolUid !== 'string' || symbolUid.length === 0) {
    return { status: 400, body: { error: 'symbolUid is required' } };
  }
  const uids = await blastRadius({ store, tenantId, repoId, symbolUid, depth: Number.isFinite(depth) ? Math.trunc(depth) : 1, direction });
  const nodes = (await Promise.all(uids.map((uid) => store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid }))))
    .filter(Boolean)
    .map((n) => publicNode(n, { mode }));
  return { status: 200, body: { symbolUid, depth, direction, nodes } };
});

router.get('/graph/edge-occurrences', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const sourceSymbolUid = req.query.sourceSymbolUid;
  const edgeType = req.query.edgeType;
  const targetSymbolUid = req.query.targetSymbolUid;
  if (![sourceSymbolUid, edgeType, targetSymbolUid].every((v) => typeof v === 'string' && v.length > 0)) {
    return { status: 400, body: { error: 'sourceSymbolUid, edgeType, targetSymbolUid are required' } };
  }
  const occurrences = await store.listEdgeOccurrencesForEdge({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid });
  return { status: 200, body: { occurrences } };
});

router.get('/graph/annotations', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const symbolUid = req.query.symbolUid ?? null;
  const limit = Number(req.query.limit ?? 200);
  if (symbolUid && typeof store.listGraphAnnotationsBySymbolUid === 'function') {
    return { status: 200, body: { annotations: await store.listGraphAnnotationsBySymbolUid({ tenantId, repoId, symbolUid }) } };
  }
  if (typeof store.listGraphAnnotations === 'function') {
    return {
      status: 200,
      body: { annotations: await store.listGraphAnnotations({ tenantId, repoId, limit: Number.isFinite(limit) ? Math.trunc(limit) : 200 }) }
    };
  }
  return { status: 200, body: { annotations: [] } };
});

router.get('/contracts/get', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const symbolUid = req.query.symbolUid;
  if (typeof symbolUid !== 'string' || symbolUid.length === 0) {
    return { status: 400, body: { error: 'symbolUid is required' } };
  }
  const node = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
  if (!node) return { status: 404, body: { error: 'not found' } };
  return {
    status: 200,
    body: {
      symbolUid: node.symbol_uid,
      qualifiedName: node.qualified_name,
      signature: node.signature,
      contract: node.contract ?? null,
      constraints: node.constraints ?? null,
      allowableValues: node.allowable_values ?? null,
      location: { filePath: node.file_path, lineStart: node.line_start, lineEnd: node.line_end }
    }
  };
});

router.get('/flows/entrypoints', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { entrypoints: await store.listFlowEntrypoints({ tenantId, repoId }) } };
});

router.get('/flows/graphs', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { graphs: await store.listFlowGraphs({ tenantId, repoId }) } };
});

router.get('/flows/graph', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const flowGraphKey = req.query.flowGraphKey;
  if (typeof flowGraphKey !== 'string' || flowGraphKey.length === 0) return { status: 400, body: { error: 'flowGraphKey is required' } };
  const graph = await store.getFlowGraph({ tenantId, repoId, flowGraphKey });
  if (!graph) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { graph } };
});

router.get('/flows/trace', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const startSymbolUid = req.query.startSymbolUid;
  const depth = Number(req.query.depth ?? 2);
  const mode = req.query.mode ?? 'default';
  if (typeof startSymbolUid !== 'string' || startSymbolUid.length === 0) {
    return { status: 400, body: { error: 'startSymbolUid is required' } };
  }
  const t = await traceFlow({ store, tenantId, repoId, startSymbolUid, depth: Number.isFinite(depth) ? Math.trunc(depth) : 2 });
  return {
    status: 200,
    body: {
      startSymbolUid,
      depth: t.depth,
      nodes: t.nodes.map((n) => publicNode(n, { mode })),
      edges: t.edges.map(publicEdge)
    }
  };
});

router.get('/coverage/summary', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;

  const nodes = await store.listNodes({ tenantId, repoId });
  const blocks = docStore?.listBlocks ? await docStore.listBlocks({ tenantId, repoId }) : [];

  const documented = new Set();
  if (docStore?.getEvidence) {
    for (const b of blocks) {
      const ev = await docStore.getEvidence({ tenantId, repoId, blockId: b.id ?? b.blockId ?? b.block_id });
      for (const e of ev ?? []) {
        const uid = e?.symbol_uid ?? e?.symbolUid ?? null;
        if (typeof uid === 'string' && uid.length > 0) documented.add(uid);
      }
    }
  }

  const typeBuckets = {
    Function: { total: 0, documented: 0 },
    Class: { total: 0, documented: 0 },
    Module: { total: 0, documented: 0 },
    Package: { total: 0, documented: 0 }
  };

  for (const n of nodes) {
    const t = String(n?.node_type ?? '');
    if (t === 'Function') typeBuckets.Function.total++;
    if (t === 'Class') typeBuckets.Class.total++;
    if (t === 'Package') typeBuckets.Package.total++;
    if (t === 'File' || t === 'Module') typeBuckets.Module.total++;
    if (documented.has(n.symbol_uid)) {
      if (t === 'Function') typeBuckets.Function.documented++;
      if (t === 'Class') typeBuckets.Class.documented++;
      if (t === 'Package') typeBuckets.Package.documented++;
      if (t === 'File' || t === 'Module') typeBuckets.Module.documented++;
    }
  }

  const overallTotal = Object.values(typeBuckets).reduce((acc, x) => acc + x.total, 0);
  const overallDocumented = Object.values(typeBuckets).reduce((acc, x) => acc + x.documented, 0);
  const pct = (d, t) => (t > 0 ? Math.round((d / t) * 1000) / 10 : 0);

  const unresolved = store.listUnresolvedImports ? await store.listUnresolvedImports({ tenantId, repoId, limit: 2000 }) : [];

  return {
    status: 200,
    body: {
      overall: { documented: overallDocumented, total: overallTotal, pct: pct(overallDocumented, overallTotal) },
      byType: Object.fromEntries(
        Object.entries(typeBuckets).map(([k, v]) => [k, { ...v, pct: pct(v.documented, v.total) }])
      ),
      unresolvedImports: { total: Array.isArray(unresolved) ? unresolved.length : 0 }
    }
  };
});

router.get('/coverage/unresolved-imports', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const internal = store.listUnresolvedImports ? await store.listUnresolvedImports({ tenantId, repoId, limit: 2000 }) : [];
  const observed = store.listObservedDependencies ? await store.listObservedDependencies({ tenantId, repoId }) : [];

  const bySpec = new Map();
  for (const u of internal ?? []) {
    const spec = String(u?.spec ?? '');
    if (!spec) continue;
    const prev =
      bySpec.get(spec) ?? { spec, count: 0, category: 'not_found', kind: u?.kind ?? 'internal_unresolved', examples: [] };
    prev.count++;
    if (prev.examples.length < 5) prev.examples.push({ file_path: u.file_path ?? null, line: u.line ?? null, sha: u.sha ?? null });
    bySpec.set(spec, prev);
  }

  // External imports (expected): represented via observed dependencies.
  for (const o of observed ?? []) {
    const k = String(o?.package_key ?? '');
    if (!k) continue;
    const spec = k.includes(':') ? k.split(':', 2)[1] : k;
    const prev = bySpec.get(spec) ?? { spec, count: 0, category: 'external_expected', kind: 'external', examples: [] };
    prev.count++;
    bySpec.set(spec, prev);
  }

  const out = Array.from(bySpec.values()).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return { status: 200, body: { imports: out } };
});

router.get('/coverage/undocumented-entrypoints', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const limit = Number(req.query.limit ?? 50);
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 50;

  const nodes = await store.listNodes({ tenantId, repoId });
  const edges = await store.listEdges({ tenantId, repoId });
  const blocks = docStore?.listBlocks ? await docStore.listBlocks({ tenantId, repoId }) : [];

  const documented = new Set();
  if (docStore?.getEvidence) {
    for (const b of blocks) {
      const ev = await docStore.getEvidence({ tenantId, repoId, blockId: b.id ?? b.blockId ?? b.block_id });
      for (const e of ev ?? []) {
        const uid = e?.symbol_uid ?? e?.symbolUid ?? null;
        if (typeof uid === 'string' && uid.length > 0) documented.add(uid);
      }
    }
  }

  const inboundCalls = new Map();
  for (const e of edges) {
    if (String(e?.edge_type ?? '') !== 'Calls') continue;
    const t = e?.target_symbol_uid ?? null;
    if (!t) continue;
    inboundCalls.set(t, (inboundCalls.get(t) ?? 0) + 1);
  }

  const candidates = nodes
    .filter((x) => x?.visibility === 'public' && !documented.has(x.symbol_uid))
    .filter((x) => ['Function', 'Class', 'ApiEndpoint'].includes(String(x?.node_type ?? '')))
    .map((x) => ({
      symbol_uid: x.symbol_uid,
      qualified_name: x.qualified_name ?? null,
      node_type: x.node_type ?? null,
      file_path: x.file_path ?? null,
      line_start: x.line_start ?? null,
      callers: inboundCalls.get(x.symbol_uid) ?? 0
    }));

  // Entry points: either high fan-in or zero callers (potential public API).
  const entrypoints = candidates.filter((c) => c.callers >= 2 || c.callers === 0);

  // Approximate blast radius using a bounded graph traversal (depth=2).
  const withScores = [];
  for (const c of entrypoints.slice(0, 200)) {
    try {
      const br = await blastRadius({ store, tenantId, repoId, symbolUid: c.symbol_uid, depth: 2, direction: 'both' });
      withScores.push({ ...c, blast_radius: (br?.nodes ?? []).length });
    } catch {
      withScores.push({ ...c, blast_radius: 0 });
    }
  }

  withScores.sort((a, b) => (b.blast_radius ?? 0) - (a.blast_radius ?? 0));
  return { status: 200, body: { entrypoints: withScores.slice(0, n) } };
});

router.post('/coverage/document', async (req) => {
  const tenantId = tenantIdFromCtx(req, DEFAULT_TENANT_ID);
  const forbid = requireRole(req, OrgRoles.MEMBER);
  if (forbid) return forbid;
  const repoId = req.body?.repoId ?? DEFAULT_REPO_ID;
  const symbolUids = Array.isArray(req.body?.symbolUids) ? req.body.symbolUids.filter((s) => typeof s === 'string' && s.length > 0) : [];
  if (symbolUids.length === 0) return { status: 400, body: { error: 'symbolUids is required' } };
  const org = await Promise.resolve(orgs.getOrg?.({ tenantId }));
  const effectiveDocsRepoFullName = org?.docsRepoFullName ?? docsRepoFullName;
  if (!effectiveDocsRepoFullName) return { status: 400, body: { error: 'docs_repo_not_configured' } };
  docQueue.add('doc.generate', { tenantId, repoId, sha: 'manual', changedFiles: [], docsRepoFullName: effectiveDocsRepoFullName, symbolUids });
  await maybeDrainOnce();
  return { status: 200, body: { ok: true, enqueued: symbolUids.length } };
});

router.get('/docs/blocks', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const status = req.query.status ?? null;
  return { status: 200, body: { blocks: await docStore.listBlocks({ tenantId, repoId, status }) } };
});

router.get('/docs/block', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const blockId = req.query.blockId;
  if (typeof blockId !== 'string' || blockId.length === 0) return { status: 400, body: { error: 'blockId is required' } };
  const block = await docStore.getBlock({ tenantId, repoId, blockId });
  if (!block) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { block, evidence: await docStore.getEvidence({ tenantId, repoId, blockId }) } };
});

router.get('/pr-runs', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const status = req.query.status ?? null;
  const limit = Number(req.query.limit ?? 50);
  return { status: 200, body: { runs: await docStore.listPrRuns({ tenantId, repoId, status, limit }) } };
});

router.get('/pr-run', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  const prRunId = req.query.prRunId;
  if (typeof prRunId !== 'string' || prRunId.length === 0) return { status: 400, body: { error: 'prRunId is required' } };
  const prRun = await docStore.getPrRun({ tenantId, repoId, prRunId });
  if (!prRun) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { prRun } };
});

router.get('/deps/mismatches', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { mismatches: await store.listDependencyMismatches({ tenantId, repoId }) } };
});

router.get('/deps/manifests', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { manifests: await store.listDependencyManifests({ tenantId, repoId }) } };
});

router.get('/deps/declared', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { declared: await store.listDeclaredDependencies({ tenantId, repoId }) } };
});

router.get('/deps/observed', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { observed: await store.listObservedDependencies({ tenantId, repoId }) } };
});

router.get('/index/diagnostics', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.query.repoId ?? DEFAULT_REPO_ID;
  return { status: 200, body: { diagnostics: (await store.listIndexDiagnostics?.({ tenantId, repoId })) ?? [] } };
});

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const requestId = String(req.headers['x-request-id'] ?? crypto.randomUUID());
  res.setHeader('x-request-id', requestId);

  try {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/metrics') {
      const token = String(process.env.GRAPHFLY_METRICS_TOKEN ?? '');
      const pub = String(process.env.GRAPHFLY_METRICS_PUBLIC ?? '') === '1';
      const auth = String(req.headers.authorization ?? '');
      const ok = pub || (token && auth.toLowerCase().startsWith('bearer ') && auth.slice('bearer '.length).trim() === token);
      if (!ok) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(metrics.renderPrometheus());
      return;
    }

    const result = await router.handle(req);
    res.statusCode = result.status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(result.body));

    const dur = Date.now() - start;
    metrics.recordHttp({ method: req.method, path: pathname, status: result.status, durationMs: dur });
    log.info('http_request', { requestId, method: req.method, path: pathname, status: result.status, durationMs: dur });
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'internal_error', message: String(error?.message ?? error) }));
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const dur = Date.now() - start;
    metrics.recordHttp({ method: req.method, path: pathname, status: 500, durationMs: dur });
    log.error('http_error', { requestId, method: req.method, path: pathname, status: 500, durationMs: dur, error: String(error?.message ?? error) });
  }
});

server.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (u.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const tenantId = u.searchParams.get('tenantId') ?? DEFAULT_TENANT_ID;
    const repoId = u.searchParams.get('repoId') ?? DEFAULT_REPO_ID;

    const authMode = String(process.env.GRAPHFLY_AUTH_MODE ?? 'none');
    if (authMode === 'jwt') {
      const jwtSecret = process.env.GRAPHFLY_JWT_SECRET ?? '';
      const token = u.searchParams.get('token') ?? '';
      const out = verifyJwtHs256({ secret: jwtSecret, token });
      if (!out.ok) {
        socket.destroy();
        return;
      }
      const claimTenant = out.claims?.tenantId ?? out.claims?.tenant_id ?? null;
      if (claimTenant && String(claimTenant) !== String(tenantId)) {
        socket.destroy();
        return;
      }
    }

    const ok = acceptWebSocketUpgrade({ req, socket, head });
    if (!ok) {
      socket.destroy();
      return;
    }

    let unsub = null;
    const conn = createWsConnection({
      socket,
      onClose: () => {
        try {
          unsub?.();
        } catch {}
      }
    });
    unsub = realtimeHub.subscribe({ tenantId, repoId, onEvent: (evt) => conn.sendJson(evt) });
    conn.sendJson({ type: 'ws:ready', payload: { tenantId, repoId } });
  } catch {
    try {
      socket.destroy();
    } catch {}
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Graphfly API listening on http://127.0.0.1:${port}`);
});
