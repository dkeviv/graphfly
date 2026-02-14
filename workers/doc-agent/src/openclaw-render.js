import { runOpenClawToolLoop } from '../../../packages/openclaw-client/src/openresponses.js';
import { renderContractDocBlock } from './doc-block-render.js';
import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';

function makeLocalDocAgentGateway({ symbolUid, tenantId, repoId, store }) {
  let callCount = 0;

  return async ({ body }) => {
    callCount++;

    if (callCount === 1) {
      return {
        status: 200,
        text: '',
        json: {
          id: 'resp_1',
          output: [
            {
              type: 'function_call',
              name: 'contracts_get',
              call_id: 'call_contracts',
              arguments: JSON.stringify({ symbolUid })
            },
            {
              type: 'function_call',
              name: 'flows_trace',
              call_id: 'call_trace',
              arguments: JSON.stringify({ startSymbolUid: symbolUid, depth: 3 })
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

    const contractPayload = outputsByCallId.get('call_contracts');
    const tracePayload = outputsByCallId.get('call_trace');

    if (!contractPayload) throw new Error('local_openclaw_missing_contract_payload');
    const md =
      renderContractDocBlock(contractPayload).trimEnd() +
      `\n\n### Flow (Derived)\n- Depth: ${tracePayload?.depth ?? 3}\n- Nodes: ${tracePayload?.nodes?.length ?? 0}\n- Edges: ${tracePayload?.edges?.length ?? 0}\n`;

    const v = validateDocBlockMarkdown(md);
    if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

    return {
      status: 200,
      text: '',
      json: {
        id: 'resp_2',
        output_text: md
      }
    };
  };
}

export async function generateFlowDocWithOpenClaw({
  store,
  tenantId,
  repoId,
  symbolUid,
  openclaw = null
}) {
  const node = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
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
      handler: async ({ startSymbolUid, depth = 3 }) => {
        return traceFlow({ store, tenantId, repoId, startSymbolUid, depth });
      }
    }
  ];

  const gatewayUrl = openclaw?.gatewayUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? 'http://local-openclaw.invalid';
  const token = openclaw?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? '';
  const agentId = openclaw?.agentId ?? process.env.OPENCLAW_AGENT_ID ?? 'doc-agent';
  const model = openclaw?.model ?? process.env.OPENCLAW_MODEL ?? 'openclaw';
  const requestJson = openclaw?.requestJson ?? makeLocalDocAgentGateway({ symbolUid, tenantId, repoId, store });

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

  const { outputText } = await runOpenClawToolLoop({
    gatewayUrl,
    token,
    agentId,
    model,
    input,
    instructions,
    user: `graphfly:${tenantId}:${repoId}`,
    tools,
    maxTurns: 10,
    requestJson
  });

  const v = validateDocBlockMarkdown(outputText);
  if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

  // Also return evidence for doc-store updates.
  const trace = await traceFlow({ store, tenantId, repoId, startSymbolUid: symbolUid, depth: 3 });
  return { markdown: outputText.trimEnd() + '\n', trace };
}

