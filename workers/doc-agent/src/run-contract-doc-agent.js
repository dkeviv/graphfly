import { runOpenRouterToolLoop } from '../../../packages/llm-openrouter/src/tool-loop.js';
import http from 'node:http';
import https from 'node:https';
import { renderContractDocBlock } from './doc-block-render.js';
import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';

// Minimal “contract doc agent” runner:
// - Uses OpenRouter (chat-completions tool loop) as the agent runtime
// - Uses client-side tools to fetch Public Contract Graph data from Graphfly API
// - Produces a contract-first markdown snippet (no code bodies/snippets)

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      { method: 'GET', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function makeGraphflyTools({ apiUrl, tenantId, repoId }) {
  return [
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
        const { status, json } = await httpGetJson(
          new URL(`/contracts/get?tenantId=${encodeURIComponent(tenantId)}&repoId=${encodeURIComponent(repoId)}&symbolUid=${encodeURIComponent(symbolUid)}`, apiUrl).toString()
        );
        if (status !== 200) throw new Error(`contracts_get failed: HTTP ${status}`);
        return json;
      }
    },
    {
      name: 'graph_blast_radius',
      description: 'Returns impacted nodes (blast radius) for a symbol in the Code Intelligence Graph.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbolUid: { type: 'string' },
          depth: { type: 'integer', minimum: 0, maximum: 5 },
          direction: { type: 'string', enum: ['in', 'out', 'both'] }
        },
        required: ['symbolUid']
      },
      handler: async ({ symbolUid, depth = 1, direction = 'both' }) => {
        const { status, json } = await httpGetJson(
          new URL(
            `/graph/blast-radius?tenantId=${encodeURIComponent(tenantId)}&repoId=${encodeURIComponent(repoId)}&symbolUid=${encodeURIComponent(symbolUid)}&depth=${encodeURIComponent(String(depth))}&direction=${encodeURIComponent(direction)}`,
            apiUrl
          ).toString()
        );
        if (status !== 200) throw new Error(`graph_blast_radius failed: HTTP ${status}`);
        return json;
      }
    },
    {
      name: 'graph_semantic_search',
      description: 'Semantic search over Code Intelligence Graph nodes (contract-first, no code bodies).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['query']
      },
      handler: async ({ query, limit = 10 }) => {
        const { status, json } = await httpGetJson(
          new URL(
            `/graph/search?tenantId=${encodeURIComponent(tenantId)}&repoId=${encodeURIComponent(repoId)}&q=${encodeURIComponent(query)}&mode=semantic&limit=${encodeURIComponent(String(limit))}`,
            apiUrl
          ).toString()
        );
        if (status !== 200) throw new Error(`graph_semantic_search failed: HTTP ${status}`);
        return json;
      }
    }
  ];
}

const apiUrl = process.env.GRAPHFLY_API_URL ?? 'http://127.0.0.1:8787';
const tenantId = process.env.TENANT_ID ?? 't-1';
const repoId = process.env.REPO_ID ?? 'r-1';

const symbolUid = process.argv[2];
if (!symbolUid) {
  // eslint-disable-next-line no-console
  console.error('Usage: node workers/doc-agent/src/run-contract-doc-agent.js <symbolUid>');
  process.exit(1);
}

const tools = makeGraphflyTools({ apiUrl, tenantId, repoId });

const offline = process.env.OFFLINE_RENDER === '1';
if (offline) {
  const contractsTool = tools.find((t) => t.name === 'contracts_get');
  const payload = await contractsTool.handler({ symbolUid });
  const md = renderContractDocBlock(payload);
  const v = validateDocBlockMarkdown(md);
  if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);
  // eslint-disable-next-line no-console
  console.log(md);
  process.exit(0);
}

const instructions = [
  'You are Graphfly Doc Agent.',
  'You must be safe-by-design: never request or output source code bodies/snippets.',
  'Generate documentation using Public Contract Graph fields only: signatures, schemas, constraints, allowable values, locations, and flow metadata.',
  'Output markdown only.'
].join('\n');

const input = [
  'Create a single Markdown doc block for the given symbol.',
  'Include: heading, 1-sentence summary, contract/schema bullets, constraints/allowable values, and evidence (file path + line range).',
  `SymbolUid: ${symbolUid}`,
  'Use the tool contracts_get(symbolUid) to fetch the contract.'
].join('\n');

const apiKey = process.env.OPENROUTER_API_KEY ?? '';
const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const model = process.env.GRAPHFLY_LLM_MODEL ?? 'openai/gpt-4o-mini';

const { outputText } = await runOpenRouterToolLoop({
  apiKey,
  baseUrl,
  model,
  input,
  instructions,
  user: `graphfly:${tenantId}:${repoId}`,
  tools,
  maxTurns: 10,
  appTitle: 'Graphfly',
  httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? null
});

const v = validateDocBlockMarkdown(outputText);
if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);
// eslint-disable-next-line no-console
console.log(outputText);
