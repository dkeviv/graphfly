import http from 'node:http';
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
import { limitsForPlan } from '../../../packages/entitlements/src/limits.js';
import { StripeEventDedupe } from '../../../packages/stripe-webhooks/src/dedupe.js';
import { makeStripeWebhookHandler } from './stripe-webhook.js';
import { applyStripeEventToEntitlements } from '../../../packages/billing/src/apply-stripe-event.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';
import { neighborhood } from '../../../packages/cig/src/neighborhood.js';
import { InMemoryQueue } from '../../../packages/queue/src/in-memory.js';
import { createIndexerWorker } from '../../../workers/indexer/src/indexer-worker.js';
import { createDocWorker } from '../../../workers/doc-agent/src/doc-worker.js';
import { GitHubDocsWriter } from '../../../packages/github-service/src/docs-writer.js';
import { LocalDocsWriter } from '../../../packages/github-service/src/local-docs-writer.js';
import { createStripeClient, createCheckoutSession, createCustomerPortalSession } from '../../../packages/stripe-service/src/stripe.js';
import { createUsageCountersFromEnv } from '../../../packages/stores/src/usage-counters.js';
import { getPgPoolFromEnv } from '../../../packages/stores/src/pg-pool.js';
import { withTenantClient } from '../../../packages/pg-client/src/tenant.js';
import { PgBillingStore } from '../../../packages/billing-pg/src/pg-billing-store.js';
import { formatGraphSearchResponse } from './search-format.js';
import { getBillingUsageSnapshot } from './billing-usage.js';
import { createOrgStoreFromEnv } from '../../../packages/stores/src/org-store.js';
import { createRepoStoreFromEnv } from '../../../packages/stores/src/repo-store.js';

const DEFAULT_TENANT_ID = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
const DEFAULT_REPO_ID = process.env.REPO_ID ?? '00000000-0000-0000-0000-000000000002';

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
const repos = await createRepoStoreFromEnv();

function tenantIdFromStripeEvent(event) {
  const md = event?.data?.object?.metadata;
  const v = md?.tenantId ?? md?.tenant_id ?? md?.orgId ?? md?.org_id;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function gitCloneAuthFromEnv() {
  const token = process.env.GITHUB_READER_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (!token) return null;
  return { username: 'x-access-token', password: token };
}

// In-memory job plumbing (no external deps). In production this is BullMQ + Redis.
const indexQueue = new InMemoryQueue('index');
const docQueue = new InMemoryQueue('doc');
const docsRepoFullName = process.env.DOCS_REPO_FULL_NAME ?? 'org/docs';
const docsRepoPath = process.env.DOCS_REPO_PATH ?? null;
const docsWriter = docsRepoPath
  ? new LocalDocsWriter({ configuredDocsRepoFullName: docsRepoFullName, docsRepoPath })
  : new GitHubDocsWriter({ configuredDocsRepoFullName: docsRepoFullName });
const indexerWorker = createIndexerWorker({ store, docQueue, docStore });
const docWorker = createDocWorker({ store, docsWriter, docStore, entitlementsStore: entitlements, usageCounters: usage });

async function drainOnce() {
  for (const j of indexQueue.drain()) await indexerWorker.handle(j);
  for (const j of docQueue.drain()) await docWorker.handle({ payload: j.payload });
}

const handleGitHubWebhook = makeGitHubWebhookHandler({
  secret: githubSecret,
  dedupe: githubDedupe,
  onPush: async (push) => {
    let tenantId = DEFAULT_TENANT_ID;
    let repoId = DEFAULT_REPO_ID;
    try {
      const found = await Promise.resolve(repos.findRepoByFullName?.({ fullName: push.fullName }));
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

    const cloneAuth = gitCloneAuthFromEnv();
    const cloneSource = typeof push.cloneUrl === 'string' && push.cloneUrl.length > 0 ? push.cloneUrl : null;

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
    await drainOnce();
  }
});

const router = createJsonRouter();
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

router.get('/api/v1/orgs/current', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
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

router.put('/api/v1/orgs/current', async (req) => {
  const tenantId = req.body?.tenantId ?? DEFAULT_TENANT_ID;
  const patch = {
    displayName: req.body?.displayName,
    docsRepoFullName: req.body?.docsRepoFullName
  };
  const org = await orgs.upsertOrg({ tenantId, patch });
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

router.get('/api/v1/repos', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const out = await repos.listRepos({ tenantId });
  return { status: 200, body: { repos: out } };
});

router.post('/api/v1/repos', async (req) => {
  const tenantId = req.body?.tenantId ?? DEFAULT_TENANT_ID;
  const fullName = req.body?.fullName ?? req.body?.full_name;
  const githubRepoId = req.body?.githubRepoId ?? req.body?.github_repo_id ?? null;
  const defaultBranch = req.body?.defaultBranch ?? req.body?.default_branch ?? 'main';
  if (typeof fullName !== 'string' || fullName.length === 0) return { status: 400, body: { error: 'fullName is required' } };
  const repo = await repos.createRepo({ tenantId, fullName, defaultBranch, githubRepoId });
  return { status: 200, body: { repo } };
});

router.delete('/api/v1/repos/:repoId', async (req) => {
  const tenantId = req.query.tenantId ?? DEFAULT_TENANT_ID;
  const repoId = req.params.repoId;
  const out = await repos.deleteRepo({ tenantId, repoId });
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
  const tenantId = req.body?.tenantId ?? DEFAULT_TENANT_ID;
  const plan = req.body?.plan ?? 'pro';
  // For this repo: org billing persistence is not wired yet; use env for customer + price.
  const apiKey = process.env.STRIPE_SECRET_KEY ?? '';
  const customerId = process.env.STRIPE_CUSTOMER_ID ?? '';
  const priceId =
    plan === 'enterprise' ? process.env.STRIPE_ENTERPRISE_PRICE_ID ?? '' : process.env.STRIPE_PRO_PRICE_ID ?? '';
  const successUrl = process.env.STRIPE_SUCCESS_URL ?? 'http://localhost/success';
  const cancelUrl = process.env.STRIPE_CANCEL_URL ?? 'http://localhost/cancel';

  if (!apiKey || !customerId || !priceId) {
    return { status: 501, body: { error: 'stripe_not_configured', tenantId, missing: { apiKey: !apiKey, customerId: !customerId, priceId: !priceId } } };
  }
  const stripe = await createStripeClient({ apiKey });
  const session = await createCheckoutSession({
    stripe,
    customerId,
    priceId,
    successUrl,
    cancelUrl,
    metadata: { tenantId, plan }
  });
  return { status: 200, body: { url: session.url } };
}

router.post('/billing/checkout', billingCheckoutHandler);
router.post('/api/v1/billing/checkout', billingCheckoutHandler);

async function billingPortalHandler(req) {
  const tenantId = req.body?.tenantId ?? DEFAULT_TENANT_ID;
  const apiKey = process.env.STRIPE_SECRET_KEY ?? '';
  const customerId = process.env.STRIPE_CUSTOMER_ID ?? '';
  const returnUrl = process.env.STRIPE_RETURN_URL ?? 'http://localhost/billing';
  if (!apiKey || !customerId) {
    return { status: 501, body: { error: 'stripe_not_configured', tenantId, missing: { apiKey: !apiKey, customerId: !customerId } } };
  }
  const stripe = await createStripeClient({ apiKey });
  const session = await createCustomerPortalSession({ stripe, customerId, returnUrl });
  return { status: 200, body: { url: session.url } };
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
  try {
    const result = await router.handle(req);
    res.statusCode = result.status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(result.body));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'internal_error', message: String(error?.message ?? error) }));
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`Graphfly API listening on http://127.0.0.1:${port}`);
});
