import http from 'node:http';
import { InMemoryGraphStore } from '../../../packages/cig/src/store.js';
import { ingestNdjson } from '../../../packages/ndjson/src/ingest.js';
import { blastRadius } from '../../../packages/cig/src/query.js';
import { semanticSearch, textSearch } from '../../../packages/cig/src/search.js';
import { createJsonRouter } from './tiny-router.js';
import { DeliveryDedupe } from '../../../packages/github-webhooks/src/dedupe.js';
import { makeGitHubWebhookHandler } from './github-webhook.js';
import { publicNode, publicEdge } from './public-shapes.js';
import { InMemoryEntitlementsStore } from '../../../packages/entitlements/src/store.js';
import { makeRateLimitMiddleware } from './middleware/rate-limit.js';
import { StripeEventDedupe } from '../../../packages/stripe-webhooks/src/dedupe.js';
import { makeStripeWebhookHandler } from './stripe-webhook.js';
import { applyStripeEventToEntitlements } from '../../../packages/billing/src/apply-stripe-event.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';
import { InMemoryDocStore } from '../../../packages/doc-store/src/in-memory.js';

const store = new InMemoryGraphStore();
const docStore = new InMemoryDocStore();
const githubDedupe = new DeliveryDedupe();
const githubSecret = process.env.GITHUB_WEBHOOK_SECRET ?? '';
const entitlements = new InMemoryEntitlementsStore();
const stripeDedupe = new StripeEventDedupe();
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

const handleGitHubWebhook = makeGitHubWebhookHandler({
  secret: githubSecret,
  dedupe: githubDedupe,
  onPush: async () => {
    // TODO: enqueue incremental indexing job (BullMQ) per docs/02_REQUIREMENTS.md FR-CIG-02.
  }
});

const router = createJsonRouter();
router.use(makeRateLimitMiddleware({ entitlementsStore: entitlements }));

const handleStripeWebhook = makeStripeWebhookHandler({
  signingSecret: stripeSecret,
  dedupe: stripeDedupe,
  onEvent: async (event) => {
    // TODO: persist stripe_events + org_billing snapshot per docs/02_REQUIREMENTS.md FR-BL-03 + docs/03_TECHNICAL_SPEC.md.
    applyStripeEventToEntitlements({ event, tenantId: 't-1', entitlementsStore: entitlements });
  }
});

router.post('/webhooks/stripe', async ({ headers, rawBody }) => {
  return handleStripeWebhook({ headers, rawBody });
});

router.post('/webhooks/github', async ({ headers, rawBody }) => {
  return handleGitHubWebhook({ headers, rawBody });
});

router.post('/ingest/ndjson', async (req) => {
  const { tenantId = 't-1', repoId = 'r-1', ndjson } = req.body ?? {};
  if (typeof ndjson !== 'string' || ndjson.length === 0) {
    return { status: 400, body: { error: 'ndjson must be a non-empty string' } };
  }
  await ingestNdjson({ tenantId, repoId, ndjsonText: ndjson, store });
  return { status: 200, body: { ok: true } };
});

router.get('/graph/nodes', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const mode = req.query.mode ?? 'default';
  const nodes = store.listNodes({ tenantId, repoId }).map((n) => publicNode(n, { mode }));
  return { status: 200, body: { nodes } };
});

router.get('/graph/edges', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { edges: store.listEdges({ tenantId, repoId }).map(publicEdge) } };
});

router.get('/graph/search', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const q = req.query.q ?? '';
  const mode = req.query.mode ?? 'text';
  const limit = Number(req.query.limit ?? 10);
  const n = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;

  const results =
    mode === 'semantic'
      ? semanticSearch({ store, tenantId, repoId, query: q, limit: n })
      : textSearch({ store, tenantId, repoId, query: q, limit: n });

  return {
    status: 200,
    body: {
      mode,
      query: q,
      results: results.map((r) => ({
        score: r.score,
        node: {
          symbolUid: r.node.symbol_uid,
          qualifiedName: r.node.qualified_name,
          name: r.node.name,
          nodeType: r.node.node_type,
          filePath: r.node.file_path,
          lineStart: r.node.line_start,
          lineEnd: r.node.line_end
        }
      }))
    }
  };
});

router.get('/graph/blast-radius', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const symbolUid = req.query.symbolUid;
  const depth = Number(req.query.depth ?? 1);
  const direction = req.query.direction ?? 'both';
  const mode = req.query.mode ?? 'default';
  if (typeof symbolUid !== 'string' || symbolUid.length === 0) {
    return { status: 400, body: { error: 'symbolUid is required' } };
  }
  const uids = blastRadius({ store, tenantId, repoId, symbolUid, depth: Number.isFinite(depth) ? Math.trunc(depth) : 1, direction });
  const nodes = uids
    .map((uid) => store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid }))
    .filter(Boolean)
    .map((n) => publicNode(n, { mode }));
  return { status: 200, body: { symbolUid, depth, direction, nodes } };
});

router.get('/graph/edge-occurrences', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const sourceSymbolUid = req.query.sourceSymbolUid;
  const edgeType = req.query.edgeType;
  const targetSymbolUid = req.query.targetSymbolUid;
  if (![sourceSymbolUid, edgeType, targetSymbolUid].every((v) => typeof v === 'string' && v.length > 0)) {
    return { status: 400, body: { error: 'sourceSymbolUid, edgeType, targetSymbolUid are required' } };
  }
  const occurrences = store.listEdgeOccurrencesForEdge({ tenantId, repoId, sourceSymbolUid, edgeType, targetSymbolUid });
  return { status: 200, body: { occurrences } };
});

router.get('/contracts/get', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const symbolUid = req.query.symbolUid;
  if (typeof symbolUid !== 'string' || symbolUid.length === 0) {
    return { status: 400, body: { error: 'symbolUid is required' } };
  }
  const node = store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
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
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { entrypoints: store.listFlowEntrypoints({ tenantId, repoId }) } };
});

router.get('/flows/trace', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const startSymbolUid = req.query.startSymbolUid;
  const depth = Number(req.query.depth ?? 2);
  const mode = req.query.mode ?? 'default';
  if (typeof startSymbolUid !== 'string' || startSymbolUid.length === 0) {
    return { status: 400, body: { error: 'startSymbolUid is required' } };
  }
  const t = traceFlow({ store, tenantId, repoId, startSymbolUid, depth: Number.isFinite(depth) ? Math.trunc(depth) : 2 });
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
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const status = req.query.status ?? null;
  return { status: 200, body: { blocks: docStore.listBlocks({ tenantId, repoId, status }) } };
});

router.get('/docs/block', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  const blockId = req.query.blockId;
  if (typeof blockId !== 'string' || blockId.length === 0) return { status: 400, body: { error: 'blockId is required' } };
  const block = docStore.getBlock({ tenantId, repoId, blockId });
  if (!block) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { block, evidence: docStore.getEvidence({ tenantId, repoId, blockId }) } };
});

router.get('/deps/mismatches', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { mismatches: store.listDependencyMismatches({ tenantId, repoId }) } };
});

router.get('/deps/manifests', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { manifests: store.listDependencyManifests({ tenantId, repoId }) } };
});

router.get('/deps/declared', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { declared: store.listDeclaredDependencies({ tenantId, repoId }) } };
});

router.get('/deps/observed', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { observed: store.listObservedDependencies({ tenantId, repoId }) } };
});

router.get('/index/diagnostics', async (req) => {
  const tenantId = req.query.tenantId ?? 't-1';
  const repoId = req.query.repoId ?? 'r-1';
  return { status: 200, body: { diagnostics: store.listIndexDiagnostics({ tenantId, repoId }) } };
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
