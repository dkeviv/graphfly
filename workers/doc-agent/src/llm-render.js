import { runOpenRouterToolLoop } from '../../../packages/llm-openrouter/src/tool-loop.js';
import { renderContractDocBlock } from './doc-block-render.js';
import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';
import { redactSecrets } from '../../../packages/security/src/redact.js';

function clampTraceDepth(raw, fallback = 5) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), 10);
}

function safeString(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return redactSecrets(s);
}

function makeLocalDocAgentProvider({ symbolUid, tenantId, repoId, store, traceDepth }) {
  let callCount = 0;

  return async ({ body }) => {
    callCount++;

    if (callCount === 1) {
      return {
        status: 200,
        text: '',
        json: {
          id: 'chatcmpl_local_flowdoc_1',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  { id: 'call_contracts', type: 'function', function: { name: 'contracts_get', arguments: JSON.stringify({ symbolUid }) } },
                  { id: 'call_trace', type: 'function', function: { name: 'flows_trace', arguments: JSON.stringify({ startSymbolUid: symbolUid, depth: traceDepth }) } }
                ]
              }
            }
          ]
        }
      };
    }

    const outputsByCallId = new Map();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (const m of messages) {
      if (m?.role !== 'tool') continue;
      const callId = m?.tool_call_id ?? null;
      if (!callId) continue;
      try {
        outputsByCallId.set(callId, JSON.parse(String(m.content ?? 'null')));
      } catch {
        outputsByCallId.set(callId, null);
      }
    }

    const contractPayload = outputsByCallId.get('call_contracts');
    const tracePayload = outputsByCallId.get('call_trace');

    if (!contractPayload) throw new Error('local_llm_missing_contract_payload');
    const md =
      renderContractDocBlock(contractPayload).trimEnd() +
      `\n\n### Flow (Derived)\n- Depth: ${tracePayload?.depth ?? 3}\n- Nodes: ${tracePayload?.nodes?.length ?? 0}\n- Edges: ${tracePayload?.edges?.length ?? 0}\n`;

    const v = validateDocBlockMarkdown(md);
    if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

    return {
      status: 200,
      text: '',
      json: {
        id: 'chatcmpl_local_flowdoc_2',
        choices: [{ index: 0, message: { role: 'assistant', content: md } }]
      }
    };
  };
}

function isLlmRequired(env = process.env) {
  const mode = String(env.GRAPHFLY_MODE ?? 'dev').toLowerCase();
  if (mode !== 'prod') return false;
  const v = String(env.GRAPHFLY_LLM_REQUIRED ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false');
}

export async function generateFlowDocWithLlm({
  store,
  tenantId,
  repoId,
  symbolUid,
  llmModel = null,
  llm = null
}) {
  const node = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
  if (!node) throw new Error('symbol_not_found');

  const traceDepth = clampTraceDepth(process.env.GRAPHFLY_DOC_AGENT_TRACE_DEPTH, 5);
  if (!node) throw new Error('symbol_not_found');

  const tools = [
    {
      name: 'contracts_get',
      description: 'Fetches Public Contract Graph data for a symbol (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { symbolUid: { type: 'string' } },
        required: ['symbolUid']
      },
      handler: async ({ symbolUid: uid }) => {
        const n = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid: uid });
        if (!n) throw new Error('not_found');
        return {
          symbolUid: n.symbol_uid,
          qualifiedName: n.qualified_name,
          signature: n.signature ?? null,
          parameters: n.parameters ?? null,
          returnType: n.return_type ?? null,
          docstring: safeString(n.docstring ?? null),
          contract: n.contract ?? null,
          constraints: n.constraints ?? null,
          allowableValues: n.allowable_values ?? null,
          location: { filePath: n.file_path, lineStart: n.line_start, lineEnd: n.line_end }
        };
      }
    },
    {
      name: 'flows_trace',
      description: 'Traces a derived flow graph from an entrypoint symbol (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startSymbolUid: { type: 'string' },
          depth: { type: 'integer', minimum: 0, maximum: 10 }
        },
        required: ['startSymbolUid']
      },
      handler: async ({ startSymbolUid, depth = traceDepth }) => {
        const out = await traceFlow({ store, tenantId, repoId, startSymbolUid, depth });
        return {
          startSymbolUid: out.startSymbolUid,
          depth: out.depth,
          nodes: (out.nodes ?? []).map((n) => ({
            symbol_uid: n.symbol_uid,
            qualified_name: n.qualified_name ?? null,
            node_type: n.node_type ?? null,
            visibility: n.visibility ?? null,
            signature: n.signature ?? null,
            contract: n.contract ?? null,
            constraints: n.constraints ?? null,
            allowable_values: n.allowable_values ?? null,
            file_path: n.file_path ?? null,
            line_start: n.line_start ?? null,
            line_end: n.line_end ?? null
          })),
          edges: (out.edges ?? []).map((e) => ({
            source_symbol_uid: e.source_symbol_uid,
            edge_type: e.edge_type,
            target_symbol_uid: e.target_symbol_uid
          }))
        };
      }
    }
  ];

  const apiKeyRaw = llm?.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
  const baseUrl = llm?.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const requestOverride = typeof llm?.requestJson === 'function' ? llm.requestJson : null;
  const apiKey = String(apiKeyRaw ?? '').trim() || (requestOverride ? 'test' : '');
  const model = llm?.model ?? llmModel ?? process.env.GRAPHFLY_LLM_MODEL ?? 'openai/gpt-4o-mini';
  const useRemote = Boolean(requestOverride) || Boolean(String(apiKeyRaw ?? '').trim());
  if (isLlmRequired() && !useRemote) throw new Error('llm_api_key_required');

  const requestJson = requestOverride
    ? requestOverride
    : useRemote
      ? undefined
      : makeLocalDocAgentProvider({ symbolUid, tenantId, repoId, store, traceDepth });

  const instructions = [
    'You are Graphfly Doc Agent.',
    'You must be safe-by-design: never request or output source code bodies/snippets.',
    'Doc blocks must be contract-first and must not contain code fences.',
    'Use tools to fetch contract + derived flow data.'
  ].join('\n');

  const input = [
    'Generate a single Markdown doc block for this symbol.',
    `SymbolUid: ${symbolUid}`,
    'Call contracts_get and flows_trace, then output final Markdown.'
  ].join('\n');

  const { outputText } = await runOpenRouterToolLoop({
    apiKey: useRemote ? apiKey : 'local',
    baseUrl,
    model,
    input,
    instructions,
    user: `graphfly:${tenantId}:${repoId}`,
    tools,
    maxTurns: 10,
    requestJson,
    appTitle: 'Graphfly',
    httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? null
  });

  const v = validateDocBlockMarkdown(outputText);
  if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

  // Also return evidence for doc-store updates.
  const trace = await traceFlow({ store, tenantId, repoId, startSymbolUid: symbolUid, depth: 3 });
  return { markdown: outputText.trimEnd() + '\n', trace };
}
