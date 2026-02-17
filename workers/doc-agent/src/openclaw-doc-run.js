import { runOpenClawToolLoop } from '../../../packages/openclaw-client/src/openresponses.js';
import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';
import { renderContractDocBlock } from './doc-block-render.js';
import { traceFlow } from '../../../packages/cig/src/trace.js';
import { redactSecrets } from '../../../packages/security/src/redact.js';
import { hashString } from '../../../packages/cig/src/types.js';

function slugify(key) {
  return String(key).toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

function safeDocPathFromFilePath(filePath) {
  const raw = String(filePath ?? '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .trim();
  if (!raw) return null;
  const segments = raw.split('/').filter(Boolean);
  const safe = [];
  for (const seg of segments) {
    if (seg === '.' || seg === '..') continue;
    const normalized = seg
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');
    if (!normalized || normalized === '.' || normalized === '..') continue;
    safe.push(normalized);
  }
  return safe.length ? safe.join('/') : null;
}

function docFileForContractNode({ blockType, qualifiedName, symbolUid, filePath }) {
  const slug = slugify(qualifiedName ?? symbolUid ?? 'unknown');
  const fp = safeDocPathFromFilePath(filePath);
  if (fp) return `contracts/${blockType}/${fp}/${slug}.md`;
  return `contracts/${blockType}/${slug}.md`;
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
  if (t === 'schema') return 'schema';
  return 'overview';
}

function safeString(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return redactSecrets(s);
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
        const docFile = docFileForContractNode({ blockType, qualifiedName, symbolUid, filePath: contractPayload?.location?.filePath ?? null });
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
  openclaw = null,
  onEvent = null
}) {
  if (!docStore) throw new Error('docStore is required');
  if (!docsWriter) throw new Error('docsWriter is required');
  if (typeof docsRepoFullName !== 'string' || docsRepoFullName.length === 0) throw new Error('docsRepoFullName is required');

  let prResult = null;
  const stats = { blocksCreated: 0, blocksUpdated: 0, blocksUnchanged: 0, blocksLocked: 0 };
  const triggeringSymbolUids = new Set();
  const changedFilesByPath = new Map(); // docFile -> content

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
      name: 'docs_blocks_list',
      description: 'Lists doc blocks for this repo (for surgical updates and coverage).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { status: { type: ['string', 'null'] } },
        required: []
      },
      handler: async ({ status = null } = {}) => {
        const blocks = await docStore.listBlocks({ tenantId, repoId, status });
        return (Array.isArray(blocks) ? blocks : []).map((b) => ({
          id: b.id ?? null,
          doc_file: b.doc_file ?? b.docFile ?? null,
          block_anchor: b.block_anchor ?? b.blockAnchor ?? null,
          block_type: b.block_type ?? b.blockType ?? null,
          status: b.status ?? null,
          content_hash: b.content_hash ?? b.contentHash ?? null,
          updated_at: b.updated_at ?? b.updatedAt ?? null
        }));
      }
    },
    {
      name: 'docs_block_get',
      description: 'Fetches a doc block content and all evidence links.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blockId: { type: 'string' }
        },
        required: ['blockId']
      },
      handler: async ({ blockId }) => {
        const block = await docStore.getBlock({ tenantId, repoId, blockId });
        const evidence = await docStore.getEvidence({ tenantId, repoId, blockId });
        return { block, evidence };
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
        const docTypes = new Set(['Function', 'Class', 'Package', 'Module', 'File', 'Schema']);
        const filtered = nodes.filter((n) => {
          const t = String(n?.node_type ?? '');
          if (allowTypes && !allowTypes.has(t)) return false;
          if (!docTypes.has(t)) return false;
          // Requirements: document all modules; exported functions/classes are visibility=public.
          // HTTP routes are covered by flow entrypoints (flows/), not contract docs (contracts/).
          if (t === 'Module' || t === 'File' || t === 'Package' || t === 'Schema') return true;
          return n?.visibility === 'public';
        });
        const allowed = symbolUids ? new Set(symbolUids) : null;
        const out = filterPublicNodes(filtered, allowed);
        return out.map((n) => ({
          symbol_uid: n.symbol_uid,
          qualified_name: n.qualified_name ?? null,
          node_type: n.node_type ?? null,
          signature: n.signature ?? null,
          file_path: n.file_path ?? null,
          line_start: n.line_start ?? null,
          line_end: n.line_end ?? null
        }));
      }
    },
    {
      name: 'undocumented_public_nodes_list',
      description: 'Lists public nodes that have no doc block evidence (new-node doc generation).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nodeTypes: { type: 'array', items: { type: 'string' } },
          limit: { type: 'integer', minimum: 1, maximum: 5000 }
        },
        required: []
      },
      handler: async ({ nodeTypes = null, limit = 500 } = {}) => {
        const blocks = await docStore.listBlocks({ tenantId, repoId });
        const documented = new Set();
        for (const b of blocks ?? []) {
          const ev = await docStore.getEvidence({ tenantId, repoId, blockId: b.id ?? b.blockId ?? b.block_id });
          for (const e of ev ?? []) {
            const uid = e?.symbol_uid ?? e?.symbolUid ?? null;
            if (typeof uid === 'string' && uid.length > 0) documented.add(uid);
          }
        }

        const allowTypes = Array.isArray(nodeTypes) && nodeTypes.length > 0 ? new Set(nodeTypes) : null;
        const nodes = await store.listNodes({ tenantId, repoId });
        const docTypes = new Set(['Function', 'Class', 'Package', 'Module', 'File', 'Schema']);
        const filtered = nodes
          .filter((n) => docTypes.has(String(n?.node_type ?? '')))
          .filter((n) => {
            const t = String(n?.node_type ?? '');
            if (t === 'Module' || t === 'File' || t === 'Package' || t === 'Schema') return true;
            return n?.visibility === 'public';
          })
          .filter((n) => (allowTypes ? allowTypes.has(String(n?.node_type ?? '')) : true))
          .filter((n) => !documented.has(n.symbol_uid));

        const n = Number.isFinite(limit) ? Math.max(1, Math.min(5000, Math.trunc(limit))) : 500;
        return filtered.slice(0, n).map((x) => ({
          symbol_uid: x.symbol_uid,
          qualified_name: x.qualified_name ?? null,
          node_type: x.node_type ?? null,
          signature: x.signature ?? null,
          file_path: x.file_path ?? null,
          line_start: x.line_start ?? null,
          line_end: x.line_end ?? null
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
      handler: async ({ startSymbolUid, depth = 3 }) => {
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
        const contentText = String(content ?? '');
        const v = validateDocBlockMarkdown(contentText);
        if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);

        const existing =
          typeof docStore.getBlockByKey === 'function'
            ? await docStore.getBlockByKey({ tenantId, repoId, docFile, blockAnchor })
            : null;
        const status = existing?.status ?? null;
        if (status === 'locked') {
          stats.blocksLocked++;
          return { ok: true, skipped: true, reason: 'locked', docFile, blockAnchor };
        }
        const existingHash = existing?.content_hash ?? existing?.contentHash ?? null;
        const nextHash = hashString(contentText);
        const created = !existing;
        const unchanged = Boolean(existing) && typeof existingHash === 'string' && existingHash.length > 0 && existingHash === nextHash;
        const changed = !unchanged;

        const block = await docStore.upsertBlock({
          tenantId,
          repoId,
          docFile,
          blockAnchor,
          blockType,
          content: contentText,
          status: 'fresh',
          lastIndexSha: triggerSha,
          lastPrId: prRunId
        });
        if (block && docStore.setEvidence) {
          for (const e of Array.isArray(evidence) ? evidence : []) {
            const uid = e?.symbolUid ?? e?.symbol_uid ?? null;
            if (typeof uid === 'string' && uid.length > 0) triggeringSymbolUids.add(uid);
          }
          const defaultEvidenceKind = blockType === 'flow' ? 'flow' : 'contract_location';
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
                  evidenceKind: e?.evidenceKind ?? defaultEvidenceKind
                }))
              : []
          });
        }
        if (created) stats.blocksCreated++;
        else if (unchanged) stats.blocksUnchanged++;
        else stats.blocksUpdated++;

        if (changed) changedFilesByPath.set(docFile, contentText);
        return {
          ok: true,
          blockId: block?.id ?? null,
          docFile,
          blockAnchor,
          blockType,
          created,
          changed,
          unchanged,
          content: changed ? contentText : undefined
        };
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
        const shaRaw = String(triggerSha ?? '').trim();
        const sha8 = shaRaw.replaceAll(/[^a-z0-9]/gi, '').slice(0, 8) || 'manual';
        const effectiveBranchName =
          sha8 === 'manual' ? `docs/update-${sha8}-${Date.now()}` : `docs/update-${sha8}`;
        const effectiveTitle = `docs: update for ${sha8}`;
        const effectiveBody =
          [
            `Triggered by: ${shaRaw || 'manual'}`,
            '',
            `Blocks updated: ${stats.blocksUpdated}`,
            `Blocks created: ${stats.blocksCreated}`,
            `Blocks unchanged: ${stats.blocksUnchanged}`,
            stats.blocksLocked ? `Blocks locked: ${stats.blocksLocked}` : null,
            '',
            'Triggering graph symbols:',
            ...(Array.from(triggeringSymbolUids).slice(0, 200).map((uid) => `- ${uid}`) || [])
          ]
            .filter(Boolean)
            .join('\n') + '\n';

        const effectiveFiles = Array.from(changedFilesByPath.entries()).map(([path, content]) => ({ path, content }));
        if (effectiveFiles.length === 0) {
          prResult = { ok: true, empty: true, targetRepoFullName, title: effectiveTitle, body: effectiveBody, branchName: effectiveBranchName, filesCount: 0 };
          return prResult;
        }

        prResult = await docsWriter.openPullRequest({
          targetRepoFullName,
          title: effectiveTitle,
          body: effectiveBody,
          branchName: effectiveBranchName,
          files: effectiveFiles
        });
        return prResult;
      }
    }
  ];

  const configuredGatewayUrlRaw = openclaw?.gatewayUrl ?? process.env.OPENCLAW_GATEWAY_URL ?? null;
  const configuredGatewayUrl = typeof configuredGatewayUrlRaw === 'string' ? configuredGatewayUrlRaw.trim() : null;
  const gatewayUrl = configuredGatewayUrl ? configuredGatewayUrl : 'http://local-openclaw.invalid';
  const token = openclaw?.token ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? process.env.OPENCLAW_TOKEN ?? '';
  const agentId = openclaw?.agentId ?? process.env.OPENCLAW_AGENT_ID ?? 'doc-agent';
  const model = openclaw?.model ?? process.env.OPENCLAW_MODEL ?? 'openclaw';
  const envRemote = String(process.env.OPENCLAW_USE_REMOTE ?? '').trim().toLowerCase();
  const useRemote =
    typeof openclaw?.useRemote === 'boolean'
      ? openclaw.useRemote
      : envRemote === '0' || envRemote === 'false'
        ? false
        : Boolean(configuredGatewayUrl);
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
    'When updating existing docs, use docs_blocks_list + docs_block_get to understand current content and preserve structure.',
    'When new public nodes exist with no doc evidence, generate new doc blocks (undocumented_public_nodes_list).',
    'The flows_entrypoints_list and public_nodes_list tools already return only the targets for this run.',
    'Only open PRs in the configured docs repo.',
    'Use tools to list entrypoints, fetch contracts/flows, upsert doc blocks, then create a PR.'
  ].join('\n');

  const input = [
    `Create/update documentation for flow entrypoints (flows/) and public contracts (contracts/) for triggerSha=${triggerSha}.`,
    'For each flow entrypoint: fetch contract, trace derived flow, upsert a single doc block for it.',
    'For each public contract node (API endpoints, exported functions/classes): fetch contract and upsert a single doc block for it.',
    'Finally, open a PR in the docs repo with the generated files.'
  ].join('\n');

  function emit(type, payload) {
    if (typeof onEvent !== 'function') return;
    try {
      onEvent(type, payload ?? null);
    } catch {
      // ignore
    }
  }

  function summarizeArgs(args) {
    if (!args || typeof args !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string') out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
      else if (typeof v === 'number' || typeof v === 'boolean' || v == null) out[k] = v;
      else if (Array.isArray(v)) out[k] = `[${v.length}]`;
      else out[k] = '{…}';
    }
    return out;
  }

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
    requestJson,
    onTurn: ({ turn, maxTurns }) => emit('agent:turn', { agent: 'doc', turn, maxTurns }),
    onToolCall: ({ name, callId, args }) => emit('agent:tool_call', { agent: 'doc', name, callId, args: summarizeArgs(args) }),
    onToolResult: ({ name, callId, result }) =>
      emit('agent:tool_result', { agent: 'doc', name, callId, ok: true, resultShape: result && typeof result === 'object' ? Object.keys(result).slice(0, 12) : null })
  });

  if (!prResult) throw new Error('doc_agent_missing_pr_result');
  return {
    pr: prResult,
    stats: {
      ...stats,
      triggeringSymbolUids: Array.from(triggeringSymbolUids),
      filesChanged: changedFilesByPath.size
    }
  };
}
