import { runOpenRouterToolLoop } from '../../llm-openrouter/src/tool-loop.js';
import { semanticSearch, textSearch } from '../../cig/src/search.js';
import { traceFlow } from '../../cig/src/trace.js';
import { sanitizeNodeForMode, GraphflyMode, normalizeMode } from '../../security/src/safe-mode.js';
import { redactSecrets } from '../../security/src/redact.js';
import { validateDocBlockMarkdown } from '../../doc-blocks/src/validate.js';
import { unifiedDiffText } from './diff.js';
import { sanitizeMarkdownForAssistant, sanitizeAssistantAnswer } from './sanitize.js';

function clampInt(x, { min, max, fallback }) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function truncateString(s, maxLen) {
  const str = String(s ?? '');
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

function sanitizeJsonValue(value, { maxString = 2000 } = {}) {
  if (typeof value === 'string') return truncateString(redactSecrets(value), maxString);
  if (Array.isArray(value)) return value.map((v) => sanitizeJsonValue(v, { maxString }));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeJsonValue(v, { maxString });
    return out;
  }
  return value;
}

function safeDocPath(p) {
  const s = String(p ?? '').replaceAll('\\', '/').replaceAll(/\/+/g, '/');
  if (!s || s.startsWith('/') || s.includes('..')) throw new Error('invalid_doc_path');
  if (!s.endsWith('.md')) throw new Error('doc_path_must_end_with_md');
  if (s.length > 500) throw new Error('doc_path_too_long');
  return s;
}

function citationKey(c) {
  const t = c?.type ?? '';
  if (t === 'symbol') return `symbol:${c.symbolUid ?? ''}`;
  if (t === 'flow') return `flow:${c.entrypointKey ?? ''}`;
  if (t === 'doc_block') return `doc_block:${c.blockId ?? ''}`;
  if (t === 'docs_file') return `docs_file:${c.path ?? ''}:${c.ref ?? ''}`;
  if (t === 'pr_run') return `pr_run:${c.prRunId ?? ''}`;
  return JSON.stringify(c);
}

function uniqCitations(citations) {
  const out = [];
  const seen = new Set();
  for (const c of citations ?? []) {
    const k = citationKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function classifyRetry(err) {
  const msg = String(err?.message ?? err);
  if (msg.includes('assistant_tool_budget_exceeded')) return { retryable: false, reason: 'budget' };
  if (msg.includes('assistant_draft_invalid')) return { retryable: false, reason: 'invalid_draft' };
  if (msg.includes('invalid_tool_arguments')) return { retryable: false, reason: 'tool_args' };
  if (msg.includes('OpenRouter /chat/completions failed')) return { retryable: true, reason: 'provider_http' };
  if (msg.includes('openrouter_api_key_required') || msg.includes('llm_api_key_required')) return { retryable: false, reason: 'missing_key' };
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND')) return { retryable: true, reason: 'network' };
  return { retryable: false, reason: 'unknown' };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatContextMessages(contextMessages, { maxMessages = 16, maxCharsPerMessage = 1200 } = {}) {
  const arr = Array.isArray(contextMessages) ? contextMessages : [];
  const last = arr.slice(-maxMessages);
  const lines = [];
  for (const m of last) {
    const roleRaw = m?.role ?? 'user';
    const role = roleRaw === 'assistant' || roleRaw === 'system' ? roleRaw : 'user';
    const content = truncateString(redactSecrets(String(m?.content ?? '')), maxCharsPerMessage);
    if (!content) continue;
    lines.push(`${role.toUpperCase()}: ${content}`);
  }
  return lines.join('\n');
}

function isLlmRequired(env = process.env) {
  const mode = String(env.GRAPHFLY_MODE ?? 'dev').toLowerCase();
  if (mode !== 'prod') return false;
  const v = String(env.GRAPHFLY_LLM_REQUIRED ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false');
}

export async function runDocsAssistantQuery({
  store,
  docStore,
  docsReader = null,
  tenantId,
  repoId,
  question,
  mode = GraphflyMode.SUPPORT_SAFE,
  llm = null,
  contextMessages = null,
  onEvent = null
} = {}) {
  const q = String(question ?? '').trim();
  if (!q) throw new Error('question is required');
  const viewMode = normalizeMode(mode);
  const citations = [];

  const apiKey = llm?.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
  const model = llm?.model ?? process.env.GRAPHFLY_LLM_MODEL ?? 'openai/gpt-4o-mini';
  const baseUrl = llm?.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const useRemote = Boolean(String(apiKey ?? '').trim());
  if (isLlmRequired() && !useRemote) throw new Error('llm_api_key_required');

  const maxTurns = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_TURNS ?? 12, { min: 2, max: 60, fallback: 12 });
  const maxToolCalls = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_TOOL_CALLS ?? 1500, { min: 10, max: 50_000, fallback: 1500 });
  const maxTraceNodes = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_TRACE_NODES ?? 120, { min: 10, max: 5000, fallback: 120 });
  const maxTraceEdges = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_TRACE_EDGES ?? 200, { min: 10, max: 10_000, fallback: 200 });
  const maxSearch = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_SEARCH_RESULTS ?? 10, { min: 1, max: 50, fallback: 10 });

  let toolCalls = 0;
  function guardTool(handler) {
    return async (args) => {
      toolCalls++;
      if (toolCalls > maxToolCalls) throw new Error(`assistant_tool_budget_exceeded: maxToolCalls=${maxToolCalls}`);
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
    return {
      startSymbolUid,
      depth: t.depth,
      truncated: safeNodes.length > maxTraceNodes || safeEdges.length > maxTraceEdges,
      nodesTotal: safeNodes.length,
      edgesTotal: safeEdges.length,
      nodes: safeNodes.slice(0, maxTraceNodes),
      edges: safeEdges.slice(0, maxTraceEdges)
    };
  }

  const tools = [
    {
      name: 'graph_semantic_search',
      description: 'Semantic search across public contract graph nodes (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['query']
      },
      handler: guardTool(async ({ query, limit = maxSearch }) => {
        const out = await semanticSearch({ store, tenantId, repoId, query, limit: clampInt(limit, { min: 1, max: 50, fallback: maxSearch }) });
        const arr = Array.isArray(out) ? out : [];
        return arr.slice(0, maxSearch).map((x) => {
          const node = x?.node ?? x;
          const safe = sanitizeNodeForMode(node, viewMode);
          citations.push({ type: 'symbol', symbolUid: safe.symbolUid, qualifiedName: safe.qualifiedName, location: safe.location });
          return { score: x?.score ?? null, node: safe };
        });
      })
    },
    {
      name: 'graph_text_search',
      description: 'Text search by qualified name and symbol name (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['query']
      },
      handler: guardTool(async ({ query, limit = maxSearch }) => {
        const out = await textSearch({ store, tenantId, repoId, query, limit: clampInt(limit, { min: 1, max: 50, fallback: maxSearch }) });
        const arr = Array.isArray(out) ? out : [];
        return arr.slice(0, maxSearch).map((x) => {
          const safe = sanitizeNodeForMode(x.node, viewMode);
          citations.push({ type: 'symbol', symbolUid: safe.symbolUid, qualifiedName: safe.qualifiedName, location: safe.location });
          return { score: x?.score ?? null, node: safe };
        });
      })
    },
    {
      name: 'contracts_get',
      description: 'Fetch public contract fields for a symbol (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { symbolUid: { type: 'string' } },
        required: ['symbolUid']
      },
      handler: guardTool(async ({ symbolUid }) => {
        const node = await store.getNodeBySymbolUid({ tenantId, repoId, symbolUid });
        if (!node) throw new Error('not_found');
        const safe = sanitizeNodeForMode(node, viewMode);
        citations.push({ type: 'symbol', symbolUid: safe.symbolUid, qualifiedName: safe.qualifiedName, location: safe.location });
        return {
          symbolUid: safe.symbolUid,
          qualifiedName: safe.qualifiedName,
          signature: safe.signature,
          contract: safe.contract,
          constraints: safe.constraints,
          allowableValues: safe.allowableValues,
          location: safe.location
        };
      })
    },
    {
      name: 'flows_entrypoints_list',
      description: 'Lists flow entrypoints for this repo (routes/jobs/CLIs).',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      handler: guardTool(async () => {
        const eps = await store.listFlowEntrypoints({ tenantId, repoId });
        const out = (Array.isArray(eps) ? eps : []).slice(0, 200).map((ep) => ({
          entrypointKey: ep.entrypoint_key,
          entrypointType: ep.entrypoint_type ?? null,
          method: ep.method ?? null,
          path: ep.path ?? null,
          symbolUid: ep.entrypoint_symbol_uid ?? ep.symbol_uid ?? null,
          filePath: ep.file_path ?? null,
          lineStart: ep.line_start ?? null,
          lineEnd: ep.line_end ?? null
        }));
        for (const ep of out) citations.push({ type: 'flow', entrypointKey: ep.entrypointKey, symbolUid: ep.symbolUid ?? null });
        return out;
      })
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
        citations.push({ type: 'symbol', symbolUid: startSymbolUid });
        return safeTrace({ startSymbolUid, depth: d });
      })
    },
    {
      name: 'docs_blocks_list',
      description: 'Lists doc blocks for this repo (contract-first markdown; no code fences).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { status: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 2000 } },
        required: []
      },
      handler: guardTool(async ({ status = null, limit = 200 } = {}) => {
        if (!docStore?.listBlocks) return [];
        const blocks = await docStore.listBlocks({ tenantId, repoId, status });
        const n = clampInt(limit, { min: 1, max: 2000, fallback: 200 });
        return (Array.isArray(blocks) ? blocks : []).slice(0, n).map((b) => {
          const docFile = b.doc_file ?? b.docFile ?? null;
          const blockAnchor = b.block_anchor ?? b.blockAnchor ?? null;
          citations.push({ type: 'doc_block', blockId: b.id ?? null, docFile, blockAnchor });
          return {
            id: b.id,
            docFile,
            blockAnchor,
            blockType: b.block_type ?? b.blockType ?? null,
            status: b.status ?? null,
            lastIndexSha: b.last_index_sha ?? b.lastIndexSha ?? null,
            updatedAt: b.updated_at ?? b.updatedAt ?? null
          };
        });
      })
    },
    {
      name: 'docs_block_get',
      description: 'Fetches a doc block and its evidence (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { blockId: { type: 'string' } },
        required: ['blockId']
      },
      handler: guardTool(async ({ blockId }) => {
        if (!docStore?.getBlock || !docStore?.getEvidence) throw new Error('doc_store_unavailable');
        const block = await docStore.getBlock({ tenantId, repoId, blockId });
        if (!block) throw new Error('not_found');
        const evidence = await docStore.getEvidence({ tenantId, repoId, blockId });
        const docFile = block.doc_file ?? block.docFile ?? null;
        const blockAnchor = block.block_anchor ?? block.blockAnchor ?? null;
        citations.push({ type: 'doc_block', blockId: block.id ?? blockId, docFile, blockAnchor });
        return {
          block: {
            id: block.id,
            docFile,
            blockAnchor,
            blockType: block.block_type ?? block.blockType ?? null,
            status: block.status ?? null,
            content: sanitizeMarkdownForAssistant(block.content ?? '', { maxChars: 20_000 })
          },
          evidence: (Array.isArray(evidence) ? evidence : []).slice(0, 250).map((e) => ({
            symbolUid: e.symbol_uid ?? e.symbolUid ?? null,
            qualifiedName: e.qualified_name ?? e.qualifiedName ?? null,
            filePath: e.file_path ?? e.filePath ?? null,
            lineStart: e.line_start ?? e.lineStart ?? null,
            lineEnd: e.line_end ?? e.lineEnd ?? null,
            sha: e.sha ?? null
          }))
        };
      })
    },
    {
      name: 'docs_repo_list_dir',
      description: 'List docs repo directory entries (docs repo only).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, ref: { type: 'string' }, maxEntries: { type: 'integer', minimum: 1, maximum: 1000 } },
        required: []
      },
      handler: guardTool(async ({ path = '', ref = null, maxEntries = 200 } = {}) => {
        if (!docsReader?.listDir) return { ok: false, error: 'docs_reader_unavailable', entries: [] };
        const out = await docsReader.listDir({ targetRepoFullName: docsReader._docsRepo ?? null, dirPath: path, ref, maxEntries });
        return sanitizeJsonValue(out, { maxString: 500 });
      })
    },
    {
      name: 'docs_repo_read_file',
      description: 'Read a docs repo Markdown file (sanitized; no code blocks).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, ref: { type: 'string' }, maxChars: { type: 'integer', minimum: 1000, maximum: 100000 } },
        required: ['path']
      },
      handler: guardTool(async ({ path, ref = null, maxChars = 20_000 } = {}) => {
        if (!docsReader?.readFile) return { ok: false, error: 'docs_reader_unavailable', content: null };
        const out = await docsReader.readFile({ targetRepoFullName: docsReader._docsRepo ?? null, filePath: path, ref });
        if (!out?.ok) return out;
        citations.push({ type: 'docs_file', path: out.path ?? path, ref: ref ?? null });
        return { ok: true, path: out.path ?? path, sha: out.sha ?? null, content: sanitizeMarkdownForAssistant(out.content ?? '', { maxChars }) };
      })
    }
  ];

  const instructions = [
    'You are Graphfly Product Documentation Assistant.',
    'You help users understand a system using: Public Contract Graph, Flow Graphs, and docs repo Markdown.',
    'SAFETY RULES:',
    '- Never request, output, or infer source code bodies/snippets.',
    '- Prefer tools; cite evidence via symbol UIDs, flow entrypoints, or docs file paths.',
    '- Keep answers concise and enterprise-grade.',
    `Mode: ${viewMode}.`,
    `Budgets: maxTurns=${maxTurns}, maxToolCalls=${maxToolCalls}.`
  ].join('\n');

  const history = formatContextMessages(contextMessages, { maxMessages: 16, maxCharsPerMessage: 1200 });
  const inputText = history ? `Conversation (most recent last):\n${history}\n\nUser question:\n${q}` : `User question:\n${q}`;

  // Deterministic fallback when no LLM is configured.
  if (!useRemote) {
    const matches = await semanticSearch({ store, tenantId, repoId, query: q, limit: maxSearch });
    const top = (Array.isArray(matches) ? matches : []).slice(0, 5).map((x) => sanitizeNodeForMode((x?.node ?? x), viewMode));
    for (const n of top) citations.push({ type: 'symbol', symbolUid: n.symbolUid, qualifiedName: n.qualifiedName, location: n.location });
    const eps = await store.listFlowEntrypoints({ tenantId, repoId });
    const flows = (Array.isArray(eps) ? eps : []).slice(0, 5).map((ep) => ({
      entrypointKey: ep.entrypoint_key,
      entrypointType: ep.entrypoint_type ?? null,
      method: ep.method ?? null,
      path: ep.path ?? null,
      symbolUid: ep.entrypoint_symbol_uid ?? ep.symbol_uid ?? null
    }));
    for (const f of flows) citations.push({ type: 'flow', entrypointKey: f.entrypointKey, symbolUid: f.symbolUid ?? null });

    const answer =
      `## Answer\n` +
      `Question: ${sanitizeAssistantAnswer(q)}\n\n` +
      `### Top matching contracts\n` +
      (top.length
        ? top
            .map((n) => `- \`${n.qualifiedName ?? n.symbolUid}\` (${n.nodeType}) — ${n.signature ? `\`${sanitizeAssistantAnswer(n.signature, { maxChars: 600 })}\`` : 'signature: —'}`)
            .join('\n')
        : '- (no matches)') +
      `\n\n### Relevant entrypoints\n` +
      (flows.length
        ? flows.map((f) => `- \`${f.entrypointKey}\` ${f.method && f.path ? `(${f.method} ${f.path})` : ''}`).join('\n')
        : '- (none detected)') +
      `\n\n### Evidence\n` +
      uniqCitations(citations)
        .slice(0, 50)
        .map((c) => (c.type === 'symbol' ? `- symbol: \`${c.symbolUid}\`` : c.type === 'flow' ? `- flow: \`${c.entrypointKey}\`` : `- ${c.type}`))
        .join('\n') +
      '\n';
    return { ok: true, answerMarkdown: sanitizeAssistantAnswer(answer), citations: uniqCitations(citations) };
  }

  const maxAttempts = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_ATTEMPTS ?? 3, { min: 1, max: 10, fallback: 3 });
  const baseBackoffMs = clampInt(process.env.GRAPHFLY_ASSISTANT_RETRY_BASE_MS ?? 500, { min: 100, max: 30_000, fallback: 500 });

  let outputText = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onEvent?.('assistant:start', { tenantId, repoId, mode: viewMode, attempt });
      const out = await runOpenRouterToolLoop({
        apiKey,
        baseUrl,
        model,
        input: inputText,
        instructions,
        user: `graphfly:${tenantId}:${repoId}`,
        tools,
        maxTurns,
        appTitle: 'Graphfly',
        httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? null,
        onTurn: ({ turn, maxTurns: mt }) => onEvent?.('assistant:turn', { turn, maxTurns: mt }),
        onToolCall: ({ name }) => onEvent?.('assistant:tool_call', { name }),
        onToolResult: ({ name, result }) => onEvent?.('assistant:tool_result', { name, summary: typeof result === 'string' ? result.slice(0, 200) : null })
      });
      outputText = out.outputText ?? '';
      break;
    } catch (err) {
      const cls = classifyRetry(err);
      onEvent?.('assistant:error', { attempt, reason: cls.reason, error: String(err?.message ?? err) });
      if (!cls.retryable || attempt === maxAttempts) throw err;
      const backoff = Math.min(30_000, baseBackoffMs * 2 ** (attempt - 1));
      await sleep(backoff);
    }
  }

  return { ok: true, answerMarkdown: sanitizeAssistantAnswer(outputText), citations: uniqCitations(citations) };
}

export async function runDocsAssistantDraftDocs({
  store,
  docStore,
  docsReader = null,
  tenantId,
  repoId,
  instruction,
  docsRepoFullName,
  mode = GraphflyMode.SUPPORT_SAFE,
  llm = null,
  onEvent = null
} = {}) {
  const prompt = String(instruction ?? '').trim();
  if (!prompt) throw new Error('instruction is required');
  if (!docsRepoFullName) throw new Error('docsRepoFullName is required');
  const viewMode = normalizeMode(mode);

  const citations = [];
  const filesByPath = new Map();

  const maxTurns = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_TURNS ?? 14, { min: 2, max: 80, fallback: 14 });
  const maxToolCalls = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_TOOL_CALLS ?? 2500, { min: 10, max: 100_000, fallback: 2500 });
  const maxSearch = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_SEARCH_RESULTS ?? 10, { min: 1, max: 50, fallback: 10 });

  let toolCalls = 0;
  function guardTool(handler) {
    return async (args) => {
      toolCalls++;
      if (toolCalls > maxToolCalls) throw new Error(`assistant_tool_budget_exceeded: maxToolCalls=${maxToolCalls}`);
      return handler(args);
    };
  }

  const tools = [
    {
      name: 'graph_semantic_search',
      description: 'Semantic search across public contract graph nodes (no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['query']
      },
      handler: guardTool(async ({ query, limit = maxSearch }) => {
        const out = await semanticSearch({ store, tenantId, repoId, query, limit: clampInt(limit, { min: 1, max: 50, fallback: maxSearch }) });
        const arr = Array.isArray(out) ? out : [];
        return arr.slice(0, maxSearch).map((x) => {
          const node = x?.node ?? x;
          const safe = sanitizeNodeForMode(node, viewMode);
          citations.push({ type: 'symbol', symbolUid: safe.symbolUid, qualifiedName: safe.qualifiedName, location: safe.location });
          return { score: x?.score ?? null, node: safe };
        });
      })
    },
    {
      name: 'docs_repo_read_file',
      description: 'Read a docs repo Markdown file (sanitized; no code blocks).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, ref: { type: 'string' }, maxChars: { type: 'integer', minimum: 1000, maximum: 100000 } },
        required: ['path']
      },
      handler: guardTool(async ({ path, ref = null, maxChars = 20_000 } = {}) => {
        if (!docsReader?.readFile) return { ok: false, error: 'docs_reader_unavailable', content: null };
        const out = await docsReader.readFile({ targetRepoFullName: docsRepoFullName, filePath: path, ref });
        if (!out?.ok) return out;
        citations.push({ type: 'docs_file', path: out.path ?? path, ref: ref ?? null });
        return { ok: true, path: out.path ?? path, sha: out.sha ?? null, content: sanitizeMarkdownForAssistant(out.content ?? '', { maxChars }) };
      })
    },
    {
      name: 'draft_set_file',
      description: 'Set a docs repo file content in the draft (no code fences/snippets).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content']
      },
      handler: guardTool(async ({ path, content }) => {
        const p = safeDocPath(path);
        const text = redactSecrets(String(content ?? ''));
        const v = validateDocBlockMarkdown(text);
        if (!v.ok) throw new Error(`assistant_draft_invalid:${v.reason}`);
        filesByPath.set(p, text);
        return { ok: true, path: p, bytes: text.length };
      })
    },
    {
      name: 'draft_get_diff',
      description: 'Get a unified diff for the current draft vs docs repo base.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      handler: guardTool(async () => {
        const diffs = [];
        for (const [p, after] of filesByPath.entries()) {
          let before = '';
          const read = docsReader?.readFile ? await docsReader.readFile({ targetRepoFullName: docsRepoFullName, filePath: p }) : null;
          if (read?.ok && typeof read.content === 'string') before = read.content;
          diffs.push(unifiedDiffText({ beforeText: before, afterText: after, fileLabel: p }));
        }
        return { ok: true, diff: diffs.filter(Boolean).join('\n\n') };
      })
    }
  ];

  const apiKey = llm?.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';
  const model = llm?.model ?? process.env.GRAPHFLY_LLM_MODEL ?? 'openai/gpt-4o-mini';
  const baseUrl = llm?.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const useRemote = Boolean(String(apiKey ?? '').trim());
  if (isLlmRequired() && !useRemote) throw new Error('llm_api_key_required');

  const instructions = [
    'You are Graphfly Product Documentation Assistant.',
    'Task: draft documentation changes in the docs repo (docs repo only).',
    'SAFETY RULES:',
    '- Never request or output source code bodies/snippets.',
    '- Do not include Markdown code fences or code-like content.',
    '- Use draft_set_file to propose file edits; call draft_get_diff to preview.',
    '- Cite evidence using symbol UIDs and docs file paths.',
    `Mode: ${viewMode}.`,
    `Budgets: maxTurns=${maxTurns}, maxToolCalls=${maxToolCalls}.`
  ].join('\n');

  if (!useRemote) {
    const matches = await semanticSearch({ store, tenantId, repoId, query: prompt, limit: maxSearch });
    const top = (Array.isArray(matches) ? matches : []).slice(0, 5).map((x) => sanitizeNodeForMode((x?.node ?? x), viewMode));
    for (const n of top) citations.push({ type: 'symbol', symbolUid: n.symbolUid, qualifiedName: n.qualifiedName, location: n.location });
    const slug = prompt
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '')
      .slice(0, 60) || 'assistant-note';
    const filePath = `assistant/${slug}.md`;
    const md =
      `## ${truncateString(prompt, 120)}\n\n` +
      `### Scope\n` +
      `- This document is generated from the Public Contract Graph and Flow Graphs.\n` +
      `- It intentionally contains no source code bodies/snippets.\n\n` +
      `### Relevant contracts\n` +
      (top.length
        ? top.map((n) => `- \`${n.qualifiedName ?? n.symbolUid}\`${n.signature ? ` — \`${sanitizeAssistantAnswer(n.signature, { maxChars: 600 })}\`` : ''}`).join('\n')
        : '- (no matches)') +
      `\n\n### Evidence\n` +
      uniqCitations(citations)
        .slice(0, 50)
        .map((c) => (c.type === 'symbol' ? `- symbol: \`${c.symbolUid}\`` : `- ${c.type}`))
        .join('\n') +
      '\n';
    const safe = redactSecrets(md);
    const v = validateDocBlockMarkdown(safe);
    if (!v.ok) throw new Error(`assistant_draft_invalid:${v.reason}`);
    filesByPath.set(filePath, safe);
    const diff = unifiedDiffText({ beforeText: '', afterText: safe, fileLabel: filePath });
    return { ok: true, files: Array.from(filesByPath.entries()).map(([path, content]) => ({ path, content })), diff, citations: uniqCitations(citations), summary: 'Draft created (deterministic fallback).' };
  }

  const maxAttempts = clampInt(process.env.GRAPHFLY_ASSISTANT_MAX_ATTEMPTS ?? 3, { min: 1, max: 10, fallback: 3 });
  const baseBackoffMs = clampInt(process.env.GRAPHFLY_ASSISTANT_RETRY_BASE_MS ?? 500, { min: 100, max: 30_000, fallback: 500 });

  let outputText = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onEvent?.('assistant:start', { tenantId, repoId, mode: viewMode, attempt });
      const out = await runOpenRouterToolLoop({
        apiKey,
        baseUrl,
        model,
        input: `User request:\n${prompt}\n\nDraft docs changes using draft_set_file.`,
        instructions,
        user: `graphfly:${tenantId}:${repoId}`,
        tools,
        maxTurns,
        appTitle: 'Graphfly',
        httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? null,
        onTurn: ({ turn, maxTurns: mt }) => onEvent?.('assistant:turn', { turn, maxTurns: mt }),
        onToolCall: ({ name }) => onEvent?.('assistant:tool_call', { name }),
        onToolResult: ({ name, result }) => onEvent?.('assistant:tool_result', { name, summary: typeof result === 'string' ? result.slice(0, 200) : null })
      });
      outputText = out.outputText ?? '';
      break;
    } catch (err) {
      const cls = classifyRetry(err);
      onEvent?.('assistant:error', { attempt, reason: cls.reason, error: String(err?.message ?? err) });
      if (!cls.retryable || attempt === maxAttempts) throw err;
      const backoff = Math.min(30_000, baseBackoffMs * 2 ** (attempt - 1));
      await sleep(backoff);
    }
  }

  const diffs = [];
  for (const [p, after] of filesByPath.entries()) {
    let before = '';
    const read = docsReader?.readFile ? await docsReader.readFile({ targetRepoFullName: docsRepoFullName, filePath: p }) : null;
    if (read?.ok && typeof read.content === 'string') before = read.content;
    diffs.push(unifiedDiffText({ beforeText: before, afterText: after, fileLabel: p }));
  }
  const diff = diffs.filter(Boolean).join('\n\n');

  return {
    ok: true,
    summary: sanitizeAssistantAnswer(outputText || 'Draft prepared.'),
    files: Array.from(filesByPath.entries()).map(([path, content]) => ({ path, content })),
    diff,
    citations: uniqCitations(citations)
  };
}
