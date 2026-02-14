import { runOpenClawToolLoop } from '../../../packages/openclaw-client/src/openresponses.js';
import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';
import { renderContractDocBlock } from './doc-block-render.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';

function slugify(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

function filterEntrypoints(entrypoints, allowedKeys) {
  if (!allowedKeys) return entrypoints;
  if (allowedKeys.size === 0) return [];
  return entrypoints.filter((ep) => allowedKeys.has(ep.entrypoint_key));
}

function filterPublicNodes(nodes, allowedSymbolUids) {
  if (!allowedSymbolUids) return nodes;
  return nodes.filter((n) => allowedSymbolUids.has(n.symbol_uid));
}

function blockTypeFromNodeType(nodeType) {
  const t = String(nodeType ?? '').toLowerCase();
  if (t === 'function') return 'function';
  if (t === 'class') return 'class';
  if (t === 'apiendpoint') return 'api_endpoint';
  if (t === 'module' || t === 'file') return 'module';
  if (t === 'package') return 'package';
  return 'overview';
}

function makeLocalDocPrAgentGateway({ tenantId, repoId, store, docsRepoFullName, triggerSha, entrypointKeys, symbolUids }) {
  let callCount = 0;
  let cachedEntrypoints = null;
  let cachedPublicNodes = null;

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
              name: 'flows_entrypoints_list',
              call_id: 'call_entrypoints',
              arguments: JSON.stringify({})
            },
            {
              type: 'function_call',
              name: 'public_nodes_list',
              call_id: 'call_public_nodes',
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

    if (callCount === 2) {
      const entrypoints = outputsByCallId.get('call_entrypoints') ?? [];
      cachedEntrypoints = entrypoints;
      const publicNodes = outputsByCallId.get('call_public_nodes') ?? [];
      cachedPublicNodes = publicNodes;
      const calls = [];
      for (let i = 0; i < entrypoints.length; i++) {
        const ep = entrypoints[i];
        const symbolUid = ep.entrypoint_symbol_uid ?? ep.symbol_uid;
        calls.push({
          type: 'function_call',
          name: 'contracts_get',
          call_id: `call_contracts_flow_${i}`,
          arguments: JSON.stringify({ symbolUid })
        });
        calls.push({
          type: 'function_call',
          name: 'flows_trace',
          call_id: `call_trace_flow_${i}`,
          arguments: JSON.stringify({ startSymbolUid: symbolUid, depth: 3 })
        });
      }

      for (let i = 0; i < publicNodes.length; i++) {
        const n = publicNodes[i];
        const symbolUid = n.symbol_uid ?? n.symbolUid;
        if (!symbolUid) continue;
        calls.push({
          type: 'function_call',
          name: 'contracts_get',
          call_id: `call_contracts_public_${i}`,
          arguments: JSON.stringify({ symbolUid })
        });
      }
      return { status: 200, text: '', json: { id: 'resp_2', output: calls } };
    }

    if (callCount === 3) {
      const entrypoints = cachedEntrypoints ?? (await store.listFlowEntrypoints({ tenantId, repoId }));
      const publicNodes = cachedPublicNodes ?? [];
      const calls = [];
      for (let i = 0; i < entrypoints.length; i++) {
        const ep = entrypoints[i];
        const symbolUid = ep.entrypoint_symbol_uid ?? ep.symbol_uid;
        const contractPayload = outputsByCallId.get(`call_contracts_flow_${i}`);
        const tracePayload = outputsByCallId.get(`call_trace_flow_${i}`);
        if (!contractPayload) throw new Error('local_openclaw_missing_contract_payload');

        const md =
          renderContractDocBlock(contractPayload).trimEnd() +
          `\n\n### Flow (Derived)\n- Depth: ${tracePayload?.depth ?? 3}\n- Nodes: ${tracePayload?.nodes?.length ?? 0}\n- Edges: ${tracePayload?.edges?.length ?? 0}\n`;

        const v = validateDocBlockMarkdown(md);
        if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

        const docFile = `flows/${slugify(ep.entrypoint_key)}.md`;
        const blockAnchor = `## ${contractPayload.qualifiedName ?? symbolUid}`;
        const evidence = Array.isArray(tracePayload?.nodes)
          ? tracePayload.nodes.map((n) => ({
              symbolUid: n.symbol_uid,
              filePath: n.file_path ?? null,
              lineStart: n.line_start ?? null,
              lineEnd: n.line_end ?? null,
              sha: triggerSha,
              evidenceKind: 'flow'
            }))
          : [{ symbolUid, filePath: contractPayload?.location?.filePath ?? null, lineStart: contractPayload?.location?.lineStart ?? null, sha: triggerSha }];

        calls.push({
          type: 'function_call',
          name: 'docs_upsert_block',
          call_id: `call_docs_flow_${i}`,
          arguments: JSON.stringify({ docFile, blockAnchor, blockType: 'flow', content: md, evidence })
        });
      }

      for (let i = 0; i < publicNodes.length; i++) {
        const contractPayload = outputsByCallId.get(`call_contracts_public_${i}`);
        if (!contractPayload) continue;
        const md = renderContractDocBlock(contractPayload);
        const v = validateDocBlockMarkdown(md);
        if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

        const symbolUid = contractPayload.symbolUid;
        const qualifiedName = contractPayload.qualifiedName ?? symbolUid;
        const nodeType = contractPayload.nodeType ?? null;
        const blockType = blockTypeFromNodeType(nodeType);
        const docFile = `contracts/${blockType}/${slugify(qualifiedName)}.md`;
        const blockAnchor = `## ${qualifiedName}`;
        const evidence = [
          {
            symbolUid,
            filePath: contractPayload?.location?.filePath ?? null,
            lineStart: contractPayload?.location?.lineStart ?? null,
            lineEnd: contractPayload?.location?.lineEnd ?? null,
            sha: triggerSha,
            evidenceKind: 'contract_location'
          }
        ];

        calls.push({
          type: 'function_call',
          name: 'docs_upsert_block',
          call_id: `call_docs_public_${i}`,
          arguments: JSON.stringify({ docFile, blockAnchor, blockType, content: md, evidence })
        });
      }

      return { status: 200, text: '', json: { id: 'resp_3', output: calls } };
    }

    if (callCount === 4) {
      const files = [];
      for (const out of outputsByCallId.values()) {
        if (!out?.docFile || !out?.content) continue;
        files.push({ path: out.docFile, content: out.content });
      }

      return {
        status: 200,
        text: '',
        json: {
          id: 'resp_4',
          output: [
            {
              type: 'function_call',
              name: 'github_create_pr',
              call_id: 'call_pr',
              arguments: JSON.stringify({
                targetRepoFullName: docsRepoFullName,
                title: 'Graphfly: update docs',
                body: 'Automated update based on Code Intelligence Graph evidence.',
                branchName: `graphfly/docs/${Date.now()}`,
                files
              })
            }
          ]
        }
      };
    }

    return {
      status: 200,
      text: '',
      json: {
        id: `resp_${callCount}`,
        output_text: 'ok'
      }
    };
  };
}

export async function runDocPrWithOpenClaw({
  store,
  docStore,
  docsWriter,
  tenantId,
  repoId,
  docsRepoFullName,
  triggerSha,
  prRunId = null,
  entrypointKeys = null,
  symbolUids = null,
  openclaw = null
}) {
  if (!docStore) throw new Error('docStore is required');
  if (!docsWriter) throw new Error('docsWriter is required');
  if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) throw new Error('docsRepoFullName is required');

  let prResult = null;

  const tools = [
    {
      name: 'flows_entrypoints_list',
      description: 'Lists flow entrypoints (routes, jobs, CLIs) for this repo.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      handler: async () => {
        const eps = await store.listFlowEntrypoints({ tenantId, repoId });
        const allowed = entrypointKeys ? new Set(entrypointKeys) : null;
        return filterEntrypoints(eps, allowed);
      }
    },
    {
      name: 'public_nodes_list',
      description: 'Lists documentable public contract nodes (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeTypes: { type: 'array', items: { type: 'string' } }
        },
        required: []
      },
      handler: async ({ nodeTypes = null } = {}) => {
        const allowTypes = Array.isArray(nodeTypes) && nodeTypes.length > 0 ? new Set(nodeTypes) : null;
        const nodes = await store.listNodes({ tenantId, repoId });
        const docTypes = new Set(['ApiEndpoint', 'Function', 'Class', 'Package', 'Module', 'File']);
        const filtered = nodes.filter((n) => {
          if (n?.visibility !== 'public') return false;
          const t = String(n?.node_type ?? '');
          if (allowTypes && !allowTypes.has(t)) return false;
          return docTypes.has(t);
        });
        const allowed = symbolUids ? new Set(symbolUids) : null;
        const out = filterPublicNodes(filtered, allowed);
        return out.map((n) => ({
          symbol_uid: n.symbol_uid,
          qualified_name: n.qualified_name ?? null,
          node_type: n.node_type ?? null,
          file_path: n.file_path ?? null,
          line_start: n.line_start ?? null,
          line_end: n.line_end ?? null
        }));
      }
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
      handler: async ({ symbolUid }) => {
        const n = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
        if (!n) throw new Error('not_found');
        return {
          symbolUid: n.symbol_uid,
          qualifiedName: n.qualified_name,
          nodeType: n.node_type ?? null,
          symbolKind: n.symbol_kind ?? null,
          visibility: n.visibility ?? null,
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
    },
    {
      name: 'docs_upsert_block',
      description: 'Upserts a doc block and replaces its evidence links.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          docFile: { type: 'string' },
          blockAnchor: { type: 'string' },
          blockType: { type: 'string' },
          content: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                symbolUid: { type: 'string' },
                filePath: { type: ['string', 'null'] },
                lineStart: { type: ['integer', 'null'] },
                lineEnd: { type: ['integer', 'null'] },
                sha: { type: 'string' }
              },
              required: ['symbolUid']
            }
          }
        },
        required: ['docFile', 'blockAnchor', 'blockType', 'content']
      },
      handler: async ({ docFile, blockAnchor, blockType, content, evidence = [] }) => {
        const v = validateDocBlockMarkdown(content);
        if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);
        const block = await docStore.upsertBlock({
          tenantId,
          repoId,
          docFile,
          blockAnchor,
          blockType,
          content: String(content ?? ''),
          status: 'fresh',
          lastIndexSha: triggerSha,
          lastPrId: prRunId
        });
        if (block && docStore.setEvidence) {
          await docStore.setEvidence({
            tenantId,
            repoId,
            blockId: block.id,
            evidence: Array.isArray(evidence)
              ? evidence.map((e) => ({
                  symbolUid: e?.symbolUid,
                  filePath: e?.filePath ?? null,
                  lineStart: e?.lineStart ?? null,
                  lineEnd: e?.lineEnd ?? null,
                  sha: e?.sha ?? triggerSha,
                  evidenceKind: e?.evidenceKind ?? 'flow'
                }))
              : []
          });
        }
        return { ok: true, blockId: block?.id ?? null, docFile, content: String(content ?? '') };
      }
    },
    {
      name: 'github_create_pr',
      description: 'Opens a PR in the docs repo with a list of markdown files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetRepoFullName: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          branchName: { type: 'string' },
          files: { type: 'array', items: { type: 'object', additionalProperties: true } }
        },
        required: ['targetRepoFullName', 'title', 'branchName', 'files']
      },
      handler: async ({ targetRepoFullName, title, body, branchName, files }) => {
        prResult = await docsWriter.openPullRequest({
          targetRepoFullName,
          title,
          body,
          branchName,
          files: Array.isArray(files) ? files : []
        });
        return prResult;
      }
    }
  ];

  const gatewayUrl = openclaw?.gatewayUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? 'http://local-openclaw.invalid';
  const token = openclaw?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? '';
  const agentId = openclaw?.agentId ?? process.env.OPENCLAW_AGENT_ID ?? 'doc-agent';
  const model = openclaw?.model ?? process.env.OPENCLAW_MODEL ?? 'openclaw';
  const useRemote = Boolean(openclaw?.useRemote ?? (process.env.OPENCLAW_USE_REMOTE === '1' && process.env.OPENCLAW_GATEWAY_URL));
  const requestJson =
    openclaw?.requestJson ??
    (useRemote
      ? undefined
      : makeLocalDocPrAgentGateway({
          tenantId,
          repoId,
          store,
          docsRepoFullName,
          triggerSha,
          entrypointKeys: entrypointKeys ? new Set(entrypointKeys) : null,
          symbolUids: symbolUids ? new Set(symbolUids) : null
        }));

  const instructions = [
    'You are Graphfly Doc Agent.',
    'You must be safe-by-design: never request or output source code bodies/snippets.',
    'Doc blocks must be contract-first and must not contain code fences.',
    'Only open PRs in the configured docs repo.',
    'Use tools to list entrypoints, fetch contracts/flows, upsert doc blocks, then create a PR.'
  ].join('\n');

  const input = [
    'Create/update documentation for flow entrypoints (flows/) and public contracts (contracts/).',
    'For each flow entrypoint: fetch contract, trace derived flow, upsert a single doc block for it.',
    'For each public contract node (API endpoints, exported functions/classes): fetch contract and upsert a single doc block for it.',
    'Finally, open a PR in the docs repo with the generated files.'
  ].join('\n');

  await runOpenClawToolLoop({
    gatewayUrl,
    token,
    agentId,
    model,
    input,
    instructions,
    user: `graphfly:${tenantId}:${repoId}`,
    tools,
    maxTurns: 20,
    requestJson
  });

  if (!prResult) throw new Error('doc_agent_missing_pr_result');
  return { pr: prResult };
}
