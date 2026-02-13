import { runOpenClawToolLoop } from '../../../packages/openclaw-client/src/openresponses.js';
import { makeGraphflyTools } from '../../../packages/openclaw-client/src/graphfly-tools.js';
import { renderContractDocBlock } from './doc-block-render.js';
import { validateDocBlockMarkdown } from '../../../packages/doc-blocks/src/validate.js';

// Minimal “contract doc agent” runner:
// - Uses OpenClaw as the agent runtime
// - Uses client-side tools to fetch Public Contract Graph data from Graphfly API
// - Produces a contract-first markdown snippet (no code bodies/snippets)

const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? '';
const agentId = process.env.OPENCLAW_AGENT_ID ?? 'main';

const apiUrl = process.env.GRAPHFLY_API_URL ?? 'http://127.0.0.1:8787';
const tenantId = process.env.TENANT_ID ?? 't-1';
const repoId = process.env.REPO_ID ?? 'r-1';

const symbolUid = process.argv[2];
if (!gatewayUrl) {
  // eslint-disable-next-line no-console
  console.error('OPENCLAW_GATEWAY_URL is required');
  process.exit(1);
}
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

const { outputText } = await runOpenClawToolLoop({
  gatewayUrl,
  token,
  agentId,
  input,
  instructions,
  user: `graphfly:${tenantId}:${repoId}`,
  tools,
  maxTurns: 10
});

const v = validateDocBlockMarkdown(outputText);
if (!v.ok) throw new Error(`doc_block_invalid:${v.reason}`);
// eslint-disable-next-line no-console
console.log(outputText);
