import { runOpenClawToolLoop } from '../../../packages/openclaw-client/src/openresponses.js';
import { embedText384 } from '../../../packages/cig/src/embedding.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';
import { sanitizeNodeForMode, GraphflyMode } from '../../../packages/security/src/safe-mode.js';
import http from 'node:http';
import https from 'node:https';

function truncateString(s, maxLen) {
  const str = String(s ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

function looksLikeCodeBody(s) {
  const str = String(s ?? '');
  if (str.includes('```')) return true;
  if (str.length < 240) return false;
  const newlines = (str.match(/\n/g) ?? []).length;
  const braces = (str.match(/[{}]/g) ?? []).length;
  const semis = (str.match(/;/g) ?? []).length;
  return newlines >= 3 && braces >= 2 && semis >= 2;
}

function sanitizeJsonValue(value, { maxString = 2000 } = {}) {
  if (typeof value === 'string') {
    if (looksLikeCodeBody(value)) return '[REDACTED_CODE_LIKE]';
    return truncateString(value, maxString);
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeJsonValue(v, { maxString }));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeJsonValue(v, { maxString });
    return out;
  }
  return value;
}

function clampInt(x, { min, max, fallback }) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  return Math.max(min, Math.min(max, v));
}

function validateAnnotationContent(content) {
  const s = String(content ?? '');
  if (s.includes('```')) return { ok: false, reason: 'code_fence_not_allowed' };
  return { ok: true };
}

function summarizeFlowDeterministic({ entrypoint, contract, trace }) {
  const epKey = entrypoint.entrypoint_key;
  const nodes = Array.isArray(trace?.nodes) ? trace.nodes : [];
  const edges = Array.isArray(trace?.edges) ? trace.edges : [];
  const packages = new Set();
  for (const e of edges) {
    if (e.edge_type === 'UsesPackage') packages.add(e.target_symbol_uid);
  }
  const content =
    `## Flow Summary\n` +
    `- Entrypoint: ${epKey}\n` +
    `- Depth: ${trace?.depth ?? 0}\n` +
    `- Nodes: ${nodes.length}\n` +
    `- Edges: ${edges.length}\n` +
    (packages.size ? `- External packages used: ${packages.size}\n` : '');

  const payload = {
    entrypoint_key: epKey,
    entrypoint_type: entrypoint.entrypoint_type,
    method: entrypoint.method ?? null,
    path: entrypoint.path ?? null,
    start_symbol_uid: entrypoint.entrypoint_symbol_uid ?? entrypoint.symbol_uid ?? null,
    depth: trace?.depth ?? null,
    nodes_count: nodes.length,
    edges_count: edges.length,
    uses_packages: Array.from(packages).slice(0, 200)
  };

  return { content: content.trimEnd(), payload };
}

function makeLocalGraphAgentGateway({ tenantId, repoId, store, triggerSha, maxEntrypoints, maxDepth }) {
  let turn = 0;
  let cachedEntrypoints = null;
  const cachedContracts = new Map();
  const cachedTraces = new Map();

  return async ({ body }) => {
    turn++;

    if (turn === 1) {
      return {
        status: 200,
        text: '',
        json: {
          id: 'resp_1',
          output: [
            {
              type: 'function_call',
              name: 'flows_entrypoints_list',
              call_id: 'call_entrypoints',
              arguments: JSON.stringify({})
            }
          ]
        }
      };
    }

    const inputs = Array.isArray(body?.input) ? body.input : [];
    const outputsByCallId = new Map();
    for (const item of inputs) {
      if (item?.type !== 'function_call_output') continue;
      try {
        outputsByCallId.set(item.call_id, JSON.parse(item.output));
      } catch {
        outputsByCallId.set(item.call_id, null);
      }
    }

    if (turn === 2) {
      const entrypoints = outputsByCallId.get('call_entrypoints') ?? [];
      cachedEntrypoints = entrypoints.slice(0, maxEntrypoints);

      const calls = [];
      for (let i = 0; i < cachedEntrypoints.length; i++) {
        const ep = cachedEntrypoints[i];
        const symbolUid = ep.entrypoint_symbol_uid ?? ep.symbol_uid;
        calls.push({
          type: 'function_call',
          name: 'contracts_get',
          call_id: `call_contract_${i}`,
          arguments: JSON.stringify({ symbolUid })
        });
        calls.push({
          type: 'function_call',
          name: 'flows_trace',
          call_id: `call_trace_${i}`,
          arguments: JSON.stringify({ startSymbolUid: symbolUid, depth: maxDepth })
        });
      }
      return { status: 200, text: '', json: { id: 'resp_2', output: calls } };
    }

    if (turn === 3) {
      const eps = cachedEntrypoints ?? [];
      for (let i = 0; i < eps.length; i++) {
        const c = outputsByCallId.get(`call_contract_${i}`);
        const t = outputsByCallId.get(`call_trace_${i}`);
        if (c) cachedContracts.set(i, c);
        if (t) cachedTraces.set(i, t);
      }

      const calls = [];
      for (let i = 0; i < eps.length; i++) {
        const ep = eps[i];
        const symbolUid = ep.entrypoint_symbol_uid ?? ep.symbol_uid;
        const contract = cachedContracts.get(i) ?? null;
        const trace = cachedTraces.get(i) ?? null;
        const { content, payload } = summarizeFlowDeterministic({ entrypoint: ep, contract, trace });
        const v = validateAnnotationContent(content);
        if (!v.ok) throw new Error(`graph_annotation_invalid:${v.reason}`);
        calls.push({
          type: 'function_call',
          name: 'graph_annotations_upsert',
          call_id: `call_upsert_${i}`,
          arguments: JSON.stringify({
            symbolUid,
            annotationType: 'flow_summary',
            payload,
            content,
            sha: triggerSha
          })
        });
      }
      return { status: 200, text: '', json: { id: 'resp_3', output: calls } };
    }

    return { status: 200, text: '', json: { id: `resp_${turn}`, output_text: 'ok' } };
  };
}

export async function runGraphEnrichmentWithOpenClaw({
  store,
  tenantId,
  repoId,
  triggerSha,
  openclaw = null
}) {
  if (!store) throw new Error('store is required');
  const maxTurns = clampInt(process.env.GRAPHFLY_GRAPH_AGENT_MAX_TURNS ?? 12, { min: 2, max: 50, fallback: 12 });
  const maxEntrypoints = clampInt(process.env.GRAPHFLY_GRAPH_AGENT_MAX_ENTRYPOINTS ?? 25, { min: 1, max: 200, fallback: 25 });
  const maxDepth = clampInt(process.env.GRAPHFLY_GRAPH_AGENT_MAX_DEPTH ?? 4, { min: 1, max: 10, fallback: 4 });
  const maxToolCalls = clampInt(process.env.GRAPHFLY_GRAPH_AGENT_MAX_TOOL_CALLS ?? 300, { min: 10, max: 5000, fallback: 300 });
  const maxTraceNodes = clampInt(process.env.GRAPHFLY_GRAPH_AGENT_MAX_TRACE_NODES ?? 200, { min: 10, max: 5000, fallback: 200 });
  const maxTraceEdges = clampInt(process.env.GRAPHFLY_GRAPH_AGENT_MAX_TRACE_EDGES ?? 300, { min: 10, max: 10_000, fallback: 300 });

  let toolCalls = 0;
  function guardTool(handler) {
    return async (args) => {
      toolCalls++;
      if (toolCalls > maxToolCalls) throw new Error(`graph_agent_tool_budget_exceeded: maxToolCalls=${maxToolCalls}`);
      return handler(args);
    };
  }

  async function safeTrace({ startSymbolUid, depth }) {
    const t = await traceFlow({ store, tenantId, repoId, startSymbolUid, depth });
    const nodes = Array.isArray(t.nodes) ? t.nodes : [];
    const edges = Array.isArray(t.edges) ? t.edges : [];

    const safeNodes = nodes.map((n) => sanitizeNodeForMode(n, GraphflyMode.SUPPORT_SAFE));
    const safeEdges = edges.map((e) => ({
      sourceSymbolUid: e.source_symbol_uid,
      targetSymbolUid: e.target_symbol_uid,
      edgeType: e.edge_type,
      metadata: e.metadata ? sanitizeJsonValue(e.metadata, { maxString: 500 }) : null
    }));

    const truncated = safeNodes.length > maxTraceNodes || safeEdges.length > maxTraceEdges;
    return sanitizeJsonValue(
      {
        startSymbolUid,
        depth: t.depth,
        truncated,
        nodesTotal: safeNodes.length,
        edgesTotal: safeEdges.length,
        nodes: safeNodes.slice(0, maxTraceNodes),
        edges: safeEdges.slice(0, maxTraceEdges)
      },
      { maxString: 2000 }
    );
  }

  function makeRetryingRequestJson(baseRequestJson, { maxAttempts = 4, baseMs = 300, maxMs = 10_000 } = {}) {
    return async (args) => {
      let last = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await baseRequestJson(args);
          last = res;
          const status = res?.status ?? 0;
          if (status === 429 || (status >= 500 && status < 600)) {
            if (attempt === maxAttempts) return res;
            const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return res;
        } catch (e) {
          last = { status: 0, json: null, text: String(e?.message ?? e) };
          if (attempt === maxAttempts) throw e;
          const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
      return last;
    };
  }

  function httpRequestJson({ url, method, headers, body }) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          method,
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          headers
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              // ignore
            }
            resolve({ status: res.statusCode ?? 0, json, text });
          });
        }
      );
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }

  const tools = [
    {
      name: 'flows_entrypoints_list',
      description: 'Lists flow entrypoints (routes, jobs, CLIs) for this repo.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      handler: guardTool(async () => store.listFlowEntrypoints({ tenantId, repoId }))
    },
    {
      name: 'flows_trace',
      description: 'Trace a flow starting at a symbol uid (contract-first; no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startSymbolUid: { type: 'string' },
          depth: { type: 'integer', minimum: 0, maximum: 10 }
        },
        required: ['startSymbolUid']
      },
      handler: guardTool(async ({ startSymbolUid, depth = 3 }) => {
        const d = clampInt(depth, { min: 0, max: 10, fallback: 3 });
        return safeTrace({ startSymbolUid, depth: d });
      })
    },
    {
      name: 'contracts_get',
      description: 'Fetches Public Contract Graph data for a symbol (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { symbolUid: { type: 'string' } },
        required: ['symbolUid']
      },
      handler: guardTool(async ({ symbolUid }) => {
        const node = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
        if (!node) throw new Error('not_found');
        return {
          symbolUid: node.symbol_uid,
          qualifiedName: node.qualified_name,
          signature: node.signature,
          contract: node.contract ?? null,
          constraints: node.constraints ?? null,
          allowableValues: node.allowable_values ?? null,
          location: { filePath: node.file_path, lineStart: node.line_start, lineEnd: node.line_end }
        };
      })
    },
    {
      name: 'graph_annotations_upsert',
      description: 'Upserts a graph annotation (enrichment) for a symbol. No code bodies/snippets.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbolUid: { type: 'string' },
          annotationType: { type: 'string' },
          payload: { type: 'object' },
          content: { type: 'string' },
          sha: { type: 'string' }
        },
        required: ['symbolUid', 'annotationType', 'sha']
      },
      handler: guardTool(async ({ symbolUid, annotationType, payload = null, content = null, sha }) => {
        const v = validateAnnotationContent(content ?? '');
        if (!v.ok) throw new Error(`graph_annotation_invalid:${v.reason}`);
        const safePayload = payload ? sanitizeJsonValue(payload, { maxString: 2000 }) : null;
        const safeContent = content ? sanitizeJsonValue(content, { maxString: 4000 }) : null;
        const embeddingText = typeof safeContent === 'string' && safeContent.length > 0 ? safeContent : JSON.stringify(safePayload ?? {});
        await Promise.resolve(
          store.upsertGraphAnnotation?.({
            tenantId,
            repoId,
            annotation: {
              symbol_uid: symbolUid,
              annotation_type: annotationType,
              payload: safePayload,
              content: safeContent,
              embedding_text: embeddingText,
              embedding: embedText384(embeddingText),
              first_seen_sha: sha,
              last_seen_sha: sha
            }
          })
        );
        return { ok: true, symbolUid, annotationType };
      })
    }
  ];

  const gatewayUrl = openclaw?.gatewayUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? '';
  const token = openclaw?.token ?? process.env.OPENCLAW_TOKEN ?? '';
  const model = openclaw?.model ?? process.env.OPENCLAW_MODEL ?? 'openclaw';
  const openclawReqRaw = String(process.env.GRAPHFLY_OPENCLAW_REQUIRED ?? '1').trim().toLowerCase();
  const openclawRequired = String(process.env.GRAPHFLY_MODE ?? 'dev').toLowerCase() === 'prod' && !(openclawReqRaw === '0' || openclawReqRaw === 'false');
  if (openclawRequired && (!gatewayUrl || !token)) throw new Error('openclaw_remote_required');

  const requestJson = gatewayUrl && token
    ? makeRetryingRequestJson(httpRequestJson, {
        maxAttempts: clampInt(process.env.GRAPHFLY_GRAPH_AGENT_HTTP_MAX_ATTEMPTS ?? 4, { min: 1, max: 10, fallback: 4 }),
        baseMs: clampInt(process.env.GRAPHFLY_GRAPH_AGENT_HTTP_RETRY_BASE_MS ?? 300, { min: 50, max: 5000, fallback: 300 }),
        maxMs: clampInt(process.env.GRAPHFLY_GRAPH_AGENT_HTTP_RETRY_MAX_MS ?? 10_000, { min: 500, max: 60_000, fallback: 10_000 })
      })
    : makeLocalGraphAgentGateway({
        tenantId,
        repoId,
        store,
        triggerSha,
        maxEntrypoints,
        maxDepth
      });

  const instructions =
    'You are Graphfly Graph Agent. Build evidence-backed enrichment annotations from the Code Intelligence Graph.\n' +
    '- Never request or output source code bodies/snippets.\n' +
    '- Prefer tool calls; keep output concise.\n' +
    `- Budget: maxEntrypoints=${maxEntrypoints}, maxDepth=${maxDepth}, maxTurns=${maxTurns}.\n` +
    'Goal: For each flow entrypoint, produce a flow_summary annotation with key facts and counts grounded in flows_trace + contracts_get.\n';

  await runOpenClawToolLoop({
    gatewayUrl: gatewayUrl || 'http://local',
    token: token || null,
    model,
    input: 'Generate graph annotations for this repo.',
    instructions,
    user: { tenantId, repoId },
    tools,
    maxTurns,
    requestJson: async ({ url, method, headers, body }) => (!gatewayUrl || !token ? requestJson({ body }) : requestJson({ url, method, headers, body }))
  });
}
