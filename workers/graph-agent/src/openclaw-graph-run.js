import { runOpenClawToolLoop } from '../../../packages/openclaw-client/src/openresponses.js';
import { embedText384 } from '../../../packages/cig/src/embedding.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';

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

  let toolCalls = 0;
  function guardTool(handler) {
    return async (args) => {
      toolCalls++;
      if (toolCalls > maxToolCalls) throw new Error(`graph_agent_tool_budget_exceeded: maxToolCalls=${maxToolCalls}`);
      return handler(args);
    };
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
        const t = await traceFlow({ store, tenantId, repoId, startSymbolUid, depth: d });
        return t;
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
        const embeddingText = typeof content === 'string' && content.length > 0 ? content : JSON.stringify(payload ?? {});
        await Promise.resolve(
          store.upsertGraphAnnotation?.({
            tenantId,
            repoId,
            annotation: {
              symbol_uid: symbolUid,
              annotation_type: annotationType,
              payload,
              content,
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

  const requestJson =
    gatewayUrl && token
      ? undefined
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
    requestJson: requestJson ? async ({ url, method, headers, body }) => requestJson({ body }) : undefined
  });
}
